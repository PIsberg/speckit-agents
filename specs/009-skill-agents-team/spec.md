# Feature Specification: Skill-Agents Team Mode

**Feature Branch**: `009-skill-agents-team`

**Created**: 2026-10-25

**Status**: Implemented (merged in PR #183, 2026-10-25); the audit findings accepted at hand-over are issues #176 to #181, #184 and #185.

**Input**: User description: "According to Anthropic it is smarter to use role-based skills rather than role-based agents. Add a mode so that `/speckit-team --team skill-agents <request>` runs the team's roles as skills rather than as subagents. The existing agent-based team (the default, and every current `--team` option) stays exactly as it is."

## Clarifications

### Session 2026-10-25

- Q: Is skill-agents offered as an option in the team-size question, or typed only? → A: Typed only. The team-size question and its options stay unchanged; a free-text answer of `skill-agents` to that question is not the mode (as with `noagents`).
- Q: Which of the default team's guardrail checks must be enforced in skill mode? → A: The audit gate before build and the verification outcome are enforced. (The part of this answer that let lane limits be named as not enforced is replaced by the lane decision below.)
- Q: Do the role skills run in the main session or each in a separate context? → A: Inline, in the main session's own context. A role skill MUST NOT run in a separate subagent-like context, since that would bring back the per-agent cost this mode avoids. Basis: the product's guidance keeps phases that share context (planning, implementation, testing) in the main conversation, and Anthropic reports about 15x the tokens of chat for multi-agent systems. (2026-10-25)
- Q: Where do a role's instructions come from? → A: One source. A role skill's instructions MUST come from the same source as the matching agent's, so the two cannot drift. A hand-kept second copy is not acceptable. (2026-10-25)
- Q: Are lane limits only reported in this mode? → A: No, they are enforced. Each role MUST be held to the same lane as its agent in a default run (which files it may write; read-only roles write nothing). Any guardrail that still cannot be enforced inside one session is named at run start (Constitution II). Basis: a rule declared by a skill stays active for the rest of the session, so it cannot scope a lane to one role; the repository's existing guardrail script already sees when a role skill is invoked and by name. (2026-10-25)
- Q: Is the cost claim measured? → A: Yes. The feature MUST measure the input tokens of a skill-agents run against a default run of the same request, and the docs MUST report the numbers with which run and which date they come from. (2026-10-25)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run the team's roles as skills (Priority: P1)

A user types `/speckit-team --team skill-agents <request>`. The same roles that the default team runs as separate subagents (product-owner, architect, spec-auditor, test-writer, implementer, spec-gatekeeper) each do their work as a role-based skill, in the user's own session, in the same pipeline order, and the run ends at the same handover.

**Why this priority**: This is the whole feature. Without it the flag does nothing.

**Independent Test**: Run the command on a small request in a clean repository. No subagent is launched, every role's step is performed and reported by name, and the feature directory holds a spec, plan, tasks and the built result as a default run would.

**Acceptance Scenarios**:

1. **Given** a clean repository with Spec Kit set up, **When** the user types `/speckit-team --team skill-agents <request>`, **Then** the run goes through the six roles in pipeline order, and no subagent is launched at any point.
2. **Given** such a run, **When** a role finishes, **Then** the user sees which role did the work and what it produced, as a default run reports it.
3. **Given** such a run, **When** it reaches a point where the default team stops for the user (spec review, plan review, open decisions, retry limit), **Then** it stops at the same point and waits for the user.

---

### User Story 2 - Default and existing options are untouched (Priority: P1)

A user who never types `skill-agents` sees no change: a request with no `--team` still asks the team-size question and runs agents, and every existing `--team` form (a role list, `noagents`) and `--security` and `--project` behave as before.

**Why this priority**: The owner requires the existing team to stay exactly as it is.

**Independent Test**: Run the existing test suite and the existing live checks unchanged, and compare the question shown for a request without `--team` before and after.

**Acceptance Scenarios**:

1. **Given** a request without `--team`, **When** the user runs `/speckit-team`, **Then** the same team-size question with the same four options is asked, and the chosen team runs as subagents.
2. **Given** `--team test-writer,implementer` or `--team noagents`, **When** the command runs, **Then** it behaves as it did before this feature.
3. **Given** the files of the agent-based team (agents and their prompts), **When** this feature is complete, **Then** none of them has changed in behaviour.

---

### User Story 3 - Clear refusal of mixed or unclear use (Priority: P2)

A user who mixes `skill-agents` with role names, or who misspells it, is told why the request was refused and what the valid forms are, before any work starts.

**Why this priority**: Prevents a half-agent, half-skill run that nobody asked for.

**Independent Test**: Type each mixed or misspelled form and check that nothing runs and the message names the valid forms.

**Acceptance Scenarios**:

1. **Given** `--team skill-agents,implementer <request>`, **When** the command runs, **Then** it refuses in one message that says skill-agents cannot be combined with role names, before any work.
2. **Given** `--team skill-agent <request>` (misspelled), **When** the command runs, **Then** it refuses as for any unknown team name and lists the valid names including `skill-agents`.
3. **Given** `--team skill-agents` in text after the request has begun, **When** the command runs, **Then** it is read as request text, as for other options.
4. **Given** a request without `--team`, **When** the user answers the team-size question in free text with `skill-agents`, **Then** the answer is not the mode, and the user is asked again or told the valid choices, as for `noagents`.
5. **Given** a skill-agents run whose audit does not pass, **When** the run reaches the point before build, **Then** building does not start; and **Given** a finished build, **When** the result does not satisfy the spec, **Then** the run does not hand over as verified.
6. **Given** a skill-agents run, **When** a role tries to write a file outside its lane (or a read-only role tries to write any file), **Then** the write is blocked, as it is for the matching agent in a default run; and **Given** any guardrail that cannot be enforced in this mode, **When** the run starts, **Then** it is listed to the user before any work.
7. **Given** a skill-agents run, **When** any role acts, **Then** it acts in the user's own session context and no separate context is started for it.

---

### User Story 4 - Same options alongside it (Priority: P3)

A user adds `--security` or `--project <name>` to a skill-agents run and gets the security review and the project's knowledge, as in a default run.

**Why this priority**: Useful but the mode is valuable without it.

**Independent Test**: Run with `--project` set and check the project's instructions are applied in the roles' work; run with `--security` and check a security review step happens.

**Acceptance Scenarios**:

1. **Given** `--team skill-agents --project billing <request>`, **When** the run starts, **Then** the project's instructions apply to every role's work.
2. **Given** `--team skill-agents --security <request>`, **When** the spec and the result are reached, **Then** the security review happens at both points as in a default run.

---

### Edge Cases

- The working tree is not clean, or `.specify/` is missing: the same preconditions and refusals apply as in a default run.
- A role skill is missing at run time (not installed): the run refuses before any work and names the missing skill.
- The user interrupts a skill-agents run partway, or an API error ends its turn: the files written so far remain, the acting role's lane ends with that turn (its lane check and report do not run, and the user is told so), and the user can restart with the same command.
- A skill-agents run in a repository where the default team is installed too: both modes coexist, and choosing one never changes the other's files.
- The installer is run again or the tool is uninstalled: role skills are installed and removed with the same marker rule as the team's other files.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/speckit-team --team skill-agents <request>` MUST run the six core roles, in pipeline order, as role-based skills and MUST launch no subagent.
- **FR-002**: The word `skill-agents` MUST be accepted only as the whole team list, in the same position as other `--team` lists, and MUST be refused with a message when combined with any role name.
- **FR-003**: A run in this mode MUST stop for the user at every point where the default team stops, and MUST show the user which role is acting.
- **FR-004**: A run in this mode MUST produce the same kinds of feature file (spec, plan, tasks, tests, built result) as a default run for the same request; their content may differ, as SC-004 measures.
- **FR-005**: Requests without `--team`, and every existing `--team` form, `--security` and `--project`, MUST behave exactly as before, including the team-size question and its four options.
- **FR-006**: The team-size question MUST NOT offer skill-agents as an option; the mode is chosen only by typing `--team skill-agents` in the command. A free-text answer of `skill-agents` to the team-size question MUST NOT start the mode.
- **FR-007**: `--security` and `--project <name>` MUST work in this mode with the same outcomes as in a default run.
- **FR-008**: In this mode the audit gate before build (building does not start until the audit passes) and the verification outcome (the result is checked against the spec before handover) MUST be enforced with the same outcome as in a default run. Each role MUST also be held to the same lane as its agent in a default run (which files it may write; read-only roles write nothing), enforced and not only reported, and the lane in force MUST change when the acting role changes. Any other guardrail that still cannot be enforced inside one session (for example tests being red before building, if so) MUST be named to the user at the start of the run as not enforced, and MUST NOT be silently dropped.
- **FR-009**: Installing MUST add the role skills and uninstalling MUST remove them, and files the user wrote MUST be left alone.
- **FR-010**: The documentation a user consults (README, the guardrail table, the command help) MUST describe the mode, state which guardrails apply in it, and state what was verified live and what only by test.
- **FR-011**: A run in this mode MUST refuse before any work if a needed role skill is missing, naming it.
- **FR-012**: In this mode the roles MUST run inline, in the user's own session context. A role MUST NOT be run in a separate subagent-like context.
- **FR-013**: A role skill's instructions MUST come from the same source as the matching agent's, so that changing a role's instructions changes both. No hand-kept second copy may exist.
- **FR-014**: The input tokens of a skill-agents run and of a default run of the same request MUST be measured, and the documentation MUST report the numbers and state which runs and which date they come from.

### Key Entities

- **Role skill**: the instructions for one of the six roles, run in the user's session. It does the same job as the matching subagent and reports under the role's name.
- **Skill-agents run**: one `/speckit-team` run in this mode, from request to handover.
- **Team list**: the words after `--team`; `skill-agents` is a reserved single-word list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a skill-agents run on the repository's standard full-run fixture, 0 subagents are launched and 6 of 6 roles report their work by name.
- **SC-002**: The existing test suite passes unchanged (0 existing tests edited to pass), and the team-size question text is identical before and after.
- **SC-003**: 100% of the mixed or misspelled forms in User Story 3 are refused before any file is written, with a message that lists the valid names.
- **SC-004**: For the same request on the standard fixture, a skill-agents run and a default run each produce a spec, plan, tasks and passing tests, and both pass the repository's final verification.
- **SC-005**: The input tokens of a skill-agents run and of a default run of the same request on the same fixture are measured, and both numbers, the runs they come from and the date are in the project's measurements document, so the claim that skills are cheaper is shown by numbers rather than assumed.
- **SC-006**: In a skill-agents run, 100% of attempted writes outside a role's lane (and every write by a read-only role) are blocked, the same cases a default run blocks, and 0 guardrails are dropped without being named at run start.
- **SC-007**: For each of the six roles, the skill's instructions and the agent's come from one source: 0 hand-kept duplicate copies exist, shown by a test that fails when they differ.

## Assumptions

- The default is the existing behaviour: nothing changes for a user who does not type `skill-agents`.
- The mode runs in the user's own session, so it shares that session's context; the cost of that is what SC-005 measures. The expected gain is lower input tokens than a default run; the measurement, not this expectation, is the claim.
- Pipeline order, stops, retry limits and handover are the same as the default team's.
- A team of fewer roles is out of scope: the mode runs all six core roles.
- Combining with `noagents` or a role list is out of scope and refused.
- Supported on Windows, macOS and Linux, as the rest of the team.
