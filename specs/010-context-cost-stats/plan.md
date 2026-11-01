# Implementation Plan: Token, Cost and Context Stats on the Board

**Branch**: `263-context-cost-stats` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

## Summary

The board mod (`mods/speckit-board/`) draws the session's context use, tokens and cost in its three
places: the band above the prompt (a context bar, tokens, cost, a cost bar), the pane (the same, two
rows, plus each team agent's figures) and the `/speckit-board status` answer (one `stats:` line). One
pure function, `statsView()` in `hooks/model.ts`, turns the session's figures into the texts all three
draw, so they agree by construction (FR-005). The figures come from the plugin API the mod already
runs on; nothing new is measured, stored or sent.

## Technical Context

**Language/Version**: TypeScript (TSX) run by Claude Code as a mod; no build step (constitution IV).

**Primary Dependencies**: the plugin API only. The figures, by the type names in the API's declarations
(`mods/speckit-board/.claude-plugin/types/claude-code/index.d.ts`, laid by Claude Code at load):
- `$.session.usage()` answers `SessionUsage`: `context` (`SessionContextUsage`: `percent`, `tokens`,
  `window`; `percent` absent until the live window's first response, so on a fresh or just compacted
  session), `cost?` (`SessionCost.usd`, "absent only where the host keeps no cost ledger (the CLI
  always has one)") and `rateLimits` (`SessionRateLimit.kind`: `five_hour`, `seven_day`, a gateway's
  `spend_limit`; empty off a subscription). The plain call makes no request (FR-010).
- `turn.complete`'s input (`TurnCompleteInput`) carries `usage?` (`TurnUsage`: `model` and
  `ModelUsage`'s four counts, summed over the turn's requests) and `agentId` (absent on the main loop;
  the `agent_id` `classic.SubagentStart` gives, which `SpeckitAgent.id` holds).
- Nothing in the API gives a cumulative token count or a cost per agent (`AgentInfo` has neither).
- Claude Code 2.1.293, CI's oldest supported (`package.json` `config.claudeCode`), has both: its
  npm binary (`@anthropic-ai/claude-code-win32-x64@2.1.293`) lists the `session.usage` op and passes
  `usage` and `agentId` on `turn.complete` (string search of the binary, 2026-11-01, not run).

**Storage**: none new. The stats live in the mod's session state (`PluginState`), never in the store
or on disk (data-model.md).

**Testing**: `claude-code/testing` through `claude plugin test mods/speckit-board`, which `npm test`
runs in `test/board-mod.test.mjs` ("the board mod's own tests pass under claude plugin test").

**Target Platform**: Claude Code on Windows, macOS and Linux; no platform-specific code.

**Performance Goals**: no work added to any tool call; on `turn.complete` nothing is awaited (budget
below).

**Scale/Scope**: 3 source files of the mod (`types/index.d.ts`, `hooks/model.ts`,
`hooks/register.tsx`), its 2 test files, README.md, docs/rules.md, CLAUDE.md.

## Constitution Check

| Rule | Tasks | How |
|---|---|---|
| I. Test-First: a test in `test/` under `npm test`, seen failing, asserting what a caller observes | T002, T005, T008, T010, T012 | each precedes its implementation; the mod's tests run under `npm test` through `test/board-mod.test.mjs`; they assert texts drawn, items laid out, the command's answer |
| II. Hook entry points handle all input without throwing; a path that can throw has a test | T002, T005, T010 | malformed usage answers and turn usage, a rejecting `$.session.usage()` |
| III. Observers never block; a failure is visible; overhead within a stated budget | T010, T011 | turn.complete's result unchanged and not delayed by a hanging read; a failed read, or one still pending a poll later, shows `context n/a` in the band; a refused `stats` write is toasted; budget below |
| IV. Plugin API only, no runtime dependency | T003, T006, T009, T011, T013 | `$.session.usage()` and `turn.complete` only, present in 2.1.293 (Technical Context) |
| V. Public contracts change additively, listed in the README | T009, T014 | `/speckit-board status` gains a last line; no event is emitted, so no schema version applies |
| VII. Every supported platform | T010, T012 | no platform code; the mod's tests run on all three in CI |
| VIII. README and CLAUDE.md describe it; docs say what was verified live | T014 | board section, Known limits, Verified; the mod's `claude plugin test` count (132 today, README.md "Verified" and "Test suite") as the run reports it with T002, T005, T008, T010, T012's tests; CLAUDE.md's mod line |

Not applicable: II's live check of hook wiring (no new `on()` entry: T011 reuses the `turn.complete`
hook and the 4 s poll); VI (no event emitted, nothing stored; T010 checks no store or file write);
Installation Constraints (installer and its files unchanged); installer help text (no flag changes);
Authoring Skills and Agents (no skill or agent changes); Workflow gates (run by spec-gatekeeper and
the main session); Governance (no amendment).

**Observer budget (III)**: 0 added per tool call (the stats hook no tool event). Per turn end, the
`turn.complete` hook starts the stats work without awaiting it and returns `next(e)` as today; the
work is two state updates and one `$.session.usage()` read, none started while one is pending
(FR-010); a read pending for `POLL_MS` or longer counts as failed until it answers (III).

## Design

- **State**: `stats` in the mod's session state and `usage` on each team agent row (data-model.md).
- **Reading** (`hooks/register.tsx`): `measure($)` reads `$.session.usage()` into `stats` through
  `readUsage()`, unawaited, at session start, at every 4 s poll and after each `turn.complete` (D6);
  the `turn.complete` hook adds `e.usage` to the session's and, by `e.agentId`, to that team agent's
  counts through `addUsage()` (D2, D3). A read that hangs or a `stats` write that is refused is
  shown, not swallowed (constitution III; T011).
- **Cost bar** (`hooks/model.ts: costBar`): one 10-cell text drawn in the band, the status answer and
  the pane alike, so the drawn fill agrees in all three (FR-005, D10).
- **Rules** (`hooks/model.ts: statsView`): context, tokens and cost as data-model.md "Rules" and D1;
  texts, bars, marks, the band's shedding (D5), the pane rows and the status line as
  `contracts/stats-text.md`.
- **Callers keep working**: `bandLayout()` and `boardText()` take the view as an optional last argument;
  without it they answer exactly as today (FR-012). `register.tsx` always passes it.
- SC-003 is a hand check (`quickstart.md`, D9). CI's `live-board` job still runs
  `tools/live-board.mjs`, whose L3 (all three band buttons at 140 columns) holds because the stats
  give way first (D5).

## Project Structure

```text
specs/010-context-cost-stats/
├── plan.md, spec.md, tasks.md
├── data-model.md            # stats state, price table, rules
├── contracts/stats-text.md  # the texts the band, pane and status answer draw
└── quickstart.md            # SC-003 and the D1/D6 assumptions, by hand

mods/speckit-board/
├── types/index.d.ts         # SpeckitUsage, SpeckitStats, SpeckitAgent.usage, PluginState.stats
├── hooks/model.ts           # PRICES, priceOf, estimateUsd, addUsage, readUsage, statsView, agentStats,
│                            #   shortCount, dollars; bandLayout and boardText take the view
├── hooks/register.tsx       # stats atom, measure, turn.complete, band, pane, status
└── tests/model.test.ts, tests/board.test.tsx
README.md, docs/rules.md, CLAUDE.md
```

## Complexity Tracking

None.

## Decisions

### D1: Is a cost the CLI reports on a subscription login marked `est.`?

Answer (2026-11-01): A, as recommended

The CLI always reports `cost.usd` (Technical Context), priced from list rates, also on a subscription,
where nothing is billed per token. Read literally, FR-004 shows it bare, so a subscriber sees a
billed-looking figure, which the clarification of 2026-11-01 asked to avoid.

- **A (recommended)**: mark the reported cost `est.` when the session reports a `five_hour` or
  `seven_day` rate-limit window (a subscription); show it bare otherwise. The estimate from tokens
  (D4) runs only where no cost is reported. Before the first response no window is reported, so a
  subscription's `$0.00` shows bare until then. A gateway's `spend_limit` alone does not count.
  Changes T005, T006.
  Spec: FR-004: A cost the session reports MUST be shown as reported, and with the word `est.` beside
  it when the login is a subscription (the session reports a `five_hour` or `seven_day` rate-limit
  window), whose cost is priced, not billed. When the session reports none, the cost MUST be estimated
  from the token counts and the model's list price and shown with `est.`, and an estimate MUST never
  be shown without that mark. Any other unknown figure, and a cost with no reported value and no known
  price, MUST show as `n/a`, never as zero.
  Spec: US2-4: **Given** an API-key session reports a cost, **When** the band is drawn, **Then** the
  reported cost is shown without `est.`, and no estimate replaces it; on a subscription the same
  reported figure carries `est.`.
  Spec: SC-006: In every sampled state where the session reports no cost or the login is a
  subscription, the cost shown carries `est.` or is `n/a`; where an API-key session reports a cost, the
  figure equals the reported one and carries no `est.`, in 100% of the sampled states.
- **B**: FR-004 as written: a reported cost is always bare. In the CLI the estimate path never runs
  for the session total; subscribers see a bare dollar figure. No spec change; T005 drops the
  subscription cases.

### D2: Is a team agent's cost always an estimate?

Answer (2026-11-01): A, as recommended

The API reports no cost per agent, so FR-007 and US4-3 ("Given the session reports no cost...") leave
the agent's cost undefined whenever the session does report one, which in the CLI is always.

- **A (recommended)**: an agent's cost is always its tokens at list price, marked `est.`; `n/a` when
  it has no usage or an unpriced model. Where managed `modelPricing` differs from list price, the
  agents' sum can exceed the session's reported total, against US4-1's "not less than their sum".
  Changes T005, T006, T012, T013.
  Spec: FR-007: The pane MUST show, for each team agent that has run, its own tokens and its cost
  estimated from them at list price and marked `est.` (the session reports no cost per agent); other
  unknown figures show `n/a`.
  Spec: US4-3: **Given** an agent's tokens and its model's price are known, **When** its row is
  drawn, **Then** its cost is estimated and marked `est.`, whether or not the session reports its own
  cost.
- **B**: show an agent's cost only where the session reports none; in the CLI the rows show tokens
  and no cost, so US4's value (which role spends most) rests on tokens. Spec: FR-007 drops the cost.

### D3: What do the token counts count?

Answer (2026-11-01): A, as recommended

No API figure totals tokens, so the mod sums `turn.complete`'s `usage`, for the main loop and every
agent, from when it loads. US2-1's `1.2M in` beside `$0.78` only fits a count that includes cache
reads.

- **A (recommended)**: `in` = uncached input + cache reads + cache writes, `out` = output, summed per
  model from every `turn.complete` since the mod loaded. They restart at a mod reload, `/clear` or a
  resume, while the reported cost counts from the session's start (`SessionUsage.startedAt`); the main
  session's own tokens move when its turn ends, and a whole `/speckit-team` run is one turn. Changes
  T002, T003, T005.
  Spec: FR-003: The band MUST show the session's input tokens (uncached, cache-read and cache-written
  together) and output tokens, counted from the turns since the board loaded, in a short form (`k`,
  `M`), and its cost in dollars with two decimals.
  Spec: Edge case (resumed session): A session resumed from an earlier one: context and cost are those
  the session reports; token counts start at the board's load; the board does not invent a total
  across sessions.
- **B**: `in` = uncached input only. A cached run reads `12k in` beside a cost of dollars; the
  estimate still prices cache counts. Spec: FR-003 says "uncached input tokens".

### D4: Which prices does the estimate use?

Answer (2026-11-01): A, as recommended

The estimate needs a price per model; the API exposes none to a mod. data-model.md "Price table"
copies Anthropic's pricing page (fetched 2026-11-01): 20 rows, four rates each.

- **A (recommended)**: the table as data-model.md lists it, matched on the normalised model id
  exactly (an unlisted id is unpriced, never matched to a sibling). Cache writes at the 5-minute rate
  (the usage does not split 5-minute from 1-hour writes, which cost 1.6 times as much); Haiku 5.5 at
  its over-100k rate, as usage summed over a turn cannot tell the tiers apart and the higher rate never
  under-reads; no long-context premium. A new model shows `n/a` until a row is added. Changes T002,
  T003.
- **B**: Haiku 5.5 at its up-to-100k rate (one fifth): lower estimates for agents on Haiku 5.5.
- **C**: only the four current models' rows (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5): an older
  model in a session shows `n/a`.

### D5: Where do the stats give way on a short band?

Answer (2026-11-01): A, as recommended

FR-008 orders the stats among themselves, not against the band's own items (phase names, task bar,
buttons).

- **A (recommended)**: the stats shed first, tokens, cost bar, cost, leaving the context item; then
  the band sheds its own items as today with the context item kept; the context item goes only in the
  narrowest form (`only-head`). 12 variants instead of 8 (contracts/stats-text.md "Band"). The
  context item (up to 22 columns) makes the buttons drop sooner than today by that much. Changes T008,
  T009.
  Spec: FR-008: On a terminal of 60 columns the band MUST keep its existing line count and drop, in
  order, the token counts, then the cost bar, then the cost figure, before any of its existing items;
  the context bar is dropped last, only where the band's narrowest form does not fit with it.
- **B**: all four stats items shed before any existing item: the band is today's at every width
  where it does not fit with the stats, and the context bar is gone wherever the richest band no
  longer fits, against FR-001 on narrower terminals (not measured). Spec: FR-008 likewise, with "before
  any of its existing items" covering the context bar.

### D6: How often do the figures refresh?

Answer (2026-11-01): A, as recommended

FR-006 asks for a refresh after every model response. The API gives the session's figures per turn
(`turn.complete`, and `session.measure` "after each main-thread turn") or per response only through
`turn.step`, a streaming hook every response's chunks pass through.

- **A (recommended)**: context and cost from `$.session.usage()` at every 4 s poll and every turn end;
  tokens at every turn end (D3). Mid-turn context and cost lag at most 4 s, if `$.session.usage()`
  moves mid-turn as the status line does (quickstart.md checks it). Changes T010, T011.
  Spec: FR-006: The figures MUST refresh without a user command: context use and cost within the
  board's 4-second poll and after every turn, token counts after every turn of the session and of each
  agent's run.
- **B**: a `turn.step` hook that reads each response's usage: per-response tokens, at the cost of a
  hook on every stream (a wiring change, so a live check under constitution II) and a measured
  per-response budget under III. No spec change; adds a task.

### D7: Which existing tests may change?

Answer (2026-11-01): A, as recommended

The stats add a `stats:` line to every status answer with a board and 3 rows to the pane, so tests
pinning the whole answer or the pane's height fail with any honest implementation.

- **A (recommended)**: those pins change by exactly the stats' line or rows, and no other assertion
  changes: `tests/board.test.tsx` :220, :223, :1225, :1228 (pane rows, +3) and the whole status
  answers at :1267, :1328, :1338 (T010, T012). `tests/model.test.ts` is unchanged, since
  `bandLayout()` and `boardText()` without the view answer as today.
  Spec: FR-012: The README's board section and `docs/rules.md` MUST describe the stats, and the
  board's existing tests MUST keep passing with the stats present; a test that pins the pane's height
  or the whole status answer changes by the stats' rows or line alone.
- **B**: show the stats in the pane and status only once a figure is known, so the pinned tests
  (whose world answers no usage) stay as they are; the band still shows `context n/a` (US1-4), and the
  three places disagree on an unknown state, against FR-005.

### D8: Where in `docs/rules.md` do the stats go?

Answer (2026-11-01): A, as recommended

`docs/rules.md` lists the skills' and agents' rules, and `test/rules.test.mjs` fails on a `###` entry
naming no prompt section.

- **A (recommended)**: a `## Board stats` section, a table of each stats rule and the test that holds
  it, placed before `## skills/speckit-team/SKILL.md`, where the test reads no entry. Changes T014.
- **B**: leave `docs/rules.md` alone, as it covers prompts only. Changes T014.
  Spec: FR-012: The README's board section MUST describe the stats, and the board's existing tests
  MUST keep passing with the stats present (with D7-A: a test that pins the pane's height or the
  whole status answer changes by the stats' rows or line alone).

### D9: How is SC-003 checked?

Answer (2026-11-01): A, as recommended

SC-003 asks for the band read in a recorded session. No requirement asks for an automated check.

- **A (recommended)**: by hand, `quickstart.md`, before merge; README's Verified says so until then.
  No task.
- **B**: add an L6 check to `tools/live-board.mjs` (the band shows `%`, `in`, `out` and `$`) and its
  case in `test/live-board.test.mjs`: one more slice; its fake API reports a `claude-fake` model, so
  the cost reads as the CLI prices it.
- **C**: also re-record `docs/media/board.png` with the stats: one more task, no test.

### D10: How many cells does the cost bar draw, and how does it round?

Answer (2026-11-01): A, as recommended

`bar()` (`hooks/model.ts:259`) rounds to its cells, so a 5-cell band bar draws $2.50 as 3 of 5 and
the pane's `barWidth` bar (6 to 24) as 12 of 24: US2-6's "half filled" fails in the band and FR-005's
"same cost-bar fill" fails between band and pane. No cell count under 50 draws every cost within
SC-007's 1 pp.

- **A (recommended)**: one `costBar(fill)` of 10 cells, a cell for each whole tenth of the reference
  reached (`fill` rounded to 3 decimals, then floored, so an estimate summing to 0.79999 draws 8),
  drawn as the same text in the band, the status answer and the pane. Sampled costs draw 0, 5, 8, 9,
  10 and 10 of 10: half at $2.50 (US2-6), full only at the reference (US2-8); $4.75 draws 9 (90%, 5 pp
  under), so SC-007's 1 pp is the view's `fill`. The band's cost part grows from 5 to 10 columns plus
  its mark, so it sheds 5 columns sooner (D5's order unchanged). The pane's cost row draws 10 cells
  while its context row keeps `barWidth`. Changes T004, T005, T006, T009, T013;
  contracts/stats-text.md "Figures", "Band", "Status answer", "Pane"; data-model.md "Fill".
  Spec: FR-013: Beside the cost the band MUST show a cost bar of 10 cells, full at a fixed reference
  of $5.00 for the session, one cell filled for each whole 10% of the reference the cost reaches (so
  full only at or above it), and marked high at or above 80% and critical at or above 95% of the
  reference with a word or symbol as well as any colour. The bar is drawn from a reported or an
  estimated cost (the estimate keeps `est.`) and is omitted when the cost is `n/a`. The reference is a
  scale, not a budget: it stops and alerts nothing.
  Spec: SC-007: In the sampled costs ($0, $2.50, $4.00, $4.75, $5.00, $9.00), the cost bar's fill
  (cost divided by $5.00, capped at full) is within 1 percentage point of that ratio, the bar draws
  0, 5, 8, 9, 10 and 10 of its 10 cells, the same cells in the band, the pane and the status answer,
  its mark is none, none, high, critical, critical, critical, and the same holds for an estimated
  cost, in 100% of the sampled states.
- **B**: one 20-cell bar through `bar()` as it rounds, in all three places. Sampled costs draw 0, 10,
  16, 19, 20 and 20 of 20, exact, so no spec line changes. The band's cost part grows from 5 to 20
  columns, so it sheds 15 columns sooner, and the pane's cost row draws 20 cells. Changes the same
  tasks and files as A.
- **C**: keep 5 band cells and the pane's `barWidth`, and measure the fill on the view only. $2.50
  draws 3 of 5 in the band and 12 of 24 in the pane, so the drawn bars disagree. Changes no task.
  Spec: US2-6: ... beside the cost it shows a cost bar whose fill is one half (full at the $5.00
  reference), drawn to the bar's nearest cell, and the text `$2.50`.
  Spec: FR-005: The band, the pane and the status answer MUST show the same percentage, token counts,
  cost and cost-bar fill for the same state, the fill read before a bar rounds it to its cells.

### D11: At 70 columns, does the context item or the other phases' glyphs give way?

Answer (2026-11-01): A, as recommended

`tests/board.test.tsx` "the band names the current phase at any width" (:151-164) mounts the band at
70 columns with `implementer` running and `RED 1/3`, and :160 expects 4 bare `✓`. That state's
existing variant 7 is 61 columns; the context item (`│`, `context n/a`, their gaps) makes it 75, so
under D5-A the band falls to `only-head` with the context item (63) and draws no bare `✓` (audit
H1). D7-A lets no such assertion change, so D5-A and FR-012 cannot both hold.

- **A (recommended)**: keep D5-A as the owner answered it; :160 changes from 4 bare `✓` to none and
  nothing else in the test does: `◐ build` named (:158), `✓ spec` absent (:159) and the agent's text
  (:161) hold, so the test still checks what its title says. Beside a docked pane, while an agent
  runs, the band keeps the context bar (FR-001) and names only the current phase. Changes T010.
  Spec: FR-012: The README's board section and `docs/rules.md` MUST describe the stats, and the
  board's existing tests MUST keep passing with the stats present; a test that pins the pane's
  height or the whole status answer changes by the stats' rows or line alone, and one that counts the
  band's other phases' glyphs at a width where the context item displaces them changes by that count
  alone.
- **B**: the context item gives way after the buttons and before the other phases' glyphs:
  contracts/stats-text.md "Band" steps 5 to 10 are existing variants 2 to 7 with `context` alone, 11
  is variant 7 without stats, 12 variant 8 without stats (still 12 variants), and `only-head` never
  carries the context item. The test holds unchanged; in its state the band shows no context bar from
  61 to 74 columns, the width beside a docked pane, whenever an agent runs, which FR-001 then no
  longer covers there. Changes T008, T009, contracts/stats-text.md "Band", D5's record.
  Spec: FR-008: On a terminal of 60 columns the band MUST keep its existing line count and drop, in
  order, the token counts, then the cost bar, then the cost figure, before any of its existing items;
  the context bar is dropped after the band's buttons and before the other phases' glyphs.
