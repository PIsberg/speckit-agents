# Data Model: Skill-Agents Team Mode

State lives under the git common directory, `.git/speckit-team/` (`hooks/speckit-team.mjs: stateDir`),
written with `writeJson`, read with `readState`. Metadata only (Constitution VI).

## Team record, `team/<session_id>.json` (feature 006, changed)

| Field | Type | Rule |
|---|---|---|
| `skillAgents` | `true`, new | only from a typed `/speckit-team --team skill-agents` (UserPromptExpansion); never from a launch prompt or an answer (FR-006) |
| `roles` | string[] | `TEAM_ROLES`, all seven, when `skillAgents` |
| `session_id`, `at` | as before | |

`teamOf()` returns `{ roles, noagents, skillAgents }`; `skillAgents` is true only when the field is
`true`. A typed `/speckit-team` without it removes the record (as now); a team-role Agent launch
overwrites it without the field (as now), which ends the mode.

## Role record, `role/<session_id>.json` (new)

The role acting in the main session of a skill-agents request. At most one per session.

| Field | Type | Rule |
|---|---|---|
| `session_id` | string | matches `SESSION_ID` |
| `role` | string | one of `TEAM_ROLES` |
| `sha` | string | `git rev-parse HEAD` when the role started; hex, 40 to 64 characters |
| `dirty` | string[] | `changedSince('HEAD')` when the role started; excluded from its lane check |
| `transcript` | string or null | `transcript_path` of the Skill call |
| `offset` | number | that file's size in bytes then; the role's text starts there |
| `feature` | string or null | `feature()` then |
| `fingerprint` | string or null | `fingerprint(feature)` then, only for spec-auditor (the #77 rule) |
| `at` | ISO string | |

Lifecycle: written at the PreToolUse of a `speckit-role-<role>` Skill call that is let through;
closed (contract section 6) and replaced at the next such call; closed and removed at the main
session's Stop (`lane role`); removed by a typed `/speckit-team`. Ended at the first user prompt row
after `offset` (contract section 8): removed where it is next read, never closed. Unreadable or incomplete: the
lane check says it could not run, and `scope role` denies writes until a typed `/speckit-team`.

## Verdict and ends records (changed, additive)

`verdicts/<feature>.json` and `ends/<feature>.json` keep their fields. Recorded from a role skill,
`agent_id` is `null` and a new field `role` names `spec-auditor` or `spec-gatekeeper`. Readers that do
not know `role` ignore it (Constitution V).
