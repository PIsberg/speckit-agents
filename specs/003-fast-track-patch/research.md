# Research: Fast track for small changes

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-09, revised 2026-10-10

No `NEEDS CLARIFICATION` remained in the spec or the Technical Context. Each entry below is a design
decision, the reason for it, and what was rejected. R1 to R10 and R14 were revised for the owner's
decision of 2026-10-09 "commit after the check" (plan.md, decision 14), which reverses decision 6;
R15 and R16 are new with it.

## R1. One new agent, launched by a new skill that commits after the check

- **Decision**: `/speckit-patch <change>` is a skill in the main session. It creates the branch,
  launches one new subagent, `patcher`, in the foreground, and, only after `patcher` reported `DONE`
  with the tests passed and the hook accepted the end of its run, commits `patcher`'s files, pushes
  and opens the pull request (R15). `patcher` only changes the working tree, runs the tests and
  reports `DONE`, `FAILED` or `ESCALATE`; it may not commit, push or run `gh` (R15). All of the fast
  track's hooks sit in `patcher`'s frontmatter.
- **Rationale**: SC-001 counts "1 agent stage". Agent frontmatter hooks are the mechanism this repo
  has already verified end to end (`test/e2e.test.mjs`), and they fire only while that agent runs, so
  `/speckit-team`'s agents, gates and lanes are not touched at all (FR-009) and `settings.json`
  gets no new entry. The commit moved out of the hooked agent because a hook that checks the working
  tree at the end cannot undo what is already in a commit or on the remote: the spec audit of
  2026-10-09 (finding H1) showed a protected change committed and pushed while within budget, then
  restored in the tree, passing the end check while the pull request kept it. A commit made after
  the end check accepted the run, from the list of files the check accepted, cannot carry what the
  check refused.
- **Rejected**: (a) the skill doing the work in the main session with skill-scoped hooks: those are
  not verified in this repo, and a main-session PreToolUse hook would see every tool call of every
  session in a Spec Kit repo; (b) reusing `implementer`: its `gate retries` hook denies everything
  until an audit has passed, which a fast-track run never has; (c) `patcher` committing, pushing and
  opening the PR itself, behind the budget hook (decision 6, reversed by the owner on 2026-10-09):
  a commit and a push in the same Bash call as the edit ran before any hook saw them.

## R2. Hook modes: one new scope rule, one new mode

- **Decision**: `scope protected` (a new rule of the existing `scope` mode) denies `Write`, `Edit`,
  `MultiEdit` and `NotebookEdit` to protected paths. A new mode `patch` keeps the run's start record,
  denies commands that commit, push or open a pull request, measures the change on every tool call,
  and runs the end-of-run check on `SubagentHandback`, `SubagentStop` and `Stop`. `patcher`'s report
  word is checked by the existing `ends` mode (`ends DONE FAILED ESCALATE`).
- **Rationale**: `scope` already resolves paths through symlinks, junctions and 8.3 names, guards
  the git directory and handles mistyped `file_path`; a new rule inherits all of it. `ends` already
  refuses a report without its word once and never twice. Only the budget, the command deny, the
  team hashes and the end check are new logic.
- **Rejected**: a second hook script (the installer, the smoke check and `CLAUDE.md` assume one
  script); folding the protected-path check into `patch` (it would duplicate the path resolution).

## R3. What counts as a changed line, a file touched, a test and a doc

- **Decision**:
  - The change is everything that differs from the start commit, committed or not, plus untracked
    files not ignored by git: `git diff --find-renames --numstat <start>` (with `--name-status` for
    the change type) and `git ls-files --others --exclude-standard`. Files already dirty at the
    start are left out of the counts (spec, Edge Cases) only while they stay as they were; a later
    change to one stops the run (R14).
  - **Changed lines** of a file are the larger of its insertions and its deletions as
    `git diff --numstat` reports them, so a modified line counts 1: 30 lines modified in place fit,
    31 do not, and 5 lines replaced by 8 count 8. A deleted file counts its deleted lines. An
    untracked text file counts its line count.
  - **Renames** (owner decision, 2026-10-09): git's rename detection pairs a deleted path with an
    added one at 50% similarity or more (git's default). A rename between two production paths counts
    1 file and only its edited lines, the larger of the pair's insertions and deletions: a pure rename
    (`R100`) counts 0 lines. A rename with a protected side is a protected change of both paths. A
    rename between a production path and a test or doc path counts as without rename detection: the
    production side alone, as a deleted file (its deleted lines) or an added file (its lines), read
    from a second `git diff --no-renames --numstat -z <start> -- <old> <new>` on just those two paths.
    A rename between two test or doc paths counts nothing. A rename with either side in the start's
    dirty list is left out of the counts, like any dirty path, and moving a dirty file changes it
    (R14). A rename under 50% similarity is, to git, a deletion and an addition, and counts as 2 files.
  - **Files touched** are the production files with any change: a rename between production paths
    counts 1, a deletion 1.
  - **Binary** is git's own verdict (`-` in `--numstat`) for tracked files, and a NUL byte in the
    first 8000 bytes for untracked ones (git's heuristic). An added or modified binary production
    file stops the run; a deleted one is only a file touched, and so is a pure rename (`R100`) of
    one, although numstat prints `-` for it too (verified on 2026-10-09 in a scratch repo:
    `git mv logo.png pic.png` gives numstat `-  -` and name-status `R100`).
  - **What git sees as a rename**: only a pair it tracks. `git mv`, or a new path staged with
    `git add`, is paired; a file moved with plain `mv`, or written anew and the old one deleted, leaves
    the new path untracked, so it counts as a deletion plus a new file (2 files, both line counts).
    Verified in the same scratch repo: after `mv plain.js moved.js`, the diff shows only `D plain.js`.
    The hook does not stage files to find the pair, because it changes nothing in the repo
    (contracts/hook-cli.md); `agents/patcher.md` says to move files with `git mv`, which writes the
    index, not history, and stays allowed (R15).
  - A path is **protected** first (R4), then a **test** if it matches the built-in `TEST_PATTERNS` or
    a line of `.specify/test-paths` **as committed at the run's start commit**
    (`git cat-file blob <start>:.specify/test-paths`; no such file means the built-in patterns only),
    then **documentation** if it ends in `.md`, `.mdx`, `.markdown`, `.rst`, `.adoc`, `.asciidoc` or
    `.txt` (case-insensitive). Everything else is **production**. Only production files count toward
    the budget (FR-005).
- **Rationale**: the owner's rule (2026-10-09): a small fix is usually an in-place edit, and a modified
  line is one line of change to a reviewer. A reviewer can still check the hook's number by hand:
  per file, the larger of the two `git diff --numstat` columns, which `git diff -M --numstat` prints
  for a rename too. Rename detection is the owner's rule (2026-10-09): moving a file is not a change
  in its content, and counting it twice would spend half the file budget on one move. Counting a
  rename across classes without detection keeps a test moved into production code from reading as a
  free file, the reason the plan first chose `--no-renames` (the lane check's choice, unchanged). A
  docs folder is not a doc rule because folders hold code too (`docs/media/record.mjs` in this
  repo). **Test patterns from the start commit** (owner decision, 2026-10-09, plan.md decision 14):
  the existing `testPaths` reads `.specify/test-paths` from the working tree
  (`hooks/speckit-team.mjs` lines 133 to 141), so a Bash edit adding `^src/` made production code
  count as tests for the rest of the run (spec audit finding H1). A file read from a commit cannot be
  changed by the run. A `.specify/test-paths` the developer had changed but not committed at the
  start is not used; the README says to commit it first. `scope` and `lane` keep reading the working
  tree (FR-009: `/speckit-team` unchanged).
- **Rejected**: insertions plus deletions (what `git diff --shortstat` prints): a modified line
  counts 2, so 15 in-place edits fill the budget; the owner rejected it on 2026-10-09. No rename
  detection (`--no-renames`, the first plan): a renamed file counted as 2 files and twice its
  lines; the owner rejected it on 2026-10-09. Staging into a temporary index to pair a plain `mv`:
  `git add` writes objects into the repository, which the hook never does. Test patterns copied into
  the start record: the same protection with a second copy of a file git already keeps.
- **Owner decision**: confirmed on 2026-10-09 as max(insertions, deletions) per production file, and
  in a second answer the same day, with git's rename detection: a pure rename 0 lines and 1 file, a
  rename with edits its edited lines and 1 file (plan.md, "Decisions to confirm", 3). The handling of
  a rename across classes and of a move git does not see was the planner's, confirmed by the owner on
  2026-10-09. Test patterns from the start commit: the owner's, 2026-10-09 (decision 14).

## R4. The protected set

- **Decision**: a repo-relative table in `hooks/speckit-team.mjs`, matched case-insensitively, each
  entry with the reason the denial message gives:

  | Pattern | Why |
  |---|---|
  | `.specify/` | Spec Kit's config and the constitution |
  | `specs/` | feature specs, plans and tasks, which belong to /speckit-team (also enforces FR-001) |
  | `.claude/` | the project's Claude Code agents, skills, hooks and settings |
  | `.github/` | CI workflows and repository settings |
  | `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml`, `Jenkinsfile`, `.pre-commit-config.yaml` | other CI and commit-hook configuration |

  A second table, `OWN_SOURCES`, applies only in the speckit-agents repository:

  | Pattern | Why |
  |---|---|
  | `hooks/speckit-team.mjs`, `agents/*.md`, `skills/*/SKILL.md`, `install.mjs` | the agent team's own sources |
  | `package.json` (top level only) | the package name that marks this repository |

  The hook treats a repo as the speckit-agents repository when its top-level `package.json`, read
  from a commit with `git cat-file blob <rev>:package.json`, parses as JSON with
  `"name": "speckit-agents"`, as this repo's does. `<rev>` is the run's start commit in the `patch`
  end check and `measure`, and `HEAD` in `scope protected` (which has no start record). A missing or
  malformed file, another name, that name in a subfolder's `package.json`, or a repo with no commit
  means an ordinary repo, where these five paths are ordinary files. Read at most once per `<rev>`
  per hook run.

  Plus, for paths outside the repo: the installed team itself, that is `agents/`, `hooks/` and
  `skills/` under the directory the running hook was installed into, and that directory's
  `settings.json` and `settings.local.json`. The hook finds that directory from its own path
  (`fileURLToPath(import.meta.url)`, two levels up). A `Write` or `Edit` there is denied by
  `scope protected`; a change by any other means is caught by the end check through the hashes taken
  at the start (R16: it ends the run `FAILED` with no accepted record, owner decision of
  2026-10-10, plan.md decision 16 point 2). The git directory is already denied by every `scope` rule.
- **Rationale**: FR-007's minimum names the hook script, the agent definitions and the installer.
  In a user's repo those live in `.claude/` or in the Claude Code config directory, outside the
  repo; in this repo they are `hooks/`, `agents/`, `skills/` and `install.mjs`. Both have to be
  covered. The owner decided on 2026-10-09 that the source patterns apply only in this
  repository, so a user repo with its own `install.mjs` or `agents/*.md` is not refused. The npm
  name is the recognition rule because a test can set it in a throwaway repo, an ordinary project
  carries this exact name only by naming its own root package after this one, and a clone or fork
  keeps it and stays protected (owner-confirmed 2026-10-09, second answer). `package.json` is in
  `OWN_SOURCES` so an agent cannot lift the protection by editing the name (owner-confirmed
  2026-10-09, second answer): `Write` and `Edit` to it are denied, and because the name is read from
  a commit, a shell edit of it, committed or not, cannot change the start commit, so the end check
  still protects the sources and blocks until they and `package.json` are restored. The cost: in
  this repository the fast track cannot change `package.json` at all (a version bump or a new script
  goes through `/speckit-team`); the README says so. Reading the name from a commit rather than the
  working tree was the planner's choice, confirmed by the owner on 2026-10-09.
- **Rejected**: a `.specify/protected-paths` file like `.specify/test-paths`: it would let every
  repo add paths, but no agent's lane may write `.specify/`, so this repo's own entries would be a
  task only the user could do, and the spec does not ask for it (YAGNI; a follow-up issue if
  wanted). Matching files by the installer's marker line: `README.md` and `CLAUDE.md` in this repo
  quote the marker, so every doc typo here would be refused. For recognising this repository: the git
  remote URL (absent in a fork, a renamed repo or a clone without that remote), the root commit
  (missing from CI's shallow checkout), the presence of `hooks/speckit-team.mjs` (a repo that
  vendors the hook would match). Reading the name from the working tree with `readOr()` (the
  previous plan): a shell edit of the name would switch the protection off before the end check.
  Protecting the source paths in every repo: the owner's original plan, changed on 2026-10-09.

## R5. When the budget is exceeded: stop the run with a deny

- **Decision**: on each `patcher` PreToolUse call other than `SubagentHandback`, `patch` measures the
  change. Once it is over budget or holds a binary production file, every tool is denied with the
  FR-006 message (measured counts, limits, "leave the work uncommitted, report ESCALATE",
  `/speckit-team`). Reporting back is never denied for the budget. The one exception is described
  in R7.
- **Rationale**: PreToolUse sees the tree before the tool runs, so the write that crosses the line
  goes through, and the work stays in the working tree as FR-006 requires. This mirrors
  `gate retries`, which already stops implementer the same way. An over-budget run is never
  committed: the end check writes no accepted record for it, and the skill commits only with one
  (R15).
- **Not replaced by the command deny**: the deny of `git commit`, `git push` and `gh` (R15) matches
  command words, which misses aliases and scripts; the budget deny and the end check do not depend
  on how a command is spelled.
- **Cost**: three or four `git` calls per `patcher` tool call, on top of the two the hook already
  makes. Not measured; `patcher` is the only agent that pays it. Constitution III's overhead budget
  is for observers, and this is a guardrail.

## R6. The end-of-run check

- **Decision**: on `SubagentHandback` (PreToolUse), `SubagentStop` and `Stop`, `patch` first removes
  the accepted record (R15), measures again and, in this order:
  1. Protected repo files changed since the start (not dirty at the start; a dirty one that changed
     is R14's case, since restoring it to the start commit would destroy the developer's work):
     block (Stop) or deny (handback) naming each file and its restore command,
     `git checkout <start sha> -- <file>` or "delete it" for a new file. It blocks on every attempt until they are restored, including
     when `stop_hook_active` is set (spec Clarifications, FR-007).
  2. `HEAD` is no longer the start commit, at any size (a commit made by a program the command deny
     does not see, R15): block or deny, asking for `git reset --soft <start sha>`, which keeps the
     work uncommitted, until `HEAD` is back. `patcher` never commits, so any commit is one to undo.
  3. An installed team file (agent, hook, skill or settings file, R16) whose hash differs from the
     start: let it finish, also at a handback ending in `DONE`, with a `systemMessage` naming the
     files and saying the run ended `FAILED`; no accepted record, so the skill commits nothing
     (owner decisions of 2026-10-10, plan.md decision 15 point 5 and decision 16 point 2).
  4. Over budget, nothing committed: let it finish, with a `systemMessage` giving the counts, the
     limits, that the work is uncommitted, and `/speckit-team`. No accepted record.
  5. Within budget: write the accepted record and let it finish, with a `systemMessage` giving the
     size against the budget (User Story 1, scenario 3).
  The hook itself runs no git command that changes anything.
- **Rationale**: the protected rule and the stop-for-budget rule pull in opposite directions
  (spec: over-budget production changes stay; protected changes must be restored), and the order
  above gives each its own outcome. Step 2 covered only an over-budget commit before; a commit at any
  size now blocks, because a commit within budget was the route of finding H1: a protected change
  committed, then restored in the tree, is invisible to a diff of the tree against the start commit,
  but not to `HEAD` having moved.
- **Differs from the lane check**, which warns and lets the agent go on its second stop. The spec
  says "until they are restored", so a model that never restores loops. Confirmed by the owner on
  2026-10-09 (plan.md, "Decisions to confirm", 5).

## R7. Restoring while over budget

- **Decision**: while over budget, and only if a protected repo file changed or a commit was made
  since the start, a Bash call is allowed when its whole command is one of `git checkout <args>`,
  `git restore <args>`, `git reset --soft <args>` or `rm <args>`, with no `;`, `&`, `|`, backtick,
  `$`, `>`, `<` or newline in it, and (owner decision of 2026-10-10, spec audit finding M5, plan.md
  decision 16 point 3) every path it names is a protected file still to be restored: a changed
  protected file that existed at the start for `git checkout`/`git restore`, a new protected file
  for `rm`, and `git reset --soft` only when something is committed. No `.`, folder, pattern or file
  uncommitted at the start. Every other tool stays denied. A changed installed team file opens
  no allowance: no command in that list restores it (R16).
- **Wholesale restore denied** (same decision): on every `Bash` call, within budget or not,
  `git reset --hard`, `git clean`, `git stash` (R15's list) and a `git checkout -- <paths>` or
  `git restore <paths>` with `.` among the paths are denied, because each can overwrite or delete
  the developer's uncommitted files (spec Assumptions: "left alone"). The planner extended the
  path rule from `.` to `..`, folders, patterns, pathspec magic and files uncommitted at the start,
  which reach the same files (plan.md decision 16 point 3, to confirm). Words are split per
  command segment (at `;`, `&`, `|`, `(`, `)` and newlines), so a following `&& npm test` is not
  read as paths.
- **Rationale**: without it R5 and R6 deadlock: the end check asks for a restore and R5 denies the
  Bash call that would do it. None of the four commands is in R15's deny list.
- **Rejected**: allowing all Bash while a restore is pending: the agent could run anything in that
  window. Any `git checkout`, `git restore` or `rm` while a restore is pending (the first plan):
  `git restore .` or `rm -rf src` would pass as a restore (finding M5).

## R8. Start record and accepted record: keys and lifetime

- **Decision**: `.git/speckit-team/patch/<key>.json` with `{ sha, dirty, team, at }` (`dirty` maps
  each path dirty at the start to the SHA-256 of its bytes then, R14; `team` maps each installed
  team file to its SHA-256 then, R16), written at the agent's first tool call. `<key>` is
  `agent_id`, or `session_id` when the agent runs as the main thread (`claude --agent patcher`); it
  must match `^[\w-]{1,128}$`. The start record is never deleted by the hook. The accepted record
  (R15) is one file per worktree, `<git dir>/speckit-team/patch-accepted.json`, removed by every
  `patch` call and written only by an accepting end check.
- **Rationale**: as main thread, `Stop` fires at the end of every turn; deleting the start record
  there would start a fresh budget each turn. A few bytes per run is cheap; the README says the
  folder is safe to delete. The existing `agents/` start records are keyed and stored the same way.
  The accepted record has a fixed name because the skill that reads it does not know `patcher`'s
  `agent_id`; it is per worktree (`git rev-parse --absolute-git-dir`, not the common directory) so a
  fast track in a second worktree of the same repo cannot read the first one's.

## R9. Failing closed when the budget cannot be measured

- **Decision**: at PreToolUse, a start record that cannot be read, names a commit git cannot find, or
  has a `dirty` or `team` field of the wrong shape, an invalid line in `.specify/test-paths` as
  committed at the start commit, or a repo with no commit denies the tool and says what to do (delete
  the record, fix and commit the line, commit first). With no `agent_id` and no `session_id`, and for
  every input the hook cannot use, it makes no decision and says so, like every other mode. At the
  end check, the same faults produce a `systemMessage`, no block and no accepted record, so the
  skill commits nothing (R15).
- **Rationale**: an unmeasurable budget is no budget. The retry limit already fails closed on an
  unreadable record (README, "The retry limit"). Under "commit after the check" the end check's
  fail-open path no longer lets a change through: without an accepted record nothing is committed.

## R10. What is prose, not hook

- **Decision**: FR-002 (no PR unless the existing tests passed), FR-003 (passed, failed, skipped or
  not run), FR-004 (regression test first for a behaviour change) and "never merge" are rules in
  `agents/patcher.md` and `skills/speckit-patch/SKILL.md`. That the skill commits only on `DONE`
  with the tests passed, only with an accepted record, and only the record's files, is prose in the
  skill; the hook's part is that no accepted record exists unless the end check accepted the run,
  and that the record never lists a protected or dirty-at-start file (R14, R15). The report's last
  line (`DONE`, `FAILED`, `ESCALATE`) is checked by `ends`.
- **Rationale**: no hook can tell which command is a repo's test suite or whether it passed; this is
  the same split `/speckit-team` has (implementer's `RESULT: GREEN` is its own claim, checked by
  spec-gatekeeper running the gates). Unit tests can only show the installed agent and skill carry
  the rules; the live checks (quickstart L1, L2, L8) are the behavioural evidence.

## R11. Triage is its own skill and runs nothing

- **Decision**: `/speckit-triage <request>` prints one suggestion, `/speckit-patch` or
  `/speckit-team`, with a one-line reason and the command to type. It launches no agent and
  invokes no skill; the developer confirms by typing the command (FR-013).
- **Rationale**: a separate skill keeps `/speckit-patch` usable without triage (FR-013) and needs no
  hook. Signals for `/speckit-team`: a new capability, command, flag or output; a change to a public
  contract; a protected path; more than 30 production lines or 2 production files.
- **Rejected**: triage as the first step of `/speckit-patch` (then the fast track is never usable
  without it); an AskUserQuestion that then runs the chosen track (the spec says it never runs one).

## R12. Installer, board twin, docs media

- **Decision**: no new installer flag: `install.mjs` always installs `patcher` and both skills, and
  `--uninstall` removes them through the existing marker and file list. No `settings.json` change.
  The installer already replaces `{{HOOK}}` in every file it writes (`install.mjs` line 350), so the
  skill can name the installed hook's path (R15). `ROLE_COLOR` in
  `mods/speckit-board/hooks/model.ts` gains `patcher: 'cyan'` because `test/board-mod.test.mjs`
  holds it equal to every `agents/*.md` (CLAUDE.md, Rules); `TEAM` and the board's phases are not
  changed (the board is retired with 001, #11).
- **Docs media** (CLAUDE.md, "Layout"):
  - `docs/media/architecture-visualized.svg` **is updated**: it draws the commands and every agent
    with its model and lane, and the fast track adds a command and an agent.
  - `docs/media/agents-list.gif` **is re-recorded**: the `@` typeahead stops at 15 entries, and a
    seventh team agent (`patcher`, alphabetically between `implementer` and `product-owner`) changes
    which agents it shows; the README paragraph and the tape's comment describe the old list.
  - `guardrail-denial.gif`, `subagent-inline.gif`, `pipeline.gif` and `board.png` **are not**: they
    show architect, spec-auditor, product-owner and the board, none of which changes what it shows.
  - No new recording of the fast track is planned (owner may ask for one).

## R13. SC-005 measurement

- **Decision**: one live `/speckit-patch` run (a one-line typo fix in the scratch repo
  `node docs/media/record.mjs --setup-only` builds, under `claude -p`) measured with
  `node tools/usage.mjs <transcript>`, recorded in README "Context budget" next to the four
  `/speckit-team` runs, with the same columns and its `total_cost_usd`. The same run is the live
  check of the new hook wiring that constitution II requires.
- **Rationale**: same tool and same table as the existing figures, so they compare. No figure is
  promised in advance (SC-005).

## R14. Files already uncommitted at the start: left alone, or the run stops

- **Decision**: the start record keeps, for each path dirty at the start (differing from `HEAD`, or
  untracked), the SHA-256 of its bytes then, or `null` if it did not exist. Such a path stays out of
  the line and file counts, and out of the accepted record, as long as it is as it was. Then:
  - A `Write`, `Edit`, `MultiEdit` or `NotebookEdit` aimed at one is denied before it runs, the
    reason naming the path as the developer's uncommitted work.
  - A change by any other means (Bash, a move, a deletion) makes its bytes differ from the recorded
    hash; and a commit since the start that contains one (`git diff --no-renames --name-only <sha> HEAD`)
    sweeps it in, even with its bytes unchanged. Either puts the path in `dirtyTouched`, which makes
    the run **over budget**: every tool but reporting back is denied (R5), the end check accepts
    nothing, and a commit is blocked at the end until `git reset --soft <sha>` (R6 step 2), after
    which the swept-in work is uncommitted again.
  - At the end, an uncommitted `dirtyTouched` path is named in the stop message (ESCALATE); the hook
    asks for no restore, because it holds only a hash, and restoring to the start commit would
    destroy the developer's work (spec FR-007: dirty files are never touched).
- **Rationale**: the spec leaves out only the changes that existed before the run (Edge Cases,
  Assumptions: "left alone", "not swept into its commit"). Leaving a dirty path out of measurement for
  the whole run let `patcher` make an unmeasured edit of any size to a production file the developer
  had open (FR-005, SC-002). The hook cannot separate the developer's lines from `patcher`'s in one
  file, so a change it cannot measure counts as over the budget, R9's rule that an unmeasurable budget
  is no budget. Denying the write up front keeps a `Write` from overwriting the work at all; the hash
  catches every other route. Comparing bytes, not times, so rewriting identical content is not a
  change. The skill's commit takes only the accepted record's files with `git commit -- <paths>`,
  which leaves the developer's other changes, staged or not, out of it (R15). Constitution VI: the
  record holds a hash, never the content, and stays in the git directory.
- **Rejected**: (a) refusing to start with a dirty tree: the spec's edge case runs the fast track with
  uncommitted changes present, and untracked scratch files are common; (b) denying writes to dirty
  files only: a Bash edit gets past it; (c) a hash only, with no up-front deny: a `Write` would
  overwrite the developer's work before the hook could stop anything; (d) recording the dirty files'
  content to measure `patcher`'s part: it copies the developer's work into hook state, and the spec
  asks for no such split.
- **Cost**: every `patcher` tool call reads each dirty-at-start file once to hash it; not measured,
  and a tree with many untracked files that git does not ignore pays most. The one-Bash-call route of
  the previous plan (edit, commit and push in one command, run before any hook saw it) is closed for
  every command that names `git commit`, `git push` or `gh`: the whole command is denied before it
  runs (R15). What is left is listed in R15, "What remains".

## R15. Commit after the check

Owner decision of 2026-10-09 (plan.md, decision 14, points 1 and 2); the mechanism below is the
planner's (decision 15), confirmed by the owner on 2026-10-10.

- **Decision**:
  - **`patcher` may not write history or reach the remote.** On every `patcher` PreToolUse `Bash`
    call, within budget or not, `patch` denies a command that names one of these git subcommands:
    `commit`, `commit-tree`, `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `stash`, `tag`,
    `branch`, `switch`, `update-ref`, `symbolic-ref`, `notes`, `replace`, `filter-branch`, `push`,
    `pull`, `fetch`, `clone`, `remote`, `ls-remote`, `submodule`, `send-email`, `request-pull`, or
    `checkout` with no `--` word after it; or that names the program `gh` or `hub`. The command is
    split into words at whitespace, newlines and the characters `;`, `&`, `|`, `(`, `)`, `{`, `}`,
    `<`, `>`, backtick, `"`, `'`, `$` and `!`. A word whose last path segment (after `/` or `\`),
    lower-cased and without `.exe`, is `git` starts a git command: the words after it that begin
    with `-` are git's options (`-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`,
    `--exec-path` and `--config-env` written without `=` also take the next word), and the first
    other word is the subcommand. Every `git` word in the command is checked, so
    `sh -c "git push"`, `a && git commit`, `git -C . commit`, `/usr/bin/git push`, `git.exe push`
    and `git -c alias.x='!git push' x` are all caught. A word whose last segment is `gh` or `hub`
    (`.exe` removed) is denied wherever it stands. `git checkout <sha> -- <file>`,
    `git restore <file>`, `git reset` without `--hard`, `git mv`, `git add`, `git status`,
    `git diff`, `git log` and `git show` stay allowed: they change the tree or the index for named
    files, or only read (the wholesale forms are denied, R7).
  - **The skill commits.** `/speckit-patch`, in the main session: before launching `patcher`, it
    notes `git rev-parse HEAD` (the start), creates `patch/<slug>` with `git switch -c` and notes
    `git hash-object -- "<installed hook path>"`. After `patcher` reported `DONE` with the tests
    passed, it commits only when all of these hold: the hook's hash is unchanged, `HEAD` is the
    start, the current branch is `patch/<slug>`, and the accepted record exists with `sha` equal to
    the start. It then runs `git add -- <untracked>` and `git commit -m <message> -- <files>` with
    the record's two lists, `git push -u origin patch/<slug>` (never forced), and `gh pr create` if
    there is a GitHub remote. On any failed check it commits nothing and tells the user which check
    failed and that the work is uncommitted in the working tree. When the record's `files` is empty
    it commits, pushes and opens nothing and says `patcher` changed no file:
    `git commit -m <message> --` with no path commits the whole index, the developer's staged work
    included (owner decision of 2026-10-10, spec audit finding H1, plan.md decision 16 point 1;
    verified the same day with git 2.55.0.windows.5).
  - **The accepted record**: `<git dir>/speckit-team/patch-accepted.json`,
    `{ key, sha, files, untracked, lines, filesTouched, at }` (data-model.md). Every `patch` call, on
    any event, first removes it; only an end check that reaches outcome 5 (R6: no protected or team
    change, `HEAD` at the start, within budget) writes it, as its last step. `files` is every path
    `patcher` changed (production, test and doc; both sides of a rename), `untracked` the ones git
    does not track yet; neither ever holds a path dirty at the start or a protected path.
- **Rationale**: the end check is the only point that sees the whole run; a commit made before it
  holds whatever the run did, and a push made before it cannot be undone. The record turns "the end
  check passed" into something the skill can read and a test can assert: it exists only if the last
  `patch` call was an accepted end, because any later tool call of `patcher` removes it before the
  tool runs, and an end that blocks or fails removes it too, so a record left by an earlier run, or
  written by `patcher` itself through Bash, never reaches the skill. `git commit -- <paths>` (git's
  `--only` mode) commits those paths' working-tree state and nothing else from the index: verified
  on 2026-10-10 with git 2.55.0.windows.5 in a scratch repo, where a `git mv` rename, a plain `rm`,
  a new file and a developer's staged change to another file gave a commit of exactly the rename,
  the deletion and the new file, with the developer's change still staged. In the same repo,
  `git add -- <path>` failed ("pathspec did not match any files") for the old side of a `git mv`,
  and `git commit -- <path>` failed for a file never added, which is why the record keeps
  `untracked` apart: only those are added, and `git commit` takes the whole list. The skill checks
  the hook's hash itself because a Bash rewrite of the installed hook replaces the code that runs
  the end check (R16); the skill's instructions were loaded before `patcher` ran, and
  `git hash-object` is not the hook. The skill creates the branch so `patcher` never needs `switch`
  or `branch`; denying both, and `checkout` without `--`, keeps `HEAD` on the run's branch, where
  `git reset --soft <start>` (R6 step 2) is the right undo.
- **What remains** (README, Known limits, T018). The fast track guards against an agent's mistakes
  and drift, not against deliberate evasion through the shell (the spec's threat model), so the
  first and third items below are known limits by design, not defects to close later:
  - A commit, push or pull request made by a program whose command does not name it is not denied
    before it runs: a git alias (`git ci`), `npm version`, a script, `make release`, `curl` to the
    GitHub API. A commit is still caught: the end check blocks until `git reset --soft <start>`, and
    the skill commits only when `HEAD` is the start. A push or pull request such a program made has
    already reached the remote; the skill never force-pushes, so its own push to a branch the
    program already pushed fails instead of overwriting it, and the developer deletes the stray
    branch or pull request.
  - The match is on words, not on what runs: a command that only mentions a denied word (for example
    `echo "git push"`, or `ls ~/.config/gh`) is denied too. The message says what to do instead.
  - The guardrail state under the git directory is protected from `Write` and `Edit`, not from Bash
    (README, "Read-only isn't airtight"). A Bash rewrite of the start record can hide a change from
    the end check; a protected file hidden that way is still not in the accepted record's list, so
    the skill does not commit it, and it stays uncommitted in the working tree.
  - One fast-track run per worktree at a time: two runs in one worktree share the accepted record
    (and the working tree).
- **Rejected**: (a) the end check also comparing the remote with the start: it can report a pushed
  change, not unpush it; (b) the skill re-hashing each listed file before committing: between the
  accepted end and the commit only the main session runs, and the record already holds the accepted
  list; (c) a main-session hook on the skill's `git commit`: skill-scoped hooks are unverified here
  (R1 a); (d) the skill committing with `git add -A`: it sweeps in the developer's files.

## R16. The installed team is hashed at the start and checked at the end

Owner decision of 2026-10-09 (plan.md, decision 14, point 4); the file set and the hook-hash check in
the skill are the planner's (decision 15), confirmed by the owner on 2026-10-10 with one change: a
changed settings file ends the run `FAILED` instead of blocking.

- **Decision**: the start record's `team` maps each installed team file, relative to `TEAM_DIR` with
  forward slashes, to the SHA-256 of its bytes: every regular file directly in `TEAM_DIR/agents/`,
  directly in `TEAM_DIR/hooks/` and directly in each `TEAM_DIR/skills/<name>/`, plus
  `settings.json` and `settings.local.json` (always listed; `null` when missing). The end check
  lists the same set again; a path whose hash differs, that is new, or that is gone is a team change.
  - Any team file changed, agent, hook, skill or settings file alike (owner decisions of
    2026-10-10: plan.md decision 15 point 5 for the settings files, decision 16 point 2 and spec
    audit finding M2 for the rest): no block. The end check lets the run finish (R6 step 3),
    writes no accepted record and shows a `systemMessage` naming each file under `TEAM_DIR` and
    saying the run ended `FAILED`, so `/speckit-patch` commits nothing and opens no PR; for an
    agent, hook or skill file it says to reinstall the team (`node install.mjs` from the
    speckit-agents checkout). The hook holds only a hash, `patcher` may not write there and no
    command it may run restores an installed file, and Claude Code or the developer may write the
    settings files during any session, so blocking would leave no way out but stopping the run by
    hand: even `ESCALATE` could not finish.
  The skill separately compares `git hash-object` of the installed hook before and after `patcher`
  and commits nothing on a difference (R15).
- **Rationale**: FR-007 requires the end check to catch a protected change made by other means, and
  the installed team is protected (R4); `isTeamFile` alone covers only `Write` and `Edit` (spec
  audit finding H2). One directory level per folder covers what the installer writes
  (`agents/<name>.md`, `hooks/speckit-team.mjs`, `skills/<name>/SKILL.md`) and whatever sits beside
  it, read with `fs.readdirSync`, which Node 18 supports without the `recursive` option (added in
  18.17). Hashing happens at the first tool call and at each end check, not on every tool call. The
  installed hook checking its own hash proves nothing once it has been rewritten, because the
  rewritten code is what runs the check; hence the skill's own comparison.
- **Limits** (README, Known limits, T018): files deeper than one level (`skills/x/sub/file`) are
  denied to `Write` and `Edit` but not hashed. A change Claude Code or the developer makes to
  `settings.json` or `settings.local.json` in the config directory during the run (a setting changed
  in `/config`, a permission saved there) cannot be told apart from one `patcher` made, so it ends
  the run `FAILED` with nothing committed, and the developer re-runs the change; so does any other
  change to a hashed team file, whoever made it. A Bash write
  anywhere else outside the repo is not caught: deliberate evasion through the shell is outside what
  the fast track guards against (the spec's threat model).
- **Rejected**: blocking the end on a changed team file (the first plan; replaced by the owner on
  2026-10-10, first for the settings files and then, after finding M2, for every team file,
  because `patcher` cannot restore one and the run would loop until stopped by hand); hashing the whole config directory (it holds Claude Code's own state,
  written during every session); a recursive walk of `skills/` (a user's skill folder may hold thousands of files,
  hashed twice per run); checking the team on every tool call (the owner asked for the end check, and
  a team change matters only once the run would be accepted); hashing only files that carry the
  installer's marker (a new file beside them, such as a new skill, would not be seen).
