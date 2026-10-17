# /speckit-team from the idea through the team question to the product owner's first questions, the pipeline's first two stops.
# Recorded by record.mjs, which fills in the {{...}} fields.
Output "{{OUTPUT}}"
# The screen as text after each command, so a reviewer can search it for account details. Frames
# drawn during a Sleep or a Wait are not in it (#62): look at the GIF too.
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

# The idea leaves real questions open (which languages, how greet picks one, what it falls back
# to). A precise one, "a --shout flag that prints the greeting in capitals", gave Haiku's
# product-owner nothing to ask in three takes on 2026-10-11, and the wait below timed out (#99).
Type "/speckit-team Let greet say hello in the user's own language"
Sleep 1s
# "Enter 1" is Enter once: a bare "Enter" line below is the answer to the team question.
Enter 1
# The team question comes first: wait for its dialog and take the first option, Full team
# (Recommended). Claude Code 2.1.296 draws a dialog as tabs ending in Submit, with no "Esc to cancel" line.
Sleep 10s
Wait+Screen@10m /Full team/
Sleep 3s
Enter
# The team dialog also ends in Submit: let it close before waiting for product-owner's dialog.
Sleep 10s
Wait+Screen@10m /Submit|Esc to cancel/
Sleep 8s
