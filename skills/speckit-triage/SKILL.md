---
# speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.
name: speckit-triage
description: Advisory only: suggests whether a request fits /speckit-patch or /speckit-team and prints the command to type.
argument-hint: "<request>"
disable-model-invocation: true
---

Triage this request: $ARGUMENTS

Suggest one track. This skill launches no agent and invokes no skill, and it changes no file. It
prints one suggestion and stops; the user types the command.

Suggest `/speckit-team` when any of these holds:
- the request adds a new capability, command, flag or output;
- it changes a public contract;
- it touches a protected path, meaning a path the fast track protects: `.specify/`
  (Spec Kit config, constitution), `specs/`, `.claude/`, CI and commit-hook config (`.github/` and
  similar), and in the speckit-agents repo its hook, agents, skills and installer. README.md is
  not protected, so a typo fix there is not a reason for `/speckit-team`;
- it needs more than 30 production lines or more than 2 production files.

Otherwise suggest `/speckit-patch`.

Output exactly one line: `Suggested: <command> <request> (<one-line reason>)`, for example
`Suggested: /speckit-team <request> (adds a new installer flag, a public contract)`. If you cannot
tell, suggest `/speckit-team`, the slower and safer track.
