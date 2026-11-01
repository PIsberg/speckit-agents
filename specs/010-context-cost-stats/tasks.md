---
description: "Tasks for feature 010: token, cost and context stats on the board"
---

# Tasks: Token, Cost and Context Stats on the Board

**Input**: `specs/010-context-cost-stats/` (plan.md, spec.md, data-model.md, contracts/stats-text.md)

**Tests**: required (constitution I). Each slice's test tasks precede its implementation. Paths are
under `mods/speckit-board/` unless they start at the repository root. Line numbers are as of
2026-11-01, for finding the place, not for pinning.

Shared references:
- Mod tests import from `../hooks/model` as `tests/model.test.ts` does at :3, and use
  `claude-code/testing: test, expect, mock`.
- `tests/model.test.ts` helpers: `board` :136, `standalone` :319, `SLICE` :143, `widthOf` :236,
  `phaseTexts` :237.
- `tests/board.test.tsx` helpers: `world` :23 (answers ops as `on('store.get', ...)` does at :42;
  counts `storeWrites`), `poll` :99, `around` :119, `stop` :125, `finish` :562, `mountBand` :574,
  `mountPane` :576, `STATUS` :993, `start` :996, `cmd` :1255.
- An op the world does not answer throws at the bottom (`claude-code/testing`, "the bottom hook
  throws, naming its event"), so `$.session.usage()` there rejects unless a test answers it.

## Round 1: the figures and their texts (`hooks/model.ts`)

### Phase 1: Prices and the estimate (US2)

- [X] T001 [US2] Stub in `types/index.d.ts`: `export type SpeckitUsage = Record<string, ModelUsage>`
  (`import type { ModelUsage } from 'claude-code'`). Stub in `hooks/model.ts`:
  `export type Price = { input: number; cacheWrite: number; cacheRead: number; output: number }`,
  `export const PRICES: Readonly<Record<string, Price>> = {}`,
  `export function priceOf(model: string): Price | undefined`,
  `export function estimateUsd(usage: SpeckitUsage): number | undefined`,
  `export function addUsage(sum: SpeckitUsage, turn: unknown): SpeckitUsage`.
- [X] T002 [US2] Tests in `tests/model.test.ts` for `priceOf`, `estimateUsd`, `addUsage`: FR-004, the
  edge case "token counts present but the model is unknown", SC-004. Not settled by the spec: the
  matching and the rows of data-model.md "Price table" (a dated, a Bedrock and a Vertex id; a key
  never matching a longer sibling or an unlisted id, D4); each of the four counts at its own rate
  (D3); one unpriced model, and empty usage, give `undefined`; a malformed turn (no model, a
  negative, non-finite or non-number count, `null`) leaves the sum unchanged and unmutated.
- [X] T003 [US2] Implement `PRICES`, `priceOf`, `estimateUsd`, `addUsage` in `hooks/model.ts` as
  data-model.md "Price table", "Matching", "Estimate" and "Reading" give them.

### Phase 2: The view of the figures (US1, US2, US4)

- [X] T004 [US1] Stub in `types/index.d.ts`: `SpeckitStats` as data-model.md "Types";
  `SpeckitAgent` gains `usage?: SpeckitUsage`. Stub in `hooks/model.ts`: `export const
  COST_REFERENCE = 5`, `HIGH = 0.8`, `CRITICAL = 0.95`, `export const NO_STATS: SpeckitStats`,
  `export type Mark = '' | 'high' | 'critical'`,
  `export type Meter = { text: string; fill?: number; mark: Mark }`,
  `export type StatsView = { context: Meter; detail: string; tokens: string; cost: Meter }`
  (`detail`: the pane's `100k of 200k`, `''` when unknown),
  `export function readUsage(raw: unknown, before: SpeckitStats): SpeckitStats`,
  `export function statsView(s: SpeckitStats): StatsView`,
  `export function agentStats(usage: SpeckitUsage | undefined): string`,
  `export function shortCount(n: number): string`, `export function dollars(usd: number): string`,
  `export function costBar(fill: number): string` (D10).
- [X] T005 [US1] Tests in `tests/model.test.ts` for `readUsage`, `statsView`, `agentStats`,
  `shortCount`, `dollars`, `costBar`: US1-1 to US1-4, US2-1, US2-3 to US2-9, US4-2, US4-3, FR-001 to FR-004,
  FR-007, FR-013, SC-001, SC-004, SC-006, SC-007, and the edge cases on above 100%, compaction,
  zero cost and large numbers. Not settled by the spec: the `0%` rule and the
  `n/a` after spending (data-model.md "Rules"); a subscription's reported cost marked `est.` and a
  `spend_limit` window alone not (D1); an agent's cost always `est.` (D2); `fill` unrounded and
  capped, the mark on the uncapped ratio (data-model.md "Marks", "Fill"); the count and dollar bounds
  in contracts/stats-text.md "Figures" (999, 1,000, 9,950, 999,950, $9,999.99, $10,000); a
  malformed `SessionUsage` keeping `usage` and `isSubscription`; `costBar`'s cells at SC-007's
  sampled costs and a fill just under a tenth by float error (data-model.md "Fill", D10).
- [X] T006 [US1] Implement `NO_STATS`, `readUsage`, `statsView`, `agentStats`, `shortCount`,
  `dollars`, `costBar` in `hooks/model.ts`, using T003's `estimateUsd` and `bar` (:259) for
  `costBar`'s cells, as data-model.md "Reading" and "Rules" and contracts/stats-text.md "Figures"
  give them.

### Phase 3: Band and status text (US3)

- [X] T007 [US3] Stub in `hooks/model.ts`: `BandItem` (:371) gains
  `| { kind: 'stat'; part: 'context' | 'tokens' | 'cost' | 'costbar'; text: string; mark: Mark }`;
  `bandLayout(b, running, now, cols, stats?: StatsView)` (:403) and
  `boardText(b, running, now, stats?: StatsView)` (:348) take the view as an optional last argument.
- [X] T008 [US3] Tests in `tests/model.test.ts` for `bandLayout` and `boardText` with a view from
  `statsView`: US3-2, FR-001, FR-005, FR-008, FR-012, FR-013, SC-005. Not settled by the spec: the
  parts' place and the shedding in contracts/stats-text.md "Band" (D5, 19 steps since its revision), at 135, 100, 80, 60,
  45 and 30 columns, `widthOf` within the columns and the current phase named in each; without a
  view both functions answer as today; the status line in contracts/stats-text.md "Status answer",
  equal to the band's four parts' texts.
- [X] T009 [US3] Implement in `hooks/model.ts`: `VARIANTS` (:385) crossed with a stats level as
  contracts/stats-text.md "Band" lists, the four `stat` items through one internal helper shared by
  `bandLayout` and `boardText`, the context bar from `bar` (:259), the cost bar from T006's
  `costBar`; `widthOf` (:400) counts a `stat` item by its
  text.

## Round 2: live figures in the band, the status answer and the pane (`hooks/register.tsx`)

### Phase 4: Band and status answer, read from the session (US1, US2, US3)

- [X] T010 [US1] Tests in `tests/board.test.tsx`: US1-1, US1-3, US1-4, US2-1, US2-2, US3-1 (band and
  status), US3-3, US3-4, FR-005, FR-006, FR-009, FR-010, FR-011, SC-004. Not settled by the spec: the
  world answers `session.usage` per test (a `SessionUsage`, a rejection, a promise that never
  settles) and is the bottom of `turn.complete` (`({ text: e.answer, ...(e.usage && { usage:
  e.usage }) })`, as Claude Code's core answers it), raised with `$.turn.complete({ turnId, answer,
  durationMs, isAborted, reason: 'answer', usage, agentId })`; a new figure after the 4 s poll and
  after a turn (D6); with a never-settling read the `turn.complete` result is the bottom's and
  resolves; a `session.usage` read still pending a poll (`POLL_MS`, register.tsx:12) later shows
  `context n/a` in the band and the status answer, and its late answer is then drawn (constitution
  III); a refused `stats` write, from the poll and from `turn.complete`, is toasted once until a
  write succeeds, as "a refused isCleared write is toasted" does (constitution III); a malformed turn
  usage changes no count; no `storeWrites` and no `fs.write` from the
  stats; no `.specify/` gives the notice and no `stats:` line. Update the pins on a whole status
  answer (:1267, :1328, :1338) by the `stats:` line alone (D7), and in "the band names the current
  phase at any width" (:151-164) only :160, from 4 bare `✓` to none: at 70 columns the context item
  displaces the other phases' glyphs (D5, D11); :158, :159 and :161 stay.
- [X] T011 [US1] Implement in `hooks/register.tsx`, and in `types/index.d.ts` `PluginState
  ['speckit-board']` gains `stats: SpeckitStats`:
  `const stats = atom({ plugin: 'speckit-board', key: 'stats' } as const, NO_STATS)` beside the
  atoms (:17-24); `measure($)`: `$.session.usage()` through `readUsage` into `stats` with
  `update`, a rejection as `readUsage(undefined, s)`; no second read while one is pending (FR-010),
  but a call that finds one pending since `POLL_MS` (:12) or longer, by `$.clock.now()`, writes
  `readUsage(undefined, s)` so the band shows `context n/a` until the read answers (constitution
  III); started unawaited from `session.start` after `refresh` (:314), from `poll` (:228) and after
  each turn; the `turn.complete` hook (:404), when `repo` is set, starts unawaited `addUsage` of
  `e.usage` into `stats.usage` and, where `e.agentId` is a row's `id` in `agents`, into that row's
  `usage`, then `measure`, and returns `next(e)` as today; a refused `stats` write there or in
  `measure` is toasted (`board could not update the stats: <message>`, the form of :355-358) once
  until a write succeeds, so a lasting refusal does not toast every 4 s; the band
  (:409) passes `statsView(await read($, stats))` to `bandLayout` and draws a `stat` item as a
  `Text` in its mark's color (contracts/stats-text.md "Band"); `/speckit-board status` (:345)
  passes it to `boardText`. No new `on()` entry (plan.md, Constitution Check II).

### Phase 5: The pane's stats and each agent's figures (US3, US4)

- [X] T012 [US4] Tests in `tests/board.test.tsx`: US3-1 (pane), US4-1 to US4-3, FR-005, FR-007,
  SC-002. Not settled by the spec: the two rows and the agent row text of contracts/stats-text.md
  "Pane", with figures equal to the band's and the status answer's in one state; an ended row's
  figures after its dim text, with `around`'s `then` unchanged; a running row none; a row with no
  usage `n/a`; agents from `finish` and `stop` with usage raised by `$.turn.complete({ agentId })`
  (D2); the standalone pane shows the rows. Update the pane-row pins (:220, :223, :1225, :1228) by 3
  (D7).
- [X] T013 [US4] Implement in `hooks/register.tsx`: in the Pane hook (:447) the two stats rows after
  the phases Box (:508-530), the context bar of the existing `barWidth` (:484), the cost bar
  `hooks/model.ts: costBar` (D10); in each ended team row
  (:536-557), after the dim text's Box, a `flexShrink={0}` Box with `agentStats(a.usage)`;
  `paneRows` (:238) adds 3 in both views, not in the cleared pane; all per contracts/stats-text.md
  "Pane".

### Phase 6: Docs (FR-012, constitution VIII)

- [X] T014 [P] [US3] Docs, repository root: `README.md` "Board mod (experimental)" (:1294): "What it
  draws" (:1355) the band's stats parts and their shedding (D5), the pane's two rows and the agent
  figures; "Commands" (:1400) the `status` row names the `stats:` line; "Where it reads its state"
  (:1414) `$.session.usage()` and `turn.complete`; "Verified" (:1484): the stats are held by the mod's
  unit tests, and quickstart.md's hand check is not run; the mod's test count, `132 tests` in
  "Verified" (:1486) and `its own 132 tests` in "Test suite"'s `test/board-mod.test.mjs` row (:1528),
  set to the count `claude plugin test mods/speckit-board` reports once T002, T005, T008, T010 and
  T012's tests are in (no test holds it); "Known limits" (:2085): tokens count from
  the mod's load (D3), the price table's date and its 5-minute cache-write and Haiku 5.5 rates (D4),
  an agent's cost always an estimate (D2), a subscription's cost marked `est.` (D1).
  `docs/rules.md`: a `## Board stats` section, a table of the stats' rules and the tests that hold
  them, before `## skills/speckit-team/SKILL.md` (:43), with no `###` heading, as
  `test/rules.test.mjs: entries` reads only those (D8). `CLAUDE.md` "Layout": the
  `mods/speckit-board/` bullet says the board draws the session's context, tokens and cost.

## Dependencies and order

- Round 1, in order T001, T004, T007 (stubs), T002, T005, T008 (red), T003, T006, T009 (green): one
  file, so not parallel; T006 uses T003, T009 uses T006.
- Round 2: T010, T012 (red), then T011, T013 (green, `register.tsx`, in that order: T013 reads T011's
  atom) and T014 [P] (disjoint files). No stubs: these tests call only the engine.
- MVP: Round 1 and Phase 4 (US1 and US2 in the band and status answer).
