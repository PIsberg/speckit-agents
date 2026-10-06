# Contract: the in-Claude view (mod `speckit-activity`)

A Claude Code plugin of function hooks (a "mod"), source in `mod/speckit-activity/`, installed
into `<claude dir>/skills/speckit-activity/` (installed-files.md). It is both a producer (relays
agent and tool activity to the writer) and a consumer (draws only what it reads back from the
stream, FR-016). Plugin API: Claude Code 2.1.291, `claude-code` types.

## Activation

- At `session.start` the mod runs `git rev-parse --show-toplevel --path-format=absolute --git-common-dir`
  once through `$.process.run`, and checks `<top>/.specify` with `$.fs.exists`.
- No Spec Kit, or `.specify/activity.json` has `enabled: false`: the mod is inert. It sets no
  status, registers no command, starts no timer, and its `tool.call` hook only calls `next(e)`
  (FR-012 "nothing in other repositories", FR-022, SC-008).

## Public surface

| Item | Value | Contract |
|---|---|---|
| Plugin name | `speckit-activity` | `plugin.json` `name` |
| Slash command | `/speckit-activity` | Opens the panel. Registered with `immediate: true`, so it works while a pipeline turn runs. Answers `{ text: 'Agent activity pane opened.' }`. |
| Pane id | `speckit-activity`, title `Agents` | Opened only by the command, never unasked. |
| Status line | one per plugin via `$.ui.status` | Format below. Set only in Spec Kit repos. |
| `userConfig.latencyLog` | boolean, default `false` | When on, each newly read record logs `speckit-activity lag <ms> <kind>` to the debug log (`$.ui.log(..., { to: 'debug' })`). Used by the SC-002 live check only. |

## Summary line (FR-012, always on in Spec Kit repos)

```
speckit: <n> agents[ (<s> stale)] | phase <phase>[ <feature short>] | verdict <PASS|FAIL|none>[ | <d> denied][ | observer: <f> problem(s)]
speckit: idle, 0 agents | last phase <phase|none> | verdict <PASS|FAIL|none>
```

- `<n>` counts active and stale subagents, team and non-team; the main session is not counted.
- `<feature short>` is the feature directory's base name (`001-agent-activity-feed-and-pane`).
- `<d>` is the number of `deny`/`block` outcomes in the last 10 minutes; omitted when 0.
- Words, not colours, carry every state (FR-015).

## Panel (FR-012, FR-014, FR-015)

Sections, top to bottom, drawn with `Box` and `Text` only:

1. **Agents**: one row per agent instance that is active, stale, or finished within the last
   10 minutes. Row: state word (`run`, `STALE`, `done`), `name#<last 4 of agent.id>`,
   `team`/`other`, activity label and path, feature short name, phase, time since last record
   (`4s`, `2m10s`), worktree when not `.`, and for `done` the lane result (`lane clean`,
   `lane VIOLATIONS (<n>)`, `lane unchecked`). The main session is the last row, named `main`.
2. **Decisions**: the latest 8 records with outcome `deny` or `block`, lane `violations`, or verdict
   `FAIL`, newest first: time, outcome word in capitals (`DENY`, `BLOCK`), agent, rule, path. Then
   one line counting allowed decisions and gate passes since session start.
3. **Verdict**: latest verdict per feature (`PASS` or `FAIL`, feature, time).
4. **Phase**: current phase, previous phase, last completed phase.

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

- A fault cause (from `emit` output, or the mod's own: `emit-failed:<code>`, `emit-output-invalid`,
  `stream-unreadable:<code>`, `render-failed`) is toasted once per session and counted on the
  summary line.
- The `tool.call` hook never awaits a `$` call before `next(e)` and never answers in place of
  `next`, so a failure in the mod cannot deny, delay or change a tool call (FR-017). A throw there
  is skipped by the engine and the tool runs.
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
