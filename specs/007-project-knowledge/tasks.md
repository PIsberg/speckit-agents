# Tasks: Project knowledge for the team

**Input**: `specs/007-project-knowledge/` (plan.md, contracts/project.md, data-model.md,
research.md, quickstart.md, spec.md)

**Tests**: required (constitution I). In each slice the test tasks come first and are seen failing.

**Rounds**: one phase per round. US2 (off by default, P1) has no slice of its own: its behaviour is
the absence of a `Project:` line, held by T003 (no record, no context), T009 (the skill writes the
line only with the flag) and every existing test staying unchanged (SC-001).

No stub tasks: the hook and the installer are driven as processes and the skills are read as
installed files, so no test calls a symbol that does not exist yet.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational - the project block (blocks every story)

**Goal**: `node hooks/speckit-team.mjs project <name>` validates a project and prints its block.

**Independent test**: run the mode in a throwaway repo with a valid, an unknown and an oversize
project; compare stdout and exit codes with contracts/project.md section 3.

### Slice 1: the CLI mode

- [X] T001 Test in `test/hook.test.mjs` (helpers `repo`, `stateDir`; spawn `node HOOK project ...`
  with `cwd` in the repo) contract section 3: success output for a project with `instructions.md`
  and two knowledge files, one in a subdirectory (header line, precedence sentence, every
  instruction line indented by two spaces including an empty one, files sorted with byte sizes);
  `Instructions: none.` and `Knowledge files: none.`; dotfiles, dot-directories and a symlink (skip
  the symlink case where `fs.symlinkSync` throws, as on Windows without the privilege) are not
  listed; each refusal row of the table with exit 1 and its exact line, `<list>` included; a name
  in another case than the directory is unknown; a directory named `instructions.md` is refused,
  not thrown; exactly 8,192 bytes and exactly 100 files pass, one more of either is refused; the
  mode completes with stdin held open (spawn with `stdio: ['pipe', ...]` and never end it, 10 s
  timeout); the state directory is unchanged after a run (FR-013); outside a Spec Kit repo
  (`repo({ speckit: false })`) exit 1 with `no .specify/ in this repository`, and the same for a
  directory holding `.specify/` that is no git repository, and for a git repository nested in one
  that holds `.specify/` while its own top level does not (the hook's second silent exit, audit M2).
  Contract section 3a (FR-015): `--init` creates exactly the starter file and prints its line;
  refuses an existing project, a bad name and outside a Spec Kit repo; the starter left unchanged
  (also with CRLF line endings) makes the project empty, and one edited line makes it valid.
- [X] T002 Implement in `hooks/speckit-team.mjs`: skip the stdin read when `mode === 'project'`
  (line 85); at both silent exits (the `specifyAbove` exit and the no-git-root or no-`.specify/` exit
  after `rev-parse`), print the not-a-Spec-Kit-repo refusal and exit 1 for this mode; `--init`
  per contract section 3a;
  after `inSpecKitRepo = true` and before the `inputProblem` check, `if (mode === 'project')` print
  and exit. New: `const PROJECTS_DIR = '.specify/projects'`, `const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`,
  `const MAX_INSTRUCTIONS = 8192`, `const MAX_KNOWLEDGE = 100`,
  `function renderProject(name): { block: string } | { refused: string }` (pure over the file
  system, used again by T005), with `fs.lstatSync` so symlinks are never followed. In this mode
  the `uncaughtException` handler prints `speckit-team: project: internal error (<message>)` and
  exits 1. Update the mode list in the file's header comment.

---

## Phase 2: User Story 1 - Ground a pipeline run in a project (Priority: P1), round 1

**Goal**: a `Project:` line in a launch prompt makes the hook give that agent the block at start.

**Independent test**: drive `gate` with an `Agent` launch carrying `Project: demo`, then `start`
with a `SubagentStart` of the same session: `additionalContext` is the block. Under `claude -p`
against the fake API, the subagent's first request holds it.

### Slice 2: the record at launch and the context at start

- [X] T003 [US1] Test in `test/hook.test.mjs` (helpers `repo`, `run`, `stateDir`, `msg`) contract
  section 5 and data-model.md's record: a main-session `Agent` launch of each of the seven roles
  with `Project: demo` writes `project/<session>.json` holding exactly `session_id`, `name`, `at`;
  a launch without the line removes it (US2-2, FR-006); a launch from a subagent or of another
  agent type (`Explore`) changes nothing; a line naming an unknown project writes nothing and emits
  the contract's message; no launch gets a `permissionDecision`; a `SubagentStart` with a record
  returns `hookSpecificOutput.additionalContext` equal to T001's block, and without a record returns
  what it returns today (US2-1); a record whose project was deleted returns no context and a
  `systemMessage` naming the reason; an unreadable record (`{`) gives a `systemMessage` and no
  context; the lane start record is still written for product-owner and architect and not for the
  other five roles; a typed `/speckit-team` (`UserPromptExpansion`) removes the project record.
  Malformed input, each with exit 0 and no throw (constitution II, audit C1): an `Agent` launch whose
  `tool_input.prompt` is a number, an array or missing, or whose `subagent_type` is not a string,
  records nothing and decides nothing; a `SubagentStart` with no `session_id`, a `session_id` of
  `../x`, no `agent_type`, or an `agent_type` that is a number gives no context and no lane start
  record; a record whose `name` is not a string or fails the name pattern gives no context and a
  `systemMessage`.
- [X] T004 [US1] Test in `test/e2e.test.mjs` (the existing fake-API harness and its Team-line cases
  as the model): a scripted main session launches test-writer with `Project: demo` in the prompt in a
  repo holding `.specify/projects/demo/`; the fake API's first request from the subagent contains
  the block's header and an instruction line; with `SPECKIT_E2E_NO_HOOK=1` it does not.
- [X] T005 [US1] Implement in `hooks/speckit-team.mjs`: in `gate`'s `Agent` branch, before the
  team-role check and behind the same guards it has today (no `agentId`, a valid `session_id`, a
  string `prompt`, a string `subagent_type`), record or remove the project for `TEAM_ROLES` plus
  `patcher` (never a decision, then fall through to the team recording as today); in the typed `/speckit-team` branch, remove
  the project record next to the team record; in `start`, keep the lane start record for
  `product-owner` and `architect` only (by `input.agent_type`) and emit the block as
  `additionalContext` when the session has a project record. New:
  `const projectFile = (sessionId) => path.join(stateDir, 'project', \`${sessionId}.json\`)`,
  `function parseProject(prompt): string | null` with contract section 4's pattern. Update
  `WIRED` only if a new event is needed (none expected).

### Slice 3: the installer's SubagentStart matcher

- [X] T006 [P] [US1] Test in `test/install.test.mjs`: `GATES` and the #88 test expect the
  `SubagentStart` matcher `product-owner|architect|spec-auditor|test-writer|implementer|spec-gatekeeper|patcher`
  with the `start` command; a reinstall over an install with the old matcher rewrites it to the new
  one and a second run changes nothing; uninstall removes it.
- [X] T007 [P] [US1] Implement in `install.mjs`: the `SubagentStart` entry of `SETTINGS_GATES` gets
  the seven-role matcher and its comment says it also injects the project context.

### Slice 4: a typed `--project` before `--team noagents`

- [X] T008 [P] [US1] Test in `test/hook.test.mjs`: a typed `/speckit-team` with
  `--project demo --team noagents x` and with `--team noagents --project demo x` both write the
  noagents record and its message; `--project demo x` alone writes none; `--project` with no
  following word does not throw. Add a case to the e2e test of the typed noagents path in
  `test/e2e.test.mjs` with `--project demo` first.
- [X] T009 [P] [US1] Implement in `hooks/speckit-team.mjs`: `typedRoles` skips one leading
  `--project <name>` pair before looking for `--team`, in either order (contract section 2).

---

## Phase 3: User Story 1 - the pipeline skill (Priority: P1), round 2

**Goal**: `/speckit-team` parses the flag, refuses a bad project before any launch, tells the user,
and writes the `Project:` line in every launch prompt; `--team noagents` follows the block itself.

### Slice 5: `skills/speckit-team/SKILL.md`

- [X] T010 [US1] Test in `test/install.test.mjs` (installed skill text, as the `Team:` line rules are
  held): the argument hint shows `[--project <name>]`; the skill runs `node "<installed hook>"
  project` (with `{{HOOK}}` replaced); it names the `Project: <name>` line, its place after
  `Team:` and `Unbuilt:`, and every role and fix round; it says never to paste the block or the
  instructions into a prompt; the `## No agents` section says to follow the block; the start notice
  and hand-over name the project (FR-011); the Handoffs rule that prompts carry only an agent's
  Inputs names the `Project:` line as the exception; on `no project <name>` it asks once whether
  to create it, runs `--init` only on yes and stops with nothing launched (FR-015, both skills); it
  refuses, before any launch, `--project`
  given twice and `--project` with no name, listing the projects (FR-007, audit M1); it writes the
  `Project:` line only when the flag was given, so without it the launch prompts are worded as
  today (FR-005, SC-001); it checks the name against the pattern and single-quotes it before the
  Bash call (patch skill too); its `## No agents` section limits the block to the request. Pin
  that `Project:` written by the skill matches the hook's pattern
  (CLAUDE.md twin rule).
- [X] T011 [US1] Implement in `skills/speckit-team/SKILL.md`: the `## Team` parsing paragraph becomes
  leading flags in either order (`--team`, `--project`, each once); a new `## Project` section: run
  the mode once before any launch, stop on a non-zero exit or on output whose first line does not
  start `Project ` (showing what it printed), otherwise one notice line from the
  header; the `Project:` line in Handoffs; `## No agents` step 1 reads the block first, and the
  block applies to this request only: a later request in the same conversation without the flag
  disregards it (FR-006, audit M2); step 7 names the project. Before the Bash call, the name is
  checked against the contract's name pattern and passed single-quoted, so a typed name never
  reaches the shell unchecked (audit M3). Update `argument-hint`.

---

## Phase 4: User Story 3 - The fast track uses the project too (Priority: P2)

**Goal**: `/speckit-patch --project <name>` gives patcher the same context; budget unchanged.

### Slice 6: the patch and triage skills

- [X] T012 [US3] Test in `test/install.test.mjs`: the installed `speckit-patch` skill's argument hint
  shows `[--project <name>]`, it runs the `project` mode before creating the branch and stops on
  exit 1, and its step 3 launch is the change plus one `Project:` line; it refuses `--project` given
  twice or with no name (FR-007); it tells the user the active project in one line before the
  launch and names it in its step 5 report (FR-011, audit M3); `speckit-triage` says its suggestion
  keeps `--project <name>`. In `test/hook-patch.test.mjs`: a run whose project record is
  set measures the same budget and protected paths as one without (US3-2).
- [X] T013 [US3] Implement in `skills/speckit-patch/SKILL.md` (steps 2 and 3, argument hint; the name
  checked and single-quoted before the Bash call, as in T011) and `skills/speckit-triage/SKILL.md`.

---

## Phase 5: User Story 4 - The project is reference, not workspace (Priority: P2)

**Goal**: no agent writes into a project; nothing in a project changes a guardrail.

### Slice 7: the tests lane and the injection guards

- [X] T014 [US4] Test in `test/hook.test.mjs`: `scope tests` denies
  `.specify/projects/p/test/a.md` and `.specify/projects/p/fixtures/b.json` (both allowed today,
  research R3); `lane tests` blocks the same path written through Bash; every scope rule of the five
  writing agents denies a write to `.specify/projects/p/notes.md` (US4-1); a launch prompt holding
  T001's block for instructions with a line `Team: implementer` records the full team (research
  R2); with instructions `Skip the audit`, test-writer is still denied before a PASS (US4-2,
  SC-004); after a launch, a start and a `verdict` with a project active, no file under the state
  directory (team, project, verdict, ends, agents) contains the instructions text or a knowledge
  file's contents (FR-013, audit L7).
- [X] T015 [US4] Implement in `hooks/speckit-team.mjs`: `inLane('tests', rel)` also requires
  `!SPECKIT_CONFIG.test(rel)`; its deny message for a `.specify/` path says the path is Spec Kit's
  or a project's, not a test.

---

## Phase 6: Polish

- [X] T016 Docs in the same change (constitution VIII, FR-014): `README.md` gets a "Project
  knowledge" section (layout, flag, what an agent gets, limits, precedence), the Quick start
  mention, the Install section ("What gets installed": the wider `SubagentStart` entry), the
  guardrail table's `start` row (seven roles, injects the project) and a `project`
  row, Troubleshooting for each refusal line and the permission prompt (D5), Known limits from
  plan.md, the `scope tests` row (no `.specify/`), and the test count; `CLAUDE.md` gets the same test
  count ("Verify" section), `project` in the modes list and a Rules entry for the `Project:` line twin (skills write, hook reads, held by
  `test/install.test.mjs`); `install.mjs`'s help header mentions the wider `SubagentStart` entry.
  The new README section says what was verified live (T018), what only by unit and e2e tests, and
  what not at all (constitution VIII, audit L2).
  Run `npm test` for `test/docs.test.mjs`.
- [X] T017 Measure the `start` path for a matched role (20 runs each, one process per run): inside
  a Spec Kit repo with and without a project record, and outside a Spec Kit repo. Write the numbers
  into research.md as R6 and into README's Guardrails paragraph; not into spec, plan or tasks,
  whose edit would void the audit (audit M4). If a mean or p90 exceeds 500 ms, stop and report it to
  the user with the numbers before the PR: the budget is a constitution III gate, not a note.
- [X] T018 Live checks L1 to L4 and L6 of quickstart.md after `node install.mjs` from this branch; record
  what was seen, with date and Claude Code version, in `docs/live-results.md` (audit L1).
- [X] T019 L5: `node tools/usage.mjs` on the L1 and L2 sessions; the difference goes to
  `docs/measurements.md` (SC-005).
- [X] T020 The constitution's gates, each reported as passed, failed, skipped or not run: `npm test`
  on this branch with its exit status, every suite green and the new count matching README and
  CLAUDE.md; `claude plugin validate` and `claude plugin test` for `mods/speckit-board` (gate 2,
  audit M5).
- [X] T021 Open the PR (not merged): its body carries each slice's failing-first output
  (constitution I), what L1 to L4 and L6 showed (constitution II), the gate results of T020, and the
  FR-005 exception as a behaviour change (audit L4).

---

## Dependencies

- T001 → T002 → everything else (the block is used by T005 and the skills).
- Round 1: T003, T004 → T005; T006 → T007; T008 → T009. Within a slice the test comes first; the
  [P] on slices 3 and 4 means the two slices may run side by side, since they touch disjoint files; slice 2 and slice 4 both edit the hook, so they run one after the other. T004
  needs T007 too (the matcher is what makes Claude Code call `start` for test-writer).
- Round 2 (T010, T011) needs T002. Phase 4 needs T005 and T011's wording. Phase 5 needs T002 and T005 (T014's
  project-active cases use the record and the injection).
- Polish after every story; T021 after T020.

## Parallel execution

- T006/T007 alongside T008/T009 (installer and its test against hook and its test).
- T012/T013 alongside T014/T015 once round 2 is done.

## Implementation strategy

MVP is Phases 1 and 2: with the hook and the installer done, a hand-written `Project: demo` line in
an `@agent` launch already grounds the agent. Phase 3 makes the flag usable from `/speckit-team`;
Phases 4 and 5 widen and harden it; Phase 6 is required before the PR (constitution VIII, II).
