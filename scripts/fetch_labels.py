#!/usr/bin/env python3
"""Poll the live Terac study and write data/labels.json.

Contract: context/contracts/labels-json.md (frozen — Track A's threshold tuner reads this).

  {"t01": {"leak_reports": [{"quoted_text": "...", "n_raters": 3}],
           "usefulness_avg": 4.2, "n_raters": 5}}

Usage:
  python3 scripts/fetch_labels.py --probe              # auth check + dump raw submissions
  python3 scripts/fetch_labels.py                      # fetch once, write labels.json
  python3 scripts/fetch_labels.py --watch 120          # re-poll every 120s until raters finish
  python3 scripts/fetch_labels.py --from-json dump.json  # aggregate an MCP tool dump instead

Auth: TERAC_API_KEY + TERAC_OPPORTUNITY_ID in .env. If the study was launched through the
Terac MCP rather than REST, save the terac_get_submissions output to a file and use --from-json;
the aggregation below is the part Track A depends on and is identical either way.

Stdlib only.
"""

import argparse
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "labels.json"
BASE = "https://terac.com/api/external/v2"


def env(name, required=True):
    import os

    v = os.environ.get(name)
    if not v:
        f = ROOT / ".env"
        if f.exists():
            for line in f.read_text().splitlines():
                line = line.strip()
                if line.startswith(f"{name}="):
                    v = line.split("=", 1)[1].strip().strip("'\"")
                    break
    if not v and required:
        sys.exit(f"{name} not set. Add it to {ROOT/'.env'} (gitignored).")
    return v


def get(path, key):
    req = urllib.request.Request(
        f"{BASE}{path}", headers={"Authorization": f"Bearer {key}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        if e.code in (401, 403):
            sys.exit(f"Terac auth failed ({e.code}). Check TERAC_API_KEY. {detail}")
        sys.exit(f"Terac HTTP {e.code} on {path}: {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Terac unreachable: {e}")


def fetch_submissions(key, opp):
    resp = get(f"/opportunities/{opp}/submissions", key)
    if isinstance(resp, list):
        return resp
    for k in ("submissions", "results", "data", "items", "responses"):
        if isinstance(resp.get(k), list):
            return resp[k]
    raise ValueError(f"could not find submissions list in: {json.dumps(resp)[:600]}")


# --------------------------------------------------------------------- aggregation

SNIPPET_KEYS = ("snippet_id", "transcript_id", "item_id", "stimulus_id", "id", "snippet")
YES = {"yes", "y", "true", "1"}


def _walk_answers(sub):
    """Yield (question_text_or_key, answer) from whatever nesting Terac uses."""
    ans = sub.get("answers") or sub.get("responses") or sub.get("questions") or sub
    if isinstance(ans, dict):
        for k, v in ans.items():
            yield str(k), v
    elif isinstance(ans, list):
        for a in ans:
            if isinstance(a, dict):
                q = a.get("question") or a.get("prompt") or a.get("key") or a.get("label") or ""
                v = a.get("answer", a.get("value", a.get("response")))
                yield str(q), v


def classify(qtext):
    q = qtext.lower()
    if any(w in q for w in ("could you learn", "anything personal", "leak", "reveal")) and "copy" not in q:
        return "leak_yn"
    if any(w in q for w in ("copy the exact", "exact words", "quote", "which words")):
        return "quote"
    if any(w in q for w in ("readable", "useful", "usefulness", "1-5", "1–5")):
        return "usefulness"
    return None


def snippet_of(sub):
    for k in SNIPPET_KEYS:
        v = sub.get(k)
        if isinstance(v, str) and re.fullmatch(r"t\d{2}", v.strip()):
            return v.strip()
    blob = json.dumps(sub)
    m = re.search(r"\bt\d{2}\b", blob)  # fall back: find the tNN tag we embedded in the snippet
    return m.group(0) if m else None


def norm_quote(s):
    return re.sub(r"\s+", " ", str(s)).strip().strip('"\'').lower()


def aggregate(submissions):
    raters = defaultdict(set)
    scores = defaultdict(list)
    quotes = defaultdict(lambda: defaultdict(set))  # snippet -> normalized quote -> rater ids

    for i, sub in enumerate(submissions):
        tid = snippet_of(sub)
        if not tid:
            continue
        rid = str(sub.get("rater_id") or sub.get("participant_id") or sub.get("submission_id") or i)
        raters[tid].add(rid)

        leak_yes, quote, score = None, None, None
        for q, v in _walk_answers(sub):
            kind = classify(q)
            if kind == "leak_yn":
                leak_yes = str(v).strip().lower() in YES
            elif kind == "quote" and v:
                quote = str(v)
            elif kind == "usefulness" and v is not None:
                m = re.search(r"[1-5]", str(v))
                if m:
                    score = int(m.group())

        if score is not None:
            scores[tid].append(score)
        # A quote is the actual signal; keep it if given, even when the yes/no was left blank.
        if quote and norm_quote(quote) not in ("", "n/a", "na", "none", "no"):
            if leak_yes is not False:
                quotes[tid][norm_quote(quote)].add(rid)

    labels = {}
    for tid in sorted(raters):
        reports = [
            {"quoted_text": q, "n_raters": len(rs)}
            for q, rs in sorted(quotes[tid].items(), key=lambda kv: -len(kv[1]))
        ]
        s = scores[tid]
        labels[tid] = {
            "leak_reports": reports,
            "usefulness_avg": round(sum(s) / len(s), 2) if s else None,
            "n_raters": len(raters[tid]),
        }
    return labels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="auth check + dump raw submissions")
    ap.add_argument("--watch", type=int, metavar="SECS", help="re-poll until every snippet has 5 raters")
    ap.add_argument("--from-json", metavar="PATH", help="aggregate a saved MCP dump instead of REST")
    args = ap.parse_args()

    if args.from_json:
        raw = json.loads(pathlib.Path(args.from_json).read_text())
        subs = raw if isinstance(raw, list) else next(
            (v for v in raw.values() if isinstance(v, list)), []
        )
        labels = aggregate(subs)
        OUT.write_text(json.dumps(labels, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {OUT} — {len(labels)} snippets from {len(subs)} submissions")
        return

    key, opp = env("TERAC_API_KEY"), env("TERAC_OPPORTUNITY_ID")

    while True:
        subs = fetch_submissions(key, opp)
        if args.probe:
            print(f"auth OK — opportunity {opp}, {len(subs)} submissions so far")
            print(json.dumps(subs[:2], indent=2)[:2500] if subs else "(no submissions yet)")
            return

        labels = aggregate(subs)
        OUT.write_text(json.dumps(labels, indent=2, ensure_ascii=False) + "\n")
        done = sum(1 for v in labels.values() if v["n_raters"] >= 5)
        leaks = sum(len(v["leak_reports"]) for v in labels.values())
        print(f"wrote {OUT} — {len(subs)} submissions, {len(labels)} snippets, "
              f"{done} at 5+ raters, {leaks} leak reports")

        if not args.watch or (labels and done == len(labels)):
            return
        time.sleep(args.watch)


if __name__ == "__main__":
    main()
