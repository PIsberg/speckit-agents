---
description: "Task list for the agent activity feed and live pane"
---

# Tasks: Agent Activity Feed and Live Pane

**Input**: Design documents from `specs/001-agent-activity-feed-and-pane/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. Constitution I (Test-First, non-negotiable) and SC-003 ask for them. Within
every phase the test tasks come first and must be shown failing before the implementation tasks
that follow them. Where a test could pass before its implementation exists (it guards behaviour
that already holds), the task says so and names the deliberate break that must turn it red once;
that evidence goes in the PR body (T062).

**Organization**: by user story, in priority order: US1, US2, US5 (all P1), then US3, US4 (P2).
Phase records and the main session's start and stop are built in US1, because the US1 live check
(L2, L4) and US2's all-kinds consumer test need them (audit finding H2).

**Base**: this plan sits on commit b9b0dc3 (research R16): subagents report through
`SubagentHandback`, the gate exempts it, and spec-auditor's verdict is read on PreToolUse
`SubagentHandback` and on Stop. No new command hook is added by this feature.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: touches only files no other task in the same group touches, and depends on no
  unfinished task in that group. Safe to hand to parallel implementers in separate worktrees.
- **[Story]**: US1 to US5, from spec.md. Setup, Foundational and Polish tasks have none.
- Test files follow the repo's patterns: `test/*.test.mjs` (run by `npm test`) and
  `mod/speckit-activity/test/*.test.ts` (run by `claude plugin test`; never under `test/`, because
  Node 26 runs `.test.ts` there, research R13).

## Path conventions

Repository root: `hooks/`, `install.mjs`, `test/`, `bench/`, `mod/speckit-activity/`, `README.md`,
`CLAUDE.md`. Layout in [plan.md](plan.md) "Project Structure".

---

## Phase 1: Setup

**Purpose**: settle the unverified platform facts, and create the empty mod so its tests can run.

- [ ] T001 Live spike for research V1 to V11 with a throwaway mod outside the repo (not committed): a plugin folder `skills/speckit-spike/` in a scratch `CLAUDE_CONFIG_DIR` if the session can authenticate there, otherwise in `~/.claude/skills/speckit-spike/`, deleted afterwards, whose `register.tsx` logs `session.start`, `session.end` (`reason`, and whether a `$.process.run` of a script that appends one line to a file, started there, completes within `next.budget`), `tool.call` (`agentId`), `classic.SubagentStart` (`agent_id`, `cwd`, including for an `isolation: "worktree"` subagent) and `turn.complete` (`agentId`), and runs `$.process.run(['node', '<abs path>/x.mjs'], { stdin })`; compare `agent_id` with a frontmatter command hook's; make a lane-style Stop hook block once and see whether `turn.complete` fires for the refused stop (V8); end sessions with `/exit`, Ctrl-D and `/clear` and note which `session_id` main-loop events carry after `/clear` (V10); log the `hook_event_name` a frontmatter Stop hook receives in a subagent and with `claude --agent <name>` (V11); run `claude plugin test` on a folder with `test/a.test.ts` that reads `performance.now()` and `Date.now()` (V7); set a `userConfig` field, find the debug log file, and compare `$.clock.now()` with the system clock over 10 s (V9). Record each result (date, Claude Code version, what was observed) in the "Live verification log" table of `specs/001-agent-activity-feed-and-pane/research.md`, then apply that table's rule for each failed answer: **stop** for V1, V2, V3, V4, V5 (owner decision 2026-10-06: no weakened US4 S2), V8, or V10 when `session.end` never fires on `/exit` (hand back to architect: the change touches plan.md or the contracts and voids the audit); **fallback** for V6 (tests and fixture move to the plugin root, task paths change), V7 (mean bound or "not run" in T037) and V10 when only the budget is too short (stop written at the next session's start, T026 adapts); V9 and V11 never stop (V9's failure makes quickstart L9 "not run" and a follow-up issue in T061).
- [ ] T002 [P] Create the mod skeleton: `mod/speckit-activity/.claude-plugin/plugin.json` (name `speckit-activity`, version `0.1.0`, description, `userConfig.latencyLog` boolean default `false`), `mod/speckit-activity/hooks/hooks.json` (`{"modules":["./register.tsx"]}`), `mod/speckit-activity/hooks/register.tsx` (line 1 the comment `// speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.`, `const HOOK = '{{HOOK}}'`, an empty `register: Register`), `mod/speckit-activity/types/index.d.ts` (PluginState `'speckit-activity': { model: ActivityModel; now: number; faults: string[] }` and the exported `ActivityModel` type per data-model.md "View state"). `claude plugin validate mod/speckit-activity` must pass.
- [ ] T003 [P] Add scripts to `package.json`: `"validate:mod": "claude plugin validate mod/speckit-activity"`, `"test:mod": "claude plugin test mod/speckit-activity"`, `"bench": "node bench/overhead.mjs"`. Leave `"test"` as `node --test test/`.
- [ ] T004 [P] Test runner bridge in `test/mod.test.mjs`: two tests that spawn `claude plugin validate mod/speckit-activity` and `claude plugin test mod/speckit-activity` from the repo root (spawn `claude` by name with an argv array; it is `claude.exe` on this machine, and a `.cmd` shim elsewhere needs `shell: true` on Windows), assert exit 0 and include stdout and stderr in the failure message; each is `skip`ped with the reason "claude not on PATH" when `claude --version` fails. Covers constitution I (mod behaviour under `npm test`) and quality gate 2.

**Checkpoint**: research V1 to V11 answered and no stop rule triggered; the empty mod validates; `npm test` runs the mod bridge.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the one writer, `observer-fault` records, the `emit` relay mode, safe input handling with a defined no-decision path, the guarded import, and installing the new hook module.

### Tests (write first, show failing)

- [ ] T005 [P] In `test/hook.test.mjs` add "every mode makes no decision on empty, malformed and unknown input" (contracts/emit-cli.md "input handling"): for `scope only specs/`, `scope tests`, `scope no-tests`, `gate`, `verdict`, `lane tests`, `lane no-tests`, feed stdin `''`, `'{not json'`, `'[]'`, `'{}'` and `{"hook_event_name":"NoSuchEvent"}`, in a Spec Kit repo and outside one; assert exit 0 and empty stdout every time; and that `lane` and `verdict` given a `Stop` event (as an agent run with `claude --agent` sends) decide exactly as for `SubagentStop`, with no `observer-fault` (audit finding M4); in the Spec Kit repo assert exactly one new `observer-fault` record per call with cause `input-invalid:<mode>` (the first three) or `input-unknown-event:<mode>` (the last two), `mode` set, and none of the input text in it; outside, no `speckit-team/` directory. Red today: `'{not json'` crashes every mode, `gate` denies on `'{}'`, `verdict` blocks on `'{}'` (research R14). Covers FR-019, FR-018, constitution II, audit finding H1 and the spec edge case "malformed, empty or unknown hook input".
- [ ] T006 [P] Create `test/activity.test.mjs` (reuse the throwaway-repo pattern of `test/hook.test.mjs`): pipe envelope lines (contracts/emit-cli.md) into `node hooks/speckit-team.mjs emit` and read `<git common dir>/speckit-team/activity/*.jsonl`. Assert: one record per valid envelope; every common field of data-model.md with the right type, `schema` `"1.0"`, unique `id`, the envelope's `ts`, `source` `"mod"`, `worktree` `"."` (FR-002); an `implementer` record has `agent.team` true, `feature` `"specs/001-demo"`, `phase` `"green"`, and `feature` `"unknown"` once `.specify/feature.json` is deleted (FR-003); an envelope without `agent_id` gives `agent.id` `main:<session_id>`, name `main`, team false, `feature` and `phase` null (FR-004); `activity` per the data-model label table for Read, Edit, Bash, Grep, Agent, SubagentHandback (`other`) and `mcp__x__y` (FR-009); a `file_path` inside the repo given in Windows form (via `path.join` on win32) and POSIX form becomes `src/a.js`, one outside the repo becomes `null` (FR-020); an `observer-fault` envelope becomes an `observer-fault` record with its `cause` and `mode`; stdout is `{"written":n,"skipped":m,"faults":[]}`; malformed lines and unknown kinds are skipped, counted, and produce one `envelope-invalid` `observer-fault` record per batch, and empty stdin prints `{"written":0,"skipped":0,"faults":[]}` (FR-019); `.specify/activity.json` `{"enabled": false}` writes nothing (contracts/config.md); every line is at most 4096 bytes and ends in `\n`.
- [ ] T007 [P] Create `test/privacy.test.mjs`: run `emit` and every guardrail mode with the marker `PRIVACY_MARKER_7f3a` placed in `tool_input.command`, `tool_input.content`, `tool_input.new_string`, `tool_input.old_string`, the `SubagentHandback` `tool_input.message` seen by `verdict`, `prompt`, `last_assistant_message`, malformed stdin, an environment variable of the spawned process, and a file under the repo; then scan every byte of the activity directory: 0 occurrences of the marker, of `os.homedir()` in either slash style, and of any drive-letter or leading-`/` path (SC-006, FR-008). With `fields.command: true` a Bash `tool` record carries `command`, cut to 200 characters; with `fields.description: true` an `agent-start` carries `description`; with defaults neither key exists (FR-009). Before T022 the guardrail half finds no records and passes without proving anything; after T022, break the record builder once (copy `tool_input.command` into the `decision` record) and show this test red (audit finding M7).
- [ ] T008 [P] In `test/install.test.mjs` add: after install, `<claude dir>/hooks/speckit-activity.mjs` exists, carries the `speckit-agents: managed` marker and no `{{HOOK}}`; running the installed `speckit-team.mjs emit` with empty stdin from `os.tmpdir()` exits 0 and prints `{"written":0,"skipped":0,"faults":[]}`; `--uninstall` removes `hooks/speckit-activity.mjs`. Covers FR-021 and contracts/installed-files.md.
- [ ] T009 [P] Create `test/isolation.test.mjs` (audit finding C2, FR-017, constitution II): copy `hooks/speckit-team.mjs` into temp hook directories (a) without `speckit-activity.mjs`, (b) with a `speckit-activity.mjs` that throws while loading, (c) with one whose exports throw when called; in a Spec Kit repo run the guardrail matrix (scope allow and deny, gate block and allow, verdict on handback and on stop, lane clean and violations) against each and against the intact pair; assert every stdout and exit code equals the intact pair's, all exit 0; and `emit` prints a fault `activity-module-failed:ERR_MODULE_NOT_FOUND` for (a) and `activity-module-failed:Error` for (b) and (c); and after a guardrail run in (a), the fault file (data-model.md "Fault file", in a temp dir the test points `TMP`/`TMPDIR`/`TEMP` at) holds `activity-module-failed:ERR_MODULE_NOT_FOUND`, written by `speckit-team.mjs` itself (audit finding M6). Variant (c) only exercises recording once T022 lands; it can pass before that, so after T022 break the guard once (call the export outside the `try`) and show it red.

### Implementation

- [ ] T010 Create `hooks/speckit-activity.mjs` (marker on line 2, as in `hooks/speckit-team.mjs`): config loading with per-key defaults and validation (contracts/config.md); team set and agent-to-phase table; activity label table; repo top level, git common dir and `worktree` resolution; path normalisation to repo-relative forward slashes; record builder from an allow-list of fields only (data-model.md), including `observer-fault` with a fixed message per cause; the 4096-byte cap; writer that picks the greatest segment, creates a new one with `wx` when needed (research R3) and appends each batch with one `appendFileSync`. Export what `speckit-team.mjs` needs. No retention, phase records or fault file yet (T033, T023, T038).
- [ ] T011 In `hooks/speckit-team.mjs`: parse stdin inside `try`/`catch` (research R14); add the `emit` mode per contracts/emit-cli.md, loading `./speckit-activity.mjs` with a dynamic `import()` inside `try`/`catch` after the `.specify/` check, always printing the status JSON (with `activity-module-failed:<code ?? name>` when the import or a call fails) and exiting 0; on any failed import or call, in any mode, append `activity-module-failed:<code ?? name>` to the fault file with a few lines of stdlib code in `speckit-team.mjs` itself, inside its own `try`/`catch` (data-model.md "Fault file", audit finding M6). Update the header comment's mode list.
- [ ] T012 In `hooks/speckit-team.mjs`: give every mode the no-decision path of contracts/emit-cli.md for empty, unparsable or non-object stdin and for events it is not wired to, with explicit checks in `gate` (accept only `PreToolUse` and `UserPromptExpansion`) and `verdict` (accept only `PreToolUse` with `SubagentHandback`, `SubagentStop` and `Stop`), and `lane` accepting `SubagentStop` and `Stop` (audit finding M4), so none decides on `{}`; in a Spec Kit repo write the `observer-fault` record through the guarded import (audit finding H1).
- [ ] T013 [P] In `install.mjs`: add `hooks/speckit-activity.mjs` to `files()`; extend the smoke check to run the installed hook's `emit` with empty stdin from the temp directory and require exit 0 and parseable JSON.

**Checkpoint**: `npm test` green for T005 to T009; envelopes become records; malformed input is visible and decides nothing; a broken activity module changes no decision.

---

## Phase 3: User Story 1 - See who is doing what while the pipeline runs (Priority: P1) MVP

**Goal**: the summary line and the `/speckit-activity` panel show every agent, its activity, feature and phase, recent denials and the latest verdict, from guardrail records and relayed activity, including the main session and phase changes.

**Independent Test**: install, run a pipeline in a Spec Kit repo, watch the status line and the pane (quickstart L1 to L5). No outside consumer needed.

### Tests for User Story 1 (write first, show failing)

- [ ] T014 [US1] Create the fixture `mod/speckit-activity/test/fixtures/pipeline.jsonl`: schema-1.0 records per data-model.md for a full pipeline: main session `agent-start`; product-owner, architect, spec-auditor, test-writer, implementer, spec-gatekeeper with `agent-start`, `tool` and `agent-stop` (`final: true`); `phase` records `specify` to `verify`; an architect `decision` `deny` on `src/app.js`; `gate` `block` (`no-verdict`) then `allow`; `verdict` `FAIL` then `PASS` (`via: "handback"`); `lane` `violations` (`final: false`) then `clean`; 3 `implementer` instances with distinct `agent.id` in worktrees `.`, `../wt1`, `../wt2`; an `Explore` non-team agent; one `observer-fault` (`input-unknown-event:gate`); after one agent's `agent-stop`, one of its records placed later in the file but with an earlier `ts`, and one with a later `ts` (neither may reactivate it, M3); one record carrying an unknown extra field and one record of an unknown `kind` (`future-kind`). Shared by T017 to T020 and checked against the producer by T031.
- [ ] T015 [P] [US1] Create `test/observe.test.mjs`: drive the guardrail modes as `test/hook.test.mjs` does and read the stream. Assert one record per decision with the fields of data-model.md: `scope only specs/ CLAUDE.md` gives `decision` `allow` for `specs/...` and `deny` for `src/main/App.java` with `tool` and `path` (FR-001, US1 S3); `scope tests` and `scope no-tests` denials name their rule; `gate` records `block` with causes `no-verdict`, `verdict-fail`, `stale-audit` and `allow` after PASS, with `trigger` `tool`, `skill` and `command` (FR-001), and no `gate` record for a `SubagentHandback` call (exempt since b9b0dc3); `verdict` on PreToolUse `SubagentHandback` with `VERDICT: FAIL` then `PASS` in `tool_input.message` gives `verdict` records with `via: "handback"`, and on SubagentStop with `last_assistant_message` gives `via: "stop"`, each with a 16-hex `fingerprint` (US1 S4); a handback without the line gives `decision` `verdict-line` `deny`, the same agent's second one `allow`, and a stop without it `block`; `lane` records `violations` (paths, `pathCount`, `final: false`), the second stop `final: true`, `clean`, and `unchecked` with no start point (US1 S5); `agent.id` is the input's `agent_id`, or `main:<session_id>` with name `main` without one (FR-002); each mode's stdout is unchanged from the existing tests' expectations. SC-001: a scripted run (scope deny, gate block, verdict FAIL, verdict PASS, gate allow, lane violations, lane clean) has exactly one record for each denial, gate outcome, verdict and lane check.
- [ ] T016 [P] [US1] In `test/activity.test.mjs` add phase records (US3 S2, research R6, needed by the US1 phase indicator): `agent-start` of product-owner then architect gives `phase` records `specify` (`previous` null) then `plan` (`previous` `specify`), each written before its agent-start; a second architect start gives no new phase record; 3 implementer starts in one batch give exactly one `green` phase record; a main-session `agent-start` gives none.
- [ ] T017 [P] [US1] Create `mod/speckit-activity/test/relay.test.ts` (`claude-code/testing`; the test's own `on` answers `process.run` for `git rev-parse` and for `emit`, `fs.exists` for `.specify`, `fs.read` for `.specify/activity.json`; `mock.clock`). Producer: a main-session `tool.call` and a subagent `tool.call` lead, after 100 ms, to one `process.run` with argv `['node', HOOK, 'emit']` whose stdin lines are envelopes with `kind: 'tool'`, `tool`, `file_path`, `agent_id` (subagent only), `session_id`, `cwd`, `ts` (FR-001, FR-004); a subagent's tool envelopes carry the `cwd` its `classic.SubagentStart` carried, and the session cwd for an agent with no start seen (audit finding M4); `session.start` queues the main session's `agent-start`, `session.end` its `agent-stop` (FR-004); `turn.complete` with `agentId` gives that agent's `agent-stop`, without `agentId` nothing (research R2); no `command` field by default and the field present with `fields.command: true` (FR-008, FR-009); one agent's envelopes arrive in the order start, tools, stop (US2 S1); a burst of 50 calls while an `emit` is in flight gives one more `emit`, never two at once; the test's beneath `tool.call` hook is reached before the mod makes any `fs.*` or `process.*` call in that dispatch (FR-017, constitution III); a `SubagentHandback` call reaches beneath with its input unchanged and no envelope contains its `message` (R16). Partial and malformed input (audit finding C2, FR-019): `tool.call` with no tool fields, and with `file_path` a number, still reaches beneath once, unchanged, and queues an envelope without `file_path`; `classic.SubagentStart` without `agent_id` queues no `agent-start` but an `observer-fault` envelope `input-invalid:SubagentStart`, and without `cwd` uses the session cwd; `turn.complete` with an `agentId` never started still gives an `agent-stop` with the session cwd; `session.start` where `git rev-parse` rejects, exits 128, or prints one line leaves the mod inert (no status, no command, no `emit`) and returns `next(e)`'s result; a `.specify/activity.json` that is not JSON gives defaults (enabled, no `command` field) and one toast for `config-invalid`. Failures: `emit` rejecting, exiting 1, printing non-JSON, or printing `faults` gives one `ui.toast` per distinct cause per session with the exact text of contracts/view.md and none for a repeat, and tool calls keep reaching beneath (FR-018, US5 S2). Outside Spec Kit (`fs.exists` false) there is no `emit`, no `ui.status` and no `command.register` (FR-012, FR-022, SC-008). Ordering at start (audit finding M3, FR-022): `session.start` resolves with `next(e)`'s result before any `process.run` for `git` is dispatched (the test's beneath `process.run` hook records the order), in a Spec Kit repo and outside one. `session.end` (audit findings C2, H2): it queues the main session's `agent-stop` and flushes it, so the beneath `process.run` for `emit` receives that envelope before `session.end` resolves; with `$.session.id()` rejecting it uses the id seen at start; with the beneath `emit` never resolving it still resolves within `next.budget` (mocked) and returns `next(e)`'s result, without throwing; in an inert mod it only calls `next(e)`. Main-session start after `/clear`: `session.end` with `reason: 'clear'` and then a main-loop `tool.call` queue `agent-stop`, then `agent-start` for main, then the `tool` envelope. Mod faults as records (audit finding M6): `emit` rejecting, a `fs.list` rejecting with `ENOTDIR`, a malformed config and a throwing render each queue an `observer-fault` envelope with that cause, delivered by the next `emit` that succeeds; past 1000 queued envelopes the oldest are dropped and one `relay-overflow` envelope says how many.
- [ ] T018 [P] [US1] Create `mod/speckit-activity/test/follow.test.ts`: the test's `fs.list` and `fs.read` hooks serve the fixture split into two in-memory segments: history is read at start; bytes appended to a segment show on the next poll; a trailing line without `\n` is held until completed; a new segment is followed; a deleted segment's cursor is dropped with no error; an unparsable line is skipped (FR-007, consumer side); every path the mod reads is under the stream directory or `.specify/` (FR-016); the fixture's `observer-fault` record raises one toast with the exact text of contracts/view.md, and the summary ends `observer: 1 problem(s)` (FR-018); `fs.list` rejecting with `ENOTDIR` raises one toast for `stream-unreadable:ENOTDIR` and none on the next polls; with `mock.clock`, 100 records appended one per 300 ms each change the status line or pane within 1000 ms of mocked time after being appended (SC-002, FR-014); with `latencyLog: true` (test options), each newly read record produces exactly one `ui.log` with `to: 'debug'` and the text `speckit-activity lag <ms> <kind> <id>`, where `<ms>` is the mocked clock at the poll minus the record's `ts`, and with the option off none (audit finding M8; quickstart L9 parses this line).
- [ ] T019 [P] [US1] Create `mod/speckit-activity/test/summary.test.ts` (capture `ui.status` with the test's own hook): an empty stream gives `speckit: idle, 0 agents | last phase none | verdict none` (US1 S1); the fixture mid-run gives agent count, phase, feature short name, verdict and `1 denied` in the format of contracts/view.md, the main session not counted (FR-012); after every agent stops, `speckit: idle, 0 agents | last phase verify | verdict PASS` (US1 S1); an agent with no record for 121 s of mocked time is counted as stale (FR-013); a finished agent stays finished when a record of it follows in the file with an earlier `ts` or arrives with a later `ts`, and becomes active again only with a new `agent-start` with a later `ts` (audit finding M3, data-model.md "AgentInstance"); `enabled: false` and a repo without `.specify` give no status at all (FR-012, SC-008).
- [ ] T020 [P] [US1] Create `mod/speckit-activity/test/pane.test.ts`: `command.run` for `speckit-activity` answers `Agent activity pane opened.` and opens pane id `speckit-activity` (FR-012), also when the input carries no arguments or unexpected extra fields; `command.run` for another command name (`compact`, `other-plugin-cmd`) reaches the test's beneath hook with its input unchanged and opens no pane (audit finding H2); for each surface in `['terminal', 'desktop', 'vscode', 'mobile']` mount the `Pane`: with only the main session's `agent-start` it shows exactly one agent row, `main` (quickstart L2); with the fixture loaded: a row per agent with `name#xxxx`, `team` or `other`, activity label and path, feature short name, phase and age (FR-012, US1 S2); a `DENY` line naming architect, rule and `src/app.js`, asserted by text so colour is not needed (US1 S3, FR-015); `PASS` against the feature (US1 S4); a `done` row with `lane clean` and one with `lane VIOLATIONS` (US1 S5); 3 implementer rows with 3 distinct `#xxxx` suffixes (FR-014, SC-007); `STALE` after 121 s of mocked time (FR-013); an Observer line for the fault; with `bodyColumns` 40 and `bodyRows` 6 the tree validates, rows are truncated not wrapped, and the summary counts line plus the newest items are shown (spec edge case "terminal too narrow"); a model that makes drawing throw shows one line naming the problem and toasts `render-failed` once (FR-018).
- [ ] T021 [P] [US1] In `test/install.test.mjs` add: install puts `skills/speckit-activity/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx` (with the marker) and the other mod modules under `<claude dir>`, with every `{{HOOK}}` replaced by the absolute forward-slash hook path and no `test/` folder installed; a second install reports no `install`/`update`; `--uninstall` removes `skills/speckit-activity/`; an existing `skills/speckit-activity/` without the marker makes install fail with nothing written, and `--force` backs it up and replaces it (FR-021, contracts/installed-files.md).

### Implementation for User Story 1

- [ ] T022 [P] [US1] In `hooks/speckit-team.mjs`: append the `decision`, `gate`, `verdict` and `lane` records of contracts/emit-cli.md at each decision point through the guarded import, before the decision is printed, never changing stdout or the exit code; `verdict` on both paths with `via`, and the `verdict-line` `deny`/`allow`/`block` decisions; no record for the exempt `SubagentHandback` gate call; skip writing when `enabled` is false.
- [ ] T023 [P] [US1] In `hooks/speckit-activity.mjs`: phase state in `<git common dir>/speckit-team/phase.json` keyed by feature, and `phase` records written before a team `agent-start` whose phase differs from the feature's last (research R6).
- [ ] T024 [P] [US1] Create `mod/speckit-activity/hooks/stream.ts`: locate the stream from the `git rev-parse` output, poll with `$.fs.list`, read changed segments with `$.fs.read(path, { as: 'bytes' })` from the byte cursor, consume to the last `\n`, drop cursors of deleted segments, skip unparsable lines, report `stream-unreadable:<code>` (contracts/activity-stream.md).
- [ ] T025 [P] [US1] Create `mod/speckit-activity/hooks/fold.ts`: fold records into the `ActivityModel` of `types/index.d.ts` with the state rules of data-model.md "AgentInstance" (ordering by `ts`, finished terminal, 120 s stale), latest activity, lane per agent, latest 8 non-allow decisions, allow counters, verdict per feature, current and last completed phase, fault causes from `observer-fault` records; ignore unknown kinds and fields; produce the summary text of contracts/view.md.
- [ ] T026 [P] [US1] Create `mod/speckit-activity/hooks/relay.ts`: envelope queue (synchronous push, no `$` call; bounded at 1000 with a `relay-overflow` fault), the `agent_id -> cwd` map from `classic.SubagentStart`, main-session start (at session start, and before the first main-loop event with no open main run) and stop (at `session.end`, flushed in a race with `next.budget`, contracts/view.md), `agent-stop` from `turn.complete`, `observer-fault` envelopes for partial input and for the mod's own faults (audit finding M6), opt-in fields and `config-invalid` from `.specify/activity.json`, flush every 100 ms with at most one `$.process.run(['node', HOOK, 'emit'], { stdin })` in flight, poll right after each flush, parse the status JSON, and toast each fault cause once per session with the text of contracts/view.md, keeping shown causes in `$.state`.
- [ ] T027 [P] [US1] Create `mod/speckit-activity/hooks/view.tsx`: the Pane tree of contracts/view.md from `$.ui.resolve(e)` `Box` and `Text` only, sized to `e.props.bodyColumns` and `scroll.bodyRows`, words for every state, the main session row, the Observer section, narrow and short layouts, drawing wrapped in `try`/`catch` with a one-line fallback.
- [ ] T028 [US1] Wire `mod/speckit-activity/hooks/register.tsx`: `session.start` (return `next(e)`'s result first; from a `$.clock.after(0)` timer detect Spec Kit, `enabled` and a usable `git rev-parse`, else stay inert; then register `/speckit-activity` with `immediate: true`, start the 100 ms relay, 250 ms poll and 1 s clock timers and queue the main session's start; audit finding M3), `session.end` (queue its stop and flush within `next.budget`, contracts/view.md), `tool.call` (push, then `return next(e)`), `classic.SubagentStart` and `turn.complete` (push, then `next(e)`), `command.run` with the matcher `{ command: 'speckit-activity' }` (open the pane), `ui.render` on `{ component: 'Pane', requestId: 'speckit-activity' }`, and `$.ui.status` updates only when the text changes; `latencyLog` debug lines per contracts/view.md. Depends on T024 to T027.
- [ ] T029 [P] [US1] In `install.mjs`: install the mod's files (not `test/`) from `mod/speckit-activity/` into `<claude dir>/skills/speckit-activity/` with `{{HOOK}}` rendering, treat the folder as owned when `hooks/register.tsx` carries the marker, include it in the collision check and in `--uninstall` (contracts/installed-files.md).
- [ ] T030 [US1] Live check, constitution II: install into the real Claude config, then run quickstart L1 to L5 and L12 (the main session's stop on `/exit`, Ctrl-D and `/clear`; audit finding C2) in a scratch Spec Kit repo with `claude --debug`; record date, Claude Code version, what was done and what was observed for each in `README.md` "Verifying".

**Checkpoint**: US1 works on its own: status line and pane show the pipeline live, with the main session and phases.

---

## Phase 4: User Story 2 - Any outside tool can consume agent activity (Priority: P1)

**Goal**: the stream is documented well enough that a consumer written from the README alone works, follows live without gaps or duplicates, resumes from a saved cursor, and survives retention.

**Independent Test**: the README's reference consumer, run by `test/stream.test.mjs` against a scripted run, and live in quickstart L11.

### Tests for User Story 2 (write first, show failing)

- [ ] T031 [P] [US2] Create `test/stream.test.mjs`. SC-003, FR-005: extract the fenced code block that follows the line `<!-- reference-consumer -->` in `README.md`, write it to a temp file, run it as `node consumer.mjs <repo> --once` after a scripted run that produces all 9 record kinds (`emit` envelopes including a main-session start and an `observer-fault`, team agent starts that produce `phase` records, plus the guardrail modes), and assert it prints one `<kind>\t<id>` line per record and covers 100% of the FR-001 kinds. FR-005: every field name in the emitted records, nested `agent.*` included, appears in the README's record tables. FR-006: the README states that unknown fields, kinds and values must be ignored and that a removal, rename or retype is a major version change. M7: the README's stream section states the agent-state rules of data-model.md "AgentInstance" (order by `ts`, `agent-stop` terminal, 120 s stale). US2 S2: a stream with an extra unknown field and an unknown kind is consumed without error. FR-007, US2 S3: with `retention.segmentBytes` 4096, start the consumer with `--cursor <file>` after 50 records, write 400 more across several segment rotations, stop it midway and restart it with the same cursor file, and assert the set of `id`s received equals the set written with none twice; each agent's lines come in the order start, tools, stop (US2 S1). Fixture drift: each kind's key set in `mod/speckit-activity/test/fixtures/pipeline.jsonl` equals the producer's for that kind. US2 S4, FR-010: `hooks/*.mjs` import, statically or with `import()`, only `node:fs`, `node:path`, `node:child_process`, `node:crypto`, `node:os`, `node:url` and relative paths that resolve inside `hooks/` (so `speckit-team.mjs`'s `import('./speckit-activity.mjs')` is allowed, audit finding M9), and the mod's sources contain no `$.http`.
- [ ] T032 [P] [US2] Create `test/retention.test.mjs` (FR-011), writing through `emit` unless stated: with `segmentBytes` 4096 and `maxBytes` 65536, write more than 200 KB and assert the directory stays within `maxBytes` plus one segment, segments are removed oldest name first and the newest is never removed; segments with modification time set 8 days back (`fs.utimesSync`) are removed, except one holding a record of a session in the relayed batch; `maxAgeDays: 1` is honoured; an undeletable entry (a directory named like a segment) does not stop writes and produces one `observer-fault` record `retention-failed:<code>`. Guardrails never delete (audit finding M2): with the directory over `maxBytes` and the newest segment full, 20 guardrail runs start a new segment but leave every older segment in place, and the next `emit` brings the directory back under the cap. UTC-day rollover (audit finding L2): with the newest segment named for the previous UTC day, the next write starts a new segment and the next `emit` runs retention. `segmentBytes` greater than `maxBytes` in `.specify/activity.json` gives a `config-invalid` record and segments no larger than `maxBytes` (audit finding L4).

### Implementation for User Story 2

- [ ] T033 [US2] In `hooks/speckit-activity.mjs`: retention run from `emit` only, when the newest segment changed or a UTC day passed (state in `retention.json`), never from a guardrail mode; the UTC-day segment rollover; the `segmentBytes <= maxBytes` rule; `retention-failed:<code>` faults as `observer-fault` records (research R5, data-model.md "Segment and Store").
- [ ] T034 [P] [US2] In `README.md` add the section "Activity stream": location, segment files, the read-then-follow algorithm, "Deriving agent state" (contracts/activity-stream.md, audit finding M7), the common-field table and one table per kind (every field, type, meaning, from data-model.md), the activity label table, the fault causes and the fault file, versioning and ignore-unknown rules, locality and privacy with the two opt-in fields, retention and the `.specify/activity.json` table (contracts/config.md), a stream changelog (`1.0`), and the reference consumer: a Node stdlib script after a line `<!-- reference-consumer -->` taking `<repo> [--once] [--cursor <file>]`, following per contracts/activity-stream.md, saving the cursor map after every pass when `--cursor` is given, and printing `<kind>\t<id>` per record.
- [ ] T035 [US2] Live check: quickstart L11 with the reference consumer copied out of the README; record the result in `README.md` "Verifying".

**Checkpoint**: a consumer built from the README works without reading source.

---

## Phase 5: User Story 5 - Observation never harms the work (Priority: P1)

**Goal**: identical guardrail decisions whether observation works, is off or is broken; failures visible once; no cost outside Spec Kit; overhead measured against the 10 ms budget.

**Independent Test**: `test/safety.test.mjs` decision matrix, `bench/overhead.mjs`, quickstart L8.

### Tests for User Story 5 (write first, show failing)

- [ ] T036 [P] [US5] Create `test/safety.test.mjs`. SC-004, FR-017, US5 S1: run a matrix of guardrail inputs (scope only, tests, no-tests, allowed and denied; gate blocked and allowed by tool, skill and typed command, and the exempt `SubagentHandback`; verdict on handback and stop, missing, PASS, FAIL; lane clean, violations, second stop) three ways: observation on, `.specify/activity.json` `{"enabled": false}`, and `<git common dir>/speckit-team/activity` replaced by a regular file; assert stdout bytes and exit codes are identical across the three for every input. FR-018 (writer side): with the regular file in place, `emit` exits 0 and its `faults` contain `stream-unwritable:EEXIST` (or `ENOENT`, data-model.md "Fault causes") with a growing `count`; a malformed `.specify/activity.json` gives a `config-invalid` `observer-fault` record and default behaviour; with the fault file pre-seeded with 50 causes in its documented format (temp dir redirected by `TMP`/`TMPDIR`/`TEMP`), a new `stream-unwritable` cause leaves exactly 50, the new one present and the one with the oldest `lastAt` gone (audit finding L2). SC-008, FR-022, US5 S3: in a git repo without `.specify/`, every guardrail mode prints 0 bytes, `emit` with envelopes whose `cwd` is that repo reports them skipped, and no `speckit-team/` directory is created. The identical-output assertions can pass before T039 if T022 is already careful; break it once (print a `systemMessage` when the append fails) and show the test red (audit finding M1).
- [ ] T037 [P] [US5] Create `mod/speckit-activity/test/overhead.test.ts` (SC-005, FR-017, research R9): drive 100 `$.tool.call`s through the mod with observation active; time call-to-beneath per call with `performance.now()` when research V7 says it is wall time, and print median and p90 and assert the median is at most 2 ms; if only `Date.now()` is wall time, time the 100 calls together and print and assert the mean per call (labelled as a mean bound); otherwise skip the timing with the reason. Always assert that no `fs.*` or `process.*` dispatch from the mod happens before the beneath hook is reached. Red evidence (M1): add an awaited `$.fs.exists` before `next(e)` in the `tool.call` hook once and show the structural assertion fail, and a 5 ms busy wait and show the timing fail.

### Implementation for User Story 5

- [ ] T038 [US5] In `hooks/speckit-activity.mjs`: the fault file of data-model.md (`<os.tmpdir()>/speckit-team-faults/<16 hex>.json`, at most 50 causes with the oldest `lastAt` dropped, count and first/last time) for `stream-unwritable:<code>`, in the same format `speckit-team.mjs` uses for `activity-module-failed` (T011); every writer, config and retention error caught; fault-file causes returned for `emit`'s status JSON.
- [ ] T039 [US5] In `hooks/speckit-team.mjs`: make the T036 matrix pass: every observation call inside `try`/`catch`, no observer path able to change stdout, the exit code or the order of the decision, and `emit` reporting the faults from T038.
- [ ] T040 [P] [US5] Create `bench/overhead.mjs` per research R9: the baseline arm is the base commit's hook (`git show <base>:hooks/speckit-team.mjs`, `--base` defaulting to `b9b0dc3`, printed), which has no activity code; the treatment arm is today's `hooks/speckit-team.mjs` with `speckit-activity.mjs` beside it (audit findings H4, M1); run 100 alternating pairs of `gate` on `PreToolUse Read` in a throwaway Spec Kit repo; a second row of 100 pairs where the treatment's newest segment is pre-filled to `segmentBytes` before every run, so each run starts a segment (audit finding M2); and 100 pairs of the early exit in a repo without `.specify/`; print median and p90 of the paired differences per row with Node, git, OS versions and the base commit; exit 1 when either Spec Kit row's median exceeds 8 ms (the 10 ms budget less the mod's 2 ms share) or the non-Spec-Kit median exceeds 2 ms.
- [ ] T041 [US5] Run `node bench/overhead.mjs` and `claude plugin test mod/speckit-activity` on Windows; record the hook-side medians of all three rows, the mod-side median or mean bound (and which), the total against the 10 ms budget, date and versions in `README.md` "Verifying"; state macOS and Linux as "not run" (SC-005).
- [ ] T042 [US5] Live check: quickstart L8 (unwritable destination: same denial, the two toasts `stream-unwritable:EEXIST` or `ENOENT` and `stream-unreadable:ENOTDIR` once each); record the result in `README.md` "Verifying".

**Checkpoint**: breaking the stream changes no decision; the user is told once per cause.

---

## Phase 6: User Story 3 - Observe agents outside the Spec Kit team (Priority: P2)

**Goal**: built-in and third-party subagents appear in feed and view, marked non-team; the phase indicator follows the pipeline. (Main-session records and phase records were built in US1.)

**Independent Test**: an `Explore` subagent appears as `other` with no phase (quickstart L6); phases advance as team agents start (L4).

### Tests for User Story 3 (write first, show failing)

- [ ] T043 [P] [US3] In `test/activity.test.mjs` add: `Explore` and `general-purpose` envelopes give `agent.team` false, `feature` null, `phase` null, and no `phase` record on their start (FR-004, US3 S1).
- [ ] T044 [P] [US3] In `mod/speckit-activity/test/pane.test.ts` add: the `Explore` row reads `other` with no phase or feature (US3 S1); a new `phase` record changes the panel's Phase section and the summary's phase, and a non-team agent's start does not (US3 S2).

### Implementation for User Story 3

- [ ] T045 [US3] In `mod/speckit-activity/hooks/fold.ts` and `mod/speckit-activity/hooks/view.tsx`: `other` marking and the Phase section from `phase` records, until T043 and T044 pass (T043 may already pass after T010; if so, break the team test once and show it red).
- [ ] T046 [US3] Live check: quickstart L6, and the phase rows of L4; record in `README.md` "Verifying".

**Checkpoint**: non-team work is visible and labelled; phases advance.

---

## Phase 7: User Story 4 - Parallel agents stay distinguishable (Priority: P2)

**Goal**: concurrent same-type agents and worktrees are told apart in every record and row.

**Independent Test**: 3 implementers at once give 3 rows and 3 identities (quickstart L7).

### Tests for User Story 4 (write first, show failing)

- [ ] T047 [P] [US4] Create `test/parallel.test.mjs`: 3 concurrent `emit` processes for 3 `implementer` agent ids, 50 `tool` envelopes each, plus concurrent `gate` invocations: every line parses, the 150 tool records split 50/50/50 by `agent.id`, and each agent's own order is intact (SC-007, US4 S1); in a `git worktree add` checkout, `emit` envelopes with that `cwd` and a guardrail run there write into the shared common-dir stream with `worktree` set to the checkout's path relative to the main worktree (US4 S2); two sessions in one repo give two `main:<session>` identities (spec edge case "two sessions"). The concurrency part likely passes once T010 exists; break it once (write each record with two `appendFileSync` calls, line then newline) and show interleaved or unparsable lines make it red (audit finding M1).
- [ ] T048 [P] [US4] In `mod/speckit-activity/test/pane.test.ts` add: the 3 implementer rows show their worktree labels `../wt1` and `../wt2` (none for `.`); two sessions' main rows are separate (US4 S1, S2).

### Implementation for User Story 4

- [ ] T049 [US4] In `hooks/speckit-activity.mjs`: `worktree` for linked worktrees, relative to the main worktree's top level derived from the common dir, until T047 passes.
- [ ] T050 [US4] In `mod/speckit-activity/hooks/view.tsx`: worktree labels and per-session main rows, until T048 passes.
- [ ] T051 [US4] Live check: quickstart L7 (3 parallel implementers in worktrees); record in `README.md` "Verifying".

**Checkpoint**: every story works independently.

---

## Phase 8: Polish and cross-cutting

### Tests (write first, show failing)

- [ ] T052 [P] In `test/install.test.mjs` add SC-009 as amended by the owner (2026-10-06), the directory rule and the `settings.json` rules of research R12 and contracts/installed-files.md (FR-021, constitution Installation Constraints "and nothing else", audit finding C1). Fixtures for a pre-existing `settings.json`, each with an unrelated hook and a `permissions.allow` list, chosen so `JSON.stringify` cannot reproduce them: CRLF line endings with 4-space indentation; compact single-line JSON with inline arrays (`{"permissions":{"allow":["Read","Grep"]},"hooks":{...}}`); tab indentation with inline arrays and no trailing newline. For each: (a) install then uninstall leaves `settings.json` byte-identical to the fixture (nothing else changed it), every other pre-existing file byte-identical, and zero files or directories that were not there before: no `*.bak-speckit-agents-*` file at all, no manifest, and the `agents/`, `hooks/` and `skills/` the installer created removed once emptied (red today: two backups are left, and CRLF, inline arrays and compact spacing are rewritten); (b) between install and uninstall, rewrite `settings.json` as another tool would (add a key `"leanCtx": {"x": 1}`, keep the installer's entries, re-indent with 2 spaces and CRLF): after uninstall it parses to the fixture's value plus that key, uses 2 spaces and CRLF, and no backup or manifest is left. Then: (c) no `settings.json` before install (an empty config dir): after install then uninstall the dir is exactly as before, with no `settings.json` and no backup; (d) a config dir where `agents/` and `skills/` already exist and are empty and `hooks/` does not: after install the manifest's `createdDirs` is exactly `["hooks"]`; after uninstall `agents/` and `skills/` still exist and are empty and `hooks/` is removed; (e) install twice: the second install reports every file, the manifest and `settings.json` `unchanged`, takes no second backup and changes nothing, and uninstall still leaves zero files; (f) re-sorted entries: after install, move the installer's `PreToolUse` gate to the front of its array (before an unrelated entry) and its `UserPromptExpansion` event key before the others, then install again: `settings.json` is byte-identical, reported `unchanged`, no backup (red today: entries are removed and re-appended); a stale gate path is replaced at the same index; (g) `--force` over a user's `agents/architect.md`: after uninstall the user's file is back, byte-identical, and no backup of it remains; (h) a user file added to a created directory (`agents/my-agent.md`) keeps that directory and the file; (i) manifest deleted before `--uninstall`: entries removed with the file's indentation and line endings kept, no directory removed, `settings.json` not deleted, no backup taken; (j) a `hooks/speckit-agents.install.json` without the marker makes install fail with nothing written, as for any collision. Messages (audit finding L2): `--help` mentions the activity view and its installed files; the final install message names `/speckit-activity`; the uninstall message names `.git/speckit-team/activity/`. Smoke check (audit finding L2): installing from a copy of the source tree whose `hooks/speckit-team.mjs` prints `not json` in `emit` mode fails the install with exit 1 and that output, after the files were written (as today's `gate` smoke check does).

### Implementation

- [ ] T053 In `install.mjs` (after T013 and T029, which edit the same file): detect and keep the indentation, line endings (LF or CRLF) and trailing-newline state of `settings.json` on every write; update owned gate entries in place, remove stale ones, append missing ones; before writing, note which of `agents/`, `hooks/`, `skills/` and whether `settings.json` do not exist; take the one install-time `settings.json` backup only when a pre-existing file is about to change and none is recorded; record `--force` backups; write the manifest `hooks/speckit-agents.install.json` (`managedBy`, `createdDirs`, `createdSettings`, `settingsBackup`, `forceBackups`, merged across installs) through the same `write()` so a reinstall reports it `unchanged`; treat a manifest without the marker as a collision; extend the smoke check to fail the install when `emit` does not print its status JSON; on `--uninstall` follow contracts/installed-files.md "Uninstall, in order" (restore `--force` backups, settings value without the entries, deleted when created and `{}`, backup bytes written back when its value equals the result, else current formatting kept, never a new backup, then the recorded backup deleted; listed empty directories removed deepest first; no usable manifest: no deletes beyond owned files and entries); update the help header (installs the activity module and the view), the final "Done. Next" lines (`/speckit-activity` in a Spec Kit repo) and the uninstall message (per-repo streams stay in `.git/speckit-team/activity/`) (research R12, constitution VIII).
- [ ] T054 [P] Create `bench/latency.mjs`: in the current repo, send 100 `tool` envelopes through `node <hook> emit`, one every 300 ms, each with a fresh `ts`, and write the 100 record ids to the file named by its first argument, for the SC-002 live check (quickstart L9).
- [ ] T055 [P] Update `CLAUDE.md` outside the SPECKIT block: Layout (`hooks/speckit-activity.mjs`, `mod/speckit-activity/`, `bench/`), Verify (`claude plugin validate` and `claude plugin test` on the mod; the mod's tests live in its own `test/` because `node --test test/` would run `.test.ts`; `test/mod.test.mjs` runs them and reports a skip without `claude`; the bench), Rules (an observer never changes a decision; observer code lives in `speckit-activity.mjs` and is imported guarded; guardrails never run retention; malformed hook input makes no decision and records an `observer-fault`; `lane` and `verdict` accept `Stop` and `SubagentStop`; any new catch-all hook must let `SubagentHandback` through; never edit with `String.replace` replacement strings that may contain `$`).
- [ ] T056 Update `README.md`: Requirements (Claude Code 2.1.291 for the view, early-access API), Install table (the new installed files and the manifest), guardrail table note that each mode also writes a record and that malformed input decides nothing, a section "The activity view" (status line format, `/speckit-activity`, panel, narrow layout, the observer toast text, `latencyLog`), Troubleshooting (no status line; an observer problem toast, cause by cause, including the fault file), Known limits (macOS and Linux not run; retention not enforced without the mod; retention edge for sessions older than 7 days; a phase record may repeat across racing sessions; silent only if both stream and temp directories are unwritable; decision records are lost while the activity module is missing; a main session's stop is lost if the relay cannot finish within the session-end budget), each linking its follow-up issue from T061, Uninstall (new files and the manifest; `settings.json` keeps its value, indentation and line endings, byte-identical if nothing else changed it; no backup or other file left; only directories and a `settings.json` the installer created are removed; pre-existing ones are kept; an install made before the manifest existed leaves its directories, an empty `settings.json` and its old backups behind; streams kept) (FR-023, constitution VIII).
- [ ] T057 Gate 1: run `npm test` without piping it; report passed, failed and skipped counts, and list each skipped test with its reason (the `test/mod.test.mjs` bridge without `claude` is a skip, never a pass; audit finding L5); paste any failure output in full.
- [ ] T058 Gate 2: run `claude plugin validate mod/speckit-activity` and `claude plugin test mod/speckit-activity` directly, whatever T057's bridge reported; report each as passed, failed, skipped or not run (not run when `claude` is unavailable, with the reason), with output on failure.
- [ ] T059 Gate 3, constitution II: full live run of quickstart L1 to L12 after reinstalling, including L9 (100 lag lines, every lag under 1000 ms, SC-002; or "not run" with the reason when research V9 failed) and L10 (privacy scan including the handback message, SC-006); in `README.md` "Verifying" list what was verified live, what only by unit test, and what not at all (FR-023), with date and versions.
- [ ] T060 Make every count, path and command in `README.md` and `CLAUDE.md` match the code: the `npm test` count (21 today, after b9b0dc3) and duration, the number of suites, installed files, modes; and correct the stale "Live results" line that says spec-auditor's verdict is "recorded by its Stop hook" (README line 231 today): since b9b0dc3 it is read from the SubagentHandback report, with the Stop path kept for `claude -p` (constitution VIII, audit finding L6).
- [ ] T061 Open the follow-up issues (owner decision 2026-10-06, audit finding H3, research R17): with `gh issue create --repo PIsberg/speckit-agents`, one issue per item, each saying what is missing, why it was not done now and what it would take: macOS and Linux not run (SC-005 overhead, live checks, `npm test`); each live check reported "not run" by T059 (for example L9 when research V9 failed); retention not enforced without the mod; the retention edge for sessions older than 7 days; a phase record repeating across racing sessions; silence when both the stream and the temp directory are unwritable; decision records lost while the activity module is missing; a main session's stop lost when the relay outlasts the session-end budget; installs made before the manifest. Record the issue numbers for T062 and the README links of T056.
- [ ] T062 Open the feature PR (audit finding M9, owner decision 2026-10-06): write the body to a file outside the repo and run `gh pr create --repo PIsberg/speckit-agents --base main --head 001-agent-activity-feed-and-pane --body-file <file>`. The body starts "Stacked on #1, review the last N commits." with N the number of this feature's commits on top of `fix/subagent-handback`; then for each live check (T001's V1 to V11, T030, T035, T042, T046, T051, T059) the date, Claude Code version, what was done and what was observed, copied from `research.md` and `README.md` "Verifying"; for each test task the red output seen before its implementation, or the deliberate break named in the task (constitution I); each gate as passed, failed, skipped or not run (T057 to T059); the docs updated; and the follow-up issues from T061, linked. Do not merge.

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**: none. T001 first; a stop rule in its table ends the run and goes back to architect.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)**: after Foundational. The MVP. Includes phase records (T016, T023) and the main session's start and stop (T017, T026, T028), which T030 (L2, L4) and T031 need.
- **US2 (Phase 4)**: after US1: T031 needs the fixture (T014), phase records (T023) and the main-session start (T026, T028) to cover all 9 kinds.
- **US5 (Phase 5)**: after US1: T039 refines T022's code, T037 measures T028's hook.
- **US3 (Phase 6)**: after US1 (extends its mod files and tests).
- **US4 (Phase 7)**: after US1 (extends `view.tsx` and `pane.test.ts`).
- **Polish (Phase 8)**: T052 may be written any time after Phase 2; T053 only after T029 (both edit `install.mjs`). T057 to T062 last, in order: gates T057 to T059, then T060, then the issues (T061), then the PR (T062), which links them.

### Story completion order

```
Setup -> Foundational -> US1 (MVP) -> { US2, US5 } -> { US3, US4 } -> Polish
```

### Within each story

- Test tasks first; each must fail for the right reason, or be broken deliberately as its task says, before its implementation starts.
- `hooks/speckit-activity.mjs` tasks run in order T010, T023, T033, T038, T049 (one file).
- `hooks/speckit-team.mjs` tasks run in order T011, T012, T022, T039.
- `install.mjs` tasks run in order T013, T029, T053 (audit finding L1).
- `test/install.test.mjs` tasks: T008, T021, T052. `test/activity.test.mjs`: T006, T016, T043. `mod/speckit-activity/test/pane.test.ts`: T020, T044, T048.
- `README.md` tasks run in order T030, T034, T035, T041, T042, T046, T051, T056, T059, T060.
- Mod: T024 to T027 before T028; T045 and T050 after T028.

### Parallel opportunities

- Setup: T002, T003, T004.
- Foundational tests: T005 to T009. Then T010 with T013; T011 and T012 after T010, in order.
- US1 tests: T015 to T021 after T014. US1 implementation: T022, T023, T024, T025, T026, T027, T029 together; then T028.
- US2: T031 with T032; then T033 with T034.
- US5: T036 with T037; T040 alongside T038.
- US3 tests T043, T044; US4 tests T047, T048.
- Polish: T054 with T055.

## Parallel example: User Story 1

```text
# Red, after T014 (fixture):
T015 test/observe.test.mjs
T016 test/activity.test.mjs
T017 mod/speckit-activity/test/relay.test.ts
T018 mod/speckit-activity/test/follow.test.ts
T019 mod/speckit-activity/test/summary.test.ts
T020 mod/speckit-activity/test/pane.test.ts
T021 test/install.test.mjs

# Green, one implementer per file:
T022 hooks/speckit-team.mjs
T023 hooks/speckit-activity.mjs
T024 mod/speckit-activity/hooks/stream.ts
T025 mod/speckit-activity/hooks/fold.ts
T026 mod/speckit-activity/hooks/relay.ts
T027 mod/speckit-activity/hooks/view.tsx
T029 install.mjs
# then T028 mod/speckit-activity/hooks/register.tsx
```

## Implementation strategy

### MVP first (User Story 1)

1. Phase 1, with T001 answered and no stop rule triggered.
2. Phase 2.
3. Phase 3, then validate with quickstart L1 to L5 (T030).
4. Stop and demo: the status line and the pane during a real pipeline.

### Incremental delivery

1. MVP as above.
2. US2: the public interface documented and proven by the README's own consumer.
3. US5: the safety matrix and the overhead numbers. (Ship US2 and US5 before calling the feature
   done: both are P1.)
4. US3, then US4.
5. Polish, then gates T057 to T059, each reported as passed, failed, skipped or not run, after the follow-up issues (T061), and the PR (T062).

## Notes

- Every test task names its file and the FR, SC, scenario or audit-finding IDs it covers; every
  behaviour it asserts is observable (hook stdout, stream files, `emit` output, what the status line
  and pane show), never a private function.
- Live checks (T001, T030, T035, T042, T046, T051, T059) are required by constitution II because the
  mod's events and the relay are new wiring. Unit tests cannot prove Claude Code fires them.
- Commit after each task or logical group; never on `main`.
