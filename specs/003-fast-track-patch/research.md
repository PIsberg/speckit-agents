# Research: Fast track for small changes

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-09

No `NEEDS CLARIFICATION` remained in the spec or the Technical Context. Each entry below is a design
decision, the reason for it, and what was rejected.

## R1. One new agent, launched by a new skill

- **Decision**: `/speckit-patch <change>` is a skill in the main session that launches one new
  subagent, `patcher`, in the foreground. `patcher` makes the change, runs the tests, commits, pushes
  and opens the pull request. All of the fast track's hooks sit in `patcher`'s frontmatter.
- **Rationale**: SC-001 counts "1 agent stage". Agent frontmatter hooks are the mechanism this repo
  has already verified end to end (`test/e2e.test.mjs`), and they fire only while that agent runs, so
  `/speckit-team`'s agents, gates and lanes are not touched at all (FR-009) and `settings.json`
  gets no new entry. Opening the PR inside the hooked agent puts the commit and the PR behind the
  budget hook (FR-006): once over budget, the `git commit` and `gh pr create` calls are denied.
- **Rejected**: (a) the skill doing the work in the main session with skill-scoped hooks: those are
  not verified in this repo, and a main-session PreToolUse hook would see every tool call of every
  session in a Spec Kit repo; (b) reusing `implementer`: its `gate retries` hook denies everything
  until an audit has passed, which a fast-track run never has; (c) the main session opening the PR
  after the report: that step is prose, with no hook between an over-budget change and `gh pr create`.

## R2. Hook modes: one new scope rule, one new mode

- **Decision**: `scope protected` (a new rule of the existing `scope` mode) denies `Write`, `Edit`,
  `MultiEdit` and `NotebookEdit` to protected paths. A new mode `patch` keeps the run's start record,
  measures the change on every tool call, and runs the end-of-run check on `SubagentHandback`,
  `SubagentStop` and `Stop`. `patcher`'s report word is checked by the existing `ends` mode
  (`ends DONE FAILED ESCALATE`).
- **Rationale**: `scope` already resolves paths through symlinks, junctions and 8.3 names, guards
  the git directory and handles mistyped `file_path`; a new rule inherits all of it. `ends` already
  refuses a report without its word once and never twice. Only the budget and the end check are new
  logic.
- **Rejected**: a second hook script (the installer, the smoke check and `CLAUDE.md` assume one
  script); folding the protected-path check into `patch` (it would duplicate the path resolution).

## R3. What counts as a changed line, a file touched, a test and a doc

- **Decision**:
  - The change is everything that differs from the start commit, committed or not, plus untracked
    files not ignored by git: `git diff --find-renames --numstat <start>` (with `--name-status` for
    the change type) and `git ls-files --others --exclude-standard`. Files already dirty at the start are left out
    (spec, Edge Cases).
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
    dirty list is left out, like any dirty path. A rename under 50% similarity is, to git, a deletion
    and an addition, and counts as 2 files.
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
    (contracts/hook-cli.md); `agents/patcher.md` says to move files with `git mv`.
  - A path is **protected** first (R4), then a **test** if the existing `isTest()` says so (built-in
    patterns plus `.specify/test-paths`), then **documentation** if it ends in `.md`, `.mdx`,
    `.markdown`, `.rst`, `.adoc`, `.asciidoc` or `.txt` (case-insensitive). Everything else is
    **production**. Only production files count toward the budget (FR-005).
- **Rationale**: the owner's rule (2026-10-09): a small fix is usually an in-place edit, and a modified
  line is one line of change to a reviewer. A reviewer can still check the hook's number by hand:
  per file, the larger of the two `git diff --numstat` columns, which `git diff -M --numstat` prints
  for a rename too. Rename detection is the owner's rule (2026-10-09): moving a file is not a change
  in its content, and counting it twice would spend half the file budget on one move. Counting a
  rename across classes without detection keeps a test moved into production code from reading as a
  free file, the reason the plan first chose `--no-renames` (the lane check's choice, unchanged). A
  docs folder is not a doc rule because folders hold code too (`docs/media/record.mjs` in this
  repo).
- **Rejected**: insertions plus deletions (what `git diff --shortstat` prints): a modified line
  counts 2, so 15 in-place edits fill the budget; the owner rejected it on 2026-10-09. No rename
  detection (`--no-renames`, the first plan): a renamed file counted as 2 files and twice its
  lines; the owner rejected it on 2026-10-09. Staging into a temporary index to pair a plain `mv`:
  `git add` writes objects into the repository, which the hook never does.
- **Owner decision**: confirmed on 2026-10-09 as max(insertions, deletions) per production file, and
  in a second answer the same day, with git's rename detection: a pure rename 0 lines and 1 file, a
  rename with edits its edited lines and 1 file (plan.md, "Decisions to confirm", 3). The handling of
  a rename across classes and of a move git does not see is the planner's, not yet confirmed.

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
  (`fileURLToPath(import.meta.url)`, two levels up). The git directory is already denied by every
  `scope` rule.
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
  working tree is the planner's choice, not yet confirmed by the owner.
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
  FR-006 message (measured counts, limits, "make no commit, open no pull request, leave the work
  uncommitted, report ESCALATE", `/speckit-team`). Reporting back is never denied for the budget.
  The one exception is described in R7.
- **Rationale**: PreToolUse sees the tree before the tool runs, so the write that crosses the line
  goes through, and the work stays in the working tree as FR-006 requires; the next call, which
  would be the commit, is denied. This mirrors `gate retries`, which already stops implementer the
  same way.
- **Rejected**: denying only commands that look like `git commit` or `gh pr create`: a string match
  on shell commands misses aliases and scripts.
- **Cost**: three or four `git` calls per `patcher` tool call, on top of the two the hook already
  makes. Not measured; `patcher` is the only agent that pays it. Constitution III's overhead budget
  is for observers, and this is a guardrail.

## R6. The end-of-run check

- **Decision**: on `SubagentHandback` (PreToolUse), `SubagentStop` and `Stop`, `patch` measures again
  and, in this order:
  1. Protected files changed since the start (not dirty at the start): block (Stop) or deny
     (handback) naming each file and its restore command, `git checkout <start sha> -- <file>` or
     "delete it" for a new file. It blocks on every attempt until they are restored, including when
     `stop_hook_active` is set (spec Clarifications, FR-007).
  2. Over budget and `HEAD` is no longer the start commit (a commit slipped through, for example in
     the same Bash call as the edit): block or deny, asking for `git reset --soft <start sha>`, which
     keeps the work uncommitted, until `HEAD` is back.
  3. Over budget, nothing committed: let it finish, with a `systemMessage` giving the counts, the
     limits, that the work is uncommitted, and `/speckit-team`.
  4. Within budget: let it finish, with a `systemMessage` giving the size against the budget
     (User Story 1, scenario 3).
  The hook itself runs no git command that changes anything.
- **Rationale**: the protected rule and the stop-for-budget rule pull in opposite directions
  (spec: over-budget production changes stay; protected changes must be restored), and the order
  above gives each its own outcome.
- **Differs from the lane check**, which warns and lets the agent go on its second stop. The spec
  says "until they are restored", so a model that never restores loops. Confirmed by the owner on
  2026-10-09 (plan.md, "Decisions to confirm", 5).

## R7. Restoring while over budget

- **Decision**: while over budget, and only if a protected file changed or a commit was made since
  the start, a Bash call is allowed when its whole command is one of `git checkout <args>`,
  `git restore <args>`, `git reset --soft <args>` or `rm <args>`, with no `;`, `&`, `|`, backtick,
  `$(`, `>`, `<` or newline in it. Every other tool stays denied.
- **Rationale**: without it R5 and R6 deadlock: the end check asks for a restore and R5 denies the
  Bash call that would do it.
- **Rejected**: allowing all Bash while a restore is pending: the agent could commit and push in
  that window.

## R8. Start record key and lifetime

- **Decision**: `.git/speckit-team/patch/<key>.json` with `{ sha, dirty, at }`, written at the
  agent's first tool call. `<key>` is `agent_id`, or `session_id` when the agent runs as the main
  thread (`claude --agent patcher`); it must match `^[\w-]{1,128}$`. The record is never deleted by
  the hook.
- **Rationale**: as main thread, `Stop` fires at the end of every turn; deleting the record there
  would start a fresh budget each turn. A few bytes per run is cheap; the README says the folder is
  safe to delete. The existing `agents/` start records are keyed and stored the same way.

## R9. Failing closed when the budget cannot be measured

- **Decision**: at PreToolUse, a start record that cannot be read or names a commit git cannot find,
  an invalid `.specify/test-paths` line, or a repo with no commit denies the tool and says what to do
  (delete the record, fix the line, commit first). With no `agent_id` and no `session_id`, and for
  every input the hook cannot use, it makes no decision and says so, like every other mode. At the
  end check, the same faults produce a `systemMessage` and no block.
- **Rationale**: an unmeasurable budget is no budget. The retry limit already fails closed on an
  unreadable record (README, "The retry limit").

## R10. What is prose, not hook

- **Decision**: FR-002 (no PR unless the existing tests passed), FR-003 (passed, failed, skipped or
  not run), FR-004 (regression test first for a behaviour change), "commit only your own files" and
  "never merge" are rules in `agents/patcher.md`. The report's last line (`DONE`, `FAILED`,
  `ESCALATE`) is checked by `ends`.
- **Rationale**: no hook can tell which command is a repo's test suite or whether it passed; this is
  the same split `/speckit-team` has (implementer's `RESULT: GREEN` is its own claim, checked by
  spec-gatekeeper running the gates). Unit tests can only show the installed agent carries the
  rules; the live check (quickstart L1, L2) is the behavioural evidence.

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
  `ROLE_COLOR` in `mods/speckit-board/hooks/model.ts` gains `patcher: 'cyan'` because
  `test/board-mod.test.mjs` holds it equal to every `agents/*.md` (CLAUDE.md, Rules); `TEAM` and the
  board's phases are not changed (the board is retired with 001, #11).
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
