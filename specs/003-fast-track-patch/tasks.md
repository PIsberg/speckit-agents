---
description: "Task list for the fast track for small changes"
---

# Tasks: Fast track for small changes

**Input**: Design documents from `specs/003-fast-track-patch/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required by constitution I and SC-004. In every slice the test tasks come first and are
shown failing before the implementation task. Where a test guards behaviour that already holds (the
malformed-input cases of an existing mode), the task says so; the deliberate break that turns it red
once is named there.

**Organization**: one slice at a time. A slice is one behaviour: its test tasks, then one
implementation task. Each slice builds and tests without the slices after it. The hook slices
(US3, US2) come before the agent (US1) although all are P1, because `patcher` is only safe to install
once its hooks exist; installing it first would ship a fast track with no budget and no protected
paths.

**User Story 4** (existing tracks unchanged, P1) has no slice of its own, because it adds no code.
Its scenarios are covered by: US4-1 by the existing `test/hook.test.mjs` and `test/e2e.test.mjs`
gate tests, which no task changes; US4-2 (silent without `.specify/`) by T001 and T003; US4-3
(uninstall) by T007 and T011; FR-009 by T003 (no verdict, retry or ends state written) and T007
(no new `settings.json` entry).

**No setup or stub tasks**: no dependency is added and no new test file is created. Tests drive the
hook and the installer through their command lines, and the e2e tests through `claude -p`. A missing
hook mode, agent or skill makes those tests fail on an assertion, not on an import or parse error.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: touches only files no other task in the same slice touches, and depends on no unfinished
  task in that slice.
- **[Story]**: US1, US2, US3, US5 from spec.md. Documentation tasks have none.
- Message texts are in [contracts/hook-cli.md](contracts/hook-cli.md); tests match their stable
  parts (paths, counts, limits, `/speckit-team`, the restore commands), not whole sentences.

---

## Slice 1: protected paths are denied before the write (US3, P1)

**Goal**: `scope protected` denies `Write`, `Edit`, `MultiEdit` and `NotebookEdit` to protected
paths in the repo and to the installed team outside it.

**Independent test**: `node --test test/hook.test.mjs`; the new cases pass, every existing case
still passes.

- [ ] T001 [US3] Tests in `test/hook.test.mjs` for `scope protected` (FR-007 write half, FR-001, FR-010, FR-011, US3-1, US3-4, plan.md decision 4, Edge "within budget but protected", SC-003). Use the file's existing `repo()`, `write()`, `denied()` helpers.
  - Denied, with a reason that names the repo-relative path and `/speckit-team`, and no file created or changed on disk: `.specify/memory/constitution.md`, `.specify/feature.json`, `.specify/test-paths`, `specs/001-demo/spec.md`, `specs/004-new/plan.md`, `.claude/settings.json`, `.claude/agents/x.md`, `.github/workflows/test.yml`, `.github/CODEOWNERS`, `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml`, `Jenkinsfile`, `.pre-commit-config.yaml`. On a case-insensitive file system (detected as the existing `.git/` spelling test does), also `.SPECIFY/memory/constitution.md`.
  - The speckit-agents sources, protected only in the speckit-agents repository (plan.md decision 4, owner-confirmed 2026-10-09; data-model.md `isOwnRepo(rev)`). In a repo whose setup commit has a top-level `package.json` of `{"name":"speckit-agents"}`: `hooks/speckit-team.mjs`, `agents/implementer.md`, `skills/speckit-team/SKILL.md`, `install.mjs` and `package.json` are denied, the reason naming the path and `/speckit-team`, nothing written (for `package.json`, its content on disk unchanged); on a case-insensitive file system also `HOOKS/speckit-team.mjs` and `PACKAGE.JSON`. The same five paths return `null` in each ordinary repo, the `package.json` write included: no `package.json`; `{"name":"my-app"}`; `{not json`; `[]`; `{"name":["speckit-agents"]}`; `{"name":"speckit-agents"}` only in `pkg/package.json`; `{"name":"speckit-agents"}` in the working tree but never committed; and a Spec Kit repo with no commit. In the speckit-agents repo, `hooks/useThing.js`, `agents/notes.txt`, `src/install.mjs` and `pkg/package.json` are still allowed.
  - The name is read from `HEAD`, not the working tree (plan.md decision 4, owner-confirmed 2026-10-09): in the speckit-agents repo, after the test rewrites `package.json` with `fs` to `{"name":"x"}` (uncommitted), a `Write` to `install.mjs` is still denied. No case in this list crashes the hook (constitution II).
  - Allowed (output `null`): `src/main/App.java`, `README.md`, `docs/guide.md`, `test/app.test.js`, `hooks/useThing.js`, `agents/notes.txt`, `skills/x/notes.md`, `src/install.mjs`, `package.json`, `.specifyx/notes.md`, `specsheet/x.md` (an ordinary repo).
  - Outside the repo: a `Write` to `path.join(<checkout root>, 'agents', 'x.md')`, `<checkout root>/hooks/x.mjs`, `<checkout root>/skills/y/SKILL.md`, `<checkout root>/settings.json` and `<checkout root>/settings.local.json` is denied with a reason matching `/installed agent team/` (the hook under test runs from the checkout, so the checkout is its team directory); a `Write` to `path.join(os.tmpdir(), 'elsewhere.txt')` is allowed. Assert nothing is created at those paths.
  - `.git/speckit-team/retries/x.json` is denied with the existing guardrail-state reason.
  - Add `scope protected` to the "every mode is a no-op outside a Spec Kit repo" test (a `.github/workflows/x.yml` write returns `null`), to the `MODES` list used by both malformed-input tests, and to the `file_path` loop of "mistyped fields never crash a hook". These three additions already pass before T002, because the existing `scope` mode handles them for any rule; show them red once by making `scope` throw for rule `protected` before the input checks, then revert.
- [ ] T002 [US3] Implement the `protected` rule of the `scope` mode in `hooks/speckit-team.mjs`, per contracts/hook-cli.md "scope protected" and research R4. New names (module scope):
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
except `SubagentHandback`.

**Independent test**: `node --test test/hook.test.mjs`.

- [ ] T003 [US2] Tests in `test/hook.test.mjs` for `patch` on PreToolUse (FR-005, FR-006 the stop, FR-002 no feature needed, FR-009, FR-010, FR-011, FR-014, US2-1, US2-3, US2-4, US2-5, SC-002, Edge Cases on 30/31 lines, plan.md decision 3 with the owner's rename rule of 2026-10-09, 3 files, renames, deletions, binaries, Edge Case "uncommitted changes at start" and Assumptions "left alone", plan.md decision 13, research R14). Add a helper `patchTool(dir, tool_name, tool_input = {}, extra = {})` that runs `['patch']` with `hook_event_name: 'PreToolUse'`, `agent_id: 'p1'`, `agent_type: 'patcher'`, and a helper that writes an n-line text file. Every written file contains the marker string `PATCH-CONTENT-7f3a`. Cases:
  - Boundary: first call `Read` records the start; then new `src/a.js` (20 lines) and `src/b.js` (10 lines): a `Bash` call is allowed. One more line in `src/b.js`: the next call is denied, the reason matching `31 changed production lines in 2 files`, `limit 30 lines, 2 files`, `/speckit-team` and `no commit`.
  - Boundary, modified lines (a modified line counts 1, max(insertions, deletions) per file): the setup commit adds a 40-line `src/forty.js`; after the first call, 30 of its lines changed in place: a `Bash` call is allowed. A 31st line changed in place: the next call is denied, the reason matching `31 changed production lines in 1 files`.
  - Boundary, mixed: 20 lines of `src/forty.js` changed in place plus a new 10-line `src/b.js`: allowed (30 in 2 files). One more line changed in place in `src/forty.js`: denied, matching `31 changed production lines in 2 files`.
  - Uneven edits: 5 lines of `src/forty.js` replaced by 8 lines counts 8, shown by adding a new 22-line `src/b.js` (allowed, 30) and then one more line in `src/b.js` (denied, 31). In a separate repo, 31 lines deleted from `src/forty.js` are denied (deletions alone count).
  - Three production files of one line each: denied, the reason naming `3 files`.
  - Tests and docs do not count: 5 production lines plus 200 lines spread over `test/a.test.js`, `src/test/java/BigTest.java`, `fixtures/data.json`, `README.md`, `docs/guide.mdx`, `notes.rst`, `CHANGES.txt`, `guide.adoc`, and `checks/golden/x.out` matched only by a `^checks/golden/` line in `.specify/test-paths` written before the first call: allowed. A 31-line `docs/tool.mjs` is denied (a docs folder is not a doc rule).
  - Binary: an untracked `src/logo.png` holding a NUL byte is denied with the reason matching `binary production files are not allowed: src/logo.png`; a committed binary production file that is then modified is denied; a committed binary production file that is deleted counts as 1 file and is not denied for being binary; a binary `test/fixtures/x.bin` is allowed.
  - Pure rename (0 lines, 1 file): the setup commit adds a 40-line `src/forty.js`; after the first call, `git mv src/forty.js src/moved.js`, a new 29-line `src/b.js` and a new 1-line `src/c.js`: the next call is denied, the reason matching `30 changed production lines in 3 files` (without rename detection it would read 110 lines in 4 files). In a separate repo, the same pure rename plus a new 30-line `src/b.js` is allowed.
  - Rename with edits (edited lines only, 1 file): `git mv src/forty.js src/moved.js`, then 5 of its lines changed in place, plus a new 25-line `src/b.js`: allowed (30 in 2 files). One more line of `src/moved.js` changed in place: the next call is denied, the reason matching `31 changed production lines in 2 files`.
  - Pure rename of a committed binary production file `src/logo.png` (`git mv` to `src/pic.png`): allowed, not reported as binary (git prints `-` for it in `--numstat`; research R3).
  - Rename across classes (owner-confirmed 2026-10-09, research R3): `git mv` of a committed 40-line `test/old.test.js` to `src/old.js` is denied, the reason matching `40 changed production lines in 1 files`.
  - A move git does not pair: the committed 3-line `src/small.js` moved with `fs.renameSync` to `src/tiny.js` (new path untracked) plus a new 1-line `src/c.js`: denied, the reason matching `7 changed production lines in 3 files`.
  - Deletions: deleting a committed 3-line production file counts 3 lines and 1 file; with two more new one-line production files the next call is denied, the reason naming `3 files`.
  - Committed work counts: 31 lines committed with `git commit` before the next call are denied (measured from the start commit, not `HEAD`).
  - Dirty at start, left alone (FR-005, Edge Case): the setup commit adds a 10-line `src/old.js`; before the first call the test appends 50 lines to it and writes an untracked 100-line `src/wip.js`. After the first call, a new 30-line `src/b.js`: a `Bash` call is allowed (30 lines in 1 file; neither dirty file counted). Rewriting `src/wip.js` with `fs` to byte-identical content: still allowed (content, not time, decides).
  - Dirty at start, further edit through `Write`/`Edit` (research R14, contract step 3): with the same two dirty files, a `Write` to `src/wip.js`, an `Edit` to `src/old.js`, a `MultiEdit` to `src/old.js` given as an absolute path, and a `Write` to `src/./wip.js` are each denied, the reason matching the repo-relative path, `uncommitted` and `/speckit-team`; a `Write` to the clean `src/new.js` in the same run is allowed. Also denied when it is the run's first call (the start record is written first).
  - Dirty at start, further edit through Bash: after the first call, one line appended to `src/wip.js` with `fs` (as a Bash command would): the next `Bash` call is denied, the reason matching `src/wip.js`, `no commit` and `/speckit-team`, although 0 production lines are counted. In separate repos the same for one line appended to `src/old.js`, for `src/wip.js` deleted, and for a dirty-at-start `.specify/memory/constitution.md` with a line appended (not named as a protected change, named as changed although uncommitted at the start).
  - Dirty at start, swept into a commit: after the first call the test runs `git add src/wip.js` and `git commit -qm x` with the file's bytes unchanged: the next `Bash` call is denied naming `src/wip.js`. The same for `git commit -qam x` sweeping the modified `src/old.js`.
  - These four cases fail if dirty paths are skipped for the whole run, as the earlier plan did: each would be allowed.
  - `SubagentHandback` is not denied when over budget.
  - Over budget, a `Bash` call `git add -A && git commit -qm x` is denied; afterwards `HEAD` is the start commit and `git status --porcelain` still lists the files (US2-3).
  - No active feature: with `.specify/feature.json` deleted before the first call, the 31-line case is still denied.
  - Fails closed (research R9): a start record replaced by `{not json` is denied, the reason naming `.git/speckit-team/patch/p1.json`; a start record whose `sha` is 40 hex digits of no commit is denied; an invalid line in `.specify/test-paths` is denied, the reason naming the line; a Spec Kit repo with no commit is denied with `no commit`; a start record whose `dirty` is `["src/wip.js"]` (the old array form) or `{"src/wip.js":"x"}` is denied as unusable, the reason naming the record file.
  - Unusable input: no `agent_id` and no `session_id` gives no decision and a `speckit-team: patch got unusable input` message; `agent_id: '../x'` the same. With only `session_id: 's1'`, a start record is kept under that key and the 31-line case is denied.
  - Add `['patch']` to the `MODES` list of both malformed-input tests, to the "an event a mode is not wired for" test, and a `patch` call to "every mode is a no-op outside a Spec Kit repo".
  - After every case: no hook output contains `PATCH-CONTENT-7f3a` (FR-014), and `.git/speckit-team/` holds no `verdicts/`, `retries/` or `ends/` folder (FR-009).
- [ ] T004 [US2] Implement the `patch` mode's PreToolUse path in `hooks/speckit-team.mjs`, per contracts/hook-cli.md "patch" steps 1, 2, 3, 4 and 6 (step 5 is T006), research R3, R5, R8, R9 and R14, and data-model.md. New names:
  - `const PATCH_LINES = 30;`, `const PATCH_FILES = 2;`
  - `const DOC_PATTERNS: RegExp[] = [/\.(md|mdx|markdown|rst|adoc|asciidoc|txt)$/i];` and `const isDoc = (rel: string): boolean`.
  - `const patchFile = (key: string): string` returning `path.join(stateDir, 'patch', `${key}.json`)`.
  - `function repoRel(file: string): string | null`: the repo-relative, forward-slash path of `path.resolve(cwd, file)` with `real()` on both sides, `null` when outside the repo; extracted from the `scope` mode, which now calls it (no change in `scope`'s behaviour).
  - `function stateOf(rel: string): string | null`: SHA-256 hex of the bytes of `path.join(root, rel)` (the existing `createHash`), `null` when it cannot be read (missing, a directory).
  - `function measure(start: { sha: string, dirty: Record<string, string | null> }): { lines: number, files: number, binary: string[], protectedChanged: { path: string, isNew: boolean }[], committed: boolean, dirtyTouched: string[] }`: `git diff --find-renames --numstat -z <sha>` and `git diff --find-renames --name-status -z <sha>` for tracked files (with `-z`, a rename record is `<ins>\t<del>\t\0<old>\0<new>\0` in numstat and `R<score>\0<old>\0<new>\0` in name-status; any other record has one path), `git ls-files --others --exclude-standard -z` for untracked ones (NUL in the first 8000 bytes is binary; text counts its lines); each path classed with `isProtected(rel, start.sha)`, then test, doc or production, in that order; a tracked production text file adds `Math.max(insertions, deletions)` to `lines`; a rename follows data-model.md "Renames" (between production paths 1 file and its numstat, `R100` never binary; across classes the production side from `git diff --no-renames --numstat -z <sha> -- <old> <new>`); a path, or a rename with either side, among the keys of `start.dirty` skipped from the counts; `committed` is `git rev-parse HEAD !== sha`; `dirtyTouched` is each key of `start.dirty` whose `stateOf()` differs from its recorded value, plus, when `committed`, each key listed by `git diff --no-renames --name-only -z <sha> HEAD`, sorted and without duplicates. `over` includes `dirtyTouched.length > 0`.
  - `WIRED.patch = ['PreToolUse', 'SubagentStop', 'Stop']`.
  - Mode `patch`, PreToolUse with any `tool_name` but `SubagentHandback`: key, start record (written once, `{ sha, dirty: Object.fromEntries(changedSince('HEAD').map((rel) => [rel, stateOf(rel)])), at }`), validation (data-model.md, the `dirty` shape included), the dirty-file write deny of step 3 (for `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, target via `repoRel(tool_input.file_path ?? tool_input.notebook_path)`; a missing or non-string path falls through to measuring), measure, and the deny message of step 6 with its dirty-file part. Leave `SubagentHandback`, `SubagentStop` and `Stop` as exit 0 for now.
  - Header comment: one line for `patch`.

**Checkpoint**: T003 green; `npm test` green.

---

## Slice 3: the end-of-run check (US3, P1, with US2's end message)

**Goal**: finishing is blocked while a protected file changed by any means is not restored, or while
an over-budget change is committed; otherwise the run ends with its size or the escalation message.
A pure restore command is allowed while over budget.

**Independent test**: `node --test test/hook.test.mjs`.

- [ ] T005 [US3] Tests in `test/hook.test.mjs` for the `patch` end check and the restore allowance (FR-006, FR-007 end-of-run half, FR-014, US3-2, US3-3, US1-3, US2-1, US2-2, Edge "protected changed through a shell command", Edge "uncommitted changes at start", plan.md decisions 4 and 13). The setup commit adds `.github/workflows/ci.yml`. Each case starts the run with a `patchTool(dir, 'Read')` call; "stop" means `['patch']` with `hook_event_name: 'SubagentStop'`, `agent_id: 'p1'`, `agent_type: 'patcher'`; "handback" means PreToolUse `SubagentHandback` with `tool_input.message: 'Fixed.\nDONE'`.
  - A line appended to `.specify/memory/constitution.md` with `fs`: stop is blocked, the reason matching `.specify/memory/constitution.md` and `git checkout <12 hex> -- .specify/memory/constitution.md`; stop with `stop_hook_active: true` is still blocked; handback is denied with the same reason; after the test runs `git checkout <start sha> -- .specify/memory/constitution.md`, stop gives no block.
  - A new `.github/workflows/new.yml`: the reason says to delete it. A deleted `.github/workflows/ci.yml`: the reason gives its `git checkout` command.
  - The hook changes nothing: after a blocked stop the appended line is still in the file, `HEAD` is the start commit and `git status --porcelain` is unchanged.
  - Dirty at start: `.specify/memory/constitution.md` modified before the first call is not named, not blocked on, and its content is unchanged after stop (US3-3).
  - Dirty at start, changed through Bash (research R14, Edge Case "uncommitted changes at start"): an untracked 100-line `src/wip.js` written before the first call, one line appended to it with `fs` after: stop and handback give no block or deny and a `systemMessage` matching `src/wip.js`, `uncommitted` and `/speckit-team` (message A), with no `git checkout` command for it; `src/wip.js` still holds the appended line afterwards (the hook restores nothing).
  - Dirty at start, swept into a commit: the same `src/wip.js` unchanged, plus a new 3-line `src/a.js`, both committed by the test with `git add -A` and `git commit -qm x` after the first call: stop is blocked with `git reset --soft <12 hex>`, also with `stop_hook_active: true`, and handback is denied; after the test runs `git reset --soft <start sha>`, stop gives no block and a `systemMessage` matching `3 of 30 production lines, 1 of 2 production files`, and `src/wip.js` is byte-identical to its content before the run. Before this change both cases ended within budget with the work committed.
  - Over budget, uncommitted (31 lines): stop and handback give no block or deny, and a `systemMessage` matching `31 changed production lines`, `limit 30 lines, 2 files`, `uncommitted` and `/speckit-team`.
  - Over budget and committed: stop is blocked with `git reset --soft <12 hex>`, also with `stop_hook_active: true`; after the test runs `git reset --soft <start sha>`, stop gives the over-budget `systemMessage` and no block.
  - Within budget (3 lines in 1 file): stop gives no block and a `systemMessage` matching `3 of 30 production lines, 1 of 2 production files`.
  - Restore allowance (research R7), over budget with the constitution changed: `Bash` `git checkout <sha> -- .specify/memory/constitution.md`, `git restore .specify/memory/constitution.md`, `git reset --soft <sha>` and `rm .github/workflows/new.yml` are allowed; `git checkout <sha> -- x && git commit -qm y`, `rm a; rm b`, `git checkout $(echo x)` and a `Write` are denied, the reason containing `First restore`. Over budget with nothing to restore and nothing committed, `git checkout <sha> -- src/a.js` is denied.
  - No start record for the key: stop exits with no output. Start record `{not json`: stop gives a `systemMessage` matching `fast-track check could not run` and no block.
  - The speckit-agents sources, both sides (plan.md decision 4): in a repo whose setup commit has a top-level `package.json` of `{"name":"speckit-agents"}` and a committed `install.mjs`, a line appended to `install.mjs` with `fs` blocks stop, the reason matching `install.mjs` and `git checkout <12 hex> -- install.mjs`. In an ordinary repo (setup commit with `{"name":"my-app"}` and the same `install.mjs`), the same append gives no block and a `systemMessage` matching `1 of 30 production lines, 1 of 2 production files`.
  - `package.json`, both sides (owner-confirmed 2026-10-09): in the speckit-agents repo, the test rewrites `package.json` with `fs` to `{"name":"x"}` and appends a line to `install.mjs`; stop is blocked, the reason naming both `package.json` and `install.mjs` with a `git checkout <12 hex> --` command each (the name is read from the start commit, so editing it does not lift the protection); the same after the test also commits both changes with `git commit -qam x`. In the ordinary repo, appending a line to `package.json` with `fs` gives no block and a `systemMessage` matching `1 of 30 production lines, 1 of 2 production files`.
  - No hook output in these cases contains `PATCH-CONTENT-7f3a`.
- [ ] T006 [US3] Implement the end check and the restore allowance in `hooks/speckit-team.mjs`, per contracts/hook-cli.md "End of run" and step 5, research R6, R7 and R14. New names:
  - `function isPureRestore(command: unknown): boolean`: true only for a string whose whole text is one `git checkout …`, `git restore …`, `git reset --soft …` or `rm …` command containing none of `;`, `&`, `|`, backtick, `$`, `>`, `<` or a newline.
  - `function endCheck(start: { sha: string, dirty: Record<string, string | null> }, viaHandback: boolean): void` (exits): the four outcomes in the contract's order, `over` including `dirtyTouched`, message A with its dirty-file part; deny on the handback path, block on SubagentStop and Stop, regardless of `stop_hook_active`.
  - Route `SubagentHandback` (PreToolUse), `SubagentStop` and `Stop` of mode `patch` to `endCheck`; add step 5 to the PreToolUse path.
  - Header comment: the `patch` line covers the end check.

**Checkpoint**: T005 green; `npm test` green.

---

## Slice 4: the fast track, installed and wired (US1, P1) 🎯 MVP

**Goal**: `/speckit-patch` and the `patcher` agent are installed and uninstalled with the team, and
Claude Code fires `patcher`'s three hooks.

**Independent test**: `node --test test/install.test.mjs test/board-mod.test.mjs test/e2e.test.mjs`
(e2e needs `claude` on PATH; skipped, not passed, without it).

- [ ] T007 [P] [US1] Tests in `test/install.test.mjs` (FR-001, FR-002, FR-003, FR-004, FR-006, FR-009, FR-012, US4-3, constitution II quoted path, Installation constraints):
  - Add `'patcher'` to the file's `AGENTS` constant, so the existing install, marker, `{{HOOK}}` and uninstall loops cover it.
  - In "install lays down agents, skill, hook and both settings gates": installed `agents/patcher.md` contains `node "<hookPath>" patch`, `node "<hookPath>" scope protected` and `node "<hookPath>" ends DONE FAILED ESCALATE`; `skills/speckit-patch/SKILL.md` exists with the marker, `name: speckit-patch` and `disable-model-invocation: true`; `gates(s)` is still exactly the two existing entries.
  - Installed `agents/patcher.md` states the fast track's prose rules, each matched case-insensitively: the words `DONE`, `FAILED` and `ESCALATE`; `regression test`; `passed, failed, skipped or not run`; `git add -A` named as not to be used; files listed by `git status` at the start named as not to be edited, staged or committed (matched as `not yours`); `git mv` (how to move a file); `never merge`; `/speckit-team` with `never start`. Installed `skills/speckit-patch/SKILL.md` states `never merge` and `never start` `/speckit-team`.
  - "a second install changes nothing" and "install then uninstall into an empty config dir leaves it empty" hold with the new files (assert `skills/speckit-patch` exists after the install in the first).
  - "--uninstall removes only what it installed": also `skills/speckit-patch` is gone.
  - "refuses to replace agents it did not install, unless --force": a user's own `agents/patcher.md` is refused and left unchanged without `--force`.
  - "--help lists every flag": the help text also names `/speckit-patch`; a real install's stdout names `/speckit-patch` in its final "Next" lines.
- [ ] T008 [P] [US1] Test in `test/board-mod.test.mjs`: in "the board mod draws each role in the color of its agent file", expect 7 agent files instead of 6 (CLAUDE.md Rules, the `ROLE_COLOR` twin). Red until T010 adds `agents/patcher.md` and its color.
- [ ] T009 [P] [US1] Tests in `test/e2e.test.mjs` (FR-005, FR-006, FR-007, SC-003, SC-004, US2-1, US2-3, US3-1, US3-2), scripted model, `agent('patcher', 'e2e patcher')`:
  - In `setup()`: when `process.env.SPECKIT_E2E_NO_HOOK === '1'`, overwrite the installed hook with `process.exit(0);\n` after installing (used by T020 for SC-004; off by default).
  - "patcher's scope hook denies a protected Write and allows a production one": `Write` `.specify/memory/constitution.md`, then `Write` `src/fix.js` (one line), then `say('Fixed.\nDONE')`. The first result is an error matching `patcher may not write .specify/memory/constitution.md: it is a protected path`; the constitution is unchanged; `src/fix.js` exists.
  - "over budget, patcher's next tool call is denied and nothing is committed": `Write` `src/big.js` (31 lines), `Bash` `git add -A && git commit -qm big`, `say('Over budget.\nESCALATE')`. The Bash result matches `Fast-track budget exceeded: 31 changed production lines in 1 files`; `HEAD` is the setup commit; `src/big.js` is still untracked.
  - "a protected file changed through Bash blocks patcher's stop until it is restored": `Bash` `echo x >> .specify/memory/constitution.md`, `say('Done.\nDONE')`, `Bash` `git checkout <setup sha> -- .specify/memory/constitution.md`, `say('Restored.\nDONE')`. The third request shows `Fast track: patcher changed protected files: .specify/memory/constitution.md`; afterwards the file equals its committed content.
  - "patcher's report must end in DONE, FAILED or ESCALATE" (`permissionMode: 'auto'`): `SubagentHandback` `placeholder`, then `Fixed.\nDONE`. The first result is an error matching `exactly one of: DONE, FAILED, ESCALATE`.
- [ ] T010 [US1] Implement the fast track's files (FR-001 to FR-004, FR-006, FR-012, FR-014), per contracts/commands-and-files.md:
  - New `agents/patcher.md`: the frontmatter in the contract verbatim (`name: patcher`, `tools: Read, Write, Edit, Bash`, `model: sonnet`, `color: cyan`, the three hook entries), the marker comment line, and a body of Inputs, Process, Lane and Report carrying every rule the contract lists, in the style of `agents/implementer.md` (no em-dashes).
  - New `skills/speckit-patch/SKILL.md`: frontmatter `name: speckit-patch`, a one-line `description`, `argument-hint: "<small change>"`, `disable-model-invocation: true`, the marker line; body with the four steps of the contract, including the foreground-launch check copied from `skills/speckit-team/SKILL.md` step 0.
  - `install.mjs`: `'patcher'` appended to `AGENTS`; `{ src: 'skills/speckit-patch/SKILL.md', dst: <claudeDir>/skills/speckit-patch/SKILL.md }` in `files()`; a help line in the header comment naming `/speckit-patch` (the fast track for small changes); a line in the final "Done. Next:" message: `A small change: /speckit-patch <change>`.
  - `mods/speckit-board/hooks/model.ts`: `patcher: 'cyan'` in `ROLE_COLOR`; `TEAM` unchanged.

**Checkpoint**: T007 to T009 green; `npm test` green.

---

## Slice 5: advisory triage (US5, P3)

**Goal**: `/speckit-triage <request>` suggests a track with a reason and runs nothing.

**Independent test**: `node --test test/install.test.mjs`.

- [ ] T011 [US5] Tests in `test/install.test.mjs` (FR-013, US5-1, US5-2, FR-012): installed `skills/speckit-triage/SKILL.md` exists with the marker, `name: speckit-triage` and `disable-model-invocation: true`; it names both `/speckit-patch` and `/speckit-team`; it states that it launches no agent and invokes no skill (match `launches no agent` and `invokes no skill`, case-insensitive); it names the four signals for `/speckit-team` (`public contract`, `protected path`, `30`, `2`); `--uninstall` removes `skills/speckit-triage`; `--help` names `/speckit-triage`.
- [ ] T012 [US5] Implement `skills/speckit-triage/SKILL.md` per contracts/commands-and-files.md "/speckit-triage" (frontmatter `name: speckit-triage`, `argument-hint: "<request>"`, `disable-model-invocation: true`, the marker line; body: the signals, one suggestion with a one-line reason and the exact command to type, and that it launches no agent and invokes no skill). In `install.mjs`: add it to `files()`, a help line naming `/speckit-triage`, and `Not sure which track: /speckit-triage <request>` in the final message.

**Checkpoint**: T011 green; `npm test` green.

---

## Documentation slices (constitution VIII, FR-012, SC-005; owner requirement)

These change no behaviour, so they have no test tasks. Each one runs the prose rules on what it
writes: no em-dashes, no curly quotes, en-dash only in numeric ranges, numbers over adjectives. Every
place to fix is listed in plan.md "Documentation plan"; each task names its rows. Count the agent
bodies and descriptions with a command, not by eye.

- [ ] T013 Update the user-facing parts of `README.md` (plan.md "Documentation plan" rows for T013): the nav line and intro (seven agents, the fast track beside the pipeline); a Highlights bullet for the fast track (budget 30 production lines and 2 files, protected paths, one agent stage, link to "The fast track"); Contents; "What gets installed" (`agents/{...,patcher}.md`, the seven subagents, `skills/speckit-patch/SKILL.md`, `skills/speckit-triage/SKILL.md`; `settings.json` still two entries); "Installer options" (one sentence: no flag, the fast track is always installed); Quick start: a "#### 3. A small change: the fast track" with `/speckit-patch` and `/speckit-triage` examples and the three report words; "The team": a `patcher` row (phase: fast track; may write: everything except protected paths, within the budget; hands over: one commit and a PR, or `ESCALATE`/`FAILED`; model sonnet), and the "26 to 43 lines" and "These six total about 1,700 characters, roughly 420 tokens" figures recounted for seven (`wc -l` on the bodies, character count of the `description:` lines); the SVG alt text; Troubleshooting entries for "Fast-track budget exceeded", "may not write ... it is a protected path" and "Fast track: patcher changed protected files" (what each means, what to do); "Install fails" (seven names); Uninstall (seven agents, three skills); Repository layout (seven definitions, the hook's modes including `patch`, the skills row with all three, "features 001, 002 and 003").
- [ ] T014 Update the "How it works" parts of `README.md`: the intro (two commands, the skill decides and the hooks decide); a new "### The fast track" section after "### The pipeline skill": what one run does, the budget and how it is measured (per production file the larger of its insertions and deletions from the start commit, so a modified line counts once and 30 modified lines fit; untracked files by line count; files already uncommitted at the start left out while unchanged, a `Write` or `Edit` to one denied, and a change or commit of one by other means stopping the run (plan.md decision 13); a rename between production files as 1 file and only its edited lines, so a pure rename is 0 lines, a test or doc moved into production code counted as a new production file, and a move git does not pair, such as plain `mv`, as a deletion plus a new file, which is why the agent moves files with `git mv`), the path classes and the exact test and doc rules (data-model.md "Path class"), the protected table (research R4), the speckit-agents sources and `package.json` itself protected only in a repo whose top-level `package.json`, as committed, is named `speckit-agents`, and the installed-team rule, the PreToolUse stop and the restore allowance, the end check's four outcomes, why the protected check blocks every time, what is prompt text rather than hook (research R10), and one line each on what was verified live, by unit and e2e test only, and not at all (filled from T018's results if they exist, else written as "not yet run live"); the Guardrails table rows for `scope protected` (patcher, PreToolUse `Write|Edit|MultiEdit|NotebookEdit`), `patch` (patcher, PreToolUse every tool, and Stop) and `ends DONE FAILED ESCALATE`, plus "every `scope` rule" now covering five writing agents; State (`patch/` per run, safe to delete, never written: `verdicts/`, `retries/`, `ends/`); Customising (`PATCH_LINES`, `PATCH_FILES`, `PROTECTED` in `hooks/speckit-team.mjs`; `.specify/test-paths` also decides what the budget counts); Known limits (a Bash write outside the repo is not caught at the end; one Bash command that commits and pushes in a single call runs before any hook sees it, so the end check blocks after the push; each tool call hashes every file uncommitted at the start; in the speckit-agents repository the fast track cannot change `package.json` (a version bump or a new script goes through `/speckit-team`); a file moved with plain `mv` counts as two files; each run has its own budget, so repeated runs on one branch are not summed; FR-002 to FR-004 are prompt rules; a generated file git does not ignore counts as production).
- [ ] T015 [P] Update `CLAUDE.md` outside the SPECKIT block: Layout (`agents/*.md` includes `patcher`; the hook's modes `scope`, `gate`, `verdict`, `result`, `ends`, `lane`, `patch`; `skills/speckit-patch/SKILL.md` and `skills/speckit-triage/SKILL.md` beside `skills/speckit-team/SKILL.md`); Rules: a new rule that `OWN_SOURCES` in `hooks/speckit-team.mjs` lists the team's own source paths, protected by the fast track only in this repository (recognised by the `name` in the committed top-level `package.json`, which is itself in `OWN_SOURCES`, so the fast track cannot change `package.json` here), so a new guardrail file of the team gets an entry there and a case in `test/hook.test.mjs`; the `ROLE_COLOR` rule now covers seven agent files.
- [ ] T016 [P] Redraw `docs/media/architecture-visualized.svg` by hand: the COMMANDS layer gains `/speckit-patch <change>` (one agent, budget 30 lines / 2 files, protected paths) and `/speckit-triage` (suggests a track, runs nothing); the AGENTS layer gains `patcher` (Sonnet; lane: all but protected paths, within the budget; one commit and a PR, or ESCALATE); grow the `viewBox` as needed and keep the existing style. Check it renders (open it in a browser or convert it with any available tool) and that its text has no em-dash.
- [ ] T017 Re-record `docs/media/agents-list.gif`: run `node docs/media/record.mjs agents-list` (needs `vhs`, `specify`, a logged-in `claude` and git on PATH; README "Recording the demo media"), read the frames in `agents-list.txt` to see which of the seven team agents the 15-entry list shows, then update the comment at the top of `docs/media/agents-list.tape` and the paragraph under "The team in the `@` typeahead" in `README.md` to what the frames show. If `vhs` or a logged-in `claude` is not available, report this task as one only the user can do, and change nothing.
- [ ] T018 Live checks L1 to L7 of `specs/003-fast-track-patch/quickstart.md` in a scratch Spec Kit repo with the team freshly installed (constitution II, SC-005). These make real model calls on the user's account. Record in `README.md`: a dated "Live results" entry with the Claude Code version, what each check showed and its cost; anything not exercised moved into the "Not yet exercised live" note; under "Live check" the fast-track commands; under "Context budget" a row or short table for the L1 run measured with `node tools/usage.mjs <transcript>` (main session requests, peak and input; agents launched and their input; cost), next to the four `/speckit-team` runs. A check that could not run is written as not run, with the reason. If `claude -p` cannot run from this session, report the task as one only the user can do.
- [ ] T019 Update every test count: run `npm test` once (exit status checked directly, not through a pipe) and copy its numbers into `README.md` "Test suite" (`npm test` runs N tests; per-suite counts for `hook.test.mjs`, `install.test.mjs`, `board-mod.test.mjs`, `e2e.test.mjs`), the "End-to-end tests" paragraph (the scripted tests now fire every hook entry including `patcher`'s three; "The 11 tests" and "all 11" recounted; the `SPECKIT_E2E_NO_HOOK=1` switch described), and `CLAUDE.md` "Verify" (test count, run time and date, the e2e count).
- [ ] T020 Write `specs/003-fast-track-patch/evidence.md`, which the PR body quotes (constitution I and II): for each slice, check out the commit before its implementation commit in a temporary `git worktree`, run the slice's test file there, and paste the failing summary lines; run `SPECKIT_E2E_NO_HOOK=1 node --test test/e2e.test.mjs` and list each new `patcher` case as failed (SC-004), pasting the summary; copy T018's live results, or state that they were not run and why. Remove the temporary worktrees afterwards.

---

## Dependencies and order

```text
Slice 1 (T001 → T002)
  → Slice 2 (T003 → T004)          needs scope protected's PROTECTED table for path classes
    → Slice 3 (T005 → T006)        needs measure() and the start record
      → Slice 4 (T007, T008, T009 [P] → T010)   the agent is installed only once its hooks exist
        → Slice 5 (T011 → T012)
          → T013 → T014 → T017 → T018 → T019 → T020   (all edit README.md, in this order)
             T015 [P], T016 [P] at any point after T012
```

- T019 runs after the last test is added (T011) and after T018, so the counts are final.
- T020 runs last: it needs every slice's commits and T018's results.

## Parallel opportunities

- Slice 4's three test tasks touch three different files: T007 (`test/install.test.mjs`), T008
  (`test/board-mod.test.mjs`) and T009 (`test/e2e.test.mjs`) can be written side by side.
- T015 (`CLAUDE.md`) and T016 (the SVG) touch no file any other doc task touches.
- No two implementation slices can run side by side: slices 1 to 3 all change
  `hooks/speckit-team.mjs` and `test/hook.test.mjs`, slices 4 and 5 both change `install.mjs` and
  `test/install.test.mjs`.

## Implementation strategy

- **MVP**: slices 1 to 4. After slice 4 the fast track is usable with every guardrail the spec asks
  for; slice 5 (triage, P3) and the docs complete the change. The PR is not opened before the
  documentation slices are done (constitution VIII).
- Each slice ends with `npm test` green before the next starts.
