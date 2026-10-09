# Data model: Fast track for small changes

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Everything here lives in `hooks/speckit-team.mjs` or on disk under the git directory. No schema is
emitted to a consumer outside the repo; the start record is internal state like the existing
`agents/<id>.json`.

## Budget (constants)

| Name | Value | Rule |
|---|---|---|
| `PATCH_LINES` | `30` | production changed lines allowed; 30 is within, 31 is over (FR-005) |
| `PATCH_FILES` | `2` | production files touched allowed; 2 is within, 3 is over (FR-005) |

Binary production files: none allowed, added or modified (FR-006).

## Path class

Every changed repo-relative path (forward slashes) gets exactly one class, checked in this order:

1. **protected**: `isProtected(rel, rev)` returns the reason string from the `PROTECTED` table
   (research R4), or, when `isOwnRepo(rev)` is true, from the `OWN_SOURCES` table (which includes
   the top-level `package.json`), else `null`.
2. **test**: `isTest(rel)`, the existing function (built-in `TEST_PATTERNS` plus
   `.specify/test-paths`).
3. **doc**: `isDoc(rel)`, `DOC_PATTERNS = [/\.(md|mdx|markdown|rst|adoc|asciidoc|txt)$/i]`.
4. **production**: anything else.

`isOwnRepo(rev)`: true when `git cat-file blob <rev>:package.json` (the top-level file as committed
at `rev`) parses as a JSON object whose `name` is exactly `speckit-agents`. `rev` is the start
commit in `measure` and the end check, `HEAD` in `scope protected`. No such commit, no such file,
malformed JSON, or any other name: false, never an error. Computed at most once per `rev` per hook
run (plan.md, decision 4; owner-confirmed 2026-10-09, reading from a commit included).

Outside the repo, only `isTeamFile(abs)` matters: true for a path under `<TEAM_DIR>/agents/`,
`<TEAM_DIR>/hooks/` or `<TEAM_DIR>/skills/`, or equal to `<TEAM_DIR>/settings.json` or
`<TEAM_DIR>/settings.local.json`, compared with the existing `canonical()`.
`TEAM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`.

## Start record (one per fast-track run)

File: `<git common dir>/speckit-team/patch/<key>.json`

| Field | Type | Meaning |
|---|---|---|
| `sha` | string, 40 to 64 hex | `HEAD` at the agent's first tool call |
| `dirty` | object: repo-relative path to string or `null` | each path that differed from `HEAD` or was untracked then, mapped to the SHA-256 (64 hex) of its bytes then, or `null` if it did not exist (deleted) or could not be read; left out of the counts while unchanged (research R14) |
| `at` | string, ISO 8601 | when it was written |

- `<key>`: `agent_id`, else `session_id`; must match `^[\w-]{1,128}$` (research R8).
- Written once, at the first PreToolUse of that key; never rewritten or deleted by the hook.
- Valid only if `sha` is hex of 40 to 64 characters, `dirty` is a plain object (not an array) whose
  values are each 64 lower-case hex characters or `null`, and
  `git cat-file -e <sha>^{commit}` succeeds. Otherwise it is **unusable** (research R9).

## Measurement (computed on every call, never stored)

`measure(start)` returns:

| Field | Type | Meaning |
|---|---|---|
| `lines` | number | sum over tracked production text files of max(insertions, deletions) from `git diff --find-renames --numstat` (a modified line counts 1; a pure rename 0), plus line counts of untracked production text files |
| `files` | number | production paths with any change; a rename between production paths counts 1 |
| `binary` | string[] | production paths added or modified that are binary |
| `protectedChanged` | `{ path: string, isNew: boolean }[]` | protected paths changed, added or deleted since `sha` |
| `committed` | boolean | `HEAD` is not `sha` |
| `dirtyTouched` | string[] | paths in `start.dirty` whose current state (`stateOf(rel)`) differs from the recorded one, plus, when `committed`, those listed by `git diff --no-renames --name-only -z <sha> HEAD` (swept into a commit) |

`stateOf(rel)`: SHA-256 hex of the file's bytes under the repo root, `null` if it cannot be read
(missing, a directory). Byte-equal content is unchanged, whatever its modification time.

Derived: `over = lines > PATCH_LINES || files > PATCH_FILES || binary.length > 0 || dirtyTouched.length > 0`
(research R14: a change the hook cannot separate from the developer's work counts as over).

Paths in `start.dirty` are left out of `lines`, `files`, `binary` and `protectedChanged`; a change to
one shows only in `dirtyTouched`.

Renames (owner-confirmed 2026-10-09, the cross-class rule included; research R3), by the
classes of the two paths:

| Old path | New path | Counted as |
|---|---|---|
| production | production | 1 file, max(insertions, deletions) of the pair; a pure rename 0 lines; binary only if not `R100` |
| protected | anything, or the reverse | both paths in `protectedChanged` (old: restore, new: delete) |
| production | test or doc | the old path as a deleted production file |
| test or doc | production | the new path as an added production file |
| test or doc | test or doc | nothing |

Either side in `start.dirty`: the rename is left out of the counts, and the dirty side's changed
state puts it in `dirtyTouched`. A move git does not pair (new path
untracked, or under 50% similar) is a deletion plus an addition.

## Run outcome (the report's last line)

| Word | When | Committed | PR |
|---|---|---|---|
| `DONE` | within budget, nothing protected changed, the existing tests passed | yes, one commit on `patch/<slug>` | opened if the repo has a GitHub remote; never merged |
| `FAILED` | a test failed, or no test command could be run (reported as not run) | no | no |
| `ESCALATE` | over budget, a binary production file, a file that was uncommitted at the start changed or committed, or the change needs a protected path | no | no |

The spec's four results map as: done to `DONE`; tests failed to `FAILED`; stopped for budget and
stopped for protected path to `ESCALATE`.

## State transitions of one run

```text
first tool call ──► start record written (sha, hash of each dirty file)
      │
      ▼
each tool call: Write/Edit to a dirty-at-start file ──► denied (research R14)
      │
      ▼
measure ──► within budget ──► tool allowed
   │
   └──► over budget ──► restore needed and the call is a pure restore? ──► allowed
                              │
                              └──► denied (FR-006 message)
report (handback or stop): measure
   protected changed ──► blocked until restored (every attempt)
   over and committed ──► blocked until git reset --soft <sha>
   over               ──► finishes, systemMessage: stopped for budget, work uncommitted,
                          any changed dirty-at-start file named
   within             ──► finishes, systemMessage: size against the budget
```
