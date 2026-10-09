# Contract: hook modes `scope protected` and `patch`

Both are modes of `hooks/speckit-team.mjs`, called as `node "<installed hook path>" <mode> [args]`
with the hook event JSON on stdin, like every other mode. Outside a git repo that contains
`.specify/` both exit 0 with no output (FR-010). Input that is not a JSON object, or an event the
mode is not wired for, makes no decision and prints the existing
`speckit-team: <mode> got unusable input (<why>); no decision made.` (FR-011).

Output shapes are the existing ones:

- deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}`
- block: `{"decision":"block","reason":"<reason>"}`
- message only: `{"systemMessage":"<text>"}`
- allow: no output, exit 0

No message carries file contents, command output or prompt text: only paths, counts, limits and a
short commit id (FR-014). `<sha12>` is the first 12 characters of the start commit.

## `scope protected`

Wired: `patcher`, PreToolUse, matcher `Write|Edit|MultiEdit|NotebookEdit`. `WIRED.scope` unchanged.

| Target | Decision | Reason text |
|---|---|---|
| inside the git directory | deny | existing git-directory message (every `scope` rule) |
| outside the repo, `isTeamFile()` | deny | `<who> may not write <file>: it belongs to the installed agent team (its hook, agents, skills or settings). Stop and report ESCALATE; the developer uses /speckit-team.` |
| outside the repo, anything else | allow | |
| inside the repo, `isProtected(rel, 'HEAD')` (the `PROTECTED` table; in the speckit-agents repository also `OWN_SOURCES`, top-level `package.json` included, data-model.md) | deny | `<who> may not write <rel>: it is a protected path (<why>). The fast track does not change it. Stop and report ESCALATE; the developer uses /speckit-team.` |
| inside the repo, anything else | allow | tests, docs and production code alike |

`<who>` is `agent_type`, or `the main session`.

The speckit-agents repository is recognised by its top-level `package.json` as committed (at `HEAD`
here, at the start commit in `patch`) having `"name": "speckit-agents"`. In any other repo (the file
missing, malformed, named otherwise, or no commit), `hooks/speckit-team.mjs`, `agents/*.md`,
`skills/*/SKILL.md`, `install.mjs` and `package.json` are ordinary files: allowed here, and counted
by `patch` as their class (usually production).

## `patch`

Wired: `patcher`, PreToolUse matcher `.*`, and Stop (which Claude Code delivers to a subagent as
`SubagentStop`). `WIRED.patch = ['PreToolUse', 'SubagentStop', 'Stop']`.

### Key and start record

- Key: `agent_id`, else `session_id`. Neither, or one not matching `^[\w-]{1,128}$`: no decision,
  `speckit-team: patch got unusable input (no agent_id or session_id to keep the start record under); no decision made.`
- First PreToolUse of a key writes `<git common dir>/speckit-team/patch/<key>.json`
  (data-model.md). With no commit in the repo: deny,
  `Fast track: this repo has no commit to measure the change from. Commit first, or use /speckit-team.`

### PreToolUse, any tool except `SubagentHandback`

In this order:

1. Start record unusable: deny,
   `Fast track: the budget cannot be measured: <file> is unreadable or names a commit this repo does not have. Report this; the user deletes the file to start over.`
2. `.specify/test-paths` has an invalid line: deny,
   `Fast track: the budget cannot be measured: <existing test-paths message>. Report this to the user, who fixes the file.`
3. `tool_name` is `Write`, `Edit`, `MultiEdit` or `NotebookEdit` and its target
   (`tool_input.file_path` or `notebook_path`, resolved to a repo-relative path as `scope` does) is a
   key of the start record's `dirty`: deny,
   `Fast track: <rel> had uncommitted changes when the run started. They are the developer's work, so the fast track leaves the file alone. If the change needs this file, make no commit and report ESCALATE; the developer commits or stashes that work first, or uses /speckit-team.`
   (research R14).
4. Measure. Within budget: allow.
5. Over budget, a protected file changed or `committed`, `tool_name` is `Bash` and
   `tool_input.command` is one pure restore command (research R7: whole command is
   `git checkout …`, `git restore …`, `git reset --soft …` or `rm …`, containing none of
   `; & | ` `` ` `` ` $( > <` or a newline): allow.
6. Otherwise deny with the budget message:
   `Fast-track budget exceeded: <lines> changed production lines in <files> files (limit 30 lines, 2 files)[; binary production files are not allowed: <paths>][; changed or committed although they had uncommitted changes when the run started, so the change cannot be measured: <paths>]. Tests and docs do not count. Stop: make no commit, open no pull request, leave the work uncommitted, and report ESCALATE; the developer re-runs the change with /speckit-team.`
   When a restore is pending (step 5's condition), the reason adds
   ` First restore the protected files (git checkout <sha12> -- <file>, or delete a new file) and undo any commit (git reset --soft <sha12>).`

### End of run: PreToolUse `SubagentHandback`, `SubagentStop`, `Stop`

No start record for the key: allow, no output. Unusable record or test patterns: allow with
`systemMessage` `speckit-team: fast-track check could not run for <who>: <why>.` Otherwise measure,
then the first that applies:

| Condition | Handback (PreToolUse) | SubagentStop / Stop |
|---|---|---|
| `protectedChanged` not empty | deny | block, also when `stop_hook_active` |
| over budget (`dirtyTouched` included) and `committed` | deny | block, also when `stop_hook_active` |
| over budget | allow + systemMessage A | allow + systemMessage A |
| within budget | allow + systemMessage B | allow + systemMessage B |

- Protected reason: `Fast track: <who> changed protected files: <path> (git checkout <sha12> -- <path>), <new path> (new: delete it). Restore them, then finish. The hook changes nothing itself.`
- Committed reason: `Fast track: <who> committed while over the budget (<lines> lines in <files> files; limit 30 lines, 2 files). Run git reset --soft <sha12> so the work stays uncommitted, then report ESCALATE.`
- A: `fast track stopped: <lines> changed production lines in <files> files (limit 30 lines, 2 files)[; binary production files: <paths>][; changed although they had uncommitted changes when the run started: <paths>]. Nothing was committed; the work is uncommitted in the working tree. Use /speckit-team for this change.`
- B: `fast track: <lines> of 30 production lines, <files> of 2 production files (tests and docs not counted).`

`<lines>` is the sum, over production files, of the larger of a file's insertions and deletions in
`git diff --find-renames --numstat` from the start commit (a modified line counts 1; a pure rename
counts 0), plus the line count of each untracked production file. `<files>` counts production paths
with any change, a rename between production paths as 1. A rename between a production path and a
test or doc path counts as the production side added or deleted (data-model.md, "Renames"); a move
git does not pair, such as plain `mv` leaving the new path untracked, counts as a deletion plus a
new file.

A path dirty at the start is left out of `<lines>`, `<files>`, the binary list and the protected
list. While its bytes match the SHA-256 recorded at the start and no commit since the start
contains it, it costs nothing; otherwise it is listed in the `[; changed ...]` part and the run is over
budget (data-model.md `dirtyTouched`, research R14). The end check never asks to restore it: the
hook holds only its hash, and the start commit's version would destroy the developer's work.

The hook never runs a git command that changes the repo; it reads with `rev-parse`, `diff`,
`ls-files` and `cat-file` only.

## `ends DONE FAILED ESCALATE`

The existing `ends` mode, unchanged, wired on `patcher`'s PreToolUse `SubagentHandback` and Stop:
a report whose last line is not `DONE`, `FAILED` or `ESCALATE` is refused once, never twice.
Without `--record`, so it records nothing.
