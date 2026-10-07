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
node bench/overhead.mjs        # 100 alternating pairs; prints medians and exits 1 over budget
claude plugin test mod/speckit-activity   # overhead.test.ts prints the mod-side median (or mean bound)
```

The bench's baseline arm is the base commit's `hooks/speckit-team.mjs` (`--base`, default
`b9b0dc3`), which has no activity code at all; the treatment arm is today's hook with
`speckit-activity.mjs` beside it (research R9). Pass: hook-side paired median at most 8 ms in both
the plain row and the segment-rotation row, plus the mod-side figure, at most 10 ms; the
repository-without-Spec-Kit row within 2 ms. Record the
numbers, which mod-side measure was used (`performance.now()` median or `Date.now()` mean bound),
date, Node, git and Claude Code versions in the README. macOS and Linux: record "not run".

## 3. Install into a scratch config and repo

```sh
node install.mjs --claude-dir "$SCRATCH/claude"     # or the real ~/.claude for the live checks
mkdir -p "$SCRATCH/sk" && cd "$SCRATCH/sk" && git init && specify init --here --ai claude
git add -A && git commit -m init
```

Start Claude Code in the scratch repo (with `CLAUDE_CONFIG_DIR` pointing at the scratch config if
used) as `claude --debug`. Expected immediately: the status line reads
`speckit: idle, 0 agents | last phase none | verdict none`.

## 4. Live checks (constitution II; record what was observed in the README "Verifying")

| Id | Do | Expect | Proves |
|---|---|---|---|
| L1 | Open a repo without `.specify/`, run a few tool calls and one subagent | no status line, no `/speckit-activity` in the command list, no `.git/speckit-team/activity/` | FR-012, FR-022, SC-008 |
| L2 | In the Spec Kit repo, type `/speckit-activity` while idle | pane opens; its Agents section has exactly one row, `main`, and the summary reads `idle, 0 agents` | US1 S1, FR-012, FR-004 |
| L3 | `@agent-architect write src/x.txt` | within 1 s: decision `DENY architect scope only specs/ CLAUDE.md src/x.txt` in the pane, summary `1 denied` | US1 S3, FR-015, SC-001 |
| L4 | `/speckit-team <idea>` through spec, plan, audit | rows appear per agent with phase `specify`, `plan`, `audit`; the phase line advances; the verdict line shows `PASS` or `FAIL`, and the stream's `verdict` record has `via: "handback"` | US1 S2, S4, US3 S2 |
| L5 | Let test-writer and implementer finish | rows show `done` with `lane clean` (or `lane VIOLATIONS`); a stop the lane check refused leaves the row at `run` until the agent really ends | US1 S5 |
| L6 | Ask the main session for an `Explore` subagent | row `Explore#xxxx other` with no phase; records have `team: false`, `phase: null` | US3 S1, FR-004 |
| L7 | Run 3 implementers in parallel worktrees (`[P]` tasks) | 3 rows `implementer#xxxx` with distinct suffixes and worktree labels; stream records carry 3 `agent.id` values and their `worktree` | US4, SC-007 |
| L8 | See below | see below | US5 S1, S2, SC-004, FR-018 |
| L9 | See below | see below | SC-002 |
| L10 | After L4 to L7, run the privacy scan below on the real stream | 0 hits | SC-006 |
| L11 | See below | see below | US2 S1, S3, FR-007 |
| L12 | See below | see below | FR-001, FR-004 (main session stop), audit finding C2 |
| L13 | See below | see below | US6 S1 to S3, FR-024, FR-032 to FR-034, SC-010, SC-011 |
| L14 | See below | see below | US6 S4 to S6, FR-025 to FR-031, SC-012, SC-013 |
| L15 | See below | see below | FR-028, SC-014 |
| L16 | See below | see below | FR-020, constitution VII (the PowerShell hook shell, third audit M11) |

### L8: unwritable destination

1. Stop Claude Code. In the scratch repo:
   `D="$(git rev-parse --path-format=absolute --git-common-dir)/speckit-team"; mv "$D/activity" "$D/activity.saved"; echo x > "$D/activity"`
2. Start `claude --debug`, then run `@agent-architect write src/x.txt`.
3. Expect: the Write is denied with the same reason text as in L3 (copy L3's reason to compare).
4. Expect exactly two toasts on Windows, each once, with the text of contracts/view.md:
   `speckit-activity: observer problem stream-unwritable:EEXIST. Agents are not affected; see README, Troubleshooting.`
   (the writer; `ENOENT` in place of `EEXIST` is also correct, if the append is reached first) and
   `speckit-activity: observer problem stream-unreadable:ENOTDIR. Agents are not affected; see README, Troubleshooting.`
   (the reader). The summary line ends `observer: 2 problem(s)`.
5. Repeat step 2. Expect no further toast.
6. Restore: `rm "$D/activity"; mv "$D/activity.saved" "$D/activity"`.

### L9: latency over 100 records

If research V9 found no way to set `latencyLog`, no debug log file for `$.ui.log` lines, or a
`$.clock.now()` that is not wall time, L9 cannot run: report SC-002 live as "not run" with that
reason in the README (SC-002 then rests on the mocked-clock test in `follow.test.ts`) and open the
follow-up issue (T069). Otherwise:

1. Turn on `latencyLog`: open `/config`, find the row for `speckit-activity` `latencyLog`, set it on
   (the route recorded as V9 in research.md's live verification log; if V9 found that it is set
   through `pluginConfigs` in `settings.json` instead, use that). The mod reloads with the option.
2. Note the debug log file of this session (the path V9 recorded for `claude --debug`).
3. In a second terminal, in the repo: `node bench/latency.mjs "$T/ids.txt"` (100 `tool` records,
   300 ms apart, each with a fresh `ts`; it writes the 100 record ids it sent to `$T/ids.txt`).
4. Check the lag lines of exactly those records:
   `grep -F -f "$T/ids.txt" "$LOG" | grep -o "speckit-activity lag [0-9]*" > "$T/lag.txt"`, then
   `wc -l < "$T/lag.txt"` must print 100 and `awk '$3 >= 1000' "$T/lag.txt"` must print nothing
   (the second `grep` strips any prefix the debug log adds, leaving `speckit-activity lag <ms>`).
5. Lag is defined in contracts/view.md: the mod's clock when the poll has parsed the record, minus
   the record's `ts`; it includes the relay, the write, the wait for the poll and the read, and
   excludes the redraw.
6. Repeat steps 3 and 4 with the rich view open (`/speckit-activity rich`), writing to a second ids
   file. The rich view shows a record up to one frame (500 ms) after the poll that read it, so for
   this pass also check the render lines: for each id, the first `speckit-activity render rich <ms>`
   line after its lag line must be within 500 ms, and lag plus that gap under 1000 ms (third audit
   M5; T055 asserts the same in mocked time).

### L10: privacy scan

Put a marker in the prompt, in a file the agents read, in an environment variable, and ask
spec-auditor to include it in its report (the SubagentHandback message), for example
`PRIVACY_MARKER_7f3a`, then:

```sh
grep -c PRIVACY_MARKER_7f3a "$(git rev-parse --path-format=absolute --git-common-dir)"/speckit-team/activity/*.jsonl
```

Expect every count to be 0. (Here `grep` is the check itself, so its output is the result.)

### L11: a consumer that attaches late, stops, and resumes

The reference consumer is the code block after `<!-- reference-consumer -->` in the README, saved
as `$T/consumer.mjs`. It prints `<kind>\t<id>` per record and, with `--cursor <file>`, saves its
cursor map after every pass and resumes from it.

1. Mid-pipeline: `node "$T/consumer.mjs" . --cursor "$T/cur.json" > "$T/live.txt"`
2. After some records, stop it (Ctrl-C), wait for a few more records, then restart the same
   command with `>>` in place of `>`.
3. After the pipeline: `node "$T/consumer.mjs" . --once > "$T/all.txt"`
4. Duplicates, expect no output: `cut -f2 "$T/live.txt" | sort | uniq -d`
5. Gaps, expect no output for ids written after the consumer first started:
   `comm -13 <(cut -f2 "$T/live.txt" | sort) <(cut -f2 "$T/all.txt" | sort)`
   (the first run reads history from the start of the stream, so with default retention every id
   in `all.txt` should be in `live.txt`).

### L12: the main session's stop

1. In the Spec Kit repo, start `claude --debug`, run one tool call, note the session id
   (`/status`), then end the session with `/exit`.
2. Read the stream with the reference consumer or directly:
   `grep -h '"kind":"agent-stop"' "$(git rev-parse --path-format=absolute --git-common-dir)"/speckit-team/activity/*.jsonl | grep '"main:<session id>"'`
   Expect exactly one line.
3. Start a new session in the same repo and open `/speckit-activity`: the previous session's
   `main` row reads `done` (it ended within the last 10 minutes), and the new session's `main` row
   reads `run`.
4. Repeat with Ctrl-D, and once with `/clear` followed by one tool call: after `/clear` there is an
   `agent-stop` for the old main run and a new `agent-start` for main before the next `tool` record.
   (If research V10 recorded the fallback, step 2's line appears only after step 3's session start.)

### L13: switching and persistence

1. On a fresh install (no stored choice), open `/speckit-activity`: the plain board, and its last
   row reads `View: plain. Switch: /speckit-activity rich, or ctrl+x tab then v.`
2. During `/speckit-team`, type `/speckit-activity rich`: the rich view appears within 1 s; the
   agents that were running are still there and their work goes on (compare the stream before and
   after: no gap in their `tool` records).
3. Press ctrl+x tab, then `v`: the plain board within 1 s. Press `v` again: rich. (If research V12
   recorded the fallback, use Enter on the button instead, as the switch line then says.)
4. Leave rich chosen, `/exit`, start a new session in a different Spec Kit repository, open the
   panel: rich. Switch to plain, restart: plain.
5. In a repository without `.specify/`: `/speckit-activity` is not offered, and the store file
   (research V13's location, or its fallback file) has not changed (modification time).
6. Do 20 switches during one pipeline run, alternating the command and the key; note any switch
   that took longer than 1 s and any agent action that failed or waited (none expected).

### L14: the rich layout, its limits and parity

1. With agents in at least 3 phases, the track shows each under its phase (a stale one marked
   `STALE`) and non-team agents under `no phase`; cards show history bars, `<n> calls/5m`, the
   feature, the worktree when not `.`, and `lane ...` for finished agents.
2. With more than 4 agents or more than 4 non-allow decisions, the capped sections end in counted
   `+<n> more` lines and the switch row shows `[ n: next page ]`; press ctrl+x tab, then `n` until
   the page number wraps, and check that every agent, decision, verdict and fault cause on the
   plain board (switch to it to compare) appeared on some page (third audit H1).
3. Provoke a denial (`@agent-architect write src/x.txt`): its line starts with `NEW` for about 5 s,
   then stays without it.
4. Resize the terminal to 120 columns, then 80, then 79: at 79 the panel shows
   `Rich view needs 80 columns (now 79); showing the plain board.`; at no size does a line wrap,
   and the rich view never takes more than 20 lines (count them).
5. In fullscreen at 160 columns, with the pane docked and narrowed below 76 columns, the panel
   shows `Rich view needs 76 columns in the pane (now <n>); showing the plain board.` (third audit M6).
6. Shorten the terminal until the pane has fewer than 20 rows: the header says `reduced`.
7. Switch the terminal to a monochrome scheme (or `NO_COLOR=1` if the session honours it): every
   state is still readable by its word or glyph and number.

### L15: redraw rate

With `latencyLog` on (L9 step 1), the rich view open, the terminal not resized, and a pipeline
running, take the render lines of one 60-second span and bucket them per second (third audit H3):
each line is `speckit-activity render rich <clock ms>`, one per draw, so

```sh
grep -o "speckit-activity render rich [0-9]*" "$LOG" | awk '{print int($4/1000)}' \
  | awk -v from="$FROM" -v to="$((FROM + 60))" '$1 >= from && $1 < to' | sort | uniq -c | sort -rn | head -3
```

with `FROM` the first second of the span (Unix seconds) must show no count above 2. If research V9
found no debug-log route, report L15 "not run" with that reason; SC-014 then rests on T055.

### L16: hooks under the PowerShell hook shell (third audit M11)

FR-020 names Git Bash and PowerShell as hook shells on Windows. If this Claude Code build lets a
hook command run under PowerShell (a hook `shell` setting, or the session's shell setting; research
records which), install, set it, and repeat L3 (scope deny) and the typed `/speckit-implement`
check of README "Verifying" (gate block at 0 turns): same decisions as under Git Bash, and the
records in the stream. If the build offers no way to choose PowerShell for hooks, report L16
"not run" with that reason; T063's unit test (installed commands run through
`powershell -NoProfile -Command`) is then the only evidence, and T069 opens the issue.

## 5. Uninstall

```sh
node install.mjs --claude-dir "$SCRATCH/claude" --uninstall
```

Expect (SC-009 as amended by the owner, contracts/installed-files.md): `settings.json` parses to
the same value as before the install, with its indentation and line endings, byte-identical if
nothing else changed it meanwhile; no `settings.json` if there was none before; no
`settings.json.bak-speckit-agents` and no `hooks/speckit-agents.install.json` left (PR #2); a
pre-existing empty directory still there. The stored view choice in Claude Code's plugin store is
untouched and stays, as does the per-repo stream (third audit K1).
