# mathlib Constitution

## Core Principles

### I. Test first
Every behaviour has a `node:test` test that is written and seen failing before the code that
makes it pass.

### II. No dependencies
The library runs on Node 18+ with the standard library only. No `npm install` step.

### III. Small exports
Each function in `src/math.js` is exported by name and documented with one JSDoc comment.

## Governance
This constitution overrides other practice. Amendments are made by pull request and bump the
version.

**Version**: 1.0.0 | **Ratified**: 2026-10-17 | **Last Amended**: 2026-10-17
