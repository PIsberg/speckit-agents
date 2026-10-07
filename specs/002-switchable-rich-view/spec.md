# Feature Specification: Switchable Rich Agent View

**Feature Branch**: `002-switchable-rich-view` (not created yet; this spec was written ahead of it)

**Created**: 2026-10-07

**Status**: Draft

**Input**: GitHub issue #3 in PIsberg/speckit-agents: "Feature 002: switchable rich agent view (deferred from 001)". The requirements were approved by the owner as User Story 6 of feature 001 (spec.md at commit 21d8502) and split out on 2026-10-07.

**Depends on**: feature 001 (agent activity feed and live pane). This feature adds a second view on top of 001's plain board and documented activity interface, and cannot be built before them. References of the form "001 FR-012" point to `specs/001-agent-activity-feed-and-pane/spec.md`.

## Clarifications

### Carried over from feature 001 (owner decisions, 2026-10-06)

- Q: Which elements and numbers does the rich view have? -> A: All four elements: pipeline track, agent cards with a 15-second by 5-minute activity history, a 5-second decision highlight, and a live indicator; at most 2 redraws per second.
- Q: How is the switch made? -> A: An argument on the panel command naming the view (`/speckit-activity rich|plain`, with `cool` as an alias for `rich`), plus a key that toggles once the panel has keyboard focus; the panel states how to switch.
- Q: What is the scope of the stored choice? -> A: Per user, for all repositories, stored locally. A choice never stored shows the plain board with no fault; an unreadable or invalid stored choice shows the plain board and records an observer fault.
- Q: How much screen may it take? -> A: At most 20 terminal lines; below 80 columns it falls back to the plain board with a stated notice.
- Q: Does the choice affect the one-line summary? -> A: No. The summary is identical in both views; only the open panel changes.
- Audit 3 fix (H2), kept: every plain-board item is reachable, and each capped section shows a counted "+n more", because a 20-line cap cannot show everything. The reduced form follows the same rule, and parity is checked with colour removed.
- Audit 3 fix (M4), kept: the toggle key works once the panel has keyboard focus (one platform keystroke or a click), the panel never takes focus by itself, and the command argument needs no focus step.

### Open, from the fourth audit of 001

- M2: [NEEDS CLARIFICATION: does uninstall remove the stored view choice? Recommended: yes. 001 FR-021 and SC-009 require uninstall to leave nothing behind, and a lost preference costs one command after a reinstall.]
- M7: [NEEDS CLARIFICATION: what happens on a platform where no toggle key reaches the panel? Recommended: the command argument stays the way to switch, and the panel's switch hint names only the command there instead of a key that does nothing.]

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch to a richer visual view and back (Priority: P2)

The plain text board stays the default. The user can switch to a richer view that places each active agent on a pipeline track, shows agents as cards with a short activity history, and briefly highlights important decisions, then switch back at any time, including mid-pipeline. The choice is remembered across sessions.

**Why this priority**: The owner wants a more engaging way to see who is doing what, without giving up the plain board. It builds on 001's view and the same documented interface.

**Independent Test**: With a pipeline running, switch to the rich view and back, and confirm the content matches the documented records and the plain board is shown on a fresh install.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the user opens the panel, **Then** the plain board is shown.
2. **Given** the plain board is shown, **When** the user switches to the rich view, **Then** the rich view appears within 1 second without restarting the session or the pipeline, and agents already running remain shown.
3. **Given** the rich view is chosen and the session is ended and restarted, **When** the user opens the panel, **Then** the rich view is shown; **When** the user switches back, **Then** the plain board is shown on the next restart.
4. **Given** the rich view is shown and agents are in 3 different phases, **When** the user looks at the pipeline track, **Then** each agent appears on its own phase, and agents with no phase appear in a separate "no phase" area.
5. **Given** a guardrail denial, a blocked gate or a FAIL verdict is recorded, **When** it happens, **Then** it is highlighted for 5 seconds with a text marker, then settles into the decisions list without the marker.
6. **Given** the terminal is narrow or short, **When** the rich view cannot fit, **Then** it degrades to a reduced form or to the plain board, states that it did, and never wraps into unreadability.
7. **Given** a repository without Spec Kit initialised, **When** the user tries to switch, **Then** nothing is shown.

### Edge Cases

- More agents, decisions, verdicts or observer causes than a section can show: the section shows a counted "+n more" whose count equals the items not shown (FR-006).
- The stored choice is missing, unreadable or names an unknown view: the plain board is shown; only the unreadable and invalid cases record an observer fault (FR-011).
- The terminal is resized while the rich view is open: the next redraw applies the size rules (FR-008), within the redraw limit (FR-005).
- A burst of records arrives: redraws stay at or below 2 per second whatever triggers them (FR-005).

## Requirements *(mandatory)*

### Functional Requirements

Each requirement keeps its 001 number in brackets for traceability.

- **FR-001** [001 FR-024]: The plain board (001 FR-012) MUST remain the default on a fresh install. A second, richer view MUST be available alongside it.
- **FR-002** [001 FR-025]: The rich view MUST show a pipeline track of the six phases (spec, plan, audit, red, green, gate) with each active team agent placed on its current phase, and agents without a phase in a separate area.
- **FR-003** [001 FR-026]: The rich view MUST show each agent as a card with name, state (active, finished, stale), current activity and target, time since last activity, and an activity history of tool calls per interval, in 15-second intervals over the last 5 minutes.
- **FR-004** [001 FR-027]: In the rich view, a guardrail denial, gate block or FAIL verdict MUST be highlighted for 5 seconds when it happens, then settle into the decisions list.
- **FR-005** [001 FR-028]: The rich view MUST show that it is live (a running indicator) and MUST NOT redraw more than 2 times per second, whatever triggers the redraw.
- **FR-006** [001 FR-029]: The rich view MUST read only the documented interface (001 FR-016) and MUST make every item of the plain board (agents, decisions, verdicts, phase, observer faults) reachable. Wherever a section is capped by the screen allowance (FR-008), it MUST show a counted "+n more" for that section (agents, decisions, verdicts, observer causes), so nothing disappears silently. The reduced form (10 to 19 rows) follows the same rule. Parity is checked with colour removed.
- **FR-007** [001 FR-030]: Every state in the rich view MUST be readable without colour; colour may add to words and symbols, never replace them (001 FR-015).
- **FR-008** [001 FR-031]: The rich view MUST degrade on narrow or short terminals to a reduced form or to the plain board, and MUST say that it did. It MUST take at most 20 terminal lines and MUST fall back to the plain board, with a stated notice, below 80 columns.
- **FR-009** [001 FR-032]: The user MUST be able to switch between the two views, and back, at any time including while a pipeline runs, without ending the session, interrupting an agent or losing history. The switch is made by an argument on the panel command naming the view, plus a key that toggles once the panel has keyboard focus. The user gives focus with one platform keystroke (in the terminal, ctrl+x tab) or a click; the panel MUST NOT take focus by itself, so it never steals the prompt. The command argument works without any focus step. The one-line summary (001 FR-012) is identical in both views; only the open panel changes.
- **FR-010** [001 FR-033]: The switch MUST be discoverable: the open panel MUST state the current view and how to switch.
- **FR-011** [001 FR-034]: The chosen view MUST persist across sessions. The choice is stored per user, for all repositories, locally. A choice never stored shows the plain board with no fault; an unreadable or invalid stored choice shows the plain board and records an observer fault.
- **FR-012** [001 FR-035]: Rich view and switching MUST obey 001 FR-017 to FR-019 and FR-022: they never block or delay an agent, failures are recorded as observer faults, and nothing is shown or stored in repositories without Spec Kit initialised.

### Key Entities

- **View choice**: which of the two views the panel shows (plain or rich). One per user, shared by all repositories, stored on the local machine.
- **Pipeline track**: the six phases in order, each holding the active team agents currently in it, plus a "no phase" area.
- **Agent card**: one agent's name, state, current activity and target, time since last activity, and its activity history.
- **Highlight**: a decision shown with a text marker for 5 seconds after it is recorded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** [001 SC-010]: The default view on a fresh install is the plain board in 100% of installs, and a stored choice of the rich view is shown after restart in 100% of tested restarts.
- **SC-002** [001 SC-011]: Switching in either direction completes within 1 second, measured over 20 switches during a scripted run, with 0 agent actions altered or delayed.
- **SC-003** [001 SC-012]: With colour removed, 100% of the plain board's items (agents, decisions, verdicts, phase, observer faults) are reachable in the rich view, every state in it is identified by text, and every capped section shows a counted "+n more" whose count equals the number of items not shown; measured on a fixture that exceeds every section's capacity.
- **SC-004** [001 SC-013]: At 3 tested terminal sizes, including one below the narrow limit, the rich view never exceeds its screen allowance and never wraps lines; below the limit it says it degraded.
- **SC-005** [001 SC-014]: The rich view redraws no more often than 2 times per second over a 60-second scripted run.

## Assumptions

- Feature 001 is built first and its documented activity interface, plain board, summary line and panel command exist. Nothing here changes them except to add the second view.
- The design work for this view on branch `001-agent-activity-feed-and-pane` at commit 21d8502 (contracts/view.md "Rich view and switching", research.md R18 and V12 to V16) is input for the plan, not a decision. It must be re-checked against the minimal-design rule: no recovery machinery unless a requirement above demands it.
- Open findings from the fourth audit of 001 that are design-level, for the architect to resolve in the plan:
  - H1: redraws triggered by page or view changes bypass the 2-per-second limit (FR-005 now says "whatever triggers the redraw").
  - H4: the V13 fallback file blocks a clean uninstall (see M2 above).
  - H5: task T053 expects "+5 more decisions" where the design gives "+4".
  - M1: the reduced form at 10 rows cannot show an agent.
  - M6: V16 without a viewport shows the rich view at 76 to 79 columns, below the 80-column limit of FR-008.
- Out of scope: any view beyond these two, per-repository view choices, and changing the one-line summary.
