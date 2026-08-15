---
type: concept
title: Band facts
description: Band SDK surface and the verdict-reading constraint (researched 2026-08-15)
timestamp: 2026-08-15T20:00:00Z
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
- Signup code (guidebook): HACKBANDAUG26 for free pro month.
