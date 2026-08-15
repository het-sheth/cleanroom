---
type: concept
title: Track A/B integration risks
description: Contract conflict and two measured findings, raised against the sentinel-core plan
timestamp: 2026-08-15T21:55:00Z
---

Raised by Track B after reading `docs/superpowers/plans/2026-08-15-sentinel-core.md`. Track A's
code is not written yet, which is why these are worth settling now rather than at merge.

## 1. Placeholder numbering — contract conflict, needs an ack

[[contracts/redacted-baseline]] says: *"Placeholders are typed and indexed: `[SSN_1]`,
`[PERSON_2]`."* Two readings, and the two tracks have each implemented a different one:

| | scheme | same input renders as |
|---|---|---|
| Track B `scripts/redact_baseline.py` | one counter across the transcript | `[SSN_1]`, `[PERSON_2]` |
| Track A plan, Task 3 | counter **per entity type** | `[SSN_1]`, `[PERSON_1]` |

The contract's own example only reproduces under the global counter, so the plan as written
diverges from it. But per-type numbering is the better design: `[PERSON_1]` and `[PERSON_2]`
tell a reader there are two distinct people, where a global counter makes the number meaningless.

**Why it matters beyond aesthetics:** BEFORE numbers come from Track B's Python redactor and
AFTER from Track A's Sentinel. If the two number differently, every placeholder in the demo diff
shifts and the comparison reads as churn rather than as improvement.

**Track B's recommendation:** adopt per-type numbering in both, and correct the contract's example
to `[SSN_1]`, `[PERSON_1]`. Track B will change its redactor to match on ack — not before, per the
AGENTS.md rule against unilateral contract edits. **Track A: reply here.**

## 2. Repeated values — measured, mitigation already in Track B

A value appearing several times in one Transcript is only fully removed if *every* occurrence is
replaced. Track B's redactor therefore scrubs literal repeats of any detected span (≥4 chars)
after applying the returned offsets, per fail-closed (ADR 0003).

Whether Pioneer returns one span per occurrence or only the first is **unverified** — no live call
has been made yet (no API key; see [[build-order]]). {{unverified — resolve with
`scripts/redact_baseline.py --probe` the moment a key exists}} What *is* measured is the blast
radius if it returns only the first: **t01, t06, t14, t18 and t25 each repeat a planted value**, so
offset-only redaction leaks in 5 of 25 transcripts, t25 being the injection fixture we demo.

Task 3 of the plan already locates successive occurrences when offsets are *absent*. The gap is
only the case where offsets are *present but partial*. Cheap to close either way.

## 3. Mock-mode route distribution — measured against the real dataset

Task 4's test asks for a below-floor case computed rather than guessed. Computed here over all 82
planted entities using the plan's own formula
(`0.30 + (sha256(id+type+value)[0:4] / 0xffff) * 0.65`) and `DEFAULT_POLICY` (floor 0.35,
ceiling 0.75):

- **auto-redact 25 (30%) · consult 46 (56%) · allow-observed 11 (13%)** — all three routes are
  well populated, so the mock demo exercises the whole policy without tuning.
- **Below-floor fixtures for the Task 4 test** (lowest first): `t24`/address `0.3025`,
  `t15`/phone `0.3099`, `t24`/username `0.3138`, `t09`/medical_record_number `0.3143`,
  `t06`/person `0.3161`.
- **Contextual-type proof case:** `t16`/`@rmoyer-dev` scores `0.8328` — above the ceiling — and
  still routes to consult. That single row demonstrates the contextual rule better than any
  synthetic example.
- **Best demo transcript: `t25`.** The injection fixture is one of six transcripts that exercise
  all three routes in a single scrub, so the security moment and the policy walkthrough are the
  same screen.
- Note the mock hashes `id + type + value`, so the same username scores differently per
  transcript: `t-bergqvist` is `0.7896` (consult) in t16 but `0.3138` (allow-observed) in t24.
  Realistic enough, but don't narrate mock confidences as if they were model outputs.

Entity-type vocabulary lines up: all four of the plan's `contextual_types`
(`username`, `organization`, `location`, `job_title`) occur as planted types in
[[contracts/transcripts-jsonl]]. Whether *Pioneer* emits those same type strings is unverified
until a live call is made.
