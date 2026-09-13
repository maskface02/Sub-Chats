# User Story Template

```markdown
## US-NNN: <title>

**as a** <persona>
**i want** <capability>
**so that** <benefit>

### acceptance criteria
- [ ] AC.1: <testable behavior>
- [ ] AC.2: <testable behavior>
- [ ] AC.3: <testable behavior>

### states
- empty: <what user sees when no data>
- loading: <what user sees during fetch>
- error: <what user sees on failure>
- success: <what user sees on completion>

### out of scope
- <thing this story does NOT include>

### dependencies
- depends on: US-XXX
- blocks: US-YYY

### a11y notes
- keyboard: <keys and what they do>
- screen reader: <announced text>
- contrast: <meets WCAG AA>
```

## writing good AC
- start with a verb ("shows", "creates", "validates")
- mention the actor ("the user", "the system")
- include a measurable outcome ("in < 100ms", "with status 200")
- avoid vague words ("should work", "looks good", "is intuitive")

## good vs bad examples
- BAD: "the user should be able to find chats easily"
- GOOD: "AC.1: the user can search chats by title; AC.2: results appear in <200ms; AC.3: empty state shows 'no chats match'"
