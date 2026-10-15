# Data model: Project knowledge for the team

## Project (user-owned files, committed with the repo)

```text
.specify/projects/<name>/
├── instructions.md      # optional: the custom instructions
└── <anything else>      # each regular file, at any depth, is a knowledge file
```

- `name`: `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` and equal, case included, to a directory entry of
  `.specify/projects/` (so `Billing` and `billing` are never both accepted on Windows).
- Knowledge files: every regular file under the directory except `instructions.md` at its top,
  names starting with `.` (files and directories), and symlinks (never followed, never listed).
  Sorted by path, repo-relative with forward slashes.
- Limits (D3): `instructions.md` at most 8,192 bytes; at most 100 knowledge files.
- Valid when: the directory exists and is no symlink, and it holds instructions, at least one
  knowledge file, or both.

## Project record (hook state, one per session)

`.git/speckit-team/project/<session_id>.json`, beside the team record:

```json
{ "session_id": "abc123", "name": "billing", "at": "2026-10-15T10:00:00.000Z" }
```

- Written at the main session's `Agent` launch of any of the seven roles whose prompt has a
  `Project: <name>` line; removed at a launch of one of them without that line, and at a typed
  `/speckit-team`, which starts a new request (FR-006). `/speckit-patch` launches exactly one
  `patcher`, whose launch sets or removes the record, so it needs no typed-command entry.
- Read at `SubagentStart` of the seven roles to render the block.
- Metadata only (FR-013): never the instructions text or a file's contents.
- Missing or unreadable: no project context, and a `systemMessage` when unreadable.

## Rendered block

Produced by one function for the CLI (`project <name>`) and for `SubagentStart`
([contracts/project.md](contracts/project.md), section 3). Rendered from the files as they are at
that moment: an agent started later sees later edits.
