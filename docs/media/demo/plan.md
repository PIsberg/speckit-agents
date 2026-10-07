# Implementation Plan: greet command

**Branch**: `001-greet` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Summary

One ES module, `src/greet.js`, exports `greet(name)` and runs as a CLI when executed directly.

## Technical Context

**Language/Version**: JavaScript, Node 18+
**Primary Dependencies**: none
**Testing**: `node:test`, run by `npm test`
**Target Platform**: any OS with Node 18+
**Project Type**: single CLI
**Performance Goals**: under 1 second per run (SC-002)
**Constraints**: standard library only

## Constitution Check

- I. Test first: tasks T002 and T003 precede T004 and T005. Pass.
- II. No dependencies: none added. Pass.
- III. Docs move with the code: T006 updates README.md. Pass.

## Project Structure

```
src/greet.js           # greet(name) and the CLI entry point
test/greet.test.mjs    # FR-001 to FR-003, SC-001 and SC-002
package.json           # "test": "node --test test/"
README.md              # usage
```
