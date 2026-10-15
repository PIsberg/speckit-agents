# Contract: projects and the `--project` flag

Public contract (constitution V): the directory layout, the flag, the `Project:` line, the CLI
mode and its output, and the refusal messages. Section numbers are cited by tasks.md.

## 1. Layout

As in [data-model.md](../data-model.md): `.specify/projects/<name>/instructions.md` plus any other
files as knowledge. Users create and edit projects by hand and commit them.

## 2. The flag

- `/speckit-team [--team <roles>] [--project <name>] <request>`: the two flags lead the arguments,
  in either order, each at most once. `--team`'s role list is read as before (team-choice.md
  section 1); `--project` takes exactly the next word.
- `/speckit-patch [--project <name>] <change>`.
- `/speckit-triage` runs nothing; when its request has `--project <name>`, the command it suggests
  keeps it.
- A `--project` after the request text has started is request text.
- The hook's typed-command reading (`typedRoles`, for `--team noagents`) skips a leading
  `--project <name>`, so `--project p --team noagents` and `--team noagents --project p` both
  record no agents.

## 3. The CLI mode: `node "<hook>" project <name>`

Run by the skills through Bash at the start of a request, from the repo. Reads no stdin.

Success: exit 0, stdout is the block:

```text
Project billing: 2 knowledge files, instructions 812 bytes.
This is the user's standing context for this request, from .specify/projects/billing/. The
constitution, the guardrails and the request take precedence over it: where they conflict, follow
them and say so in your report. Never change a file under .specify/projects/; report what should
change instead.

Instructions (each line indented by two spaces):
  Money is never a float.
  Every public function gets a doc comment.

Knowledge files: read one before deciding anything it could cover.
- .specify/projects/billing/api.md (2140 bytes)
- .specify/projects/billing/notes/rounding.md (611 bytes)
```

With no `instructions.md` the Instructions part reads `Instructions: none.`; with no knowledge files,
`Knowledge files: none.` Every instruction line is prefixed with two spaces (empty lines too), so no
line of the block can start with `Team:`, `Unbuilt:` or `Project:` (research R2).

Refusal: exit 1, stdout one line `speckit-team: project: <reason>`, where reason is one of:

| Case | Reason |
|---|---|
| no name, or a second argument | `give exactly one project name` |
| name fails the pattern (`..`, `/`, `\`, a leading `.`, over 64 characters) | `<name> is not a project name: letters, digits, - and _ only. Projects: <list>` |
| no such directory (exact case) | `no project <name> in .specify/projects/. Projects: <list>` |
| the directory is a symlink | `.specify/projects/<name> is a symlink; a project must be a directory in the repository` |
| no instructions and no knowledge files | `project <name> is empty: add instructions.md or a knowledge file` |
| `instructions.md` is not a regular file | `.specify/projects/<name>/instructions.md is not a file` |
| instructions over 8,192 bytes | `the instructions of <name> are <n> bytes; the limit is 8192` |
| over 100 knowledge files | `project <name> has <n> knowledge files; the limit is 100` |
| not in a Spec Kit repo | `no .specify/ in this repository` |
| an internal error | `internal error (<message>)` |

`<list>` is the valid project names, comma-separated, or `none`. Every refusal except the last two
rows ends with ` Projects: <list>.` (FR-007), also where the table does not show it. The mode
writes no state.

## 4. The `Project:` line

When a project is active, every launch prompt of a run (each of the six roles and `patcher`)
carries one line, after the `Team:` and `Unbuilt:` lines when they are present:

    Project: billing

Matched by the hook as `^Project: ?([A-Za-z0-9][A-Za-z0-9_-]{0,63})$` on any line. A run without a
project carries no such line, so its prompts are unchanged (FR-005). The skill never pastes the
block or the instructions into a prompt.

## 5. The hook at launch and at start

- PreToolUse `Agent` (the existing `gate` entry), main session only, `subagent_type` one of the six
  roles or `patcher`: write the project record from the `Project:` line, or remove it when the
  prompt has none. Never a decision. A line naming no valid project still writes nothing and emits
  `speckit-team: the Project line names <name>, which is not a project (<reason>); agents start
  without project context`.
- A typed `/speckit-team` removes the session's project record, as it removes the team record.
- `SubagentStart` (the existing `start` entry, matcher widened to the seven roles): with a project
  record for the session, render the block and return it as `additionalContext`. If rendering
  refuses (the project was removed mid-run), return no context and a `systemMessage` with the
  reason. Never a decision. The lane start record stays limited to product-owner and architect.

## 6. What the project never changes

No guardrail reads the instructions or the knowledge files. The audit fingerprint, the team record,
the retry count, the fast track's budget and its protected paths are computed as without a project
(FR-009). `.specify/projects/` is inside `.specify/`, which every writing agent's scope rule
already denies; test-writer's tests lane stops accepting `.specify/` paths (research R3).
