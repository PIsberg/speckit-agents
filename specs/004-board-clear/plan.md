# Implementation Plan: Board Clear

**Branch**: `004-board-clear` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-board-clear/spec.md`

## Summary

A `[ clear ]` button in the board mod's pane and band, and a `/speckit-board clear` argument, remove
every finished team agent's row from the pane and the band from above the prompt. The rows are
dropped from the mod's `agents` state (research R1); the band is held off by one new session-scoped
flag, `isCleared`, that the next team agent's start resets (R2, R7). Clear does no file, store or
process I/O (R3), so the pipeline's records and the gate's decisions cannot change. All code is in
`mods/speckit-board/` (two source files and the state type); the hook, the installer, the agents and
the skills are not touched.

## Technical Context

**Language/Version**: TypeScript/TSX run as source by Claude Code's plugin runtime (Claude Code
2.1.293 in CI); Node 18+ for `test/board-mod.test.mjs`.

**Primary Dependencies**: the Claude Code plugin API (`claude-code`, `claude-code/testing`) only. None
added.

**Storage**: plugin state (`atom`), session-scoped, not persisted. No file, no `$.store` key, nothing
under `.git/speckit-team/`.

**Testing**: `claude plugin test` on `mods/speckit-board/tests/*.test.ts(x)`, run under `npm test` by
`test/board-mod.test.mjs`; `node:test` in `test/board-mod.test.mjs` for the README check (T011).

**Target Platform**: Claude Code on Windows, macOS, Linux (CI runs all three).

**Project Type**: Claude Code mod (plugin of function hooks) inside the speckit-agents repo.

**Performance Goals**: the band and the new agent's row back at the `SubagentStart` event, not the
next 4-second poll (SC-004).

**Constraints**: observer budget (constitution III), stated here and measured by T009: a clear does
0 file reads, 0 file writes, 0 store calls, 0 process runs and 0 status-line updates; a team agent's
`SubagentStart` does the same number of file reads and process runs with or without a clear before it,
plus at most one plugin-state write. No `tool.call` handler is added or changed.

**Scale/Scope**: 3 source files changed (`hooks/register.tsx`, `hooks/model.ts`, `types/index.d.ts`),
3 test files (`tests/board.test.tsx`, `tests/model.test.ts`, `test/board-mod.test.mjs`), `README.md`,
`CLAUDE.md`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

Every MUST rule, with the task that delivers it or the line that shows it does not apply.

| Rule | How this plan meets it | Tasks | Result |
|---|---|---|---|
| I. Every behaviour change ships with a test that runs under `npm test` | Each implementation task follows its tests in the same slice: T001, T002 before T003; T004 before T005; T006, T007 before T008; T009 before T010; T011 before T012. The mod's behaviour tests live in `mods/speckit-board/tests/`, where `claude plugin test` finds them, and run under `npm test` through `test/board-mod.test.mjs` ("the board mod's own tests pass under claude plugin test"), which fails the suite on any failing mod test; that is how all 52 existing mod tests meet this rule (CLAUDE.md, Layout). T011 adds a test in `test/` itself. | T001, T002, T004, T006, T007, T009, T011 | PASS |
| I. Shown failing first, or broken once; evidence in the PR body | Every test task names what makes it red before its implementation: an argument the mod does not know yet, a button not drawn, a toggle that does not end the clear. Where a case already holds (T009's budget count), the task names the deliberate break. The red output goes in each test-writer report for the PR body. | T001, T002, T004, T006, T007, T009, T011 | PASS |
| I. Tests assert what a caller observes | Tests assert the command's answer, toasts, the status-line calls, the Texts and Buttons a mounted pane or band draws, and the engine events the mod raises (`fs.write`, `store.set`, `process.run`). `clearText` is asserted only through those answers. `bandLayout` is the model suite's existing seam for the band's row, kept for T006. | T001, T002, T004, T006, T007, T009 | PASS |
| I. No test passes because the code never ran | Each clear test asserts the clear's own line first (`cleared 3 agent rows and the band.`), so a clear that did not run fails it. T002's zero-I/O assertion is paired with that line in every state. | T001, T002, T004, T007 | PASS |
| II. Every hook entry point handles all input without throwing; each throwing path tested | The changed entry points are the mod's `command.run`, `classic.SubagentStart` and two `onPress` closures. The new throwing path, a refused plugin-state write, is caught and shown (R5) and tested for the command (T001), the buttons (T004) and the agent start (T009). An unknown argument stays answered (T001). | T001, T003, T004, T005, T009, T010 | PASS |
| II. A hook wiring change is verified live before merge | Not applicable: no hook command, event, matcher or frontmatter of `hooks/speckit-team.mjs` or `install.mjs` changes, and the mod subscribes to no new event (it changes the bodies of its existing `command.run`, `classic.SubagentStart` and `ui.render` handlers). The live checks in quickstart.md are deferred to a follow-up issue (D5 B). | none | N/A |
| II. Installed hook commands use a quoted, absolute, forward-slash path | Not applicable: no installed hook command is added or changed. | none | N/A |
| III. Observers never deny, delay or alter an agent's action or a guardrail's decision | `classic.SubagentStart` still returns `next(e)` unchanged (T009 asserts the result equals the next handler's); clear does no I/O, so no guardrail file changes (T002). | T002, T009, T010 | PASS |
| III. An observer failure leaves the agent's work unchanged and is visible | A refused state write answers or toasts `clear failed: ...`; at an agent start it toasts and the start proceeds (R5, data-model.md). | T001, T004, T009 | PASS |
| III. Observer overhead within a measured budget stated in the plan | Budget in Technical Context, Constraints. T002 measures the clear's I/O (0 events); T009 measures a `SubagentStart` after a clear against one without (equal file reads and process runs). | T002, T009 | PASS |
| IV. Node stdlib only; plugin code uses only the plugin API, shipped as source | `register.tsx` and `model.ts` import only `claude-code` and `../types`; T011 uses `node:fs`, `node:path`, `node:test`, `node:assert`. No build step is added. | T003, T005, T008, T010, T011 | PASS |
| IV. A new runtime dependency needs an amendment | None added; `package.json` unchanged. | none | N/A |
| V. Public contracts: changes additive within a major version, listed in the README | `/speckit-board clear` is a new argument; the argument hint and the unknown-argument answer gain `clear` (contracts/board-clear.md). Nothing is removed or renamed. README Commands table (T012). | T003, T012 | PASS |
| V. Emitted events carry a schema version; consumers may ignore unknown fields | Not applicable: the feature emits no event and changes no event format. | none | N/A |
| VI. Event data stays local; metadata only | Not applicable: no event or data leaves the mod; clear reads and writes in-memory plugin state only. | none | N/A |
| VII. Works on Windows, macOS and Linux; forward-slash paths | No path handling is added. The mod's tests run on all three in CI (`SPECKIT_REQUIRE_CLAUDE=1` makes a missing `claude` fail, not skip). No live check runs in this feature (D5 B). | T001, T002, T004, T006, T007, T009 | PASS |
| VIII. README, CLAUDE.md and the installer's help text describe it; counts, paths, commands match | README Commands table, "What it draws", the test counts in "Verified" and "Test suite"; CLAUDE.md's `npm test` count (T012). T011 holds the Commands table to the mod's argument hint. The installer's help and final message name no board argument (`install.mjs` lines 9, 10, 454), so they need no change. | T011, T012 | PASS |
| VIII. Docs state what was verified live, by unit test only, and not at all | T012 states what the mod's tests cover and writes "not seen live" for the button and the argument (D5 B). | T012 | PASS |
| VIII. No em-dashes, no curly quotes, numbers over adjectives | Checked in T012. | T012 | PASS |
| Installation constraints (idempotent, no overwrite, validate first, silent without `.specify/`, uninstall) | Not applicable: the installer and what it writes are unchanged; `--board` reads the mod in place, so a `git pull` delivers the change. Outside a Spec Kit repo the command keeps its existing answer and the band draws nothing (no board). | none | N/A |
| Workflow: feature branch; agents open PRs, never merge | Work is on `004-board-clear`. | none | N/A |
| Workflow: gates reported passed, failed, skipped or not run; `claude plugin validate` and `claude plugin test`; no pipe eats an exit code | spec-gatekeeper's job; both plugin commands run inside `npm test` (`test/board-mod.test.mjs`). No task of this feature runs a gate through a pipe. | none | PASS |
| Governance: deviations in Complexity Tracking | None. | none | N/A |

Post-design re-check (after research.md, data-model.md, contracts/): no rule changed status.

## Project Structure

### Documentation (this feature)

```text
specs/004-board-clear/
├── spec.md
├── plan.md              # this file
├── research.md          # R1 to R7
├── data-model.md        # agent rows, isBandHidden, isCleared
├── quickstart.md        # test commands and live checks L1 to L6
├── contracts/
│   └── board-clear.md   # the command, the buttons, the line, the failure text
└── tasks.md
```

### Source Code (repository root)

```text
mods/speckit-board/
├── hooks/
│   ├── model.ts          # clearText; bandLayout gains the clear button (D2)
│   └── register.tsx      # isCleared atom, clear(), the command branch, both buttons, the start reset
├── types/index.d.ts      # PluginState gains isCleared
└── tests/
    ├── board.test.tsx    # behaviour through the engine
    └── model.test.ts     # the band's row
test/board-mod.test.mjs   # README Commands table against the argument hint
README.md, CLAUDE.md      # docs
```

**Structure Decision**: the existing mod layout. Pure logic in `model.ts`, engine wiring in
`register.tsx`, as the file header of `model.ts` sets out.

## Documentation plan

Found by `grep -n "status|refresh\|refresh, band\|toggle band\|52 tests\|187 tests\|/speckit-board"`:

| File | Place | Change | Task |
|---|---|---|---|
| `README.md` | Board mod, "Commands" table | row for `/speckit-board clear` | T012 |
| `README.md` | Board mod, "What it draws" (band bullet, pane bullet) | `[ clear ]` in both, the band's drop order, what clear keeps (running rows, records, status line) | T012 |
| `README.md` | Board mod, "Verified", and "Verifying", "Test suite" table | the mod's test count (52, the number `claude plugin test` reports after T010), `board-mod.test.mjs` 8 to 9, `npm test` 187 to 188 | T012 |
| `README.md` | Board mod, "Verified", live record | "not seen live" for the `clear` button and argument (D5 B) | T012 |
| `CLAUDE.md` | "Verify", the `npm test` count | 187 to 188 | T012 |
| `install.mjs` | help comment, final message | none: no board argument is named there | none |
| `mods/speckit-board/.claude-plugin/plugin.json` | `description` | none: it names the surfaces, not commands (D6) | none |

## Complexity Tracking

None.

## Decisions

### D1. What does a clear do while a team agent is running?

**Decided: A** (user, 2026-10-10).

The spec's edge case keeps the running agent's row and "the band stays". It does not say what happens
to the band once that agent finishes.

- **A (recommended): the clear removes the finished rows only and leaves the band out of it.**
  `isCleared` is not set; the band stays after the agent finishes, and a second clear then removes it.
  The line says so: `cleared 2 agent rows; 1 running agent kept.` Edge cases: a clear with only running
  agents is `nothing to clear; 1 running agent kept.` FRs: FR-003 reads "remove the band" only when no
  team agent runs, which the Edge Cases section already implies. Tasks: T001 (case b), T003. Counts:
  none.
- **B: set the cleared state anyway, and draw the band only while some agent runs.** The band would
  vanish the moment the last running agent finished, hiding that agent's result in the band; the next
  agent start then brings it back. Adds a third input to the band's draw condition. Tasks: T001,
  T003, T010 (the start reset no longer the only way back). FR-006's "the cleared state ends at that
  point" then ends a state the user may not know was entered.
- **C: refuse a clear while any team agent runs.** Simplest, but in a `/speckit-team` run an agent is
  almost always running, so the button would rarely work. Contradicts the spec's edge case ("Only
  finished agents' rows are cleared"), so it needs a spec change first.

### D2. Is the band's `[ clear ]` dropped on a short row?

**Decided: A** (user, 2026-10-10).

SC-006 asks for the button "in 100% of tested states where they are drawn". The band today drops all
its buttons on a short row (about 80 columns and below, and always beside a docked pane, where it is
about 70).

- **A (recommended): it drops with the other buttons**, in the order `hide`, `clear`, `board`. SC-006
  then reads "wherever the band draws its buttons"; T006 asserts that every band layout with
  `[ hide ]` has `[ clear ]`, and every one with `[ clear ]` has `[ board ]`. At any width the pane's
  `[ clear ]` and `/speckit-board clear` remain. The band gains one variant (8 instead of 7), and every
  layout that carries `[ clear ]` is 10 columns wider (the button and its gap), so it gives way to the
  next, narrower one 10 columns sooner.
  Existing model tests keep passing: no buttons at 70 columns either way. Tasks: T006, T008.
- **B: it is never dropped.** SC-006 holds literally at every width, but below about 80 columns the
  band then drops the other phases' glyphs to keep it, and at 30 columns it may not fit beside the
  current phase's name at all; the existing test "a short band drops its buttons before the phases"
  and the README's drop-order sentence change. Tasks: T006, T008, T012, and an edit to an existing
  model test.

### D3. How does a pressed button say what it cleared?

**Decided: A** (user, 2026-10-10).

FR-008 asks for one line; FR-012 says clear must not change the status line or toasts. The
clarification behind FR-012 was "Does clear also reset the status line and toasts? No".

- **A (recommended): one toast with the line, for a button press only.** FR-012 reads "clear does not
  reset or remove the status line or earlier toasts". The command answers with its text and raises no
  toast. Tests assert exactly one new toast per press and none per command (T001, T004, T007).
- **B: no toast; the pane's team section shows the line until the next agent starts.** FR-012 holds
  literally, but a press on the band's button with the pane closed shows nothing at all, which fails
  FR-008 for US1-2. Adds a stored line to the state and a row to `paneRows`.

### D4. What do `/speckit-board band` and the pane's `toggle band` do after a clear?

**Decided: A** (user, 2026-10-10).

Today they flip `isBandHidden`. After a clear the band is not drawn although `isBandHidden` is false, so
a plain flip would answer `band hidden.` and leave the band away.

- **A (recommended): the toggle acts on what is drawn.** If the band is neither hidden nor
  cleared, it hides it (`band hidden.`); otherwise it shows it and ends the cleared state (`band shown.`). Without a clear
  this is today's behaviour exactly. The band's own `hide` is unchanged. Tasks: T009, T010; existing
  test "the band shows the feature, every phase and the RED count" keeps passing.
- **B: leave the toggle as it is.** After a clear the user needs two toggles to see the band, the first
  answering `band hidden.` while nothing changes on screen. No task.

### D5. Re-record the board screenshot and run the headless live check in this feature?

**Decided: B** (user, 2026-10-10).

CLAUDE.md asks for a re-recording after a change to what the board shows; `docs/media/board.png` shows
the pane's buttons, which gain `[ clear ]`.

- **A (recommended): yes, as T013.** `node docs/media/record.mjs board` (vhs, `specify`, `claude`, git on
  PATH; two short Haiku runs, a few cents), then L1 and L2 of quickstart.md at 0 turns. The screenshot
  must be looked at by a person before it is committed (README, "Recording the demo media"). README's
  live record gains a dated entry. L3 to L6 stay for the owner and are listed as not seen live unless
  done.
- **B: defer to an issue.** No cost now; README states the button and the argument are verified by the
  mod's tests only. The screenshot is out of date by one button until then. T013 is dropped; T012 writes
  the "not seen live" line; a GitHub issue is opened with the PR.

### D6. What is "the board's description" in FR-010?

**Decided: A** (user, 2026-10-10).

- **A (recommended): the README's Board mod section ("What it draws" and "Commands") and the
  command's argument hint shown in Claude Code's typeahead.** `plugin.json`'s `description` and the
  command's `description` ("Show the Spec Kit team board") name no commands today and stay as they are.
  Tasks: T003 (argument hint), T012.
- **B: also the command's `description`**, for example "Show or clear the Spec Kit team board". One
  more string in T003 and the existing registration test; `plugin.json` unchanged.
