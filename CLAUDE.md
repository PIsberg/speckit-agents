# speckit-agents

Source for a Claude Code subagent team around GitHub Spec Kit. `README.md` explains the design;
this file is how to work on it.

## Layout
- `agents/*.md`: subagent definitions. `{{HOOK}}` is replaced by the installer with the absolute
  path of the installed hook script. Never hard-code a path or use `$HOME` there.
- `hooks/speckit-team.mjs`: every guardrail. One script, modes `scope`, `gate`, `verdict`, `result`, `ends`, `lane`.
- `skills/speckit-team/SKILL.md`: the `/speckit-team` orchestration skill.
- `install.mjs`: installer (`setup.sh` / `setup.ps1` only check for Node and call it).
- `docs/media/`: the README's GIFs, the vhs tapes that record them, `record.mjs` that runs the
  tapes against a scratch Spec Kit repo, and the demo feature in `demo/`. Re-record after changing
  what an agent or hook shows on screen (README.md, "Developing").
- `mods/speckit-board/`: an experimental Claude Code mod (function hooks, TypeScript run as source)
  that draws the pipeline's state. `install.mjs --board` installs it through `claude plugin`, with
  this checkout as the marketplace (`.claude-plugin/marketplace.json`), so it is read in place;
  `claude --plugin-dir` loads it for one session. Its own tests are
  `mods/speckit-board/tests/*.test.ts(x)` under `claude plugin test`.
- `test/`: `node:test` suites. `hook.test.mjs` drives the hook with hook JSON on stdin;
  `install.test.mjs` installs into throwaway config dirs (its board tests run the real
  `claude plugin` and are skipped without it); `board-mod.test.mjs` checks the mod's
  fingerprint against the hook's and runs `claude plugin validate` and `claude plugin test` on it
  (skipped, not passed, without a `claude` executable on PATH).

## Verify
- `npm test`: all suites, no network, 56 s on Windows (60 tests, 2026-10-08; the four installer tests
  that run the real `claude plugin` take 38 s of it).
- CI (`.github/workflows/test.yml`) runs `npm test` on Linux, macOS and Windows for every PR and
  push to main, with Claude Code 2.1.293 from npm and `SPECKIT_REQUIRE_CLAUDE=1`, which makes the
  tests that need `claude` fail instead of skip when it is missing.
- Unit tests cannot prove Claude Code fires a hook. After changing a hook command, an event or a
  matcher, install and run a live check in a scratch Spec Kit repo (README.md, "Verifying").

## Rules
- Every file the installer writes keeps the `speckit-agents: managed by install.mjs` marker line;
  install and uninstall use it to tell their own files from the user's.
- A new hook command goes in the agent frontmatter or `SETTINGS_GATES` in `install.mjs`, and the
  README's guardrail table.
- Hooks fail open when they crash. Any change that can make the script throw needs a test.
- `fingerprint()` in `hooks/speckit-team.mjs` has a twin in `mods/speckit-board/hooks/model.ts`.
  Change both, and the pinned value in `test/board-mod.test.mjs` and the mod's `model.test.ts`.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/001-agent-activity-feed-and-pane/plan.md`
<!-- SPECKIT END -->
