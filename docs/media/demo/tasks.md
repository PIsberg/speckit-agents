# Tasks: greet command

**Input**: `specs/001-greet/spec.md`, `specs/001-greet/plan.md`

## Phase 1: Setup

- [ ] T001 Create `package.json` with `"type": "module"` and `"test": "node --test test/"`

## Phase 2: User Story 1 - Greet a named person (P1)

### Tests (write first, see them fail)

- [ ] T002 [US1] In `test/greet.test.mjs`, test `greet('Ada')` returns `Hello, Ada!` (FR-001) and that `greet()`, `greet('')` and `greet('  ')` return `Hello, world!` (FR-002)
- [ ] T003 [US1] In `test/greet.test.mjs`, spawn `node src/greet.js Ada` and `node src/greet.js`; assert stdout, exit code 0 (FR-003) and a run time under 1 second (SC-002)

### Implementation

- [ ] T004 [US1] Implement `greet(name)` in `src/greet.js` so T002 passes
- [ ] T005 [US1] Add the CLI entry point to `src/greet.js` so T003 passes

## Phase 3: Polish

- [ ] T006 Document usage in `README.md`

## Dependencies

T001 before all. T002 and T003 before T004 and T005. T006 last.
