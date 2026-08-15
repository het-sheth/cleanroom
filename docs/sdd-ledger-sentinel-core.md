# SDD ledger — plan: docs/superpowers/plans/2026-08-15-sentinel-core.md

Branch: feat/sentinel-core. Base at start: 25909dc.

## Pre-flight conflict scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 policy ↔ T4 cli | T4 consumes `route()`, `DEFAULT_POLICY` | Signatures match plan text. Clean. |
| T2 ledger ↔ T4 cli | T4 consumes `Ledger`, `spanHmac`, PAYLOAD_KEYS incl. `model_id:"mock"`, `prompt_hash:null` | Payload keys match contracts/ledger-row.md order. Clean. |
| T3 redact ↔ T4 cli | T4 supplies decisions with `route`+`disposition:"timeout"` on consults | T3 spec: timeout redacts (ADR 0003). Clean. |
| T3 detector ↔ T5 finetune | Shared throw conventions, separate files | Clean. |
| T4 cli ↔ T5 cli | Both edit sentinel/cli.js; T5 needs `--model` override on scrub | Sequential; T5 text explicitly owns adding `--model` if T4 lacks it. Ruling: not a conflict — T5 carries it. |
| T1 self | Boundary tests (0.35, 0.75) vs route logic | Consistent (>= at ceiling, < at floor). Clean. |
| T2 self | rowHash canonicalization vs verify recompute | Same PAYLOAD_KEYS order both sides. Clean. |
| T4 self | Mock confidence formula vs "compute in test, don't guess" | Deterministic sha256 formula; tests can derive. Clean. |
| T5 self | shouldFineTune counts leak_reports entries vs labels-json contract | Contract shape has leak_reports[]; consistent. Clean. |

No conflicts requiring rulings. Global constraints noted: zero deps, node:test, sentinel/ only,
fail closed, no real PII, conventional commits.

## Progress

Task 1: implemented (636646c), DONE_WITH_CONCERNS — `node --test <dir>` fails on Node 25+.
Ruling: package.json test script must become `node --test "sentinel/test/**/*.test.js"` — plan's
literal script is broken on this machine's Node; fix in Task 1's fix round. Cost if wrong: none
(strictly more portable).
Merged origin/track-b/data-and-scripts (3bb13e2) before Task 1 review; future BASEs post-merge.
Ruling: per-type placeholder numbering confirmed (contract corrected, Track B acked to switch);
plan Task 3 gains repeat-scrub requirement; Task 4 test may reuse Track B's measured fixtures
(76b5e20). Cost if wrong: placeholder renumbering churn in demo diffs.
Task 1: review verdict — spec ✅ except npm test script (Important, matches standing ruling);
minor: weaken boundary assertion → fix in same round. Fix round 1 dispatched to original
implementer (script → glob form + tighten 0.35 assertion).
Dashboard (parallel, non-SDD): feat/dashboard done, 16/16 tests, pushed (8118909). Integration
note: byte-verify dashboard lib/chain.js canonicalization against Task 2 rowHash at Task 4 time.
Pioneer live probe: 403 card_required — billing/promo not completed on account; user notified.
Task 1: fix round 1/5 (2 addressed per implementer — npm-test glob + boundary assertion;
commit fa2facb). Scoped re-review dispatched (76b5e20..fa2facb).
Task 1: fix round 1/5 (2 addressed, 0 open; commit fa2facb). Re-review: all addressed, no new
breakage.
Task 1: minor (deferred): npm test glob single-quoting is POSIX-only; needs double-quote handling
if Windows ever matters.
Task 1: complete (commits 636646c..fa2facb, review clean after round 1)
Task 2: implemented (BASE e83b690, commit 21442a2, 29/29 via npm test, implementer DONE).
REVIEW NOT YET DISPATCHED — next controller action: review-package e83b690 21442a2 + task
reviewer per SKILL. Session handoff occurred here (HANDOFF.md at repo root, commit e0a7010).
Task 2: review clean (spec ✅, approved). Minor (deferred): append() re-reads whole file per call (O(n²)); no concurrency handling (out of scope per brief).
Task 2: complete (commits e83b690..21442a2, review clean)
Session resumed by new controller post-handoff. Merged origin/track-b/data-and-scripts (845db4a per-type numbering, 3353474 test-cmd fix); npm test 29/29 post-merge.
Ruling: Task 3 detector primary response path = verified Pioneer shape (flat payload w/ required schema; result.data.entities as dict-of-types → normalizer flattens), per context/research/pioneer.md; plan's older shape list kept only as defensive fallback. Cost if wrong: normalizer rework.
Note: .env in main worktree has only PIONEER_API_KEY + SUPABASE_ACCESS_TOKEN set; SUPABASE_URL/SERVICE_KEY/CLEANROOM_SALT/TERAC_API_KEY empty — delta's Supabase verify blocked, user flagged.
Task 3: dispatched (BASE 5caa15b, implementer sonnet; dispatch carries verified-Pioneer-shape ruling + per-type numbering ruling).
Task 3: implemented (BASE 5caa15b, commit 7d66889, 54/54 via npm test, implementer DONE; flagged edge: identical-range dual-type detection is first-wins, not confidence-weighted). Review dispatching.
Task 3: review — spec ❌ (1 Important, plan-mandated): shouldRedact whitelists redact dispositions; null/unknown disposition or unknown route falls through to allow, inverting ADR 0003. Ruling: ADR 0003 outranks brief's literal disposition list — default redact unless disposition === 'allow'; unknown routes fail closed too. Cost if wrong: over-redaction (safe direction). 6 minors deferred (dead swap branch; typeToken case-fold order vs Track B; occurrenceIndex mixed-offset edge; 3+-way overlap untested; report count slip; identical-range first-wins acceptable).
Task 3: fix round 1/5 (1 addressed per implementer — fail-closed default; commit 745fe91, 58/58). Scoped re-review dispatched (7d66889..745fe91).
Task 3: fix round 1/5 (1 addressed, 0 open; commits 7d66889..745fe91). Re-review: addressed, no new breakage.
Task 3: complete (commits 5caa15b..745fe91, review clean after round 1)
Dashboard byte-verify (handoff item, done at Task 4 time by controller): chain.js vs ledger.js — genesis + row hashes MATCH on live cross-implementation run.
Task 4: dispatched (BASE 745fe91, implementer sonnet; dispatch carries fail-closed timeout ruling, Track B fixture counts, no --model flag ruling).
Task 4: implemented (BASE 745fe91, commit 343a445, 65/65 via npm test, implementer DONE; judgment call: repeated scrub to same --out appends to ledger rather than truncating). Review dispatching.
Task 4: review clean (spec ✅, approved). Minors (deferred): --policy flag untested; per-type summary table rows not directly asserted; append-vs-truncate on repeated --out untested; flag-without-value → raw TypeError not usage error; parseArgs unrecognized-argument throw untested.
Task 4: complete (commits 745fe91..343a445, review clean)
SESSION RESTART by user here (terac MCP now Connected w/ API-key header; tools need fresh session). Next controller actions, in order: (1) LAUNCH TERAC STUDY per context/status/terac-study-spec.md — feasibility quote first, decision tree in spec; (2) dispatch Task 5 (fine-tune loop; implementer sonnet; Task 5 owns adding --model to scrub); (3) after Task 5: final whole-branch review (MERGE_BASE 25909dc), most capable model; then Band work per build-order.
Session resumed post-restart; terac tools live. Feasibility requested: id si6si8o8barzgjhhlrducc36 (5 participants × all 15 snippets = 5 raters/snippet, gen-pop, 4h ask; quote ~1h, poll every ~5min). Draft opportunity will be created on quote; launch after Het confirms draft (Terac requires explicit post-draft approval).
Task 5: dispatched (BASE 343a445, implementer sonnet; dispatch carries --model ownership, ADR 0005 caps, labels-json contract pointer, detector throw conventions).
Task 5: implemented (BASE 343a445, commit 3fb0763, 97/97 via npm test, implementer DONE — no
blocking concerns; flagged: labels-json has no `type` on leak_reports so CLI falls back to a fixed
PII-type list for /generate labels; live-mode --model and finetune-status deployed branch verified
by inspection only). Review package generated (review-343a445..3fb0763.diff) but REVIEW NOT
DISPATCHED — session ended here.
Controller handoff #2 (session limit): next actions, in order: (1) Task 5 task-review from the
existing review package; (2) final whole-branch review MERGE_BASE 25909dc on the most capable
model; (3) PR feat/sentinel-core to master (contains track-b merges — one PR).
Terac: feasibility si6si8o8barzgjhhlrducc36 RESPONDED — $17.50 incentive / $25.00 CPI x5 = $125,
org balance $25. FUNDING GAP, needs Het. Draft not yet created. Open gap: no hosted survey for
raters; snippets (18205 chars) exceed the 8000-char description cap, so 3 activity tasks x 5
snippets is the no-hosting shape, and a screener is mandatory before launch.
Band: research/band.md UI steps were stale. Verified against band.ai/hacker-guide this session —
button is "Connect Remote Agent"; rooms under Chats + participants panel; agent_config.yaml takes
ONLY top-level agent keys (load_agent_config reads that shape). band-setup.sh added at repo root.
Note: this controller was instructed not to spawn subagents unprompted, so no reviews were
dispatched. That is a harness constraint, not a verdict on the code.
Terac: balance topped to $125. DRAFT CREATED ydwueq13zlc9k7nb9w1w3s6y (5 participants x $25
confirmed CPI = $125.00, feasibility_request_id attached so the human-confirmed price is honored).
NOT LAUNCHED — awaiting Het's explicit go per Terac's post-draft approval rule.
Ruling: study shape = 3 activity tasks x 5 snippets, manual_review, snippets+questions inline in
task descriptions. Forced by two constraints: no hosted survey, and 18205 chars of snippets vs an
8000-char description cap. Cost if wrong: raters answer as free text, so scripts/fetch_labels.py
must parse a fixed per-excerpt text format instead of a structured survey export.
Ruling: added a 2-question screener (technical-English comfort; long-form reading behaviour, each
with 2 rejecting answers) even though the spec said gen-pop/no-screening — Terac REFUSES to launch
an unscreened study. Screens for "ordinary reader who reads", not expertise, so the study premise
holds. Cost if wrong: slightly smaller pool, marginally slower recruitment.
Ruling: 5 participants, not the 1 discussed while the balance was $25 — Het topped up to exactly
5 x $25 after being quoted that figure. Cost if wrong: $100 of credit; recoverable by editing the
draft before launch.
