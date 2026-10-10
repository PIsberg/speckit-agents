---
description: "Task list for the fast track for small changes"
---

# Tasks: Fast track for small changes

**Input**: Design documents from `specs/003-fast-track-patch/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Revision of 2026-10-10**: the owner's decision "commit after the check" (plan.md, decision 14,
reversing decision 6) added slice 3 (the command deny) and slice 5 (the installed team hashed), and
changed slices 2, 4 and 6. Task IDs were renumbered: old T005 to T020 are now T007, T008 and T011 to
T024. The owner confirmed decision 15 the same day with one change: a changed config-dir settings
file ends the run `FAILED` with no accepted record instead of blocking (T009, T010, T011, T017,
T018; no task added or renumbered).

**Revision of 2026-10-10, third spec audit**: the owner chose the fixes for findings H1, M2 and M5
(plan.md decision 16). H1: the skill commits, pushes and opens nothing when the accepted record's
`files` is empty (T011, T014). M2: a changed installed agent, hook or skill file ends the run
`FAILED` with no accepted record, like a settings file, instead of blocking (T008, T009, T010,
T017, T018). M5: `git reset --hard`, `git clean` and a wholesale `git checkout`/`git restore` are
denied to `patcher`, and the restore allowance admits only commands naming protected files still to
be restored (T005, T006, T007, T008, T011, T014, T017, T018). No task added or renumbered.

**Tests**: Required by constitution I and SC-004. In every slice the test tasks come first and are
shown failing before the implementation task. Where a test guards behaviour that already holds (the
malformed-input cases of an existing mode), the task says so; the deliberate break that turns it red
once is named there. Every new hook decision has a case that fails when that decision is removed;
the task names which.

**Organization**: one slice at a time. A slice is one behaviour: its test tasks, then one
implementation task. Each slice builds and tests without the slices after it. The hook slices
(US3, US2) come before the agent (US1) although all are P1, because `patcher` is only safe to install
once its hooks exist; installing it first would ship a fast track with no budget and no protected
paths.

**User Story 4** (existing tracks unchanged, P1) has no slice of its own, because it adds no code.
Its scenarios are covered by: US4-1 by the existing `test/hook.test.mjs` and `test/e2e.test.mjs`
gate tests, which no task changes; US4-2 (silent without `.specify/`) by T001 and T003; US4-3
(uninstall) by T011 and T015; FR-009 by T003 (no verdict, retry or ends state written; `scope` and
`lane` still read `.specify/test-paths` from the working tree) and T011 (no new `settings.json`
entry).

**No setup or stub tasks**: no dependency is added and no new test file is created. Tests drive the
hook and the installer through their command lines, and the e2e tests through `claude -p`. A missing
hook mode, agent or skill makes those tests fail on an assertion, not on an import or parse error.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: touches only files no other task in the same slice touches, and depends on no unfinished
  task in that slice.
- **[Story]**: US1, US2, US3, US5 from spec.md. Documentation tasks have none.
- Message texts are in [contracts/hook-cli.md](contracts/hook-cli.md); tests match their stable
  parts (paths, counts, limits, command names, `/speckit-team`, the restore commands), not whole
  sentences.

---

## Slice 1: protected paths are denied before the write (US3, P1)

**Goal**: `scope protected` denies `Write`, `Edit`, `MultiEdit` and `NotebookEdit` to protected
paths in the repo and to the installed team outside it.

**Independent test**: `node --test test/hook.test.mjs`; the new cases pass, every existing case
still passes.

- [X] T001 [US3] Tests in `test/hook.test.mjs` for `scope protected` (FR-007 write half, FR-001, FR-010, FR-011, US3-1, US3-4, plan.md decision 4, Edge "within budget but protected", SC-003). Use the file's existing `repo()`, `write()`, `denied()` helpers.
  - Denied, with a reason that names the repo-relative path and `/speckit-team`, and no file created or changed on disk: `.specify/memory/constitution.md`, `.specify/feature.json`, `.specify/test-paths`, `specs/001-demo/spec.md`, `specs/004-new/plan.md`, `.claude/settings.json`, `.claude/agents/x.md`, `.github/workflows/test.yml`, `.github/CODEOWNERS`, `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml`, `Jenkinsfile`, `.pre-commit-config.yaml`. On a case-insensitive file system (detected as the existing `.git/` spelling test does), also `.SPECIFY/memory/constitution.md`.
  - The speckit-agents sources, protected only in the speckit-agents repository (plan.md decision 4, owner-confirmed 2026-10-09; data-model.md `isOwnRepo(rev)`). In a repo whose setup commit has a top-level `package.json` of `{"name":"speckit-agents"}`: `hooks/speckit-team.mjs`, `agents/implementer.md`, `skills/speckit-team/SKILL.md`, `install.mjs` and `package.json` are denied, the reason naming the path and `/speckit-team`, nothing written (for `package.json`, its content on disk unchanged); on a case-insensitive file system also `HOOKS/speckit-team.mjs` and `PACKAGE.JSON`. The same five paths return `null` in each ordinary repo, the `package.json` write included: no `package.json`; `{"name":"my-app"}`; `{not json`; `[]`; `{"name":["speckit-agents"]}`; `{"name":"speckit-agents"}` only in `pkg/package.json`; `{"name":"speckit-agents"}` in the working tree but never committed; and a Spec Kit repo with no commit. In the speckit-agents repo, `hooks/useThing.js`, `agents/notes.txt`, `src/install.mjs` and `pkg/package.json` are still allowed.
  - The name is read from `HEAD`, not the working tree (plan.md decision 4, owner-confirmed 2026-10-09): in the speckit-agents repo, after the test rewrites `package.json` with `fs` to `{"name":"x"}` (uncommitted), a `Write` to `install.mjs` is still denied. No case in this list crashes the hook (constitution II).
  - Allowed (output `null`): `src/main/App.java`, `README.md`, `docs/guide.md`, `test/app.test.js`, `hooks/useThing.js`, `agents/notes.txt`, `skills/x/notes.md`, `src/install.mjs`, `package.json`, `.specifyx/notes.md`, `specsheet/x.md` (an ordinary repo).
  - Outside the repo: a `Write` to `path.join(<checkout root>, 'agents', 'x.md')`, `<checkout root>/hooks/x.mjs`, `<checkout root>/skills/y/SKILL.md`, `<checkout root>/settings.json` and `<checkout root>/settings.local.json` is denied with a reason matching `/installed agent team/` (the hook under test runs from the checkout, so the checkout is its team directory); a `Write` to `path.join(os.tmpdir(), 'elsewhere.txt')` is allowed. Assert nothing is created at those paths.
  - `.git/speckit-team/retries/x.json` is denied with the existing guardrail-state reason.
  - Add `scope protected` to the "every mode is a no-op outside a Spec Kit repo" test (a `.github/workflows/x.yml` write returns `null`), to the `MODES` list used by both malformed-input tests, and to the `file_path` loop of "mistyped fields never crash a hook". These three additions already pass before T002, because the existing `scope` mode handles them for any rule; show them red once by making `scope` throw for rule `protected` before the input checks, then revert.
- [X] T002 [US3] Implement the `protected` rule of the `scope` mode in `hooks/speckit-team.mjs`, per contracts/hook-cli.md "scope protected" and research R4. New names (module scope):
  - `import { fileURLToPath } from 'node:url';`
  - `const PROTECTED: Array<[RegExp, string]>`: the research R4 table, every regex anchored at the start of the repo-relative path and case-insensitive, each paired with the reason the message quotes.
  - `const OWN_SOURCES: Array<[RegExp, string]>`: the research R4 second table (`hooks/speckit-team.mjs`, `agents/*.md`, `skills/*/SKILL.md`, `install.mjs`, and `^package\.json$` at the top level only), same form.
  - `function isOwnRepo(rev: string): boolean`: `true` when the output of `git cat-file blob <rev>:package.json` (run with the existing git helper, never throwing) parses as a JSON object whose `name` is exactly the string `speckit-agents`; a failed command, no commit, a parse failure or any other value is `false`. Memoised per `rev` for the run.
  - `function isProtected(rel: string, rev: string = 'HEAD'): string | null`: the reason of the first matching `PROTECTED` entry, else, when `isOwnRepo(rev)`, of the first matching `OWN_SOURCES` entry, else `null`. `scope protected` calls it with `'HEAD'`.
  - `const TEAM_DIR: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`.
  - `function isTeamFile(abs: string): boolean`: `canonical(abs)` is under `canonical(TEAM_DIR)` + `/agents/`, `/hooks/` or `/skills/`, or equals `canonical(TEAM_DIR)` + `/settings.json` or `/settings.local.json`.
  - In `scope`: for rule `protected`, the `isTeamFile` check goes right after the git-directory guard and before the outside-the-repo exit; the `isProtected` check after `rel` is computed.
  - Add `scope protected` to the mode list in the header comment, with one line saying what it denies.

**Checkpoint**: T001 green; `npm test` green.

---

## Slice 2: the budget stops the run (US2, P1)

**Goal**: the `patch` mode records the run's start on the first tool call and, once the change is
over 30 production lines, 2 production files or holds a binary production file, denies every tool
except `SubagentHandback`. Test files are decided by `.specify/test-paths` as committed at the start
commit.

**Independent test**: `node --test test/hook.test.mjs`.

- [X] T003 [US2] Tests in `test/hook.test.mjs` for `patch` on PreToolUse (FR-005, FR-006 the stop, FR-002 no feature needed, FR-009, FR-010, FR-011, FR-014, US2-1, US2-3, US2-4, US2-5, SC-002, Edge Cases on 30/31 lines, plan.md decision 3 with the owner's rename rule of 2026-10-09, 3 files, renames, deletions, binaries, Edge Case "uncommitted changes at start" and Assumptions "left alone", plan.md decisions 13 and 14 point 3, research R3 and R14). Add a helper `patchTool(dir, tool_name, tool_input = {}, extra = {})` that runs `['patch']` with `hook_event_name: 'PreToolUse'`, `agent_id: 'p1'`, `agent_type: 'patcher'`, and a helper that writes an n-line text file. Every written file contains the marker string `PATCH-CONTENT-7f3a`. Cases:
  - Boundary: first call `Read` records the start; then new `src/a.js` (20 lines) and `src/b.js` (10 lines): a `Bash` call is allowed. One more line in `src/b.js`: the next call is denied, the reason matching `31 changed production lines in 2 files`, `limit 30 lines, 2 files`, `/speckit-team` and `uncommitted`.
  - Boundary, modified lines (a modified line counts 1, max(insertions, deletions) per file): the setup commit adds a 40-line `src/forty.js`; after the first call, 30 of its lines changed in place: a `Bash` call is allowed. A 31st line changed in place: the next call is denied, the reason matching `31 changed production lines in 1 files`.
  - Boundary, mixed: 20 lines of `src/forty.js` changed in place plus a new 10-line `src/b.js`: allowed (30 in 2 files). One more line changed in place in `src/forty.js`: denied, matching `31 changed production lines in 2 files`.
  - Uneven edits: 5 lines of `src/forty.js` replaced by 8 lines counts 8, shown by adding a new 22-line `src/b.js` (allowed, 30) and then one more line in `src/b.js` (denied, 31). In a separate repo, 31 lines deleted from `src/forty.js` are denied (deletions alone count).
  - Three production files of one line each: denied, the reason naming `3 files`.
  - Tests and docs do not count: the setup commit holds a `.specify/test-paths` with the line `^checks/golden/`; then 5 production lines plus 200 lines spread over `test/a.test.js`, `src/test/java/BigTest.java`, `fixtures/data.json`, `README.md`, `docs/guide.mdx`, `notes.rst`, `CHANGES.txt`, `guide.adoc`, and `checks/golden/x.out`: allowed. A 31-line `docs/tool.mjs` is denied (a docs folder is not a doc rule).
  - Test patterns come from the start commit (plan.md decision 14 point 3, spec audit H1): after the first call the test appends the line `^src/` to `.specify/test-paths` with `fs` (as a Bash command would) and writes a new 31-line `src/big.js`: the next `Bash` call is denied, the reason matching `31 changed production lines`. Fails if the patterns are read from the working tree (then 0 lines, allowed). In a separate repo, a `^checks/golden/` line written to `.specify/test-paths` before the first call but never committed: a 31-line `checks/golden/x.out` is denied (counted as production).
  - Binary: an untracked `src/logo.png` holding a NUL byte is denied with the reason matching `binary production files are not allowed: src/logo.png`; a committed binary production file that is then modified is denied; a committed binary production file that is deleted counts as 1 file and is not denied for being binary; a binary `test/fixtures/x.bin` is allowed.
  - Pure rename (0 lines, 1 file): the setup commit adds a 40-line `src/forty.js`; after the first call, `git mv src/forty.js src/moved.js`, a new 29-line `src/b.js` and a new 1-line `src/c.js`: the next call is denied, the reason matching `30 changed production lines in 3 files` (without rename detection it would read 110 lines in 4 files). In a separate repo, the same pure rename plus a new 30-line `src/b.js` is allowed.
  - Rename with edits (edited lines only, 1 file): `git mv src/forty.js src/moved.js`, then 5 of its lines changed in place, plus a new 25-line `src/b.js`: allowed (30 in 2 files). One more line of `src/moved.js` changed in place: the next call is denied, the reason matching `31 changed production lines in 2 files`.
  - Pure rename of a committed binary production file `src/logo.png` (`git mv` to `src/pic.png`): allowed, not reported as binary (git prints `-` for it in `--numstat`; research R3).
  - Rename across classes (owner-confirmed 2026-10-09, research R3): `git mv` of a committed 40-line `test/old.test.js` to `src/old.js` is denied, the reason matching `40 changed production lines in 1 files`.
  - A move git does not pair: the committed 3-line `src/small.js` moved with `fs.renameSync` to `src/tiny.js` (new path untracked) plus a new 1-line `src/c.js`: denied, the reason matching `7 changed production lines in 3 files`.
  - Deletions: deleting a committed 3-line production file counts 3 lines and 1 file; with two more new one-line production files the next call is denied, the reason naming `3 files`.
  - Committed work counts: 31 lines committed by the test with `git commit` before the next call are denied (measured from the start commit, not `HEAD`).
  - Dirty at start, left alone (FR-005, Edge Case): the setup commit adds a 10-line `src/old.js`; before the first call the test appends 50 lines to it and writes an untracked 100-line `src/wip.js`. After the first call, a new 30-line `src/b.js`: a `Bash` call is allowed (30 lines in 1 file; neither dirty file counted). Rewriting `src/wip.js` with `fs` to byte-identical content: still allowed (content, not time, decides).
  - Dirty at start, further edit through `Write`/`Edit` (research R14, contract step 3): with the same two dirty files, a `Write` to `src/wip.js`, an `Edit` to `src/old.js`, a `MultiEdit` to `src/old.js` given as an absolute path, and a `Write` to `src/./wip.js` are each denied, the reason matching the repo-relative path, `uncommitted` and `/speckit-team`; a `Write` to the clean `src/new.js` in the same run is allowed. Also denied when it is the run's first call (the start record is written first).
  - Dirty at start, further edit through Bash: after the first call, one line appended to `src/wip.js` with `fs` (as a Bash command would): the next `Bash` call is denied, the reason matching `src/wip.js`, `uncommitted` and `/speckit-team`, although 0 production lines are counted. In separate repos the same for one line appended to `src/old.js`, for `src/wip.js` deleted, and for a dirty-at-start `.specify/memory/constitution.md` with a line appended (not named as a protected change, named as changed although uncommitted at the start).
  - Dirty at start, swept into a commit: after the first call the test runs `git add src/wip.js` and `git commit -qm x` with the file's bytes unchanged: the next `Bash` call is denied naming `src/wip.js`. The same for `git commit -qam x` sweeping the modified `src/old.js`.
  - These four dirty-at-start cases fail if dirty paths are skipped for the whole run: each would be allowed.
  - `SubagentHandback` is not denied when over budget.
  - Over budget, a `Bash` call `git add -A && git commit -qm x` is denied; afterwards `HEAD` is the start commit and `git status --porcelain` still lists the files (US2-3).
  - No active feature: with `.specify/feature.json` deleted before the first call, the 31-line case is still denied.
  - Fails closed (research R9): a start record replaced by `{not json` is denied, the reason naming `.git/speckit-team/patch/p1.json`; a start record whose `sha` is 40 hex digits of no commit is denied; an invalid line in `.specify/test-paths` committed in the setup commit is denied, the reason naming the line; the same invalid line only in the working tree (written before the first call, never committed) does not deny a 1-line change; a Spec Kit repo with no commit is denied with `no commit`; a start record whose `dirty` is `["src/wip.js"]` (the old array form) or `{"src/wip.js":"x"}` is denied as unusable, the reason naming the record file.
  - Unusable input: no `agent_id` and no `session_id` gives no decision and a `speckit-team: patch got unusable input` message; `agent_id: '../x'` the same. With only `session_id: 's1'`, a start record is kept under that key and the 31-line case is denied.
  - `scope` and `lane` unchanged (FR-009): in a repo whose working-tree `.specify/test-paths` has an uncommitted `^checks/golden/` line, `scope tests` still allows a `Write` to `checks/golden/x.out`.
  - Add `['patch']` to the `MODES` list of both malformed-input tests, to the "an event a mode is not wired for" test, and a `patch` call to "every mode is a no-op outside a Spec Kit repo".
  - After every case: no hook output contains `PATCH-CONTENT-7f3a` (FR-014), and `.git/speckit-team/` holds no `verdicts/`, `retries/` or `ends/` folder (FR-009).
- [X] T004 [US2] Implement the `patch` mode's PreToolUse path in `hooks/speckit-team.mjs`, per contracts/hook-cli.md "patch" steps 1, 2, 3, 5 and 7 (step 4 is T006, step 6 is T008), research R3, R5, R8, R9 and R14, and data-model.md. New names:
  - `const PATCH_LINES = 30;`, `const PATCH_FILES = 2;`
  - `const DOC_PATTERNS: RegExp[] = [/\.(md|mdx|markdown|rst|adoc|asciidoc|txt)$/i];` and `const isDoc = (rel: string): boolean`.
  - `function parseTestPaths(text: string): { patterns: RegExp[], bad: string | null }`: the body of today's `testPaths` IIFE, which now calls it with the working-tree file (no change in `scope` or `lane`).
  - `function testsAt(rev: string): { isTest: (rel: string) => boolean, bad: string | null }`: `parseTestPaths(git(root, 'cat-file', 'blob', `${rev}:.specify/test-paths`) ?? '')`, memoised per `rev`.
  - `const patchFile = (key: string): string` returning `path.join(stateDir, 'patch', `${key}.json`)`.
  - `function repoRel(file: string): string | null`: the repo-relative, forward-slash path of `path.resolve(cwd, file)` with `real()` on both sides, `null` when outside the repo; extracted from the `scope` mode, which now calls it (no change in `scope`'s behaviour).
  - `function stateOf(rel: string): string | null`: SHA-256 hex of the bytes of `path.join(root, rel)` (the existing `createHash`), `null` when it cannot be read (missing, a directory).
  - `function measure(start: { sha: string, dirty: Record<string, string | null> }): { lines: number, files: number, binary: string[], protectedChanged: { path: string, isNew: boolean }[], committed: boolean, dirtyTouched: string[] }`: `git diff --find-renames --numstat -z <sha>` and `git diff --find-renames --name-status -z <sha>` for tracked files (with `-z`, a rename record is `<ins>\t<del>\t\0<old>\0<new>\0` in numstat and `R<score>\0<old>\0<new>\0` in name-status; any other record has one path), `git ls-files --others --exclude-standard -z` for untracked ones (NUL in the first 8000 bytes is binary; text counts its lines); each path classed with `isProtected(rel, start.sha)`, then `testsAt(start.sha).isTest`, doc or production, in that order; a tracked production text file adds `Math.max(insertions, deletions)` to `lines`; a rename follows data-model.md "Renames" (between production paths 1 file and its numstat, `R100` never binary; across classes the production side from `git diff --no-renames --numstat -z <sha> -- <old> <new>`); a path, or a rename with either side, among the keys of `start.dirty` skipped from the counts; `committed` is `git rev-parse HEAD !== sha`; `dirtyTouched` is each key of `start.dirty` whose `stateOf()` differs from its recorded value, plus, when `committed`, each key listed by `git diff --no-renames --name-only -z <sha> HEAD`, sorted and without duplicates. `over` includes `dirtyTouched.length > 0`.
  - `WIRED.patch = ['PreToolUse', 'SubagentStop', 'Stop']`.
  - Mode `patch`, PreToolUse with any `tool_name` but `SubagentHandback`: key, start record (written once, `{ sha, dirty: Object.fromEntries(changedSince('HEAD').map((rel) => [rel, stateOf(rel)])), at }`), validation (data-model.md, the `dirty` shape included), the `testsAt(sha).bad` deny of step 2, the dirty-file write deny of step 3 (for `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, target via `repoRel(tool_input.file_path ?? tool_input.notebook_path)`; a missing or non-string path falls through to measuring), measure, and the deny message of step 7 with its dirty-file part. Leave `SubagentHandback`, `SubagentStop` and `Stop` as exit 0 for now.
  - Header comment: one line for `patch`.

**Checkpoint**: T003 green; `npm test` green.

---

## Slice 3: `patcher` cannot commit, push or open a pull request (US2, P1)

**Goal**: within budget or not, a `patcher` Bash command that names a git subcommand that writes
history or reaches the remote, or the program `gh` or `hub`, is denied before it runs (plan.md
decision 14 point 1, research R15); so is a git command that overwrites or deletes files wholesale:
`git reset --hard`, `git clean`, or a `git checkout`/`git restore` of `.`, a folder, a pattern or a
file uncommitted at the start (plan.md decision 16 point 3, research R7, spec audit finding M5).

**Independent test**: `node --test test/hook.test.mjs`.

- [X] T005 [US2] Tests in `test/hook.test.mjs` for the command deny and the wholesale-restore deny (FR-006 "no commit, no pull request", FR-007, FR-011, FR-014, US2-3, spec Assumptions "Uncommitted changes present at start are left alone", spec audit findings H1 and M5, plan.md decisions 14, 15 and 16, research R7 and R15). Each case starts the run with `patchTool(dir, 'Read')`, then a new 1-line `src/a.js` (within budget), then `patchTool(dir, 'Bash', { command })`. Every case below fails if the step is removed (the call would be allowed):
  - Denied, the reason matching `may not run <name>` and `/speckit-patch`, for each command, with `<name>` in brackets: `git commit -qm x` (`git commit`); `git add -A && git commit -qm x` (`git commit`); `echo x >> .github/workflows/ci.yml && git commit -qam x && git push` (`git commit`); `git push origin HEAD` (`git push`); `git -C . commit -m x`; `git -c user.name=x commit -m x`; `git --git-dir=.git push`; `GIT_DIR=.git git push`; `/usr/bin/git push`; `"C:\Program Files\Git\cmd\git.exe" push`; `sh -c "git push"`; `bash -c 'git commit -m x'`; `git -c alias.x='!git push' x` (`git push`); `git stash`; `git switch -c other`; `git checkout -b other`; `git checkout main`; `git branch -D x`; `git tag v1`; `git merge x`; `git rebase main`; `git cherry-pick abc`; `git revert HEAD`; `git am x.patch`; `git update-ref refs/heads/x HEAD`; `git fetch`; `git pull`; `git remote add o x`; `git reset --soft HEAD~1 && git push` (`git push`); `gh pr create --fill` (`gh`); `gh api repos/x/y` (`gh`); `gh.exe pr create` (`gh`); `hub pull-request` (`hub`).
  - Wholesale restore denied (plan.md decision 16 point 3, spec audit finding M5, research R7). These cases add, before the first call, an untracked dirty-at-start `src/wip.js` and a committed folder `test/` holding one file. Denied, the reason matching `may not run <name>`, `uncommitted` and `ESCALATE`, and afterwards `src/wip.js` byte-identical to its content before the call (the hook ran nothing), with `<name>` in brackets: `git reset --hard` (`git reset --hard`); `git reset --hard <start sha>`; `git reset -q --hard`; `git clean -fd` (`git clean`); `git clean -n`; `git -C . clean -fdx`; `git checkout -- .` (`git checkout -- .`); `git checkout <start sha> -- .`; `git restore .` (`git restore .`); `git restore -- .`; `git restore --staged --worktree .`; `git restore ..`; `git restore src` (a folder); `git restore src/`; `git checkout -- src` (a folder); `git restore 'src/*.js'` (a pattern); `git checkout -- 'src/?.js'`; `git restore ':/'` (pathspec magic); `git restore --pathspec-from-file=list.txt`; `git checkout -- src/wip.js` (dirty at start); `git restore src/wip.js`; `git checkout <start sha> -- src/a.js src/wip.js`; `npm test && git restore .`; `sh -c "git checkout -- ."`. `git stash` and `git stash push -- src/a.js` stay denied by the history list (`may not run git stash`). Every one of these fails the test if it is allowed.
  - Allowed (output `null`): `git status --short`, `git diff`, `git log --oneline -3`, `git show HEAD`, `git mv src/a.js src/b.js`, `git add src/a.js`, `git checkout <start sha> -- src/a.js`, `git checkout -- src/a.js`, `git restore src/a.js`, `git restore --source=<start sha> src/a.js`, `git restore -s <start sha> src/a.js`, `git reset --soft <start sha>`, `git reset -- src/a.js`, `git checkout -- src/a.js && npm test` (`test` after `&&` is not read as a path, although the folder `test/` exists), `npm test`, `node --test`, `grep -rn commit src`, `echo committed`, `ls highlights`, `cat github.txt`, `echo reset --hard`.
  - Non-string `tool_input.command` (an array, a number, missing): no crash, no command deny from either list, the call is allowed within budget (constitution II).
  - A `Write` whose content mentions `git push` is not affected (the step looks at `Bash` only).
  - The deny holds with only `session_id: 's1'` as key.
  - No hook output contains `PATCH-CONTENT-7f3a`.
- [X] T006 [US2] Implement the command deny and the wholesale-restore deny in `hooks/speckit-team.mjs`, per contracts/hook-cli.md "patch" step 4, research R7 and R15, and plan.md decision 16 point 3. New names:
  - `const HISTORY_SUBCOMMANDS: Set<string>`: `commit`, `commit-tree`, `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `stash`, `tag`, `branch`, `switch`, `update-ref`, `symbolic-ref`, `notes`, `replace`, `filter-branch`, `push`, `pull`, `fetch`, `clone`, `remote`, `ls-remote`, `submodule`, `send-email`, `request-pull`.
  - `const GIT_OPTIONS_WITH_VALUE: Set<string>`: `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path`, `--config-env`.
  - `function historyCommand(command: unknown): string | null`: `null` for a non-string; else split into words at whitespace, newlines and each of the characters `;`, `&`, `|`, `(`, `)`, `{`, `}`, `<`, `>`, backtick, `"`, `'`, `$` and `!` (research R15); for each word whose last path segment (after `/` or `\`), lower-cased and without `.exe`, is `git`: skip the following words that start with `-` (and the word after one in `GIT_OPTIONS_WITH_VALUE` given without `=`), take the next word as the subcommand, and return `git <subcommand>` if it is in `HISTORY_SUBCOMMANDS`, or is `checkout` with no `--` word after it in the command; for a word whose last segment is `gh` or `hub` (`.exe` removed), return that name; else `null`.
  - `function gitCalls(command: string): Array<{ sub: string, args: string[] }>`: splits the command into segments at newlines and each of `;`, `&`, `|`, `(`, `)`; each segment into words at whitespace and each of `"`, `'` and backtick; for each `git` word (the same last-segment rule as `historyCommand`), skips git's options as `historyCommand` does and returns the subcommand and the words after it in the same segment.
  - `function treeCommand(command: unknown, start: { dirty: Record<string, string | null> }): string | null` (plan.md decision 16 point 3, data-model.md "Bash commands `patcher` may not run"): `null` for a non-string; else for each call of `gitCalls(command)`: `reset` with a `--hard` word returns `git reset --hard`; `clean` returns `git clean`; `checkout` with a path word after `--`, or `restore` with a path word (after `--` if present, else each word not starting with `-` and not the value word of `-s`/`--source`) or a `--pathspec-from-file` option, where a path word is wholesale when it is `.` or `..`, ends in `/`, names an existing folder (resolved against the input's `cwd`), contains `*`, `?` or `[`, starts with `:`, or `repoRel()` of it is a key of `start.dirty`: returns `git checkout -- <word>` or `git restore <word>`; else `null`.
  - Step 4 in the PreToolUse path, after step 3 and before measuring: `historyCommand` first, then `treeCommand` with its own message (contracts/hook-cli.md step 4).
  - Header comment: the `patch` line mentions the command deny and the wholesale-restore deny.

**Checkpoint**: T005 green; `npm test` green.

---

## Slice 4: the end-of-run check and the accepted record (US3, P1, with US2's end message)

**Goal**: finishing is blocked while a protected file changed by any means is not restored, or while
anything is committed since the start; otherwise the run ends with its size or the escalation
message, and only a within-budget end leaves the accepted record `/speckit-patch` commits from. A
restore command naming only protected files still to be restored is allowed while over budget
(plan.md decision 16 point 3).

**Independent test**: `node --test test/hook.test.mjs`.

- [X] T007 [US3] Tests in `test/hook.test.mjs` for the `patch` end check, the accepted record and the restore allowance (FR-002, FR-006, FR-007 end-of-run half, FR-014, US1-1, US1-3, US2-1, US2-2, US3-2, US3-3, Edge "protected changed through a shell command", Edge "uncommitted changes at start", spec audit findings H1 and M5, plan.md decisions 4, 13, 14, 15 and 16, research R6, R7 and R15). The setup commit adds `.github/workflows/ci.yml`. Each case starts the run with a `patchTool(dir, 'Read')` call; "stop" means `['patch']` with `hook_event_name: 'SubagentStop'`, `agent_id: 'p1'`, `agent_type: 'patcher'`; "handback" means PreToolUse `SubagentHandback` with `tool_input.message: 'Fixed.\nDONE'`; "the record" means `.git/speckit-team/patch-accepted.json`.
  - A line appended to `.specify/memory/constitution.md` with `fs`: stop is blocked, the reason matching `.specify/memory/constitution.md` and `git checkout <12 hex> -- .specify/memory/constitution.md`; stop with `stop_hook_active: true` is still blocked; handback is denied with the same reason; no record exists; after the test runs `git checkout <start sha> -- .specify/memory/constitution.md`, stop gives no block.
  - A new `.github/workflows/new.yml`: the reason says to delete it. A deleted `.github/workflows/ci.yml`: the reason gives its `git checkout` command.
  - The hook changes nothing in the repo: after a blocked stop the appended line is still in the file, `HEAD` is the start commit and `git status --porcelain` is unchanged.
  - Dirty at start: `.specify/memory/constitution.md` modified before the first call is not named, not blocked on, and its content is unchanged after stop (US3-3).
  - Dirty at start, changed through Bash (research R14): an untracked 100-line `src/wip.js` written before the first call, one line appended to it with `fs` after: stop and handback give no block or deny and a `systemMessage` matching `src/wip.js`, `uncommitted` and `/speckit-team` (message A), with no `git checkout` command for it; no record; `src/wip.js` still holds the appended line afterwards (the hook restores nothing).
  - Dirty at start, swept into a commit: the same `src/wip.js` unchanged, plus a new 3-line `src/a.js`, both committed by the test with `git add -A` and `git commit -qm x` after the first call: stop is blocked with `git reset --soft <12 hex>`, also with `stop_hook_active: true`, and handback is denied; after the test runs `git reset --soft <start sha>`, stop gives no block and a `systemMessage` matching `3 of 30 production lines, 1 of 2 production files`, the record's `files` is `["src/a.js"]` (not `src/wip.js`), and `src/wip.js` is byte-identical to its content before the run.
  - Committed within budget, the H1 route (plan.md decision 14): after the first call the test appends a line to `.github/workflows/ci.yml` with `fs`, runs `git commit -qam ci` (as a program the command deny does not see would), then `git checkout <start sha> -- .github/workflows/ci.yml`, so the working tree matches the start again: stop is blocked with `git reset --soft <12 hex>`, also with `stop_hook_active: true`; handback is denied; no record. Fails if the commit check is limited to over-budget runs, as in the previous plan (then: no block, and a record). After the test runs `git reset --soft <start sha>`, stop gives no block and the record's `files` does not contain `.github/workflows/ci.yml`.
  - Committed within budget, plain: a new 3-line `src/a.js` committed by the test: stop is blocked with `git reset --soft <12 hex>`; no record.
  - Test patterns edited during the run: after the first call the test appends `^src/` to `.specify/test-paths` with `fs` and writes a new 3-line `src/a.js`: stop is blocked naming `.specify/test-paths` with its `git checkout <12 hex> --` command; no record.
  - Over budget, uncommitted (31 lines): stop and handback give no block or deny, and a `systemMessage` matching `31 changed production lines`, `limit 30 lines, 2 files`, `uncommitted` and `/speckit-team`; no record.
  - Over budget and committed: stop is blocked with `git reset --soft <12 hex>`, also with `stop_hook_active: true`; after the test runs `git reset --soft <start sha>`, stop gives the over-budget `systemMessage`, no block and no record.
  - Within budget, the record (FR-002, US1-1): with `src/wip.js` dirty at the start, after the first call a new 3-line `src/a.js`, a new `test/a.test.js`, a new `docs/a.md` and `git mv src/main/App.java src/main/Main.java`: stop gives no block and a `systemMessage` matching `3 of 30 production lines, 2 of 2 production files`; the record parses as `{ key: 'p1', sha: <start sha>, files: ['docs/a.md', 'src/a.js', 'src/main/App.java', 'src/main/Main.java', 'test/a.test.js'], untracked: ['docs/a.md', 'src/a.js', 'test/a.test.js'], lines: 3, filesTouched: 2 }` plus an `at` string. Handback in the same state gives the same record.
  - The record is removed by every `patch` call (research R15); each of these fails if the removal step is removed: after an accepted stop, a `patchTool(dir, 'Read')` call leaves no record; a record the test writes itself before a blocked stop (constitution changed) is gone after it; a record the test writes before an over-budget stop is gone after it; a record the test writes before a stop whose key has no start record (`agent_id: 'other'`) is gone after it; a start record replaced by `{not json`: stop gives a `systemMessage` matching `fast-track check could not run`, no block, and no record.
  - Restore allowance (research R7, narrowed by the owner on 2026-10-10, plan.md decision 16 point 3, spec audit finding M5). Setup: an untracked dirty-at-start `src/wip.js` before the first call; after it, a 31-line `src/a.js` (over budget), a line appended to `.specify/memory/constitution.md` and a new `.github/workflows/new.yml`, nothing committed. Allowed: `git checkout <sha> -- .specify/memory/constitution.md`, `git restore .specify/memory/constitution.md`, `git restore --source=<sha> .specify/memory/constitution.md` and `rm .github/workflows/new.yml`, `rm -f -- .github/workflows/new.yml`. Denied, each failing the test if allowed: `git checkout <sha> -- .specify/memory/constitution.md src/a.js` (a path not to be restored); `git restore .specify` (a folder); `git checkout <sha> -- '.specify/*'` (a pattern); `git checkout <sha> -- src/wip.js` and `rm src/wip.js` (dirty at start); `rm src/a.js`; `rm -rf .github`; `rm .specify/memory/constitution.md` (not a new file); `git reset --soft <sha>` (nothing committed); `git reset --hard <sha>`; `git restore .`; `git checkout <sha> -- x && git commit -qm y`; `rm a; rm b`; `git checkout $(echo x)`; and a `Write`. After the denied calls `src/wip.js`, `src/a.js` and the appended constitution line are unchanged. In a second repo, over budget and committed (31 lines committed by the test): `git reset --soft <sha>` is allowed. Over budget with nothing to restore and nothing committed, `git checkout <sha> -- src/a.js` is denied.
  - No start record for the key: stop exits with no output.
  - The speckit-agents sources, both sides (plan.md decision 4): in a repo whose setup commit has a top-level `package.json` of `{"name":"speckit-agents"}` and a committed `install.mjs`, a line appended to `install.mjs` with `fs` blocks stop, the reason matching `install.mjs` and `git checkout <12 hex> -- install.mjs`. In an ordinary repo (setup commit with `{"name":"my-app"}` and the same `install.mjs`), the same append gives no block and a `systemMessage` matching `1 of 30 production lines, 1 of 2 production files`.
  - `package.json`, both sides (owner-confirmed 2026-10-09): in the speckit-agents repo, the test rewrites `package.json` with `fs` to `{"name":"x"}` and appends a line to `install.mjs`; stop is blocked, the reason naming both `package.json` and `install.mjs` with a `git checkout <12 hex> --` command each (the name is read from the start commit, so editing it does not lift the protection); the same after the test also commits both changes with `git commit -qam x`. In the ordinary repo, appending a line to `package.json` with `fs` gives no block and a `systemMessage` matching `1 of 30 production lines, 1 of 2 production files`.
  - No hook output in these cases contains `PATCH-CONTENT-7f3a`, and no record contains it.
- [X] T008 [US3] Implement the end check, the accepted record and the restore allowance in `hooks/speckit-team.mjs`, per contracts/hook-cli.md "End of run", "Accepted record" and step 6, research R6, R7, R14 and R15. New names:
  - `const acceptedFile: string`: `path.join(git(root, 'rev-parse', '--absolute-git-dir'), 'speckit-team', 'patch-accepted.json')`, computed only in mode `patch`.
  - At the top of mode `patch`, on every event: `fs.rmSync(acceptedFile, { force: true })`.
  - `measure()` also returns `changed: string[]` (every changed path of any class except protected, both sides of a rename, not a key of `start.dirty`, sorted) and `untracked: string[]` (the members of `changed` from `git ls-files --others --exclude-standard`).
  - `function restoreAllowed(command: unknown, start: { sha: string, dirty: Record<string, string | null> }, m: ReturnType<typeof measure>): boolean` (contracts/hook-cli.md step 6, data-model.md): true only for a string whose whole text is one `git checkout …`, `git restore …`, `git reset --soft …` or `rm …` command containing none of `;`, `&`, `|`, backtick, `$`, `>`, `<` or a newline, and whose every path word, resolved with `repoRel()`, is a `m.protectedChanged` entry with `isNew: false` (for `git checkout`/`git restore`, paths after `--`, or for `restore` the words not starting with `-` and not the value of `-s`/`--source`) or with `isNew: true` (for `rm`, after an optional `-f` and `--`; any other option is false); `git reset --soft <rev>` only when `m.committed` and no further word.
  - `function endCheck(start: { sha: string, dirty: Record<string, string | null> }, viaHandback: boolean): void` (exits): the four outcomes in the contract's order (the team row is added by T010), protected repo files, then a commit at any size, message A with its dirty-file part, message B; on the within-budget outcome `writeJson(acceptedFile, { key, sha, files: m.changed, untracked: m.untracked, lines: m.lines, filesTouched: m.files, at })` as the last step before exiting; deny on the handback path, block on SubagentStop and Stop, regardless of `stop_hook_active`.
  - Route `SubagentHandback` (PreToolUse), `SubagentStop` and `Stop` of mode `patch` to `endCheck`; add step 6 (`restoreAllowed`) to the PreToolUse path; the budget message's restore part (step 7) when step 6's condition holds.
  - Header comment: the `patch` line covers the end check and the accepted record.

**Checkpoint**: T007 green; `npm test` green.

---

## Slice 5: the installed team is hashed at the start and checked at the end (US3, P1)

**Goal**: a change to any installed team file (agents, hook, skills, the config directory's settings
files) by any means during the run ends the run `FAILED` with no accepted record and never blocks;
protected repo files keep blocking (plan.md decision 14 point 4, decision 15 point 5 and decision
16 point 2, research R16, spec audit findings H2 and M2).

**Independent test**: `node --test test/hook.test.mjs`.

- [X] T009 [US3] Tests in `test/hook.test.mjs` for the team check (FR-007 end-of-run half for the installed team, FR-011, FR-014, US3-2, SC-003, spec audit findings H2 and M2, plan.md decision 16 point 2, research R16). Give `run()` a fourth parameter `hook = HOOK`, and add a helper `teamCopy()` that makes a temporary config dir `<tmp>/cfg` holding `hooks/speckit-team.mjs` (copied from the checkout), `agents/patcher.md`, `agents/implementer.md`, `skills/speckit-patch/SKILL.md` and `settings.json` (`{}`), and returns the copied hook's path; the cases run that copy, so its team directory is `<tmp>/cfg`. Each case starts with `patchTool` `Read` through the copy and adds a new 1-line `src/a.js` (within budget). Every team file ends the run `FAILED` and never blocks (plan.md decision 15 point 5 and decision 16 point 2, owner decisions of 2026-10-10; contracts/hook-cli.md message C):
  - Each of these, done with `fs` after the first call (as a Bash command would), in its own repo and config dir: a line containing `PATCH-CONTENT-7f3a` appended to `agents/patcher.md`; a new `skills/evil/SKILL.md`; `agents/implementer.md` deleted; a comment line appended to the copied `hooks/speckit-team.mjs` (the hook that runs is the changed one, which still detects it); `settings.json` rewritten to `{"x":1}`; `settings.local.json` created. For each: stop gives no `decision: "block"`, also with `stop_hook_active: true`; handback with `Fixed.\nDONE` is not denied (also with `Over budget.\nESCALATE`, so the run can always finish); each of the three gives a `systemMessage` matching the `TEAM_DIR`-relative path, `installed agent team`, `FAILED` and `commits nothing`, with no `git checkout` command for it; and after each, the record does not exist. Each case fails if the team change blocks (as it did with agent, hook and skill files in outcome 1 before finding M2) and fails if the record is written (as it would with the team check removed).
  - After the test puts the original bytes back (or removes the created file), stop gives no block and the record is written, so the cases above cannot pass on a run that never accepts. Run for `agents/patcher.md` and `settings.json`.
  - Two team files: `settings.json` rewritten and a line appended to `agents/patcher.md`: stop gives no block, message C naming both paths, and no record.
  - Team file plus a protected repo file: a line appended to `agents/patcher.md` and to `.specify/memory/constitution.md`: stop is blocked naming `.specify/memory/constitution.md` with its `git checkout <12 hex> --` command (protected repo files keep blocking), the reason not naming `agents/patcher.md`, and no record; after the test runs `git checkout <start sha> -- .specify/memory/constitution.md`, stop gives no block, message C naming `agents/patcher.md`, and no record.
  - Outside the hashed set (research R16, pinned so a change of the set is a visible decision): a change to `<tmp>/cfg/projects/x.jsonl` and a new `<tmp>/cfg/skills/x/sub/deep.md` give no block.
  - Over budget (31 lines) with `agents/patcher.md` changed: a `Bash` `git checkout <sha> -- src/a.js` is denied (a team change opens no restore allowance, research R7).
  - A config dir with no `skills/` folder and no `settings.json` (both removed before the first call): the start record is written and stop accepts.
  - A start record whose `team` is `[]` or `{"agents/x.md":"zz"}`: the next PreToolUse is denied as unusable, the reason naming the record file; stop gives `fast-track check could not run` and no record.
  - No hook output contains `PATCH-CONTENT-7f3a`.
- [X] T010 [US3] Implement the team check in `hooks/speckit-team.mjs`, per contracts/hook-cli.md "End of run" (the team row and message C), research R16 and plan.md decision 16 point 2. New names:
  - `function teamState(): Record<string, string | null>`: the SHA-256 of each regular file directly in `TEAM_DIR/agents/`, directly in `TEAM_DIR/hooks/` and directly in each `TEAM_DIR/skills/<name>/`, keyed by its `TEAM_DIR`-relative forward-slash path, plus `settings.json` and `settings.local.json` always present (`null` when missing); `fs.readdirSync(dir, { withFileTypes: true })` without `recursive`; a folder that cannot be listed contributes nothing; never throws.
  - `function teamChanged(before: Record<string, string | null>): string[]`: the sorted paths present in `before` or `teamState()` whose values differ (a path on one side only differs).
  - The start record gains `team: teamState()`; validation requires `team` to be a plain object of 64-hex-or-`null` values.
  - In `endCheck`, after the commit outcome and before the over-budget outcome: if `teamChanged(start.team)` is not empty, allow (on the handback path whatever the report's last word; on SubagentStop and Stop never block) with `systemMessage` C of the contract naming each path under `TEAM_DIR`, and exit without writing the accepted record. The protected-files outcome stays repo paths only.
  - Header comment: the `patch` line mentions the team check.

**Checkpoint**: T009 green; `npm test` green.

---

## Slice 6: the fast track, installed and wired (US1, P1) 🎯 MVP

**Goal**: `/speckit-patch` and the `patcher` agent are installed and uninstalled with the team;
Claude Code fires `patcher`'s three hooks; the skill commits only after an accepted end.

**Independent test**: `node --test test/install.test.mjs test/board-mod.test.mjs test/e2e.test.mjs`
(e2e needs `claude` on PATH; skipped, not passed, without it).

- [X] T011 [P] [US1] Tests in `test/install.test.mjs` (FR-001, FR-002, FR-003, FR-004, FR-006, FR-009, FR-012, US4-3, constitution II quoted path, Installation constraints, spec Edge Case "not swept into its commit", spec audit findings H1 and M5, plan.md decisions 14 and 16):
  - Add `'patcher'` to the file's `AGENTS` constant, so the existing install, marker, `{{HOOK}}` and uninstall loops cover it.
  - In "install lays down agents, skill, hook and both settings gates": installed `agents/patcher.md` contains `node "<hookPath>" patch`, `node "<hookPath>" scope protected` and `node "<hookPath>" ends DONE FAILED ESCALATE`; `skills/speckit-patch/SKILL.md` exists with the marker, `name: speckit-patch` and `disable-model-invocation: true`, and no `{{HOOK}}` is left in it; `gates(s)` is still exactly the two existing entries.
  - Installed `agents/patcher.md` states the fast track's prose rules, each matched case-insensitively: the words `DONE`, `FAILED` and `ESCALATE`; `regression test`; `passed, failed, skipped or not run`; files listed by `git status` at the start named as not to be edited (matched as `not yours`); `git mv` (how to move a file); `never commit`, `never push` and `gh` named as not to be run; `git reset --hard` and `git clean` named as not to be run, and a file restored only by naming it (plan.md decision 16 point 3); `never merge`; `/speckit-team` with `never start`. It does not contain `gh pr create` or `git switch -c` (the skill does those now).
  - Installed `skills/speckit-patch/SKILL.md` states the commit-after-the-check steps (research R15): `git switch -c patch/`; `git hash-object -- "<hookPath>"` with the installed path; `patch-accepted.json`; `git add --` and `git commit -m` with `--` before the paths; `git add -A` named as not to be used; `git push -u origin`; `--force` named as not to be used; `gh pr create`; `DONE` with `passed`; `commit nothing and report the run as FAILED` (a failed check, the missing accepted record included, plan.md decision 15 point 5); the empty-record rule (spec audit finding H1, plan.md decision 16 point 1): the text matches `files` with `is empty` and `commit nothing, push nothing and open no pull request`, and that sentence comes before the first `git commit -m` in the file (so the check precedes the command); `never merge`; `never start` `/speckit-team`. The empty-record assertion fails on a skill without the rule, as the one planned before this revision.
  - "a second install changes nothing" and "install then uninstall into an empty config dir leaves it empty" hold with the new files (assert `skills/speckit-patch` exists after the install in the first).
  - "--uninstall removes only what it installed": also `skills/speckit-patch` is gone.
  - "refuses to replace agents it did not install, unless --force": a user's own `agents/patcher.md` is refused and left unchanged without `--force`.
  - "--help lists every flag": the help text also names `/speckit-patch`; a real install's stdout names `/speckit-patch` in its final "Next" lines.
- [X] T012 [P] [US1] Test in `test/board-mod.test.mjs`: in "the board mod draws each role in the color of its agent file", expect 7 agent files instead of 6 (CLAUDE.md Rules, the `ROLE_COLOR` twin). Red until T014 adds `agents/patcher.md` and its color.
- [X] T013 [P] [US1] Tests in `test/e2e.test.mjs` (FR-005, FR-006, FR-007, SC-003, SC-004, US2-1, US2-3, US3-1, US3-2, plan.md decision 14), scripted model, `agent('patcher', 'e2e patcher')`; "the record" means `.git/speckit-team/patch-accepted.json` in the scratch repo:
  - In `setup()`: when `process.env.SPECKIT_E2E_NO_HOOK === '1'`, overwrite the installed hook with `process.exit(0);\n` after installing (used by T024 for SC-004; off by default).
  - "patcher's scope hook denies a protected Write and allows a production one": `Write` `.specify/memory/constitution.md`, then `Write` `src/fix.js` (one line), then `say('Fixed.\nDONE')`. The first result is an error matching `patcher may not write .specify/memory/constitution.md: it is a protected path`; the constitution is unchanged; `src/fix.js` exists; the record exists with `files` `["src/fix.js"]` (the end check ran under `claude -p` and accepted the run).
  - "patcher may not commit; the end check still accepts its work": `Write` `src/fix.js` (one line), `Bash` `git add -A && git commit -qm fix`, `say('Fixed.\nDONE')`. The Bash result matches `may not run git commit`; `HEAD` is the setup commit; the record lists `src/fix.js`.
  - "over budget, patcher's next tool call is denied and nothing is accepted": `Write` `src/big.js` (31 lines), `Bash` `git status --short`, `say('Over budget.\nESCALATE')`. The Bash result matches `Fast-track budget exceeded: 31 changed production lines in 1 files`; `HEAD` is the setup commit; `src/big.js` is still untracked; no record.
  - "a protected file changed through Bash blocks patcher's stop until it is restored": `Bash` `echo x >> .specify/memory/constitution.md`, `say('Done.\nDONE')`, `Bash` `git checkout <setup sha> -- .specify/memory/constitution.md`, `say('Restored.\nDONE')`. The third request shows `Fast track: patcher changed protected files: .specify/memory/constitution.md`; afterwards the file equals its committed content, and the record's `files` does not contain it.
  - "patcher's report must end in DONE, FAILED or ESCALATE" (`permissionMode: 'auto'`): `SubagentHandback` `placeholder`, then `Fixed.\nDONE`. The first result is an error matching `exactly one of: DONE, FAILED, ESCALATE`.
- [X] T014 [US1] Implement the fast track's files (FR-001 to FR-004, FR-006, FR-012, FR-014), per contracts/commands-and-files.md:
  - New `agents/patcher.md`: the frontmatter in the contract verbatim (`name: patcher`, `tools: Read, Write, Edit, Bash`, `model: sonnet`, `color: cyan`, the three hook entries), the marker comment line, and a body of Inputs, Process, Lane and Report carrying every rule the contract lists, in the style of `agents/implementer.md` (no em-dashes).
  - New `skills/speckit-patch/SKILL.md`: frontmatter `name: speckit-patch`, a one-line `description`, `argument-hint: "<small change>"`, `disable-model-invocation: true`, the marker line; body with the six steps of the contract, including the foreground-launch check copied from `skills/speckit-team/SKILL.md` step 0, `{{HOOK}}` for the hook path, the exact commands of step 4, and step 4's empty-record rule (when the accepted record's `files` is empty: commit nothing, push nothing and open no pull request, and report that `patcher` changed no file; plan.md decision 16 point 1) stated before the `git commit -m` command.
  - `install.mjs`: `'patcher'` appended to `AGENTS`; `{ src: 'skills/speckit-patch/SKILL.md', dst: <claudeDir>/skills/speckit-patch/SKILL.md }` in `files()`; a help line in the header comment naming `/speckit-patch` (the fast track for small changes); a line in the final "Done. Next:" message: `A small change: /speckit-patch <change>`.
  - `mods/speckit-board/hooks/model.ts`: `patcher: 'cyan'` in `ROLE_COLOR`; `TEAM` unchanged.

**Checkpoint**: T011 to T013 green; `npm test` green.

---

## Slice 7: advisory triage (US5, P3)

**Goal**: `/speckit-triage <request>` suggests a track with a reason and runs nothing.

**Independent test**: `node --test test/install.test.mjs`.

- [X] T015 [US5] Tests in `test/install.test.mjs` (FR-013, US5-1, US5-2, FR-012): installed `skills/speckit-triage/SKILL.md` exists with the marker, `name: speckit-triage` and `disable-model-invocation: true`; it names both `/speckit-patch` and `/speckit-team`; it states that it launches no agent and invokes no skill (match `launches no agent` and `invokes no skill`, case-insensitive); it names the four signals for `/speckit-team` (`public contract`, `protected path`, `30`, `2`); `--uninstall` removes `skills/speckit-triage`; `--help` names `/speckit-triage`.
- [ ] T016 [US5] Implement `skills/speckit-triage/SKILL.md` per contracts/commands-and-files.md "/speckit-triage" (frontmatter `name: speckit-triage`, `argument-hint: "<request>"`, `disable-model-invocation: true`, the marker line; body: the signals, one suggestion with a one-line reason and the exact command to type, and that it launches no agent and invokes no skill). In `install.mjs`: add it to `files()`, a help line naming `/speckit-triage`, and `Not sure which track: /speckit-triage <request>` in the final message.

**Checkpoint**: T015 green; `npm test` green.

---

## Documentation slices (constitution VIII, FR-012, SC-005; owner requirement)

These change no behaviour, so they have no test tasks. Each one runs the prose rules on what it
writes: no em-dashes, no curly quotes, en-dash only in numeric ranges, numbers over adjectives. Every
place to fix is listed in plan.md "Documentation plan"; each task names its rows. Count the agent
bodies and descriptions with a command, not by eye.

- [ ] T017 Update the user-facing parts of `README.md` (plan.md "Documentation plan" rows for T017): the nav line and intro (seven agents, the fast track beside the pipeline); a Highlights bullet for the fast track (budget 30 production lines and 2 files, protected paths, one agent stage, the commit made only after the end check accepts the run, link to "The fast track"); Contents; "What gets installed" (`agents/{...,patcher}.md`, the seven subagents, `skills/speckit-patch/SKILL.md`, `skills/speckit-triage/SKILL.md`; `settings.json` still two entries); "Installer options" (one sentence: no flag, the fast track is always installed); Quick start: a "#### 3. A small change: the fast track" with `/speckit-patch` and `/speckit-triage` examples, the three report words, and who commits (the main session, after `DONE` and the accepted end); "The team": a `patcher` row (phase: fast track; may write: the working tree except protected paths, within the budget, never a commit; hands over: a report the skill commits from, or `ESCALATE`/`FAILED`; model sonnet), and the "26 to 43 lines" and "These six total about 1,700 characters, roughly 420 tokens" figures recounted for seven (`wc -l` on the bodies, character count of the `description:` lines); the SVG alt text; Troubleshooting entries for "Fast-track budget exceeded", "may not write ... it is a protected path", "Fast track: patcher changed protected files" (repo files only; restore each by naming it), "fast track FAILED: installed agent team files changed during the run" (an agent, hook, skill or settings file in the config directory changed; nothing was committed; reinstall the team if an agent, hook or skill file changed, then run the change again; plan.md decision 16 point 2), "may not run git commit", "may not run git reset --hard" (and `git clean`, a `git checkout`/`git restore` of `.`, a folder, a pattern or a file uncommitted at the start; plan.md decision 16 point 3) and "Fast track: patcher committed" (what each means, what to do); in the Quick start, that a run in which `patcher` changed no file commits nothing and opens no PR (plan.md decision 16 point 1); "Install fails" (seven names); Uninstall (seven agents, three skills); Repository layout (seven definitions, the hook's modes including `patch`, the skills row with all three, "features 001, 002 and 003").
- [ ] T018 Update the "How it works" parts of `README.md`: the intro (two commands, the skill decides and the hooks decide); a new "### The fast track" section after "### The pipeline skill": what one run does (the skill branches, `patcher` changes the working tree and runs the tests, the hook checks the end, the skill commits `patcher`'s files from the accepted record, pushes and opens the PR; plan.md decision 14), the budget and how it is measured (per production file the larger of its insertions and deletions from the start commit, so a modified line counts once and 30 modified lines fit; untracked files by line count; files already uncommitted at the start left out while unchanged, a `Write` or `Edit` to one denied, and a change or commit of one by other means stopping the run (plan.md decision 13); a rename between production files as 1 file and only its edited lines, so a pure rename is 0 lines, a test or doc moved into production code counted as a new production file, and a move git does not pair, such as plain `mv`, as a deletion plus a new file, which is why the agent moves files with `git mv`), the path classes and the exact test and doc rules (data-model.md "Path class"; `.specify/test-paths` as committed at the start commit, so commit a change to it before a run), the protected table (research R4), the speckit-agents sources and `package.json` itself protected only in a repo whose top-level `package.json`, as committed, is named `speckit-agents`, the installed-team rule (writes denied; every other change caught at the end by the hashes taken at the start and ending the run `FAILED`, research R16, plan.md decision 16 point 2), the command deny (research R15) and the wholesale-restore deny (research R7), the PreToolUse stop and the restore allowance (only commands naming protected files still to be restored), the end check's outcomes (contracts/hook-cli.md "End of run", the team row included: the run ends `FAILED` with no accepted record, so nothing is committed) and the accepted record (an empty `files` commits nothing), why the protected check blocks every time for repo files only, what is prompt text rather than hook (research R10), and one line each on what was verified live, by unit and e2e test only, and not at all (filled from T022's results if they exist, else written as "not yet run live"); the Guardrails table rows for `scope protected` (patcher, PreToolUse `Write|Edit|MultiEdit|NotebookEdit`), `patch` (patcher, PreToolUse every tool, and Stop) and `ends DONE FAILED ESCALATE`, plus "every `scope` rule" now covering five writing agents; State (`patch/` per run and `patch-accepted.json` per worktree, both safe to delete; never written: `verdicts/`, `retries/`, `ends/`); Customising (`PATCH_LINES`, `PATCH_FILES`, `PROTECTED`, `HISTORY_SUBCOMMANDS` in `hooks/speckit-team.mjs`; `.specify/test-paths`, as committed, also decides what the budget counts); Known limits, from research R15 "What remains" and R16 "Limits", introduced by the threat model in one sentence (the fast track guards against an agent's mistakes and drift, not deliberate evasion through the shell such as aliases or scripts; spec.md): a commit, push or PR made by a program whose command does not name it (a git alias, `npm version`, a script, `curl`) is not denied before it runs, a commit is still caught at the end and the skill never force-pushes, so a stray push makes the skill's push fail and the developer deletes the stray branch or PR; the deny matches words, so a command that only mentions `git push` or `gh` is denied too; guardrail state under the git directory is protected from `Write` and `Edit`, not Bash, and a change hidden that way stays uncommitted; one run per worktree at a time; installed team files deeper than one folder level are not hashed, and any change to a hashed team file during a run, including one Claude Code or the developer makes to the config directory's `settings.json` or `settings.local.json`, ends it `FAILED` with nothing committed; a Bash write anywhere else outside the repo is not caught; each tool call hashes every file uncommitted at the start; in the speckit-agents repository the fast track cannot change `package.json` (a version bump or a new script goes through `/speckit-team`); a file moved with plain `mv` counts as two files; each run has its own budget, so repeated runs on one branch are not summed; FR-002 to FR-004 are prompt rules; a generated file git does not ignore counts as production.
- [ ] T019 [P] Update `CLAUDE.md` outside the SPECKIT block: Layout (`agents/*.md` includes `patcher`; the hook's modes `scope`, `gate`, `verdict`, `result`, `ends`, `lane`, `patch`; `skills/speckit-patch/SKILL.md` and `skills/speckit-triage/SKILL.md` beside `skills/speckit-team/SKILL.md`); Rules: a new rule that `OWN_SOURCES` in `hooks/speckit-team.mjs` lists the team's own source paths, protected by the fast track only in this repository (recognised by the `name` in the committed top-level `package.json`, which is itself in `OWN_SOURCES`, so the fast track cannot change `package.json` here), so a new guardrail file of the team gets an entry there and a case in `test/hook.test.mjs`; a new rule that the accepted record's fields are read by `skills/speckit-patch/SKILL.md`, so a change to either changes both and `test/install.test.mjs`; the `ROLE_COLOR` rule now covers seven agent files.
- [ ] T020 [P] Redraw `docs/media/architecture-visualized.svg` by hand: the COMMANDS layer gains `/speckit-patch <change>` (one agent, budget 30 lines / 2 files, protected paths, commits after the end check) and `/speckit-triage` (suggests a track, runs nothing); the AGENTS layer gains `patcher` (Sonnet; lane: the working tree but protected paths, within the budget, no commit; hands back DONE, FAILED or ESCALATE); grow the `viewBox` as needed and keep the existing style. Check it renders (open it in a browser or convert it with any available tool) and that its text has no em-dash.
- [ ] T021 Re-record `docs/media/agents-list.gif`: run `node docs/media/record.mjs agents-list` (needs `vhs`, `specify`, a logged-in `claude` and git on PATH; README "Recording the demo media"), read the frames in `agents-list.txt` to see which of the seven team agents the 15-entry list shows, then update the comment at the top of `docs/media/agents-list.tape` and the paragraph under "The team in the `@` typeahead" in `README.md` to what the frames show. If `vhs` or a logged-in `claude` is not available, report this task as one only the user can do, and change nothing.
- [ ] T022 Live checks L1 to L8 of `specs/003-fast-track-patch/quickstart.md` in a scratch Spec Kit repo with the team freshly installed (constitution II, SC-005). These make real model calls on the user's account. Record in `README.md`: a dated "Live results" entry with the Claude Code version, what each check showed and its cost; anything not exercised moved into the "Not yet exercised live" note; under "Live check" the fast-track commands; under "Context budget" a row or short table for the L1 run measured with `node tools/usage.mjs <transcript>` (main session requests, peak and input; agents launched and their input; cost), next to the four `/speckit-team` runs. A check that could not run is written as not run, with the reason. If `claude -p` cannot run from this session, report the task as one only the user can do.
- [ ] T023 Update every test count: run `npm test` once (exit status checked directly, not through a pipe) and copy its numbers into `README.md` "Test suite" (`npm test` runs N tests; per-suite counts for `hook.test.mjs`, `install.test.mjs`, `board-mod.test.mjs`, `e2e.test.mjs`), the "End-to-end tests" paragraph (the scripted tests now fire every hook entry including `patcher`'s three; "The 11 tests" and "all 11" recounted; the `SPECKIT_E2E_NO_HOOK=1` switch described), and `CLAUDE.md` "Verify" (test count, run time and date, the e2e count).
- [ ] T024 Write `specs/003-fast-track-patch/evidence.md`, which the PR body quotes (constitution I and II): for each slice, check out the commit before its implementation commit in a temporary `git worktree`, run the slice's test file there, and paste the failing summary lines; run `SPECKIT_E2E_NO_HOOK=1 node --test test/e2e.test.mjs` and list each new `patcher` case as failed (SC-004), pasting the summary; copy T022's live results, or state that they were not run and why. Remove the temporary worktrees afterwards.

---

## Dependencies and order

```text
Slice 1 (T001 → T002)
  → Slice 2 (T003 → T004)          needs scope protected's PROTECTED table for path classes
    → Slice 3 (T005 → T006)        needs the patch mode's PreToolUse path and start record
      → Slice 4 (T007 → T008)      needs measure() and the start record
        → Slice 5 (T009 → T010)    needs endCheck() and the accepted record
          → Slice 6 (T011, T012, T013 [P] → T014)   the agent is installed only once its hooks exist
            → Slice 7 (T015 → T016)
              → T017 → T018 → T021 → T022 → T023 → T024   (all edit README.md, in this order)
                 T019 [P], T020 [P] at any point after T016
```

- T023 runs after the last test is added (T015) and after T022, so the counts are final.
- T024 runs last: it needs every slice's commits and T022's results.

## Parallel opportunities

- Slice 6's three test tasks touch three different files: T011 (`test/install.test.mjs`), T012
  (`test/board-mod.test.mjs`) and T013 (`test/e2e.test.mjs`) can be written side by side.
- T019 (`CLAUDE.md`) and T020 (the SVG) touch no file any other doc task touches.
- No two implementation slices can run side by side: slices 1 to 5 all change
  `hooks/speckit-team.mjs` and `test/hook.test.mjs`, slices 6 and 7 both change `install.mjs` and
  `test/install.test.mjs`.

## Implementation strategy

- **MVP**: slices 1 to 6. After slice 6 the fast track is usable with every guardrail the spec asks
  for; slice 7 (triage, P3) and the docs complete the change. The PR is not opened before the
  documentation slices are done (constitution VIII).
- Each slice ends with `npm test` green before the next starts.
