# Contract: commands, agent and installed files

These are public contracts under constitution V: a slash command, an agent name and installed file
names are things users type and other tools can find.

## `/speckit-patch <change>`

File: `skills/speckit-patch/SKILL.md`, installed to `<claude dir>/skills/speckit-patch/SKILL.md`.
Frontmatter: `name: speckit-patch`, `argument-hint: "<small change>"`,
`disable-model-invocation: true`, and the marker comment line.

Steps the skill gives the main session:

1. Preconditions: `.specify/` exists, or stop (the fast track's hooks are inactive without it).
   If the working tree is dirty, list the files, say they will not be counted or committed, and ask
   before going on. The same foreground-launch check as `/speckit-team` step 0.
2. Launch `patcher` once, in the foreground, with the change as given, and nothing else.
3. Relay the report in at most 5 lines: what changed, the size against the budget, the test outcome,
   the PR link.
   - `DONE`: watch the PR's CI per the git rules in `CLAUDE.md`; on red, report it to the user (no
     automatic fix round).
   - `FAILED`: say which test failed or that tests were not run; no PR exists.
   - `ESCALATE`: say why, that the work is uncommitted in the working tree, and that
     `/speckit-team` is the way on. Never start `/speckit-team`.
4. Never merge.

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
description: <one sentence: the fast track for small changes, one pass, budget 30 production lines and 2 files, protected paths denied; use through /speckit-patch; not for features>
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
- Process: note `git status --short` first, those files are not yours: never edit, move, delete,
  stage or commit them (a hook denies a write to one and stops the run if one changes or is
  committed; research R14); `git switch -c patch/<slug>`
  from the current commit and say what that commit is if it is not on `main` or `master`; for a
  change in behaviour, write a regression test first and show it failing (FR-004; typos, comments,
  docs and config values with no behaviour are exempt); make the change; run the existing tests and
  check the command's own exit status; move or rename a file only with `git mv` (a plain `mv`
  counts as a deleted and a new file against the budget); only if they passed, stage your own files by name (never
  `git add -A` or `git commit -a`), commit once, push the branch and open a PR with `gh pr create` if there is a GitHub
  remote (FR-002). Never merge. Never start `/speckit-team`.
- Lane: everything except the protected paths; at most 30 changed production lines (a modified
  line counts once) and 2 production files, tests and docs not counted, no binary production file. A hook enforces both.
  When a hook stops you for the budget, commit nothing and report `ESCALATE`.
- Report: at most 10 lines: files changed, the size, the exact test command and its result stated
  as passed, failed, skipped or not run (FR-003), the branch and PR link. Last line exactly `DONE`,
  `FAILED` or `ESCALATE`.

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

`<git common dir>/speckit-team/patch/<key>.json`, one per run, never committed, safe to delete.
`verdicts/`, `retries/` and `ends/` are not written by the fast track (FR-009); `ends` keeps its
existing per-agent `agents/<id>.ends-ok` and `.ends-asked` markers.
