# Implementation Plan: Choose the team size per request

**Branch**: `006-choose-team-size` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-choose-team-size/spec.md`

## Summary

`/speckit-team` takes an optional `--team <roles>` list, or asks once when it has none, and runs only
the chosen roles. The rules (syntax, refusals, what each role works from, what each absence skips)
are in [contracts/team-choice.md](contracts/team-choice.md). Three parts change:

1. The skill (`skills/speckit-team/SKILL.md`) checks the choice, tells the user what is skipped,
   guards every step by its role, runs a one-round build from a brief when there is no `tasks.md`,
   and puts a `Team:` line in every launch prompt of a subset run.
2. The hook (`hooks/speckit-team.mjs`, mode `gate`) records that line per session when the main
   session launches an agent, and the audit gate on test-writer and implementer skips its check
   when the recorded team has no spec-auditor (FR-007). The installer widens one `settings.json`
   matcher so Claude Code calls the hook on `Agent` launches (D1).
3. test-writer, implementer and spec-gatekeeper accept a brief in place of task IDs, and
   spec-gatekeeper reports a check whose role is absent as skipped.

A full-team run carries no `Team:` line, so its prompts, launches, stops and gate decisions are
today's (FR-002).

## Technical Context

**Language/Version**: Node 18+ ES modules (hook, installer, tests); Markdown prompts (skill, agents)

**Primary Dependencies**: none (constitution IV)

**Storage**: one JSON file per session under `.git/speckit-team/team/` ([data-model.md](data-model.md))

**Testing**: `node:test`: `test/hook.test.mjs` (hook JSON on stdin), `test/install.test.mjs`
(installed files), `test/e2e.test.mjs` (real `claude -p` against the fake API)

**Target Platform**: Claude Code 2.1.293 (CI) on Windows, macOS, Linux

**Project Type**: Claude Code agent team (prompts plus one hook script and an installer)

**Performance Goals**: one hook process per main-session `Agent` launch: 172 ms mean inside a Spec
Kit repo and 148 ms outside one (10 runs each of today's `gate` path, Windows, 2026-10-11); budget
500 ms (constitution III). The 148 ms outside a Spec Kit repo is allowed by constitution 1.1.0,
Installation Constraints

**Constraints**: the audit gate fails closed: a missing, unreadable or other-session team record
means the full team's gates

**Scale/Scope**: 6 roles; 24 valid teams of 63 non-empty choices under D3-A

**Assumption pinned by a test**: a subagent's hook input carries the main session's `session_id`.
The hook keys the record by it; T006 runs it under `claude -p` and fails if it does not hold.

## Constitution Check

| Rule | Tasks | How |
|---|---|---|
| I. Test in `test/` under `npm test` | T001, T003, T005, T006, T008, T010, T012, T014, T016 | every slice starts with its test task |
| I. Failing first, evidence in the PR body | the same, each before its implementation task | test-writer's RED reports, carried into the PR body at hand-over (skill step 7) |
| I. Assert what a caller observes | T001, T003, T005, T006, T008, T010, T012, T014, T016 | decision JSON, messages and the record file; installed settings and files; what the subagent sees |
| I. No test that passes because the code never ran | T006 | fails with `SPECKIT_E2E_NO_HOOK=1` (CLAUDE.md, Verify) |
| II. No throw on any input; a test per throwing path | T001, T003 (tests), T002, T004 | non-string prompt, bad `session_id`, unreadable record, no active feature |
| II. Wiring change verified live, PR says what was seen | T018 | quickstart L1 to L4, recorded in README "Live results" |
| II. Quoted absolute forward-slash command | T005, T007 | only the matcher changes; T005 checks the command |
| III. Observers never block; failures visible; budget | T001, T002 | the launch recorder never decides (T001); a bad `Team:` line says so; budget in Technical Context |
| IV. Node standard library only | T002, T004, T007 | `fs`, `path` only |
| V. Public contracts additive and documented | T007, T009, T017 | an optional argument and a matcher that matches one more tool; README lists both |
| VI. Metadata only | T002 | the record holds role names, session id, time |
| VII. Every platform | T006 | e2e runs in CI on all three; record path from `path.join` |
| VIII. Docs in the same change, counts match, verified vs not | T004, T013, T017, T018 | hook header, agent body lengths, README, CLAUDE.md, installer help, Live results |
| Install: idempotent, uninstall removes all | T005 | an old `Skill` entry is rewritten, a rerun changes nothing, uninstall removes it |
| Install: nothing outside `.specify/` | T001 | passes under constitution 1.1.0: no blocking, output or record outside a Spec Kit repo; the `Skill\|Agent` gate starts one hook process per Agent call (148 ms outside a Spec Kit repo) that exits with no output, as the amended bullet allows |
| Workflow: feature branch | T011 | without product-owner the main session creates `team/<request>` |

Not applicable: IV's plugin rule and new-dependency amendment (no plugin code, no dependency); V's
event schema version and unknown fields (no event emitted); VI's destination and opt-in fields (no
event data); install's overwrite and validate-first rules (no new file and no new input; the entry
stays owned by `isGate` in `install.mjs`); Workflow's PR, gates 1 and 2 and pipe rules
(spec-gatekeeper and hand-over, not tasks); Governance (no amendment).

## Project Structure

### Documentation (this feature)

```text
specs/006-choose-team-size/
├── plan.md
├── data-model.md          # the team record
├── quickstart.md          # live checks L1 to L4
├── contracts/team-choice.md
└── tasks.md
```

No `research.md`: the one unknown (`session_id` in a subagent's hook input) is pinned by T006, and
every choice is a decision below.

### Source Code (repository root)

```text
hooks/speckit-team.mjs          # TEAM_ROLES, team record at Agent launch, audit skip (T002, T004)
install.mjs                     # SETTINGS_GATES matcher; help text (T007, T017)
skills/speckit-team/SKILL.md    # team choice, step guards, brief run, report (T009, T011, T015)
agents/test-writer.md           # brief in place of task IDs (T013)
agents/implementer.md           # brief in place of task IDs (T013)
agents/spec-gatekeeper.md       # Team line, brief, skipped checks (T013)
README.md, CLAUDE.md            # T013 (body lengths), T017, T018
test/hook.test.mjs, test/install.test.mjs, test/e2e.test.mjs
```

Unchanged: product-owner, architect, spec-auditor and patcher agents; the fast track; the board mod
(it keeps drawing the active feature's files); `docs/media/` (a full-team run shows nothing new).

## Known limits

- In a run without product-owner and architect, the implementer's retry count and spec-gatekeeper's
  word go to the feature `.specify/feature.json` names, if any (D6).
- The architect writes test and implementation tasks whatever the team; the skill skips those of an
  absent role and lists them (contract section 5).

## Complexity Tracking

None.

## Decisions

### D1. How do the hooks learn the team?

- **A, chosen by the user 2026-10-11: widen the installer's PreToolUse gate matcher from `Skill` to
  `Skill|Agent`; `gate` records the launch prompt's `Team:` line per session (contract section 7).**
  - `install.mjs`: one string in `SETTINGS_GATES`; `withGates` rewrites an installed `Skill` entry
    on reinstall (T005, T007).
  - Every `Agent` launch in every repo starts one node process: 148 ms outside a Spec Kit repo,
    exiting with no output, the cost the `Skill` gate has on every Skill call today. Allowed by
    constitution 1.1.0, Installation Constraints.
  - Needs the main session's `session_id` in the subagent's hook input; T006 fails if it is not.
  - A hand-typed `@agent-implementer` after a subset run in the same session is a launch without a
    `Team:` line, so it removes the record and meets the full gate (FR-009).

### D2. How does a request name its roles?

- **A, chosen by the user 2026-10-11: a leading `--team <role>,<role>` (contract section 1).**
  - Unambiguous: a request that mentions "implementer" in prose (common in this repo) is not read as
    a team. An empty list is expressible and refused (FR-006). T008 tests it.

### D3. A planning role whose input no chosen role writes

- **A, chosen by the user 2026-10-11: refuse `architect` without `product-owner` and `spec-auditor`
  without `architect`, before any launch (contract section 3).**
  - 24 of the 63 non-empty choices are valid; the user gets the reason and resends.

### D4. FR-002 says "same stops", FR-010 adds the team question

- **A, chosen by the user 2026-10-11: the full team is today's run after the question.**
  - Every full-team run gains one AskUserQuestion before product-owner launches; naming all six
    with `--team` skips it.

### D5. The team question's options (FR-010, US4)

- **A, chosen by the user 2026-10-11: one single-select question with four presets and free text
  (contract section 8).**
  - Full team, or the two commonest subsets, in one click; any other team typed as a role list and
    checked like `--team`.

### D6. Where a run without a spec keeps its counts

- **A, chosen by the user 2026-10-11: the active feature, as today; documented in README "Known
  limits" (T017).**
  - The implementer's REDs in such a run count against the feature `.specify/feature.json` names; a
    GREEN resets that count; 3 REDs in a row block implementer on it until a GREEN, a new audit or
    the user deletes the record. spec-gatekeeper's word replaces that feature's. With no active
    feature nothing is counted (T003, T004).
