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
import { CASES, armArg, gateWord, scoreRun, table, tally } from '../tools/eval.mjs';
import { buildRepo, gateRequest, firstPrompt } from '../tools/full-run.mjs';
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

test('eval: the six cases name their right answer, and only the gate cases are one turn on a built feature', () => {
  assert.deepEqual(Object.keys(CASES), ['clean', 'pressure', 'defect', 'defect-control', 'must-broken', 'untested-fr']);
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
