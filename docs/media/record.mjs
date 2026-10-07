#!/usr/bin/env node
// Records the agent-view GIFs in README.md. Each tape drives a real Claude Code session (Haiku,
// main session and subagents) in a throwaway Spec Kit repo, so a run costs a little and the
// output differs from run to run. Needs vhs, specify, claude and git on PATH.
//
//   node docs/media/record.mjs                  all tapes
//   node docs/media/record.mjs pipeline         only the named tapes
//   node docs/media/record.mjs --setup-only     build the scratch repo, record nothing
//
// The team is installed into the scratch repo's own .claude/, and Claude Code is started with
// --setting-sources project,local and --strict-mcp-config, so your user-level hooks, plugins,
// statusline and MCP servers stay out of the recording. Check each GIF before committing it:
// the session banner can still show account details.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
// Order matters: pipeline needs a clean tree on main, and every tape gets one (see resetDemo).
const TAPES = ['agents-list', 'guardrail-denial', 'subagent-inline', 'pipeline'];
const CLAUDE = "claude --model haiku --setting-sources project,local --strict-mcp-config"
  + " --allowedTools 'Bash Read Write Edit Glob Grep Skill'";
// vhs on Windows resolves `bash` to WSL, which has neither the env nor claude; pwsh has both.
const SHELL = process.platform === 'win32' ? 'pwsh' : 'bash';
// A fixed path, so Claude Code's folder trust survives between runs.
const work = path.join(os.tmpdir(), 'speckit-agents-demo');
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
  fs.mkdirSync(demo, { recursive: true });
  git('init', '-q', '-b', 'main');
  // Without --script, specify waits on an interactive picker. Without UTF-8, specify on Windows
  // crashes printing its banner into a pipe (cp1252).
  run('specify', ['init', '--here', '--ai', 'claude', '--force', '--ignore-agent-tools',
    '--script', process.platform === 'win32' ? 'ps' : 'sh'],
  { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  run(process.execPath, [path.join(repo, 'install.mjs'), '--claude-dir', path.join(demo, '.claude')]);
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

function record(name) {
  const tape = fs.readFileSync(path.join(here, `${name}.tape`), 'utf8')
    .replaceAll('{{OUTPUT}}', path.join(here, `${name}.gif`).replaceAll('\\', '/'))
    .replaceAll('{{SHELL}}', SHELL)
    .replaceAll('{{CLAUDE}}', CLAUDE);
  const file = path.join(work, `${name}.tape`);
  fs.writeFileSync(file, tape);
  const r = spawnSync('vhs', [file], {
    cwd: demo, stdio: 'inherit', env: { ...process.env, CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' },
  });
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
  return [t, record(t)];
});
for (const [t, status] of results) console.log(`record: ${t}.gif ${status}`);
process.exit(results.every(([, s]) => s === 'recorded') ? 0 : 1);
