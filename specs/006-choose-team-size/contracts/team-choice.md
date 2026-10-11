# Contract: choosing the team for one `/speckit-team` request

Public surface (constitution V): the slash command's arguments (sections 1 to 3), the
`settings.json` entry (section 7). Sections 4 to 6 are the rules the skill, the agents and the hook
share; `test/install.test.mjs` and `test/hook.test.mjs` hold them together.

## 1. Request syntax (D2)

```text
/speckit-team [--team <role>[,<role>...]] <request>
```

- `--team` counts only as the first word of the arguments.
- The role list is the words after it up to and including the first word that does not end in a
  comma: `--team test-writer, implementer add a flag` and `--team test-writer,implementer add a flag`
  both name two roles; the request is `add a flag`.
- Names are case-insensitive, a name given twice counts once, and order does not matter.
- No `--team`: no roles are named, and the skill asks once (FR-010, section 8).
- All six roles named is the full team: the run is the one without `--team` and the question.

## 2. Role names

`product-owner`, `architect`, `spec-auditor`, `test-writer`, `implementer`, `spec-gatekeeper`, in
pipeline order. `patcher` is not one (spec, Key Entities). The list equals `agents/*.md` without
`patcher`, the skill's list and `TEAM_ROLES` in `hooks/speckit-team.mjs`.

## 3. Refusals (FR-006, D3)

Checked before anything is launched. Each refusal is one message that says why and lists the six
valid names.

| Choice | Why given |
|---|---|
| a name not in section 2 (also `--team` followed straight by the request: its first word is the unknown name) | that name is not a team role |
| neither `test-writer` nor `implementer` | one of them is required |
| `architect` without `product-owner` | architect plans from product-owner's spec |
| `spec-auditor` without `architect` | spec-auditor audits architect's plan and tasks |

## 4. What the build roles work from (FR-012)

| Team has | Brief | Rounds |
|---|---|---|
| `product-owner` and `architect` | `spec.md`, `plan.md`, `tasks.md`, as today | one per `tasks.md` phase, as today |
| `product-owner`, no `architect` | the approved `spec.md` | one |
| neither | the request text | one |

In a one-round run there is no `tasks.md`: test-writer and implementer get the brief in their prompt
in place of task IDs and tick nothing, implementer gets `last round`, and a stub pass runs only when
test-writer reports a missing production symbol. Without product-owner nothing creates a feature
branch, so the main session does it before the first launch when the tree is on `main` or `master`:
`git switch -c team/<the request in kebab case, at most 40 characters>`.

## 5. What an absent role skips (FR-004, FR-005, FR-008, FR-011)

| Absent role | Steps skipped | Guardrails skipped |
|---|---|---|
| product-owner | the spec, its questions, the spec review stop | none |
| architect | plan and tasks, the plan stop and its open decisions, rounds by phase (one round instead) | none; at the retry limit the user decides, there is no architect to rethink |
| spec-auditor | the audit and its FAIL routing | the audit gate on test-writer and implementer (`gate`) |
| test-writer | the red step; the test tasks of `tasks.md` stay unticked and are listed | spec-gatekeeper's test trace (Process 1) |
| implementer | the stub and green steps; the implementation tasks stay unticked and are listed | spec-gatekeeper's passing tests: the red tests are the run's result |
| spec-gatekeeper | verification and REJECTED routing | the recorded last word (`ends --record`) |

Every run keeps: hand-over (PR and CI, spec Assumptions), every chosen agent's `scope`, `lane`,
`ends` and `result` hooks, the retry limit while implementer is chosen, tests before implementation
when both test-writer and implementer are chosen, and the `/speckit-implement` gate.

The one-line notice at the start (FR-005) and the final report (FR-008) name the rows of the absent
roles, the report also the unticked tasks.

## 6. The `Team:` line

In a run whose team is not the full team, every launch prompt carries one line

```text
Team: test-writer, implementer
```

with the chosen roles in section 2's order, lower case, separated by a comma and a space. A full-team
run carries no such line, so its prompts are as before (FR-002). Readers: the hook (section 7) and
spec-gatekeeper, which reports a check whose role is absent (section 5) as skipped, not as a
rejection.

## 7. Hook behaviour (D1)

The installer's `settings.json` PreToolUse gate entry changes its matcher from `Skill` to
`Skill|Agent`. Same command (`node "<hook>" gate`), same timeout.

On PreToolUse `Agent` from the main session (no `agent_id`), `gate` never makes a permission
decision:

| Launch prompt | Effect | Message |
|---|---|---|
| a `Team:` line naming only section 2 roles | writes the session's team record (`data-model.md`) | `speckit-team: team for this session: <roles>; audit gate off, spec-auditor is not in the team` or `...; audit gate on` |
| no `Team:` line | removes the session's team record | none |
| a `Team:` line naming anything else, or no role | removes the session's team record | `speckit-team: the Team line names <word>, not a team role; the full team's gates apply` |
| not a string, or no usable `session_id` | nothing | none |

In a subagent (`agent_id` set), `gate` and `gate retries` skip the audit check when the session's team
record is readable and lacks `spec-auditor`; otherwise they deny with today's text. With the audit
check skipped and no active feature, `gate retries` applies no retry limit. `result` counts a report
as an attempt under the same rule instead of `not counted` while the audit is unpassed. Without
`agent_id` (`/speckit-implement`, typed or as a Skill call) the record is never read.

## 8. The team question (FR-010, D5)

When no roles are named, one AskUserQuestion question, single select, before any launch:

1. Full team (Recommended): all six roles.
2. Build only: test-writer, implementer.
3. Implement only: implementer.
4. Spec and build, no audit or verification: product-owner, architect, test-writer, implementer.

Its free-text answer ("Other") is a role list read as section 1's list and checked by section 3.
