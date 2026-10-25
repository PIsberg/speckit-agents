# Research: Skill-Agents Team Mode

Only the unknowns the decisions in `plan.md` do not already settle. Each is checked by an e2e case
against the real Claude Code (`test/e2e.test.mjs`, fake API, $0) before anything depends on it.

## R1. Does the session transcript hold a response's text when PreToolUse of its tool call runs?

- Decision: yes, assumed. The hook reads the role's report from `transcript_path`, from the byte
  offset recorded when the role started, when the role closes (the next role skill's PreToolUse, or
  Stop). Claude Code writes each content block of a response as its own transcript line before it runs
  the response's tools.
- Rationale: the main session has no SubagentHandback and no SubagentStop, so the transcript is the
  only place a hook sees what spec-auditor and spec-gatekeeper concluded (FR-008).
- If wrong: no verdict is found at the Skill call, the audit gate stays closed with a message naming
  the missing VERDICT line (fails closed, Constitution II), and the Stop path still records it.
  T017 covers both paths.
- Alternatives: a Bash call that records the verdict (the session could record any verdict, and a
  settings `Bash` gate costs a process per Bash call in every repo); a verdict file the role writes
  (spec-auditor is read-only).

## R2. Do a skill's frontmatter hooks fire for the main session, and stay after the skill?

- Decision: yes, per the spec's clarification of 2026-10-25 ("a rule declared by a skill stays active
  for the rest of the session"). The role skills carry `scope role` and `lane role`; the hook looks up
  the acting role on each call, so a rule that outlives its skill applies the current role's lane.
- Rationale: no new `settings.json` entry, so sessions that never run a role skill start no extra
  process (Installation Constraints).
- If wrong: T011 and T014 fail with the hook in place; the slice goes back to the architect, never to a
  silent fallback.
- Alternative: a `settings.json` PreToolUse `Write|Edit|MultiEdit|NotebookEdit` gate and a Stop gate:
  a process on every write and every turn in every repo, and the Stop one is outside the constitution's
  allowance.

## R3. Can the model invoke a skill marked `user-invocable: false`?

- Decision: yes; the flag only hides it from the `/` menu. A typed `/speckit-role-x` would fire
  UserPromptExpansion, not the Skill gate, and run with no role record, so the role skills are not
  typeable. T008 invokes one through the Skill tool on the oldest supported Claude Code (CI).

## R4. One source for a role's instructions (FR-013)

- Decision: `install.mjs` generates each role skill from `agents/<role>.md` at install time: a fixed
  frontmatter and preamble, then the agent's body byte for byte.
- Alternatives: a symlink (no frontmatter of its own, and Windows needs developer mode); a skill that
  tells the session to Read the agent file (the role's instructions then arrive through Read, which the
  hook cannot tie to a role); a second hand-kept file (forbidden by FR-013).
