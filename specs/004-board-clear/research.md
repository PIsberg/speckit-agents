# Research: Board Clear

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-10

No `NEEDS CLARIFICATION` remained in the spec or the Technical Context. Each entry is a design
decision, the reason, and what was rejected. The code read: `mods/speckit-board/hooks/register.tsx`,
`hooks/model.ts`, `types/index.d.ts`, `tests/board.test.tsx`, `tests/model.test.ts`, and the plugin
API types in `.claude-plugin/types/claude-code/index.d.ts`.

## R1. The rows are removed from the `agents` atom, not hidden behind a filter

- **Decision**: clear rewrites the `agents` atom to its running members only.
- **Rationale**: the finished rows feed nothing but the pane and the poll's redraw. `snapshot()`,
  `derivePhases`, `nextStep` and the band read only running agents, and the gatekeeper word kept for
  verify lives in `$.store`, not in the list. Removing them gives FR-002 and "rows cleared earlier stay
  gone" (FR-006) with no new state, and the `+N earlier` count restarts with them.
- **Alternatives**: a `clearedAt` time that the pane filters rows by. Rejected: one more value every
  reader has to apply, for rows nothing else reads.

## R2. One new session-scoped flag for the band, `isCleared`

- **Decision**: a plugin atom `isCleared: boolean` (initial `false`), separate from the existing
  `isBandHidden`. The band is drawn only while both are false.
- **Rationale**: the spec's "cleared state" ends at the next team agent's start (FR-006), while a band
  the user hid with `/speckit-board band` stays hidden (US1-3). One flag cannot carry both: setting
  `isBandHidden` at clear and resetting it at agent start would show a band the user had hidden. Plugin
  state survives a hot reload of the mod and is not persisted (the API keeps persistence in
  `$.store`), which is "not stored" in the spec's Key Entities.
- **Alternatives**: reuse `isBandHidden`. Rejected for the reason above. Store the flag in `$.store`.
  Rejected: the spec says the cleared state is not stored.

## R3. Clear does no I/O

- **Decision**: `clear()` reads and writes plugin state only. It calls no `$.fs`, `$.store`,
  `$.process` or `$.ui.status`, and does not call `refresh()`.
- **Rationale**: FR-004 and FR-012 by construction: the records under `.git/speckit-team/` and the spec
  files are reachable only through `$.fs` and `$.process`, the status line only through `$.ui.status`.
  The engine raises an event for each of those calls, so a test can count them (T002).
  `hooks/speckit-team.mjs`'s gate reads only those files, so byte-identical files give the same gate
  decision (SC-003); the hook's own suite already pins the decision for each verdict and RED state.
- **Alternatives**: none worth recording.

## R4. One function, two routes, one line

- **Decision**: `clear($)` returns the line; `/speckit-board clear` answers with it as the command's
  text, and the two buttons show it as a toast (plan.md, D3). The text comes from a pure
  `clearText(rows, isBandCleared, running)` in `model.ts`, beside the mod's other texts.
- **Rationale**: FR-011 asks for the same effect on both routes, FR-008 for one line on each. A button
  has no answer of its own; a toast is the only place a pressed button can say something.

## R5. A failed clear says so

- **Decision**: the command answers `clear failed: <reason>.` and a button toasts the same when a state
  write is refused.
- **Rationale**: constitution III, "if an observer fails ... the failure MUST be visible". `$.state.set`
  is an event a test can deny (the API: "hook its `state.set`"), so the path is testable (T001, T004).

## R6. The band's `[ clear ]` button drops with the other buttons

- **Decision**: the band lays out `[ board ] [ clear ] [ hide ]` and, on a short row, drops `hide`,
  then `clear`, then `board`, before the other phases' glyphs, as it drops buttons today (plan.md, D2).
- **Rationale**: the band's rule is one row, never wrapped, with the current phase named at every
  width. A button that never drops would push the phase glyphs out first below about 80 columns. The
  pane's button and `/speckit-board clear` stay reachable at every width.

## R7. Next agent's start ends the cleared state, at no I/O cost

- **Decision**: the `classic.SubagentStart` handler, for a team role only, sets `isCleared` to `false`
  before it adds the row. It still returns `next(e)` unchanged.
- **Rationale**: FR-006 and SC-004 (the band is back at the start event, not at the next poll). The
  handler already reads the agent list and the files; this adds one in-memory state write and no file
  read or process run, which is the observer budget (constitution III) that T009 measures.
