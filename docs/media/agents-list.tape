# /agents and the @-mention typeahead. Recorded by record.mjs, which fills in the {{...}} fields.
Output "{{OUTPUT}}"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms

# Start Claude Code off camera. The second Enter accepts the folder-trust prompt on a first run
# and does nothing on an empty prompt otherwise.
Hide
Type "clear; {{CLAUDE}}"
Enter
Sleep 10s
Enter
Sleep 5s
Show

Type "/agents"
Sleep 800ms
Enter
Sleep 3s
Down@700ms 3
Sleep 1s
Enter
Sleep 2s
Enter
Sleep 6s
Escape
Sleep 800ms
Escape
Sleep 800ms
Escape
Sleep 1500ms

Type "@agent-"
Sleep 4s
