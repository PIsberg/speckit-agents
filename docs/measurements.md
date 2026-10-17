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
rules in "4-5. Red and green" of [the skill](../skills/speckit-team/SKILL.md). Not checked: a real
main session following them, and what side by side saves against what it costs
([#114](https://github.com/PIsberg/speckit-agents/issues/114)).

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
