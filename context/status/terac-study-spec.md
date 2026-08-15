---
type: worked-example
title: Terac study — ready-to-launch spec
description: Exact feasibility/launch calls and decision tree for the leak-spotting study (Task 3)
timestamp: 2026-08-15T21:20:00Z
---

Status: **NOT LAUNCHED — blocked.** The Terac MCP is not configured in this environment and the
credit link is unredeemed. Both need the account holder; Track B cannot self-unblock. Everything
below is prepared so launch is a single call once it is.

Prereqs, in order:
1. `claude mcp add --transport http terac https://terac.com/mcp`, restart the session, complete
   the OAuth prompt.
2. Redeem credits: https://terac.com/r/rGi7O0EfkRbzmiElg8kRjES5W2JrKNYc
3. `PIONEER_API_KEY` in `.env` → `python3 scripts/redact_baseline.py` → `python3 scripts/build_snippets.py`.
   The study shows *redacted* text, so the baseline pass gates the launch. See [[build-order]].

## Job description (pass verbatim to `terac_request_feasibility`)

> Rate short excerpts from automated software-engineering session logs. Each excerpt has had
> personal information automatically removed and replaced with placeholders like [EMAIL_1] or
> [SSN_2]. For each excerpt you will answer three questions: whether you can still learn anything
> personal about a specific person or account from what remains, and if so which exact words
> reveal it; and how readable the excerpt still is. No special expertise required — we want
> ordinary readers, because the question is whether a normal person can spot what leaked. All
> excerpts are synthetic test data containing no real personal information.

- Audience: **general population, no screening** (organizer guidance: fastest turnaround).
- 15 snippets × 5 raters = 75 rater-responses. Questions and snippet payload: `data/study_snippets.json`.

## Decision tree at quote time

| Quoted ETA | Action |
|---|---|
| ≤ 4h and within credits | Launch immediately with 15 snippets |
| > 4h | `python3 scripts/build_snippets.py --count 8`, re-quote |
| still > 4h | Launch anyway at 8 snippets — partial results beat none |

Snippet priority is fixed in `scripts/build_snippets.py`, so the 8-snippet fallback keeps the
injection fixture and the format-evasion hard cases and drops the easy controls first.

## On launch, record here and in [[build-order]]

- Opportunity ID: `___`
- Quoted ETA: `___` · quoted cost: `___` · launched at: `___`
- Then: `TERAC_OPPORTUNITY_ID` into `.env`, and `python3 scripts/fetch_labels.py --probe` to
  confirm auth *before* results exist. Poll with `--watch 120`.

## Constraint

ADR 0005: raters only ever see synthetic or templated examples, never customer spans. Every
snippet here derives from `data/transcripts.jsonl`, which is wholly synthetic — this holds by
construction, and must keep holding if the snippet source ever changes.
