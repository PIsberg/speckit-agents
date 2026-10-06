<!--
Sync Impact Report
- Version change: template -> 1.0.0 (first ratification)
- Principles defined: I. Test-First; II. Guardrails Never Fail Silently; III. Observers Never Block;
  IV. Zero Runtime Dependencies; V. Versioned Public Contracts; VI. Local and Private by Default;
  VII. Every Supported Platform; VIII. Docs in the Same Change
- Added sections: Installation Constraints; Workflow and Quality Gates; Governance
- Removed sections: none
- Templates: .specify/templates/plan-template.md (OK, Constitution Check derives gates from this file),
  .specify/templates/spec-template.md (OK, no new mandatory section),
  .specify/templates/tasks-template.md (OK, test tasks already precede implementation)
- Deferred TODOs: none
-->

# speckit-agents Constitution

## Core Principles

### I. Test-First (NON-NEGOTIABLE)

- Every behaviour change MUST ship with a test in `test/` that runs under `npm test`.
- The test MUST be shown failing before the change, or, where that is impractical, the change MUST
  be broken deliberately once and the test shown red. The evidence goes in the PR body.
- Tests MUST assert what a caller observes: a hook's decision JSON, the files the installer writes,
  the events a consumer receives, what a pane renders. Not private functions or internal state.
- A test that passes because the code under test never ran is a defect.

Rationale: in this repo the same commit that built the guardrails produced two bugs that only a
failing test or a live run exposed.

### II. Guardrails Never Fail Silently

- A Claude Code hook that crashes is a non-blocking error: the action proceeds and nobody is told.
  Every hook entry point MUST therefore handle all input, including empty, malformed and unknown
  events, without throwing. Any code path that can throw MUST have a test.
- A change to how a hook is wired (command string, event name, matcher, frontmatter) MUST be
  verified in a live Claude Code session before merge, and the PR MUST say what was observed.
  Unit tests cannot prove that Claude Code fires a hook.
- Installed hook commands MUST use a quoted, absolute, forward-slash path. Never `$HOME` or `~`.

### III. Observers Never Block

- Code that watches agents (event emitters, sinks, panes, status lines) MUST NOT deny, delay or
  alter an agent's action, and MUST NOT change any guardrail's decision.
- If an observer fails (a sink unreachable, a disk full, a render refused), the agent's work MUST
  continue unchanged and the failure MUST be visible somewhere the user looks.
- Observer overhead on a tool call MUST stay within a measured budget stated in the plan.

### IV. Zero Runtime Dependencies

- Hooks, installer and tests MUST use only the Node standard library (Node 18 or newer).
- Code that runs inside Claude Code as a plugin MUST use only the plugin API (`$`), and MUST be
  shippable as source with no build or `npm install` step for the user.
- Adding a runtime dependency requires amending this constitution first.

### V. Versioned Public Contracts

- Anything a consumer outside this repo can read or call is a public contract: the event format,
  installed file names and locations, `settings.json` entries, installer flags, slash commands.
- Every emitted event MUST carry a schema version. Within a major version, changes MUST be
  additive. Removing, renaming or retyping a field is a major version change and MUST be listed
  in the README.
- Consumers MUST be able to ignore fields they do not know; the docs MUST say so.

### VI. Local and Private by Default

- Event data MUST stay on the machine unless the user explicitly configures a destination.
- By default, events MUST NOT contain prompt text, model output, file contents, command output,
  environment variables or credentials. Metadata only: which agent, which tool, which phase,
  which repo-relative path, which decision, when.
- Anything beyond metadata MUST be opt-in per field, documented, and off by default.

### VII. Every Supported Platform

- Supported: Windows (Git Bash and PowerShell hook shells), macOS, Linux.
- Every feature MUST work on all three, or the spec MUST state the exception and why.
- Paths are compared and emitted with forward slashes. Line endings follow `.gitattributes`.

### VIII. Docs in the Same Change

- A change is not done until `README.md`, `CLAUDE.md` and the installer's help text describe it.
  Every count, path and command in those docs MUST match the code it describes.
- Docs MUST state what was verified live, what only by unit test, and what not at all.
- Prose uses no em-dashes and no curly quotes; numbers over adjectives.

## Installation Constraints

- `install.mjs` MUST stay idempotent: a second run changes nothing.
- The installer MUST NOT overwrite a file it did not write unless `--force` is given, and then only
  after backing it up. Ownership is decided by the `speckit-agents: managed by install.mjs` marker.
- It MUST validate everything it will read before writing anything, so a failure never leaves a
  half install.
- Installed components MUST cost nothing in repositories without `.specify/`: no blocking, no
  output, no measurable delay.
- `--uninstall` MUST remove every file and settings entry the installer added, and nothing else.

## Workflow and Quality Gates

- Work happens on a feature branch. Nothing is committed to `main` except the recorded baseline
  (2026-10-06). Agents open pull requests; they never merge them.
- Gates before a PR, each reported as passed, failed, skipped or not run:
  1. `npm test`, all suites green.
  2. `claude plugin validate` and `claude plugin test` for every plugin in the repo.
  3. The live check from README "Verifying" for any change to hook wiring or plugin events.
- A skipped gate is not a passed gate. A failure is reported with its output, never summarised.
- Never pipe a gate through `tail`, `tee` or `grep` without preserving its exit status.

## Governance

- This constitution overrides every other document in the repo. Where `CLAUDE.md` or the README
  disagrees with it, they are wrong and get fixed.
- spec-auditor treats a violated MUST as CRITICAL, which blocks implementation; spec-gatekeeper
  checks every MUST against the final diff. A justified deviation is recorded in the plan's
  Complexity Tracking table, and is still a FAIL unless this constitution is amended.
- Amendments go through `/speckit-constitution` with a version bump: MAJOR for removing or
  redefining a principle, MINOR for adding one, PATCH for wording. Each amendment updates the
  Sync Impact Report above.

**Version**: 1.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
