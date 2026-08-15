#!/usr/bin/env python3
"""Baseline redaction pass over data/transcripts.jsonl via Pioneer GLiNER2-PII.

Contract: context/contracts/redacted-baseline.md
Writes data/redacted_baseline.jsonl and data/baseline_metrics.json (the demo's BEFORE numbers).

No tuning here by design — the baseline is supposed to miss things (see build-order).

Usage:
  python3 scripts/redact_baseline.py --probe    # dump ONE raw API response, adapt, then run
  python3 scripts/redact_baseline.py            # full pass over all 25
  python3 scripts/redact_baseline.py --mock     # no key needed; unblocks the Terac payload,
                                                # but the numbers are NOT detector measurements

Needs PIONEER_API_KEY in .env (gitignored) or the environment.
Stdlib only — no pip install, so it runs cold.
"""

import argparse
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
TRANSCRIPTS = ROOT / "data" / "transcripts.jsonl"
OUT_JSONL = ROOT / "data" / "redacted_baseline.jsonl"
OUT_METRICS = ROOT / "data" / "baseline_metrics.json"

ENDPOINT = "https://api.pioneer.ai/inference"
MODEL_ID = "fastino/gliner2-privacy-filter-PII-multi"
THRESHOLD = 0.5  # default; do NOT tune here — tuning happens after Terac labels


def mock_detections(row):
    """Stand-in detections derived from planted ground truth — NOT a model measurement.

    Uses the same pseudo-confidence formula as the Sentinel's mock mode
    (docs/superpowers/plans/2026-08-15-sentinel-core.md Task 4) so a mock BEFORE and a mock
    AFTER are directly comparable. Spans below the policy floor are left undetected, which is
    what makes a mock baseline miss anything at all.

    Exists so the Terac snippet payload can be built before a Pioneer key arrives — the study
    launch is the critical path. Numbers produced this way are pipeline smoke tests and must
    never be quoted as baseline detector recall.
    """
    import hashlib

    FLOOR = 0.35  # DEFAULT_POLICY floor; below this the Sentinel routes allow-observed
    dets = []
    for p in row["planted"]:
        h = hashlib.sha256((row["id"] + p["type"] + p["value"]).encode()).hexdigest()
        conf = 0.30 + (int(h[:4], 16) / 0xFFFF) * 0.65
        if conf < FLOOR:
            continue  # allow-observed: seen, ledgered, not redacted
        start = row["text"].find(p["value"])
        while start != -1:
            dets.append({"type": p["type"], "text": p["value"], "start": start,
                         "end": start + len(p["value"]), "confidence": round(conf, 4)})
            start = row["text"].find(p["value"], start + 1)
    return dets


def load_key():
    import os

    key = os.environ.get("PIONEER_API_KEY")
    if key:
        return key
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line.startswith("PIONEER_API_KEY="):
                return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(
        "PIONEER_API_KEY not found.\n"
        "  Get one: https://agent.pioneer.ai -> Billing -> Get Pro (promo ZeroHumanHack0826)\n"
        "           -> Settings -> API Keys (shown once)\n"
        f"  Then:    echo 'PIONEER_API_KEY=<key>' >> {env}"
    )


def call_pioneer(text, key, retries=3):
    body = json.dumps({"model_id": MODEL_ID, "text": text, "threshold": THRESHOLD}).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body, headers={"X-API-Key": key, "Content-Type": "application/json"}
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:400]
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"Pioneer HTTP {e.code}: {detail}")
        except urllib.error.URLError as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"Pioneer unreachable: {e}")


def extract_detections(resp, text):
    """Normalize Pioneer's response into our detection shape.

    The exact response shape is unverified (see context/research/pioneer.md), so this accepts
    the plausible variants rather than guessing at one. Run --probe first; if none of these
    match, print shows the raw body and this is the ONE function to edit.

    Matches the normalization in sentinel/lib/detector.js so both tracks flatten identically:
    a span whose text cannot be located in the transcript is emitted with
    ``start=None, end=None, unlocatable=True`` — never dropped (ADR 0003 fails CLOSED, and a
    dropped detection is PII that survives into the redacted output). redact() then scrubs
    such a span by literal text.
    """
    # Find the list of spans wherever it lives.
    candidates = None
    if isinstance(resp, list):
        candidates = resp
    elif isinstance(resp, dict):
        for k in ("entities", "detections", "predictions", "results", "spans", "output", "data"):
            v = resp.get(k)
            if isinstance(v, list):
                candidates = v
                break
            if isinstance(v, dict):  # e.g. {"entities": {"ssn": [...]}} grouped by type
                flat = []
                for typ, items in v.items():
                    for it in items if isinstance(items, list) else [items]:
                        d = dict(it) if isinstance(it, dict) else {"text": it}
                        d.setdefault("label", typ)
                        flat.append(d)
                candidates = flat
                break
    if candidates is None:
        raise ValueError(f"could not locate spans in response: {json.dumps(resp)[:600]}")

    out = []
    occurrence = {}  # span text -> next search offset, so duplicates map to successive hits

    def locate(span):
        """(start, end, unlocatable) — never a -1 sentinel downstream code could splice on."""
        frm = occurrence.get(span, 0)
        i = text.find(span, frm)
        if i == -1:
            return None, None, True
        occurrence[span] = i + len(span)
        return i, i + len(span), False

    for c in candidates:
        if not isinstance(c, dict):
            continue
        typ = c.get("label") or c.get("type") or c.get("entity") or c.get("entity_type") or "unknown"
        span = c.get("text") or c.get("span") or c.get("value") or c.get("word")
        start, end = c.get("start"), c.get("end")
        if start is None and "offset" in c:
            start = c["offset"]
            end = start + len(span or "")
        if span is None and start is not None and end is not None:
            span = text[start:end]
        if span is None:
            continue
        unlocatable = False
        if start is None or end is None or text[start:end] != span:
            # Offsets absent or stale. Recover them if we can; otherwise keep the detection as
            # unlocatable — dropping it here is a fail-OPEN leak (ADR 0003).
            start, end, unlocatable = locate(span)
        conf = c.get("confidence", c.get("score", c.get("probability")))
        det = {
            "type": str(typ).lower(),
            "text": span,
            "start": None if start is None else int(start),
            "end": None if end is None else int(end),
            "confidence": round(float(conf), 4) if conf is not None else None,
        }
        if unlocatable:
            det["unlocatable"] = True
        out.append(det)
    return out


def is_positioned(d):
    """Does this detection carry offsets that select a real, non-empty range?

    Mirrors isPositioned() in sentinel/lib/redact.js. Anything else — the `unlocatable` flag,
    None/negative offsets, an empty or inverted range — must never reach the offset splice.
    """
    return (
        not d.get("unlocatable")
        and isinstance(d.get("start"), int)
        and isinstance(d.get("end"), int)
        and d["start"] >= 0
        and d["end"] > d["start"]
    )


def _conf(d):
    c = d.get("confidence")
    return c if isinstance(c, (int, float)) else -1.0  # unknown confidence loses every tie-break


def resolve_overlaps(detections):
    """Keep a non-overlapping set: containment skips the inner span, a partial overlap keeps the
    HIGHER-CONFIDENCE span. Mirrors resolveOverlaps() in sentinel/lib/redact.js (plan Task 3) —
    the old leftmost-wins rule made BEFORE/AFTER placeholder counts a tie-break artifact.

    Only positioned spans take part; overlap is meaningless without real offsets.
    """
    ordered = sorted(
        (d for d in detections if is_positioned(d)),
        key=lambda d: (d["start"], -(d["end"] - d["start"])),
    )
    kept = []
    for span in ordered:
        skip = False
        i = 0
        while i < len(kept):
            k = kept[i]
            if not (span["start"] < k["end"] and k["start"] < span["end"]):
                i += 1
                continue
            if k["start"] <= span["start"] and span["end"] <= k["end"]:  # contained in a kept span
                skip = True
                break
            if span["start"] <= k["start"] and k["end"] <= span["end"]:  # contains a kept span
                kept.pop(i)
                continue
            if _conf(span) > _conf(k):  # partial overlap: higher confidence wins
                kept.pop(i)
                continue
            skip = True
            break
        if not skip:
            kept.append(span)
    return kept


def redact(text, detections):
    """Replace each detected span with a typed, per-type-indexed placeholder.

    Returns ``(redacted_text, unresolved)``. `unresolved` lists redacted spans that had no
    usable offsets: they were scrubbed by literal text only. `scrubbed: False` means the span's
    text never occurred literally, so nothing was removed for it — the caller must surface that
    loudly rather than let a silent detection count imply a clean redaction (ADR 0003).

    Numbering is per entity type, in order of first appearance: the first person is [PERSON_1],
    the first SSN [SSN_1], the second person [PERSON_2]. Two spans with the same type and text
    share a number. Per context/contracts/redacted-baseline.md, corrected 2026-08-15 — a single
    counter across all types made the number meaningless, where per-type numbering tells a reader
    how many distinct people or cards a transcript held. Track A's Sentinel numbers the same way,
    so BEFORE and AFTER stay diffable.
    """
    kept = sorted(resolve_overlaps(detections), key=lambda d: d["start"])
    # Spans without usable offsets bypass overlap resolution (nothing to compare) but are still
    # kept, tokenized and scrubbed by literal text — never dropped.
    unlocatable = [d for d in detections if not is_positioned(d) and d.get("text")]

    assigned, per_type = {}, {}
    for d in kept + unlocatable:  # positioned spans numbered in offset order, the rest after
        key = (d["type"], d["text"])
        if key not in assigned:  # same span text -> same placeholder within a transcript
            per_type[d["type"]] = per_type.get(d["type"], 0) + 1
            tag = re.sub(r"[^A-Za-z0-9]", "_", d["type"]).upper()
            assigned[key] = f"[{tag}_{per_type[d['type']]}]"

    parts, cursor = [], 0
    for d in kept:
        parts.append(text[cursor:d["start"]])
        parts.append(assigned[(d["type"], d["text"])])
        cursor = d["end"]
    parts.append(text[cursor:])
    out = "".join(parts)

    # Fail closed (ADR 0003): the detector often returns only the first occurrence of a value
    # that appears several times in a transcript, and an unlocatable span has no offsets at all.
    # Once a span is known to be PII, scrub every literal occurrence of it too, or it leaks
    # through untouched. Longest span text first, so a shorter span can't corrupt a longer one.
    for (_typ, span), placeholder in sorted(assigned.items(), key=lambda kv: -len(kv[0][1])):
        if len(span) >= 4:  # too-short spans would match unrelated substrings
            out = out.replace(span, placeholder)

    seen, unresolved = set(), []
    for d in unlocatable:
        key = (d["type"], d["text"])
        if key in seen:
            continue
        seen.add(key)
        unresolved.append(
            {
                "type": d["type"],
                "token": assigned[key],
                # True only when a literal occurrence existed and is now gone.
                "scrubbed": d["text"] in text and d["text"] not in out,
            }
        )
    return out, unresolved


def caught(planted_value, redacted_text):
    """Caught iff the planted value no longer survives in the redacted output.

    Measured against the redacted text rather than by comparing strings to detection spans.
    Span-similarity matching over-credits: a detection of the email 'n.voss@vellumhr.com'
    shares characters with the planted username 'nvoss' and scored as a catch, even though the
    detector never found the username. Survival in the output is the fact we actually care
    about — it is what a Terac rater can read — and it needs no similarity heuristic.
    """
    return planted_value not in redacted_text


def covering_detection(planted_value, text, detections):
    """Which detection overlapped this planted span — diagnostics only, not the catch metric."""
    starts, i = [], text.find(planted_value)
    while i != -1:
        starts.append(i)
        i = text.find(planted_value, i + 1)
    for ps in starts:
        pe = ps + len(planted_value)
        for d in detections:
            if not is_positioned(d):  # unlocatable spans have no range to overlap
                continue
            if d["start"] < pe and ps < d["end"]:  # any character overlap
                return d
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="print one raw response and exit")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--mock", action="store_true",
                    help="derive detections from planted ground truth instead of calling Pioneer; "
                         "unblocks the Terac payload before a key exists (NOT a real baseline)")
    args = ap.parse_args()

    key = None if args.mock else load_key()
    rows = [json.loads(l) for l in TRANSCRIPTS.open()]

    if args.probe:
        resp = call_pioneer(rows[0]["text"], key)
        print("RAW RESPONSE for t01 (adapt extract_detections() to this shape):\n")
        print(json.dumps(resp, indent=2)[:4000])
        try:
            dets = extract_detections(resp, rows[0]["text"])
            print(f"\nparsed OK: {len(dets)} detections; first: {dets[:2]}")
        except ValueError as e:
            print(f"\nPARSE FAILED: {e}")
        return

    if args.limit:
        rows = rows[: args.limit]

    results = []
    for i, r in enumerate(rows, 1):
        if args.mock:
            dets = mock_detections(r)
        else:
            dets = extract_detections(call_pioneer(r["text"], key), r["text"])
        red_text, unresolved = redact(r["text"], dets)
        results.append({"id": r["id"], "redacted_text": red_text, "detections": dets})
        print(f"  [{i}/{len(rows)}] {r['id']}: {len(dets)} detections", flush=True)
        # Surfaced loudly, never silently omitted (ADR 0003). Types only — errors reach stderr,
        # PII must not.
        for u in unresolved:
            if not u["scrubbed"]:
                print(f"  !! {r['id']}: UNSCRUBBED {u['type']} span {u['token']} — detected but "
                      f"not found literally in the transcript; output may still carry it",
                      file=sys.stderr, flush=True)

    with OUT_JSONL.open("w") as f:
        for res in results:
            f.write(json.dumps(res, ensure_ascii=False) + "\n")

    # ---- BEFORE metrics: planted caught vs missed, per planted entity type
    by_id = {res["id"]: res for res in results}
    per_type, misses, false_pos = {}, [], []
    for r in rows:
        dets = by_id[r["id"]]["detections"]
        red_text = by_id[r["id"]]["redacted_text"]
        for p in r["planted"]:
            slot = per_type.setdefault(p["type"], {"planted": 0, "caught": 0, "missed": 0})
            slot["planted"] += 1
            if caught(p["value"], red_text):
                slot["caught"] += 1
            else:
                slot["missed"] += 1
                cov = covering_detection(p["value"], r["text"], dets)
                misses.append(
                    {"id": r["id"], "type": p["type"], "value": p["value"],
                     "note": p.get("note", ""), "difficulty": r["difficulty"],
                     # a partial overlap means the detector saw part of the span and still leaked it
                     "partially_detected_as": {"type": cov["type"], "text": cov["text"],
                                               "confidence": cov["confidence"]} if cov else None}
                )
        if not r["planted"] and dets:  # tricky negative that still fired
            false_pos.append(
                {"id": r["id"], "spurious": [{"type": d["type"], "text": d["text"],
                                              "confidence": d["confidence"]} for d in dets]}
            )

    for v in per_type.values():
        v["recall"] = round(v["caught"] / v["planted"], 3) if v["planted"] else None

    total_p = sum(v["planted"] for v in per_type.values())
    total_c = sum(v["caught"] for v in per_type.values())
    hard_rows = [r for r in rows if r["difficulty"] == "hard" and r["planted"]]
    hard_p = sum(len(r["planted"]) for r in hard_rows)
    hard_c = sum(
        1 for r in hard_rows for p in r["planted"]
        if caught(p["value"], by_id[r["id"]]["redacted_text"])
    )

    metrics = {
        "label": "BEFORE (MOCK — not a detector measurement)" if args.mock else "BEFORE",
        "mock": bool(args.mock),
        "model_id": "mock" if args.mock else MODEL_ID,
        "threshold": THRESHOLD,
        "transcripts": len(rows),
        "overall": {
            "planted": total_p,
            "caught": total_c,
            "missed": total_p - total_c,
            "recall": round(total_c / total_p, 3) if total_p else None,
        },
        "hard_cases_only": {
            "planted": hard_p,
            "caught": hard_c,
            "recall": round(hard_c / hard_p, 3) if hard_p else None,
        },
        "tricky_negatives": {
            "transcripts": sum(1 for r in rows if not r["planted"]),
            "with_false_positives": len(false_pos),
            "detail": false_pos,
        },
        "per_entity_type": per_type,
        "missed_entities": misses,
    }
    OUT_METRICS.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n")

    print(f"\nwrote {OUT_JSONL} ({len(results)} rows)")
    print(f"wrote {OUT_METRICS}")
    print(f"BEFORE recall: {total_c}/{total_p} overall, {hard_c}/{hard_p} on hard cases")
    print(f"tricky negatives firing false positives: {len(false_pos)}/"
          f"{sum(1 for r in rows if not r['planted'])}")


if __name__ == "__main__":
    main()
