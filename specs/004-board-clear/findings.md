# Run findings: `/speckit-team` on the board's [clear] button

A live run of the team on feature 004, watched from the orchestrating session on 2026-10-10 with
Claude Code 2.1.296 on Windows. The watcher tailed the session's and every agent's transcript and
reported launches, hook decisions, verdicts and tool errors. Numbers come from those transcripts
and from `node tools/usage.mjs` on the session; each finding says where it was seen.

## The run

| Step | Agent | Result | Wall time | Input tokens |
|---|---|---|---|---|
| Spec | product-owner x2 | 5 questions, then READY FOR PLAN | 64 s + 29 s | 0.20M + 0.09M |
| Plan | architect | 13 tasks, 6 open decisions | 654 s | 2.96M |
| Plan | architect x2, dictated | decisions applied (second launch for missed rows) | 49 s + 33 s | 0.14M + 0.13M |
| Audit | spec-auditor | FAIL (1 HIGH: FR-012 vs D3) | 136 s | 0.46M |
| Audit | product-owner | FR-012 reworded | 12 s | 0.08M |
| Audit | spec-auditor | PASS (5 MEDIUM, 7 LOW accepted) | 218 s | 0.51M |
| Phase 1 | test-writer | RED, 23 tests | 230 s | 1.20M |
| Phase 1 | implementer | RED (1 of 3): one test cannot pass | 80 s | 0.38M |
| Phase 1 | test-writer | FIXED (T006 width bound) | 35 s | 0.09M |
| Phase 1 | implementer | GREEN, T008 ticked | 244 s | 0.05M |
| Phase 2 | test-writer | RED, 4 tests (1 passing by design, shown red once) | 110 s | 0.39M |
| Phase 2 | implementer | GREEN | 447 s | 0.24M |
| Phase 2 | test-writer | FIXED (2 `tsc` errors in test code) | 55 s | 0.16M |
| Phase 3 | test-writer | RED (README table test) | 34 s | 0.09M |
| Phase 3 | implementer | GREEN, `npm test` 188/188 | 212 s | 0.12M |
| Verify | spec-gatekeeper | APPROVED | 241 s | 0.12M |

18 launches, all in the foreground, 0 responses spent waiting on a background agent. Agents used
7.41M input tokens and the main session 10.74M over 81 responses (first 59k, peak 207k). The main
session's figure overstates a plain run: it also carried the reinstall that came before the run,
the watcher's notifications (each one a response that re-reads the whole context) and the checks
made for this report. Measure the skill from a separate watching session next time.

From `/speckit-team` to the PR took about 60 minutes, including the user's three stops. The user
asked mid-run whether it was going slowly. It was: one architect pass was 11 of those minutes.

## Findings

### 1. Plan decisions do not flow back into the spec
Seen: audit 1 failed on FR-012 ("must not change toasts") against plan D3 ("a press raises one
toast"). Audit 2 passed but listed three more of the same kind as MEDIUM (FR-001/SC-006 vs D2,
FR-003 vs D1, FR-006 vs D4) and advised amending them before the gatekeeper. Cost of the first:
one FAIL, one product-owner, one re-audit, about 6 minutes and 1.05M tokens. The rest are #86.

Idea: at the plan stop, when a decision's option text says how an FR reads, send that FR's
rewording to product-owner in the same round as the architect's revision, before the first audit.

### 2. A task no implementation can meet passed four checks
Seen: T006 asked for `widthOf(items) <= cols` for every width from 30 columns with a running
agent. The narrowest band layout with an agent is 44 wide (`Expected: <= 30, Received: 44`,
reproduced with `claude plugin test`). The architect wrote it, both audits passed it, and
test-writer's red was valid because the test failed on its first assertion, before the bound.
Cost: an implementer RED (1 of 3 toward the retry limit), a test-writer FIXED and a second
implementer.

Idea: test-writer checks that every assertion can be met by some implementation, not only that
the test fails now, for example by evaluating a bound against the existing smallest and largest
values.

### 3. test-writer does not run the type check
Seen: the Phase 2 implementer ran `tsc` on the mod and found two errors in test code
(`board.test.tsx:165` TS2532, `:573` TS2345), reproduced with `typescript@5.6.3`. CI's Linux job
runs that check and would have gone red. One extra test-writer launch.

Idea: name the repo's type check in test-writer.md, or put it in the test tasks of a TypeScript
change.

### 4. An implementer stalled on its own background test run
Seen: the T010 implementer took 447 s. It ran `npm test` in the background, then tried `sleep 110`
(blocked by Claude Code) and `Monitor` (not available to subagents). The next implementer was
told to run `npm test` in the foreground and took 212 s with no stall.

Idea: implementer.md (and test-writer.md) say to run the suite in the foreground.

### 5. Agents write files through Bash heredocs, and only two lanes see it
Seen: product-owner (`cat > spec.md <<'EOF'`) and test-writer both failed with
`unexpected EOF while looking for matching '`, then retried with Write. The scope hooks of
product-owner and architect match only `Write|Edit|MultiEdit|NotebookEdit`, and the Stop-time lane
check covers only test-writer and implementer. A product-owner or architect Bash write outside
its lane is never caught. Harmless here: the target was inside the lane. README lines 38 to 40
read as if a Bash change is caught for every agent.

Idea: either extend the Stop-time lane check to product-owner and architect, or say in the README
that it covers the two build agents only.

### 6. Reports now arrive as a separate hand-back message
Seen: in 2.1.296 an agent's report comes back as a message from the agent (its
`SubagentHandback` call). The Agent tool's result only says where the report went. The hooks work
with it: `verdict`, `result` and `ends` all fired on `PreToolUse:SubagentHandback` and recorded
FAIL, PASS, RED (1 of 3), GREEN (count reset) and APPROVED. `skills/speckit-team/SKILL.md`,
"Handoffs", still says to take the report as the tool's result.

### 7. Five questions at the spec stop need two calls
Seen: product-owner returned 5 open questions; AskUserQuestion takes at most 4 per call.
SKILL.md says this for the architect stop (step 2) but not for the spec stop (step 1).

### 8. The answer most users give is "accept all"
Seen: 6 open decisions at the plan stop; 5 went to the recommended option. The one the user
changed (D5) was optional extra work, a re-recording and a live check. If optional work were a
default-off decision, the common answer would be one click.

### 9. The orchestrator's own mistake
Seen: the dictated revision for D5 was built from `grep ... | cut -c1-200`, which hid four T013
mentions in long table rows. One extra architect launch (33 s, 0.13M tokens). The dictated
architect reported them as `needs revision` instead of guessing, which is what it should do.

Idea: SKILL.md's dictated mode says to search for a removed ID without truncating lines.

### 10. Smaller observations
- The test harness cannot record `store.set` and `store.delete` (`world()` owns them through
  `mock.store`), so FR-004's "no store write" is checked only indirectly. Issue #85.
- spec.md and its checklist were written with CRLF. Not an audit risk: `fingerprint()`
  normalises `\r\n` (`hooks/speckit-team.mjs:239`).
- The user's lean-ctx setup rewrites agents' Bash calls and blocks `node -e`; architect and
  test-writer each hit that once. Environment, not this repo.
- A user-level security-review plugin started its own `claude -p` session on an implementer edit.
  Environment, not this repo.

## Not checked
- The buttons were not pressed in a real TUI, and `docs/media/board.png` was not re-recorded
  (decision D5 B, issue #84).
- CI on Linux and macOS: pending when this was written; see PR #87.

## Acted on
In the branch `perf/004-run-findings`, stacked on #87. None of it is measured yet; the next full
run is the measurement (#79).

1. An option that makes a spec line wrong carries its new wording on a `Spec:` line
   (`agents/architect.md`), and the skill sends the chosen ones to product-owner in the same
   message as the architect's revision.
2. test-writer works out a value the existing code already decides, for the smallest and the
   largest case a test covers, and reports a task number that cannot hold (`BLOCKED`) instead of
   writing it. The skill sends it back with the number the code allows when the task's intent is
   plain, and to the architect otherwise.
3. test-writer runs the type check CI runs over tests; CLAUDE.md names the mod's `tsc` command.
4. test-writer, implementer, spec-gatekeeper and patcher give a test run a Bash `timeout` that
   covers it. The stall was not the agent's choice: its `npm test` passed the Bash tool's default
   2 minutes, and Claude Code answered "Command did not complete within its 120s timeout and was
   moved to the background". It waited 121 s and then 113 s, and ran the suite again (168 s).
5. README.md says the lane check covers test-writer and implementer only, and product-owner's and
   architect's prompts ask for Write and Edit. The hook that would catch their Bash writes: #88.
6. The skill takes a report from the agent's hand-back message when the Agent result points there.
7. The skill states the 4-question limit once, for every stop.
8. With more than 4 open decisions, the first question takes every recommended option, with
   exceptions as free text. Optional work as a decision that defaults to off: #89.
9. An ID a decision drops is one dictated edit for every mention, which the architect greps for
   with whole lines.
10. Not acted on: the store assertion is #85, and the rest is the environment.

Also from the run table: 22 of the first architect run's 35 responses made a single read, at 85k
of input each on average. architect.md and test-writer.md now ask for the reads an agent can
already name in one response.
