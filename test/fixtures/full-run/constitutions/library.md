# mathlib Constitution

## Core Principles

### I. Validated input
Every exported function MUST check its arguments and throw a `TypeError` whose message names the
parameter when one has the wrong type. Wrong input never returns a value.

### II. Documented API
Every exported function MUST have an entry in `README.md` under `## API`: its signature, one
sentence on what it returns, and one example call with its result.

### III. Recorded changes
A change that adds or changes an export MUST add a line to `CHANGELOG.md` under `## Unreleased`
naming the function.

### IV. Tested behaviour
Every exported function MUST have `node:test` tests in `test/<module>.test.js` for its ordinary
case, each edge case its documentation names, and each error it throws.

### V. Standard library only
The library MUST run on Node 18+ with no runtime or development dependencies.

## Governance
This constitution overrides other practice. Amendments are made by pull request and bump the
version.

**Version**: 1.0.0 | **Ratified**: 2026-11-20 | **Last Amended**: 2026-11-20
