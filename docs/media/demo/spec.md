# Feature Specification: greet command

**Feature Branch**: `001-greet`

**Created**: 2026-10-07

**Status**: Approved

**Input**: User description: "A command that greets someone by name."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Greet a named person (Priority: P1)

A user runs `node src/greet.js Ada` and sees `Hello, Ada!`.

**Why this priority**: It is the whole feature.

**Independent Test**: Run the command with a name and compare its output.

**Acceptance Scenarios**:

1. **Given** the name `Ada`, **When** the user runs the command, **Then** it prints `Hello, Ada!` and exits 0.
2. **Given** no name, **When** the user runs the command, **Then** it prints `Hello, world!` and exits 0.

### Edge Cases

- A name of only spaces is treated as no name.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The module MUST export `greet(name)`, returning `Hello, <name>!`.
- **FR-002**: `greet` MUST return `Hello, world!` when the name is missing, empty or only spaces.
- **FR-003**: Running `node src/greet.js [name]` MUST print `greet(name)` followed by a newline and exit 0.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Both acceptance scenarios and the edge case pass as automated tests in `npm test`.
- **SC-002**: The command finishes in under 1 second on Node 18.
