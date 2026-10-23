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
| L1 | headless | `claude -p "/speckit-board clear"` | prints `cleared the pane and the band.` (a fresh headless session draws the band; amended 2026-10-11 after the live run, which the mod's headless test already pinned; `the pane` added 2026-10-23, #150), exit 0, 0 turns |
| L2 | headless | `claude -p "/speckit-board foo"` | prints `unknown argument "foo": use status, refresh, band or clear.` |
| L3 | interactive | open the pane with `/speckit-board`, at 140 columns | the pane shows `[ clear ]`; the band shows `[ board ] [ clear ] [ hide ]` |
| L4 | interactive | run two `@agent-spec-auditor` (Haiku stand-ins are enough), then press the pane's `[ clear ]` | toast `cleared 2 agent rows, pane and band.`; the pane shows `cleared; refresh or the next team agent brings it back` and no phase, task or agent row (#150); the band is gone; the status line unchanged |
| L5 | interactive | then start one more team agent | its row and the band are back within 4 s |
| L6 | interactive | before and after L4, `sha256sum .git/speckit-team/*/*.json specs/*/spec.md specs/*/plan.md specs/*/tasks.md .specify/feature.json` | identical |

L1, L2 and the screenshot are deferred to a follow-up issue (D5 B), not run by this feature. L1 and L2
were run on 2026-10-11 (README.md, "Board mod", "Verified"); `test/e2e.test.mjs` now runs both in CI. L3 to L6
were run on 2026-10-12 in an interactive session that vhs drove against a fake API, the two
spec-auditors scripted stand-ins: `node tools/live-board.mjs` repeats them and prints each result
(docs/live-results.md, "The board"), and CI's `live-board` job runs it for every pull request. It hashes L6's files with `git hash-object`, which every OS has,
in place of `sha256sum`. The screenshot was re-recorded on 2026-10-17 (#84).
