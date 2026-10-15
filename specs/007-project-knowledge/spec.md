# Feature Specification: Project knowledge for the team

**Feature Branch**: `007-project-knowledge`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "can you build support https://www.anthropic.com/news/projects it can activated with a flag". Settled with the owner on 2026-10-15: a project is the claude.ai Projects idea rebuilt for the team (custom instructions plus knowledge files), activated per request with a flag, on the pipeline and the fast track.

## Clarifications

### Session 2026-10-15

- Q: What does "support Projects" mean here? → A: The claude.ai Projects idea rebuilt for the team (custom instructions plus knowledge files), not a sync with claude.ai.
- Q: Where do projects live? → A: In the repository, one directory per project under one fixed location, shared through git (FR-001).
- Q: How do knowledge files reach the agents? → A: As a list of paths and sizes; each agent reads the files its task needs. No contents in launch prompts (FR-004).

### Plan decisions 2026-10-15

- Q: Where under the repository, how delivered, what limits, which writes blocked, which permission? → A: All recommended options of plan.md: `.specify/projects/<name>/` (D1); the hook injects the context at each agent's start from a `Project:` line (D2, FR-003, FR-009, SC-002); 8,192 bytes and 100 files (D3, FR-010); spec-auditor's and spec-gatekeeper's Bash writes are a known limit (D4, FR-008, SC-003); no installer allow rule (D5).

### Audit 2026-10-15 (spec-auditor FAIL, finding F1)

- Q: FR-005 promises identical decisions without the flag, but closing test-writer's lane on `.specify/` changes one in every run. Which gives? → A: FR-005 states it as its one exception (owner, 2026-10-15).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ground a pipeline run in a project (Priority: P1)

A user keeps reference material for their work, such as a style guide, domain notes or the docs of
an API they call, together with a few lines of standing instructions ("all public functions get a
doc comment", "money is never a float"). They start `/speckit-team` with a flag naming that
project. Every agent the run launches receives the project's instructions and knows which knowledge
files the project holds, so the spec, the plan, the tests and the code follow them without the user
repeating them in the request.

**Why this priority**: This is the feature. Without it, every request has to restate the same
context, and agents that start from nothing never see it.

**Independent Test**: Create a project whose instructions demand something an agent would not do
unprompted (for example a fixed marker line in every new file). Run a request with the flag and
read the transcripts: every agent's transcript starts with the instructions and the knowledge list,
and the files the agents wrote follow the instruction.

**Acceptance Scenarios**:

1. **Given** a project with instructions and two knowledge files, **When** the user starts
   `/speckit-team --project <name> <request>`, **Then** every agent launched in the run, every fix
   round included, receives the project's instructions and the list of its knowledge files.
2. **Given** that run, **When** an agent's task touches what a knowledge file covers, **Then** the
   agent can read that file without the user naming it.
3. **Given** a request with both `--team` and `--project`, in either order, **When** the run
   starts, **Then** both take effect.
4. **Given** a run with a project, **When** it starts, **Then** the user is told in one line which
   project is active and how many knowledge files it holds.

---

### User Story 2 - Without the flag, nothing changes (Priority: P1)

A user who does not pass the flag gets exactly today's run: the same launch prompts, the same
stops, the same guardrail decisions. A project that exists on disk is never picked up on its own.

**Why this priority**: The feature is opt-in. A run that changes because a directory happens to
exist would surprise every current user.

**Independent Test**: With a project present on disk, run a request without the flag and compare
its launch prompts and hook decisions with the pre-change version: identical.

**Acceptance Scenarios**:

1. **Given** a project on disk and a request without the flag, **When** the run proceeds, **Then**
   no launch prompt mentions the project and every guardrail decides as before this feature,
   except test-writer's tests lane on `.specify/` paths (FR-005).
2. **Given** a run with the flag, **When** the next request is started without it, **Then** that
   request runs with no project: the choice does not carry over.

---

### User Story 3 - The fast track uses the project too (Priority: P2)

A user making a small change with `/speckit-patch --project <name> <change>` gets the same
grounding: `patcher` receives the instructions and the knowledge list, and the fast track's budget
and protections are unchanged.

**Why this priority**: Small changes are where restating context costs most relative to the work,
but the pipeline already delivers the feature.

**Independent Test**: Run `/speckit-patch` with the flag; `patcher`'s launch prompt carries the
instructions and the list, and the budget check counts the same lines it counts today.

**Acceptance Scenarios**:

1. **Given** a project, **When** the user runs `/speckit-patch --project <name> <change>`, **Then**
   `patcher` receives the project's instructions and knowledge list.
2. **Given** that run, **When** the fast track checks its budget and protected paths, **Then** it
   decides exactly as it would without the flag.
3. **Given** `/speckit-team --team noagents --project <name> <request>`, **When** the main session
   runs Spec Kit's commands itself, **Then** it follows the project's instructions and reads its
   knowledge files the same way an agent would.

---

### User Story 4 - The project is reference, not workspace (Priority: P2)

While a project is active, no agent changes its instructions or knowledge files, and nothing in the
project can loosen a guardrail.

**Why this priority**: The project is the user's source of truth. An agent that "fixes" the style
guide to match its own code, or an instruction that says "skip the tests", would turn grounding into
a way around the team's rules.

**Independent Test**: In a run with a project, have an agent attempt to write a knowledge file: it
is blocked with a message naming the project. Put "skip the audit" in the instructions: the audit
gate still blocks implementer until an audit passes.

**Acceptance Scenarios**:

1. **Given** an active project, **When** any agent tries to create, change or delete a file in it,
   **Then** the action is blocked and the message says the file belongs to the active project.
2. **Given** an active project whose instructions contradict a guardrail or the constitution,
   **When** the run proceeds, **Then** every guardrail decides as it would without the project.
3. **Given** a request without the flag, **When** an agent writes a file inside a project, **Then**
   the guardrails decide as they do today for any path under `.specify/`: the user edits projects
   by hand, not through the team.

---

### Edge Cases

- The flag names a project that does not exist: the run stops before launching anything and lists
  the projects that do.
- The flag is given twice, or with no name after it: the run stops before launching anything and
  says why.
- The name contains a path separator or `..`: refused, the same way as an unknown project.
- The project has instructions and no knowledge files, or knowledge files and no instructions: it
  runs with what it has. A project with neither is refused as empty.
- The instructions exceed the size limit (FR-010): the run stops before launching anything and says
  the limit and the actual size.
- A knowledge file is large or not text (a PDF, an image): it is listed with its size; whether an
  agent reads it is the agent's call, as with any file.
- A knowledge file changes during the run: agents read it when they need it, so a later agent can
  see a newer version than an earlier one. Agents cannot change it (FR-008); the user can.
- The project's instructions ask for something the request contradicts: the request wins for that
  request, and the agent says so in its report.
- `/speckit-triage` with the flag: triage runs nothing; its suggested command keeps the flag.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A project MUST consist of a custom instructions text and zero or more knowledge files,
  identified by a name. Projects live in the repository, one directory per project under one fixed,
  documented location, so they are shared through git and reviewed like any other file. The flag
  never resolves a project outside the repository.
- **FR-002**: `/speckit-team` and `/speckit-patch` MUST accept `--project <name>` before the request
  text, in any order with `--team`. Without it, no project is active.
- **FR-003**: With a project active, every agent launched in the run (every role, every fix round,
  `patcher`) MUST start with the project's instructions and the list of its knowledge files, each
  with its path and size, in its context; the launch prompt names the project in one `Project:`
  line (D2).
- **FR-004**: Knowledge files MUST reach agents as a list only: no launch prompt carries a knowledge
  file's contents, and each agent reads the files its task needs. The list MUST tell the agent to
  check it before deciding something a listed file could cover.
- **FR-005**: Without the flag, launch prompts, stops and guardrail decisions MUST be identical to
  the behaviour before this feature, whether or not any project exists on disk, with one exception:
  test-writer's tests lane (its scope rule and its lane check) no longer accepts a path under
  `.specify/`, with or without the flag. Before this feature it accepted any such path that a test
  pattern matched (`.specify/<anything>/test/...`), which left Spec Kit's config and every project
  writable by test-writer.
- **FR-006**: The project choice MUST apply to one request only and MUST NOT persist into later
  requests.
- **FR-007**: The run MUST refuse, before launching anything, an unknown project, an empty project,
  a name with a path separator or `..`, a flag with no name and a flag given twice, and MUST say why
  and list the available projects.
- **FR-008**: Any Write or Edit by an agent into a project, and any change into a project that a lane
  or end check covers, MUST be blocked with a message that names the path. spec-auditor's and
  spec-gatekeeper's Bash writes are a documented known limit (D4).
- **FR-009**: A project's instructions MUST NOT change any guardrail's decision. The project context
  every agent receives MUST state that the constitution, the guardrails and the request take
  precedence over it.
- **FR-010**: The instructions text MUST be at most 8,192 bytes and a project MUST hold at most 100
  knowledge files, both checked before anything is launched; a knowledge file's own size is not
  limited, since files are listed rather than copied (D3).
- **FR-011**: At the start of a run with a project, the user MUST be told in one line which project
  is active and how many knowledge files it holds; the final report MUST name it.
- **FR-012**: In `/speckit-team --team noagents` runs, the main session MUST apply the project's
  instructions and knowledge itself.
- **FR-013**: Events, state records and recorded verdicts MUST NOT carry the instructions text or a
  knowledge file's contents; they carry at most the project's name.
- **FR-014**: The README (install, quick start, guardrail table, troubleshooting), `CLAUDE.md` and
  the skills' argument hints MUST describe how to create a project, the flag and what it changes.

### Key Entities

- **Project**: a named bundle of one custom instructions text and zero or more knowledge files.
  Owned and edited by the user; read-only to agents while active.
- **Custom instructions**: the standing guidance every agent in a run receives, below the
  constitution and the guardrails in precedence.
- **Knowledge file**: one reference document of a project; agents read it, never change it.
- **Project choice**: which project, if any, is active for one request. Lives for one request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Without the flag, 100% of the existing tests pass unchanged, and launch prompts are
  byte-identical to the pre-change version.
- **SC-002**: With the flag, 100% of launches in a run (every role, every fix round, `patcher`)
  start with the project's instructions and its knowledge list in context.
- **SC-003**: With the flag, 0 agent writes into the active project through Write or Edit succeed,
  and 0 changes into it pass a lane or end check.
- **SC-004**: With an instruction that contradicts a guardrail, 0 guardrail decisions differ from
  the same run without the project.
- **SC-005**: The extra input a project adds to a run is measured with `tools/usage.mjs` on one run
  with and one without the flag, and stated in `docs/measurements.md`.

## Assumptions

- A project is plain files the user writes: one instructions file and the documents beside it. No
  sync with claude.ai: the announcement names no API for Projects, and none is known, so a claude.ai
  Project's knowledge is copied in by hand.
- The flag is per request, like `--team`. A persistent default project (one switched on without the
  flag) is out of scope; it would contradict "off by default".
- Agents read knowledge with the tools they already have; the feature adds no search or retrieval
  over knowledge files.
- The board mod is retired (#11) and is not extended to show the project.
- The fast track's 30-line, 2-file budget counts only the change, never the project's files, which
  `patcher` cannot write anyway (FR-008).
