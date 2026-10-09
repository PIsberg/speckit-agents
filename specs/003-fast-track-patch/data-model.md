# Data model: Fast track for small changes

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Everything here lives in `hooks/speckit-team.mjs` or on disk under the git directory. No schema is
emitted to a consumer outside the repo; the start record is internal state like the existing
`agents/<id>.json`. The accepted record is read by one consumer, `skills/speckit-patch/SKILL.md`,
which ships in the same install.

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
2. **test**: in `patch`, `testsAt(start.sha).isTest(rel)`: the built-in `TEST_PATTERNS` plus the
   lines of `.specify/test-paths` as committed at the start commit (research R3). `scope` and `lane`
   keep the existing `isTest(rel)`, which reads the working tree.
3. **doc**: `isDoc(rel)`, `DOC_PATTERNS = [/\.(md|mdx|markdown|rst|adoc|asciidoc|txt)$/i]`.
4. **production**: anything else.

`isOwnRepo(rev)`: true when `git cat-file blob <rev>:package.json` (the top-level file as committed
at `rev`) parses as a JSON object whose `name` is exactly `speckit-agents`. `rev` is the start
commit in `measure` and the end check, `HEAD` in `scope protected`. No such commit, no such file,
malformed JSON, or any other name: false, never an error. Computed at most once per `rev` per hook
run (plan.md, decision 4; owner-confirmed 2026-10-09, reading from a commit included).

`testsAt(rev)`: `{ isTest(rel), bad }` from `parseTestPaths(text)`, the existing parser of
`.specify/test-paths` moved into a function that both `testPaths` (working tree, unchanged
behaviour) and `testsAt` (`git cat-file blob <rev>:.specify/test-paths`, an empty text when the
command fails) call. `bad` names the invalid lines, as today.

Outside the repo, two things matter:

- `isTeamFile(abs)`, for `Write` and `Edit`: true for a path under `<TEAM_DIR>/agents/`,
  `<TEAM_DIR>/hooks/` or `<TEAM_DIR>/skills/`, or equal to `<TEAM_DIR>/settings.json` or
  `<TEAM_DIR>/settings.local.json`, compared with the existing `canonical()`.
- `teamState()`, for every other means (research R16): an object mapping each regular file directly
  in `<TEAM_DIR>/agents/`, directly in `<TEAM_DIR>/hooks/` and directly in each
  `<TEAM_DIR>/skills/<name>/`, by its `TEAM_DIR`-relative forward-slash path (`agents/patcher.md`),
  to the SHA-256 of its bytes, plus `settings.json` and `settings.local.json`, each always present
  and `null` when missing. A folder that cannot be listed contributes nothing.

`TEAM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`.

## Start record (one per fast-track run)

File: `<git common dir>/speckit-team/patch/<key>.json`

| Field | Type | Meaning |
|---|---|---|
| `sha` | string, 40 to 64 hex | `HEAD` at the agent's first tool call |
| `dirty` | object: repo-relative path to string or `null` | each path that differed from `HEAD` or was untracked then, mapped to the SHA-256 (64 hex) of its bytes then, or `null` if it did not exist (deleted) or could not be read; left out of the counts while unchanged (research R14) |
| `team` | object: `TEAM_DIR`-relative path to string or `null` | `teamState()` at the first tool call (research R16) |
| `at` | string, ISO 8601 | when it was written |

- `<key>`: `agent_id`, else `session_id`; must match `^[\w-]{1,128}$` (research R8).
- Written once, at the first PreToolUse of that key; never rewritten or deleted by the hook.
- Valid only if `sha` is hex of 40 to 64 characters, `dirty` and `team` are each a plain object (not
  an array) whose values are each 64 lower-case hex characters or `null`, and
  `git cat-file -e <sha>^{commit}` succeeds. Otherwise it is **unusable** (research R9).

## Accepted record (one per worktree, research R15)

File: `<git dir>/speckit-team/patch-accepted.json`, where `<git dir>` is
`git rev-parse --absolute-git-dir` (the worktree's own git directory; in an ordinary checkout the
same `.git` that holds the start records).

| Field | Type | Meaning |
|---|---|---|
| `key` | string | the run's key, as in the start record |
| `sha` | string, 40 to 64 hex | the run's start commit |
| `files` | string[] | every path `patcher` changed since `sha`, sorted: production, test and doc, both sides of a rename; never a path in `start.dirty`, never a protected path |
| `untracked` | string[] | the members of `files` that git does not track yet (`git ls-files --others --exclude-standard`) |
| `lines` | number | `measure().lines` |
| `filesTouched` | number | `measure().files` |
| `at` | string, ISO 8601 | when the end check accepted the run |

- Removed by every call of mode `patch`, on any event, before anything else is decided (after only
  the hook's existing outside-Spec-Kit, unusable-input and wrong-event exits, which decide nothing).
- Written only by an end check that reaches outcome 4 (within budget, nothing protected or team
  changed, `HEAD` at `sha`), as its last step.
- Read by `/speckit-patch`: `git add -- <untracked>`, then `git commit -m <message> -- <files>`.

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
| `changed` | string[] | every changed path of any class except protected, both sides of a rename, not in `start.dirty`, sorted (the accepted record's `files`) |
| `untracked` | string[] | the members of `changed` that are untracked |

`stateOf(rel)`: SHA-256 hex of the file's bytes under the repo root, `null` if it cannot be read
(missing, a directory). Byte-equal content is unchanged, whatever its modification time.

Derived: `over = lines > PATCH_LINES || files > PATCH_FILES || binary.length > 0 || dirtyTouched.length > 0`
(research R14: a change the hook cannot separate from the developer's work counts as over).

Computed at the end check only: `teamChanged`, the sorted `TEAM_DIR`-relative paths whose entry in
`teamState()` differs from `start.team`, counting a path present on one side only. The end check
splits it by `TEAM_SETTINGS = ['settings.json', 'settings.local.json']`: the other paths (agents,
hook, skills) block; the settings paths end the run `FAILED` with no accepted record (plan.md
decision 15 point 5, owner decision of 2026-10-10; research R16).

Paths in `start.dirty` are left out of `lines`, `files`, `binary`, `protectedChanged` and `changed`;
a change to one shows only in `dirtyTouched`.

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
state puts it in `dirtyTouched`. A move git does not pair (new path untracked, or under 50% similar)
is a deletion plus an addition.

## Bash commands `patcher` may not run

`historyCommand(command)` returns the denied command's name (`git push`, `gh`) or `null`, by the
word rule of research R15. Denied git subcommands: `commit`, `commit-tree`, `merge`, `rebase`,
`cherry-pick`, `revert`, `am`, `stash`, `tag`, `branch`, `switch`, `update-ref`, `symbolic-ref`,
`notes`, `replace`, `filter-branch`, `push`, `pull`, `fetch`, `clone`, `remote`, `ls-remote`,
`submodule`, `send-email`, `request-pull`, and `checkout` with no `--` word after it. Denied
programs: `gh`, `hub`. A `command` that is not a string returns `null`.

## Run outcome (the report's last line)

`patcher` commits nothing in any outcome; the commit is the skill's.

| Word | When | Committed by the skill | PR |
|---|---|---|---|
| `DONE` | within budget, nothing protected or team changed, no commit, the existing tests passed | yes, one commit on `patch/<slug>`, only if the accepted record exists, its `sha` and `HEAD` are the start, and the installed hook's hash is unchanged | opened if the repo has a GitHub remote; never merged |
| `FAILED` | a test failed, or no test command could be run (reported as not run); or, reported by the skill, a commit check of step 4 failed, such as no accepted record because a settings file in the config directory changed during the run | no | no |
| `ESCALATE` | over budget, a binary production file, a file that was uncommitted at the start changed or committed, or the change needs a protected path | no | no |

The spec's four results map as: done to `DONE`; tests failed to `FAILED`; stopped for budget and
stopped for protected path to `ESCALATE`.

## State transitions of one run

```text
/speckit-patch: note HEAD and the hook's hash, git switch -c patch/<slug>
      │
      ▼
patcher, every hook call of mode patch ──► accepted record removed
      │
first tool call ──► start record written (sha, hash of each dirty file, hash of each team file)
      │
      ▼
each tool call: Write/Edit to a dirty-at-start file ──► denied (research R14)
                Bash naming git commit, push, gh, ... ──► denied (research R15)
      │
      ▼
measure ──► within budget ──► tool allowed
   │
   └──► over budget ──► restore needed and the call is a pure restore? ──► allowed
                              │
                              └──► denied (FR-006 message)
report (handback or stop): measure, hash the team
   protected, agent, hook or skill changed ──► blocked until restored (every attempt)
   committed (any size)      ──► blocked until git reset --soft <sha>
   settings file changed     ──► finishes, systemMessage: the file, run FAILED; no accepted record
   over                      ──► finishes, systemMessage: stopped for budget, work uncommitted,
                                 any changed dirty-at-start file named; no accepted record
   within                    ──► accepted record written; finishes, systemMessage: size against the budget
      │
      ▼
/speckit-patch: DONE with tests passed, record present, sha = HEAD = start, branch, hook hash unchanged?
   yes ──► git add -- <untracked>; git commit -m <message> -- <files>; git push -u; gh pr create
   no  ──► no commit, no PR; the work stays uncommitted. After DONE, a failed check is
           reported as FAILED, naming the check; FAILED and ESCALATE are relayed as reported
```
