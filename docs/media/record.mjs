#!/usr/bin/env node
// Records the agent-view GIFs and the board mod's screenshot in README.md. Each tape drives a real
// Claude Code session (Haiku, main session and subagents: the scratch copies of the agents are set
// to `model: haiku`) in a throwaway Spec Kit repo, so a run costs a little and the output differs
// from run to run. Needs vhs, specify, claude and git on PATH.
//
//   node docs/media/record.mjs                  all tapes
//   node docs/media/record.mjs pipeline         only the named tapes
//   node docs/media/record.mjs --setup-only     build the scratch repo, record nothing
//
// The team is installed into the scratch repo's own .claude/, and Claude Code is started with
// --setting-sources project,local and --strict-mcp-config, so your user-level hooks, plugins,
// statusline and MCP servers stay out of the recording. Check each GIF and screenshot before
// committing it: the session banner and the usage line can still show account details.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
// Order matters: pipeline needs a clean tree on main, and every tape gets one (see resetDemo).
const TAPES = ['agents-list', 'guardrail-denial', 'subagent-inline', 'pipeline', 'board'];
// Bash stays unscoped: Spec Kit's skills run its PowerShell or shell scripts, so any allowlist that
// lets the tapes finish includes an interpreter. The containment is the fixed prompts and the
// throwaway repo; an unanswered permission prompt would only hang the recording.
const CLAUDE = "claude --model haiku --setting-sources project,local --strict-mcp-config"
  + " --allowedTools 'Bash Read Write Edit Glob Grep Skill'";
// vhs on Windows resolves `bash` to WSL, which has neither the env nor claude; pwsh has both.
const SHELL = process.platform === 'win32' ? 'pwsh' : 'bash';
// A fixed path, so Claude Code's folder trust survives between runs. It is in the home directory,
// not a shared temp dir: the recorder accepts trust for it, and anyone who could create it first
// could plant hooks that would then run as you. Every run deletes it whole first.
// SPECKIT_DEMO_DIR names another folder instead, for a run that must leave this one as it is;
// the same care applies to that folder.
const work = process.env.SPECKIT_DEMO_DIR
  ? path.resolve(process.env.SPECKIT_DEMO_DIR)
  : path.join(os.homedir(), '.cache', 'speckit-agents-demo');
const demo = path.join(work, 'repo');

function fail(msg) {
  console.error(`record: ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: demo, stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed: ${r.error?.message ?? `exit ${r.status}`}`);
}

const git = (...args) => run('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', ...args]);

function buildDemo() {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true, mode: 0o700 });
  fs.mkdirSync(demo);
  git('init', '-q', '-b', 'main');
  // Without --script, specify waits on an interactive picker. Without UTF-8, specify on Windows
  // crashes printing its banner into a pipe (cp1252).
  run('specify', ['init', '--here', '--integration', 'claude', '--force', '--ignore-agent-tools',
    '--script', process.platform === 'win32' ? 'ps' : 'sh'],
  { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  run(process.execPath, [path.join(repo, 'install.mjs'), '--claude-dir', path.join(demo, '.claude')]);
  // An agent's `model:` line beats CLAUDE_CODE_SUBAGENT_MODEL, so the scratch copies are switched
  // to Haiku here; with the env var alone the agents ran on Opus and Sonnet (#39).
  const agents = path.join(demo, '.claude', 'agents');
  for (const f of fs.readdirSync(agents).filter((n) => n.endsWith('.md'))) {
    const file = path.join(agents, f);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^model: .*$/m, 'model: haiku'));
  }
  const src = path.join(here, 'demo');
  fs.copyFileSync(path.join(src, 'constitution.md'), path.join(demo, '.specify', 'memory', 'constitution.md'));
  const feat = path.join(demo, 'specs', '001-greet');
  fs.mkdirSync(feat, { recursive: true });
  for (const f of ['spec.md', 'plan.md', 'tasks.md']) fs.copyFileSync(path.join(src, f), path.join(feat, f));
  fs.writeFileSync(path.join(demo, '.specify', 'feature.json'),
    `${JSON.stringify({ feature_directory: 'specs/001-greet' }, null, 2)}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'Demo feature 001-greet');
}

// A tape may leave edits, a new branch or a recorded verdict behind; the next one starts clean.
function resetDemo() {
  git('checkout', '-q', '-f', 'main');
  git('reset', '-q', '--hard');
  git('clean', '-q', '-fd');
  fs.rmSync(path.join(demo, '.git', 'speckit-team'), { recursive: true, force: true });
}

// The board tape shows the board mid-build: the demo feature's setup and test tasks ticked, and an
// audit PASS and one RED recorded by the team's own hook, as the real agents' stops record them.
// test-writer and implementer are swapped for stand-ins that only report, the implementer after 30
// seconds so the screenshot catches it running (Claude Code's Bash refuses a bare `sleep`).
// resetDemo puts the installed agents back.
const STAND_INS = {
  'test-writer': 'Use no tool. Reply with exactly these two lines and nothing else:\n'
    + "T002 and T003 fail on the stub's not-implemented error\nRED\n",
  implementer: 'Run this Bash command exactly once, so the board shows you at work for 30 seconds:\n'
    + 'node -e "setTimeout(() => {}, 30000)"\n'
    + 'Then reply with exactly these two lines and nothing else:\n'
    + 'T004 greet(name) returns the greeting; 2 tests pass\nRESULT: GREEN\n',
};

function stageBoard() {
  const tasks = path.join(demo, 'specs', '001-greet', 'tasks.md');
  fs.writeFileSync(tasks, fs.readFileSync(tasks, 'utf8').replace(/^- \[ \] (T00[123]) /gm, '- [x] $1 '));
  const hook = path.join(repo, 'hooks', 'speckit-team.mjs');
  for (const [mode, stop] of [
    ['verdict', { last_assistant_message: 'VERDICT: PASS' }],
    ['result', { agent_id: 'board-tape', last_assistant_message: 'RESULT: RED' }],
  ]) {
    const r = spawnSync(process.execPath, [hook, mode], {
      input: JSON.stringify({ cwd: demo, hook_event_name: 'SubagentStop', ...stop }),
      encoding: 'utf8',
    });
    if (r.status !== 0) fail(`staging the board: the ${mode} hook failed: ${r.stderr}`);
  }
  for (const [name, prompt] of Object.entries(STAND_INS)) {
    fs.writeFileSync(path.join(demo, '.claude', 'agents', `${name}.md`), `---\nname: ${name}\n`
      + 'description: A stand-in for the board screenshot. Use only when asked by name.\n'
      + `tools: Bash\nmodel: haiku\n---\n${prompt}`);
  }
}

function record(name) {
  const slash = (p) => p.replaceAll('\\', '/');
  const tape = fs.readFileSync(path.join(here, `${name}.tape`), 'utf8')
    .replaceAll('{{OUTPUT}}', slash(path.join(here, `${name}.gif`)))
    .replaceAll('{{SHOTS}}', slash(here))
    .replaceAll('{{WORK}}', slash(work))
    .replaceAll('{{BOARD}}', slash(path.join(repo, 'mods', 'speckit-board')))
    .replaceAll('{{SHELL}}', SHELL)
    .replaceAll('{{CLAUDE}}', CLAUDE);
  const file = path.join(work, `${name}.tape`);
  fs.writeFileSync(file, tape);
  const r = spawnSync('vhs', [file], { cwd: demo, stdio: 'inherit' });
  return r.status === 0 ? 'recorded' : `FAILED (${r.error?.message ?? `exit ${r.status}`})`;
}

const args = process.argv.slice(2);
const setupOnly = args.includes('--setup-only');
const wanted = args.filter((a) => a !== '--setup-only');
const unknown = wanted.filter((t) => !TAPES.includes(t));
if (unknown.length) fail(`unknown tape ${unknown.join(', ')}; choose from ${TAPES.join(', ')}`);

buildDemo();
if (setupOnly) {
  console.log(`record: scratch repo ready at ${demo}`);
  process.exit(0);
}
const results = (wanted.length ? TAPES.filter((t) => wanted.includes(t)) : TAPES).map((t) => {
  resetDemo();
  if (t === 'board') stageBoard();
  return [t, record(t)];
});
for (const [t, status] of results) console.log(`record: ${t} ${status}`);
process.exit(results.every(([, s]) => s === 'recorded') ? 0 : 1);
