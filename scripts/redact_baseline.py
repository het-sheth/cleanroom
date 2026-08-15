#!/usr/bin/env python3
"""Baseline redaction pass over data/transcripts.jsonl via Pioneer GLiNER2-PII.

Contract: context/contracts/redacted-baseline.md
Writes data/redacted_baseline.jsonl and data/baseline_metrics.json (the demo's BEFORE numbers).

No tuning here by design — the baseline is supposed to miss things (see build-order).

Usage:
  python3 scripts/redact_baseline.py --probe    # dump ONE raw API response, adapt, then run
  python3 scripts/redact_baseline.py            # full pass over all 25

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
        if start is None or end is None or text[start:end] != span:
            i = text.find(span)  # offsets absent or stale: recover them
            if i == -1:
                continue
            start, end = i, i + len(span)
        conf = c.get("confidence", c.get("score", c.get("probability")))
        out.append(
            {
                "type": str(typ).lower(),
                "text": span,
                "start": int(start),
                "end": int(end),
                "confidence": round(float(conf), 4) if conf is not None else None,
            }
        )
    return out


def redact(text, detections):
    """Replace each detected span with a typed, indexed placeholder: [SSN_1], [PERSON_2]."""
    spans = sorted(detections, key=lambda d: (d["start"], -d["end"]))
    kept, last_end = [], -1
    for d in spans:  # drop overlaps; first (leftmost, longest) wins
        if d["start"] >= last_end:
            kept.append(d)
            last_end = d["end"]

    assigned, counter, parts, cursor = {}, 0, [], 0
    for d in kept:
        key = (d["type"], d["text"])
        if key not in assigned:  # same span text -> same placeholder within a transcript
            counter += 1
            assigned[key] = f"[{d['type'].upper()}_{counter}]"
        parts.append(text[cursor:d["start"]])
        parts.append(assigned[key])
        cursor = d["end"]
    parts.append(text[cursor:])
    out = "".join(parts)

    # Fail closed (ADR 0003): the detector often returns only the first occurrence of a value
    # that appears several times in a transcript. Once a span is known to be PII, scrub every
    # literal repeat of it too, or the duplicates leak through untouched.
    for (_typ, span), placeholder in assigned.items():
        if len(span) >= 4:  # too-short spans would match unrelated substrings
            out = out.replace(span, placeholder)
    return out


def norm(s):
    """Loose comparison key: planted 'five two three, zero four' vs a detected substring."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def caught(planted_value, detections):
    """A planted entity counts as caught if a detected span covers it (either containment)."""
    pv = norm(planted_value)
    if not pv:
        return None
    for d in detections:
        dv = norm(d["text"])
        if dv and (pv in dv or dv in pv):
            return d
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="print one raw response and exit")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    key = load_key()
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
        resp = call_pioneer(r["text"], key)
        dets = extract_detections(resp, r["text"])
        results.append({"id": r["id"], "redacted_text": redact(r["text"], dets), "detections": dets})
        print(f"  [{i}/{len(rows)}] {r['id']}: {len(dets)} detections", flush=True)

    with OUT_JSONL.open("w") as f:
        for res in results:
            f.write(json.dumps(res, ensure_ascii=False) + "\n")

    # ---- BEFORE metrics: planted caught vs missed, per planted entity type
    by_id = {res["id"]: res for res in results}
    per_type, misses, false_pos = {}, [], []
    for r in rows:
        dets = by_id[r["id"]]["detections"]
        for p in r["planted"]:
            slot = per_type.setdefault(p["type"], {"planted": 0, "caught": 0, "missed": 0})
            slot["planted"] += 1
            hit = caught(p["value"], dets)
            if hit:
                slot["caught"] += 1
            else:
                slot["missed"] += 1
                misses.append(
                    {"id": r["id"], "type": p["type"], "value": p["value"],
                     "note": p.get("note", ""), "difficulty": r["difficulty"]}
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
        1 for r in hard_rows for p in r["planted"] if caught(p["value"], by_id[r["id"]]["detections"])
    )

    metrics = {
        "label": "BEFORE",
        "model_id": MODEL_ID,
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
