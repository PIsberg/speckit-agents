# The board mod while a team agent runs: the pane docked beside the transcript, the band above the
# prompt, the status line. Recorded by record.mjs, which fills in the {{...}} fields and stages the
# board first: three tasks ticked, an audit PASS and one RED recorded by the hook itself, and
# test-writer and implementer swapped for stand-ins that only report, so the agent rows cost two
# short Haiku runs. The screenshot shows the board, not the stand-ins' work.
Output "{{WORK}}/board.txt"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1400
Set Height 900
Set Padding 16
Set TypingSpeed 25ms
# Fullscreen, where the pane docks beside the transcript.
Env CLAUDE_CODE_NO_FLICKER "1"

# Start Claude Code off camera. On a first run the folder-trust prompt is up, and its default is
# "No, exit": Down picks "Yes". On an empty prompt both keys do nothing.
Hide
Type "clear; {{CLAUDE}} --plugin-dir '{{BOARD}}'"
Enter
Sleep 10s
Down
Sleep 300ms
Enter
Sleep 8s
Show

Type "/speckit-board"
Sleep 800ms
Enter
Sleep 3s
Type "/speckit-board status"
Sleep 800ms
Enter
Sleep 3s
Type "Launch the test-writer agent in the background, description 'Red tests for T002 and T003', prompt 'go'. Then end your turn without using any other tool. When it reports, reply only: ok"
Sleep 500ms
Enter
Sleep 25s
Type "Launch the implementer agent in the background, description 'Green T004 greet(name)', prompt 'go'. Then end your turn without using any other tool. When it reports, reply only: ok"
Sleep 500ms
Enter
Sleep 16s
Screenshot "{{SHOTS}}/board.png"
Sleep 1s
