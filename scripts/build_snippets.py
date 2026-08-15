#!/usr/bin/env python3
"""Select and format the Terac study snippets from data/redacted_baseline.jsonl.

Feeds Task 3. Writes data/study_snippets.json — the payload to hand to
terac_launch_draft_opportunity (see context/status/terac-study-spec.md).

Selection: every hard case + the injection fixture + a few easy/negative controls.
Controls matter — without them we only measure under-redaction and learn nothing about
over-redaction, which is what usefulness_avg is for.

Each snippet embeds its tNN id in the visible header so scripts/fetch_labels.py can map a
rater submission back to a transcript regardless of how Terac echoes item ids.

Usage:
  python3 scripts/build_snippets.py            # 15 snippets (default)
  python3 scripts/build_snippets.py --count 8  # fallback if Terac quotes ETA > 4h twice
"""

import argparse
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TRANSCRIPTS = ROOT / "data" / "transcripts.jsonl"
REDACTED = ROOT / "data" / "redacted_baseline.jsonl"
OUT = ROOT / "data" / "study_snippets.json"

# Priority order. Hard cases and the injection fixture first, so --count 8 degrades to the
# most informative subset rather than an arbitrary one.
PRIORITY = [
    "t25",  # injection fixture — the security demo
    "t12", "t13", "t14", "t18",  # format-evasion: separators, spelled-out, intl, truncated PAN
    "t11", "t15", "t16", "t17", "t24",  # misspellings, split-across-tool-call, handles, quasi-id
    "t19", "t21",  # tricky negatives — catch over-redaction
    "t06", "t04", "t01",  # easy controls — if these leak, something is badly wrong
]

MAX_WORDS = 170  # keep rater time down; longer snippets cut completion rate


def trim(text, max_words=MAX_WORDS):
    """Keep the window with the most placeholders — that's the part raters need to judge."""
    words = text.split()
    if len(words) <= max_words:
        return text
    best_i, best_score = 0, -1
    for i in range(0, len(words) - max_words + 1, 10):
        score = sum(1 for w in words[i : i + max_words] if "[" in w and "]" in w)
        if score > best_score:
            best_i, best_score = i, score
    chunk = " ".join(words[best_i : best_i + max_words])
    return ("… " if best_i else "") + chunk + (" …" if best_i + max_words < len(words) else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=15)
    args = ap.parse_args()

    if not REDACTED.exists():
        raise SystemExit(
            f"{REDACTED} missing — run scripts/redact_baseline.py first (needs PIONEER_API_KEY)."
        )

    red = {json.loads(l)["id"]: json.loads(l) for l in REDACTED.open()}
    src = {json.loads(l)["id"]: json.loads(l) for l in TRANSCRIPTS.open()}

    chosen = [t for t in PRIORITY if t in red][: args.count]
    snippets = []
    for tid in chosen:
        r = red[tid]
        snippets.append(
            {
                "item_id": tid,
                "text": f"[Session {tid}]\n\n{trim(r['redacted_text'])}",
                # internal only — never shown to raters, used to score their answers afterwards
                "_ground_truth": {
                    "planted": len(src[tid]["planted"]),
                    "detected": len(r["detections"]),
                    "difficulty": src[tid]["difficulty"],
                },
            }
        )

    payload = {
        "audience": "general population",
        "screening": "none",
        "raters_per_item": 5,
        "questions": [
            {
                "id": "leak_yn",
                "type": "single_choice",
                "prompt": "Could you learn anything personal about a specific real-seeming "
                          "person or account from this text?",
                "options": ["Yes", "No"],
            },
            {
                "id": "quote",
                "type": "free_text",
                "prompt": "If yes, copy the exact words that reveal it.",
                "required": False,
            },
            {
                "id": "usefulness",
                "type": "scale_1_5",
                "prompt": "How readable/useful is this text for understanding what happened "
                          "in the session? (1 = unreadable, 5 = perfectly clear)",
            },
        ],
        "snippets": snippets,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {OUT} — {len(snippets)} snippets, {len(snippets) * 5} rater-responses needed")
    print(f"  items: {', '.join(s['item_id'] for s in snippets)}")
    missing = [t for t in PRIORITY[: args.count] if t not in red]
    if missing:
        print(f"  WARNING: not in redacted baseline, skipped: {missing}")


if __name__ == "__main__":
    main()
