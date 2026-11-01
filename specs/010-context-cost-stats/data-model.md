# Data Model: Token, Cost and Context Stats

Session state only: the mod's `PluginState`, reset when the mod loads, never in the store or on disk.

## Types (`mods/speckit-board/types/index.d.ts`)

```ts
import type { ModelUsage } from 'claude-code'

// Token counts summed per model id, as `turn.complete`'s `usage` reports them.
export type SpeckitUsage = Record<string, ModelUsage>

export type SpeckitStats = {
  isRead: boolean          // the last $.session.usage() answered a usable SessionUsage
  percent?: number         // context.percent
  contextTokens?: number   // context.tokens
  window?: number          // context.window
  usd?: number             // cost.usd, the session's reported cost
  isSubscription: boolean  // a five_hour or seven_day rate-limit window was reported (D1)
  usage: SpeckitUsage      // every turn.complete since the mod loaded, main loop and agents (D3)
}

// SpeckitAgent gains:  usage?: SpeckitUsage   // that agent's turns, by its id (D2)
// PluginState['speckit-board'] gains:  stats: SpeckitStats   // initially model.ts NO_STATS
```

`NO_STATS` = `{ isRead: false, isSubscription: false, usage: {} }`.

## Reading

- `readUsage(raw, before)`: a `SessionUsage` with numbers where numbers belong sets `isRead`,
  `percent`, `contextTokens`, `window`, `usd` (absent when `cost` is) and `isSubscription` (true once
  any `rateLimits[].kind` is `five_hour` or `seven_day`; kept true after). Anything else (undefined, a
  rejection, a wrong type) gives `isRead: false` with the four figures cleared, `usage` and
  `isSubscription` kept. A field of the wrong type is read as absent.
- `addUsage(sum, turn)`: a `TurnUsage` (a string `model`, four finite counts of zero or more) adds its
  counts to `sum[model]`; anything else returns `sum` unchanged. Never mutates `sum`.

## Rules (`statsView`)

- **Context**: `percent` when known. Absent with `isRead` and nothing spent (`usd === 0`, or `usd`
  absent and `usage` empty): `0%` (US1-3, a fresh session). Otherwise unknown, `n/a` (US1-4; also just
  after a compaction or on a resumed session, until the next response). Above 100: shown `>100%`, bar
  full.
- **Cost**: `usd` when reported, with `est.` when `isSubscription` (D1). Otherwise `estimateUsd(usage)`
  with `est.`. Otherwise `n/a`.
- **Marks**, for both bars, on the uncapped ratio (context `percent / 100`, cost `usd / 5`): at or over
  0.95 `critical`, at or over 0.8 `high`, else none (`HIGH = 0.8`, `CRITICAL = 0.95`,
  `COST_REFERENCE = 5`, fixed).
- **Fill**: the same ratio capped at 1; the view carries it unrounded, so SC-001 and SC-007 read it
  exactly; a drawn bar rounds it to its cells.
- **Agent** (`agentStats`): tokens and `estimateUsd` of the agent's `usage`, always `est.` (D2); `n/a`
  without usage or with an unpriced model.

## Price table (`hooks/model.ts: PRICES`, D4)

USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing, fetched
2026-11-01. `cacheWrite` is the 5-minute write rate.

| Key | input | cacheWrite | cacheRead | output |
|---|---|---|---|---|
| `claude-fable-5-1` | 10 | 12.50 | 0.25 | 50 |
| `claude-mythos-5-1` | 10 | 12.50 | 0.25 | 50 |
| `claude-fable-5` | 10 | 12.50 | 1 | 50 |
| `claude-mythos-5` | 10 | 12.50 | 1 | 50 |
| `claude-opus-5-5` | 4 | 5 | 0.20 | 20 |
| `claude-opus-5` | 5 | 6.25 | 0.50 | 25 |
| `claude-opus-4-8` | 5 | 6.25 | 0.50 | 25 |
| `claude-opus-4-7` | 5 | 6.25 | 0.50 | 25 |
| `claude-opus-4-6` | 5 | 6.25 | 0.50 | 25 |
| `claude-opus-4-5` | 5 | 6.25 | 0.50 | 25 |
| `claude-opus-4-1` | 15 | 18.75 | 1.50 | 75 |
| `claude-opus-4` | 15 | 18.75 | 1.50 | 75 |
| `claude-sonnet-5-5` | 2 | 2.50 | 0.10 | 10 |
| `claude-sonnet-5` | 2 | 2.50 | 0.20 | 10 |
| `claude-sonnet-4-6` | 3 | 3.75 | 0.30 | 15 |
| `claude-sonnet-4-5` | 3 | 3.75 | 0.30 | 15 |
| `claude-sonnet-4` | 3 | 3.75 | 0.30 | 15 |
| `claude-haiku-5-5` | 0.50 | 0.625 | 0.05 | 2.50 |
| `claude-haiku-4-5` | 1 | 1.25 | 0.10 | 5 |
| `claude-haiku-3-5` | 0.80 | 1 | 0.08 | 4 |

The current models' ids (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`,
`claude-haiku-5-5`) are from the models overview page, same day; the others follow the same pattern
and are not checked.

**Matching** (`priceOf`): drop everything up to and including `anthropic.` (Bedrock), then a trailing
`-v<n>` or `-v<n>:<n>`, `@<8 digits>` (Vertex) or `-<8 digits>` (a dated id); the rest must equal a key
exactly. So `claude-opus-4-5-20251101` takes `claude-opus-4-5`, and an unlisted `claude-opus-4-9` is
unpriced rather than given `claude-opus-4`'s rate.

**Estimate** (`estimateUsd`): the sum over models of `(input_tokens × input + cache_creation_input_tokens
× cacheWrite + cache_read_input_tokens × cacheRead + output_tokens × output) / 1,000,000`; `undefined`
when `usage` is empty or any of its models is unpriced (edge case: no estimate from a guessed price).
