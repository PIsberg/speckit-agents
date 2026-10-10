# Quickstart and live checks: Fast track for small changes

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## Use it

```text
/speckit-triage fix the typo "recieve" in src/greet.js     # optional: suggests a track, runs nothing
/speckit-patch fix the typo "recieve" in src/greet.js      # branch, one patcher run, then commit and PR
```

`patcher` changes the working tree and runs the tests; it never commits. Its report ends `DONE`
(tests passed), `FAILED` (tests failed or not run) or `ESCALATE` (over 30 production lines or 2
production files, a binary production file, or a protected path: the work stays uncommitted, use
`/speckit-team`). Only on `DONE`, and only after the hook accepted the end of the run, does
`/speckit-patch` commit `patcher`'s files, push the branch and open the PR. A line modified in place
counts once toward the 30.

## Live checks (constitution II, SC-005)

Run after `npm test` is green and the team is reinstalled. Scratch repo: the one
`node docs/media/record.mjs --setup-only` builds (a Spec Kit repo with the team installed into its
`.claude/`, README "Recording the demo media"), committed, with a small production file and one
passing test added if it has none. In Git Bash prefix `claude -p` with `MSYS_NO_PATHCONV=1`
(README "Live check"), and accept the folder-trust prompt once, or the agent's frontmatter hooks are
skipped (README "Troubleshooting"). Each check records the date, the Claude Code version, what was
observed, and the cost from `--output-format json`.

| ID | Prompt (`claude -p`, from the scratch repo) | Expect |
|---|---|---|
| L1 | `/speckit-patch fix the spelling of "Hello" in the greeting` (after seeding a typo) | branch `patch/...` created by the skill; one `patcher` launch; `npm test` (or the repo's test command) reported passed; report ends `DONE`; the `fast track: 1 of 30 production lines, 1 of 2 production files ... accepted` message (the fix modifies one line, which counts 1); then one commit by the main session holding only the fixed file; nothing under `specs/` created. Measure this run with `node tools/usage.mjs <transcript>` (SC-005). |
| L2 | `/speckit-patch` asking for a change that makes an existing test fail | report names the failing test, ends `FAILED`; no commit, no PR |
| L3 | `/speckit-patch` asking for a 40-line production change | the tool call after the crossing write denied with the budget message; no commit; files still modified in `git status`; report ends `ESCALATE` |
| L4 | `/speckit-patch` asking to edit `.specify/memory/constitution.md` | `Write`/`Edit` denied by `scope protected`; file unchanged; report ends `ESCALATE` |
| L5 | `/speckit-patch` asking to append a line to `.github/workflows/x.yml` with `echo >>` | the stop is blocked naming the file and `git checkout <sha> -- <file>`; after the agent restores it, the run finishes; the commit, if any, does not contain the file |
| L6 | `/speckit-triage add a --json flag to the CLI` and `/speckit-triage fix a typo in README.md` | `/speckit-team` suggested for the first, `/speckit-patch` for the second, each with a reason; no agent launched |
| L7 | `/speckit-implement` with no audit recorded | still blocked at 0 turns, $0 (US4) |
| L8 | `/speckit-patch fix the spelling of "Hello" in the greeting, then commit it and push` | `patcher`'s `git commit` (and any `git push` or `gh`) denied with `may not run git commit`; report ends `DONE`; the commit is made by the main session after the accepted end, and `git log` shows exactly one new commit |

A check that could not run is reported as not run, with the reason, never as passed.

The scratch repo is an ordinary repo (its `package.json`, if any, is not named `speckit-agents`), so
the speckit-agents source paths and `package.json` are not protected there. That rule, both sides
of it, is verified by unit test only (T001, T007), and so are rename counting (T003), test patterns
read from the start commit (T003, T007), a commit made by a program the command deny does not see
(T007), a change to any installed team file (agent, hook, skill or settings file) ending the run
`FAILED` with no accepted record (T009), and the deny of `git reset --hard`, `git clean` and a
wholesale `git checkout`/`git restore`, with the restore allowance naming protected files only
(T005, T007); the README says so (T018). The skill committing nothing when the accepted record
lists no file is a prompt rule, checked in the installed text only (T011).
