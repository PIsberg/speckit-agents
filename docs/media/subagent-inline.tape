# spec-auditor running inside the main session: the collapsed progress view, the expanded
# transcript, and the verdict it hands back. Recorded by record.mjs, which fills in the {{...}}
# fields.
Output "{{OUTPUT}}"
# Every frame as text, so a reviewer can search them all for account details.
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

# On Claude Code 2.1.296 a bare mention ran the agent in the background, out of the transcript.
Type "@agent-spec-auditor audit the active feature. Run it in the foreground."
Sleep 500ms
Enter
Sleep 20s
# Expand the transcript while the agent works, then collapse it again.
Ctrl+O
Sleep 8s
Ctrl+O
# Wait for the agent's end, not its verdict words: the expanded view shows its description, which
# names VERDICT, PASS and FAIL, and a collapse can take a moment to draw.
Sleep 2s
Wait+Screen@5m /Done \(|finished ·/
Sleep 12s
