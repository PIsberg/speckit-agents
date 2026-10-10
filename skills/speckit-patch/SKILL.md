---
# speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.
name: speckit-patch
description: The fast track for a small change: one patcher run, then a commit and a pull request on a patch branch.
argument-hint: "<small change>"
disable-model-invocation: true
---

Make this small change through the fast track: $ARGUMENTS

The main session launches `patcher` once, checks its work and commits it. `patcher` itself never
commits. Hooks and limits: the README.md of the speckit-agents repo.

## 1. Preconditions
- `.specify/` exists. If not, stop: the fast track's hooks are inactive without it.
- If the working tree is dirty, list the files, say they will not be counted or committed, and ask
  before going on.
- Your Agent tool has a `run_in_background` parameter. If not, Claude Code has fork subagents on
  and runs every agent in the background, which costs an extra waiting request. Tell the user once,
  in one line, that `CLAUDE_CODE_FORK_SUBAGENT=0` in the shell or under `env` in settings.json
  (`node install.mjs --no-fork` writes it for every project), then a restart, brings foreground
  launches back. Then go on.

## 2. Before launching
- Note `git rev-parse HEAD` (the start) and `git hash-object -- "{{HOOK}}"` (the installed hook's
  hash).
- Create the branch with `git switch -c patch/<slug>` from the current commit. If that commit is
  not on `main` or `master`, say what it is.

## 3. Launch
Launch `patcher` once, in the foreground (`run_in_background: false`), with the change as given and
nothing else.

## 4. Commit
On `DONE` with the report stating the existing tests passed, commit only when every check holds:
- `git hash-object -- "{{HOOK}}"` equals the noted hash.
- `git rev-parse HEAD` equals the start.
- `git branch --show-current` is `patch/<slug>`.
- `$(git rev-parse --git-dir)/speckit-team/patch-accepted.json` exists and its `sha` equals the start.

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
the work is uncommitted in the working tree. A missing accepted record is such a check; one cause
is an installed team file (an agent, hook, skill or settings file in the config directory) changed
during the run, which the hook's message names.

## 5. Report
Relay the outcome in at most 5 lines: what changed, the size against the budget, the test outcome,
the PR link.
- `FAILED`: say which test failed or that tests were not run; no commit, no PR.
- `DONE` with an empty `files`: say that `patcher` changed no file; no commit, no PR.
- `ESCALATE`: say why, that the work is uncommitted in the working tree, and that `/speckit-team`
  is the way on. Never start `/speckit-team`.

## 6. Merging
Never merge.
