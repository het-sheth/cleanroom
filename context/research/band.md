---
type: concept
title: Band facts
description: Band SDK surface, verified UI steps, and the verdict-reading constraint
timestamp: 2026-08-15T21:45:00Z
---

Source: band.ai/hacker-guide (docs.band.ai currently documents a different desktop product, "Jam" —
use the hacker guide), researched via subagent on hackathon day.

- Composition SDK: framework adapter (Anthropic SDK, LangGraph, …) → `Agent.create(adapter,
  agent_id, api_key)` → `await agent.run()`. Auth: persistent `agent_id` UUID + api key in
  `agent_config.yaml`.
- Rooms route via @mentions — agents only see messages naming them. Ops: `band_add_participant`,
  `band_lookup_peers`, `band_send_event`.
- CONSTRAINT: no documented REST call for an external process to read a room's verdict. Design
  consequence (ADR 0003): the exporter is itself a Band agent in the room and acts on @mention —
  the gate lives inside the room, which also strengthens the load-bearing story.
- Prize bar: "remove the room and the app should break." Our fail-closed gate satisfies this
  structurally.
- Signup code (guidebook): HACKBANDAUG26 for free pro month (redemption flow undocumented —
  Discord if stuck: discord.com/invite/5YkNXmYfjk).
- Key issuance is SELF-SERVE. **UI labels re-verified 2026-08-15 ~21:40Z against
  band.ai/hacker-guide — the earlier note here was stale and cost real time:**
  - app.band.ai → Agents → **"Connect Remote Agent"** (there is also a "New Agent" / internal-agent
    path; that is the WRONG one for us — we bring our own reasoning loop and authenticate by key).
  - The form asks for name, **handle** (≤24 chars, the @mention address — load-bearing, since rooms
    route by mention), description, tags, Personal Registry Access, and public-directory listing.
    We use `cleanroom-specialist`/`specialist` and `cleanroom-exporter`/`exporter`, registry access
    ON, public listing OFF.
  - API key appears ONCE in a popup; agent UUID is on the agent's Settings page.
  - Rooms are under **Chats** → create room → **participants panel** → add both agents. No room
    API; this stays a UI step.
- `agent_config.yaml` (gitignored, template committed as `agent_config.example.yaml`) holds ONLY
  top-level agent keys → `{agent_id, api_key}`, because `band.config.load_agent_config("<key>")`
  looks the agent up by that top-level key. Room id and URLs must live elsewhere (`.env`), not in
  this file.
- SDK: PyPI `band-sdk` **1.6.0**, Python ≥3.11, install `pip install "band-sdk[anthropic]"`
  (verified extras include `anthropic`, `langgraph`, `claude-sdk`, and ~20 more; the hacker guide
  only documents `langgraph`). Import package is **`band`**, not `band_sdk`:
  `from band import Agent`, `from band.config import load_agent_config`.
  `Agent.create(adapter=..., agent_id=..., api_key=...)` then `await agent.run()` opens a
  persistent WebSocket and listens forever.
- WebSocket: `wss://app.band.ai/api/v1/socket/websocket?api_key=&vsn=2.0.0`, Phoenix Channels,
  read-only, one connection per agent. REST base `https://app.band.ai/`.
- Setup wizard for all of the above: `./band-setup.sh` at the repo root (6 stages, writes the
  gitignored config, builds `.venv-band`). Watch out on Python 3.14 — wheels may not exist yet;
  fall back to 3.12.
