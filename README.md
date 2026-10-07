# speckit-agents

A team of six Claude Code subagents that carries a feature through
[GitHub Spec Kit](https://github.com/github/spec-kit), from idea to pull request. Each agent owns
one phase. Hooks, not prompt text, keep each one in its lane: the planner cannot write code, the
implementer cannot touch tests, and nobody writes code until an independent auditor has passed
the spec.

```
idea ─► product-owner ─► architect ─► spec-auditor ─► per slice: stubs ─► red ─► green ─► spec-gatekeeper ─► PR
        spec.md          plan.md      VERDICT:        implementer  test-writer  implementer  APPROVED /
        + questions      tasks.md     PASS / FAIL                                  │         REJECTED
           ▲                ▲              │                                       │
           └── you answer   └── findings routed back on FAIL ◄── 3 REDs in a row ──┘
```

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [The team](#the-team)
- [Why this architecture](#why-this-architecture)
- [How it works](#how-it-works)
- [Customising](#customising)
- [Verifying](#verifying)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)
- [Uninstall](#uninstall)
- [Developing](#developing)

## Requirements

| Tool | Why | Check |
|---|---|---|
| [Claude Code](https://code.claude.com) | runs the agents. Needs subagent frontmatter `hooks:` and `skills:`, and the `UserPromptExpansion` hook event (verified on 2.1.291) | `claude --version` |
| Node 18+ | every hook is a Node script | `node --version` |
| git | the hooks use it to find the repo and diff an agent's work | `git --version` |
| Spec Kit (`specify`) | per repo, provides the phase skills | `specify --version` (verified on 0.8.11) |

Install Spec Kit with `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git`.

## Install

```sh
git clone <this repo> speckit-agents && cd speckit-agents
./setup.sh                                               # macOS, Linux, Git Bash
powershell -ExecutionPolicy Bypass -File setup.ps1       # Windows PowerShell
node install.mjs                                         # anywhere Node runs
```

The installer puts everything in your user-level Claude Code directory (`$CLAUDE_CONFIG_DIR`, or
`~/.claude`), so the team is available in every repository:

| Installed file | What it is |
|---|---|
| `agents/{product-owner,architect,spec-auditor,test-writer,implementer,spec-gatekeeper}.md` | the six subagents |
| `skills/speckit-team/SKILL.md` | the `/speckit-team` command that runs the pipeline |
| `hooks/speckit-team.mjs` | every guardrail |
| `settings.json` | two hook entries merged in; your other settings and hooks are kept |

Options:

| Flag | Effect |
|---|---|
| `--dry-run` | print what would change, write nothing |
| `--force` | replace same-named agents you wrote yourself (each is kept as `*.bak-speckit-agents` and put back on uninstall) |
| `--claude-dir DIR` | install into `DIR` instead of `~/.claude` |
| `--uninstall` | remove everything the installer wrote, and nothing else |

The installer is idempotent; rerun it after pulling changes. It changes `settings.json` in place,
keeping the file's own indentation and line endings, and updates its gate entries where they stand,
so a rerun after another tool re-sorted the file changes nothing. The first time it changes your
settings it keeps one copy of the original as `settings.json.bak-speckit-agents`. It refuses to
touch a `settings.json` that is not valid JSON, and records what it created in
`hooks/speckit-agents.install.json`. It finishes by running the installed hook once, so a broken
Node setup fails the install instead of silently disabling the guardrails.

Restart Claude Code afterwards: agents are loaded at session start.

## Quick start

In a repository:

```sh
specify init --here --ai claude
```

Then, in Claude Code:

```
/speckit-constitution   (once per repo: the rules every phase is checked against)
/speckit-team Let users export their reading list as CSV
```

`/speckit-team` runs the whole pipeline from the main session. It stops for you at three points:
to answer the product owner's questions, to approve the spec, and to approve the plan and tasks.
After that it audits, then builds the feature one slice at a time (stubs, failing tests, code),
verifies and opens a PR, which it does not merge.

You can also run one phase at a time by @-mentioning an agent:

```
@agent-spec-auditor audit the active feature
@agent-implementer do T007 and T008
```

## The team

| Agent | Spec Kit phase | May write | Hands over | Model |
|---|---|---|---|---|
| `product-owner` | specify, clarify | `specs/`, `.specify/feature.json` | `spec.md` and up to 5 questions with recommended answers | sonnet |
| `architect` | plan, tasks | `specs/`, `CLAUDE.md` | `plan.md`, `data-model.md`, `contracts/`, `tasks.md`, with the minimal design that meets the spec | opus |
| `spec-auditor` | analyze | nothing | `VERDICT: PASS` or `FAIL`; FAIL only on CRITICAL or HIGH findings, MEDIUM and LOW are listed and accepted | opus |
| `test-writer` | TDD red | test files, `tasks.md` | committed tests, each shown failing on an assertion, never on a parse, import or compile error | sonnet |
| `implementer` | stubs, TDD green | anything except test files | signature stubs (`RESULT: STUB`), or committed code with the suite green (`RESULT: GREEN` / `RED`) | sonnet |
| `spec-gatekeeper` | final check | nothing | `APPROVED` or `REJECTED`, with a requirement-to-test table | sonnet |

Each agent's phase instructions are Spec Kit's own skill (`speckit-plan` and so on), preloaded
into the agent with the `skills:` frontmatter field. The agent file adds only what Spec Kit does
not say: its inputs, its lane, and the shape of its report. Those bodies are 19 to 33 lines on
purpose.

**Why the prompts are short.** A long prompt dilutes the rules that matter, and a rule in prose
is a request. "Never edit tests" in a prompt will hold most of the time. A hook that rejects the
edit holds every time, and its rejection message tells the agent what to do instead.

**Why each agent has a narrow description.** Claude Code puts every agent's description into
every session so it can route work. These six total about 1,700 characters, roughly 420 tokens.
Each one says when to use the agent and what it will not do, so routing does not have to guess.

## Why this architecture

- **No guessing at requirements.** Most agent pipelines go wrong at the start: the spec is vague,
  and the coding agent fills the gaps with guesses. Here product-owner has to return its open
  questions with recommended answers, `/speckit-team` puts them to you, and nothing is planned
  until you have approved the spec.
- **Tests written before the code.** A model that writes tests for code it has just written tends
  to write tautologies: tests that mock everything and pass regardless. test-writer writes the
  tests first, against stubs, and has to show each one failing on an assertion. implementer then
  has to make them pass and cannot edit them. A test that failed before the code existed shows the
  acceptance criterion became a check the code did not shape.
- **Circuit breakers.** spec-auditor stands between the plan and the code: a plan that breaks the
  spec is sent back before any tokens go into tests or code, and any later edit to spec, plan,
  tasks or constitution voids its PASS. During the build, the [retry limit](#the-retry-limit)
  stops an implementer after 3 failed attempts in a row and sends the task back to the architect
  or to you.
- **Permissions per role, enforced by hooks.** Each agent's file-system lane is checked by a hook
  on every write and again when it stops, not asked for in its prompt. A rule in a prompt is a
  request that holds most of the time; a hook that denies the write holds every time, and its
  message tells the agent what to do instead.

## How it works

### Guardrails

Everything below is enforced by `hooks/speckit-team.mjs`. In a repo without `.specify/` every
mode exits immediately and allows the action, so installing at user level costs nothing elsewhere.

| Mode | Wired to | What it stops |
|---|---|---|
| `scope only <prefixes>` | product-owner, architect: PreToolUse `Write\|Edit\|MultiEdit\|NotebookEdit` | writing outside their prefixes |
| `scope tests` | test-writer: same | writing production code |
| `scope no-tests` | implementer: same | writing test files |
| `gate` | test-writer, implementer: PreToolUse on every tool except `SubagentHandback` | doing anything before the audit passed (reporting back is never blocked) |
| `gate retries` | implementer: the same | also a fourth attempt after 3 `RESULT: RED` reports in a row on the same plan and tasks (see [The retry limit](#the-retry-limit)) |
| `result` | implementer: PreToolUse `SubagentHandback`, and Stop | a report without a `RESULT:` line (refused once, then counted as RED); counts the result |
| `gate` | `settings.json`: PreToolUse `Skill` and `UserPromptExpansion` | `/speckit-implement`, typed by you or called by Claude, before the audit passed |
| `verdict` | spec-auditor: PreToolUse `SubagentHandback`, and Stop | a report without a `VERDICT:` line (refused once, never twice); records the verdict |
| `lane tests` / `lane no-tests` | test-writer, implementer: Stop | finishing with out-of-lane changes, including ones made through Bash or already committed |

Agent hooks live in each agent's frontmatter, so they only run while that agent is active.

### The audit gate

When spec-auditor reports, a hook reads the last `VERDICT:` line from the report and stores it
with a fingerprint. In an interactive session the report is the `message` of the
`SubagentHandback` tool, read by a PreToolUse hook as it is sent; under `claude -p` it is the
agent's last message, read by the Stop hook. The fingerprint is a SHA-256 of the constitution, `spec.md`, `plan.md` and `tasks.md`.
The gate recomputes the fingerprint on every check. Any edit to those four files after a PASS
voids it, so the auditor has to look again. Task checkboxes are normalised before hashing, so
ticking `- [X]` while implementing does not.

The active feature comes from `.specify/feature.json`, which Spec Kit maintains.

### The retry limit

An implementer that cannot make its tests pass will otherwise keep trying small tweaks, and each
attempt costs a full agent run. So every implementer report ends with `RESULT: GREEN` (its tests
and the full suite pass), `RESULT: RED` (anything else) or `RESULT: STUB` (the signatures-only
pass described under [The pipeline skill](#the-pipeline-skill)). The `result` hook counts them per
feature: GREEN resets the count, STUB leaves it, RED adds one, and a report that still has no
`RESULT:` line after one request counts as RED. A handback and the Stop that follows it are one
attempt, not two.

After 3 REDs in a row, `gate retries` denies the implementer every tool except reporting back,
and says why. The count belongs to the plan and tasks it was made on (the audit fingerprint), so
the way forward is to send the failing task to the architect: the revised `plan.md` or `tasks.md`
needs a new audit and starts the count from zero. Or the user decides, and to retry unchanged
deletes `.git/speckit-team/retries/<feature>.json`. A retry record that cannot be read keeps the
gate shut, like an unreadable verdict. The limit is `MAX_RED` in `hooks/speckit-team.mjs`.

### The lane check

The write hooks see `Write` and `Edit`, but an agent can also change files with
`sed -i` through Bash. So on the first tool call, the gate records the agent's starting commit
and the files already dirty. When the agent stops, `lane` diffs everything since then, committed
or not, and blocks the stop if any changed file is outside the lane. The agent is told which
files to restore. Files that were dirty before the agent started are ignored. If the agent stops
a second time with the problem still there, the hook lets it finish with a WARNING rather than
loop.

### Test files

A path counts as a test if it matches one of:

- a directory segment `test/`, `tests/`, `__tests__/`, `testing/`, `testdata/`, `fixtures/`, `e2e/`, `spec/`
- `src/it/`, `src/integrationTest/`, `src/testFixtures/`
- `test_*.py`, `*_test.{go,py,rs,exs,dart,c,cc,cpp}`, `*.{test,spec}.{js,ts,jsx,tsx,mjs,cjs,mts,cts}`
- `*{Test,Tests,IT,Spec}.{java,kt,kts,groovy,scala,cs}`, `*_spec.rb`, `*Test.swift`, `*Tests.swift`

Plus every regex line in the repo's `.specify/test-paths` (see below).

### State

Verdicts, retry counts and per-agent start points live in `$(git rev-parse --git-common-dir)/speckit-team/`.
That is inside `.git`, so it is never committed, and it is shared by every worktree of the repo,
which lets parallel implementers in worktrees pass the same gate.

### The pipeline skill

`/speckit-team` runs in the main session, because only the main session can talk to you. It
launches each agent with the inputs it needs and relays the product owner's questions to you. On
a FAIL it routes each CRITICAL and HIGH finding to the agent that owns it; MEDIUM and LOW findings
are accepted and listed once at hand-over. On a REJECTED it routes each reason the same way. After
two failed audits it hands the findings to you.

After the audit it builds the feature one slice at a time, never in one shot. A slice is one small
implementation task plus the test tasks that cover it, and the architect writes `tasks.md` in
those slices. For each slice:

1. **Stubs.** If the tests will call code that does not exist yet, implementer first creates the
   signatures the task lists, with bodies that only signal "not implemented", and reports
   `RESULT: STUB`. This is what lets the next step fail cleanly.
2. **Red.** test-writer writes the slice's tests and loops until each one fails on an assertion
   or on the stub's not-implemented signal. A test that fails because it does not parse, an
   import is missing or a name is undefined proves nothing about the behaviour, so test-writer
   fixes it (at most 3 rounds per test) and the skill sends back any that still fail that way.
3. **Green.** implementer makes the slice's tests pass, under the [retry limit](#the-retry-limit).

For `[P]` slices touching disjoint files, it can run several loops at once, each implementer in its
own git worktree.

**Handoffs are lossy on purpose.** A subagent never sees the main session's conversation; it
starts with the prompt the skill writes and whatever files it reads. So the skill passes each
agent only what its Inputs section lists, and never the chat, the product owner's questions and
answers, or another agent's full report. implementer gets the slice's task IDs and test-writer's
report for them, and its own prompt tells it to read `tasks.md`, the failing tests and the code
they touch, not `spec.md`, `plan.md`, `research.md` or `data-model.md`. The tests are its spec.

The failure-reason check in step 2 is prose: the hooks cannot tell an assertion failure from a
compile error in an arbitrary language, so the skill checks test-writer's pasted output.

## Customising

- **Test layout the patterns miss:** add one JavaScript regex per line to `.specify/test-paths`
  in that repo. Lines starting with `#` are comments.

  ```
  # golden files are tests too
  ^checks/golden/
  ```

- **Models:** edit `model:` in `agents/*.md` and rerun the installer. Use `inherit` to follow the
  session's model.
- **More or fewer implementer attempts:** `MAX_RED` in `hooks/speckit-team.mjs` (default 3).
- **A stricter or looser PASS:** spec-auditor's "Verdict" section in `agents/spec-auditor.md`.
  By default only CRITICAL and HIGH findings fail an audit.
- **How much design the architect adds:** step 2 of `agents/architect.md` asks for the minimal
  design and no recovery machinery unless a requirement or constitution rule demands it.
- **Edit the source, not the installed copy.** Installed files carry a
  `speckit-agents: managed by install.mjs` marker, and the next install overwrites them.

## Verifying

`npm test` runs 44 tests: 28 drive the hook with hook JSON on stdin against throwaway git repos,
16 run the installer against throwaway config dirs. They prove the logic. They cannot prove that
Claude Code fires a hook, which is where all three serious bugs in this project were. After changing a
hook command, an event name or a matcher, check it live in a scratch repo:

```sh
mkdir /tmp/sk && cd /tmp/sk && git init && specify init --here --ai claude
# commit, then, with no audit recorded:
MSYS_NO_PATHCONV=1 claude -p "/speckit-implement" --output-format json
```

Expect `"num_turns":0` and `"total_cost_usd":0`, meaning the gate stopped it before any model
call. (`MSYS_NO_PATHCONV=1` matters only in Git Bash, which otherwise rewrites `/speckit-implement`
into `C:/Program Files/Git/speckit-implement`.)

Live results on 2026-10-06 (Claude Code 2.1.291, Windows 11, Haiku subagents):

- typed `/speckit-implement` with no audit: blocked at 0 turns, $0
- architect's `Write` to `src/`: denied, file not created
- implementer's first `Bash` call before an audit: denied by the gate
- spec-auditor's `VERDICT: PASS`: recorded by its Stop hook

Not yet exercised live: test-writer, implementer's test-file denial, and the lane checks. Those
are covered by the unit tests only.

## Troubleshooting

**The gates do nothing.** A hook that crashes counts as a non-blocking error, so the action goes
through and nothing tells you. Check that `node` is on the PATH Claude Code sees, then run
`claude --debug hooks` and look for `speckit-team.mjs` errors. This happened once already: hook
commands written with `$HOME` expanded to `/c/Users/...`, which `node` on Windows resolves to
`C:\c\Users\...`. The installer therefore writes a quoted absolute path. Do not hand-edit it into
`$HOME` or `~`.

**An agent cannot report back, or a verdict is never recorded.** Subagents in an interactive
session report through the `SubagentHandback` tool, not their last message. A hook that matches
every tool (`.*`) also matches that one: before 2026-10-06 the gate denied it, so a gated agent
retried its report until it gave up, and spec-auditor's verdict, read from the last message, was
never found. The gate now lets `SubagentHandback` through and the verdict is read from its
`message`. Any new catch-all hook must do the same.

**`/speckit-implement` is not gated.** A typed slash command fires `UserPromptExpansion`, not
`UserPromptSubmit`, and a PreToolUse `Skill` hook only sees Claude calling the skill. Both entries
must be in `settings.json`; rerun the installer if a tool that rewrites `settings.json` dropped
them.

**"spec-auditor has not passed".** Run `@agent-spec-auditor`. If it passed and you then edited
the spec, plan, tasks or constitution, the PASS is void by design: run it again.

**"Retry limit: implementer reported RESULT: RED 3 times in a row".** The plan or tasks need
rethinking: send the failing task to the architect and re-audit, which resets the count. To retry
without changes, delete the file the message names.

**An agent is blocked writing a legitimate test file.** Add a pattern to `.specify/test-paths`.

**Install fails with "not installed by speckit-agents".** You already have an agent with one of
these six names. Rename yours, or pass `--force` to back it up and replace it.

## Known limits

- **Hooks fail open.** If Node is missing or the script cannot start, the action is allowed. The
  installer's smoke check and the live check above are the defences. Input the hook cannot use
  (not JSON, not an object, an event the mode is not wired for) also lets the action through, but
  never silently: the hook makes no decision and shows a `speckit-team: ... no decision made`
  message. The same holds for fields of the wrong type and for any unforeseen error: a safety net
  turns every crash into no decision plus a `speckit-team: ... internal error` message. One case
  fails closed instead: a verdict file that cannot be read proves no PASS, so the gate stays shut
  and says why. Until 2026-10-06 the hook crashed on all of these, which allowed the action
  without a word.
- **Inline tests can't be told apart.** Tests that live inside production files (Rust
  `#[cfg(test)]`) can't be identified by path.
- **Read-only isn't airtight.** spec-auditor and spec-gatekeeper have no Write or Edit tools,
  but Bash could still write a file.
- **Subagents can't ask you questions.** product-owner returns its questions, and the main
  session asks them.
- **A preloaded skill pulls in its whole phase.** An architect asked to do one small thing will
  tend to run all of `speckit-plan`.
- **The team never merges.** It stops at the PR.

## Uninstall

```sh
node install.mjs --uninstall
```

This removes the six agents, the skill, the hook and both `settings.json` entries, and leaves
nothing of the installer's behind:

- **Settings:** if nothing else changed your `settings.json` since the install, its original bytes
  are written back, CRLF and inline arrays included. If something did (another tool, you), that
  change is kept and only the gates are removed, in the file's own format. Your own empty
  `"hooks": {}` or event lists are kept. No backup is made at uninstall, and the install-time copy
  is deleted.
- **Files:** only files that carry the installer's marker are removed; a same-named file you wrote
  is left alone. An agent that `--force` replaced is put back.
- **Directories:** only `agents/`, `hooks/` or `skills/` that the install created, and only if
  they are empty.

Audit state stays in each repo's `.git/speckit-team/`, which is safe to delete. An install made
before the record file existed has no record of what it created, so its uninstall keeps every
directory and leaves any older `*.bak-speckit-agents-<time>` backups in place.

## Developing

See `CLAUDE.md`. In short: edit `agents/`, `hooks/`, `skills/` or `install.mjs`, run `npm test`,
rerun the installer, and do the live check if you touched how a hook is wired.
