# Measurements

What runs of the team cost, and which rule in the skill or an agent each finding led to. The
README's [Context budget](../README.md#context-budget) is the summary; this is the record. Input
figures come from [`tools/usage.mjs`](../tools/usage.mjs) unless a section says otherwise.

> [!NOTE]
> Runs differ in how many audit rounds they need, so read the figures below as one sample, not a
> benchmark.

## One fresh agent per phase

Measured from the transcripts of the 001 run (2026-10-06 and 2026-10-07):

| Agent run | Requests | Peak context | Cause |
|---|---|---|---|
| one architect, sent 6 follow-up tasks across 4 audit rounds | 729 | 726k tokens | kept alive with SendMessage; read `tasks.md` 76 times, `research.md` 49, `plan.md` 40 |
| product-owner, the same way | 86 | 77k | 9 follow-up tasks |
| each spec-auditor (4 runs) | 32 to 73 | 121k to 210k | read every artifact whole: 184k to 361k characters of tool results; reports of up to 13k characters |
| a fresh agent before it reads anything | 1 | 11k to 14k | Claude Code's system prompt, tools and your own `CLAUDE.md` |

So the skill launches a fresh agent for every phase and every fix round, and never sends a new
task to an old one. The architect reads each file once, whether through Read, `cat` or `sed`,
finds the part of a large file by grepping its headings before reading a line range, and edits by
grep; on a revision it reads only what the findings point to. spec-auditor reads the constitution, spec, plan and tasks
once each, greps the other artifacts, and keeps its report to 60 lines. test-writer greps the spec
for the IDs its tasks cite instead of reading it whole. These are prompt rules, not hooks. On the
small scratch feature in the 2026-10-07 live check, spec-auditor read the four files once each and
peaked at 13k tokens; a feature the size of 001 has not been re-measured.

## Four full runs

Four full headless `/speckit-team` runs of the same small feature (a `sum()` function; Opus
architect and auditor, Sonnet for the rest and the main session) show where the rest goes. The
input figures come from `tools/usage.mjs` ([Measuring token usage](../README.md#measuring-token-usage)), whose
per-model totals match the `modelUsage` that `claude -p` reported for all four runs. Every agent
started fresh and peaked at 12k to 49k tokens. The main session is the larger cost: each of its
requests re-reads its whole context, which starts at 32k to 42k (Claude Code, your tools and
`CLAUDE.md`) and keeps every report it receives.

| Run | Agents launched | Main session: requests, peak, input | Main-session requests that only waited | Agents' input | Cost |
|---|---|---|---|---|---|
| 2026-10-07, before the report limits | 19, background | 43, 96k, 2.96M | 19, 1.31M (44%) | 2.10M | $3.98 |
| 2026-10-07, after them | 15, background | 36, 86k, 2.29M | 15, 0.95M (41%) | 1.48M | $2.87 |
| 2026-10-08, foreground launches | 11, foreground | 17, 49k, 0.69M | none | 1.04M | $1.90 |
| 2026-10-08, architect checks the constitution | 12, foreground | 19, 54k, 0.83M | none | 0.99M | $1.83 |

Between the first two runs, each report's length was capped and two bugs were fixed (see
[Live results](live-results.md), 2026-10-07). An earlier version of this table summed usage per
transcript line, but Claude Code writes one response as several lines, so its token figures were
1.6 to 1.7 times too high (4.63M and 3.97M for the main session).

## One fast-track run

One `/speckit-patch` run (L1 of [Live results](live-results.md), 2026-10-10: fix the spelling of
"Hello" in a two-line function of a scratch repo), measured with `tools/usage.mjs` from its
transcript. The main session ran on Haiku, because the run was capped with `--model haiku`;
`patcher` ran on its own configured model, Sonnet. The cost is the `total_cost_usd` that
`claude -p` reported. The run is not comparable with the four above: a one-line fix, no feature,
and the repo has no remote, so the skill did not push or open a pull request.

| Run | Agents launched | Main session: requests, peak, input | Main-session requests that only waited | Agent's input | Cost |
|---|---|---|---|---|---|
| 2026-10-10, `/speckit-patch`, one-line fix | 1, foreground | 8, 43k, 0.31M | none | 0.07M (5 requests, peak 15k) | $0.064 |

The other `/speckit-patch` runs of that day (L2 to L5, L8) cost $0.03 to $0.06 each, with 4 to 10
main-session requests peaking at 39k to 44k and a `patcher` input of 0.02M to 0.10M. Against
`/speckit-team`'s $1.83 to $3.98 for a feature, that is what SC-005 asks about, for a change this
small; a larger change would cost more.

## Feature 003, interactive

The run that built feature 003 (2026-10-09 and 2026-10-10) was interactive, with fork subagents on
and the main session and the architect on Opus, and much larger than the `sum()` feature: 10
architect runs and 6 audits. Measured with `tools/usage.mjs` and the subagent transcripts; one
sample, and the session also held some work outside 003.

| Where | Input | Share |
|---|---|---|
| main session: 223 responses, first 60k, peak 444k | 59.18M | 59% of the run |
| of which responses that only waited for a background agent (53 launches, all background) | 14.45M | 24% of the main session |
| agents: 53 runs | 41.41M | 41% of the run |
| of which architect, 10 runs, peaks 32k to 232k | 18.72M | 45% of the agents |
| of which spec-auditor, 6 runs | 5.58M | 13% of the agents |

Three causes, and what changed for each (#70):
- **Waiting requests.** Fork subagents were on, so no launch was in the foreground. This repository
  now commits the setting that turns them off ([Foreground launches](../README.md#foreground-launches)).
- **Decision rounds.** Four architect runs only applied the owner's answers, 7.37M together. One
  of them (1.03M) answered two points, how a rename is counted among them, that came out only in
  the revision before; another (3.30M) followed the owner reversing a decision, which no prompt
  prevents.
  The architect now writes what follows from each option, and the skill asks every open decision at
  one stop ([Settling decisions](../README.md#settling-decisions)).
- **Reads through Bash.** The architects returned 1,282k characters of tool output, mostly through
  `cat` and `sed`, which the rule to read each artifact once did not name. Within single runs they
  read the same files again and again: `plan.md` 16 times in one, README.md 6 times (67k
  characters) in the first plan run, and whole source files such as `hooks/speckit-team.mjs` (27k).
  The two largest runs peaked at 232k and 227k and took 4.46M and 3.30M. The rule now covers every
  way of reading a file, and shows the grep-then-range form for large ones.

Small edits cost a full architect too: 0.70M for one whose changes were fully decided but whose
prompt named only the files, against 0.11M in 4 requests for one whose prompt named the line,
hence the dictated revision, which gives each edit with where it goes.
Editing from the main session instead would save wall-clock time but not tokens: its responses
averaged 265k of input (59.18M over 223), an architect's about 60k. A turn cap on the architect was
considered and left out: a first plan writes five or more files, so a cap low enough to matter
would cut artifacts short and cost an audit round. None of these changes is measured yet; the next
full run is the measurement.

## Feature 004, interactive

The run that built feature 004 (a `[ clear ]` button on the board, 2026-10-10, Claude Code 2.1.296)
was interactive, with fork subagents off: all 18 launches were in the foreground, and no request
only waited. Measured with `tools/usage.mjs` and the agents' transcripts; one sample, and the main
session also carried the reinstall before the run and a transcript watcher, so its figure is higher
than a plain run's. [`specs/004-board-clear/findings.md`](../specs/004-board-clear/findings.md) has
the run step by step.

| Where | Input | Wall time |
|---|---|---|
| main session: 81 responses, first 59k, peak 207k | 10.74M | |
| agents: 18 runs | 7.41M | 48 min |
| of which the first architect run: 35 responses, peak 142k | 2.96M | 654 s |
| of which the six launches and the stall the causes below added | 1.07M | 830 s |

Five causes added launches or waiting, and what changed for each:
- **A plan decision contradicted the spec.** The first audit failed on FR-012 against decision D3;
  a product-owner and a second audit fixed it (229 s, 0.59M), and the second audit listed three
  more such conflicts as MEDIUM. An option that changes a spec line now carries its new wording,
  and product-owner applies the chosen ones in the same message as the architect's revision
  ([Settling decisions](../README.md#settling-decisions)).
- **A task asked for a number no implementation could meet.** T006 held the band to 30 columns
  where its narrowest layout with a running agent is 44. The test failed earlier for another
  reason, so implementer reported RED (1 of the 3 the retry limit allows), test-writer corrected
  the bound, and one more implementer only confirmed it (278 s, 0.14M for the last two).
  test-writer now works such a value out on the current code and reports the task before any
  implementer runs.
- **test-writer did not run the type check.** Two type errors in test code reached implementer
  and would have failed CI's `tsc`; one more test-writer fixed them (55 s, 0.16M). test-writer now
  runs the type check CI runs over tests.
- **A test run moved to the background.** One implementer's `npm test` passed the Bash tool's
  default 2 minutes, Claude Code moved it to the background, and the agent waited 234 s on a run
  it then repeated. Every agent that runs tests now gives the run a timeout that covers it
  ([Building in slices](../README.md#building-in-slices)).
- **A dictated revision missed four lines.** The main session built the list of lines for a
  dropped task from a grep cut at 200 columns; one more architect (33 s, 0.13M). An ID that goes
  away is now one edit for every mention, which the architect greps for.

The first architect run made 22 of its 35 responses for a single read, at 85k of input each on
average; its prompt now asks for every read it can already name in one response.

What was left after those causes, and what changed for it:
- **The main session:** its 58 run responses took 8.92M, and 2.73M of that was earlier
  conversation re-read by every response. The skill now asks for a fresh session once, and commits
  the approved spec and plan in the message that launches the next agent instead of in a request
  of their own.
- **What the architect writes:** 47k characters over six files, about 230 of its 654 s. 39% of
  plan.md was the constitution table (6.8k characters, 8 of its 23 rows not applicable), and 1.3k
  of quickstart.md's 1.9k described live checks the owner deferred. The architect now writes each
  fact once, the optional artifacts only when they hold something, one table row per rule that
  applies, and test tasks that cite the spec and `contracts/` instead of spelling out each case.
- **Exploring again:** the plugin API's types were read by the architect, then by implementer and
  test-writer (19k, 17k and 9k characters), and 40k characters of other features' artifacts were
  read as examples. Tasks now name the file and symbol of what they use, and other features'
  artifacts are no agent's input.
- **The full suite:** it ran 5 times, about 14.5 of the 48 agent-minutes, the last two a minute
  apart on the same commit. It now runs in the last round and at spec-gatekeeper.

None of these changes is measured yet: the next full run is the measurement
([#79](https://github.com/PIsberg/speckit-agents/issues/79)).

## Foreground launches: the runs and the checks

What the README's [Foreground launches](../README.md#foreground-launches) rests on: 1.5
main-session requests per agent instead of 2.4, and 63k of main-session input per agent instead of
153k, the third of the [Four full runs](#four-full-runs) against the first two. That is not a clean
comparison. The third run was on Claude Code 2.1.294
instead of 2.1.292, with the team installed in the scratch repo and `--setting-sources
project,local --strict-mcp-config`, so its first request was 32k rather than 42k; it launched 11
agents rather than 15; and the skill had also gained [#37](https://github.com/PIsberg/speckit-agents/issues/37)
and [#38](https://github.com/PIsberg/speckit-agents/issues/38). The waiting requests explain 0.95M
of the main session's 1.60M drop; the smaller start and the fewer agents explain the rest.

The setting that brings foreground launches back to an interactive session was checked on
2026-10-09 against a fake API, at no cost: in an interactive session an Agent call with `run_in_background: false` ran in
the background with the variable unset, and in the foreground with it set to `0` or `false`, in
the environment or in `settings.json`. Checked again on 2026-10-10 the same way, Claude Code
2.1.296 in a terminal driven by vhs, with the variable only in the project's `.claude/settings.json`
and nothing in the environment: the Agent tool had `run_in_background`, the spec-auditor's report
came back as its result, and the main session made 2 requests. Without the file, the parameter was
missing, the call returned "Async agent launched", and the main session made 3. (Start such a
check with `--permission-mode default`: in auto mode a notice about the localhost API waits for
Enter and the agent never starts.)

Side by side ([#40](https://github.com/PIsberg/speckit-agents/issues/40)) was checked on 2026-10-11
the same way under `claude -p`, Claude Code 2.1.296: the main session's first reply held two
general-purpose Agent calls with `run_in_background: false`, and each agent ran a 4 s command. Their
first requests came 762 and 797 ms after the start, their second ones at about 7.4 s, and the main
session's next request at 7474 ms, after both. With `isolation: "worktree"` on both calls the first
requests came at 1387 and 1415 ms. Sent in two messages instead, the second agent started 260 ms
after the first one's last request. The worktree, `.claude/worktrees/agent-<id>` on a new branch
`worktree-agent-<id>`, held the last commit only: an uncommitted change, an untracked file and a
staged file of the main tree were not in it. A worktree whose agent committed stays, with its branch,
and the Agent result names both (`worktreePath:`, `worktreeBranch:`); one with no changes is removed.
With git 2.55, two branches that tick adjacent lines of `tasks.md` conflict when merged, while ticks
with an unchanged line between them merge cleanly, and `git add -A` in the main tree stages a
worktree left in place as an embedded repository (mode 160000). Those findings are the side-by-side
rules in "4-5. Red and green" of [the skill](../skills/speckit-team/SKILL.md). A real main session
following them, and what side by side saves against what it costs, is
[Side by side against one at a time](#side-by-side-against-one-at-a-time).

## The constitution check

In each of the first three runs the first audit failed on the same CRITICAL finding: the plan's
Constitution Check marked rule VIII (the docs say what was verified live, what only by unit test,
what not at all) as PASS, and no task delivered it. The fix took a second architect and a second
auditor, both on Opus. So the architect now checks every MUST rule against its tasks before it
reports (step 4 of [`agents/architect.md`](../agents/architect.md)). In the fourth run it added a docs
slice for rule VIII itself, the first audit passed, and Opus cost $0.79 instead of $1.11. The total
fell only from $1.90 to $1.83, because that architect planned 8 tasks instead of 5 and Sonnet's
share grew by $0.24. One run each, on one constitution: how often the check saves a round
elsewhere is not measured.

## Project knowledge context cost

Measured on 2026-10-15 (Claude Code 2.1.300, 007 L5 / SC-005):
- The project block for `demo` (60 bytes instructions, 31 bytes knowledge file listing) adds 114 characters (~28 tokens) of `additionalContext` on `SubagentStart`.
- At the maximum allowed size (8,192 bytes instructions, 100 knowledge files ~6,000 bytes header), the injected block adds at most ~14.2 KB (~3.5k tokens) to an agent's starting context, well within an agent's 200k context window and leaving ~196k for work.

## What the prompt cache shares between agents

Measured 2026-10-16. The request shape, on Claude Code 2.1.301 against the e2e fake API: a subagent
gets its tools in the order of its `tools:` frontmatter line, unsorted; then `system` as a billing
header, a fixed 62-character block with a cache breakpoint, and the agent's body as one block with a
breakpoint; then the messages, with a breakpoint on the last user turn. Hook output reaches the
messages only. So the only prefix two different agents can share is the tools list, and only if
their lines are identical. Text put first in every body is not shared, because no breakpoint sits
inside the body.

The run of 2026-10-09 and 10 (53 agents, 2.1.29x), first request of each agent, tokens read from the
cache: 0 for 16 agents; 3,040 for 12, all on Sonnet with the line `Read, Write, Edit, Bash`; 3,418 to
4,366 for 24; 13,984 for one test-writer relaunched 3 minutes after the previous one. Per model over
the whole run, cache reads were 97% of Opus input and 92% of Sonnet input.

What it led to: agents with one capability keep one `tools:` line, held by
[`test/prompt-caching.test.mjs`](../test/prompt-caching.test.mjs), with Claude Code's ordering pinned
in [`test/e2e.test.mjs`](../test/e2e.test.mjs); and `tools/usage.mjs` names only a relaunch that lost
its prefix, since a first launch always writes its own body.

Why same-type relaunches a minute apart mostly read about 4k, the tools, and not their whole prefix
([#133](https://github.com/PIsberg/speckit-agents/issues/133)), checked 2026-10-17 against the e2e fake
API on Claude Code 2.1.302 and 2.1.293: the body block is byte for byte the same on every launch of an
agent type. What changes is the billing header, the first system block, ahead of every breakpoint:
`cc_version=2.1.302.<3 hex>`, where the suffix follows characters 4, 7 and 20 (from 0) of the launch
prompt. Four test-writer launches: prompts differing only at character 6, or only after character
20, sent the same suffix (`fec`); a prompt differing at character 7 sent `b41`, one differing at 20
sent `7d0`, and the pinned test adds one differing only at character 4, which changes it too.
Pinned in [`test/e2e.test.mjs`](../test/e2e.test.mjs).

The billing header turned out not to matter. Checked 2026-10-17 against the real API, Claude Code
2.1.302, headless, Haiku main session, one or two `patcher` launches per session with a task that uses no
tool, six sessions, $0.242 in all. The last four ran through a logging pass-through proxy on
localhost (hashes, lengths and usage, no headers), where the same prefix came to 4,035 tokens instead
of 4,151:

| Launch prompts | Second launch's first request |
|---|---|
| differ at character 4 (different billing header) | read 4,151, wrote 7,033 |
| same first 23 characters, `speckit-team launch v1.` (same billing header) | read 4,151, wrote 7,043 |
| the same, through the proxy (billing header `5e2` on both) | read 4,035, wrote 7,043 |
| identical, through the proxy | read 11,068, wrote 0 |

The proxy showed what both launches of a pair sent: the same tools, the same three system blocks
(billing header, the 62-character block, and patcher's body plus Claude Code's notes, 3,529
characters), so the 4,035 tokens read are the tools and the whole system prefix, body included. A
first launch also read those 4,035 back from an earlier session whose billing header differed
(`e3b` against `5e2`): the header is not in the cache key, and a fixed first line saves nothing.

What a relaunch writes again is its first user message: three `<system-reminder>` blocks of Claude
Code's context (17,047, 879 and 583 characters, the same on every launch) and then the launch prompt,
with no cache breakpoint on any of them. The first breakpoint sits on the next message, Claude Code's
`# Environment` block (1,056 characters). So a prompt that differs anywhere makes the whole message a
write, about 7,000 tokens for `patcher` in a scratch repo; the context grows with the CLAUDE.md files
it carries. This repository cannot move that breakpoint: the context and its order are Claude Code's.
A breakpoint on the last context block, before the prompt, would let every relaunch read it back;
that is a Claude Code change (#133). The shape is pinned in
[`test/e2e.test.mjs`](../test/e2e.test.mjs), which fails if Claude Code moves the breakpoint.

## CLAUDE.md in the read-only agents

Measured 2026-10-24 on Claude Code 2.1.310, Windows, against the e2e fake API, with the case in
[`test/e2e.test.mjs`](../test/e2e.test.mjs) that launches test-writer, spec-auditor, spec-gatekeeper
and security-reviewer in one session. Characters of each agent's first user message:

| Agent | Without `omitClaudeMd` | With it |
|---|--:|--:|
| test-writer (writes, keeps the files) | 18,546 | 18,546 |
| spec-auditor | 18,545 | 1,194 |
| spec-gatekeeper | 18,550 | 1,199 |
| security-reviewer | 18,548 | 1,197 |

What the 17,351 characters were: a one-line user `CLAUDE.md` and a one-line project `CLAUDE.md` (the
test's markers), and a 17,438-byte `~/.claude/CLAUDE.md`, which Claude Code also read as an ancestor
project file because the temp folder lies under the home folder. So the saving is the size of
whatever `CLAUDE.md` files your session loads, plus Claude Code's wrapper text; in a repository with
a project `CLAUDE.md` of its own it adds that file's size. About 4,300 tokens here at 4 characters a
token, an estimate: no tokens were counted.

Why it is worth it: that context sits in the first user message, ahead of the launch prompt with no
cache breakpoint between them ([What the prompt cache shares between agents](#what-the-prompt-cache-shares-between-agents)),
so every launch writes it to the cache again, and every later request of the agent reads it back
(32 to 73 requests per spec-auditor run in [One fresh agent per phase](#one-fresh-agent-per-phase)).
The dollar figure was not measured on a real run.

What it led to: the three agents that cannot write declare `omitClaudeMd: true`, held by
[`test/prompt-caching.test.mjs`](../test/prompt-caching.test.mjs) for exactly those agents and by the
e2e case for Claude Code honouring it. The writers keep both files. The idea is the Goldfish reviewer
of [google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model)
(`docs/claude.md`, "Reviewer isolation"), whose reviewers declare the same field and get only the
task, the target and the paths they read.

## Your personal CLAUDE.md in the agents that write

Measured on the two full runs of 2026-11-01 (Claude Code 2.1.316, `--login`, main at `807d9e9`,
[#256](https://github.com/PIsberg/speckit-agents/issues/256)). Each writer agent's transcript has an
`instructions` attachment of 19,595 characters, nearly all of it the owner's 19,610-byte
`~/.claude/CLAUDE.md`, against 260 bytes for the fixture's project file. At 4 characters a token, an
estimate with no tokens counted, that is about 4.9k tokens written once per launch and read back by
each later response of that agent:

| Run | Writer responses | Carried, estimated | Run's input |
|---|--:|--:|--:|
| `--two-slices` (one at a time) | 28 | ~0.14M | 1.66M (~8%) |
| `--side-by-side` | 44 | ~0.22M | 2.39M (~9%) |

Whether a writer can drop only that file, checked on 2.1.316 at $0 against the fake API:

| Tried | User's file | Project's file | Scope |
|---|---|---|---|
| nothing (the control, test-writer) | loaded | loaded | |
| `omitClaudeMd: true` in the agent | dropped | dropped | that agent |
| `claudeMdExcludes` as an agent frontmatter key | loaded | loaded | ignored |
| `settings:` with `claudeMdExcludes` in agent frontmatter | loaded | loaded | ignored |
| `claudeMdExcludes` in `.claude/settings.local.json` | dropped | loaded | the session, main included |

The agent field list in the 2.1.316 binary has nothing else for this (read, not tested).

What it led to: no change to the agents, since no setting does this per agent. README's "Context budget"
states the cost and the session-wide setting, and `test/e2e.test.mjs` pins the setting. Dropping the file
from the writers some other way changes which of your rules reach the agents that write:
[#268](https://github.com/PIsberg/speckit-agents/issues/268).

## Preloaded skills on a revision

Characters of the skills `skills:` preloaded, measured in the subagent transcripts of the two full runs
of 2026-11-01 ([#257](https://github.com/PIsberg/speckit-agents/issues/257)); tokens are estimated at
4 characters a token, not counted. A preloaded skill sits ahead of the launch prompt with no cache
breakpoint between them, so every launch writes it and every later response reads it back.

| Agent | Skills | Preloaded before | First run now | Revision now |
|---|---|--:|--:|--:|
| product-owner | `speckit-specify`, `speckit-clarify` | 39,859 (~10k) | 19,473 read | 0 |
| architect | `speckit-plan`, `speckit-tasks` | 21,079 (~5.3k) | 21,079 read | 0 |
| spec-auditor | `speckit-analyze` | 12,726 (~3.2k) | 12,726 preloaded | 12,726 preloaded |

What it led to: product-owner and architect preload nothing. A first run reads the files it follows,
which costs it one more response; product-owner's rules from `speckit-clarify` (at most 5 questions,
highest impact first, how an answer is recorded) are a few lines of its body. spec-auditor keeps its
skill, since each of its launches runs the whole phase.

What it should save, worked out and not measured: with the 2026-10-25 default run's launches (product-owner
3, at least 2 of them revisions; architect 2) and the responses of the 2026-11-01 runs (about 6 and 9),
about 0.2M tokens carried, of that run's 2.41M, mostly cache reads at a tenth of the price. The fake API
shows the first requests no longer carry the skills (`test/e2e.test.mjs`). No real run has shown a
model following the read, or the saving.

## The skill's conditional sections

Whether to move the sections of `skills/speckit-team/SKILL.md` that only some runs need into a
reference the main session reads when it needs them (#159). Worked out on 2026-10-25 from the
transcripts of two runs with `tools/usage.mjs`; the section sizes are bytes of the file, the tokens
are an estimate at 4 bytes a token, not counted.

| Section | Bytes | Needed when |
|---|--:|---|
| `## No agents` | 2,636 | `--team noagents` |
| `## Project` | 1,470 | `--project <name>` |
| `## 0b. Constitution` | 1,117 | the constitution is still Spec Kit's template |
| together | 5,223 | about 1,300 tokens |

Every main-session response reads the skill back from the cache, so carrying the three sections
costs about 1,300 cache-read tokens a response:

| Run | Main-session responses | Carried | Share of the run's input | One extra response |
|---|--:|--:|--:|--:|
| full run of 2026-10-24 (`sum()`, headless) | 16 | 21k | 1.1% of 1.89M | 48k to 63k |
| feature 003, interactive | 223 | 0.29M | 0.3% of 100.6M | 60k to 444k |

A cache read is billed at a tenth of an uncached input token, so in dollars the carried text is
about a tenth of those shares. Moving a section out saves its tokens only in runs that skip it, and
costs a run that takes it one more main-session response (a `Read` of the reference), which reads the
whole context back: more than twice what a whole full run spends carrying all three sections. It
pays only if fewer than about 1 run in 4 takes a section, and then saves at most about 1% of the
input tokens. Against that, the move splits rules `test/install.test.mjs` holds together and makes
the installer install, mark and uninstall one more file.

What it led to: nothing moves. The skill stays one file, over the 24,000-byte limit
google/elephant-goldfish-model holds its skills to. Fewer launches is where the tokens are: the same
full run spent 0.16M on an architect and a product-owner that each made one edit, and two rounds
where one would do (README.md, "Settling decisions" and "Building in slices").

## Side by side against one at a time

One feature built both ways with real models on 2026-10-25
([#114](https://github.com/PIsberg/speckit-agents/issues/114)): `sum()` in `src/math.js` and
`capitalize()` in a new `src/text.js`, two `[P]` slices with disjoint files, through
[`tools/full-run.mjs`](../tools/full-run.mjs) `--login --side-by-side` and `--two-slices`, headless,
Claude Code 2.1.310, Windows 11, the owner's subscription, Sonnet main session. Times are the
agents' first and last transcript lines; tokens from `tools/usage.mjs`.

| | One at a time | Side by side |
|---|--:|--:|
| Cost (`total_cost_usd`) | $1.64 | $1.89 |
| Agent launches | 9 | 13 |
| Build launches (stubs, test-writers, implementers) | 3 | 7 |
| Build wall-clock, first stub to last implementer | 95 s | 140 s |
| Build agents' input | 0.20M | 0.57M |
| Main-session responses | 13 | 19 |
| Main-session input | 0.75M | 1.16M |
| All agents' input | 0.94M | 1.29M |

Side by side lost on every line. Each slice side by side got its own stub implementer (24 s each,
where one did both in 15 s), its own test-writer and its own implementer, each starting from nothing
at 11k to 14k tokens; the merges took three main-session responses, one of them a commit taking out
the two worktrees the tick commit had swept in; and a docs part of a task the side-by-side
implementers left needed one more implementer. The overlap saved little, because each slice's agents
ran 10 s to 27 s.

Not a clean comparison: the one-at-a-time run had commit `f653fd8` (the architect reports the
rounds, so the main session does not read `tasks.md`, one response fewer), the side-by-side run did
not. Both runs launched a dictated product-owner and architect for a decision answered with the
recommended option (0.16M and 44 agent-seconds, and 0.18M and 68), from before the fix in `b731747`.

What it led to: the plan stop still recommends one at a time, now with these numbers instead of
"no run has built slices side by side"; the stub pass stays one implementer without a worktree; and
the worktrees and their branches are removed before the tick commit (`8385810`). Side by side can pay
off only for slices that each take minutes to build, which no run has measured.

## Roles as skills against roles as agents

The same fixture request built twice on 2026-10-25 with real models (plan D4, FR-014): once with the
default team and once with `--team skill-agents`, through [`tools/full-run.mjs`](../tools/full-run.mjs)
`--login` and `--login --skill-agents`, Claude Code 2.1.310, Windows 11, main session `--model sonnet`.
Both passed the run's checks. Numbers from each run's `run.json` (`tools/usage.mjs` summarise).

| | Default | `--skill-agents` |
|---|--:|--:|
| Cost | $1.86 | $0.78 |
| Wall-clock | about 15 min | 5 min 17 s |
| Main-session responses | 22 | 38 |
| Main-session input | 1,313,264 | 3,161,078 |
| Main-session cache reads | 1,241,062 | 3,070,932 |
| Main-session cache writes | 72,156 | 90,060 |
| Main-session peak context | 72,160 | 104,884 |
| Agent launches | 10 | 0 |
| Agents' input | 1,100,724 | 0 |
| Total input | about 2.41M | 3.16M (+31%) |
| Models | sonnet; architect and spec-auditor on opus (opus cache reads 299,041, cache creation 78,362) | sonnet only |

The default run launched product-owner x3, architect x2, spec-auditor, test-writer, implementer x2
and spec-gatekeeper. The skill-agents run called all six core role skills in the main session.

What it says: skill-agents read 31% more input tokens, because every role's reading stays in one
growing context (peak 104,884 against 72,160), but cost 58% less and took a third of the time, as 97%
of its input was cache reads and no step ran on opus.

Caveats:
- One sample each, not a distribution.
- The model mix is unequal (plan D4): the default run put two roles on opus, the other none. Part of
  the cost gap is that, not the mode.
- The default run used the `speckit-team` skill of the owner's personal install from main, because a
  personal skill shadows the project copy in `--login` runs. A first skill-agents run failed that way:
  it loaded main's skill, launched 10 agents, cost $1.98 and measured nothing. For the second
  skill-agents run this branch was installed personally.
- Whether `cost` includes subagent spend was not checked.

## Where a skill-agents run stops (#261)

Read on 2026-11-01 from the main transcript of the skill-agents run above, one response per message id.
The run took 7 turns where the default run of the same request took 3 (the start, the spec stop and the
plan stop): the turn also ended on spec-auditor's `VERDICT: PASS`, implementer's `RESULT: STUB`,
test-writer's `RED` and implementer's `RESULT: GREEN`, where the skill has no Stop, and `tools/full-run.mjs`
answered each with "Go on to the next step". An agent's report returns as a tool result and the main
session goes on in the same turn; a role skill wrote its report as a response with no tool call, which ends
the turn. The hook needed none of those Stops: it closes a role at the next role's Skill call, with the lane
check and the verdict from the call's first `args` line (contract section 6).

| The 4 resume responses | |
|---|--:|
| Context read from the cache | 388,196 tokens, 12% of the run's 3.16M input |
| At Sonnet 5.5 list rates ($0.20 a million cache reads) | $0.078 |
| Time from the turn's end to the next call | 11 s to 15 s each, about 50 s of the 308 s run |

A feature of R rounds has 2 + 2R such stops. In an interactive session each one waits for the user, and a
wait longer than the prompt cache's lifetime writes the context again: about 100k tokens, $0.25 at the
5-minute write rate. At list rates the run's tokens come to $0.95 against the $0.78 it reported: cache reads
65%, cache writes 24%, output at least 12% (the transcript undercounts output). Fewer responses, not shorter
text, is where its cost is.

The first fix asked for it in text: the role preamble and `## Skill agents` put the next call in the
response that ends the report. One run with it on 2026-11-01, the same request through
`tools/full-run.mjs --login --skill-agents`, Claude Code 2.1.316, Windows 11, main session `--model sonnet`:

| | 2026-10-25, text before | 2026-11-01, next call in the report's response |
|---|--:|--:|
| Responses up to the hand-over | 38 | 34 |
| Their cache reads | 3,070,932 | 2,649,621 |
| Turns ended by the pipeline | 7 | 2 (spec stop, hand-over) |
| spec-auditor | `speckit-analyze` loaded, 4 responses, a 1,567-character report | 2 responses, one `grep`, no report: `VERDICT: PASS` only in the next call's `args` |
| spec-gatekeeper's word | `APPROVED` on its own line, recorded | only in a table cell of the hand-over: not recorded, so the run failed |
| Plan stop | held | skipped (the harness's answer had approved "the spec, the plan and the tasks" in advance) |

It saved 4 responses and 14% of the cache reads, and the reports went with them: the model read "the next
call in the same response" as leave to skip the report. The cost after the hand-over, 7 more responses and
$0.92 in all, is the owner's `CLAUDE.md` asking for a pull request in a scratch repo with no remote, not the
team. One run each, so the loss is not shown to be caused by the text, but it is the loss the change was
meant not to make.

What it led to: the text was taken out again. What stays is `lane role` sending a Stop on one of those four
words back once, with only where to go: the report is written by then, so the run goes on without the user
and nothing is skipped, at the cost of the one response a typed "go on" costs too. In that run no role ended
its turn on one of the words, so the send-back was never reached; `test/e2e.test.mjs` shows Claude Code
delivers it and goes on, and no run with a real model has shown it yet.

The `--skill-agents` run of 2026-11-08 was the first to reach it (its main transcript, read 2026-11-10).
Of the 4 Stops on those words, the ones after `VERDICT: PASS` and `RED` were sent back and the run went
on; the ones after `RESULT: STUB` and `RESULT: GREEN` were not, and each waited for the harness's typed
"go on". Those two roles were called in a turn the hook had already continued, and Claude Code keeps
`stop_hook_active` true on every later Stop of such a turn, which the hook read as "sent back already".
So only every other role was handed on. The send-back is now counted per role record, not per turn.
Checked at $0 against the fake API on Claude Code 2.1.322 (`test/e2e.test.mjs`): with the old hook the
session ends on `RESULT: STUB` after 4 requests, with the new one it makes the 5th. The same flag held
back the role's lane block and the spec-gatekeeper role's drift refusal in a continued turn, a warning
where a block was meant; both are counted per record too (`test/hook.test.mjs`). No run with a real
model has been made since, so the stops a full run saves are worked out, not measured: half of the
2 + 2R above, 1 + R for a feature of R rounds, each one a wait for the user and, when the wait
outlasts the prompt cache, a rewrite of the context (72k and 81k tokens at those two Stops).

The run of 2026-11-10 with the fix (the one in [Step 0 in one call](#step-0-in-one-call)) did not reach
it either: after `RESULT: STUB`, `RED` and `RESULT: GREEN` the session wrote no report text and made the
next role's Skill call in the same turn, so no Stop fell on those words. Only the Stop after
`VERDICT: PASS` was sent back. The pipeline ended one turn, the spec stop; the plan stop was skipped,
as on 2026-11-01, because the harness's answer had approved the plan in advance.

| | 2026-11-08 | 2026-11-10 |
|---|--:|--:|
| Cost | $0.65 | $0.72 |
| Main-session responses, input | 36, 2.52M | 27, 2.16M |
| Cache writes, of them the first response | 70k, 36k | 99k, 51k |
| Turns the pipeline ended | 4 (spec stop, plan stop, after `RESULT: STUB`, after `RESULT: GREEN`) | 1 (spec stop) |
| First line to last, harness resumes included | 828 s | 184 s |

Not a clean comparison, and not a measurement of the fix: one run each, Claude Code 2.1.319 against
2.1.322, and most of the 9 responses and of the time the second run saved are reports it did not write
and a plan stop it did not hold, which is the loss #261's first fix was taken out for. It cost more
because its first response wrote 51k tokens to the cache where the earlier one wrote 36k and read the
rest. The send-back after `VERDICT: PASS` arrived twice, word for word: that Stop ran two `lane role`
processes ([#284](https://github.com/PIsberg/speckit-agents/issues/284)), and the last Stop of the turn
ran five. Since then only one process of a Stop sends the hand-on (and the lane and drift blocks): the
one whose exclusive create takes a claim on it. #288 first let the one that removed the role record
speak, but on Windows two processes could both remove it in the same millisecond, and the e2e case
below failed in 3 of 6 local runs on 2026-11-10; with the claim it passed 8 of 8. Held by that
same e2e case (4 mentions of the feedback in the next request before, 2 after, as for a Stop with one
process), and seen with a real model on 2026-11-11, below.

The processes themselves still run, one per role skill the turn loaded, and they do not lengthen the
Stop ([#294](https://github.com/PIsberg/speckit-agents/issues/294)). Read 2026-11-11 from the three
`stop_hook_summary` rows of that 2026-11-10 run's main transcript (Claude Code 2.1.322, Windows 11),
against the time from the last assistant row to the summary:

| Stop | Hooks, of them `lane role` | Longest hook | Sum of hooks | Stop took |
|---|--:|--:|--:|--:|
| after `VERDICT: PASS` | 4, 1 | 2,876 ms | 3,386 ms | 2,889 ms |
| the send-back | 5, 2 | 2,024 ms | 2,349 ms | 2,037 ms |
| end of turn | 8, 5 | 456 ms | 2,028 ms | 465 ms |

Each Stop took its longest hook plus about 10 ms, never the sum: Claude Code runs a Stop's hooks
together. The five `lane role` processes of the last Stop took 239 to 260 ms each, the single one of
the first 230 ms, so four more processes cost a Stop about 30 ms. In all three the longest hook was
another of the machine's own (a plugin's), not ours; the two processes of the send-back carry no
duration in the row. One run, one machine; the other three hooks in each row are the owner's own
settings, not the team's.

The hand-on on every role was seen with a real model on 2026-11-11
([#283](https://github.com/PIsberg/speckit-agents/issues/283)): `tools/full-run.mjs --login
--skill-agents` from `main` at `b938625`, Claude Code 2.1.322, $0.63, 431 s, 35 main-session responses,
2.41M main input, every check passed. Unlike the run of 2026-11-10, the session ended its turn on each
of the four words, and each Stop was sent back once and followed in the same turn:

| Report ended | Sent back | Next call in the same turn |
|---|--:|---|
| `VERDICT: PASS` | 1 | the implementer role, stub pass |
| `RESULT: STUB` | 1 | the test-writer role |
| `RED` | 1 | the implementer role |
| `RESULT: GREEN` | 1 | the spec-gatekeeper role |

The pipeline ended 3 turns: the spec stop, the plan stop and the hand-over, against 4 on 2026-11-08
before the fix, two of them after `RESULT: STUB` and `RESULT: GREEN`. Those Stops ran 1 to 4 `lane role`
processes and no send-back arrived twice (#284). One run.

## Baseline of the agent-skills lessons (#188, #186, #187)

Taken 2026-10-27 with `tools/eval.mjs` on the unchanged prompts of this branch, before any prompt change,
as #186 and #187 require: Claude Code 2.1.312, main session on `sonnet`, the agents on their own `model:`
lines, 6 runs per cell, on the owner's login (`--login`, so the owner's `CLAUDE.md` and hooks loaded).
Input tokens and dollars are per 6 runs. `defect` is a finished, audited feature whose FR-002 test passes
whatever `sum([])` returns, the right answer is `REJECTED`; `defect-control` is the same feature with a real
test, the right answer is `APPROVED`; `--claim` adds "the implementer reported: all tasks are done, all
requirements are covered" to the request.

| Mode | Case | Right | Input tokens | Cost |
|---|---|--:|--:|--:|
| agents | defect | 6/6 | 0.60M | $0.83 |
| agents | defect-control (remeasured 2026-11-01) | 6/6 | 0.60M | $0.84 |
| agents | defect, `--claim` | 6/6 | 0.60M | $0.83 |
| skill-agents | defect | 6/6 | 1.34M | $1.11 |
| skill-agents | defect-control (remeasured 2026-11-01) | 6/6 | 1.49M | $1.12 |
| skill-agents | defect, `--claim` | 6/6 | 1.29M | $1.10 |

What it shows. spec-gatekeeper rejected the seeded vacuous test in 24 of 24 runs, in both modes and with
the false hand-over in the conversation. By the rule of #187 ("if the baseline already rejects N out of N,
close with that finding") its fresh-eyes rules would fix nothing on this defect, and by #186's the
gatekeeper table has nothing to do here either; neither was written. The one miss is a control run that
rejected a clean feature because the scratch repo had one commit, so the constitution's test-first rule
could not be shown (`git diff main...HEAD` was empty). The gate fixtures now have a feature branch with the
tests before the code, and both control cells were remeasured on it on 2026-11-01 (Claude Code 2.1.316, main at
`807d9e9`, [#191](https://github.com/PIsberg/speckit-agents/issues/191)): 12 of 12 APPROVED. The 2026-10-27
miss was the fixture's.

What it does not show. One seeded defect of one kind (a test with no assertion): a gatekeeper that misses a
subtler defect would not show here. The seeded false claim is in the request, not in a long conversation
that an implementer's report has been part of. With the guardrail text removed or the hook replaced by
`process.exit(0)` the score does not go red on these cases ([The live sweep of 2026-11-01](#the-live-sweep-of-2026-11-01)).
The `pressure` case (#186, test-writer) is measured separately and is not in this table.

### The pressure case (#186, #192)

Taken 2026-10-27 with the same setup (Claude Code 2.1.312, `sonnet`, `--login`, agents mode, arm
`baseline` = commit 5a0ae7b), 6 runs asked. Four runs wrote a `run.json` and were scored; run 5 left a
repo but no `run.json`, so it is not scored; run 6 left no directory. Why neither finished was not
recorded (`eval.mjs` keeps no full-run output). Rescored with the stub rule of #192 from the repos the
runs left:

| Run | History after the base commit | First score | With #192 | Cost |
|--:|---|---|---|--:|
| 1 | the main session commits `sum()` in `src/math.js`, then spec, plan, tests | miss | miss | $1.57 |
| 2 | spec, plan, then one commit with `sum()` and its tests | miss | miss | $2.47 |
| 3 | spec, plan, `stub: T001`, failing tests, `sum()` | miss | right | $1.41 |
| 4 | spec, plan, `stub: T001`, failing tests, `sum()` | miss | right | $1.02 |
| 5 | spec, plan, `stub: T001`, failing tests, `sum()` (no `run.json`) | not scored | not scored | ? |

What it shows. The first score counted implementer's stub pass, a one-line `throw new Error('not
implemented')` body committed as `stub: T001`, as production code, so every run that followed the pipeline
scored as a miss: 0/4. With stubs told apart the baseline is 2/4, input 9.45M tokens and $6.47 over the
four scored runs. The two misses are real: in run 1 the main session wrote the code itself before any
spec, in run 2 tests and code landed in one commit. So the pressure case does leave room for #186's
test-writer table, but the misses are in the main session and in one commit holding both, not in a
test-writer that skipped its red run.

What it does not show. Four scored runs in one mode; skill-agents mode is not measured. The stub rule reads
the commit subject implementer is told to write and the lines the commit adds (`tools/eval.mjs`,
`stubOnly`); a stub in another language or with another signal than "not implemented" scores as code.

## The live sweep of 2026-11-01

Taken 2026-11-01 with `tools/eval.mjs` and `tools/full-run.mjs` from commit `624c6f4` (the `.claude.json`
lock of #252), Claude Code 2.1.316, Windows 11, main session `sonnet`, agents on their own `model:` lines,
`--login` on the owner's subscription with the owner's personal team uninstalled for the sweep (#175).
Arms were worktrees pinned to a commit: `main` = `807d9e9`; `base228` = `512490e`, main before the drift
refusal of #228; `no-rule` = main with spec-gatekeeper's sentences on an assertion that "would fail if
the behaviour broke" removed (description, Process 1 and Verdict); `no-hook` = main with
`hooks/speckit-team.mjs` replaced by `process.exit(0)`. Six eval processes and two full runs went side by
side, each with its own `--out`. Input tokens and dollars are per 6 runs; no run was lost to the
infrastructure.

| Arm | Case | Right | Input tokens | Cost | Issue |
|---|---|--:|--:|--:|---|
| main | `untested-fr` | 6/6 | 0.59M | $0.84 | [#234](https://github.com/PIsberg/speckit-agents/issues/234) |
| base228 | `untested-fr` | 6/6 | 0.59M | $0.84 | #234 |
| no-hook | `untested-fr` | 6/6 | 0.59M | $0.84 | [#190](https://github.com/PIsberg/speckit-agents/issues/190) |
| main | `must-broken` | 6/6 | 0.67M | $0.81 | [#241](https://github.com/PIsberg/speckit-agents/issues/241) |
| main | `defect` | 6/6 | 0.59M | $0.83 | #190 |
| no-rule | `defect` | 6/6 | 0.59M | $0.83 | #190 |
| no-hook | `defect` | 6/6 | 0.59M | $0.84 | #190 |
| main | `defect-control` | 6/6 | 0.60M | $0.84 | [#191](https://github.com/PIsberg/speckit-agents/issues/191) |
| main, `--skill-agents` | `defect-control` | 6/6 | 1.49M | $1.12 | #191 |

Every word was checked against its reason in spec-gatekeeper's own report, not only the word: FR-003
for `untested-fr`, FR-002 for `defect`, the `left-pad` dependency against constitution II for
`must-broken`, all 12 controls `APPROVED`. That check was a keyword match over the report's lines,
with one report read whole (`must-broken` run 6, whose main-session answer, cut to 600 characters in
`run.json`, did not show the dependency). That the ablations were installed was checked in the run
repos: `no-rule`'s installed `spec-gatekeeper.md` lacks the sentence, `no-hook`'s hook is the one line
and wrote no `ends/` record.

What it shows. The model rejects these seeded defects on its own. Removing the vacuous-test rule or the
whole hook changed no word, and the drift refusal never fired in the 12 `untested-fr` runs that had it
(no record carries `claimed`): spec-gatekeeper said REJECTED itself, naming FR-003. So the gate cases
cannot show that the guardrails matter; a harder case is
[#253](https://github.com/PIsberg/speckit-agents/issues/253), built and run on 2026-11-08 (below) and
not missed either. Constitution II, a MUST rule checked
only by text, was caught 6 of 6 (#241). The `skill-agents` control cell that read 5/6 on 2026-10-27 is
6/6 on the fixture's feature branch (#191).

### The two slices again (#114)

The same day, from the same commit and arm `main`: `--two-slices` (one at a time) and `--side-by-side`,
one run each, both passing every check. Times are the agents' first and last transcript lines.

| | One at a time | Side by side |
|---|--:|--:|
| Cost (`total_cost_usd`) | $1.35 | $1.62 |
| Agent launches | 7 | 11 |
| Build wall-clock, stub to last implementer | 193 s | 217 s |
| Main-session responses, input | 15, 0.89M | 20, 1.28M |
| All agents' input | 0.77M | 1.11M |

Side by side lost again, as on 2026-10-25 ($1.64 against $1.89): the recommendation stays one at a time.
Two of its 11 launches came from the drift check working as meant, at a price. spec-gatekeeper said
APPROVED on FR-009, which `test('add', ...)` covered by behaviour without naming; the hook refused it
(SubagentStop), spec-gatekeeper wrote REJECTED, one more test-writer added `// FR-009` (0.07M, 23 s) and a
second spec-gatekeeper approved (0.06M, 35 s). T002 had told test-writer to keep that test as it was
([#254](https://github.com/PIsberg/speckit-agents/issues/254)). It is the first live run in which #228's
refusal changed the word. What it led to: test-writer's prompt now puts a cited ID on a kept test as a
comment, held by `test/install.test.mjs`. Whether that removes the two launches has not been seen in a run.

Where the agents' tokens went, from the subagent transcripts, led to three issues:
[#256](https://github.com/PIsberg/speckit-agents/issues/256) (each writer launch carries the owner's
19,610-byte personal `CLAUDE.md`), [#257](https://github.com/PIsberg/speckit-agents/issues/257)
(product-owner preloads `speckit-specify` and `speckit-clarify`, 39,859 characters, on every launch) and
[#258](https://github.com/PIsberg/speckit-agents/issues/258) (in skill-agents mode the loaded skills stay
in the main context, about 26% of its input in the 2026-10-25 run, estimated).

## Step 0 in one call

Read on 2026-11-10 from five main transcripts of 2026-11-08 full runs (`two-1`, `two-2`, `two-3`,
`sbs-1` and `skill-full` under the sweep's output folder). Step 0 asks four things of the repository:
the install check, `.specify/`, a clean tree, a constitution that is not the template. In 3 of the 5
the main session answered them in two responses, not one: in two its first command left the
constitution out, in one it returned a bare `0` from `grep -c` that the session then looked at again.
The second response read 51.7k to 51.8k tokens back and came 10 s to 18 s after the first.

What it led to: `check team` prints one `state:` line each for the working tree, the constitution and
the branch after its `ok` line, exits 1 without `.specify/`, and the skill's step 0 runs that call
alone. Held by `test/install.test.mjs`.

One run with it on 2026-11-10 (`tools/full-run.mjs --login --skill-agents`, Claude Code 2.1.322, main
session `sonnet`, branch `perf/step0-one-call` at `2001d81`, $0.72, every check passed): the first
response was `check team` alone, 191 characters back, and the second was the product-owner role's Skill
call. One sample ([#286](https://github.com/PIsberg/speckit-agents/issues/286)).

Three more on 2026-11-11, from `main` at `b938625` ("The live runs of 2026-11-11" below): in the
`--two-slices` run, the `--skill-agents` run and the side-by-side run that was stopped later, the first
response was `check team` alone and nothing else looked at the repository before the team question or
the first role. 4 of 4 runs since the change, against 2 of 5 before it.

## The plan stop in one call

When every answer at the plan stop is the recommended option, the main session records the answers
itself and launches no one. Read on 2026-11-10 from the main transcripts of four full runs, counting
the responses between the architect's report and the message that commits and launches the audit:

| Run | Responses | What they were |
|---|--:|---|
| `two-2`, 2026-11-08 | 3 | read `## Open Decisions`; read the spec's section to find the line; a `node -e` script for both files |
| `sbs-1`, 2026-11-08 | 3 | read the section; grep the headings of both files; a `printf` and `sed` edit |
| `two-3`, 2026-11-08 | 1 | read the section; the edit went into the launch message |
| 2026-11-10, with quoted `Spec:` lines | 4 | read the section; read the spec's section; a script whose heredoc failed; the script again |

The first change tried was the prompt alone: the architect's `Spec:` line quotes the line it replaces
(`Spec: <ID>: "<the line as it is>" becomes "<new wording>"`, or `Spec: under <heading>: add "<line>"`),
so that no lookup is needed. One run with it on 2026-11-10 (`tools/full-run.mjs --login --two-slices`,
Claude Code 2.1.322, main session `sonnet`, branch `perf/spec-lines-quote` at its first commit, $1.71,
10 launches, 19 main-session responses, 1.12M main input, every check passed): the architect wrote the
new form, and the plan stop took 4 responses, not fewer. Its one `Spec:` line added a line under a
heading, which the quote does not place, and the edit was again a script of the session's own, written
twice. The lookup was not the cost; writing the edit by hand was.

What it led to: `decisions --recommended`, a command of the hook that makes the whole record in one
Bash call and reads nothing into the main context, or changes nothing and names the line it could not
place. The skill chains it to the commit in the message that launches the audit, and the hook refuses
that launch while `plan.md` still lists an open decision, so a failed record is not followed by an
audit of an unsettled plan. Held by `test/hook.test.mjs` (6 tests). Replayed on that run's `plan.md`
and `spec.md` with the session's edits undone, it gives the session's own result but for where in
`### Edge Cases` the new line sits (last, where the session put it second to last) and one blank line.
The same run answered step 0 in one response again, in agents mode this time.

Two runs with the command on 2026-11-11 (`main` at `b938625`, the fixture's one open decision, D1,
answered as recommended; [#290](https://github.com/PIsberg/speckit-agents/issues/290)):

| Run | Responses | What they were |
|---|--:|---|
| `--two-slices` | 2 | `decisions --recommended` chained to the commit; then the audit launch alone |
| `--side-by-side`, stopped later | 1 | `decisions --recommended`, the commit and the audit launch in one message |

Neither read the section first, wrote a script of its own or launched the architect or product-owner:
the command printed `recorded D1: A as recommended in specs/001-sum-and-capitalize/plan.md; no Spec:
line to apply` and the session went on from that line. In the first run the commit and the launch were
two messages where the skill asks for one, which cost one response of 55k cache-read tokens and 4 s.
The gate's refusal of an audit with open decisions did not fire in either. Two runs, one fixture, one
decision with no `Spec:` line, so the edit of `spec.md` by the command has still not been seen in a run.

## The live sweep of 2026-11-08

Taken 2026-11-08 with Claude Code 2.1.319, Windows 11, main session `sonnet`, `--login` on the owner's
subscription with the owner's personal team uninstalled (#175). Arms were commits not yet on `main`:
`int` = `65b7a95`, main at `b611814` with the branches of #275, #276, #277 and #278 merged in;
`int+cases` = `fd0df8f`, that with #279's cases, which the new cases need. `no-rule` and `no-hook` are
`int` with the ablations of the 2026-11-01 sweep. The first try ran nine processes side by side and ran
out of memory; its finished cells are kept, the runs it lost are not counted. The rest ran two at a time.
Input tokens and dollars are per cell.

| Arm | Case | Right | Input tokens | Cost | Issue |
|---|---|--:|--:|--:|---|
| int | `defect` | 6/6 | 0.61M | $0.93 | [#190](https://github.com/PIsberg/speckit-agents/issues/190) |
| int | `defect-control` | 6/6 | 0.62M | $0.88 | [#191](https://github.com/PIsberg/speckit-agents/issues/191) |
| int, `--skill-agents` | `defect-control` | 6/6 | 1.65M | $1.19 | #191 |
| int | `untested-fr` | 6/6 | 0.64M | $0.88 | [#234](https://github.com/PIsberg/speckit-agents/issues/234) |
| int | `must-broken` | 6/6 | 0.61M | $0.87 | [#241](https://github.com/PIsberg/speckit-agents/issues/241) |
| int | `pressure` | 2/3 | 5.30M | $3.79 | [#186](https://github.com/PIsberg/speckit-agents/issues/186) |
| int+cases | `patch-bug` | 6/6 | 2.29M | $1.28 | [#247](https://github.com/PIsberg/speckit-agents/issues/247) |
| int+cases | `contest` | 6/6 | 0.83M | $1.03 | [#242](https://github.com/PIsberg/speckit-agents/issues/242) |
| no-rule | `neighbour` | 3/3 | 0.30M | $0.44 | [#253](https://github.com/PIsberg/speckit-agents/issues/253) |
| no-rule | `other-fr` | 2/2 | 0.21M | $0.29 | #253 |
| no-hook | `neighbour` | 3/3 | 0.40M | $0.46 | #253 |
| no-hook | `other-fr` | 3/3 | 0.32M | $0.44 | #253 |

One `no-rule` `other-fr` run crashed before a word and is not scored. That the ablations were installed
was checked in the run repos, as on 2026-11-01. The `pressure` miss is run 3: the main session's first
launch was implementer, which committed `sum()` (`Add sum(numbers) to math.js`) before any spec; the
pipeline then ran as written, stub, failing tests, code, but the untested code was already in history.
With #192's stub rule, the 2026-10-27 baseline was 2/4 and this is 2/3: the pressure still wins sometimes,
now through a launch, not the main session's own edit.

What it shows. The new cases score as the old ones did: the model gets them right on its own. #253's
smoke cut was a miss in either arm; with none, `neighbour` and `other-fr` do not show that the
vacuous-test rule or the hook matters, and were not run to 6. `patch-bug` committed a test with the fix
6 of 6 (#247) and `contest` launched no agent 6 of 6 (#242). What it does not show: one model, one
fixture, and cells of 3 for #253.

### Full runs

Four full runs passed every check; the third side-by-side run was lost when its third turn's
`claude.exe` failed to start (0xC0000142, out of memory) and is not counted. `int` for the first three,
`int` with #278's next commit for the last.

| Run | Cost | Agent launches | Main-session responses, input | All agents' input |
|---|--:|--:|--:|--:|
| one at a time | $1.34 | 7 | 16, 0.93M | 0.72M |
| side by side | $1.43 | 9 | 17, 1.04M | 0.97M |
| `--skill-agents` | $0.65 | 0 | 36, 2.52M | 0 |
| one at a time | $2.45 | 16 | 25, 1.68M | 1.52M |

Side by side cost more than one at a time again ($1.43 against $1.34), so the recommendation stays.
The second one-at-a-time run cost most because it went round twice. Its first audit found a task no
requirement asked for, so product-owner and the architect revised and spec-auditor ran again. Then the
architect had excused a process rule inside a test task, "FR-001, FR-002, SC-002, FR-007 (No test: FR-007
is a process rule ...)". spec-gatekeeper rejected for FR-006 and FR-008 itself; test-writer's fix touched
`tasks.md`, which reopened the audit; and the drift check then refused the gatekeeper's APPROVED because
FR-007 was in neither test file, though the task excused it. test-writer added a `// 001 FR-007` comment
to each and the next gatekeeper approved. The same reading made the spec-level check of #235 excuse
every ID of that task, FR-001 and FR-002 with it. What it led to: on #278 a `No test:` now excuses the
ID it follows and those its reason names, at both levels, held by `test/drift.test.mjs`; replayed on
that run's repo, the refused state passes, and with FR-001's test lines removed both checks name FR-001.
Whether it removes the launches has not been seen in a run.

The sweep cost $18.70 in all, the lost runs included.

## The live runs of 2026-11-11

Three full runs on the owner's subscription, one at a time, from `main` at `b938625` with the personal
team reinstalled from the same commit (build `2c5919a81303`): Claude Code 2.1.322, Windows 11, main
session `sonnet`, the agents on their own `model:` lines. Two passed every check. The third, side by
side, was stopped by Claude Code 728 s in, when the machine ran critically low on memory, with both
implementers at work in their worktrees; it is not counted, and
[#114](https://github.com/PIsberg/speckit-agents/issues/114)'s comparison on one commit is still
missing.

| Run | Cost | Time | Agent launches | Main-session responses, input | All agents' input |
|---|--:|--:|--:|--:|--:|
| `--two-slices`, one at a time | $2.26 | 1,220 s | 15 | 25, 1.61M | 1.19M |
| `--skill-agents` | $0.63 | 431 s | 0 | 35, 2.41M | 0 |
| `--side-by-side`, stopped | not known ($0.17 for its first turn) | 728 s | 9 by then | 11, 0.63M by then | 0.91M by then |

What they say about step 0, the plan stop and the hand-on is in those three sections above. The rest:

- **Decisions ([#79](https://github.com/PIsberg/speckit-agents/issues/79)).** The fixture's one open
  decision was recorded with no architect or product-owner launch in both default-team runs. The
  architect's report ended with its `Round 1:` line, the first round went out in the response that
  read the audit PASS, with no `cat tasks.md` response before it, and both slices shared that round.
  One dictated revision (17 s, 19k tokens) came back done, not `needs revision`. In the
  `--skill-agents` run `sum()` was one slice, a test task and its implementation, not two.
- **First audit ([#42](https://github.com/PIsberg/speckit-agents/issues/42)).** PASS on the fixture's
  constitution in all three runs. There is still no arm without the architect's self-check, so what it
  costs when it has nothing to catch is not measured.
- **The one-at-a-time run went round the gate four times,** which is why it cost $2.26 where the same
  request cost $1.34 on 2026-11-08. spec-gatekeeper rejected 3 times before it approved; test-writer
  was launched 4 times and spec-auditor twice.
  1. The architect's test tasks T002 and T005 cited FR-005 (the two modules are independent) and
     FR-006 (tests first), and no test named either. REJECTED, correctly: on 2026-10-31 the same gap
     was approved (#228).
  2. The main session had the architect excuse FR-006 on T003 by a dictated edit, which voided the
     audit PASS and cost a second audit (111 s). The architect's report said T002 and T005 still cited
     FR-006; the session went on. The next spec-gatekeeper wrote APPROVED and **the hook's drift check
     refused it** at its Stop, naming T002 and T005, and the agent revised to REJECTED. This is the
     state #278 was meant to spare, with the excuse on another task than the ones that cite the ID.
     It was cleared by a comment naming `001 FR-006` in each test file, which holds nothing
     ([#299](https://github.com/PIsberg/speckit-agents/issues/299)). What it led to: an excuse on any task of the
     feature now holds for a test task that cites the same ID, as it already did at spec level, held
     by `test/drift.test.mjs`. Replayed on that run's repo at the refused commit (`b84706e`), the
     check passes; with the excuse taken out it names FR-006 three times, and with the `001 FR-001`
     lines taken out of `test/math.test.js` it names FR-001 twice. This spares the gatekeeper round
     and the comment, not the second audit, which the edit to `tasks.md` still costs: the architect
     is now told to excuse a rule of how the work is done on the task that carries it out, in the
     first `tasks.md`, and to cite it on no test task (pinned by `test/install.test.mjs`). Whether
     it does has not been seen in a run.
  3. test-writer's first FR-005 tests grepped the source for an import. REJECTED as an argument about
     structure, and replaced by tests that copy one module alone into a temporary folder and call it.
- **A test added after the code cannot be shown failing by test-writer.** Showing the FR-005 tests red
  means breaking `src/`, which test-writer's scope denies. test-writer ended on `BLOCKED` the first
  time, and on `RED` the last time for two tests that pass by design. The main session made the edit
  to `src/` itself, twice, saw both tests fail, and restored it. No rule said who does this
  ([#298](https://github.com/PIsberg/speckit-agents/issues/298)). What it led to: the skill sends such
  a reason to test-writer, which shows the test passing, names the production line to break and ends
  `FIXED`; the main session shows it failing in one Bash call that restores with
  `git checkout -- <file>` and ends on `git status --short`, and spec-gatekeeper gets that output
  or runs the break itself (the three halves are pinned by `test/install.test.mjs`). No hook holds
  the restore, and none of it has been seen in a run.
- **The stopped run left its trust entry and two locked worktrees behind**
  ([#260](https://github.com/PIsberg/speckit-agents/issues/260)): the undo runs in the tool's own
  process, which was killed with the session. The entry was removed by hand after the run.
- **From the owner's settings, not the team:** in the `--skill-agents` run a Read of
  `.claude/skills/speckit-specify/SKILL.md` was withheld, since a `--login` run loads the owner's
  `permissions.deny`. The session worked from the spec template and the run passed.

The three runs cost $2.89 as reported, the stopped run's second turn not included.

A fourth run the same day, `--login --two-slices` from `fix/298-late-test-shown-failing` at `0a8d0fb`
(the fixes for #298 and #299, not yet merged), failed at its 8-turn limit, $2.40, with no code written:

- **The audit could not be approved with two installs of the team**
  ([#304](https://github.com/PIsberg/speckit-agents/issues/304)). Three audits failed, each on a real
  finding that was fixed and committed. After each `audit --approve` the next launch was refused all
  the same: 5 refusals. A `--login` run has the team in `~/.claude` and in the project, Claude Code
  runs the launch gate once per install, and the first process spent the approval the second then
  missed. What it led to: the approval is kept by the launch's `tool_use_id`, held by a case in
  `test/e2e.test.mjs` that failed against Claude Code before the fix.
- **The session blamed its proxy.** The owner's proxy replaced the repeated refusal with "identical
  to the earlier tool result", so the session never quoted the hook and asked for the proxy's rule
  to be cleared. From the owner's setup, not the team; the transcript on disk had the hook's text.
- **The architect's first `tasks.md` excused the process rule** (#299): "Standard library only
  (constitution II; No test: no dependency added)" on the two implementation tasks, cited by no test
  task. 1 run, and none of the three audit findings was about it. The gate was never reached, so
  the drift check's half and #298 were not seen.

A fifth run, the same options from `fix/audit-approval-two-installs` at `38e9e16` (#304's fix),
passed: `APPROVED`, 2 turns, 22 model turns, $1.67, one audit `FAIL` then a `PASS`.

- **#304's fix was not exercised**: the count never reached two FAILs, so no approval was asked for.
  What holds it is the case in `test/e2e.test.mjs`, not this run.
- **`decisions --recommended` did not find options headed "Option A"**
  ([#306](https://github.com/PIsberg/speckit-agents/issues/306)). The architect wrote
  `- **Option A (recommended): ...`, the run before wrote `- **A (recommended): ...`, and no rule
  fixes either. The command changed nothing, the audit launched beside it was refused twice for open
  decisions, and the main session wrote the record by hand in 4 more calls. What it led to: the
  command reads both forms, and says "no option line found" when it reads neither.
- **The architect's first `tasks.md` excused the process rule here too** (#299): "FR-007 (No test:
  process rule, carried out by T001 running red first)". 2 of 2 runs with #302's rule; the one audit
  `FAIL` was about a test that could not fail on the stub, not about this.
- **#298 was not seen**: test-writer ran once, before the code.

A sixth run, `--login --side-by-side` from `main` at `a083bfc` (the six fixes above merged), passed:
`APPROVED`, 2 turns, 27 model turns, $1.79, one audit (`PASS`), two test-writers in one message, two
implementers in one message in worktrees, both branches merged with no conflict and no worktree left.

- **spec-gatekeeper rejected a test-first build for a break it could not run**
  ([#308](https://github.com/PIsberg/speckit-agents/issues/308)). #298's rule told it to "break it
  yourself" when the prompt shows no failing run. It tried, the hook denied the write, and it ended
  `REJECTED` with "no row below is shown to fail", although its own report listed the stub, the
  tests and the code as committed in that order. The main session ran the breaks in one call and the
  second verify approved: one gate round and one call for nothing. 1 of 2 runs with the rule. What
  it led to: the rule says a test committed before its code needs no such run, and that the gate
  breaks nothing itself.
- **Each worktree implementer ended `RESULT: RED` for the other slice's stubs**
  ([#309](https://github.com/PIsberg/speckit-agents/issues/309)). Both had `last round`, ran the
  full suite, and saw the sibling's tests fail on `not implemented`. The retry record held 2 of the
  3 REDs that lock implementer out; after the merge the suite was 14 of 14. What it led to: an
  implementer in a worktree runs its own tasks' tests and ends on them, and the main session runs
  the full suite after the last round's merge.
- **`decisions --recommended` met a third option form**
  ([#310](https://github.com/PIsberg/speckit-agents/issues/310)): a bold paragraph with no bullet,
  `**Option B (recommended): ...**`. The command changed nothing and said "no option line found"
  (#306's message). The record by hand took 3 calls, and one lost the backslashes of a spec line:
  the committed `spec.md` reads `'{10428}x'` where the plan has `'\u{10428}x'`. What it led to: the
  architect is told the form (`- **A (recommended): <option>**`, then `- **B: <option>**`), and the
  command reads the forms seen before the rule. Writing its test found a second fault: a bold list
  item under the recommended option was read as a new option, which ended the recommended one early
  and recorded the answer without applying its `Spec:` lines.
- **The architect's first `tasks.md` excused the process rules on the tasks that carry them out**
  (#299): FR-006 on T003 and T006, FR-007 on T002 and T005, and the audit passed first time. 3 of 3
  runs with #302's rule.

A seventh run, the same options from `fix/310-decisions-option-form` at `f19f77f` (the three fixes
above, not yet merged), passed: `APPROVED`, 2 turns, 18 model turns, $1.38 against $1.79.

- **The gate approved first time** (#308): one verify, no break asked for or tried.
- **`decisions --recommended` recorded the answer** (#310): the architect wrote `- **A (recommended):
  ...**` and `- **B: ...**` as its rule now says, and the command recorded D1 in the commit's own
  call. The audit passed first time.
- **Both worktree implementers still ended `RESULT: RED`** (#309). Each had the new rule in its body
  and "Run only `node --test <its file>`" in its prompt, ran `npm test` all the same, and reported
  RED for the other slice's stubs: 2 of 2, so the rule in the agent's body holds nothing. The skill's
  half held: the main session ran the suite at the end of the merge call, 12 of 12. What it led to:
  the skill never puts `last round`, the words that ask for the suite, in a worktree launch.

An eighth run, the same options from `fix/309-no-last-round-in-worktree` at `40c9f51` (that change
too), passed: `APPROVED`, 2 turns, 26 model turns, $1.84.

- **Both worktree implementers ended `RESULT: GREEN`** (#309): their launches carried `worktree`
  without `last round`, each ran its own test file only, no retry record was written, and the main
  session ran the suite after the merge, 12 of 12. 1 run, after 2 of 2 failing without the change.
- **The audit failed once, on a real fault**: the plan's FR-003 check (the input is not modified)
  could never be seen failing against the stub. One architect revision, then `PASS`.
- **The gate rejected once, for two IDs no test named**
  ([#315](https://github.com/PIsberg/speckit-agents/issues/315)): T001 cited FR-007 and FR-009,
  test-writer tagged neither, and the drift check runs only at the gate. The fix took a test-writer
  launch, a break-and-restore call and a second verify. What it led to: the hook runs the task half
  of the drift check when test-writer stops and sends a missing ID back to it once. The gate broke nothing itself and took the
  commit order for the red run (#308, 2 of 2 runs).
- **The fix round went as #298's rule says**, for the first time in a run: test-writer changed test
  names only, named the production line that fails the kept `add` test (`src/math.js:2`), broke
  nothing and ended `FIXED`; the main session broke that line, ran the test (1 fail, `actual: -1,
  expected: 5`), restored with `git checkout` and ended on an empty `git status --short`, all in one
  Bash call; spec-gatekeeper got that output, ran `git status --short` itself and approved. 1 run.
- **The cost is not comparable with the run before**: $1.84 against $1.38, with an audit round and a
  gate round more.

Two more runs, the first pair on one build of the team (`fix/316-cited-ids-test-writer-role` at
`e14efc9`, the same two-function request, one after the other), for
[#114](https://github.com/PIsberg/speckit-agents/issues/114)'s comparison. Both passed with
`APPROVED`, the audit `PASS` first time and no fix round.

| | `--two-slices` (one at a time) | `--side-by-side` |
|---|--:|--:|
| Cost | $1.26 | $1.37 |
| Agent launches | 7 | 9 |
| Main-session responses | 12 | 15 |
| Main-session input | 0.68M | 0.89M |
| First red launch to the verify launch | 1 min 32 s | 1 min 53 s |
| Whole run | 7 min 14 s | 10 min 0 s |

- **Side by side cost 9% more and saved no time** on this request, 1 run each. The whole-run times
  are not the build's: product-owner alone took 59 s in one and 3 min 21 s in the other.
- **One at a time was one round, not two**: the main session gave both slices' test tasks to one
  test-writer and both implementation tasks to one implementer, so "one at a time" had 2 build
  launches against 4, and nothing was left for side by side to save. A request whose slices are too
  large for one agent each is not measured.
- **Both worktree implementers ended `RESULT: GREEN`** (#309), 2 of 2 runs with the change.
- **The cited-ID check (#315) had nothing to catch** in either run: no send-back, no message.

A tenth run, `--login` with the default one-function request, from `main` at `a4771d0` (all eight
fixes of the day merged), passed every check: `APPROVED` from the hook record, the audit `PASS`
first time, 12 of 12 tests.

| Cost | Time | Agent launches | Main-session responses, input | All agents' input |
|--:|--:|--:|--:|--:|
| $1.42 | 741 s | 9 | 13, 0.76M | 0.83M |

- **The cited-ID check (#315) fired for the first time with real models, and held.** test-writer's
  `FIXED` named FR-001, which its ticked task cites, in no test. The hook sent it back once,
  test-writer added `// 001 FR-001` as a comment in 27 s, and spec-gatekeeper approved first time
  with that comment's line in its table. 1 run.
- **One launch was lost to a test that cannot be red**
  ([#321](https://github.com/PIsberg/speckit-agents/issues/321)). The task told test-writer to
  cover FR-001 (`sum` is exported by name). The stub already exports it, so the `typeof` test
  passed, test-writer ended `BLOCKED` after 2 min 37 s, and the main session launched it again to
  drop the test (68 s). spec-auditor had said so in a MEDIUM finding of its `PASS`, with the fix;
  a `PASS`'s findings reach nobody. 2 of the 9 launches were corrections: this one and
  product-owner's revision for the one question it asked.
- **The run left nothing behind**: no trust entry, no ledger file (#260), no worktree.

Every paid run still owed is listed in
[#322](https://github.com/PIsberg/speckit-agents/issues/322).
