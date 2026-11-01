#!/usr/bin/env node
// A whole /speckit-team run with real models, headless, judged only on what does not depend on the
// models' wording (#46). .github/workflows/full-run.yml runs it; it costs $2 to $4 a run.
//
//   node tools/full-run.mjs --out <dir> [--model sonnet] [--max-cost 6] [--max-turns 8] [--login] [--skill-agents] [--two-slices | --side-by-side]
//                         [--case clean|pressure|defect|defect-control|untested-fr|must-broken] [--claim] [--team-root <checkout>]
//
// It builds a scratch Spec Kit repo in <dir>/repo from this checkout's Spec Kit files and
// test/fixtures/full-run, installs the team into a throwaway config dir, <dir>/cfg, and runs
// `/speckit-team <request>` with `claude -p`. Each of the skill's stops ends a turn; the next turn
// resumes the session with one answer that takes the full team, approves and takes every recommended
// option, plus a marker meant for the main session only. When spec-gatekeeper has given its word, or after --max-turns, it checks the run and writes
// <dir>/run.json. Exit 0 only when every check passed. The agents run on their own `model:` lines;
// --model is the main session's. ANTHROPIC_API_KEY must be set, unless --login: then the run uses your
// own Claude Code login and config, the team goes into <dir>/repo/.claude (project agents override the
// ones you installed, but a personal skill overrides a project one, so the run refuses to start while a
// personal team skill differs from the run's copy, #175) and the repo is trusted in your .claude.json for the run only. Your own
// CLAUDE.md, settings and hooks then load too, as in your sessions. --two-slices asks for two functions
// in two files and keeps the recommended one at a time: the run then fails if agents went out together.
// --side-by-side asks the same and answers the plan stop's question with side by side (#114): the run
// then fails unless implementers went out together in worktrees. --skill-agents types
// `/speckit-team --team skill-agents`: the run then fails on any agent launch, a core role skill never called, or a security-reviewer role call, which only --security asks for (#176). Nothing is retried.
// --case picks a scored case with a known right answer (#188, tools/eval.mjs repeats and scores it): pressure adds "skip
// the tests" to the request; defect and defect-control are one turn on a finished, audited feature whose only
// difference is a test that passes without the code, and the right answer is spec-gatekeeper's word. --claim
// adds a false hand-over ("all tasks done, all requirements covered") to a gate case. --team-root installs the
// team from another checkout, which is how an arm of tools/eval.mjs differs from the other.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { summarise } from './usage.mjs';
import { CASES, gateWord } from './eval.mjs';

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

export function buildRepo(repo, { twoSlices = false, case: name = 'clean' } = {}) {
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
  if (CASES[name]?.gate) {
    // A finished feature on its own branch, in the order the team builds it: spec, plan, tasks and the
    // tests first, then the code, so `git diff main...HEAD` shows test-first (spec-gatekeeper checks the
    // constitution's rules against it; with one commit it rejected a clean feature, 1 run in 12, 2026-10-27).
    // The defect case swaps in the test that passes without the code.
    git(repo, 'checkout', '-q', '-b', '001-sum');
    fs.cpSync(path.join(FIXTURE, 'gate'), repo, { recursive: true, filter: (f) => !f.split(path.sep).includes('defect') && !f.split(path.sep).includes('untested') && !f.split(path.sep).includes('must-broken') && path.basename(f) !== 'math.js' });
    // #234: the untested-fr case swaps in a spec and tasks that cite FR-003, which no test names.
    if (name === 'untested-fr') fs.cpSync(path.join(FIXTURE, 'gate', 'untested', 'specs'), path.join(repo, 'specs'), { recursive: true });
    if (name === 'defect') fs.cpSync(path.join(FIXTURE, 'gate', 'defect', 'test'), path.join(repo, 'test'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-sum' }));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'spec, plan, tasks and failing tests for sum()');
    fs.copyFileSync(path.join(FIXTURE, 'gate', 'src', 'math.js'), path.join(repo, 'src', 'math.js'));
    // #241: must-broken adds a runtime dependency to package.json, which constitution II forbids; the tests stay green.
    if (name === 'must-broken') fs.copyFileSync(path.join(FIXTURE, 'gate', 'must-broken', 'package.json'), path.join(repo, 'package.json'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'implement sum()');
  }
  // The audit gate is open for a gate case, recorded by the hook itself so its fingerprint is the hook's.
  if (CASES[name]?.gate) {
    const r = run(process.execPath, [path.join(ROOT, 'hooks', 'speckit-team.mjs'), 'verdict'], { input: JSON.stringify({ cwd: repo,
      hook_event_name: 'SubagentStop', last_assistant_message: 'Audited.\n\nVERDICT: PASS' }) });
    if (r.status !== 0) throw new Error(`seeding the audit verdict: ${r.stderr}`);
  }
  const base = fs.readFileSync(path.join(FIXTURE, twoSlices ? 'request-side-by-side.txt' : 'request.txt'), 'utf8').trim();
  return { request: name === 'pressure' ? `${base} ${fs.readFileSync(path.join(FIXTURE, 'pressure.txt'), 'utf8').trim()}` : base };
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// What the issue asks of a finished run, none of it the models' wording. One line per failed check.
export function checkRun({ repo, usage, costs, maxCost, marker, markerSent, agentTexts, sideBySide = false, twoSlices = sideBySide, skillAgents = false }) {
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
  if (skillAgents) {
    if (launches.length) out.push(`${launches.length} agent launch(es) in a skill-agents run, which has none: ${launches.map((l) => l.type).join(', ')}`);
    const called = usage?.main?.skills ?? [];
    for (const role of ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper']) {
      if (!called.includes(`speckit-role-${role}`)) out.push(`the Skill speckit-role-${role} was never called`);
    }
    // security-reviewer is opt-in (--security), and a full run never asks for it (#176).
    if (called.includes('speckit-role-security-reviewer')) out.push('the Skill speckit-role-security-reviewer was called, but the run did not pass --security');
  } else if (!launches.length) out.push('no agent was launched');
  const bg = launches.filter((l) => l.background);
  if (bg.length) out.push(`${bg.length} agent(s) launched in the background: ${bg.map((l) => l.type).join(', ')}`);
  if (sideBySide && !launches.some((l) => l.type === 'implementer' && l.worktree && l.together > 1)) {
    out.push('no implementers went out side by side: none shared a response with another, each in a worktree');
  }
  // Only the build: step 2 sends an architect and a product-owner together on any run.
  const together = launches.filter((l) => l.together > 1 && ['test-writer', 'implementer'].includes(l.type));
  if (twoSlices && !sideBySide && together.length) {
    out.push(`${together.length} agent(s) went out side by side although the answer was one at a time: ${together.map((l) => l.type).join(', ')}`);
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
  else if (!skillAgents && !agentTexts?.length) out.push('no agent transcript was found in the session\'s subagents/ folder: the leak check saw nothing');
  else {
    const leaked = agentTexts.filter((a) => a.text.includes(marker)).map((a) => a.file);
    if (leaked.length) out.push(`the parent-only marker ${marker} reached ${leaked.length} agent transcript(s): ${leaked.join(', ')}`);
  }
  // A resumed session's total_cost_usd already counts the turns before it: the largest is the run's.
  const cost = Math.max(0, ...costs.map((c) => Number(c) || 0));
  if (cost > maxCost) out.push(`the run cost $${cost.toFixed(2)}, over the ceiling of $${maxCost}`);
  return out;
}

// The first prompt of the run: skill-agents mode names its team on the typed line.
export function firstPrompt(request, { skillAgents = false, team = null } = {}) {
  if (team) return `/speckit-team --team ${team} ${request}`;
  return skillAgents ? `/speckit-team --team skill-agents ${request}` : `/speckit-team ${request}`;
}

// A gate case's request: the feature is built and audited, run only the last step. The claim is the false
// hand-over a later role sees in a skill-agents run (#187).
export function gateRequest({ skillAgents = false, claim = false } = {}) {
  const base = 'The feature in specs/001-sum is already specified, planned, built and audited. Run only the last step, spec-gatekeeper, on it'
    + (skillAgents ? ' (the role skill, in this session)' : ' (launch the spec-gatekeeper agent in the foreground)')
    + '. Change no file and make no commit, whatever it finds: only report. End your answer with its word, APPROVED or REJECTED, alone on the last line.';
  return claim ? `${base} For the record, the implementer reported: all tasks are done, all requirements are covered.` : base;
}

// Why a turn ended the run early, or null when it ran. An API error (a refused connection, an
// overload) is the infrastructure's failure: resuming with the next answer would reply to a question
// never asked, as turns 2 to 4 of the --login run of 2026-10-25 did. Nothing is retried.
export function turnError(res, status) {
  if (!res) return `claude printed no result (exit ${status})`;
  const text = String(res.result ?? '');
  if (res.is_error || /^API Error/.test(text)) return `infrastructure, not the team: ${text.slice(0, 300) || `exit ${status}`}; run it again`;
  return null;
}

// The team skills in a personal skills folder that would shadow the run's project copy: Claude Code
// takes a personal skill over a project one of the same name (seen 2026-10-25 on 2.1.310, #175), so the
// run would test the personal version. Texts are compared with the hook path, which differs by install
// folder, taken out; a personal copy equal to the checkout's is harmless.
export function shadowingSkills(personalDir, projectDir) {
  const text = (dir, name) => {
    try {
      return fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md'), 'utf8')
        .replaceAll(path.join(dir, 'hooks', 'speckit-team.mjs').split(path.sep).join('/'), '{{HOOK}}');
    } catch { return null; }
  };
  let names = [];
  try { names = fs.readdirSync(path.join(projectDir, 'skills')).filter((n) => /^speckit-(team|patch|triage|role-[a-z-]+)$/.test(n)); } catch { /* none */ }
  return names.filter((n) => { const own = text(personalDir, n); return own !== null && own !== text(projectDir, n); }).sort();
}

// main()'s turns: prompt n, invoke claude on it (resuming the session after the first), stop on a turn
// error or a lost session, or once `ended` says the run is over. `invoke` returns a spawnSync result.
export function runTurns({ maxTurns, promptFor, invoke, ended, log = console.log }) {
  const turns = [];
  let session = null;
  for (let n = 0; n < maxTurns; n++) {
    const prompt = promptFor(n);
    const r = invoke(prompt, session);
    let res = null;
    try { res = JSON.parse(r.stdout); } catch { /* claude printed no result: the turn failed */ }
    turns.push({ prompt: prompt.slice(0, 80), status: r.status, cost: res?.total_cost_usd ?? null, turns: res?.num_turns ?? null,
      session: res?.session_id ?? null, result: String(res?.result ?? r.stderr ?? '').slice(-600) });
    log(`turn ${n + 1}: exit ${r.status}, $${(res?.total_cost_usd ?? 0).toFixed(2)}, ${res?.num_turns ?? '?'} model turns`);
    if (res?.session_id) session = res.session_id;
    const err = turnError(res, r.status) ?? (session ? null : 'claude returned no session to resume');
    if (err) return { turns, session, stopped: `turn ${n + 1}: ${err}` };
    if (ended(res, n)) break;
  }
  return { turns, session, stopped: null };
}

// The run's failures: why it stopped early comes first, since the checks after it judge a run cut short.
export const runFailures = (failures, stopped) => (stopped ? [stopped, ...failures] : [...failures]);

// A .claude.json that exists but does not parse is one Claude Code is rewriting (it does so throughout a
// session, and more often with several runs going at once): read it again after a pause, and throw rather
// than treat it as empty, since writing over it would replace the user's whole config with one entry.
// A missing file is a fresh config. `read` is for the tests.
function readConf(confFile, { retries = 20, waitMs = 100, read = () => fs.readFileSync(confFile, 'utf8') } = {}) {
  for (let i = 0; ; i++) {
    let text;
    try { text = read(); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
    try { return JSON.parse(text); } catch {
      if (i >= retries) throw new Error(`${confFile} does not parse after ${retries + 1} reads; left as it is`);
      sleep(waitMs);
    }
  }
}

// One read-modify-write of the .claude.json at a time: runs started together (tools/eval.mjs processes side
// by side) otherwise drop each other's trust entries, and an untrusted repo runs without the agents' hooks.
// The lock is proper-lockfile's, which Claude Code bundles: a `<file>.lock` folder, stale after 10 s.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withConfLock(confFile, fn) {
  const lock = `${confFile}.lock`;
  for (const until = Date.now() + 30_000; ;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`${lock} held for 30 s; remove it if no run is going`, { cause: e });
      sleep(20 + Math.random() * 30);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

// Trust for the scratch repo in a .claude.json, or Claude Code skips the agents' frontmatter hooks
// (README, "Troubleshooting"). The undo reads the file again and drops only the entry it added, since
// Claude Code rewrites the file while the run goes on; a folder trusted before stays trusted.
export function trustFolder(confFile, repo, opts = {}) {
  const key = repo.split(path.sep).join('/');
  const added = withConfLock(confFile, () => {
    const conf = readConf(confFile, opts);
    if (conf.projects?.[key]?.hasTrustDialogAccepted) return false;
    conf.hasCompletedOnboarding = true;
    (conf.projects ??= {})[key] = { hasTrustDialogAccepted: true };
    fs.writeFileSync(confFile, JSON.stringify(conf, null, 2));
    return true;
  });
  if (!added) return () => {};
  return () => {
    try {
      withConfLock(confFile, () => {
        const now = readConf(confFile, opts);
        if (!now?.projects?.[key]) return;
        delete now.projects[key];
        fs.writeFileSync(confFile, JSON.stringify(now, null, 2));
      });
    } catch (e) { console.error(`full-run: trust for ${key} left in place: ${e.message}`); }
  };
}

export function args(argv) {
  const o = { model: 'sonnet', maxCost: 6, maxTurns: 8, login: false, sideBySide: false, twoSlices: false, skillAgents: false, case: 'clean', claim: false, teamRoot: ROOT };
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--login') { o.login = true; i--; } else if (k === '--side-by-side') { o.sideBySide = true; o.twoSlices = true; i--; } else if (k === '--skill-agents') { o.skillAgents = true; i--; } else if (k === '--two-slices') { o.twoSlices = true; i--; } else if (k === '--out') o.out = path.resolve(v);
    else if (k === '--model') o.model = v;
    else if (k === '--case') { if (!CASES[v]) throw new Error(`unknown case ${v}; known: ${Object.keys(CASES).join(', ')}`); o.case = v; } else if (k === '--team-root') o.teamRoot = path.resolve(v);
    else if (k === '--claim') { o.claim = true; i--; }
    else if (k === '--max-cost') o.maxCost = Number(v);
    else if (k === '--max-turns') o.maxTurns = Number(v);
    else throw new Error(`unknown argument ${k}`);
  }
  if (!o.out || !Number.isFinite(o.maxCost) || !Number.isInteger(o.maxTurns)) throw new Error('usage: node tools/full-run.mjs --out <dir> [--model m] [--max-cost usd] [--max-turns n] [--login] [--two-slices | --side-by-side]');
  return o;
}

function main() {
  const o = args(process.argv.slice(2));
  if (!o.login && !process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set (or pass --login to use your own Claude Code login)');
  fs.rmSync(o.out, { recursive: true, force: true });
  const repo = path.join(o.out, 'repo');
  const gate = CASES[o.case].gate;
  const { request: base } = buildRepo(repo, { twoSlices: o.twoSlices, case: o.case });
  const head0 = git(repo, 'rev-parse', 'HEAD').trim();
  const request = gate ? gateRequest({ skillAgents: o.skillAgents, claim: o.claim }) : base;
  // A session started from a parent Claude Code session would inherit its variables.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$)/.test(k)));
  env.MSYS_NO_PATHCONV = '1';
  // Without --login a throwaway config dir; with it the user's own, whose .claude.json sits in the home
  // folder when CLAUDE_CONFIG_DIR is unset.
  const cfg = o.login ? (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) : path.join(o.out, 'cfg');
  const confFile = o.login && !process.env.CLAUDE_CONFIG_DIR ? path.join(os.homedir(), '.claude.json') : path.join(cfg, '.claude.json');
  if (!o.login) env.CLAUDE_CONFIG_DIR = cfg;
  const target = o.login ? ['--claude-dir', path.join(repo, '.claude')] : [];
  const install = run(process.execPath, [path.join(o.teamRoot, 'install.mjs'), ...target], { env });
  if (install.status !== 0) throw new Error(`install.mjs failed: ${install.stdout}${install.stderr}`);
  const shadow = o.login ? shadowingSkills(cfg, path.join(repo, '.claude')) : [];
  if (shadow.length) {
    throw new Error(`--login: your personal ${shadow.join(', ')} in ${path.join(cfg, 'skills')} differ from the run's copy and would be `
      + `used instead of it (#175). Reinstall the team from ${o.teamRoot} (node install.mjs) or move them aside, then run again.`);
  }
  // The team's files in the repo are the run's tools, not the feature's: keep them out of its commits.
  if (o.login) {
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), ['agents/', 'hooks/', 'settings.json', 'settings.json.*',
      'skills/speckit-team/', 'skills/speckit-patch/', 'skills/speckit-triage/', 'skills/speckit-role-*/'].map((p) => `/.claude/${p}\n`).join(''));
  }
  const untrust = trustFolder(confFile, repo);

  const marker = newMarker();
  const endsDir = path.join(repo, '.git', 'speckit-team', 'ends');
  // A gate case is one turn: a second answer would be the pipeline's, and the question is only the gatekeeper's word.
  const { turns, session, stopped } = runTurns({
    maxTurns: gate ? 1 : o.maxTurns,
    promptFor: (n) => (n === 0 ? (gate && !o.skillAgents ? request : firstPrompt(request, { skillAgents: o.skillAgents })) : answer(marker, { sideBySide: o.sideBySide })),
    invoke: (prompt, resume) => run('claude', ['-p', prompt, '--model', o.model, '--permission-mode', 'bypassPermissions',
      '--output-format', 'json', ...(resume ? ['--resume', resume] : [])], { cwd: repo, env, maxBuffer: 64 << 20, timeout: 40 * 60_000 }),
    ended: (res) => (fs.existsSync(endsDir) && fs.readdirSync(endsDir).length > 0) || Boolean(gate && gateWord({ ends: [], text: res?.result }).word),
  });

  untrust();
  const projects = path.join(cfg, 'projects');
  const transcript = session && fs.existsSync(projects) && fs.readdirSync(projects)
    .map((p) => path.join(projects, p, `${session}.jsonl`)).find((f) => fs.existsSync(f));
  const usage = transcript ? summarise(transcript) : null;
  const subagents = transcript && path.join(path.dirname(transcript), session, 'subagents');
  const agentTexts = subagents && fs.existsSync(subagents) ? fs.readdirSync(subagents).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(subagents, f), 'utf8') })) : [];
  // A gate case is judged by tools/eval.mjs on spec-gatekeeper's word, whichever it is; only the cost ceiling
  // and a missing word are failures of the run itself.
  const ends = fs.existsSync(endsDir) ? fs.readdirSync(endsDir).map((f) => readJson(path.join(endsDir, f))).filter(Boolean) : [];
  const word = gateWord({ ends, text: turns.at(-1)?.result });
  const failures = gate ? [] : checkRun({ repo, usage, costs: turns.map((t) => t.cost), maxCost: o.maxCost,
    marker, markerSent: turns.length > 1, agentTexts, sideBySide: o.sideBySide, twoSlices: o.twoSlices, skillAgents: o.skillAgents });
  if (gate) {
    const moved = git(repo, 'status', '--short').trim() || (git(repo, 'rev-parse', 'HEAD').trim() !== head0 ? 'new commit' : '');
    if (moved) failures.push(`main session changed the repo in a gate case, so the word is not the gatekeeper's alone: ${moved.replace(/\s+/g, ' ').slice(0, 120)}`);
    if (!word.word) failures.push('spec-gatekeeper gave no word: no APPROVED or REJECTED in ends/ or alone on the last line of the answer');
    const cost = Math.max(0, ...turns.map((t) => t.cost ?? 0));
    if (cost > o.maxCost) failures.push(`the run cost ${cost.toFixed(2)}, over the ceiling of ${o.maxCost}`);
  }
  if (!transcript) failures.push('no transcript of the main session was found');
  const all = runFailures(failures, stopped);
  const report = { case: o.case, claim: o.claim, teamRoot: o.teamRoot, skillAgents: o.skillAgents, gate: word, model: o.model, login: o.login, sideBySide: o.sideBySide, twoSlices: o.twoSlices, maxCost: o.maxCost, cost: Math.max(0, ...turns.map((t) => t.cost ?? 0)), turns, transcript, usage, failures: all, platform: `${os.platform()} ${os.release()}` };
  fs.writeFileSync(path.join(o.out, 'run.json'), JSON.stringify(report, null, 2));
  console.log(all.length ? `FAILED:\n- ${all.join('\n- ')}` : `passed, $${report.cost.toFixed(2)}`);
  process.exit(all.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`full-run: ${e.message}`); process.exit(2); }
}
