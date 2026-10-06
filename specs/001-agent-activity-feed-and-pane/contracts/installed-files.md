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
{ "managedBy": "speckit-agents: managed by install.mjs", "createdDirs": ["agents", "hooks", "skills"] }
```

`createdDirs` lists, relative to `<claude dir>`, forward slashes, sorted, each of `agents/`,
`hooks/` and `skills/` that this installer created, on this install or an earlier one. Folders
owned as a unit (`skills/speckit-team/`, `skills/speckit-activity/`) are not listed; the config
directory itself never is.

The mod's `test/` folder is not installed.

Rendering: every installed text file has `{{HOOK}}` replaced by
`<claude dir>/hooks/speckit-team.mjs` as an absolute path with forward slashes (constitution II).
In the mod it is an argv element for `$.process.run`, so no shell quoting is involved.

Collision rule: `skills/speckit-activity/` existing without the marker in `hooks/register.tsx` is a
collision, handled like an agent collision (refuse, or back up and replace with `--force`).

Collision rule for the manifest: `hooks/speckit-agents.install.json` existing without the marker is
a collision like any other.

Install, in order: validate everything it will read (sources exist, `settings.json` parses) before
writing anything; note which of `agents/`, `hooks/`, `skills/` do not exist yet; write files; write
the manifest with `createdDirs` = the existing manifest's list (if it parses and carries the marker)
plus the directories noted now; merge settings as today; smoke check runs the installed hook in
`gate` mode and in `emit` mode with empty stdin from the temp directory and expects exit 0 (and,
for `emit`, JSON on stdout). A second install writes an identical manifest and reports it
`unchanged`.

Uninstall: remove `hooks/speckit-activity.mjs` and the `skills/speckit-activity/` folder when
marker-owned; remove the two settings gates as today; read `createdDirs` from the manifest, remove
the manifest, then remove each listed directory that is empty, deepest first. A directory not in
the list is never removed, empty or not, so an empty directory that existed before the install
survives it. A listed directory holding other files is kept. No manifest, one without the marker,
or one that does not parse: no directory is removed (fails safe).

Byte-identity (SC-009): install then uninstall leaves every pre-existing file byte-identical and
adds no file or directory, except `*.bak-speckit-agents-*` backups, which are kept on purpose.
`settings.json` is written back with its original indentation and trailing-newline state. A second
install changes nothing.

Per-repo data is never touched by the installer: `.git/speckit-team/activity/` and the fault file
in the temp directory stay; the uninstall message says where they are.
