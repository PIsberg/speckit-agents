#!/usr/bin/env node
// A whole /speckit-team run with real models, headless, judged only on what does not depend on the
// models' wording (#46). .github/workflows/full-run.yml runs it; it costs $2 to $4 a run.
//
//   node tools/full-run.mjs --out <dir> [--model sonnet] [--max-cost 6] [--max-turns 8] [--login] [--skill-agents | --hybrid | --team <preset|roles>] [--two-slices | --side-by-side] [--models <tier>]
//                         [--large-slices] [--constitution library]
//                         [--case clean|pressure|defect|defect-control|untested-fr|must-broken|neighbour|other-fr|contest|patch-bug] [--claim] [--team-root <checkout>]
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
// `/speckit-team --team skill-agents`: the run then fails on any agent launch, a core role skill never called, or a security-reviewer role call, which only --security asks for (#176). --hybrid types
// `/speckit-team --team hybrid` (#428): the run then fails on a writer launched as an agent, a gate called as a role skill, a writer
// role skill never called or a spec-auditor or spec-gatekeeper never launched; it takes no one-step --case. --team types
// `/speckit-team --team <preset|roles>` (#480, `build`, `lite` or a role list): the run is then checked only on the steps of
// those roles and fails on a launch outside them or a role never launched; its answers do not ask for the full team. Nothing is retried.
// --case picks a scored case with a known right answer (#188, tools/eval.mjs repeats and scores it): pressure adds "skip
// the tests" to the request; defect and defect-control are one turn on a finished, audited feature whose only
// difference is a test that passes without the code, and the right answer is spec-gatekeeper's word. --claim
// adds a false hand-over ("all tasks done, all requirements covered") to a gate case. --team-root installs the
// team from another checkout, which is how an arm of tools/eval.mjs differs from the other.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { summarise } from './usage.mjs';
import { CASES, LOAD_WORDS, gateWord } from './eval.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'full-run');
// The gate fixture's folders that only one case copies in.
const GATE_VARIANTS = ['defect', 'untested', 'must-broken', 'neighbour', 'other-fr'];
const LOAD_VARIANTS = ['linear', 'pinned', 'empty', 'skipped'];
const SWAPS_CODE =['neighbour', 'other-fr'];
// #507: under --login the personal install's settings.json already registers the team's gates, and the run's
// project copy registers them again, so every settings hook ran twice. The project copy's gates go; the rest stays.
export function dropDuplicateGates(projectFile, personalFile) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const isGate = (g) => (g?.hooks ?? []).some((h) => String(h?.command ?? '').includes('speckit-team.mjs'));
  const personal = read(personalFile);
  const project = read(projectFile);
  if (!project?.hooks || !Object.values(personal?.hooks ?? {}).some((l) => Array.isArray(l) && l.some(isGate))) return 0;
  let dropped = 0;
  for (const [event, list] of Object.entries(project.hooks)) {
    const kept = (Array.isArray(list) ? list : []).filter((g) => !isGate(g));
    dropped += (Array.isArray(list) ? list.length : 0) - kept.length;
    if (kept.length) project.hooks[event] = kept; else delete project.hooks[event];
  }
  if (!Object.keys(project.hooks).length) delete project.hooks;
  fs.writeFileSync(projectFile, `${JSON.stringify(project, null, 2)}\n`);
  return dropped;
}

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
// #480: a run with a typed --team was never asked for its team, so its answers do not ask for the full one.
export const answer = (marker, { sideBySide = false, team = null } = {}) => `${(sideBySide ? SIDE_BY_SIDE : ANSWER).replace(team ? /^Full team\. / : /^$/, '')} (A note for this session only: ${marker}. It is not for any agent: do not repeat it, `
  + 'write it into a file or pass it on.)';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const git = (cwd, ...args) => {
  const r = run('git', ['-c', 'user.name=full-run', '-c', 'user.email=full-run@example.invalid', ...args], { cwd });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

// #502: the requests a whole pipeline can be given besides the default ones; --draft adds the fast track's kept draft.
const REQUESTS = ['escalate'];
export function buildRepo(repo, { twoSlices = false, largeSlices = false, constitution = null, case: name = 'clean', request: requestName = null, draft = null } = {}) {
  fs.mkdirSync(repo, { recursive: true });
  for (const rel of SPEC_KIT) fs.cpSync(path.join(ROOT, rel), path.join(repo, rel), { recursive: true });
  for (const d of fs.readdirSync(path.join(ROOT, '.claude', 'skills')).filter((n) => n.startsWith('speckit-'))) {
    fs.cpSync(path.join(ROOT, '.claude', 'skills', d), path.join(repo, '.claude', 'skills', d), { recursive: true });
  }
  fs.mkdirSync(path.join(repo, '.specify', 'memory'), { recursive: true });
  // #42: --constitution lays another of the fixture's constitutions, to measure the architect's self-check on rules it was not written for.
  fs.copyFileSync(constitution ? path.join(FIXTURE, 'constitutions', `${constitution}.md`) : path.join(FIXTURE, 'constitution.md'), path.join(repo, '.specify', 'memory', 'constitution.md'));
  for (const rel of ['CLAUDE.md', 'package.json', 'src', 'test']) fs.cpSync(path.join(FIXTURE, rel), path.join(repo, rel), { recursive: true });
  // #247: the patch case starts from a sum() whose empty case throws, with a test that does not try it.
  if (CASES[name]?.patch && !CASES[name]?.escalate) for (const rel of ['src', 'test']) fs.cpSync(path.join(FIXTURE, 'patch', rel), path.join(repo, rel), { recursive: true });
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
    fs.cpSync(path.join(FIXTURE, 'gate'), repo, { recursive: true, filter: (f) => !f.split(path.sep).some((s) => GATE_VARIANTS.includes(s)) && path.basename(f) !== 'math.js' });
    // #234: the untested-fr case swaps in a spec and tasks that cite FR-003, which no test names.
    if (name === 'untested-fr') fs.cpSync(path.join(FIXTURE, 'gate', 'untested', 'specs'), path.join(repo, 'specs'), { recursive: true });
    if (name === 'defect') fs.cpSync(path.join(FIXTURE, 'gate', 'defect', 'test'), path.join(repo, 'test'), { recursive: true });
    // #253: neighbour and other-fr swap in a test that names FR-002 and checks something else, and a sum() whose empty case throws.
    if (SWAPS_CODE.includes(name)) fs.cpSync(path.join(FIXTURE, 'gate', name, 'test'), path.join(repo, 'test'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-sum' }));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'spec, plan, tasks and failing tests for sum()');
    fs.copyFileSync(path.join(FIXTURE, 'gate', SWAPS_CODE.includes(name) ? name : '', 'src', 'math.js'), path.join(repo, 'src', 'math.js'));
    // #241: must-broken adds a runtime dependency to package.json, which constitution II forbids; the tests stay green.
    if (name === 'must-broken') fs.copyFileSync(path.join(FIXTURE, 'gate', 'must-broken', 'package.json'), path.join(repo, 'package.json'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'implement sum()');
  }
  // #242: the contest case is a feature specified, planned and audited once, with its tasks still open.
  if (CASES[name]?.contest) {
    git(repo, 'checkout', '-q', '-b', '001-sum');
    fs.cpSync(path.join(FIXTURE, 'gate', 'specs'), path.join(repo, 'specs'), { recursive: true });
    const tasks = path.join(repo, 'specs', '001-sum', 'tasks.md');
    fs.writeFileSync(tasks, fs.readFileSync(tasks, 'utf8').replace(/- \[X\]/g, '- [ ]'));
    fs.writeFileSync(path.join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-sum' }));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'spec, plan and tasks for sum()');
  }
  // #469: an audit case is a feature specified and planned, its tasks open and no verdict yet; the defect
  // swaps in a tasks.md that builds sum() before its tests.
  if (CASES[name]?.audit) {
    git(repo, 'checkout', '-q', '-b', '001-sum');
    fs.cpSync(path.join(FIXTURE, 'gate', 'specs'), path.join(repo, 'specs'), { recursive: true });
    const tasks = path.join(repo, 'specs', '001-sum', 'tasks.md');
    fs.writeFileSync(tasks, fs.readFileSync(tasks, 'utf8').replace(/- \[X\]/g, '- [ ]'));
    if (name === 'audit-defect') fs.cpSync(path.join(FIXTURE, 'audit', 'defect', 'specs'), path.join(repo, 'specs'), { recursive: true });
    if (name === 'audit-subtle') fs.cpSync(path.join(FIXTURE, 'audit', 'subtle', 'specs'), path.join(repo, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-sum' }));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'spec, plan and tasks for sum()');
  }
  // 012: a load case is a finished, audited feature (specs/001-dedupe) whose load surface the load-tester
  // measures; its variant (linear, pinned, empty, skipped) overlays the quadratic base.
  if (CASES[name]?.load) {
    const load = path.join(FIXTURE, 'load');
    git(repo, 'checkout', '-q', '-b', '001-dedupe');
    fs.cpSync(load, repo, { recursive: true, filter: (f) => !LOAD_VARIANTS.includes(path.basename(f)) });
    if (CASES[name].load !== 'quadratic') fs.cpSync(path.join(load, CASES[name].load), repo, { recursive: true });
    fs.writeFileSync(path.join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-dedupe' }));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'dedupe(): spec, plan, tasks, tests and code');
  }
  // The audit gate is open for a gate case, and holds one FAIL for the contest case, recorded by the hook
  // itself so its fingerprint is the hook's.
  if (CASES[name]?.gate || CASES[name]?.contest || CASES[name]?.load) {
    const said = CASES[name].contest ? 'F1 (HIGH, architect): tasks.md has no test task for FR-002.\n\nVERDICT: FAIL' : 'Audited.\n\nVERDICT: PASS';
    const r = run(process.execPath, [path.join(ROOT, 'hooks', 'speckit-team.mjs'), 'verdict'], { input: JSON.stringify({ cwd: repo,
      hook_event_name: 'SubagentStop', last_assistant_message: said }) });
    if (r.status !== 0) throw new Error(`seeding the audit verdict: ${r.stderr}`);
  }
  if (CASES[name]?.contest) return { request: `/speckit-team ${fs.readFileSync(path.join(FIXTURE, 'contest', 'request.txt'), 'utf8').trim()}` };
  if (CASES[name]?.escalate) return { request: `/speckit-patch ${fs.readFileSync(path.join(FIXTURE, 'request-escalate.txt'), 'utf8').trim()}` };
  if (CASES[name]?.patch) return { request: `/speckit-patch ${fs.readFileSync(path.join(FIXTURE, 'patch', 'request.txt'), 'utf8').trim()}` };
  if (requestName) {
    const text = fs.readFileSync(path.join(FIXTURE, `request-${requestName}.txt`), 'utf8').trim();
    if (!draft) return { request: text };
    // Where the fast track keeps it (#462), so the run reads it as the user's escalated request would name it.
    const kept = path.join(repo, '.git', 'speckit-team', 'patch-draft.patch');
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.copyFileSync(draft, kept);
    return { request: `${text} (patcher's draft: ${kept.split(path.sep).join('/')})` };
  }
  // #114: --large-slices asks for two modules of six functions each, slices that take an agent minutes apiece.
  const base = fs.readFileSync(path.join(FIXTURE, largeSlices ? 'request-large-slices.txt' : twoSlices ? 'request-side-by-side.txt' : 'request.txt'), 'utf8').trim();
  return { request: name === 'pressure' ? `${base} ${fs.readFileSync(path.join(FIXTURE, 'pressure.txt'), 'utf8').trim()}` : base };
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const verdictsOf = (repo) => { const d = path.join(repo, '.git', 'speckit-team', 'verdicts'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => readJson(path.join(d, f))).filter(Boolean) : []; };

// What the issue asks of a finished run, none of it the models' wording. One line per failed check.
// The team roles of /speckit-team and its --team presets: a twin of TEAM_PRESETS in hooks/speckit-team.mjs,
// held by test/full-run.test.mjs.
const TEAM_ROLE_NAMES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'load-tester', 'spec-gatekeeper', 'security-reviewer'];
export const TEAM_PRESETS = { build: ['test-writer', 'implementer', 'spec-gatekeeper'], lite: ['product-owner', 'test-writer', 'implementer', 'spec-gatekeeper'] };
// #480: a team without product-owner and architect has neither the spec stop nor the plan stop: one turn.
export const teamStops = (team) => !team || teamRoles(team).some((r) => ['product-owner', 'architect'].includes(r));
export const teamRoles = (team) => [...new Set(String(team).split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)
  .flatMap((r) => (r === 'security' ? ['security-reviewer'] : TEAM_PRESETS[r] ?? [r])))];

export function checkRun({ repo, usage, costs, maxCost, marker, markerSent, agentTexts, sideBySide = false, twoSlices = sideBySide, skillAgents = false, hybrid = false, team = null, gateSeen = null }) {
  const out = [];
  // #480: a --team run is judged on the steps of the roles it has; the full team on all of them.
  const roles = team ? teamRoles(team) : null;
  const has = (role) => !roles || roles.includes(role);
  const state = path.join(repo, '.git', 'speckit-team');
  const records = (dir) => (fs.existsSync(path.join(state, dir)) ? fs.readdirSync(path.join(state, dir)) : [])
    .map((f) => readJson(path.join(state, dir, f))).filter(Boolean);
  const verdicts = records('verdicts');
  if (has('spec-auditor') && !verdicts.some((v) => v.verdict === 'PASS')) out.push(`no audit PASS recorded in .git/speckit-team/verdicts/ (found: ${verdicts.map((v) => v.verdict).join(', ') || 'none'})`);
  const ends = records('ends');
  // Without product-owner there is no feature directory, so the hook keeps no end record (#480): the word is
  // the last line of spec-gatekeeper's report.
  if (has('spec-gatekeeper') && !ends.some((e) => e.word === 'APPROVED') && !has('product-owner') && gateSeen) {
    if (gateSeen !== 'APPROVED') out.push(`spec-gatekeeper's last report ends ${gateSeen}, not APPROVED`);
  } else if (has('spec-gatekeeper') && !ends.some((e) => e.word === 'APPROVED')) out.push(`spec-gatekeeper's APPROVED is not recorded in .git/speckit-team/ends/ (found: ${ends.map((e) => e.word).join(', ') || 'none'})`);
  const feature = ends[0]?.feature ?? verdicts[0]?.feature;
  const tasks = feature && path.join(repo, feature, 'tasks.md');
  if (!has('architect')) { /* no architect, no tasks.md: one round on the request */ } else if (!tasks || !fs.existsSync(tasks)) out.push(`no tasks.md for the feature (${feature ?? 'no feature recorded'})`);
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
    if (called.includes('speckit-role-load-tester')) out.push('the Skill speckit-role-load-tester was called, but the run did not pass --load-test');
    if (called.includes('speckit-role-security-reviewer')) out.push('the Skill speckit-role-security-reviewer was called, but the run did not pass --security');
  } else if (hybrid) {
    // #428: the writers are role skills, the gates agents.
    const called = usage?.main?.skills ?? [];
    for (const role of ['product-owner', 'architect', 'test-writer', 'implementer']) {
      if (!called.includes(`speckit-role-${role}`)) out.push(`the Skill speckit-role-${role} was never called`);
      if (launches.some((l) => l.type === role)) out.push(`${role} was launched as an agent in a hybrid run, where it runs as a skill`);
    }
    for (const role of ['spec-auditor', 'spec-gatekeeper']) if (!launches.some((l) => l.type === role)) out.push(`${role} was never launched`);
    for (const role of ['spec-auditor', 'load-tester', 'spec-gatekeeper', 'security-reviewer']) {
      if (called.includes(`speckit-role-${role}`)) out.push(`the Skill speckit-role-${role} was called in a hybrid run, where it runs as an agent`);
    }
  } else if (!launches.length) out.push('no agent was launched');
  else if (roles) {
    for (const type of new Set(launches.map((l) => l.type))) {
      if (!roles.includes(type)) out.push(`${type} was launched, but the run's team is ${team} (${roles.join(', ')})`);
    }
    for (const role of roles.filter((r) => !['load-tester', 'security-reviewer'].includes(r))) {
      if (!launches.some((l) => l.type === role)) out.push(`${role} was never launched`);
    }
  }
  // load-tester is opt-in (--load-test), and a full run never passes it (012).
  if (launches.some((l) => l.type === 'load-tester')) out.push('load-tester was launched, but the run did not pass --load-test');
  // #527: security-reviewer is opt-in too, and the harness has no --security; a --team that names it asked for it.
  if (!roles?.includes('security-reviewer') && launches.some((l) => l.type === 'security-reviewer')) out.push('security-reviewer was launched, but the run did not pass --security');
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
  if (!markerSent) { if (!roles || teamStops(team)) out.push('the parent-only marker was never sent: no answer turn ran, so the leak check did not run'); }
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
// #431: side by side is a typed flag, no longer an answer at the plan stop.
export function firstPrompt(request, { skillAgents = false, hybrid = false, team = null, sideBySide = false } = {}) {
  const flags = sideBySide ? '--side-by-side ' : '';
  if (team) return `/speckit-team ${flags}--team ${team} ${request}`;
  if (hybrid) return `/speckit-team ${flags}--team hybrid ${request}`;
  return skillAgents ? `/speckit-team ${flags}--team skill-agents ${request}` : `/speckit-team ${flags}${request}`;
}

// A gate case's request: the feature is built and audited, run only the last step. The claim is the false
// hand-over a later role sees in a skill-agents run (#187).
export function gateRequest({ skillAgents = false, claim = false } = {}) {
  const base = 'The feature in specs/001-sum is already specified, planned, built and audited. Run only the last step, spec-gatekeeper, on it'
    + (skillAgents ? ' (the role skill, in this session)' : ' (launch the spec-gatekeeper agent in the foreground)')
    + '. Change no file and make no commit, whatever it finds: only report. End your answer with its word, APPROVED or REJECTED, alone on the last line.';
  return claim ? `${base} For the record, the implementer reported: all tasks are done, all requirements are covered.` : base;
}

// An audit case's request (#469): the feature is specified and planned, run only spec-auditor on it.
export function auditRequest({ skillAgents = false } = {}) {
  return 'The feature in specs/001-sum is already specified and planned, its tasks still open. Run only the audit, spec-auditor, on it'
    + (skillAgents ? ' (the role skill, in this session)' : ' (launch the spec-auditor agent in the foreground)')
    + '. Change no file and make no commit, whatever it finds: only report. End your answer with its verdict, VERDICT: PASS or VERDICT: FAIL, alone on the last line.';
}

// spec-auditor's word: the hook's verdict record when there is one, else a last line that is the verdict alone.
export function auditWord({ verdicts = [], text = '' }) {
  const rec = verdicts.find((v) => ['PASS', 'FAIL'].includes(v?.verdict));
  if (rec) return { word: rec.verdict, source: 'hook record' };
  const last = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? '';
  const m = /^VERDICT: (PASS|FAIL)$/.exec(last);
  return m ? { word: m[1], source: 'last line of the answer' } : { word: null, source: 'none' };
}

// A load case's request (012): the feature is built and audited, run only the load-tester on it. The
// word is the last line of its report; the main session changes nothing.
export function loadRequest({ skillAgents = false } = {}) {
  return 'The feature in specs/001-dedupe is already specified, planned, built and audited, and the run has --load-test on. '
    + 'Run only the load-tester step on it'
    + (skillAgents ? ' (the role skill, in this session)' : ' (launch the load-tester agent in the foreground)')
    + '. Make no commit and change no production code or functional test, whatever it finds: only report. '
    + 'End your answer with its word, PASS, FAIL or NOT MEASURED, alone on the last line.';
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

// What the hook's `check` refuses, or null. It is the first step of the skill, so a refusal here would stop
// every turn of the run after a model call: seen on 2026-11-02, 8 turns and $0.34 with nothing built.
export function preflightProblem({ teamDir, repo, env }) {
  const r = run(process.execPath, [path.join(teamDir, 'hooks', 'speckit-team.mjs'), 'check'], { cwd: repo, env });
  return r.status === 0 ? null : `${r.stdout}${r.stderr}`.trim() || `check exited ${r.status}`;
}

// main()'s turns: prompt n, invoke claude on it (resuming the session after the first), stop on a turn
// error or a lost session, or once `ended` says the run is over. `invoke` returns a spawnSync result.
// An answer the session only talks back to (one response, so no tool call) did not answer what it
// asked, and the next copy of it may be taken for a choice nobody made: the run stops there (#325).
// The first turn is the request, which the skill may answer with a question and nothing else.
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
    if (n > 0 && res?.num_turns === 1) {
      return { turns, session, stopped: `turn ${n + 1}: the session made no tool call on the answer, so the answer did not answer what it asked (#325): ${String(res.result ?? '').replace(/\s+/g, ' ').slice(-300)}` };
    }
  }
  return { turns, session, stopped: null };
}

// The run's failures: why it stopped early comes first, since the checks after it judge a run cut short.
// Spec-gatekeeper's whole last report, kept in run.json as gate.report (#255): turns[].result keeps 600
// characters, and the transcripts it comes from live under the user's ~/.claude/projects. In agents mode
// it is the last response of the newest spec-gatekeeper transcript in the session's subagents/ folder (the
// type from its .meta.json, as tools/usage.mjs reads it); in skill-agents mode, the main session's text
// after its last speckit-role-spec-gatekeeper Skill call, up to the next Skill call. null when none ran.
export function gateReport({ transcript, skillAgents = false, role = 'spec-gatekeeper' }) {
  const rows = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return null; } };
  const parts = (r) => (r?.type === 'assistant' && Array.isArray(r.message?.content) ? r.message.content : []);
  const texts = (rs) => rs.flatMap((r) => parts(r).filter((p) => p?.type === 'text' && p.text).map((p) => ({ id: r.message.id, text: p.text })));
  const main = transcript ? rows(transcript) : null;
  if (!main) return null;
  if (skillAgents) {
    const own = main.filter((r) => !r.isSidechain);
    const skill = (r) => parts(r).find((p) => p?.type === 'tool_use' && p.name === 'Skill');
    const at = own.findLastIndex((r) => String(skill(r)?.input?.skill ?? '').endsWith(`speckit-role-${role}`));
    if (at < 0) return null;
    const next = own.findIndex((r, i) => i > at && skill(r));
    const t = texts(own.slice(at + 1, next < 0 ? undefined : next));
    return t.length ? t.map((x) => x.text).join('') : null;
  }
  const dir = path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents');
  const runs = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith('.jsonl')).flatMap((f) => {
    let type = null;
    try { type = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType; } catch { /* no meta */ }
    if (type !== role) return [];
    const rs = rows(path.join(dir, f)) ?? [];
    const t = texts(rs);
    return t.length ? [{ t, when: Math.max(0, ...rs.map((r) => Date.parse(r.timestamp) || 0)) }] : [];
  }).sort((a, b) => a.when - b.when);
  const last = runs.at(-1)?.t;
  if (!last) return null;
  const id = last.at(-1).id;
  return last.filter((x) => x.id === id).map((x) => x.text).join('');
}

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
      // #262: on Windows a lock folder another process is removing refuses mkdir with EPERM (or EACCES),
      // not EEXIST: it is still held. The limit comes first, so a folder that stays unwritable ends too.
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      if (Date.now() > until) throw new Error(`${lock} could not be taken for 30 s (${e.code}); remove it if no run is going`, { cause: e });
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch { /* gone or going: try again */ }
      sleep(20 + Math.random() * 30);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

// Trust for the scratch repo in a .claude.json, or Claude Code skips the agents' frontmatter hooks
// (README, "Troubleshooting"). The undo reads the file again and drops only the entry it added, since
// Claude Code rewrites the file while the run goes on; a folder trusted before stays trusted.
// #260: a process can write the file back from a copy read before the undo (1 entry in the 56 runs of
// 2026-11-01). `undo({ recheck })` looks again after each wait in ms and removes an entry that came back.
// A write later than the last check, such as one by a run still going beside it, is not caught.
// A run stopped from outside never reaches its undo (seen 2026-11-11). Each entry a run adds is kept in a
// ledger beside the config, `<file>.speckit-trust.json`, with the run's pid; the next run removes the entries
// of pids that are gone, and says so. Only entries this tool added are in it. A pid the system gave to another
// process reads as a run still going, so its entry stays: never the other way. `opts.ledger: null` keeps none.
export const TRUST_RECHECK_MS = [2_000, 10_000];
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function readLedger(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('not a list');
  return rows.filter((r) => typeof r?.key === 'string' && Number.isInteger(r?.pid));
}
const writeLedger = (file, rows) => (rows.length ? fs.writeFileSync(file, JSON.stringify(rows, null, 2)) : fs.rmSync(file, { force: true }));
export function trustFolder(confFile, repo, opts = {}) {
  const key = repo.split(path.sep).join('/');
  const ledger = opts.ledger === undefined ? `${confFile}.speckit-trust.json` : opts.ledger;
  // The ledger never stops a run: a problem with it is said, and the run goes on without it.
  const withLedger = (fn) => {
    if (!ledger) return;
    try { writeLedger(ledger, fn(readLedger(ledger))); } catch (e) { console.error(`full-run: the trust ledger ${ledger} was not used: ${e.message}`); }
  };
  const added = withConfLock(confFile, () => {
    const conf = readConf(confFile, opts);
    let swept = false;
    withLedger((rows) => {
      for (const r of rows.filter((x) => !pidAlive(x.pid))) {
        if (!conf.projects?.[r.key]) continue;
        delete conf.projects[r.key];
        swept = true;
        console.error(`full-run: trust for ${r.key} was left by a run that ended without its undo (pid ${r.pid}); removed`);
      }
      return rows.filter((x) => pidAlive(x.pid));
    });
    const trusted = Boolean(conf.projects?.[key]?.hasTrustDialogAccepted);
    if (!trusted) {
      conf.hasCompletedOnboarding = true;
      (conf.projects ??= {})[key] = { hasTrustDialogAccepted: true };
    }
    if (swept || !trusted) fs.writeFileSync(confFile, JSON.stringify(conf, null, 2));
    if (!trusted) withLedger((rows) => [...rows, { key, pid: process.pid }]);
    return !trusted;
  });
  if (!added) return () => {};
  // Whether the entry was there to remove.
  const remove = () => withConfLock(confFile, () => {
    const now = readConf(confFile, opts);
    withLedger((rows) => rows.filter((r) => !(r.key === key && r.pid === process.pid)));
    if (!now?.projects?.[key]) return false;
    delete now.projects[key];
    fs.writeFileSync(confFile, JSON.stringify(now, null, 2));
    return true;
  });
  return ({ recheck = [] } = {}) => {
    try {
      remove();
      for (const ms of recheck) {
        sleep(ms);
        if (remove()) console.error(`full-run: trust for ${key} came back after its undo; removed again`);
      }
    } catch (e) { console.error(`full-run: trust for ${key} left in place: ${e.message}`); }
  };
}

// Seen 2026-11-20: with --out under the Windows Temp folder, Git Bash's pwd prints it as /tmp/..., an agent
// passed that path to Write, and Claude Code wrote C:\tmp\... instead; in 5 of 9 runs product-owner's spec never
// reached the scratch repo and was written again. A message for such a folder on Windows, else null.
export function tempOutProblem(out, { platform = process.platform, tmp = os.tmpdir() } = {}) {
  if (platform !== 'win32') return null;
  const rel = path.win32.relative(tmp.toLowerCase(), out.toLowerCase());
  if (rel.startsWith('..') || path.win32.isAbsolute(rel)) return null;
  return `--out ${out} is in the Temp folder (${tmp}), which Git Bash shows as /tmp: an agent that takes its path from pwd `
    + 'then writes to C:\\tmp\\... instead of the scratch repo. Use a folder outside it.';
}

// #429: install.mjs's model tiers; --models installs the run's team on one.
const MODEL_TIERS = ['default', 'sonnet', 'opus', 'fast'];
export const installArgs = ({ models }) => (models ? ['--models', models] : []);

export function args(argv) {
  const o = { model: 'sonnet', maxCost: 6, maxTurns: 8, login: false, sideBySide: false, twoSlices: false, skillAgents: false, hybrid: false, case: 'clean', claim: false, teamRoot: ROOT, constitution: null, largeSlices: false, models: null, team: null, request: null, draft: null };
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--login') { o.login = true; i--; } else if (k === '--side-by-side') { o.sideBySide = true; o.twoSlices = true; i--; } else if (k === '--skill-agents') { o.skillAgents = true; i--; } else if (k === '--hybrid') { o.hybrid = true; i--; } else if (k === '--two-slices') { o.twoSlices = true; i--; } else if (k === '--out') o.out = path.resolve(v);
    else if (k === '--model') o.model = v;
    else if (k === '--case') { if (!CASES[v]) throw new Error(`unknown case ${v}; known: ${Object.keys(CASES).join(', ')}`); o.case = v; } else if (k === '--team-root') o.teamRoot = path.resolve(v);
    else if (k === '--claim') { o.claim = true; i--; }
    else if (k === '--large-slices') { o.largeSlices = true; o.twoSlices = true; i--; }
    else if (k === '--constitution') {
      const known = fs.readdirSync(path.join(FIXTURE, 'constitutions')).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).sort();
      if (!known.includes(v)) throw new Error(`unknown constitution ${v}; known: ${known.join(', ')}`);
      o.constitution = v;
    }
    else if (k === '--request') {
      if (!REQUESTS.includes(v)) throw new Error(`--request takes one of ${REQUESTS.join(', ')}`);
      o.request = v;
    }
    else if (k === '--draft') {
      if (!v || !fs.existsSync(v)) throw new Error(`--draft: no file ${v}`);
      o.draft = path.resolve(v); o.request = 'escalate';
    }
    else if (k === '--team') {
      if (!v || v.startsWith('--') || !teamRoles(v).every((r) => TEAM_ROLE_NAMES.includes(r))) throw new Error(`--team takes build, lite or a comma-separated list of team roles (${TEAM_ROLE_NAMES.join(', ')})`);
      o.team = v;
    }
    else if (k === '--max-cost') o.maxCost = Number(v);
    else if (k === '--max-turns') o.maxTurns = Number(v);
    else if (k === '--models') {
      if (!MODEL_TIERS.includes(v)) throw new Error(`--models takes one of ${MODEL_TIERS.join(', ')}`);
      o.models = v;
    }
    else throw new Error(`unknown argument ${k}`);
  }
  if (!o.out || !Number.isFinite(o.maxCost) || !Number.isInteger(o.maxTurns)) throw new Error('usage: node tools/full-run.mjs --out <dir> [--model m] [--max-cost usd] [--max-turns n] [--login] [--skill-agents | --hybrid | --team <preset|roles>] [--two-slices | --side-by-side] [--large-slices] [--constitution <name>] [--models <tier>]');
  if (o.hybrid && o.skillAgents) throw new Error('--hybrid and --skill-agents are two different teams: pass one');
  const c = CASES[o.case];
  if (o.hybrid && (c.gate || c.load || c.contest || c.patch || c.audit)) throw new Error(`--hybrid runs only a whole pipeline, not the one-step case ${o.case}`);
  for (const [flag, on] of [['--hybrid', o.hybrid], ['--skill-agents', o.skillAgents]]) if (o.team && on) throw new Error(`--team and ${flag} are two different teams: pass one`);
  if ((o.draft || o.request) && (c.gate || c.load || c.contest || c.patch || c.audit)) throw new Error(`--${o.draft ? 'draft' : 'request'} runs only a whole pipeline, not the one-step case ${o.case}`);
  if (o.team && (c.gate || c.load || c.contest || c.patch || c.audit)) throw new Error(`--team runs only a whole pipeline, not the one-step case ${o.case}`);
  return o;
}

function main() {
  const o = args(process.argv.slice(2));
  if (!o.login && !process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set (or pass --login to use your own Claude Code login)');
  const tempProblem = tempOutProblem(o.out);
  if (tempProblem) throw new Error(tempProblem);
  fs.rmSync(o.out, { recursive: true, force: true });
  const repo = path.join(o.out, 'repo');
  // #469: an audit case is one turn like a gate case, judged on spec-auditor's verdict.
  const gate = CASES[o.case].gate || CASES[o.case].audit;
  const audit = Boolean(CASES[o.case].audit);
  // #242, #247: one turn from a typed command, judged by tools/eval.mjs on what the session did.
  const oneTurn = Boolean(CASES[o.case].contest || CASES[o.case].patch);
  // 012: a load case is one turn too, judged on the last line of load-tester's report.
  const load = Boolean(CASES[o.case].load);
  const { request: base } = buildRepo(repo, { twoSlices: o.twoSlices, largeSlices: o.largeSlices, constitution: o.constitution, case: o.case, request: o.request, draft: o.draft });
  const head0 = git(repo, 'rev-parse', 'HEAD').trim();
  const request = audit ? auditRequest({ skillAgents: o.skillAgents }) : gate ? gateRequest({ skillAgents: o.skillAgents, claim: o.claim }) : load ? loadRequest({ skillAgents: o.skillAgents }) : base;
  // A session started from a parent Claude Code session would inherit its variables.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$)/.test(k)));
  env.MSYS_NO_PATHCONV = '1';
  // Without --login a throwaway config dir; with it the user's own, whose .claude.json sits in the home
  // folder when CLAUDE_CONFIG_DIR is unset.
  const cfg = o.login ? (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) : path.join(o.out, 'cfg');
  const confFile = o.login && !process.env.CLAUDE_CONFIG_DIR ? path.join(os.homedir(), '.claude.json') : path.join(cfg, '.claude.json');
  if (!o.login) env.CLAUDE_CONFIG_DIR = cfg;
  const target = o.login ? ['--claude-dir', path.join(repo, '.claude')] : [];
  const install = run(process.execPath, [path.join(o.teamRoot, 'install.mjs'), ...target, ...installArgs(o)], { env });
  if (install.status !== 0) throw new Error(`install.mjs failed: ${install.stdout}${install.stderr}`);
  const shadow = o.login ? shadowingSkills(cfg, path.join(repo, '.claude')) : [];
  if (shadow.length) {
    throw new Error(`--login: your personal ${shadow.join(', ')} in ${path.join(cfg, 'skills')} differ from the run's copy and would be `
      + `used instead of it (#175). Reinstall the team from ${o.teamRoot} (node install.mjs) or move them aside, then run again.`);
  }
  if (o.login) dropDuplicateGates(path.join(repo, '.claude', 'settings.json'), path.join(cfg, 'settings.json'));
  // The team's files in the repo are the run's tools, not the feature's: keep them out of its commits.
  if (o.login) {
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), ['agents/', 'hooks/', 'settings.json', 'settings.json.*',
      'skills/speckit-team/', 'skills/speckit-patch/', 'skills/speckit-triage/', 'skills/speckit-role-*/'].map((p) => `/.claude/${p}\n`).join(''));
  }
  const untrust = trustFolder(confFile, repo);
  // A gate case in agents mode sends its request without the skill, so it never reaches the check.
  const refused = !(gate || load) || o.skillAgents ? preflightProblem({ teamDir: o.login ? path.join(repo, '.claude') : cfg, repo, env }) : null;
  if (refused) {
    untrust();
    throw new Error(`the skill's first step would refuse this run, so no model was called:\n${refused}`);
  }

  const marker = newMarker();
  const endsDir = path.join(repo, '.git', 'speckit-team', 'ends');
  // A gate case is one turn: a second answer would be the pipeline's, and the question is only the gatekeeper's word.
  // 012 SC-006: load-noisy keeps busy-loop children running for the whole turn, 30% of the cores.
  const busy = o.case === 'load-noisy' ? Array.from({ length: Math.max(1, Math.round(0.3 * os.cpus().length)) },
    () => spawn(process.execPath, ['-e', 'for (;;);'], { stdio: 'ignore' })) : [];
  const { turns, session, stopped } = runTurns({
    maxTurns: gate || load || oneTurn || !teamStops(o.team) ? 1 : o.maxTurns,
    promptFor: (n) => (n === 0 ? (((gate || load) && !o.skillAgents) || oneTurn ? request : firstPrompt(request, { skillAgents: o.skillAgents, hybrid: o.hybrid, team: o.team, sideBySide: o.sideBySide })) : answer(marker, { sideBySide: o.sideBySide, team: o.team })),
    invoke: (prompt, resume) => run('claude', ['-p', prompt, '--model', o.model, '--permission-mode', 'bypassPermissions',
      '--output-format', 'json', ...(resume ? ['--resume', resume] : [])], { cwd: repo, env, maxBuffer: 64 << 20, timeout: 40 * 60_000 }),
    ended: (res) => (fs.existsSync(endsDir) && fs.readdirSync(endsDir).length > 0) || Boolean(audit && auditWord({ text: res?.result }).word) || Boolean(!audit && gate && gateWord({ ends: [], text: res?.result }).word) || Boolean(load && gateWord({ text: res?.result, words: LOAD_WORDS, lastLineOnly: true }).word),
  });

  for (const b of busy) b.kill();
  // Its session is over; a write-back from a stale copy shortly after is removed again (#260).
  untrust({ recheck: TRUST_RECHECK_MS });
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
  const report0 = transcript ? gateReport({ transcript, skillAgents: o.skillAgents, role: load ? 'load-tester' : 'spec-gatekeeper' }) : null;
  const word = load ? { ...gateWord({ text: report0 ?? turns.at(-1)?.result, words: LOAD_WORDS, lastLineOnly: true }), report: report0 }
    : audit ? { ...auditWord({ verdicts: verdictsOf(repo), text: turns.at(-1)?.result }), report: transcript ? gateReport({ transcript, skillAgents: o.skillAgents, role: 'spec-auditor' }) : null }
    : { ...gateWord({ ends, text: turns.at(-1)?.result }), report: report0 };
  const failures = gate || load || oneTurn ? [] : checkRun({ repo, usage, costs: turns.map((t) => t.cost), maxCost: o.maxCost,
    marker, markerSent: turns.length > 1, agentTexts, sideBySide: o.sideBySide, twoSlices: o.twoSlices, skillAgents: o.skillAgents, hybrid: o.hybrid, team: o.team,
    gateSeen: o.team && report0 ? gateWord({ text: report0 }).word : null });
  if (gate) {
    const moved = git(repo, 'status', '--short').trim() || (git(repo, 'rev-parse', 'HEAD').trim() !== head0 ? 'new commit' : '');
    if (moved) failures.push(`main session changed the repo in a gate case, so the word is not the gatekeeper's alone: ${moved.replace(/\s+/g, ' ').slice(0, 120)}`);
    if (!word.word) failures.push(audit ? 'spec-auditor gave no verdict: none recorded in verdicts/ and no VERDICT: PASS or FAIL alone on the last line of the answer'
      : 'spec-gatekeeper gave no word: no APPROVED or REJECTED in ends/ or alone on the last line of the answer');
    const cost = Math.max(0, ...turns.map((t) => t.cost ?? 0));
    if (cost > o.maxCost) failures.push(`the run cost ${cost.toFixed(2)}, over the ceiling of ${o.maxCost}`);
  }
  if (load && !word.word) failures.push('load-tester gave no word: PASS, FAIL or NOT MEASURED alone on the last line of its report');
  if (oneTurn || load) {
    const cost = Math.max(0, ...turns.map((t) => t.cost ?? 0));
    if (cost > o.maxCost) failures.push(`the run cost ${cost.toFixed(2)}, over the ceiling of ${o.maxCost}`);
  }
  if (!transcript) failures.push('no transcript of the main session was found');
  const all = runFailures(failures, stopped);
  const report = { case: o.case, claim: o.claim, teamRoot: o.teamRoot, skillAgents: o.skillAgents, hybrid: o.hybrid, team: o.team, gate: word, model: o.model, login: o.login, sideBySide: o.sideBySide, twoSlices: o.twoSlices, maxCost: o.maxCost, cost: Math.max(0, ...turns.map((t) => t.cost ?? 0)), turns, transcript, usage, failures: all, platform: `${os.platform()} ${os.release()}` };
  // #502: the kept draft outlives the scratch repo, for a --draft run.
  const keptDraft = path.join(repo, '.git', 'speckit-team', 'patch-draft.patch');
  if (CASES[o.case].escalate && fs.existsSync(keptDraft)) fs.copyFileSync(keptDraft, path.join(o.out, 'patch-draft.patch'));
  fs.writeFileSync(path.join(o.out, 'run.json'), JSON.stringify(report, null, 2));
  console.log(all.length ? `FAILED:\n- ${all.join('\n- ')}` : `passed, $${report.cost.toFixed(2)}`);
  process.exit(all.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`full-run: ${e.message}`); process.exit(2); }
}
