# spec-auditor running inside the main session: the collapsed progress view, the expanded
# transcript, and the verdict it hands back. Recorded by record.mjs, which fills in the {{...}}
# fields.
Output "{{OUTPUT}}"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms
Set PlaybackSpeed 2

# Start Claude Code off camera. record.mjs refuses to run until the folder is trusted, so no trust
# prompt appears; the second Enter lands on an empty prompt and does nothing.
Hide
Type "clear; {{CLAUDE}}"
Enter
Sleep 10s
Enter
Sleep 5s
Show

Type "@agent-spec-auditor audit the active feature"
Sleep 500ms
Enter
Sleep 20s
# Expand the transcript while the agent works, then collapse it again.
Ctrl+O
Sleep 8s
Ctrl+O
Wait+Screen@5m /VERDICT|PASS|FAIL/
Sleep 10s
