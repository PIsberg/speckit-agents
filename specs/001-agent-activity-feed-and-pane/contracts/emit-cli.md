# Contract: hook CLI additions (`emit` mode, records from guardrail modes)

`hooks/speckit-team.mjs` keeps its four guardrail modes and gains one mode. It is installed at
`<claude dir>/hooks/speckit-team.mjs`; its record code lives in `hooks/speckit-activity.mjs`
beside it, loaded with a dynamic `import()` inside `try`/`catch` only after the `.specify/` check,
so a missing or broken activity module can never crash a guardrail or change a decision.

Wiring is unchanged by this feature. Since commit b9b0dc3 it is: `scope` on PreToolUse
Write/Edit (agent frontmatter); `gate` on PreToolUse `.*` for test-writer and implementer and on
PreToolUse `Skill` and `UserPromptExpansion` in `settings.json`, with `SubagentHandback` exempt;
`verdict` on spec-auditor's PreToolUse `SubagentHandback` and its Stop; `lane` on Stop of
test-writer and implementer. No new command hook is added, catch-all or otherwise.

## All modes: input handling (FR-019, decided in audit finding H1)

Each mode accepts only the events it is wired to:

| Mode | Accepted `hook_event_name` |
|---|---|
| `scope` | `PreToolUse` |
| `gate` | `PreToolUse`, `UserPromptExpansion` |
| `verdict` | `PreToolUse` (with `tool_name` `SubagentHandback`), `SubagentStop` |
| `lane` | `SubagentStop` |

On empty stdin, stdin that is not a JSON object, or an event the mode does not accept, the mode
**makes no decision**: exit 0, empty stdout, so the action proceeds, which is what today's crash
on malformed stdin already does in effect. In a Spec Kit repository (found from `cwd` in the input,
else the process's working directory) it also writes one `observer-fault` record with cause
`input-invalid:<mode>` (empty or unparsable) or `input-unknown-event:<mode>`, and no input content.
Outside a Spec Kit repository it writes nothing (FR-022, SC-008).

Today `gate` given `{}` in a Spec Kit repo denies, and `verdict` given `{}` blocks; both get this
no-op path (tasks).

## Guardrail modes: records (FR-001)

Each guardrail mode appends its record before it prints its decision, and never changes what it
prints or its exit code because of observation (FR-017, SC-004).

| Mode | Record | When |
|---|---|---|
| `scope ...` | `decision` (`rule` = `scope only <prefixes>`, `scope tests` or `scope no-tests`; `outcome` `allow` or `deny`) | every evaluated Write/Edit inside the repo |
| `gate` | `gate` (`outcome`, `trigger`, `cause`, `tool`) | every evaluation of the audit. Not for `SubagentHandback` (exempt, not evaluated), nor for skills or commands other than speckit-implement. |
| `verdict` via PreToolUse `SubagentHandback` | `verdict` (`PASS`/`FAIL`, `via: "handback"`) when found; else `decision` `verdict-line` `deny` the first time, `allow` when let through the second time | spec-auditor's report in interactive sessions |
| `verdict` via `SubagentStop` | `verdict` (`via: "stop"`) when found; else `decision` `verdict-line` `block`, or no record when the hook lets the stop go without asking | spec-auditor's stop (the `claude -p` path) |
| `lane tests\|no-tests` | `lane` (`clean`, `violations` or `unchecked`; `final`) | every stop of test-writer and implementer |

Agent identity comes from the hook input: `agent_id` and `agent_type` inside a subagent; the main
session otherwise (`main:<session_id>`, name `main`).

If the activity module cannot be imported, or throws, the guardrail's output and exit code are
exactly those it would produce with the module intact, and no record is written.

## `emit` mode (internal, used by the mod; versioned as `v: 1`)

```
node "<claude dir>/hooks/speckit-team.mjs" emit < envelopes.jsonl
```

`emit` is not a Claude Code hook: only the mod calls it, and only in Spec Kit repositories. It
always answers with its status JSON.

Stdin: one envelope per line.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `v` | 1 | yes | envelope version |
| `kind` | `agent-start`, `agent-stop`, `tool`, `observer-fault` | yes | |
| `ts` | ISO 8601 string | yes | when the event happened; replaced by the write time when invalid |
| `session_id` | string | yes | |
| `cwd` | absolute path | yes | the agent's working directory: for a subagent the `cwd` of its `classic.SubagentStart` (its worktree when isolated), else the session's |
| `agent_id` | string | no | absent for the main session |
| `agent_type` | string | no | absent for the main session |
| `tool` | string | for `tool` | tool name |
| `file_path` | string | no | raw target path of a file tool; made repo-relative or `null`, never stored raw |
| `command` | string | no | sent only when `fields.command` is on; dropped again by the writer when off |
| `description` | string | no | sent only when `fields.description` is on; same rule |
| `cause`, `mode` | string | for `observer-fault` | a cause from data-model.md "Fault causes" and the mod event that saw it |

Processing: envelopes are grouped by repository (resolved from `cwd`); envelopes for a cwd outside
a Spec Kit repository are skipped and counted, and create nothing. Lines that do not parse or name
an unknown `kind` are skipped, counted, and recorded as one `envelope-invalid` fault per batch. For
an `agent-start` of a team agent whose phase differs from the feature's last recorded phase, a
`phase` record is written first (research R6).

Stdout, always, exit code always 0:

```json
{ "written": 12, "skipped": 0, "faults": [ { "cause": "stream-unwritable:EEXIST", "message": "...", "count": 3, "firstAt": "...", "lastAt": "..." } ] }
```

`faults` lists the fault-file causes (data-model.md "Fault file") for the stream directories this
run touched, plus `activity-module-failed:<code>` when `speckit-activity.mjs` could not be imported
or threw (`ERR_MODULE_NOT_FOUND` for a missing module, the error's name when it throws, measured on
Node 26). Empty stdin is valid and prints `{"written":0,"skipped":0,"faults":[]}`; the installer's
smoke check runs it from the temp directory and expects exit 0 and that JSON.
