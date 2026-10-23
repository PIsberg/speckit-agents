# Contract: clearing the board

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) | **Date**: 2026-10-10

The user-facing surface this feature adds to the board mod (`mods/speckit-board/`). The slash command
is a public contract (constitution V); the change is additive. Two existing texts change to name the
new argument; both are pinned by tests in `mods/speckit-board/tests/board.test.tsx`.

## `/speckit-board clear`

- Registered argument hint: `[status|refresh|band|clear]` (was `[status|refresh|band]`).
- Runs at once, also during a turn (the command's existing `immediate: true`).
- Outside a Spec Kit repo it answers the existing `no .specify/ in this repository.` and does nothing.
- Otherwise it clears (below) and answers with the clear's line as the command's text. It raises no
  toast and does not set the status line (FR-012).
- Headless (`claude -p "/speckit-board clear"`) it answers the same text (FR-009).
- Unknown argument answer: `unknown argument "<arg>": use status, refresh, band or clear.`
  (was `... use status, refresh or band.`).

## The `[ clear ]` buttons

| Where | Element | Position | Hotkey | Style |
|---|---|---|---|---|
| Pane | `<Button key="clear" label="clear">` | after `toggle band`, before `close` | `c` | default |
| Band | `<Button key="clear" label="clear">` | after `board`, before `hide` | none | `dimColor`, as `hide` |

- A press clears (below) and shows the clear's line as one toast. It does not set the status line.
- The band drops its buttons on a short row in this order: `hide`, then `clear`, then `board` (D2).
  A band with `[ hide ]` also has `[ clear ]`; a band with `[ clear ]` also has `[ board ]`.

## What a clear does

1. Counts the team agents of this session that are running (`running`) and finished (`rows`).
2. Notes whether the band is drawn: a feature is active, `isBandHidden` and `isCleared` are false.
3. Sets the agent list to its running members.
4. If `running` is 0, sets `isCleared` to true. `isBandCleared` is true when the band was drawn
   (step 2) and `running` is 0.
5. Returns `clearText(rows, isBandCleared, running)`.

It reads and writes plugin state only: no `$.fs`, `$.store`, `$.process`, `$.ui.status` call, no
refresh (FR-004, FR-012).

## The line (`clearText`)

`clearText(rows: number, isPaneCleared: boolean, isBandCleared: boolean, running: number): string`
(`isPaneCleared` added 2026-10-23, #150: a board was shown and not already cleared, and no team agent runs)

| rows | isPaneCleared | isBandCleared | running | Text |
|---|---|---|---|---|
| 3 | true | true | 0 | `cleared 3 agent rows, pane and band.` |
| 1 | true | true | 0 | `cleared 1 agent row, pane and band.` |
| 2 | true | false | 0 | `cleared 2 agent rows and the pane.` |
| 0 | true | true | 0 | `cleared the pane and the band.` |
| 0 | false | false | 0 | `nothing to clear.` |
| 2 | false | false | 1 | `cleared 2 agent rows; 1 running agent kept.` |
| 0 | false | false | 2 | `nothing to clear; 2 running agents kept.` |

## A failed clear

When a state write is refused, the command answers and a button toasts
`clear failed: <the error's message>.` (constitution III).

## After a clear

- With no team agent running (amended 2026-10-23, #150), the pane draws only its title, the line
  `cleared; refresh or the next team agent brings it back`, and the `refresh` and `close`
  buttons: no phase, next step, agent row or task. A running team agent is never hidden this way,
  even when the write that ends the clear was refused.
- `/speckit-board` opens that cleared pane, 5 rows tall (FR-007). `/speckit-board refresh` and the
  pane's `refresh` end the cleared state and draw the board and the band again; the cleared pane's
  `refresh` also reopens the pane at the board's height. The 4-second poll does not end it. A refused
  write is toasted as `board could not end the clear: <message>` and the refresh goes on. `status`
  answers as before (US3-2).
- The next team agent's `classic.SubagentStart` ends the cleared state: its row and the band are drawn
  at that event (FR-006, SC-004).
- `/speckit-board band` and the pane's `toggle band`, pressed while the band is hidden or cleared, show
  it and end the cleared state: answer `band shown.`; otherwise they hide it: `band hidden.` (D4). The
  cleared pane has no `toggle band` (#150); its `refresh` ends the clear instead.
