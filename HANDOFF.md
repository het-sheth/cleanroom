# HANDOFF — cleanroom, Zero-Human Company Hackathon (2026-08-15)

You are a fresh Claude session taking over mid-hackathon. **Submissions lock 6:45 PM PDT.**
Read in order: this file → `AGENTS.md` → `context/status/build-order.md` →
`.superpowers/sdd/2026-08-15-sentinel-core/progress.md` (the SDD ledger — trust it and `git log`
over any recollection).

## Mission (compressed)
Autonomous PII-compliance department for agent observability. GLiNER2-PII via Pioneer detects;
pure policy routes (auto-redact / consult / allow-observed); a Band-resident specialist
dispositions ambiguous spans from METADATA ONLY (ADR 0001, never raw text); every decision lands
in a hash-chained ledger (ADR 0004 claim scope); fail closed (ADR 0003); Terac raters improve
thresholds; the agent may launch ONE GLiNER fine-tune after ≥20 labels (ADR 0005). Vocabulary in
`CONTEXT.md`. Pitch wedge + judge Q&A in `context/research/competitive.md` — the wedge is
observed-not-acted + HMAC-confirm, NOT "accurate detection" (banned phrase; GLiNER2-PII SPY
span-F1 is 0.477).

## Work state
- Branch `feat/sentinel-core` (SDD loop, plan `docs/superpowers/plans/2026-08-15-sentinel-core.md`):
  - Task 1 (policy) COMPLETE, review clean. Task 2 (ledger) IMPLEMENTED at 21442a2, 29/29 tests —
    **review NOT yet run: your first SDD action is the Task 2 task-review** per
    superpowers:subagent-driven-development (templates in that skill; ledger has the workflow
    trail; BASE for Task 2 = e83b690).
  - Tasks 3 (detector+redactor — note the repeat-scrub requirement), 4 (CLI), 5 (fine-tune loop)
    pending. Implementers/reviewers on model "sonnet" (user rule: subagents never on Fable).
- Branch `feat/dashboard`: DONE, pushed (16/16 tests). `node dashboard/server.js --dir
  dashboard/fixtures` → :4600. At Task 4, byte-verify its `dashboard/lib/chain.js` hashing against
  `sentinel/lib/ledger.js` (both claim sha256(prev + JSON.stringify(9 payload keys in
  PAYLOAD_KEYS order, missing→null))).
- Branch `track-b/data-and-scripts` (teammate, GitHub user Baburaoooo): merged into
  feat/sentinel-core. He owes: per-type placeholder switch (acked in
  `context/status/integration-risks.md`), Stripe checkbox, real baseline rerun once Pioneer works.
  Coordinate via context/ pages + git per AGENTS.md, not chat.

## Blockers & first actions (priority order)
1. **Terac study — CLOCK-CRITICAL, unlaunched.** The Terac MCP was added via `claude mcp add`
   and should be available in YOUR session. Launch per `context/status/terac-study-spec.md`:
   feasibility-quote first, then launch `data/study_snippets.json` (15 snippets, gen-pop, 5
   raters/snippet). Ground truth (`data/study_ground_truth.json`) never reaches raters. If ETA
   >4h, halve snippets and requote; launch something regardless.
2. **Pioneer 403** on live inference (`card_required`) despite Pro + $40 credit. Suspects: API key
   minted under the wrong team (keys are per-team — regenerate while "Het's Team" is selected,
   update PIONEER_API_KEY in `.env`), or a card-on-file requirement (billing page shows none) —
   user adds card or asks booth. Verify fix: `python3 scripts/redact_baseline.py --probe`. Then
   full baseline + `build_snippets.py` rerun (teammate's job, coordinate).
3. **Band agents not yet created** — user does app.band.ai → Agents → New Agent ×2
   (specialist + exporter), key shown ONCE, UUID on settings page → gitignored
   `agent_config.yaml` (`specialist:`/`exporter:` with `agent_id`/`api_key`). SDK facts in
   `context/research/band.md`. Band task starts after sentinel Task 4.
4. **Supabase** — optional flourish (user has Pro): user creates project, puts URL +
   service_role key in `.env`; then mirror policy table + ledger rows. Below 1–3 in priority;
   file ledger + dashboard already demo the chain.
5. Render: $50 credit available; `dashboard/render.yaml` exists. Stretch only (prize needs Render
   Workflows). Spend no time before core demo works.

## Demo plan (~30 min before lock)
Split screen: `sentinel/cli.js scrub` on Track B's `data/transcripts.jsonl` (t25 = injection
fixture, exercises all three routes) + dashboard on the output dir. Tamper-toggle moment. Show
fine-tune job id live if Task 5 launched one. Pitch: architecture slide carries the ADR 0002
boundary caveat + ZDR ("confirmed on-site, visible in Pioneer UI — no public doc") + the three
rehearsed judge answers in competitive.md.

## Rules that bite
- Never quote mock-mode numbers as detector performance.
- All PII synthetic; keys only in `.env`/`agent_config.yaml` (gitignored).
- Contracts in `context/contracts/` change only with cross-track ack.
- Cut order if time collapses: `context/status/build-order.md` (never cut: Terac study, GLiNER2
  usage, ledger).
