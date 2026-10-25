# Tasks: Skill-Agents Team Mode

**Input**: `plan.md`, `contracts/skill-agents.md`, `data-model.md`, `research.md`, `spec.md`

**Tests**: required (Constitution I). Each slice's test tasks come before its implementation task.
US2 (nothing else changes) is held by the existing suite left unedited (SC-002) and by the cases T003
and T005 name.

Helpers named once here: `test/hook-helpers.mjs`: `repo`, `run(dir, args, payload, hook)`, `write`,
`denied`, `pass`, `stateDir`, `msg`, `commitAll`; `test/install.test.mjs`: `claudeDir`, `install`,
`roundTrip`, `AGENTS`, `TEAM_ORDER`, `teamSkill`, `flat`, `skillSection`; `test/e2e.test.mjs`:
`setup`, `session(s, script, { prompt })`, `call`, `say`, `wfile`, `recordPass`, `state`, `story`,
`lastResult`, `lastResultIsError`, `MAIN`, `noClaude`.

## Phase 1: Foundational, role skills installed (Round 1)

- [X] T001 Test in `test/install.test.mjs` (FR-009, FR-012, FR-013, SC-007, contract section 2, Edge
  "installer is run again or uninstalled"): an install writes `skills/speckit-role-<role>/SKILL.md` for
  each of `TEAM_ORDER` and none for patcher; frontmatter as contract section 2 with the installed hook's
  quoted absolute forward-slash path, and none of `context:`, `agent:`, `model:`, `allowed-tools:`; the
  text after the preamble equals the installed `agents/<role>.md` after its closing frontmatter line, so
  the test fails when the two differ; a rerun logs `unchanged` for each; `--uninstall` removes the seven
  folders (`roundTrip`); a user's own `skills/speckit-role-architect/SKILL.md` without the marker makes
  install refuse, and `--force` backs it up; `--help` names `/speckit-team --team skill-agents`.
  Validate before writing (Installation Constraints): a copied tree (`install.mjs`, `agents`, `hooks`,
  `skills`, copied as the test "--board from another checkout points the board at that checkout" does)
  whose `agents/architect.md` has no frontmatter, installed into an empty `claudeDir()`, exits nonzero
  and leaves that directory empty.
- [X] T002 Implement in `install.mjs`: `const ROLE_SKILLS = AGENTS.filter((a) => a !== 'patcher')`,
  `const ROLE_PREAMBLE` (contract section 2), `function roleSkill(role: string, agentText: string): string`
  (throws on an agent file without its frontmatter); `files()` gains
  `{ src: 'agents/<role>.md', dst: <claudeDir>/skills/speckit-role-<role>/SKILL.md, role }`. Render
  every file's content before the collision check, so a bad source writes nothing (Installation
  Constraints), then write with `write` and `{{HOOK}}` replaced as now; uninstall already removes a
  `SKILL.md`'s folder (`remove`). Header comment (the `--help` text): the role skills and the typed form.

## Phase 2: User Story 3, the typed mode in the hook (Round 1)

- [X] T003 [P] [US3] Test in `test/hook.test.mjs` (FR-002, FR-006, FR-008, FR-011, US3-1, US3-2, US3-3, Edge
  "role skill missing", contract sections 3 and 7): copy `hooks/speckit-team.mjs` into `<tmp>/hooks/`
  beside `<tmp>/skills/speckit-role-<role>/SKILL.md` for the seven roles and pass that copy as `run`'s
  `hook`, since the hook finds the skills from its own folder (`TEAM_DIR`). Payload as the existing
  typed `noagents` case: `UserPromptExpansion`, `command_name: 'speckit-team'`, `command_args`,
  `session_id`. Cases left open by the contract: `Skill-Agents` in mixed case counts; leading
  `--security` and `--project x` before `--team skill-agents` count; `skill-agents,implementer`,
  `skill-agent` and the word after the request text record no `skillAgents`; one skill missing blocks
  and names it; a later typed `/speckit-team` without it removes the team and role records (a role
  record written by hand per `data-model.md`); the `noagents` record and message are unchanged.
- [X] T004 [P] [US3] Implement in `hooks/speckit-team.mjs`, gate mode's typed `speckit-team` branch
  (contract section 3): reuse `typedRoles`, `teamFile`, `writeJson`, `TEAM_DIR`, `TEAM_ROLES`, `block`;
  add `const roleFile = (sessionId: string): string` (`role/<id>.json` under `stateDir`),
  `function missingRoleSkills(): string[]`, the start message (contract section 7) as a constant;
  `teamOf()` returns `skillAgents` (data-model).

## Phase 3: User Story 1, the skill runs the roles as skills (Round 1)

- [X] T005 [US1] Test in `test/install.test.mjs` on the installed `skills/speckit-team/SKILL.md` (FR-001,
  FR-002, FR-003, FR-004, FR-006, FR-007, FR-012, US1-1 to US1-3, US3-1 to US3-4, US4-1, US4-2, contract
  section 1, plan D2 and P3): `argument-hint` names `skill-agents`; `## Team` gives the contract's
  refusals and says the question does not offer it; the question's four options do not mention it; a
  `## Skill agents` section says: no Agent call; each step's role is a Skill call to
  `speckit-role-<role>` with that role's Inputs (`## Handoffs` bullets) as its `args`; one line naming the
  role before each call; one role at a time (plan P5): one role Skill call per response, never two in
  one message, and the launches the steps send side by side (`## Handoffs`, "in one message as several
  Agent calls"; the answers paragraph's architect revision with product-owner's `Spec:` lines) become
  one role call after the other, the next after the previous role's work is done; a role that goes on
  after the user answers in a new message is called again before it writes (plan D8); the stops of steps 1 to 6 hold; the side-by-side question is not asked; with
  `--project` the block is read from `node "{{HOOK}}" project` output and followed by every role, as
  `## No agents` step 1; security-reviewer at both points of steps 1 and 6; the skill counts 3
  `RESULT: RED` in a row itself; the hook's start message is not repeated.
- [X] T006 [US1] Implement in `skills/speckit-team/SKILL.md`: the `argument-hint`, a `## Team` paragraph
  and refusals (contract section 1), and a `## Skill agents` section after `## No agents` that maps each
  step's launch to its Skill call, says the one-at-a-time rule (plan P5) where it replaces the
  side-by-side launches, says a role continued in a later turn is called again (contract section 8), and
  points to the steps instead of restating them. At most 3,000
  characters added in all: every `/speckit-team` run reads the skill.

## Phase 4: User Story 3, guardrails in the session (Rounds 2 and 3)

Team record for unit tests: written by hand into `stateDir(dir)/team/<session_id>.json` as
`data-model.md` gives it, since the source hook's `TEAM_DIR` has no role skills.

- [X] T007 [US3] Test in `test/hook.test.mjs` (contract section 4, FR-005, FR-006, FR-008, US3-5 first
  half): PreToolUse `Skill` payloads with `tool_input.skill`. Open cases: no record, a `noagents` record
  and a plain team record all deny; product-owner is let through and writes the role record with the
  data-model fields; test-writer, implementer and spec-gatekeeper are denied before `pass(dir)`, let
  through after it, and denied again after a spec edit (spec-gatekeeper also after an edit made while
  the implementer role acted, plan D6); with a skill-agents record every such denial, and a main-session
  `speckit-implement` Skill call's, carries contract section 4 step 4's reason (names
  `speckit-role-spec-auditor`, not `@agent-spec-auditor`); a call with `agent_id` decides nothing; `speckit-role-patcher` and
  `speckit-role-x` decide nothing; `plugin:speckit-role-architect` counts; a missing or malformed
  `session_id` or `tool_input` never crashes.
- [X] T008 [US3] Test in `test/e2e.test.mjs` (contract sections 3 and 4, research R3): `session` with
  `prompt: '/speckit-team --team skill-agents ' + MAIN`; the main script's Skill call to
  `speckit-role-test-writer` gets the `Implementation gate` result naming `speckit-role-spec-auditor` and
  not `@agent-spec-auditor` (contract section 4 step 4), then one to `speckit-role-architect`
  goes through and the only file under `.git/speckit-team/role/` names architect. Fails with
  `SPECKIT_E2E_NO_HOOK=1`.
- [X] T009 [US3] Implement in `hooks/speckit-team.mjs`, gate mode's PreToolUse `Skill` branch, contract
  section 4 steps 1, 2, 4, 5: `const ROLE_SKILL = /(^|:)speckit-role-([a-z-]+)$/` over the name the branch
  reads for `speckit-implement` (`ti.skill_name || ti.skill || ti.name`); add
  `function auditorRef(): string` (`the Skill speckit-role-spec-auditor (an agent launch ends
  skill-agents mode)` when `teamOf()?.skillAgents`, else `@agent-spec-auditor`), used in place of
  `@agent-spec-auditor` in gate mode's `Implementation gate:` reason, the one denial text of both branches; reuse `teamOf`, `auditProblem`, `deny`, `git(root, 'rev-parse', 'HEAD')`, `changedSince('HEAD')`,
  `feature`, `fingerprint`, `writeJson`, `roleFile`; the transcript's size by `fs.statSync`, 0 when it
  cannot be read.
- [X] T010 [US3] Test in `test/hook.test.mjs` (contract section 5, FR-008, SC-006, US3-6, Installation
  Constraints): `write(dir, ['scope', 'role'], file, { session_id })` with a role record per row of the
  contract's table; no record, or `agent_id` set, decides nothing; an unreadable record denies; a repo
  from `repo({ speckit: false })` decides nothing; the git directory is denied. Twin: `ROLE_LANES` read
  from the hook's source equals, per role, the `scope` arguments in `agents/<role>.md`, or `['none']`
  where its `disallowedTools` has `Write`. Ended record (contract section 8, plan D8, H1): the test writes
  the record's `transcript` as JSONL with rows after `offset`, one case per row kind section 8 names as
  ending or keeping the role; an ended record of each lane kind denies nothing, gives section 8's message
  once and is removed; an unreadable transcript keeps the role's denials.
- [X] T011 [US3] Test in `test/e2e.test.mjs` (FR-008, US3-6, research R2): typed as in T008, then
  `recordPass(s)`; the main script calls the Skill `speckit-role-architect`, then `wfile` to `src/x.js`
  (denied with architect's lane text), then the Skill `speckit-role-spec-auditor`, then `wfile` to
  `specs/001-x/spec.md` (denied as read-only), which shows the Skill's own rows keep the role live on
  the Claude Code under test. After the session, `run(dir, ['scope', 'role'], …)` on a role record over
  that session's real transcript with `offset: 0` (the typed prompt's row lies after it) decides nothing
  (contract section 8). Fails with `SPECKIT_E2E_NO_HOOK=1`.
- [X] T012 [US3] Implement in `hooks/speckit-team.mjs`, scope mode: `const ROLE_LANES` (contract
  section 5), rule `role` resolved from the session's role record to its rule and prefixes, rule `none`
  denying every path, denial texts naming the role; reuse `readState`, `roleFile`, `inLane`,
  `inPrefixes`, `inGitDir`, `repoRel`, `deny`. Contract section 8: `function linesAfter(file: string,
  offset: number): string[] | null` (the JSONL lines from byte `offset`, `null` when unreadable; reuse
  `lines`), `function promptRow(line: string): boolean`, `function roleEnded(rec: object): boolean`
  (`false` for an unreadable transcript) and `function dropRole(rec: object): string` (removes the record,
  returns section 8's message; the caller sends it as `systemMessage` with its own outcome, through
  `emit` at the end, so a Skill call still reaches its gate and new record), called before the lane rule
  is resolved.
- [X] T013 [US3] Test in `test/hook.test.mjs` (contract section 6 steps 1 and 3, FR-008, US3-6): role
  record written by a Skill call payload; files created on disk as Bash would, committed or not. Open
  cases: outside the lane, the next role's Skill call is denied naming the file and the start sha's 12
  characters; `run(dir, ['lane', 'role'], { hook_event_name: 'Stop', session_id })` blocks, and with
  `stop_hook_active` gives the `WARNING` message and removes the record; a file dirty at the role's start
  is not counted; a file written through Bash under a read-only role is not counted, its Stop and the
  next Skill call decide nothing (plan D7); an ended record (contract section 8, plan D8) with a file
  outside its lane: the Stop neither blocks nor warns and removes it with section 8's message, and the
  next role's Skill call is let through with a new record; the same role called again in the next turn
  (M3) gets its lane back: a write outside it is denied, and its Stop checks only what changed since
  that call; no record decides nothing; an unreadable
  record, a non-hex sha (`--output=x`) or a sha that is no commit says the lane check could not run.
- [X] T014 [US3] Test in `test/e2e.test.mjs` (FR-008, US3-6, research R2): typed as in T008,
  `recordPass(s)`; the main script calls the Skill `speckit-role-implementer`, writes a test file through
  Bash as the existing case "implementer may not change tests, and its lane check catches a test written
  through Bash" does, then ends with `say`; the Stop is blocked with the lane check's text. Fails with
  `SPECKIT_E2E_NO_HOOK=1`.
- [X] T015 [US3] Implement in `hooks/speckit-team.mjs`: `function closeRole(rec: object, at: 'skill' | 'stop'): void`
  (contract section 6 steps 1 and 3; denies at a Skill call, blocks at Stop), called from T009's step 3
  and from lane mode's `role` rule. Take lane mode's check (`hooks/speckit-team.mjs`, `mode === 'lane'`:
  the unreadable and incomplete start record, the hex-sha test that keeps options out of git's
  arguments, `testPaths.bad`, `git cat-file -e`, then `changedSince` minus `dirty` outside the rule) out
  into `function laneOutside(base: object | null, rule: string, prefixes: string[], who: string): { problem: string } | { outside: string[] }`
  (`problem` is the existing `lane check could not run for <who>: ...` text; `testPaths.bad` counts for
  `tests` and `no-tests` only). `closeRole` first hands an ended record (T012's `roleEnded`) to T012's
  `dropRole`, closes nothing and passes its message on to the caller's output (contract section 8). `closeRole` skips the lane check for a role whose rule is `none` (plan D7). Lane mode calls it with its `who` and
  rule and keeps its messages, so its existing `test/hook.test.mjs` lane cases hold the change; `closeRole`
  calls it with the role record and `ROLE_LANES[role]`. Also reuse `block`, `deny`, `emit`.
- [X] T016 [P] [US3] Test in `test/hook.test.mjs` (contract section 6 step 2, FR-008, US3-5, research R1):
  the test writes a transcript JSONL of rows `{ type: 'assistant', message: { role: 'assistant', content:
  [{ type: 'text', text }] } }` and passes it as `transcript_path` of the Skill call that starts the role.
  Open cases: a PASS from the spec-auditor role is recorded at the test-writer Skill call, which is then
  let through (closing comes before the gate); FAIL is recorded and test-writer denied; no VERDICT line
  records nothing and says so; a PASS above the offset is ignored; a spec edit after the role started
  records nothing and says so; both of those messages name `speckit-role-spec-auditor` and not
  `@agent-spec-auditor` (contract section 6 step 2); the spec-gatekeeper role's last line `APPROVED` is recorded at Stop; both
  records carry `role` and `agent_id: null`; a missing transcript says so and never crashes.
- [X] T017 [P] [US3] Test in `test/e2e.test.mjs` (FR-008, US3-5, research R1): extend `reply` so a step
  with both `text` and `name` sends a text block then the tool call in one response. Session 1: typed as
  in T008; the Skill `speckit-role-spec-auditor`, then one step with text ending `VERDICT: PASS` and the
  Skill `speckit-role-test-writer`: the call goes through and `state(s, 'verdicts', '001-x.json')` is
  PASS. Session 2: the auditor role, then `say` ending `VERDICT: PASS`: the Stop records it. Fails with
  `SPECKIT_E2E_NO_HOOK=1`.
- [X] T018 [P] [US3] Implement in `hooks/speckit-team.mjs`, `closeRole` step 2: `function roleTexts(file: string, offset: number): string[]`
  reading through T012's `linesAfter`, built on `function assistantText(line: string, mainOnly: boolean): string`, the row parsing taken out
  of `lastAssistantText` (`hooks/speckit-team.mjs`; one JSONL row to its assistant text, `''` for a
  malformed or non-assistant row and, with `mainOnly`, a sidechain row), which `lastAssistantText` then
  calls with `false`; `function verdictIn(text: string): 'PASS' | 'FAIL' | null` and
  `function lastWord(text: string): string` taken out of the `verdict` and `ends` modes and used by them
  too, so their existing cases hold all three extractions; records via `verdictFile`, `endsFile`,
  `writeJson`, with `role` (data-model); the stale and none-found messages name the auditor through
  T009's `auditorRef`.

## Phase 5: User Story 1, the full run in this mode (Round 3)

- [X] T019 [P] [US1] Test in `test/full-run.test.mjs` (SC-001, SC-004, FR-014): `args` takes
  `--skill-agents` as a flag without a value; `firstPrompt(request, { skillAgents: true })` is
  `/speckit-team --team skill-agents <request>` and without it `/speckit-team <request>`;
  `checkRun({ ..., skillAgents: true })` fails on any entry in `usage.main.launches` and on any of the six
  core `speckit-role-<role>` names missing from `usage.main.skills`, and does not fail for no launch or no
  agent transcript; the existing passing-run case still passes without the option.
- [X] T020 [P] [US1] Test in `test/usage.test.mjs` (SC-001): `skills(rows)` lists the main session's Skill
  tool calls by `input.skill` (or `skill_name`) in order, skipping sidechain rows; `summarise(file).main.skills`
  holds the same list. Row builders: the ones at the top of the file.
- [X] T021 [P] [US1] Implement in `tools/usage.mjs`: `export function skills(rows: object[]): string[]`
  beside `launches`, and `main.skills` in `summarise`. In `tools/full-run.mjs`: `args` sets
  `skillAgents`; `export function firstPrompt(request: string, { skillAgents = false } = {}): string`,
  used by `main`; `checkRun` option `skillAgents = false`; `--login` also excludes
  `/.claude/skills/speckit-role-*/`; the header's usage line.

## Phase 6: Polish (Rounds 4 and 5)

T024 runs in Round 4, before T022 and T023, so the README's verified-live statement (FR-010) reports
what was seen.

- [X] T022 Test in `test/install.test.mjs` (FR-010, Constitution VIII, plan P4): README.md has a section on
  `--team skill-agents` that names the enforced and the not-enforced guardrails of contract section 7
  and says what was verified live and what by test; its guardrail table has `scope role` and `lane role`
  rows; the Claude Code row of "Requirements" names skill frontmatter `hooks:` and `user-invocable`;
  CLAUDE.md "Rules" names the `ROLE_LANES` twin. Pattern: the existing "README has a "Choosing the
  team" section" test.
- [ ] T023 Implement docs: `README.md` (Contents; "Requirements": the Claude Code row adds skill
  frontmatter `hooks:` and a model-invoked `user-invocable: false` skill for `--team skill-agents`,
  research R2 and R3, verified on the version T024 recorded; "What gets installed"; "Choosing the
  team", whose verified-live statement reports T024's `docs/live-results.md` entry; the guardrail
  table's `scope role`, `lane role` and `gate` rows; "Live check" steps for this mode as T024 ran them;
  Troubleshooting for the deny of section 4 step 2; known limits: each role on the session's model, with
  `CLAUDE.md`, seeing the conversation; the test count from `npm test`), `CLAUDE.md` (Layout: generated
  role skills; Rules: the `ROLE_LANES` twin and role-skill frontmatter as a place for a hook command; the
  test count), `docs/architecture.md` (the inline mode in the pipeline overview).
- [X] T024 Measure (FR-014, SC-001, SC-004, SC-005, plan D4, Constitution II live check): run
  `node tools/full-run.mjs --out <dir> --login` and `--login --skill-agents` on the same day, read each
  transcript with `node tools/usage.mjs`, and write to `docs/measurements.md` a section with both runs'
  input tokens, cache reads, cost, models, date and check results. Live check: README.md "Live check"'s
  procedure typed as `/speckit-team --team skill-agents <request>`, seeing the start message (contract
  section 7), a `speckit-role-test-writer` call before an audit denied with contract section 4 step 4's
  text, and a Write outside architect's lane denied; record what was seen and `claude --version` in
  `docs/live-results.md`. A run that cannot start from an agent's shell goes to the user.

## Dependencies

Round 1 before Round 2: T008, T011, T014 need T002's installed role skills and T004's typed record.
T015 builds on T009 and T012, T018 on T015. T024 needs T001 to T021; T023 needs T024's records. Within a round,
one test-writer then one implementer.

## Rounds

- Round 1: red T001, T003, T005; green T002, T004, T006
- Round 2: red T007, T008, T010, T011, T013, T014; green T009, T012, T015
- Round 3: stub T021; red T016, T017, T019, T020; green T018, T021 [P]
- Round 4: green T024
- Round 5: red T022; green T023
