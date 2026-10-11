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
```

| Field | Rule |
|---|---|
| `session_id` | the launching main session's `session_id`, matching `^[\w-]{1,128}$`; the file name repeats it |
| `roles` | the Team line's roles, lower case, each once, in `TEAM_ROLES` order |
| `at` | ISO time of the launch that wrote it |

No prompt text, request text or model output (constitution VI).

Lifecycle (`contracts/team-choice.md` section 7):
- Written at every main-session `Agent` launch whose prompt has a valid `Team:` line, replacing the
  previous one.
- Removed at a main-session `Agent` launch with no `Team:` line or an invalid one, so the next
  full-team request in the same session, or a hand-typed `@agent-implementer`, gets the full gates
  (FR-009).
- Read only by `gate`, `gate retries` and `result` in a subagent of the same session; a record of
  another session is never opened. Missing: full gates. Unreadable or without a `roles` array: full
  gates too (fail closed, like an unreadable verdict).
- Never cleaned up otherwise: one file of under 200 bytes per session that ran a subset request;
  safe to delete, like the rest of the directory.
