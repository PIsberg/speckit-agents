# Data Model: Board Clear

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-10

All state below is plugin state of the board mod (`$.state`, through `atom`): it survives a hot reload
of the mod, is not persisted, and starts over in a new session. Nothing is added to `$.store`, to any
file, or to `.git/speckit-team/`.

## Agent row (existing, `agents: SpeckitAgent[]`)

Unchanged type (`mods/speckit-board/types/index.d.ts`). New rule:

- Clear keeps the members with `isRunning: true` and drops every other one (FR-002, FR-005).
- A row dropped by clear is never added back: rows are added only at a team agent's
  `classic.SubagentStart`, with that agent's own id.

## Band visibility (existing `isBandHidden`, new `isCleared`)

| Field | Type | Initial | Set by |
|---|---|---|---|
| `isBandHidden` | `boolean` | `false` | the user: `/speckit-board band`, the pane's `toggle band`, the band's `hide` (unchanged) |
| `isCleared` | `boolean` | `false` | clear (`true`), a team agent's start (`false`), the band toggle when it shows the band (`false`, D4) |

The band is drawn when the board has a feature, no survey is showing, `isBandHidden` is `false` and
`isCleared` is `false`.

### Transitions of `isCleared`

| From | Event | To | Note |
|---|---|---|---|
| any | clear, with no team agent running | `true` | FR-003 |
| any | clear, with a team agent running | unchanged | the band stays while work is live (Edge Cases, D1) |
| `true` | `classic.SubagentStart` of a team role | `false` | FR-006 |
| `true` | `/speckit-board band` or the pane's `toggle band` | `false` (and `isBandHidden` `false`) | D4 |
| any | session end | gone | not stored |

`/speckit-board`, `refresh`, `status`, the poll and a turn's end do not change it (FR-007).

## Clear result (computed, not stored)

| Field | Meaning |
|---|---|
| `rows` | finished agent rows removed |
| `isBandCleared` | the band was drawn before the clear and is not after it |
| `running` | team agents still running, whose rows were kept |

Rendered by `clearText` into one line ([contracts/board-clear.md](contracts/board-clear.md)).
