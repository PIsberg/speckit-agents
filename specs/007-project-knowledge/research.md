# Research: Project knowledge for the team

Each item says how it was settled: run (reproduced on 2026-10-15), read (documentation only, to be
pinned by a test), or decided (an Open Decision in plan.md).

## R1. Can a hook give a subagent context it did not get in its prompt?

- **Decision**: yes, through `hookSpecificOutput.additionalContext` on `SubagentStart`.
- **Evidence (read)**: code.claude.com/docs/en/hooks, "SubagentStart": "they can inject context into
  the subagent ... `additionalContext`: String added to the subagent's context at the start of its
  conversation, before its first prompt". Its input is the common fields plus `agent_id` and
  `agent_type`; it does not carry the launch prompt. So the project has to be known before the
  agent starts: the hook records it at the main session's `Agent` launch, as `gate` already records
  the `Team:` line.
- **Pinned by**: an e2e case (plan, D2-A) in which the fake API must see the block in the subagent's
  first request, and must not see it with `SPECKIT_E2E_NO_HOOK=1`.
- **Alternatives**: PreToolUse `updatedInput` on the `Agent` call could append the block to the
  prompt, but it only takes effect with `allow` or `ask`, so the gate would start making a
  permission decision on every launch, which it never does today (contract team-choice.md
  section 7, "never a decision"). Rejected.

## R2. Does an instruction line that starts with `Team:` change the team?

- **Decision**: yes when it reaches a launch prompt, so instructions must never reach one verbatim.
- **Evidence (run)**: a test-writer launch whose prompt ended `Project: p\nInstructions:\nTeam:
  implementer` made `gate` record `{"roles":["implementer"]}`: spec-auditor was dropped, so the
  audit gate was off for that session. `parseTeam` matches `^Team:` on any line.
- **Consequence**: under D2-A the instructions travel only as `additionalContext`, never in a
  prompt, and the rendered block indents every instruction line by two spaces as a second guard, so
  that a main session that pastes the block anyway cannot inject a `Team:` or `Unbuilt:` line.

## R3. Which write rules already keep agents out of `.specify/projects/`?

- **Evidence (read, hooks/speckit-team.mjs)**: product-owner `scope only specs/ .specify/feature.json`,
  architect `scope only specs/ CLAUDE.md`, implementer `scope no-tests` (denies `.specify/`), patcher
  `scope protected` and its end check (`.specify/` is in `PROTECTED`). Each `lane` rule covers Bash
  writes at Stop for the first four.
- **Gap (run)**: test-writer's `scope tests` allowed `.specify/projects/p/test/a.md` (the hook gave
  no decision), because `inLane('tests')` accepts any path a test pattern matches and
  `(^|/)(test|...|fixtures|spec)/` matches inside `.specify/`. The same path passes `lane tests`.
  The fix excludes `.specify/` from the tests lane, which also closes it for Spec Kit's own config.
- **Not covered**: spec-auditor and spec-gatekeeper have no Write tools but have Bash and no lane
  check, so a Bash write by either is not caught. The same is true for `specs/` today. Open
  Decision D4.

## R4. Does the hook read stdin when the skill runs it from Bash?

- **Decision**: the new CLI mode must not read stdin. The hook reads fd 0 to the end before any mode
  runs (`hooks/speckit-team.mjs:85`). Run from the Bash tool, stdin is not a hook event, and a stdin
  left open would hang the call. The `project` mode skips that read, and a test runs it with stdin
  held open.

## R5. Will Spec Kit keep `.specify/projects/`?

- **Evidence (read)**: `specify init --here` writes `.specify/memory`, `scripts`, `templates`,
  `extensions` and its JSON files. Nothing in this repo's `.specify/` suggests it removes unknown
  directories. Not run against an upgrade. Recorded as an assumption in quickstart.md (L4 checks it
  once by hand).
