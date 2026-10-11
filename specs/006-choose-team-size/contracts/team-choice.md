# Contract: choosing the team for one `/speckit-team` request

Public surface (constitution V): the slash command's arguments (sections 1 to 3), the
`settings.json` entry (section 7). Sections 4 to 6 are the rules the skill, the agents and the hook
share; `test/install.test.mjs` and `test/hook.test.mjs` hold them together.

## 1. Request syntax (D2)

```text
/speckit-team [--team <role>[,<role>...]] <request>
/speckit-team --team noagents <request>
```

- `--team` counts only as the first word of the arguments.
- `--team noagents` (amended 2026-10-11, FR-013): the role list is exactly the one word `noagents`,
  in any case. No agent runs; the main session runs Spec Kit's own skills (section 9). It counts only
  when typed: the hook reads it from the typed command (section 7), so it is not one of section 8's
  options.
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
| `noagents` together with a role (amended 2026-10-11) | no agents means no roles |
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
| architect | plan and tasks, the plan stop and its open decisions, rounds by phase (one round instead) | spec-gatekeeper's open-task check (Process 2): there is no `tasks.md`; at the retry limit the user decides, there is no architect to rethink |
| spec-auditor | the audit and its FAIL routing | the audit gate on test-writer and implementer (`gate`) |
| test-writer | the red step; the test tasks of `tasks.md` are never launched, step 6's extra round included, and stay unticked | spec-gatekeeper's test trace (Process 1) and its open-task check on the test tasks (Process 2) |
| implementer | the stub and green steps and step 6's extra round; every task of `tasks.md` that is not a test task stays unticked; spec-gatekeeper starts after the last round's test-writer `RED` | the stub pass: a test failing on a missing production symbol or module counts as red, listed in test-writer's report, so step 4-5's broken-test rule sends back only a syntax error or a missing test-side name and runs no stub step; spec-gatekeeper's passing tests (the red tests are the run's result) and its open-task check on those tasks (Process 2) |
| spec-gatekeeper | verification and REJECTED routing | the recorded last word (`ends --record`) |

Unbuilt tasks: in a run with `tasks.md` and without test-writer or implementer, the skill splits the
tasks as it does for rounds (a test task is test-writer's, every other task implementer's), never
launches anyone for the absent role's tasks, and starts spec-gatekeeper only once every other task
is ticked. spec-gatekeeper's prompt then carries one line after the `Team:` line

```text
Unbuilt: T001, T003, T005
```

with exactly the absent role's task IDs in task order. spec-gatekeeper's Process 2 skips those IDs
and reports them as skipped, not as a REJECTED reason; any other open task still rejects. No
`Unbuilt:` line, no skip.

Constitution (skill step 0b): it runs only when the team has architect, spec-auditor or
spec-gatekeeper, the roles that read the constitution; otherwise the template stays and the start
notice names the step as skipped (FR-004, FR-005). With product-owner, step 1 commits the draft with
the spec, as today. Without it, the draft is committed on the branch section 4 leaves the tree on,
in the message of the first launch.

Every run keeps: hand-over (PR and CI, spec Assumptions), every chosen agent's `scope`, `lane`,
`ends` and `result` hooks, the retry limit while implementer is chosen, tests before implementation
when both test-writer and implementer are chosen, and the `/speckit-implement` gate. The retry limit
is the hook's on the active feature (D6). With no active feature (no `.specify/feature.json`, or one
naming no directory in the repo) the hook counts nothing (section 7), so the skill counts instead:
after 3 implementer `RESULT: RED` in a row it relaunches no implementer and hands the failing output
to the user (D7).

The one-line notice at the start (FR-005) and the final report (FR-008) name the rows of the absent
roles; the report also lists the unticked tasks and, in a run with implementer and no active
feature, that the retry limit was the skill's count, not the hook's (D7).

## 6. The `Team:` line

In a run whose team is not the full team, every launch prompt carries one line

```text
Team: test-writer, implementer
```

with the chosen roles in section 2's order, lower case, separated by a comma and a space. A full-team
run carries no such line, so its prompts are as before (FR-002), and a `--team noagents` run launches
nothing. `Team: noagents` is no team: the hook reads it as a line naming a non-role. Readers: the
hook (section 7) and spec-gatekeeper, which reports a check whose role is absent (section 5) as
skipped, not as a rejection.

## 7. Hook behaviour (D1)

The installer's `settings.json` PreToolUse gate entry changes its matcher from `Skill` to
`Skill|Agent`. Same command (`node "<hook>" gate`), same timeout.

On PreToolUse `Agent` from the main session (no `agent_id`) whose `subagent_type` is a section 2 role
in any case, `gate` never makes a permission decision (amended 2026-10-11, #101 and #103):

| Launch prompt | Effect | Message |
|---|---|---|
| a `Team:` line naming only section 2 roles | writes the session's team record (`data-model.md`) | `speckit-team: team for this session: <roles>; audit gate off, spec-auditor is not in the team` or `...; audit gate on` |
| no `Team:` line | writes the full team | none |
| a `Team:` line naming anything else, or no role | writes the full team | `speckit-team: the Team line names <word>, not a team role; the full team's gates apply` |
| any of these, when the record has `spec-auditor` and the new team lacks it | nothing: within a request the team never loses spec-auditor | `speckit-team: the Team line drops spec-auditor, which this request's team has; the audit gate stays on. A new /speckit-team request chooses a new team.` |
| any of these, when the record was `noagents` | as above | `speckit-team: a team agent was launched in a no-agents request; the full team's gates apply from here` (unless a message above applies) |
| not a string, or no usable `session_id` | nothing | none |

A launch of any other agent type (an Explore agent, `patcher`, a user's own agent) changes nothing
(#103). An `Agent` call made by a subagent (`agent_id` set) changes nothing and makes no decision,
whether or not the audit has passed (#102): launching an agent is not implementing, and the agents
of the team have no Agent tool.

On `UserPromptExpansion` of a typed `/speckit-team` (the installer's matcher is
`speckit-implement|speckit\.implement|speckit-team`; a command name ending in `:speckit-team` counts
too), `gate` never makes a decision. It removes the session's team record, which starts a request
(FR-009). When the typed arguments (`command_args`, or else the typed `prompt` after the command
name) name exactly `--team noagents` by section 1, it then writes the `noagents` record and says
`speckit-team: no agents for this request: /speckit-implement in this session skips the audit gate
until the next /speckit-team or team agent launch`. No usable `session_id`: nothing.

In a subagent (`agent_id` set), `gate` and `gate retries` skip the audit check when the session's team
record is readable and lacks `spec-auditor`; otherwise they deny with today's text. With the audit
check skipped and no active feature, `gate retries` makes no decision and still writes the lane
start record (`agents/<agent_id>.json`, which `lane` needs); the skill's count of section 5 caps the
relaunches instead (D7). `result` counts a report as an attempt under the same rule instead of `not
counted` while the audit is unpassed; with no active feature it counts nothing, as today. Without
`agent_id` (`/speckit-implement`, typed or as a Skill call) only a `noagents` record skips the audit
check; any other record is never read. At the retry limit, a readable record without `architect`
turns the deny's last sentence into `There is no architect in this run's team, so the user decides,
and only the user retries unchanged by deleting <file>.` (#106).

## 8. The team question (FR-010, D5)

When no roles are named, one AskUserQuestion question, single select, before any launch:

1. Full team (Recommended): all six roles.
2. Build only: test-writer, implementer.
3. Implement only: implementer.
4. Spec and build, no audit or verification: product-owner, architect, test-writer, implementer.

Its free-text answer ("Other") is a role list read as section 1's list and checked by section 3.
The question is a `**Stop:**` in the skill's sense (`## Pace`): the run waits for the answer, and in
a full-team run it is the first of four stops (D4). A free-text `noagents` is not the no-agents
choice, which only a typed command makes (section 7): the skill says in one line to type
`/speckit-team --team noagents <request>`, and stops.

## 9. No agents (FR-013, added 2026-10-11)

With `--team noagents` the skill's `## No agents` replaces steps 0b to 6: no Agent call and no
`Team:` line. The main session invokes `speckit-specify`, asks the spec's open questions (at most 5)
with AskUserQuestion, and stops for the spec review; invokes `speckit-plan` and `speckit-tasks` and
stops for the plan approval; invokes `speckit-implement`, which section 7 lets past the audit gate;
runs the tests, stopping after 3 failed runs of the same tests in a row; and hands over by step 7.
Skipped: the audit, verification and every agent hook. If the gate still denies
`speckit-implement`, the hook did not see the typed command, and the skill stops and says so.
