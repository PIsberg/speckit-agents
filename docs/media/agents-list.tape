# The team in the @ typeahead: typing @ lists the agents Claude Code knows, the team's with their
# descriptions, and the arrow keys walk the list. Claude Code 2.1.295 removed the /agents menu this
# tape used to open. The tape types nothing after @: on 2.1.296 a filter lists files rather than
# agents (@agent- the agents' .md files, @impl every path containing it), and also any other Claude
# session on the machine whose name starts with it, which a bare @ never lists. The list puts the
# repo's folders first, then the agents in alphabetical order, and stops at 15 entries: 4 folders,
# Claude Code's 5 agents and 6 of the team's, without test-writer (the seventh, last in the order).
# One take showed only 10 entries, so check the frames for all six. The 14 steps end on the
# last entry. record.mjs fills in the
# {{...}} fields and runs the tape from a drive letter mapped onto the demo folder, so paths on
# screen read R:\repo rather than one with the user name in it.
Output "{{OUTPUT}}"
# Every frame as text, so a reviewer can search them all for account details.
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
Down@500ms 14
Sleep 3s
Escape
Sleep 1500ms
