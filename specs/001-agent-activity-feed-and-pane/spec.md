# Feature Specification: Agent Activity Feed and Live Pane

**Feature Branch**: `001-agent-activity-feed-and-pane`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Implement a Claude mod that has a generic interface of what the agents are doing, so that we can hook it into anything. Then also make a visual agent representation within Claude to show what the agents are doing, who is doing what, etc."

## Clarifications

### Session 2026-10-06

- Q: What counts as "what the agent is doing"? -> A: Tool name, a coarse activity label (reading, writing, running a command, searching, delegating) and the repo-relative target path for file tools. No command text and no task description by default; anything richer is opt-in per field.
- Q: Which consumers must work out of the box? -> A: Only the in-Claude view and a documented local readable stream. Chat, dashboards and remote shipping are left to consumers of the interface, not bundled.
- Q: How much history is retained? -> A: The current session plus the previous 7 days, capped at 10 MB, oldest removed first; both limits configurable.
- Q: When does the view appear and what does it show? -> A: An always-on one-line summary (agent count, phase, last verdict) in repos with Spec Kit initialised, and a fuller panel the user opens on demand; nothing shown in other repos.
- Q: When is an agent shown as stale? -> A: After 120 seconds without a record.
- Review fix: User Story 1 scenario 1 no longer allows hiding the view when idle; the summary shows an idle state (0 agents) and the last completed phase, consistent with FR-012.
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

### Edge Cases

- A malformed, empty or unknown hook input arrives: nothing is thrown, nothing is blocked, and either a minimal event or no event is produced.
- An agent crashes and never reports a stop: the view and consumers must not show it as running forever (FR-013).
- Two sessions run in the same repo at once: events keep session identity and do not merge into one agent's row.
- The history store grows without bound: retention limits apply (FR-011).
- The terminal is too narrow or too short for all rows: the view degrades to a summary count plus the most recent items and never wraps into unreadability.
- Paths contain Windows separators or drive letters: emitted paths are repo-relative with forward slashes.
- A tool input contains a secret or prompt text: it never appears in the default events (FR-008).

## Requirements *(mandatory)*

### Functional Requirements

**Activity interface**

- **FR-001**: The system MUST emit a record for each of these activity kinds: agent start, agent stop, tool use by an agent, guardrail decision (allowed or denied, with the rule that decided), implementation gate outcome (blocked or allowed), audit verdict (PASS or FAIL), lane check at agent stop (clean or violations), and pipeline phase change.
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
- **FR-020**: The feature MUST work on Windows (Git Bash and PowerShell hook shells), macOS and Linux, with forward-slash repo-relative paths in all records.
- **FR-021**: The feature MUST install and uninstall through the existing installer idempotently, and uninstall MUST remove everything it added and nothing else.
- **FR-022**: The feature MUST cost nothing in repositories without Spec Kit initialised: no output, no blocking, no measurable delay.
- **FR-023**: Docs MUST state what was verified in a live session, what only by unit test, and what not at all.

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
- **SC-005**: Observer overhead per tool call stays under the budget stated in the plan, measured as the median over 100 calls on Windows. macOS and Linux measurements are reported as "not run" in the docs and tracked as a follow-up, not claimed as passed; FR-020 still requires the feature to work on all 3.
- **SC-006**: A default-config scan of a full pipeline's records finds 0 occurrences of prompt text, model output, file contents, command output or environment values.
- **SC-007**: With 3 concurrent same-type agents, 100% of records are attributable to the correct instance.
- **SC-008**: In a repository without Spec Kit initialised, 0 bytes of output and 0 records are produced.
- **SC-009**: Install then uninstall leaves the user's configuration byte-identical to before; a second install changes nothing.

## Assumptions

- The user runs a Claude Code version that supports the extension points the view needs. The plan must verify this live and name the minimum version.
- The existing guardrail hooks are the source of decision facts; they are extended to report, never to change, their decisions.
- The six team agents are identified by name; any other agent name counts as non-team.
- History and stream stay on the local disk of the machine running Claude.
- Out of scope: shipping records to remote services, built-in chat or dashboard integrations, controlling or interrupting agents from the view, and showing prompt or output text by default.
- Out of scope: persisting records across machines or aggregating several users.
