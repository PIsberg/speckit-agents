---
# speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.
name: speckit-team
description: Run a feature through the Spec Kit agent team, product-owner to spec-gatekeeper, stopping where a human decides.
argument-hint: "[--team <role>,<role>...|noagents] [--security] [--project <name>] <feature idea>"
disable-model-invocation: true
---

Run the Spec Kit team on: $ARGUMENTS

The main session orchestrates: it holds the conversation with the user, launches each agent with
the inputs it needs and passes reports along. It does not do the agents' work itself. Team and
hooks: the README.md of the speckit-agents repo.

## Handoffs
Launch every agent in the foreground (`run_in_background: false`). Its report is the tool's
result or, when the result says so, the agent's own message (its `SubagentHandback` call, as in
Claude Code 2.1.296). A background launch costs you an extra request that only waits, and each
request re-reads your whole context: in the 2026-10-07 runs those waits were 41% and 44% of the
main session's input. Agents meant to run side by side go in one message as several Agent calls.

If your Agent tool has no `run_in_background` parameter, every agent runs in the background
whatever you pass. Then launch it and end your turn: its completion notification brings the
report. Do not poll it, sleep, or read its output file.

Launch a fresh agent for every phase and every fix round, and let it end when it reports. Never
send a running or finished agent a new task with SendMessage: it keeps everything it has read. In
the 001 run one architect kept alive across 4 audit rounds grew to 726k tokens of context over 729
requests; a fresh one starts near 14k.

Every report you receive stays in your context for the rest of the run and is re-read with each
later request, so each agent's Report section caps its length. Do not ask an agent for more
detail than that, and do not restate a report to the user in full. Before each launch, tell the
user in one line what the agent will do (for the architect's first pass, that it is the longest
step: 654 s in the 004 run); after its report, one line with its last word, what it changed and
how long it took (`duration_ms` in the result). While an agent works, the user sees only the Agent
call's `description` and the agent's tool calls, never its text (Claude Code 2.1.296), so let the
description name the step and the task IDs (`Red: T001 to T007`).

A subagent starts with nothing but the prompt you write, so keep every prompt lossy: only what
that agent's Inputs section lists. Never paste this conversation, the product owner's questions
and answers, or another agent's full report.
- architect: the feature directory and, on a revision, the findings it owns or the user's answers
  by decision ID. When the answers or findings fully determine every edit (a value, a list entry,
  a wording), start the prompt with `dictated:` and give each exact edit with where it goes (file
  and heading or line): the architect then greps and edits without re-reading the artifacts. In
  the 003 run a revision that named the line cost 0.11M tokens; one with fully decided changes that
  named only the files cost 0.70M. Anything that needs design judgement is a full revision, and so
  is an edit a dictated architect reports as `needs revision`. An ID an answer drops or renames is
  one edit for every mention (`drop T013 everywhere under specs/004-x/`), which the architect
  greps for itself: in the 004 run a list of lines from a grep cut at 200 columns missed four of
  them, and cost one more architect.
- spec-auditor: the feature directory.
- security-reviewer: when in spec state, the feature directory and `spec.md`; when reviewing the result, the feature directory and the command to inspect the diff (`git diff main...HEAD` or `master...HEAD`).
- test-writer: the round's test task IDs. It ticks them in `tasks.md` itself once they are red:
  do not tell it otherwise. Left unticked, they hold up the gatekeeper and cost an extra
  implementer launch only to tick them. In a one-round run (step 4-5) the brief instead.
- implementer: the round's task IDs plus test-writer's report for them (test files and failing
  output, trimmed); on a relaunch, the failing output of the last attempt instead; `last round`
  when no round follows (step 4-5). For a stub pass, `stub` and the task IDs.
- spec-gatekeeper: the feature directory and, when tasks are unbuilt (step 6), the `Unbuilt:` line.

In a run whose team is not the full team, every launch prompt carries one `Team:` line with the
chosen roles in pipeline order, lower case, separated by a comma and a space, for example:

    Team: test-writer, implementer

A full-team run carries no `Team:` line, so its prompts are as above.

When a project is active (the `--project` flag was given), every launch prompt of every role and
every fix round carries one `Project:` line, after the `Team:` and `Unbuilt:` lines when present, for
example:

    Project: billing

Prompts carry only an agent's Inputs; the `Project:` line is the only exception. Without the flag,
no prompt carries a `Project:` line (prompts are worded as before). Never paste the block or the
project's instructions into any prompt: the hook injects them as `additionalContext` at
`SubagentStart`. Commit the approved files (spec, plan, tasks, the constitution) in the message of
the next launch, whichever role it is.

## Pace
Wait for the user only where a step says **Stop:**, or where it says to hand something to the
user. Everywhere else, launch the next agent as soon as the report you need is in: do not ask
whether to go on, and do not end your turn between steps, except to wait for an agent that runs in
the background (see Handoffs). AskUserQuestion takes at most 4 questions per call: at any stop, ask
in as many calls as it takes, all before the next launch.

## 0. Preconditions
- `.specify/` exists. If not, stop: the user runs `specify init --here --integration claude`.
- The conversation holds nothing but this run. If it already holds other work, tell the user once,
  in one line, that every response of the run re-reads it and that `/clear` before `/speckit-team`
  avoids that (in the 004 run, 2.73M of the main session's 8.92M). Then go on.
- The working tree is clean. If not, ask before going on.
- `.specify/memory/constitution.md` holds real rules. If it is missing or still the template
  (placeholder tokens such as `[PROJECT_NAME]` or `[PRINCIPLE_1_NAME]` remain), run step 0b first.
- Your Agent tool has a `run_in_background` parameter. If not, Claude Code has fork subagents on
  (the default in an interactive session) and runs every agent in the background, which costs an
  extra waiting request per agent. Tell the user once, in one line, that `CLAUDE_CODE_FORK_SUBAGENT=0`
  in the shell or under `env` in settings.json (`node install.mjs --no-fork` in the speckit-agents
  checkout writes it for every project), then a restart, brings foreground launches back.
  Then go on.

## Team
`--team`, `--security` and `--project` lead the arguments before the request text, in any order (`--team <roles> --project <name>`, `--security <request>`, etc.), each at most once. A `--team`, `--security` or `--project` after the request text has started is request text.

`--team` counts only as the first word of the arguments (or the first word after a leading `--project <name>` or `--security`): `--team <role>[,<role>...] <request>`. The
role list is the words after it up to and including the first word that does not end in a comma
(`test-writer, implementer` and `test-writer,implementer` both name two roles). Names are
case-insensitive, a name given twice counts once, and order does not matter. The team roles, in
pipeline order, are `product-owner`, `architect`, `spec-auditor`, `test-writer`, `implementer`,
`spec-gatekeeper` and `security-reviewer`; `patcher` is not a team role (it is the fast track's).
The `security-reviewer` is opt-in: it is included when requested via `--security` or named in `--team`
(`--team ...,security-reviewer` or alias `security`). All six core roles named is the full
team, the same run as without `--team`.

`--team noagents` (the list is the one word `noagents`, in any case) runs no agent at all: you run
Spec Kit's own skills in this session by `## No agents`, which replaces steps 0b to 6. It is chosen
only by typing it, because the hook reads the typed command to let this session's
`speckit-implement` past the audit gate. So it is not one of the question's options, and a
free-text answer of `noagents` is not that choice: say in one line that it is typed as
`/speckit-team --team noagents <request>`, and stop.

With no roles named (no `--team`), ask once, before any launch, with one AskUserQuestion call, a single-select question. **Stop:** wait for the answer. The options:
1. Full team (Recommended): all six roles.
2. Build only: test-writer, implementer.
3. Implement only: implementer.
4. Spec and build, no audit or verification: product-owner, architect, test-writer, implementer.

A free-text answer ("Other") is a role list read as above and checked by the same refusals below. A request with `--team` is not asked: the question is only for requests without it. When `--security` was given with no `--team`, security-reviewer is added to the chosen team.

Before anything is launched, refuse in one message that says why and lists the valid names:
- a name that is not a team role (also `--team` followed straight by the request: its first word
  is the unknown name): that name is not a team role;
- an empty team: no roles named;
- `noagents` with a role: no agents means no roles;
- neither `test-writer` nor `implementer`: one of them is required;
- `architect` without `product-owner`: architect plans from product-owner's spec;
- `spec-auditor` without `architect`: spec-auditor audits architect's plan and tasks.

Then tell the user in one line the team and what is skipped: every step of an absent role is
skipped, as is step 0b unless architect, spec-auditor or spec-gatekeeper is chosen. Without
product-owner nothing creates a feature branch: if the tree is on main or master, run
`git switch -c team/<the request in kebab case, at most 40 characters>` before the first launch.
Skipped rows, per absent role:
- product-owner: the spec, its questions and the spec review stop.
- architect: plan and tasks, the plan stop and its open decisions, rounds by phase (one round
  instead), spec-gatekeeper's open-task check; at the retry limit the user decides.
- spec-auditor: the audit and its FAIL routing, the audit gate on test-writer and implementer.
- test-writer: the red step and the test tasks, which stay unticked.
- implementer: the stub and green steps; its tasks stay unticked.
- spec-gatekeeper: verification and REJECTED routing, the recorded last word.
- security-reviewer: the security review of the spec and the security review of the result.

## No agents
Only when the arguments start `--team noagents`. You run Spec Kit's own skills in this session: no
Agent call at all, and no `Team:` line. Tell the user in one line that no agent runs, so the audit,
the verification and every agent hook are skipped, and step 0b with them. Step 0 holds, except its
Agent tool check. Wait only at the two stops below.
1. **Spec.** If a project is active, read the block first from the `project` CLI output and follow the block (the project's instructions and knowledge files). The project block applies to this request only: a later request in the same conversation without the flag disregards it. Invoke the `speckit-specify` skill with the request text. Ask each open question (a
   `[NEEDS CLARIFICATION]` marker; at most 5, the most impactful first) with AskUserQuestion,
   recommended answer first, and write each answer into the requirement it settles and under
   `## Clarifications` as `- Q: <question> → A: <answer>`. The work goes on a feature branch, as in
   step 1. **Stop:** the user reviews `spec.md`; on approval, commit it.
2. **Plan and tasks.** Invoke `speckit-plan`, then `speckit-tasks`. **Stop:** ask about every choice
   the plan leaves open, recommended option first, then the user approves `plan.md` and `tasks.md`;
   on approval, commit them.
3. **Build.** Invoke `speckit-implement`. The hook lets it past the audit gate because the user typed
   `--team noagents`. If it is denied anyway, the hook did not see the typed command (an older
   Claude Code, or a request not typed that way): stop, and tell the user to run
   `@agent-spec-auditor` or to start again by typing the command. Run the tests that cover each
   task, and the full suite once at the end. After 3 failed runs of the same tests in a row, stop
   fixing and hand the failing output to the user.
4. **Hand over** by step 7; the report names the active project (when one was active) and the skipped audit, verification and agent hooks
   instead of roles.

## Project
`--project` takes exactly the next word: `--project <name>`. If given without `<name>` (or with a missing name) or twice, refuse before any launch: say why and list available projects by running `node "{{HOOK}}" project`.

Before anything is launched:
1. Check `<name>` against the project name pattern (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, letters,
   digits, `-` and `_` only, at most 64 characters). If invalid, tell the user in one line that `<name>`
   is not a valid project name: letters, digits, - and _ only, and stop with nothing launched.
2. In one Bash call, run `node "{{HOOK}}" project '<name>'` (with `'<name>'` single-quoted, so no
   untrusted name reaches the shell unchecked).
3. If it exits with a non-zero status:
   - If the output contains `no project <name> in .specify/projects/; create it with --init.`: ask the
     user once with AskUserQuestion whether to create it (`Create project <name>?`). On yes, run
     `node "{{HOOK}}" project '<name>' --init`, show its output line, and stop with nothing launched so
     the user can write the project's rules first. On no, stop with nothing launched.
   - Otherwise (or if the output's first line does not start `Project `), show what it printed and
     stop before any launch.
4. If it exits 0 and the first line starts `Project <name>:`, tell the user in one line the start notice
   from the header line (for example, `Project billing: 2 knowledge files, instructions 812 bytes.`).

## 0b. Constitution (only while it is the template)
Run this step only when the team has architect, spec-auditor or spec-gatekeeper, the roles that
read the constitution; otherwise skip it, the template stays and the start notice names it as
skipped.
The constitution is the user's rules: draft them, never decide them.
1. Read only what the repo already states as rules: `CLAUDE.md` or `AGENTS.md`, the README's
   contributing or development section, the build file, the CI workflow. Draft 3 to 6 principles,
   each one testable rule (MUST or SHOULD) with the file it comes from. Mark a rule you inferred
   rather than read as inferred.
2. Show the draft and ask with AskUserQuestion: use it as drafted (recommended), or change it
   (the user's answer is the change).
3. Invoke the `speckit-constitution` skill with the approved principles as its arguments. Do not
   commit it here: step 1 creates the feature branch, and it is committed there. Without
   product-owner, commit it on the `team/` branch in the message of the first launch.
**Stop:** the approval in 2. Then go on to step 1 without asking again.

## 1. Spec: product-owner
Only when product-owner is in the team; without it, skip this step.
Launch with the idea. Relay its questions with AskUserQuestion, recommended answer first, then
relaunch it with the answers. Repeat until `READY FOR PLAN`.
Then make sure the work is on a feature branch. Spec Kit's git extension creates one during
speckit-specify; Spec Kit 1.x installs that extension only with `specify init --extension git`.
If you are still on main or master, create the branch yourself, named after the feature directory
(`git switch -c <its basename>`); uncommitted work moves with it.
If security-reviewer is in the team: launch security-reviewer in the foreground (`run_in_background: false`) with `phase: spec` and the feature directory to review `spec.md`. On FAIL, route CRITICAL and HIGH findings to product-owner (or to the user if product-owner is absent), then relaunch security-reviewer. On PASS, proceed to the spec review stop.
**Stop:** the user reviews `spec.md`. Once they approve, commit it, and the constitution if step 0b
wrote it, on that branch, in the message that launches the architect: Claude Code runs the calls of
one message in order, so the commit lands before the architect starts and needs no request of its
own, which would re-read your whole context.

## 2. Plan and tasks: architect
Only when architect is in the team; without it, skip this step.
**Stop:** the user settles every open decision and approves `plan.md`, `tasks.md` and the spec
lines the decisions reword.
The architect's report lists each open decision by ID; its options, and what follows from each,
are in `## Open Decisions`, the last section of `plan.md`. Read only that section, in one command
(`sed -n '/^## Open Decisions/,$p'` on the file), and ask about every open decision at this one
stop with AskUserQuestion, recommended option first, each option's description saying what
follows from it. With more than 4, ask first one question that lists every decision with its
options: take every recommended option (recommended), or decide one by one. The user can also
answer with exceptions (`D5: B`). In the 004 run 5 of 6 answers were the recommended option.
Then send all the answers to one architect revision (dictated where they fully determine the
edits, see Handoffs) and, in the same message, the chosen options' `Spec:` lines to product-owner:
the two write different files, and the first audit then reads a spec that agrees with the plan.
In the 004 run a decision that contradicted FR-012 failed the first audit, and the fix cost a
product-owner and a second audit (229 s, 0.59M tokens). In the 003 run four architect revisions
only applied answers, 7.37M tokens together.
If `tasks.md` has two or more slices whose tasks are all `[P]` and touch disjoint files, ask at the
same stop, with AskUserQuestion, whether to build them one at a time (recommended: it costs less, and
no run with real models has built slices side by side yet) or side by side. Say why it matters: side by side may be faster but
costs more, since each `[P]` slice then gets its own agents instead of sharing its round's, and it
runs several agents against the user's usage limits at once. Ask once per run; the answer holds for every `[P]` group.

## 3. Audit: spec-auditor
Only when spec-auditor is in the team; without it, skip this step.
Commit the approved spec, plan and tasks in the message that launches it (see step 1). On FAIL,
send each CRITICAL and HIGH finding to its owner (product-owner or architect), then re-audit.
An owner not in the team (absent, unchosen) cannot take a finding: hand it to the user.
MEDIUM and LOW findings are accepted: do not route them, and list them once at hand-over.
After two FAILs, hand the findings to the user. A PASS is voided by any later edit to spec, plan, tasks
or constitution, but not by ticking task checkboxes: the hook ignores checkbox state, so ticks made
while building never call for a re-audit.

## 4-5. Red and green, one round at a time
Skip a step whose role is absent from the team, and never launch anyone for the tasks of an absent
role. Without architect there is no `tasks.md`: run one round on a brief, the request text or, with
product-owner, the approved `spec.md`. One test-writer then one implementer get the brief in their
prompt in place of task IDs and tick nothing; implementer gets `last round`. A stub pass runs only
when test-writer reports a missing production symbol.

A slice is one implementation task (or a few that change the same behaviour) plus the test tasks
that cover it, as the architect wrote them. A round is the slices of one phase of `tasks.md` (Setup,
Foundational, one user story), at most 4 slices: split a longer phase into rounds in task order.
Build one round at a time, with one stub pass, one test-writer and one implementer per round, and
finish it before starting the next. Every launch starts from nothing (11k to 14k tokens before it
reads a file) and reads the code again, so up to three launches per slice made the build the
longest part of a run. Never hand the whole feature to one test-writer or one implementer.

For each round:
1. **Stubs** (implementer, only if the round's tests will call a file, function or type that does
   not exist yet): launch with `stub` and the round's task IDs. It creates the signatures the
   architect listed, with bodies that only signal "not implemented", and reports `RESULT: STUB`.
2. **Red** (test-writer, the round's test task IDs): check the report before moving on. It ends
   `RED` or `BLOCKED`, and on `RED` the round's test tasks are ticked; on `BLOCKED`, act on the
   entries it lists. A test-writer sent only to correct an existing test ends `FIXED`. Every
   test must fail on an assertion or on the stub's not-implemented signal. A syntax error, a
   missing import or module, an undefined name or a compile error is a broken test, not a red
   one: send it back. If test-writer reports a missing production symbol, run step 1 for it. When
   implementer is absent there is no stub step: a failure on a missing production symbol or module
   that test-writer lists is red, and the skill still sends back a syntax error or a missing
   test-side name. If
   it reports a task number that cannot hold, send a test-writer the number the code allows when
   the task's intent is plain, and list the task at hand-over; otherwise the architect rewrites it.
3. **Green** (implementer, the round's implementation task IDs, and `last round` when no round
   follows). An implementer runs the tests that cover its change, and the full suite only in the
   last round; spec-gatekeeper runs it once more. In the 004 run the full suite ran 5 times, about
   14.5 of the 48 agent-minutes. Every report ends with `RESULT: GREEN` or `RESULT: RED`. On RED,
   relaunch it with the failing output. After 3 REDs in a row the hook blocks implementer: do not
   retry, and never delete the retry record yourself.
   With no active feature (no `.specify/feature.json`, or one naming no directory) the hook counts
   nothing, so count yourself: after 3 implementer `RESULT: RED` in a row, relaunch none and hand
   the failing output to the user.
   Either send the failing task and its output to the architect to rethink (a new audit then
   resets the count), or hand the decision to the user.

Only if the user chose side by side in step 2, the slices of a round whose tasks are all `[P]` and
touch disjoint files run side by side instead: one loop per slice, each step's agents launched
together in one message, each implementer with `isolation: "worktree"` and `worktree` in its prompt,
so that it ticks nothing (ticks on adjacent lines of `tasks.md` conflict when the branches merge).
A worktree starts from the last commit, without uncommitted work: commit the round's tests and
ticks in the message that launches the implementers. After each implementer step, in one Bash
call chained with `&&`: merge the branches the results name (`worktreeBranch`) into the feature
branch in task order, tick the tasks each report names as done and commit, then
`git worktree remove` each `worktreePath` and `git branch -d` its branch, since `git add -A` would
commit a worktree left in place.

## 6. Verify: spec-gatekeeper
Only when spec-gatekeeper is in the team; without it, skip this step. Start it as soon as the last
round reports `RESULT: GREEN` and every task in `tasks.md` is ticked; when implementer is absent,
as soon as the last round's test-writer reports `RED`. When test-writer or implementer is absent,
launch no one for its tasks and put one line after the `Team:` line, the `Unbuilt:` line, with exactly those task IDs in
task order, for example:

    Unbuilt: T001, T003, T005

and start once every other task is ticked.
A task still unticked then (a final test run, a docs task no round took), limited to the chosen
roles' tasks, is one more round: launch
implementer for it with `last round`, and verify after its GREEN. Hand to the user only a task no
agent can do. On REJECTED, route each reason to test-writer or implementer, whichever is chosen (a reason for a
role not chosen goes to the user) (an implementer then
with `last round`), then re-run spec-gatekeeper.
If security-reviewer is in the team: after spec-gatekeeper verification (or after the last round when spec-gatekeeper is absent), launch security-reviewer in the foreground (`run_in_background: false`) with `phase: result` to inspect the code diff and dependencies. On FAIL, route CRITICAL and HIGH findings to implementer (or test-writer, or to the user if neither is chosen), then relaunch security-reviewer. On PASS, proceed to handover.

## 7. Hand over
Open the PR per the git rules in CLAUDE.md (do not merge), and watch CI until it is green.
Report the active project (when one was active), the roles that ran with each one's verdict (including security-reviewer when opted in), a row for each absent role as skipped, the
unticked tasks and anything still open. In a run with implementer and no active feature, say the
retry limit was the skill's count, not the hook's.
