# Feature Specification: Choose the team size per request

**Feature Branch**: `006-choose-team-size`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "I would like to build that you dynamically choose how big your team of agents is for each /speckit-team request. then the rest of the flow need to adjust to the number of agents. for example if I just want implementer and test-writer. default should still be full team like now"

## Clarifications

### Session 2026-10-11

- Q: Where does a subset run get its work from when no spec- or task-writing role is present? → A: The request text is the brief. The chosen roles work from it in one round, with no spec, plan or task list.
- Q: Which roles are mandatory? → A: None individually, but a team must contain at least one of test-writer or implementer.
- Q: Is the team chosen interactively, from the request text, or both? → A: Both. The request text can name roles. When it names none, the user is asked once, with the full team as the recommended answer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a request with a chosen subset of the team (Priority: P1)

A user starts `/speckit-team` and names which of the team's roles take part in this request, for
example only implementer and test-writer. The run launches only those roles. Every step that
belonged to an absent role is skipped, and the run does not stop, ask about, or wait for anything
that only an absent role could produce.

**Why this priority**: This is the feature. Without it every request pays for the whole pipeline,
including requests that need two roles.

**Independent Test**: Start a request naming implementer and test-writer only. Read the session
transcript: no other role was launched, no stop was raised for a spec, a plan or an audit, and
the run ended with a report from the two chosen roles.

**Acceptance Scenarios**:

1. **Given** a clean working tree, **When** the user starts a request naming only implementer and
   test-writer, **Then** the only agents launched in the run are test-writer and implementer.
2. **Given** that same request, **When** the run reaches the point where the full team would
   stop for the user to approve a spec, a plan or an audit result, **Then** it raises none of
   those stops.
3. **Given** a request naming a subset, **When** the run starts, **Then** the user is told in one
   line which roles take part and which steps are skipped as a result.
4. **Given** a request naming only implementer, **When** the run starts, **Then** implementer
   works from the request text in one round and no spec.md, plan or tasks.md is created.
5. **Given** a request naming neither test-writer nor implementer, **When** the run starts,
   **Then** it stops before launching anything and says one of them is required.

---

### User Story 2 - No choice means the full team, exactly as today (Priority: P1)

A user who names no roles is asked one team question. Accepting the full team (or naming all six
roles with --team) runs the pipeline as it runs today: same agents, same order, same stops, same
guardrails.

**Why this priority**: The full-team path must not regress; the only change an existing user sees
is the one team question.

**Independent Test**: Start a request with no team named, accept the full team at the team
question, and compare the sequence of launches and stops from then on with the pre-change
behaviour: identical. Repeat with all six roles named with --team and no question: identical.

**Acceptance Scenarios**:

1. **Given** a request that names no roles and the full team accepted at the team question,
   **When** the run proceeds, **Then** every step of the full pipeline runs in its current order
   with its current stops.
2. **Given** the full team, **When** an agent is launched, **Then** every guardrail that applies
   today still applies to it, with the same decisions.

---

### User Story 3 - Guardrails follow the chosen team (Priority: P2)

Guardrails that today wait for an upstream role (for example, implementation is blocked until an
audit passes) stay correct when that role is absent: they neither block the run forever nor
silently open for a full-team run. The user can see why a guardrail did or did not apply.

**Why this priority**: A subset run that is blocked by a gate for a role that was never launched
is unusable, and a gate that opens in a full-team run would weaken the product.

**Independent Test**: Run implementer in a subset request that omits the auditor and in a
full-team request whose audit has not passed: the first is allowed, the second is blocked with
today's message.

**Acceptance Scenarios**:

1. **Given** a request whose team omits the audit role, **When** implementer starts, **Then** the
   implementation gate does not block it for want of an audit.
2. **Given** a full-team request whose audit has not passed, **When** implementer starts, **Then**
   it is blocked exactly as today.
3. **Given** a subset request, **When** a guardrail is skipped because its upstream role is
   absent, **Then** the run's report says which guardrail was skipped and why.

---

### User Story 4 - Choose the team without remembering role names (Priority: P3)

A user who names no roles in the request is asked once which roles take part, with the full team
recommended, instead of having to recall the role names.

**Why this priority**: Convenience only; naming roles in the request already delivers the feature.

**Independent Test**: Start a request that names no roles: the choice is offered once, and
accepting the recommendation yields the full team. Start one that names roles: no question is asked.

**Acceptance Scenarios**:

1. **Given** a request that names no roles, **When** the run starts, **Then** the user is asked
   once, can pick a subset or accept the full team in one answer, and the full team is the
   recommended option.
2. **Given** a request that names roles, **When** the run starts, **Then** the user is not asked
   to choose the team.

---

### Edge Cases

- The user names a role that does not exist: the run stops before launching anything and lists
  the valid role names.
- The user names an empty team or a team with neither test-writer nor implementer (see FR-006):
  the run stops before launching anything and says what is missing.
- The user names a subset in which a role needs an input no remaining role produces (for example
  implementer without any task list): the request text is the brief and the role works from it
  (FR-012); the run does not stop to ask for a spec, plan or task list.
- The user names architect without product-owner, or spec-auditor without architect: the run
  stops before launching anything and says which role each one needs.
- The user names a role twice: it counts once.
- The same role names are given in a different case or order: the run behaves the same.
- A subset run is resumed or a second request starts in the same feature: the new request's own
  team choice applies; a previous run's choice does not carry over.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A user MUST be able to name, per `/speckit-team` request, which of the team's
  roles take part.
- **FR-002**: With the full team (all six named, or the full team accepted at the FR-010
  question), the run MUST behave exactly as before this feature from then on (same launches,
  order, stops and guardrail decisions).
- **FR-003**: Only the chosen roles MUST be launched; no unchosen role is launched at any step,
  including fix rounds.
- **FR-004**: Every step, stop and hand-off belonging to an unchosen role MUST be skipped without
  asking the user about it.
- **FR-005**: At the start of a run the user MUST be told in one line which roles take part and
  which steps are skipped.
- **FR-006**: The run MUST refuse, before launching anything, a choice that names an unknown
  role, an empty team, a team containing neither test-writer nor implementer, architect without
  product-owner, or spec-auditor without architect, and MUST say why and list valid names. No
  single role is mandatory beyond these rules.
- **FR-007**: A guardrail that waits for an unchosen upstream role MUST NOT block the run for
  want of that role, and a guardrail whose upstream role is chosen MUST block exactly as today.
- **FR-008**: The run's final report MUST list the roles that ran, the steps skipped and every
  guardrail skipped because its upstream role was absent.
- **FR-009**: The team choice MUST apply to one request only and MUST NOT persist into later
  requests.
- **FR-010**: The request MAY name the roles with a leading `--team` and a comma-separated list
  of role names, before the request text. When it names none, the user MUST be asked once which
  roles take part, with the full team as the recommended answer; accepting it yields the full
  team. A request that names roles MUST NOT be asked again.
- **FR-012**: When the chosen team has no role that writes the spec or the task list
  (product-owner, architect), the request text MUST serve as the brief: the chosen roles work
  from it in one round, and the run neither requires nor creates a spec, a plan or a task list.
- **FR-011**: The documentation a user consults (README, role and guardrail tables) MUST state
  how to choose the team, what each omission skips and which guardrails follow.

### Key Entities

- **Team choice**: the set of roles taking part in one request. The full team of six roles is the
  recommended answer to the team question. Lives for one request.
- **Role**: one of the team's agents (product-owner, architect, spec-auditor, test-writer,
  implementer, spec-gatekeeper; the fast-track patcher is a separate track and not part of this
  choice).
- **Skipped step**: a pipeline step not run because its role is absent; reported to the user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A request naming implementer and test-writer launches exactly 2 distinct roles and
  raises 0 user stops for spec, plan or audit approval.
- **SC-002**: A request with the full team produces, after the team question, the same launch
  sequence, stops and guardrail decisions as the pre-change version in 100% of the existing
  full-pipeline test cases.
- **SC-003**: In every subset request, 0 unchosen roles are launched and 0 guardrails block for
  want of an absent role.
- **SC-004**: In a full-team request whose audit has not passed, implementer is still blocked
  (0 regressions in the gate's existing cases).
- **SC-005**: The final report of a subset run names every skipped step and guardrail, with 0
  omissions against the list derived from the chosen team.

## Assumptions

- The patcher and the fast track (`/speckit-patch`) are out of scope; they already are a small
  team of one.
- "Team size" means which roles participate, not how many copies of a role run.
- Hand-over (PR and CI follow-up) belongs to the main session, not to a role, and stays.
- Every role choice must keep today's rule that tests are written before implementation when
  both test-writer and implementer are chosen.
- In a run without product-owner and architect, the implementer's retry count and
  spec-gatekeeper's recorded word belong to the feature `.specify/feature.json` names, if any.
- Out of scope: reordering roles, adding new roles, running roles in parallel differently.
