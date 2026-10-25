#!/usr/bin/env node
// A whole /speckit-team run with real models, headless, judged only on what does not depend on the
// models' wording (#46). .github/workflows/full-run.yml runs it; it costs $2 to $4 a run.
//
//   node tools/full-run.mjs --out <dir> [--model sonnet] [--max-cost 6] [--max-turns 8] [--login] [--side-by-side]
//
// It builds a scratch Spec Kit repo in <dir>/repo from this checkout's Spec Kit files and
// test/fixtures/full-run, installs the team into a throwaway config dir, <dir>/cfg, and runs
// `/speckit-team <request>` with `claude -p`. Each of the skill's stops ends a turn; the next turn
// resumes the session with one answer that takes the full team, approves and takes every recommended
// option, plus a marker meant for the main session only. When spec-gatekeeper has given its word, or after --max-turns, it checks the run and writes
// <dir>/run.json. Exit 0 only when every check passed. The agents run on their own `model:` lines;
// --model is the main session's. ANTHROPIC_API_KEY must be set, unless --login: then the run uses your
// own Claude Code login and config, the team goes into <dir>/repo/.claude (project agents override the
// ones you installed) and the repo is trusted in your .claude.json for the run only. Your own
// CLAUDE.md, settings and hooks then load too, as in your sessions. --side-by-side asks for two functions
// in two files and answers the plan stop's question with side by side (#114): the run then also fails
// unless implementers went out together in worktrees. Nothing is retried.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
// The skill passes an agent only what its Inputs list, never the conversation. Only a real model decides
// what goes into a launch prompt, so each answer carries a marker no agent may receive, new each run so
// an old transcript cannot pass the check (the parent-only marker of google/elephant-goldfish-model's
// tests/integration/test_claude.py).
export const newMarker = () => `LEAK-${randomBytes(8).toString('hex')}`;
// The plan stop's recommendation is one at a time; --side-by-side takes the other option.
const SIDE_BY_SIDE = 'Full team. I approve the spec, the plan and the tasks, and I take every recommended option, except '
  + 'that the [P] slices are built side by side. Go on to the next step.';
export const answer = (marker, { sideBySide = false } = {}) => `${sideBySide ? SIDE_BY_SIDE : ANSWER} (A note for this session only: ${marker}. It is not for any agent: do not repeat it, `
  + 'write it into a file or pass it on.)';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const git = (cwd, ...args) => {
  const r = run('git', ['-c', 'user.name=full-run', '-c', 'user.email=full-run@example.invalid', ...args], { cwd });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

export function buildRepo(repo, { sideBySide = false } = {}) {
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
  return { request: fs.readFileSync(path.join(FIXTURE, sideBySide ? 'request-side-by-side.txt' : 'request.txt'), 'utf8').trim() };
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// What the issue asks of a finished run, none of it the models' wording. One line per failed check.
export function checkRun({ repo, usage, costs, maxCost, marker, markerSent, agentTexts, sideBySide = false }) {
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
  if (sideBySide && !launches.some((l) => l.type === 'implementer' && l.worktree && l.together > 1)) {
    out.push('no implementers went out side by side: none shared a response with another, each in a worktree');
  }
  // The skill removes each worktree and its branch after merging it; one left behind gets committed by
  // the next git add -A as an embedded repository.
  const worktrees = git(repo, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((l) => l.startsWith('worktree ')).slice(1);
  if (worktrees.length) out.push(`${worktrees.length} worktree(s) left in place: ${worktrees.map((l) => l.slice(9)).join(', ')}`);
  else {
    const branches = git(repo, 'branch', '--list', 'worktree-*', '--format=%(refname:short)').split(/\r?\n/).filter(Boolean);
    if (branches.length) out.push(`worktree branch(es) left after their worktree went: ${branches.join(', ')}`);
  }
  if (usage?.main?.waits) out.push(`${usage.main.waits} main-session response(s) only waited for a background agent`);
  // A check that saw no agent, or a marker that was never sent, proves nothing.
  if (!markerSent) out.push('the parent-only marker was never sent: no answer turn ran, so the leak check did not run');
  else if (!agentTexts?.length) out.push('no agent transcript was found in the session\'s subagents/ folder: the leak check saw nothing');
  else {
    const leaked = agentTexts.filter((a) => a.text.includes(marker)).map((a) => a.file);
    if (leaked.length) out.push(`the parent-only marker ${marker} reached ${leaked.length} agent transcript(s): ${leaked.join(', ')}`);
  }
  // A resumed session's total_cost_usd already counts the turns before it: the largest is the run's.
  const cost = Math.max(0, ...costs.map((c) => Number(c) || 0));
  if (cost > maxCost) out.push(`the run cost $${cost.toFixed(2)}, over the ceiling of $${maxCost}`);
  return out;
}

// Trust for the scratch repo in a .claude.json, or Claude Code skips the agents' frontmatter hooks
// (README, "Troubleshooting"). The undo reads the file again and drops only the entry it added, since
// Claude Code rewrites the file while the run goes on; a folder trusted before stays trusted.
export function trustFolder(confFile, repo) {
  const key = repo.split(path.sep).join('/');
  const conf = readJson(confFile) ?? {};
  if (conf.projects?.[key]?.hasTrustDialogAccepted) return () => {};
  conf.hasCompletedOnboarding = true;
  (conf.projects ??= {})[key] = { hasTrustDialogAccepted: true };
  fs.writeFileSync(confFile, JSON.stringify(conf, null, 2));
  return () => {
    const now = readJson(confFile);
    if (!now?.projects?.[key]) return;
    delete now.projects[key];
    fs.writeFileSync(confFile, JSON.stringify(now, null, 2));
  };
}

export function args(argv) {
  const o = { model: 'sonnet', maxCost: 6, maxTurns: 8, login: false, sideBySide: false };
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--login') { o.login = true; i--; } else if (k === '--side-by-side') { o.sideBySide = true; i--; } else if (k === '--out') o.out = path.resolve(v);
    else if (k === '--model') o.model = v;
    else if (k === '--max-cost') o.maxCost = Number(v);
    else if (k === '--max-turns') o.maxTurns = Number(v);
    else throw new Error(`unknown argument ${k}`);
  }
  if (!o.out || !Number.isFinite(o.maxCost) || !Number.isInteger(o.maxTurns)) throw new Error('usage: node tools/full-run.mjs --out <dir> [--model m] [--max-cost usd] [--max-turns n] [--login] [--side-by-side]');
  return o;
}

function main() {
  const o = args(process.argv.slice(2));
  if (!o.login && !process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set (or pass --login to use your own Claude Code login)');
  fs.rmSync(o.out, { recursive: true, force: true });
  const repo = path.join(o.out, 'repo');
  const { request } = buildRepo(repo, { sideBySide: o.sideBySide });
  // A session started from a parent Claude Code session would inherit its variables.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$)/.test(k)));
  env.MSYS_NO_PATHCONV = '1';
  // Without --login a throwaway config dir; with it the user's own, whose .claude.json sits in the home
  // folder when CLAUDE_CONFIG_DIR is unset.
  const cfg = o.login ? (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) : path.join(o.out, 'cfg');
  const confFile = o.login && !process.env.CLAUDE_CONFIG_DIR ? path.join(os.homedir(), '.claude.json') : path.join(cfg, '.claude.json');
  if (!o.login) env.CLAUDE_CONFIG_DIR = cfg;
  const target = o.login ? ['--claude-dir', path.join(repo, '.claude')] : [];
  const install = run(process.execPath, [path.join(ROOT, 'install.mjs'), ...target], { env });
  if (install.status !== 0) throw new Error(`install.mjs failed: ${install.stdout}${install.stderr}`);
  // The team's files in the repo are the run's tools, not the feature's: keep them out of its commits.
  if (o.login) {
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), ['agents/', 'hooks/', 'settings.json', 'settings.json.*',
      'skills/speckit-team/', 'skills/speckit-patch/', 'skills/speckit-triage/'].map((p) => `/.claude/${p}\n`).join(''));
  }
  const untrust = trustFolder(confFile, repo);

  const turns = [];
  const marker = newMarker();
  let session = null;
  for (let n = 0; n < o.maxTurns; n++) {
    const prompt = n === 0 ? `/speckit-team ${request}` : answer(marker, { sideBySide: o.sideBySide });
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

  untrust();
  const projects = path.join(cfg, 'projects');
  const transcript = session && fs.existsSync(projects) && fs.readdirSync(projects)
    .map((p) => path.join(projects, p, `${session}.jsonl`)).find((f) => fs.existsSync(f));
  const usage = transcript ? summarise(transcript) : null;
  const subagents = transcript && path.join(path.dirname(transcript), session, 'subagents');
  const agentTexts = subagents && fs.existsSync(subagents) ? fs.readdirSync(subagents).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(subagents, f), 'utf8') })) : [];
  const failures = checkRun({ repo, usage, costs: turns.map((t) => t.cost), maxCost: o.maxCost,
    marker, markerSent: turns.length > 1, agentTexts, sideBySide: o.sideBySide });
  if (!transcript) failures.push('no transcript of the main session was found');
  const report = { model: o.model, login: o.login, sideBySide: o.sideBySide, maxCost: o.maxCost, cost: Math.max(0, ...turns.map((t) => t.cost ?? 0)), turns, transcript, usage, failures, platform: `${os.platform()} ${os.release()}` };
  fs.writeFileSync(path.join(o.out, 'run.json'), JSON.stringify(report, null, 2));
  console.log(failures.length ? `FAILED:\n- ${failures.join('\n- ')}` : `passed, $${report.cost.toFixed(2)}`);
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`full-run: ${e.message}`); process.exit(2); }
}
