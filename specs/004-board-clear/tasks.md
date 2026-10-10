---
description: "Task list for Board Clear"
---

# Tasks: Board Clear

**Input**: Design documents from `specs/004-board-clear/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/board-clear.md](contracts/board-clear.md),
[quickstart.md](quickstart.md)

**Decisions**: the tasks follow the recommended option of each open decision in plan.md (D1 to D6).
A different answer changes the tasks that decision names.

**Tests**: required by constitution I. In every slice the test tasks come first and are shown failing
before the implementation task. Where a case already holds before its implementation, the task names
the deliberate break that shows it red once.

**Organization**: one phase per user story, built a round at a time (up to 4 slices). A slice is one
behaviour: its test tasks, then one implementation task. User Story 3 (clear never changes the
pipeline, P1) has no phase of its own: it is a property of the clear itself, so its test (T002) sits in
slice 1, before the clear exists, and slice 2's test (T004) repeats it for the button.

**No setup or foundational tasks**: no dependency, no new file outside the existing test files, no
shared infrastructure. The new names the tests import (`clearText`, `clearFailedText`) are listed in
T003 for the round's stub pass; everything else is reached through the engine (`$.command.run`,
`ui.press`, `$.classic.SubagentStart`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: touches only files no other task in the same slice touches, and depends on no unfinished
  task in that slice.
- **[Story]**: US1, US2, US3 from spec.md. Documentation tasks have none.
- Texts are in [contracts/board-clear.md](contracts/board-clear.md); tests match them exactly.
- Test helpers: `world()`, `poll()`, `around()`, `stop()`, `BAND`, `PANE`, `band()`, `pane` in
  `mods/speckit-board/tests/board.test.tsx`; `board()`, `SLICE`, `widthOf`, `phaseTexts` in
  `mods/speckit-board/tests/model.test.ts`. "3 finished agents" means `classic.SubagentStart` then
  `classic.SubagentStop(stop(id, 'implementer', 'RESULT: GREEN'))` for ids `i1` to `i3`, with
  pass-through `classic.SubagentStart`/`SubagentStop` handlers registered as the existing tests do.

---

## Phase 1: Clear the board and the band (US1 and US3, P1) 🎯 MVP

**Goal**: `/speckit-board clear` and a `[ clear ]` button in the pane and in the band remove every
finished agent's row and the band, and touch nothing else.

**Independent test**: `claude plugin test mods/speckit-board`: slices 1 to 3's cases pass and every
existing case still passes.

One round of three slices.

### Slice 1: `/speckit-board clear` (FR-011, FR-002, FR-003, FR-004, FR-005, FR-007, FR-008, FR-009, FR-012)

- [X] T001 [US1] Tests in `mods/speckit-board/tests/board.test.tsx` for the `clear` argument (FR-011, FR-002, FR-003, FR-005, FR-007, FR-008, FR-009, FR-012, US1-1, US1-3, US1-4, US2-2, Edge Cases "running", "twice", "headless", "narrow", SC-001, SC-005, plan.md D1, constitution III failure visibility). Each case runs on the `terminal` and the `desktop` surface where it mounts the band or the pane. Red before T003 because the mod answers `unknown argument "clear": ...`.
  - 3 finished agents, the band drawn at `band()` (a Text `◐ build`): `$.command.run({ command: 'speckit-board', args: 'clear' })` answers `{ text: 'cleared 3 agent rows and the band.' }`; a band mounted after it draws no `◐ build` and no `◆ 001-x`; a pane mounted after it draws no Text `implementer`, no `+N earlier`, and the Text `cleared; no team agent has run since`; `seen.toasts` and `seen.status` have the same length as before the command (FR-012).
  - Then `/speckit-board` (empty args) answers `pane opened.`, and the pane draws `next T002 Test greet`, `PASS` after `audit` (use `around`) and no Text `implementer` (FR-007, US2-2).
  - A running `test-writer` (`t1`, started, not stopped) and 2 finished implementers: `clear` answers `cleared 2 agent rows; 1 running agent kept.`; the pane draws `test-writer` followed by `running` and no `implementer`; the band still draws `◐ build` and the agent item matching `/test-writer/` (FR-005, D1 A).
  - `seen.files[`${ROOT}/.specify/feature.json`]` deleted before `session.start`, no agents: `clear` answers `nothing to clear.`, and again `nothing to clear.` (US1-4, FR-008, SC-005).
  - `/speckit-board band` first (answers `band hidden.`), 2 finished: `clear` answers `cleared 2 agent rows.`; a band mounted after it draws nothing of the mod's; a second `clear` answers `nothing to clear.` (US1-3 by command, SC-005).
  - The band mounted at `band(45)`, where it draws no Button: `clear` with no agents answers `cleared the band.`, and the band then draws no `◐ build` (Edge Case "narrow").
  - A session started with `isInteractive: false`: `clear` answers `cleared the band.` as text (FR-009).
  - After `session.start`, a `state.set` hook that denies writes to the key `agents` (the API's `state.set` event, as `fs.read` is denied in `world()`): `clear` answers text matching `/^clear failed: .+\.$/` (constitution III, research R5).
  - Update the existing tests: "/speckit-board is registered to run at once" expects `argumentHint: '[status|refresh|band|clear]'`; "an unknown argument says which ones there are" expects `unknown argument "stauts": use status, refresh, band or clear.`
- [X] T002 [US3] Tests in `mods/speckit-board/tests/board.test.tsx` that clear is display-only (FR-004, US3-1, US3-2, SC-002, SC-003). One test per state, generated from a table as the existing `for (const word of ...)` tests are: verdict `{ verdict: 'PASS', fingerprint: fp }`, `{ verdict: 'FAIL', fingerprint: fp }`, `{ verdict: 'PASS', fingerprint: 'stale' }` (each with the default RED 1), and the retry record `{ fingerprint: fp, red: [...] }` with 0, 1, 2 and 3 entries under a current PASS. In each: start the session, add 3 finished agents, then register recorders for `fs.write`, `store.set`, `store.delete` and `process.run` (passing `process.run` on to `world()`'s git answer); take `JSON.stringify(seen.files)` and the text of `/speckit-board status`; run `/speckit-board clear`. Assert the answer is `cleared 3 agent rows and the band.` (so the clear ran), 0 recorded `fs.write`, `store.set`, `store.delete` and `process.run` events, `seen.files` unchanged, and the `status` text unchanged, its `RED n/3` included (US3-2). Red before T003 on the answer. The gate's decision follows from the unchanged files (research R3); the hook's own suite pins it per state.
- [X] T003 [US1] Implement the `clear` argument, per contracts/board-clear.md and data-model.md.
  - `mods/speckit-board/types/index.d.ts`: `PluginState['speckit-board']` gains `isCleared: boolean`, with a comment: the band is held off until the next team agent starts; session state, not stored.
  - `mods/speckit-board/hooks/model.ts`: `export function clearText(rows: number, isBandCleared: boolean, running: number): string` (the contract's table: `agent row`/`agent rows`, `running agent`/`running agents`) and `export function clearFailedText(err: unknown): string` (`clear failed: <message>.`, the message of an `Error`, else `String(err)`).
  - `mods/speckit-board/hooks/register.tsx`: `const isCleared = atom({ plugin: 'speckit-board', key: 'isCleared' } as const, false)`; `async function isBandDrawn($: EngineInterface): Promise<boolean>` (a board, `isBandHidden` and `isCleared` false); `async function clear($: EngineInterface): Promise<string>` (the contract's five steps; no `$.fs`, `$.store`, `$.process`, `$.ui.status` or `refresh`; it throws on a refused write). In `command.run`, a `clear` branch before the unknown-argument check: `try { return { text: await clear($) } } catch (err) { return { text: clearFailedText(err) } }`. `argumentHint: '[status|refresh|band|clear]'`; the unknown-argument text `use status, refresh, band or clear.` The `AbovePrompt` handler also returns `next(e)` while `isCleared`. The pane's empty team text reads `cleared; no team agent has run since` while `isCleared`.

### Slice 2: the pane's `[ clear ]` button (FR-001, US1-3, US1-5, SC-006, plan.md D3)

- [X] T004 [US1] Tests in `mods/speckit-board/tests/board.test.tsx` for the pane's button (FR-001, FR-004, FR-008, FR-012, US1-3, US1-5, SC-006 pane, D3 A, constitution III). Red before T005: no Button `clear` in the pane.
  - The existing test "the pane lists the phases ..." expects 5 Buttons (was 4); on both surfaces a Button with key `clear`, label `clear` and `hotkey` `c` is drawn after `band` and before `close`.
  - US1-3: `/speckit-board band` (hidden), 3 finished, a mounted pane: `ui.press({ key: 'clear' })` adds exactly one toast, `cleared 3 agent rows.`; the pane then draws no Text `implementer`; `seen.status` has the same length; a band mounted after it draws nothing of the mod's; with the recorders of T002 registered before the press, 0 `fs.write`, `store.set`, `store.delete` and `process.run` events (FR-004 by button).
  - A second press adds one toast, `nothing to clear.` (SC-005).
  - With `state.set` denied for the key `agents`, a press adds one toast matching `/^clear failed: .+\.$/`.
- [X] T005 [US1] Implement the pane's button in `mods/speckit-board/hooks/register.tsx`: `async function pressClear($: EngineInterface): Promise<void>` toasts `await clear($)`, or `clearFailedText(err)` when it throws, and nothing else; in the pane's button row, between `toggle band` and `close`, `<Button key="clear" label="clear" hotkey="c" onPress={() => pressClear($)} />`.

### Slice 3: the band's `[ clear ]` button (FR-001, US1-2, US1-5, SC-006, plan.md D2)

- [X] T006 [P] [US1] Tests in `mods/speckit-board/tests/model.test.ts` for the band's row (FR-001, SC-006 band, D2 A). Red before T008: no `clear` item.
  - `bandLayout(board({ tasks: SLICE, red: 1 }), [], 0, 135)`: the button items, in order, are `[ board ]`, `[ clear ]`, `[ hide ]`; the `clear` item has `key: 'clear'`, `label: 'clear'`.
  - For every `cols` from 30 to 140, with no agent and with `[{ type: 'implementer', startedAt: 0 }]`: a layout with `[ hide ]` has `[ clear ]`, a layout with `[ clear ]` has `[ board ]`, and `widthOf(items) <= cols`. The existing three band tests keep passing unchanged.
- [X] T007 [P] [US1] Tests in `mods/speckit-board/tests/board.test.tsx` for the band's button (FR-001, US1-2, US1-5, SC-006 band, D3 A). Red before T008: no Button `clear` in the band.
  - The band at `band()` on both surfaces draws a Button with key `clear`, label `clear`, `dimColor`.
  - No pane mounted, 2 finished: `ui.press({ key: 'clear' })` on the band adds one toast, `cleared 2 agent rows and the band.`; the band then draws no `◐ build`; a pane mounted after it draws no Text `implementer` (US1-2).
- [X] T008 [US1] Implement the band's button.
  - `mods/speckit-board/hooks/model.ts`: `BandItem`'s button `key: 'board' | 'clear' | 'hide'`; `BandVariant` gains `isClearShown: boolean`; `VARIANTS` becomes eight: the first four with all three buttons, then `hide` dropped, then `clear` dropped, then the two without buttons (`head`, then `only-head`), as plan.md D2 A orders them; the layout pushes `{ kind: 'button', text: '[ clear ]', key: 'clear', label: 'clear' }` between `board` and `hide`. Update the comment above `VARIANTS`.
  - `mods/speckit-board/hooks/register.tsx`: the band's `case 'button'` draws `<Button key="clear" label="clear" dimColor onPress={() => pressClear($)} />` for `key === 'clear'`.

**Checkpoint**: Phase 1 green; the clear works from the command, the pane and the band.

---

## Phase 2: The board comes back for new work (US2, P2)

**Goal**: after a clear, the next team agent brings its row and the band back by itself, and the band
toggle shows a cleared band in one step.

**Independent test**: `claude plugin test mods/speckit-board`: slice 4's cases pass, Phase 1's still do.

### Slice 4: the next team agent ends the cleared state (FR-006, SC-004, plan.md D4, constitution III budget)

- [X] T009 [US2] Tests in `mods/speckit-board/tests/board.test.tsx` (FR-006, US2-1, SC-004, D4 A, constitution III).
  - 3 finished, `clear`, then `$.classic.SubagentStart({ agent_id: 'a9', agent_type: 'spec-auditor' })` with no clock advance: a band mounted after it draws `◆ 001-x`; the pane draws `spec-auditor` followed by `running` and no Text `implementer` (US2-1, SC-004: at the start event, not the 4-second poll). Red before T010: the band stays away.
  - D4: after a clear, `/speckit-board band` answers `band shown.` and the band draws `◆ 001-x`; again, `band hidden.` and nothing; again, `band shown.`. After another clear, a press of the pane's `band` Button draws the band again. Red before T010: the first answer is `band hidden.`
  - Budget (plan.md, Technical Context): with recorders for `fs.read` and `process.run`, count the events during the `SubagentStart` of `x1` in a session that has not cleared; stop `x1`, clear, and count the events during the `SubagentStart` of `x2`: the two counts are equal, and each `SubagentStart` resolves to the next handler's `{}`. This case holds before T010; show it red once by adding a second `await refresh($)` to the start handler, then revert.
  - With `state.set` denied for the key `isCleared` after a clear, `SubagentStart` still resolves to `{}`, the pane draws the new agent `running`, and one toast matches `/^board could not end the clear: /` (constitution III). Red before T010: no toast.
- [X] T010 [US2] Implement in `mods/speckit-board/hooks/register.tsx`.
  - `classic.SubagentStart`, for a team role, before the row is added: when `isCleared` is true, set it false; a refused write toasts `board could not end the clear: <message>` and the handler goes on. It still returns `next(e)`.
  - `async function toggleBand($: EngineInterface): Promise<boolean>`: when `isBandHidden` and `isCleared` are both false, sets `isBandHidden` true and returns `true`; otherwise sets both false and returns `false`. Without a clear this is today's flip exactly, with or without a feature. The `band` argument answers `band ${hidden ? 'hidden' : 'shown'}.` from it, and the pane's `toggle band` Button calls it. The band's `hide` Button is unchanged.

**Checkpoint**: Phases 1 and 2 green.

---

## Phase 3: Documentation (FR-010, constitution VIII)

### Slice 5: the README and CLAUDE.md (FR-010, plan.md D6)

- [ ] T011 Test in `test/board-mod.test.mjs`: "the README's board commands are the arguments the mod registers" (FR-010, constitution VIII "every command in those docs MUST match the code"). Read `mods/speckit-board/hooks/register.tsx` and take the arguments from `argumentHint: '[...]'` (split on `|`); read `README.md`, take the part from `### Commands` after `## Board mod (experimental)` to the next `###`, and collect `<arg>` from each table row starting `` | `/speckit-board <arg>` ``. Assert the two sorted lists are equal. Uses `node:fs`, `node:path`, `node:test`, `node:assert` only. Red before T012: the README has no `clear` row.
- [ ] T012 Update the docs, per plan.md "Documentation plan".
  - `README.md`, Board mod, "Commands": a row `` | `/speckit-board clear` | removes the finished agents' rows and the band, as the `clear` button does; running agents keep their rows, and the next team agent brings the band back. It changes no file under `.git/speckit-team/`, no spec file, and not the status line | ``.
  - `README.md`, "What it draws": the band's buttons are `board`, `clear` and `hide`, dropped on a short row in the order `hide`, `clear`, `board` (D2); the pane's buttons include `clear`.
  - `README.md`, "Verified": the mod's test count (52 now) set to the number `claude plugin test mods/speckit-board` reports; "Verifying", "Test suite": `board-mod.test.mjs` 8 to 9 tests, its mod-test count, and the `npm test` total 187 to 188. State that the `[ clear ]` button and the `clear` argument are verified by the mod's tests only, not seen live, and that `docs/media/board.png` predates the button (D5 B; a follow-up issue is opened with the PR).
  - `CLAUDE.md`, "Verify": `187 tests` to `188 tests`.
  - No em-dashes, no curly quotes.

---

## Dependencies and order

- Phase 1 is one round: slices 1, 2, 3 in order. Slice 2 calls `clear()` from T003; slice 3 calls
  `pressClear()` from T005.
- Phase 2 needs Phase 1 (`isCleared`, `clear()`).
- Phase 3 needs Phases 1 and 2: T011 reads the argument hint T003 sets, T012 counts the tests of
  T001 to T011.

## Parallel opportunities

- T006 and T007 (slice 3) touch disjoint files. No two slices touch disjoint files: slices 1 to 4 all
  change `board.test.tsx` and `register.tsx`.

## Implementation strategy

- MVP: Phase 1. It delivers FR-001 to FR-005, FR-007 to FR-009, FR-011, FR-012 and US3.
- Phase 2 adds FR-006 and the band toggle (D4). Phase 3 the docs and the live record.

## Coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T004, T005, T006, T007, T008 |
| FR-002, FR-003, FR-008, FR-011 | T001, T003 (button routes: T004, T007) |
| FR-004, SC-002, SC-003 | T002, T003, T004 |
| FR-005 | T001, T003 |
| FR-006, SC-004 | T009, T010 |
| FR-007 | T001, T003 |
| FR-009 | T001, T003 |
| FR-010 | T003 (argument hint), T011, T012 |
| FR-012 | T001, T004 |
| SC-001 | T001 |
| SC-005 | T001, T004 |
| SC-006 | T004, T006, T007 |
| US1-1 to US1-5 | T001, T004, T007 |
| US2-1, US2-2 | T009, T001 |
| US3-1, US3-2 | T002 |
