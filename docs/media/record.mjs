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
// statusline and MCP servers stay out of the recording. Each tape records into the demo folder, and
// its GIF and screenshots are copied into docs/media only if no frame shows your user name or your
// home folder's name (leaks.mjs). Still look at each GIF and screenshot before committing it: the
// usage line can show other account details.
// The startup logo names your plan; no setting hides it, and the README's GIFs keep it (#63).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { identities, publish } from './leaks.mjs';

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
let demo = path.join(work, 'repo');

function fail(msg) {
  console.error(`record: ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: demo, stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed: ${r.error?.message ?? `exit ${r.status}`}`);
}

const git = (...args) => run('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', ...args]);

// On Windows the tapes reach the scratch repo through a drive letter of its own, so a path on
// screen reads R:\repo, not C:\Users\<name>\... (#60). The letter points at the demo folder, which
// stays owner-only, and is removed when the script exits; one a crashed run left behind is reused.
// Elsewhere the home directory stays in the path, and only the check after each tape catches it.
function mapDrive() {
  if (process.platform !== 'win32') return null;
  const mapped = spawnSync('subst', { encoding: 'utf8' }).stdout ?? '';
  for (const letter of 'RSTUVWXYZ') {
    const target = mapped.split(/\r?\n/).find((l) => l.toUpperCase().startsWith(`${letter}:\\: => `))?.slice(8);
    const ours = target && path.resolve(target).toLowerCase() === work.toLowerCase();
    if (!ours && (target || fs.existsSync(`${letter}:\\`))) continue;
    if (!ours && spawnSync('subst', [`${letter}:`, work]).status !== 0) continue;
    process.on('exit', () => spawnSync('subst', [`${letter}:`, '/D']));
    return `${letter}:`;
  }
  console.error('record: no free drive letter for the scratch repo; paths on screen will show your user name');
  return null;
}

function buildDemo({ onDrive }) {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true, mode: 0o700 });
  // Before anything is installed, so the hook paths the installer writes use the drive letter too.
  const drive = onDrive && mapDrive();
  if (drive) demo = `${drive}\\repo`;
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

// Who you are, as a recording could show it (leaks.mjs). os.userInfo() throws where the user has no
// passwd entry; the home folder's name is checked either way.
const names = identities({
  user: (() => { try { return os.userInfo().username; } catch { return process.env.USER ?? process.env.USERNAME; } })(),
  home: os.homedir(),
  shortHome: process.platform === 'win32'
    ? spawnSync('cmd', ['/d', '/c', `for %I in ("${os.homedir()}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true }).stdout?.trim()
    : undefined,
});

// vhs writes a tape's GIF and screenshots to out/<tape>/ in the demo folder; publish() copies them
// into docs/media only if no frame shows one of the names.
function record(name) {
  const slash = (p) => p.replaceAll('\\', '/');
  const out = path.join(work, 'out', name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const tape = fs.readFileSync(path.join(here, `${name}.tape`), 'utf8')
    .replaceAll('{{OUTPUT}}', slash(path.join(out, `${name}.gif`)))
    .replaceAll('{{SHOTS}}', slash(out))
    .replaceAll('{{WORK}}', slash(work))
    .replaceAll('{{BOARD}}', slash(path.join(repo, 'mods', 'speckit-board')))
    .replaceAll('{{SHELL}}', SHELL)
    .replaceAll('{{CLAUDE}}', CLAUDE);
  const file = path.join(work, `${name}.tape`);
  fs.writeFileSync(file, tape);
  const r = spawnSync('vhs', [file], { cwd: demo, stdio: 'inherit' });
  if (r.status !== 0) return `FAILED (${r.error?.message ?? `exit ${r.status}`})`;
  const dump = path.join(work, `${name}.txt`);
  if (!fs.existsSync(dump)) return `FAILED (no ${dump} to check for your user name)`;
  const shown = publish({ dump: fs.readFileSync(dump, 'utf8'), names, out, media: here });
  return shown.length
    ? `NOT COPIED to docs/media: ${shown.length} lines of ${dump} show your user name; the files are in ${out}:\n  ${shown.slice(0, 5).join('\n  ')}`
    : 'recorded';
}

const args = process.argv.slice(2);
const setupOnly = args.includes('--setup-only');
const wanted = args.filter((a) => a !== '--setup-only');
const unknown = wanted.filter((t) => !TAPES.includes(t));
if (unknown.length) fail(`unknown tape ${unknown.join(', ')}; choose from ${TAPES.join(', ')}`);

// --setup-only leaves the repo for you to use after the script exits, when the drive letter is gone
// and hook paths written through it would point nowhere.
buildDemo({ onDrive: !setupOnly });
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
