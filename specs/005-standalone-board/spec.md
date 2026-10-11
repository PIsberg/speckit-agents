# Feature Specification: Standalone Board

**Feature Branch**: `005-standalone-board`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "make it possible to run the speckit-board without the speckit-agents team. A user who has only Spec Kit and speckit-board installed, and runs Spec Kit's own commands (/speckit-specify, /speckit-plan, /speckit-tasks, /speckit-implement and so on) without any of the team's agents or hooks, should still get a useful board of the pipeline's state."

## Clarifications

### Session 2026-10-11

- Q: How does the board show the audit and verify phases when the feature has no team record? → A: Hidden (FR-004).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the pipeline's state with Spec Kit alone (Priority: P1)

A user has Spec Kit and the board, and no team agents, hooks or `/speckit-team` skill. They run `/speckit-specify`, `/speckit-plan` and `/speckit-tasks` themselves. The board's band, pane and status line show the active feature, which phases are done, the task progress and what to do next, all taken from the feature's own files.

**Why this priority**: It is the whole feature. Today the board is useful only after the team has run: with no team it shows the audit and verify phases as waiting for agents that never come, and tells the user to start `/speckit-team`.

**Independent Test**: In a repo with Spec Kit and the board and nothing else, run `/speckit-specify`, then `/speckit-plan`, then `/speckit-tasks`, and after each command read `/speckit-board status`. The spec, plan and tasks phases turn done in that order, and no line names a team agent or `/speckit-team`.

**Acceptance Scenarios**:

1. **Given** a feature with a spec and no plan, **When** the user opens the board, **Then** it shows the spec phase as the current one and the next step names Spec Kit's plan command.
2. **Given** a feature with a spec, a plan and a task list of 10 tasks, 4 ticked, **When** the user opens the board, **Then** the spec, plan and tasks phases show done, build shows `4/10`, and the next step is the first unticked task.
3. **Given** all tasks are ticked, **When** the user opens the board, **Then** it reports the feature as ready for the PR.
4. **Given** the user ticks a task by hand or `/speckit-implement` ticks it, **When** the board next refreshes, **Then** the count and the next step reflect it without the user running any board command.
5. **Given** no team record exists for the feature, **When** the band, pane and status line are drawn, **Then** none shows a retry meter, a gate-closed note, a "stale" mark or a team agent's name.

---

### User Story 2 - Install the board without the team (Priority: P1)

A user who does not want the team's agents, hooks or skills installs only the board, and nothing else changes in their Claude Code setup.

**Why this priority**: Without it the board cannot be run standalone at all, whatever it draws.

**Independent Test**: On a machine with none of the team installed, install the board by the documented route, list the agents, skills and hooks the team would have added, and confirm none exists; then start a session and confirm `/speckit-board` works.

**Acceptance Scenarios**:

1. **Given** a machine without the team installed, **When** the user follows the README's board-only instructions, **Then** the board is available and no team agent, team skill or team hook has been added.
2. **Given** the board was installed alone, **When** the user later installs the team, **Then** the board keeps working and now also shows the team's audit, build gate and agents.
3. **Given** the board and the team are both installed, **When** the user removes the team and keeps the board, **Then** the board keeps working in standalone mode.

---

### User Story 3 - Mixed use on one feature (Priority: P2)

A user ran the team on a feature, then carries on with plain Spec Kit commands, or the reverse. The board must not lie about either.

**Why this priority**: Real repos mix the two. Showing team state where the team never ran, or hiding it where it did, would mislead.

**Independent Test**: In a repo with one feature the team audited and one it never touched, switch the active feature between them and compare the two boards.

**Acceptance Scenarios**:

1. **Given** the team has recorded an audit for the active feature, **When** the board is drawn, **Then** it shows the audit and verify phases exactly as it did before this feature.
2. **Given** the active feature has no team record, **When** the board is drawn, **Then** it shows the standalone view for that feature even if another feature in the repo has team records.
3. **Given** a feature with a team record whose files the user then edited by hand, **When** the board is drawn, **Then** it still marks the audit as out of date, as before.

---

### User Story 4 - Standalone board needs no setup beyond Spec Kit (Priority: P3)

The board works in a repo that Spec Kit initialised, with or without a git repository, and degrades to a clear message when there is no active feature.

**Why this priority**: The first minute decides whether a user keeps a tool.

**Independent Test**: Open the board in (a) a Spec Kit repo with no feature yet, (b) a Spec Kit repo that is not a git repository, (c) a repo with no Spec Kit.

**Acceptance Scenarios**:

1. **Given** a Spec Kit repo with no active feature, **When** the user opens the board, **Then** it says there is no active feature and names Spec Kit's specify command as the way to start one.
2. **Given** a Spec Kit repo that is not a git repository, **When** the user opens the board, **Then** it shows the spec, plan, tasks and build phases from the files, with no error.
3. **Given** a repo without Spec Kit, **When** the user opens the board, **Then** it says Spec Kit is not set up there, changes nothing, and does not fail the session.

---

### Edge Cases

- A feature has a task list with no tasks in the expected format: build shows no count and the next step says the list has no tasks; no error.
- The feature file points at a feature folder that does not exist: the board says so by name and draws no phases.
- The spec's status line says Approved but no plan exists yet: the spec phase is done, as today.
- The user runs a Spec Kit command that rewrites the plan or tasks while the pane is open: the pane updates within the board's existing refresh interval.
- The user clears the board with the clear button in standalone mode: it works as before and has no agent rows to remove.
- An optional team record is unreadable: the board behaves as it does today for that record, and never treats unreadable as absent.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The board MUST draw its band, pane, status line and `/speckit-board status` answer for a feature that has no team record, using only the feature's spec, plan and task files and the active-feature setting.
- **FR-002**: For such a feature the board MUST show the spec, plan and tasks phases and the build phase with its task count, derived exactly as it derives them today.
- **FR-003**: For such a feature the board MUST NOT show a retry meter, a gate-closed note, a stale or failed mark that comes from a team record, a verdict, or a running or finished team agent.
- **FR-004**: In standalone mode the audit and verify phases MUST be hidden: the band, pane and status line list only the spec, plan, tasks and build phases, and no line, mark or placeholder stands in for the two hidden ones. In team mode they are shown as before.
- **FR-005**: In standalone mode the next step MUST name only Spec Kit's own commands and the open task, never `/speckit-team` or a team agent. Examples: no spec yet leads to the specify command; spec without plan leads to the plan command; plan without tasks leads to the tasks command; open tasks lead to the first open task (and the implement command when none is ticked); all ticked leads to "ready for the PR".
- **FR-006**: In standalone mode build MUST NOT be shown as blocked by a closed gate: with a task list present, build is current as soon as the tasks phase is done.
- **FR-007**: The board MUST pick the standalone view per feature, by whether the team has recorded anything for that feature, not by whether the team is installed.
- **FR-008**: When the active feature has any team record, the board's output MUST be identical to what it was before this feature (no regression for team users).
- **FR-009**: The board MUST be installable without installing any of the team's agents, skills or hooks, by a route the README documents, and MUST NOT add any of them on its own.
- **FR-010**: The board MUST update after a Spec Kit command or a hand edit changes a feature file, within the interval it already uses, without a board command.
- **FR-011**: The board MUST NOT deny, delay or alter any Spec Kit command or any tool call, and a failure to read a file MUST be shown to the user, not swallowed (constitution III).
- **FR-012**: The board MUST read and write nothing outside the machine, and its output MUST contain only repo-relative paths, phase names, counts and task titles taken from the feature's own task list (constitution VI).
- **FR-013**: With no active feature, with a missing feature folder, outside a git repository, and outside a Spec Kit repository, the board MUST answer with a one-line message that says what is missing and what starts it, and MUST NOT throw.
- **FR-014**: The standalone view MUST work on Windows, macOS and Linux, with the same output for the same files (constitution VII).
- **FR-015**: Removing or never installing the team MUST NOT change the board's clear, hide and refresh behaviour.
- **FR-016**: The README MUST describe the standalone use, what the board shows with and without the team, and the board-only install, in the same change (constitution VIII).

### Key Entities

- **Feature**: the active Spec Kit feature, with a spec, an optional plan and an optional task list.
- **Team record**: anything the team's hooks keep about a feature (an audit verdict, a retry count, a gatekeeper word). Its presence for a feature selects the team view for that feature.
- **View**: standalone (no team record for the feature) or team (at least one).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a repo with Spec Kit and the board only, 100% of the lines the board prints (band, pane, status line and status answer) for a feature at each of the 5 stages (no spec, spec, plan, tasks, all ticked) contain no team agent name and no `/speckit-team`.
- **SC-002**: At each of those 5 stages the current phase and next step are correct on the first refresh after the file changes, within the board's existing refresh interval (4 seconds today).
- **SC-003**: For a team-recorded feature the board's output is byte-identical before and after this feature across the existing board test cases (0 differences).
- **SC-004**: A user with Spec Kit installed reaches a working standalone board in at most 2 commands and with 0 team files added.
- **SC-005**: The 4 degraded cases in User Story 4 and the edge cases each produce a message and no thrown error in 100% of test runs on all three platforms.

## Assumptions

- The user's Spec Kit commands write the spec, plan and task files where the board already looks, and set the active feature as they do today.
- Audit and verify belong to the team's workflow, not to Spec Kit, so a standalone user has no audit or gate to display.
- Showing that a Spec Kit command is running (as the board shows a team agent running) is out of scope: Spec Kit commands are not agents, and the state comes from files only.
- Spec Kit's analyze and checklist commands leave no state the board reads; surfacing them is out of scope.
- The board stays experimental and keeps its retirement plan; this feature does not extend it beyond standalone use of what exists.
- The specific install route (extra installer flag, direct plugin commands, or both) is the architect's choice, provided FR-009 holds.
