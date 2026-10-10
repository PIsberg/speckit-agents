# Feature Specification: Board Clear

**Feature Branch**: `004-board-clear`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "implement a clear option in the board. It should clear both the board and the band."

## Clarifications

### Session 2026-10-10

- Q: Does clear touch the pipeline's records? -> A: No, display-only.
- Q: Does clear remove the rows of running agents? -> A: No, only finished agents' rows.
- Q: Does clear also reset the status line and toasts? -> A: No, the board (pane) and the band only.
- Q: How long does the cleared state last? -> A: Until the next team agent starts or the session ends; it is not stored.
- Q: How does the user trigger clear? -> A: A [clear] button on the board (the user's own words). A `/speckit-board clear` argument is kept as a secondary route for headless sessions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clear the board and the band in one action (Priority: P1)

After a pipeline has run, the board's pane lists the session's team agents with their report words, and the band shows the feature, phases and progress. The user wants a clean slate without restarting the session. One press of the [clear] button empties the pane's agent list and removes the band from above the prompt.

**Why this priority**: It is the whole feature. Without it, old agent rows and the band stay on screen for the rest of the session.

**Independent Test**: Run a pipeline until the pane lists at least 3 agents and the band is visible, press [clear], and confirm the pane lists no agent rows and the band is not drawn.

**Acceptance Scenarios**:

1. **Given** the pane lists finished agents and the band is shown, **When** the user presses [clear], **Then** the pane lists no agent rows and the band is no longer drawn.
2. **Given** the pane is closed and the band is shown, **When** the user presses [clear] on the band, **Then** the band is no longer drawn and, when the pane is next opened, it lists no agent rows from before the clear.
3. **Given** the band was already hidden with `/speckit-board band` and the pane is open, **When** the user presses [clear] in the pane, **Then** the agent rows are cleared, no error is shown, and the band stays hidden.
4. **Given** the board has nothing to clear (no agent rows, no feature), **When** the user presses [clear], **Then** it completes without error and says there was nothing to clear.
5. **Given** the board shows a [clear] button, **When** the user looks at the pane and at the band, **Then** each shows a button labelled `clear`.

---

### User Story 2 - Board comes back for new work (Priority: P2)

After a clear, the user starts or continues a pipeline. The board must not stay blank for good, or the user would have to know how to undo the clear.

**Why this priority**: A clear that permanently disables the board would be a trap. It matters less than the clear itself.

**Independent Test**: Clear, then launch one team agent and confirm its row and the band appear.

**Acceptance Scenarios**:

1. **Given** the board was cleared, **When** a team agent starts, **Then** the pane shows that agent's row and none of the cleared rows, and the band is drawn again.
2. **Given** the board was cleared, **When** the user opens the pane with `/speckit-board`, **Then** the pane opens and shows the pipeline's current phases and next step, without the cleared agent rows.

---

### User Story 3 - Clear never changes the pipeline (Priority: P1)

Clearing is about what is drawn. The pipeline's own records (verdicts, retry count, gatekeeper approval, `tasks.md`) are what the guardrails use, and clear must leave them as they were.

**Why this priority**: A clear that reset a retry count or an audit verdict would let work past a gate that should block it.

**Independent Test**: Record a PASS verdict and a RED count of 2, clear, and compare the records and the gate's decisions before and after.

**Acceptance Scenarios**:

1. **Given** a current audit PASS and a RED count of 2, **When** the user clears, **Then** every file under `.git/speckit-team/`, `spec.md`, `plan.md` and `tasks.md` is byte-identical, and the gate decides exactly as before.
2. **Given** the board was cleared, **When** `/speckit-board status` runs, **Then** its answer still reports the phases, the next step and the retry state from the records.

### Edge Cases

- Clear while an agent is running: the running agent keeps its row and the band stays, so the user is never shown a board that hides live work. Only finished agents' rows are cleared.
- [clear] pressed twice in a row: the second run changes nothing and shows no error.
- Clear in a headless `claude -p` session: there is no button there, so the `/speckit-board clear` argument answers with text and does not fail.
- [clear] when the band has already dropped parts for a narrow terminal: the band is removed in the same way.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The board MUST show a [clear] button, in the pane and in the band, that the user can press to clear the board and the band.
- **FR-011**: The board MUST also accept `/speckit-board clear` alongside the existing `refresh`, `band` and `status`, with the same effect as the button, so a session without a clickable board can clear.
- **FR-002**: Running clear MUST remove every finished agent's row from the pane in one step, so the pane shows no agent row that existed before the clear.
- **FR-003**: Running clear MUST remove the band from above the prompt in one step.
- **FR-004**: Clear MUST be display-only: it MUST NOT modify, delete or reset the verdict, retry, gatekeeper or other files under `.git/speckit-team/`, nor `spec.md`, `plan.md`, `tasks.md` or `.specify/feature.json`.
- **FR-005**: Clear MUST NOT remove the row of an agent that is still running.
- **FR-006**: After a clear, the next team agent that starts MUST show its own row and bring the band back, without the user pressing or running anything. The cleared state ends at that point; rows cleared earlier stay gone.
- **FR-007**: After a clear, `/speckit-board` MUST still open the pane, showing the phases and next step from the records and no pre-clear agent rows.
- **FR-008**: Clear MUST show one line saying what it cleared, or that there was nothing to clear, and MUST NOT error when there is nothing to clear, when the band is already hidden, or when run twice.
- **FR-009**: The button MUST work in an interactive session; the `/speckit-board clear` argument MUST answer as text in a headless `claude -p` session.
- **FR-012**: Clear MUST NOT reset or remove the status line or earlier toasts; a button press MAY add one toast with the FR-008 line.
- **FR-010**: The README's command table and the board's description MUST document the [clear] button and the `clear` argument.

### Key Entities

- **Agent row**: one line of the pane for a team agent of this session, with its task, report word and times.
- **Band**: the single row above the prompt with the feature, phases, progress and buttons, [clear] among them.
- **Cleared state**: what the board remembers about being cleared, so earlier agents' rows stay out of the pane and the band stays away until new work starts. It ends when the next team agent starts or the session ends, and is not stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After one clear, 0 pre-clear finished-agent rows are in the pane and the band is not drawn, checked in a session that showed at least 3 agent rows before.
- **SC-002**: The files named in FR-004 are byte-identical before and after a clear in 100% of tested cases.
- **SC-003**: The gate returns the same decision before and after a clear for each case tested (audit PASS, FAIL, stale, RED count 0 to 3).
- **SC-004**: The first team agent started after a clear has its row and the band on screen within 4 seconds, the board's poll interval.
- **SC-006**: The [clear] button is present in the pane and in the band in 100% of tested states where they are drawn.
- **SC-005**: A clear on an empty board, a repeated clear, and a clear with the band hidden each finish with 0 errors.

## Assumptions

- "The board" means the pane and "the band" means the row above the prompt, as the README defines them.
- "On the board" means the board's two surfaces that already carry buttons, the pane and the band. The user did not say which; both get the button so it is reachable whichever is showing. A cleared band has no button, so the pane's is the one to use when the band is hidden.
- The cleared state is not stored between sessions: a new session starts with the board as it would today.
- The pipeline's records are not touched (FR-004), the status line and toasts are outside "the board and the band" (FR-012).
- The board mod is a prototype to be retired once feature 001's view ships (owner decision, #11). This feature is requested for it as it stands; it does not extend 001 or 002.
