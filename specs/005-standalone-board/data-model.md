# Data Model: Standalone Board

Only what changes. Everything else in `mods/speckit-board/types/index.d.ts` and `hooks/model.ts`
stays as it is.

## `SpeckitBoard` (`types/index.d.ts`)

| Field | Type | Rule |
|---|---|---|
| `isStandalone` | `boolean`, optional | `true`: standalone view (plan.md, Design, View). Absent or `false`: team view, so boards built by the existing tests stay team boards (SC-003). |

In a standalone board `phases` has 4 entries (spec, plan, tasks, build), `red` is 0 and
`isRetryUnreadable` is `false`.

## `BoardInputs` (`hooks/model.ts`)

| Field | Was | Now |
|---|---|---|
| `isStandalone` | none | `boolean`, optional; absent means team |
| `spec`, `plan` | `string \| undefined` | `string \| null \| undefined`: `null` is a file that exists and cannot be read (D3) |
| `tasks` | `SpeckitTask[] \| undefined` | `SpeckitTask[] \| null \| undefined`, `null` as above |

## Plugin state (`types/index.d.ts: PluginState['speckit-board']`)

| Atom | Type | Rule |
|---|---|---|
| `notice` | `string` | the one-line notice while `board` is `null` (`contracts/board-text.md`, N2-N4); `''` while a board is drawn |
| `teamFeatures` | `string[]` | D1: repo-relative feature folders a team agent started on this session. Appended at a team `SubagentStart`, never cleared by `/speckit-board clear`. |

## `Repo` (`hooks/register.tsx`)

`{ root: string; stateDir?: string }`: `stateDir` is absent in a Spec Kit repo that is not a git
repo, and then no record file or store word is read.
