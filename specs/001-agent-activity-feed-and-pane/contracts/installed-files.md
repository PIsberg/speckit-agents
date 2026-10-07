# Contract: what the installer adds (FR-021, SC-009)

The installer's machinery for ownership, settings and uninstall is delivered by PR #2 (commit
274bae6, research R12, R19), with tests. This contract states that machinery as this feature relies
on it, and what the feature adds to it. No new flag. `settings.json` gets no new entry.

## Files this feature adds

| Installed path (under `<claude dir>`) | Source | Ownership marker |
|---|---|---|
| `hooks/speckit-activity.mjs` | `hooks/speckit-activity.mjs` | marker comment, line 2 |
| `skills/speckit-activity/.claude-plugin/plugin.json` | `mod/speckit-activity/.claude-plugin/plugin.json` | folder owned via `hooks/register.tsx` |
| `skills/speckit-activity/hooks/hooks.json` | `mod/speckit-activity/hooks/hooks.json` | same |
| `skills/speckit-activity/hooks/register.tsx` | `mod/speckit-activity/hooks/register.tsx` | marker comment, line 1 |
| `skills/speckit-activity/hooks/*.ts`, `*.tsx` | the mod's other modules | same |
| `skills/speckit-activity/types/index.d.ts` | `mod/speckit-activity/types/index.d.ts` | same |

The mod's `test/` folder is not installed. The `skills/speckit-activity/` folder is removed as a
unit on uninstall, as `skills/speckit-team/` already is. Its subdirectories are therefore not listed
in the manifest's `createdDirs`.

Rendering: every installed text file has `{{HOOK}}` replaced by
`<claude dir>/hooks/speckit-team.mjs` as an absolute path with forward slashes (constitution II).
In the mod it is an argv element for `$.process.run`, so no shell quoting is involved.

Collision rule: `skills/speckit-activity/` existing without the marker in `hooks/register.tsx` is a
collision, handled like an agent collision (refuse, or back up and replace with `--force`).

## The manifest (PR #2)

`<claude dir>/hooks/speckit-agents.install.json`, carrying the marker:

```json
{
  "managedBy": "speckit-agents: managed by install.mjs",
  "createdDirs": ["agents", "hooks", "skills"],
  "createdSettings": false,
  "settingsBackup": "settings.json.bak-speckit-agents",
  "forceBackups": [{ "path": "agents/architect.md", "backup": "agents/architect.md.bak-speckit-agents" }]
}
```

- `createdDirs`: which of `agents/`, `hooks/`, `skills/` this installer created, merged across installs.
- `createdSettings`: whether this installer created `settings.json`.
- `settingsBackup`: the one copy of the user's original settings, taken the first time the
  installer changes them, under the fixed name `settings.json.bak-speckit-agents`; `null` when none.
- `forceBackups`: each file `--force` replaced, with its copy.
- A manifest without the marker is a collision.

## `settings.json` (PR #2; SC-009 as amended by the owner, 2026-10-06)

- Edited in place in the file's own indentation, line endings and trailing-newline state; gate
  entries updated where they stand, so a re-sorted file is left alone by a re-run.
- Uninstall writes the original bytes back when nothing else changed the settings since install;
  otherwise it keeps the other tool's changes and strips the gates in the file's own format. It
  never takes a backup, deletes `settingsBackup`, keeps a user's own empty `hooks` containers, and
  deletes a `settings.json` it created when nothing but `{}` would remain.

## Install, in order

1. Validate everything it will read (sources exist, `settings.json` parses, ownership of the
   manifest and of every target) before writing anything (PR #2).
2. Write files, the new ones included; merge the gate entries; write the manifest (PR #2).
3. Smoke check: run the installed hook in `gate` mode (PR #2) and, added by this feature, in `emit`
   mode with empty stdin from the temp directory; require exit 0, and for `emit` its status JSON;
   anything else fails the install with the hook's output (T013).
4. Final message names `/speckit-activity` (T064).

A second install writes nothing and reports every file, the manifest and `settings.json` `unchanged`.

## Uninstall, in order (PR #2, with this feature's files)

1. Remove owned files and folders, `hooks/speckit-activity.mjs` and `skills/speckit-activity/`
   included, when marker-owned; put back each `--force` replacement.
2. `settings.json` as above; never a backup; delete `settingsBackup`.
3. Remove the manifest, then each directory in `createdDirs` that is empty. A directory not in the
   list is never removed, empty or not.
4. No manifest, one without the marker, or one that does not parse: remove the owned files and the
   gates (in the file's own format, no backup), and nothing else.
5. The uninstall message says that per-repo streams stay in `.git/speckit-team/activity/` and that
   the stored view choice stays (T064).

**Not removed: the stored view choice** (third audit, finding K1). The mod's choice of view is kept
by Claude Code in the plugin's `$.store` file (on this machine
`<claude dir>/plugins/store/<plugin>_<source>-<hash>.json`), or, under research V13's fallback, in
`<claude dir>/hooks/speckit-activity.view.json` written by the mod at run time. Neither is written by
the installer, so uninstall does not touch them ("and nothing else"), and a prefix match could hit a
same-named plugin from another source. The README's uninstall section names both and says that
deleting them only resets the view to plain. Under the fallback, a `hooks/` directory the installer
created stays because that file is in it.

## Result (SC-009, as amended by the owner)

After install then uninstall: `settings.json` has the same value as before (or does not exist, if it
did not exist), with its indentation and line endings, byte-identical when nothing else changed it
meanwhile; every other pre-existing file is byte-identical; no file or directory written by the
installer is left. Files Claude Code or the mod wrote at run time (the stored view choice) are not
the installer's and stay.

Per-repo data is never touched by the installer: `.git/speckit-team/activity/` and the fault file
in the temp directory stay.
