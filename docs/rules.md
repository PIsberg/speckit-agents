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
| A contested finding goes to the user; the main session does not judge it | skill 3 | #242 |

Taken over since the issue was filed: spec-gatekeeper's APPROVED on a cited FR no test holds is
refused by a hook (#228), the undo offer and the cause of a failed fast-track run come from the hook's
end record (#213, #221), and what a subagent's hooks say at its Stop reaches the main session (#231).

## skills/speckit-team/SKILL.md

### skills/speckit-team/SKILL.md: (opening)
<!-- fingerprint: 83c68899 -->
- The main session orchestrates and does not do the agents' work. text.

### skills/speckit-team/SKILL.md: Handoffs
<!-- fingerprint: 0f6a576c -->
- Launch every agent in the foreground; without a `run_in_background` parameter, end the turn and wait. pinned (`test/e2e.test.mjs` pins the parameter's behaviour); a breach costs tokens.
- A fresh agent for every phase and fix round, never SendMessage. text, unseen (cost).
- Do not ask an agent for more than its Report allows; one line before and after each launch. pinned.
- Prompts carry only the role's Inputs; never paste the conversation or another full report. text, unseen (cost).
- architect: a `dictated:` revision when the answers fix every edit. pinned.
- test-writer ticks its own tasks. text.
- implementer: `last round` when no round follows; `stub` for a stub pass. pinned.
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
<!-- fingerprint: af599062 -->
- Run `check` first and stop on exit 1. script `check`, pinned (#230).
- Stop without `.specify/`. text; every hook is off there anyway.
- Note that `/clear` saves tokens; ask about a dirty tree. pinned (dirty tree), text.
- Run step 0b while the constitution is the template. text.
- Say how to bring foreground launches back when the Agent tool has no `run_in_background`. text.

### skills/speckit-team/SKILL.md: Team
<!-- fingerprint: 1b01364f -->
- How `--team`, `--security` and `--project` are read, and the refusals before any launch. pinned.
- `noagents` is chosen only by typing it. hook `gate` (reads the typed command at `UserPromptExpansion`).
- `skill-agents` is chosen only by typing it. hook `gate` (denies a role skill outside a typed `--team skill-agents`).
- With no `--team`, one question, full team first. pinned.
- Without product-owner, a `team/` branch before the first launch. pinned.
- One line naming the team and what is skipped. pinned.

### skills/speckit-team/SKILL.md: No agents
<!-- fingerprint: 7ba38cc5 -->
- Spec Kit's own skills in this session, no Agent call, two stops. pinned.
- `speckit-implement` goes past the audit gate only after the typed command. hook `gate`.
- After 3 failed runs of the same tests, hand the output to the user. text.

### skills/speckit-team/SKILL.md: Skill agents
<!-- fingerprint: e04e0914 -->
- One Skill call per role, one role per response, its Inputs as `args`. pinned.
- Each role's lane, the audit gate before test-writer, implementer and spec-gatekeeper, the verdict and the word. hook `scope role`, `lane role`, `gate`.
- After spec-auditor's or spec-gatekeeper's report, the next Skill call's `args` starts with its last line. pinned; hook `gate` reads it.
- Count RED yourself: 3 in a row go to the user. text, unseen (the hook does not count in this mode; README says so).

### skills/speckit-team/SKILL.md: Project
<!-- fingerprint: ea58ddb5 -->
- Check the name, run `project`, act on its exit status and output, ask before `--init`. script `project`, pinned.

### skills/speckit-team/SKILL.md: 0b. Constitution (only while it is the template)
<!-- fingerprint: 6ecca909 -->
- Only for a team with architect, spec-auditor or spec-gatekeeper. pinned.
- Draft from what the repo states, mark inferred rules, ask, then `speckit-constitution`. text.

### skills/speckit-team/SKILL.md: 1. Spec: product-owner
<!-- fingerprint: 170c0dda -->
- Relay the questions, recommended answer first; relaunch until `READY FOR PLAN`. text.
- Work on a feature branch. text; visible in the PR.
- security-reviewer on the spec, FAIL routing, two FAILs to the user. pinned.
- Stop for the spec review; commit it with the architect's launch. pinned.

### skills/speckit-team/SKILL.md: 2. Plan and tasks: architect
<!-- fingerprint: 0bd00c70 -->
- Read only `## Open Decisions`; ask every decision at one stop. pinned.
- Answers that all take the recommendation: record them yourself, launch no one. pinned.
- Otherwise one architect revision and the `Spec:` lines to product-owner in one message. pinned.
- Ask once whether to build `[P]` slices side by side. pinned.

### skills/speckit-team/SKILL.md: 3. Audit: spec-auditor
<!-- fingerprint: 0ffcae43 -->
- Commit the approved files with the launch. text.
- CRITICAL and HIGH findings to their owner, or to the user when the owner is absent. pinned.
- A contested finding goes to the user; do not judge it yourself. pinned, unseen (#242).
- MEDIUM and LOW findings are listed at hand-over, not routed. text.
- After two FAILs, the findings go to the user. hook `gate`: a third spec-auditor launch is refused until `audit --approve`, which the skill runs only on the user's yes (#242). The yes itself is text: the hook cannot tell it from a model's.
- An edit to spec, plan, tasks or constitution voids a PASS; ticks do not. hook `gate` (fingerprint).

### skills/speckit-team/SKILL.md: 4-5. Red and green, one round at a time
<!-- fingerprint: d144544e -->
- Rounds of at most 4 slices, never the whole feature to one agent. pinned.
- Take the rounds from the architect's `Round <n>:` lines. pinned.
- Without architect, one round on a brief; without test-writer, no test in implementer's brief. pinned.
- Stubs only when the tests will call something missing. text.
- Send back a test that fails for the wrong reason. text, unseen (#240).
- After 3 REDs in a row, no relaunch. hook `gate retries`, `result`; without an active feature the skill counts (pinned).
- Side-by-side slices in worktrees, merged in task order. pinned.

### skills/speckit-team/SKILL.md: 6. Verify: spec-gatekeeper
<!-- fingerprint: 0a1855e9 -->
- Start once the last round is GREEN and every task is ticked; the `Unbuilt:` line for an absent role's tasks. pinned.
- REJECTED reasons to test-writer or implementer, or the user. pinned.
- security-reviewer on the result, then spec-gatekeeper again after its fix. pinned.

### skills/speckit-team/SKILL.md: 7. Hand over
<!-- fingerprint: 8dc4d8c8 -->
- Open the PR, do not merge, watch CI. text.
- Report the roles, skipped rows, unticked tasks and the retry count's source. pinned.

## skills/speckit-patch/SKILL.md

### skills/speckit-patch/SKILL.md: (opening)
<!-- fingerprint: ad23fcd1 -->
- patcher never commits. hook `patch`.
- `--project` is one word, checked before launch. script `project`, pinned.

### skills/speckit-patch/SKILL.md: 1. Preconditions
<!-- fingerprint: a984e98c -->
- Run `check` first and stop on exit 1. script `check`, pinned (#230).
- Stop without `.specify/`. pinned.
- List a dirty tree's files and ask. text; the hook leaves them out of the record.
- Say how to bring foreground launches back. text.

### skills/speckit-patch/SKILL.md: 2. Before launching
<!-- fingerprint: cd7f4d94 -->
- Run `project` and act on its answer. script `project`, pinned.
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
<!-- fingerprint: 7ca08a5d -->
- Other features' specs are not inputs. text, unseen (cost).

### agents/product-owner.md: Process
<!-- fingerprint: 5011442f -->
- Stop without `.specify/`; follow speckit-specify. text.
- A finding judged wrong is reported `contested` with its file:line; an upheld contest is recorded. pinned.
- At most 5 open questions, highest impact first. text.
- Tick a checklist item only after checking it this run. text, unseen.

### agents/product-owner.md: Lane
<!-- fingerprint: 00d6fa36 -->
- Only `specs/` and `.specify/feature.json`. hook `scope only`, `lane only`.
- Write and Edit, not Bash. hook `scope only` reads Bash too (#209).
- No technologies in the spec; every requirement testable. text; spec-auditor checks.

### agents/product-owner.md: Report
<!-- fingerprint: 015322f2 -->
- At most 20 lines; `READY FOR PLAN` last, only with no open question. text; no `ends` hook.

## agents/architect.md

### agents/architect.md: (opening)
<!-- fingerprint: 15536b51 -->
- Owns how and in what order. text.

### agents/architect.md: Inputs
<!-- fingerprint: 658d56ab -->
- Other features' artifacts are not inputs. text, unseen (cost).

### agents/architect.md: Process
<!-- fingerprint: b69e78fc -->
- Stop on a `[NEEDS CLARIFICATION]` marker. text.
- Minimal design; recovery machinery only where an FR or rule demands it. text; spec-auditor checks.
- Grep for an existing function before a task adds one. pinned; spec-auditor checks (HIGH).
- Each fact once; write `research.md`, `data-model.md`, `contracts/`, `quickstart.md` only when needed. pinned (facts once), text.
- Slices: one behaviour each, every task in one slice. pinned.
- Every test task names its test file and the IDs it covers. pinned; hook `ends --record` checks at spec-gatekeeper's APPROVED that the test files hold the IDs (#228).
- Signatures for stubs; file and symbol for what a task uses. pinned.
- `[P]` only on disjoint files. text; a merge conflict shows a breach.
- Check every constitution MUST rule before reporting. text; spec-auditor checks (CRITICAL).
- `## Open Decisions` with options, consequences and `Spec:` lines; plan and tasks as recommended. pinned.
- Contested findings, answered decisions, dictated revisions. pinned.

### agents/architect.md: Context
<!-- fingerprint: 881e4648 -->
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
- speckit-analyze, read-only. hook `scope none`.
- Read each artifact once; grep the rest. text, unseen (cost).
- A second implementation of existing behaviour is HIGH. pinned.

### agents/spec-auditor.md: Verdict
<!-- fingerprint: 17ab67a7 -->
- FAIL only on CRITICAL or HIGH; a broken MUST rule is CRITICAL; severity by impact. text.
- A finding the user ruled out is not raised again. pinned.

### agents/spec-auditor.md: Report
<!-- fingerprint: 4345ec6a -->
- `VERDICT: PASS` or `VERDICT: FAIL` last. hook `verdict` (asks once, records it against the files it read).

## agents/test-writer.md

### agents/test-writer.md: (opening)
<!-- fingerprint: 1d901c91 -->
- Writes the executable spec. text.

### agents/test-writer.md: Inputs
<!-- fingerprint: 0d3e3e30 -->
- Only the named tasks, the cited lines and the contracts; a brief in place of tasks ticks nothing. pinned (brief), text, unseen (cost).

### agents/test-writer.md: Process
<!-- fingerprint: c6a45c12 -->
- The repo's framework and style. text.
- The FR or scenario ID in each test's name or a comment. hook `ends --record`: at spec-gatekeeper's APPROVED the drift check refuses a cited ID no test file holds (#228).
- Red for the right reason, not a syntax error or a name error. hook `ends RED BLOCKED FIXED`: a RED whose output is one is sent back once, then kept in `ends/red-faults.json` (#240). A missing module is not checked: a RED for a production file not yet written is valid, and the hook cannot tell it from a test helper.
- Run the type check when CI type-checks tests; report a task number no code can meet. pinned.
- Without implementer, a missing production symbol is red. pinned.
- Stop after 3 rounds on one test. text.
- A Bash `timeout` that covers the run. pinned.
- Tick finished tasks; commit on the feature branch. text; visible in the PR.

### agents/test-writer.md: Lane
<!-- fingerprint: f4440b62 -->
- Test files and `tasks.md` only. hook `scope tests`, `lane tests`.

### agents/test-writer.md: Report
<!-- fingerprint: 3fcabb39 -->
- `RED`, `BLOCKED` or `FIXED` last. hook `ends`.

## agents/implementer.md

### agents/implementer.md: (opening)
<!-- fingerprint: b33ad9f4 -->
- Never changes the tests. hook `scope no-tests`, `lane no-tests`.

### agents/implementer.md: Inputs
<!-- fingerprint: 5878364d -->
- Only the tasks, the report and the tests; spec and plan stay unread. pinned (brief), text, unseen (cost).

### agents/implementer.md: Process
<!-- fingerprint: 7f872658 -->
- Confirm the red state first. text.
- The least code that turns the tests green. text.
- The full suite only in the last round. pinned.
- Check each command's own exit status, not a pipe's. text, unseen.
- A Bash `timeout` that covers the run. pinned.
- Tick and commit; in a worktree tick nothing. pinned.

### agents/implementer.md: Stub pass
<!-- fingerprint: a9263c82 -->
- Signatures only, bodies that signal not implemented; `RESULT: STUB`. hook `result` (counts no attempt), text.

### agents/implementer.md: Lane
<!-- fingerprint: 47c5d56c -->
- Everything except test files and `.specify/`. hook `scope no-tests`, `lane no-tests`.
- A test that looks wrong is reported, not changed. text.

### agents/implementer.md: Report
<!-- fingerprint: f67ff55a -->
- `RESULT: GREEN`, `RED` or `STUB` last; 3 REDs in a row block. hook `result`, `gate retries`.

## agents/spec-gatekeeper.md

### agents/spec-gatekeeper.md: (opening)
<!-- fingerprint: 2fa87321 -->
- Verifies and fixes nothing. hook `scope none`.

### agents/spec-gatekeeper.md: Inputs
<!-- fingerprint: 6c1ebb55 -->
- `Team:` and `Unbuilt:` lines. pinned.

### agents/spec-gatekeeper.md: Process
<!-- fingerprint: 5b88acd5 -->
- Every FR has a test that would fail if it broke. hook `ends --record` for an FR a ticked test task cites (#228); text, unseen for the rest (#235).
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
- Finds flaws, fixes nothing. hook `scope none`.

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
- Not the protected paths; 30 production lines and 2 files. hook `scope protected`, `patch`.

### agents/patcher.md: Report
<!-- fingerprint: c5918333 -->
- `DONE`, `FAILED` or `ESCALATE` last. hook `ends`.
- A change with production lines and no test file gives its reason in a `No test: <reason>` line. hook `patch` reads it at the end check (#243).
