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
| `command.run` with matcher `{ command: 'speckit-activity' }` | none; opens the pane in the view `args` names (Public surface) | the matcher keeps every other command away from the hook; the test proves another command passes through untouched and opens nothing; `args` missing, empty or not a string means "the stored view" |
| `ui.press` with a matcher on this plugin's elements `switch-view` and `rich-page` | none; toggles the view or turns the rich view's page | a press for any other element, another plugin's element, or with `element` or `plugin` missing is passed on with `next(e)` untouched and changes nothing (third audit H5) |

`turn.complete` is used for subagent stops instead of `classic.SubagentStop` because it fires once
the agent's run has really ended, after any Stop hook (lane check, verdict line) has let it go, so
a stop that a guardrail refused never produces an `agent-stop` (research R2; live check V8).

## Public surface

| Item | Value | Contract |
|---|---|---|
| Plugin name | `speckit-activity` | `plugin.json` `name` |
| Slash command | `/speckit-activity [plain\|rich\|cool]` | Opens the panel, in the stored view, or in the named view after storing it (`cool` is a synonym of `rich`). Registered with `immediate: true` and `argumentHint: '[plain|rich]'`, so it works while a pipeline turn runs. The only answer texts (third audit M2): `Agent activity pane opened (plain view).` or `Agent activity pane opened (rich view).`, naming the view now shown; for a word other than `plain`, `rich` or `cool`, the current view opens and the answer is `Unknown view "<word>": use plain or rich.` |
| Switch key | Button key `switch-view`, `hotkey: 'v'`, in both views | Toggles the view once the user has given the pane the keyboard (ctrl+x tab or a click); the pane never takes the keyboard itself (owner decision 2026-10-06). A click on the Button works too; Enter on it when it holds the focus is unverified until research V12. |
| Page key | Button key `rich-page`, `hotkey: 'n'`, in the rich view when a section is capped | Turns the page of every capped section (Rich view, "Paging"); same focus rule as `v`. |
| Stored choice | `$.store` key `view`, value `{ "view": "plain" }` or `{ "view": "rich" }` | Per user, all repositories, local (FR-034); read and written only in Spec Kit repositories. |
| Pane id | `speckit-activity`, title `Agents` | Opened only by the command, never unasked. |
| Status line | one per plugin via `$.ui.status` | Format below. Set only in Spec Kit repos. |
| `userConfig.latencyLog` | boolean, default `false` | When on, each record the poll reads for the first time logs `speckit-activity lag <ms> <kind> <id>` with `$.ui.log(text, { to: 'debug' })`. `<ms>` = `$.clock.now()` when that poll has parsed the record, minus `Date.parse(record.ts)`: it covers the producer's delay (relay queue and `emit` spawn for mod records), the write, the wait for the poll and the read; it excludes the redraw that follows the `$.state.set` in the same tick. Also, every time the rich view's render runs (each draw, not each new frame), one line `speckit-activity render rich <clock ms>`, so draws can be bucketed per second (third audit H3). Used by the SC-002 and SC-014 live checks only (quickstart L9, L15). |
| Stored choice when uninstalled | stays | Claude Code writes the `$.store` file, not the installer, so uninstall leaves it (third audit K1, contracts/installed-files.md). |

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

## Rich view and switching (User Story 6, FR-024 to FR-035)

### Which view is drawn

1. The plain board is the default: no stored choice means plain, with no fault (FR-024, SC-010;
   owner decision 2026-10-06).
2. A stored choice is read from `$.store` once per load, after Spec Kit detection. A read that
   rejects, or a value other than `plain` or `rich`, means plain and one `observer-fault`
   `view-choice-unreadable` (FR-034, as settled by the owner).
3. A switch (command argument, or the `switch-view` Button by `v` or a click) sets the `view`
   state at once, which redraws the panel within the next frame (at most 500 ms, so well within
   SC-011's 1 s), and then writes `$.store` without the drawing waiting for it. A write that
   rejects keeps the switch for this session and raises `view-choice-unwritable`.
4. Size rules, checked on every draw, in this order:
   - `e.viewport.columns` below 80 (the spec's terminal width): the plain board, first line
     `Rich view needs 80 columns (now <n>); showing the plain board.`
   - `e.props.bodyColumns` below 76 (the room the layout needs; a narrow docked pane in a wide
     terminal, third audit M6): the plain board, first line
     `Rich view needs 76 columns in the pane (now <n>); showing the plain board.`
     When the surface gives no viewport, only this rule applies (research V16, third audit L6).
   - `scroll.bodyRows` below 10: the plain board, first line
     `Rich view needs 10 rows (now <n>); showing the plain board.`
   - `scroll.bodyRows` from 10 to 19: the reduced form (below), `reduced` in its header.
   - Otherwise the full rich layout, never more than 20 rows.
5. The summary line (`$.ui.status`) is produced by the same function in both views and does not
   depend on the choice (FR-032).
6. Nothing is drawn, read or stored in a repository without Spec Kit: the command is not
   registered there, and `$.store` is never called (FR-035).

### Switch line (FR-033), in both views, the last row

```
View: <plain|rich>. Switch: /speckit-activity <other>, or ctrl+x tab then v.   [ v: <other> view ]
```

`[ v: <other> view ]` is the `switch-view` Button. If research V12 found that the hotkey does not
press while the pane holds the keyboard, the text reads `or ctrl+x tab, then Enter on the button`.

### State words (one mapping, third audit L3)

The spec's states map to one word each, used by the plain board, the rich view and the summary:
active -> `run`, stale -> `STALE`, finished -> `done` (data-model.md "AgentInstance").

### Full rich layout (at most 20 rows; needs 76 body columns; truncated beyond)

| Rows | Content |
|---|---|
| 1 | Header: `AGENTS (rich)`, `LIVE` with a glyph that alternates `*` and `+` once per second and `read <n>s ago` (time since the last successful poll), or `LIVE?` and `feed stalled` when no poll has succeeded for 5 s (FR-028); `phase <current> (previous <p>, last completed <c>)`; `page <p>/<n>` when any section is capped. |
| 2 to 4 | Pipeline track (FR-025): row 2 `spec > plan > audit > red > green > gate`, then `no phase` after a separator, the current phase in capitals and marked `<-now`; row 3 under each phase its active and stale team agents, `name#xxxx`, a stale one followed by ` STALE`, at most 2 then `+<n>`; row 4 under `no phase` the active and stale non-team subagents the same way. Finished agents and the main session are not on the track (third audit L5); they are cards. Phase labels map from record values: `specify` -> `spec`, `verify` -> `gate`, the rest unchanged. |
| 5 to 12 | Agent cards (FR-026), one per 2 rows, 4 per page: row A `<state word> name#xxxx team\|other <activity> <path> <age>`; row B the 20-cell history (oldest left, one cell per 15 s, glyph height by calls in that interval relative to the agent's busiest interval, `.` for none), `<n> calls/5m`, feature short name, `wt <worktree>` when not `.`, and `lane clean`, `lane VIOLATIONS (<n>)` or `lane unchecked` for a finished agent. Order: active, stale, then finished within the last 10 minutes, newest first, the main session last. |
| 13 | `+<n> more agents (n: next page, page <p>/<k>)` when agents do not fit, else blank. |
| 14 to 17 | Decisions (FR-027): 4 non-allow records per page, newest first, as in the plain board; a record first read less than 5 s ago starts with `NEW ` and is drawn `inverse`; after 5 s the same line stays without `NEW `. |
| 18 | `+<n> more decisions` when they do not fit, then `allowed <a>, gate passes <g>` (the plain board's counters). |
| 19 | Left half: `verdicts: <feature short> <PASS\|FAIL> <time>, ...` one per feature, then `+<n> more` when they do not fit. Right half: `observer: <cause>, <cause>, ...` every fault cause seen this session, then `+<n> more` when they do not fit; `observer: none` when there are none. |
| 20 | The switch line, with the `rich-page` Button `[ n: next page ]` before the `switch-view` Button when any section is capped. |

### Paging (every plain-board item reachable, third audit H1)

The capped sections are the agent cards (4 per page), the decisions (4 per page), the verdicts
(as many as fit the left half of row 19) and the fault causes (as many as fit the right half).
Each ends in a counted `+<n> more` when it overflows. One page number, `richPage`, applies to all
of them: section `s` with `k_s` pages shows its page `richPage mod k_s`. Pressing the `rich-page`
Button (`n` once the pane has the keyboard, or a click) increments `richPage`; the header shows
`page <p>/<k>` with `k` the largest `k_s`. So within `k` presses every agent, decision, verdict and
fault cause the plain board shows has been on screen. The page resets to 1 when the view is
switched.

**Reduced form** (10 to 19 rows): header, track rows 2 to 4, agents one row each (row A only, no
history) as many as fit with `+<n> more`, 2 decisions with `+<n> more` and the counters, the
verdict and observer row, the switch line; `reduced` in the header; paging as above.

**Parity with the plain board** (FR-029, SC-012): every agent, decision line, verdict, phase and
fault cause the plain board shows at the same size is on some page of the rich view, and the
allow and gate-pass counters are on every page; colour (`color`, `backgroundColor`, `inverse`)
adds to words and glyphs and never replaces them (FR-030).

**Glyphs**: `▁▂▃▄▅▆▇█` for history heights 1 to 8, `.` for an empty interval. If research V14 finds
them not single-width on a supported terminal, the ASCII set `_-~=+*#@` (heights 1 to 8) with `.`
for an empty interval is used everywhere instead. In both sets per-interval counts are relative
heights; the only number is the 5-minute total. What the fallback changes for the user: coarser
bars.

**Borders**: none. `Box` `borderStyle` exists, but each bordered box costs 2 of the 20 rows;
sections are separated by their rows' labels instead.

### Timing (FR-028, SC-014)

The rich view's render reads only the `richFrame` and `view` state values, so every rich draw
follows a `richFrame` write or a change the engine makes itself (a resize). A publisher writes
`richFrame` at most once per 500 ms, leading edge: a change after a quiet period is written at
once, later changes wait for the 500 ms mark. The 1 s live tick is one of those writes, not an
additional one (third audit L2). So, without resizes, the rich view draws at most twice and at
least once per second while it is open; T055 counts draws per 1-second window and quickstart L15
buckets render log lines per second. The publisher runs only while the rich view is open.
Worst-case delay from a record's write to the rich view is one poll (250 ms) plus one frame
(500 ms), inside FR-014's 1 s for guardrail records; relayed records add the relay (100 ms plus the
`emit` spawn), still inside 1 s at the measured p90 (R1); T055 asserts the 1 s in mocked time and
quickstart L9 is run with the rich view open as well (third audit M5).

The first poll after load folds up to 10 MB of history; it runs in slices of 500 records with a
`$.clock.after(0)` yield between slices, so a `tool.call` dispatch never waits behind it on the
mod's event loop, and building `richFrame` touches only the items it shows plus per-section
counts (third audit M9; measured in T037).

## State contract (`mod/speckit-activity/types/index.d.ts`)

```ts
declare module 'claude-code' {
  interface PluginState {
    'speckit-activity': {
      model: ActivityModel
      now: number
      faults: string[]
      view: 'plain' | 'rich'
      richPage: number
      richFrame: RichFrame
    }
  }
}
```

`ActivityModel` and `RichFrame` are exported from the same file and documented there
(data-model.md "View state").
