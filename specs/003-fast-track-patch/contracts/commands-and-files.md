# Contract: commands, agent and installed files

These are public contracts under constitution V: a slash command, an agent name and installed file
names are things users type and other tools can find.

## `/speckit-patch <change>`

File: `skills/speckit-patch/SKILL.md`, installed to `<claude dir>/skills/speckit-patch/SKILL.md`,
with `{{HOOK}}` replaced by the installed hook's absolute path (the installer already does this for
every file it writes). Frontmatter: `name: speckit-patch`, `argument-hint: "<small change>"`,
`disable-model-invocation: true`, and the marker comment line.

Steps the skill gives the main session (research R15; owner decision of 2026-10-09, plan.md
decision 14):

1. Preconditions: `.specify/` exists, or stop (the fast track's hooks are inactive without it).
   If the working tree is dirty, list the files, say they will not be counted or committed, and ask
   before going on. The same foreground-launch check as `/speckit-team` step 0.
2. Before launching: note `git rev-parse HEAD` (the start) and `git hash-object -- "{{HOOK}}"` (the
   installed hook's hash); create the branch with `git switch -c patch/<slug>` from the current
   commit, and say what that commit is if it is not on `main` or `master`.
3. Launch `patcher` once, in the foreground, with the change as given, and nothing else.
4. On `DONE` with the report stating the existing tests passed, commit only when every check holds:
   `git hash-object -- "{{HOOK}}"` equals the noted hash; `git rev-parse HEAD` equals the start;
   `git branch --show-current` is `patch/<slug>`; `$(git rev-parse --git-dir)/speckit-team/patch-accepted.json`
   exists and its `sha` equals the start. If the record's `files` is empty, commit nothing, push
   nothing and open no pull request, and report that `patcher` changed no file (owner decision of
   2026-10-10, plan.md decision 16 point 1: `git commit -m "<message>" --` with no path commits
   everything already staged, the developer's work included). Otherwise
   `git add -- <each path in untracked>` (skipped when `untracked` is empty) and
   `git commit -m "<message>" -- <each path in files>` (every path quoted; never `git add -A`, never
   `git commit -a`), `git push -u origin patch/<slug>` (never `--force`), and `gh pr create` if
   there is a GitHub remote. Watch the PR's CI per the git rules in `CLAUDE.md`; on red, report it to
   the user (no automatic fix round). If a check fails: commit nothing and report the run as
   `FAILED`, say which check failed, and that the work is uncommitted in the working tree. A missing
   accepted record is such a check; one cause is an installed team file (an agent, hook, skill or
   settings file in the config directory) changed during the run, which the hook's message names
   (contracts/hook-cli.md, message C; plan.md decision 15 point 5 and decision 16 point 2).
5. Relay the outcome in at most 5 lines: what changed, the size against the budget, the test
   outcome, the PR link.
   - `FAILED`: say which test failed or that tests were not run; no commit, no PR.
   - `DONE` with an empty `files`: say that `patcher` changed no file; no commit, no PR.
   - `ESCALATE`: say why, that the work is uncommitted in the working tree, and that
     `/speckit-team` is the way on. Never start `/speckit-team`.
6. Never merge.

## `/speckit-triage <request>`

File: `skills/speckit-triage/SKILL.md`, installed to `<claude dir>/skills/speckit-triage/SKILL.md`.
Frontmatter: `name: speckit-triage`, `argument-hint: "<request>"`,
`disable-model-invocation: true`, and the marker comment line.

Output: one suggestion with a one-line reason and the exact command to type, for example
`Suggested: /speckit-team <request> (adds a new installer flag, a public contract)`. It launches no
agent and invokes no skill (FR-013). Signals for `/speckit-team`: a new capability, command, flag
or output; a change to a public contract; a protected path (README, "The fast track"); more than 30
production lines or 2 production files.

## Agent `patcher`

File: `agents/patcher.md`, installed to `<claude dir>/agents/patcher.md`.

Frontmatter:

```yaml
name: patcher
description: <one sentence: the fast track for small changes, one pass, budget 30 production lines and 2 files, protected paths denied, changes the working tree only; use through /speckit-patch; not for features>
tools: Read, Write, Edit, Bash
model: sonnet
color: cyan
hooks:
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: 'node "{{HOOK}}" patch'
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: 'node "{{HOOK}}" scope protected'
    - matcher: "SubagentHandback"
      hooks:
        - type: command
          command: 'node "{{HOOK}}" ends DONE FAILED ESCALATE'
  Stop:
    - hooks:
        - type: command
          command: 'node "{{HOOK}}" patch'
        - type: command
          command: 'node "{{HOOK}}" ends DONE FAILED ESCALATE'
```

Body sections (Inputs, Process, Lane, Report), carrying these rules:

- Inputs: the change in the prompt, the code it touches, and `CLAUDE.md`, the CI workflow or the
  build file for the test command. No `specs/` artifacts.
- Process: note `git status --short` first, those files are not yours: never edit, move or delete
  them (a hook denies a write to one and stops the run if one changes; research R14); you work on
  the branch `/speckit-patch` created; for a change in behaviour, write a regression test first and
  show it failing (FR-004; typos, comments, docs and config values with no behaviour are exempt);
  make the change; move or rename a file only with `git mv` (a plain `mv` counts as a deleted and a
  new file against the budget); run the existing tests and check the command's own exit status.
  Restore a file only by naming it (`git checkout <sha> -- <file>`); never `git reset --hard`,
  `git clean`, `git stash`, or a `git checkout`/`git restore` of `.`, a folder or a pattern: a
  hook denies them, because they destroy the developer's uncommitted work (plan.md decision 16).
  Never commit, never push, never run `gh`, never switch branch: a hook denies them, and
  `/speckit-patch` commits your files after the end-of-run check accepts the run (research R15).
  Never merge. Never start `/speckit-team`.
- Lane: the working tree, everything except the protected paths; at most 30 changed production
  lines (a modified line counts once) and 2 production files, tests and docs not counted, no binary
  production file. A hook enforces both. When a hook stops you for the budget, report `ESCALATE`.
- Report: at most 10 lines: files changed, the size, the exact test command and its result stated
  as passed, failed, skipped or not run (FR-003). Last line exactly `DONE` (tests passed), `FAILED`
  or `ESCALATE`.

## Installed files and settings

| Installed file | Added by this feature |
|---|---|
| `agents/patcher.md` | yes |
| `skills/speckit-patch/SKILL.md` | yes |
| `skills/speckit-triage/SKILL.md` | yes |
| `hooks/speckit-team.mjs` | no, existing; gains the `patch` mode and the `protected` scope rule |
| `settings.json` | no change: no new gate entry |

All carry the `speckit-agents: managed by install.mjs` marker; install and `--uninstall` treat them
like the existing agents and skill. No new installer flag. `install.mjs --help` and the final
"Done. Next:" message mention `/speckit-patch` and `/speckit-triage`.

## Hook state

- `<git common dir>/speckit-team/patch/<key>.json`: the start record, one per run, never committed,
  safe to delete.
- `<git dir>/speckit-team/patch-accepted.json`: the accepted record, at most one per worktree,
  present only between an accepted end of `patcher`'s run and its next hook call (research R15).
  `/speckit-patch` reads it; nothing else does. Safe to delete (the skill then commits nothing).
- `verdicts/`, `retries/` and `ends/` are not written by the fast track (FR-009); `ends` keeps its
  existing per-agent `agents/<id>.ends-ok` and `.ends-asked` markers.
