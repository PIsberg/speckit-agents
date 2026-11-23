# Which rules hold, and which are only asked

Every rule in the skills (`skills/*/SKILL.md`) and the agents (`agents/*.md`), section by section,
and what holds it ([#232](https://github.com/PIsberg/speckit-agents/issues/232)). Live runs on
2026-10-31 showed models skipping rules that were only text: spec-gatekeeper approved a requirement
while writing that it had not run the check (#228), and the main session skipped `/speckit-patch`'s undo
offer (#225) and invented the cause of a failed run (#221). This file says which guarantees are advice.

Each rule carries one tag for what holds it:

- **hook `<mode>`**: a hook decides (denies, blocks, refuses) or records it, whatever the model does.
  The modes are in [README.md, "What the hooks stop"](../README.md#what-the-hooks-stop).
- **script**: the skill runs a command of ours and acts on its answer (`check`, `project`, the fast
  track's records). Tests hold what the command answers; acting on the answer is still asked.
- **pinned**: a test (`test/install.test.mjs` unless named) holds the text, so it cannot drop out
  unnoticed. Whether a model follows it is not checked.
- **text**: asked, and nothing else.

and **unseen** when a breach leaves no trace a reviewer of the PR, the state under
`.git/speckit-team/` or CI would see. A text or pinned rule that is also unseen is where a model's
lapse goes unnoticed: those are the candidates for a hook, a script, or a scored case in
`tools/eval.mjs`, which measures how often a rule is followed (#190).

`test/rules.test.mjs` holds this file to the prompts: each section below carries a fingerprint of the
section's text. A section that is new, changed or gone fails `npm test` until its entry here is
reviewed and its fingerprint updated; the failure prints the new one.

## Text-only rules whose breach leaves no trace

The load-bearing ones, with what would hold them. Cost rules (read less, launch fresh agents) are
unseen too, but a breach costs tokens, not correctness, and `tools/usage.mjs` measures them.

| Rule | Where | What would hold it |
|---|---|---|
| A requirement no test task cites, or one a test names without testing it, still needs a real test | spec-gatekeeper Process 1 | #235 |
| The constitution's MUST rules are checked against the feature's diff | spec-gatekeeper Process 4 | scored case `must-broken` (#241): 6 of 6 REJECTED on 2026-11-01, a rate, not a hold |
| A contested finding goes to the user; the main session does not judge it | skill 3 | scored case `contest` (#242): 6 of 6 launched no agent on 2026-11-08, a rate, not a hold |

Taken over since the issue was filed: spec-gatekeeper's APPROVED on a cited FR no test holds is
refused by a hook (#228), the undo offer and the cause of a failed fast-track run come from the hook's
end record (#213, #221), and what a subagent's hooks say at its Stop reaches the main session (#231).

## Board stats

The board mod's stats (feature 010). Not prompt rules, so no fingerprint: each is held by a unit test in `mods/speckit-board/tests/`.

| Rule | What holds it |
|---|---|
| Band, pane and `status` draw the same figures from one `statsView()` | `board.test.tsx`: "the pane draws the context and cost rows" |
| A read that fails, is empty or is malformed shows `n/a` and changes no count | `board.test.tsx`: "a refused, empty or malformed read" |
| One `session.usage` read at a time; a read that never answers blocks neither a turn nor the start | `board.test.tsx`: "a session.usage read that never answers" |
| A refused `stats` write is toasted once until a write succeeds | `board.test.tsx`: "a refused stats write" |
| No store entry and no file is written by the stats | `board.test.tsx`: "writes no store entry and no file" |
| An unpriced model gives `cost n/a` with no bar | `model.test.ts`: "statsView cost" |

## skills/speckit-team/SKILL.md

### skills/speckit-team/SKILL.md: (opening)
<!-- fingerprint: 83c68899 -->
- The main session orchestrates and does not do the agents' work. text.

### skills/speckit-team/SKILL.md: Handoffs
<!-- fingerprint: 2014d498 -->
- Launch every agent in the foreground; without a `run_in_background` parameter, end the turn and wait. pinned (`test/e2e.test.mjs` pins the parameter's behaviour); a breach costs tokens.
- A fresh agent for every phase and fix round, never SendMessage. text, unseen (cost); a resumed agent's later reports are still checked and counted: hook `result` and `ends` close its last report at its next tool call (#370), and judge every hand-back, and a Stop that is not the counted one, as a new report (#394).
- Do not ask an agent for more than its Report allows; one line before and after each launch. pinned.
- Prompts carry only the role's Inputs; never paste the conversation or another full report. text, unseen (cost).
- architect: a `dictated:` revision when the answers fix every edit. pinned.
- test-writer ticks its own tasks. text.
- implementer: `last round` when no round follows and spec-gatekeeper is not in the team (#430); `stub` for a stub pass. pinned.
- spec-gatekeeper: the `Unbuilt:` line. pinned.
- The `Team:` line, exact and in pipeline order. hook `gate` (records it at the launch and opens the audit gate by it), pinned.
- The `Project:` line. hook `start` (injects the block), pinned.
- Never paste the project block. text.
- Commit the approved files in the message of the next launch. pinned; `test/e2e.test.mjs` pins that one message's calls run in order.

### skills/speckit-team/SKILL.md: Pace
<!-- fingerprint: 76ee041c -->
- Wait only at a **Stop:**; do not ask whether to go on. text.
- At most 4 questions per AskUserQuestion call, all before the next launch. text.

### skills/speckit-team/SKILL.md: 0. Preconditions
<!-- fingerprint: b38b0a75 -->
- Run `check team` first, alone, and stop on exit 1. script `check`, pinned (#230).
- With `--project`, the same call takes `--project '<name>'` and prints the block too (#338). script `check`, pinned.
- Stop without `.specify/`. script `check` (exit 1 names it); every hook is off there anyway.
- Note that `/clear` saves tokens. text.
- Ask about a dirty tree. script `check team` (the `state:` line names the files), pinned.
- Run step 0b while the constitution is missing or the template. script `check team` (the `state:` line says which), text.
- Say how to bring foreground launches back when the Agent tool has no `run_in_background`. text.

### skills/speckit-team/SKILL.md: Team
<!-- fingerprint: 4925cc0b -->
- How `--team`, `--security` and `--project` are read, and the refusals before any launch. pinned.
- `noagents` is chosen only by typing it. hook `gate` (reads the typed command at `UserPromptExpansion`).
- `skill-agents` is chosen only by typing it. hook `gate` (denies a role skill outside a typed `--team skill-agents`).
- `hybrid` is chosen only by typing it, and takes no role names, `noagents` or `skill-agents`. hook `gate` (records it only from the typed command, and denies a writer role skill outside a typed `--team skill-agents` or `--team hybrid`, #428); the refusal message is pinned.
- With no `--team`, the full team and no question; `--team ?` asks one question, full team first (#431). pinned; hook `gate` refuses a launch whose `Team:` line names less than the full team until the user's answer is in the transcript after the typed request (#366).
- Without product-owner, a `team/` branch before the first launch. pinned.
- One line naming the team and what is skipped. pinned.
- `--yes` and `--side-by-side` lead the arguments with the other flags. pinned; hook `gate` reads a `--team` after them (#431).
- `--yes`: the spec and plan stops take every recommendation and the approval without asking; the constitution approval and every FAIL, REJECTED or limit stop still wait. pinned (#431). Unmeasured: how often a run under `--yes` builds a spec the user would have answered otherwise.

### skills/speckit-team/SKILL.md: No agents
<!-- fingerprint: 7ba38cc5 -->
- Spec Kit's own skills in this session, no Agent call, two stops. pinned.
- `speckit-implement` goes past the audit gate only after the typed command. hook `gate`.
- After 3 failed runs of the same tests, hand the output to the user. text.

### skills/speckit-team/SKILL.md: Skill agents
<!-- fingerprint: dee6a827 -->
- One Skill call per role, one role per response, its Inputs as `args`. pinned.
- Each role's lane, the audit gate before test-writer, implementer and spec-gatekeeper, the verdict and the word. hook `scope role`, `lane role`, `gate`.
- After spec-auditor's or spec-gatekeeper's report, the next Skill call's `args` starts with its last line. pinned; hook `gate` reads it.
- Steps 1 to 6 stop only where they stop: a role's turn that ends on `VERDICT: PASS`, `RESULT: STUB`, `RED` or `RESULT: GREEN` is sent back once per role call, so the run goes on without the user (#261); so is a first `VERDICT: FAIL`, a `REJECTED`, a `FIXED` and a `RESULT: RED` under the retry limit (#332). hook `lane role`.
- Count RED yourself: 3 in a row go to the user. hook `lane role` and `gate` count the role's REDs in the retry record and say the third, which is not handed on (#332); `gate` denies a fourth `speckit-role-implementer` call with the agent's text (#341).
- `--project`: the block is already in the session from `## Project` step 2; never pasted into a role call's `args` (#335). pinned.

### skills/speckit-team/SKILL.md: Hybrid
<!-- fingerprint: 044a20fb -->
- product-owner, architect, test-writer and implementer as Skill calls, one per response; RED counted by the skill. pinned; hook `scope role`, `lane role` and `gate` hold each writer role's lane, the audit gate and the retry limit as in skill-agents (#428).
- spec-auditor, spec-gatekeeper, security-reviewer and load-tester as foreground Agent launches with no `Team:` line. pinned; hook `gate` denies their role skills in a hybrid request, keeps the request's team at their launch, and closes the writer role before it (its lane check and report word, as at a role call).
- Before a gate's launch, the writer role's report as its own message ending in its word, the launch in the next response. pinned; hook `gate` refuses the launch once when test-writer's or implementer's report has no word, and counts a missing `RESULT:` as `RESULT: RED`. Seen 2026-11-23: in both hybrid full runs the gatekeeper went out with no report, and in one the relaunch had none either.
- Never launch a writer role as an agent. pinned; hook `gate` ends the mode at such a launch, so the full team's agent gates apply from there.
- No side-by-side slices, no side-by-side question. pinned.
- `--project`: the writer roles follow the block in the session; every Agent launch carries the `Project:` line. pinned; hook `gate` reads the line at the launch.

### skills/speckit-team/SKILL.md: Project
<!-- fingerprint: 3e980d17 -->
- Check the name, read the block from step 0's `check team --project`, act on its exit status and output, ask before `--init`. script `check`, `project`, pinned (#338).

### skills/speckit-team/SKILL.md: 0b. Constitution (only while it is the template)
<!-- fingerprint: 6ecca909 -->
- Only for a team with architect, spec-auditor or spec-gatekeeper. pinned.
- Draft from what the repo states, mark inferred rules, ask, then `speckit-constitution`. text.

### skills/speckit-team/SKILL.md: 1. Spec: product-owner
<!-- fingerprint: 31447d7b -->
- Relay the questions with product-owner's options as listed, recommended first; relaunch only on a report without `READY FOR PLAN`. pinned (#216).
- One stop for the questions and the spec; every answer the recommended one and the spec approved: `clarifications --recommended` chained to the commit, no product-owner launch; only an explicit approval ends the stop. pinned (#427); script `clarifications --recommended` (all or nothing); hook `gate` refuses an architect or spec-auditor launch, agent or role skill, while `## Open Questions` lists a question.
- Work on a feature branch. text; visible in the PR.
- security-reviewer on the spec, FAIL routing, two FAILs to the user. pinned.
- Stop for the spec review, which `--yes` answers with the recommendations and the approval (#431); commit it with the architect's launch. pinned.

### skills/speckit-team/SKILL.md: 2. Plan and tasks: architect
<!-- fingerprint: 1ea85635 -->
- Read only `## Open Decisions`; ask every decision at one stop. pinned.
- Answers that all take the recommendation: launch no one, record them with `decisions --recommended` in the message that commits and launches the audit. script `decisions` (all or nothing), pinned; hook `gate` refuses a spec-auditor launch while `plan.md` has an open decision.
- Otherwise one architect revision and the `Spec:` lines to product-owner in one message. pinned.
- `[P]` slices one at a time unless the request has `--side-by-side`; never asked (#431). pinned.
- `--yes` takes every recommended decision and the approval at this stop. pinned (#431).

### skills/speckit-team/SKILL.md: 3. Audit: spec-auditor
<!-- fingerprint: 0ffcae43 -->
- Commit the approved files with the launch. text.
- CRITICAL and HIGH findings to their owner, or to the user when the owner is absent. pinned.
- A contested finding goes to the user; do not judge it yourself. pinned, unseen; measured by the scored case `contest` (#242, 6 of 6 on 2026-11-08).
- MEDIUM and LOW findings are listed at hand-over, not routed. text.
- After two FAILs, the findings go to the user. hook `gate`: a third spec-auditor launch, or `speckit-role-spec-auditor` call (#353), is refused until `audit --approve`, which the skill runs only on the user's yes (#242) and which covers one launch, by its `tool_use_id`, for every install's gate process (#304, e2e). The yes itself is text: the hook cannot tell it from a model's.
- An edit to spec, plan, tasks or constitution voids a PASS; ticks do not. hook `gate` (fingerprint).

### skills/speckit-team/SKILL.md: 4-5. Red and green, one round at a time
<!-- fingerprint: 0fe72712 -->
- Rounds of at most 4 slices, never the whole feature to one agent. pinned.
- Take the rounds from the architect's `Round <n>:` lines. pinned.
- Without architect, one round on a brief; without test-writer, no test in implementer's brief. pinned.
- Stubs only when the tests will call something missing. text.
- Send back a test that fails for the wrong reason. text, unseen (#240).
- After 3 REDs in a row, no relaunch. hook `gate retries`, `result`; without an active feature the skill counts (pinned).
- Side-by-side slices, only with `--side-by-side`, in worktrees, merged in task order. pinned.
- One full suite run per build: with spec-gatekeeper in the team, no implementer gets `last round` and spec-gatekeeper's gates are the run (#430). pinned. Unmeasured: a regression the last implementer would have caught now costs a REJECTED and a relaunch.
- The full suite of a side-by-side round: the main session runs it after the last round's merge unless spec-gatekeeper runs it next, and a failure goes to one implementer without a worktree; a worktree launch never carries `last round`. pinned (#309). Seen 2026-11-11: told only in their own body not to run the suite, both implementers ran it and ended RED; with `last round` left out of the launch, both ended GREEN and the main session ran the suite after the merge, 12 of 12 (1 run).

### skills/speckit-team/SKILL.md: 5b. Load test: load-tester
<!-- fingerprint: dec7a9e5 -->
- Only when `--load-test` or `--team` names it, once the last round is GREEN and before spec-gatekeeper, in the foreground. pinned; hook `gate` (denies a launch before the audit passed).
- The report's last line is `PASS`, `FAIL` or `NOT MEASURED`; anything else is relaunched once, then handed to the user. hook `ends` (refuses once); pinned.
- A `FAIL` stops for the user; on accept only `load-test.md` is committed and the load tests are stashed by name, so a tick or a file of the user's stays (#422). pinned, and the stash command is run in a scratch repo; a breach leaves a load test in the PR, unseen.

### skills/speckit-team/SKILL.md: 6. Verify: spec-gatekeeper
<!-- fingerprint: c64bb015 -->
- Start once the last round is GREEN and every task is ticked; the `Unbuilt:` line for an absent role's tasks. pinned.
- REJECTED reasons to test-writer or implementer, or the user; an implementer here never gets `last round` (#430). pinned.
- A test of behaviour the code already has: test-writer writes it and ends `FIXED`; the main session shows it failing in one Bash call that restores and ends on `git status --short`, and gives spec-gatekeeper the output. pinned (#298); hook `scope` denies test-writer the production write. That the session restored the file is text: the output in the prompt shows a breach, nothing refuses one.
- security-reviewer on the result, then spec-gatekeeper again after its fix. pinned.

### skills/speckit-team/SKILL.md: 7. Hand over
<!-- fingerprint: c5cd1219 -->
- Open the PR, do not merge, watch CI. text.
- Report the roles, skipped rows, unticked tasks and the retry count's source. pinned.

## skills/speckit-patch/SKILL.md

### skills/speckit-patch/SKILL.md: (opening)
<!-- fingerprint: ad23fcd1 -->
- patcher never commits. hook `patch`.
- `--project` is one word, checked before launch. script `project`, pinned.

### skills/speckit-patch/SKILL.md: 1. Preconditions
<!-- fingerprint: ea0a7836 -->
- Run `check` first and stop on exit 1; with a project, `check --project '<name>'` (#338). script `check`, pinned (#230).
- Stop without `.specify/`. pinned.
- List a dirty tree's files and ask. text; the hook leaves them out of the record.
- Say how to bring foreground launches back. text.

### skills/speckit-patch/SKILL.md: 2. Before launching
<!-- fingerprint: 6c361382 -->
- Act on the project block step 1's `check --project` printed. script `check`, `project`, pinned (#338).
- Note the start, the hook's hash and the remote-tracking refs. pinned.
- Branch `patch/<slug>` from the current commit. text; visible.

### skills/speckit-patch/SKILL.md: 3. Launch
<!-- fingerprint: 7ecfe200 -->
- One patcher, foreground, the change and at most a `Project:` line. text.

### skills/speckit-patch/SKILL.md: 4. Commit
<!-- fingerprint: 29d78884 -->
- Commit only when every check holds (hook hash, start, branch, accepted record, refs, dirty files). pinned; the accepted record is hook `patch`.
- An empty `files` commits nothing. pinned.
- Add and commit by path, never `git add -A` or `-a`; push without `--force`. pinned.
- A missing record's cause is the end record's `outcome` and `message`, quoted. script (hook `patch` writes it), pinned (#221). A message that names no test file says the change needs its test or the `No test:` line: the same message, pinned by `test/install.test.mjs` (#243).

### skills/speckit-patch/SKILL.md: 5. Report
<!-- fingerprint: 97caf9c6 -->
- Read the end record first; offer its `undo`, run it only on an explicit yes. script (hook `patch` writes it), pinned (#213).
- Never undo another way. text; a breach shows as lost work, not in the state.

### skills/speckit-patch/SKILL.md: 6. Merging
<!-- fingerprint: 8997f720 -->
- Never merge. text.

## skills/speckit-triage/SKILL.md

### skills/speckit-triage/SKILL.md: (opening)
<!-- fingerprint: e35347c6 -->
- Advisory: one `Suggested:` line, the four signals for `/speckit-team`, `--project` kept. pinned.
- Launches nothing, changes no file. text.

## agents/product-owner.md

### agents/product-owner.md: (opening)
<!-- fingerprint: 494078d9 -->
- Owns what, not how. text.

### agents/product-owner.md: Inputs
<!-- fingerprint: b16ccd50 -->
- Other features' specs are not inputs. text, unseen (cost).

### agents/product-owner.md: Process
<!-- fingerprint: 18632438 -->
- Stop without `.specify/` or the skill; a new feature reads speckit-specify, a revision leaves it unread. pinned; e2e that nothing is preloaded (#257); no hook.
- An answer goes under `## Clarifications`, `### Session`, as `- Q: ... → A: ...`, and into what it settles; an answered question leaves `## Open Questions`. pinned; spec-auditor reads the result; hook `gate` holds the architect while one is listed (#427).
- A finding judged wrong is reported `contested` with its file:line; an upheld contest is recorded. pinned.
- At most 5 open questions, highest impact first, each with 2 to 4 options (AskUserQuestion's limit, #216) or at most 5 words. pinned, unseen.
- The spec written as if each recommendation were taken, the questions under `## Open Questions` as `### Q<n>:` with `- **A (recommended): <answer>.**` lines. pinned (#427); script `clarifications --recommended` refuses another form and changes nothing.
- Tick a checklist item only after checking it this run. text, unseen.

### agents/product-owner.md: Lane
<!-- fingerprint: 00d6fa36 -->
- Only `specs/` and `.specify/feature.json`. hook `scope only`, `lane only`.
- Write and Edit, not Bash. hook `scope only` reads Bash too (#209).
- No technologies in the spec; every requirement testable. text; spec-auditor checks.

### agents/product-owner.md: Report
<!-- fingerprint: 79a07e0f -->
- Each open question with its options, recommended first (#216). pinned.
- At most 20 lines; `READY FOR PLAN` last, only with no `[NEEDS CLARIFICATION]` marker; questions under `## Open Questions` may remain (#427). pinned; no `ends` hook.

## agents/architect.md

### agents/architect.md: (opening)
<!-- fingerprint: 15536b51 -->
- Owns how and in what order. text.

### agents/architect.md: Inputs
<!-- fingerprint: f3b99b28 -->
- Other features' artifacts are not inputs. text, unseen (cost).

### agents/architect.md: Process
<!-- fingerprint: c21917d8 -->
- Stop on a `[NEEDS CLARIFICATION]` marker. text.
- A first plan reads speckit-plan and speckit-tasks, a revision leaves them unread. pinned; e2e that nothing is preloaded (#257); no hook.
- Minimal design; recovery machinery only where an FR or rule demands it. text; spec-auditor checks.
- Grep for an existing function before a task adds one. pinned; spec-auditor checks (HIGH).
- Each fact once; write `research.md`, `data-model.md`, `contracts/`, `quickstart.md` only when needed. pinned (facts once), text.
- Slices: one behaviour each, every task in one slice. pinned.
- Every FR is cited by a test task or excused by `No test: <reason>` right after it, which excuses only that ID and those the reason names. hook `ends --record`: at spec-gatekeeper's APPROVED an FR in no test line naming the feature's number and not excused that way is refused (#235); a cited ID any task of the feature excuses is not asked of a test task's files (#299).
- A test task cites only what a test can fail on; a rule of how the work is done gets its `No test:` on the task that carries it out, in the first `tasks.md`. pinned (#299); no hook: a process rule a test task cites unexcused is refused at spec-gatekeeper's APPROVED, which is late. Whether the architect follows it is unseen in a run.
- Every test task names its test file and the IDs it covers. pinned; hook `ends --record` checks at spec-gatekeeper's APPROVED that the test files hold the IDs (#228).
- Signatures for stubs; file and symbol for what a task uses. pinned.
- `[P]` only on disjoint files. text; a merge conflict shows a breach.
- Check every constitution MUST rule before reporting. text; spec-auditor checks (CRITICAL).
- `## Open Decisions` with options, consequences and `Spec:` lines, each on one line, that quote the line they replace; plan and tasks as recommended; each option a list item `- **A (recommended): <option>**`, then `- **B: <option>**`. pinned (#310); script `decisions` refuses a `Spec:` line in another form and changes nothing when it finds no option line. Seen 2026-11-11: three runs, three option forms, before the rule.
- Contested findings, answered decisions, dictated revisions. pinned.

### agents/architect.md: Context
<!-- fingerprint: f691c92e -->
- Read each part once; no whole-file dumps; parallel reads. text, unseen (cost).

### agents/architect.md: Lane
<!-- fingerprint: 2d269475 -->
- Only `specs/` and the SPECKIT block of `CLAUDE.md`. hook `scope only`, `lane only`; the hook allows all of `CLAUDE.md`, not only the block.
- Write and Edit, not Bash. hook `scope only` reads Bash too (#209).

### agents/architect.md: Report
<!-- fingerprint: d18f2849 -->
- At most 15 lines; one `Round <n>:` line per round. pinned; no `ends` hook.

## agents/spec-auditor.md

### agents/spec-auditor.md: (opening)
<!-- fingerprint: 63bf3ef1 -->
- Treat the artifacts as wrong until checked. text.

### agents/spec-auditor.md: Inputs
<!-- fingerprint: 2b8c83de -->
- The active feature and the constitution. text.

### agents/spec-auditor.md: Process
<!-- fingerprint: 287cccab -->
- speckit-analyze, read-only. hook `scope none`, `lane none` (#412).
- Read each artifact once; grep the rest. text, unseen (cost).
- A second implementation of existing behaviour is HIGH. pinned.

### agents/spec-auditor.md: Verdict
<!-- fingerprint: 17ab67a7 -->
- FAIL only on CRITICAL or HIGH; a broken MUST rule is CRITICAL; severity by impact. text.
- A finding the user ruled out is not raised again. pinned.

### agents/spec-auditor.md: Report
<!-- fingerprint: 40092ae6 -->
- Leave out speckit-analyze's next steps, offers and `## Extension Hooks` block (#405). pinned.
- `VERDICT: PASS` or `VERDICT: FAIL` last. hook `verdict` (asks once, records it against the files it read).

## agents/test-writer.md

### agents/test-writer.md: (opening)
<!-- fingerprint: 1d901c91 -->
- Writes the executable spec. text.

### agents/test-writer.md: Inputs
<!-- fingerprint: 0d3e3e30 -->
- Only the named tasks, the cited lines and the contracts; a brief in place of tasks ticks nothing. pinned (brief), text, unseen (cost).

### agents/test-writer.md: Process
<!-- fingerprint: 6b838db1 -->
- The repo's framework and style. text.
- The FR or scenario ID in each test's name or a comment, after the feature's number (`001 FR-002`). hook `ends`: test-writer's RED or FIXED is sent back once while a ticked test task cites an ID none of its test files holds (#315; the skill-agents role at its Stop or the next role call, #316). hook `ends --record`: at spec-gatekeeper's APPROVED the drift check refuses a cited ID no test file holds (#228), and an FR of `spec.md` in no test line naming the feature's number (#235).
- On a kept test, the ID as a comment; a kept test is not a new test. pinned (#254).
- A requirement the stub already meets (an export, a signature) gets no test of its own: its ID goes as a comment on the tests that call the symbol, and it is not reported as already passing. pinned (#321); unseen (cost). Shown in 1 run with real models (2026-11-11).
- Red for the right reason, not a syntax error or a name error. hook `ends RED BLOCKED FIXED`: a RED whose output is one is sent back once, then kept in `ends/red-faults.json` (#240). A missing module counts only when the path the error names is a test file under the repo's test patterns (a helper, a fixture; #245): Node ESM's absolute path, a relative one resolved against CJS's Require stack or with its leading `./` and `../` dropped, or a Python module. A missing production file, a package or a path outside the repo is still a valid RED, and a relative helper path that names no test folder (`./helper.mjs`) is not caught.
- Run the type check when CI type-checks tests; report a task number no code can meet. pinned.
- Without implementer, a missing production symbol is red. pinned.
- Stop after 3 rounds on one test. text.
- A Bash `timeout` that covers the run. pinned.
- Tick finished tasks; commit on the feature branch. text; visible in the PR.

### agents/test-writer.md: Lane
<!-- fingerprint: f4440b62 -->
- Test files and `tasks.md` only. hook `gate scope tests`, `lane tests`.

### agents/test-writer.md: Report
<!-- fingerprint: 281fc551 -->
- `RED`, `BLOCKED` or `FIXED` last. hook `ends`.
- A test added for behaviour the code already has is shown passing, with the production line to break, and ends `FIXED`. pinned (#298); which of the three words fits is text, unseen.

## agents/implementer.md

### agents/implementer.md: (opening)
<!-- fingerprint: b33ad9f4 -->
- Never changes the tests. hook `gate retries scope no-tests`, `lane no-tests`.

### agents/implementer.md: Inputs
<!-- fingerprint: 5878364d -->
- Only the tasks, the report and the tests; spec and plan stay unread. pinned (brief), text, unseen (cost).

### agents/implementer.md: Process
<!-- fingerprint: 9a23234f -->
- Confirm the red state first. text.
- The least code that turns the tests green. text.
- The full suite only with `last round`, which the skill leaves out when spec-gatekeeper runs it next (#430), and never in a worktree, which lacks the other slices' code. pinned (#309). Seen 2026-11-11: two worktree implementers ended RED for each other's stubs, 2 of the 3 that lock the role out.
- Check each command's own exit status, not a pipe's. text, unseen.
- A Bash `timeout` that covers the run. pinned.
- Tick and commit; in a worktree tick nothing. pinned.

### agents/implementer.md: Stub pass
<!-- fingerprint: a9263c82 -->
- Signatures only, bodies that signal not implemented; `RESULT: STUB`. hook `result` (counts no attempt), text.

### agents/implementer.md: Lane
<!-- fingerprint: 47c5d56c -->
- Everything except test files and `.specify/`. hook `gate retries scope no-tests`, `lane no-tests`.
- A test that looks wrong is reported, not changed. text.

### agents/implementer.md: Report
<!-- fingerprint: 824a3852 -->
- `RESULT: GREEN`, `RED` or `STUB` last; 3 REDs in a row block. hook `result`, `gate retries`.

## agents/load-tester.md

### agents/load-tester.md: (opening)
<!-- fingerprint: 0382dda5 -->
- Changes no production code and no functional test. hook `scope load`.

### agents/load-tester.md: Inputs
<!-- fingerprint: d01e1496 -->
- The feature directory, the diff, the constitution, the test command and the existing load tests. text.

### agents/load-tester.md: Lane
<!-- fingerprint: f77e4f90 -->
- Writes only load tests and `specs/<feature>/load-test.md`; leaves a file already in a load directory whose own name does not say load (#418). hook `scope load` and `lane load`.

### agents/load-tester.md: Process
<!-- fingerprint: 688bf52d -->
- Find the load surface in the diff; none found is NOT MEASURED. pinned.
- Check the instrument: the working tree's build, a non-empty and complete result set, skips listed as not measured, a feature switch engaged. pinned; a missed check leaves a wrong number nobody sees, unseen.
- Run `probe` before the first measurement and after the last; its `noisy:` lines go under Warnings as they are, each starting `noisy:` (#456). script (`probe` answers; reporting it is asked); pinned. Before the verbatim rule 4 of 5 load-noisy reports (#417) reworded the line ("Noisy host: ...").
- Gate only on deterministic measures, ceilings from a failing first run times a margin, no budget row before its failing run. pinned, unseen.
- A growth-per-doubling ceiling from the growth the work needs (one pass: 2x) plus 40%, never from the build under test, and measured on a work count or a ratio to a same-run control, never raw time (#456). pinned; seen breaking before the rule: a ceiling of 4.15 x 2.2 passed a quadratic dedupe in the #417 runs of 2026-11-23.
- Workloads: sizes doubled, cold and warm apart, concurrency swept, accuracy rates, the host's control subtracted. pinned, unseen.
- Harness and record: load tests where `lane load` accepts them, reduced by default and the full sweep behind an environment variable, versions compared in one sitting, `load-test.md` rewritten each run. pinned.
- `NOT MEASURED`, naming the edit, when the project's test command would not run a new load test without an edit outside the lane (#424, FR-016). pinned.
- Delete run output outside the lane that git does not ignore. text; hook `lane load` sends it back by name and passes what git ignores (#423).

### agents/load-tester.md: Verdict
<!-- fingerprint: b1ba067b -->
- FAIL on a failed gating measurement or instrument check, NOT MEASURED when none ran, PASS only when one ran and all passed. pinned; recorded nowhere, so it never touches spec-auditor's verdict.
- An instrument failure in a committed load test is FAIL for the run even with a working one written beside it; a committed skip is NOT MEASURED at best (#456). pinned; before the rule 11 of 14 broken-instrument runs ended PASS (#417), after it not measured yet.

### agents/load-tester.md: Report
<!-- fingerprint: a295eebf -->
- At most 40 lines in a fixed order, the last line `PASS`, `FAIL` or `NOT MEASURED`. hook `ends` (the last line); pinned (the order).

## agents/spec-gatekeeper.md

### agents/spec-gatekeeper.md: (opening)
<!-- fingerprint: 2fa87321 -->
- Verifies and fixes nothing. hook `scope none`; `lane none` warns only (#412).

### agents/spec-gatekeeper.md: Inputs
<!-- fingerprint: 6c1ebb55 -->
- `Team:` and `Unbuilt:` lines. pinned.

### agents/spec-gatekeeper.md: Process
<!-- fingerprint: d42825c5 -->
- Every FR has a test that would fail if it broke. hook `ends --record`: an FR a ticked test task cites must be in its test files (#228), and every FR of `spec.md` in a test line naming the feature's number unless a task gives it `No test:` (#235). Whether the test would fail if the behaviour broke: text, unseen.
- A test committed before the code that passes it needs no break; a test added after the code counts only on the output that shows it failing on broken code and the tree clean after, and the gate breaks nothing itself. pinned (#298, #308); hook `scope none` denies the write. Seen 2026-11-11: told it could break the code, the gate was denied and rejected a test-first build.
- Every task ticked, `Unbuilt:` IDs skipped. pinned.
- Run what CI runs; a skipped gate is not a passed one. text; the report shows a breach.
- A Bash `timeout` that covers the run. pinned.
- The constitution's MUST rules against the diff. text, unseen; measured by the scored case `must-broken` (#241, 6 of 6 on 2026-11-01).

### agents/spec-gatekeeper.md: Verdict
<!-- fingerprint: 28621ddb -->
- REJECTED on any missing test, open task, failed gate or broken rule. text; hook `ends --record` for the drift (#228).

### agents/spec-gatekeeper.md: Report
<!-- fingerprint: 656c8c5c -->
- `APPROVED` or `REJECTED` last, recorded. hook `ends --record`.

## agents/security-reviewer.md

### agents/security-reviewer.md: (opening)
<!-- fingerprint: 890c59bc -->
- Finds flaws, fixes nothing. hook `scope none`, `lane none` (#412).

### agents/security-reviewer.md: Inputs
<!-- fingerprint: ce64a755 -->
- The phase in the prompt decides spec or result review. text.

### agents/security-reviewer.md: 1. Spec State Review (phase: spec)
<!-- fingerprint: 9eee3a9f -->
- Threats, access control, data exposure, input validation, security requirements. text, unseen.

### agents/security-reviewer.md: 2. Result Review (phase: result)
<!-- fingerprint: 5e6024c9 -->
- OWASP flaws, secrets, input handling, error leakage, negative tests. text, unseen.

### agents/security-reviewer.md: Verdict
<!-- fingerprint: 2facc98b -->
- FAIL on CRITICAL or HIGH. text.
- A finding the user ruled out is not raised again. pinned.

### agents/security-reviewer.md: Report
<!-- fingerprint: 9ac2c233 -->
- `VERDICT: PASS` or `VERDICT: FAIL` last. hook `ends`; recorded nowhere, so it never touches spec-auditor's verdict.

## agents/patcher.md

### agents/patcher.md: (opening)
<!-- fingerprint: efae9789 -->
- One small change in one pass. hook `patch` (budget).

### agents/patcher.md: Inputs
<!-- fingerprint: 729b789f -->
- No `specs/` artifacts. text.

### agents/patcher.md: Process
<!-- fingerprint: a29a0566 -->
- Files dirty at the start are not yours. hook `patch` (denies a write to one, stops the run if one changes).
- A regression test first for a behaviour change. text: whether the test fails first is not checked. hook `patch`: the end check stops a run that changes production lines with no test file changed, unless the report has a `No test: <reason>` line (#243).
- Move files with `git mv`. text; a plain `mv` costs budget, which the hook counts.
- Run the tests; a Bash `timeout` that covers it. pinned.
- Restore only by naming the file. hook `patch` (denies a wholesale restore).
- Never commit, push, run `gh` or switch branch. hook `patch`.
- Never start `/speckit-team`. text.
- `git status --short` last, `ESCALATE` when the budget denies it. pinned; hook `patch`.

### agents/patcher.md: Lane
<!-- fingerprint: 08103761 -->
- Not the protected paths; 30 production lines and 2 files. hook `patch` (the `scope protected` rule in the same process, #444).

### agents/patcher.md: Report
<!-- fingerprint: c5918333 -->
- `DONE`, `FAILED` or `ESCALATE` last. hook `ends`.
- A change with production lines and no test file gives its reason in a `No test: <reason>` line. hook `patch` reads it at the end check (#243). Whether the reason is true is text, unseen; measured by the scored case `patch-bug` (#247, 6 of 6 committed a test on 2026-11-08).
