# speckit-agents

Source for a Claude Code subagent team around GitHub Spec Kit: eight agents, three skills, one hook
script and an installer. This file is how to work on it; the map below says where the rest is.

## Docs map
Read the part you need, not the whole file: `grep -n '^#' README.md`, then that line range.
- `README.md`: what a user sees and does: install, the pipeline and choosing the team, the guardrail
  table, the audit gate, the retry and lane checks, the fast track, the board mod, verifying,
  troubleshooting, known limits, developing.
- `docs/measurements.md`: what runs cost, and which prompt rule each finding led to.
- `docs/live-results.md`: what was seen in a real session, by date.
- `docs/CHANGELOG.md`: every commit by day, written by `node tools/changelog.mjs`; regenerate it as a
  PR's last commit (a chain's last PR), never edit it by hand.
- `docs/rules.md`: every rule of the skills and agents and what holds it: hook, script, pinned text, or
  nothing. A section added, changed or dropped fails `test/rules.test.mjs` until its entry is reviewed.
- `docs/architecture.md`: pipeline overview, security-reviewer dual-gate lifecycle, and diagram prompt.
- `.specify/memory/constitution.md`: the rules every change is held to (tests first, guardrails never
  fail silently, docs in the same change).
- `specs/<NNN-feature>/`: one feature's spec, plan, contracts and tasks, and the decisions behind it.

## Layout
- `agents/*.md`: the eight subagents, `patcher` (the fast track's) among them. The installer replaces
  `{{HOOK}}` with the installed hook's absolute path; never write a path or `$HOME` there.
- `hooks/speckit-team.mjs`: every guardrail, one script; modes `scope`, `gate`, `verdict`, `result`,
  `ends`, `start`, `lane`, `patch`, `relay`, `project`, `check`. `hooks/speckit-drift.mjs`: the drift check, installed
  beside it and loaded at spec-gatekeeper's `APPROVED` (#228); `tools/drift.mjs` is its command line.
- `skills/<name>/SKILL.md`: `/speckit-team` runs the pipeline, `/speckit-patch` the fast track (one
  `patcher`), `/speckit-triage` suggests a track and runs nothing.
- `skills/speckit-role-<role>/SKILL.md`: not in the repo; `install.mjs` generates seven from
  `agents/<role>.md` for `--team skill-agents`, with `scope role` and `lane role` in their frontmatter.
- `install.mjs`: the installer; `setup.sh` and `setup.ps1` only check for Node and call it.
- `mods/speckit-board/`: an experimental board mod, read in place through `claude plugin` with this
  checkout as the marketplace. A prototype retired once feature 001's view ships (owner decision,
  #11): build neither 001 nor 002 on it, and do not change 001's spec for it.
- `tools/usage.mjs`: a session's input tokens from its transcript; measure a skill or agent change
  before and after. `tools/live-board.mjs`: the board's interactive checks, vhs driving a real session
  against a fake API at $0; run it after changing what the board draws or its buttons do.
  `tools/drift.mjs`: finished features' test tasks against the tests as they are now, no model.
  `tools/changelog.mjs`: `docs/CHANGELOG.md` from `git log --no-merges`; `--check` says if it is behind.
  `tools/test.mjs`: `npm test`, every `test/*.test.mjs` under the node that runs it (#214).
  `tools/full-run.mjs`: a whole `/speckit-team` run with real models on `test/fixtures/full-run/`, for
  the `full-run` workflow (manual, weekly, `e2e` label; skipped until `FULL_RUN_ENABLED` and the key);
  `--login` runs it on your own Claude Code login instead of a key, `--case` picks a scored case
  (`pressure`, `defect`, `defect-control`, `untested-fr`, `must-broken`; `tools/eval.mjs` repeats them per arm and counts right answers, #188), `--side-by-side` builds two `[P]`
  slices side by side (#114), `--two-slices` the same request one at a time.
- `docs/media/`: recordings, their tapes and `record.mjs` (README.md, "Recording the demo media").
- `.claude/settings.json`: `CLAUDE_CODE_FORK_SUBAGENT=0`, so the team's agents run in the foreground
  when it builds features here.

## Verify
- `npm test`: every suite, no network beyond localhost, 542 tests (the files and what each runs:
  README.md, "Test suite"), through `tools/test.mjs`, which takes `node --test` options and files
  (`node tools/test.mjs --test-name-pattern=x test/hook.test.mjs`). Tests that need `claude` skip
  without it. `SPECKIT_E2E_CONCURRENCY=1` runs the e2e tests one by one.
- CI runs it on Linux, macOS and Windows with Claude Code 2.1.293 (`package.json` `config.claudeCode`,
  the oldest supported, moved by hand) and `SPECKIT_REQUIRE_CLAUDE=1` (those tests fail instead of
  skipping), then on Linux `npm ci` and type-checks the board mod:
  `npx --no-install tsc -p mods/speckit-board --noEmit`, after a
  `claude --plugin-dir mods/speckit-board` session has laid its types, and lints with
  `npx --no-install eslint` (`eslint.config.mjs`; pre-commit's eslint hook runs the same one, from
  `node_modules`, so a clone needs `npm ci` once before it can commit JavaScript). A
  `live-board` job runs `tools/live-board.mjs` on Linux and macOS (vhs from its release, version and
  checksums in the job's `env:`).
- Every version is pinned in one place (README.md, "Where each version is pinned"), held by
  `test/versions.test.mjs`: never write a tool's version into a workflow, a hook config or these docs.
- Unit tests cannot prove Claude Code fires a hook; `e2e.test.mjs` does. A new hook entry gets a case
  there that fails with the installed hook replaced by `process.exit(0)` (`SPECKIT_E2E_NO_HOOK=1`).
  After changing a hook's command, event or matcher, also run README.md's "Live check".

## Rules
- Skill and agent authoring limits (line budgets, description length, no model name in a body, no colliding
  descriptions) are held by `test/skills.test.mjs`; the rest are review criteria in the constitution.
- Every file the installer writes keeps the `speckit-agents: managed by install.mjs` marker line;
  install and uninstall tell their own files from the user's by it. The installer stamps the build after
  it (#230); `buildOf()` in `install.mjs` and in the hook are twins, held by `test/install.test.mjs`.
- A new hook command goes in an agent's frontmatter or `SETTINGS_GATES` in `install.mjs`, and in the
  README's guardrail table.
- Hooks fail open when they crash. Any change that can make the script throw needs a test.
- An agent declares `omitClaudeMd: true` exactly when it cannot write (`disallowedTools` has `Write`), so
  it starts without the user's and project's `CLAUDE.md`. Held by `test/prompt-caching.test.mjs`; that
  Claude Code leaves them out, by `test/e2e.test.mjs`. A rule such an agent must check goes in the
  constitution.
- `ROLE_LANES` in the hook equals each agent's `scope` rule in its frontmatter (the role skills'
  `scope role` reads it). Role-skill frontmatter, generated by `install.mjs`, is a second place for a
  hook command, with the README's guardrail table.
- Twins, each held by `test/board-mod.test.mjs`: `fingerprint()` in the hook and in
  `mods/speckit-board/hooks/model.ts` (also pinned in the mod's `model.test.ts`); the mod's
  `ROLE_COLOR` and each `agents/*.md` `color:` line; its `MAX_RED` and the hook's; its `WORDS` and the
  words test-writer and spec-gatekeeper pass to `ends`. Change both halves. Also `TEST_PATTERNS` in the hook and in `hooks/speckit-drift.mjs`, held by `test/drift.test.mjs`. Also `NO_NETWORK` and `NO_FORGE_LOGIN`
  in the hook and in `install.mjs`, which writes the exact allow rule for the hook's export line (#122,
  #123), held by `test/hook-patch.test.mjs`. A change to the line adds the old rule to
  `OLD_NO_NETWORK_RULES` in `install.mjs`, so a reinstall replaces it.
- `OWN_SOURCES` in the hook lists the team's own sources, which the fast track protects only in this
  repository, recognised by the `name` in the committed `package.json` (itself in the list). A new
  guardrail file of the team gets an entry and a case in `test/hook.test.mjs`.
- `Team:` line of every launch prompt in a run with a chosen team: the skill writes it, the hook reads
  it with `TEAM_ROLES` (the seven roles without `patcher`), spec-gatekeeper reports an absent role's check
  as skipped. `Unbuilt:` line after it: the task IDs of an absent test-writer or implementer, which
  spec-gatekeeper's open-task check skips. Both halves are held together by `test/install.test.mjs`.
- `Project:` line of every launch prompt in a run with an active project: the skills (`speckit-team`
  and `speckit-patch`) write it, the hook reads it with `parseProject` at `Agent` PreToolUse, and
  `SubagentStart` injects the block as `additionalContext`. Both halves are held together by
  `test/install.test.mjs`.
- `--team noagents` reaches the hook only from the user's typed `/speckit-team` (`UserPromptExpansion`,
  `typedRoles`), never from a launch prompt, because it opens the main session's `/speckit-implement`
  gate. Held by `test/install.test.mjs` and `test/hook.test.mjs`; the typed path by `test/e2e.test.mjs`.
- product-owner's and architect's `lane only` prefixes at Stop equal their `scope only` prefixes; the
  `start` entry in `SETTINGS_GATES` records where they start. Held by `test/install.test.mjs`.
- In `--team skill-agents` the report's last line (`VERDICT: PASS`, `APPROVED`) is read from the next Skill call's `args` first line: the skill writes it, the hook reads it with the Stop's last message beside the transcript; both halves are held by `test/install.test.mjs` and `test/hook.test.mjs`.
- The accepted record's fields, and the end record's (`patch-undo.json`: `undo`, `outcome`, `message`),
  are read by `skills/speckit-patch/SKILL.md`; change both, and `test/install.test.mjs`.
- Prompt rules with a half in the skill and a half in an agent (the `## Open Decisions` section, the
  `dictated:` prefix, a `contested` finding and where its ruling is recorded, `Spec:` lines, `last round`, `worktree`,
  the architect's `Round <n>:` report lines, answers that take every recommendation), the Bash `timeout` sentence of the four
  agents that run tests, and the agent body lengths README.md states are held together by
  `test/install.test.mjs`. The skill's rule to commit with the next launch relies on Claude Code running
  one message's calls in order, its side-by-side slices on calls in one message running together and on
  a worktree starting from the last commit; `test/e2e.test.mjs` pins all three.

The SPECKIT block below is Spec Kit's: `speckit-plan` rewrites it to name the plan of the feature it
planned last. Read that plan only when you work on that feature.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/009-skill-agents-team/plan.md`
<!-- SPECKIT END -->
