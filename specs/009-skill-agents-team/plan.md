# Implementation Plan: Skill-Agents Team Mode

**Branch**: `009-skill-agents-team` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-skill-agents-team/spec.md`

## Summary

`/speckit-team --team skill-agents <request>` runs the seven team roles as skills in the main
session. `install.mjs` generates one skill per role from `agents/<role>.md` (FR-013). The hook's
existing Skill gate sees each role skill call: it records the acting role, closes the previous one
(its lane check of the whole diff, and spec-auditor's or spec-gatekeeper's word read from the session
transcript) and holds test-writer and implementer to the audit gate. A `scope role` rule in the role
skills' frontmatter applies the acting role's lane to every write. No agent file changes.

## Technical Context

**Language/Version**: JavaScript, Node 18 or newer, standard library only (Constitution IV)

**Primary Dependencies**: none new; Claude Code 2.1.293 or newer (skill frontmatter `hooks:` and `user-invocable`, research R2, R3)

**Storage**: JSON state under `.git/speckit-team/` (`data-model.md`)

**Testing**: `node --test` via `npm test`: `test/install.test.mjs`, `test/hook.test.mjs`, `test/e2e.test.mjs` (real Claude Code, fake API), `test/full-run.test.mjs`, `test/usage.test.mjs`

**Target Platform**: Windows (Git Bash, PowerShell hook shells), macOS, Linux

**Project Type**: CLI tooling: installer, hook script, prompt files

**Performance Goals**: no new `settings.json` entry. In a session that ran a role skill, one hook process per write (68 ms in a Spec Kit repo, README "Guardrails") and one `git diff` plus a read of the transcript's tail per role change

**Constraints**: every role on the session's model and with the session's `CLAUDE.md` (inline, FR-012); seven skill descriptions in every session's skill list, about 700 characters (D5)

**Scale/Scope**: 4 source files, 5 test files, 5 doc files; `agents/*.md` unchanged (US2-3)

## Constitution Check

| Rule | Tasks | How |
|---|---|---|
| I. Every behaviour change has a test under `npm test` | T001, T003, T005, T007, T010, T013, T016, T019, T020, T022 | each slice's tests come first |
| I. Test seen failing first | the red step of every round | the stub step only for T021's `skills` |
| I. Tests assert what a caller observes | T001, T003, T007, T010, T013, T016 | installed files, decision JSON, state files |
| I. No test passes on code that never ran | T008, T011, T014, T017 | e2e cases fail with `SPECKIT_E2E_NO_HOOK=1` |
| II. Hook handles all input without throwing; throw paths tested | T007, T010, T013, T016 | malformed fields, unreadable records and transcript |
| II. Wiring change verified live, PR says what was seen | T008, T011, T014, T017, T024 | e2e on real Claude Code in CI's three OSes; the full runs |
| II. Quoted, absolute, forward-slash hook path | T001, T002 | the role skills get `{{HOOK}}` replaced as the agents do |
| IV. Standard library only | T002, T004, T009, T012, T015, T018, T021 | |
| V. Public contracts additive and listed in README | T002, T018, T023 | `contracts/skill-agents.md`; `role` field added to two records |
| VI. Metadata only | T009, T018 | the role record holds paths, a sha and an offset; only the verdict word is kept from the transcript |
| VII. Every platform, forward slashes | T008, T011, T014, T017, T009 | e2e runs in CI on all three; paths through `repoRel` |
| VIII. README, CLAUDE.md, installer help; verified live vs by test; prose | T002, T023, T024 | |
| Install: idempotent, marker, no overwrite without `--force` | T001, T002 | |
| Install: validate before writing | T001, T002 | every role skill rendered before the first write; a bad agent file writes nothing |
| Install: nothing in repos without `.specify/` | T010 | no settings entry added; `scope role` exits there (`notSpecKit`) |
| Install: `--uninstall` removes what it added | T001 | |
| Gate: live check for hook wiring | T024, T023 | T024 runs it and records it in `docs/live-results.md`; T023, a round later, writes the steps and what was seen into README |

Not applicable: III (no observer changes; the board reads the same records), IV plugin rules (no
plugin code changes), the amendment rules (no new dependency), V event schema version (no event
emitted), VI opt-in fields (nothing beyond metadata is kept), `claude plugin validate` (no plugin
changes), Workflow branch, PR and piping rules (the main session's, not a task's).

## Project Structure

### Documentation (this feature)

```text
specs/009-skill-agents-team/
├── plan.md, research.md, data-model.md, tasks.md
└── contracts/skill-agents.md
```

### Source Code (repository root)

```text
install.mjs                    # role skills generated from agents/<role>.md, help text
hooks/speckit-team.mjs         # typed skill-agents, role skill calls, scope role, lane role
skills/speckit-team/SKILL.md   # ## Team paragraph, ## Skill agents section
tools/usage.mjs, tools/full-run.mjs   # --skill-agents run and its checks
test/install.test.mjs, test/hook.test.mjs, test/e2e.test.mjs, test/full-run.test.mjs, test/usage.test.mjs
README.md, CLAUDE.md, docs/architecture.md, docs/measurements.md, docs/live-results.md
```

**Structure Decision**: no new source file. The hook keeps one script (CLAUDE.md, Layout); the role
skills are build output of the installer, not sources, so FR-013 holds by construction.

## Design notes

- P1. Role lifecycle: a role starts at its Skill call and ends at the next role's Skill call or at the
  main session's Stop. While the orchestrating skill waits at a stop inside a turn (AskUserQuestion),
  the role stays; the writes the skill makes there (answers into `plan.md` and `spec.md`, ticks) are in
  the acting role's lane, and commits change no file.
- P2. The role skills are denied outside a typed skill-agents request (contract section 4), so a model
  that picks one up in an ordinary session never brings a lane into it (FR-005, FR-006).
- P3. Side by side is never offered in this mode: there are no worktree agents (FR-012).
- P4. Lane rules are a twin: `ROLE_LANES` in the hook and the `scope` line in each agent's frontmatter,
  held by T010's test, listed in CLAUDE.md "Rules" by T023.
- P5. One role at a time: a role's lane runs from its Skill call to the next (P1), so two role Skill
  calls in one response would leave the second role's lane on the first role's work. Every launch the
  skill sends side by side in one message (`skills/speckit-team/SKILL.md`, `## Handoffs`, and the
  answers paragraph's architect revision with product-owner's `Spec:` lines) becomes one role call
  after the other, in the order the step names them (T005, T006).
- P6. No hook text in this mode sends the main session to an agent: the gate's reason and closing's
  verdict messages name the Skill `speckit-role-spec-auditor` (contract sections 4 and 6, T007 to T009,
  T016, T018), since an agent launch breaks FR-001 and ends the mode (D3).

## Complexity Tracking

None.

## Decisions

### D1. What are the role skills called?

Answer (2026-10-25): A, as recommended

- **A (recommended): `speckit-role-<role>`.** No clash with the eight agent names in the `@` list or
  with Spec Kit's `speckit-<command>` skills (`speckit-implement` against an `implementer` skill would
  differ by two letters). Contract sections 2 and 4, T001, T002, T009 as written.
- B: `<role>` bare. `/architect` and `@architect` name different things; a user's own skill named
  `architect` collides, and install then refuses without `--force`. Same tasks, other names.
- C: `speckit-<role>`. `speckit-implementer` beside Spec Kit's `speckit-implement`; the gate's anchored
  match keeps them apart, a model reading the skill list may not. Same tasks, other names.

### D2. Does the hook enforce the retry limit in this mode?

Answer (2026-10-25): A, as recommended

- **A (recommended): no; the skill counts.** After 3 `RESULT: RED` in a row it relaunches none and
  hands the output to the user, as `## 4-5` already does without an active feature. The start message
  names the limit as not enforced (contract section 7, FR-008). Delivered by T004 (the message) and T006 (the count).
- B: yes. Closing an implementer role reads its `RESULT:` line from the transcript (GREEN clears, STUB
  leaves, RED or none adds one, as the `result` mode does) and section 4 denies `speckit-role-implementer`
  at `MAX_RED`. One more slice in round 3 (a unit test, an e2e test, the change to T018's close), a
  README "retry limit" row, and the start message drops the limit. In one session the role's text can
  include the orchestrator's own lines, so a stray `RESULT:` line could miscount.

### D3. Does the hook refuse an Agent launch in a skill-agents request?

Answer (2026-10-25): A, as recommended

- **A (recommended): no.** The skill launches none (FR-001), and the full run fails on any launch
  (T019, SC-001). A team-role launch overwrites the team record as today, which ends the mode: later
  role skill calls are denied.
- B: yes. The gate's Agent branch denies a team-role launch while the record has `skillAgents`. That
  makes the branch decide for the first time, against feature 006's `contracts/team-choice.md` section
  7 ("never a decision"); one more unit and e2e test in round 2. A user switching mode mid-request
  retypes `/speckit-team` (as now).

### D4. How are the two runs for FR-014 measured?

Answer (2026-10-25): A, as recommended

- **A (recommended): one run each, `node tools/full-run.mjs --login` and `--login --skill-agents`,
  same day, default `--model sonnet`.** The default run's agents use their `model:` lines (architect and
  spec-auditor on opus); in skill-agents every role runs on sonnet. `docs/measurements.md` states that
  mix beside the numbers and gives cost as well as input tokens. About $4 to $8 of the user's usage and
  up to 80 minutes. T024 as written.
- B: three runs each. Spread instead of one sample; three times the cost and time. T024 runs six.
- C: the skill-agents run with `--model opus`. Matches the heaviest roles, overpays the rest; the mix
  is then unequal the other way.

### D5. Are the role skills installed for everyone?

Answer (2026-10-25): A, as recommended

- **A (recommended): yes, by every install.** Their seven descriptions sit in every session's skill
  list, about 700 characters in every repo. FR-009 as written.
- B: only with a new installer flag `--skill-agents`, kept on reruns as `--board` is. Nothing in other
  users' sessions; one more flag (a public contract), and the typed mode then blocks with "run
  `node install.mjs --skill-agents`". Adds a test and the flag to T001, T002, the hook's block text in
  T003 and T004, and README.
  Spec: FR-009: Installing with `--skill-agents` MUST add the role skills, a later install keeps them
  until `--no-skill-agents`, and uninstalling MUST remove them; files the user wrote MUST be left alone.

### D6. How is a spec edit made inside test-writer or implementer caught?

Answer (2026-10-25): A, as recommended

In a default run, `agents/test-writer.md` and `agents/implementer.md` run `gate` on every tool call
(matcher `.*`), so after an edit to the spec, plan, tasks or constitution the agent's next call is
denied. In this mode the gate runs at a role skill call only, and implementer's `no-tests` lane allows
`specs/` (audit finding H3, FR-008).

- **A (recommended): gate spec-gatekeeper's start too, and name the per-call difference.** Contract
  section 4 step 4 adds `spec-gatekeeper`; the start message (section 7) names that the gate is not
  checked on each tool call inside test-writer and implementer. Outcome: work after such an edit can
  go on until the role ends, but neither the next build role nor verification starts until
  spec-auditor passes again. One word in the hook's role list and one clause of message; T007 gets the
  spec-gatekeeper cases, T009 and T004 carry it. Stricter than a default run, where nothing gates
  spec-gatekeeper's launch; in this mode the team is always all seven, so an audit always exists.
- B: the same per-call gate as the agents. Every role skill's frontmatter (contract section 2) gains a
  PreToolUse `.*` entry `gate role`; gate mode, from the main session with a role record of test-writer
  or implementer, denies any tool call but a role Skill call while `auditProblem()` is set. Same outcome
  as a default run; a hook process on every main-session tool call for the rest of the session after
  the first role skill (research R2: frontmatter hooks stay), a new hook entry with its own
  `test/e2e.test.mjs` case (one more e2e session, in T008's slice), a README guardrail-table row, and
  T001's frontmatter assertion changes. The start message keeps its current enforced list.
- C: name it only. The start message says the gate is not checked inside test-writer and implementer
  and is not checked before spec-gatekeeper; no hook change. A spec edit during implementer reaches
  verification unaudited unless the skill re-runs spec-auditor.
  Spec: FR-008, first sentence: In this mode the audit gate MUST stop test-writer and implementer from
  starting until the audit passes, and the verification outcome MUST be enforced as in a default run;
  an edit to the spec, plan or tasks made while either acts is not re-checked, and this MUST be named
  to the user at the start of the run as not enforced.

### D7. Does closing a read-only role check its Bash writes?

Answer (2026-10-25): A, as recommended

In a default run spec-auditor, spec-gatekeeper and security-reviewer have `disallowedTools: Write, Edit,
MultiEdit, NotebookEdit` and no `lane` hook (`agents/spec-gatekeeper.md`), so a file a Bash command
leaves behind (a test run's coverage or cache output) blocks nothing. SC-006 asks for "the same cases a
default run blocks" (audit finding M2).

- **A (recommended): no; `scope role` only.** Contract section 5 denies the role's Write and Edit calls,
  as `disallowedTools` does; section 6 step 1 skips the lane check for a `none` role. Same outcome as a
  default run; spec-gatekeeper's `npm test` never blocks its own close. T013 asserts it, T015 skips it.
  SC-006 and FR-008 as written.
- B: yes; every file a read-only role changes counts, Bash included. Stricter than a default run: a
  spec-gatekeeper test run that leaves an untracked file blocks the next role or the Stop, and the skill
  must restore it before going on. T013 asserts any change counts, T015's `laneOutside` puts every file
  outside for `none`, and README names the difference.
  Spec: SC-006: In a skill-agents run, 100% of attempted writes outside a role's lane are blocked, and
  every file a read-only role changes, through any tool, blocks its close; 0 guardrails are dropped
  without being named at run start.
