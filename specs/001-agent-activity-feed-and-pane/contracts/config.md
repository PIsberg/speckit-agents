# Contract: `.specify/activity.json` (public, optional, per repository)

Read by the writer on every write and by the mod at session start. Absent means every default.
It lives next to `.specify/test-paths`, which the guardrails already read.

```json
{
  "enabled": true,
  "retention": { "maxAgeDays": 7, "maxBytes": 10485760, "segmentBytes": 262144 },
  "fields": { "command": false, "description": false }
}
```

| Key | Type | Default | Effect |
|---|---|---|---|
| `enabled` | boolean | `true` | `false`: no record is written by any producer, and the view shows nothing in this repo. Guardrails are unaffected (FR-017). |
| `retention.maxAgeDays` | number > 0 | `7` | Segments last written longer ago are deleted, unless they hold the writing session's records (FR-011). |
| `retention.maxBytes` | integer >= 65536 | `10485760` (10 MB) | Hard cap on the directory; oldest segments deleted first (FR-011). |
| `retention.segmentBytes` | integer, 4096 to 1048576 | `262144` | Size at which a writer starts a new segment. Also bounds what the view reads per poll. |
| `fields.command` | boolean | `false` | Opt-in: `tool` records of `Bash` carry `command`, the first 200 characters (FR-009). |
| `fields.description` | boolean | `false` | Opt-in: `agent-start` records carry the subagent's task `description`, first 200 characters (FR-009). |

Rules:

- Unknown keys are ignored, so later minor versions can add keys.
- A file that is not valid JSON, or a value of the wrong type or out of range, falls back to that
  key's default and records the fault `config-invalid` (shown once per session by the view).
- Changes apply to the next write. The view rereads the file at session start.
