# Quickstart: live checks for 006

Constitution II: the widened `settings.json` matcher (`contracts/team-choice.md` section 7) has to be
seen firing in a real Claude Code session; e2e covers it only under the fake API. Set up as in
README.md, "Live check" (scratch Spec Kit repo, throwaway `CLAUDE_CONFIG_DIR` with the team
installed, `CLAUDECODE`, `CLAUDE_CODE_*` and `AI_AGENT` cleared, `MSYS_NO_PATHCONV=1` in Git Bash),
with no audit recorded and the scratch repo's `.specify/feature.json` naming an existing feature.

| ID | Run | Expect |
|---|---|---|
| L1 | `claude -p '/speckit-team --team test-writer,implementer add a hello.txt that says hello' --model haiku --permission-mode acceptEdits --allowedTools "Bash Read Write Edit Glob Grep Skill Agent" --output-format stream-json --verbose` | `task_started` events for test-writer and implementer only; the message `speckit-team: team for this session: test-writer, implementer; audit gate off, spec-auditor is not in the team`; no `Implementation gate` denial; `.git/speckit-team/team/<session>.json` holds the two roles; a `team/...` branch; the final report lists the skipped steps and the skipped audit gate (SC-001, SC-005) |
| L2 | `claude -p '/speckit-team --team bogus,implementer add a file' --model haiku --output-format json` | no agent launched; the reply names `bogus` and lists the six roles (FR-006) |
| L3 | `claude -p '/speckit-team --team spec-auditor,implementer add a file' --model haiku --output-format json` | no agent launched; the reply says spec-auditor needs architect (D3) |
| L4 | interactive: `claude`, then `/speckit-team add a file` | one question with Full team first and marked recommended (FR-010); answer Build only and see L1's launches; Esc out after |

Record each result, with the date and Claude Code version, in README.md, "Live results".
