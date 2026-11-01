# Contract: the stats' texts

What the band, the pane and `/speckit-board status` show. All three draw from one `statsView()`
(`hooks/model.ts`), so a figure reads the same in each (FR-005). The rules behind each figure are
data-model.md "Rules".

## Figures

| Figure | Examples | Form |
|---|---|---|
| count (`shortCount`) | `0`, `999`, `1.0k`, `9.9k`, `45k`, `999k`, `1.2M`, `99.9M`, `120M`, `1.2B` | under 1,000 whole; then the first that stays under its bound once rounded: `k` one decimal under 10, `k` whole under 1,000, `M` one decimal under 100, `M` whole under 1,000, then `B` one decimal (999,950 reads `1.0M`) |
| tokens | `1.2M in · 45k out` | `in` and `out` as D3 counts them; `0 in · 0 out` before any turn |
| dollars (`dollars`) | `$0.00`, `$0.78`, `$9999.99`, `$10k`, `$1.2M` | `$` and two decimals under $10,000, no thousands separator; from $10,000 `$` and the count form |
| context | `0%`, `50%`, `>100%`, `n/a` | the reported whole percentage |
| cost | `$0.78`, `$0.78 est.`, `n/a` | `est.` per data-model.md "Rules" |
| mark | ` high`, ` critical` | appended to the context figure and to the cost bar, per data-model.md "Marks" |

A bar is `hooks/model.ts: bar(fill, 1, width)`, `█` filled and `░` empty, with the fill capped at 1.
No bar is drawn for an `n/a` figure.

## Band

After the task count and `RED n/3`, before the agent at work and the buttons, as `BandItem`s of kind
`stat`:

| Part | Text |
|---|---|
| (separator) | `│`, as the existing `sep` item |
| `context` | `<bar 8> <context><mark>`, e.g. `████░░░░ 50%`, `████████ 96% critical`; unknown: `context n/a` |
| `tokens` | the tokens text |
| `cost` | the cost text; unknown: `cost n/a` |
| `costbar` | `<bar 5><mark>`, e.g. `███░░`, `█████ critical`; absent when the cost is `n/a` |

Drawn in the bar's color: no mark `claude`, `high` `warning`, `critical` `error`.

**Shedding (D5)**: `bandLayout` tries, richest first, the band's 8 existing variants crossed with a
stats level, and draws the first that fits:

1. existing variant 1 with the four parts;
2. variant 1 without `tokens`;
3. variant 1 without `tokens` and `costbar`;
4. variant 1 with `context` alone;
5. to 11. existing variants 2 to 8, each with `context` alone;
12. existing variant 8 without stats.

Without a view, `bandLayout` tries the 8 existing variants alone, as today.

## Status answer

A last line, after `next:` and `running:`: `stats: ` and the texts of all four band parts (step 1
above), joined by one space, the separator left out:

```text
stats: ████░░░░ 50% 1.2M in · 45k out $2.50 est. ███░░
```

(The bar is the band's, so the fill matches.) Without a view, `boardText` answers as today. A notice
(no board) gets no stats line.

## Pane

A block of two rows after the phases, before the Team section, in both views:

```text
context ████████████░░░░░░░░░░░░ 50% · 100k of 200k
cost    ██████████░░░░░░░░░░░░░░ $2.50 est. of $5.00 · 1.2M in · 45k out
```

- The label is 8 columns wide; the bar takes the pane's existing `barWidth` (`register.tsx`, the Pane
  hook); the mark follows the figure, as in the band.
- ` · <contextTokens> of <window>` only when both are known. An unknown figure reads `n/a` after its
  label, with no bar (`cost    n/a · 1.2M in · 45k out`).
- `paneRows` counts 3 more rows (the two and a blank), except in the cleared pane.

A team agent's row, once it has ended, gains after its dim text `agentStats(usage)`:
`$0.40 est. · 1.2M in · 45k out`, or `n/a` with no usage. A running row gains nothing.
