---
description: "Task list for the agent activity feed and live pane"
---

# Tasks: Agent Activity Feed and Live Pane

**Input**: Design documents from `specs/001-agent-activity-feed-and-pane/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. Constitution I (Test-First, non-negotiable) and SC-003 ask for them. Within
every phase the test tasks come first and must be shown failing before the implementation tasks
that follow them (evidence goes in the PR body).

**Organization**: by user story, in priority order: US1, US2, US5 (all P1), then US3, US4 (P2).

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

- [ ] T001 Live spike for research V1 to V7 with a throwaway mod outside the repo (not committed): a plugin folder `skills/speckit-spike/` in a scratch `CLAUDE_CONFIG_DIR` if the session can authenticate there, otherwise in `~/.claude/skills/speckit-spike/`, deleted afterwards, whose `register.tsx` logs `session.start`, `tool.call` (`agentId`), `classic.SubagentStart`/`classic.SubagentStop` (`agent_id`, `cwd`) and runs `$.process.run(['node', '<abs path>/x.mjs'], { stdin })`; compare `agent_id` with a frontmatter command hook's; run `claude plugin test` on a folder with `test/a.test.ts` that reads `Date.now()`. Record each result (date, Claude Code version, what was observed) in the "Live verification log" table of `specs/001-agent-activity-feed-and-pane/research.md`. If V1 or V4 fails, stop and hand back to architect: the R8 fallback changes plan.md and contracts, which voids the audit.
- [ ] T002 [P] Create the mod skeleton: `mod/speckit-activity/.claude-plugin/plugin.json` (name `speckit-activity`, version `0.1.0`, description, `userConfig.latencyLog` boolean default `false`), `mod/speckit-activity/hooks/hooks.json` (`{"modules":["./register.tsx"]}`), `mod/speckit-activity/hooks/register.tsx` (line 1 the comment `// speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.`, `const HOOK = '{{HOOK}}'`, an empty `register: Register`), `mod/speckit-activity/types/index.d.ts` (PluginState `'speckit-activity': { model: ActivityModel; now: number; faults: string[] }` and the exported `ActivityModel` type per data-model.md "View state"). `claude plugin validate mod/speckit-activity` must pass.
- [ ] T003 [P] Add scripts to `package.json`: `"validate:mod": "claude plugin validate mod/speckit-activity"`, `"test:mod": "claude plugin test mod/speckit-activity"`, `"bench": "node bench/overhead.mjs"`. Leave `"test"` as `node --test test/`.
- [ ] T004 [P] Test runner bridge in `test/mod.test.mjs`: two tests that spawn `claude plugin validate mod/speckit-activity` and `claude plugin test mod/speckit-activity` from the repo root (spawn `claude` by name with an argv array; it is `claude.exe` on this machine, and a `.cmd` shim elsewhere needs `shell: true` on Windows), assert exit 0 and include stdout and stderr in the failure message; each is `skip`ped with the reason "claude not on PATH" when `claude --version` fails. Covers constitution I (mod behaviour under `npm test`) and quality gate 2.

**Checkpoint**: research V1 to V7 answered; the empty mod validates; `npm test` runs the mod bridge.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the one writer, the `emit` relay mode, safe input handling, and installing the new hook module. Every story's records go through these.

### Tests (write first, show failing)

- [ ] T005 [P] In `test/hook.test.mjs` add "every mode exits 0 with no output on empty, malformed and unknown input": for `scope only specs/`, `scope tests`, `scope no-tests`, `gate`, `verdict`, `lane tests`, `lane no-tests`, feed stdin `''`, `'{not json'`, `'[]'`, and `{"hook_event_name":"NoSuchEvent"}`, in a Spec Kit repo and outside one; assert exit 0, empty stdout, and no `activity/` directory created. `'{not json'` crashes today (research R14). Covers FR-019 and the spec edge case "malformed, empty or unknown hook input".
- [ ] T006 [P] Create `test/activity.test.mjs` (reuse the throwaway-repo pattern of `test/hook.test.mjs`): pipe envelope lines (contracts/emit-cli.md) into `node hooks/speckit-team.mjs emit` and read `<git common dir>/speckit-team/activity/*.jsonl`. Assert: one record per valid envelope; every common field of data-model.md with the right type, `schema` `"1.0"`, unique `id`, the envelope's `ts`, `source` `"mod"`, `worktree` `"."` (FR-002); an `implementer` record has `agent.team` true, `feature` `"specs/001-demo"`, `phase` `"green"`, and `feature` `"unknown"` once `.specify/feature.json` is deleted (FR-003); `activity` per the data-model label table for Read, Edit, Bash, Grep, Agent and `mcp__x__y` (FR-009); a `file_path` inside the repo given in Windows form (`C:\...\src\a.js` style via `path.join`) and POSIX form becomes `src/a.js`, one outside the repo becomes `null` (FR-020); stdout is `{"written":n,"skipped":m,"faults":[]}`; malformed lines and unknown kinds are skipped and counted, empty stdin prints `{"written":0,"skipped":0,"faults":[]}` (FR-019); `.specify/activity.json` `{"enabled": false}` writes nothing (contracts/config.md); every line is at most 4096 bytes and ends in `\n`.
- [ ] T007 [P] Create `test/privacy.test.mjs`: run `emit` and every guardrail mode with the marker `PRIVACY_MARKER_7f3a` placed in `tool_input.command`, `tool_input.content`, `tool_input.new_string`, `tool_input.old_string`, `prompt`, `last_assistant_message`, an environment variable of the spawned process, and a file under the repo; then scan every byte of the activity directory: 0 occurrences of the marker, of `os.homedir()` in either slash style, and of any drive-letter or leading-`/` path (SC-006, FR-008). With `fields.command: true` a Bash `tool` record carries `command`, cut to 200 characters; with `fields.description: true` an `agent-start` carries `description`; with defaults neither key exists (FR-009).
- [ ] T008 [P] In `test/install.test.mjs` add: after install, `<claude dir>/hooks/speckit-activity.mjs` exists, carries the `speckit-agents: managed` marker and no `{{HOOK}}`; running the installed `speckit-team.mjs emit` with empty stdin from `os.tmpdir()` exits 0 and prints `{"written":0,"skipped":0,"faults":[]}`; `--uninstall` removes `hooks/speckit-activity.mjs`. Covers FR-021 and contracts/installed-files.md.

### Implementation

- [ ] T009 Create `hooks/speckit-activity.mjs` (marker on line 2, as in `hooks/speckit-team.mjs`): config loading with per-key defaults and validation (contracts/config.md); team set and agent-to-phase table; activity label table; repo top level, git common dir and `worktree` resolution; path normalisation to repo-relative forward slashes; record builder from an allow-list of fields only (data-model.md), with the 4096-byte cap; writer that picks the greatest segment, creates a new one with `wx` when needed (research R3) and appends each batch with one `appendFileSync`. Export the functions `speckit-team.mjs` needs; no retention, phase records or fault store yet (T029, T042, T034).
- [ ] T010 In `hooks/speckit-team.mjs`: parse stdin inside `try`/`catch`, treating malformed input as `{}` (research R14); add the `emit` mode per contracts/emit-cli.md, loading `./speckit-activity.mjs` with a dynamic `import()` inside `try`/`catch` after the `.specify/` check, always printing the status JSON and exiting 0. Update the header comment's mode list.
- [ ] T011 [P] In `install.mjs`: add `hooks/speckit-activity.mjs` to `files()`; extend the smoke check to run the installed hook's `emit` with empty stdin from the temp directory and require exit 0 and parseable JSON.

**Checkpoint**: `npm test` green for T005 to T008; envelopes become records; nothing else changed.

---

## Phase 3: User Story 1 - See who is doing what while the pipeline runs (Priority: P1) MVP

**Goal**: the summary line and the `/speckit-activity` panel show every agent, its activity, feature and phase, recent denials and the latest verdict, from guardrail records and relayed activity.

**Independent Test**: install, run a pipeline in a Spec Kit repo, watch the status line and the pane (quickstart L1 to L5). No outside consumer needed.

### Tests for User Story 1 (write first, show failing)

- [ ] T012 [US1] Create the fixture `mod/speckit-activity/test/fixtures/pipeline.jsonl`: schema-1.0 records per data-model.md for a full pipeline: main session; product-owner, architect, spec-auditor, test-writer, implementer, spec-gatekeeper with `agent-start`, `tool` and `agent-stop`; `phase` records `specify` to `verify`; an architect `decision` `deny` on `src/app.js`; `gate` `block` (`no-verdict`) then `allow`; `verdict` `FAIL` then `PASS`; `lane` `violations` then `clean`; 3 `implementer` instances with distinct `agent.id` in worktrees `.`, `../wt1`, `../wt2`; an `Explore` non-team agent; one record carrying an unknown extra field and one record of an unknown `kind` (`future-kind`). Shared by T014 to T017 and checked against the producer by T027.
- [ ] T013 [P] [US1] Create `test/observe.test.mjs`: drive the guardrail modes as `test/hook.test.mjs` does and read the stream. Assert one record per decision with the fields of data-model.md: `scope only specs/ CLAUDE.md` gives `decision` `allow` for `specs/...` and `deny` for `src/main/App.java` with `tool` and `path` (FR-001, US1 S3); `scope tests` and `scope no-tests` denials name their rule; `gate` records `block` with causes `no-verdict`, `verdict-fail`, `stale-audit` and `allow` after PASS, with `trigger` `tool`, `skill` and `command` (FR-001); `verdict` records `FAIL` and `PASS` with a 16-hex `fingerprint`, and a missing VERDICT line gives `decision` `verdict-line` `block` (US1 S4); `lane` records `violations` (paths, `pathCount`, `final: false`), the second stop `final: true`, `clean`, and `unchecked` with no start point (US1 S5); `agent.id` is the input's `agent_id`, or `main:<session_id>` with name `main` without one (FR-002); each mode's stdout is unchanged from the existing tests' expectations. SC-001: a scripted run (scope deny, gate block, verdict FAIL, verdict PASS, gate allow, lane violations, lane clean) has exactly one record for each denial, gate outcome, verdict and lane check.
- [ ] T014 [P] [US1] Create `mod/speckit-activity/test/relay.test.ts` (`claude-code/testing`; the test's own `on` answers `process.run` for `git rev-parse` and for `emit`, `fs.exists` for `.specify`, `fs.read` for `.specify/activity.json`; `mock.clock`): a main-session `tool.call` and a subagent `tool.call` lead, after 100 ms, to one `process.run` with argv `['node', HOOK, 'emit']` whose stdin lines are envelopes with `kind: 'tool'`, `tool`, `file_path`, `agent_id` (subagent only), `session_id`, `cwd`, `ts` (FR-001, FR-004); no `command` field by default and the field present with `fields.command: true` (FR-008, FR-009); `$.classic.SubagentStart`/`SubagentStop` give `agent-start`/`agent-stop` envelopes carrying the event's `cwd` (FR-001); one agent's envelopes arrive in the order start, tools, stop (US2 S1); a burst of 50 calls while an `emit` is in flight gives one more `emit`, never two at once; the test's beneath `tool.call` hook is reached before the mod makes any `fs.*` or `process.*` call in that dispatch (FR-017, constitution III); `emit` rejecting, exiting 1, printing non-JSON, or printing `faults` gives one `ui.toast` per distinct cause per session and none for a repeat, and tool calls keep reaching the beneath hook (FR-018, US5 S2); with `fs.exists` false for `.specify` there is no `emit`, no `ui.status` and no `command.register` (FR-012, FR-022, SC-008).
- [ ] T015 [P] [US1] Create `mod/speckit-activity/test/follow.test.ts`: the test's `fs.list` and `fs.read` hooks serve the fixture split into two in-memory segments: history is read at start; bytes appended to a segment show on the next poll; a trailing line without `\n` is held until completed; a new segment is followed; a deleted segment's cursor is dropped with no error; an unparsable line is skipped (FR-007, consumer side); every path the mod reads is under the stream directory or `.specify/` (FR-016); with `mock.clock`, 100 records appended one per 300 ms each change the status line or pane within 1000 ms of mocked time after being appended (SC-002, FR-014).
- [ ] T016 [P] [US1] Create `mod/speckit-activity/test/summary.test.ts` (capture `ui.status` with the test's own hook): an empty stream gives `speckit: idle, 0 agents | last phase none | verdict none` (US1 S1); the fixture mid-run gives agent count, phase, feature short name, verdict and `1 denied` in the format of contracts/view.md, the main session not counted (FR-012); after every agent stops, `speckit: idle, 0 agents | last phase verify | verdict PASS` (US1 S1); an agent with no record for 121 s of mocked time is counted as stale (FR-013); `enabled: false` and a repo without `.specify` give no status at all (FR-012, SC-008).
- [ ] T017 [P] [US1] Create `mod/speckit-activity/test/pane.test.ts`: `command.run` for `speckit-activity` answers `Agent activity pane opened.` and opens pane id `speckit-activity` (FR-012); for each surface in `['terminal', 'desktop', 'vscode', 'mobile']` mount the `Pane` with the fixture loaded and find: a row per agent with `name#xxxx`, `team` or `other`, activity label and path, feature short name, phase and age (FR-012, US1 S2); a `DENY` line naming architect, rule and `src/app.js`, asserted by text so colour is not needed (US1 S3, FR-015); `PASS` against the feature (US1 S4); a `done` row with `lane clean` and one with `lane VIOLATIONS` (US1 S5); 3 implementer rows with 3 distinct `#xxxx` suffixes (FR-014, SC-007); `STALE` after 121 s of mocked time (FR-013); with `bodyColumns` 40 and `bodyRows` 6 the tree validates, rows are truncated not wrapped, and the summary counts line plus the newest items are shown (spec edge case "terminal too narrow"); a model that makes drawing throw shows one line naming the problem (FR-018).
- [ ] T018 [P] [US1] In `test/install.test.mjs` add: install puts `skills/speckit-activity/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx` (with the marker) and the other mod modules under `<claude dir>`, with every `{{HOOK}}` replaced by the absolute forward-slash hook path and no `test/` folder installed; a second install reports no `install`/`update`; `--uninstall` removes `skills/speckit-activity/`; an existing `skills/speckit-activity/` without the marker makes install fail with nothing written, and `--force` backs it up and replaces it (FR-021, contracts/installed-files.md).

### Implementation for User Story 1

- [ ] T019 [P] [US1] In `hooks/speckit-team.mjs`: append the `decision`, `gate`, `verdict` and `lane` records of contracts/emit-cli.md at each decision point through the guarded import, before the decision is printed, never changing stdout or the exit code; skip writing when `enabled` is false.
- [ ] T020 [P] [US1] Create `mod/speckit-activity/hooks/stream.ts`: locate the stream from the `git rev-parse` output, poll with `$.fs.list`, read changed segments with `$.fs.read(path, { as: 'bytes' })` from the byte cursor, consume to the last `\n`, drop cursors of deleted segments, skip unparsable lines (contracts/activity-stream.md).
- [ ] T021 [P] [US1] Create `mod/speckit-activity/hooks/fold.ts`: fold records into the `ActivityModel` of `types/index.d.ts` (agent states and the 120 s stale rule of data-model.md, latest activity, lane per agent, latest 8 non-allow decisions, allow counters, verdict per feature, current and last completed phase), ignoring unknown kinds and fields; produce the summary text of contracts/view.md.
- [ ] T022 [P] [US1] Create `mod/speckit-activity/hooks/relay.ts`: envelope queue (synchronous push, no `$` call), opt-in fields from `.specify/activity.json`, flush every 100 ms with at most one `$.process.run(['node', HOOK, 'emit'], { stdin })` in flight, poll right after each flush, parse the status JSON, toast each fault cause once per session and keep the shown causes in `$.state` (contracts/view.md "Failures").
- [ ] T023 [P] [US1] Create `mod/speckit-activity/hooks/view.tsx`: the Pane tree of contracts/view.md from `$.ui.resolve(e)` `Box` and `Text` only, sized to `e.props.bodyColumns` and `scroll.bodyRows`, words for every state, narrow and short layouts, drawing wrapped in `try`/`catch` with a one-line fallback.
- [ ] T024 [US1] Wire `mod/speckit-activity/hooks/register.tsx`: `session.start` (detect Spec Kit and `enabled`, else stay inert; register `/speckit-activity` with `immediate: true`; start the 100 ms relay, 250 ms poll and 1 s clock timers), `tool.call` (push, then `return next(e)`), `classic.SubagentStart` and `classic.SubagentStop` (push, then `next(e)`), `command.run` for `speckit-activity` (open the pane), `ui.render` on `{ component: 'Pane', requestId: 'speckit-activity' }`, and `$.ui.status` updates only when the text changes; `latencyLog` debug lines per contracts/view.md. Depends on T020 to T023.
- [ ] T025 [P] [US1] In `install.mjs`: install the mod's files (not `test/`) from `mod/speckit-activity/` into `<claude dir>/skills/speckit-activity/` with `{{HOOK}}` rendering, treat the folder as owned when `hooks/register.tsx` carries the marker, include it in the collision check and in `--uninstall` (contracts/installed-files.md).
- [ ] T026 [US1] Live check, constitution II: install into the real Claude config, then run quickstart L1 to L5 in a scratch Spec Kit repo with `claude --debug`; record date, Claude Code version, what was done and what was observed for each in `README.md` "Verifying".

**Checkpoint**: US1 works on its own: status line and pane show the pipeline live.

---

## Phase 4: User Story 2 - Any outside tool can consume agent activity (Priority: P1)

**Goal**: the stream is documented well enough that a consumer written from the README alone works, follows live without gaps or duplicates, and survives retention.

**Independent Test**: the README's reference consumer, run by `test/stream.test.mjs` against a scripted run, and live in quickstart L11.

### Tests for User Story 2 (write first, show failing)

- [ ] T027 [P] [US2] Create `test/stream.test.mjs`. SC-003, FR-005: extract the fenced code block that follows the line `<!-- reference-consumer -->` in `README.md`, write it to a temp file, run it as `node consumer.mjs <repo> --once` after a scripted run that produces all 8 kinds (`emit` envelopes plus the guardrail modes), and assert it prints one `<kind>\t<id>` line per record and covers 100% of the FR-001 kinds. FR-005: every field name in the emitted records, nested `agent.*` included, appears in the README's record tables. FR-006: the README states that unknown fields, kinds and values must be ignored and that a removal, rename or retype is a major version change. US2 S2: a stream with an extra unknown field and an unknown kind is consumed without error. FR-007, US2 S3: with `retention.segmentBytes` 4096, start the consumer in follow mode after 50 records, write 400 more across several segment rotations, stop it, and assert the set of `id`s received equals the set written with none twice; each agent's lines come in the order start, tools, stop (US2 S1). Fixture drift: each kind's key set in `mod/speckit-activity/test/fixtures/pipeline.jsonl` equals the producer's for that kind. US2 S4, FR-010: `hooks/*.mjs` import only `node:fs`, `node:path`, `node:child_process`, `node:crypto`, `node:os`, `node:url`, and the mod's sources contain no `$.http`.
- [ ] T028 [P] [US2] Create `test/retention.test.mjs` (FR-011): with `segmentBytes` 4096 and `maxBytes` 65536, write more than 200 KB and assert the directory stays within `maxBytes` plus one segment, segments are removed oldest name first and the newest is never removed; segments with modification time set 8 days back (`fs.utimesSync`) are removed, except one holding a record of the writing session; `maxAgeDays: 1` is honoured; an undeletable entry (a directory named like a segment) does not stop writes and records a `retention-failed` fault once T034 lands (mark that assertion `todo` until then).

### Implementation for User Story 2

- [ ] T029 [US2] In `hooks/speckit-activity.mjs`: retention at segment creation and the UTC-day rollover of research R5 and data-model.md "Segment and Store".
- [ ] T030 [P] [US2] In `README.md` add the section "Activity stream": location, segment files, the read-then-follow algorithm, the common-field table and one table per kind (every field, type, meaning, from data-model.md), the activity label table, versioning and ignore-unknown rules, locality and privacy with the two opt-in fields, retention and the `.specify/activity.json` table (contracts/config.md), a stream changelog (`1.0`), and the reference consumer: a Node stdlib script after a line `<!-- reference-consumer -->` taking `<repo> [--once]`, following per contracts/activity-stream.md and printing `<kind>\t<id>` per record.
- [ ] T031 [US2] Live check: quickstart L11 with the reference consumer copied out of the README; record the result in `README.md` "Verifying".

**Checkpoint**: a consumer built from the README works without reading source.

---

## Phase 5: User Story 5 - Observation never harms the work (Priority: P1)

**Goal**: identical guardrail decisions whether observation works, is off or is broken; failures visible once; no cost outside Spec Kit; overhead measured against the 10 ms budget.

**Independent Test**: `test/safety.test.mjs` decision matrix, `bench/overhead.mjs`, quickstart L8.

### Tests for User Story 5 (write first, show failing)

- [ ] T032 [P] [US5] Create `test/safety.test.mjs`. SC-004, FR-017, US5 S1: run a matrix of guardrail inputs (scope only, tests, no-tests, allowed and denied; gate blocked and allowed by tool, skill and typed command; verdict missing, PASS, FAIL; lane clean, violations, second stop) three ways: observation on, `.specify/activity.json` `{"enabled": false}`, and `<git common dir>/speckit-team/activity` replaced by a regular file; assert stdout bytes and exit codes are identical across the three for every input. FR-018 (writer side): with the regular file in place, `emit` exits 0 and its `faults` contain `stream-unwritable:<code>` with a growing `count`; a malformed `.specify/activity.json` gives `config-invalid` and default behaviour. SC-008, FR-022, US5 S3: in a git repo without `.specify/`, every guardrail mode prints 0 bytes, `emit` with envelopes whose `cwd` is that repo reports them skipped, and no `speckit-team/` directory is created.
- [ ] T033 [P] [US5] Create `mod/speckit-activity/test/overhead.test.ts` (SC-005, FR-017): drive 100 `$.tool.call`s through the mod with observation active and record call-to-beneath time with `Date.now()`; assert the median is at most 2 ms when research V7 says the clock is wall time, otherwise skip that assertion with the reason; always assert that no `fs.*` or `process.*` dispatch from the mod happens before the beneath hook is reached.

### Implementation for User Story 5

- [ ] T034 [US5] In `hooks/speckit-activity.mjs`: the fault store of research R10 (`<os.tmpdir()>/speckit-team-faults/<16 hex>.json`, at most 50 causes, count and first/last time), every writer, config and retention error caught and recorded, faults returned for `emit`'s status JSON.
- [ ] T035 [US5] In `hooks/speckit-team.mjs`: make the T032 matrix pass: every observation call inside `try`/`catch`, no observer path able to change stdout, the exit code or the order of the decision, and `emit` reporting the faults from T034.
- [ ] T036 [P] [US5] Create `bench/overhead.mjs` per research R9: 100 alternating pairs (observation on, then `enabled: false`) of `gate` on `PreToolUse Read` in a throwaway Spec Kit repo, and 100 pairs of the early exit in a repo without `.specify/` against the same call with the activity module absent; print median and p90 of the paired differences with Node, git and OS versions; exit 1 when the Spec Kit median exceeds 8 ms (the 10 ms budget less the mod's 2 ms share) or the non-Spec-Kit median exceeds 2 ms.
- [ ] T037 [US5] Run `node bench/overhead.mjs` and `claude plugin test mod/speckit-activity` on Windows; record the medians, the total against the 10 ms budget, date and versions in `README.md` "Verifying"; state macOS and Linux as "not run" (SC-005).
- [ ] T038 [US5] Live check: quickstart L8 (unwritable destination in a live session); record the result in `README.md` "Verifying".

**Checkpoint**: breaking the stream changes no decision; the user is told once.

---

## Phase 6: User Story 3 - Observe agents outside the Spec Kit team (Priority: P2)

**Goal**: built-in and third-party subagents and the main session appear in feed and view, marked non-team; phase changes are recorded.

**Independent Test**: an `Explore` subagent appears as `other` with no phase (quickstart L6); phases advance as team agents start (L4).

### Tests for User Story 3 (write first, show failing)

- [ ] T039 [P] [US3] In `test/activity.test.mjs` add: `Explore` envelopes give `agent.team` false, `feature` null, `phase` null (FR-004, US3 S1); envelopes without `agent_id` give `agent.id` `main:<session_id>`, name `main`, team false (FR-004); `agent-start` of product-owner then architect gives `phase` records `specify` (`previous` null) then `plan` (`previous` `specify`), written before the agent-start; a second architect start gives no new phase record; 3 implementer starts in one batch give exactly one `green` phase record (US3 S2, research R6).
- [ ] T040 [P] [US3] In `mod/speckit-activity/test/relay.test.ts` add: `session.start` in a Spec Kit repo queues an `agent-start` envelope for the main session and `session.end` an `agent-stop` (FR-004).
- [ ] T041 [P] [US3] In `mod/speckit-activity/test/pane.test.ts` add: the `Explore` row reads `other` with no phase (US3 S1); a new `phase` record changes the panel's phase line and the summary's phase (US3 S2).

### Implementation for User Story 3

- [ ] T042 [US3] In `hooks/speckit-activity.mjs`: phase state in `<git common dir>/speckit-team/phase.json` keyed by feature, and `phase` records at team `agent-start` (research R6); `null` feature and phase for non-team and main records.
- [ ] T043 [US3] In `mod/speckit-activity/hooks/relay.ts` and `mod/speckit-activity/hooks/register.tsx`: main-session `agent-start` at `session.start` and `agent-stop` at `session.end`, within `next.budget`.
- [ ] T044 [US3] In `mod/speckit-activity/hooks/fold.ts` and `mod/speckit-activity/hooks/view.tsx`: `other` marking and the phase line from `phase` records, until T041 passes.
- [ ] T045 [US3] Live check: quickstart L6, and the phase rows of L4; record in `README.md` "Verifying".

**Checkpoint**: non-team work is visible and labelled; phases advance.

---

## Phase 7: User Story 4 - Parallel agents stay distinguishable (Priority: P2)

**Goal**: concurrent same-type agents and worktrees are told apart in every record and row.

**Independent Test**: 3 implementers at once give 3 rows and 3 identities (quickstart L7).

### Tests for User Story 4 (write first, show failing)

- [ ] T046 [P] [US4] Create `test/parallel.test.mjs`: 3 concurrent `emit` processes for 3 `implementer` agent ids, 50 `tool` envelopes each, plus concurrent `gate` invocations: every line parses, the 150 tool records split 50/50/50 by `agent.id`, and each agent's own order is intact (SC-007, US4 S1); in a `git worktree add` checkout, `emit` envelopes with that `cwd` and a guardrail run there write into the shared common-dir stream with `worktree` set to the checkout's path relative to the main worktree (US4 S2); two sessions in one repo give two `main:<session>` identities (spec edge case "two sessions").
- [ ] T047 [P] [US4] In `mod/speckit-activity/test/pane.test.ts` add: the 3 implementer rows show their worktree labels `../wt1` and `../wt2` (none for `.`); two sessions' main rows are separate (US4 S1, S2).

### Implementation for User Story 4

- [ ] T048 [US4] In `hooks/speckit-activity.mjs`: `worktree` for linked worktrees, relative to the main worktree's top level derived from the common dir, until T046 passes.
- [ ] T049 [US4] In `mod/speckit-activity/hooks/view.tsx`: worktree labels and per-session main rows, until T047 passes.
- [ ] T050 [US4] Live check: quickstart L7 (3 parallel implementers in worktrees); record in `README.md` "Verifying".

**Checkpoint**: every story works independently.

---

## Phase 8: Polish and cross-cutting

### Tests (write first, show failing)

- [ ] T051 [P] In `test/install.test.mjs` add SC-009 and the directory rule of research R12 (FR-021, constitution Installation Constraints "and nothing else"): (a) a config dir holding only a `settings.json` indented with 4 spaces and no trailing newline plus an unrelated hook, and a second one indented with tabs: install then uninstall leaves every pre-existing file byte-identical and adds no file or directory except `*.bak-speckit-agents-*`; in particular `agents/`, `hooks/` and `skills/`, which the installer created, are removed once emptied, and `hooks/speckit-agents.install.json` is gone; (b) a config dir where `agents/` and `skills/` already exist and are empty and `hooks/` does not: after install the manifest's `createdDirs` is exactly `["hooks"]`; after uninstall `agents/` and `skills/` still exist and are empty, and `hooks/` is removed; (c) install twice on a fresh dir: the second install reports the manifest `unchanged` and changes nothing, and uninstall still removes all three directories (the record survives a reinstall); (d) a user file added to a created directory (`agents/my-agent.md`) keeps that directory and the file; (e) manifest deleted before `--uninstall`: no directory is removed; (f) a `hooks/speckit-agents.install.json` without the marker makes install fail with nothing written, as for any collision.

### Implementation

- [ ] T052 In `install.mjs`: keep the detected indentation and trailing-newline state of `settings.json`; before writing, note which of `agents/`, `hooks/`, `skills/` do not exist, and write the manifest `hooks/speckit-agents.install.json` (`managedBy` carrying the marker, `createdDirs` = the existing manifest's list merged with the newly created ones, sorted) through the same `write()` so a reinstall reports it `unchanged`; treat a manifest without the marker as a collision; on `--uninstall` read `createdDirs`, remove the manifest, then remove only the listed directories that are empty, deepest first, and no directory at all when the manifest is missing, unowned or unparsable (contracts/installed-files.md); update the help header (installs the activity module and the view), the final "Done. Next" lines (`/speckit-activity` in a Spec Kit repo) and the uninstall message (per-repo streams stay in `.git/speckit-team/activity/`) (research R12, constitution VIII).
- [ ] T053 [P] Create `bench/latency.mjs`: in the current repo, send 100 `tool` envelopes through `node <hook> emit`, one every 300 ms, each with a fresh `ts`, for the SC-002 live check (quickstart L9).
- [ ] T054 [P] Update `CLAUDE.md` outside the SPECKIT block: Layout (`hooks/speckit-activity.mjs`, `mod/speckit-activity/`, `bench/`), Verify (`claude plugin validate` and `claude plugin test` on the mod; the mod's tests live in its own `test/` because `node --test test/` would run `.test.ts`; the bench), Rules (an observer never changes a decision; observer code lives in `speckit-activity.mjs` and is imported guarded).
- [ ] T055 Update `README.md`: Requirements (Claude Code 2.1.291 for the view, early-access API), Install table (the new installed files), guardrail table note that each mode also writes a record, a section "The activity view" (status line format, `/speckit-activity`, panel, narrow layout, `latencyLog`), Troubleshooting (no status line; an observer problem toast), Known limits (macOS and Linux not run; retention edge for sessions older than 7 days; phase record may repeat across racing sessions; `agent-stop` may repeat; silent only if both stream and temp directories are unwritable), Uninstall (new files and the manifest; only directories the installer created are removed, when empty, and pre-existing ones are kept; an install made before the manifest existed leaves its directories behind; backups kept, streams kept) (FR-023, constitution VIII).
- [ ] T056 Gate 1: run `npm test` without piping it; report passed, failed and skipped counts; paste any failure output in full.
- [ ] T057 Gate 2: run `claude plugin validate mod/speckit-activity` and `claude plugin test mod/speckit-activity`; report each as passed, failed, skipped or not run, with output on failure.
- [ ] T058 Gate 3, constitution II: full live run of quickstart L1 to L11 after reinstalling, including L9 (100 `latencyLog` lines, every lag under 1000 ms, SC-002) and L10 (privacy scan, SC-006); in `README.md` "Verifying" list what was verified live, what only by unit test, and what not at all (FR-023), with date and versions.
- [ ] T059 Make every count, path and command in `README.md` and `CLAUDE.md` match the code: the `npm test` count (17 today) and duration, the number of suites, installed files, modes (constitution VIII).

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**: none. T001 first; if V1 or V4 fails, stop (it changes the plan).
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)**: after Foundational. The MVP.
- **US2 (Phase 4)**: after Foundational. T027's fixture-drift check reads T012's fixture, so run after T012 exists. Independent of US1's mod code.
- **US5 (Phase 5)**: after Foundational. T035 refines T019's code, so after US1's T019 in practice.
- **US3 (Phase 6)**: after US1 (extends its mod files and tests).
- **US4 (Phase 7)**: after US1 (extends `view.tsx` and `pane.test.ts`).
- **Polish (Phase 8)**: after the stories wanted for the release. T056 to T059 last.

### Story completion order

```
Setup -> Foundational -> US1 (MVP) -> { US2, US5 } -> { US3, US4 } -> Polish
```

### Within each story

- Test tasks first; each must fail for the right reason before its implementation starts.
- `hooks/speckit-activity.mjs` tasks run in order T009, T029, T034, T042, T048 (one file).
- `hooks/speckit-team.mjs` tasks run in order T010, T019, T035.
- `README.md` tasks run in order T026, T030, T031, T037, T038, T045, T050, T055, T058, T059.
- Mod: T020 to T023 before T024; T043 and T044 after T024.

### Parallel opportunities

- Setup: T002, T003, T004.
- Foundational tests: T005, T006, T007, T008. Then T009 with T011.
- US1 tests: T013 to T018 after T012. US1 implementation: T019, T020, T021, T022, T023, T025 together; then T024.
- US2: T027 with T028; then T029 with T030.
- US5: T032 with T033; T036 alongside T034.
- US3 tests T039, T040, T041; US4 tests T046, T047.
- Polish: T053 with T054.

## Parallel example: User Story 1

```text
# Red, after T012 (fixture):
T013 test/observe.test.mjs
T014 mod/speckit-activity/test/relay.test.ts
T015 mod/speckit-activity/test/follow.test.ts
T016 mod/speckit-activity/test/summary.test.ts
T017 mod/speckit-activity/test/pane.test.ts
T018 test/install.test.mjs

# Green, one implementer per file:
T019 hooks/speckit-team.mjs
T020 mod/speckit-activity/hooks/stream.ts
T021 mod/speckit-activity/hooks/fold.ts
T022 mod/speckit-activity/hooks/relay.ts
T023 mod/speckit-activity/hooks/view.tsx
T025 install.mjs
# then T024 mod/speckit-activity/hooks/register.tsx
```

## Implementation strategy

### MVP first (User Story 1)

1. Phase 1, with T001 answered. Stop if V1 or V4 failed.
2. Phase 2.
3. Phase 3, then validate with quickstart L1 to L5 (T026).
4. Stop and demo: the status line and the pane during a real pipeline.

### Incremental delivery

1. MVP as above.
2. US2: the public interface documented and proven by the README's own consumer.
3. US5: the safety matrix and the overhead numbers. (Ship US2 and US5 before calling the feature
   done: both are P1.)
4. US3, then US4.
5. Polish, then gates T056 to T058, each reported as passed, failed, skipped or not run.

## Notes

- Every test task names its file and the FR, SC or scenario IDs it covers; every behaviour it
  asserts is observable (hook stdout, stream files, `emit` output, what the status line and pane
  show), never a private function.
- Live checks (T026, T031, T038, T045, T050, T058) are required by constitution II because the
  mod's events and the relay are new wiring. Unit tests cannot prove Claude Code fires them.
- Commit after each task or logical group; never on `main`.
