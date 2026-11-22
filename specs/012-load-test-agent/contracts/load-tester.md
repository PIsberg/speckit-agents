# Contract: the load-tester role

What a user types, what the installer lays down, what the hook decides and prints, and what the role
writes. Additive to every existing contract (constitution V).

## 1. Opting in

- `/speckit-team --load-test <request>` adds `load-tester` to the chosen team, as `--security` adds
  security-reviewer. `--load-test` leads the arguments with `--team`, `--security` and `--project`, in
  any order, at most once; after the request text has started it is request text.
- `--team <roles>` may name `load-tester` (no alias). Pipeline order, used by the `Team:` line:
  `product-owner, architect, spec-auditor, test-writer, implementer, load-tester, spec-gatekeeper,
  security-reviewer`.
- Never in the default team: a launch with no `Team:` line records `CORE_ROLES`, without it.
- Refusals of `## Team` are unchanged (D4): a team still needs test-writer or implementer.
- `--team skill-agents --load-test <request>` runs the role as `speckit-role-load-tester`.

## 2. The agent file `agents/load-tester.md`

Frontmatter, in the form of the other agents (marker line first):

| Key | Value |
|---|---|
| `tools` | `Bash, Edit, Read, Write` (no `disallowedTools`, so no `omitClaudeMd`) |
| `model` | `sonnet` |
| `color` | `pink` (the colour no other agent has; twin: `ROLE_COLOR` in `mods/speckit-board/hooks/model.ts`) |
| PreToolUse `.*` | `node "{{HOOK}}" gate scope load` |
| PreToolUse `SubagentHandback` | `node "{{HOOK}}" ends PASS FAIL "NOT MEASURED"` |
| Stop | `node "{{HOOK}}" lane load`, then `node "{{HOOK}}" ends PASS FAIL "NOT MEASURED"` |

Body: at most 100 lines, sections Inputs, Lane, Process, Verdict, Report. Inputs: the feature directory
(from the prompt), `git diff main...HEAD` (or `master...HEAD`), the constitution, the project's test
command and existing load tests. `install.mjs: roleSkill` generates the role skill from it.

## 3. Lane `load` (D1)

A repo-relative path is in the lane when either holds:

- `isTest(path)` (built-in `TEST_PATTERNS` plus `.specify/test-paths`, `!` lines applied) and the path
  matches `/(^|[\/._-])load([\/._-]|$)/i` or `/[a-z0-9]Load(Tests?|IT|Spec)\.[A-Za-z]+$/`;
- the path matches `^specs/[^/]+/load-test\.md$`.

Everything else is outside: production code, functional tests, `tasks.md`, spec, plan, `.specify/`.

| Check | Where | Outcome outside the lane |
|---|---|---|
| `scope load` (via `gate scope load`, and `scope role` for the role skill) | PreToolUse Write, Edit, MultiEdit, NotebookEdit, Bash | deny, naming the path and what the lane holds |
| `lane load` (and `lane role`) | Stop | block once to restore, then a `WARNING:` system message |
| `.specify/test-paths` has a bad line | both | the refusal the `tests` and `no-tests` rules give |
| audit not passed (`gate`) | every tool call; for the role skill, its call | `Implementation gate: ...`, as test-writer's |

## 4. Report

At most 40 lines, in this order:

1. `Measurements`: one row per measurement: name, value, unit, what it was judged against (a ceiling or
   a same-run control), `gates` or `trend`, and the result (`pass` or `fail`). Wall-clock and processor
   time are always `trend`.
2. `Not measured`: each skipped, unavailable or not-run measurement or tier, and why. Never in 1.
3. `Warnings`: the `noisy:` lines of section 6, an unstable FAIL with both readings, a result that moved
   with no named cause.
4. The last line, exactly one of `PASS`, `FAIL`, `NOT MEASURED`.

The verdict: `FAIL` when a gating measurement fails or an instrument check fails (the build measured
is not the working tree's, a result set is empty or short of its expected count, a switch did not
engage). `NOT MEASURED` when no gating measurement ran (no load surface, no runner, only skips).
`PASS` only when at least one gating measurement ran, every gating measurement passed and every
instrument check held. A noisy run changes no verdict.

## 5. Record file `specs/<feature>/load-test.md`

One file per feature, rewritten on each run, with these sections:

- `## Procedure`: the commands for the reduced run (the project's ordinary test command) and for the
  full sweep (the environment variable that selects it), and what each load test measures.
- `## Environment`: date, OS, processor, runtime and tool versions, the versions compared.
- `## Budgets`: one row per ceiling: measurement, unit, ceiling, margin, the failing first readings, and
  their date. A row is added only after the failing first run (FR-012).
- `## Readings`: each run's values, by date, with what each was judged against.
- `## Warnings` and `## Skipped`: as in the report.

## 6. `probe` (D2)

A CLI mode of the installed hook, run from Bash like `check`; never a hook entry. It reads no stdin and
answers in any directory.

```text
node "<hook>" probe
probe: busy <B>% probe <M> ms

node "<hook>" probe --since <B0>,<M0>
probe: busy <B>% probe <M> ms (start: busy <B0>%, probe <M0> ms)
noisy: other processes used <max(B0, B)>% of the machine (10% or more)
noisy: the fixed probe ran <P>% slower at the end than at the start (20% or more)
```

- `<B>`: the share of all processors' time not idle over a 1,000 ms sample of `os.cpus()`, an integer.
- `<M>`: the median time of 5 runs of a fixed workload (SHA-256 over a 1 MiB buffer, 64 times), in ms.
- Each `noisy:` line appears only when its threshold is crossed: busy at the start or the end at 10 or
  more; end probe time at 1.2 times the start's or more (`<P>` = `round((M / M0 - 1) * 100)`).
- Exit 0. A `--since` value that is not two non-negative numbers, the second above 0, exits 1 with one
  line starting `speckit-team: probe:`, never a stack trace.
