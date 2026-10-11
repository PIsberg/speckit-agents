# Data model: 006 choose the team size

One new piece of state. The team choice itself (spec, Key Entities) lives in the main session's
conversation and in the `Team:` line of each launch prompt (`contracts/team-choice.md` section 6);
only the hook's copy is stored.

## Team record

Path: `$(git rev-parse --git-common-dir)/speckit-team/team/<session_id>.json`, beside `verdicts/`
and `retries/` (README.md, "State"). In `.git`, so never committed, and shared by every worktree of
the repo, which lets implementers in worktrees read it.

```json
{ "session_id": "3f2c...", "roles": ["test-writer", "implementer"], "at": "2026-10-11T09:12:03.000Z" }
{ "session_id": "3f2c...", "roles": [], "noagents": true, "at": "2026-10-11T09:12:03.000Z" }
```

| Field | Rule |
|---|---|
| `session_id` | the launching main session's `session_id`, matching `^[\w-]{1,128}$`; the file name repeats it |
| `roles` | the Team line's roles, lower case, each once, in `TEAM_ROLES` order; all six for a launch with no valid `Team:` line; empty only with `noagents` |
| `noagents` | `true` only in the record a typed `/speckit-team --team noagents` writes (amended 2026-10-11, FR-013); absent otherwise |
| `at` | ISO time of the launch or typed command that wrote it |

No prompt text, request text or model output (constitution VI).

Lifecycle (`contracts/team-choice.md` section 7, amended 2026-10-11 for #101, #103 and FR-013):
- Removed when the user types `/speckit-team`, which starts a request (FR-009); typed as
  `/speckit-team --team noagents`, the `noagents` record is written in its place.
- Written at every main-session launch of a team role: the `Team:` line's roles, or the full team
  for a launch without a valid line, so a hand-typed `@agent-implementer` after a subset request
  gets the full gates (FR-009). Not rewritten when the record has `spec-auditor` and the new team
  lacks it (#101). Launches of other agents, and any subagent's `Agent` call, leave it alone (#102,
  #103).
- Read by `gate`, `gate retries` and `result` in a subagent of the same session, and, for the
  `noagents` flag only, by `gate` in the main session (a typed `/speckit-implement` or Claude's
  `speckit-implement` call); a record of another session is never opened. Missing: full gates.
  Unreadable or without a `roles` array: full gates too (fail closed, like an unreadable verdict).
- Never cleaned up otherwise: one file of under 200 bytes per session that launched a team role or
  typed `--team noagents`; safe to delete, like the rest of the directory.
