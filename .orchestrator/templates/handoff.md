# Handoff Template

Use this when one role hands work to another. The receiving role uses this as their input.

```yaml
---
handoff_id: HOFF-NNN
date: YYYY-MM-DD
from_role: backend
to_role: frontend
phase: N
priority: high | medium | low
---

## what was produced
- <file/path.ts> — <one-line description>
- <file/path.ts> — <one-line description>
- <migration.sql> — <description>

## what was accepted
- [ ] types exported
- [ ] tests pass
- [ ] spec items X, Y, Z implemented
- [ ] review by [Role].Critic passed

## spec reference
`.orchestrator/specs/phase-N.md` — sections X, Y, Z

## consumer notes
- import types from `@/lib/api/types`
- the API client in `src/lib/api/` is the canonical fetch wrapper
- any new types must be added there

## open changes requested
(none)

## blockers
(none)
```
