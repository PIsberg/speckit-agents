#!/usr/bin/env node
// A whole /speckit-team run with real models, headless, judged only on what does not depend on the
// models' wording (#46). .github/workflows/full-run.yml runs it; it costs $2 to $4 a run.
//
//   node tools/full-run.mjs --out <dir> [--model sonnet] [--max-cost 6] [--max-turns 8]
//
// It builds a scratch Spec Kit repo in <dir>/repo from this checkout's Spec Kit files and
// test/fixtures/full-run, installs the team into a throwaway config dir, <dir>/cfg, and runs
// `/speckit-team <request>` with `claude -p`. Each of the skill's stops ends a turn; the next turn
// resumes the session with one answer that takes the full team, approves and takes every recommended
// option. When spec-gatekeeper has given its word, or after --max-turns, it checks the run and writes
// <dir>/run.json. Exit 0 only when every check passed. The agents run on their own `model:` lines;
// --model is the main session's. ANTHROPIC_API_KEY must be set; nothing is retried.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarise } from './usage.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'full-run');
// Spec Kit's own files, as `specify init --integration claude` laid them in this checkout, so CI
// needs no specify CLI. Not the constitution or the active feature: those are the fixture's.
const SPEC_KIT = ['.specify/templates', '.specify/scripts', '.specify/extensions', '.specify/extensions.yml',
  '.specify/integrations', '.specify/workflows', '.specify/init-options.json', '.specify/integration.json'];
const ANSWER = 'Full team. I approve the spec, the plan and the tasks, and I take every recommended option. '
  + 'Go on to the next step.';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const git = (cwd, ...args) => {
  const r = run('git', ['-c', 'user.name=full-run', '-c', 'user.email=full-run@example.invalid', ...args], { cwd });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

export function buildRepo(repo) {
  fs.mkdirSync(repo, { recursive: true });
  for (const rel of SPEC_KIT) fs.cpSync(path.join(ROOT, rel), path.join(repo, rel), { recursive: true });
  for (const d of fs.readdirSync(path.join(ROOT, '.claude', 'skills')).filter((n) => n.startsWith('speckit-'))) {
    fs.cpSync(path.join(ROOT, '.claude', 'skills', d), path.join(repo, '.claude', 'skills', d), { recursive: true });
  }
  fs.mkdirSync(path.join(repo, '.specify', 'memory'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, 'constitution.md'), path.join(repo, '.specify', 'memory', 'constitution.md'));
  for (const rel of ['CLAUDE.md', 'package.json', 'src', 'test']) fs.cpSync(path.join(FIXTURE, rel), path.join(repo, rel), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'mathlib, before the feature');
  return { request: fs.readFileSync(path.join(FIXTURE, 'request.txt'), 'utf8').trim() };
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// What the issue asks of a finished run, none of it the models' wording. One line per failed check.
export function checkRun({ repo, usage, costs, maxCost }) {
  const out = [];
  const state = path.join(repo, '.git', 'speckit-team');
  const records = (dir) => (fs.existsSync(path.join(state, dir)) ? fs.readdirSync(path.join(state, dir)) : [])
    .map((f) => readJson(path.join(state, dir, f))).filter(Boolean);
  const verdicts = records('verdicts');
  if (!verdicts.some((v) => v.verdict === 'PASS')) out.push(`no audit PASS recorded in .git/speckit-team/verdicts/ (found: ${verdicts.map((v) => v.verdict).join(', ') || 'none'})`);
  const ends = records('ends');
  if (!ends.some((e) => e.word === 'APPROVED')) out.push(`spec-gatekeeper's APPROVED is not recorded in .git/speckit-team/ends/ (found: ${ends.map((e) => e.word).join(', ') || 'none'})`);
  const feature = ends[0]?.feature ?? verdicts[0]?.feature;
  const tasks = feature && path.join(repo, feature, 'tasks.md');
  if (!tasks || !fs.existsSync(tasks)) out.push(`no tasks.md for the feature (${feature ?? 'no feature recorded'})`);
  else {
    const open = fs.readFileSync(tasks, 'utf8').split(/\r?\n/).filter((l) => /^\s*[-*]\s+\[ \]/.test(l));
    if (open.length) out.push(`${open.length} task(s) in tasks.md not ticked: ${open.map((l) => l.trim()).join(' | ')}`);
  }
  // Without NODE_TEST_CONTEXT: under a parent `node --test` the repo's runner would report to it and
  // exit 0 whatever its tests did.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const t = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], { cwd: repo, env, shell: process.platform === 'win32' });
  if (t.status !== 0) out.push(`the scratch repo's npm test exits ${t.status}: ${(t.stdout + t.stderr).trim().split('\n').slice(-5).join(' | ')}`);
  const launches = usage?.main?.launches ?? [];
  if (!launches.length) out.push('no agent was launched');
  const bg = launches.filter((l) => l.background);
  if (bg.length) out.push(`${bg.length} agent(s) launched in the background: ${bg.map((l) => l.type).join(', ')}`);
  if (usage?.main?.waits) out.push(`${usage.main.waits} main-session response(s) only waited for a background agent`);
  // A resumed session's total_cost_usd already counts the turns before it: the largest is the run's.
  const cost = Math.max(0, ...costs.map((c) => Number(c) || 0));
  if (cost > maxCost) out.push(`the run cost $${cost.toFixed(2)}, over the ceiling of $${maxCost}`);
  return out;
}

function args(argv) {
  const o = { model: 'sonnet', maxCost: 6, maxTurns: 8 };
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--out') o.out = path.resolve(v);
    else if (k === '--model') o.model = v;
    else if (k === '--max-cost') o.maxCost = Number(v);
    else if (k === '--max-turns') o.maxTurns = Number(v);
    else throw new Error(`unknown argument ${k}`);
  }
  if (!o.out || !Number.isFinite(o.maxCost) || !Number.isInteger(o.maxTurns)) throw new Error('usage: node tools/full-run.mjs --out <dir> [--model m] [--max-cost usd] [--max-turns n]');
  return o;
}

function main() {
  const o = args(process.argv.slice(2));
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  fs.rmSync(o.out, { recursive: true, force: true });
  const repo = path.join(o.out, 'repo');
  const cfg = path.join(o.out, 'cfg');
  const { request } = buildRepo(repo);
  // A session started from a parent Claude Code session would inherit its variables.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$)/.test(k)));
  Object.assign(env, { CLAUDE_CONFIG_DIR: cfg, MSYS_NO_PATHCONV: '1' });
  const install = run(process.execPath, [path.join(ROOT, 'install.mjs')], { env });
  if (install.status !== 0) throw new Error(`install.mjs failed: ${install.stdout}${install.stderr}`);
  // Folder trust, or Claude Code skips the agents' frontmatter hooks (README, "Troubleshooting").
  const conf = readJson(path.join(cfg, '.claude.json')) ?? {};
  conf.hasCompletedOnboarding = true;
  (conf.projects ??= {})[repo.replaceAll('\\', '/')] = { hasTrustDialogAccepted: true };
  fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify(conf, null, 2));

  const turns = [];
  let session = null;
  for (let n = 0; n < o.maxTurns; n++) {
    const prompt = n === 0 ? `/speckit-team ${request}` : ANSWER;
    const r = run('claude', ['-p', prompt, '--model', o.model, '--permission-mode', 'bypassPermissions',
      '--output-format', 'json', ...(session ? ['--resume', session] : [])], { cwd: repo, env, maxBuffer: 64 << 20, timeout: 40 * 60_000 });
    let res = null;
    try { res = JSON.parse(r.stdout); } catch { /* claude printed no result: the turn failed */ }
    turns.push({ prompt: prompt.slice(0, 80), status: r.status, cost: res?.total_cost_usd ?? null, turns: res?.num_turns ?? null,
      session: res?.session_id ?? null, result: String(res?.result ?? r.stderr ?? '').slice(-600) });
    console.log(`turn ${n + 1}: exit ${r.status}, $${(res?.total_cost_usd ?? 0).toFixed(2)}, ${res?.num_turns ?? '?'} model turns`);
    if (!res?.session_id) break;
    session = res.session_id;
    const ends = path.join(repo, '.git', 'speckit-team', 'ends');
    if (fs.existsSync(ends) && fs.readdirSync(ends).length) break;
  }

  const projects = path.join(cfg, 'projects');
  const transcript = session && fs.existsSync(projects) && fs.readdirSync(projects)
    .map((p) => path.join(projects, p, `${session}.jsonl`)).find((f) => fs.existsSync(f));
  const usage = transcript ? summarise(transcript) : null;
  const failures = checkRun({ repo, usage, costs: turns.map((t) => t.cost), maxCost: o.maxCost });
  if (!transcript) failures.push('no transcript of the main session was found');
  const report = { model: o.model, maxCost: o.maxCost, cost: Math.max(0, ...turns.map((t) => t.cost ?? 0)), turns, transcript, usage, failures, platform: `${os.platform()} ${os.release()}` };
  fs.writeFileSync(path.join(o.out, 'run.json'), JSON.stringify(report, null, 2));
  console.log(failures.length ? `FAILED:\n- ${failures.join('\n- ')}` : `passed, $${report.cost.toFixed(2)}`);
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`full-run: ${e.message}`); process.exit(2); }
}
