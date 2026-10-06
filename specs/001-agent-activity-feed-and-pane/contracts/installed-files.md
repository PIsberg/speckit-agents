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

The mod's `test/` folder is not installed.

## The manifest `hooks/speckit-agents.install.json` (research R12)

```json
{
  "managedBy": "speckit-agents: managed by install.mjs",
  "createdDirs": ["agents", "hooks", "skills"],
  "createdSettings": false,
  "settingsBackup": "settings.json.bak-speckit-agents-2026-10-06T19-00-00-000Z",
  "forceBackups": [{ "file": "agents/architect.md", "backup": "agents/architect.md.bak-speckit-agents-2026-10-06T19-00-00-000Z" }]
}
```

- `createdDirs`: relative to `<claude dir>`, forward slashes, sorted: each of `agents/`, `hooks/`
  and `skills/` this installer created, on this install or an earlier one. Folders owned as a unit
  (`skills/speckit-team/`, `skills/speckit-activity/`) are not listed; the config directory itself
  never is.
- `createdSettings`: `true` when this installer created `settings.json`.
- `settingsBackup`: the install-time copy of a pre-existing `settings.json`, taken by the first
  install that changed it; `null` when there is none. Later installs never take another.
- `forceBackups`: each file `--force` replaced, with the copy of the user's original.
- Values are merged across installs: lists are unioned, `createdSettings` is or-ed, an existing
  `settingsBackup` is kept. So a second install writes the same bytes.

Rendering: every installed text file has `{{HOOK}}` replaced by
`<claude dir>/hooks/speckit-team.mjs` as an absolute path with forward slashes (constitution II).
In the mod it is an argv element for `$.process.run`, so no shell quoting is involved.

Collision rule: `skills/speckit-activity/` existing without the marker in `hooks/register.tsx` is a
collision, handled like an agent collision (refuse, or back up and replace with `--force`). So is a
`hooks/speckit-agents.install.json` without the marker.

## `settings.json` (owner decision 2026-10-06, audit findings C1)

The guarantee is about the value and the formatting conventions, not the bytes, because another
tool (lean-ctx, in the owner's setup) may rewrite `settings.json` between sessions and its changes
must survive an uninstall:

1. **Value**: after install then uninstall, `settings.json` parses to the same value as before
   (deep equality, key order included), plus whatever another tool changed in between.
2. **Formatting**: the file's indentation (spaces, their count, or tabs) and line endings (LF or
   CRLF) are kept on every write the installer makes, detected from the file as it is at that
   moment. When nothing else changed the content between install and uninstall, uninstall writes
   back the pre-install bytes exactly (from `settingsBackup`, after checking that its parsed value
   equals the current value minus the installer's entries), so compact spacing and inline arrays
   survive too.
3. **No files left behind**: uninstall never takes a backup; it deletes `settingsBackup` (and any
   older backups it recorded); it restores each `forceBackups` entry to its original name, so the
   user's own agent comes back and the copy is gone. A `settings.json` the installer created and
   that would be left as `{}` is deleted.
4. **Idempotent**: a second install changes nothing, including after another tool re-sorted the
   file (below).

### Gate entries are updated in place

The installer owns two gate entries (`PreToolUse` matcher `Skill`, `UserPromptExpansion` matcher
`speckit-implement|speckit\.implement`), recognised as today by a command containing
`speckit-team.mjs`. An owned entry already present for that event and matcher is updated where it
stands (command and timeout set, position kept); an owned entry that matches no current gate is
removed; a missing gate is appended. After another tool re-sorts `settings.json`, a re-run finds
every entry right and writes nothing. (Today it removes and re-appends its entries, so a re-sorted
file is rewritten, and backed up, on every run.)

## Install, in order

1. Validate everything it will read (sources exist, `settings.json` parses, the manifest's
   ownership) before writing anything.
2. Note which of `agents/`, `hooks/`, `skills/` and whether `settings.json` do not exist yet.
3. Write files (backing up `--force` replacements and recording them); merge the gate entries in
   place; when that changes a pre-existing `settings.json` and the manifest records no
   `settingsBackup`, copy the file first and record the copy's name.
4. Write the manifest with the merged values above.
5. Smoke check: run the installed hook in `gate` mode and in `emit` mode with empty stdin from the
   temp directory; require exit 0, and for `emit` its status JSON; anything else fails the install
   with the hook's output.

A second install writes nothing and reports every file, the manifest and `settings.json`
`unchanged`.

## Uninstall, in order

1. Remove owned files and folders (`hooks/speckit-activity.mjs`, `skills/speckit-activity/` and
   the existing ones) when marker-owned; move each `forceBackups` copy back to its original name.
2. `settings.json`: remove the installer's entries from the current value. If `createdSettings`
   and the result is `{}`: delete the file. Else if `settingsBackup` exists and its parsed value
   deep-equals the result: write the backup's bytes back. Else: write the result with the current
   file's indentation and line endings. Never back up. Then delete `settingsBackup`.
3. Read `createdDirs`, remove the manifest, then remove each listed directory that is empty,
   deepest first. A directory not in the list is never removed, empty or not. A listed directory
   holding other files is kept.
4. No manifest, one without the marker, or one that does not parse: remove the owned files and the
   gate entries as today (writing with the current file's indentation and line endings, no
   backup), remove no directory, delete no `settings.json`, and touch no backup file.

## Result (SC-009, as amended by the owner)

After install then uninstall: `settings.json` has the same value as before (or does not exist, if
it did not exist), with its indentation and line endings, and byte-identical when nothing else
changed it meanwhile; every other pre-existing file is byte-identical; no file or directory is
left that was not there before, backups included.

Per-repo data is never touched by the installer: `.git/speckit-team/activity/` and the fault file
in the temp directory stay; the uninstall message says where they are.
