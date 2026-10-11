# Tasks: Choose the team size per request

**Input**: `specs/006-choose-team-size/` (plan.md, contracts/team-choice.md, data-model.md,
quickstart.md, spec.md)

**Tests**: required (constitution I). In each slice the test tasks come first.

**Rounds**: one phase per round. US3 is built first although it is P2: a subset run of US1 passes
through its gate. US2 has no slice of its own: its behaviour is the absence of a `Team:` line, held by
T003 (US2-2, SC-002, SC-004: the existing gate tests stay as they are) and T008 (US2-1, FR-002).

No stub tasks: the hook and the installer are driven as processes, and the prompts are read as
installed files, so no test calls a symbol that does not exist yet.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: User Story 3 - Guardrails follow the chosen team (Priority: P2, built first)

**Goal**: the audit gate opens for test-writer and implementer when the session's recorded team has
no spec-auditor, and blocks exactly as today otherwise.

**Independent test**: drive `node hooks/speckit-team.mjs gate` with an `Agent` launch carrying
`Team: test-writer, implementer`, then a test-writer tool call of the same session: allowed. The
same with `spec-auditor` in the line: denied with today's text.

### Slice 1: the team record at an Agent launch

- [X] T001 [US3] Test in `test/hook.test.mjs` (helpers `repo`, `run`, `stateDir`, `denied`) the
  recorder of `contracts/team-choice.md` section 7, first table, and the record of `data-model.md`:
  covers FR-009, FR-006 (the hook's side), the Edge Cases on a name given twice and on case and
  order, constitution II and III. Not settled there: no `Agent` launch from the main session ever
  gets a `permissionDecision`, with or without a PASS (today `gate` would deny it); a launch from a
  subagent (`agent_id` set) records nothing; outside a Spec Kit repo (`repo({ speckit: false })`)
  there is no output and no record; a `session_id` of `../x` or 200 characters is unusable.
- [X] T002 [US3] Implement in `hooks/speckit-team.mjs`, inside `if (mode === 'gate')` before the
  `Skill` branch: on `event === 'PreToolUse'` with `input.tool_name === 'Agent'` and no `agentId`,
  record or remove the team and `process.exit(0)` / `emit({ systemMessage })`, never `deny`. New:
  `const TEAM_ROLES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'];`
  `function parseTeam(prompt): { roles: string[] } | { bad: string } | null` (null: not a string or
  no `^Team:` line; `bad`: the first word not in `TEAM_ROLES`, or `''` for no role);
  `const teamFile = (sessionId) => path.join(stateDir, 'team', \`${sessionId}.json\`)`. Uses
  `str`, `writeJson`, `stateDir`, `emit`, `agentId` from the same file; message texts from the
  contract.

### Slice 2: the gate and the retry count follow the record

- [X] T003 [US3] Test in `test/hook.test.mjs` (helpers `repo`, `run`, `pass`, `report`, `denied`,
  `stateDir`, `FEAT`) contract section 7's subagent rules: covers US3-1, US3-2, FR-007, SC-003,
  SC-004, US2-2. Not settled there: the record is written by a T002 launch with the same
  `session_id` as the subagent call; another session's record is ignored; a record holding `{` or
  `{"roles": 3}` keeps the gate shut with today's `has not passed` text; the lane start record
  (`.git/speckit-team/agents/<agent_id>.json`) is still written when the audit is skipped; `gate
  retries` with the audit skipped and `.specify/feature.json` removed exits 0 with no decision and
  still writes that lane start record for its `agent_id` (D7), and with a feature still denies after
  3 REDs (`MAX_RED`); `result` with the audit skipped counts a RED
  instead of `not counted`; a `Skill` call to `speckit-implement` and a typed
  `UserPromptExpansion` without `agent_id` stay blocked whatever the record says. Every existing
  gate, result and retry test stays unchanged (SC-002).
- [X] T004 [US3] Implement in `hooks/speckit-team.mjs`: `function teamOf(): string[] | null` (the
  roles in `teamFile(str(input.session_id))` when the id matches `^[\w-]{1,128}$` and `roles` is an
  array of `TEAM_ROLES` names, else null; uses `readState`) and `function auditSkipped(): boolean`
  (`Boolean(agentId)` and `teamOf()` lacks `spec-auditor`). In `if (mode === 'gate')` skip the
  `auditProblem()` deny when `auditSkipped()`; enter the `args[0] === 'retries'` branch only when
  `feature()` is not null (hoist `const feat = feature()` into its condition), with no `return` or
  `process.exit` there: it is module top level, and the lane start record after it
  (`baseFile(agentId)`, `writeJson`) must still be written (D7); in `if (mode === 'result')` use
  `auditSkipped() ? null : auditProblem()` for `closed`. Update the header comment's `gate` lines
  (lines 12 to 14) for the `Agent` launch and the team.

### Slice 3: Claude Code calls the gate on Agent launches

- [X] T005 [US3] Test in `test/install.test.mjs` (helpers `claudeDir`, `install`, `settingsOf`,
  `gates`, `UNRELATED`) the installer side of D1: covers contract section 7's first sentence. Not
  settled there: `gates(settingsOf(dir))` holds `PreToolUse:Skill|Agent` and
  `UserPromptExpansion:speckit-implement|speckit\.implement`; a settings file with an older
  `matcher: 'Skill'` entry of ours ends with one `Skill|Agent` entry and `UNRELATED` kept; the
  entry's command is still `node "<absolute hook path>" gate`; a second install changes no byte;
  `--uninstall` leaves no entry.
- [X] T006 [US3] Test in `test/e2e.test.mjs` (helpers `setup`, `session`, `call`, `MAIN`,
  `lastResult`, `story`, `spec`, `state`) the wiring under `claude -p`: covers US3-1, US3-2, FR-007,
  FR-009 and the plan's `session_id` assumption. Not settled elsewhere: `MAIN` launches test-writer
  with `call('Agent', { ..., prompt: 'e2e test-writer: go\nTeam: test-writer, implementer' })` and its
  `Read` of `spec(s)` returns the spec, and `state(s, 'team', <session>.json)` holds the two roles;
  with `Team: spec-auditor, architect, product-owner, test-writer` the `Read` gets `Implementation
  gate: spec-auditor has not passed specs/001-x`; a first launch with the subset line then a second
  launch with no `Team:` line in the same session gets the gate's denial. With
  `SPECKIT_E2E_NO_HOOK=1` the second and third cases fail (CLAUDE.md, Verify). The cases go after
  the file's last test, inside the run of hook-firing tests that README.md "End-to-end tests" counts
  (T016).
- [X] T007 [US3] Implement in `install.mjs: SETTINGS_GATES` the PreToolUse matcher `'Skill|Agent'`
  and its comment (Claude calling the speckit-implement skill, and the main session launching an
  agent). `install.mjs: withGates` needs no change: it rewrites `matcher` from `wanted.matcher`.

**Checkpoint**: `node --test test/hook.test.mjs test/install.test.mjs test/e2e.test.mjs` green.

---

## Phase 2: User Story 1 - Run a request with a chosen subset of the team (Priority: P1)

**Goal**: `/speckit-team --team test-writer,implementer <request>` launches those two only, from
the request text, with no spec, plan or audit stop.

**Independent test**: the installed `skills/speckit-team/SKILL.md` states each rule below; quickstart
L1 shows it live (T018).

### Slice 4: the team choice at the start of a run

- [ ] T008 [US1] Test in `test/install.test.mjs` (helpers `claudeDir`, `install`, `flat`, `AGENTS`)
  that the installed `skills/speckit-team/SKILL.md` carries contract sections 1 to 3 and 6: covers
  FR-001, FR-002, FR-005, FR-006, US1-3, US1-5, US2-1 and the Edge Cases on unknown names, empty
  teams, names given twice and case and order. Not settled there: the skill's six role names equal
  `AGENTS` without `patcher` and the list in `hooks/speckit-team.mjs`'s `const TEAM_ROLES = [...]`
  (read from the source); the frontmatter `argument-hint` names `--team`; the `Team:` line's form is
  quoted exactly and the skill says a full-team run has none; the refusal comes before any launch.
- [ ] T009 [US1] Implement in `skills/speckit-team/SKILL.md`: `argument-hint: "[--team <role>,<role>...] <feature idea>"`;
  a `## Team` section after `## 0. Preconditions` with contract sections 1 to 3 (syntax, the six
  names, the refusals with their reasons) and the one-line start notice built from section 5's
  rows; in `## Handoffs`, the `Team:` line of section 6 in every launch prompt of a subset run and
  none in a full-team run.

### Slice 5: every step follows the team

- [ ] T010 [US1] Test in `test/install.test.mjs` that the installed skill guards each of its steps
  by role and runs the brief round: covers FR-003, FR-004, FR-007, FR-008, FR-012, US1-1, US1-2,
  US1-4, US3-3, SC-001, SC-003, SC-005 and the Edge Case on a role whose input no chosen role
  writes. Not settled elsewhere: steps 1, 2, 3 and 6 each name their role as the condition; findings
  and REJECTED reasons go only to a chosen role and otherwise to the user; without product-owner the
  skill creates the `team/` branch of contract section 4 before the first launch; the brief round is
  one test-writer then one implementer with `last round`; step 6 launches no implementer for a task
  of an absent role, starts spec-gatekeeper after the last test-writer `RED` when implementer is
  absent, and puts the `Unbuilt:` line of contract section 5 in its prompt (quoted exactly), and
  `## Handoffs` names that line for spec-gatekeeper; step 4-5 says that with no active feature the
  main session stops relaunching implementer after 3 REDs in a row and hands the output to the user
  (D7); step 7's report lists the roles that ran, section 5's rows for the absent ones, the unticked
  tasks and the D7 count; `## 0b.` runs only when architect, spec-auditor or spec-gatekeeper is
  chosen, and without product-owner its draft is committed with the first launch (contract section
  5, Constitution); with implementer absent, step 4-5's Red check counts a failure on a missing
  production symbol or module that test-writer lists as red, still sends back a syntax error, and
  runs no stub step (contract section 5, implementer row); the existing assertions on `## 4-5.`
  (`installed speckit-team skill builds a tasks.md phase per round`) and on step 6 still hold.
- [ ] T011 [US1] Implement in `skills/speckit-team/SKILL.md`: a role condition at the head of
  `## 0b. Constitution` (architect, spec-auditor or spec-gatekeeper) and, in its item 3, where the
  draft is committed without product-owner (contract section 5, Constitution); at the head of
  `## 1. Spec: product-owner`, `## 2. Plan and tasks: architect`, `## 3. Audit: spec-auditor`,
  `## 6. Verify: spec-gatekeeper`; in `## 4-5.`, the one-round brief run of contract section 4,
  the skip of an absent role's step and tasks, in its step 2 (Red) the implementer-absent exception
  to `A syntax error, a missing import or module, an undefined name or a compile error is a broken
  test` and to `run step 1 for it` (contract section 5, implementer row), and in its step 3 (Green) the no-feature count of
  contract section 5 (D7) beside `After 3 REDs in a row the hook blocks implementer`; in `## 6.`,
  the start condition and `Unbuilt:` line of contract section 5, with `A task still unticked then`
  limited to the chosen roles' tasks; in `## Handoffs`, the `Unbuilt:` line in the spec-gatekeeper
  entry; commits of approved files with the next launch whichever role it is; in `## 7. Hand
  over`, the report of contract section 5 (FR-008).

### Slice 6: the build roles take a brief and the Team line

- [ ] T012 [US1] Test in `test/install.test.mjs` that the installed `agents/test-writer.md`,
  `agents/implementer.md` and `agents/spec-gatekeeper.md` follow contract sections 4 to 6: covers
  FR-007 (spec-gatekeeper's checks), FR-012, SC-003, SC-005. Not settled there: test-writer and
  implementer read a brief in their prompt in place of task IDs and tick nothing then; test-writer,
  with a `Team:` line lacking implementer, lists a missing production symbol and still ends `RED`
  instead of `BLOCKED` (contract section 5, implementer row); spec-gatekeeper reads the `Team:` and
  `Unbuilt:` lines, skips exactly the `Unbuilt:` IDs in its open-task check and still rejects any
  other open task, skips that check when there is no `tasks.md`, reports a check whose role is
  absent as skipped and not as a REJECTED reason, and traces the brief's requirements when there is
  no `spec.md`; the existing test `README states the agent bodies' length as agents/*.md has it`
  still holds.
- [ ] T013 [US1] Implement in `agents/test-writer.md` (`## Inputs`, Process 2's missing-stub
  bullet, Process 3 and 4), `agents/implementer.md` (`## Inputs`, Process 4) and
  `agents/spec-gatekeeper.md` (`## Inputs`, Process 1 and 2, `## Verdict`'s `any task is open`)
  the rules of T012, and update README.md's sentence `Those bodies
  are 22 to 94 lines long` (section "The team") if the new body lengths move either bound.

**Checkpoint**: `node --test test/install.test.mjs` green.

---

## Phase 3: User Story 4 - Choose the team without remembering role names (Priority: P3)

**Goal**: with no `--team`, one question with the full team recommended.

### Slice 7: the team question

- [ ] T014 [US4] Test in `test/install.test.mjs` that the installed skill asks contract section 8's
  question: covers FR-010, US4-1, US4-2. Not settled there: one AskUserQuestion call before any
  launch; the full team is its first option and marked recommended; a free-text answer is checked
  by the same refusals as `--team`; a request with `--team` is never asked; the question is marked
  `**Stop:**`, the marker `## Pace` waits on (contract section 8).
- [ ] T015 [US4] Implement in `skills/speckit-team/SKILL.md: ## Team` the question of contract
  section 8, marked `**Stop:**`, and its answer's path into the T009 checks.

---

## Phase 4: Polish - documentation, the live check and the demo

### Slice 8: the docs say how to choose the team

- [ ] T016 Test in `test/install.test.mjs` the docs of FR-011 and constitution VIII: README.md has a
  section on choosing the team whose table names every `TEAM_ROLES` role with the steps and
  guardrails its absence skips; README's guardrail table row for the `settings.json` `gate` names
  `Skill|Agent`; `node install.mjs --help` prints a `--team` line; CLAUDE.md's Rules name the
  `Team:` and `Unbuilt:` lines as rules held by `test/install.test.mjs`. Stop count (D4, contract
  section 8): README's `You decide at ... stops` and `It stops for you at ... points` say four
  (the third statement is T019's), and the numbered list after the second has four items, the first the team question, skipped when `--team` names the team. E2E count: README
  "End-to-end tests"'s `The <n> tests fire every hook entry` and `all <n> fail` equal the number of
  `test(` calls in `test/e2e.test.mjs` from `architect's and product-owner's scope hooks deny a
  Write outside their lanes` to the end of the file, and the sentence names the `Skill|Agent` gate.
  Pattern: `README states the agent bodies' length as agents/*.md has it` (`flat`, the repo root).
- [ ] T017 Implement the docs: README.md: a `#### Choosing the team` subsection under "The pipeline
  skill" with contract sections 1, 3, 5 and 8, a `--team` example in Quick start "2. Run the
  pipeline", the `gate` rows of "Guardrails", a paragraph in "The audit gate" on the team record,
  `team/` in "State", D6's and D7's lines in "Known limits", the test count in "Test suite", the
  stop count in "Highlights" (`You decide at three stops`), Quick start "2. Run the pipeline" (`It
  stops for you at three points` and its list), and in "End-to-end tests" the e2e count, the `Skill|Agent` gate, and the `all <n> fail` claim measured again with
  `SPECKIT_E2E_NO_HOOK=1`, with its date and Claude Code version (a case that does not fail is
  named, constitution VIII);
  CLAUDE.md: the `Team:` line in Rules (skill, `TEAM_ROLES`, spec-gatekeeper, held by
  `test/install.test.mjs`) and beside it the `Unbuilt:` line (skill, spec-gatekeeper), and the test
  count in Verify; `install.mjs`'s header comment (its `--help` text): a line on
  `/speckit-team --team <roles> <request>`.
- [ ] T018 Run `specs/006-choose-team-size/quickstart.md` L1 to L4 and record each result, with the
  date and the Claude Code version, in README.md "Live results"; say which were seen live and
  which only in tests (constitution II and VIII).

### Slice 9: the pipeline demo shows the team question

- [ ] T019 Test in `test/install.test.mjs` the demo of constitution VIII and CLAUDE.md's
  `docs/media/` rule: covers FR-010, US4-1 as the README shows them. Not settled elsewhere:
  `docs/media/pipeline.tape` (read as text) answers the team question with its first option after
  the `Type "/speckit-team ..."` line and before the wait for product-owner's question dialog
  (today's `Wait+Screen@10m /Submit|Esc to cancel/`), and its first-line comment names both stops;
  README.md "What it looks like" > "The pipeline" names the team question as the first of the
  pipeline's four stops and product-owner's questions as the second, in the paragraph (today
  `the first of the pipeline's three stops`) and in the `pipeline.gif` alt text.
  Pattern: `README states the agent bodies' length as agents/*.md has it` (`flat`, the repo root).
- [ ] T020 Implement in `docs/media/pipeline.tape` (header comment, the steps after `Type
  "/speckit-team ...`) the team question's answer, Enter on `Full team (Recommended)`, and a wait
  for product-owner's dialog that starts once the team dialog has closed; in README.md "The
  pipeline" the paragraph and alt text of T019; then re-record with `node docs/media/record.mjs
  pipeline` (README "Recording the demo media": vhs, `specify`, `claude`, git on PATH, live Haiku
  calls), which publishes `docs/media/pipeline.gif` only through `docs/media/leaks.mjs: publish`,
  and look at every frame per that section's caution. If a tool is missing, the gif stays as it
  was and the hand-over says it was not re-recorded.

---

## Dependencies and execution order

- Phase 1 (T001 to T007) first: T006 needs T002 and T007, and T008 reads `TEAM_ROLES` from T002.
- Phase 2 after Phase 1; Phase 3 after T009 (same section); Phase 4 last (T016 reads the skill and
  the hook; T018 and T020 need everything installed, T020 the skill of T009 to T015).
- Within a round, slices run in task order: each pair shares a file (`test/hook.test.mjs`,
  `hooks/speckit-team.mjs`, `skills/speckit-team/SKILL.md`, `test/install.test.mjs`), so none is
  marked `[P]`.

## Implementation strategy

Round 1 (slices 1 to 3) makes a subset run possible at all; round 2 (slices 4 to 6) is the MVP the
user asked for; round 3 is convenience; round 4 is docs, the live check and the demo recording.
