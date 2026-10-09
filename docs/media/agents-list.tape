# The team in the @ typeahead: typing @ lists the agents Claude Code knows, the team's with their
# descriptions, and the arrow keys walk the list. Claude Code 2.1.295 removed the /agents menu this
# tape used to open. The tape types nothing after @: on 2.1.296 any filter (@agent-, @test) also
# matched absolute paths under the user's temp folder, user name included, and @spec matched
# other Claude sessions on the machine. Recorded by record.mjs, which fills in the {{...}} fields.
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

Type "@"
Sleep 4s
Down@500ms 15
Sleep 3s
Escape
Sleep 1500ms
