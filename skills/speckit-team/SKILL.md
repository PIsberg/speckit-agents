---
# speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.
name: speckit-team
description: Run a feature through the Spec Kit agent team, product-owner to spec-gatekeeper, stopping where a human decides.
argument-hint: "<feature idea>"
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
- test-writer: the round's test task IDs. It ticks them in `tasks.md` itself once they are red:
  do not tell it otherwise. Left unticked, they hold up the gatekeeper and cost an extra
  implementer launch only to tick them.
- implementer: the round's task IDs plus test-writer's report for them (test files and failing
  output, trimmed); on a relaunch, the failing output of the last attempt instead; `last round`
  when no round follows (step 4-5). For a stub pass, `stub` and the task IDs.
- spec-gatekeeper: the feature directory.

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

## 0b. Constitution (only while it is the template)
The constitution is the user's rules: draft them, never decide them.
1. Read only what the repo already states as rules: `CLAUDE.md` or `AGENTS.md`, the README's
   contributing or development section, the build file, the CI workflow. Draft 3 to 6 principles,
   each one testable rule (MUST or SHOULD) with the file it comes from. Mark a rule you inferred
   rather than read as inferred.
2. Show the draft and ask with AskUserQuestion: use it as drafted (recommended), or change it
   (the user's answer is the change).
3. Invoke the `speckit-constitution` skill with the approved principles as its arguments. Do not
   commit it here: step 1 creates the feature branch, and it is committed there.
**Stop:** the approval in 2. Then go on to step 1 without asking again.

## 1. Spec: product-owner
Launch with the idea. Relay its questions with AskUserQuestion, recommended answer first, then
relaunch it with the answers. Repeat until `READY FOR PLAN`.
Then make sure the work is on a feature branch. Spec Kit's git extension creates one during
speckit-specify; Spec Kit 1.x installs that extension only with `specify init --extension git`.
If you are still on main or master, create the branch yourself, named after the feature directory
(`git switch -c <its basename>`); uncommitted work moves with it.
**Stop:** the user reviews `spec.md`. Once they approve, commit it, and the constitution if step 0b
wrote it, on that branch, in the message that launches the architect: Claude Code runs the calls of
one message in order, so the commit lands before the architect starts and needs no request of its
own, which would re-read your whole context.

## 2. Plan and tasks: architect
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
same stop, with AskUserQuestion, whether to build them one at a time (recommended: no live run has confirmed
side-by-side launches yet) or side by side. Say why it matters: side by side may be faster but
costs more, since each `[P]` slice then gets its own agents instead of sharing its round's, and it
runs several agents against the user's usage limits at once. Ask once per run; the answer holds for every `[P]` group.

## 3. Audit: spec-auditor
Commit the approved spec, plan and tasks in the message that launches it (see step 1). On FAIL,
send each CRITICAL and HIGH finding to its owner (product-owner or architect), then re-audit.
MEDIUM and LOW findings are accepted: do not route them, and list them once at hand-over.
After two FAILs, hand the findings to the user. A PASS is voided by any later edit to spec, plan, tasks
or constitution, but not by ticking task checkboxes: the hook ignores checkbox state, so ticks made
while building never call for a re-audit.

## 4-5. Red and green, one round at a time
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
   one: send it back. If test-writer reports a missing production symbol, run step 1 for it. If
   it reports a task number that cannot hold, send a test-writer the number the code allows when
   the task's intent is plain, and list the task at hand-over; otherwise the architect rewrites it.
3. **Green** (implementer, the round's implementation task IDs, and `last round` when no round
   follows). An implementer runs the tests that cover its change, and the full suite only in the
   last round; spec-gatekeeper runs it once more. In the 004 run the full suite ran 5 times, about
   14.5 of the 48 agent-minutes. Every report ends with `RESULT: GREEN` or `RESULT: RED`. On RED,
   relaunch it with the failing output. After 3 REDs in a row the hook blocks implementer: do not
   retry, and never delete the retry record yourself.
   Either send the failing task and its output to the architect to rethink (a new audit then
   resets the count), or hand the decision to the user.

Only if the user chose side by side in step 2, the slices of a round whose tasks are all `[P]` and
touch disjoint files run side by side instead: one loop per slice, each step's agents launched
together in one message, each implementer with `isolation: "worktree"`,
then merge their branches into the feature branch in task order.

## 6. Verify: spec-gatekeeper
Start it as soon as the last round reports `RESULT: GREEN` and every task in `tasks.md` is ticked.
A task still unticked then (a final test run, a docs task no round took) is one more round: launch
implementer for it with `last round`, and verify after its GREEN. Hand to the user only a task no
agent can do. On REJECTED, route each reason to test-writer or implementer (an implementer then
with `last round`), then re-run spec-gatekeeper.

## 7. Hand over
Open the PR per the git rules in CLAUDE.md (do not merge), and watch CI until it is green.
Report each agent's verdict and anything still skipped or open.
