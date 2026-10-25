# Research: Skill-Agents Team Mode

Only the unknowns the decisions in `plan.md` do not already settle. Each is checked by an e2e case
against the real Claude Code (`test/e2e.test.mjs`, fake API, $0) before anything depends on it.

## R1. Does the session transcript hold a response's text when PreToolUse of its tool call runs?

Revised 2026-10-25 after CI.

- Finding: no, not reliably. First assumed yes; refuted on CI (PR #183, run 40223102740, Claude Code
  2.1.293): T017's session 1, one response holding text ending `VERDICT: PASS` and the
  `speckit-role-test-writer` Skill call, found no VERDICT at that call's PreToolUse on ubuntu and
  macOS (passed on windows, and locally on 2.1.310), and the Stop at the end of the same turn found it.
  The response holding a tool call reaches the transcript at some time around that call's PreToolUse:
  a race, platform and timing dependent. Rows written before the response, the turn's prompt among
  them, race the same way (R5).
- Decision (plan D10): what a closing role says last reaches the hook through hook input, not the
  transcript: at a Skill call, the first line of that call's `tool_input.args`, which the skill starts
  with the closing role's last line; at Stop, `last_assistant_message`. The transcript after the
  role's `offset` still gives its earlier responses (contract section 6 step 2).
- `last_assistant_message` at Stop: there on 2.1.293 (R5).
- Consequence for `offset`: taken at the Skill call's PreToolUse, it can lie before the rows of the
  response holding that call, so a role's window can start with that response's text (the line naming
  the role, the previous role's last message). The call's own `args` line and the Stop's last message
  are read after the transcript, so they win (`verdictIn` takes the last line, the `ends` word the last
  text). `offset` can also be 0 when the transcript is not written yet (R5).
- Alternatives (plan D10): wait in the hook for the call's own row; deny and ask for the call again;
  a Bash call that records the verdict (a settings `Bash` gate costs a process per Bash call in every
  repo); a verdict file the role writes (spec-auditor is read-only).

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

## R5. What does the main session's Stop carry on 2.1.293, and why did T017's session 2 fail on macOS?

Checked 2026-10-25 (audit finding U1, CI job 121272983651): Claude Code 2.1.293 from npm, T017's
session 2 script against the fake API of `test/e2e.test.mjs`, the team installed in a scratch repo and
its hook wrapped to log each input and the transcript's rows before running it. Windows 11, and Linux
(WSL Ubuntu, Node 22).

- `last_assistant_message` is there at the main session's Stop: Claude Code builds it from the
  session's messages in memory, not from the transcript (the bundle's Stop input schema: "Text content
  of the last assistant message before stopping"). Windows: 14 of 14 runs recorded PASS. Linux: 21 of
  22 recorded PASS from that field alone, since the transcript at Stop still ended at the Skill call's
  row in most of them.
- The transcript lags everywhere: Claude Code queues its rows and writes them every 100 ms
  (`FLUSH_INTERVAL_MS=100` in the 2.1.293 bundle), the turn's prompt row included. With the fake API
  answering at once, the first role Skill call's PreToolUse can run before the first write. The 22nd
  Linux run: no transcript file at that call, so the record took `offset` 0, the typed prompt's row
  then lay after it, `roleEnded` read the role as ended at Stop, removed it with contract section 8's
  message and recorded nothing: `verdict` 'none recorded', CI's macOS result. The same race can end a
  role at its first write (T008, T011, T014), and in a real session wherever a response comes within
  100 ms of its prompt. On Windows the slower hook start hid it: 14 of 14 transcripts held the prompt
  row by the first Skill call.
- `prompt_id`: every hook input carries it on 2.1.293, the bundle's base hook schema: "UUID correlating
  a user prompt with all subsequent events until the next prompt". Seen: UserPromptExpansion,
  PreToolUse `Skill` and Stop of one turn carry one value; `claude -p --resume` of the same session
  (same `session_id`) carries a new one; the same on 2.1.310. Read in the bundle, not seen: every input
  that is not a list of tool results gets a new id (typed prompts, slash commands, the prompt after an
  interrupt or an API error), so an AskUserQuestion answer keeps it. Not known: whether a message typed
  while a turn runs gets a new id; the `-p` harness cannot send one.
- Decision: plan D11.
