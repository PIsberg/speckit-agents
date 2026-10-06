# Data Model: Agent Activity Feed and Live Pane

**Feature**: `001-agent-activity-feed-and-pane` | **Date**: 2026-10-06 | **Plan**: [plan.md](plan.md)

The machine-readable form of the record is [contracts/activity-record.schema.json](contracts/activity-record.schema.json).
This file explains the entities, their relationships, validation rules and state transitions.

## Entities and relationships

```
Session 1--* AgentInstance 1--* ActivityRecord *--1 Segment *--1 Store (one per repo, shared by worktrees)
FeatureRun 1--* ActivityRecord (team records only)
Envelope (mod -> writer) --becomes--> ActivityRecord
Consumer 1--1 Cursor --points into--> Segment
Config (.specify/activity.json) --governs--> writer (enabled, retention, opt-in fields)
Fault (per cause) --reported by--> writer, shown by the view
```

## ActivityRecord

One immutable fact about an agent at a point in time. One JSON object per line.

### Common fields (every kind)

| Field | Type | Rule |
|---|---|---|
| `schema` | string | `"1.0"` for this feature. `major.minor`. Consumers check the major. |
| `id` | string | UUID v4 from `crypto.randomUUID()`. Unique per record. |
| `ts` | string | ISO 8601 UTC with milliseconds, when the event happened (the producer's clock, not the write time). |
| `kind` | string | One of `agent-start`, `agent-stop`, `tool`, `decision`, `gate`, `verdict`, `lane`, `phase`. |
| `source` | string | `"hook"` (written by a guardrail process) or `"mod"` (relayed from the mod). |
| `session` | string | Claude Code `session_id`; `"unknown"` when the input has none. |
| `agent` | object | `{ "id": string, "name": string, "team": boolean }`. |
| `agent.id` | string | Claude Code `agent_id` for a subagent; `"main:<session>"` for the main session. Unique per running instance (FR-002). |
| `agent.name` | string | The subagent's `agent_type` (`implementer`, `Explore`, ...); `"main"` for the main session. |
| `agent.team` | boolean | `true` when `agent.name` is one of the six team agents, else `false`. |
| `feature` | string or null | Team records: the active feature directory (`specs/001-x`) from `.specify/feature.json`, or `"unknown"` when it cannot be read. Non-team records: `null` (not applicable). |
| `phase` | string or null | Team records: the agent's phase (table below), or `"unknown"`. `phase` records: the phase entered. Non-team records: `null`. |
| `worktree` | string | The checkout the event came from: path of its top level relative to the main worktree's top level, forward slashes, `"."` for the main checkout, `"unknown"` when git cannot say. Never absolute. |

Team agents and their phases: `product-owner` -> `specify`, `architect` -> `plan`,
`spec-auditor` -> `audit`, `test-writer` -> `red`, `implementer` -> `green`,
`spec-gatekeeper` -> `verify`.

### Kind-specific fields

| Kind | Field | Type | Rule |
|---|---|---|---|
| `agent-start` | `description` | string | Opt-in only (`fields.description`), first 200 characters. Absent by default. |
| `agent-stop` | (none) | | May repeat for one agent when a Stop hook kept it running (the lane check does this); a later record from the agent means it is active again. |
| `tool` | `tool` | string | Tool name as Claude Code reports it (`Edit`, `Bash`, `mcp__x__y`). |
| | `activity` | string | `reading`, `writing`, `running`, `searching`, `delegating` or `other` (table below). |
| | `path` | string or null | File tools only: repo-relative target path, forward slashes. `null` for other tools and for paths outside the repo. |
| | `command` | string | Opt-in only (`fields.command`), Bash command text, first 200 characters. Absent by default. |
| `decision` | `rule` | string | The rule that decided: `scope only <prefixes>`, `scope tests`, `scope no-tests`, or `verdict-line`. |
| | `outcome` | string | `allow`, `deny` (a tool call refused) or `block` (a stop refused). |
| | `tool` | string or null | The tool the decision was about; `null` for a stop. |
| | `path` | string or null | Repo-relative path decided on, forward slashes; `null` when none. |
| `gate` | `outcome` | string | `allow` or `block`. |
| | `trigger` | string | `tool` (an agent's tool call), `skill` (Claude calling the speckit-implement skill), `command` (the user typing `/speckit-implement`). |
| | `cause` | string or null | `null` when allowed; else `no-feature`, `no-verdict`, `verdict-fail`, `stale-audit`. |
| | `tool` | string or null | Tool name for `trigger: "tool"`, else `null`. |
| `verdict` | `verdict` | string | `PASS` or `FAIL`. |
| | `fingerprint` | string | 16 hex characters: the audited artifacts' fingerprint the gate compares against. |
| `lane` | `rule` | string | `tests` or `no-tests`. |
| | `result` | string | `clean`, `violations`, or `unchecked` (no start point was recorded for the agent). |
| | `paths` | string[] | Out-of-lane repo-relative paths, at most 20. Empty when clean. |
| | `pathCount` | integer | Total out-of-lane paths (may exceed the 20 listed). |
| | `final` | boolean | `true` when the stop went through (clean, or the second stop with a warning); `false` when the stop was blocked. |
| `phase` | `previous` | string or null | The feature's phase before this record; `null` for the first. |

Activity labels by tool (FR-009):

| `activity` | Tools |
|---|---|
| `reading` | Read, NotebookRead, WebFetch |
| `writing` | Write, Edit, MultiEdit, NotebookEdit |
| `running` | Bash, PowerShell, BashOutput, KillShell |
| `searching` | Grep, Glob, WebSearch, ToolSearch |
| `delegating` | Agent, Task, Skill, SendMessage |
| `other` | everything else, including MCP tools |

### Validation rules

- Every record carries all common fields; `feature` and `phase` are `null` exactly when
  `agent.team` is `false`, except `phase` records, which always have a phase.
- Strings are UTF-8; paths use `/` and never start with a drive letter or `/`.
- A serialized record is at most 4096 bytes. The writer shortens `paths` first, then opt-in strings.
- Forbidden content (FR-008): prompt text, model output (`last_assistant_message`), file contents,
  command output, environment values, credentials, and absolute paths. Only the allow-listed fields
  above are ever written.
- Within major version 1, fields and enum values may be added, never removed, renamed or retyped.
  Consumers ignore fields and enum values they do not know.

## AgentInstance (derived by consumers)

Identified by `agent.id` (with `session` for display). State is derived from its records:

```
            any record                 agent-stop
  (none) ------------> active ---------------------> finished
                        ^  |                            |
          any record    |  | no record for 120 s        | any later record
                        |  v                            v
                        stale <---------------------- active
```

- `active`: the latest record is not `agent-stop` and is at most 120 s old.
- `stale`: not finished and the latest record is more than 120 s old (FR-013). Shown, never as running.
- `finished`: the latest record is `agent-stop`. The lane result shown with it is the latest `lane`
  record for the same `agent.id`.
- Current activity: `activity` and `path` of the latest `tool` record.
- The main session (`agent.name == "main"`) is listed separately and is not counted in the
  summary's agent count, so an idle pipeline reads `0 agents` (US1 scenario 1).

## FeatureRun (derived)

Key: `feature`. Current phase: `phase` of the latest `phase` record for the feature, else of the
latest team record. Last completed phase: the current phase once no team agent of the feature is
active. Latest verdict: the latest `verdict` record for the feature.

## Segment and Store

- Store: `<git common dir>/speckit-team/activity/`, one per repository, shared by its worktrees.
- Segment: `<UTC yyyyMMdd'T'HHmmssSSS>Z-<pid>-<4 hex>.jsonl`. Append-only; created with exclusive
  create; deleted whole by retention; never rewritten.
- New segment when the newest is at least `segmentBytes` or was created on an earlier UTC day.
- Retention runs at segment creation: never the newest; age (`maxAgeDays`, keeping segments that
  hold the writing session's records); then size (`maxBytes`, oldest first, hard cap).

## Cursor (consumer side)

`{ [segmentName]: byteOffset }`. Offset is the first unconsumed byte; only bytes up to the last
`\n` are consumed. A cursor for a segment that no longer exists is dropped.

## Envelope (mod -> writer, internal)

One JSON object per stdin line of `node <hook> emit` (contracts/emit-cli.md):
`{ v: 1, kind, ts, session_id, cwd, agent_id?, agent_type?, tool?, file_path?, command?, description? }`.
`kind` is `agent-start`, `agent-stop` or `tool`. Unknown kinds and malformed lines are skipped and
counted. The writer derives every record field from these; nothing else is copied.

## Config (`.specify/activity.json`, optional)

| Key | Type | Default |
|---|---|---|
| `enabled` | boolean | `true` |
| `retention.maxAgeDays` | number > 0 | `7` |
| `retention.maxBytes` | integer >= 65536 | `10485760` |
| `retention.segmentBytes` | integer, 4096 to 1048576 | `262144` |
| `fields.command` | boolean | `false` |
| `fields.description` | boolean | `false` |

A missing file means all defaults. A malformed file or an invalid value falls back to the default
for that key and records a `config-invalid` fault.

## Fault

`{ cause: string, message: string, count: integer, firstAt: ts, lastAt: ts }`, keyed by `cause`
(`stream-unwritable:<code>`, `retention-failed:<code>`, `config-invalid`, `emit-failed:<code>`,
`emit-output-invalid`). Stored per stream in the temp directory; reported in `emit` output; shown by
the view once per cause per session.

## View state (`$.state`, plugin `speckit-activity`)

| Key | Value |
|---|---|
| `model` | Folded view: agents by id (name, team, session, worktree, state inputs, latest activity, path, lane), recent non-allow decisions (latest 8), allow counters, latest verdict per feature, current and last completed phase. |
| `now` | Milliseconds, updated by a 1 s tick so ages and stale marks advance. |
| `faults` | Causes already shown this session. |
