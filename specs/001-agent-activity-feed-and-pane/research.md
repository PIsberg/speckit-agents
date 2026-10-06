# Research: Agent Activity Feed and Live Pane

**Feature**: `001-agent-activity-feed-and-pane` | **Date**: 2026-10-06 | **Plan**: [plan.md](plan.md)

Every decision below names what was chosen, why, and the alternative rejected. Facts are marked
**measured** (run on this machine), **read** (from the Claude Code 2.1.291 plugin API declarations
or reference), or **given** (verified earlier in this session by the owner and passed in). Items
that only a live session can settle are collected in "Live verification log" at the end; T001 in
`tasks.md` fills it in before anything is built on them.

## R1. What a hook costs on this machine (measured)

Windows 11, Node v26.8.2, git 2.55.0.windows.5, 100 runs each, `process.hrtime` around `spawnSync`.
Script kept outside the repo; `bench/overhead.mjs` (T036) reproduces the hook rows.

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
  These processes already run; the added cost is the append (0.5 ms, R1).
- **Activity facts** (`agent-start`, `agent-stop`, `tool`) come from the mod's in-process function
  hooks: `tool.call` (carries `agentId` inside a subagent, read), `classic.SubagentStart` and
  `classic.SubagentStop` (carry `agent_id`, `agent_type`, `cwd`, read), `session.start` and
  `session.end` for the main session. The hook on the tool path only pushes an envelope onto an
  in-memory queue and calls `next(e)`; it makes no `$` call first.
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

**Decision**: the writer enforces retention whenever it creates a segment (at most once per
`segmentBytes` written, and at least once per UTC day while anything is written).

1. Never delete the segment just created.
2. **Age**: delete a segment whose modification time is older than `maxAgeDays` (default 7),
   unless it contains a record of the writing session (substring check for `"session":"<id>"`).
   This keeps the current session's records plus the previous 7 days.
3. **Size**: while the directory holds more than `maxBytes` (default 10485760), delete the oldest
   segment by name. The size cap is hard: it wins over the current-session rule.
4. Any error is reported as a fault (R10) and the write goes on.

Both limits, and `segmentBytes`, are configurable in `.specify/activity.json` (contracts/config.md).

**Alternatives rejected**: the mod enforces retention (`$.fs` has no delete, read; and retention
would stop when the mod is not loaded); trimming on every write (cost on every guardrail call);
a scheduled job (nothing to schedule it with, cross-platform).

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

1. **Hook side**: `bench/overhead.mjs` runs the installed-equivalent hook 100 times in pairs
   (observation enabled, then `.specify/activity.json` `{"enabled": false}`), alternating to cancel
   drift, for a `gate` on `PreToolUse Read` in a Spec Kit repo, and reports the median of the paired
   differences. Pairing is needed because the spawn itself varies by 75 to 178 ms (R1).
2. **Mod side**: `mod/speckit-activity/test/overhead.test.ts` drives 100 `$.tool.call`s through the
   mod and times call-to-beneath with `Date.now()`, and separately asserts the structural
   guarantee (the beneath hook is reached before the mod makes any `$.fs` or `$.process` call).
   If T001 shows the test environment's clock is not wall time, the timing half is reported as
   "not run" and the structural half stands.
3. SC-005 passes when hook-side median plus mod-side median is at most 10 ms. Results go in the
   README with date and versions. macOS and Linux: "not run" (spec, SC-005).

**Repositories without Spec Kit** (FR-022, SC-008): the guardrail modes keep their early exit,
and `hooks/speckit-activity.mjs` is imported only after the `.specify/` check, so the code path
outside Spec Kit is unchanged; the bench reports that case too and expects a paired median within
2 ms (the measurement's noise floor at these spawn times). The mod runs one `git rev-parse` at
session start (13.6 ms, R1), then its `tool.call` hook is a boolean check; it sets no status,
registers no command, writes nothing.

Why 10 ms: it is about 6% of one Git Bash hook spawn (173 ms, R1), large enough to be measured
reliably with paired runs, and 20 times the expected cost, so a regression to a per-call spawn
(66 ms or more) fails it clearly.

## R10. Making observer failures visible (FR-018, constitution III)

**Decision**:

- The writer never changes a hook's stdout or exit code, and catches every error.
- On a failure it records a fault (cause code, message, count, first and last time) in
  `<os.tmpdir()>/speckit-team-faults/<16 hex of sha256(stream dir)>.json`, a location that does
  not depend on the stream directory being writable. At most 50 causes are kept.
- `node <hook> emit` prints `{ "written", "skipped", "faults" }` on stdout, faults included, so the
  mod learns about failures in guardrail processes it does not run.
- The mod shows each distinct cause once per session with `$.ui.toast` and adds
  `observer: <n> problem(s)` to the summary line. A failure of its own (the `emit` process cannot
  start, exits non-zero, or prints something unparsable) is a cause too. Its own drawing is
  wrapped in `try`/`catch` and falls back to a one-line text naming the problem.

**Alternatives rejected**: `systemMessage` in the hook's output (changes the hook output that
SC-004 compares, and repeats in every agent's transcript); stderr only (not shown without
`--debug`); a record in the stream itself (the stream may be the thing that is broken).

**Known edge**: if both the stream directory and the temp directory are unwritable, the failure is
silent. Listed in the README's known limits.

## R11. Privacy (FR-008, FR-009, SC-006)

**Decision**: metadata only, one filter, opt-in per field.

- The writer builds every record from an allow-list of fields (data-model.md). It never copies
  hook input objects. `tool_input` contributes the tool name and, for file tools (Read, Write,
  Edit, MultiEdit, NotebookEdit), the target path made repo-relative with forward slashes; a path
  outside the repo is `null`.
- `last_assistant_message`, prompts, tool output, file contents and environment values are never
  read into a record. `worktree` is relative to the main worktree, so no home directory (and no
  user name) appears.
- Opt-in fields in `.specify/activity.json` `fields`: `command` (Bash command text, first 200
  characters) and `description` (a subagent's task description, first 200 characters). Both off by
  default. The mod reads the same file at session start and sends those values only when on; the
  writer drops them again when off.
- Raw absolute paths cross from the mod to the writer only over the local `emit` process's stdin
  and are never stored.

## R12. Install then uninstall leaves the configuration byte-identical (SC-009)

Found while reading `install.mjs`: today `--uninstall` re-serialises `settings.json` with 2-space
indentation (a file indented otherwise changes bytes) and leaves directories it created
(`agents/`, `hooks/`, `skills/`) behind empty.

**Decision**: preserve the detected indentation and the presence of a trailing newline when
writing `settings.json`. `*.bak-speckit-agents-*` backups stay on purpose (they are the user's
copies of their own files); the SC-009 test excludes them and the README says so. Flagged for
confirmation in plan.md.

**Directories: the installer records the ones it creates, and uninstall removes only those.**
Installation Constraints say `--uninstall` removes what the installer added "and nothing else", so
an empty directory that existed before the install must survive it.

- Before writing anything, the installer notes which of `agents/`, `hooks/` and `skills/` under
  the config directory do not exist yet. Directories inside a folder it owns as a unit
  (`skills/speckit-team/`, `skills/speckit-activity/`) need no record: those folders are removed
  whole. The config directory itself is never recorded and never removed.
- It writes the list to a manifest, `<claude dir>/hooks/speckit-agents.install.json`:
  `{ "managedBy": "speckit-agents: managed by install.mjs", "createdDirs": ["agents", "hooks"] }`,
  forward slashes, sorted. The `managedBy` value contains the marker, so the existing ownership
  check (`ours()`) applies. `hooks/` always exists after an install, so the manifest always has a
  home.
- A later install merges: `createdDirs` = the manifest's existing list plus any directory created
  in this run. A second install therefore writes the same bytes and reports `unchanged`
  (idempotent). Without that merge, a reinstall would see the directories as pre-existing and
  forget it created them.
- `--uninstall` removes the owned files and folders, then the manifest, then each directory in
  `createdDirs` that is empty, deepest first. A recorded directory that now holds the user's files
  is kept. Every directory not in the list is kept, empty or not.
- No manifest (an install made before this change, or the user deleted it), a manifest without the
  marker, or one that does not parse: uninstall removes no directory. Failing safe means leaving
  an empty directory behind, never deleting one the installer cannot prove it created. A manifest
  without the marker is a collision, handled like any other (refuse, or `--force` with a backup).

**Alternatives rejected**:

| Alternative | Why not |
|---|---|
| Remove `agents/`, `hooks/`, `skills/` whenever they are left empty (the first design) | Deletes an empty directory the user made before the install; violates "and nothing else". |
| A marker file inside each created directory | Puts a stray non-agent file in `agents/` and a non-skill entry in `skills/`, which Claude Code scans; three files to own instead of one. |
| Decide at uninstall time from timestamps | Birth times are not available on every filesystem, and a directory's age says nothing about who created it. |
| Never remove directories | Leaves directories the installer added behind; breaks SC-009 for a fresh config directory. |

## R13. Where the mod's tests live (constitution I, gates)

**Measured**: Node 26 `node --test test/` also runs `*.test.ts` files under `test/` (type stripping
on by default). A mod test there would be picked up by `npm test` and fail on its
`claude-code/testing` import.

**Decision**: the mod's tests live in `mod/speckit-activity/test/*.test.ts` and run with
`claude plugin test mod/speckit-activity`. `test/mod.test.mjs` runs `claude plugin validate` and
`claude plugin test` on that folder from `npm test`, and is reported as skipped (with the reason)
when `claude` is not on PATH, so the mod's behaviour is under `npm test` as constitution I asks
without making `npm test` depend on Claude Code.

## R14. Malformed input to the existing hook (FR-019, constitution II)

Found while reading `hooks/speckit-team.mjs`: line 32 is
`JSON.parse(fs.readFileSync(0, 'utf8') || '{}')`, which throws on malformed stdin, so the hook
crashes and the action proceeds silently. The feature changes this script, so FR-019 applies.

**Decision**: parse inside `try`/`catch`; malformed input is treated as `{}`. The effective
decision is unchanged (the action proceeds, as it does after a crash today), but the hook no
longer crashes and no record is written. Covered by a test that fails today.

## R15. Minimum Claude Code version

**Decision**: 2.1.291, the only version the plugin API was read from and the live checks run on.
The plugin API is marked early access in its own declarations (read). Guardrail decision records
need no new Claude Code feature; the view and the activity records need the mod. README states
both.

## Live verification log

To be filled in by T001 (a throwaway mod outside the repo) before the mod implementation tasks (T020 to T024) build on these. Each line:
result, date, Claude Code version, how observed. If V1 fails, switch to the R8 fallback and
update plan.md, contracts/installed-files.md and the tasks before continuing.

| Id | Question | Result |
|---|---|---|
| V1 | Does a function-hooks plugin folder in `<claude dir>/skills/<name>/` (no SKILL.md) load in a new session, interactive and `claude -p`, with no prompt? | not run |
| V2 | Do `classic.SubagentStart` and `classic.SubagentStop` fire in the mod for every subagent, with the same `agent_id` the agent's frontmatter command hooks receive? | not run |
| V3 | Does `tool.call` carry `agentId` for a subagent's tool calls and none for the main session's? | not run |
| V4 | Does `$.process.run(['node', '<abs path>', 'emit'], { stdin })` find `node` on Windows with no shell? | not run |
| V5 | For an `isolation: "worktree"` subagent, is `classic.SubagentStart`'s `cwd` the worktree? | not run |
| V6 | Does `claude plugin test mod/speckit-activity` discover `test/*.test.ts` in the plugin folder? | not run |
| V7 | Is `Date.now()` wall time inside `claude plugin test` when `mock.clock` is not used? | not run |
