---
type: concept
title: Competitive landscape and pitch rulings
description: Opus adversarial diligence (2026-08-15) — prior art, wedge, Band/Pioneer rulings, judge Q&A
timestamp: 2026-08-15T21:30:00Z
---

Source: Opus adversarial review subagent with web research, hackathon day. Vendor claims marked.

## Prior art (what a judge may know)
- **Langfuse `mask` callable / LangSmith anonymizer** — closest substitute; client-side regex or
  callable masking. Their own docs call it "a coarse safety net" and demo Presidio/Comprehend as
  drop-ins. No confidence routing, no per-span disposition, no record of what was seen-not-redacted.
  Whoever wires Presidio into Langfuse's mask hook has ~80% of Sentinel.
- **Presidio** — detect + mask/hash/encrypt, MIT; has context-word scoring and a decision trace,
  but only explains why PII WAS detected, never why it wasn't.
- **Kong AI Gateway `ai-sanitizer`** — the real competitor: 20+ PII categories, fail-closed block
  mode, audit via file log. **Its audit log stores the original sensitive values** — the design
  flaw our HMAC avoids. Attack this explicitly in the pitch.
- **LLM Guard** — free pseudonymize-and-restore (Anonymize/Deanonymize + Vault).
- AWS Comprehend PII / Google DLP: confidence-scored detection is commodity. Portkey: paid
  guardrail integrations. LiteLLM/Cloudflare: none native.

## Rulings on our claims
- Contextual judgment layer → **downgraded to supporting feature** (Presidio context words +
  academic prior art, e.g. arXiv 2606.04067). Don't lead with it.
- Tamper-evident ledger → commodity pattern EXCEPT **observed-not-acted rows + HMAC-confirm**,
  which no vendor has. This is the wedge.
- Self-improving loop → real only if demoed live (judge will ask for the fine-tune job ID —
  show it running, timestamps visible).
- Agent-consults-agent → prior art exists (PolicyGuard, arXiv 2606.29225); frame as isolation,
  not novelty.

## The wedge (pitch verbatim)
"Every PII layer proves what it redacted; cleanroom is the only one that proves what it saw and
deliberately didn't — cryptographically, without ever storing the value."

## Band ruling: defensible-with-honest-framing
In-process call would be faster; we paid latency to make the metadata-only boundary OBSERVABLE
rather than asserted — the room transcript is third-party-inspectable evidence (same logic as PCI
network segmentation vs code review). Say the tradeoff out loud: "the room is the evidence
artifact, not the compute." Never conceal that it's also the prize criterion.

## Pioneer ruling: load-bearing, with one banned word
Model choice correct (regex can't do usernames/orgs/locations — exactly our contextual types;
frontier LLM ~10x slower). Directional benchmark {{vendor, unverified}}: regex 83.9 F1 @145 docs/s,
GLiNER 93.9 @18, GPT-4 96.0 @2.1 (ertas.ai). BUT GLiNER2-PII span-F1 on SPY benchmark is **0.477**
(best of five systems, low in absolute terms — arXiv 2605.09973). **Never say "accurate
detection."** Say: "detection is the weak link, which is why nothing depends on it alone" — that
sentence justifies the routing bands, the ledger, and the human loop in one breath.

## Judge Q&A (rehearse these three)
1. "Why not a 50-line Presidio call in Langfuse's mask hook?" → It is, for the unambiguous 80%;
   the product is the other 20%: banded routing, per-span disposition record, and proof for what
   we let through — none of which a mask callable produces.
2. "You send raw text to Pioneer — thesis dead?" → Yes for the hosted tier, and it's on our
   architecture slide, not our FAQ. Weights are downloadable, demo data synthetic, detection runs
   where the customer chooses; hosted is the trial tier, not the security claim.
3. "Tamper-evident against whom?" → Anyone but us; operator-proofing is roadmap anchoring. What
   no competitor has is HMAC-confirm — Kong stores the original values, we store a keyed hash
   only the customer can verify.
