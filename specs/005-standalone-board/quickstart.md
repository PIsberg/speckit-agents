# Quickstart: live checks for the standalone board

Unit tests cannot show that Claude Code installs a plugin from a GitHub marketplace or that a real
Spec Kit run updates the board. These two checks are run by hand before the PR; record the outcome in
README.md, "Board mod", "Verified" (constitution VIII).

## 1. Board-only install (FR-009, SC-004, D2-A)

In a scratch config dir, so nothing of yours changes:

```sh
export CLAUDE_CONFIG_DIR="$(mktemp -d)"
claude plugin marketplace add PIsberg/speckit-agents
claude plugin install speckit-board@speckit-agents --scope user
claude plugin list
ls "$CLAUDE_CONFIG_DIR"/agents "$CLAUDE_CONFIG_DIR"/skills 2>&1
grep -c speckit-team "$CLAUDE_CONFIG_DIR"/settings.json
```

Expect: `speckit-board@speckit-agents` listed; no `agents/` or `skills/` folder from the team, and
`0` from the grep. Then start `claude` in a Spec Kit repo with the same `CLAUDE_CONFIG_DIR` and run
`/speckit-board status`: it answers.

## 2. Standalone session (US1, SC-001, SC-002)

In a fresh Spec Kit repo (`specify init`) with the board from check 1 and no team:

1. `/speckit-specify <an idea>`, then `/speckit-board status`: S-2 of `contracts/board-text.md`.
2. Set the spec's Status line to Approved by hand: within 4 s the status line reads S-3.
3. `/speckit-plan`, `/speckit-tasks`, each followed by `/speckit-board status`: S-4, then S-5.
4. Tick one task in `tasks.md` by hand: within 4 s the band shows `1/N` and the status line S-6.
5. Read every line printed: none names a team agent or `/speckit-team`.

Repeat steps 1 and 3 in a copy of the repo with its `.git` folder removed (US4 scenario 2).

Run on 2026-10-11, headless and at $0 (README.md, "Board mod", "Verified"): check 1 in full; check 2
with the files Spec Kit's commands write put in place by hand instead of running the commands, each
state read with `claude -p "/speckit-board status"` against a fake API. Not seen: the status line
updating within 4 s with no command (steps 2 and 4), which needs an interactive session.
