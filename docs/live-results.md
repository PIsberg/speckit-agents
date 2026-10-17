# Live results

Checks run in a real Claude Code session, by date, newest first; what a check did not see is
said where it was run. The README's [Live results](../README.md#live-results) is the summary.

## Project knowledge

<details>
<summary><b>2026-10-16</b>: Claude Code 2.1.301, Windows 11, a project and security-reviewer with real models (007, the security-reviewer agent)</summary>

Setup: a scratch repo with `.specify/` laid down by hand (`specify init` hung when spawned from the
session), a `demo` project whose `instructions.md` requires every new JavaScript file to start with
`// demo-project: reviewed`, and the branch's team installed into a throwaway config dir. Twice,
headless: `/speckit-team --team implementer,security-reviewer --project demo Add src/greet.js
exporting greet(name) ... with node:test tests in test/greet.test.js.`, main session on Sonnet,
`acceptEdits`, fork subagents off. The repo sat under the home directory, so `~/.claude/CLAUDE.md`
loaded as project instructions in both runs; its rules (branch first, tests first) were in play.

| Check | Result |
|---|---|
| Team line with security-reviewer | Seen. The `Agent` gate recorded `team for this session: implementer, security-reviewer; audit gate off`. |
| Project block, real model | Seen. `SubagentStart` gave implementer and security-reviewer the `demo` block; implementer started `src/greet.js` with `// demo-project: reviewed`, the rule nothing else in the run named. |
| Run 1 ($0.23, 6 turns) | A defect. With no test-writer, the main session told implementer to write the tests too. Implementer's lane check at Stop made it delete `test/greet.test.js`, and the main session stopped before the security review. The skill now says that without test-writer nobody writes tests (`test/install.test.mjs`). |
| Run 2 ($0.25, 6 turns), skill fixed | Seen. Implementer's brief left the tests out; it reported `RESULT: GREEN`. security-reviewer ran `phase: result` on `git diff main...HEAD` and ended `VERDICT: PASS` with two LOW findings (no negative tests; output unescaped if put in HTML). Its `ends` hook accepted the report: `.git/speckit-team/agents/<id>.ends-ok` was written. The hand-over listed the tests as not written. |
| `tools/usage.mjs` on run 2 | Cache hit rate 84% on Sonnet; no lost-prefix entry, as expected with one agent per type. |

Not seen: security-reviewer's spec phase, a `VERDICT: FAIL` and its routing, and the `ends` refusal
with a real model (the model ended its report correctly the first time; the refusal is held by
`test/e2e.test.mjs`).

</details>

<details>
<summary><b>2026-10-15</b>: Claude Code 2.1.300, Windows 11, project knowledge live checks (007, L1 to L4 and L6), against a fake API</summary>

Setup: a scratch Spec Kit repo with `.specify/projects/demo/` holding `instructions.md` (60 bytes) and `rounding.md` (31 bytes), the branch's team installed via `node install.mjs`, running Claude Code 2.1.300 against a localhost fake API harness.

| Check | Result |
|---|---|
| L1 injection | Passed. `/speckit-patch --project demo`: launch prompt carries `Project: demo`; `SubagentStart` hook injects the formatted project block as `additionalContext` into `patcher`'s first model request, containing the project header and indented instructions. |
| L2 off by default | Passed. `/speckit-patch` without `--project`: launch prompt has no `Project:` line, no project block injected, and `.git/speckit-team/project/` record is not written. |
| L3 protection | Passed. `patcher` attempting to write `.specify/projects/demo/rounding.md` is denied with `patcher may not write .specify/projects/demo/rounding.md: it is a protected path`. |
| L4 Spec Kit keeps it | Passed. `specify init --here --force --integration claude` runs in the scratch repo; `.specify/projects/demo/instructions.md` is preserved intact. |
| L6 pipeline role | Passed. `/speckit-team --team implementer --project demo`: launch prompt carries `Team: implementer` and `Project: demo`; `implementer` receives the injected project block as `additionalContext` in its first model request. |

</details>

## The team and the fast track

<details>
<summary><b>2026-10-17</b>: Claude Code 2.1.302, Windows 11, the fast track's L3, L6 and L8 re-run (#73), Haiku main session</summary>

Setup as on 2026-10-10 below: the branch's team (with #138's export line) installed with
`CLAUDE_CONFIG_DIR=<throwaway dir> node install.mjs`, a fresh Spec Kit repo with one commit and no
remote (`src/greet.js` with "Helo", `src/math.js`, a passing test each, `node --test`), folder trust
pre-accepted in the throwaway `.claude.json`, the session's `CLAUDECODE`, `CLAUDE_CODE_*` and
`AI_AGENT` variables cleared, the repo reset to its commit between runs. Every run was
`claude -p ... --model haiku --permission-mode acceptEdits --output-format json`; `patcher` ran on its
configured model, Sonnet. Seven runs, $0.231 in all.

| Check | Result | Turns | Cost | Input tokens (Haiku main / Sonnet patcher) |
|---|---|---|---|---|
| L3 eight functions, one Edit each | passed | 5 | $0.083 | 200k / 138k |
| L6 triage, `--json` flag | passed | 1 | $0.004 | 34k / none |
| L6 triage, README typo | passed | 1 | $0.004 | 36k / none |
| L8 fix, `patcher` told to commit | passed | 8 | $0.058 | 339k / 73k |
| L8 fix, `patcher` told to push | push deny not exercised | 9 | $0.048 | 343k / 50k |
| L8 `@agent-patcher` push only | not the check: no agent launched | 3 | $0.005 | 109k / none |
| L8 Agent call, push only | push deny passed | 1 | $0.029 | 110k / 23k |

- **L3** passed: asked for eight exported functions with a three-line JSDoc comment each, one Edit per
  function, without estimating first, `patcher` made six edits; the seventh (`max`) was denied with
  `fast track budget exceeded: 36 changed production lines in 1 files (limit 30 lines, 2 files). Tests
  and docs do not count. Stop: leave the work uncommitted and report ESCALATE; ...`, and so was its
  last `git status --short`. Its report ended `ESCALATE`; at the stop the hook said
  `fast track stopped: 36 changed production lines in 1 files ...` and wrote no accepted record;
  `src/math.js` stayed modified and nothing was committed. The Haiku main session's summary said
  `npm test` passed 2 of 2, while `patcher` said it never ran the tests: the summary was wrong on that.
- **L6** passed both ways: `add a --json flag to the CLI` suggested `/speckit-team` ("adds a new flag
  and output format, which is a new public capability"); `fix a typo in README.md` now suggested
  `/speckit-patch` ("README.md, which is not a protected path"), the wording fix e7d1b27 seen live.
  No agent launched in either.
- **L8** passed: told in the skill's launch prompt to commit, `patcher` ran
  `git status --short && git commit -am "fix greeting"`, denied with `may not run git commit: the fast
  track never commits, pushes or opens a pull request; /speckit-patch does that after the end-of-run
  check accepts the run. ...`; it ended `DONE`, the end check said `fast track: 1 of 30 production
  lines, 1 of 2 production files ... accepted`, and the main session made the one new commit
  (`src/greet.js`, `test/greet.test.js`). Its `git push` failed for lack of a remote, as expected here.
  A second run told the skill to have `patcher` run `git push origin HEAD` itself; `patcher` never
  tried it (no denial in the run). An `@agent-patcher` mention with the push as its only task was run
  by the Haiku main session itself, with no agent launched. Told to make one Agent call with that
  prompt verbatim, the main session launched `patcher`, whose `git push origin HEAD` was denied with
  `Fast track: patcher may not run git push: the fast track never commits, pushes or opens a pull
  request; ...`; nothing was pushed (#142).

</details>

<details>
<summary><b>2026-10-12</b>: Claude Code 2.1.296, Windows 11, the team question answered Build only in an interactive session (006 L4, #100), against a fake API</summary>

Setup: a throwaway Spec Kit repo on branch `001-greet` with a spec, plan and tasks and no audit
recorded, the team installed into a throwaway config dir, an interactive session started by vhs with
`--permission-mode default` and fork subagents on (Claude Code's default), talking to a fake API on
localhost, so no model ran and nothing was spent. The fake main session followed the installed
skill's text: it asked the team question with the options it read under "The options:", and on the
answer launched the roles that option names, each prompt with the skill's `Team:` line. Typed:
`/speckit-team add a file`; vhs then pressed Down and Enter.

| What | Result |
|---|---|
| The question | One question with the skill's four options in its order, `1. Full team (Recommended)` first, then Build only, Implement only and Spec and build, and Claude Code's own `5. Type something.` |
| The answer | `→ Build only` reached the main session, which launched test-writer, then implementer, each prompt with `Team: test-writer, implementer`; both ran in the background. |
| The team message | Under each launch: `PreToolUse:Agent says: speckit-team: team for this session: test-writer, implementer; audit gate off, spec-auditor is not in the team`. |
| The audit gate | Off for both: each agent's first tool call, a Read of `spec.md` with no audit recorded, went through, and no screen showed `Implementation gate`. |
| The team record | `.git/speckit-team/team/<session>.json` held `test-writer` and `implementer`. |

Not seen: a real model mapping the answer to the `Team:` line. The 2026-10-11 run below saw a real
main session ask the question (Full team first and recommended) and, in L1, write
`Team: test-writer, implementer` from `--team`. `test/e2e.test.mjs` pins the hook's half with fork
subagents on under `claude -p`.

</details>

<details>
<summary><b>2026-10-12</b>: Claude Code 2.1.296, Windows 11, the fast track's hooks in an interactive session (#73), against a fake API</summary>

Setup: a throwaway git repo with `.specify/memory/constitution.md` and one source file, the team
installed into a throwaway config dir, an interactive session started by vhs with
`--permission-mode default` and fork subagents on (Claude Code's default), talking to a fake API on
localhost, so no model ran and nothing was spent. Typed prompt: the main session launched `patcher`,
which wrote `.specify/memory/constitution.md`, then `src/fix.js`, then reported `Fixed.` and `DONE`.

| What | Result |
|---|---|
| The launch | `patcher` ran in the background, as every agent does with fork subagents on. |
| The scope hook (`patch`, PreToolUse) | Its protected Write was denied: its next request showed `patcher may not write .specify/memory/constitution.md: it is a protected path`, and the file was unchanged. |
| Its production Write | Asked for permission ("Do you want to create fix.js?"); Enter on "1. Yes" let it through. |
| The end check (`patch`, at its stop) | Wrote the accepted record with `["src/fix.js"]`. |

`test/e2e.test.mjs` pins the same with fork subagents on under `claude -p`.

</details>

<details>
<summary><b>2026-10-11</b>: Claude Code 2.1.296, Windows 11, choosing the team (006, L1 to L4), Haiku main session and agents</summary>

Setup: a fresh Spec Kit repo outside this checkout, the branch's team installed into its own
`.claude/` (`node install.mjs --claude-dir <repo>/.claude`, agents switched to `model: haiku`), the demo
feature as the active feature with no audit recorded, runs under `claude -p --setting-sources
project,local`, the session's `CLAUDECODE`, `CLAUDE_CODE_*` and `AI_AGENT` variables cleared.

| ID | Result |
|---|---|
| L1 | Seen live. `/speckit-team --team test-writer,implementer add a hello.txt that says hello`: `task_started` for test-writer and implementer only; the message `speckit-team: team for this session: test-writer, implementer; audit gate off, spec-auditor is not in the team` on both launches; no `Implementation gate` denial; `.git/speckit-team/team/<session>.json` held the two roles; branch `team/add-hello-txt` with one commit; the final report named the skipped roles. |
| L2 | Seen live. `--team bogus,implementer`: 1 turn, no agent launched, the reply named `bogus` and listed the six roles. |
| L3 | Seen live. `--team spec-auditor,implementer`: 1 turn, no agent launched, the reply said spec-auditor needs architect. |
| L4 | Partly seen. Interactive `/speckit-team <request>` (three recordings for the pipeline demo, driven by vhs) put the question with Full team first and marked Recommended, and answering it launched product-owner with no `Team:` line. Answering Build only and Esc out were **not run**: nobody drove them (run on 2026-10-12 against a fake API, above). |

Not seen live: the pipeline demo re-recording. Three attempts of `node docs/media/record.mjs pipeline`
got the team question and its answer, but the product owner (Haiku) returned no open questions each
time (and, with fork subagents on, the main session was not woken by a backgrounded agent's report), so
the tape's wait for the question dialog timed out; `docs/media/pipeline.gif` was not published.

</details>

<details>
<summary><b>2026-10-10</b>: Claude Code 2.1.296, Windows 11, the fast track (L1 to L8), Haiku main session</summary>

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
  ([Context budget](../README.md#context-budget)).
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
  word, as [Known limits](../README.md#known-limits) said, and the model went on without it. The listing forms
  of `git branch` are allowed since [#72](https://github.com/PIsberg/speckit-agents/issues/72).
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

</details>

<details>
<summary><b>2026-10-06</b>: Claude Code 2.1.291, Windows 11, Haiku main session</summary>

- typed `/speckit-implement` with no audit: blocked at 0 turns, $0
- architect's `Write` to `src/`: denied, file not created
- implementer's first `Bash` call before an audit: denied by the gate
- spec-auditor's `VERDICT: PASS`: recorded by its Stop hook

</details>

<details>
<summary><b>2026-10-07</b>: Claude Code 2.1.292, Windows 11, Haiku main session, user-level install</summary>

- implementer before an audit: its `Bash` call denied by `gate retries`, and its RED not counted
- 3 implementer runs ending `RESULT: RED`: counted once each, 3 IDs in the retry record
- a fourth implementer run: its `Bash` call denied with the retry-limit message, its report still
  delivered
- one slice (test-writer on T001, then implementer on T002): the tests failed on the stub's
  "not implemented" error, implementer turned them green, each committed only in-lane files, and
  its `RESULT: GREEN` reset the count through the SubagentStop hook
- two full `/speckit-team` runs of a small feature, all six agents: spec, 1 audit FAIL and a
  revision, PASS, 3 slices, gatekeeper. They found two bugs, both fixed: a stub-only task was never
  ticked, so the gatekeeper rejected the feature; and a gatekeeper handed back the report
  "placeholder" in the same turn as a tool call, so a second gatekeeper had to run. `ends` now
  refuses such a report once.

</details>

<details>
<summary><b>2026-10-08</b>: Claude Code 2.1.294, Windows 11, Haiku main session, user-level install, a repo initialised by Spec Kit 1.1.2 without <code>--extension git</code></summary>

- one full `/speckit-team` run of a small feature: constitution drafted and approved, 3 product
  questions answered, spec, plan, audit PASS recorded by the hook, 5 slices, spec-gatekeeper
  APPROVED with its word in the `ends` record. With no git extension, the skill created the
  feature branch itself; `main` kept only the initial commit. About $3.30.

</details>

<details>
<summary><b>2026-10-08, later</b>: the team installed into the scratch repo by <code>record.mjs --setup-only</code></summary>

The team was installed into the scratch repo's own `.claude/` by
`docs/media/record.mjs --setup-only` (headless, `--setting-sources project,local`). The main
session ran on Haiku and each agent on its frontmatter model (spec-auditor Opus, the others
Sonnet), as the debug log's requests show: `CLAUDE_CODE_SUBAGENT_MODEL=haiku` did not override an
agent's `model:` line ([#39](https://github.com/PIsberg/speckit-agents/issues/39)).

- test-writer told to hand back the bare report "placeholder", the failure seen in the run above:
  refused by `ends RED BLOCKED` with "Your report must end with a final line that is exactly one
  of: RED, BLOCKED", then accepted when it reported `BLOCKED` with its reason. $0.03.
- product-owner on the vague idea "reminders, so people stop forgetting things": a spec with 3
  `[NEEDS CLARIFICATION]` markers, each question with a recommended answer, and no
  `READY FOR PLAN`. Relaunched with the answers, it wrote them into a `## Clarifications` session,
  replaced the 3 markers with requirements, asked nothing new and ended `READY FOR PLAN`. It also
  ticked the checklist's markers item and reported all 16 items ticked, while saying it had not
  re-read them ([#38](https://github.com/PIsberg/speckit-agents/issues/38); the other 15 were
  ticked by speckit-specify's own validation in the first round). $0.19 per round. With step 5
  added to its prompt, a rerun of the second round made the same one tick, backed by a grep that
  found 0 markers, and its report gave the checklist line ("16 of 16 items are ticked. I checked
  each against the spec in this run"). Its reads were of the spec and checklist before its edits;
  no tool call re-checked the 15 unchanged items.
- `/speckit-team` from step 4 on `docs/media/demo`'s 001-greet (audit already PASS): implementer
  on the setup task, a stub pass ending `RESULT: STUB`, then 2 slices of test-writer and
  implementer, then the docs task and spec-gatekeeper `APPROVED`. Both test-writers ended `RED`
  with one failure line per test (4, then 2); every implementer ended `RESULT: GREEN` with the
  suite's counts, and the `result` hook reset the retry count each time. The orchestrator told
  test-writer not to tick its tasks, so an extra implementer ran only to tick them
  ([#37](https://github.com/PIsberg/speckit-agents/issues/37)). $0.36, 3.5 minutes. With the skill
  saying test-writer ticks its own tasks, a rerun told each test-writer to tick its task once red;
  both did, and the run needed 8 agent launches instead of 9, still ending `APPROVED`. $0.33.

</details>

## The board

- **The `[ clear ]` button, interactive ([#84](https://github.com/PIsberg/speckit-agents/issues/84)).**
  On 2026-10-12 (Windows 11, Claude Code 2.1.296, vhs 0.11.0), at $0: an interactive session 140
  columns wide that vhs drove against a fake API, in a throwaway Spec Kit repo with the team installed
  and the board loaded by `--plugin-dir` (`node tools/live-board.mjs`, which writes every screen as
  text). L3: after `/speckit-board` the docked pane showed `[ clear ]` and the band
  `[ board ] [ clear ] [ hide ]`. L4: after two spec-auditors reported PASS, ctrl+x tab, Tab, Tab and
  Enter pressed the band's `[ clear ]`. The toast read `cleared 2 agent rows and the band.`, the pane
  `cleared; no team agent has run since`, the band was gone, and the status line still read
  `speckit-board: 001-greet · ◐ build (1/3)`. The pane's `[ clear ]`, pressed by its hotkey `c`, did
  the same. ctrl+x tab gives an open pane the keyboard only while the band has no buttons, so that run
  hid the band first. L5: a third spec-auditor's row and the band were back on the screen taken 4 s
  after it was asked for. L6: `git hash-object` gave the same hashes for the six files (the team
  record, the verdict record, spec, plan, tasks and `feature.json`) before and after the clear.
- **A click on `[ clear ]` ([#117](https://github.com/PIsberg/speckit-agents/issues/117)).** The same
  day and setup, with the keys replaced by the mouse report a terminal sends the app for a click: an
  SGR press and release at column 57, row 34, inside the band's `[ clear ]` at 140 columns and 41
  rows, typed with no delay so the bytes arrive together. Claude Code took it as a click: the same
  toast, the pane's agent rows gone, the band gone and back with the third agent, the same hashes,
  and none of the report's characters in the prompt. vhs has no mouse, so the terminal's own
  translation of a physical click was not exercised; the bytes it would send were.
- **In CI on Linux and macOS ([#116](https://github.com/PIsberg/speckit-agents/issues/116)).** The
  same day, the `live-board` job (Claude Code 2.1.293, vhs 0.11.0) ran `tools/live-board.mjs` on
  ubuntu-latest (ttyd 1.7.4) and macos-latest (ttyd 1.7.7): on both the width probe found 1549
  pixels for 140 columns (1692 on Windows), and L3 to L6 passed with the band's `[ clear ]`, L3, L4
  and L6 with the pane's. It runs for every pull request since.
- **The board-only install and the standalone view ([#92](https://github.com/PIsberg/speckit-agents/issues/92)).**
  On 2026-10-11 (Windows 11, Claude Code 2.1.296, Spec Kit 1.1.2), headless and at $0, in a throwaway
  config dir: `claude plugin marketplace add PIsberg/speckit-agents` cloned this repository from
  GitHub and `claude plugin install speckit-board@speckit-agents --scope user` installed the board
  from main (`claude plugin list`: enabled, version 0.1.0), with no `agents/` or `skills/` folder and
  no `speckit-team` entry in `settings.json`. In a repo `specify init --here --integration claude`
  made, with the files Spec Kit's commands write put in place by hand (no model), a headless
  `claude -p "/speckit-board status"` against a fake API answered at 0 turns with the contract's
  texts in order: the no-feature notice, then S-2 `001-greeting · ◐ spec (draft)`, S-3 `○ plan`,
  S-4 `○ tasks`, S-5 `○ build (0/3)` with `next: /speckit-implement: T001 Create greet.js`, and S-6
  `◐ build (1/3)`; each run also raised its `ui_status` and startup `ui_toast`, and no line named a
  team agent or `/speckit-team`. A copy of the repo without `.git` answered S-6 and S-3 the same.
- **The clear argument ([#84](https://github.com/PIsberg/speckit-agents/issues/84)).** The same day,
  board from this checkout by `--plugin-dir`: `claude -p "/speckit-board clear"` answered
  `cleared the band.` at 0 turns, exit 0 (the band of a fresh headless session is drawn, so there is
  a band to clear; the quickstart had expected `nothing to clear.`), and `/speckit-board foo`
  answered `unknown argument "foo": use status, refresh, band or clear.`

- **Installed from this checkout.** On Windows, 2026-10-08, with the board installed from this
  checkout and no `--plugin-dir`: a headless `claude -p "/speckit-board refresh"` in a scratch Spec
  Kit repo set the status line, raised the startup toast and answered the command, and an
  interactive session (recorded with vhs) drew the band, the status line and, after
  `/speckit-board`, the pane. An edit to `mods/speckit-board/` reached the installed board at the
  next session start with no reinstall.
- **Team agent tracking.** The same day, with real agents (main session on Haiku). Headless, while
  `@agent-spec-auditor` ran the status line read `◐ audit`, and when it stopped the mod toasted
  `spec-auditor finished: PASS`, then `Audit PASS` once the hook had recorded the verdict;
  `@agent-spec-gatekeeper` went `◐ verify`, then `spec-gatekeeper finished: APPROVED` and
  `✓ verified`, which a new session still showed. Interactive, with the pane open, spec-auditor
  ran as a background agent and the pane showed `spec-auditor running 19s` with the spinner, then
  `✓ spec-auditor PASS`. That run found two bugs, fixed: the agent rows were drawn below the task
  list and cut off, and a background agent's word was missing because its report arrives through
  `SubagentHandback`. `@agent-implementer` on one task ended `implementer finished: GREEN`.
- **The gatekeeper's word and the retry meter.** On 2026-10-08 (Claude Code 2.1.294, user-level
  install, board by `--plugin-dir`, recorded with vhs): after a real `@agent-spec-auditor` PASS and
  `@agent-spec-gatekeeper` APPROVED in headless sessions, a new interactive session showed
  `✓ verify` from the hook's `ends` record alone, and two `RESULT: RED` stops fed to the installed
  `result` hook moved the band to `RED 1/3`, then `RED 2/3`, with the pane's meter at `●●○`. That
  run found a bug, fixed: a spec approved in conversation keeps Spec Kit's `Draft` status, so the
  board named `spec, draft` as the current step of a verified feature; a plan now counts as the
  spec's approval.
- **Headless on Linux.** On 2026-10-08 (Ubuntu 22.04 under WSL 2, Claude Code 2.1.294, Node
  22.20.0, `node install.mjs --board` from a clone of this checkout): with a PASS and an APPROVED
  fed to the installed `verdict` and `ends --record` hooks, a headless
  `claude -p "/speckit-board refresh"` emitted `ui_status`
  `speckit 001-greet · ◐ build (1/2) · 1/2 tasks` and the startup `ui_toast`, then, with the last
  task ticked, `✓ verified · 2/2 tasks`, at $0.
- **A blocked stop ([#31](https://github.com/PIsberg/speckit-agents/issues/31)).** The same day on
  Windows (Claude Code 2.1.294, main session on Haiku, spec-auditor on its own Opus, board by
  `--plugin-dir`, the debug log read for order): a spec-auditor told to leave out its `VERDICT`
  line once was refused by the `verdict` hook, and the mod's `classic.SubagentStop` settled after
  that block with no toast and the status still `◐ audit`; when it added the line,
  `spec-auditor finished: PASS` came 7 ms after the hook recorded the verdict. That held for a
  foreground agent, a background one in a headless session (which still reports through
  SubagentStop), and an interactive `@agent-spec-auditor`, where the hook denied the first
  `SubagentHandback` and the toast came 0.5 s after the second.
- **A stopped agent ([#32](https://github.com/PIsberg/speckit-agents/issues/32)).** The same setup:
  a background spec-auditor stopped with `TaskStop` 1.3 s in ended `exitPath=cancelled`, its task
  `killed`, with no `SubagentStop` (the mod's handler never ran and the agent's session hooks were
  cleared unrun); the poll's agent-list check ended its row 0.1 s later, which a poll can take up
  to 4 s to do.
- **A failed agent ([#35](https://github.com/PIsberg/speckit-agents/issues/35)).** A localhost
  proxy set as `ANTHROPIC_BASE_URL` answered every spec-auditor request after its first with a 400,
  which is not retried; the agent ended `exitPath=error`, its task `failed` ("Agent terminated
  early due to an API error"), again with no `SubagentStop`, and the poll ended its row 1.8 s
  later, while the main session was still inside a tool call.
- **The look in the screenshot.** On 2026-10-08 and 09 (Claude Code 2.1.295, Windows 11, board by
  `--plugin-dir` in a scratch Spec Kit repo with the demo feature staged mid-build, recorded with
  vhs, the main session and two stand-in agents on Haiku): the band, the pane docked in fullscreen
  and inline above the prompt, the status line, and the agent rows with each agent's task and its
  role's color, as in the screenshot above. `/speckit-board` typed while a turn ran a 25-second
  Bash command opened the pane during the turn; the version before `immediate` queued it until the
  turn ended. A headless `claude -p "/speckit-board status"` printed the board as text at 0 turns
  and $0. The session before this change found a bug, fixed: the plugin store kept the
  gatekeeper's word under the feature's path alone, so the scratch repo showed `✓ verify` from an
  `APPROVED` kept for another repository's `specs/001-greet`, though no gatekeeper had run there
  and its audit was newer. It also showed what the change redraws: the pane's phase track broke
  mid-row in a pane docked 60 columns wide, beside the dock the band drew bare glyphs, every
  finished agent got a green `✓` whatever its word, and the status line read
  `speckit-board: speckit 001-greet · ◐ build (3/6) · 3/6 tasks`. The session after it found two
  more, fixed before the screenshot: a team row wrapped its word (`runnin`, `g`) in the docked
  pane, and at about 70 columns the band kept `[ board ]` but dropped the other phases' glyphs.
