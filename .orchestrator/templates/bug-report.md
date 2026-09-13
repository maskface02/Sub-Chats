# Bug Report Template

```yaml
---
bug_id: BUG-NNN
date: YYYY-MM-DD
filed_by: qa
assigned_to: backend | frontend | devops
severity: critical | high | medium | low
phase: N
status: open | in_progress | resolved | wont_fix
---

## title
<one-line description>

## steps to reproduce
1.
2.
3.

## expected
<what should happen>

## actual
<what actually happens>

## environment
- browser: chrome 120 / firefox 121 / safari 17
- viewport: 1920×1080 / 768×1024 / 375×667
- user state: logged in as X / anonymous
- network: online / offline / throttled

## evidence
- screenshot: <path>
- video: <path>
- logs: <path or inline>
- console: <path or inline>

## related
- spec reference: `.orchestrator/specs/phase-N.md` — section X
- related bugs: BUG-XXX

## proposed fix
<optional — what the role thinks the fix is>
```
