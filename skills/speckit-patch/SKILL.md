---
# speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.
name: speckit-patch
description: The fast track for a small change: one patcher run, then a commit and a pull request on a patch branch.
argument-hint: "[--project <name>] <small change>"
disable-model-invocation: true
---

Make this small change through the fast track: $ARGUMENTS

The main session launches `patcher` once, checks its work and commits it. `patcher` itself never
commits. Hooks and limits: the README.md of the speckit-agents repo.

`--project` takes exactly the next word: `--project <name>`. If given without `<name>` (or with a missing name) or twice, refuse before launching: say why and list available projects by running `node "{{HOOK}}" project`. Check `<name>` against the project name pattern (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, letters, digits, `-` and `_` only, at most 64 characters). If invalid, tell the user in one line that `<name>` is not a valid project name and stop with nothing launched.

## 1. Preconditions
- Run `node "{{HOOK}}" check` in one Bash call. On exit 1, show its lines and stop with nothing launched:
  the team that would run is not this install alone (#230). On exit 0, show any `note:` line, then go on.
- `.specify/` exists. If not, stop: the fast track's hooks are inactive without it.
- If the working tree is dirty, list the files, say they will not be counted or committed, and ask
  before going on.
- Your Agent tool has a `run_in_background` parameter. If not, Claude Code has fork subagents on
  and runs every agent in the background, which costs an extra waiting request. Tell the user once,
  in one line, that `CLAUDE_CODE_FORK_SUBAGENT=0` in the shell or under `env` in settings.json
  (`node install.mjs --no-fork` writes it for every project), then a restart, brings foreground
  launches back. Then go on.

## 2. Before launching
- If a project is active (`--project <name>` was given): in one Bash call, run `node "{{HOOK}}" project '<name>'` (single-quoted). If it exits non-zero:
  - If the output contains `no project <name> in .specify/projects/; create it with --init.`: ask the user once with AskUserQuestion whether to create it (`Create project <name>?`). On yes, run `node "{{HOOK}}" project '<name>' --init`, show its output line, and stop with nothing launched. On no, stop with nothing launched.
  - Otherwise, show what it printed and stop on exit 1 before creating the branch.
  If it exits 0, tell the user in one line the active project from the header line before launching.
- Note `git rev-parse HEAD` (the start), `git hash-object -- "{{HOOK}}"` (the installed hook's
  hash) and `git for-each-ref --format='%(refname) %(objectname)' refs/remotes` (the remote-tracking
  refs), in one Bash call. Your notes are out of `patcher`'s reach; the hook's own start record is not.
- Create the branch with `git switch -c patch/<slug>` from the current commit. If that commit is
  not on `main` or `master`, say what it is.

## 3. Launch
Launch `patcher` once, in the foreground (`run_in_background: false`), with the change as given and, when a project is active, one `Project: <name>` line (for example, `Project: billing`) and nothing else.

## 4. Commit
On `DONE` with the report stating the existing tests passed, commit only when every check holds:
- `git hash-object -- "{{HOOK}}"` equals the noted hash.
- `git rev-parse HEAD` equals the start.
- `git branch --show-current` is `patch/<slug>`.
- `$(git rev-parse --git-dir)/speckit-team/patch-accepted.json` exists and its `sha` equals the start.
- `git for-each-ref --format='%(refname) %(objectname)' refs/remotes` prints refs that equal the noted
  refs. A change means a push or a fetch happened: also tell the user to check the remote for a pushed
  branch or a pull request.
- No file you listed as dirty in step 1 is in the record's `files` or `untracked`.

If the record's `files` is empty, commit nothing, push nothing and open no pull request, and report
that `patcher` changed no file: `git commit -m "<message>" --` with no path commits everything
already staged, the developer's work included.

Otherwise:
1. `git add -- <each path in untracked>` (skipped when `untracked` is empty).
2. `git commit -m "<message>" -- <each path in files>`, every path quoted. Never `git add -A`, never
   `git commit -a`.
3. `git push -u origin patch/<slug>`. Never `--force`.
4. `gh pr create` if there is a GitHub remote. Watch the PR's CI per the git rules in `CLAUDE.md`;
   on red, report it to the user, with no automatic fix round.

If a check fails, commit nothing and report the run as FAILED, say which check failed, and that
the work is uncommitted in the working tree. A missing accepted record is such a check: its cause is
the `outcome` (`stopped`, `failed`) and `message` of `$(git rev-parse --git-dir)/speckit-team/patch-undo.json`
when its `sha` equals the start. Quote the message; never work a cause out from other files. No
such record: say the end check left none.

## 5. Report
When nothing was committed (`FAILED`, `ESCALATE`, a failed check), read
`$(git rev-parse --git-dir)/speckit-team/patch-undo.json` first: the undo below is part of the report.

Relay the outcome in at most 5 lines: what changed, the active project (if one was active), the size against the budget, the test outcome,
the PR link.
- `FAILED`: say which test failed or that tests were not run; no commit, no PR; then the undo.
- `DONE` with an empty `files`: say that `patcher` changed no file; no commit, no PR.
- `ESCALATE`: say why, that the work is uncommitted in the working tree, and that `/speckit-team`
  is the way on; then the undo. Never start `/speckit-team`.

The undo: if the record's `sha` equals the start and its `undo` is not `null`, show that command,
the one that takes back `patcher`'s changes and nothing else, and ask whether to run it; run it
exactly as given, only on an explicit yes. No file, another `sha` or `null`: say there is nothing
to undo that way. Never undo any other way (`git stash`, `git reset --hard`, `git clean`,
`git checkout .`): those take the developer's own uncommitted work too.

## 6. Merging
Never merge.
