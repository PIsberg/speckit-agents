# Research: Agent Activity Feed and Live Pane

**Feature**: `001-agent-activity-feed-and-pane` | **Date**: 2026-10-06 | **Plan**: [plan.md](plan.md)

Every decision below names what was chosen, why, and the alternative rejected. Facts are marked
**measured** (run on this machine), **read** (from the Claude Code 2.1.291 plugin API declarations
or reference), or **given** (verified earlier in this session by the owner and passed in). Items
that only a live session can settle are collected in "Live verification log" at the end; T001 in
`tasks.md` fills it in before anything is built on them.

## R1. What a hook costs on this machine (measured)

Windows 11, Node v26.8.2, git 2.55.0.windows.5, 100 runs each, `process.hrtime` around `spawnSync`.
Script kept outside the repo; `bench/overhead.mjs` (T040) reproduces the hook rows.

| Case | Median ms | p90 ms | Min ms |
|---|---|---|---|
| `node -e ""` (bare Node spawn) | 42.3 | 49.9 | 35.1 |
| `git rev-parse --show-toplevel` | 13.6 | 22.9 | 10.5 |
| `node speckit-team.mjs gate`, repo without `.specify/` (early exit) | 66.2 | 120.2 | 55.1 |
| `node speckit-team.mjs gate`, Spec Kit repo (full path, deny) | 109.5 | 178.3 | 75.1 |
| `bash -c 'node ... gate'`, repo without `.specify/` (how Claude Code runs it on Windows) | 173.4 | 237.5 | 103.1 |
| `fs.appendFileSync` of one 300-byte record, in-process | 0.5 | 0.6 | 0.2 |

Consequence: a command hook on every tool call costs about 173 ms per call through Git Bash, in
every repository, including ones without Spec Kit. Writing a record from a process that is
already running costs 0.5 ms. Every producer decision below follows from these two numbers.

## R2. Where records are produced

**Decision**: two producers, split by who already holds the fact, one writer implementation.

- **Guardrail facts** (`decision`, `gate`, `verdict`, `lane`) are written by `hooks/speckit-team.mjs`
  in the process that makes the decision, at the moment it decides, before it prints the decision.
  These processes already run; the added cost is the append (0.5 ms, R1). Verdicts are recorded on
  both paths of commit b9b0dc3 (R16): spec-auditor's PreToolUse `SubagentHandback` hook and its Stop.
- **Activity facts** (`agent-start`, `agent-stop`, `tool`) come from the mod's in-process function
  hooks: `tool.call` (carries `agentId` inside a subagent, read), `classic.SubagentStart` (carries
  `agent_id`, `agent_type`, `cwd`, read), `turn.complete` carrying a subagent's `agentId` for its
  stop, and `session.start` and `session.end` for the main session. The hook on the tool path only
  pushes an envelope onto an in-memory queue and calls `next(e)`; it makes no `$` call first.
- **The main session's start and stop** (audit finding C2): `agent-start` at `session.start`;
  `agent-stop` at `session.end`, flushed within that event's short shared budget (`next.budget`);
  `session.end` with `reason: 'clear'` is followed by no `session.start` (read), so the relay also
  queues a main `agent-start` before the first main-loop event it sees with no open main run (after
  a `/clear`, or after a reload). `session.end` is new wiring, so it gets a live question (V10) and a
  live check (quickstart L12).
- **Why `turn.complete` and not `classic.SubagentStop` for the stop** (audit finding M3):
  SubagentStop fires on every attempt to stop, including one that the lane check or the verdict
  line then refuses, after which the agent keeps working. `turn.complete` fires when the subagent's
  turn has ended (read: "a subagent's own `turn.complete`, carrying `agentId`"), so each run gets
  exactly one `agent-stop`, and consumers can treat it as terminal. Live check V8.
- **Observer faults** (`observer-fault`) are written by whichever side sees the fault: the hook for
  malformed or unknown input (R14) and its own writer errors, the mod (relayed) for partial event
  input. Faults that cannot be written to the stream go to the fault file (R10).
- **Phase facts** (`phase`) are derived by the writer when a team agent starts in a phase different
  from the feature's last recorded phase (R6).
- **One writer**: the mod hands its queue to `node <hook> emit` through `$.process.run` with the
  envelopes on stdin, batched (one batch at most every 100 ms, one process in flight per session),
  from a `$.clock.every` timer started at `session.start`, never from the tool path. Every byte in
  the stream is therefore written by the same Node code (`hooks/speckit-activity.mjs`), which also
  holds the one privacy filter (R11), so `npm test` covers all of it.

**Alternatives rejected**:

| Alternative | Why not |
|---|---|
| Command hooks for everything (`PreToolUse` and `PostToolUse` matcher `.*` in `settings.json`, plus `SubagentStart`/`SubagentStop`) | 173 ms median per tool call through Git Bash (R1), in every repo on the machine. Breaks FR-022 and SC-008 (cost outside Spec Kit repos) and any reasonable SC-005 budget. |
| Command hooks only on the six team agents' frontmatter | No records for non-team agents or the main session (US3, FR-004). |
| The mod produces everything, including decisions | The mod does not make guardrail decisions. It could only infer them from the folded result of `classic.PreToolUse` (read), which is unverified for agent-frontmatter hooks, and decision records would disappear whenever the mod is not loaded. |
| The mod writes the stream itself with `$.fs.write` | `$.fs` has `read`, `write` (whole file), `list`, `exists`, `stat` and no append (read). A whole-file rewrite races with the hook's appends and with readers holding byte cursors, costs O(n^2) per segment, and is capped at 4 MiB per call. |
| The mod spawns `node <hook> emit` per tool call | Same 66 to 110 ms spawn per call (R1); batching from a timer keeps it off the tool path and coalesces bursts. |

## R3. Stream location and format

**Decision**: append-only JSON Lines segments in
`<git common dir>/speckit-team/activity/`, where `<git common dir>` is
`git rev-parse --path-format=absolute --git-common-dir`.

- Same state directory the guardrails already use, so it is inside `.git` (never committed),
  shared by every worktree of the repo (US4), and local to the machine (FR-010).
- Segment file name: `<UTC yyyyMMdd'T'HHmmssSSS>Z-<pid>-<4 hex>.jsonl`, created with exclusive
  create (`wx`). Lexicographic order is creation order.
- One record per line, UTF-8, `\n` terminated, at most 4096 bytes per line (the writer shortens
  long strings and lists to fit). A batch is written with a single `appendFileSync` call, which
  opens with `O_APPEND` (POSIX) or `FILE_APPEND_DATA` (Windows), so concurrent writers never
  overwrite each other.
- A writer appends to the lexicographically greatest segment, and creates a new one when that
  segment has reached `segmentBytes` (default 262144) or was created on an earlier UTC day.
- Segments are never rewritten or truncated. They are only created, appended to, and deleted
  whole by retention (R5).

**Alternatives rejected**: a single file trimmed in place (invalidates every consumer's byte
offset and races with concurrent appends); one file per session (a session larger than the cap
still needs in-file trimming, and consumers must watch an unbounded set of files); SQLite (a
runtime dependency, constitution IV); a named pipe or local socket (no history for late
consumers, a server process to keep alive, different semantics on Windows); HTTP (network,
constitution VI).

## R4. Reading history, then following live, with no gaps or duplicates (FR-007)

**Decision**: the cursor is `(segment name, byte offset of the first unconsumed byte)`.

1. List `*.jsonl` in the directory, sort by name.
2. For each segment, read from its cursor (0 for a segment not seen before) to the last `\n`.
   Bytes after the last `\n` are a record still being written: leave them for the next read.
3. Advance the cursor by the bytes consumed. Forget cursors of segments that no longer exist.
4. Repeat on a timer (the view polls every 250 ms). `fs.watch` may be used as a wake-up hint
   only; it is not reliable across the three platforms and the mod has no equivalent.

Because segments are append-only and never rewritten, every byte is read exactly once: no gaps, no
duplicates. A consumer that loses its cursor can deduplicate on each record's `id`. Order is
guaranteed per producer process (each writes its batches in order to non-decreasing segment
names); records from different producers interleave in arrival order and carry `ts` for anyone
who needs a total order. A lagging consumer can lose records only to retention, which it can
detect: its cursor's segment disappeared while unread bytes remained.

The mod follows the same procedure through `$.fs.list` (size per entry, read) and
`$.fs.read(path, { as: 'bytes' })` (read), slicing at its byte cursor, which keeps it on the same
documented interface as any outside consumer (FR-016).

## R5. Retention enforcement (FR-011)

**Decision**: retention runs only in `emit`, the mod's relay process, which is off every tool
path (audit finding M2: reading up to 10 MB and deleting files inside a guardrail, before its
decision is printed, would put that cost on a tool call, and Claude Code waits for a command hook
to exit, so running it after printing would not help). Guardrail modes may still start a new
segment when the newest is full (creating one empty file, measured as part of the rotation row in
`bench/overhead.mjs`), but never delete anything.

`emit` runs retention when the newest segment's name differs from the one it saw at its last run,
or when its last run was on an earlier UTC day (state in `<git common dir>/speckit-team/retention.json`).
So it runs at most once per segment written and at least once per UTC day while the mod relays.

1. Never delete the newest segment.
2. **Age**: delete a segment whose modification time is older than `maxAgeDays` (default 7),
   unless it contains a record of a session in the batch being relayed (substring check for
   `"session":"<id>"`). This keeps the current session's records plus the previous 7 days.
3. **Size**: while the directory holds more than `maxBytes` (default 10485760), delete the oldest
   segment by name. The size cap is hard: it wins over the current-session rule.
4. Any error is recorded as an `observer-fault` (`retention-failed:<code>`) and the relay goes on.

Both limits, and `segmentBytes`, are configurable in `.specify/activity.json` (contracts/config.md);
`segmentBytes` must not exceed `maxBytes` (audit finding L4).

**Alternatives rejected**: the mod enforces retention itself (`$.fs` has no delete, read);
retention inside the guardrail at rotation (cost on a tool call, M2); trimming on every write (cost
on every guardrail call); a scheduled job (nothing to schedule it with, cross-platform).

**Known limit**: without the mod loaded (Claude Code older than 2.1.291, or the mod disabled),
guardrail records are still written and nothing enforces the cap, so the stream grows by about
300 to 400 bytes per guardrail decision. Listed in the README's known limits and tracked as a
follow-up issue (T069).

**Known edge**: a second session in the same repo that has run for more than 7 days can lose its
oldest records to another session's age check. Listed in the README's known limits.

## R6. Phase-change records

**Decision**: the writer emits a `phase` record when it writes an `agent-start` for a team agent
whose phase differs from the last phase recorded for that feature (state in
`speckit-team/phase.json`). Agent to phase: product-owner `specify`, architect `plan`,
spec-auditor `audit`, test-writer `red`, implementer `green`, spec-gatekeeper `verify`.
`skills/speckit-team/SKILL.md` is not changed: the main session moves the pipeline by launching
the next team agent, and that launch is the phase change (US3 scenario 2).

Within one session the mod sends batches one at a time, so parallel implementers starting
together produce one phase record. Two sessions racing on the same feature can produce the same
phase twice; the contract says a `phase` record repeating the current phase means no change.

**Alternatives rejected**: SKILL.md runs `node "<hook>" phase <name>` through Bash at each step
(depends on the model complying, costs a Bash permission prompt and a tool call per phase, and
misses phases started with `@agent-...` outside `/speckit-team`); the mod infers phases from what
it has read back (it lags its own writes, so parallel starts would duplicate).

## R7. The in-Claude view

**Decision**:

- **Summary**: `$.ui.status(text)`, one line pinned under the prompt, one per plugin (read). Set
  in Spec Kit repos only, updated when its text changes. Plain text, so state never depends on
  colour (FR-015).
- **Panel**: `$.ui.open({ id: 'speckit-activity', title: 'Agents' })`, drawn by a `ui.render`
  hook on `{ component: 'Pane', requestId: 'speckit-activity' }`, opened only by the slash command
  `/speckit-activity`, registered with `immediate: true` so it opens while a pipeline turn is
  running (read). A pane opened by a user action seats at any width (given); the view never opens
  it unasked.
- Elements: `Box` and `Text` only, which every surface's table has (read). Layout sized to
  `e.props.bodyColumns` and `scroll.bodyRows`.
- State the drawing reads lives in `$.state` under plugin `speckit-activity` (survives hot
  reload, redraws readers on `set`, read). A 1 s tick updates the clock value so ages and the
  120 s stale mark (FR-013) advance with no new records.

**Alternatives rejected**: the `AbovePrompt` band for the summary (terminal and desktop only, yields
to surveys, takes rows above the prompt; read); opening the pane at session start (FR-012 says on
demand, and an unasked pane seats only from 144 columns, given); `$.ui.toast` for decisions
(transient, so a denial would not "stay visible", US1 scenario 3).

## R8. Installing and uninstalling the mod (FR-021)

**Decision**: the installer renders the mod from `mod/speckit-activity/` into
`<claude dir>/skills/speckit-activity/`, replacing `{{HOOK}}` with the installed hook's absolute
forward-slash path, exactly as it does for agents and the skill today. reference.md says a
plugin folder under `~/.claude/skills/<name>` is auto-loaded and watched. Ownership: the folder
is the installer's when `hooks/register.tsx` carries the `speckit-agents: managed by install.mjs`
marker (JSON files cannot carry a comment, and the existing skill folder is already removed as a
unit). `--uninstall` removes the folder. `settings.json` is not touched by this feature: the mod
needs no settings entry, and the decision records come from hooks that are already wired.

**Alternatives rejected**:

| Alternative | Why not |
|---|---|
| `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `settings.json` | Works (read), but edits a user path-list variable the user may already set, with a platform-specific separator. Kept as the fallback if T001 shows the skills folder does not load a function-hooks plugin. |
| `claude plugin marketplace add` + `claude plugin install` from the installer | Needs `claude` on PATH at install time, writes Claude Code's own plugin registry, and reads the plugin from the source clone, where `{{HOOK}}` cannot be rendered. |
| `/plugin install ... --marketplace` | Interactive only; not something `install.mjs` can run. |

## R9. Overhead budget (FR-017, SC-005, FR-022)

**Decision**: observation adds at most **10 ms median per tool call on Windows**.

What it covers, and the expected cost of each part:

| Part | Where it runs | Expected |
|---|---|---|
| Mod `tool.call` hook: build an envelope, push it, call `next` | in-process, every tool call of every agent and the main session | well under 1 ms; no `$` call before `next` |
| Record append in a guardrail hook | in the hook process that already runs (test-writer, implementer on every call; others on Write/Edit) | about 0.5 ms (R1) plus `feature.json` read |
| `node <hook> emit` batch | off the tool path, timer-driven, at most one in flight | 66 to 110 ms per batch (R1), not on any call |

How it is measured:

1. **Hook side**: `bench/overhead.mjs` puts two hooks in temp directories: the treatment, today's
   `hooks/speckit-team.mjs` with `speckit-activity.mjs` beside it, and the baseline, the
   `hooks/speckit-team.mjs` of the base commit (`git show <base>:hooks/speckit-team.mjs`, `--base`
   defaulting to `b9b0dc3`, the commit this feature is stacked on; printed in the output). The
   baseline therefore has no activity module, no import attempt and no record code at all (audit
   findings H4 and M1: `enabled: false` still loads the module, and a module-absent copy of the new
   hook still pays a failed import). It runs a `gate` on `PreToolUse Read` in a Spec Kit repo
   100 times in alternating pairs, to cancel drift, and reports the median and p90 of the paired
   differences. Pairing is needed because the spawn itself varies by 75 to 178 ms (R1).
   A second row does the same while forcing a segment rotation on every treatment run (the newest
   segment pre-filled to `segmentBytes`), so the cost of starting a segment from a guardrail is
   measured too (audit finding M2); retention never runs in a guardrail (R5). Both rows are held to
   the hook-side share of the budget.
2. **Mod side**: `mod/speckit-activity/test/overhead.test.ts` drives 100 `$.tool.call`s through the
   mod and times call-to-beneath per call with `performance.now()` when the plugin test
   environment has it as wall time (sub-millisecond, live check V7), and prints the median and p90.
   `Date.now()` has 1 ms resolution, too coarse for work expected well under 1 ms; if only
   `Date.now()` is wall time, the test times the 100 calls together and prints the mean per call
   as a bound, labelled as a mean. If neither is wall time, the timing is "not run". It always
   asserts the structural guarantee: the beneath hook is reached before the mod makes any `$.fs`
   or `$.process` call.
3. SC-005 passes when hook-side median plus mod-side median (or mean bound) is at most 10 ms.
   Results go in the README with date and versions. macOS and Linux: "not run" (spec, SC-005).

**Repositories without Spec Kit** (FR-022, SC-008): the guardrail modes keep their early exit,
and `hooks/speckit-activity.mjs` is imported only after the `.specify/` check, so the code path
outside Spec Kit is unchanged; the bench reports that case too and expects a paired median within
2 ms (the measurement's noise floor at these spawn times). The mod runs one `git rev-parse` per
session (13.6 ms, R1), but not on the session's start path (audit finding M3): its `session.start`
hook returns `next(e)` first and runs the detection from a `$.clock.after(0)` timer, so the first
prompt never waits for git; until the detection answers, and for good outside Spec Kit, its
`tool.call` hook is a boolean check. It sets no status, registers no command, writes nothing.

Why 10 ms: it is about 6% of one Git Bash hook spawn (173 ms, R1), large enough to be measured
reliably with paired runs, and 20 times the expected cost, so a regression to a per-call spawn
(66 ms or more) fails it clearly.

## R10. Making observer failures visible (FR-018, constitution III)

**Decision**:

- The writer never changes a hook's stdout or exit code, and catches every error.
- **Faults go into the stream first**, as `observer-fault` records (FR-001 kind added by the
  product owner after audit finding H1): malformed or unknown hook input, invalid envelopes, an
  invalid config, a failed retention delete. Any consumer sees them, and the view reads them like
  every other record (FR-016, audit finding M5).
- **The mod's own faults are records too** (audit finding M6): `emit-failed:<code>`,
  `emit-output-invalid`, `stream-unreadable:<code>`, `config-invalid` (mod side) and
  `render-failed` are queued as `observer-fault` envelopes and written by the next `emit` that
  succeeds. The relay queue is bounded (1000 envelopes; past that the oldest are dropped and one
  `relay-overflow` fault records how many), so an `emit` that keeps failing cannot grow memory.
- **Only what cannot be in the stream goes to the fault file**:
  `<os.tmpdir()>/speckit-team-faults/<16 hex of sha256(stream dir)>.json`, a location that does not
  depend on the stream directory being writable, holding `stream-unwritable:<code>` and
  `activity-module-failed:<code>` (cause code, message, count, first and last time; at most 50
  causes, the least recently seen dropped first). `activity-module-failed` is written by
  `speckit-team.mjs` itself with a few lines of its own, since the module that normally writes
  faults is the one that failed. `node <hook> emit` reports the file's causes in its status JSON.
  The file's location and format are documented in the README, so outside tools can read it.
- The mod shows each distinct cause once per session with one fixed toast text (contracts/view.md)
  and adds `observer: <n> problem(s)` to the summary line. A fault it raised itself is toasted at
  once, not only after it comes back through the stream. Drawing is wrapped in `try`/`catch` and
  falls back to a one-line text.
- Fault records carry a fixed message per cause and never any input content, so a malformed input
  holding prompt text cannot leak into the stream through its fault.

**Alternatives rejected**: `systemMessage` in the hook's output (changes the hook output that
SC-004 compares, and repeats in every agent's transcript); stderr only (not shown without
`--debug`); the fault file for every fault (outside tools would need a second interface, and the
view would read something outside the stream, M5); the stream for every fault (it may be the thing
that is broken).

**Known edge**: if both the stream directory and the temp directory are unwritable, the failure is
silent. Listed in the README's known limits.

## R11. Privacy (FR-008, FR-009, SC-006)

**Decision**: metadata only, one filter, opt-in per field.

- The writer builds every record from an allow-list of fields (data-model.md). It never copies
  hook input objects. `tool_input` contributes the tool name and, for file tools (Read, Write,
  Edit, MultiEdit, NotebookEdit), the target path made repo-relative with forward slashes; a path
  outside the repo is `null`.
- `last_assistant_message`, the SubagentHandback `message` (read by the verdict hook only to find
  the VERDICT line), prompts, tool output, file contents and environment values are never read
  into a record. `worktree` is relative to the main worktree, so no home directory (and no
  user name) appears.
- Opt-in fields in `.specify/activity.json` `fields`: `command` (Bash command text, first 200
  characters) and `description` (a subagent's task description, first 200 characters). Both off by
  default. The mod reads the same file at session start and sends those values only when on; the
  writer drops them again when off.
- Raw absolute paths cross from the mod to the writer only over the local `emit` process's stdin
  and are never stored.

## R12. Install then uninstall restores the configuration (SC-009, as amended by the owner)

**Delivered by PR #2** (commit 274bae6, research R19), with tests, on the code this feature builds on:
the defects found here and in the first two audits (uninstall re-serialising `settings.json`,
leaving `{}` and timestamped backups after an install into an empty config dir, two backups and
rewritten CRLF, inline arrays and compact spacing with a pre-existing file, a dropped user
`"hooks": {}`, empty `agents/` `hooks/` `skills/` left behind, a reinstall rewriting a re-sorted
file) are fixed there, and its tests cover each one. What PR #2 does, which this plan relies on and
does not redo:

- `hooks/speckit-agents.install.json`, carrying the marker: `createdDirs`, `createdSettings`,
  `settingsBackup` (the fixed name `settings.json.bak-speckit-agents`), `forceBackups`
  (`{ path, backup }` per `--force` replacement). A manifest without the marker is a collision.
- Edits `settings.json` in place in its own indentation, line endings and trailing-newline state;
  updates gate entries in place, so a re-sorted file is left alone on a re-run.
- One backup of the user's original settings, the first time the installer changes them; none at
  uninstall; the install-time copy deleted at uninstall.
- Uninstall writes the original bytes back when nothing else changed the settings, otherwise keeps
  the other tool's changes and strips the gates in the file's own format, puts back `--force`
  replacements, keeps a user's own empty `hooks` containers, and removes only directories it
  created. Without a usable manifest it removes the owned files and the gates and nothing else.

**What this feature adds**: two more owned entries in `files()` (`hooks/speckit-activity.mjs`, the
`skills/speckit-activity/` folder, owned through the marker in `hooks/register.tsx` and removed as
a unit), an `emit` smoke check, and the help, final and uninstall messages (T013, T029, T064). PR
#2's round-trip tests then cover the new files with no change; T063 adds the cases PR #2 does not
test (a deleted or unmarked manifest, the messages, the smoke check, the PowerShell shell).

**The stored view choice is not the installer's** (third audit, finding K1): the mod's `$.store`
file is written by Claude Code under its plugin store, named by plugin and source. Deleting it at
uninstall would remove a file the installer did not write ("and nothing else"), and a match on the
`speckit-activity` prefix could hit a same-named plugin from another source. Uninstall leaves it;
the README's uninstall section says where it is and that removing it by hand only resets the view
to plain. T063(d) asserts it is untouched.

## R13. Where the mod's tests live (constitution I, gates)

**Measured**: Node 26 `node --test test/` also runs `*.test.ts` files under `test/` (type stripping
on by default). A mod test there would be picked up by `npm test` and fail on its
`claude-code/testing` import.

**Decision**: the mod's tests live in `mod/speckit-activity/test/*.test.ts` and run with
`claude plugin test mod/speckit-activity`. `test/mod.test.mjs` runs `claude plugin validate` and
`claude plugin test` on that folder from `npm test`, and is reported as skipped (with the reason)
when `claude` is not on PATH, so the mod's behaviour is under `npm test` as constitution I asks
without making `npm test` depend on Claude Code.

**Constitution IV and `claude-code/testing`** (audit finding M8): IV's first bullet ("hooks,
installer and tests MUST use only the Node standard library") governs code that runs on Node:
`hooks/`, `install.mjs`, `test/*.test.mjs` and `bench/` follow it. The mod's tests do not run on
Node; they run inside Claude Code's plugin environment, like the mod, which IV's second bullet
governs ("only the plugin API"). `claude-code/testing` is part of that API: it is declared by the
engine in the same `claude-code.d.ts`, supplied by the engine at test time, and nothing is
installed, downloaded or added to `package.json`. So it is not a runtime dependency and needs no
amendment. If the auditor reads IV otherwise, this is the place to amend it.

## R14. Malformed input to the existing hook (FR-019, constitution II)

**Delivered by PR #2** (commit 274bae6, research R19), with tests: stdin is read and parsed without
throwing; input that is not a JSON object, or an event outside the mode's `WIRED` list (`scope`:
PreToolUse; `gate`: PreToolUse, UserPromptExpansion; `verdict`: PreToolUse, SubagentStop, Stop;
`lane`: SubagentStop, Stop), makes no decision, so the action proceeds as it did when the hook
crashed, and in a Spec Kit repository prints
`{"systemMessage": "speckit-team: <mode> got unusable input (<why>); no decision made."}`; outside
one it stays silent. `lane` and `verdict` accept `Stop` (an agent run as the main thread). The
defects found earlier here (the crash on `JSON.parse`, and `gate` denying and `verdict` blocking on
`{}`) are fixed there, and its tests cover them.

**What this feature adds (H1 of the first audit, still needed)**: the `systemMessage` tells the
person once, in the transcript; it is not readable through the documented interface. So on PR #2's
no-decision path, in a Spec Kit repository, the mode also writes one `observer-fault` record
(`input-invalid:<mode>` when the input is unusable, `input-unknown-event:<mode>` when the event is
outside `WIRED[mode]`), with a fixed message and no input content (R10, R11), before the
`systemMessage` is printed and without changing it. Outside a Spec Kit repository nothing is
written. Tasks T005 and T012.

**Rejected**: replacing PR #2's `systemMessage` with the record (the person would no longer be told
in the transcript); deny or block on unusable input (turns a wiring fault into a refusal the agent
cannot act on).

**The guarded import** (audit finding C2 of the first audit): `speckit-team.mjs` loads
`speckit-activity.mjs` with `import()` inside `try`/`catch`. Missing module (`ERR_MODULE_NOT_FOUND`,
measured on Node 26), a module that throws while loading, or an export that throws when called: the
guardrail's output and exit code are what they would be with the module intact, no record is
written, and `activity-module-failed:<code>` goes to the fault file and `emit`'s output so the view
can say so.

## R15. Minimum Claude Code version

**Decision**: 2.1.291, the only version the plugin API was read from and the live checks run on.
The plugin API is marked early access in its own declarations (read). Guardrail decision records
need no new Claude Code feature; the view and the activity records need the mod. README states
both.

## R16. Reports through SubagentHandback (commit b9b0dc3, landed under this plan)

In interactive sessions subagents report through the `SubagentHandback` tool, not their last
message. Since b9b0dc3 the gate exempts `SubagentHandback` (not evaluated, so no `gate` record),
and spec-auditor's verdict is read by a PreToolUse hook on `SubagentHandback` from
`tool_input.message`, with the Stop path kept for `claude -p`. Consequences for this plan:

- `verdict` records are written on both paths and say which (`via`: `handback` or `stop`). A
  missing VERDICT line on the handback is a `decision` `verdict-line` `deny` the first time and
  `allow` when it is let through the second time.
- The handback `message` is model output: it is never copied into a record (R11), and the privacy
  test plants its marker there too.
- No new command hook is added. The mod's `tool.call` hook sees `SubagentHandback` like any tool,
  never answers in place of `next`, and never reads `message`, so it cannot hold a report back.

## R17. Delivery and follow-ups (owner decision 2026-10-06, audit finding H3)

The repository has a private GitHub remote, `PIsberg/speckit-agents`. PR #1 (branch
`fix/subagent-handback`, commit b9b0dc3) is open against `main`; PR #2 (branch
`fix/hook-input-and-uninstall`, commit 274bae6) is stacked on it; branch
`001-agent-activity-feed-and-pane` is rebased on PR #2.

- The feature PR is opened with `gh pr create --base main` and is stacked on #2 (itself on #1):
  its body says "Stacked on #2 (itself stacked on #1); review the last N commits", N being the
  feature's own commits. Its base stays `main`, so the repository's checks run for it.
- Everything the feature leaves undone becomes a GitHub issue in `PIsberg/speckit-agents`, one per
  item, each saying what is missing, why it was not done now and what it would take, linked from
  the PR body: macOS and Linux not run (SC-005 measurement, live checks, `npm test`); the view not
  live-tested on the desktop app, VS Code or mobile (T052 and the L-checks run on Windows Terminal
  only); any live check reported "not run" (for example L9 if V9 fails, L16 if the PowerShell hook
  shell cannot be set); each fallback T001 or T052 applied; retention without the mod (R5); the
  retention edge for sessions older than 7 days; a phase record repeating across racing sessions;
  silence when both the stream and the temp directory are unwritable; decision records lost while
  the activity module is missing; a main session's stop lost when the relay outlasts the
  session-end budget. Task T069, after the live run (T068) so its "not run" items are known; it
  also adds each issue's link to the README's "Known limits"; the PR (T073) links them.

## R18. The switchable rich view (User Story 6, FR-024 to FR-035)

What this build's drawing surface supports, read from `claude-code.d.ts` and reference.md
(2.1.291), and what each finding decides:

| Need | What the API offers (read) | Decision | Live item |
|---|---|---|---|
| A key that toggles while the panel is open (FR-032) | No free key event for a Pane. A `Button`'s `hotkey` (one digit or lowercase letter) presses it "while the plugin's site holds the focus", which a site gets "after ctrl+x tab, a click or `open({ focus })`"; Enter on the focused Button also presses it (`ButtonProps`). `action` binds only engine keybinding actions, not new ones. | A `switch-view` Button with `hotkey: 'v'` in both views. The panel never takes the keyboard itself (owner decision 2026-10-06: the key works once the user gives the pane focus, by ctrl+x tab or a click); the switch line says "ctrl+x tab then v". Whether Enter presses the switch Button after ctrl+x tab depends on which Button the focus lands on first, which is unverified (T052 probes it). | V12 |
| The view named on the command (FR-032) | `command.run`'s input has `args`: "everything after the name, as typed" (`CommandRunInput`); `CommandSpec.argumentHint` shows a hint. | `/speckit-activity [plain\|rich\|cool]`. | none (unit-tested) |
| Per-user persistence across repositories and sessions, local (FR-034) | `$.store`: "This plugin's own key-value store, kept between sessions and hot reloads... A JSON file of the plugin's own under the user's Claude Code configuration directory." On this machine such files sit in `~/.claude/plugins/store/<plugin>_<source>-<hash>.json`. | `$.store` key `view`. Claude Code writes the file, so uninstall leaves it (K1). | V13 |
| (alternative) `userConfig` / `pluginConfigs` | A `userConfig` field is a `/config` row, stored under `pluginConfigs` in settings; `$.config.set` changes it, and a change reloads the module. | Rejected: it writes the user's `settings.json`, which another tool rewrites between sessions (the SC-009 decision) and which the installer guarantees to leave as it found it; a reload per switch also drops timers and costs the 1 s budget. | |
| Borders (layout) | `Box` `borderStyle`: `single`, `double`, `round`, `bold`, ... on the terminal; another value draws no border. | Not used: each border costs 2 of the 20 rows. | none |
| Block characters for history bars | `Text` draws any string; no glyph restriction is stated. `Raster` (a grid of coloured cells) is terminal-only, so not usable on every surface. | `Text` with `▁▂▃▄▅▆▇█` and `.` for an empty interval. Per-interval counts are shown only as relative heights; the one number is the 5-minute total. | V14 |
| Colour without relying on it (FR-030) | `Text`: `color` (theme key or raw), `backgroundColor`, `bold`, `inverse`, `dimColor`, `wrap` (`truncate`, ...). | Colour and `inverse` only on top of words (`NEW`, `DENY`, state words). Every Text `wrap: 'truncate'`, so no line wraps (SC-013). | none |
| Timer-driven redraw capped at 2 per second (FR-028, SC-014) | `$.clock.every`/`after` run until cancelled or reload; a `$.state.set` redraws the sites that read the value "at the redraw rate"; `$.ui.invalidate` asks for a redraw. No frame-rate setting. A change of width redraws every site; a change of height alone redraws nothing. | The cap comes from our writes: the rich view reads only `richFrame` (and `view`), written by a throttled publisher at most once per 500 ms; the 1 s live tick is one of those writes, not an extra one. What is counted is pane draws (rich renders), not writes (T055, L15, audit finding H3). Draws the engine makes on its own (a resize) are outside our control; V15 checks there are no others. | V15 |
| Room for the 20-line and 80-column rules (FR-031) | `viewport.columns` (cells across the whole surface); `viewport.rows` is informational and not re-evaluated on a height change. A Pane gives `bodyColumns` (the box it draws into) and `scroll.bodyRows` (the most rows the frame may take, less the engine's). `placement` is `dock` or `inline`. | 80-column rule on `viewport.columns` (the spec's terminal width) and a 76-column rule on `bodyColumns` (the room the layout needs; catches a narrow docked pane in a wide terminal, audit finding M6), both with a stated notice; the 20-row cap is ours, the reduced form and the plain fallback by `scroll.bodyRows`. | V16 |

**Other decisions**:

- FR-034, settled by the owner (2026-10-06): a never-stored choice (every fresh install) is plain
  with no fault; an unreadable or invalid stored choice is plain and a `view-choice-unreadable`
  fault.
- `cool` is a synonym of `rich` on the command (owner-approved); docs and the panel say `rich`.
- Track labels follow FR-025 (`spec, plan, audit, red, green, gate`); record values stay
  `specify` and `verify` (schema 1.0 is unchanged); the view maps them. State words are one mapping
  in both views and the summary: `run` (active), `STALE` (stale), `done` (finished)
  (data-model.md "AgentInstance", third audit L3).
- Every plain-board item is reachable in the rich view (third audit H1, as settled in spec.md):
  each capped section (cards, decisions, verdicts per feature, fault causes) ends in a counted
  `+n more`, and a `rich-page` Button (`hotkey: 'n'`) pages all capped sections together until
  each has shown every item; the reduced form follows the same rule. Paging rather than a taller
  tree, because the 20-line cap bounds the frame, and an inline pane's frame grows with its tree.
- Uninstall leaves the mod's view-choice store (K1, R12).
- The rich view adds at most 500 ms (one frame) to the record-to-screen time; worst cases stay
  under FR-014's 1 s (contracts/view.md "Timing"); T055 asserts it in mocked time and L9 is run
  with the rich view open too (third audit M5).
- The history fold and the rich frame share the mod's event loop with `tool.call`: the first
  pass over up to 10 MB is folded in slices of 500 records with yields, and building `richFrame`
  touches only the items it shows plus per-section counts, so T037 can hold tool calls to the same
  2 ms during both (third audit M9).

## R19. PR #2 (commit 274bae6), landed under this plan

Branch 001 is rebased on `fix/hook-input-and-uninstall` (PR #2, stacked on PR #1). PR #2 fixed two
defects on main that running this feature through the pipeline found: the hook's crash and wrong
decisions on unusable input (R14), and uninstall leaving files and reformatting `settings.json`
(R12). It brings the test count to 34 (18 hook, 16 install). Every task and contract here that
covered that work is reshaped as an extension of it (tasks.md "Base"), and the feature PR is
stacked on #2 (R17, T073).

## Live verification log

To be filled in by T001 (a throwaway mod outside the repo) before the mod implementation tasks
(T024 to T028) build on these, and for V12 to V16 by T052 before the rich view's tasks (T056 to
T061). Each line: result, date, Claude Code version, how observed. Each
question has a rule for a failed answer (audit finding H3): **stop** means T001 hands back to
architect, because the answer changes plan.md or the contracts and so voids the audit;
**fallback** means the named fallback is recorded here and the listed tasks adapt, with no new
audit needed because no contract changes.

| Id | Question | If the answer is no | Result |
|---|---|---|---|
| V1 | Does a function-hooks plugin folder in `<claude dir>/skills/<name>/` (no SKILL.md) load in a new session, interactive and `claude -p`, with no prompt? | stop: R8 fallback (`CLAUDE_CODE_PLUGIN_DIRS`) changes installed-files.md | not run |
| V2 | Does `classic.SubagentStart` fire in the mod for every subagent, and is its `agent_id` the same value the agent's frontmatter command hooks receive as `agent_id`? | stop: hook and mod records could not be joined per agent, the design's key | not run |
| V3 | Does `tool.call` carry `agentId` for a subagent's tool calls and none for the main session's? | stop: tool records could not be attributed (FR-002, SC-007) | not run |
| V4 | Does `$.process.run(['node', '<abs path>', 'emit'], { stdin })` find `node` on Windows with no shell? | stop: the relay transport changes | not run |
| V5 | For an `isolation: "worktree"` subagent, is `classic.SubagentStart`'s `cwd` the worktree? | stop (owner decision 2026-10-06): US4 S2 is not weakened and no `worktree_unknown` field is added; architect redesigns how the mod learns the worktree | not run |
| V6 | Does `claude plugin test mod/speckit-activity` discover `test/*.test.ts` in the plugin folder? | fallback: tests move to `mod/speckit-activity/*.test.ts` and the fixture to `mod/speckit-activity/fixtures/`; the installer skips `*.test.ts` and `fixtures/`. Task paths change, not their content. | not run |
| V7 | Inside `claude plugin test` without `mock.clock`: is `performance.now()` available and wall time? Is `Date.now()`? | fallback per R9: `Date.now()` mean bound, else timing "not run" (T037) | not run |
| V8 | Does `turn.complete` fire once when a subagent's run ends, carrying its `agentId` (equal to V2's `agent_id`), and not when a Stop hook refused its stop (lane check blocking once)? | stop: the `agent-stop` source (R2, M3) changes the data model | not run |
| V9 | How is a mod's `userConfig` field set (the `/config` row, or `pluginConfigs` in settings)? Which file holds `$.ui.log(..., { to: 'debug' })` lines in a `claude --debug` session? Is `$.clock.now()` wall time in a live session (compared with the system clock over a 10 s span, within 50 ms)? | no stop. If any part is no, the SC-002 live check (quickstart L9) cannot run: it is reported as "not run" in the README with the reason, SC-002 rests on the mocked-clock unit test (T018) alone, and the gap becomes a follow-up issue (T069). | not run |
| V10 | Does `session.end` fire in the mod on `/exit`, on Ctrl-D and on `/clear` (`reason: 'clear'`), and does a `$.process.run` of `emit` started from it finish within `next.budget` so the main session's `agent-stop` is written? After `/clear`, which `session_id` do later main-loop events carry? | stop if `session.end` never fires on `/exit` (the main session's `agent-stop`, a public guarantee in activity-stream.md, has no source). Fallback, no stop, if it fires on `/exit` but not on Ctrl-D or `/clear`, or fires but the relay cannot finish within the budget (third audit M10): the mod writes the main session's stop at the next session's start, or before the next main run's start, for any `main:<session>` it saw start and not stop (`agent-stop` with that run's last `ts`); quickstart L12 checks it there, and what changes for the user is that such a stop appears when the next session starts, not when the old one ends. | not run |
| V11 | Which `hook_event_name` does an agent's frontmatter `Stop` hook receive when the agent runs as a subagent, and when it runs as the main thread (`claude --agent implementer`)? | no stop: `lane` and `verdict` accept both `SubagentStop` and `Stop` (audit finding M4); the answer is recorded so the README states it | not run |
| V12 | (T052) Does a Pane `Button` with `hotkey: 'v'` toggle when the pane holds the keyboard after ctrl+x tab, and after a click, inline and docked, in Windows Terminal with Git Bash and with PowerShell? After ctrl+x tab, which Button holds the focus first, and does Enter press it? Does `/spike-view rich` deliver `args: "rich"`? | stop if `args` is not delivered (FR-032's argument has no source). Fallback, no stop, if the hotkey does not press: Enter on the focused switch Button, reached by ctrl+x tab and, if the focus lands elsewhere, Tab to it; the switch line then says so. What changes for the user: one or two more keys after ctrl+x tab; both paths need ctrl+x tab (or a click) first in any case. The Enter path is unverified until T052 probes it. | not run |
| V13 | (T052) Does a `$.store.set` survive a session restart and read back in another repository? Where is the file, and what is its name? If not: does a `$.fs.write` of `<claude dir>/hooks/speckit-activity.view.json`, the directory taken from the rendered `{{HOOK}}` path, survive a restart and read back? | fallback, no stop, if only `$.store` fails: the mod uses that file (written outside the repository by `$.fs.write`; the installer never touches it, and the README names it). Nothing changes for the user. Stop if neither survives a restart (FR-034 would have no store). | not run |
| V14 | (T052) Do `▁▂▃▄▅▆▇█`, `─`, `·` and `●` each take one cell, without replacement characters, in Windows Terminal with Git Bash and with PowerShell? | fallback, no stop: the ASCII set of contracts/view.md everywhere (8 distinct level characters, `.` only for an empty interval). What changes for the user: coarser bars; per-interval counts stay relative heights in both sets, the 5-minute total stays a number. Only Windows Terminal is probed; the desktop app, VS Code and mobile are not (T069 issue). | not run |
| V15 | (T052) With a timer writing a `$.state` value every 100 ms, then every 500 ms, and then not at all while transcript output streams, a tool runs and the focus moves, how many times per second does the pane's `ui.render` run (one debug-log line per invocation, bucketed per second)? | stop if the engine runs the pane hook more than twice in a second without our writes (third audit H3): SC-014 counts draws, and our throttle could not bound them, so the owner decides how SC-014 counts engine-initiated draws. If it runs at most once per write: nothing changes. | not run |
| V16 | (T052) Are `e.viewport.columns`, `e.props.bodyColumns` and `e.props.scroll.bodyRows` present for an inline pane and a docked pane in a 160-column window, and does a height-only resize redraw the pane? | fallback, no stop: without a viewport only the 76-column `bodyColumns` rule applies, so a pane at least 76 columns wide shows the rich view whatever the terminal width; what is lost is the separate 80-terminal-column notice, which a pane under 76 columns gets in its own words instead (third audit L6). A height-only resize not redrawing means the reduced or plain form is chosen at the next draw, at most 1 s later by the live tick. | not run |
| V17 | (T068) Can this Claude Code build run hook commands under PowerShell (a hook `shell` setting, or the session's shell setting), and if so do the installed commands decide as under Git Bash (quickstart L16)? | no stop: if PowerShell cannot be chosen for hooks, L16 is "not run" with that reason, T063's `powershell -NoProfile -Command` unit test is the only evidence, and T069 opens the issue (third audit M11). | not run |
