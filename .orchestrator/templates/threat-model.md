# STRIDE Threat Model Template

```markdown
## scope
<feature or surface being modeled>

## data flows
1. <actor> → <system> → <resource>
2. ...

## trust boundaries
- <boundary 1>: between <A> and <B>
- <boundary 2>: ...

## threats (STRIDE)

### Spoofing
- T-S-1: <threat description>
  - likelihood: low | medium | high
  - impact: low | medium | high
  - mitigation: <how we prevent/detect/respond>

### Tampering
- T-T-1: ...

### Repudiation
- T-R-1: ...

### Information Disclosure
- T-I-1: ...

### Denial of Service
- T-D-1: ...

### Elevation of Privilege
- T-E-1: ...

## assumptions
- <what we assume is true>

## out of scope
- <what we explicitly don't model>

## residual risk
- <what risk remains after mitigations; accept/transfer/avoid>

## sign-off
- reviewed by: security
- date: YYYY-MM-DD
- status: approved | needs-mitigation | rejected
```
