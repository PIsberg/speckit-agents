# Quickstart: Project knowledge for the team

## Try it

```sh
mkdir -p .specify/projects/demo
printf 'Every new source file starts with the line: // demo-project\n' > .specify/projects/demo/instructions.md
printf '# Rounding\nRound half to even.\n' > .specify/projects/demo/rounding.md
git add .specify/projects && git commit -m "project: demo"
```

Then, in Claude Code: `/speckit-patch --project demo add a rounding helper`. The new file starts with
`// demo-project`.

## Live checks (constitution II: the SubagentStart matcher changes)

Run after installing from this branch (`node install.mjs`), in a scratch Spec Kit repo with the demo
project, and record what was seen in `docs/live-results.md`.

- **L1, injection**: `/speckit-patch --project demo <change>`. The patcher's transcript
  (`~/.claude/projects/<slug>/<session>/subagents/`) starts with the block as context, and its
  launch prompt has only the `Project: demo` line.
- **L2, off by default**: the same change without the flag. No `Project:` line, no injected context,
  no `project/` record under `.git/speckit-team/`.
- **L3, protection**: ask patcher (with the flag) to fix a typo in `rounding.md`. Denied as a
  protected path.
- **L4, Spec Kit keeps it**: `specify init --here --force --integration claude` in the scratch
  repo; `.specify/projects/demo/` is still there. (research R5)
- **L5, cost (SC-005)**: `node tools/usage.mjs` on the L1 and L2 sessions; the difference in input
  tokens goes to `docs/measurements.md`.
