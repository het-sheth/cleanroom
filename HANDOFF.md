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

Naming, since it trips people: **cleanroom** is the product/repo; the **Sentinel** is the one
in-boundary component that intercepts transcripts and enforces dispositions (`sentinel/`). Not a
rename candidate — see `CONTEXT.md`.

## The demo works right now — verify it in 30 seconds

```
CLEANROOM_SALT=demo node sentinel/cli.js scrub data/transcripts.jsonl --mock --out /tmp/demo-out
node .claude/worktrees/agent-ae9282936049760f8/dashboard/server.js --dir /tmp/demo-out
```
Open :4600. Verified this session: 25 transcripts, **161 ledger rows, `ledger verify: ok`**.
Tamper moment: edit any character in `/tmp/demo-out/ledger.jsonl`, refresh, chain break lights up.
(The dashboard lives on branch `feat/dashboard`; the path above is the agent worktree it was
built in. `git worktree list` if it's gone.)

## Setting up on a different laptop (read this before anything else)

`git clone` gives you the code but NOT the secrets — six things are gitignored on purpose. Here's
each one and how to get it back:

| Missing after clone | How to restore |
|---|---|
| `.env` | `cp env.example .env`, then fill: `PIONEER_API_KEY`, `TERAC_API_KEY`, `CLEANROOM_SALT`. Het carries these; send them over a private channel, never a commit. |
| `agent_config.yaml` | `cp agent_config.example.yaml agent_config.yaml`, then run `./band-setup.sh` or paste the four Band values by hand. |
| `.superpowers/sdd/…/progress.md` (SDD ledger) | Committed copy at **`docs/sdd-ledger-sentinel-core.md`** — that's the authoritative record of every task, ruling, and deferred minor. |
| `.superpowers/sdd/…/review-*.diff` | Regenerate: `git diff 343a445..3fb0763 > /tmp/task5.diff` (any range in the ledger works). |
| The dashboard | It's a branch, not a worktree: `git worktree add ../cleanroom-dashboard feat/dashboard`, then `node dashboard/server.js --dir <out>`. |
| `node_modules/`, `.venv-band/` | Nothing to install for the Sentinel — **zero runtime dependencies**, Node ≥22, `npm test` works off a bare clone. `.venv-band` only matters for Band. |

**Not a file, and easy to miss:** the Terac MCP server is Claude Code config, not repo content, so
a new machine has no Terac tools at all until you run
`claude mcp add --transport http terac https://terac.com/api/mcp`, restart the session, and
complete auth. This gap already stalled one session today.

**Most secrets are not actually needed.** The demo is fully mock-mode: `agent_config.yaml` matters
only on a machine that runs `agent.run()` (and Band isn't wired into the Sentinel yet — consults
resolve to `disposition: "timeout"` in code), `PIONEER_API_KEY` only unblocks live detection
(currently 403), and `CLEANROOM_SALT` only matters if you want ledger HMACs comparable across
machines. Move keys when you need those, not to get started.

Smoke test that a fresh machine is working, no secrets needed:

```
npm test                                     # expect 97 passing
CLEANROOM_SALT=demo node sentinel/cli.js scrub data/transcripts.jsonl --mock --out /tmp/demo-out
```

Everything runs in `--mock` today, so a laptop with no API keys can still build, test, and demo.

## Work state

- **`feat/sentinel-core`** (SDD loop, plan `docs/superpowers/plans/2026-08-15-sentinel-core.md`):
  Tasks 1–4 COMPLETE, reviews clean. **Task 5 (fine-tune loop) is IMPLEMENTED at `3fb0763`,
  97/97 tests, but its review was never dispatched** — the review package is already generated at
  `.superpowers/sdd/2026-08-15-sentinel-core/review-343a445..3fb0763.diff`. That is the next SDD
  action, followed by the final whole-branch review (MERGE_BASE `25909dc`, most capable model).
  Task 5's implementer flagged three things the reviewer should look at: the `labels-json`
  contract has no `type` field on `leak_reports[]` so the CLI falls back to a fixed PII-type list
  when deriving `/generate` labels; live-mode `--model` and `finetune-status`'s deployed branch
  are verified by code inspection only (no live network in tests).
- **`feat/dashboard`**: DONE, reviewed, 16/16 tests, pushed, in sync with origin. Its PR to master
  can be opened any time. Byte-verified against `sentinel/lib/ledger.js` — hashes match.
- **`track-b/data-and-scripts`** (teammate, GitHub user Baburaoooo): already merged into
  `feat/sentinel-core`, so that's ONE PR, not two. He still owes: Stripe checkbox, real baseline
  rerun once Pioneer works. Coordinate via `context/` pages + git per AGENTS.md, not chat.

## Blockers, in priority order

1. **Terac study — quote is IN, funding is short.** Feasibility `si6si8o8barzgjhhlrducc36` came
   back **RESPONDED**: $17.50 participant incentive, **$25.00 CPI** (incentive + platform fee),
   5 participants = **$125.00**. Org balance is **$25.00**. Top up at
   https://terac.com/cleanroom-msuutrxi/settings/finance (needs Het). Then: create the DRAFT with
   `terac_create_opportunity` passing `feasibility_request_id` (drafts cost nothing and start no
   recruitment), hand Het the `links.dashboard.draft_editor` URL, and only launch after he
   explicitly says go — Terac refuses a launch that wasn't confirmed post-draft.
   Payload is built: `data/study_snippets.json`, 15 snippets, 8 findable leaks. Never send
   `data/study_ground_truth.json` — that's the scoring key. Decision tree + the deliberate t25
   injection bias are in `context/status/terac-study-spec.md`.
   **Open design gap:** raters need somewhere to answer. There's no hosted survey. The 18,205
   chars of snippets exceed the 8,000-char `description` cap, so the workable no-hosting shape is
   3 `activity` tasks × 5 snippets each, `review_type: manual_review`. A study also cannot launch
   unscreened — write a screener with a rejecting catch-all before trying.
2. **Band agents — Het was stuck here; the recorded UI steps were stale.** Run `./band-setup.sh`
   from the repo root (6 stages, writes gitignored `agent_config.yaml`). Corrections found this
   session against band.ai/hacker-guide: the button is **"Connect Remote Agent"**, not "New
   Agent"; rooms live under **Chats** with a **participants panel**, not a top-level room screen;
   `agent_config.yaml` must carry ONLY top-level agent keys → `{agent_id, api_key}`, because
   `band.config.load_agent_config("<key>")` reads that shape. Package is `band-sdk` (v1.6.0,
   Python ≥3.11), import is `band`. `[anthropic]` is a real extra. Het's system Python is 3.14.5 —
   the wizard builds `.venv-band`; if wheels don't exist, retry on 3.12.
   Agent identities to use: `cleanroom-specialist` / handle `specialist`, and
   `cleanroom-exporter` / handle `exporter` — Band routes by @mention, so handles are load-bearing.
3. **Pioneer 403** on live inference (`card_required`) despite Pro + $40 credit. Suspects: key
   minted under the wrong team (keys are per-team — regenerate with "Het's Team" selected, update
   `PIONEER_API_KEY` in `.env`), or a card-on-file requirement. Verify with
   `python3 scripts/redact_baseline.py --probe`. Everything downstream runs in `--mock` today, so
   this gates only the real BEFORE numbers.
4. **Supabase** — optional flourish. `SUPABASE_URL` / service key are still empty in `.env`. File
   ledger + dashboard already demo the chain; below 1–3.
5. **Pitch assets** (Het): ZDR screenshot from the Pioneer UI; set a real `CLEANROOM_SALT` in
   `.env` before the live run.

## Demo plan (~30 min before lock)
Split screen: `sentinel/cli.js scrub` on `data/transcripts.jsonl` (t25 = injection fixture,
exercises all three routes) + dashboard on the output dir. Tamper-toggle moment. Show the
fine-tune job id live if one was launched. Pitch: architecture slide carries the ADR 0002
boundary caveat + ZDR ("confirmed on-site, visible in Pioneer UI — no public doc") + the three
rehearsed judge answers in `context/research/competitive.md`.

## Rules that bite
- Never quote mock-mode numbers as detector performance.
- All PII synthetic; keys only in `.env` / `agent_config.yaml` (both gitignored).
- Contracts in `context/contracts/` change only with cross-track ack.
- Never push to master — branch + PR. No AI attribution trailers.
- Cut order if time collapses: `context/status/build-order.md`. Never cut: Terac study, GLiNER2
  usage, ledger. Band is NOT on the never-cut list — if it stays stuck, fail-closed still demos
  via the consult→timeout→redact path already in the CLI, at the cost of the Band prize track.
- This session's controller was told not to spawn subagents unprompted, which is why Task 5's
  review is parked rather than run. Confirm with Het before dispatching SDD reviewers.
