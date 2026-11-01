# Quickstart: checking the stats by hand

For SC-003 (D9) and the two API readings D1 and D6 rest on. Not run yet; record what you see in
`docs/live-results.md` under its date.

## Setup

In this repository, on the feature branch: `claude --plugin-dir mods/speckit-board`, in a terminal at
least 140 columns wide.

## Checks

1. **SC-003**: send one prompt, then read the band alone, no command typed. It shows the context bar
   and percentage, `in` and `out` counts and a cost. Record the band's text or a screenshot.
2. **D1**: on a subscription login (`/status` names it), the cost carries `est.`; on an API key it
   does not. The figure matches `/cost`.
3. **D6**: ask for a task that runs several tools in one turn. While the turn runs, the band's
   percentage moves within about 4 s of the status line's, before the turn ends.
4. **FR-008**: narrow the terminal to 60 columns. The band stays one row and keeps the current
   phase's name; the tokens go first, then the cost bar, then the cost.
5. `/speckit-board status` ends with a `stats:` line whose figures equal the band's; `/speckit-board`
   opens the pane with the same figures in its two stats rows.
