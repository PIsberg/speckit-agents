# Tasks: Standalone Board

**Input**: `specs/005-standalone-board/` (plan.md, data-model.md, contracts/board-text.md, quickstart.md)

**Tests**: required (constitution I). Each slice is its test tasks, then its implementation task.
Phases are built one at a time; a phase's slices go through stubs, failing tests and implementation
together. Implementation tasks list the signatures to stub.

Paths below are under `mods/speckit-board/` unless they start with `test/`, `install.mjs`, `README.md` or `CLAUDE.md`.
Test helpers named here: `tests/model.test.ts: base` (:36), `states` (:40), `board` (:136), `SLICE`
(:143), `widthOf`, `phaseTexts` (:236-237); `tests/board.test.tsx: world` (:23), `poll` (:74), `posix`
(:83), `BAND`, `PANE`, `band`, `pane` (:85-88), `around` (:94), `stop` (:100), `clearCmd`, `mountBand`,
`mountPane` (:555-558), `recorders` (:564), `denyState` (:571).

## Phase 1: User Story 1, the standalone view in the model (P1), MVP

**Goal**: pure functions draw a feature with no team record. **Independent test**: `tests/model.test.ts`.

### Slice 1: four phases, build without a gate

- [X] T001 [US1] Test in `tests/model.test.ts` the standalone phases: FR-002, FR-004, FR-006, the edge case "Approved but no plan", and the Phases line of `contracts/board-text.md` S-1 to S-8. Not settled there: in standalone `derivePhases` ignores `verdict`, `red`, `isRetryUnreadable`, `gate` and `running` (a running `architect` leaves plan `todo`); with `isStandalone` absent the six phases come out as today. Build on `base` and `states`.
- [X] T002 [US1] Implement in `hooks/model.ts: derivePhases(i: BoardInputs): SpeckitPhase[]` the standalone branch (plan.md, Design, Standalone phases). Add `isStandalone?: boolean` to `hooks/model.ts: BoardInputs` and to `types/index.d.ts: SpeckitBoard` (data-model.md). Uses `hooks/model.ts: phase`, `types/index.d.ts: SpeckitPhase`, `SpeckitPhaseState`.

### Slice 2: standalone texts, no agents

- [X] T003 [US1] Test in `tests/model.test.ts` the status line, phases line and next step of `contracts/board-text.md` S-1 to S-8, and SC-001 (no name in `hooks/model.ts: TEAM`, no `/speckit-team`) over every string `statusLine`, `boardText`, `nextStep` and `bandLayout` return for those stages. Not settled there: given running agents, a standalone board's `bandLayout` has no `agent` item and `boardText` no `running:` line (FR-003); S-5's `nextStep` carries `command: '/speckit-implement:'` and the task. Extend `board` to copy `i.isStandalone` onto the board.
- [X] T004 [US1] Implement in `hooks/model.ts` the standalone texts of `contracts/board-text.md`: `nextStep(b: SpeckitBoard, running: readonly string[]): { text: string; task?: SpeckitTask; command?: string }` (adds `command`), `idleStep` wording for standalone, `statusLine(b)` (S-7's `✓ ready for the PR`), `boardText(b, running, now)` and `bandLayout(b, running, now, cols)` dropping agents when `b.isStandalone`. Uses `hooks/model.ts: current`, `nextTask`, `PHASE_ROLES`, `BandItem`.

**Checkpoint**: model tests green; nothing in the mod reads `isStandalone` yet.

## Phase 2: User Stories 1 and 3, the view picked per feature in the mod (P1, P2)

**Goal**: the mod sets `isStandalone` from the feature's records and draws it. **Independent test**: `tests/board.test.tsx`.

### Slice 3: view per feature

- [X] T005 [US1] [US3] Test in `tests/board.test.tsx` the view selection: FR-001, FR-007, FR-010, SC-002, US1 scenarios 1-4, US3 scenarios 1-3, and plan.md Design "View" (each record kind alone selects the team view; the store word via `register.tsx: gateKey`). Not settled there: D1-A, a team `SubagentStart` on a feature with no record turns it to the team view and `clearCmd` does not turn it back; US3 scenario 2 switches `.specify/feature.json` between `specs/001-x` (records) and a second feature without any, as the test at :531 switches features; FR-010 edits `seen.files` and waits one `POLL_MS` (4000) with `poll`. Extend `world` with a way to leave out its default verdict and retries files, and make its `fs.exists` answer true for every path in `files` and every folder above one, as the real one does; existing tests keep their calls and expectations (FR-008, SC-003). Constitution II, two more cases: a team `SubagentStart` whose `teamFeatures` write is refused (`tests/board.test.tsx: denyState`, as the test at :876 does for `isCleared`) still reaches `next(e)` and toasts; a team `SubagentStart` with no repo (`register.tsx: repo` null, :25) reaches `next(e)` and does not throw.
- [X] T006 [US1] [US3] Implement in `hooks/register.tsx: snapshot($: EngineInterface, at: Repo)` the view rule of plan.md Design "View", setting `isStandalone` on the board; add the atom `teamFeatures` (`types/index.d.ts: PluginState['speckit-board'].teamFeatures: string[]`, data-model.md) and append `activeFeature($, repo.root)` to it in the `classic.SubagentStart` handler for a team role (`hooks/model.ts: teamRole`), skipped when `repo` is null (as `refresh` guards it at :133) and wrapped in a try/catch that toasts, as the handler's `isCleared` write at :285-289 is, so `next(e)` is always reached (constitution II). Uses `register.tsx: readJson`, `gateWord`, `gateKey`, `activeFeature`; `claude-code: atom`, `read`, `update`.

### Slice 4: the standalone pane

- [X] T007 [US1] Test in `tests/board.test.tsx` the standalone pane through `mountPane` / `PANE`: FR-003, FR-004, the pane paragraph of `contracts/board-text.md` (no Team section, S-5's `/speckit-implement:` before the task), FR-015 and the edge case "clear in standalone" (`clearCmd` answers per `hooks/model.ts: clearText(0, true, 0)`, the band hides, `/speckit-board band` brings it back). Not settled there: the rows `ui.open` is asked for are `2 + 4 + 1 + taskRows + 3`, the pattern of the test at :189 without the team block and its blank row.
- [X] T008 [US1] Implement in `hooks/register.tsx` the `ui.render` Pane handler for a standalone board (no Team box; `step.command` drawn before the task) and `paneRows(b: SpeckitBoard | null, team: readonly SpeckitAgent[], isAll: boolean): number` without the team rows when `b.isStandalone`. Uses `hooks/model.ts: nextStep` (T004), `taskSections`.

**Checkpoint**: a repo with Spec Kit and the board only gets the full standalone board (US1).

## Phase 3: User Story 4, degraded cases (P3)

**Goal**: one line for each missing piece, no throw, a non-git Spec Kit repo drawn. **Independent test**: `tests/model.test.ts`, `tests/board.test.tsx`.

### Slice 5: repo without git, repo without Spec Kit

- [X] T009 [US4] Test in `tests/model.test.ts` `ancestors`: FR-014, with POSIX (`/a/b`) and Windows (`C:\a\b`, `C:/a/b/`) spellings. Not settled there: result is nearest first, forward slashes, no trailing slash, the root as `''` (POSIX) or `C:` (Windows), so `${dir}/.specify` is the path to test.
- [X] T010 [US4] Test in `tests/board.test.tsx`: US4 scenarios 2 and 3, FR-012, FR-013, D4-A, D5-A. A cwd `/plain/sub` that `world`'s `process.run` answers as no git, with `/plain/.specify/feature.json` and a feature under `/plain`, draws S-5's four phases from the files; a cwd with no `.specify/` anywhere toasts nothing at start and answers N-1 to `status`, to no argument and to `band`, with no absolute path in any text. Replaces the test "outside a Spec Kit repo it says it loaded and found nothing" (:482).
- [X] T011 [US4] Implement `hooks/model.ts: ancestors(cwd: string): string[]` and `noticeText(n: Notice, dir?: string): string` with `export type Notice = 'not-set-up' | 'no-feature' | 'feature-unreadable' | 'no-folder'` (texts N-1 to N-4, `contracts/board-text.md`); in `hooks/register.tsx`: `Repo` as `{ root: string; stateDir?: string }`, `findRepo($: EngineInterface, cwd: string): Promise<Repo | null>` walking `ancestors` with `$.fs.exists` when git answers nothing, `snapshot` reading no record or store word without `stateDir`, `session.start` with no toast when `repo` is null, `command.run` answering `noticeText('not-set-up')`.

### Slice 6: notices for a missing feature

- [X] T012 [US4] Test in `tests/board.test.tsx` N-2, N-3, N-4 of `contracts/board-text.md`, US4 scenario 1, FR-013 and the edge case "folder does not exist": each as the `status` answer, the pane's line (`mountPane`) and the start toast, with the last `seen.status` entry `undefined`. Not settled there: N-2 covers `feature.json` missing, without `feature_directory`, and naming a folder outside the repo (`hooks/model.ts: featureDir` returns `''`); N-4 needs `spec.md` missing and the folder absent from `world`'s `fs.exists`.
- [X] T013 [US4] Implement in `hooks/register.tsx`: `snapshot(...)` returning `Promise<{ board: SpeckitBoard | null; notice: string }>` (folder checked with `$.fs.exists` only when `spec.md` is missing), `refresh` storing both in the atoms `board` and `notice` (`types/index.d.ts: PluginState['speckit-board'].notice: string`), and the Pane handler, `status` answer and `session.start` toast drawing `notice`. Uses `hooks/model.ts: noticeText` (T011).

### Slice 7: a file that exists but cannot be read (D3-A)

- [X] T014 [US4] Test in `tests/model.test.ts` `contracts/board-text.md` U-1 to U-3 in both views (`isStandalone` true and absent): FR-011, D3-A. Not settled there: `spec`, `plan` or `tasks` `null` is unreadable while `undefined` stays missing; the next step names only the file name.
- [X] T015 [US4] Test in `tests/board.test.tsx` FR-011 and the edge case "an optional team record is unreadable" (D3-A): a `tasks.md` that `fs.exists` reports and `fs.read` denies shows `✗ tasks (unreadable)`; a verdict file the same way selects the team view and shows `✗ audit (unreadable)`; a missing one stays missing. Extend `world` so a file can exist while its read is denied.
- [X] T016 [US4] Implement in `hooks/register.tsx: readText($: EngineInterface, path: string): Promise<string | null | undefined>` (on a rejected read, `$.fs.exists(path)` true gives `null`) and `readJson` passing `null` through; `snapshot` passing `null` texts to `derivePhases` (fingerprint still uses `hooks/model.ts: MISSING` for them); in `hooks/model.ts`: `BoardInputs.spec`, `plan` as `string | null | undefined`, `tasks` as `SpeckitTask[] | null | undefined` (data-model.md), `derivePhases` and `idleStep` for U-1 to U-3.

**Checkpoint**: SC-005's cases each answer one line and none throws.

## Phase 4: User Story 2, board-only install and docs (P1)

**Goal**: the installer leaves a board it did not install, and the README documents the board-only route and the standalone view. **Independent test**: `test/install.test.mjs`, `test/board-mod.test.mjs`; quickstart.md check 1 by hand.

### Slice 8: `--uninstall` keeps a board the installer did not install (D6-A)

- [X] T017 [P] [US2] Test in `test/install.test.mjs`, beside "a marketplace the user added is not removed with the board" (:631), with `{ skip: noClaude }`: constitution Installation Constraints (idempotence, `--uninstall` "and nothing else"), D2-A, D6-A. Not settled elsewhere: a board the user installed (`claudeIn(dir, 'plugin', 'marketplace', 'add', path.dirname(INSTALL))` standing in for the GitHub marketplace, then `claudeIn(dir, 'plugin', 'install', 'speckit-board@speckit-agents', '--scope', 'user')`) survives `install(dir, '--board')` then `--uninstall`, and `--board` then `--no-board`, with its marketplace; the `--board` run's stdout says nothing of `git pull`; a rerun leaves `hooks/speckit-agents.install.json` byte for byte. A board `--board` installed is still removed (the :579 and :601 tests stay as they are), including from a manifest written before this change (the same install with `addedPlugin` deleted from `hooks/speckit-agents.install.json`). Uses that file's `claudeDir`, `install`, `claudeIn`, `boardIn`, `marketsIn` (:15-575).
- [X] T018 [US2] Implement in `install.mjs`: `installBoard(addedBefore: boolean, pluginBefore: boolean): { added: boolean; plugin: boolean; error?: string }` (`plugin` true when this run installs the plugin, else `pluginBefore`; a found plugin keeps `pluginBefore`; the repoint path is unchanged and its reinstall sets `true`), `removeBoard(addedBefore: boolean, pluginBefore: boolean): { added: boolean; plugin: boolean; error?: string }` (`claude plugin uninstall` only when `pluginBefore`); `pluginBefore` is `manifest.addedPlugin ?? Boolean(manifest.board)` (a manifest from before this change keeps today's removal, constitution uninstall rule), passed at the `wantBoard` call (:407-411) and the `--uninstall` call (:311; `hadBoard` at :308 stays, so the failing-Claude test at :551 still warns); the manifest write (:412-423) adds `addedPlugin: boardResult.plugin`. The closing `The board:` line (:454) keeps "After a git pull here, /reload-plugins" only when `boardResult.added`, else names `claude plugin marketplace update speckit-agents`. Update the `--no-board` line of the header comment (:10, printed as `--help` from :37-39): it removes the board only when this installer installed it (D6-A, constitution VIII); no flag is added.

### Slice 9: README and CLAUDE.md

- [X] T019 [P] [US2] Test in `test/board-mod.test.mjs`, beside "the README's board commands are the arguments the mod registers" (:123): FR-009, FR-016, SC-004, D2-A. The README's board-only commands are exactly two and install `<name in mods/speckit-board/.claude-plugin/plugin.json>@<name in .claude-plugin/marketplace.json>`. Uses that file's `ROOT`, `MOD`.
- [X] T020 [US2] Update `README.md` "Board mod" (FR-016, constitution VIII): "Installing the board" gets the board-only commands (D2-A), the US2 scenario 2-3 behaviour, and at :1027-1028 that `--uninstall` and `--no-board` remove the board only when the installer installed it (D6-A), and that a board from the GitHub marketplace updates with `claude plugin marketplace update`, not `git pull` (:1015, :1024); "What it draws" the standalone view per `contracts/board-text.md`; "Where it reads its state" the view rule, the non-git repo and unreadable files; "When it refreshes" the start toast change (D5-A); "Verified" what the unit tests cover and that quickstart.md's checks are not yet run live. Update `CLAUDE.md` Layout's `mods/speckit-board/` bullet: it runs with Spec Kit alone. Recount the tests this feature adds (constitution VIII, every count matches), from the `test(` calls in each suite and the mod's test files: `README.md:1240` (`npm test` total), `:1245` (`test/install.test.mjs`, 44), `:1246` (`test/board-mod.test.mjs`, 9, and the mod's 76), `:1153` (the mod's 76), `CLAUDE.md:46` (197, and its date). Also update `README.md:155` (the flag table's `--no-board` row) and `README.md:1016` to say `--no-board` removes the board only when the installer installed it (D6-A). The `install.mjs` help text is T018's.

## Dependencies

- Phase 1, then 2 (reads `isStandalone`, `nextStep().command`), then 3 (changes `snapshot` again), then 4 (describes the result). In Phase 4, Slice 8 touches only `install.mjs` and `test/install.test.mjs`, so T017 and T019 can run side by side; T020 follows T018 (it describes the installer change and counts T017's tests).
- Within a phase the slices share `hooks/model.ts`, `hooks/register.tsx` and their test files, so their implementation tasks run in order. Test tasks on `tests/model.test.ts` (T009, T014) can run beside those on `tests/board.test.tsx` (T010, T012, T015).

## Implementation Strategy

MVP is Phases 1-2: a Spec Kit-only repo with the board loaded by `claude --plugin-dir` gets the
standalone board. Phase 3 hardens the first minute, Phase 4 makes the install documented.
