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
3. A role record exists: close it (section 6). A lane violation denies this call.
4. `<role>` is `test-writer`, `implementer` or `spec-gatekeeper`: the audit gate, `auditProblem()`, with
   the reason text of the existing `Implementation gate:` denial. Checking it again before
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
applies. No role record, or a subagent: no decision.

## 6. Closing a role (at section 4 step 3, and `lane role` at Stop)

1. Lane: `changedSince(sha)` minus `dirty`, outside the role's rule (`none`: every file). At a Skill
   call: deny, `Lane check: <role> changed files outside its lane: <files>. Restore them (git checkout
   <sha 12> -- <file>, or delete new files), then go on.` At Stop: `block` with the same text, unless
   `stop_hook_active`, then a `WARNING` system message as the agents' lane check gives.
2. Report: the assistant text blocks of `transcript` after `offset`, in order.
   - spec-auditor: the last `VERDICT: PASS|FAIL` line of those texts, matched as the `verdict` mode
     matches it. Recorded to `verdicts/<feature>.json` unless the fingerprint recorded at the role's
     start differs from now (then a system message as the `verdict` mode gives). None found: a system
     message, nothing recorded.
   - spec-gatekeeper: the last of those texts whose last line, normalised as the `ends` mode does it, is
     `APPROVED` or `REJECTED`, recorded to `ends/<feature>.json`.
3. At Stop the record is removed; at a Skill call it is replaced (section 4 step 5).
An unreadable record, an incomplete one or an unreadable transcript: a system message naming what
could not run; never a crash.

## 7. The start message

`speckit-team: skill-agents for this request: the roles run as skills in this session. Enforced by the
hook: each role's lane, the audit gate before test-writer, implementer and spec-gatekeeper,
spec-auditor's verdict and spec-gatekeeper's word. Not enforced: the audit gate on each tool call
inside test-writer and implementer (a spec, plan or tasks edit there is caught when the next of them or
spec-gatekeeper starts), the retry limit (the skill counts), the check that a report ends in its word,
and each role's own context (every role sees this conversation).`

The skill does not repeat it; it adds its one-line team notice as in `## Team`.
