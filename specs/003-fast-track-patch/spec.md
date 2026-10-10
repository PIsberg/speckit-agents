# Feature Specification: Fast track for small changes

**Feature Branch**: `003-fast-track-patch`

**Created**: 2026-10-09

**Status**: Implemented (merged in PR #76, 2026-10-10). Approved by the owner at b215aef; FR-007 and the Threat Model were amended after that by owner decisions (9d7deb8, 4591bbb; plan.md decisions 15 to 17).

**Input**: GitHub issue #68, "Feature: Implement a /specify-fastrack for small changes in the flow". The issue's cost and time figures and its model suggestions are not requirements.

## Clarifications

### Session 2026-10-09

- Q: What is the budget, and do test and doc lines count? → A: 30 changed lines and 2 files, production code only; tests and docs do not count.
- Q: What happens to the work when a run is stopped for budget? → A: Kept uncommitted in the working tree, no pull request, escalation message names `/speckit-team`; the fast track never starts `/speckit-team`.
- Q: Is triage in scope? → A: Yes, as a P3 advisory step only: it suggests a track with a reason, the developer confirms, it never runs a track itself.
- Q: What happens when a protected file is changed by other means (for example a shell command)? → A: The end-of-run check blocks the agent from finishing, naming the files and the restore command (`git checkout <start sha> -- <file>`, or delete a new file), until they are restored. Files already dirty at the start are excluded and never touched, and the hook runs no destructive git command. Rule of thumb: over-budget production changes stay in the working tree; protected-path changes must be restored.
- Q: Are binary production files allowed on the fast track? → A: No. Any added or modified binary production file stops the run with the `/speckit-team` escalation message. Renamed and deleted production files still count as files touched.
- Q: Are the budget-stop requirements one or two? → A: One. FR-006 now covers the stop (no commit, no pull request, work stays uncommitted, message with counts and limits, never starts `/speckit-team`); FR-008 is removed and the other ids are not renumbered.

### Session 2026-10-10

- Q: Which adversary does the fast track guard against, given two audit rounds kept finding shell routes around the hooks? → A: An agent that overreaches by mistake or drifts out of scope, not one that deliberately evades the hooks through the shell. Evasion routes are listed as known limits in the README and are not defects of this feature. FR-006 and FR-007 apply within this threat model (see "Threat Model").

- Q: What happens when the installed team in the Claude config directory (hook script, agent definitions, skills, settings files) is changed by other means? → A: A direct write is still denied. A change by other means, detected at the end of the run, ends the run as FAILED with a message naming the files; nothing is committed, pushed or opened as a pull request. It does not block the agent from finishing, because the agent has no restore path for files outside the repository. Protected files inside the repository keep the block-until-restored rule. This amends FR-007.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Make a trivial change without the full pipeline (Priority: P1)

A developer who wants a typo fixed, a config value changed or a small bug fixed asks for it through a fast track beside `/speckit-team`. The change is made in one pass on a branch, with no spec, plan, tasks or audit, and the repo's existing tests must pass before it is handed over as a pull request.

**Why this priority**: This is the whole point: the full pipeline is too heavy for daily maintenance, so developers either skip the tool or bypass its guardrails.

**Independent Test**: In a scratch Spec Kit repo, request a one-line typo fix through the fast track. A branch with one small commit exists, no feature directory under `specs/` was created, and the existing tests passed.

**Acceptance Scenarios**:

1. **Given** a repo with passing tests, **When** the developer requests a one-line typo fix, **Then** a branch holds the fix, no `spec.md`, `plan.md` or `tasks.md` was written, and the existing tests were run and passed.
2. **Given** a repo with passing tests, **When** the change makes an existing test fail and the agent cannot fix it within the budget, **Then** the run ends reporting the failing test, and no pull request is opened.
3. **Given** the fast track finished, **When** the developer reads the result, **Then** it states what changed, the diff size against the budget, and the test outcome.

---

### User Story 2 - Enforced scope budget with escalation (Priority: P1)

The fast track cannot grow into a feature. A hook measures the change against a budget (changed lines, files touched). When the change would exceed it, the run stops and tells the developer to use `/speckit-team`.

**Why this priority**: Without an enforced ceiling the fast track becomes a way around every guardrail the project has.

**Independent Test**: Run the fast track with a request that needs more than the budget. The run is stopped with a message that names the measured size, the limit and `/speckit-team`.

**Acceptance Scenarios**:

1. **Given** a budget of 30 production-code lines and 2 production-code files, **When** the change exceeds either, **Then** the run is stopped and the message gives the measured value, the limit and says to escalate to `/speckit-team`.
2. **Given** a change within budget, **When** it finishes, **Then** nothing is blocked.
3. **Given** the budget is exceeded, **When** the developer checks the repo, **Then** no pull request was opened and no commit was made by the fast track, and the changes are still in the working tree.
4. **Given** a change of 5 production lines plus 200 lines of tests and docs, **When** it is measured, **Then** it is within budget.
5. **Given** a change that adds or modifies a binary production file, **When** it is measured, **Then** the run is stopped with the `/speckit-team` escalation message, whatever the line and file counts.

---

### User Story 3 - Protected paths stay protected (Priority: P1)

The fast track may not change files that carry the project's guardrails or contracts (for example the hook script, agent definitions, installer, Spec Kit's config and the constitution). A write to one is denied before the file changes, and the message says to use `/speckit-team`.

**Why this priority**: These are the files that make the other tracks safe. A trivial-change path through them defeats the tool.

**Independent Test**: Ask the fast track to edit a protected file. The write is denied and the file is unchanged. Change a protected file in the repository through a shell command: the agent cannot finish until it is restored. Change an installed team file in the Claude config directory through a shell command: the run ends as FAILED, naming the file, with nothing committed, pushed or opened as a pull request.

**Acceptance Scenarios**:

1. **Given** a protected path, **When** the fast track tries to write it directly, **Then** the write is denied and the file is unchanged.
2. **Given** a protected file was changed by other means such as a shell command, **When** the agent tries to finish, **Then** it is blocked, and the message names the files and the restore command (`git checkout <start sha> -- <file>`, or delete a new file), until they are restored.
3. **Given** a protected file that was already modified when the run started, **When** the run ends, **Then** that file is not reported, blocked on or touched, unless it changed again during the run, which stops the run like an over-budget change (plan.md decision 13).
4. **Given** an unprotected path, **When** the fast track writes it, **Then** it is allowed.
5. **Given** an installed team file in the Claude config directory (hook script, agent definition, skill or settings file), **When** the fast track tries to write it directly, **Then** the write is denied and the file is unchanged.
6. **Given** an installed team file in the Claude config directory was changed by other means such as a shell command, **When** the run ends, **Then** the run ends as FAILED with a message naming the files, nothing is committed, pushed or opened as a pull request, and the agent is not blocked from finishing.

---

### User Story 4 - Existing tracks are unchanged (Priority: P1)

Adding the fast track does not weaken or alter `/speckit-team`, the audit gate, the lanes or the retry limit, and costs nothing in repos without `.specify/`.

**Why this priority**: The issue asks for a track beside the pipeline, not a relaxation of it.

**Independent Test**: The existing test suites pass unchanged, and a run of `/speckit-team` still denies implementer before an audit passes.

**Acceptance Scenarios**:

1. **Given** the fast track is installed, **When** implementer is called inside `/speckit-team` before an audit passed, **Then** it is still denied.
2. **Given** a repo without `.specify/`, **When** any tool is used, **Then** the fast track's hooks produce no output and no block.
3. **Given** the fast track was installed, **When** the installer runs with its uninstall option, **Then** every file and settings entry it added is removed and nothing else.

---

### User Story 5 - Route a request to the right track (Priority: P3)

Before work starts, the developer is told whether the request looks like a small change or a feature, with the reason, and can accept or override it.

**Why this priority**: Convenience on top of two tracks that already work by explicit choice.

**Independent Test**: Give a typo request and an "add a new command" request; the first is suggested for the fast track, the second for `/speckit-team`, each with a one-line reason.

**Acceptance Scenarios**:

1. **Given** a request that adds a capability, changes a public contract or touches a protected path, **When** it is triaged, **Then** `/speckit-team` is suggested with the reason.
2. **Given** a suggestion, **When** the developer overrides it, **Then** the chosen track runs and its own guardrails still apply.

### Edge Cases

- The change is within budget but touches a protected path: denied, not budgeted.
- A protected file is changed through a shell command rather than a file write: the end-of-run check blocks finishing until it is restored; the hook itself runs no destructive git command. Protected files already dirty at the start are excluded.
- Over-budget production changes stay in the working tree; protected-path changes inside the repository must be restored.
- An installed team file in the Claude config directory is changed by other means: the run ends as FAILED naming the files, with no commit, push or pull request. The agent is not blocked, since it cannot restore files outside the repository.
- The production-code diff is exactly 30 lines in 2 files: allowed. 31 lines or 3 files: stopped.
- The working tree already has uncommitted changes when the fast track starts: they are not counted as the fast track's change, and are not swept into its commit.
- Renamed or deleted production files: counted as files touched. An added or modified binary production file is not allowed: the run is stopped with the escalation message. Test and documentation files of any kind are not counted.
- Existing tests are absent or the test command is unavailable: reported as not run, never as passed, and the run does not claim success.
- The hook crashes or gets malformed input: the action proceeds (existing fail-open rule) and a test covers the path.
- Windows, macOS and Linux behave the same, including path comparison.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST offer a fast-track command beside `/speckit-team` that makes a change in one pass without creating `spec.md`, `plan.md`, `tasks.md` or a spec audit.
- **FR-002**: The fast track MUST work on a feature-less branch and MUST NOT open a pull request unless the existing tests passed.
- **FR-003**: The fast track MUST report the existing tests as passed, failed, skipped or not run, distinctly.
- **FR-004**: A change that adds or changes behaviour (a bug fix) MUST include a regression test, shown failing before the fix where practical; typos, comments, docs and config values with no behaviour are exempt.
- **FR-005**: A hook MUST measure the change in changed lines and files touched, and stop the run when either exceeds the budget; the budget MUST be 30 changed lines and 2 files, counting production code only; added or modified binary production files are not allowed at all (FR-006). Test files and documentation files do not count toward either limit; what counts as a test or documentation file is fixed in the plan and covered by a test.
- **FR-006**: When the budget is exceeded, or a binary production file is added or modified, the run MUST make no commit and open no pull request, the work MUST stay uncommitted in the working tree, and the message MUST give the measured counts, the limits and the instruction to use `/speckit-team`; the fast track MUST NOT start `/speckit-team` itself.
- **FR-007**: A hook MUST deny writes to protected paths before the file changes. For a protected file changed by other means, for a protected file inside the repository the end-of-run check MUST block the agent from finishing, naming the files and the restore command (`git checkout <start sha> -- <file>`, or delete a new file), until they are restored; protected files already dirty when the run started MUST be excluded and never touched, and the hook MUST NOT run any destructive git command. The protected set inside the repository MUST include at least: the hook script, the agent definitions, the installer, Spec Kit's config, the constitution and CI workflow files. The installed team in the Claude config directory (the hook script, agent definitions, skills and settings files installed there) is also protected: a direct write MUST be denied, and a change by other means detected at the end of the run MUST end the run as FAILED with a message naming the files, with nothing committed, pushed or opened as a pull request; it MUST NOT block the agent from finishing.
- **FR-009**: The fast track MUST NOT alter the decisions of the audit gate, lanes or retry limit for `/speckit-team`.
- **FR-010**: The fast track's hooks MUST be inactive, silent and non-blocking in repos without `.specify/`.
- **FR-011**: Every hook path MUST handle empty, malformed and unknown input without throwing, and each such path has a test.
- **FR-012**: The installer MUST install and uninstall the fast track idempotently, using the existing managed-file marker, and the README, its guardrail table and CLAUDE.md MUST describe it.
- **FR-013**: The fast track MUST be usable without a triage step. A triage step, if provided, MUST only suggest a track with a reason, and MUST NOT run a track the developer did not confirm. The triage step is in scope as a P3 advisory step only (User Story 5): it suggests a track with a reason, the developer confirms, and it never runs a track itself.
- **FR-014**: Events or output produced by the fast track MUST carry no prompt text, file contents or command output beyond what existing tracks already show.

### Key Entities

- **Fast-track run**: one request, one branch, one commit, with a measured size, a test outcome and a result (done, stopped for budget, stopped for protected path, tests failed, FAILED because the installed team was changed).
- **Budget**: 30 changed lines and 2 files touched, production code only.
- **Protected path**: a path the fast track may not change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A one-line typo fix completes through the fast track with 0 files created under `specs/` and 1 agent stage instead of `/speckit-team`'s 6.
- **SC-002**: 100% of runs whose change exceeds the budget are stopped, and 0% of runs at or under it are stopped for budget.
- **SC-003**: 100% of attempted writes to protected paths in the test matrix are denied or caught, on Windows, macOS and Linux.
- **SC-004**: All existing test suites pass, with existing assertions changed only where a count grows with the new agent (T011, T012: 6 to 7 agents), and each new hook decision has a test that fails when the hook is replaced by one that always allows.
- **SC-005**: Input token use of a fast-track run is measured with the repo's usage tool and recorded in the README next to `/speckit-team`'s; no cost figure is promised in advance.

## Assumptions

- The fast track adds no new runtime dependency.
- Uncommitted changes present at start are left alone.
- The protected list in FR-007 is the minimum; the planner may add paths, and a developer cannot override it per run.
- A `.txt` file is documentation only under the top-level `docs/` folder or with a documentation name (owner decision 2026-10-10, plan.md decision 17 point 1): `src/docs/x.txt` counts as production.
- The installed team is hashed one folder level deep (research R16): files deeper below `agents/`, `hooks/` or `skills/<name>/` are protected against direct writes only.
- Merging stays with the developer; the fast track never merges.
- The issue's alternative of relaxing the audit gate for a lone implementer (issue point 4) is out of scope; `/speckit-team`'s gates stay as they are.

## Threat Model

- **Guarded against (MUST be caught, as the requirements say)**: an agent that overreaches by mistake or drifts out of scope. That means writing protected files (FR-007), growing past the budget (FR-005, FR-006), committing or opening a pull request before the checks passed (FR-002), and sweeping in the developer's uncommitted work.
- **Not guarded against**: an agent that deliberately evades the hooks through the shell. That means git aliases, scripts or package scripts that push or commit, writes outside the repository and the Claude config directory, and network access. These gaps are not defects of this feature. The README MUST list them as known limits.
- **Effect on requirements**: where FR-006 or FR-007 says "MUST" about catching a change made "by other means" (for example a shell command), it applies to the routes inside the guarded-against case, not to deliberate evasion.
- **Verification**: a reviewer can read the README's known-limits list and find each "not guarded against" item named in it.

## Out of Scope

- Changes to `/speckit-team`, its audit gate, lanes or retry limit.
- Automatic routing that starts a track without confirmation. Only the advisory triage of User Story 5 is in scope.
- Starting `/speckit-team` from the fast track, on budget overrun or otherwise.
- Model choice for any agent.
