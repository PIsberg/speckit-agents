# Implementation Plan: Project knowledge for the team

**Branch**: `007-project-knowledge` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-project-knowledge/spec.md`

## Summary

A project is a directory `.specify/projects/<name>/` holding `instructions.md` and knowledge files
(D1). `--project <name>` on `/speckit-team` and `/speckit-patch` activates it for one request. The
rules are in [contracts/project.md](contracts/project.md). Four parts change:

1. The hook (`hooks/speckit-team.mjs`) gets a CLI mode `project <name>` that validates a project and
   prints its block (instructions indented, knowledge files listed with sizes, the precedence
   sentence). The skills run it once per request to refuse a bad name before any launch and to
   word the start notice; `--team noagents` runs follow its output in the main session.
2. The same hook records the launch prompt's `Project: <name>` line per session at the main
   session's `Agent` launch (the existing `gate` entry), and at `SubagentStart` returns the rendered
   block as `additionalContext` (D2). The installer widens the `SubagentStart` matcher from
   `product-owner|architect` to the seven roles. The main session writes one line per launch; the
   hook, not the model, delivers the instructions.
3. test-writer's tests lane stops accepting paths under `.specify/` (research R3), and `typedRoles`
   skips a leading `--project <name>`.
4. The three skills parse and pass the flag. No agent body changes: the block explains itself.

Without the flag no prompt carries a `Project:` line, no record is written, and `SubagentStart`
returns what it returns today (FR-005).

## Technical Context

**Language/Version**: Node 18+ ES modules (hook, installer, tests); Markdown prompts (skills)

**Primary Dependencies**: none (constitution IV)

**Storage**: user files under `.specify/projects/`; one JSON record per session under
`.git/speckit-team/project/` ([data-model.md](data-model.md))

**Testing**: `node:test`: `test/hook.test.mjs` (CLI mode, record, injection, lane fix),
`test/install.test.mjs` (matcher, skill texts), `test/hook-patch.test.mjs` (the fast track's budget
with a project record), `test/e2e.test.mjs` (real `claude -p` against the
fake API: the block reaches the subagent's first request; the typed `--project` before
`--team noagents`)

**Target Platform**: Claude Code 2.1.293 (CI) on Windows, macOS, Linux

**Project Type**: Claude Code agent team (prompts plus one hook script and an installer)

**Performance Goals**: `SubagentStart` now starts one hook process for five more roles: one process
per agent launch. Budget: 500 ms per process, the figure feature 006 set (constitution III asks the
plan for a budget and states none). Today's `start` path is the yardstick; T017 measures the new one
and records it in research.md R6, which the audit fingerprint does not cover.

**Constraints**: hooks fail open (a crash gives the agent no project context and the user a
`systemMessage`); no guardrail reads project content (FR-009)

**Scale/Scope**: instructions at most 8,192 bytes, at most 100 knowledge files (D3)

**Assumption pinned by a test**: `SubagentStart`'s `additionalContext` reaches the subagent's first
model request on 2.1.293 (research R1); the e2e case fails if it does not, and fails with
`SPECKIT_E2E_NO_HOOK=1`.

## Constitution Check

| Rule | How |
|---|---|
| I. Test in `test/` under `npm test`, failing first | every slice starts with its test task; the lane fix and the `Team:` injection were reproduced before planning (research R2, R3) |
| I. Assert what a caller observes | CLI stdout and exit code, the hook's `additionalContext` JSON, deny decisions, the record file, the subagent's request at the fake API |
| I. No test that passes because the code never ran | the e2e injection case fails with `SPECKIT_E2E_NO_HOOK=1` |
| II. No throw on any input; a test per throwing path | a directory named `instructions.md`, an unreadable record, a project removed mid-run, a non-string prompt or `subagent_type`, a `SubagentStart` without a usable `session_id` or `agent_type`, a record with a bad `name`, stdin left open (T001, T003) |
| II. Wiring change verified live | the `SubagentStart` matcher widens: quickstart L1 to L3, recorded in README "Live results" |
| II. Quoted absolute forward-slash command | only the matcher changes; the command is `hookCommand('start')` as today |
| III. Observers never block; budget | `start` and the record path never decide; measured against 500 ms |
| IV. Node standard library only | `fs`, `path` |
| V. Public contracts additive and documented | a new optional flag, a new CLI mode, a wider matcher; README and contracts/project.md |
| VI. Metadata only | the record holds a name, a session id and a time; the block goes to the subagent, never to state (FR-013) |
| VII. Every platform | exact-case name match on case-insensitive file systems; forward-slash paths; e2e on all three in CI |
| VIII. Docs in the same change | README (new section, guardrail table, troubleshooting, known limits, test count), CLAUDE.md (modes, the `Project:` line twin), hook header, installer help, measurements |
| Install: idempotent, uninstall removes all | the widened matcher is rewritten on reinstall by `withGates`; uninstall removes it (install.test) |
| Install: nothing outside `.specify/` | the allowance is one hook process per gated call, exiting with no output. A team-agent launch outside a Spec Kit repo is two gated calls, each with its own settings entry: the `Agent` tool call (PreToolUse, one process, since 006) and the subagent's start (`SubagentStart`, one process, since #88 for product-owner and architect, now for all seven roles). Each exits at `specifyAbove` with no output and no blocking, and only these seven agent names match, so no other agent in any repo starts a process at its start |

Not applicable: plugin rules (no plugin code); event schema (no event emitted); Governance (no
amendment).

## Project Structure

### Documentation (this feature)

```text
specs/007-project-knowledge/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md          # try it; live checks L1 to L5
├── contracts/project.md
└── tasks.md
```

### Source Code (repository root)

```text
hooks/speckit-team.mjs          # project mode, record at Agent launch, SubagentStart context, tests lane, typedRoles
install.mjs                     # SubagentStart matcher; help text
skills/speckit-team/SKILL.md    # --project parsing, start notice, Project: line, noagents
skills/speckit-patch/SKILL.md   # --project parsing, Project: line in patcher's launch
skills/speckit-triage/SKILL.md  # keeps the flag in its suggestion
README.md, CLAUDE.md, docs/measurements.md
test/hook.test.mjs, test/install.test.mjs, test/hook-patch.test.mjs, test/e2e.test.mjs
docs/live-results.md            # L1 to L4
```

Unchanged: the seven agents' files; the board mod (retired, #11); `architecture-visualized.svg` (no
model, lane, stage or retry limit changes).

## Known limits

- spec-auditor and spec-gatekeeper can write a project file through Bash: they have no Write tools
  and no lane check (D4).
- The lane check skips files that were already dirty when the agent started, so an uncommitted
  project file is protected from Write/Edit but not from a Bash write. `/speckit-team` asks for a
  clean tree first, and `/speckit-patch` lists dirty files.
- The first `/speckit-team` or `/speckit-patch` with the flag asks permission for the Bash call that
  runs `node "<hook>" project <name>`, unless it is allowed (D5).
- Agents decide which knowledge files to read; the hook cannot tell whether one was read (FR-004 as
  approved).

## Complexity Tracking

None.

## Decisions

All five settled 2026-10-15 (the user took every recommended option); the `Spec:` lines are applied
to spec.md.

### D1. Where a project lives inside the repository (FR-001)

- **A, chosen by the user 2026-10-15: `.specify/projects/<name>/`, `instructions.md` plus every other file as knowledge.**
  Every writing agent's scope rule and the fast track's protected paths already deny `.specify/`,
  so FR-008 needs one fix (test-writer, research R3), not five new rules.
  - Spec: none.
- **B: `projects/<name>/` at the repository root.** More visible, but it is user code space: every
  scope rule, both lanes and `PROTECTED` need a new entry, and a repo with its own `projects/`
  directory collides.
  - Spec: none.

### D2. How the instructions reach each agent (FR-003)

- **A, chosen by the user 2026-10-15: the hook injects the block at `SubagentStart`, from a `Project:` line the main
  session puts in each launch prompt.** Delivery is the hook's, so it cannot be abbreviated or
  forgotten across 10 to 20 launches; the main session's context grows by one line per launch
  instead of the whole block; instructions never enter a prompt that `parseTeam` reads (R2). Costs
  a matcher change and a live check.
  - Spec: FR-003 reads "every agent launched in the run ... MUST start with the project's
    instructions and the list of its knowledge files in its context; the launch prompt names the
    project in one `Project:` line". FR-009's second sentence reads "The project context every agent
    receives MUST state ...". SC-002 reads "carry" as "start with ... in context". US1's
    Independent Test reads "every agent's transcript starts with the instructions and the list".
- **B: the main session pastes the block into every launch prompt.** No hook wiring change. Each
  launch adds the block (up to about 2,000 tokens at the D3 limit) to the main session's output and,
  from then on, to every request it re-reads; delivery depends on the model copying it intact each
  time.
  - Spec: none.

### D3. Size limits (FR-010)

- **A, chosen by the user 2026-10-15: instructions at most 8,192 bytes, at most 100 knowledge files.** About 2,000
  tokens per agent at the limit; claude.ai's own custom-instruction boxes are short paragraphs.
  - Spec: FR-010 names the two numbers.
- **B: 32,768 bytes and 500 files.** Room for long instructions, at up to about 8,000 tokens per
  launch.
  - Spec: FR-010 names the two numbers.

### D4. spec-auditor's and spec-gatekeeper's Bash writes (FR-008, SC-003)

- **A, chosen by the user 2026-10-15: a known limit, as for `specs/` today.** Both agents are read-only by their tool
  lists; a Bash write is a deliberate act a lane check could only report after the fact.
  - Spec: FR-008 reads "any Write or Edit by an agent, and any change a lane or end check covers,
    ... MUST be blocked"; SC-003 reads "0 agent writes through Write or Edit, and 0 lane-checked
    changes"; the README states the gap.
- **B: a Stop check for both that blocks on any change under `.specify/projects/`.** A new lane
  rule, two agent frontmatters and their body lengths in README, plus e2e cases.
  - Spec: none.

### D5. The permission prompt for the CLI call

- **A, chosen by the user 2026-10-15: leave it to the user's permissions.** One prompt per request with the flag, at
  the start; documented in Troubleshooting.
  - Spec: none.
- **B: the installer writes an exact allow rule for `node "<hook>" project`, as it does for the
  export line (#122).** No prompt, at the cost of a new settings entry, its uninstall and tests.
  - Spec: none.
