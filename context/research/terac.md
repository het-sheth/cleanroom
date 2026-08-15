---
type: concept
title: Terac facts
description: How to launch studies and fetch labels via Terac MCP/REST (researched 2026-08-15)
timestamp: 2026-08-15T20:00:00Z
---

Source: terac.com/mcp, terac.com/docs/developers, researched via subagent on hackathon day.

- MCP tools: `terac_list_opportunities`, `terac_request_feasibility`, `terac_launch_draft_opportunity`,
  `terac_get_submissions`, `terac_get_context`, `terac_pause_opportunity`. Jobs defined in natural
  language; Terac returns a cost/ETA quote before launch.
- REST: base `https://terac.com/api/external/v2` (beta), API-key auth; flow = project → filters →
  screening questions → launch opportunity.
- Turnaround: "hours" — one documented example quoted $84 / eta 6h, delivered 5h12m. With a 6:45 PM
  lock this makes launch time the critical path: quote first, halve scope if ETA > 4h.
- Organizer guidance: target General Population for fastest results.
- Credits link: https://terac.com/r/rGi7O0EfkRbzmiElg8kRjES5W2JrKNYc
- HARD RULE (ADR 0005): raters only ever see synthetic/templated examples — never customer spans.
- Study design + payload: see `prompts/teammate-track-b.md` Task 3; results shape is
  [[contracts/labels-json]].
