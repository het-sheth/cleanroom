# cleanroom — Domain Glossary

The ubiquitous language for cleanroom, an autonomous PII-compliance department for AI-agent
observability. This file is a glossary only — implementation decisions live in `docs/adr/`,
working state lives in `context/`.

## Core concepts

- **Trust boundary** — the perimeter (customer machine/VPC) within which raw transcript text is
  allowed to exist. Only Detections and redacted text may cross it. The product's central invariant.
- **Transcript** — the record of an agent session (user messages, assistant text, tool calls, tool
  results) that a harness would ship to an observability backend.
- **Sentinel** — the in-boundary sidecar process that intercepts Transcripts, obtains Detections,
  applies the Routing Policy, and enforces Dispositions before any export.
- **Detector** — the GLiNER2-PII model that turns text into Detections.
- **Detection** — structured output for one suspected PII span: entity type, confidence, offsets,
  span shape. The *metadata form* of PII — the only form permitted to cross the Trust boundary.
  The raw span text is never a Detection.
- **Routing Policy** — a versioned pure function: (entity type, confidence) → Route. Same inputs +
  same policy version always produce the same Route.
- **Route** — one of: **auto-redact** (confidence above ceiling), **consult** (ambiguous band or
  contextual entity type), **allow-observed** (below floor; exported but ledgered).
- **Contextual entity type** — a type whose PII-ness depends on context (username, org, location,
  job title); always routed to consult regardless of confidence.
- **Disposition** — the Specialist's verdict on a consulted Detection: **redact**, **pseudonymize**,
  or **allow**.
- **Specialist** — the single Band-resident PII agent that issues Dispositions. Sees Consultations
  only — never raw text.
- **Consultation** — a metadata-only exchange in the Band room: Detections plus derived features
  (span shape, source tool, surrounding token count). By definition contains no free text.
- **Escalation ladder** — the RLM-inspired competence hierarchy. L0: Routing Policy (deterministic).
  L1: Specialist Disposition (judgment). L2: Terac human labels (hired expertise). L3: Detector
  fine-tune (self-improvement). Each level is invoked only when the level below is insufficient.
- **Fail closed** — the invariant that absence of a verdict (timeout, Band unreachable) resolves to
  redact, never to export.

## Audit concepts

- **Ledger** — the hash-chained, append-only record of every decision (Supabase-backed). Tamper-
  evident to third parties holding an earlier head; not tamper-proof against the storage operator.
- **Decision record** — one Ledger row: trace id, HMAC of the span, entity type, Route,
  Disposition (if consulted), policy version, model id, prompt hash, prev hash, row hash.
- **Observed-not-acted** — a Decision record for an allow-observed span: proof the system saw it
  and chose not to act, making false negatives visible instead of silent.
- **HMAC-confirm** — the dispute-resolution property: a customer holding the salt can prove a known
  value was (or was not) redacted, without the Ledger ever storing the value.
- **Salt** — per-customer secret used for span HMACs. Held client-side, never logged, never leaves
  the Trust boundary.

## Evaluation concepts

- **Planted entity** — synthetic PII deliberately embedded in a dev/demo Transcript, with ground
  truth recorded. All PII in this project is planted; real PII is banned.
- **Hard case** — a planted entity designed to evade detection (unusual formatting, misspelling,
  cross-message split, quasi-identifier combination).
- **Tricky negative** — text that resembles PII but is not (UUIDs, version strings, framed fiction).
- **Injection fixture** — a Transcript containing instructions aimed at subverting the Specialist;
  exists to demonstrate that Consultations carry no channel for it.
- **Baseline** — Detector output at default thresholds before any tuning. The "before" number.
- **Leak report** — a human rater's finding that redacted text still reveals something personal;
  the recall signal that drives threshold and schema tuning.
