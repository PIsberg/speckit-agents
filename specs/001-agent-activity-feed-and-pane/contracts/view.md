# Contract: the in-Claude view (mod `speckit-activity`)

A Claude Code plugin of function hooks (a "mod"), source in `mod/speckit-activity/`, installed
into `<claude dir>/skills/speckit-activity/` (installed-files.md). It is both a producer (relays
agent and tool activity to the writer) and a consumer (draws only what it reads back from the
stream, FR-016). Plugin API: Claude Code 2.1.291, `claude-code` types.

## Activation

- At `session.start` the mod first returns `next(e)`'s result, and only then, from a
  `$.clock.after(0)` timer, runs `git rev-parse --show-toplevel --path-format=absolute --git-common-dir`
  once through `$.process.run` and checks `<top>/.specify` with `$.fs.exists` (audit finding M3).
  No repository's first prompt waits for git (FR-022). Until the detection has answered, the mod
  behaves as inert; tool calls in that window are not recorded.
- The mod is inert when git fails (rejects, non-zero exit, or output that is not two lines), when
  there is no `.specify/`, or when `.specify/activity.json` has `enabled: false`. Inert means: no
  status, no command registered, no timer, no envelope, and its `tool.call` hook only calls
  `next(e)` (FR-012 "nothing in other repositories", FR-022, SC-008). `session.start` always
  returns `next(e)`'s result.
- A `.specify/activity.json` the mod cannot parse means defaults (enabled, both opt-in fields off)
  and the fault `config-invalid` (toasted once, below).

## Producer hooks (none ever answers in place of `next`)

| Hook | Envelope | Partial input |
|---|---|---|
| `tool.call` | `tool`; `cwd` from the agent's `classic.SubagentStart`, else the session cwd | missing or mistyped tool fields: envelope with what is there (`file_path` only when it is a string); never throws. Applies to every tool, `SubagentHandback` included, whose `message` is never read. |
| `classic.SubagentStart` | `agent-start` with the event's `cwd`; the mod keeps `agent_id -> cwd` | no `agent_id`: no agent-start, an `observer-fault` envelope `input-invalid:SubagentStart`; no `cwd`: the session cwd |
| `turn.complete` with `agentId` | `agent-stop` (`final: true`) for that agent; the `agent_id -> cwd` entry is dropped | without `agentId` it is the main loop's turn: nothing |
| `session.start` | main session `agent-start` (queued once detection says Spec Kit) | |
| first main-loop `tool.call` with no open main run | main session `agent-start` first, then the `tool` envelope | covers `/clear`, which ends the session with `session.end` and starts no new one, and a reload |
| `session.end` | main session `agent-stop`, then one flush of the queue, raced against `next.budget`: the hook returns `next(e)` when the flush ends or the budget is nearly spent, whichever is first, and never waits past it | no session id from `$.session.id()`: the id seen at start; a flush that hangs or fails: abandoned at the budget, with no throw (the envelopes are lost and the README says so); inert mod: only `next(e)` |
| `command.run` with matcher `{ command: 'speckit-activity' }` | none; opens the pane | the matcher keeps every other command away from the hook; the test proves another command passes through untouched and opens nothing; arguments, if any, are ignored |

`turn.complete` is used for subagent stops instead of `classic.SubagentStop` because it fires once
the agent's run has really ended, after any Stop hook (lane check, verdict line) has let it go, so
a stop that a guardrail refused never produces an `agent-stop` (research R2; live check V8).

## Public surface

| Item | Value | Contract |
|---|---|---|
| Plugin name | `speckit-activity` | `plugin.json` `name` |
| Slash command | `/speckit-activity` | Opens the panel. Registered with `immediate: true`, so it works while a pipeline turn runs. Answers `{ text: 'Agent activity pane opened.' }`. |
| Pane id | `speckit-activity`, title `Agents` | Opened only by the command, never unasked. |
| Status line | one per plugin via `$.ui.status` | Format below. Set only in Spec Kit repos. |
| `userConfig.latencyLog` | boolean, default `false` | When on, each record the poll reads for the first time logs `speckit-activity lag <ms> <kind> <id>` with `$.ui.log(text, { to: 'debug' })`. `<ms>` = `$.clock.now()` when that poll has parsed the record, minus `Date.parse(record.ts)`: it covers the producer's delay (relay queue and `emit` spawn for mod records), the write, the wait for the poll and the read; it excludes the redraw that follows the `$.state.set` in the same tick. Used by the SC-002 live check only. |

## Summary line (FR-012, always on in Spec Kit repos)

```
speckit: <n> agents[ (<s> stale)] | phase <phase>[ <feature short>] | verdict <PASS|FAIL|none>[ | <d> denied][ | observer: <f> problem(s)]
speckit: idle, 0 agents | last phase <phase|none> | verdict <PASS|FAIL|none>[ | observer: <f> problem(s)]
```

- `<n>` counts active and stale subagents, team and non-team; the main session is not counted.
- `<feature short>` is the feature directory's base name (`001-agent-activity-feed-and-pane`).
- `<d>` is the number of `deny`/`block` outcomes in the last 10 minutes; omitted when 0.
- `<f>` is the number of distinct fault causes seen this session; omitted when 0.
- Words, not colours, carry every state (FR-015).

## Panel (FR-012, FR-014, FR-015)

Sections, top to bottom, drawn with `Box` and `Text` only:

1. **Agents**: one row per agent instance that is active, stale, or finished within the last
   10 minutes, state derived as in data-model.md "AgentInstance" (ordering by `ts`, finished is
   terminal). Row: state word (`run`, `STALE`, `done`), `name#<last 4 of agent.id>`,
   `team`/`other`, activity label and path, feature short name, phase, time since last record
   (`4s`, `2m10s`), worktree when not `.`, and for `done` the lane result (`lane clean`,
   `lane VIOLATIONS (<n>)`, `lane unchecked`). The main session is the last row, named `main`,
   present from session start.
2. **Decisions**: the latest 8 records with outcome `deny` or `block`, lane `violations`, or verdict
   `FAIL`, newest first: time, outcome word in capitals (`DENY`, `BLOCK`), agent, rule, path. Then
   one line counting allowed decisions and gate passes since session start.
3. **Verdict**: latest verdict per feature (`PASS` or `FAIL`, feature, time).
4. **Phase**: current phase, previous phase, last completed phase.
5. **Observer**: one line per fault cause seen this session, when any.

Two agents of the same type are always two rows with different `#xxxx` suffixes (FR-014).

## Narrow and short layouts (spec edge case)

- `bodyColumns < 60`: rows drop feature, worktree and path columns; texts are truncated, never
  wrapped.
- Fewer rows than content: the panel shows the summary counts line, then as many of the newest
  decision lines and agent rows as fit.

## Timing (FR-014, SC-002)

- Poll: every 250 ms, `$.fs.list` on the stream directory; read only segments whose size passed the
  cursor (`$.fs.read(path, { as: 'bytes' })`).
- Relay: queued envelopes are sent at most every 100 ms, one `emit` process in flight; the mod
  polls right after each batch is written.
- Clock tick: 1 s, for ages and the 120 s stale rule (FR-013).

## Failures (FR-018)

Fault causes are the list in data-model.md "Fault causes". Every fault is a record or a fault-file
entry, so an outside tool sees the same set (FR-001, FR-016, audit finding M6). The mod learns of
them from:

1. `observer-fault` records it reads from the stream, the hook side's and its own;
2. the `faults` array in `emit`'s status JSON, which carries the fault file's causes, the two that
   cannot be in the stream (`stream-unwritable:*`, `activity-module-failed:*`);
3. its own faults (`emit-failed:<code>`, `emit-output-invalid`, `stream-unreadable:<code>`,
   `config-invalid`, `render-failed`, `relay-overflow`), which it queues as `observer-fault`
   envelopes so the next `emit` that succeeds records them, and toasts at once.

Each distinct cause is toasted once per session, with exactly this text:

```
speckit-activity: observer problem <cause>. Agents are not affected; see README, Troubleshooting.
```

and counted on the summary line (`observer: <f> problem(s)`) and listed in the panel. A second
occurrence of a cause raises no toast.

Expected causes when `<git common dir>/speckit-team/activity` is replaced by a regular file, on
Windows with Node 26 (measured for Node's `fs`): the writer's `stream-unwritable:EEXIST` (recursive
`mkdir` over a file; `ENOENT` if it gets as far as an append under it) and the reader's
`stream-unreadable:ENOTDIR` (listing a file). So two toasts.

- The `tool.call` hook never awaits a `$` call before `next(e)` and never answers in place of
  `next`, so a failure in the mod cannot deny, delay or change a tool call (FR-017). A throw there
  is skipped by the engine and the tool runs. This holds for `SubagentHandback` like any tool.
- Drawing code is wrapped in `try`/`catch`; on error the pane shows one line naming the problem.

## State contract (`mod/speckit-activity/types/index.d.ts`)

```ts
declare module 'claude-code' {
  interface PluginState {
    'speckit-activity': { model: ActivityModel; now: number; faults: string[] }
  }
}
```

`ActivityModel` is exported from the same file and documented there.
