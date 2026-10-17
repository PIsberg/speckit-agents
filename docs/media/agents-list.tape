# The team in the @ typeahead: typing @ lists the agents Claude Code knows, the team's with their
# descriptions, and the arrow keys walk the list. Claude Code 2.1.295 removed the /agents menu this
# tape used to open. The tape types nothing after @: on 2.1.296 a filter lists files rather than
# agents (@agent- the agents' .md files, @impl every path containing it), and also any other Claude
# session on the machine whose name starts with it, which a bare @ never lists. The list puts the
# repo's folders first, then the agents in alphabetical order, and stops at 15 entries. On 2.1.302
# (2026-10-17) that is 4 folders, Claude Code's 5 agents and 6 of the team's eight, without
# spec-gatekeeper and test-writer, last in the order. One take drew 5 rows at a time above the
# prompt and scrolled, the next all 15 below it. The first Down selects the first entry, so the 15
# steps end on the last. record.mjs fills in the
# {{...}} fields and runs the tape from a drive letter mapped onto the demo folder, so paths on
# screen read R:\repo rather than one with the user name in it.
Output "{{OUTPUT}}"
# The screen as text after each command, so a reviewer can search it for account details. Frames
# drawn during a Sleep or a Wait are not in it (#62): look at the GIF too.
Output "{{WORK}}/agents-list.txt"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms
# Keep the working directory out of the startup logo.
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

Type "@"
Sleep 4s
Down@500ms 15
Sleep 3s
Escape
Sleep 1500ms
