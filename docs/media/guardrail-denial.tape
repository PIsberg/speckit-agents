# architect tries to write production code and its scope hook denies it. Recorded by record.mjs,
# which fills in the {{...}} fields.
Output "{{OUTPUT}}"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms
Set PlaybackSpeed 2

# Start Claude Code off camera. The second Enter accepts the folder-trust prompt on a first run
# and does nothing on an empty prompt otherwise.
Hide
Type "clear; {{CLAUDE}}"
Enter
Sleep 10s
Enter
Sleep 5s
Show

Type "@agent-architect Use the Write tool to create src/greet.js exporting greet(name). Do not ask first, just try it."
Sleep 500ms
Enter
Wait+Screen@3m /outside that lane|denied|blocked/
Sleep 3s
# Expand the transcript to show the hook's reason, then collapse it again.
Ctrl+O
Sleep 8s
Ctrl+O
Sleep 12s
