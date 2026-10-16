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
- `docs/architecture.md`: pipeline overview, security-reviewer dual-gate lifecycle, and diagram prompt.
- `.specify/memory/constitution.md`: the rules every change is held to (tests first, guardrails never
  fail silently, docs in the same change).
- `specs/<NNN-feature>/`: one feature's spec, plan, contracts and tasks, and the decisions behind it.

## Layout
- `agents/*.md`: the eight subagents, `patcher` (the fast track's) among them. The installer replaces
  `{{HOOK}}` with the installed hook's absolute path; never write a path or `$HOME` there.
- `hooks/speckit-team.mjs`: every guardrail, one script; modes `scope`, `gate`, `verdict`, `result`,
  `ends`, `start`, `lane`, `patch`, `project`.
- `skills/<name>/SKILL.md`: `/speckit-team` runs the pipeline, `/speckit-patch` the fast track (one
  `patcher`), `/speckit-triage` suggests a track and runs nothing.
- `install.mjs`: the installer; `setup.sh` and `setup.ps1` only check for Node and call it.
- `mods/speckit-board/`: an experimental board mod, read in place through `claude plugin` with this
  checkout as the marketplace. A prototype retired once feature 001's view ships (owner decision,
  #11): build neither 001 nor 002 on it, and do not change 001's spec for it.
- `tools/usage.mjs`: a session's input tokens from its transcript; measure a skill or agent change
  before and after. `tools/live-board.mjs`: the board's interactive checks, vhs driving a real session
  against a fake API at $0; run it after changing what the board draws or its buttons do.
- `docs/media/`: recordings, their tapes and `record.mjs` (README.md, "Recording the demo media").
- `.claude/settings.json`: `CLAUDE_CODE_FORK_SUBAGENT=0`, so the team's agents run in the foreground
  when it builds features here.

## Verify
- `npm test`: every suite, no network beyond localhost, 328 tests (the files and what each runs:
  README.md, "Test suite"). Tests that need `claude` skip without it. `SPECKIT_E2E_CONCURRENCY=1` runs
  the e2e tests one by one.
- CI runs it on Linux, macOS and Windows with Claude Code 2.1.293 and `SPECKIT_REQUIRE_CLAUDE=1`
  (those tests fail instead of skipping), then type-checks the board mod on Linux:
  `npx -p typescript@5.6.3 tsc -p mods/speckit-board --noEmit`, after a
  `claude --plugin-dir mods/speckit-board` session has laid its types, and lints with eslint 10.8.0
  (`eslint.config.mjs`, the version `.pre-commit-config.yaml` pins). A `live-board` job runs
  `tools/live-board.mjs` on Linux and macOS (vhs from its release, checksum pinned).
- Unit tests cannot prove Claude Code fires a hook; `e2e.test.mjs` does. A new hook entry gets a case
  there that fails with the installed hook replaced by `process.exit(0)` (`SPECKIT_E2E_NO_HOOK=1`).
  After changing a hook's command, event or matcher, also run README.md's "Live check".

## Rules
- Every file the installer writes keeps the `speckit-agents: managed by install.mjs` marker line;
  install and uninstall tell their own files from the user's by it.
- A new hook command goes in an agent's frontmatter or `SETTINGS_GATES` in `install.mjs`, and in the
  README's guardrail table.
- Hooks fail open when they crash. Any change that can make the script throw needs a test.
- Twins, each held by `test/board-mod.test.mjs`: `fingerprint()` in the hook and in
  `mods/speckit-board/hooks/model.ts` (also pinned in the mod's `model.test.ts`); the mod's
  `ROLE_COLOR` and each `agents/*.md` `color:` line; its `MAX_RED` and the hook's; its `WORDS` and the
  words test-writer and spec-gatekeeper pass to `ends`. Change both halves. Also `NO_NETWORK` in the
  hook and in `install.mjs`, which writes the exact allow rule for the hook's export line (#122), held
  by `test/hook-patch.test.mjs`.
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
- The accepted record's fields are read by `skills/speckit-patch/SKILL.md`; change both, and
  `test/install.test.mjs`.
- Prompt rules with a half in the skill and a half in an agent (the `## Open Decisions` section, the
  `dictated:` prefix, `Spec:` lines, `last round`, `worktree`), the Bash `timeout` sentence of the four
  agents that run tests, and the agent body lengths README.md states are held together by
  `test/install.test.mjs`. The skill's rule to commit with the next launch relies on Claude Code running
  one message's calls in order, its side-by-side slices on calls in one message running together and on
  a worktree starting from the last commit; `test/e2e.test.mjs` pins all three.

The SPECKIT block below is Spec Kit's: `speckit-plan` rewrites it to name the plan of the feature it
planned last. Read that plan only when you work on that feature.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/008-prompt-caching/plan.md`
<!-- SPECKIT END -->
