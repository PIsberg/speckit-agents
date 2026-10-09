# architect tries to write production code and its scope hook denies it. Recorded by record.mjs,
# which fills in the {{...}} fields.
Output "{{OUTPUT}}"
# Every frame as text, so a reviewer can search them all for account details.
Output "{{WORK}}/guardrail-denial.txt"
Set Shell {{SHELL}}
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 16
Set Framerate 12
Set TypingSpeed 45ms
Set PlaybackSpeed 2
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

# An @agent-architect mention is not enough: on 2026-10-09 the main session decided the architect
# writes no code and wrote the file itself, where no lane applies. So the prompt names the agent.
# It asks for the foreground too, but Claude Code 2.1.296 ran the agent in the background anyway:
# an interactive session has fork subagents on unless CLAUDE_CODE_FORK_SUBAGENT=0 (#64).
Type "Run the architect agent in the foreground with this prompt: Call the Write tool once to create src/greet.js exporting greet(name). Do not ask first. Report the tool's answer word for word."
Sleep 500ms
Enter
Wait+Screen@3m /outside that lane|denied|blocked/
Sleep 3s
# Expand the transcript to show the hook's reason, then collapse it again.
Ctrl+O
Sleep 8s
Ctrl+O
Sleep 12s
