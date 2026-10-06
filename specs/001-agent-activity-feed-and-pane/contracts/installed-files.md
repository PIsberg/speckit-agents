# Contract: what the installer adds (FR-021, SC-009)

Additions to what `install.mjs` installs today. No new flag. `settings.json` gets no new entry.

| Installed path (under `<claude dir>`) | Source | Ownership marker |
|---|---|---|
| `hooks/speckit-activity.mjs` | `hooks/speckit-activity.mjs` | marker comment, line 2 |
| `skills/speckit-activity/.claude-plugin/plugin.json` | `mod/speckit-activity/.claude-plugin/plugin.json` | folder owned via `hooks/register.tsx` |
| `skills/speckit-activity/hooks/hooks.json` | `mod/speckit-activity/hooks/hooks.json` | same |
| `skills/speckit-activity/hooks/register.tsx` | `mod/speckit-activity/hooks/register.tsx` | marker comment, line 1 |
| `skills/speckit-activity/hooks/*.ts`, `*.tsx` | the mod's other modules | same |
| `skills/speckit-activity/types/index.d.ts` | `mod/speckit-activity/types/index.d.ts` | same |
| `hooks/speckit-agents.install.json` | written by the installer (no source file) | `managedBy` value contains the marker |

The manifest `hooks/speckit-agents.install.json` (research R12):

```json
{ "managedBy": "speckit-agents: managed by install.mjs", "createdDirs": ["agents", "hooks", "skills"], "createdSettings": true }
```

- `createdDirs` lists, relative to `<claude dir>`, forward slashes, sorted, each of `agents/`,
  `hooks/` and `skills/` that this installer created, on this install or an earlier one. Folders
  owned as a unit (`skills/speckit-team/`, `skills/speckit-activity/`) are not listed; the config
  directory itself never is.
- `createdSettings` is `true` when this installer created `settings.json` (it did not exist before
  the first install that wrote this manifest), on this install or an earlier one; else `false`.

The mod's `test/` folder is not installed.

Rendering: every installed text file has `{{HOOK}}` replaced by
`<claude dir>/hooks/speckit-team.mjs` as an absolute path with forward slashes (constitution II).
In the mod it is an argv element for `$.process.run`, so no shell quoting is involved.

Collision rule: `skills/speckit-activity/` existing without the marker in `hooks/register.tsx` is a
collision, handled like an agent collision (refuse, or back up and replace with `--force`). So is a
`hooks/speckit-agents.install.json` without the marker.

## `settings.json` entries: updated in place

The installer owns two gate entries (`PreToolUse` matcher `Skill`, `UserPromptExpansion` matcher
`speckit-implement|speckit\.implement`), recognised as today by a command containing
`speckit-team.mjs`.

- An owned entry already present for that event and matcher is updated where it stands: its
  command and timeout are set, its position in the array and every other entry are left alone.
- An owned entry that matches no current gate is removed. A missing gate is appended.
- So after another tool re-sorts `settings.json`, a re-run finds every entry already right and
  writes nothing (reported `unchanged`, no backup). Today it removes and re-appends its entries,
  so a re-sorted file is rewritten and backed up on every run.

## Backups

A `*.bak-speckit-agents-<time>` copy is made only of a file that holds content the installer did
not write:

- `settings.json` is backed up before a change when it existed before the install, or when it now
  holds anything besides the installer's own gate entries.
- A `settings.json` the installer created (`createdSettings`) and that holds nothing but its
  entries is changed without a backup, and on uninstall, when removing the entries would leave
  `{}`, it is deleted instead of being written back as `{}`.
- Agent and skill files replaced with `--force` are backed up as today.

## Install, in order

1. Validate everything it will read (sources exist, `settings.json` parses, the manifest's
   ownership) before writing anything.
2. Note which of `agents/`, `hooks/`, `skills/` and whether `settings.json` do not exist yet.
3. Write files; merge the gate entries in place (above).
4. Write the manifest: `createdDirs` = the existing manifest's list (if it parses and carries the
   marker) plus the directories noted now; `createdSettings` = the existing value or-ed with
   whether `settings.json` was created now.
5. Smoke check: run the installed hook in `gate` mode and in `emit` mode with empty stdin from the
   temp directory; expect exit 0, and for `emit` its status JSON.

A second install writes nothing and reports every file, the manifest and `settings.json`
`unchanged`.

## Uninstall, in order

1. Remove owned files and folders (`hooks/speckit-activity.mjs`, `skills/speckit-activity/` and
   the existing ones) when marker-owned.
2. Remove the installer's gate entries from `settings.json`. If `createdSettings` is true and the
   result is `{}`, delete `settings.json` and take no backup; otherwise write it back with its
   original indentation and trailing-newline state, backing it up first.
3. Read `createdDirs`, remove the manifest, then remove each listed directory that is empty,
   deepest first. A directory not in the list is never removed, empty or not, so an empty
   directory that existed before the install survives it. A listed directory holding other files
   is kept.
4. No manifest, one without the marker, or one that does not parse: no directory is removed and
   `settings.json` is never deleted (fails safe; an empty `{}` may be left behind).

## Byte-identity (SC-009)

Install then uninstall leaves every pre-existing file byte-identical and adds no file or
directory. That includes a config directory that had no `settings.json`: none is left behind, and
no backup is. The only files that can remain are backups of the user's own content (a pre-existing
`settings.json`, files replaced with `--force`), kept on purpose.

Per-repo data is never touched by the installer: `.git/speckit-team/activity/` and the fault file
in the temp directory stay; the uninstall message says where they are.
