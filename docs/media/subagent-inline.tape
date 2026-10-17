# spec-auditor running inside the main session: the collapsed progress view, the expanded
# transcript, and the verdict it hands back. Recorded by record.mjs, which fills in the {{...}}
# fields.
Output "{{OUTPUT}}"
# The screen as text after each command, so a reviewer can search it for account details. Frames
# drawn during a Sleep or a Wait are not in it (#62): look at the GIF too.
Output "{{WORK}}/subagent-inline.txt"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms
Set PlaybackSpeed 2
# Keep the working directory, and with it the user name, out of the startup logo.
Env CLAUDE_CODE_HIDE_CWD "1"
# Interactive sessions turn fork subagents on, and then every agent runs in the background whatever
# the prompt says (#62, #64). Off, the Agent tool has a run_in_background flag the model sets, and
# on 2026-10-17 Haiku set it once although the prompt said "in the foreground", so the prompt names
# the flag. A take whose agent shows "Backgrounded agent" is not the view the README describes.
Env CLAUDE_CODE_FORK_SUBAGENT "0"

# Start Claude Code off camera. On a first run the folder-trust prompt is up, and its default is
# "No, exit": Down picks "Yes". On an empty prompt both keys do nothing.
Hide
Type "clear; {{CLAUDE}}"
Enter
Sleep 10s
Down
Sleep 300ms
Enter
Sleep 5s
Show

Type "@agent-spec-auditor audit the active feature. Launch it with run_in_background false."
Sleep 500ms
Enter
Sleep 20s
# Expand the transcript while the agent works, then collapse it again.
Ctrl+O
Sleep 8s
Ctrl+O
# Wait for the agent's end, not its verdict words: the expanded view shows its description, which
# names VERDICT, PASS and FAIL, and a collapse can take a moment to draw. A backgrounded agent ends
# in "Agent "..." finished"; the wait takes that too, so the take ends with a GIF to reject.
Sleep 2s
Wait+Screen@5m /Done \(|finished ·|" finished/
Sleep 12s
