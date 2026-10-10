# Evidence: fast track (003)

The PR body quotes this file. Each slice's tests were committed alone before its implementation.
For each slice the tests were run in a temporary `git worktree` at the commit before the
implementation commit (`git log --oneline` on the branch gave the pairs). Exit status was read
directly from `$?` of each `node --test` run, not through a pipe. Run on 2026-10-10, Windows 11,
Node as installed on the author's machine. Every failure below is a real assertion failure in the
listed test, not a load error (each file loaded and ran all its tests; `tests` is the count run at
that commit). The worktrees were removed afterwards.

## Slice 1: scope protected (T001, tests 9562251, implementation 64b8686)

Worktree at 9562251.

```text
$ node --test test/hook.test.mjs
ℹ tests 50 ℹ pass 43 ℹ fail 7 ℹ skipped 0 
exit status: 1
```

Failed:

-  scope protected: Spec Kit, CI and agent-team paths are denied before the write (FR-007, FR-001, US3-1)
-  scope protected: ordinary paths are allowed (FR-001, US3-4)
-  scope protected: the guardrail state under .git/ is denied (FR-007)
-  scope protected: the installed agent team outside the repo is denied (FR-007)
-  scope protected: the repo name is read from HEAD, not the working tree (decision 4)
-  scope protected: the same five paths are ordinary in other repos (FR-007)
-  scope protected: the speckit-agents sources are protected in the speckit-agents repo only (FR-007)

## Slice 2: patch budget, PreToolUse path (T003, tests cdc9311, implementation aae4225)

Worktree at cdc9311.

```text
$ node --test test/hook.test.mjs
ℹ tests 73 ℹ pass 50 ℹ fail 23 ℹ skipped 0 
exit status: 1
```

Failed:

-  patch fails closed when the budget cannot be measured (research R9)
-  patch reads committed test patterns while scope tests keeps the working tree (FR-009)
-  patch: 30 lines in 2 files is allowed, the 31st line is denied (FR-005, FR-006, US2-1, SC-002)
-  patch: SubagentHandback is never denied for the budget; a commit command is denied (FR-006, US2-3)
-  patch: a Write, Edit or MultiEdit to a file dirty at the start is denied (research R14, contract step 3)
-  patch: a dirty-at-start file changed through Bash is named and denied (research R14)
-  patch: a file counts the larger of its insertions and deletions; deletions count (FR-005)
-  patch: a modified line counts 1 (FR-005, Edge 30/31 lines)
-  patch: a move git does not pair is a deletion plus a new file (decision 3)
-  patch: a pure rename of a committed binary is not binary (research R3)
-  patch: a rename across classes counts the production side (owner rule 2026-10-09, research R3)
-  patch: a third production file is over budget (FR-005, FR-006)
-  patch: binary production files are not allowed (FR-005)
-  patch: committed work counts, measured from the start commit (FR-005)
-  patch: committing a file dirty at the start is caught (research R14)
-  patch: deleting a committed production file counts its lines and 1 file (FR-005)
-  patch: files dirty at the start are left out of the count (FR-005, Edge, decision 13)
-  patch: input it cannot key a start record by gets no decision and a message (research R9)
-  patch: modified and new lines add up (FR-005)
-  patch: needs no active feature (FR-002)
-  patch: renames count by the edited lines, one file (FR-005, decision 3, research R3)
-  patch: test patterns come from the start commit, not the working tree (FR-005, decision 14 point 3)
-  patch: tests and docs do not count, a docs folder is not a doc rule (FR-005, built-in and committed patterns)

### Correction after a red run: fa0193a

At aae4225 (the implementation commit) the suite was not green: one T003 case expected a wrong
line count. The test was wrong, the implementation right, so the test was corrected in fa0193a
("test: fix expected line count in patch rename case b (T003)"). The run as it was:

```text
$ node --test test/hook.test.mjs   # worktree at aae4225
ℹ tests 73 ℹ pass 72 ℹ fail 1 ℹ skipped 0 
exit status: 1
```

Failed:

-  patch: renames count by the edited lines, one file (FR-005, decision 3, research R3)

```text
actual: 'Fast-track budget exceeded: 31 changed production lines in 3 files (limit 30 lines, 2 files). Tests and docs do not count. Stop: leave the work uncommitted and report ESCALATE; the developer re-runs the change with /speckit-team.',
expected: /30 changed production lines in 3 files/,
```

## Slice 3: command deny and wholesale-restore deny (T005, tests ffe167f, implementation 321a094)

Worktree at ffe167f.

```text
$ node --test test/hook.test.mjs
ℹ tests 77 ℹ pass 73 ℹ fail 4 ℹ skipped 0 
exit status: 1
```

Failed:

-  patch: a Write mentioning git push is not a command; the deny holds with only a session_id (FR-006)
-  patch: a non-string command gets no command deny and does not crash (constitution II)
-  patch: commit, push, history and pull-request commands are denied within budget (FR-006, FR-007, US2-3)
-  patch: wholesale restores are denied, naming restores and read-only commands pass (FR-011, FR-014, M5)

## Slice 4: end check, accepted record, restore allowance (T007, tests 4ea0cd3, implementation add7e9f)

Worktree at 4ea0cd3.

```text
$ node --test test/hook.test.mjs
ℹ tests 94 ℹ pass 78 ℹ fail 16 ℹ skipped 0 
exit status: 1
```

Failed:

-  patch end: a commit within budget is blocked at any size, the working tree matching the start (H1, decision 14)
-  patch end: a dirty-at-start file changed through a shell command is message A, never a restore (R14, Edge)
-  patch end: a new workflow says delete, a deleted workflow gives its checkout (FR-007, US2-2)
-  patch end: a plain 3-line commit is blocked (FR-006, US2-2)
-  patch end: a protected file dirty at the start is not named, blocked on or touched (US3-3)
-  patch end: dirty work swept into a commit is blocked, then measured without it (H1, R14, FR-002)
-  patch end: every patch call removes the accepted record (research R15)
-  patch end: over budget and committed is blocked until reset, then message A (FR-006, H1)
-  patch end: over budget and uncommitted is message A, no block, no record (FR-006, US1-3)
-  patch end: package.json is protected by the name at the start commit (owner 2026-10-09)
-  patch end: protected file changed with fs blocks stop and denies handback, until restored (FR-007, US2-2, FR-014)
-  patch end: test patterns edited during the run are protected (FR-007, decision 13)
-  patch end: the hook changes nothing in the repo (FR-007, constitution II)
-  patch end: the speckit-agents sources are protected in that repo only (decision 4)
-  patch end: within budget writes the accepted record, on stop and on handback (FR-002, US1-1)
-  patch restore allowance: only naming a protected file still to be restored passes (R7, M5, FR-011)

## Slice 5: installed team check (T009, tests a0aaab3, implementation 4e57cf9)

Worktree at a0aaab3.

```text
$ node --test test/hook.test.mjs
ℹ tests 103 ℹ pass 94 ℹ fail 9 ℹ skipped 0 
exit status: 1
```

Failed:

-  patch team: a config dir with no skills/ and no settings.json is hashed and accepted (FR-011)
-  patch team: a protected repo file still blocks, and is the only file the block names (FR-007, M2)
-  patch team: an unusable team in the start record is denied and the end check cannot run (FR-011, data-model)
-  patch team: any changed team file ends the run FAILED, never blocks, writes no record (FR-007, FR-011, FR-014, US3-2, SC-003, M2)
-  patch team: only agents/, hooks/, skills/<name>/ and the two settings files are hashed (research R16)
-  patch team: over budget with a team change opens no restore allowance, and message C comes first (research R7, M2)
-  patch team: putting the original back lets the run be accepted (FR-007, FR-011)
-  patch team: the start record holds a hash per team file, null for a missing settings file (FR-007, research R16)
-  patch team: two changed team files are both named in message C (FR-011, M2)

## Slice 6: agent, skill and installer wiring (T011, T012, T013, tests a899e4c and bac6a29, implementation bc30a6c)

Worktree at bac6a29 (the tick commit after the tests, the parent of the implementation).

```text
$ node --test test/install.test.mjs test/board-mod.test.mjs test/e2e.test.mjs
ℹ tests 55 ℹ pass 43 ℹ fail 12 ℹ skipped 0 
exit status: 1
```

Failed:

-  --help lists every flag, --board and --no-board included
-  a protected file changed through Bash blocks patcher's stop until it is restored (US2-3)
-  a second install changes nothing
-  install lays down agents, skill, hook and both settings gates, keeping other hooks
-  installed patcher.md states the fast track's rules
-  installed speckit-patch skill commits only after the end check, and never on an empty record
-  over budget, patcher's next tool call is denied and nothing is accepted (FR-007, US3-1)
-  patcher may not commit; the end check still accepts its work (FR-005, SC-003)
-  patcher's report must end in DONE, FAILED or ESCALATE (FR-002, US3-2)
-  patcher's scope hook denies a protected Write and allows a production one (FR-006, US2-1)
-  refuses to replace a patcher.md it did not install
-  the board mod draws each role in the color of its agent file

### Correction after a red run: the e2e scratch repo's line endings (5a836f3)

After the implementation (bc30a6c) one e2e case still failed on this machine. The scripted agent's
`git checkout` ran under the global `core.autocrlf=true` and wrote CRLF, so the restored protected
file differed from its committed bytes. The helper's `-c` flag only covered the test's own git
calls. 5a836f3 adds `git config core.autocrlf false` to the scratch repo's setup (two lines in
`test/e2e.test.mjs`; no assertion changed). The run as it was, worktree at bc30a6c:

```text
$ node --test test/e2e.test.mjs
ℹ tests 21 ℹ pass 20 ℹ fail 1 ℹ skipped 0 
exit status: 1
```

Failed:

-  a protected file changed through Bash blocks patcher's stop until it is restored (US2-3)

## Slice 7: advisory triage skill (T015, tests 77a2737, implementation d283737)

Worktree at 77a2737.

```text
$ node --test test/install.test.mjs
ℹ tests 28 ℹ pass 27 ℹ fail 1 ℹ skipped 0 
exit status: 1
```

Failed:

-  installed speckit-triage skill is advisory, names both commands and the four signals, and uninstalls

## SC-004: the end-to-end cases fail when the hook does nothing

`SPECKIT_E2E_NO_HOOK=1` makes the e2e setup overwrite the installed hook with `process.exit(0);`
(T013). Run on the branch head (097b6a7):

```text
$ SPECKIT_E2E_NO_HOOK=1 node --test test/e2e.test.mjs
ℹ tests 21 ℹ pass 3 ℹ fail 18 ℹ cancelled 0 ℹ skipped 0 
exit status: 1
```

Each new patcher case failed (5 of 5):

- failed: a protected file changed through Bash blocks patcher's stop until it is restored (US2-3)
- failed: over budget, patcher's next tool call is denied and nothing is accepted (FR-007, US3-1)
- failed: patcher may not commit; the end check still accepts its work (FR-005, SC-003)
- failed: patcher's report must end in DONE, FAILED or ESCALATE (FR-002, US3-2)
- failed: patcher's scope hook denies a protected Write and allows a production one (FR-006, US2-1)

The 13 older cases failed too, as expected: with the hook doing nothing, no hook decision is made.
The three that passed (`with a PASS on the current files, /speckit-implement goes through to the model`,
`Agent with run_in_background: false ...` and `with fork subagents on ...`) assert that nothing is
blocked or that the Agent tool behaves a certain way, so a silent hook satisfies them.

## Live results (T022), copied from README.md "Live results" as they stand

All eight checks were run; L6 failed and L3 and L8 were only partly exercised (status below). The README remains the source.

Not yet exercised live: implementer's test-file denial and a lane violation (a clean lane check
did run); for the fast track, the mid-run budget deny, the deny of `patcher`'s own `git commit`
and `git push`, a run on a repo with a remote (push and pull request), a larger change, and an
interactive session. Those are covered by the unit and end-to-end tests only.

Setup: the branch's team installed with `CLAUDE_CONFIG_DIR=<throwaway dir> node install.mjs` (the
real config directory untouched), a fresh Spec Kit repo outside this checkout with one commit and
no remote (`src/greet.js` with the typo "Helo", `src/math.js`, a passing test for each, a
`package.json` whose test command is `node --test`), and folder trust pre-accepted in the
throwaway directory's `.claude.json`. Every run was `claude -p ... --model haiku
--output-format json`; the repo was reset to its commit between runs. `patcher` ran on its
configured model, Sonnet (each run's `modelUsage` lists both models); no agent's `model:` line was
changed. Cost is `total_cost_usd` and tokens are input (uncached, cache read and cache write) from
`modelUsage`. Eleven runs, $0.41 in all.

| Check | Result | Turns | Cost | Input tokens (Haiku main / Sonnet patcher) |
|---|---|---|---|---|
| L1 fix the spelling | passed, with a note | 8 | $0.064 | 314k / 70k |
| L2 change that breaks a test | passed | 5 | $0.047 | 189k / 61k |
| L3 a 60-line change, first prompt | not the check: escalated before writing | 5 | $0.032 | 188k / 23k |
| L3 same, told not to estimate | partly: end check only | 7 | $0.055 | 275k / 48k |
| L4 constitution edit | passed | 5 | $0.043 | 155k / 51k |
| L5 `echo >>` into a workflow | passed | 6 | $0.059 | 231k / 104k |
| L6 triage, `--json` flag | passed | 1 | $0.004 | 35k / none |
| L6 triage, README typo | failed | 1 | $0.004 | 35k / none |
| L7 `/speckit-implement`, no audit | passed | 0 | $0 | none |
| L8 fix, then commit and push | deny not exercised | 10 | $0.058 | 401k / 71k |
| L8 told `patcher` to commit and push | deny not exercised | 8 | $0.046 | 313k / 49k |

- **L1** passed: the skill created `patch/fix-hello-spelling` from `main`; one `patcher` launch;
  the patcher wrote a failing test first, fixed the line, and `npm test` passed 4 of 4; the hook
  said `fast track: 1 of 30 production lines, 1 of 2 production files (tests and docs not counted).
  The end check accepted the run.`; the accepted record listed `src/greet.js` and
  `test/greet.test.js`; the main session then made one commit of those two files; nothing under
  `specs/`. The quickstart expected the commit to hold only the fixed file, but `patcher` added a
  regression test, as its prompt says to, so the commit held two. No push or pull request: the repo
  has no remote, and the skill said so. Measured with `tools/usage.mjs`: main session 8 requests,
  peak 43k, input 0.31M; one agent, 5 requests, peak 15k, input 0.07M
  ([Context budget](#context-budget)).
- **L2** passed: asked to make `add()` return `a - b` without touching tests, `patcher` named the
  failing test (`adds`, `-1 !== 5`) and ended `FAILED`; the edit stayed uncommitted on its branch;
  no commit, no pull request. (The run's `permission_denials` lists one compound Bash call of the
  main session refused by `--allowedTools`, not by a hook.)
- **L3**, first prompt (about 60 production lines in 14 functions): `patcher` judged the size
  before writing anything and ended `ESCALATE` with the tree clean. That outcome is right but it is
  not the check: no write crossed the budget, so the hook's deny did not run. Second prompt, telling
  the model to write first and let the hook measure: `patcher` appended 86 production lines in one
  Bash command that also ran the tests, so no tool call followed the crossing write to be denied.
  At the stop the hook allowed the end with `fast track stopped: 86 changed production lines in 1
  files (limit 30 lines, 2 files). Nothing was committed; ...` and wrote no accepted record. The
  files stayed modified and the skill committed nothing, but `patcher`'s own report ended `DONE`,
  not `ESCALATE`, and the skill described the run as `FAILED`. The mid-run budget deny (the tool
  call after the crossing write) was not seen live.
- **L4** passed: `patcher`'s `Edit` of `.specify/memory/constitution.md` was denied with
  `patcher may not write ...: it is a protected path`; the file was unchanged; the report ended
  `ESCALATE`.
- **L5** passed: asked to append to `.github/workflows/x.yml` with `echo >>` and to fix the
  spelling, `patcher` did both in one Bash command and ended `DONE`; the stop was blocked with
  `patcher changed protected files: .github/workflows/x.yml (new: delete it)` (the file was new, so
  the message gives no `git checkout`); `patcher` deleted it and finished; the commit held
  `src/greet.js` and `test/greet.test.js` only. In the same run `patcher`'s read-only
  `git branch --show-current` was denied as `may not run git branch`: the command deny matches the
  word, as [Known limits](#known-limits) says, and the model went on without it.
- **L6**: `/speckit-triage add a --json flag to the CLI` suggested `/speckit-team` ("a new flag and
  a new machine-readable output format, which is a public contract") and launched no agent.
  **Failed:** `/speckit-triage fix a typo in README.md` also suggested `/speckit-team`, saying
  "README.md is a protected path". It is not (the hook's table has no README, and the scratch repo
  has none). The triage skill's text reads "it touches a protected path (README.md, "The fast
  track" lists them)", which Haiku took as naming README.md; whether a stronger main session reads
  it right was not tried. Not retried.
- **L7** passed: `/speckit-implement` with no audit was blocked at 0 turns and $0 ("Implementation
  gate: no active feature ... Run @agent-spec-auditor and get VERDICT: PASS first.").
- **L8** not exercised: the main session committed after the accepted end and `git log` showed
  exactly one new commit, but `patcher` never ran `git commit`, `git push` or `gh`, so the deny
  message `may not run git commit` was not seen. A second run told the skill to have `patcher`
  commit and push itself; the skill declined and committed itself, again without `patcher` trying.
  Not retried. The deny rests on the unit and end-to-end tests.


Status of the open items, stated plainly:

- **L6 failed.** `/speckit-triage fix a typo in README.md` named README.md as a protected path.
  The wording fix (e7d1b27, "triage skill names the protected set instead of pointing at
  README.md") has not been re-run live. Only the installed-skill test covers it.
- **L3** was only partly exercised: the mid-run budget deny (the tool call after the crossing
  write) was not seen live; the end check was.
- **L8** was only partly exercised: `patcher` never tried `git commit`, `git push` or `gh`, so the
  deny message was not seen live.
