# cleanroom — Agent Instructions

Autonomous PII-compliance department for AI-agent observability. Built at the Zero-Human Company
Hackathon (2026-08-15). Submissions lock 6:45 PM PDT.

Read in this order: `CONTEXT.md` (vocabulary — use these terms exactly), `docs/adr/` (decided;
do not re-litigate), `context/status/build-order.md` (what to do now).

## The two-session workflow

Two Claude sessions work this repo in parallel — Track A (pipeline: sentinel, ledger, Band,
escalation) and Track B (data, Terac study, Stripe; see `prompts/teammate-track-b.md`). They
coordinate through the `context/` folder and git, not through chat:

1. Before starting work: `git pull`, read `context/status/`.
2. After finishing any unit of work: update the relevant `context/` page, commit, push.
3. File formats in `context/contracts/` are frozen interfaces between the tracks. Never change a
   contract unilaterally — flag it in `context/status/` and wait for the other track to ack.

## context/ conventions (OKF-style, conventions only — no build tooling)

- One concept per file: `context/<topic>/<slug>.md`, kebab-case slugs.
- Every page carries YAML frontmatter: `type: concept | pattern | worked-example`, plus `title`,
  `description`, `timestamp` (ISO 8601, last meaningful change).
- Cross-link pages with wikilinks: `[[slug]]` within a topic, `[[topic/slug]]` across topics.
- Never invent content: pages record what was decided, measured, or found — with the source named.
  Unverified claims are flagged inline.
- Topics: `research/` (external facts: APIs, booth intel), `contracts/` (frozen data formats),
  `status/` (live build state — update these every time state changes).

## Hard rules

- ALL PII is synthetic. Never put real personal data in code, fixtures, transcripts, or studies.
- Keys live in `.env` (gitignored). Never commit a key; never create or share a Stripe `sk_` key.
- Raw transcript text never enters the Band room — Consultations are structured metadata only
  (ADR 0001). If a change would violate this, the change is wrong.
- Fail closed (ADR 0003): no verdict → redact.
- Don't over-engineer: every task has a "done" line; stop there. Stretch items live in
  `context/status/build-order.md`, not in scope.

## Git

- Branch + PR for work; imperative subjects ≤50 chars, Conventional Commits prefixes.
- No AI attribution / Co-Authored-By trailers.
