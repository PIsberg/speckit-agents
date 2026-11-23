# Feature Specification: dedupe()

## Requirements

- **FR-001**: `dedupe(items)` in `src/dedupe.js` returns the distinct items of an array, first occurrence first.
- **FR-002**: `dedupe([])` returns `[]`.
- **FR-003**: `dedupe` handles a list of 20000 items in well under a second.

## Acceptance Scenarios

1. Given `[1, 2, 1, 3, 2]`, when `dedupe` is called, then it returns `[1, 2, 3]`. (FR-001)
2. Given `[]`, when `dedupe` is called, then it returns `[]`. (FR-002)
