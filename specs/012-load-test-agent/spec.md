# Feature Specification: Opt-in load-test role

**Feature Branch**: `012-load-test-agent`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "add support for opting in a load-test skill-agent or agent. Its behaviour should be based on the learnings in the author's article 'A Passing Unit Test Is a Resting Pulse: Seven Layers of Load Testing for AI-Written Code'."

## Clarifications

### Session 2026-11-22

- Q: Does the role only review, or also write load tests? → A: write and run. It writes load-test files and its own records, never production code or functional tests, and runs them.
- Q: Does a FAIL stop the run, or is it advice? → A: stop the run for the user's decision, like a failed security review.

The article's premise: code written by an agent to pass functional tests can hide quadratic scans,
per-call process forks or per-access allocation that no fixture is large enough to show. A load-test
role puts a measurement in the pipeline that can fail for that reason. "Load test" below means any
repeatable measurement of what a workload costs (time, memory allocated, processor time, accuracy
under stress), not only concurrent requests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Opt in and get a measured verdict on the feature (Priority: P1)

A user running the team on a feature that touches a hot path (a request path, a build step, a loop
over user-sized input) adds the load-test role to the run. After the implementation is green, the
role measures the changed behaviour under load and ends with a verdict and the numbers behind it.

**Why this priority**: it is the feature: a run that can fail on cost, which unit tests cannot do.

**Independent Test**: run the team with the role on a fixture whose implementation passes every unit
test but scans its input quadratically; the verdict is FAIL and names the measurement that failed.

**Acceptance Scenarios**:

1. **Given** a run that names the role, **When** the implementation is green, **Then** the role runs
   once after it and its report ends with exactly one verdict line, PASS, FAIL or NOT MEASURED.
2. **Given** a run that does not name the role, **When** the pipeline runs, **Then** the role is
   never launched and the run behaves exactly as before this feature.
3. **Given** a feature with no load surface (a text change, a doc), **When** the role runs, **Then** it
   reports NOT MEASURED with the reason, never PASS.
4. **Given** the role in either mode (agents, or `--team skill-agents`), **When** the same fixture
   runs, **Then** the verdict is the same and the same guardrails hold.

---

### User Story 2 - A benchmark that did not run the code cannot pass (Priority: P1)

The role treats its own instruments as code that can be wrong. A result counts only if the harness
provably exercised the code under test.

**Why this priority**: the article's three "dead benchmark" cases (measuring a pinned release instead
of the branch, a crash that leaves empty results, a skip reported as green) make a load verdict
worthless without this.

**Independent Test**: break each instrument on a fixture (target pinned to an older build, every
benchmark throwing, a test skipped); each gives FAIL or NOT MEASURED, never PASS.

**Acceptance Scenarios**:

1. **Given** a harness that measures an artifact other than the working tree's build, **When** the role
   checks which artifact it resolved, **Then** the verdict is FAIL naming the artifact.
2. **Given** a run whose result set is empty or smaller than the expected count, **When** the role
   reads it, **Then** the verdict is FAIL, whatever the harness's exit status.
3. **Given** any load test that was skipped, **When** the role reports, **Then** the skip is listed as
   skipped, not passed, and a skip alone gives NOT MEASURED or FAIL.
4. **Given** a feature switch the measurement depends on (routing, a cache, an early exit), **When** the
   role measures what it saved, **Then** it first asserts the switch engaged, and fails if it did not.

---

### User Story 3 - Budgets come from evidence and gate on what does not drift (Priority: P2)

A ceiling is set only after the test has been seen failing, from recorded readings with a stated
margin. Only deterministic measures (allocated bytes, ratios to a control in the same run, work
counts, accuracy rates) fail a run. Wall-clock time and processor time are reported, never gating.

**Why this priority**: a guessed or padded budget either fails on machine weather or catches nothing.

**Independent Test**: a new budget's record shows a failing first run, the readings and the margin; a
fixture run on a throttled machine changes no verdict but carries a warning.

**Acceptance Scenarios**:

1. **Given** a new budget, **When** the role creates it, **Then** it first runs with a ceiling no
   workload can meet, records the failing readings and the date, and sets the ceiling at a stated
   multiple above the highest reading.
2. **Given** a failed budget later, **When** the role reports, **Then** it says to re-derive the
   ceiling from a failing run and never to raise the number until green.
3. **Given** a wall-clock figure that moved, **When** the role reports, **Then** the figure is listed
   as a trend and the verdict does not change.
4. **Given** the machine was busy (other processes at or above 10% of it) or slowed by 20% or more
   between a fixed probe at the start and the end, **When** the role reports, **Then** the report
   carries that warning and marks the run noisy.

---

### User Story 4 - Realistic and hostile workloads (Priority: P2)

The role measures with the shapes production sends: input sizes swept upward to expose growth worse
than linear, cold start separate from warm, concurrency swept past the point where throughput flattens,
the harness's own cost separated from the code's, and, where the feature makes decisions, accuracy
measured under the same load.

**Why this priority**: average-case fixtures hid every bug the article opens with.

**Independent Test**: on a fixture with a quadratic loop, doubling the input at least four times shows
work growing about four-fold per doubling and the role reports the growth, not only a total.

**Acceptance Scenarios**:

1. **Given** a feature that processes input of variable size, **When** the role measures it, **Then**
   it runs at least four sizes, each double the last, and reports growth per doubling.
2. **Given** a feature with a cache or early exit, **When** the role measures, **Then** it reports a
   cold first request and a warm one separately, and varies inputs so a cache cannot turn the run into
   lookups.
3. **Given** a feature that serves concurrent clients, **When** the role sweeps concurrency, **Then**
   it reports each level and treats flat throughput with rising latency as a queue, not a regression.
4. **Given** a feature that allows or blocks something, **When** the role measures under load, **Then**
   the false-positive and false-negative rates are reported next to speed, and a speed gain that
   changes verdicts is FAIL.
5. **Given** a measurement of the code inside a host (a compiler, a runtime, a framework), **When** the
   role reports its cost, **Then** it subtracts a do-nothing control run in the same host and reports
   the host's share and the code's share separately.

---

### User Story 5 - The harness stays alive in the repository (Priority: P3)

Load tests the role writes live in the project, change with the code, and a small version runs in the
project's ordinary test command, so they cannot rot. A written procedure tells a person or agent how to
run the full sweep later.

**Why this priority**: the article's account of why load tests die; a harness nobody runs is lost.

**Independent Test**: after a run, the project's normal test command executes the small load test and
fails when it is made to fail.

**Acceptance Scenarios**:

1. **Given** the role wrote a load test, **When** the project's normal test command runs, **Then** a
   reduced-size version runs and fails the command on a breach.
2. **Given** a finished run, **When** a user opens the feature's folder, **Then** a procedure and the
   recorded readings (date, environment, versions compared) are there.
3. **Given** two versions compared, **When** the role reports, **Then** they ran in one sitting in
   alternating order, and a difference is called real only when the ranges do not overlap.

### Edge Cases

- The project has no way to run a benchmark (no test command, no runner): NOT MEASURED, naming what is
  missing; the role does not invent a harness in another stack.
- The run is capped to a smaller load: the report lists the tiers the cap left out as skipped, not passed.
- The role is named with a team that has no implementer: it measures the code as it stands.
- A result moves with no code change named: the report says the cause is unknown and does not guess.
- The role's own FAIL cannot be reproduced on a second run: reported as unstable, with both readings.
- The user answers "NOT MEASURED is fine" for a feature with a load surface: the report still lists it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The team MUST offer one opt-in load-test role; it joins a run only when the user names it
  (a flag on the run, or in the team list), as the security reviewer does, and is never in the default team.
- **FR-002**: A run without the role MUST be unchanged: no launch, no added prompt text, no added hook
  process beyond what the run already starts.
- **FR-003**: The role MUST be available in both modes, as an agent and as a skill under
  `--team skill-agents`, with the same lane, the same verdict lines and the same guardrails.
- **FR-004**: The role MUST write load-test files and its records, and run them, in the project's load-test location and
  the feature's folder, and MUST NOT change production code or functional tests.
- **FR-005**: The role MUST run after the implementation is green and before the final approval check.
- **FR-006**: The report MUST end with exactly one line: PASS, FAIL or NOT MEASURED, and the run's
  routing MUST treat an absent or different last line as a refused report, as for the other verdict roles.
- **FR-007**: Every verdict MUST be backed by a list of measurements, each with its value, the ceiling or
  control it was judged against, and its unit.
- **FR-008**: Skipped, unavailable and not-run measurements MUST be listed apart from passed ones, and a
  run with only those MUST NOT end PASS.
- **FR-009**: The role MUST verify the measured artifact is the working tree's build, that the result set
  is non-empty and has the expected count, and that the feature under measurement engaged (US2).
- **FR-010**: A FAIL MUST stop the run for the user's decision, like a failed security review, and not
  be silently accepted.
- **FR-011**: Only deterministic measures (allocation, ratio to a same-run control, work counts, accuracy
  rates) MAY fail a run; wall-clock and processor time MUST be reported as trends (US3).
- **FR-012**: Every new ceiling MUST come from a recorded failing first run and a stated margin (US3).
- **FR-013**: The report MUST carry a noisy-run warning at 10% or more other-process load or 20% or more
  probe slowdown (US3).
- **FR-014**: The role MUST measure growth by input size, cold against warm, concurrency levels, the
  host's share against a control, and accuracy under load, each where the feature has that dimension (US4).
- **FR-015**: A version comparison MUST run in one sitting, alternating order, and call a difference real
  only when the ranges do not overlap (US5).
- **FR-016**: The role MUST leave a small version of each load test in the project's ordinary test
  command and a written procedure for the full sweep (US5).
- **FR-017**: The role MUST follow the same project-knowledge, team-line and audit rules the other roles
  follow, and the README's guardrail table and rules list MUST describe it.

### Key Entities

- **Load-test role**: the opt-in agent or skill, with a lane, a report and one verdict line.
- **Measurement**: a named metric, its value, unit, ceiling or control, and whether it gates or trends.
- **Budget record**: the ceiling, the failing first readings, their date and environment, the margin.
- **Run record**: the procedure, readings, versions compared, warnings and skipped tiers, kept in the
  feature's folder.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a fixture whose code passes all unit tests but scans its input quadratically, the role
  ends FAIL in 100% of 5 repeated runs, and names the measurement.
- **SC-002**: On a fixture whose benchmark is pinned to another build, returns an empty result set, or
  has a skipped test, the role never ends PASS in 5 of 5 runs each.
- **SC-003**: A run without the role launches 0 additional processes or agents and its launch prompts
  are byte-identical to before this feature.
- **SC-004**: The same fixture gives the same verdict line in agents mode and in `--team skill-agents` mode.
- **SC-005**: Every ceiling the role sets has a recorded failing first reading, in 100% of budgets created.
- **SC-006**: On a fixture run with 30% of the machine busy, no verdict flips and the report carries the
  noisy-run warning.

## Assumptions

- The role's name is `load-tester`, and the flag is `--load-test`; the plan may change both.
- It targets whatever stack the project uses; it does not ship a harness of its own, and where the stack
  has no deterministic measure it reports NOT MEASURED for that measure.
- The numbers 10%, 20%, 4 sizes and 2.2x style margins come from the article and are defaults a project
  may tighten; the first fixture-based tests set the values the plan keeps.
- Statistical rigor stops at the article's overlap rule; no significance test is required.
- Cost of a run (time, tokens) is for the plan to bound; the role runs once per run.
