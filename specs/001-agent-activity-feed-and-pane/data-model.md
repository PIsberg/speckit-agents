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
Config (.specify/activity.json) --governs--> writer and mod (enabled, retention, opt-in fields)
Fault --recorded as--> observer-fault record (when the stream is writable)
      --else kept in--> fault file (temp dir), reported by `emit`
```

## ActivityRecord

One immutable fact about an agent at a point in time. One JSON object per line.

### Common fields (every kind)

| Field | Type | Rule |
|---|---|---|
| `schema` | string | `"1.0"` for this feature. `major.minor`. Consumers check the major. |
| `id` | string | UUID v4 from `crypto.randomUUID()`. Unique per record. |
| `ts` | string | ISO 8601 UTC with milliseconds, when the event happened (the producer's clock, not the write time). The basis for ordering (see AgentInstance). |
| `kind` | string | One of `agent-start`, `agent-stop`, `tool`, `decision`, `gate`, `verdict`, `lane`, `phase`, `observer-fault`. |
| `source` | string | `"hook"` (written by a guardrail process) or `"mod"` (relayed from the mod). |
| `session` | string | Claude Code `session_id`; `"unknown"` when the input has none. |
| `agent` | object | `{ "id": string, "name": string, "team": boolean }`. |
| `agent.id` | string | Claude Code `agent_id` for a subagent; `"main:<session>"` for the main session; `"unknown"` for an `observer-fault` whose input named no agent. Unique per running instance (FR-002). |
| `agent.name` | string | The subagent's `agent_type` (`implementer`, `Explore`, ...); `"main"` for the main session; `"unknown"` as above. |
| `agent.team` | boolean | `true` when `agent.name` is one of the six team agents, else `false`. |
| `feature` | string or null | Team records: the active feature directory (`specs/001-x`) from `.specify/feature.json`, or `"unknown"` when it cannot be read. All other records: `null` (not applicable). |
| `phase` | string or null | Team records: the agent's phase (table below), or `"unknown"`. `phase` records: the phase entered. All other records: `null`. |
| `worktree` | string | The checkout the event came from: path of its top level relative to the main worktree's top level, forward slashes, `"."` for the main checkout, `"unknown"` when it cannot be determined. Never absolute. |

Team agents and their phases: `product-owner` -> `specify`, `architect` -> `plan`,
`spec-auditor` -> `audit`, `test-writer` -> `red`, `implementer` -> `green`,
`spec-gatekeeper` -> `verify`.

### Kind-specific fields

| Kind | Field | Type | Rule |
|---|---|---|---|
| `agent-start` | `description` | string | Opt-in only (`fields.description`), first 200 characters. Absent by default. Source: the mod's `classic.SubagentStart` (subagents) or `session.start` (main session). |
| `agent-stop` | `final` | `true` | The agent's run has ended. Source: the mod's `turn.complete` carrying the subagent's `agentId`, which fires only once any Stop hook (the lane check, the verdict line) has let the agent go; `session.end` for the main session. Written once per run. |
| `tool` | `tool` | string | Tool name as Claude Code reports it (`Edit`, `Bash`, `mcp__x__y`). |
| | `activity` | string | `reading`, `writing`, `running`, `searching`, `delegating` or `other` (table below). |
| | `path` | string or null | File tools only: repo-relative target path, forward slashes. `null` for other tools and for paths outside the repo. |
| | `command` | string | Opt-in only (`fields.command`), Bash command text, first 200 characters. Absent by default. |
| `decision` | `rule` | string | The rule that decided: `scope only <prefixes>`, `scope tests`, `scope no-tests`, or `verdict-line`. |
| | `outcome` | string | `allow`, `deny` (a tool call refused) or `block` (a stop refused). For `verdict-line`: `deny` when spec-auditor's SubagentHandback lacked the VERDICT line the first time, `allow` when it was let through without one the second time, `block` when its stop lacked one. |
| | `tool` | string or null | The tool the decision was about; `null` for a stop. |
| | `path` | string or null | Repo-relative path decided on, forward slashes; `null` when none. |
| `gate` | `outcome` | string | `allow` or `block`. |
| | `trigger` | string | `tool` (an agent's tool call), `skill` (Claude calling the speckit-implement skill), `command` (the user typing `/speckit-implement`). |
| | `cause` | string or null | `null` when allowed; else `no-feature`, `no-verdict`, `verdict-fail`, `stale-audit`. |
| | `tool` | string or null | Tool name for `trigger: "tool"`, else `null`. |
| `verdict` | `verdict` | string | `PASS` or `FAIL`. |
| | `fingerprint` | string | 16 hex characters: the audited artifacts' fingerprint the gate compares against. |
| | `via` | string | `handback` (read from the SubagentHandback message by the PreToolUse hook, the interactive path) or `stop` (read from the last message at SubagentStop, the `claude -p` path). One record each time a verdict is recorded. |
| `lane` | `rule` | string | `tests` or `no-tests`. |
| | `result` | string | `clean`, `violations`, or `unchecked` (no start point was recorded for the agent). |
| | `paths` | string[] | Out-of-lane repo-relative paths, at most 20. Empty when clean. |
| | `pathCount` | integer | Total out-of-lane paths (may exceed the 20 listed). |
| | `final` | boolean | `true` when the stop went through (clean, or the second stop with a warning); `false` when the stop was blocked. |
| `phase` | `previous` | string or null | The feature's phase before this record; `null` for the first. |
| `observer-fault` | `cause` | string | One of the causes in "Fault causes" below. |
| | `message` | string | Fixed text per cause, at most 200 characters. Never contains input content. |
| | `mode` | string or null | The hook mode (`gate`, `verdict`, ...) or mod event that saw the fault; `null` when none. |

Activity labels by tool (FR-009):

| `activity` | Tools |
|---|---|
| `reading` | Read, NotebookRead, WebFetch |
| `writing` | Write, Edit, MultiEdit, NotebookEdit |
| `running` | Bash, PowerShell, BashOutput, KillShell |
| `searching` | Grep, Glob, WebSearch, ToolSearch |
| `delegating` | Agent, Task, Skill, SendMessage |
| `other` | everything else, including SubagentHandback and MCP tools |

### Fault causes (one list, used by the writer, `emit` and the view)

| Cause | Raised by | Where it surfaces |
|---|---|---|
| `input-invalid:<mode>` | a guardrail mode given empty or unparsable stdin | `observer-fault` record |
| `input-unknown-event:<mode>` | a guardrail mode given an event it is not wired to | `observer-fault` record |
| `input-invalid:<event>` | the mod given a `classic.SubagentStart` or `turn.complete` without the ids it needs | `observer-fault` record (relayed) |
| `envelope-invalid` | `emit` skipping malformed envelope lines or unknown kinds | `observer-fault` record, and `skipped` in `emit` output |
| `config-invalid` | writer or mod reading a malformed `.specify/activity.json`, or one whose `segmentBytes` exceeds `maxBytes` | `observer-fault` record (the mod's relayed as an envelope) |
| `retention-failed:<code>` | `emit` unable to delete a segment | `observer-fault` record |
| `stream-unwritable:<code>` | the writer unable to create or append to the stream (on Windows `EEXIST` from `mkdir` over a file, `ENOENT` from an append under it, measured) | fault file, `emit` output |
| `activity-module-failed:<code>` | `speckit-team.mjs` unable to import or run `speckit-activity.mjs` | fault file (written by `speckit-team.mjs` itself), `emit` output |
| `emit-failed:<code>` | the mod's `emit` process could not start or exited non-zero | `observer-fault` record, relayed by the next `emit` that succeeds |
| `emit-output-invalid` | `emit` printed something that is not its status JSON | `observer-fault` record, relayed |
| `stream-unreadable:<code>` | the mod unable to list or read the stream (`ENOTDIR` when `activity` is a file) | `observer-fault` record, relayed (lands once the stream is writable again) |
| `render-failed` | the pane's drawing code threw | `observer-fault` record, relayed; fallback line in the pane |
| `relay-overflow` | the mod's relay queue passed 1000 envelopes and dropped the oldest | `observer-fault` record, relayed, with the count in `message` |
| `view-choice-unreadable` | the mod's `$.store` read of the view choice rejected, or held a value other than `plain` or `rich` (not raised when no choice was ever stored) | `observer-fault` record, relayed; the plain board is shown |
| `view-choice-unwritable` | the mod's `$.store` write of a new view choice rejected | `observer-fault` record, relayed; the switch holds for the session |

Every cause is also toasted by the view once per session (contracts/view.md). Whatever the mod
raises itself is toasted at once, without waiting for it to come back through the stream.

### Validation rules

- Every record carries all common fields; `feature` and `phase` are non-null exactly when
  `agent.team` is `true`, except `phase` records, which always have a phase.
- Strings are UTF-8; paths use `/` and never start with a drive letter or `/`.
- A serialized record is at most 4096 bytes. The writer shortens `paths` first, then opt-in strings.
- Forbidden content (FR-008): prompt text, model output (`last_assistant_message`, the
  SubagentHandback `message`), file contents, command output, environment values, credentials,
  absolute paths, and raw hook input. Only the allow-listed fields above are ever written.
- Within major version 1, fields, kinds and enum values may be added, never removed, renamed or
  retyped. Consumers ignore fields, kinds and values they do not know.

## AgentInstance (derived by consumers)

Identified by `agent.id` (with `session` for display).

**Ordering basis**: the record's `ts`, ties broken by position in the stream. File order is not
used for state: the two producers write with different delays (the mod's records are relayed in
batches, the guardrail's are written at once), so a record can land in the file after one with a
later `ts`.

```
              agent-start / any record          agent-stop (final)
  (none) -----------------------------> active -------------------> finished (terminal)
                                         ^  |                          |
                       record with later |  | no record for 120 s      | agent-start with a later ts
                       ts                |  v                          v
                                        stale                       active (a new run)
```

- `active`: not finished, and the latest record by `ts` is at most 120 s old.
- `stale`: not finished, and the latest record by `ts` is more than 120 s old (FR-013).
- `finished`: an `agent-stop` exists for the agent. Finished is terminal: records of the agent
  with a later `ts` (for example a guardrail record written during its stop) are shown among
  decisions but do not reactivate the row. Only an `agent-start` with a later `ts` begins a new
  active run.
- The lane result shown with a finished agent is its latest `lane` record by `ts`.
- Current activity: `activity` and `path` of the latest `tool` record by `ts`.
- The main session (`agent.name == "main"`) is listed separately and is not counted in the
  summary's agent count, so an idle pipeline reads `0 agents` (US1 scenario 1). Its `agent-start`
  comes from `session.start`, or from the first main-loop event after a `/clear` (which ends the
  session with `session.end` and starts no new one); its `agent-stop` from `session.end`.

## FeatureRun (derived)

Key: `feature`. Current phase: `phase` of the latest `phase` record for the feature by `ts`, else
of the latest team record. Last completed phase: the current phase once no team agent of the
feature is active. Latest verdict: the latest `verdict` record for the feature by `ts`.

## Segment and Store

- Store: `<git common dir>/speckit-team/activity/`, one per repository, shared by its worktrees.
- Segment: `<UTC yyyyMMdd'T'HHmmssSSS>Z-<pid>-<4 hex>.jsonl`. Append-only; created with exclusive
  create; deleted whole by retention; never rewritten.
- New segment when the newest is at least `segmentBytes` or was created on an earlier UTC day
  (from its name). Any writer may start one, guardrail modes included.
- Retention runs in `emit` only, when the newest segment changed since its last run or a UTC day
  has passed (state in `<git common dir>/speckit-team/retention.json`): never the newest; age
  (`maxAgeDays`, keeping segments that hold records of the sessions being relayed); then size
  (`maxBytes`, oldest first, hard cap). Guardrail modes never delete.

## Cursor (consumer side)

`{ [segmentName]: byteOffset }`. Offset is the first unconsumed byte; only bytes up to the last
`\n` are consumed. A cursor for a segment that no longer exists is dropped. The README's reference
consumer can persist it to a file (`--cursor <file>`) and resume from it.

## Envelope (mod -> writer, internal)

One JSON object per stdin line of `node <hook> emit` (contracts/emit-cli.md):
`{ v: 1, kind, ts, session_id, cwd, agent_id?, agent_type?, tool?, file_path?, command?, description?, cause?, mode? }`.
`kind` is `agent-start`, `agent-stop`, `tool` or `observer-fault`. For a subagent, `cwd` is the
`cwd` its `classic.SubagentStart` carried (its worktree for an isolated agent), kept by the mod per
`agent_id`; the session's cwd when no start was seen. Unknown kinds and malformed lines are skipped,
counted, and recorded as one `envelope-invalid` fault per batch. The writer derives every record
field from these; nothing else is copied.

## Config (`.specify/activity.json`, optional)

| Key | Type | Default |
|---|---|---|
| `enabled` | boolean | `true` |
| `retention.maxAgeDays` | number > 0 | `7` |
| `retention.maxBytes` | integer >= 65536 | `10485760` |
| `retention.segmentBytes` | integer, 4096 to 1048576, and at most `maxBytes` | `262144`, or `maxBytes` when that is smaller |
| `fields.command` | boolean | `false` |
| `fields.description` | boolean | `false` |

A missing file means all defaults. A malformed file or an invalid value falls back to the default
for that key and raises `config-invalid`.

## Fault file (fallback)

`<os.tmpdir()>/speckit-team-faults/<16 hex of sha256(stream dir)>.json`:
`{ [cause]: { message, count, firstAt, lastAt } }`, at most 50 causes, the one with the oldest
`lastAt` dropped first. Holds the causes that cannot be recorded in the stream
(`stream-unwritable:*`, `activity-module-failed:*`); `emit` reports them. Documented in the README so
outside tools can read it too.

## View state (`$.state`, plugin `speckit-activity`)

| Key | Value |
|---|---|
| `model` | Folded view: agents by id (name, team, session, worktree, state inputs, latest activity, path, lane), recent non-allow decisions (latest 8), allow counters, latest verdict per feature, current and last completed phase, fault causes seen. |
| `now` | Milliseconds, updated by a 1 s tick so ages and stale marks advance. |
| `faults` | Causes already toasted this session. |
| `view` | `'plain'` or `'rich'`: the view the open panel draws. Set from the stored choice after detection (plain when none or unreadable) and by each switch. |
| `richFrame` | The only value the rich view draws from (`RichFrame`, below), written by a publisher at most once per 500 ms and once per second for the live indicator, only while the rich view is open. |

`RichFrame` (exported from `types/index.d.ts`):

| Field | Type | Meaning |
|---|---|---|
| `at` | number | ms; the clock when the frame was built (ages are computed from it). |
| `lastReadAt` | number or null | ms of the last successful poll; `null` before the first. Drives `read <n>s ago` and `feed stalled` (more than 5 s). |
| `tick` | 0 or 1 | Flips each second: the live indicator's glyph. |
| `phase` | `{ current, previous, lastCompleted }` | Record phase values (`specify` ... `verify`) or `null`; the view maps them to track labels. |
| `track` | `{ [phase]: AgentRef[] }` plus `none: AgentRef[]` | Active and stale agents by phase; non-team in `none`. `AgentRef` = `{ id, label }`, `label` being `name#<last 4 of id>`. |
| `cards` | `Card[]` | Per agent in display order: `ref`, `state` (`active`, `stale`, `finished`), `team`, `activity`, `path`, `ageMs`, `history` (20 integers, calls per 15-second interval, oldest first, covering `at - 300 s` to `at`), `total` (sum of `history`), `lane` (for finished agents). |
| `decisions` | `{ id, ts, firstReadAt, outcome, agent, rule, path }[]` | Latest non-allow decisions, newest first; the view marks `NEW` while `at - firstReadAt < 5000`. |
| `verdict` | `{ verdict, feature, ts }` or null | Latest verdict. |
| `faults` | string[] | Fault causes seen this session. |

Activity history is derived by consumers from `tool` records alone (`ts` bucketed into 15-second
intervals ending at the frame's `at`); it is not a record field, so any outside consumer can build
the same history from the stream (FR-029, FR-016).

The stored view choice is not view state: it lives in the plugin's `$.store` (key `view`, value
`{ "view": "plain" | "rich" }`), per user and for all repositories, on the local disk (FR-034).
