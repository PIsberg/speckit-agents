# Contract: what the standalone board says

`/speckit-board status` is a slash command whose answer the model and headless runs read
(constitution V). The team view's texts do not change (FR-008). Below, the feature is `005-x` and its
task list has 10 tasks; `<text>` is the task's text as `model.ts: parseTasks` reads it.

## Standalone view, by stage

The `status` answer is three lines: the status line, the phases line, `next: <next step>`. It has no
`running:` line. The band shows the same phases, the bar and count, and its buttons; no agent item and
no `RED`. The pane shows the header, next step, the phase rows, the buttons and the task sections; no
Team section.

| ID | Files | Status line | Phases line | Next step |
|---|---|---|---|---|
| S-1 | folder, no `spec.md` | `005-x · ○ spec` | `○ spec ○ plan ○ tasks ○ build` | `start with /speckit-specify <idea>` |
| S-2 | draft `spec.md` | `005-x · ◐ spec (draft)` | `◐ spec ○ plan ○ tasks ○ build` | `review spec.md, then /speckit-plan` |
| S-3 | approved `spec.md`, no plan | `005-x · ○ plan` | `✓ spec ○ plan ○ tasks ○ build` | `run /speckit-plan` |
| S-4 | plan, no `tasks.md` | `005-x · ○ tasks` | `✓ spec ✓ plan ○ tasks ○ build` | `run /speckit-tasks` |
| S-5 | 0 of 10 ticked | `005-x · ○ build (0/10)` | `✓ spec ✓ plan ✓ tasks ○ build` | `/speckit-implement: T001 <text>` |
| S-6 | 4 of 10 ticked | `005-x · ◐ build (4/10)` | `✓ spec ✓ plan ✓ tasks ◐ build` | `T005 <text>` (first unticked) |
| S-7 | 10 of 10 ticked | `005-x · ✓ ready for the PR · 10/10 tasks` | `✓ spec ✓ plan ✓ tasks ✓ build` | `ready for the PR` |
| S-8 | `tasks.md` with no task lines | `005-x · ○ build` | `✓ spec ✓ plan ✓ tasks ○ build` | `tasks.md lists no tasks` |

In the pane, S-5's next step is drawn as `/speckit-implement:` followed by the task as other tasks are
drawn (bold ID, story tag dim, `code` as code). `nextStep` returns it as
`{ text: '/speckit-implement: T001 <text>', task, command: '/speckit-implement:' }`.

## Unreadable feature files (D3, both views)

| ID | Case | Phase | Next step |
|---|---|---|---|
| U-1 | `spec.md` exists, read fails | `✗ spec`, note `unreadable` | `cannot read spec.md` |
| U-2 | `plan.md` exists, read fails | `✗ plan`, note `unreadable` | `cannot read plan.md` |
| U-3 | `tasks.md` exists, read fails | `✗ tasks`, note `unreadable` | `cannot read tasks.md` |

## Notices (both views)

One line. N-1 is the answer to every `/speckit-board` command and is never toasted (D5). N-2 to N-4
are the `/speckit-board status` answer, the pane's only line, and the start toast. The status line is
cleared. `<dir>` is the repo-relative folder.

| ID | Case | Text |
|---|---|---|
| N-1 | no `.specify/` at the git toplevel, or in no ancestor of a non-git cwd | `Spec Kit is not set up here (no .specify/): specify init sets it up.` |
| N-2 | `.specify/feature.json` missing, no `feature_directory`, or a path outside the repo | `no active feature in .specify/feature.json: /speckit-specify <idea> starts one.` |
| N-3 | `.specify/feature.json` exists but cannot be read or is not JSON | `cannot read .specify/feature.json: /speckit-specify <idea> writes it again.` |
| N-4 | the feature folder does not exist | `<dir>, the active feature in .specify/feature.json, does not exist: /speckit-specify <idea> starts one.` |

`/speckit-board band` and `clear` keep their answers; with no board, `clear` answers as today
(`model.ts: clearText`).
