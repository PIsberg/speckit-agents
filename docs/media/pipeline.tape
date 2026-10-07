# /speckit-team from the idea to the product owner's first questions, the pipeline's first stop.
# Recorded by record.mjs, which fills in the {{...}} fields.
Output "{{OUTPUT}}"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms
Set PlaybackSpeed 4

# Start Claude Code off camera. The second Enter accepts the folder-trust prompt on a first run
# and does nothing on an empty prompt otherwise.
Hide
Type "clear; {{CLAUDE}}"
Enter
Sleep 10s
Enter
Sleep 5s
Show

Type "/speckit-team Let greet take a --shout flag that prints the greeting in capitals"
Sleep 1s
Enter
# Let the slash-command menu close before waiting for the question dialog.
Sleep 10s
Wait+Screen@10m /Esc to cancel/
Sleep 8s
