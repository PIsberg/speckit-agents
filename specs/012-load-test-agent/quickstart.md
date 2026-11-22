# Quickstart: checks run by hand

The automated checks are the test tasks in `tasks.md`. These two need a person: a real session, and
real models.

## Q1: the role's hooks in a live session (constitution II)

In a scratch Spec Kit repo with the team installed from this branch (README.md, "Live check"), with an
audited feature whose tasks are done:

1. Type `/speckit-team --load-test --team implementer,load-tester <request>`.
2. Expect: load-tester launched once, after implementer's `RESULT: GREEN`; a Write of a production
   file by it denied as outside its lane; its report ending `PASS`, `FAIL` or `NOT MEASURED`; on `FAIL`,
   the run stopping with the three options of step 5b.
3. Type `/speckit-team --team implementer <request>` and expect no load-tester launch and no
   `load-tester` in any prompt.

Record what was seen in `docs/live-results.md` and the PR body.

## Q2: the scored cases (SC-001, SC-002, SC-004, SC-006; D5)

```sh
node tools/eval.mjs --out <dir> --arm branch=. --runs 5 \
  --case load-quadratic,load-linear,load-pinned,load-empty,load-skipped,load-noisy
node tools/eval.mjs --out <dir2> --arm branch=. --runs 5 --case load-quadratic --skill-agents
```

Add `--login` to run on your own Claude Code login instead of `ANTHROPIC_API_KEY`. Expect 5/5 on
every case: `load-quadratic` FAIL naming the growth measurement in both modes (SC-001, SC-004), the
three broken-instrument cases never PASS (SC-002), `load-noisy` PASS with a `noisy:` warning, the same
verdict as `load-linear` (SC-006). For SC-005, open `specs/001-dedupe/load-test.md` in a
`load-quadratic` run's repo: every `## Budgets` row has its failing first readings and date.
