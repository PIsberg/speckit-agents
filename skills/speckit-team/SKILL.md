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
On FAIL, send each finding to its owner (product-owner or architect), then re-audit. After two
FAILs, hand the findings to the user. A PASS is voided by any later edit to spec, plan, tasks
or constitution.

## 4. Red: test-writer
Check that the report shows failing output for every test before moving on.

## 5. Green: implementer
Default: one implementer, all tasks. For `[P]` tasks on disjoint files, launch one implementer
per task group with `isolation: "worktree"` and its task IDs, then merge their branches into the
feature branch in task order.

## 6. Verify: spec-gatekeeper
On REJECTED, route each reason to test-writer or implementer, then re-run spec-gatekeeper.

## 7. Hand over
Open the PR per the git rules in CLAUDE.md (do not merge), and watch CI until it is green.
Report each agent's verdict and anything still skipped or open.
