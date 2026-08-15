# HANDOFF — cleanroom, Zero-Human Company Hackathon (2026-08-15)

**Submissions lock 6:45 PM PDT.** Written at 15:35 PDT — about 3h 10m left.

Read in order: this file → `AGENTS.md` → `docs/sdd-ledger-sentinel-core.md` (the SDD ledger — trust
it and `git log` over any recollection) → `context/status/build-order.md`.

## Mission (compressed)

Autonomous PII-compliance department for agent observability. The **Sentinel** intercepts agent
transcripts inside the customer's trust boundary; **GLiNER2-PII via Pioneer** detects; a pure
**Routing Policy** sends each span to auto-redact / consult / allow-observed; a **Band-resident
Specialist** dispositions the ambiguous middle from METADATA ONLY (ADR 0001, never raw text); every
decision lands in a **hash-chained Ledger** (ADR 0004); **fail closed** (ADR 0003); **Terac** raters
improve thresholds; the agent may launch **ONE** GLiNER fine-tune after ≥20 labels (ADR 0005).

Vocabulary in `CONTEXT.md`. Naming: **cleanroom** is the product; the **Sentinel** is the component
in `sentinel/`. Pitch wedge + judge Q&A in `context/research/competitive.md` — the wedge is
observed-not-acted + HMAC-confirm, NOT "accurate detection" (banned phrase; GLiNER2-PII SPY span-F1
is 0.477).

## Branch state

`a8ed445` pushed, working tree clean, **115/115 tests passing**. All 5 plan tasks complete; the
final whole-branch review ran and its fixes landed in `c2422d8`.

**The one thing not yet done on the code:** that fix diff (`git diff 33549ae..c2422d8`, 7 files,
+565/-76, touching `detector.js` and `redact.js`) has **not been reviewed by anyone**. Re-review it
before merging. Details of what it fixed are under "Final review" below; the full report is at
`.superpowers/sdd/2026-08-15-sentinel-core/final-fix-report.md`.

## What is DONE and verified

- **Sentinel core, Tasks 1–5 complete**, each task-reviewed clean. 115 tests passing via `npm test`
  (zero runtime dependencies — a bare clone runs them).
- **Demo path works end to end in mock mode.** Verified by running it:
  ```
  CLEANROOM_SALT=demo node sentinel/cli.js scrub data/transcripts.jsonl --mock --out /tmp/demo-out
  node .claude/worktrees/agent-ae9282936049760f8/dashboard/server.js --dir /tmp/demo-out
  ```
  25 transcripts → 161 hash-chained ledger rows → `ledger verify: ok`. Tamper moment: edit one
  character in `/tmp/demo-out/ledger.jsonl`, refresh :4600, chain break lights up.
  (Dashboard lives on branch `feat/dashboard`; `git worktree add ../cleanroom-dashboard feat/dashboard`.)
- **Ledger ↔ dashboard hash agreement byte-verified** across the two independent implementations.
- **Terac study is LIVE.** Opportunity `ydwueq13zlc9k7nb9w1w3s6y`, launched 22:18:20Z, 5
  participants × $25 CPI = **$125.00 charged — the org balance is now spent, there is no budget for
  a second study.** Submissions:
  https://terac.com/cleanroom-msuutrxi/default-project-zq2odgonq5b7r3cplbylw7tk/opportunities/ydwueq13zlc9k7nb9w1w3s6y/submissions
  At last poll: 0 submissions, 2 applicants through the screener, 0 rejected. Terac's funnel is
  filters → screening form → **AI voice interview (Terac's own, cannot be skipped)** → invite →
  task. The voice interview is the slow stage. `review_type` is `manual_review`, so **Het must
  approve each submission for the rater to be paid**.
- **Pioneer live inference VERIFIED WORKING at 22:30Z.** The all-day 403 `card_required` is gone.
  Exact working call and the real response are in `context/research/pioneer.md`. Key facts:
  `schema` is REQUIRED; a real probe returned `Jane Doe` person @0.996 and `jane@example.com`
  email @1.0 but **MISSED the phone number** — quote that miss in the pitch, it is the
  "detection is the weak link" evidence.
- Band: both agents created, `agent_config.yaml` filled (gitignored). Het started the room.

## What is NOT tested end to end — read before claiming anything works

| Path | State |
|---|---|
| Sentinel unit + CLI, mock mode | ✅ 98 tests |
| CLI → dashboard → tamper detection | ✅ run by hand |
| **Pioneer live → our `detector.js`** | ❌ **never run.** The API was probed with curl; our client code has never touched it |
| **The fail-open fix** | ✅ landed + controller-verified; ⚠️ the fix diff itself is unreviewed |
| **Terac submissions → `fetch_labels.py`** | ❌ **broken as written** — see below |
| **Band → anything** | ❌ zero integration; `cli.js` still hardcodes `disposition: "timeout"` |
| Fine-tune against real Pioneer | ❌ only mocked `fetchImpl` |

**`fetch_labels.py` will not work as written.** The study has no hosted survey, so raters type free
text in a fixed per-excerpt format (`EXCERPT <id>` / `1. Leak: Yes|No` / `2. Exact words: …` /
`3. Readability 1-5: <n>`). That script expects a structured export. Someone must write the parser
before any label reaches the threshold retune — which is the "after" half of the Terac criterion.
The frozen `context/contracts/labels-json.md` OUTPUT shape does not change; only the input does.

## Final whole-branch review — findings the fix wave is addressing

Verdict was **"Fixes needed before merge."** Full text is in the SDD ledger's history; the essentials:

- **CRITICAL:** `detector.js` returns `{start: -1, end: -1}` when it cannot locate a span; `redact.js`
  treats that as a real range, so the span **exports un-redacted** while the ledger row still says
  `route: auto-redact`. Direct ADR 0003 violation. Mock mode cannot reach it (`mockDetect` uses
  `indexOf`) — **it is only reachable on the live Pioneer path that just came online.**
- **Important:** detector never verifies Pioneer's offsets match Pioneer's span text (drifted
  offsets leave a PII fragment); malformed detector output aborts mid-file leaving a half-written
  ledger; re-running `scrub` into the same `--out` appends the ledger but truncates
  `redacted.jsonl` so the printed counts disagree; `out/redacted.jsonl` carries raw PII in
  `detections[].text` (correct per the frozen contract, but needs a README caveat — it is an eval
  artifact, not the export).
- **Not a code fix, but a demo hazard:** in MOCK mode, 11 planted values survive verbatim in
  `redacted_text` — including an SSN, an MRN, an email and a bank account — because mock
  "confidence" is a sha256 of the string, not real uncertainty. A judge who greps the output finds
  an SSN. **Now that Pioneer works, demo in LIVE mode.**

Invariant audit from that review: metadata-only **holds**; salt never leaks (**verified**, asserted
by tests); ADR 0005 caps **enforced in code**; fail-closed **does not hold** on the live path until
the Critical lands.

## Hackathon requirements (from the guidebook — authoritative)

- **Terac MCP use is REQUIRED for all projects.** Criterion is not "ran a study" — it is *"turn that
  input into a better project, show a clear before and after."* Our before/after = baseline metrics
  → leak reports → retuned thresholds → after metrics. **The "after" half does not exist yet** and
  depends on labels landing + the parser above.
- **Stripe is REQUIRED for BOTH $2,500 main prizes** (Best Overall Project AND Best Overall
  Agent-Run Company): personal Stripe account, ONE Payment Link, a restricted `rk_` key with
  Balance+Charges set to Read and everything else None, all three submitted to organizers. Het sent
  a teammate the full instructions; **status unconfirmed — chase it.**
- **Band prize** needs a real dependency: *"a verdict one agent can genuinely block."* Our
  exporter-blocks-on-specialist design satisfies this **only if wired**, which it is not.
- **Pioneer prize:** open-weight models, bonus for GLiNER2-PII or the fine-tune API. Now genuinely
  reachable since inference works.
- **Render** requires Render *Workflows* specifically. Not started; skip it.

## Priority order for the next session

1. **Land the fix wave** (Critical fail-open), re-review the fix diff scoped, then `npm test`.
2. **Run the Sentinel against LIVE Pioneer** — first real end-to-end exercise of `detector.js`.
   `schema` is required on every call. This produces the real BEFORE numbers and makes the Pioneer
   prize genuine. Expect the Critical fix to matter here.
3. **Poll Terac.** When submissions land, write the free-text parser, produce labels.json, retune
   thresholds, and generate the AFTER numbers. That is the required before/after.
4. **Band wiring** if time remains — one real blocking verdict is worth more than a polished room.
5. **PR `feat/sentinel-core` to master** (contains the track-b merges — ONE PR). `feat/dashboard` is
   done and reviewed; its PR can open any time.

## Setting up on a different laptop

`git clone` gives you the code but NOT the secrets:

| Missing after clone | How to restore |
|---|---|
| `.env` | `cp env.example .env`, fill `PIONEER_API_KEY`, `TERAC_API_KEY`, `CLEANROOM_SALT`. Het carries these — private channel, never a commit. |
| `agent_config.yaml` | `cp agent_config.example.yaml agent_config.yaml`, then `./band-setup.sh` or paste the four Band values. |
| SDD ledger | Committed copy at `docs/sdd-ledger-sentinel-core.md`. |
| Review diffs | Regenerate: `git diff <base>..<head>` using any range in the ledger. |
| Dashboard | `git worktree add ../cleanroom-dashboard feat/dashboard` |

The Terac MCP is Claude Code config, not repo content:
`claude mcp add --transport http terac https://terac.com/api/mcp`, restart, complete auth.

Most secrets are not needed to work: the demo runs in mock mode with no keys at all.

## Rules that bite

- Never quote mock-mode numbers as detector performance. Never say "accurate detection".
- All PII synthetic. Keys only in `.env` / `agent_config.yaml` (both gitignored).
- Contracts in `context/contracts/` change only with cross-track ack.
- Never push to master — branch + PR. No AI attribution trailers.
- Raters and the Specialist both see only synthetic/templated examples, never customer spans
  (ADR 0005) — this is the answer to "aren't you leaking PII to strangers?"
- Cut order if time collapses: `context/status/build-order.md`. Never cut: Terac study, GLiNER2
  usage, ledger. **Band IS cuttable** — fail-closed still demos via the consult→timeout→redact path.
