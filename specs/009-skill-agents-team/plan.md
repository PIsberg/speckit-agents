# Implementation Plan: Skill-Agents Team Mode

**Branch**: `009-skill-agents-team` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-skill-agents-team/spec.md`

## Summary

`/speckit-team --team skill-agents <request>` runs the seven team roles as skills in the main
session. `install.mjs` generates one skill per role from `agents/<role>.md` (FR-013). The hook's
existing Skill gate sees each role skill call: it records the acting role, closes the previous one
(its lane check of the whole diff, and spec-auditor's or spec-gatekeeper's word read from the session
transcript and, for its last message, from the hook input: D10) and holds test-writer and implementer to the audit gate. A `scope role` rule in the role
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
| I. Every behaviour change has a test under `npm test` | T001, T003, T005, T007, T010, T013, T016, T019, T020, T022, T025, T026, T028, T030, T031 | each slice's tests come first |
| I. Test seen failing first | the red step of every round | the stub step only for T021's `skills`; T026 fails against T018's transcript-only close by carrying the verdict in `args` alone; T030 and T031 fail against T012's transcript rule, their records naming no transcript |
| I. Tests assert what a caller observes | T001, T003, T007, T010, T013, T016, T025 | installed files, decision JSON, state files |
| I. No test passes on code that never ran | T008, T011, T014, T017, T026, T031 | e2e cases fail with `SPECKIT_E2E_NO_HOOK=1` |
| II. Hook handles all input without throwing; throw paths tested | T007, T010, T013, T016, T025, T030 | malformed fields, unreadable records and transcript, non-string `args`, `last_assistant_message` and `prompt_id` |
| II. Wiring change verified live, PR says what was seen | T008, T011, T014, T017, T024 | e2e on real Claude Code in CI's three OSes; the full runs |
| II. Quoted, absolute, forward-slash hook path | T001, T002 | the role skills get `{{HOOK}}` replaced as the agents do |
| IV. Standard library only | T002, T004, T009, T012, T015, T018, T021 | |
| V. Public contracts additive and listed in README | T002, T018, T023, T029 | `contracts/skill-agents.md`; `role` field added to two records; the `args` report line (D10) |
| VI. Metadata only | T009, T018, T032 | the role record holds paths, a sha, an offset and a prompt id; only the verdict word is kept from the transcript |
| VII. Every platform, forward slashes | T008, T011, T014, T017, T009 | e2e runs in CI on all three; paths through `repoRel` |
| VIII. README, CLAUDE.md, installer help; verified live vs by test; prose | T002, T023, T024, T029, T032 | T029: the D10 path as verified by test only, and the test counts; T032: the role's end read from `prompt_id`, end to end |
| Install: idempotent, marker, no overwrite without `--force` | T001, T002 | |
| Install: validate before writing | T001, T002 | every role skill rendered before the first write; a bad agent file writes nothing |
| Install: nothing in repos without `.specify/` | T010 | no settings entry added; `scope role` exits there (`notSpecKit`) |
| Install: `--uninstall` removes what it added | T001 | |
| Gate: live check for hook wiring | T024, T023 | T024 runs it and records it in `docs/live-results.md`; T023, a round later, writes the steps and what was seen into README; D10 and D11 change no command, event, matcher or frontmatter, so no new live check |

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

- P1. Role lifecycle: a role starts at its Skill call and ends at the next role's Skill call, at the
  main session's Stop, or at the next prompt (a hook input with another `prompt_id`), which covers a
  turn that ends with no Stop (D8, D11, contract section 8). A role that goes on in a later turn is called again. While the orchestrating skill waits at a stop inside a turn (AskUserQuestion),
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
- P7. A closing role's last message never comes from the transcript alone: the response holding the
  next tool call can reach it after that call's PreToolUse (research R1, CI run 40223102740). The
  next role's Skill call carries it in its `args`, and Stop in `last_assistant_message` (D10,
  contract section 6 step 2; T025 to T029).

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

### D8. When does a role's lane end if its turn ends with no Stop?

Answer (2026-10-25): A, as recommended. How the end is read: D11 (open), which keeps A's behaviour.

Claude Code runs no Stop when the user interrupts a turn, and an API error ends a turn with StopFailure
(third audit, H1). A record that lives until the next Stop or typed `/speckit-team` then holds later,
unrelated work to the last role's lane (every Write denied under a read-only role), and the next Stop
asks the model to `git checkout` the user's own files. Removing the record at Stop also drops the lane
of a role that goes on in the next turn (M3). Seen in this machine's transcripts (read, 2026-10-25):
typed prompts are `user` rows with string content (`origin.kind: 'human'` where the version writes it),
interrupts are `user` rows with a text block, a Skill's body is `isMeta`, a background task's notice has
`origin.kind: 'task-notification'`, tool results hold only `tool_result` blocks.

- **A (recommended): a role ends with its turn, read from the transcript.** Contract section 8: the
  first user prompt row after the record's `offset` ends it; an ended record is removed where it is
  next read, never closed, with a message that says its lane check and report did not run; a role that
  goes on in a later turn is called again, and its lane runs from that call. No new hook entry: the
  record already names the transcript (data-model). Follows: an interrupted role's Bash writes outside
  its lane and its report go unchecked, and the start message names it (contract section 7, FR-008);
  a `VERDICT: PASS` from an interrupted spec-auditor is not recorded, so the gate stays shut until the
  role runs again; AskUserQuestion stops keep the role (their answers are tool results), as plan P1
  needs. The row rule depends on Claude Code's transcript format, so T011 pins both halves on the
  Claude Code under test (CI's oldest supported). Changes T005, T006, T010, T011, T012, T013, T015,
  T018, contract sections 4, 5, 6, 7 and 8, data-model's lifecycle, plan P1.
  Spec: Edge Cases: The user interrupts a skill-agents run partway, or an API error ends its turn: the files written so far remain, the acting role's lane ends with that turn (its lane check and report do not run, and the user is told so), and the user can restart with the same command.
- B: the same rule, but an ended record is still closed (lane check and report) where it is next read.
  The lane check then counts every file changed since the role's start, the user's own later work
  included, so the H1 revert prompt comes back for any file outside the lane the user touched; a
  verdict written before an interrupt is recorded. T010, T013 and T015 assert closing in place of
  dropping; same Spec line without "its lane check and report do not run".
- C: a new `UserPromptSubmit` entry in `SETTINGS_GATES` removes the record at every typed prompt; no
  transcript reading. A new hook entry: a README guardrail table row, a `test/e2e.test.mjs` case that
  fails with `SPECKIT_E2E_NO_HOOK=1` (the harness has no second prompt in a session today, so `session`
  gains `--resume`), the README live check, and a Node start on every prompt of every session where the
  team is installed (it exits at once without `.specify/`). Adds a task pair to Round 2 (4 slices).
  Same Spec line as A.

### D9. Are the agents' tool lists enforced for a role run as a skill?

Answer (2026-10-25): A, as recommended

`agents/*.md` give each agent a `tools:` list (Bash, Read, Edit, Write and similar; no WebFetch,
WebSearch, Agent or MCP tools). A role run as a skill has every tool of the main session, and `scope
role`'s matcher (`Write|Edit|MultiEdit|NotebookEdit`) does not see an MCP tool that writes (third audit,
M2).

- **A (recommended): name it in the start message.** Contract section 7 lists it among what is not
  enforced, as FR-008 asks of any guardrail the mode cannot keep. No code beyond T004's message; T003
  holds the text through section 7. A role's write into the repository through an MCP tool is still
  caught by its lane check at close for every role but the read-only ones (D7).
- B: close it: `scope role`'s frontmatter matcher becomes every tool, and a role is denied any tool
  outside its agent's `tools:` list plus the ones the orchestrating skill needs while a role acts
  (Skill, AskUserQuestion, TodoWrite). A new twin (`ROLE_TOOLS` and each agent's `tools:` line) and its
  test, a frontmatter matcher change (the live check of Constitution II), a hook start on every tool
  call during a run, a tool list to keep in step with Claude Code's tool names, and a `--project` whose
  instructions name an MCP tool stops working in this mode. Changes T010, T011, T012, contract
  sections 5 and 7, and drops the item from section 7.

### D10. How does a closing role's last message reach the hook, now that research R1 failed?

Answer (2026-10-25): A, as recommended

CI run 40223102740 (PR #183, Claude Code 2.1.293): the response holding spec-auditor's `VERDICT: PASS`
and the `speckit-role-test-writer` Skill call was not in the transcript at that call's PreToolUse on
ubuntu and macOS, so nothing was recorded and test-writer was denied; the turn's Stop found it. The
same race reaches spec-gatekeeper's word, and a Stop right after the role's last message. The lane
check (git) does not read that response; `roleEnded` does race, on the prompt row (R5, D11).

- **A (recommended): from the hook input.** Closing reads the transcript after `offset` as now, then
  one last text: at a Skill call the first line of `tool_input.args`, at Stop `last_assistant_message`
  (contract section 6 step 2). The skill's `## Skill agents` gains one sentence: the Skill call after
  spec-auditor's or spec-gatekeeper's report starts its `args` with that report's last line. No wait,
  no new hook entry, no timing assumption at a Skill call. Follows: a forgotten line while the race
  hits records nothing and denies test-writer (fails closed); the denial leaves the auditor role live,
  so the call made again with the line records it; a `VERDICT: FAIL` in `args` after a PASS in the
  transcript records FAIL (the last line wins); only the first `args` line counts, so findings quoted
  further down never do; the next role gets one more input line. Trust is unchanged: the role and the
  orchestrator are one model, so the transcript's line and the `args` line have one author, and the
  fingerprint check stands. Tasks T025 to T029 (Round 6); T017's session 1 is rewritten by T026. No
  spec line changes.
- B: the hook waits for the call's own row. At a Skill call that closes spec-auditor or
  spec-gatekeeper, poll the transcript (every 50 ms, up to 2 s) for the row holding this call's
  `tool_use_id`, then read as now. No skill change. Unknown first: whether 2.1.293 gives PreToolUse a
  `tool_use_id`, and whether Claude Code writes the row while its hooks run; if it writes after them,
  every such close waits 2 s and still finds nothing. Adds a research spike on CI's three OSes (a
  round before the slice), up to 2 s per audit close, and recovery machinery that narrows a timing
  window without closing it; T016 gains a timeout case, T017 is unchanged, the skill is unchanged.
- C: deny and ask for the call again. At a Skill call whose closing spec-auditor role yields no
  VERDICT, deny with "call this Skill again" and keep the role live; the retry is a new response, by
  which the earlier one is usually written. No skill change; one model response more each time the race
  hits (every audit in CI on ubuntu and macOS); still timing dependent, and without B's `tool_use_id`
  "not written yet" and "no VERDICT" look the same, so a report that lacks its VERDICT is asked for
  again until the model calls spec-auditor. T016 and T017 assert the second call goes through.

### D11. How does the hook tell that a role's turn has ended, now that the transcript lags (research R5)?

Answer (2026-10-25): A, as recommended

CI job 121272983651 (PR #183, macOS, Claude Code 2.1.293): T017's session 2 recorded no verdict at
Stop. `last_assistant_message` was not the cause (2.1.293 sends it, R5): the transcript did not exist
yet at the auditor's Skill call, so the record took `offset` 0, and at Stop D8's rule found the typed
prompt's row after it, ended the role and recorded nothing. Reproduced on Linux in 1 of 22 runs. D10's
report path needs no change.

- **A (recommended): Claude Code's `prompt_id`.** The role record keeps its Skill call's `prompt_id`;
  a hook input with another one ends the role (contract section 8, data-model). No transcript read for
  it, no new hook entry, no timing assumption; `promptRow` goes, and `scope role` no longer reads the
  transcript on every write. Follows: the outcomes of D8 A for a typed prompt, an interrupt, an API
  error, an AskUserQuestion answer and a Skill's body (R5; the last three read in the bundle, not
  seen); a record or an input without a string `prompt_id` (a record written before this change, a
  Claude Code that drops the field) stays live until the next role or Stop, as an unreadable
  transcript does now; a message typed while a turn runs, if Claude Code gives it a new id (not known,
  R5), ends the role mid-turn with section 8's message, so its lane check and report do not run. The
  report still reads the transcript after `offset` and then the hook-input text (D10), whose last
  line wins. Tests that change: `test/hook.test.mjs`, T007's record case, T010's "which rows end a
  role" and "an ended record of each lane kind", T013's "an ended record is removed" and "(M3)";
  `test/e2e.test.mjs`, T011's second half (a `--resume` session in place of the hook run over the
  real transcript). Unchanged and now deterministic: T008, T011's first half, T014, T017. Tasks T030
  to T032 (Round 7). No spec line changes.
- B: keep the transcript rule and slow the fake API: `test/e2e.test.mjs: session` waits 250 ms before
  each reply, past the 100 ms write interval. No hook change; every model request of the 51 e2e tests
  250 ms slower; the hook still rests on Claude Code's write interval, an internal no doc states, so a
  real response within 100 ms of its prompt, or a later Claude Code that writes less often, ends a role
  at its own start: its lane lapses at its first write with section 8's message, and a PASS is
  dropped. T030 to T032 become one task pair in `test/e2e.test.mjs`.
- C: a new `UserPromptSubmit` entry in `SETTINGS_GATES` removes the role record at every prompt (D8's
  option C). No transcript read; a Node start on every prompt of every session where the team is
  installed (it exits at once without `.specify/`), a README guardrail table row, README's live check
  and an e2e case that fails with `SPECKIT_E2E_NO_HOOK=1` (Constitution II, a new hook entry). Same
  outcomes as A. T030 and T032 change to the new entry; T031 as in A.
