# speckit-agents: project instructions

This repository is the team itself: eight subagents (`agents/*.md`), three skills
(`skills/*/SKILL.md`), one hook script (`hooks/speckit-team.mjs`) and an installer (`install.mjs`).
A feature here changes the prompts and guardrails you are running under. When the two could differ,
trust the source file in the repo, not your own instructions.

- `CLAUDE.md` at the repo root holds the working rules. spec-auditor, spec-gatekeeper and
  security-reviewer start without it (`omitClaudeMd: true`): read its `## Rules` section before you
  judge a change to an agent, a skill, the hook or the installer.
- Twins: several facts live in two places and a test holds them together (`CLAUDE.md`, `## Rules`):
  `fingerprint()` in the hook and in the board mod, `TEAM_ROLES` and the `Team:`, `Unbuilt:` and
  `Project:` launch-prompt lines, `NO_NETWORK` in the hook and in `install.mjs`, the agent body
  lengths README.md states. A change to one half changes the other half and its test in the same
  change.
- Verify with `npm test` (no network beyond localhost). Tests that need `claude` skip without it,
  and a skip is not a pass. A new or changed hook entry gets a `test/e2e.test.mjs` case that fails
  with `SPECKIT_E2E_NO_HOOK=1`.
- Never write a tool's version into a workflow, a hook config or a doc: each is pinned in one place
  (README.md, "Where each version is pinned"), held by `test/versions.test.mjs`.
- Every file `install.mjs` writes keeps the `speckit-agents: managed by install.mjs` marker line.
  Agent files name the hook as `{{HOOK}}`, never a literal path or `$HOME`.
- An agent declares `omitClaudeMd: true` exactly when its `disallowedTools` has `Write`.
- Docs change in the same change: README.md (the guardrail table, counts, troubleshooting, known
  limits), `docs/architecture.md`, and `CLAUDE.md` when it changes how to work here. A count stated
  in prose (tests, agents, body lengths) matches what a test enforces.
- Prose: no em-dashes, no curly quotes, numbers over adjectives, and say what was measured and how.
