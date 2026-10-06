# speckit-agents

A team of six Claude Code subagents that carries a feature through
[GitHub Spec Kit](https://github.com/github/spec-kit), from idea to pull request. Each agent owns
one phase. Hooks, not prompt text, keep each one in its lane: the planner cannot write code, the
implementer cannot touch tests, and nobody writes code until an independent auditor has passed
the spec.

```
idea ─► product-owner ─► architect ─► spec-auditor ─► test-writer ─► implementer ─► spec-gatekeeper ─► PR
        spec.md          plan.md      VERDICT:        failing        code that      APPROVED /
        + questions      tasks.md     PASS / FAIL     tests (red)    passes (green) REJECTED
           ▲                ▲              │
           └── you answer   └── findings routed back on FAIL
```

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [The team](#the-team)
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
| `--force` | replace same-named agents you wrote yourself (each is backed up as `*.bak-speckit-agents-<time>`) |
| `--claude-dir DIR` | install into `DIR` instead of `~/.claude` |
| `--uninstall` | remove everything the installer wrote |

The installer is idempotent; rerun it after pulling changes. It backs up `settings.json` before
every change and refuses to touch one that is not valid JSON. It finishes by running the installed
hook once, so a broken Node setup fails the install instead of silently disabling the guardrails.

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
After that it audits, writes failing tests, implements, verifies and opens a PR, which it does not
merge.

You can also run one phase at a time by @-mentioning an agent:

```
@agent-spec-auditor audit the active feature
@agent-implementer do T007 and T008
```

## The team

| Agent | Spec Kit phase | May write | Hands over | Model |
|---|---|---|---|---|
| `product-owner` | specify, clarify | `specs/`, `.specify/feature.json` | `spec.md` and up to 5 questions with recommended answers | sonnet |
| `architect` | plan, tasks | `specs/`, `CLAUDE.md` | `plan.md`, `data-model.md`, `contracts/`, `tasks.md` | opus |
| `spec-auditor` | analyze | nothing | `VERDICT: PASS` or `FAIL`; PASS means zero CRITICAL and zero HIGH findings | opus |
| `test-writer` | TDD red | test files, `tasks.md` | committed tests, each shown failing for the right reason | sonnet |
| `implementer` | TDD green | anything except test files | committed code with the suite green | sonnet |
| `spec-gatekeeper` | final check | nothing | `APPROVED` or `REJECTED`, with a requirement-to-test table | sonnet |

Each agent's phase instructions are Spec Kit's own skill (`speckit-plan` and so on), preloaded
into the agent with the `skills:` frontmatter field. The agent file adds only what Spec Kit does
not say: its inputs, its lane, and the shape of its report. Those bodies are 15 to 25 lines on
purpose.

**Why the prompts are short.** A long prompt dilutes the rules that matter, and a rule in prose
is a request. "Never edit tests" in a prompt will hold most of the time. A hook that rejects the
edit holds every time, and its rejection message tells the agent what to do instead.

**Why each agent has a narrow description.** Claude Code puts every agent's description into
every session so it can route work. These six total about 1,700 characters, roughly 420 tokens.
Each one says when to use the agent and what it will not do, so routing does not have to guess.

## How it works

### Guardrails

Everything below is enforced by `hooks/speckit-team.mjs`. In a repo without `.specify/` every
mode exits immediately and allows the action, so installing at user level costs nothing elsewhere.

| Mode | Wired to | What it stops |
|---|---|---|
| `scope only <prefixes>` | product-owner, architect: PreToolUse `Write\|Edit\|MultiEdit\|NotebookEdit` | writing outside their prefixes |
| `scope tests` | test-writer: same | writing production code |
| `scope no-tests` | implementer: same | writing test files |
| `gate` | test-writer, implementer: PreToolUse on every tool | doing anything before the audit passed |
| `gate` | `settings.json`: PreToolUse `Skill` and `UserPromptExpansion` | `/speckit-implement`, typed by you or called by Claude, before the audit passed |
| `verdict` | spec-auditor: Stop | finishing without a `VERDICT:` line; records the verdict |
| `lane tests` / `lane no-tests` | test-writer, implementer: Stop | finishing with out-of-lane changes, including ones made through Bash or already committed |

Agent hooks live in each agent's frontmatter, so they only run while that agent is active.

### The audit gate

When spec-auditor finishes, its Stop hook reads the last `VERDICT:` line from the report and
stores it with a fingerprint: a SHA-256 of the constitution, `spec.md`, `plan.md` and `tasks.md`.
The gate recomputes the fingerprint on every check. Any edit to those four files after a PASS
voids it, so the auditor has to look again. Task checkboxes are normalised before hashing, so
ticking `- [X]` while implementing does not.

The active feature comes from `.specify/feature.json`, which Spec Kit maintains.

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

Verdicts and per-agent start points live in `$(git rev-parse --git-common-dir)/speckit-team/`.
That is inside `.git`, so it is never committed, and it is shared by every worktree of the repo,
which lets parallel implementers in worktrees pass the same gate.

### The pipeline skill

`/speckit-team` runs in the main session, because only the main session can talk to you. It
launches each agent with the inputs it needs and relays the product owner's questions to you. On
a FAIL or REJECTED, it routes each finding to the agent that owns it, and after two failed audits
it hands the findings to you. For `[P]` tasks touching disjoint files, it can run several
implementers in separate git worktrees.

## Customising

- **Test layout the patterns miss:** add one JavaScript regex per line to `.specify/test-paths`
  in that repo. Lines starting with `#` are comments.

  ```
  # golden files are tests too
  ^checks/golden/
  ```

- **Models:** edit `model:` in `agents/*.md` and rerun the installer. Use `inherit` to follow the
  session's model.
- **A stricter or looser PASS:** spec-auditor's "Verdict" section in `agents/spec-auditor.md`.
- **Edit the source, not the installed copy.** Installed files carry a
  `speckit-agents: managed by install.mjs` marker, and the next install overwrites them.

## Verifying

`npm test` runs 17 tests: 10 drive the hook with hook JSON on stdin against throwaway git repos,
7 run the installer against throwaway config dirs. They prove the logic. They cannot prove that
Claude Code fires a hook, which is where both serious bugs in this project were. After changing a
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

**`/speckit-implement` is not gated.** A typed slash command fires `UserPromptExpansion`, not
`UserPromptSubmit`, and a PreToolUse `Skill` hook only sees Claude calling the skill. Both entries
must be in `settings.json`; rerun the installer if a tool that rewrites `settings.json` dropped
them.

**"spec-auditor has not passed".** Run `@agent-spec-auditor`. If it passed and you then edited
the spec, plan, tasks or constitution, the PASS is void by design: run it again.

**An agent is blocked writing a legitimate test file.** Add a pattern to `.specify/test-paths`.

**Install fails with "not installed by speckit-agents".** You already have an agent with one of
these six names. Rename yours, or pass `--force` to back it up and replace it.

## Known limits

- **Hooks fail open.** If Node is missing or the script crashes, the action is allowed. The
  installer's smoke check and the live check above are the defences.
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

This removes the six agents, the skill, the hook and both `settings.json` entries. It only removes
files that carry the installer's marker, and leaves any same-named file you wrote alone. Audit
state stays in each repo's `.git/speckit-team/`, which is safe to delete.

## Developing

See `CLAUDE.md`. In short: edit `agents/`, `hooks/`, `skills/` or `install.mjs`, run `npm test`,
rerun the installer, and do the live check if you touched how a hook is wired.
