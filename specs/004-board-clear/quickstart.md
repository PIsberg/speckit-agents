# Quickstart: Board Clear

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-10

## Automated

```sh
npm test                                         # runs the mod's tests through test/board-mod.test.mjs
claude plugin test mods/speckit-board            # the mod's tests alone (needs claude on PATH)
node --test test/board-mod.test.mjs              # the README command-table check and the twins
```

Without a `claude` executable on PATH the mod's tests are skipped, not passed.

## Live checks (deferred to a follow-up issue, D5 B)

In the scratch Spec Kit repo `node docs/media/record.mjs --setup-only` builds (the demo feature,
mid-build), with the board loaded by `--plugin-dir <checkout>/mods/speckit-board`:

| ID | Session | Steps | Expected |
|---|---|---|---|
| L1 | headless | `claude -p "/speckit-board clear"` | prints `nothing to clear.` (no team agent ran in that session), exit 0, 0 turns |
| L2 | headless | `claude -p "/speckit-board foo"` | prints `unknown argument "foo": use status, refresh, band or clear.` |
| L3 | interactive | open the pane with `/speckit-board`, at 140 columns | the pane shows `[ clear ]`; the band shows `[ board ] [ clear ] [ hide ]` |
| L4 | interactive | run two `@agent-spec-auditor` (Haiku stand-ins are enough), then press the pane's `[ clear ]` | toast `cleared 2 agent rows and the band.`; the pane lists no agent row; the band is gone; the status line unchanged |
| L5 | interactive | then start one more team agent | its row and the band are back within 4 s |
| L6 | interactive | before and after L4, `sha256sum .git/speckit-team/*/*.json specs/*/spec.md specs/*/plan.md specs/*/tasks.md .specify/feature.json` | identical |

L1, L2 and the screenshot are deferred to a follow-up issue (D5 B), not run by this feature. L3 to L6 need a person at the keyboard; the README says
which were seen live and which were not.
