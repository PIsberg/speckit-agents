# Implementation Plan: Agent Activity Feed and Live Pane

**Branch**: `001-agent-activity-feed-and-pane` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-agent-activity-feed-and-pane/spec.md`

## Summary

Every fact about the agents is written as one JSON line to an append-only, segmented, local stream
inside `.git/speckit-team/activity/`, documented in the README as a public, versioned interface
(schema `1.0`). Guardrail facts are written by the guardrail hook in the process that decides, at
0.5 ms per record. Agent and tool activity come from a Claude Code mod's in-process hooks, which
queue envelopes on the tool path and hand them in batches to the same Node writer off that path,
because a command hook per tool call costs 173 ms through Git Bash (measured). The same mod is
the first consumer: it reads the stream back like any outside tool and shows a one-line summary
(`$.ui.status`) in Spec Kit repositories and a panel opened with `/speckit-activity`. The
installer adds one hook module, the mod folder and a small manifest, and no `settings.json`
entry. The plan sits on commit b9b0dc3: subagents report through `SubagentHandback`, which the
gate exempts, and spec-auditor's verdict is read from it (research R16).

## Technical Context

**Language/Version**: JavaScript ES modules on Node 18 or newer (hooks, installer, tests, bench);
TypeScript/TSX for the mod, run as source by Claude Code's plugin engine (no build step).

**Primary Dependencies**: none at run time (constitution IV). Node standard library only. The mod
uses only the plugin API `$` and type-only imports from `claude-code`; its tests use the engine's
`claude-code/testing`.

**Storage**: append-only JSON Lines segments in `<git common dir>/speckit-team/activity/`;
per-feature phase state in `<git common dir>/speckit-team/phase.json`; observer faults as
`observer-fault` records in the stream, and in `<os temp dir>/speckit-team-faults/` only when the
stream itself is unwritable; the installer's manifest `<claude dir>/hooks/speckit-agents.install.json`. Optional per-repo config `.specify/activity.json`.

**Testing**: `node:test` via `npm test` (`test/*.test.mjs`); `claude plugin validate` and
`claude plugin test` for `mod/speckit-activity/` (its `test/*.test.ts`), also driven from
`test/mod.test.mjs`; `bench/overhead.mjs` and `bench/latency.mjs` for SC-005 and SC-002; live
checks in [quickstart.md](quickstart.md).

**Target Platform**: Claude Code 2.1.291 or newer on Windows 11 (Git Bash and PowerShell hook
shells), macOS, Linux.

**Project Type**: Claude Code extension: hook scripts, an installer, and a plugin of function hooks.

**Performance Goals**: view reflects a record within 1 s (SC-002; design target under 400 ms);
observation adds at most 10 ms median per tool call on Windows (SC-005, research R9).

**Constraints**: guardrail decisions identical with observation on, off or broken (FR-017,
SC-004); metadata only by default (FR-008); nothing leaves the machine (FR-010); zero cost in
repositories without `.specify/` (FR-022); 10 MB and 7 days of history by default (FR-011).

**Scale/Scope**: records of about 300 to 400 bytes, so about 30,000 retained at the 10 MB cap;
segments of 256 KiB (about 700 records); a handful of concurrent agents per session (3 parallel
implementers in SC-007), more than one session per repo.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

| Principle | How the design meets it | Result |
|---|---|---|
| I. Test-First | `tasks.md` puts every test task before the implementation it covers; each names its file and FR/SC IDs. Tests that guard behaviour which may already hold name a deliberate break to show them red once (T007, T009, T036, T037, T043, T047); the evidence goes in the PR body (T062). Tests assert observable output: hook stdout, files in the stream, what `emit` prints, what the pane and status line show. Mod tests run under `npm test` through `test/mod.test.mjs`. | PASS |
| II. Guardrails Never Fail Silently | Stdin parse made safe (today it throws on malformed JSON, research R14). Empty, malformed or unknown input makes no decision in every mode and writes an `observer-fault` record, so it is visible, not silent (H1); `gate` and `verdict` get the no-op path they lack today (T012). The activity module is loaded with a guarded dynamic `import()` after the `.specify/` check, so it cannot crash a guardrail or change a decision, with a test for a missing and a throwing module (T009). Every new entry point in the mod has a malformed or partial input test (T017: `tool.call`, `classic.SubagentStart`, `turn.complete`, `session.start`, `session.end`; T020: `command.run`). `lane` and `verdict` accept `Stop` as well as `SubagentStop`, so an agent run as the main thread is still checked (M4). No hook command, event or matcher in `settings.json` or agent frontmatter changes, and no catch-all hook is added; the mod's `tool.call` never holds back `SubagentHandback`. Every mod event this feature wires, `session.end` included, is verified live (T001 V1 to V11, quickstart L1 to L12, tasks T030 and T059). The mod runs `node` with an absolute forward-slash path as an argv element. | PASS |
| III. Observers Never Block | The mod's `tool.call` hook makes no `$` call before `next(e)` and never answers in its place; records are written in a `try`/`catch` before the decision is printed, never altering it; failures are `observer-fault` records in the stream, the mod's own included (the fault file only when the stream is unwritable or the activity module fails), and are toasted once per cause. Guardrails never run retention (it runs in `emit`, R5), and the mod's `session.start` returns before it runs `git` (R9). Budget stated: 10 ms median per tool call, measured against the base commit's hook, including a segment-rotation row (R9). | PASS |
| IV. Zero Runtime Dependencies | Node stdlib in hooks, installer, `test/*.test.mjs`, bench. The mod ships as `.tsx`/`.ts` source using only `$`. The mod's tests import `claude-code/testing`: they run inside Claude Code's plugin environment, not on Node, and the kit is part of the plugin API the engine supplies (declared in the same `claude-code.d.ts`); nothing is installed or added to `package.json`, so it is not a runtime dependency (research R13, audit finding M8). | PASS |
| V. Versioned Public Contracts | Every record carries `schema: "1.0"`; additive-only rule and ignore-unknown rule published in the README; contracts in [contracts/](contracts/) for the stream, record, config, view, hook CLI and installed files. | PASS |
| VI. Local and Private by Default | Local file inside `.git`; allow-listed fields only; worktree relative, never absolute; `command` and `description` opt-in per field, off by default (R11). | PASS |
| VII. Every Supported Platform | Append semantics hold on all three; paths emitted with `/`; segment names have no `:`. Verified on Windows only: macOS and Linux are "not run" for SC-005 (allowed by the spec), for the live checks and for `npm test`; the README says so, and the gap is a GitHub issue in `PIsberg/speckit-agents` linked from the PR (T061, owner decision 2026-10-06, research R17). | PASS, with the gap reported and tracked |
| VIII. Docs in the Same Change | Tasks update README (install table, activity stream reference, reference consumer, view, config, verifying, known limits, uninstall), CLAUDE.md (layout, verify) and the installer's help and final message. | PASS |
| Installation Constraints | Idempotent; marker-owned files and folder; sources and settings validated before any write; inert outside Spec Kit; uninstall removes everything added and nothing else. SC-009 as amended by the owner (2026-10-06, R12): after install then uninstall `settings.json` parses to the same value as before, keeps its indentation and line endings (CRLF included), and is byte-identical when nothing else changed it meanwhile (the install-time backup's bytes are written back only when its value matches); zero files are left behind (no uninstall-time backup; the one install-time backup and `--force` copies are removed or restored, their names kept in the manifest); a second install changes nothing, also after another tool re-sorts the file (gate entries updated in place). Directories and a `settings.json` are removed only when the installer created them, recorded in a marker-owned manifest; a pre-existing empty directory is kept. | PASS |
| Workflow and Quality Gates | `npm test`, `claude plugin validate`, `claude plugin test`, live checks, each reported as passed, failed, skipped or not run (tasks T057 to T059), and the PR body records them (T062), with follow-up issues for anything not run (T061). | PASS |

Post-design re-check (after data-model.md and contracts/): no principle changed status. The one
open risk is not a violation but an unverified platform fact: whether the installer's chosen mod
location loads (research V1), along with V2 to V11 (event ids, `turn.complete`, worktree `cwd`,
test discovery, clocks, the debug log, `session.end`, the Stop event name). T001 settles them before anything is built on them; each has a stated rule,
stop and hand back to architect, or a named fallback (research, "Live verification log").

## Decisions

The five decisions requested, each with the alternative rejected. Evidence in [research.md](research.md).

1. **Where records are produced** (R2): guardrail facts in `hooks/speckit-team.mjs` at the moment
   of decision; agent and tool activity in the mod's in-process `tool.call`,
   `classic.SubagentStart`, `turn.complete` (a subagent's stop, which fires only once a Stop hook
   has let it go, so `agent-stop` is final), `session.start` and `session.end` hooks, relayed in
   batches to `node <hook> emit`; verdicts recorded on both the `SubagentHandback` and the Stop
   path (R16); phase changes derived by the writer at team agent start (R6). Rejected: command hooks on every tool call (173 ms per call via Git Bash, in every
   repo); the mod writing the stream itself (`$.fs` has no append); the mod producing decisions it
   does not make.
2. **Stream location and format; history then live** (R3, R4): JSON Lines segments in
   `<git common dir>/speckit-team/activity/`, append-only, named by creation time, cursor =
   `(segment, byte offset)`, consume to the last `\n`, records carry `id` for restart dedupe.
   Rejected: one trimmed file (breaks offsets), per-session files, SQLite, sockets, HTTP.
3. **Retention** (R5): enforced only in `emit`, the mod's relay, off every tool path, when a new
   segment has appeared or a UTC day has passed: never the newest; age with the relayed sessions
   protected; then the size cap, oldest first, hard. Guardrails may start a segment but never
   delete. Rejected: retention inside a guardrail before or after its decision (cost on a tool call,
   audit finding M2), enforcement by the mod's own `$.fs` (no delete), on every write (cost),
   scheduled jobs. Known limit: without the mod loaded the cap is not enforced (follow-up issue).
4. **Installing the mod** (R8): rendered by `install.mjs` into `<claude dir>/skills/speckit-activity/`
   with `{{HOOK}}` replaced; folder owned through the marker in `hooks/register.tsx`; removed by
   `--uninstall`; no `settings.json` change. Fallback if T001 shows that folder does not load:
   `CLAUDE_CODE_PLUGIN_DIRS` in the settings `env` block. Rejected: marketplace install through the
   `claude` CLI (needs `claude` at install time, reads the unrendered source clone).
5. **Overhead budget** (R9): 10 ms median per tool call on Windows, measured as hook-side paired
   median (`bench/overhead.mjs`, 100 alternating pairs, today's hook with its activity module
   versus the base commit's hook, which has no activity code; plus a row where every run starts a
   segment) plus
   mod-side median from `performance.now()` (or a `Date.now()` mean bound when that is all the
   test environment has; `overhead.test.ts`, 100 calls, printed), with the structural guarantee that the mod makes no `$`
   call before `next`. Outside Spec Kit: unchanged hook path, paired median within 2 ms.

Also decided: the summary uses `$.ui.status` and the panel a `Pane` opened only by
`/speckit-activity` (R7); faults are `observer-fault` records in the stream, read by the view like any record, with
a temp-dir fault file only for an unwritable stream, and one toast per cause (R10); mod tests live in `mod/speckit-activity/test/` because Node 26 runs `.test.ts`
under `test/` (measured, R13).

## Decisions a human should confirm

| Decision | Kind | Where |
|---|---|---|
| No new runtime dependency; the mod relies on the early-access plugin API of Claude Code 2.1.291 | dependency (platform) | R15 |
| New public record format `schema 1.0` and its location `.git/speckit-team/activity/*.jsonl` | public API | contracts/activity-stream.md |
| New per-repo config file `.specify/activity.json` (`enabled`, `retention.*`, `fields.*`) | public API, schema | contracts/config.md |
| New slash command `/speckit-activity`, plugin name `speckit-activity`, `userConfig.latencyLog` | public API | contracts/view.md |
| New installed files `hooks/speckit-activity.mjs`, `skills/speckit-activity/` and the manifest `hooks/speckit-agents.install.json` (`createdDirs`, `createdSettings`, `settingsBackup`, `forceBackups`); no new `settings.json` entry | public API (installed files) | contracts/installed-files.md |
| New record kind `observer-fault` and new fields `verdict.via`, `agent-stop.final` | public API | data-model.md, schema |
| New hook mode `emit` (internal, envelope `v: 1`) | CLI surface | contracts/emit-cli.md |
| Installer behaviour change (owner decision 2026-10-06 on SC-009): keep `settings.json`'s value, indentation and line endings, writing back the pre-install bytes when nothing else changed it; one install-time backup, never one at uninstall, and that backup deleted at uninstall; `--force` replacements restored at uninstall; gate entries updated in place; directories and a `settings.json` removed only when the installer created them; installs made before this change have no manifest, so their uninstall removes no directory, deletes no backup and may leave an empty `settings.json` | behaviour change | R12 |
| Retention runs only in the mod's relay; without the mod the 10 MB cap is not enforced | design, known limit | R5 |
| `lane` and `verdict` accept `Stop` as well as `SubagentStop` | behaviour change | R14, M4 |
| If an isolated worktree agent's `cwd` is not visible to the mod, T001 stops and the design is revisited (no weakened US4 S2) | owner decision | research V5 |
| Malformed stdin, and events a mode is not wired to, now make no decision and write an `observer-fault` record, instead of crashing (every mode) or denying and blocking (`gate` and `verdict` on `{}`); the effective result for a crash is unchanged: the action proceeds | behaviour change | R14 |
| A subagent's stop is taken from `turn.complete`, not `SubagentStop`; `agent-stop` is terminal | design | R2, V8 |
| Phase changes are inferred at team agent start; `SKILL.md` is not changed | design | R6 |
| macOS and Linux reported "not run"; a follow-up issue in `PIsberg/speckit-agents` per gap; the feature PR is stacked on #1, base `main` | verification scope, delivery | Constitution Check VII, R17 |

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-activity-feed-and-pane/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: measurements, decisions, live verification log
├── data-model.md        # Phase 1: entities, record fields, state transitions
├── quickstart.md        # Phase 1: gates and live checks
├── contracts/
│   ├── activity-record.schema.json
│   ├── activity-stream.md
│   ├── config.md
│   ├── emit-cli.md
│   ├── installed-files.md
│   └── view.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
hooks/
├── speckit-team.mjs          # changed: safe stdin, records at each decision, `emit` mode
└── speckit-activity.mjs      # new: config, record builder, privacy filter, writer, segments,
                              #      retention, phase state, faults
mod/speckit-activity/         # new: the mod (installed to <claude dir>/skills/speckit-activity/)
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json            # {"modules":["./register.tsx"]}
│   ├── register.tsx          # wiring: session.start/end, tool.call, classic.Subagent*, command, render
│   ├── relay.ts              # envelope queue, batched `emit` via $.process.run, faults
│   ├── stream.ts             # stream consumer: list, byte cursors, partial lines
│   ├── fold.ts               # records -> view model, stale rule, summary text
│   └── view.tsx              # pane tree, narrow layout
├── types/index.d.ts          # PluginState contract, ActivityModel
└── test/                     # claude plugin test; not installed, not under npm's test/
    ├── fixtures/pipeline.jsonl
    ├── summary.test.ts
    ├── pane.test.ts
    ├── follow.test.ts
    ├── relay.test.ts
    └── overhead.test.ts
bench/
├── overhead.mjs              # new: SC-005 paired measurement
└── latency.mjs               # new: SC-002 live helper
install.mjs                   # changed: installs the activity module and the mod; SC-009 fixes;
                              #          writes hooks/speckit-agents.install.json (created dirs,
                              #          created settings.json); gate entries updated in place
test/
├── hook.test.mjs             # extended: malformed stdin
├── activity.test.mjs         # new: emit, record shape, labels, paths, phase, non-team
├── isolation.test.mjs        # new: activity module missing or throwing changes no decision
├── privacy.test.mjs          # new: SC-006, opt-in fields
├── observe.test.mjs          # new: guardrail records, SC-001
├── safety.test.mjs           # new: SC-004, SC-008, faults
├── stream.test.mjs           # new: FR-007 follow, README reference consumer, docs drift
├── retention.test.mjs        # new: FR-011
├── parallel.test.mjs         # new: SC-007, worktrees, two sessions
├── install.test.mjs          # extended: new files, SC-009
└── mod.test.mjs              # new: runs claude plugin validate/test
README.md, CLAUDE.md          # changed
```

**Structure Decision**: keep the existing single-project layout. The record code goes into a
second hook module rather than into `speckit-team.mjs`, so the observer is isolated from the
guardrails (a broken observer module cannot crash a guardrail) and the two can be worked on in
parallel. The mod gets its own top-level folder because it is installed as a unit and tested by a
different runner; its tests stay inside it because `node --test test/` would run them (R13).

## Complexity Tracking

No constitution violation to justify. Two choices add moving parts and are recorded here so the
auditor can weigh them:

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| Two producers (hook and mod) feeding one writer | Only the hook knows decisions; only the mod sees every tool call at no per-call cost | One producer either misses decisions (mod only) or costs 173 ms per tool call (hooks only), R2 |
| Segmented stream instead of one file | Retention must delete old records without moving consumers' byte offsets | Trimming one file in place breaks FR-007 for every follower, R3 |
