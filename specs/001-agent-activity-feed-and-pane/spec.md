# Feature Specification: Agent Activity Feed and Live Pane

**Feature Branch**: `001-agent-activity-feed-and-pane`

**Created**: 2026-10-06

**Status**: Approved

**Input**: User description: "Implement a Claude mod that has a generic interface of what the agents are doing, so that we can hook it into anything. Then also make a visual agent representation within Claude to show what the agents are doing, who is doing what, etc."

## Clarifications

### Session 2026-10-06

- Q: What counts as "what the agent is doing"? -> A: Tool name, a coarse activity label (reading, writing, running a command, searching, delegating) and the repo-relative target path for file tools. No command text and no task description by default; anything richer is opt-in per field.
- Q: Which consumers must work out of the box? -> A: Only the in-Claude view and a documented local readable stream. Chat, dashboards and remote shipping are left to consumers of the interface, not bundled.
- Q: How much history is retained? -> A: The current session plus the previous 7 days, capped at 10 MB, oldest removed first; both limits configurable.
- Q: When does the view appear and what does it show? -> A: An always-on one-line summary (agent count, phase, last verdict) in repos with Spec Kit initialised, and a fuller panel the user opens on demand; nothing shown in other repos.
- Q: When is an agent shown as stale? -> A: After 120 seconds without a record.
- Audit 2 fix (C1): SC-009 no longer demands byte-identical restore, because other tools rewrite the settings file between sessions. It now requires the same parsed value, preserved indentation and line endings unless something else changed the file, zero files left behind, and an idempotent second install.
- Audit 2 fix (H3): the macOS and Linux "not run" follow-up in FR-020 and SC-005 is tracked as a GitHub issue in PIsberg/speckit-agents, linked from the feature PR.
- Amendment 2026-10-06 (owner): added User Story 6, FR-024 to FR-035 and SC-010 to SC-014 for a richer, switchable view; the plain board stays the default.
- Q (rich view scope, FR-026 to FR-028): which elements and numbers? -> A: All four elements; activity history in 15-second intervals over the last 5 minutes; 5-second highlight; at most 2 redraws per second.
- Q (switch, FR-032): how is it made? -> A: An argument on the panel command naming the view, plus a key that toggles while the panel is open; the panel states how to switch.
- Q (persistence, FR-034): what scope? -> A: Per user, for all repositories, stored locally; a missing or unreadable choice falls back to the plain board and records an observer fault.
- Q (screen, FR-031): how much? -> A: At most 20 terminal lines; below 80 columns fall back to the plain board with a stated notice.
- Q (summary): does the choice affect the one-line summary? -> A: No; the summary is identical in both views, only the open panel changes.
- Review fix: User Story 1 scenario 1 no longer allows hiding the view when idle; the summary shows an idle state (0 agents) and the last completed phase, consistent with FR-012.
- Audit fix (M5): FR-001 now includes "observer fault" as an activity kind, so faults are readable through the documented interface and the view (FR-016, FR-018) consistent.
- Audit fix (M6): FR-020 states the exception that macOS and Linux verification is "not run", tracked as a follow-up issue, not claimed as passed.
- Audit fix (L7): Status set to Approved (owner approval 2026-10-06).
- Audit fix (H1): malformed, empty or unknown input to a guardrail hook yields no decision, the action proceeds, and an observer fault is recorded.
- Review fix: SC-003 is now an automated criterion (a reference consumer built from the README alone parses 100% of FR-001 record kinds in a scripted run, in the test suite) instead of a human trial.
- Review fix: SC-005 overhead is measured on Windows only; macOS and Linux are reported as "not run" and tracked as a follow-up. FR-020 still requires all 3 platforms to work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See who is doing what while the pipeline runs (Priority: P1)

While a feature moves through the pipeline, the user glances at a live view inside the Claude session and sees every active agent, what it is doing right now, which feature and pipeline phase it serves, and the most recent guardrail decisions. Today these decisions are invisible unless the user reads transcripts.

**Why this priority**: This is the user-facing value. Without it the feed is plumbing nobody sees.

**Independent Test**: Run a pipeline in a repo with Spec Kit initialised and observe the view. It delivers value with no external consumer attached.

**Acceptance Scenarios**:

1. **Given** the view is enabled and no agent is running, **When** the user looks at it, **Then** the summary shows an idle state (0 agents) and the last completed phase.
2. **Given** an agent starts, **When** the start is recorded, **Then** within 1 second the view lists that agent by name with its phase and feature.
3. **Given** an agent attempts a write outside its lane and the guardrail denies it, **When** the denial is recorded, **Then** the view shows the denial (agent, decision, repo-relative path) within 1 second, and it stays visible among the recent decisions.
4. **Given** the auditor records a verdict, **When** the verdict is recorded, **Then** the view shows PASS or FAIL against the feature.
5. **Given** an agent stops, **When** the stop is recorded, **Then** the view marks it finished and its lane-check result is shown.

---

### User Story 2 - Any outside tool can consume agent activity (Priority: P1)

A developer wires agent activity into another tool (dashboard, chat notifier, log shipper, another editor) using only the published description of the activity stream, without reading this repo's code.

**Why this priority**: The owner's first stated goal is a generic interface "so that we can hook it into anything". The view in Story 1 is itself the first consumer of it.

**Independent Test**: Write a minimal consumer from the documentation alone, run a pipeline, and check that the consumer receives the documented events.

**Acceptance Scenarios**:

1. **Given** a consumer reads the stream from the documented location, **When** an agent starts, uses tools, and stops, **Then** the consumer receives a start event, one event per tool use, and a stop event, in order, each with a schema version.
2. **Given** a future minor version adds a field, **When** an existing consumer reads the new events, **Then** it keeps working because the docs state unknown fields are ignored.
3. **Given** a consumer attaches after a pipeline began, **When** it reads, **Then** it can obtain recent past events and then continue with live ones, without duplicates or gaps.
4. **Given** no destination beyond the local machine has been configured, **When** events are emitted, **Then** nothing leaves the machine.

---

### User Story 3 - Observe agents outside the Spec Kit team (Priority: P2)

The user sees activity of built-in subagents, third-party subagents and the main session, not only the six team agents, so the view and feed describe everything running in the session.

**Why this priority**: The owner asked for a generic interface. It extends P1 value to non-team work, but the team case works without it.

**Independent Test**: Start a subagent that is not in the team and confirm it appears in both the feed and the view, marked as not a team agent.

**Acceptance Scenarios**:

1. **Given** a non-team subagent runs, **When** it starts, uses tools and stops, **Then** equivalent events are emitted and it appears in the view with no pipeline phase.
2. **Given** the main session is orchestrating, **When** it moves the pipeline to a new phase, **Then** a phase-change event is emitted and the view updates its phase indicator.

---

### User Story 4 - Parallel agents stay distinguishable (Priority: P2)

When several agents run at once (for example parallel implementers in separate worktrees), the user and any consumer can tell them apart and see each one's own state.

**Why this priority**: Parallel runs are where transcripts are least readable and a view is most useful.

**Independent Test**: Run 3 implementers at once and confirm 3 distinct rows and 3 distinct event identities.

**Acceptance Scenarios**:

1. **Given** 3 agents of the same type run concurrently, **When** each uses tools, **Then** every event carries an identity that distinguishes the 3 instances, and the view shows 3 rows.
2. **Given** each runs in its own worktree, **When** events are emitted, **Then** each event states which worktree or checkout it came from.

---

### User Story 5 - Observation never harms the work (Priority: P1)

If the feed or the view breaks, the agents carry on exactly as before and the user is told something is wrong.

**Why this priority**: Constitution principle III. A watcher that can stall or block a guardrail is worse than none.

**Independent Test**: Make the destination unwritable, run a pipeline, and compare guardrail decisions and agent output with a run that has observation switched off.

**Acceptance Scenarios**:

1. **Given** the feed destination is unwritable, **When** an agent uses a tool, **Then** the tool call proceeds and every guardrail decision is identical to the unobserved run.
2. **Given** an emit failure, **When** it happens, **Then** the failure is visible in the view or in a place the user looks, and is reported at most once per distinct cause per session so it does not flood.
3. **Given** a repository without Spec Kit initialised, **When** agents run, **Then** the feature adds no output and no measurable delay.

---

### User Story 6 - Switch to a richer visual view and back (Priority: P2)

The plain text board stays the default. The user can switch to a richer view that places each active agent on a pipeline track, shows agents as cards with a short activity history, and briefly highlights important decisions, then switch back at any time, including mid-pipeline. The choice is remembered across sessions.

**Why this priority**: The owner wants a more engaging way to see who is doing what, without giving up the plain board. It builds on the P1 view and the same documented interface.

**Independent Test**: With a pipeline running, switch to the rich view and back, and confirm the content matches the documented records and the plain board is shown on a fresh install.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the user opens the panel, **Then** the plain board is shown.
2. **Given** the plain board is shown, **When** the user switches to the rich view, **Then** the rich view appears within 1 second without restarting the session or the pipeline, and agents already running remain shown.
3. **Given** the rich view is chosen and the session is ended and restarted, **When** the user opens the panel, **Then** the rich view is shown; **When** the user switches back, **Then** the plain board is shown on the next restart.
4. **Given** the rich view is shown and agents are in 3 different phases, **When** the user looks at the pipeline track, **Then** each agent appears on its own phase, and agents with no phase appear in a separate "no phase" area.
5. **Given** a guardrail denial, a blocked gate or a FAIL verdict is recorded, **When** it happens, **Then** it is highlighted for 5 seconds with a text marker, then settles into the decisions list without the marker.
6. **Given** the terminal is narrow or short, **When** the rich view cannot fit, **Then** it degrades to a reduced form or to the plain board, and states that it did, and never wraps into unreadability.
7. **Given** a repository without Spec Kit initialised, **When** the user tries to switch, **Then** nothing is shown.

---

### Edge Cases

- A malformed, empty or unknown hook input arrives: nothing is thrown, nothing is blocked, and either a minimal event or no event is produced. A guardrail hook given such input makes no decision (the action proceeds, as it does today when the hook crashes) and the failure is recorded as an observer fault so it is visible.
- An agent crashes and never reports a stop: the view and consumers must not show it as running forever (FR-013).
- Two sessions run in the same repo at once: events keep session identity and do not merge into one agent's row.
- The history store grows without bound: retention limits apply (FR-011).
- The terminal is too narrow or too short for all rows: the view degrades to a summary count plus the most recent items and never wraps into unreadability.
- Paths contain Windows separators or drive letters: emitted paths are repo-relative with forward slashes.
- A tool input contains a secret or prompt text: it never appears in the default events (FR-008).

## Requirements *(mandatory)*

### Functional Requirements

**Activity interface**

- **FR-001**: The system MUST emit a record for each of these activity kinds: agent start, agent stop, tool use by an agent, guardrail decision (allowed or denied, with the rule that decided), implementation gate outcome (blocked or allowed), audit verdict (PASS or FAIL), lane check at agent stop (clean or violations), pipeline phase change, and observer fault (a failure to emit, write, read or render, with a cause code and no payload beyond metadata). Faults are records like any other, so any consumer, including the view, reads them from the documented interface.
- **FR-002**: Every record MUST carry a schema version, a timestamp, a session identity, an agent identity that is unique per running instance, an agent name, and a flag saying whether the agent belongs to the Spec Kit team.
- **FR-003**: Every record about a team agent MUST carry the feature identifier and the pipeline phase when they can be determined, and MUST say so explicitly when they cannot.
- **FR-004**: The system MUST also emit records for agents outside the team and for the main session, with the same shape and no phase.
- **FR-005**: The record format and the location where records can be read MUST be documented in the README so that a consumer can be written without reading source, including every field, its type and its meaning.
- **FR-006**: Within a major schema version, changes MUST be additive only. The docs MUST tell consumers to ignore unknown fields and MUST list any removal, rename or retype as a major version change.
- **FR-007**: A consumer MUST be able to read recent history and then follow live records without gaps or duplicates, using nothing but the documented interface.

**Privacy and locality**

- **FR-008**: By default a record MUST contain metadata only: agent, tool name, phase, repo-relative path, decision, rule name, verdict, timestamps. It MUST NOT contain prompt text, model output, file contents, command output, environment variables or credentials.
- **FR-009**: Any field beyond metadata MUST be opt-in per field, documented, and off by default. The default description of "what the agent is doing" is the tool name, a coarse activity label (reading, writing, running a command, searching, delegating) and, for file tools, the repo-relative target path. Command text and task descriptions are excluded unless opted in per field.
- **FR-010**: Records MUST stay on the local machine unless the user explicitly configures another destination. Out of the box, only two consumers are provided: the in-Claude view and a documented local readable stream. Chat, dashboards and remote shipping are NOT bundled; they are built by others on the documented interface.

**Retention**

- **FR-011**: The system MUST bound stored history by size or age and MUST remove the oldest records first. Defaults: the current session plus the previous 7 days, capped at 10 MB; both limits MUST be configurable.

**Live view**

- **FR-012**: Inside the Claude session, a live view MUST show, for each active agent: name, team or non-team, current activity label, feature, phase, and time since its last activity. It MUST also show the most recent guardrail decisions and the latest audit verdict. In repositories with Spec Kit initialised, the view MUST always show a one-line summary (agent count, phase, last verdict) and MUST offer a fuller panel, containing the items above, that the user opens on demand. In other repositories it MUST show nothing.
- **FR-013**: The view and the interface MUST NOT report an agent as running indefinitely after it has stopped reporting: an agent with no record for 120 seconds MUST be shown as stale.
- **FR-014**: The view MUST update within 1 second of a record being emitted and MUST distinguish concurrent agents of the same type.
- **FR-015**: A denied action MUST be distinguishable from an allowed one without relying on colour alone.
- **FR-016**: The view MUST be a consumer of the same documented interface as outside tools and MUST NOT read information unavailable to them.

**Safety and platform**

- **FR-017**: Observation MUST NOT deny, delay or alter any agent action or guardrail decision. Added time per tool call MUST stay within a budget the plan states and measures.
- **FR-018**: If emitting or rendering fails, agent work MUST continue unchanged and the failure MUST be visible to the user at most once per distinct cause per session.
- **FR-019**: Every hook entry point added or changed MUST handle empty, malformed and unknown input without throwing.
- **FR-020**: The feature MUST work on Windows (Git Bash and PowerShell hook shells), macOS and Linux, with forward-slash repo-relative paths in all records. Exception: only Windows is available for verification, so verification on macOS and Linux is reported as "not run" in the docs and tracked as a follow-up GitHub issue in PIsberg/speckit-agents, linked from the feature PR, not claimed as passed.
- **FR-021**: The feature MUST install and uninstall through the existing installer idempotently, and uninstall MUST remove everything it added and nothing else.
- **FR-022**: The feature MUST cost nothing in repositories without Spec Kit initialised: no output, no blocking, no measurable delay.
- **FR-023**: Docs MUST state what was verified in a live session, what only by unit test, and what not at all.

**Rich view and switching**

- **FR-024**: The plain board (FR-012) MUST remain the default on a fresh install. A second, richer view MUST be available alongside it.
- **FR-025**: The rich view MUST show a pipeline track of the six phases (spec, plan, audit, red, green, gate) with each active team agent placed on its current phase, and agents without a phase in a separate area.
- **FR-026**: The rich view MUST show each agent as a card with name, state (active, finished, stale), current activity and target, time since last activity, and a small activity history of tool calls per interval over the last few minutes. The history uses 15-second intervals over the last 5 minutes.
- **FR-027**: In the rich view, a guardrail denial, gate block or FAIL verdict MUST be highlighted when it happens for 5 seconds, then settle into the decisions list.
- **FR-028**: The rich view MUST show that it is live (a running indicator) and MUST NOT redraw more than 2 times per second, so that it neither floods the screen nor flickers.
- **FR-029**: The rich view MUST read only the documented interface (FR-016) and MUST carry every item of the plain board (agents, decisions, latest verdict, phase, observer faults), so switching loses no information.
- **FR-030**: Every state in the rich view MUST be readable without colour; colour may add to words and symbols, never replace them (FR-015).
- **FR-031**: The rich view MUST degrade on narrow or short terminals to a reduced form or to the plain board, and MUST say that it did. The rich view MUST take at most 20 terminal lines and MUST fall back to the plain board, with a stated notice, below 80 columns.
- **FR-032**: The user MUST be able to switch between the two views, and back, at any time including while a pipeline runs, without ending the session, interrupting an agent or losing history. The switch is made by an argument on the panel command naming the view, plus a key that toggles while the panel is open. The one-line summary (FR-012) is identical in both views; only the open panel changes.
- **FR-033**: The switch MUST be discoverable: the open panel MUST state the current view and how to switch.
- **FR-034**: The chosen view MUST persist across sessions. The choice is stored per user, for all repositories, locally; a missing or unreadable choice falls back to the plain board and records an observer fault.
- **FR-035**: Rich view and switching MUST obey FR-017 to FR-019 and FR-022: they never block or delay an agent, failures are recorded as observer faults, and nothing is shown or stored in repositories without Spec Kit initialised.

### Key Entities

- **Activity record**: one immutable fact about an agent at a point in time. Attributes: schema version, timestamp, kind, session, agent instance, agent name, team flag, feature, phase, worktree, and kind-specific details (tool, activity label, path, decision, rule, verdict, lane result).
- **Agent instance**: one running agent, identified uniquely across concurrent runs. Has a state (active, finished, stale) derived from records.
- **Feature run**: the feature identifier and the current pipeline phase it is in, shared by the agents serving it.
- **Guardrail decision**: allow or deny with the rule that decided, the agent, and the repo-relative path concerned.
- **Consumer**: any tool reading records, including the live view.
- **Destination**: where records are written. Local by default; anything else is user-configured.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a full pipeline run, 100% of guardrail denials, gate outcomes, verdicts and lane checks appear in both the stream and the view.
- **SC-002**: A record appears in the view within 1 second of the event, measured over 100 consecutive events.
- **SC-003**: A reference consumer written using only the fields, types and location documented in the README receives and correctly parses 100% of the record kinds listed in FR-001 during a scripted run, and runs in the test suite.
- **SC-004**: With the destination unwritable, all guardrail decisions across a recorded run match the unobserved run in 100% of cases, and agent output is unchanged.
- **SC-005**: Observer overhead per tool call stays under the budget stated in the plan, measured as the median over 100 calls on Windows. macOS and Linux measurements are reported as "not run" in the docs and tracked as a follow-up GitHub issue in PIsberg/speckit-agents, linked from the feature PR, not claimed as passed; FR-020 still requires the feature to work on all 3.
- **SC-006**: A default-config scan of a full pipeline's records finds 0 occurrences of prompt text, model output, file contents, command output or environment values.
- **SC-007**: With 3 concurrent same-type agents, 100% of records are attributable to the correct instance.
- **SC-008**: In a repository without Spec Kit initialised, 0 bytes of output and 0 records are produced.
- **SC-009**: After install then uninstall, the user's settings parse to the same value as before; the original indentation and line endings are kept unless the file's content was changed by something else in the meantime; zero files are left behind by the installer (no uninstall-time backup, and any install-time backup is removed); a second install changes nothing.

- **SC-010**: The default view on a fresh install is the plain board in 100% of installs, and a stored choice of the rich view is shown after restart in 100% of tested restarts.
- **SC-011**: Switching in either direction completes within 1 second, measured over 20 switches during a scripted run, with 0 agent actions altered or delayed.
- **SC-012**: Over a scripted run, the rich view contains 100% of the items the plain board contains (agents, decisions, latest verdict, phase, observer faults), and every state in it is identified by text, verified by rendering with colour removed.
- **SC-013**: At 3 tested terminal sizes (including one below the narrow limit) the rich view never exceeds its screen allowance and never wraps lines; below the limit it says it degraded.
- **SC-014**: The rich view redraws no more often than its stated rate over a 60-second scripted run.

## Assumptions

- The user runs a Claude Code version that supports the extension points the view needs. The plan must verify this live and name the minimum version.
- The existing guardrail hooks are the source of decision facts; they are extended to report, never to change, their decisions.
- The six team agents are identified by name; any other agent name counts as non-team.
- History and stream stay on the local disk of the machine running Claude.
- Out of scope: shipping records to remote services, built-in chat or dashboard integrations, controlling or interrupting agents from the view, and showing prompt or output text by default.
- The rich view is additive: it changes no record and no part of the documented interface.
- Out of scope for the rich view: animation beyond a running indicator and the decision highlight, sound, and any control of agents.
- Out of scope: persisting records across machines or aggregating several users.
