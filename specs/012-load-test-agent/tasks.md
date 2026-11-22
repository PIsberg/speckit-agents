---
description: "Tasks for 012: opt-in load-test role"
---

# Tasks: Opt-in load-test role

**Input**: `specs/012-load-test-agent/` (spec.md, plan.md, contracts/load-tester.md, quickstart.md)

**Tests**: required (constitution I). Each slice's test tasks come first and are seen failing.

Written as plan.md's recommended options make them (D1 A, D2 A, D3 A, D4 A, D5 A, D6 A).

## Format: `[ID] [P?] [Story] Description`

Hook line numbers are as of commit `eeb1dea`; grep the symbol if they moved.

Until T025, three existing checks stay red once T007 adds the agent, and no earlier slice fixes them:
`test/install.test.mjs` "README counts the agents ..." and the README "Choosing the team" test, and
`test/rules.test.mjs`. An implementer before T025 leaves README.md, CLAUDE.md and docs/rules.md alone.

## Phase 1: Setup

None: the repository, its suite and the fixture tree layout exist.

## Phase 2: Foundational: the `load` lane

**Slice F1** (FR-004)

- [X] T001 Test lane `load` in test/hook.test.mjs. Covers FR-004 and contracts/load-tester.md section 3
  (D1 A: the two path patterns and the record path are the cases to pick from; include
  `test/loader.test.js` as outside, and a load path taken out by a `!` line of `.specify/test-paths`).
  Write tools through `write(dir, ['scope', 'load'], file)`, Bash through `run(dir, ['scope', 'load'], ...)`
  with `tool_name: 'Bash'`, and the Stop through `lane load` after a first `gate` call has laid the start
  record, as the `.specify/` test at test/hook.test.mjs:101 does (helpers: test/hook-helpers.mjs `repo`,
  `run`, `write`, `denied`, `pass`, `FEAT`; test/hook.test.mjs `stopAs`). A bad `.specify/test-paths`
  line gives the same refusal as `scope tests`. Add `['scope', 'load']` and `['lane', 'load']` to
  `MODES` (test/hook.test.mjs:769).
- [X] T002 Implement lane `load` in hooks/speckit-team.mjs. New beside `TASKS_FILE` (:61):
  `const LOAD_PATTERNS: RegExp[]`, `const LOAD_RECORD: RegExp`; beside `inLane` (:465):
  `isLoadTest(rel: string): boolean` (`isTest(rel)` and a `LOAD_PATTERNS` match). Rule `'load'` in
  `inLane`, in `laneProblem` (:1125, its own denial text and the `testPaths.bad` check at :1149) and in
  `laneOutside` (:748). `scopeCheck` (:1296), `gate` (:1477 start record) and the Bash judge
  (`scopeBash`) take the rule unchanged.

## Phase 3: User Story 1: opt in and get a verdict (P1)

**Goal**: `--load-test` adds the role; it runs once after green, before spec-gatekeeper, and ends with
one verdict line. **Independent test**: the role is installed, recorded in the team only when named,
held to its lane in a real session, and the skill stops on its FAIL.

**Slice U1a**: the role exists in both modes (FR-001, FR-003, FR-006, FR-007, FR-017)

- [X] T003 [US1] Test the installed role in test/install.test.mjs. Covers FR-001, FR-003, FR-006,
  FR-007, FR-017, contracts/load-tester.md section 2 and section 4's report order. Update `AGENTS` (:12,
  `load-tester` between `implementer` and `spec-gatekeeper`), `START_MATCHER` (:39), and the #209/#210
  test's `expected` and `gated` maps (:527: `'load-tester': 'load'`, gated `'gate scope'`). Assert the
  frontmatter's `ends` entries and `lane load`, no `omitClaudeMd`, the generated
  `skills/speckit-role-load-tester/SKILL.md`, and that `node install.mjs --help` names `--load-test`
  and `load-tester`. The Report section names value, unit and ceiling or control per measurement and
  the three last lines. Helpers: `claudeDir`, `install`, `flat` (test/install.test.mjs:15, :23, :43).
- [X] T004 [US1] Test team membership in test/hook.test.mjs. Covers FR-001, FR-002, FR-003, FR-017,
  SC-003, contracts/load-tester.md section 1. A `Team:` line naming `load-tester` records it in pipeline
  order; a launch with no `Team:` line does not (`agentLaunch` :1786, `teamRecord` :1791); a typed
  `/speckit-team --load-test --team test-writer,load-tester x`, with `--load-test` before or after
  `--project <name>` and `--security`, records the typed roles (`typedTeam` :1826). Add `load-tester` to
  `SKILL_ROLES` (:2679); a `speckit-role-load-tester` call before an audit PASS is denied with
  `Implementation gate:`, and after one `scope role` holds it to lane `load` (`roleWrite`, `roleFile`
  helpers near :2940); the skill-agents start message names it among the audit-gated roles. A
  load-tester subagent's tool call through `gate scope load` before a PASS is denied.
- [X] T005 [US1] Test the colour twin in test/board-mod.test.mjs: the count at :52 becomes 9. Covers
  FR-003 (CLAUDE.md twin rule: `ROLE_COLOR` against each `agents/*.md` `color:` line).
- [X] T006 [US1] Test the role's hooks in a real session in test/e2e.test.mjs. Covers FR-004, FR-006
  (constitution II wiring). After an `e2e auditor` PASS (as at test/e2e.test.mjs:329), a load-tester
  agent's Write of `src/x.js` is denied and of `test/load/x.test.mjs` is not; its report without a
  verdict line is sent back once, naming the three lines, and `NOT MEASURED` then goes through (pattern:
  the security-reviewer case at :1278). Helpers: `setup` :49, `session` :242, `agent` :189, `say` :181,
  `wfile` :864, `shown` :194, `lastResult` :198, `story` :307, `MAIN` :180. Both fail with
  `SPECKIT_E2E_NO_HOOK=1`.
- [X] T007 [US1] Add the role. New agents/load-tester.md: frontmatter per contracts/load-tester.md
  section 2 (marker line first, as agents/security-reviewer.md), body sections `## Inputs`, `## Lane`,
  `## Report` (contract section 4; at most 100 lines overall, T013 to T021 add the rest). install.mjs:
  `AGENTS` (:63) in pipeline order; the help comment (:17 to :31: nine subagents, eight role skills, a
  `/speckit-team --load-test <request>` line, `load-tester` in the `--team` list). hooks/speckit-team.mjs:
  `TEAM_ROLES` (:538), `typedRoles` (:620) skips a leading `--load-test`, `ROLE_LANES` (:687)
  `"load-tester": ['load']`, the role-skill `auditGate` list (:1439) and `SKILL_AGENTS_START` (:599) gain
  load-tester. mods/speckit-board/hooks/model.ts: `ROLE_COLOR` (:17) `'load-tester': 'pink'`. Reuse
  `install.mjs: roleSkill` and the hook's `ends` as they are.

**Slice U1b**: the pipeline step (FR-001, FR-002, FR-005, FR-006, FR-010, FR-016)

- [X] T008 [US1] Test the skill text in test/install.test.mjs. Covers FR-001, FR-002, FR-005, FR-006,
  FR-010, FR-016, US1-1, US1-2, US5-1, edge cases "team that has no implementer" and "NOT MEASURED is
  fine". The step is `## 5b. Load test: load-tester`, between `## 4-5.` and `## 6.`; FAIL or any other
  last line is a **Stop:** with the three options of plan.md "Pipeline step"; load-tester's files are
  committed in the message that launches spec-gatekeeper; on accept (D6 A) that call commits only
  `load-test.md` and runs `git stash push --include-untracked`, and step 7 names the stash and its
  files; an opt-in role not asked for gets no skipped row. Also
  `argument-hint`, `## Team` (`--load-test` among the leading flags; the existing 006 T008 test at :1334
  then checks the pipeline order), `## Handoffs` and `## Skill agents` lines, and step 7. Helpers:
  `teamSkill` :1313, `skillSection` :1324, `sectionHead` :1332, `flat` :43.
- [X] T009 [US1] Write the step into skills/speckit-team/SKILL.md: argument-hint, `## Handoffs`
  (load-tester: the feature directory), `## Team`, `## Skill agents`, new `## 5b. Load test:
  load-tester` (its accept path per plan.md "Pipeline step"), `## 7. Hand over` (the accepted FAIL and
  its stash). Stays under 500 lines (`test/skills.test.mjs`).

**Slice U1c**: a run without the role launches none (FR-002, SC-003)

- [X] T010 [P] [US1] Test in test/full-run.test.mjs that `checkRun` fails a run that launched load-tester
  (agents mode, `usage.main.launches`) or called `speckit-role-load-tester` (skill-agents mode), since a
  full run never passes `--load-test`. Covers FR-002, SC-003. Pattern: the #176 security case in the test
  at :440; helpers `state` :39, `failures` :55, `roleSkills` :426, `MARKER` :54.
- [X] T011 [P] [US1] Implement the check in tools/full-run.mjs `checkRun` (:132), beside the
  security-reviewer line (:161), in both modes.

## Phase 4: User Story 2: a dead benchmark cannot pass (P1)

**Slice U2** (FR-008, FR-009)

- [ ] T012 [US2] Test the instrument rules in agents/load-tester.md through the installed file, in
  test/install.test.mjs. Covers FR-008, FR-009, US2-1 to US2-4, US1-3, edge case "no way to run a
  benchmark". The verdict rules are contracts/load-tester.md section 4's.
- [ ] T013 [US2] Write `## Process` steps "Load surface" and "Instruments" and `## Verdict` into
  agents/load-tester.md.

## Phase 5: User Story 3: budgets from evidence (P2)

**Slice U3a**: the probe (FR-013)

- [ ] T014 [P] [US3] Test `probe` in test/hook.test.mjs through `spawnSync(process.execPath, [HOOK,
  'probe', ...])` (test/hook-helpers.mjs `HOOK`). Covers FR-013, SC-006, contracts/load-tester.md
  section 6. Load cannot be set in a test, so drive the thresholds through `--since`: a start busy of 50
  gives the busy line; a start probe of 1 ms gives the slowdown line; a start probe of 10^9 ms gives no
  slowdown line. Malformed `--since` values exit 1 with the refusal line. Runs on all three CI platforms
  (constitution VII).
- [ ] T015 [P] [US3] Implement `probe` in hooks/speckit-team.mjs: add it to `CLI` (:116) and answer with
  `projectSay` (:117). New: `probeReading(): { busy: number, ms: number }` (synchronous: a 1,000 ms
  `os.cpus()` sample, then the median of 5 timed workloads) and `noisyLines(start: { busy: number, ms:
  number }, end: { busy: number, ms: number }): string[]`. (No test: constitution IV, `node:os` and
  `node:crypto` only.)

**Slice U3b**: budgets and gating (FR-011, FR-012, FR-013)

- [ ] T016 [US3] Test the budget rules in agents/load-tester.md through the installed file, in
  test/install.test.mjs. Covers FR-011, FR-012, FR-013, US3-1 to US3-4, SC-005: the body runs
  `node "<hook>" probe` before and `probe --since` after its measurements (the installed path, as T003
  checks for `{{HOOK}}`), and a budget row is written to the record only after its failing first run.
- [ ] T017 [US3] Write `## Process` step "Budgets" into agents/load-tester.md, with the 2.2x default
  margin a project's instructions or constitution may tighten (spec Assumptions).

## Phase 6: User Story 4: realistic and hostile workloads (P2)

**Slice U4** (FR-014)

- [ ] T018 [US4] Test the workload rules in agents/load-tester.md through the installed file, in
  test/install.test.mjs. Covers FR-014, US4-1 to US4-5.
- [ ] T019 [US4] Write `## Process` step "Workloads" into agents/load-tester.md.

## Phase 7: User Story 5: the harness stays alive (P3)

**Slice U5** (FR-015, FR-016)

- [ ] T020 [US5] Test the harness and record rules in agents/load-tester.md through the installed file,
  in test/install.test.mjs. Covers FR-015, FR-016, US5-1 to US5-3, edge cases "capped", "moves with no
  code change", "cannot be reproduced", contracts/load-tester.md section 5: load tests go in a path lane
  `load` accepts, run reduced by default with the full sweep behind an environment variable the
  procedure names, and are seen failing on a breach.
- [ ] T021 [US5] Write `## Process` step "Harness and record" into agents/load-tester.md; the whole body
  stays within 100 lines (`test/skills.test.mjs` holds the role skill under 150).

## Phase 8: Polish

**Slice P1**: scored load cases (SC-001, SC-002, SC-004, SC-006)

- [ ] T022 [P] Test the load cases in test/eval.test.mjs. Covers SC-001, SC-002, SC-004, SC-006: the six
  `CASES` of plan.md "Scored cases" and their right answers; `scoreRun` on each (for the three broken
  instruments FAIL and NOT MEASURED both count as right; for `load-noisy`, PASS without a `noisy` line in
  the report is wrong); `gateWord` with `words: LOAD_WORDS, lastLineOnly: true` returns a word only
  when the last non-empty line is exactly one of the three (`NOT MEASURED` included), and with neither
  option still passes the existing cases at test/eval.test.mjs:120 to :124; `buildRepo`
  lays the `specs/001-dedupe` feature with its variant and an audit PASS; `loadRequest` in both modes;
  `gateReport` with `role: 'load-tester'` reads that role's report, as the existing gateReport tests do.
- [ ] T023 [P] Build the cases. tools/eval.mjs: `CASES` (:20) entries with `load: '<variant>'`;
  `export const LOAD_WORDS = ['PASS', 'FAIL', 'NOT MEASURED']`; reuse `gateWord` (:41), no second parser:
  its signature becomes `gateWord({ ends = [], text = '', words = ['APPROVED', 'REJECTED'], lastLineOnly
  = false }): { word: string | null, source: string }`, the hook record and the line test matched against
  `words` as whole strings (not a regex), and `lastLineOnly` judging only the last non-empty line;
  `scoreRun` (:105) for the load cases.
  tools/full-run.mjs: `buildRepo` (:67) lays test/fixtures/full-run/load/ like the gate block (:83, audit
  seeding :116); `loadRequest({ skillAgents = false } = {}): string` beside `gateRequest` (:203), sent
  with `--load-test`; `gateReport({ transcript, skillAgents = false, role = 'spec-gatekeeper' })` (:276);
  in `main` (:510), load cases are one turn, judged on `gateWord({ text: <load-tester's report from
  gateReport>, words: LOAD_WORDS, lastLineOnly: true })` with no `ends`, and `load-noisy` keeps
  `Math.max(1, Math.round(0.3 * os.cpus().length))` busy-loop children running until the turn ends.
  New fixtures under test/fixtures/full-run/load/: `specs/001-dedupe/` (spec, plan, tasks ticked),
  `src/dedupe.js` (passes its tests, quadratic), `test/dedupe.test.js`, and `linear/`, `pinned/` (a load
  test importing an older vendored copy), `empty/` (a load test that catches its workload's throw and
  reports no results), `skipped/` (a load test with a skipped case).

**Slice P2**: docs (FR-017, constitution VIII)

- [ ] T024 Test the docs in test/install.test.mjs. Covers FR-017: the README "Choosing the team" test
  (:1516) expects 8 roles; the README guardrail table has rows for `gate scope load`, `lane load`,
  `ends PASS FAIL "NOT MEASURED"` and `probe` (pattern: the 009 T022 test at :1960, helpers `repoText`
  :1505, `mdSection` :1506).
- [ ] T025 Write the docs. README.md: intro, "What gets installed", the team table, "Choosing the team",
  skill-agents, the guardrail table, "Scored cases and arms" (the six cases, not yet run: D5), "Live
  results" note and "Known limits" (what is verified by e2e, what only by pinned text, what not at all),
  and every count `test/install.test.mjs` holds. CLAUDE.md: agent and role-skill counts, `TEAM_ROLES`
  count, the hook's modes (`probe`), the test count. docs/rules.md: entries and fingerprints for each
  agents/load-tester.md section and each changed skills/speckit-team/SKILL.md section
  (`test/rules.test.mjs` prints the fingerprints).

## Dependencies & Execution Order

- F1 before U1a (ROLE_LANES and the e2e case use lane `load`); U1a before every other slice (the agent
  file). U3a before U3b (the body names `probe`). P2 last: it documents every other slice.
- Within a slice, its test tasks before its implementation task.

## Rounds

| Round | Slices | Stub | Red | Green |
|---|---|---|---|---|
| 1 | F1, U1a, U1b, U1c | T007 (agents/load-tester.md with its marker and `name:` line only) | T001, T003, T004, T005, T006, T008, T010 | T002, T007, T009, T011 |
| 2 | U2, U3a, U3b, U4 | none | T012, T014, T016, T018 | T013, T015, T017, T019 |
| 3 | U5, P1, P2 | T023 (`LOAD_WORDS`, `gateWord`'s `words` and `lastLineOnly` options, `loadRequest`, the `role` option) | T020, T022, T024 | T021, T023, T025 |

`[P]` slices (U1c, U3a, P1) touch files no other slice of their round touches; the rest of each round
shares `agents/load-tester.md`, `test/install.test.mjs` or `hooks/speckit-team.mjs` and runs in task
order.

## Implementation Strategy

MVP: rounds 1 (the role, its lane and its step) and the instrument rules of round 2. Each later slice
adds rules to the body without changing the wiring.
