# /speckit-team from the idea to the product owner's first questions, the pipeline's first stop.
# Recorded by record.mjs, which fills in the {{...}} fields.
Output "{{OUTPUT}}"
# Every frame as text, so a reviewer can search them all for account details.
Output "{{WORK}}/pipeline.txt"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms
Set PlaybackSpeed 4
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

Type "/speckit-team Let greet take a --shout flag that prints the greeting in capitals"
Sleep 1s
Enter
# Let the slash-command menu close before waiting for the question dialog. Claude Code 2.1.296
# draws it as tabs ending in Submit, with no "Esc to cancel" line on screen.
Sleep 10s
Wait+Screen@10m /Submit|Esc to cancel/
Sleep 8s
