# Implementation Plan: Fast track for small changes

**Branch**: `003-fast-track-patch` | **Date**: 2026-10-09, revised 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-fast-track-patch/spec.md` (approved, commit b215aef)

## Summary

A second track beside `/speckit-team` for typo fixes, config values and small bug fixes.
`/speckit-patch <change>` creates a branch and launches one new agent, `patcher`, that makes the
change (with a failing regression test first when behaviour changes) in the working tree and runs
the existing tests. `patcher` never commits, pushes or opens a pull request. Three hooks in
`patcher`'s frontmatter keep it small and away from guardrails: `scope protected` denies writes to
protected paths; a new `patch` mode denies any Bash command that names a git subcommand writing
history or reaching the remote, or `gh`, and measures the change since the agent's first tool call
on every call. Past 30 changed production lines (a modified line counts once), 2 production files
or any binary production file, it denies everything but reporting back, so the work stays in the
tree. It also denies the git commands that overwrite or delete files wholesale (`git reset --hard`,
`git clean`, a `git checkout` or `git restore` of `.`, a folder, a pattern or a file uncommitted at
the start), and the restore allowed while over budget names each protected file to restore
(decision 16). Test files are decided by `.specify/test-paths` as committed at the start. At the end of the
run the hook blocks finishing while a protected repo file changed by any means is not restored, or
while anything is committed; a changed installed team file (agent, hook, skill or settings file in
the config directory) ends the run `FAILED` with no accepted record (decision 16); otherwise it shows the measured
size and, within budget, writes an accepted record listing `patcher`'s files. Only after `patcher` reported `DONE`
with the tests passed, and only from that record, does the skill commit those files in the main
session, push and open the pull request (owner decision of 2026-10-09, decision 14, reversing
decision 6); a record that lists no file commits nothing (decision 16). Files the developer had already changed when the run starts are left out of the count
and the commit only while they stay as they were: a write to one is denied, and a change or commit
of one by any other means stops the run like an over-budget change (decision 13). The existing
`ends` mode checks the report's last word (`DONE`, `FAILED`, `ESCALATE`). An optional
`/speckit-triage <request>` suggests a track with a reason and runs nothing. Nothing in
`/speckit-team`, its agents, `settings.json` or the hook's existing modes changes. The feature ships
with every doc it touches updated, the architecture SVG redrawn and the `@` typeahead GIF
re-recorded.

## Technical Context

**Language/Version**: JavaScript ES modules on Node 18 or newer (hook, installer, tests); Markdown
for the agent and skills; one constant in the board mod's TypeScript.

**Primary Dependencies**: none at run time (constitution IV); Node standard library only
(`node:url`'s `fileURLToPath` is the one new import in the hook). `git` and, for the PR, `gh` are
called by the `/speckit-patch` skill in the main session through Bash, as `/speckit-team` already
does; `patcher` may not call either for history or the remote.

**Storage**: one start record per run in `<git common dir>/speckit-team/patch/<key>.json` and at
most one accepted record per worktree in `<git dir>/speckit-team/patch-accepted.json`
(data-model.md). No new config file.

**Testing**: `node:test` via `npm test`: `test/hook.test.mjs` (hook JSON on stdin against
throwaway git repos, and against a copy of the hook in a throwaway config dir for the team check),
`test/install.test.mjs` (throwaway config dirs), `test/board-mod.test.mjs` (the ROLE_COLOR twin),
`test/e2e.test.mjs` (real `claude -p` against the scripted fake API). Live checks in
[quickstart.md](quickstart.md).

**Target Platform**: Claude Code 2.1.293 (CI) and newer, on Windows (Git Bash and PowerShell hook
shells), macOS and Linux; CI runs `npm test` on all three.

**Project Type**: Claude Code extension: one hook script, agent and skill definitions, an installer.

**Performance Goals**: none stated by the spec. The `patch` mode adds three or four `git` calls to
each `patcher` tool call and to no other agent's, and hashes the installed team (one folder level)
at the first call and at each end check; not measured (research R5, R16).

**Constraints**: budget 30 changed production lines and 2 production files (FR-005), a file's
changed lines being the larger of its insertions and deletions; fail closed when the budget cannot
be measured (research R9); no destructive git command in the hook (FR-007); no commit, push or pull
request by `patcher` (decision 14); silent and inert without `.specify/` (FR-010); hook messages and
records carry paths, counts and hashes only (FR-014).

**Scale/Scope**: about 260 lines added to `hooks/speckit-team.mjs`; one agent file of about 60
lines; two skill files of about 60 and 25 lines; 4 lines in `install.mjs`; 1 line in `model.ts`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

Every MUST rule, with the task that delivers it or the line that shows it does not apply.

| Rule | How this plan meets it | Tasks | Result |
|---|---|---|---|
| I. Every behaviour change ships with a test in `test/` under `npm test` | Every implementation task is preceded by its test tasks in the same slice: T001 before T002, T003 before T004, T005 before T006, T007 before T008, T009 before T010, T011 to T013 before T014, T015 before T016. Doc and media tasks change no behaviour. | T001, T003, T005, T007, T009, T011, T012, T013, T015 | PASS |
| I. Shown failing before the change, evidence in the PR body | Each test task's report carries its red output; T013 is also run with the installed hook replaced by `process.exit(0)` (SC-004). T024 collects that evidence into the file the PR body quotes. | T001 to T016, T024 | PASS |
| I. Tests assert what a caller observes | Hook tests assert decision JSON, the records and files left on disk; installer tests assert installed files and `--help` output; e2e tests assert what the agent's next request shows, the accepted record and `git` state. No test imports a hook function. | T001, T003, T005, T007, T009, T011, T013, T015 | PASS |
| I. No test that passes because the code never ran | T013's `process.exit(0)` run; every new hook decision has a case named in its task that fails when that decision is removed: the budget (T003), test patterns from the start commit (T003), the command deny and the wholesale-restore deny (T005), a commit at any size, the accepted record's removal and contents, the narrowed restore allowance (T007), the team check ending the run `FAILED` without blocking (T009). | T003, T005, T007, T009, T013 | PASS |
| II. Every hook entry point handles empty, malformed and unknown input; each path tested | `scope protected` and `patch` are added to the `MODES` list of the malformed-input, wrong-event and outside-Spec-Kit tests; `patch` gets tests for a missing key, a corrupt start record, a `dirty` or `team` field of the wrong shape, an unknown start commit, an invalid committed `.specify/test-paths`, a repo with no commit, a non-string Bash `command` (for both the history and the wholesale-restore deny), a config dir with missing folders; `scope protected` gets a missing, malformed and wrong-name root `package.json` and a repo with no commit. | T001, T003, T005, T007, T009 | PASS |
| II. A wiring change is verified in a live session before merge, the PR says what was observed | `patcher`'s frontmatter is new hook wiring: live checks L1 to L8 (quickstart.md), recorded in README "Live results" and in T024's evidence. | T022, T024 | PASS |
| II. Installed hook commands use a quoted, absolute, forward-slash path | `patcher.md` uses `node "{{HOOK}}" ...` like the other agents, and the skill `git hash-object -- "{{HOOK}}"`; T011 asserts both installed texts carry the quoted absolute path. | T011, T014 | PASS |
| III. Observers never block; observer overhead budget | Not applicable: the feature adds no observer. Its hooks are guardrails that decide by design. The board mod change is one color constant with no behaviour. | none | N/A |
| IV. Node stdlib only; plugin code only `$`, no build step | Only `node:url` is added to the hook's imports; the team listing uses `fs.readdirSync` without the Node 18.17 `recursive` option. `model.ts` gains a string constant. | T002, T010, T014 | PASS |
| IV. A new runtime dependency needs an amendment | None added. | none | N/A |
| V. Public contracts listed and versioned; additive within a major version | New public surface: `/speckit-patch`, `/speckit-triage`, agent `patcher`, three installed files, the `patch` mode and `scope protected` rule. All additive; nothing renamed or removed. Documented in contracts/ and the README. The accepted record is state under the git directory read only by the skill installed with it, not an emitted event, so no schema version applies. | T017, T018 | PASS |
| V. Consumers may ignore unknown fields; docs say so | Not applicable: no event format changes. | none | N/A |
| VI. Event data stays local; no prompt text, file contents, command output | State stays in the git directory; the start record holds a SHA-256 per dirty file and per team file, never content (research R14, R16); the accepted record holds paths and counts. Hook messages carry paths, counts, a command name and a commit id; T003, T005, T007 and T009 assert that the content written in the test never appears in any hook output or record (FR-014). | T003, T005, T007, T009 | PASS |
| VII. Works on Windows, macOS and Linux; forward-slash paths | Paths come from `git` and the existing `canonical()`/`real()`; the protected table is case-insensitive for Windows and macOS file systems (T001 covers an upper-case spelling); the command deny strips `.exe` and splits paths at `\` as well as `/` (T005); team paths are stored with forward slashes. CI runs every new test on all three. The live checks run on Windows only, and the README says so. | T001, T005, T009, T022 | PASS |
| VIII. README, CLAUDE.md and the installer's help text describe it; counts, paths and commands match | README in T017, T018, T021, T022, T023; CLAUDE.md in T019 and T023; installer help and final message in T014 and T016, asserted by T011 and T015. Every doc hit found by search is listed under "Documentation plan" below with its task. | T014, T016 to T023 | PASS |
| VIII. Docs state what was verified live, by unit test only, and not at all | T018 writes that line into "The fast track" section; T022 adds the dated live entry and moves anything not exercised into the "Not yet exercised live" note. | T018, T022 | PASS |
| VIII. No em-dashes, no curly quotes, numbers over adjectives | A check in every doc task (T017 to T023). | T017 to T023 | PASS |
| Installation: idempotent | T011 extends "a second install changes nothing" to the new files. | T011, T014 | PASS |
| Installation: never overwrite an unmarked file without `--force`, then back it up | The new files go through the existing `files()` list and collision check; T011 asserts a user's own `agents/patcher.md` is refused without `--force`. | T011, T014 | PASS |
| Installation: validate before writing | Unchanged machinery; no new input is read. | none | N/A |
| Installation: cost nothing without `.specify/` | T001 and T003 extend the outside-Spec-Kit tests to both new modes; no `settings.json` entry is added. | T001, T003 | PASS |
| Installation: `--uninstall` removes every file it added and nothing else | T011 and T015 extend the uninstall and round-trip tests to the new agent and both skills. | T011, T015 | PASS |
| Workflow: feature branch; agents open PRs, never merge | Work is on `003-fast-track-patch`. In the fast track the `/speckit-patch` skill opens the PR and never merges, and `patcher` never commits (rules in `skills/speckit-patch/SKILL.md` and `agents/patcher.md`, asserted by T011; `patcher`'s commit, push and `gh` denied by T006, tested by T005). | T005, T006, T011, T014 | PASS |
| Workflow: gates reported as passed, failed, skipped or not run; no pipes eating exit codes | Gates are spec-gatekeeper's. The fast track carries the same rule into `patcher.md` (FR-003), asserted by T011. | T011, T014 | PASS |
| Governance: deviations in Complexity Tracking | None. | none | N/A |

Post-design re-check (after research.md, data-model.md and contracts/): no rule changed status. The
open risks are not violations: the protected end check can loop on a model that never restores a
protected repo file (research R6, decision 5; an installed team file no longer loops, decision 16); a commit,
push or PR made by a program whose command does not name it is not denied before it runs, which is
deliberate shell evasion and outside what the fast track guards against (research R15, "What
remains"); and whether Claude Code delivers the fast track's hooks in an interactive session is
settled only by the live check (T022).

## Decisions to confirm

Decisions 1 to 13 were confirmed by the owner on 2026-10-09: 3 and 4 as changed by the owner, the
rest as first written. The owner's second answer the same day settled the two points left open:
renames are measured with git's rename detection (decision 3), and the repository is recognised by
the name in the top-level `package.json`, which joins the protected sources (decision 4). The three
choices the planner made inside those answers were confirmed by the owner on 2026-10-09 as well: the
name is read from a commit rather than the working tree (4), how a rename across path classes is
counted (3), and the `git mv` rule for a move git does not see as a rename (3). After the second spec
audit the owner chose "commit after the check" on 2026-10-09 (decision 14), which reverses decision 6.
The owner confirmed decision 15 on 2026-10-10 with one change (point 5): a change to the config
directory's settings file during a run no longer blocks the end; the run ends `FAILED` with nothing
committed. After the third spec audit the owner chose on 2026-10-10 the fixes for its findings H1, M2
and M5 (decision 16), which change decisions 7, 14 point 4 and 15 points 1, 3 and 5.

1. **Names** (public contract): `/speckit-patch`, `/speckit-triage`, agent `patcher`, report words
   `DONE`, `FAILED`, `ESCALATE`. Confirmed 2026-10-09.
2. **Agent model and color**: `model: sonnet` (as implementer) and `color: cyan` (the first unused
   one). The model is your choice; this only fills the field. Confirmed 2026-10-09.
3. **Changed lines = max(insertions, deletions) per production file** as `git diff --numstat`
   reports them, so a modified line counts 1: 30 modified lines fit and 31 do not. An untracked file
   counts its line count. A binary production file is still not allowed. Confirmed by the owner on
   2026-10-09, changed from insertions plus deletions. **Renames** (owner-confirmed 2026-10-09, second
   answer): measured with git's rename detection (`git diff --find-renames`), so a pure rename counts
   0 lines and 1 file touched, and a rename with edits counts only its edited lines (the larger of
   insertions and deletions) and 1 file. **Planner's choice, confirmed by the owner on 2026-10-09**
   (research R3): a rename is counted that way only when both paths are production; a test or doc moved into
   production code (or out of it) counts as without rename detection, the production side as an
   added or deleted file, so moving a test into `src/` is not a free file. A pure rename of a binary
   production file is a file touched, not a modified binary. Git pairs only paths it tracks: a file
   moved with plain `mv` or written anew leaves the new path untracked, and counts as a deletion plus
   a new file (2 files); `agents/patcher.md` says to move files with `git mv` (T014), and the hook
   never stages anything to find the pair (it changes nothing in the repo).
4. **Protected set wider than FR-007's minimum** (research R4). Confirmed by the owner on 2026-10-09,
   changed to protect the speckit-agents sources only in the speckit-agents repository. In every repo:
   `.specify/`, `specs/`, all of `.claude/` and `.github/`, `.gitlab-ci.yml`, `.circleci/`,
   `azure-pipelines.yml`, `Jenkinsfile`, `.pre-commit-config.yaml`, and the installed team in the
   Claude config directory. Only in the speckit-agents repository: `hooks/speckit-team.mjs`,
   `agents/*.md`, `skills/*/SKILL.md`, `install.mjs` and the top-level `package.json`. **How the hook
   recognises it** (owner-confirmed 2026-10-09, second answer): the repo's top-level `package.json`
   parses as JSON with `"name": "speckit-agents"`. A missing or malformed file, another name, or the
   name only in a subfolder's `package.json` means an ordinary repo. **`package.json` joins
   `OWN_SOURCES`** (owner-confirmed 2026-10-09, second answer): in this repository the fast track
   cannot change it, so an agent cannot lift the source protection by editing the name; in an
   ordinary repo it is an ordinary production file. **Planner's choice, confirmed by the owner on
   2026-10-09**: the name is read from a commit, not the working tree (`git cat-file blob <rev>:package.json`): the end
   check reads the run's start commit, `scope protected` reads `HEAD`. A `Write` or `Edit` to
   `package.json` is denied here; a shell edit of the name, committed or not, cannot change the start
   commit, so the end check still treats the repo as this one and blocks until `package.json` (and
   any source changed meanwhile) is restored. Reading the working tree would let a shell edit of the
   name switch the protection off before the end check ran. Testable: a test commits that file into a throwaway repo. Not hit by accident: an ordinary
   project would have to give its own root package this repo's exact name; a clone or fork keeps
   the name and stays protected, as it should. Rejected: the git remote URL (absent in a fork, a
   renamed repo or a clone without that remote), the root commit (missing from CI's shallow
   checkout), the mere presence of `hooks/speckit-team.mjs` (a repo that vendors the hook would
   match). No per-repo file to add paths.
5. **The protected end check blocks on every attempt** until the files are restored, unlike the lane
   check, which lets an agent go with a WARNING on its second stop (the spec says "until they are
   restored"). A model that never restores loops until you stop it. Confirmed 2026-10-09.
6. ~~`patcher` commits, pushes and opens the PR itself, so the budget hook stands between an
   oversized change and `gh pr create`.~~ **Reversed by the owner on 2026-10-09 (decision 14)**: the
   spec audit showed a commit and push in the same Bash call as an edit running before any hook saw
   them (finding H1). Unchanged from 6: on a red CI the skill reports to you; it starts no fix round.
7. **While over budget, every tool is denied** except reporting back and, when a restore is pending,
   a single pure `git checkout`, `git restore`, `git reset --soft` or `rm` command (research R7). Confirmed 2026-10-09.
   **Narrowed by the owner on 2026-10-10 (decision 16, point 3)**: the restore command must name
   only protected files still to be restored.
8. **FR-002, FR-003 and FR-004 are prompt rules** in `agents/patcher.md` and the skill, not hooks: no
   hook can know a repo's test command or its result. Unit tests only show the installed agent and
   skill carry them; the live check is the behavioural evidence. Confirmed 2026-10-09.
9. **No installer flag and no `settings.json` change**: the fast track is always installed with the
   team. Confirmed 2026-10-09.
10. **`ROLE_COLOR` in the retired board mod gains `patcher`**, because `test/board-mod.test.mjs`
    holds it equal to `agents/*.md`. `TEAM` and the board's phases do not change. Confirmed 2026-10-09.
11. **Docs media**: the SVG is redrawn and `agents-list.gif` re-recorded (needs `vhs` and a logged-in
    `claude`; if the implementer cannot run them, T021 is yours). No new GIF of the fast track. Confirmed 2026-10-09.
12. **Live runs cost real tokens**: T022 makes about eight short `claude -p` runs on your account;
    the cost is recorded, not estimated. Confirmed 2026-10-09.
13. **Files already uncommitted at the start** (research R14; spec Edge Cases and Assumptions, FR-005,
    SC-002). The start record keeps a SHA-256 of each such file. A `Write` or `Edit` to one is denied
    before it runs; a change by any other means, or a commit that contains one, puts the run over the
    budget: nothing is accepted, a commit is blocked at the end until `git reset --soft`, and the
    stop message names the file. The hook never restores it. While the file is as it was, it costs
    nothing, and it is never in the accepted record, so the skill never commits it. Rejected:
    refusing to start with a dirty tree (the spec runs with uncommitted changes present), and a write
    deny alone (a Bash edit gets past it). Cost: each `patcher` tool call hashes every dirty-at-start
    file; not measured. **Planner's choice after the spec audit (finding H1), confirmed by the owner
    on 2026-10-09.**
14. **Commit after the check** (owner decision, 2026-10-09; spec audit findings H1 and H2; research
    R1, R3, R15, R16). Reverses decision 6.
    1. `patcher` may not commit, push or open a PR: `git commit`, `git push`, `gh` and the
       equivalents that write history or reach the remote are denied to it. `patcher` only changes
       the working tree, runs the tests and reports `DONE`, `FAILED` or `ESCALATE`.
    2. `/speckit-patch`, in the main session, makes the commit (staging only `patcher`'s files, never
       files dirty at the start), pushes and opens the PR, and only after `patcher`'s end check has
       passed and `patcher` reported `DONE` with the tests passed.
    3. `.specify/test-paths` is read from the run's start commit, not the working tree.
    4. The installed team files are hashed at the start of the run and compared in the end check; a
       change ends the run `FAILED` with no accepted record (owner change of 2026-10-10: first for a
       settings file, decision 15 point 5, then for every team file, decision 16 point 2; it blocked
       like a protected change before).
15. **How decision 14 is built** (planner's choices, owner-confirmed 2026-10-10 with the change in
    point 5; research R15, R16):
    1. *How the skill knows the end check passed*: the hook writes
       `<git dir>/speckit-team/patch-accepted.json` (`key`, `sha`, `files`, `untracked`, `lines`,
       `filesTouched`, `at`) only when the end check accepts a within-budget run, and every `patch`
       call removes it first, so it exists only while the last thing the hook saw was an accepted
       end. The skill commits only with it, with `git add -- <untracked>` and
       `git commit -m <message> -- <files>` (verified 2026-10-10 with git 2.55.0.windows.5: commits
       exactly those paths, leaves the developer's staged work staged). Tested by T007 and T013.
       With `files` empty the skill commits nothing (decision 16, point 1).
    2. *The skill creates the branch* (`git switch -c patch/<slug>`) before launching `patcher`, so
       `patcher` needs no branch command at all.
    3. *The deny list* (research R15): the git subcommands `commit`, `commit-tree`, `merge`,
       `rebase`, `cherry-pick`, `revert`, `am`, `stash`, `tag`, `branch`, `switch`, `update-ref`,
       `symbolic-ref`, `notes`, `replace`, `filter-branch`, `push`, `pull`, `fetch`, `clone`,
       `remote`, `ls-remote`, `submodule`, `send-email`, `request-pull`, `checkout` without `--`,
       and the programs `gh` and `hub`, matched on the words of the command, so a command that only
       mentions them is denied too. `git mv`, `git add`, `git reset` without `--hard` and
       `git checkout <sha> -- <file>` stay allowed (`git reset --hard`, `git clean` and the
       wholesale `git checkout`/`git restore` are denied by decision 16, point 3).
    4. *A commit at any size blocks the end* until `git reset --soft <start>` (it blocked only over
       budget before): a commit within budget was finding H1's route.
    5. *The team set*: files directly in `agents/`, `hooks/` and each `skills/<name>/` of the config
       directory the hook runs from, plus `settings.json` and `settings.local.json`; deeper files are
       only `Write`-protected. ~~A change to an agent, hook or skill file gives no restore command:
       `patcher` cannot undo it, so the run loops until you stop it or reinstall the team
       (decision 5).~~ Replaced by decision 16, point 2: it ends the run `FAILED` like a settings
       file. **Settings files** (owner change of 2026-10-10): a change to `settings.json`
       (and, by the same reasoning, `settings.local.json`) in that directory during the run, which
       Claude Code or you may make, does not block. The end check lets the run finish, writes no
       accepted record and shows a message naming the file and saying the run ended `FAILED`; the
       skill, finding no accepted record, commits nothing, opens no PR and reports `FAILED`. Tested
       by T009 (a case that fails if it blocks or writes the record) and T011 (the skill's text).
    6. *The skill also compares `git hash-object` of the installed hook* before and after `patcher`
       and commits nothing on a difference, because a rewritten hook runs a rewritten end check.

16. **Fixes for the third spec audit** (owner decision, 2026-10-10; findings H1, M2, M5).
    1. *An accepted record with no file commits nothing* (H1). `git commit -m <message> --` with no
       path commits the whole index (verified 2026-10-10 with git 2.55.0.windows.5: a staged file
       was committed), so a record with `files: []` (`patcher` changed nothing and reported `DONE`)
       would sweep the developer's staged work into the commit, the push and the PR (spec Edge
       Cases, threat model). When `files` is empty the skill runs no `git add`, `git commit`,
       `git push` or `gh pr create`, and reports that `patcher` changed no file, so nothing was
       committed and no pull request opened. Contract: contracts/commands-and-files.md step 4.
       Tested by T011 (the installed skill's text); the hook still writes the record (no hook change).
    2. *A changed installed team file ends the run `FAILED`* (M2). An agent, hook or skill file in
       the config directory has no restore command and `patcher` may not write there, so blocking
       trapped the run: even `ESCALATE` could not finish. Every team file is now treated like the
       settings files of decision 15 point 5: the end check lets the run finish, writes no accepted
       record, and its message names each changed file and says the run ended `FAILED`; nothing is
       committed. Protected files inside the repo keep blocking until restored (decision 5). The
       constant `TEAM_SETTINGS` is no longer needed and is dropped. Tested by T009 (each team-file
       case fails if it blocks or writes the record). **Spec note**: FR-007 says a protected file
       changed by other means MUST block until restored, and its protected set names "the hook
       script, the agent definitions"; for the installed copies in the config directory this
       decision ends the run instead of blocking. The owner confirmed this on 2026-10-10 and had
       the product-owner amend FR-007 to say so.
    3. *No wholesale restore* (M5). Denied to `patcher` on every `Bash` call, within budget or not
       (contracts/hook-cli.md step 4): `git reset --hard`, `git clean`, `git stash` (already in the
       history list), and a `git checkout … -- <paths>` or `git restore <paths>` whose paths include
       `.` (the owner's `git checkout -- .` and `git restore .`). The restore allowance while over
       budget (decision 7, step 6) admits only a command whose every path is a protected file still
       to be restored: `git checkout`/`git restore` naming changed protected files that existed at
       the start, `rm` naming new protected files, `git reset --soft <sha>` only when something is
       committed; never `.`, a folder, a pattern or a file uncommitted at the start. Tested by T005
       and T007 (each listed command fails the test if allowed). **Planner's extension, confirmed
       by the owner on 2026-10-10**: the always-on deny covers not only `.` but every path that is not one file the
       developer left alone: `..`, a folder, a pattern (`*`, `?`, `[`), git pathspec magic (a word
       starting with `:`) and a file uncommitted at the start (spec.md "Uncommitted changes present
       at start are left alone"). Denying `.` alone would let `git restore src` or
       `git checkout -- '*.js'` destroy the same work.

    What remains after 14 and 15 (README, Known limits; research R15, R16). The fast track guards
    against an agent's mistakes and drift, not against deliberate evasion through the shell (the
    spec's threat model), so these are known limits, not defects: a commit, push or PR made by a
    program whose command does not name it (a git alias, `npm version`, a script, `curl`) is not
    denied before it runs; the commit is still caught at the end, and a push such a program made
    makes the skill's own push fail (never forced), but cannot be undone by the hook. Guardrail state
    under the git directory is not protected from Bash; a protected change hidden that way stays
    uncommitted. A Bash write outside the repo and outside the hashed team set is not caught.

## Documentation plan

Owner requirement: every doc a user or agent would consult is updated in this change. Found by
searching the repo for `six`, `scope`, `gate`, `verdict`, `result`, `ends`, `lane`, `speckit-team`,
`SKILL.md`, `AGENTS`, `ROLE_COLOR`, `99 tests`, `43`, `24`, `16`, `11 tests`, `features 001 and 002`
on 2026-10-09. Each hit and the task that fixes it:

| File and place | What is wrong or missing | Task |
|---|---|---|
| `README.md` 13 (nav), 17 ("A team of six"), 31 to 51 (Highlights), 53 to 82 (Contents) | no fast track; agent count | T017 |
| `README.md` 124 to 145 (What gets installed, Installer options) | agent list, skills, "no new flag" | T017 |
| `README.md` 162 to 212 (Quick start) | no small-change path; who commits | T017 |
| `README.md` 254 to 280 (The team: table, "26 to 43 lines", "These six total about 1,700 characters") | no `patcher` row; counts | T017 |
| `README.md` 284 (SVG alt text, "the six agents") | count, commands | T017 |
| `README.md` 1028 to 1031 ("one of these six names"), 1057 to 1082 (Uninstall: "six agents, the skill") | counts, files | T017 |
| `README.md` 971 to 1031 (Troubleshooting) | budget stop, protected denial, blocked finish, command deny, wholesale-restore deny, commit blocked, team file changed (run `FAILED`) | T017 |
| `README.md` 1086 to 1098 (Repository layout: "six subagent definitions", mode list, skills row, "features 001 and 002") | counts, modes, skills, features | T017 |
| `README.md` 301 to 306 (How it works intro), new section "The fast track" | how it works, commit after the check, what is prose, what was verified | T018 |
| `README.md` 361 to 383 (Guardrails table, "The two settings.json entries") | rows for `scope protected`, `patch`, `ends DONE FAILED ESCALATE` | T018 |
| `README.md` 448 to 453 (State) | `patch/` folder, `patch-accepted.json` | T018 |
| `README.md` 547 to 574 (Customising) | budget constants, protected table, deny list, committed `test-paths` | T018 |
| `README.md` 1033 to 1055 (Known limits) | research R15 "What remains" and R16 "Limits", repeat runs, prose-only rules, moves git does not see as renames, `package.json` in this repo | T018 |
| `README.md` 223 to 230 (The team in the `@` typeahead: "five of the team's six") | which agents the list shows | T021 |
| `README.md` 455 to 545 (Context budget) | SC-005 fast-track row | T022 |
| `README.md` 874 to 969 (Live check, Live results, "Not yet exercised live") | fast-track checks | T022 |
| `README.md` 811 to 872 (Test suite: "99 tests", 43, 24, 7, 16; e2e: "The 11 tests", "all 11") | counts | T023 |
| `CLAUDE.md` 7 to 10 (Layout: agents, hook modes, skill), 56 to 63 (Rules: ROLE_COLOR) | `patcher`, `patch`, skills, protected table rule, accepted record rule | T019 |
| `CLAUDE.md` 41 to 51 (Verify: "99 tests", time, "16 e2e tests") | counts | T023 |
| `install.mjs` 1 to 10 (help text), 407 to 412 (final message) | the fast track | T014, T016 |
| `hooks/speckit-team.mjs` 1 to 17 (mode list), 67 to 75 (`WIRED`) | new mode and rule | T002, T004, T006, T008, T010 |
| `mods/speckit-board/hooks/model.ts` 15 to 20 (`ROLE_COLOR`) | `patcher` | T014 |
| `docs/media/architecture-visualized.svg` | commands and agents layers | T020 |
| `docs/media/agents-list.tape` 1 to 10 (comment), `docs/media/agents-list.gif` | the list it shows | T021 |

Checked and left unchanged: `skills/speckit-team/SKILL.md` and the six existing `agents/*.md` (the
fast track changes nothing they say); `docs/media/{pipeline,guardrail-denial,subagent-inline}.tape`
and their GIFs and `board.png` (none shows something this feature changes, research R12);
`.github/workflows/*.yml` and `package.json` (`npm test` already globs `test/*.test.mjs`);
`specs/001-*`, `specs/002-*`.

## Project Structure

### Documentation (this feature)

```text
specs/003-fast-track-patch/
├── spec.md              # approved (b215aef)
├── plan.md              # this file
├── research.md          # R1 to R16
├── data-model.md        # budget, path classes, start and accepted records, measurement, outcomes
├── quickstart.md        # usage and live checks L1 to L8
├── contracts/
│   ├── hook-cli.md            # scope protected, patch, ends DONE FAILED ESCALATE, accepted record
│   └── commands-and-files.md  # /speckit-patch, /speckit-triage, patcher, installed files
├── evidence.md          # T024: red-first and live evidence the PR body quotes
└── tasks.md
```

### Source Code (repository root)

```text
hooks/speckit-team.mjs                 # + PROTECTED, OWN_SOURCES, isOwnRepo, isProtected, TEAM_DIR, isTeamFile, scope rule `protected`;
                                       #   + PATCH_LINES, PATCH_FILES, DOC_PATTERNS, isDoc, parseTestPaths, testsAt, patchFile, repoRel,
                                       #     stateOf, measure, HISTORY_SUBCOMMANDS, historyCommand, gitCalls, treeCommand, acceptedFile,
                                       #     restoreAllowed, endCheck, teamState, teamChanged, mode `patch`
agents/patcher.md                      # new agent
skills/speckit-patch/SKILL.md          # new skill: /speckit-patch (branches, launches patcher, commits after the check)
skills/speckit-triage/SKILL.md         # new skill: /speckit-triage
install.mjs                            # AGENTS + 'patcher'; files() + 2 skills; help text; final message
mods/speckit-board/hooks/model.ts      # ROLE_COLOR + patcher: 'cyan'
test/hook.test.mjs                     # scope protected, patch tests (budget, command deny, end check, team)
test/install.test.mjs                  # new files installed, idempotent, uninstalled, help text, prose rules
test/board-mod.test.mjs                # 7 agents
test/e2e.test.mjs                      # patcher's hooks fire under claude -p
README.md, CLAUDE.md                   # docs
docs/media/architecture-visualized.svg # redrawn
docs/media/agents-list.{gif,tape}      # re-recorded
```

**Structure Decision**: the repo's existing single-project layout. No new directory beyond the two
skill folders, no new test file, no new script.

## Complexity Tracking

No constitution violation to justify.
