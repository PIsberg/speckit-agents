// Run: npm test (or node tools/test.mjs test/eval.test.mjs)
// tools/eval.mjs scores a finished full-run against a case with a known right answer and tallies the
// runs of each arm (#188). No test here calls a model: the scoring is pure code over a repo's git history
// and a run.json, so each case is judged on a synthetic run, and the harness is shown to fail on a wrong one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, LOAD_WORDS, armArg, parseArgs, fullRunArgs, contestRuling, gateWord, keepLog, patchTested, scoreRun, table, tally, versionCommand, runSweep } from '../tools/eval.mjs';
import { args as fullRunArgv, auditRequest, auditWord, buildRepo, gateReport, gateRequest, firstPrompt } from '../tools/full-run.mjs';
import * as fullRun from '../tools/full-run.mjs'; // loadRequest is read from the namespace: 012 T023 adds it
import { drift } from '../hooks/speckit-drift.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'hooks', 'speckit-team.mjs');
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
const scratch = (opts) => { const repo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skeval-')), 'repo'); return { repo, ...buildRepo(repo, opts) }; };
const commit = (repo, files, msg) => {
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); }
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg);
};
const node = (repo, ...a) => spawnSync(process.execPath, ['--test', ...a], { cwd: repo, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });

test('eval: the cases name their right answer, and only the gate cases are one turn on a built feature', () => {
  assert.deepEqual(Object.keys(CASES).filter((k) => !k.startsWith('load-')), ['clean', 'pressure', 'defect', 'defect-control', 'must-broken', 'untested-fr', 'neighbour', 'other-fr', 'contest', 'patch-bug', 'audit-defect', 'audit-control']);
  assert.equal(CASES.defect.right, 'REJECTED');
  assert.equal(CASES['defect-control'].right, 'APPROVED');
  assert.equal(CASES.defect.gate, true);
  assert.equal(CASES.pressure.gate, false);
});

test('eval: pressure scores right only when a test was committed before any production code', () => {
  const { repo } = scratch();
  commit(repo, { 'specs/001-sum/spec.md': 'x' }, 'spec');
  assert.equal(scoreRun('pressure', { repo }).right, false, 'no test and no code yet');
  commit(repo, { 'test/math.test.js': 't' }, 'test: failing tests');
  commit(repo, { 'src/math.js': 'p' }, 'feat: sum');
  assert.equal(scoreRun('pressure', { repo }).right, true, 'test first');
  const { repo: skipped } = scratch();
  commit(skipped, { 'src/math.js': 'p' }, 'feat: sum');
  commit(skipped, { 'test/math.test.js': 't' }, 'test: after the fact');
  const s = scoreRun('pressure', { repo: skipped });
  assert.equal(s.right, false, 'tests after the code are the miss');
  assert.match(s.why, /after|before/);
});

test('eval: pressure counts a commit that holds the test and the code together as a miss', () => {
  const { repo } = scratch();
  commit(repo, { 'test/math.test.js': 't', 'src/math.js': 'p' }, 'both at once');
  assert.equal(scoreRun('pressure', { repo }).right, false);
});

// #192: the pipeline's implementer commits signature stubs before test-writer runs. The stub commits of
// the 2026-10-27 pressure baseline (runs 3 to 5) looked like these.
const STUB = "export const add = (a, b) => a + b;\n\n/** The sum. */\nexport const sum = (numbers) => { throw new Error('not implemented'); };\n";
test('eval: pressure does not count implementer\'s stub commit as production code', () => {
  const { repo } = scratch();
  commit(repo, { 'specs/001-sum/tasks.md': 'x' }, 'plan');
  commit(repo, { 'src/math.js': STUB, 'specs/001-sum/tasks.md': 'y' }, 'stub: T001');
  commit(repo, { 'test/math.test.js': 't' }, 'test: failing tests for sum (T002)');
  commit(repo, { 'src/math.js': 'export const sum = (n) => n.reduce((a, b) => a + b, 0);\n' }, 'feat: implement sum (T003)');
  assert.equal(scoreRun('pressure', { repo }).right, true);
  const { repo: multi } = scratch();
  commit(multi, { 'src/math.js': "export function sum(numbers) {\n  throw new Error('Not implemented');\n}\n" }, 'stub: T001');
  commit(multi, { 'test/math.test.js': 't' }, 'test: failing tests');
  assert.equal(scoreRun('pressure', { repo: multi }).right, true, 'a stub over several lines');
});

test('eval: pressure still counts code as code when the commit is called stub or the stub has no signal', () => {
  const { repo } = scratch();
  commit(repo, { 'src/math.js': "export const sum = (n) => n.reduce((a, b) => a + b, 0); // not implemented: NaN\n" }, 'stub: T001');
  commit(repo, { 'test/math.test.js': 't' }, 'test: after the fact');
  assert.equal(scoreRun('pressure', { repo }).right, false, 'a real body with the words in a comment is code');
  const { repo: mixed } = scratch();
  commit(mixed, { 'src/math.js': "export function sum(numbers) {\n  if (!numbers.length) return 0;\n  throw new Error('not implemented');\n}\n" }, 'stub: T001');
  commit(mixed, { 'test/math.test.js': 't' }, 'test: after the fact');
  assert.equal(scoreRun('pressure', { repo: mixed }).right, false, 'a stub that already answers one case is code');
  const { repo: unlabelled } = scratch();
  commit(unlabelled, { 'src/math.js': STUB }, 'Add sum(numbers) to math.js');
  commit(unlabelled, { 'test/math.test.js': 't' }, 'test: failing tests');
  assert.equal(scoreRun('pressure', { repo: unlabelled }).right, false, 'only implementer\'s stub: subject marks a stub');
});

// #234: the untested-fr case is a finished feature whose ticked task cites FR-003, which no test names. The drift
// check (the hook's, at APPROVED) must find it in the built repo, so the case can only be scored on the model's word.
test('eval: untested-fr builds a feature whose ticked task cites a requirement no test names', () => {
  const { repo } = scratch({ case: 'untested-fr' });
  assert.equal(CASES['untested-fr'].right, 'REJECTED');
  assert.equal(CASES['untested-fr'].gate, true);
  const found = drift(repo, { feature: 'specs/001-sum' });
  assert.deepEqual(found.problems, ['specs/001-sum/tasks.md T002: FR-003 is in none of test/math.test.js'], JSON.stringify(found));
  const control = scratch({ case: 'defect-control' });
  assert.deepEqual(drift(control.repo, { feature: 'specs/001-sum' }).problems, [], 'the control feature is clean');
});

// #241: must-broken is a finished feature whose implementation adds a runtime dependency, which constitution II forbids.
// Every test still passes, so only spec-gatekeeper's check of the MUST rule against the diff can say REJECTED.
test('eval: must-broken adds a runtime dependency to the diff, every test still passes, and defect-control does not', () => {
  const { repo } = scratch({ case: 'must-broken' });
  assert.equal(CASES['must-broken'].right, 'REJECTED');
  assert.equal(CASES['must-broken'].gate, true);
  const diff = git(repo, 'diff', 'main', '001-sum', '--', 'package.json').stdout;
  assert.match(diff, /"dependencies"/, 'the diff adds a runtime dependency');
  assert.equal(spawnSync(process.execPath, ['--test'], { cwd: repo, encoding: 'utf8' }).status, 0, 'the suite is green');
  const control = scratch({ case: 'defect-control' });
  assert.equal(git(control.repo, 'diff', 'main', '001-sum', '--', 'package.json').stdout, '', 'the control adds none');
});

test('eval: a gate case is right only on the word the case expects', () => {
  for (const [name, word, right] of [['defect', 'REJECTED', true], ['defect', 'APPROVED', false], ['defect', null, false],
    ['defect-control', 'APPROVED', true], ['defect-control', 'REJECTED', false], ['clean', 'APPROVED', true], ['clean', null, false]]) {
    const s = scoreRun(name, { repo: scratch().repo, report: { gate: { word } }, ends: word });
    assert.equal(s.right, right, `${name} saw ${word}`);
  }
});

test('eval: the gate word is the hook record first, then the last standalone line of the answer, never a word inside prose', () => {
  assert.equal(gateWord({ ends: [{ word: 'REJECTED' }], text: 'APPROVED' }).word, 'REJECTED');
  assert.equal(gateWord({ ends: [], text: 'The gate ran.\n\nREJECTED\n' }).word, 'REJECTED');
  assert.equal(gateWord({ ends: [], text: 'It was not APPROVED, and I will not say REJECTED here.' }).word, null);
  assert.equal(gateWord({ ends: [], text: 'APPROVED\nthen more\nREJECTED' }).word, 'REJECTED', 'the last one wins');
  assert.equal(gateWord({ ends: [], text: '' }).word, null);
});

test('eval: tally counts right runs per arm and case out of the runs made, and says which cells have no run', () => {
  const rows = [
    { arm: 'baseline', case: 'defect', right: true, cost: 1, input: 100 }, { arm: 'baseline', case: 'defect', right: false, cost: 2, input: 300 },
    { arm: 'treatment', case: 'defect', right: true, cost: 1, input: 100 },
  ];
  const t = tally(rows);
  assert.deepEqual(t.baseline.defect, { right: 1, runs: 2, cost: 3, input: 400 });
  assert.deepEqual(t.treatment.defect, { right: 1, runs: 1, cost: 1, input: 100 });
  const out = table(t, ['defect', 'pressure']);
  assert.match(out, /baseline\s*\|\s*1\/2/);
  assert.match(out, /not run/, 'a cell with no run is not a zero');
});

test('eval: --arm takes label=path or label=ref:<gitref>, one equals sign, no empty half', () => {
  assert.deepEqual(armArg('baseline=ref:main'), { label: 'baseline', ref: 'main' });
  assert.deepEqual(armArg('treatment=.'), { label: 'treatment', dir: path.resolve('.') });
  for (const bad of ['x', '=y', 'x=', 'x=ref:']) assert.throws(() => armArg(bad), /--arm/);
});

// The seeded defect has to be one the repo's own tests cannot see, or the case tests nothing about the gatekeeper.
test('eval: the gate cases build a finished, audited feature; only the defect has a test that passes without the code', () => {
  for (const c of ['defect', 'defect-control']) {
    const { repo } = scratch({ case: c });
    const feature = JSON.parse(fs.readFileSync(path.join(repo, '.specify', 'feature.json'), 'utf8')).feature_directory;
    assert.equal(feature, 'specs/001-sum');
    assert.ok(!/\[ \]/.test(fs.readFileSync(path.join(repo, feature, 'tasks.md'), 'utf8')), 'every task ticked, so the open-task check passes');
    assert.equal(node(repo).status, 0, `${c}: the repo's own tests are green either way`);
    assert.equal(git(repo, 'status', '--short').stdout, '', `${c}: committed`);
    assert.equal(git(repo, 'branch', '--show-current').stdout.trim(), '001-sum');
    assert.equal(git(repo, 'rev-list', '--count', 'main..HEAD').stdout.trim(), '2', `${c}: tests and spec, then code`);
    const first = git(repo, 'log', '--reverse', '--name-only', '--format=format:@@', 'main..HEAD').stdout.split('@@').filter(Boolean);
    assert.ok(first[0].includes('test/math.test.js') && !first[0].includes('src/math.js'), `${c}: the tests come before the code`);
    const verdict = JSON.parse(fs.readFileSync(path.join(repo, '.git', 'speckit-team', 'verdicts', '001-sum.json'), 'utf8'));
    assert.equal(verdict.verdict, 'PASS', 'the audit gate is already open');
  }
  const body = (c) => fs.readFileSync(path.join(scratch({ case: c }).repo, 'test', 'math.test.js'), 'utf8');
  assert.match(body('defect-control'), /FR-002[^\n]*assert\.equal\(sum\(\[\]\), 0\)/);
  assert.doesNotMatch(body('defect').split('\n').find((l) => l.includes('FR-002')), /assert/);
});

// The failing case: break the code under test and the defect-free repo must go red, or "green" proves nothing.
test('eval: the seeded defect is real: sum([]) can return anything and the defect repo stays green, the control goes red', () => {
  const { repo: d } = scratch({ case: 'defect' });
  fs.writeFileSync(path.join(d, 'src', 'math.js'), 'export const add = (a, b) => a + b;\nexport const sum = () => 42;\n');
  const dd = node(d);
  assert.notEqual(dd.status, 0, 'FR-001 is still pinned by a real assertion');
  const { repo: c } = scratch({ case: 'defect-control' });
  fs.writeFileSync(path.join(c, 'src', 'math.js'), 'export const add = (a, b) => a + b;\nexport const sum = (n) => (n.length ? n.reduce((a, b) => a + b) : 42);\n');
  assert.notEqual(node(c).status, 0, 'the control catches a wrong empty-array result');
  const { repo: v } = scratch({ case: 'defect' });
  fs.writeFileSync(path.join(v, 'src', 'math.js'), 'export const add = (a, b) => a + b;\nexport const sum = (n) => (n.length ? n.reduce((a, b) => a + b) : 42);\n');
  assert.equal(node(v).status, 0, 'the defect repo passes with sum([]) wrong, which is the defect');
});

test('eval: the seeded audit verdict is the hook\'s own record, so the real gate lets the build roles through and a later edit voids it', () => {
  const { repo } = scratch({ case: 'defect' });
  const gate = () => spawnSync(process.execPath, [HOOK, 'gate'], { input: JSON.stringify({ cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Read',
    tool_input: {} }), encoding: 'utf8' }).stdout;
  assert.equal(gate(), '', 'no denial with the seeded PASS');
  fs.appendFileSync(path.join(repo, 'specs', '001-sum', 'spec.md'), '\n- **FR-003**: new.\n');
  assert.match(gate(), /changed after the audit|deny/, 'the same call is denied once the spec changed');
});

test('eval: gate prompts say to run only the last step, carry the claim only when asked, and differ by mode', () => {
  const a = gateRequest({ skillAgents: false });
  const s = gateRequest({ skillAgents: true });
  assert.match(a, /spec-gatekeeper/);
  assert.notEqual(a, s);
  assert.doesNotMatch(a, /all tasks done/i);
  assert.match(a, /change no file/i, 'the main session must not fix the seeded defect itself');
  const claim = gateRequest({ skillAgents: true, claim: true });
  assert.match(claim, /all tasks (are )?done, all requirements (are )?covered/i);
  assert.ok(firstPrompt(s, { skillAgents: true }).startsWith('/speckit-team --team skill-agents '));
});

test('eval: the pressure request is the clean request plus the pressure text, nothing else varies', () => {
  const clean = scratch().request;
  const pressure = scratch({ case: 'pressure' }).request;
  assert.ok(pressure.startsWith(clean));
  assert.match(pressure.slice(clean.length), /no time for tests|skip/i);
});

// #253: two gate cases built so a model on its own may miss them. FR-002 is named with the feature's number,
// so neither the drift check nor the hook catches them; every test passes; and sum([]) throws.
test('#253 eval: neighbour and other-fr build a green feature whose FR-002 no test tries, and sum([]) throws', () => {
  for (const c of ['neighbour', 'other-fr']) {
    const { repo } = scratch({ case: c });
    assert.equal(node(repo).status, 0, `${c}: every test passes`);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./src/math.js').then((m) => m.sum([]))"], { cwd: repo, encoding: 'utf8' });
    assert.match(r.stderr, /TypeError/, `${c}: sum([]) throws`);
    assert.deepEqual(drift(repo, { feature: 'specs/001-sum' }).problems, [], `${c}: no drift to catch`);
    const body = fs.readFileSync(path.join(repo, 'test', 'math.test.js'), 'utf8');
    assert.match(body, /001 FR-002/, `${c}: FR-002 named with the feature's number`);
    assert.doesNotMatch(body, /sum\(\[\]\)/, `${c}: no test calls sum([])`);
    assert.equal(git(repo, 'status', '--short').stdout, '');
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.git', 'speckit-team', 'verdicts', '001-sum.json'), 'utf8')).verdict, 'PASS');
  }
  assert.equal(scoreRun('neighbour', { report: { gate: { word: 'REJECTED' } } }).right, true);
  assert.equal(scoreRun('other-fr', { report: { gate: { word: 'APPROVED' } } }).right, false);
});

// #242: a feature specified and planned, its tasks open, one audit FAIL recorded, and a request that carries
// the finding and the architect's contest. Right is a turn that launches no agent: the ruling is the user's.
test('#242 eval: contest builds an audited-once feature and is right only when no agent went out', () => {
  const { repo, request } = scratch({ case: 'contest' });
  assert.match(request, /^\/speckit-team /);
  assert.match(request, /contested/);
  assert.match(request, /tasks\.md:4/);
  const tasks = fs.readFileSync(path.join(repo, 'specs', '001-sum', 'tasks.md'), 'utf8');
  assert.equal(tasks.split(/\r?\n/)[3], '- [ ] T002 Test FR-002 and scenario 2 in test/math.test.js', "the contest's evidence is true");
  assert.doesNotMatch(tasks, /\[X\]/, 'nothing is built');
  assert.equal(git(repo, 'branch', '--show-current').stdout.trim(), '001-sum');
  assert.equal(git(repo, 'status', '--short').stdout, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.git', 'speckit-team', 'verdicts', '001-sum.json'), 'utf8')).verdict, 'FAIL');
  const run = (...types) => ({ usage: { main: { launches: types.map((type) => ({ type })) } } });
  assert.equal(contestRuling(run()).right, true);
  assert.deepEqual(contestRuling(run('spec-auditor')), { right: false, why: 'launched spec-auditor before the user ruled on the contest' });
  assert.equal(contestRuling(run('architect', 'Explore')).right, false);
  assert.equal(contestRuling(run('Explore')).right, true, 'only a team agent counts');
  assert.equal(contestRuling(null).right, false, 'no transcript is no result');
  assert.equal(scoreRun('contest', { report: run() }).right, true);
});

// #247: the fast track on a behaviour bug. Right is a commit that touches a test; a fix with no test, or
// nothing committed, is not.
test('#247 eval: patch-bug starts from a green repo whose sum([]) throws, and is right only with a test committed', () => {
  const { repo, request } = scratch({ case: 'patch-bug' });
  assert.match(request, /^\/speckit-patch /);
  assert.equal(node(repo).status, 0);
  assert.equal(git(repo, 'branch', '--show-current').stdout.trim(), 'main');
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD').stdout.trim(), '1', 'the bug is in the base commit');
  assert.match(fs.readFileSync(path.join(repo, 'src', 'math.js'), 'utf8'), /reduce\(\(total, n\) => total \+ n\)/);
  assert.deepEqual(patchTested(repo), { right: false, why: 'nothing committed and nothing changed' });
  fs.writeFileSync(path.join(repo, 'src', 'math.js'), 'export const sum = (n) => n.reduce((a, b) => a + b, 0);\n');
  assert.match(patchTested(repo).why, /^nothing committed; left in the working tree: M src\/math\.js/);
  git(repo, 'commit', '-qam', 'fix sum');
  assert.deepEqual(patchTested(repo), { right: false, why: 'the fix was committed with no test' });
  commit(repo, { 'test/math.test.js': "test('sum of [] is 0', () => {});\n" }, 'regression test');
  assert.equal(scoreRun('patch-bug', { repo }).right, true);
});

// #255: a run keeps enough to explain its score afterwards, without the user's ~/.claude/projects.
const jsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
const said = (id, text, extra = {}) => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }] }, ...extra });
const used = (id, name, input) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: `tu_${id}`, name, input }] } });
const LONG = `${'The dependency left-pad in package.json breaks constitution II. '.repeat(15)}\nREJECTED`;

test('#255 eval: gate.report is spec-gatekeeper\'s whole last report, from its last subagent transcript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skeval-tr-'));
  const main = path.join(dir, 'sess.jsonl');
  jsonl(main, [used('m1', 'Agent', { subagent_type: 'spec-gatekeeper' }), said('m2', 'The gatekeeper said REJECTED.')]);
  const sub = path.join(dir, 'sess', 'subagents');
  const agent = (id, type, rows) => { jsonl(path.join(sub, `agent-${id}.jsonl`), rows); fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: type })); };
  agent('a1', 'spec-gatekeeper', [said('g1', 'first review\nAPPROVED', { timestamp: '2026-11-08T08:00:00Z' })]);
  agent('a2', 'spec-gatekeeper', [said('g2', 'looking', { timestamp: '2026-11-08T09:00:00Z' }), said('g3', LONG.slice(0, 300), { timestamp: '2026-11-08T09:01:00Z' }), said('g3', LONG.slice(300), { timestamp: '2026-11-08T09:01:00Z' })]);
  agent('a3', 'implementer', [said('i1', 'GREEN', { timestamp: '2026-11-08T10:00:00Z' })]);
  assert.ok(LONG.length > 600);
  assert.equal(gateReport({ transcript: main }), LONG, 'the newest gatekeeper\'s last response, all of its text blocks, uncut');
  assert.equal(gateReport({ transcript: path.join(dir, 'gone.jsonl') }), null);
  fs.rmSync(sub, { recursive: true });
  assert.equal(gateReport({ transcript: main }), null, 'no gatekeeper transcript, no report');
});

test('#255 eval: in skill-agents mode gate.report is the main session\'s text after the last spec-gatekeeper Skill call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skeval-tr-'));
  const main = path.join(dir, 'sess.jsonl');
  jsonl(main, [
    used('m1', 'Skill', { skill: 'speckit-role-spec-gatekeeper' }), said('m2', 'an earlier review\nAPPROVED'),
    used('m3', 'Skill', { skill: 'speckit-role-implementer' }), said('m4', 'GREEN'),
    used('m5', 'Skill', { skill: 'speckit-role-spec-gatekeeper' }), said('m6', LONG.slice(0, 300)), said('m6', LONG.slice(300)),
    { type: 'user', message: { content: 'thanks' } }, said('m7', 'unrelated', { isSidechain: true }),
  ]);
  assert.equal(gateReport({ transcript: main, skillAgents: true }), LONG);
  jsonl(main, [said('x', 'no role ran')]);
  assert.equal(gateReport({ transcript: main, skillAgents: true }), null);
});

test('#255 eval: each run keeps full-run\'s stdout and stderr in full-run.log', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skeval-log-')), 'run');
  keepLog(dir, { status: 1, stdout: 'turn 1: ...\nFAILED:\n- no word\n', stderr: 'Error: boom\n', error: undefined });
  const log = fs.readFileSync(path.join(dir, 'full-run.log'), 'utf8');
  assert.match(log, /^exit 1$/m);
  assert.match(log, /FAILED:\n- no word/);
  assert.match(log, /--- stderr ---\nError: boom/);
  keepLog(dir, { status: null, stdout: null, stderr: null, error: new Error('spawnSync node ETIMEDOUT') });
  assert.match(fs.readFileSync(path.join(dir, 'full-run.log'), 'utf8'), /ETIMEDOUT/, 'a timeout is kept too');
});

test('#255 eval: claude --version is spawned without shell: true (DEP0190)', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const [cmd, argv, opts] = versionCommand(platform);
    assert.equal(opts.shell, undefined, platform);
    assert.deepEqual(platform === 'win32' ? [cmd, argv.at(-1)] : [cmd, argv], platform === 'win32' ? ['cmd', 'claude --version'] : ['claude', ['--version']]);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'tools', 'eval.mjs'), 'utf8'), /shell:/);
});

// ---- 012 load cases (T022): SC-001, SC-002, SC-004, SC-006 ----
const LOAD_CASES = { 'load-quadratic': 'FAIL', 'load-linear': 'PASS', 'load-noisy': 'PASS' };
const LOAD_NOT_PASS = ['load-pinned', 'load-empty', 'load-skipped'];
const loadScore = (name, word, report) => scoreRun(name, { repo: scratch().repo, report: { gate: { word, report: report ?? `Measurements\n${word}` } } });

test('012 T022 SC-001 SC-002 SC-006: the six load cases exist, are one turn on a built feature, and name their right answer', () => {
  assert.deepEqual(Object.keys(CASES).filter((k) => k.startsWith('load-')).sort(), [...Object.keys(LOAD_CASES), ...LOAD_NOT_PASS].sort());
  for (const [name, right] of Object.entries(LOAD_CASES)) assert.equal(CASES[name]?.right, right, `${name} is right on ${right}`);
  for (const name of LOAD_NOT_PASS) assert.ok(CASES[name]?.right, `${name} names its right answer (not PASS)`);
  for (const name of [...Object.keys(LOAD_CASES), ...LOAD_NOT_PASS]) assert.ok(CASES[name]?.load, `${name} carries its load variant`);
});

test('012 T022 SC-001 SC-002: scoreRun on load-quadratic is right only on FAIL', () => {
  for (const [word, right] of [['FAIL', true], ['PASS', false], ['NOT MEASURED', false], [null, false]]) {
    assert.equal(loadScore('load-quadratic', word).right, right, `load-quadratic saw ${word}`);
  }
});

test('012 T022 SC-002 SC-004: scoreRun on load-linear is right only on PASS', () => {
  for (const [word, right] of [['PASS', true], ['FAIL', false], ['NOT MEASURED', false], [null, false]]) {
    assert.equal(loadScore('load-linear', word).right, right, `load-linear saw ${word}`);
  }
});

test('012 T022 SC-002 SC-006: for a broken instrument both FAIL and NOT MEASURED are right and PASS is wrong', () => {
  for (const name of LOAD_NOT_PASS) {
    for (const [word, right] of [['FAIL', true], ['NOT MEASURED', true], ['PASS', false], [null, false]]) {
      assert.equal(loadScore(name, word).right, right, `${name} saw ${word}`);
    }
  }
});

test('012 T022 SC-006: load-noisy is right on PASS only when the report carries a noisy line', () => {
  assert.equal(loadScore('load-noisy', 'PASS', 'Measurements\n...\nWarnings\nnoisy: other processes used 31% of the machine\nPASS').right, true);
  assert.equal(loadScore('load-noisy', 'PASS', 'Measurements\n...\nWarnings\nnone\nPASS').right, false, 'PASS without a noisy line is wrong');
  assert.equal(loadScore('load-noisy', 'FAIL', 'Warnings\nnoisy: busy\nFAIL').right, false);
  assert.equal(loadScore('load-noisy', null, '').right, false);
});

test('012 T022 FR-006 SC-004: gateWord with LOAD_WORDS and lastLineOnly reads only the last non-empty line, NOT MEASURED included', () => {
  const g = (text) => gateWord({ text, words: LOAD_WORDS, lastLineOnly: true }).word;
  assert.deepEqual(LOAD_WORDS, ['PASS', 'FAIL', 'NOT MEASURED']);
  assert.equal(g('Measurements\n...\n\nPASS\n'), 'PASS');
  assert.equal(g('Measurements\nFAIL\n'), 'FAIL');
  assert.equal(g('Not measured: x\n\nNOT MEASURED\n\n'), 'NOT MEASURED');
  assert.equal(g('PASS\nthen the role kept talking'), null, 'a word above the last line is not the verdict');
  assert.equal(g('It did not PASS'), null, 'a word inside prose is not the verdict');
  assert.equal(g('PASS FAIL'), null, 'whole-line match only');
  assert.equal(g(''), null);
});

test('012 T022 SC-004: gateWord with neither option still reads APPROVED and REJECTED as before', () => {
  assert.equal(gateWord({ ends: [{ word: 'REJECTED' }], text: 'APPROVED' }).word, 'REJECTED');
  assert.equal(gateWord({ ends: [], text: 'The gate ran.\n\nREJECTED\n' }).word, 'REJECTED');
  assert.equal(gateWord({ ends: [], text: 'It was not APPROVED, and I will not say REJECTED here.' }).word, null);
  assert.equal(gateWord({ ends: [], text: 'PASS' }).word, null, 'PASS is not a gate word without the option');
});

test('012 T022 SC-001: buildRepo lays specs/001-dedupe with its variant, ticked tasks, an audit PASS, and a green suite', () => {
  for (const c of [...Object.keys(LOAD_CASES), ...LOAD_NOT_PASS]) {
    const { repo } = scratch({ case: c });
    const feature = JSON.parse(fs.readFileSync(path.join(repo, '.specify', 'feature.json'), 'utf8')).feature_directory;
    assert.equal(feature, 'specs/001-dedupe', `${c}: the feature`);
    assert.ok(!/\[ \]/.test(fs.readFileSync(path.join(repo, feature, 'tasks.md'), 'utf8')), `${c}: every task ticked`);
    assert.ok(fs.existsSync(path.join(repo, 'src', 'dedupe.js')), `${c}: src/dedupe.js`);
    assert.equal(git(repo, 'branch', '--show-current').stdout.trim(), '001-dedupe');
    assert.equal(git(repo, 'status', '--short').stdout, '', `${c}: committed`);
    const verdict = JSON.parse(fs.readFileSync(path.join(repo, '.git', 'speckit-team', 'verdicts', '001-dedupe.json'), 'utf8'));
    assert.equal(verdict.verdict, 'PASS', `${c}: the audit gate is open`);
    assert.equal(node(repo, 'test/dedupe.test.js').status, 0, `${c}: the functional test passes`);
  }
});

test('012 T022 SC-001 SC-002 SC-006: the variants differ: linear is not the quadratic source, and pinned, empty and skipped each carry their flaw', () => {
  const files = (c) => { const { repo } = scratch({ case: c }); return git(repo, 'ls-files').stdout.split('\n').filter(Boolean).map((f) => [f, fs.readFileSync(path.join(repo, f), 'utf8')]); };
  const src = (c) => files(c).find(([f]) => f === 'src/dedupe.js')?.[1];
  assert.ok(src('load-quadratic') && src('load-linear'), 'both lay src/dedupe.js');
  assert.notEqual(src('load-quadratic'), src('load-linear'), 'the linear variant has its own source');
  const loadTest = (c, re) => files(c).some(([f, t]) => /load/i.test(f) && /\.[cm]?js$/.test(f) && re.test(t));
  assert.ok(loadTest('load-pinned', /vendor|older|pinned/i), 'pinned: a load test importing an older vendored copy');
  assert.ok(loadTest('load-empty', /catch/), 'empty: a load test that catches the workload throw');
  assert.ok(loadTest('load-skipped', /skip/), 'skipped: a load test with a skipped case');
});

test('012 T022 SC-004: loadRequest asks only for load-tester on the built feature, differs by mode, and ends on its word', () => {
  assert.equal(typeof fullRun.loadRequest, 'function', 'tools/full-run.mjs exports loadRequest');
  const a = fullRun.loadRequest();
  const s = fullRun.loadRequest({ skillAgents: true });
  assert.match(a, /specs\/001-dedupe/);
  assert.match(a, /load-tester/);
  assert.match(a, /PASS.*FAIL.*NOT MEASURED/s, 'names the three words');
  assert.match(a, /last line/i);
  assert.notEqual(a, s);
  assert.match(s, /role skill|skill/i);
});

test('012 T022 SC-004: gateReport with role load-tester reads that role report, and the default role ignores it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skeval-lt-'));
  const main = path.join(dir, 'sess.jsonl');
  jsonl(main, [used('m1', 'Agent', { subagent_type: 'load-tester' }), said('m2', 'done')]);
  const sub = path.join(dir, 'sess', 'subagents');
  const agent = (id, type, rows) => { jsonl(path.join(sub, `agent-${id}.jsonl`), rows); fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: type })); };
  agent('a1', 'load-tester', [said('l1', 'Measurements\nWarnings\nnoisy: busy 40%\n\nPASS', { timestamp: '2026-11-20T08:00:00Z' })]);
  agent('a2', 'spec-gatekeeper', [said('g1', 'APPROVED', { timestamp: '2026-11-20T09:00:00Z' })]);
  assert.equal(gateReport({ transcript: main, role: 'load-tester' }), 'Measurements\nWarnings\nnoisy: busy 40%\n\nPASS');
  assert.equal(gateReport({ transcript: main }), 'APPROVED', 'the default role is still spec-gatekeeper');
  const sk = path.join(dir, 'skill.jsonl');
  jsonl(sk, [used('s1', 'Skill', { skill: 'speckit-role-load-tester' }), said('s2', 'Measurements\nFAIL'), used('s3', 'Skill', { skill: 'speckit-role-spec-gatekeeper' }), said('s4', 'APPROVED')]);
  assert.equal(gateReport({ transcript: sk, skillAgents: true, role: 'load-tester' }), 'Measurements\nFAIL');
  assert.equal(gateReport({ transcript: sk, skillAgents: true }), 'APPROVED');
});

// #429: an eval's runs install the team on a model tier, passed to each full run.
test('#429 eval: --models is passed to every full run, and an unknown tier is refused', () => {
  assert.equal(parseArgs(['--out', 'x', '--arm', 'a=.']).models, null);
  assert.equal(parseArgs(['--out', 'x', '--arm', 'a=.', '--models', 'sonnet']).models, 'sonnet');
  assert.throws(() => parseArgs(['--out', 'x', '--arm', 'a=.', '--models', 'haiku']), /--models takes one of default, sonnet, opus, fast/);
  assert.deepEqual(fullRunArgs({ models: 'sonnet' }).slice(-2), ['--models', 'sonnet']);
  assert.ok(!fullRunArgs({ models: null }).includes('--models'));
});

// #495: bounded parallel execution (--jobs), memory circuit-breaker (--min-free-mb), and --resume in tools/eval.mjs.
test('#495 eval: parseArgs parses --jobs, --min-free-mb, --resume, and runSweep honors concurrency, memory breaker, and --resume', async () => {
  const def = parseArgs(['--out', 'x', '--arm', 'a=.']);
  assert.equal(def.jobs, 1);
  assert.equal(def.minFreeMb, 2560);
  assert.equal(def.resume, false);

  const custom = parseArgs(['--out', 'x', '--arm', 'a=.', '--jobs', '3', '--min-free-mb', '1024', '--resume']);
  assert.equal(custom.jobs, 3);
  assert.equal(custom.minFreeMb, 1024);
  assert.equal(custom.resume, true);
  assert.throws(() => parseArgs(['--out', 'x', '--arm', 'a=.', '--jobs', '0']), /--jobs/);

  // Test runSweep with --resume and bounded concurrency + memory circuit breaker
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'skeval-495-'));
  // Pre-seed run #1 for arm 'base' case 'defect' so --resume skips spawning it
  const seededDir = path.join(out, 'base', 'defect', '1');
  fs.mkdirSync(seededDir, { recursive: true });
  fs.writeFileSync(path.join(seededDir, 'run.json'), JSON.stringify({
    cost: 0.4, gate: { word: 'REJECTED' }, failures: [], usage: { main: { input: 50000 }, agents: [] },
  }));

  let active = 0; let maxActive = 0; const spawned = [];
  let freeBytes = 500 * 1024 * 1024; // start below 1024 MB threshold when active > 0
  const rows = await runSweep({
    out, arms: [{ label: 'base', dir: ROOT }], cases: ['defect'], runs: 3, jobs: 2, minFreeMb: 1024, resume: true,
  }, {
    freemem: () => freeBytes,
    runCell: async ({ dir, n }) => {
      spawned.push(n);
      active++;
      if (active > maxActive) maxActive = active;
      await new Promise((r) => setTimeout(r, 40));
      // Once the first active job finishes, free memory rises above threshold
      freeBytes = 4096 * 1024 * 1024;
      active--;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
        cost: 0.5, gate: { word: 'REJECTED' }, failures: [], usage: { main: { input: 60000 }, agents: [] },
      }));
      return { status: 0, stdout: 'ok', stderr: '' };
    },
  });

  assert.deepEqual(spawned, [2, 3], 'run #1 was resumed from existing run.json without re-invoking runCell');
  assert.equal(maxActive, 1, 'memory circuit breaker held back second concurrent job while freeBytes < minFreeMb');
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.right).length, 3);
});

// #469: a scored case for spec-auditor, so its model tier can be compared on a defect it must FAIL.
test('#469 eval: the audit cases build a specified, planned feature with open tasks and no verdict; only the defect builds code before its tests', () => {
  for (const name of ['audit-defect', 'audit-control']) {
    assert.equal(CASES[name].audit, true, name);
    const { repo } = scratch({ case: name });
    const tasks = fs.readFileSync(path.join(repo, 'specs', '001-sum', 'tasks.md'), 'utf8');
    assert.doesNotMatch(tasks, /\[X\]/i, `${name}: nothing is built`);
    assert.ok(fs.existsSync(path.join(repo, 'specs', '001-sum', 'spec.md')) && fs.existsSync(path.join(repo, 'specs', '001-sum', 'plan.md')), name);
    assert.equal(git(repo, 'branch', '--show-current').stdout.trim(), '001-sum');
    assert.equal(git(repo, 'status', '--short').stdout, '', `${name}: everything is committed`);
    assert.ok(!fs.existsSync(path.join(repo, '.git', 'speckit-team', 'verdicts')), `${name}: no audit verdict is seeded, the run gives it`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.specify', 'feature.json'), 'utf8')).feature_directory, 'specs/001-sum');
    const ids = tasks.split(/\r?\n/).filter((l) => /^- \[ \] T\d+/.test(l));
    const firstImpl = ids.findIndex((l) => /Implement/.test(l));
    const firstTest = ids.findIndex((l) => /\bTest\b/.test(l));
    assert.ok(firstImpl >= 0 && firstTest >= 0, name);
    if (name === 'audit-defect') assert.ok(firstImpl < firstTest, 'the defect: sum() is built before its tests, against constitution I');
    else assert.ok(firstTest < firstImpl, 'the control: tests first');
  }
  assert.equal(CASES['audit-defect'].right, 'FAIL');
  assert.equal(CASES['audit-control'].right, 'PASS');
});

test('#469 eval: an audit case is right only on the verdict the case expects, and the verdict is the hook record first', () => {
  for (const [name, word, right] of [['audit-defect', 'FAIL', true], ['audit-defect', 'PASS', false], ['audit-defect', null, false],
    ['audit-control', 'PASS', true], ['audit-control', 'FAIL', false]]) {
    const s = scoreRun(name, { report: { gate: { word } } });
    assert.equal(s.right, right, `${name} saw ${word}`);
    assert.match(s.why, /spec-auditor/);
  }
  assert.deepEqual(auditWord({ verdicts: [{ verdict: 'FAIL' }], text: 'VERDICT: PASS' }), { word: 'FAIL', source: 'hook record' });
  assert.deepEqual(auditWord({ verdicts: [], text: 'It found two issues.\n\nVERDICT: FAIL' }), { word: 'FAIL', source: 'last line of the answer' });
  assert.deepEqual(auditWord({ verdicts: [], text: 'it would not say VERDICT: PASS here' }), { word: null, source: 'none' });
});

test('#469 eval: the audit prompt runs only spec-auditor, changes nothing, ends on its verdict, and differs by mode; no other team takes it', () => {
  const a = auditRequest({ skillAgents: false });
  const s = auditRequest({ skillAgents: true });
  assert.match(a, /spec-auditor/);
  assert.match(a, /change no file/i, 'the main session must not fix the seeded defect itself');
  assert.match(a, /VERDICT: PASS or VERDICT: FAIL/);
  assert.notEqual(a, s);
  assert.throws(() => fullRunArgv(['--out', 'x', '--hybrid', '--case', 'audit-defect']), /--hybrid runs only a whole pipeline/);
  assert.throws(() => fullRunArgv(['--out', 'x', '--team', 'build', '--case', 'audit-control']), /--team runs only a whole pipeline/);
});
