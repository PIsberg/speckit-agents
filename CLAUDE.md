# speckit-agents

Source for a Claude Code subagent team around GitHub Spec Kit. `README.md` explains the design;
this file is how to work on it.

## Layout
- `agents/*.md`: subagent definitions. `{{HOOK}}` is replaced by the installer with the absolute
  path of the installed hook script. Never hard-code a path or use `$HOME` there.
- `hooks/speckit-team.mjs`: every guardrail. One script, modes `scope`, `gate`, `verdict`, `result`, `ends`, `lane`.
- `skills/speckit-team/SKILL.md`: the `/speckit-team` orchestration skill.
- `install.mjs`: installer (`setup.sh` / `setup.ps1` only check for Node and call it).
- `docs/media/`: the README's GIFs and the board's screenshot, the vhs tapes that record them,
  `record.mjs` that runs the tapes against a scratch Spec Kit repo, and the demo feature in
  `demo/`. Re-record after changing what an agent, a hook or the board shows on screen (README.md,
  "Developing"). `architecture-visualized.svg` is drawn by hand, not recorded: edit it when an
  agent's model or lane, a pipeline stage or the retry limit changes.
- `mods/speckit-board/`: an experimental Claude Code mod (function hooks, TypeScript run as source)
  that draws the pipeline's state. `install.mjs --board` installs it through `claude plugin`, with
  this checkout as the marketplace (`.claude-plugin/marketplace.json`), so it is read in place;
  `claude --plugin-dir` loads it for one session. Its own tests are
  `mods/speckit-board/tests/*.test.ts(x)` under `claude plugin test`. It is a prototype for
  features 001 and 002, retired once 001's view ships (owner decision, #11): do not build 001 or
  002 on it, and do not change 001's spec for it (README.md, "Board mod").
- `tools/usage.mjs`: input tokens of a recorded session and its agents, from the transcript, counted
  once per API response. Measure a change to the skill or an agent with it before and after
  (README.md, "Developing").
- `test/`: `node:test` suites. `hook.test.mjs` drives the hook with hook JSON on stdin;
  `install.test.mjs` installs into throwaway config dirs (its board tests run the real
  `claude plugin` and are skipped without it); `board-mod.test.mjs` checks the mod's
  fingerprint, retry limit and role colors against the hook's and `agents/*.md`, and runs
  `claude plugin validate` and `claude plugin test` on it
  (skipped, not passed, without a `claude` executable on PATH); `usage.test.mjs` runs
  `tools/usage.mjs` on a synthetic transcript; `e2e.test.mjs` runs the real `claude -p` against a
  fake Anthropic API on localhost, first with no model, then with a scripted one that makes an
  agent's tool calls, and reads each hook's decision from the next request (no login, $0; skipped
  without `claude` like the board tests).

## Verify
- `npm test`: all suites, no network beyond localhost, 66 s on Windows (92 tests, 2026-10-09; the
  four installer tests that run the real `claude plugin` and the 14 e2e tests take most of it, and
  a run on a busy machine took twice as long).
- CI (`.github/workflows/test.yml`) runs `npm test` on Linux, macOS and Windows for every PR and
  push to main, with Claude Code 2.1.293 from npm and `SPECKIT_REQUIRE_CLAUDE=1`, which makes the
  tests that need `claude` fail instead of skip when it is missing. On Linux it then runs `tsc`
  on the board mod (README.md, "Verifying", has the local command).
- Unit tests cannot prove Claude Code fires a hook; `e2e.test.mjs` does, for every hook entry the
  installer writes, under `claude -p`. A new hook entry gets a case there; check that the case
  fails with the installed hook replaced by `process.exit(0)`. After changing a hook command, event
  or matcher, also run the live check in a scratch Spec Kit repo (README.md, "Verifying").

## Rules
- Every file the installer writes keeps the `speckit-agents: managed by install.mjs` marker line;
  install and uninstall use it to tell their own files from the user's.
- A new hook command goes in the agent frontmatter or `SETTINGS_GATES` in `install.mjs`, and the
  README's guardrail table.
- Hooks fail open when they crash. Any change that can make the script throw needs a test.
- `fingerprint()` in `hooks/speckit-team.mjs` has a twin in `mods/speckit-board/hooks/model.ts`.
  Change both, and the pinned value in `test/board-mod.test.mjs` and the mod's `model.test.ts`.
- `ROLE_COLOR` in `mods/speckit-board/hooks/model.ts` copies the `color:` line of each
  `agents/*.md`, and its `MAX_RED` the hook's. Change both; `test/board-mod.test.mjs` holds each
  pair together.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/001-agent-activity-feed-and-pane/plan.md`
<!-- SPECKIT END -->
