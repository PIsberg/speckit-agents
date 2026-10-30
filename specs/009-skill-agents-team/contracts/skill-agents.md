# Contract: `/speckit-team --team skill-agents`

Public (Constitution V): the typed form, the installed file names and the hook's messages. State
records: `data-model.md`.

## 1. The typed form (skill, `skills/speckit-team/SKILL.md`)

- `skill-agents` is a team list of exactly that one word, in any case, in the position of any
  `--team` list (`## Team`): after `--team`, which counts only as the first word or after a leading
  `--project <name>` or `--security`. `--security` and `--project` combine with it (FR-007).
- Refused before any work, in one message that says why and lists the valid names (the seven team
  roles, `noagents`, `skill-agents`):
  - `skill-agents` with any role name or with `noagents`: skill-agents runs every role as a skill and
    takes no role names (FR-002, US3-1);
  - a misspelling (`skill-agent`): the unknown-name refusal of `## Team` (US3-2).
- Not an option of the team-size question, whose text and four options stay as they are (FR-005,
  FR-006). A free-text answer `skill-agents` is not the mode: the skill says in one line that it is
  typed as `/speckit-team --team skill-agents <request>`, and stops (US3-4).
- `--team skill-agents` after the request text has started is request text (US3-3).

## 2. Installed role skills (`install.mjs`)

One per team role, seven (`AGENTS` without `patcher`), at
`<claude dir>/skills/speckit-role-<role>/SKILL.md`, generated from `agents/<role>.md` (FR-013):

```
---
# speckit-agents: managed by install.mjs. Generated from agents/<role>.md: edit that file and reinstall.
name: speckit-role-<role>
description: The <role> role of /speckit-team --team skill-agents, run in this session. Only that skill invokes it.
user-invocable: false
hooks:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: 'node "<hook path>" scope role'
  Stop:
    - hooks:
        - type: command
          command: 'node "<hook path>" lane role'
---
<preamble>

<the agent's body: everything after its closing frontmatter line, byte for byte>
```

- No `context:`, `agent:`, `model:` or `allowed-tools:` key: the role runs inline, on the session's
  model (FR-012).
- `<hook path>` is the installed hook's quoted, absolute, forward-slash path, as in the agents.
- The preamble is one fixed text in `install.mjs` with `<role>` filled in. It says: you act as the
  `<role>` role inline in this session for `/speckit-team --team skill-agents`; your inputs are
  `$ARGUMENTS` and the files they name; there is no SubagentHandback, so your report is a message of
  yours whose last line is the one your Report section names, after which the orchestrating skill goes
  on; a skill the text says is preloaded you invoke with the Skill tool; launch no agent; the hook holds
  you to `<role>`'s lane until the next role skill or the end of the turn.
- Install, rerun (no change), `--force`, collision refusal and `--uninstall` treat them as the other
  skills: by the marker line, removing the `speckit-role-<role>/` folder (FR-009).

## 3. Hook: the typed command (`gate`, UserPromptExpansion `speckit-team`)

On a typed `/speckit-team` whose `typedRoles` list is exactly `['skill-agents']`:
- Any of the seven `<TEAM_DIR>/skills/speckit-role-<role>/SKILL.md` missing: `decision: block` with a
  reason that names each missing `speckit-role-<role>` and says to run `node install.mjs` (FR-011).
- Otherwise: remove the role record, write the team record with `skillAgents: true` (data-model) and
  answer with the start message (section 7) as `systemMessage`, no decision.
Every other typed form behaves as before; every typed `/speckit-team` removes the role record.

## 4. Hook: a role skill call (`gate`, PreToolUse `Skill`)

For a skill name (`skill_name`, `skill` or `name`, as the gate reads `speckit-implement`) matching
`(^|:)speckit-role-<team role>$`, in this order:
1. From a subagent (`agent_id` set): no decision.
2. The session's team record lacks `skillAgents`: deny, `speckit-role-<role> runs only in a request
   typed as /speckit-team --team skill-agents <request>.`
3. A live role record exists: close it (section 6). A lane violation denies this call. An ended one
   (section 8): removed with section 8's message, nothing closed.
4. `<role>` is `test-writer`, `implementer` or `spec-gatekeeper`: the audit gate, `auditProblem()`,
   denying with `Implementation gate: <problem>. Run the Skill speckit-role-spec-auditor (an agent
   launch ends skill-agents mode) and get VERDICT: PASS first.` In a session whose team record has
   `skillAgents`, every gate denial (the main session's `speckit-implement` Skill call too) gives this
   text in place of `Run @agent-spec-auditor ...`: following that one launches a subagent, against
   FR-001, and the launch overwrites the team record, which ends the mode (plan D3). Checking it again before
   spec-gatekeeper means an edit to the spec, plan, tasks or constitution made inside test-writer or
   implementer (implementer's lane allows `specs/`) never reaches verification unaudited (FR-008, plan D6).
5. Write the role record; no decision.
Any other skill name: as before.

## 5. Hook: `scope role` (PreToolUse `Write|Edit|MultiEdit|NotebookEdit`, role skill frontmatter)

From the main session with a role record, the acting role's rule from `ROLE_LANES`, which equals the
`scope` rule in each agent's frontmatter (a twin, held by a test):

| Role | Rule |
|---|---|
| product-owner | `only specs/ .specify/feature.json` |
| architect | `only specs/ CLAUDE.md` |
| test-writer | `tests` |
| implementer | `no-tests` |
| spec-auditor, spec-gatekeeper, security-reviewer | `none`: every write denied; `<role> is a read-only role and writes no files. Report what should change instead.` |

Denials name the role where the agent's name stands today. The git-directory rule of every `scope` rule
applies. No role record, or a subagent: no decision. An ended record (section 8): removed with section
8's message, no decision.

## 6. Closing a role (at section 4 step 3, and `lane role` at Stop)

`lane role` from a subagent (`agent_id` set, the hook firing as its `SubagentStop`): no decision, and
the main session's role stays acting; its own Stop closes it (#177).

1. Lane, for a role whose rule is not `none`: `changedSince(sha)` minus `dirty`, outside the role's
   rule. A read-only role gets no lane check at close, as its agent has no `lane` hook in a default run
   (SC-006, plan D7); section 5 denies its Write and Edit calls as the agent's `disallowedTools` do. At a Skill
   call: deny, `Lane check: <role> changed files outside its lane: <files>. Restore them (git checkout
   <sha 12> -- <file>, or delete new files), then go on.` At Stop: `block` with the same text, unless
   `stop_hook_active`, then a `WARNING` system message as the agents' lane check gives.
2. Report: the assistant text blocks of `transcript` after `offset`, in order, then one last text
   from the hook input, when it is a string: at a Skill call, the first line of that call's
   `tool_input.args`; at Stop, `last_assistant_message`. The response that holds a tool call can reach
   the transcript after that call's PreToolUse (research R1), so the closing role's last message
   arrives through that last text. The skill's half (`## Skill agents`): the Skill call after
   spec-auditor's or spec-gatekeeper's report starts its `args` with that report's last line,
   unchanged, on a line of its own (plan D10).
   - spec-auditor: the last `VERDICT: PASS|FAIL` line of those texts, matched as the `verdict` mode
     matches it. Recorded to `verdicts/<feature>.json` unless the fingerprint recorded at the role's
     start differs from now (then a system message as the `verdict` mode gives). None found: a system
     message, nothing recorded; at a Skill call it also says to call that Skill again with `args`
     starting with the role's VERDICT line. Both messages name the Skill `speckit-role-spec-auditor`
     as step 4 of section 4 does, never `@agent-spec-auditor`. A denied call leaves the role live
     (section 4 step 5 does not run), so the call made again closes the same role.
   - spec-gatekeeper: the last line of those texts that, normalised as the `ends` mode does it, is
     `APPROVED` or `REJECTED`, recorded to `ends/<feature>.json`. Not the very last line: the report
     and the hand-over can share one response, and text after the word would hide it (#185).
3. At Stop the record is removed; at a Skill call it is replaced (section 4 step 5). At Stop an ended
   record (section 8) is removed with section 8's message and nothing closed: no lane check, no block.
An unreadable record, an incomplete one or an unreadable transcript: a system message naming what
could not run; never a crash. With an unreadable transcript, step 2 reads the last text alone, and
says so only when that holds no verdict or word. So does a transcript that could not be read when the role
started (a null `offset`), even once it can: earlier turns' texts cannot be told from the role's, and the
message says the transcript was unreadable at the start (#180).

## 7. The start message

`speckit-team: skill-agents for this request: the roles run as skills in this session. Enforced by the
hook: each role's lane, the audit gate before test-writer, implementer and spec-gatekeeper,
spec-auditor's verdict and spec-gatekeeper's word. Not enforced: the audit gate on each tool call
inside test-writer and implementer (a spec, plan or tasks edit there is caught when the next of them or
spec-gatekeeper starts), the retry limit (the skill counts), the check that a report ends in its word,
each role's own context (every role sees this conversation), each agent's tool list (a role may use
every tool of this session, MCP tools included, and a read-only role's write through one is not
checked), and a role's lane after its turn ends without a Stop (an interrupt or an API error; the
role's lane check and report then do not run).`

The skill does not repeat it; it adds its one-line team notice as in `## Team`.

## 8. When a role ends (plan D8, D11)

A role record is live from its Skill call to the end of that turn. It has ended once the hook input
being handled carries a `prompt_id` (a non-empty string) other than the record's `prompt_id`. Claude
Code gives every prompt a new one: a typed prompt, the prompt after an interrupt or after a turn an API
error ended (StopFailure, no Stop); an AskUserQuestion answer (a tool result) and a Skill's body keep
the turn's (research R5). A record or an input without a string `prompt_id` leaves the record live.
The transcript is not read for this.

An ended record is removed where it is read (section 4 step 3, section 5, section 6 at Stop), never
closed, with the system message `speckit-team: the <role> role ended with its turn and no Stop ran;
its lane check and report did not run. Call the Skill speckit-role-<role> again to continue it.` A role
that goes on in a later turn is called again (section 1's skill, `## Skill agents`); its lane then
runs from that call.
