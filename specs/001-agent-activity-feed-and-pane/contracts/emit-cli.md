# Contract: hook CLI additions (`emit` mode, records from guardrail modes)

`hooks/speckit-team.mjs` keeps its four guardrail modes and gains one mode. It is installed at
`<claude dir>/hooks/speckit-team.mjs`; its record code lives in `hooks/speckit-activity.mjs`
beside it, loaded with a dynamic `import()` inside `try`/`catch` only after the `.specify/` check,
so a broken or missing activity module can never crash a guardrail.

## All modes: input handling (FR-019)

- Stdin is parsed inside `try`/`catch`. Empty or malformed stdin is treated as `{}`; unknown
  `hook_event_name` values fall through to the mode's no-op path. No mode throws.
- Outside a git repository with `.specify/`, every guardrail mode exits 0 with no output and
  creates nothing (FR-022, SC-008). `emit` is not a Claude Code hook (only the mod calls it, and only
  in Spec Kit repositories); it always answers with its status JSON, but writes no record and
  creates no directory for an envelope whose `cwd` is outside a Spec Kit repository.

## Guardrail modes: records (FR-001)

Each guardrail mode appends its record before it prints its decision, and never changes what it
prints or its exit code because of observation (FR-017, SC-004).

| Mode | Record | When |
|---|---|---|
| `scope ...` | `decision` (`rule` = `scope only <prefixes>`, `scope tests` or `scope no-tests`; `outcome` `allow` or `deny`) | every evaluated Write/Edit inside the repo |
| `gate` | `gate` (`outcome`, `trigger`, `cause`, `tool`) | every evaluation of the audit; not for skills or commands other than speckit-implement, which are not evaluations |
| `verdict` | `verdict` (`PASS`/`FAIL`) when recorded; `decision` (`rule` `verdict-line`, `outcome` `block`) when the line is missing | spec-auditor's stop |
| `lane tests\|no-tests` | `lane` (`clean`, `violations` or `unchecked`; `final`) | every stop of test-writer and implementer |

Agent identity comes from the hook input: `agent_id` and `agent_type` inside a subagent; the main
session otherwise (`main:<session_id>`, name `main`).

## `emit` mode (internal, used by the mod; versioned as `v: 1`)

```
node "<claude dir>/hooks/speckit-team.mjs" emit < envelopes.jsonl
```

Stdin: one envelope per line.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `v` | 1 | yes | envelope version |
| `kind` | `agent-start`, `agent-stop`, `tool` | yes | |
| `ts` | ISO 8601 string | yes | when the event happened; replaced by the write time when invalid |
| `session_id` | string | yes | |
| `cwd` | absolute path | yes | the agent's working directory (its worktree for isolated agents) |
| `agent_id` | string | no | absent for the main session |
| `agent_type` | string | no | absent for the main session |
| `tool` | string | for `tool` | tool name |
| `file_path` | string | no | raw target path of a file tool; made repo-relative or `null`, never stored raw |
| `command` | string | no | sent only when `fields.command` is on; dropped again by the writer when off |
| `description` | string | no | sent only when `fields.description` is on; same rule |

Processing: envelopes are grouped by repository (resolved from `cwd`); envelopes for a cwd outside
a Spec Kit repo, with an unknown `kind`, or that do not parse are skipped and counted. For an
`agent-start` of a team agent whose phase differs from the feature's last recorded phase, a
`phase` record is written first (research R6).

Stdout, always, exit code always 0:

```json
{ "written": 12, "skipped": 0, "faults": [ { "cause": "stream-unwritable:ENOTDIR", "message": "...", "count": 3, "firstAt": "...", "lastAt": "..." } ] }
```

`faults` lists every cause recorded for the stream directories this run touched (research R10).
Empty stdin is valid and prints `{"written":0,"skipped":0,"faults":[]}`; the installer's smoke
check runs it from the temp directory and expects exit 0 and that JSON.
