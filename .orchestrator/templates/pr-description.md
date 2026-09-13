# Pull Request Description Template

```markdown
## what
<one-paragraph summary of the change>

## why
<problem this solves or feature this adds; link to spec section>

## how
<key implementation decisions, especially non-obvious ones>

## testing
- [ ] unit tests added
- [ ] e2e tests added (if user-facing)
- [ ] manual testing done
- [ ] QA sign-off (link to BUG-NNN if fixed)

## screenshots / videos
<if UI change>

## checklist
- [ ] types pass (`npm run typecheck`)
- [ ] lint passes (`npm run lint`)
- [ ] no secrets in diff
- [ ] docs updated (if user-facing)
- [ ] SPEC.md / spec file referenced

## related
- spec: `.orchestrator/specs/phase-N.md` — section X
- fixes: BUG-NNN
- depends on: PR-NNN

## risk
- low | medium | high
- rollback: <how to revert>
```
