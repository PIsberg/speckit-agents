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
Launch a fresh agent for every phase and every fix round, and let it end when it reports. Never
send a running or finished agent a new task with SendMessage: it keeps everything it has read. In
the 001 run one architect kept alive across 4 audit rounds grew to 726k tokens of context over 729
requests; a fresh one starts near 14k.

Every report you receive stays in your context for the rest of the run and is re-read with each
later request, so each agent's Report section caps its length. Do not ask an agent for more
detail than that, and do not restate a report to the user in full: summarise it in a line.

A subagent starts with nothing but the prompt you write, so keep every prompt lossy: only what
that agent's Inputs section lists. Never paste this conversation, the product owner's questions
and answers, or another agent's full report.
- architect: the feature directory and, on a revision, the findings it owns.
- spec-auditor: the feature directory.
- test-writer: the slice's test task IDs.
- implementer: the slice's task IDs plus test-writer's report for them (test files and failing
  output, trimmed); on a relaunch, the failing output of the last attempt instead. For a stub
  pass, `stub` and the task IDs.
- spec-gatekeeper: the feature directory.

## Pace
Wait for the user only where a step says **Stop:**, or where it says to hand something to the
user. Everywhere else, launch the next agent as soon as the report you need is in: do not ask
whether to go on, and do not end your turn between steps.

## 0. Preconditions
- `.specify/` exists. If not, stop: the user runs `specify init --here --integration claude`.
- The working tree is clean. If not, ask before going on.
- `.specify/memory/constitution.md` holds real rules. If it is missing or still the template
  (placeholder tokens such as `[PROJECT_NAME]` or `[PRINCIPLE_1_NAME]` remain), run step 0b first.

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
relaunch it with the answers. Repeat until `READY FOR PLAN`. If step 0b wrote the constitution,
commit it now, on the feature branch product-owner's speckit-specify created, never on main or master.
**Stop:** the user reviews `spec.md`.

## 2. Plan and tasks: architect
**Stop:** show the decisions it flagged; the user approves `plan.md` and `tasks.md`.

## 3. Audit: spec-auditor
On FAIL, send each CRITICAL and HIGH finding to its owner (product-owner or architect), then
re-audit. MEDIUM and LOW findings are accepted: do not route them, and list them once at hand-over.
After two FAILs, hand the findings to the user. A PASS is voided by any later edit to spec, plan, tasks
or constitution, but not by ticking task checkboxes: the hook ignores checkbox state, so ticks made
while building never call for a re-audit.

## 4-5. Red and green, one slice at a time
Work through `tasks.md` one slice at a time: a slice is one implementation task (or a few that
change the same behaviour) plus the test tasks that cover it. Finish a slice before starting the
next. Never hand the whole feature to one test-writer or one implementer.

For each slice:
1. **Stubs** (implementer, only if the slice's tests will call a file, function or type that does
   not exist yet): launch with `stub` and the slice's task IDs. It creates the signatures the
   architect listed, with bodies that only signal "not implemented", and reports `RESULT: STUB`.
2. **Red** (test-writer, the slice's test task IDs): check the report before moving on. Every
   test must fail on an assertion or on the stub's not-implemented signal. A syntax error, a
   missing import or module, an undefined name or a compile error is a broken test, not a red
   one: send it back. If test-writer reports a missing production symbol, run step 1 for it.
3. **Green** (implementer, the slice's implementation task IDs). Every report ends with
   `RESULT: GREEN` or `RESULT: RED`. On RED, relaunch it with the failing output. After 3 REDs in
   a row the hook blocks implementer: do not retry, and never delete the retry record yourself.
   Either send the failing task and its output to the architect to rethink (a new audit then
   resets the count), or hand the decision to the user.

Slices whose tasks are all `[P]` and touch disjoint files may run side by side: one loop per slice,
each implementer with `isolation: "worktree"`, then merge their branches into the feature branch in
task order.

## 6. Verify: spec-gatekeeper
Start it as soon as the last slice reports `RESULT: GREEN` and every task in `tasks.md` is ticked.
A task still unticked then (a final test run, a docs task no slice took) is one more slice: launch
implementer for it, and verify after its GREEN. Hand to the user only a task no agent can do.
Launch the gatekeeper in the foreground, so its report ends the step, not a later turn. On REJECTED, route each reason to test-writer or implementer, then re-run spec-gatekeeper.

## 7. Hand over
Open the PR per the git rules in CLAUDE.md (do not merge), and watch CI until it is green.
Report each agent's verdict and anything still skipped or open.
