# Implementation Plan: Standalone Board

**Branch**: `005-standalone-board` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-standalone-board/spec.md`

## Summary

The board (`mods/speckit-board/`) gets a second view. A feature with no team record (D1) is drawn
from its spec, plan and task files alone: four phases (spec, plan, tasks, build), no audit, verify,
gate, retry meter or agent rows, and next steps that name Spec Kit's own commands
(`contracts/board-text.md`). A feature with a team record is drawn exactly as today. The mod also
finds a Spec Kit repo that is not a git repo, answers each degraded case with one line, and shows a
file that exists but cannot be read instead of treating it as missing (D3). The board-only install
is two `claude plugin` commands the README documents (D2). `install.mjs` records whether it
installed the board, so `--uninstall` and `--no-board` leave a board-only install alone (D6).

## Technical Context

**Language/Version**: TypeScript run as source by Claude Code 2.1.293's plugin API (the mod);
Node 18+ ESM for `test/`.

**Primary Dependencies**: the plugin API (`$`, `claude-code`, `claude-code/testing`) only. None added.

**Storage**: plugin atoms (session state); files read only: `.specify/feature.json`, the feature's
`spec.md`, `plan.md`, `tasks.md`, and the team's `verdicts/`, `retries/`, `ends/` records. See
`data-model.md`.

**Testing**: `claude plugin test` on `mods/speckit-board/tests/*.test.ts(x)` (run under `npm test` by
`test/board-mod.test.mjs`: "the board mod's own tests pass under claude plugin test"); `node:test` in
`test/board-mod.test.mjs`. CI type-checks the mod with `tsc -p mods/speckit-board --noEmit`, so new
fields must keep the existing tests compiling (hence the optional `isStandalone`, `data-model.md`).

**Target Platform**: Claude Code on Windows, macOS, Linux (constitution VII).

**Project Type**: Claude Code plugin (mod) inside the speckit-agents repo.

**Performance Goals**: refresh within the existing 4 s poll (`register.tsx: POLL_MS`), unchanged.

**Constraints**: observer budget (constitution III): this feature adds no work to any tool call. The
mod's only `tool.call` handler (`SubagentHandback`) is unchanged. Added work is off the tool-call
path: at most one `$.fs.exists` per failed read in a refresh (D3), one per feature-folder check when
`spec.md` is missing, one `.specify/feature.json` read per team `SubagentStart` (D1), and in a
non-git folder one `$.fs.exists` per ancestor of the cwd at session start.

**Scale/Scope**: 2 source files and 1 type file in the mod, their 2 test files, `install.mjs`,
2 tests in `test/` (`board-mod.test.mjs`, `install.test.mjs`), README.md and CLAUDE.md.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Result: PASS (D1-D6
decided, see Decisions).

| Rule | Tasks | How |
|---|---|---|
| I. Every behaviour change has a test under `npm test`, seen failing first, asserting what a caller observes | T001, T003, T005, T007, T009, T010, T012, T014, T015, T017, T019 | each slice's tests precede its implementation; they assert pane, band, status line, command answers and the installed plugins |
| II. Every code path that can throw has a test | T010, T012, T015 | new paths: repo discovery without git, notices, a read that fails on an existing file |
| III. Observers never deny, delay or alter; a failure is visible | T015, T016, T012, T013 | no handler denies or rewrites (FR-011); unreadable files and `feature.json` are shown (D3); budget in Technical Context |
| IV. Plugin code uses only the plugin API, shipped as source | T002-T016 | only `$.fs`, `$.store`, atoms; no package added |
| V. Public contracts (slash command answers) documented | T020 | the new texts are in `contracts/board-text.md`; no event, no installer flag (D2-A) |
| VI. Output local and metadata only, repo-relative paths | T010, T011, T012 | the not-set-up line drops the absolute cwd the start toast printed (FR-012) |
| VII. Same behaviour on all three platforms, forward slashes | T009, T011 | `ancestors()` tested with Windows and POSIX spellings; CI runs the board tests on all three |
| VIII. README, CLAUDE.md and installer help describe the change; every count matches | T019, T020 | README and CLAUDE.md in T020, with the test counts at README.md:1153, :1240, :1245, :1246 and CLAUDE.md:46; `install.mjs --help` unchanged because no flag changes (D2-A) |
| Installation: no output in repos without `.specify/` | T010, T011 | the start toast outside Spec Kit goes (D5-A); `/speckit-board` still answers |
| Installation: idempotent; `--uninstall` removes what it added and nothing else | T017, T018 | the manifest records whether this installer installed the plugin; a board-only install survives `--board` then `--uninstall` or `--no-board` (D6-A) |

Not applicable: II hook wiring and quoted hook paths (no hook command, event or matcher changes; the
mod subscribes to the same events); installer overwrite and validate-first rules (`install.mjs`
writes no new file, only one more manifest field, D6-A); V event schema versions (the board emits no events);
Workflow gates 1-3 (spec-gatekeeper's job, and gate 3 has no hook or event change to check).

## Design

Each rule below is implemented once; tasks point here.

- **View** (FR-007, D1): `snapshot()` sets `isStandalone` when the active feature has none of: a
  `verdicts/<name>.json`, `retries/<name>.json` or `ends/<name>.json` that exists (readable or not,
  D3), a gatekeeper word in the plugin store (`gateKey`), or (D1-A) an entry in `teamFeatures`. No
  git common dir means no record files.
- **Standalone phases** (FR-002, FR-004, FR-006): `derivePhases` returns spec, plan, tasks and build.
  The first three are derived as today. Build has no gate: done when every task is ticked, active
  once one is, else todo with its count, or todo with no note when the list is empty.
- **Standalone texts** (FR-003, FR-005): `nextStep`, `statusLine`, `boardText`, `bandLayout` and
  the pane take their wording from `contracts/board-text.md` and drop every agent display
  (running list, agent band item, Team section) when `b.isStandalone`.
- **Repo** (FR-013, D4): with git as today (toplevel holding `.specify/`, state dir under the common
  dir). When git answers nothing, the nearest of `ancestors(cwd)` holding `.specify/` is the root,
  with no state dir.
- **Notices** (FR-013, D5): one line per degraded case, in `contracts/board-text.md`, shown in the
  pane, the `status` answer and the start toast; the status line is cleared.
- **Unchanged** (FR-008, FR-015): the six-phase derivation, band, pane and texts for a team view;
  clear, hide, toggle and refresh code paths. The existing board tests run unmodified in the team
  view (SC-003), except the ones D5 and the notices replace.
- **Install** (FR-009, D2-A): README documents the two commands, `test/board-mod.test.mjs`
  holds them to `.claude-plugin/marketplace.json`. `install.mjs` keeps a board it did not install
  (D6-A, constitution Installation Constraints).
- **Media**: the recorded board (`docs/media/board.png`) shows the team view, which does not change;
  no re-recording.

## Project Structure

### Documentation (this feature)

```text
specs/005-standalone-board/
├── plan.md
├── data-model.md         # changed board state
├── contracts/
│   └── board-text.md     # standalone texts and notices
├── quickstart.md         # live checks: board-only install, standalone session
└── tasks.md
```

No `research.md`: the choices are D1-D5 under Decisions.

### Source Code (repository root)

```text
mods/speckit-board/
├── hooks/model.ts        # derivePhases, nextStep, statusLine, boardText, bandLayout, ancestors, noticeText
├── hooks/register.tsx    # findRepo, readText, snapshot, refresh, SubagentStart, Pane, command.run
├── types/index.d.ts      # SpeckitBoard.isStandalone, PluginState.notice, PluginState.teamFeatures
└── tests/
    ├── model.test.ts
    └── board.test.tsx
test/board-mod.test.mjs   # README board-only commands match the marketplace
install.mjs               # installBoard, removeBoard, manifest field addedPlugin, closing message
test/install.test.mjs     # a board-only install survives --board then --uninstall
README.md, CLAUDE.md
```

**Structure Decision**: all logic stays in the two existing mod files; no new module.

## Complexity Tracking

None.

## Decisions

Each decided by the owner on 2026-10-11: option A.

### D1. What selects the team view for a feature?

FR-007 says "whether the team has recorded anything". The team writes nothing per feature until the
first audit verdict, so in a `/speckit-team` run product-owner and architect work on a feature with no
record.

- **A (owner, 2026-10-11): a record file or store word, or a team agent started in this session while the
  feature was active.** New atom `teamFeatures: string[]` (`data-model.md`), appended at each team
  `SubagentStart` (one `feature.json` read). Clear does not touch it, so a clear never flips the view.
  A new session opened on a feature mid-run before its first verdict shows standalone until the next
  team agent starts. Standalone users never start a team agent, so nothing changes for them. `patcher`
  is not a team role (`model.ts: TEAM`) and does not select it. Tasks T005, T006.
  Spec: FR-007: The board MUST pick the standalone view per feature, by whether the team has recorded
  anything for that feature or a team agent has started in this session while it was the active
  feature, not by whether the team is installed.
  Spec: Key Entities, Team record: anything the team's hooks keep about a feature (an audit verdict, a
  retry count, a gatekeeper word), or a team agent started in this session while the feature was
  active. Its presence for a feature selects the team view for that feature.

### D2. Which route installs the board without the team?

- **A (owner, 2026-10-11): two `claude plugin` commands against the GitHub marketplace**, documented in the
  README: `claude plugin marketplace add PIsberg/speckit-agents`, then
  `claude plugin install speckit-board@speckit-agents --scope user`. No clone, no installer flag,
  2 commands (SC-004). The marketplace lists only `speckit-board`, so no agent, skill or hook of the
  team loads. Updates come through `claude plugin marketplace update`, not `git pull`. A later
  `node install.mjs` without `--board` leaves this board alone; with `--board` it finds the
  `speckit-agents` marketplace (not added by it) and keeps the installed plugin, and `--uninstall`
  or `--no-board` then leaves both (D6-A; the constitution's uninstall rule). A board that `--board`
  installed is removed by `--uninstall`, so keeping it then means rerunning the second command.
  Unverified: that a GitHub-sourced marketplace resolves `./mods/speckit-board` and runs the mod;
  `quickstart.md` check 1 settles it. Tasks T017-T020.
  Spec: US2 scenario 3: **Given** the board and the team are both installed, **When** the user removes
  the team and keeps the board (a board installed with `--board` is installed again with the README's
  board-only command), **Then** the board keeps working in standalone mode.

### D3. Is a file that exists but cannot be read shown, in both views?

FR-011 and constitution III want a read failure shown; today `readText` turns every failure (over
4 MiB, no permission) into "missing". FR-008 wants team output identical.

- **A (owner, 2026-10-11): both views.** On a failed read, `$.fs.exists` tells missing from unreadable. An
  unreadable `spec.md`, `plan.md` or `tasks.md` shows its phase `✗` with note `unreadable` and the next
  step `cannot read <file>`; an unreadable record file selects the team view and reads as today's
  unreadable JSON (`null`), which meets the edge case "never treats unreadable as absent". Team output
  changes only for a file that exists and cannot be read. Tasks T014-T016.
  Spec: FR-008: When the active feature has any team record, the board's output MUST be identical to
  what it was before this feature (no regression for team users), except that a file that exists but
  cannot be read shows as unreadable rather than missing (FR-011).

### D4. What does FR-013's "outside a git repository" cover?

US4 scenario 2 draws phases in a Spec Kit repo that is not a git repo, so FR-013's one-line message
cannot apply there.

- **A (owner, 2026-10-11): a folder that is neither a git repo nor below a `.specify/`.** It gets the
  not-set-up line like any repo without Spec Kit; a non-git Spec Kit repo draws its phases with no
  team records. Tasks T010, T011.
  Spec: FR-013: With no active feature, with a missing feature folder, and outside a Spec Kit
  repository (git or not), the board MUST answer with a one-line message that says what is missing
  and what starts it, and MUST NOT throw. A Spec Kit repository that is not a git repository draws
  its phases (US4 scenario 2).

### D5. Does the board still toast at start in a repo without Spec Kit?

Today it toasts `no .specify/ in the git repo at <cwd>; nothing to show`. The constitution's
Installation Constraints say installed components produce no output in repos without `.specify/`, and
FR-012 rules out the absolute path.

- **A (owner, 2026-10-11): no toast; `/speckit-board` answers the not-set-up line**
  (`contracts/board-text.md`). Meets both rules and US4 scenario 3 ("when the user opens the board").
  A loaded board with nothing to show is then silent until asked, which the toast was added to avoid
  (README, "When it refreshes"). Replaces the test "outside a Spec Kit repo it says it loaded and
  found nothing". Tasks T010, T011, T020. No spec change.

### D6. How does the installer keep a board it did not install? (constitution: `--uninstall` removes what it added "and nothing else")

D2-A makes this sequence a documented route: board-only install, then `node install.mjs --board`,
then `--uninstall` or `--no-board`. Today `installBoard` finds the plugin, logs it "unchanged" and
the manifest still records `board: true` (`install.mjs:271-275`, `:419`); `removeBoard` then
uninstalls a plugin the installer never added (`:288-293`, `:308-311`). The closing line "After a
git pull here, /reload-plugins picks up its changes" (`:454`) is also wrong for a board read from
the GitHub marketplace.

- **A (owner, 2026-10-11): the manifest records whether this installer installed the plugin.** New field
  `addedPlugin`, set when a run installs it and kept when a run finds it; `removeBoard` uninstalls
  only when it is true. A manifest written before this change has no field and falls back to
  `board`, so existing `--board` installs are still removed on `--uninstall`. The existing tests at
  `test/install.test.mjs:579`, `:601`, `:615`, `:631` and `:551` pass unchanged (in `:631` the user
  added only the marketplace, the installer installed the plugin, and uninstall still removes it).
  The closing line names `claude plugin marketplace update speckit-agents` when the marketplace is
  not the installer's. One manifest field, about 10 changed lines, 1 new test (T017, T018), README
  `:1027-1028` (T020). No FR changes: spec.md:17 and US2 scenario 3 stay true, since they speak of a
  board `--board` installed.
