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

## 0. Preconditions
- `.specify/` exists. If not, stop: the user runs `specify init --here --ai claude`.
- `.specify/memory/constitution.md` holds real rules, not the template. If not, stop: `/speckit-constitution`.
- The working tree is clean. If not, ask before going on.

## 1. Spec: product-owner
Launch with the idea. Relay its questions with AskUserQuestion, recommended answer first, then
relaunch it with the answers. Repeat until `READY FOR PLAN`.
**Stop:** the user reviews `spec.md`.

## 2. Plan and tasks: architect
**Stop:** show the decisions it flagged; the user approves `plan.md` and `tasks.md`.

## 3. Audit: spec-auditor
On FAIL, send each CRITICAL and HIGH finding to its owner (product-owner or architect), then
re-audit. MEDIUM and LOW findings are accepted: do not route them, and list them once at hand-over.
After two FAILs, hand the findings to the user. A PASS is voided by any later edit to spec, plan, tasks
or constitution.

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
   a row the hook blocks implementer: do not retry. Either send the failing task and its output to
   the architect to rethink (a new audit then resets the count), or hand the decision to the user.

Slices whose tasks are all `[P]` and touch disjoint files may run side by side: one loop per slice,
each implementer with `isolation: "worktree"`, then merge their branches into the feature branch in
task order.

## 6. Verify: spec-gatekeeper
On REJECTED, route each reason to test-writer or implementer, then re-run spec-gatekeeper.

## 7. Hand over
Open the PR per the git rules in CLAUDE.md (do not merge), and watch CI until it is green.
Report each agent's verdict and anything still skipped or open.
