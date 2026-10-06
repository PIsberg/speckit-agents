# Quickstart: validating the activity feed and live pane

**Feature**: `001-agent-activity-feed-and-pane` | **Plan**: [plan.md](plan.md)

How to prove the feature works, gate by gate. Report every gate as passed, failed, skipped or not
run (constitution, "Workflow and Quality Gates"); paste failures with their output. Never pipe a
gate through `tail`, `tee` or `grep` without keeping its exit status.

## 1. Unit and contract gates (any OS)

```sh
npm test                                   # node:test suites in test/, includes test/mod.test.mjs
claude plugin validate mod/speckit-activity
claude plugin test mod/speckit-activity
```

`test/mod.test.mjs` runs the two `claude plugin` commands itself and reports them skipped when
`claude` is not on PATH; a skip there is not a pass, so run them directly as well.

## 2. Overhead (SC-005, Windows)

```sh
node bench/overhead.mjs        # 100 paired runs; prints medians and exits 1 over budget
```

Pass: hook-side paired median plus the mod-side median from
`mod/speckit-activity/test/overhead.test.ts` is at most 10 ms; the repository-without-Spec-Kit row
is within 2 ms. Record the numbers, date, Node, git and Claude Code versions in the README.
macOS and Linux: record "not run".

## 3. Install into a scratch config and repo

```sh
node install.mjs --claude-dir "$SCRATCH/claude"     # or the real ~/.claude for the live checks
mkdir -p "$SCRATCH/sk" && cd "$SCRATCH/sk" && git init && specify init --here --ai claude
git add -A && git commit -m init
```

Start Claude Code in the scratch repo (with `CLAUDE_CONFIG_DIR` pointing at the scratch config if
used). Expected immediately: the status line reads `speckit: idle, 0 agents | last phase none | verdict none`.

## 4. Live checks (constitution II; record what was observed in the README "Verifying")

Each check names what it proves. Use `claude --debug` so skipped hooks and refused trees are logged.

| Id | Do | Expect | Proves |
|---|---|---|---|
| L1 | Open a repo without `.specify/`, run a few tool calls and one subagent | no status line, no `/speckit-activity` in the command list, no `.git/speckit-team/activity/` | FR-012, FR-022, SC-008 |
| L2 | In the Spec Kit repo, type `/speckit-activity` while idle | pane opens with the main session row, summary `idle, 0 agents` | US1 S1, FR-012 |
| L3 | `@agent-architect write src/x.txt` | within 1 s: decision `DENY architect scope only specs/ CLAUDE.md src/x.txt` in the pane, summary `1 denied` | US1 S3, FR-015, SC-001 |
| L4 | `/speckit-team <idea>` through spec, plan, audit | rows appear per agent with phase `specify`, `plan`, `audit`; verdict line shows `PASS` or `FAIL` | US1 S2, S4, US3 S2 |
| L5 | Let test-writer and implementer finish | rows show `done` with `lane clean` (or `lane VIOLATIONS`) | US1 S5 |
| L6 | Ask the main session for an `Explore` subagent | row `Explore#xxxx other` with no phase; records have `team: false`, `phase: null` | US3 S1, FR-004 |
| L7 | Run 3 implementers in parallel worktrees (`[P]` tasks) | 3 rows `implementer#xxxx` with distinct suffixes and worktree labels; stream records carry 3 `agent.id` values and their `worktree` | US4, SC-007 |
| L8 | Replace `.git/speckit-team/activity` with a regular file, repeat L3 | the Write is still denied with the same reason; one toast `observer: ...ENOTDIR`, not repeated; summary counts the problem | US5 S1, S2, SC-004, FR-018 |
| L9 | With `userConfig.latencyLog` on, run `node bench/latency.mjs` in the repo (appends 100 records, 300 ms apart) | 100 `speckit-activity lag` lines in the debug log, every value under 1000 ms | SC-002 |
| L10 | After L4 to L7, run the privacy scan below on the real stream | 0 hits | SC-006 |
| L11 | Start the reference consumer from the README in a second terminal mid-run, then stop and restart it | receives history then live records; no `id` twice, none missing | US2 S1, S3, FR-007 |

Privacy scan (L10): put a marker in the prompt, in a file the agents read, and in an environment
variable before the run (for example `PRIVACY_MARKER_7f3a`), then:

```sh
grep -c PRIVACY_MARKER_7f3a "$(git rev-parse --path-format=absolute --git-common-dir)"/speckit-team/activity/*.jsonl
```

Expect every count to be 0. (Here `grep` is the check itself, so its output is the result.)

## 5. Uninstall

```sh
node install.mjs --claude-dir "$SCRATCH/claude" --uninstall
```

Expect the scratch config byte-identical to before the install except `*.bak-speckit-agents-*`
backups (SC-009), and the per-repo stream left in place.
