# Feature Specification: Token, Cost and Context Stats on the Board

**Feature Branch**: `263-context-cost-stats`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "I want token and cost stats including a progressbar for how much context that is used. fit in nicely on the board and the text above the prompt"

## Clarifications

### Session 2026-11-01

- Q: Which base does the feature build on, given CLAUDE.md calls the board mod a prototype that feature 001's view retires? → A: build on the board mod as the spec stands; the owner chose this knowing it is a prototype (2026-11-01).
- Q: Are the figures for the current session only, or across sessions? → A: current session only, no history.
- Q: Is the per-agent cost and token view (US4) kept? → A: yes, kept as P3.
- Q: Are the 80% and 95% marks configurable? → A: no, fixed.
- Q: What does the band show for cost when the login reports none (subscription)? → A: not `n/a`: estimate the cost from the token counts and the model's list price and mark it plainly as an estimate (`est.`), so it is never read as a billed figure. `n/a` stays only where no estimate can be made (for example an unknown model with no price).
- Q: Should there be a total cost bar beside the context bar, and what is its full mark? → A: yes (the user asked for it, 2026-11-01). The user chose the recommended default (2026-11-01): the bar is full at a fixed reference of $5.00 for the session, not configurable, with the same 80% and 95% marks as the context bar. Not a budget: nothing stops or alerts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See how full the context is at a glance (Priority: P1)

A user is partway through a run. In the board's band above the prompt they see a progress bar of how much of the session's context is used, with the percentage, so they know whether a large feature is heading for compaction before it happens.

**Why this priority**: Context filling up is the one number that changes what the user does next (finish, compact, or split the work). The README records a run reaching a 105k peak context.

**Independent Test**: Open a session with a known amount of context used and read the band. The bar and the percentage match that amount.

**Acceptance Scenarios**:

1. **Given** a session using 50% of its context window, **When** the band is drawn, **Then** it shows a bar half filled and the text `50%`.
2. **Given** context use passes 80%, **When** the band is drawn, **Then** the bar is marked as high in a way that is not colour alone (a word or symbol), and passes 95% as critical in the same way.
3. **Given** the session has just started and nothing has been sent, **When** the band is drawn, **Then** it shows an empty bar at `0%`, not an error.
4. **Given** the context use is not known (no figure available), **When** the band is drawn, **Then** it shows `context n/a` and no bar, and the rest of the band is unchanged.

---

### User Story 2 - See tokens and cost so far (Priority: P1)

The user sees, beside the bar, the tokens used and the money spent in this session so far, so a long run does not surprise them.

**Why this priority**: Cost is the other reason to watch a run; the docs measure whole runs in dollars and tokens, and the user has no live figure today.

**Independent Test**: Run a session with known token counts and cost and compare the band and the pane with those figures.

**Acceptance Scenarios**:

1. **Given** a session with 1.2M input tokens, 45k output tokens and a cost of $0.78, **When** the band is drawn, **Then** it shows the tokens in a short form (`1.2M in`, `45k out`) and the cost as `$0.78`.
2. **Given** a figure changes after a response, **When** the band next refreshes, **Then** it shows the new figure without the user running any command.
3. **Given** the session reports no cost (for example a subscription login) and the model has a known list price, **When** the band is drawn, **Then** the cost is the token counts priced at that list price and is shown with the word `est.` (for example `$0.78 est.`), never as a bare billed-looking figure and never as `$0.00`.
4. **Given** an API-key session reports a cost, **When** the band is drawn, **Then** the reported cost is shown without `est.`, and no estimate replaces it; on a subscription the same reported figure carries `est.`.
5. **Given** the session reports no cost and the model has no known list price, **When** the band is drawn, **Then** the cost is shown as `n/a`, never as `$0.00`.
6. **Given** a session whose cost is $2.50, **When** the band is drawn, **Then** beside the cost it shows a cost bar half filled (full at the $5.00 reference) and the text `$2.50`.
7. **Given** the cost reaches 80% of the reference ($4.00), **When** the band is drawn, **Then** the cost bar is marked high in a way that is not colour alone, and critical at 95% ($4.75), as for the context bar.
8. **Given** the cost passes the reference, **When** the band is drawn, **Then** the cost bar is full, the real amount is still shown, and the bar is marked critical.
9. **Given** the cost is an estimate, **When** the band is drawn, **Then** the cost bar is drawn from the estimate and the figure beside it carries `est.`; where the cost is `n/a`, no cost bar is drawn and the context bar is unchanged.

---

### User Story 3 - Stats fit the board (Priority: P2)

The stats appear in the board's three places in a consistent way: the band above the prompt shows the compact line (context bar, percentage, tokens, cost, cost bar); the pane shows the same figures with more detail; the status answer (`/speckit-board status`) prints them as text.

**Why this priority**: The request asks that they "fit in nicely". A fourth place or a different format in each would not.

**Independent Test**: Draw all three in one state and compare the figures.

**Acceptance Scenarios**:

1. **Given** any one state, **When** the band, the pane and the status answer are read, **Then** the percentage, token counts, cost and cost-bar fill are identical in all three.
2. **Given** a narrow terminal (60 columns), **When** the band is drawn, **Then** it fits on its existing line count, dropping the token counts, then the cost bar, then the cost figure, before the context bar, and never wraps or hides the existing phase text.
3. **Given** a repository without Spec Kit initialised, **When** the board would be shown, **Then** the stats are not shown either (the board shows nothing there today).
4. **Given** the user has no team (standalone board), **When** the band is drawn, **Then** the stats are still shown.

---

### User Story 4 - Cost per agent in the pane (Priority: P3)

In a run with team agents, the pane shows each agent's tokens and cost next to its row, so the user sees which role spends the most.

**Why this priority**: Useful for tuning the team, but the session totals carry the main value.

**Independent Test**: Run a team feature with two agents of different cost; the pane rows show different figures that add up to the session's agent total.

**Acceptance Scenarios**:

1. **Given** two agents finished with $0.10 and $0.40, **When** the pane is drawn, **Then** each row shows its own cost and the session total is not less than their sum.
2. **Given** an agent's figures are unknown, **When** its row is drawn, **Then** it shows `n/a` and the other rows are unaffected.
3. **Given** an agent's tokens and its model's price are known, **When** its row is drawn, **Then** its cost is estimated and marked `est.`, whether or not the session reports its own cost.

### Edge Cases

- Figures are missing, zero or malformed: each shows `n/a` or its zero form (a cost that can be estimated is shown as an estimate, see FR-004), the board still draws and the band never throws or blocks the prompt (Observers Never Block).
- Context use above 100% (after a figure update lag): the bar is full and the text shows the real value, capped for display at `>100%`.
- Context is compacted: the next refresh shows the lower figure; the bar can go down.
- Several sessions in one repository: each session shows its own figures, never another's.
- Token counts present but the model is unknown or has no list price: the cost is `n/a`, not an estimate from a guessed price.
- Estimated and reported costs in one session (for example some agents report, some do not): each figure carries its own `est.` mark; the session total carries `est.` if any part of it is estimated.
- Cost of zero (nothing spent yet, reported as zero): the cost bar is empty at `$0.00`; this is a reported zero, not an unknown cost.
- Very large numbers (over 999M tokens, over $9,999): shown in a short form that still fits the band.
- A session resumed from an earlier one: context and cost are those the session reports; token counts start at the board's load; the board does not invent a total across sessions.
- Stats must not slow the prompt: drawing them adds no model call and no network call.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The band above the prompt MUST show a progress bar of context used, with the percentage, whenever the board is shown.
- **FR-002**: The bar MUST mark high use (at or above 80%) and critical use (at or above 95%) with a word or symbol as well as any colour.
- **FR-003**: The band MUST show the session's input tokens (uncached, cache-read and cache-written together) and output tokens, counted from the turns since the board loaded, in a short form (`k`, `M`), and its cost in dollars with two decimals.
- **FR-004**: A cost the session reports MUST be shown as reported, and with the word `est.` beside it when the login is a subscription (the session reports a `five_hour` or `seven_day` rate-limit window), whose cost is priced, not billed. When the session reports none, the cost MUST be estimated from the token counts and the model's list price and shown with `est.`, and an estimate MUST never be shown without that mark. Any other unknown figure, and a cost with no reported value and no known price, MUST show as `n/a`, never as zero.
- **FR-013**: Beside the cost the band MUST show a cost bar of 10 cells, full at a fixed reference of $5.00 for the session, one cell filled for each whole 10% of the reference the cost reaches (so full only at or above it), and marked high at or above 80% and critical at or above 95% of the reference with a word or symbol as well as any colour. The bar is drawn from a reported or an estimated cost (the estimate keeps `est.`) and is omitted when the cost is `n/a`. The reference is a scale, not a budget: it stops and alerts nothing.
- **FR-005**: The band, the pane and the status answer MUST show the same percentage, token counts, cost and cost-bar fill for the same state.
- **FR-006**: The figures MUST refresh without a user command: context use and cost within the board's 4-second poll and after every turn, token counts after every turn of the session and of each agent's run.
- **FR-007**: The pane MUST show, for each team agent that has run, its own tokens and its cost estimated from them at list price and marked `est.` (the session reports no cost per agent); other unknown figures show `n/a`.
- **FR-008**: On a terminal of 60 columns the band MUST keep its existing line count and drop, in order, the token counts, then the cost bar, then the cost figure, before any of its existing items; the context bar is dropped last, only where the band's narrowest form does not fit with it.
- **FR-009**: The stats MUST work in standalone mode (no team) and in team mode, and MUST not appear where the board is not shown.
- **FR-010**: Reading and drawing the figures MUST not make a model or network call, and a failure to read them MUST NOT block or delay the prompt.
- **FR-011**: The stats MUST be read-only: they do not change the retry, gate or phase state of any run.
- **FR-012**: The README's board section and `docs/rules.md` MUST describe the stats, and the board's existing tests MUST keep passing with the stats present; a test that pins the pane's height or the whole status answer changes by the stats' rows or line alone, and one that counts the band's other phases' glyphs at a width where the context item displaces them changes by that count alone.

### Key Entities

- **Session stats**: context used (percentage of the window), input tokens, output tokens, cost in dollars, either reported or estimated (and then marked as an estimate); any may be unknown.
- **Agent stats**: the same tokens and cost for one team agent's work.
- **Thresholds**: high at 80%, critical at 95%, for both bars.
- **Cost reference**: the fixed $5.00 session amount that fills the cost bar.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a checked state, the percentage shown differs from the session's reported figure by no more than 1 percentage point, in 100% of the sampled states (0%, 50%, 80%, 95%, 100%).
- **SC-002**: The band, pane and status answer agree on all figures in 100% of the sampled states.
- **SC-003**: A user can read context used, tokens and cost from the band in one look, with no command typed (checked by reading the band alone in a recorded session).
- **SC-004**: Drawing with unknown figures, missing figures and malformed figures produces no error and no blocked prompt in 100% of the sampled cases.
- **SC-005**: At 60 columns the band is the same number of lines as before the feature in 100% of the sampled states.
- **SC-006**: In every sampled state where the session reports no cost or the login is a subscription, the cost shown carries `est.` or is `n/a`; where an API-key session reports a cost, the figure equals the reported one and carries no `est.`, in 100% of the sampled states.

- **SC-007**: In the sampled costs ($0, $2.50, $4.00, $4.75, $5.00, $9.00), the cost bar's fill (cost divided by $5.00, capped at full) is within 1 percentage point of that ratio, the bar draws 0, 5, 8, 9, 10 and 10 of its 10 cells, the same cells in the band, the pane and the status answer, its mark is none, none, high, critical, critical, critical, and the same holds for an estimated cost, in 100% of the sampled states.

## Assumptions

- "The text above the prompt" is the board's band (README, "the band above the prompt"); "the board" is the pane. The status line under the prompt is left as it is.
- Figures come from what the session already reports about itself; no new measuring is invented. Where it reports none, the figure is `n/a`, except cost, which is estimated from tokens and list price (below).
- The context window size is the one the session reports; the board does not guess a size.
- Thresholds 80% and 95% are defaults; they are fixed, not configurable, in this feature.
- Session totals are for the current session only; no history across sessions is kept (local and private by default, no new stored data).
- The cost bar's full mark is a fixed $5.00 per session, a default of this spec (the request does not give one); it is the board's scale, not a budget, and is not configurable. Confirmed by the user, 2026-11-01.
- Cost is shown in dollars; no currency conversion.
- The estimate uses the model's published list price, held by the feature and reviewed by hand; it can go stale and so is always marked `est.`. It ignores discounts, cache pricing the session does not report, and subscription terms, which is why it is not a billed figure.
- The feature builds on the existing board mod, accepting that it is a prototype (owner decision, 2026-11-01).
- Out of scope: user-set budgets and alerts that stop a run (the cost bar's reference is neither), history charts, exporting figures, and changing the status line under the prompt.
