// Run: npm test (or node tools/test.mjs test/drift.test.mjs)
// tools/drift.mjs checks every finished feature's test tasks against the tests as they are now: a
// test file a task names that is gone, or a requirement ID the task cites that its test files no
// longer hold. No model: test-writer puts each cited ID in a test's name or a comment, so text is
// enough (the drift report of google/elephant-goldfish-model, docs/designs/drift_report.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drift } from '../tools/drift.mjs';
import { excusedBy } from '../hooks/speckit-drift.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'drift.mjs');

const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });

// A repo with one feature: its tasks.md and the files given, relative to the repo. With `removed`, a git
// repo where those files were committed and then deleted, as when a test file is dropped or moved.
function repo(tasks, files = {}, { removed = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skdrift-'));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('specs/001-sum/tasks.md', `# Tasks\n\n## Phase 1\n\n${tasks}`);
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  if (removed.length) {
    git(dir, 'init', '-q');
    for (const rel of removed) write(rel, 'test("x", () => {});\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'tests');
    for (const rel of removed) fs.rmSync(path.join(dir, rel));
  }
  return dir;
}
// Outside a git repo nothing tells a built file from an example, so every missing path is reported.
const SUM_TASKS = '- [X] T001 [US1] Test FR-001 and FR-002 in `test/sum.test.js`: an empty array\n  gives 0 (FR-002).\n'
  + '- [X] T002 [US1] Implement `sum` in `src/math.js` (FR-001)\n';
const SUM_TEST = "test('FR-001 adds the numbers', () => {});\n// FR-002\ntest('an empty array gives 0', () => {});\n";

test('drift: a finished feature whose tests still hold its cited IDs reports nothing', () => {
  const r = drift(repo(SUM_TASKS, { 'test/sum.test.js': SUM_TEST, 'src/math.js': 'export const sum = () => 0;\n' }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.tasks, 1, 'one test task checked; the implementation task names no test file');
  assert.equal(r.features, 1);
});

test('drift: a test file a task names that git tracked and is gone is reported with the feature and task', () => {
  const r = drift(repo(SUM_TASKS, {}, { removed: ['test/sum.test.js'] }));
  assert.equal(r.problems.length, 1, JSON.stringify(r.problems));
  assert.match(r.problems[0], /^specs\/001-sum\/tasks\.md T001: test\/sum\.test\.js is gone$/);
});

// Tasks also name files as test inputs (`fixtures/data.json`) and paths inside a subproject: in a git
// repo a path git never tracked is no file the task built. This repo's own 003 and 005 tasks do both.
test('drift: in a git repo, a path git never tracked is an example, not a file that went missing', () => {
  const tasks = '- [X] T001 Test FR-001 in `test/sum.test.js` with an input like `test/fixtures/x.bin`\n';
  const r = drift(repo(tasks, { 'test/sum.test.js': SUM_TEST }, { removed: ['test/other.test.js'] }));
  assert.deepEqual(r.problems, []);
});

test('drift: success criteria (SC-) are not looked for in tests, only requirements (FR-)', () => {
  const tasks = '- [X] T001 Test FR-001 and SC-002 in `test/sum.test.js`\n';
  assert.deepEqual(drift(repo(tasks, { 'test/sum.test.js': SUM_TEST })).problems, []);
});

test('drift: a cited ID that none of the task\'s test files holds any more is reported', () => {
  const r = drift(repo(SUM_TASKS, { 'test/sum.test.js': "test('FR-001 adds the numbers', () => {});\n" }));
  assert.equal(r.problems.length, 1, JSON.stringify(r.problems));
  assert.match(r.problems[0], /^specs\/001-sum\/tasks\.md T001: FR-002 is in none of test\/sum\.test\.js$/);
});

// #212: an ID was matched as text, so another feature's test of the same ID number in the same file hid
// drift. A line that names a feature by its number (`009 T010 FR-008 ...`) now holds the ID for that
// feature only; a line that names none still holds it for any, as before.
test('drift (#212): the same ID of another feature in the same test file does not hide drift', () => {
  const dir = repo('- [X] T001 Test FR-001 in `test/shared.test.js`\n');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('specs/002-avg/tasks.md', '# Tasks\n\n- [X] T004 Test FR-001 and FR-002 in `test/shared.test.js`\n');
  const cases = [
    ["test('001 FR-001 adds the numbers', () => {});\ntest('002 FR-002 averages', () => {});\n", ['specs/002-avg/tasks.md T004: FR-001 is in none of test/shared.test.js for 002-avg (only on lines naming another feature)']],
    ["test('001 FR-001 adds', () => {});\ntest('002 FR-001 FR-002 averages', () => {});\n", []],
    ["test('FR-001 adds', () => {});\n// FR-002\n", []],
    ["test('001 and 002 share FR-001 and FR-002', () => {});\n", []],
    ["// specs/001-sum: FR-001\n// FR-002 in 002-avg\n", ['specs/002-avg/tasks.md T004: FR-001 is in none of test/shared.test.js for 002-avg (only on lines naming another feature)']],
  ];
  for (const [text, problems] of cases) {
    write('test/shared.test.js', text);
    assert.deepEqual(drift(dir).problems, problems, text);
  }
});

test('drift: an unticked task is not built yet, and a test path the repo adds in .specify/test-paths counts', () => {
  const tasks = '- [ ] T001 Test FR-001 in `test/sum.test.js`\n- [x] T002 Test FR-003 in `checks/sum_check.js`\n';
  const missing = drift(repo(tasks, {}));
  assert.deepEqual(missing.problems, [], 'checks/ is no test path by default, and T001 is open');
  const dir = repo(tasks, { '.specify/test-paths': '# extra\n^checks/\n' });
  const r = drift(dir);
  assert.equal(r.problems.length, 1, JSON.stringify(r.problems));
  assert.match(r.problems[0], /T002: checks\/sum_check\.js is gone/);
});

test('drift: the command exits 1 on drift, 0 without, and 2 where there are no features', () => {
  const run = (dir) => spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });
  const clean = run(repo(SUM_TASKS, { 'test/sum.test.js': SUM_TEST }));
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /1 test task in 1 feature checked, no drift/);
  const drifted = run(repo(SUM_TASKS, {}));
  assert.equal(drifted.status, 1, drifted.stdout + drifted.stderr);
  assert.match(drifted.stdout, /T001: test\/sum\.test\.js is gone/);
  assert.match(drifted.stdout, /1 problem/);
  const none = run(fs.mkdtempSync(path.join(os.tmpdir(), 'skdrift-none-')));
  assert.equal(none.status, 2, none.stdout + none.stderr);
  assert.match(none.stderr, /no specs\//);
});

// The check decides what a test file is the way the hook's test lanes do; a pattern added on one side
// only would make it miss tests the hook knows, or check files it does not. Since #228 the check lives in
// hooks/speckit-drift.mjs, which the hook loads at spec-gatekeeper's APPROVED and tools/drift.mjs runs.
test("drift: the check's TEST_PATTERNS are the hook's", () => {
  const patterns = (f) => /const TEST_PATTERNS = \[[\s\S]*?\n\];/.exec(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'))?.[0];
  const hook = patterns('hooks/speckit-team.mjs');
  assert.ok(hook, 'the hook declares TEST_PATTERNS');
  assert.equal(patterns('hooks/speckit-drift.mjs'), hook);
});

// #228: spec-gatekeeper's APPROVED is checked against the active feature only; another feature's drift
// is not this feature's to fix. A feature directory outside specs/ is checked too, and a feature without
// tasks.md has nothing to drift.
test('drift (#228): one feature checks only that feature, wherever its directory is', () => {
  const dir = repo(SUM_TASKS, { 'test/sum.test.js': SUM_TEST });
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('specs/002-avg/tasks.md', '# Tasks\n\n- [X] T004 Test FR-006 in `test/avg.test.js`\n');
  write('test/avg.test.js', "test('averages', () => {});\n");
  assert.equal(drift(dir).problems.length, 1, 'the whole repo has one problem, in 002');
  assert.deepEqual(drift(dir, { feature: 'specs/001-sum' }).problems, []);
  const one = drift(dir, { feature: 'specs/002-avg' });
  assert.deepEqual(one.problems, ['specs/002-avg/tasks.md T004: FR-006 is in none of test/avg.test.js']);
  assert.equal(one.features, 1);
  write('work/003-x/tasks.md', '- [X] T001 Test FR-001 in `test/x.test.js`\n');
  write('test/x.test.js', '// nothing\n');
  assert.deepEqual(drift(dir, { feature: 'work/003-x' }).problems, ['work/003-x/tasks.md T001: FR-001 is in none of test/x.test.js']);
  assert.deepEqual(drift(dir, { feature: 'specs/009-none' }), { features: 0, tasks: 0, problems: [] });
});

// A docs or measurement task names test files too ("held by `test/install.test.mjs`", "run
// `test/docs.test.mjs`") without promising that they hold its IDs: only a task that says it writes
// tests, before the first file it names, is checked. This repo's 007 T016 is such a docs task.
test('drift: a task that names test files but does not write tests is not checked', () => {
  const tasks = '- [X] T001 Docs in the same change (FR-014): `README.md` gets a section, held by\n  `test/sum.test.js`. Run `npm test` for `test/sum.test.js`.\n'
    + '- [X] T002 [P] [US1] Contract tests for FR-003 in `test/sum.test.js`\n';
  const r = drift(repo(tasks, { 'test/sum.test.js': SUM_TEST }));
  assert.equal(r.tasks, 1, 'T002 is a test task, T001 is not');
  assert.equal(r.problems.length, 1, JSON.stringify(r.problems));
  assert.match(r.problems[0], /T002: FR-003 is in none of test\/sum\.test\.js/);
});

// The check on this repository itself: a test moved to another file without its task updated (#161)
// fails here instead of waiting for someone to run the tool.
test('drift: this repository\'s finished features name the test files that hold their IDs', () => {
  const r = drift(ROOT);
  assert.deepEqual(r.problems, []);
  assert.ok(r.tasks >= 30, `checked ${r.tasks} test tasks`);
});

// #235: with `spec`, every requirement the feature's spec.md defines must be held by some test file, on a
// line naming the feature by its number (test-writer names tests `001 FR-002 ...`), since FR numbers repeat
// across features. A requirement no test can hold is excused only by a task that cites it with `No test:
// <reason>`: the architect writes it and the user approves it at the tasks stop, not the gatekeeper.
test('drift (#235): with spec, every FR of spec.md needs a test line naming its feature, or a task\'s No test:', () => {
  const SPEC = '# Spec\n\n- **FR-001**: adds.\n- **FR-002**: empty gives 0.\n- **FR-003**: docs in README.\n\nFR-001 again in prose.\n';
  const tasks = '- [X] T001 Test FR-001 and FR-002 in `test/sum.test.js`\n- [X] T002 Implement `sum` (FR-001)\n';
  const files = { 'specs/001-sum/spec.md': SPEC, 'test/sum.test.js': "test('001 FR-001 adds', () => {});\n// 001 FR-002\n" };
  const one = (extra = {}, t = tasks) => drift(repo(t, { ...files, ...extra }), { feature: 'specs/001-sum', spec: true }).problems;
  const p = one();
  assert.equal(p.length, 1, JSON.stringify(p));
  assert.match(p[0], /^specs\/001-sum\/spec\.md FR-003: no test names it with 001/);
  assert.deepEqual(one({}, `${tasks}- [X] T003 Docs for FR-003 in \`README.md\`. No test: prose, read by spec-auditor\n`), [], 'a task\'s No test: excuses it');
  assert.equal(one({}, `${tasks}- [X] T003 Docs in \`README.md\`. No test: prose\n`).length, 1, 'a No test: that cites another ID excuses nothing');
  // A line naming no feature, or another feature, does not hold it: every feature has an FR-003.
  assert.equal(one({ 'test/old.test.js': "test('FR-003 docs', () => {});\n// 002 FR-003\n" }).length, 1, 'FR-003 named without 001, or with 002');
  assert.deepEqual(one({ 'test/more/docs.test.js': '// 001 FR-003\n' }), [], 'any test file of the repo holds it, with the number');
  // Without `spec`, only test tasks' cited IDs are checked, as before.
  assert.deepEqual(drift(repo(tasks, files), { feature: 'specs/001-sum' }).problems, []);
  // A feature without spec.md has nothing to check at spec level.
  assert.deepEqual(drift(repo(tasks, { 'test/sum.test.js': files['test/sum.test.js'] }), { feature: 'specs/001-sum', spec: true }).problems, []);
});

// In the full run of 2026-11-08 the architect excused a process rule inside a test task: "Tests in
// `test/math.test.js` for ... FR-001, FR-002, SC-002, FR-007 (No test: FR-007 is a process rule ...)".
// The task check still asked for FR-007 in the test file, refusing APPROVED twice, and the spec check
// excused FR-001 and FR-002 with it. A No test: excuses the ID it follows and those its reason names,
// at both levels, and no other ID of the task.
test('drift (#235): a No test: excuses the ID it follows and those its reason names, not the task\'s others', () => {
  const SPEC = '- **FR-001**: adds.\n- **FR-002**: empty gives 0.\n- **FR-003**: test first.\n- **FR-004**: JSDoc.\n';
  const run = (tasks, tests) => drift(repo(tasks, { 'specs/001-sum/spec.md': SPEC, 'test/sum.test.js': tests }),
    { feature: 'specs/001-sum', spec: true }).problems;
  const T1 = '- [X] T001 Tests in `test/sum.test.js` for FR-001, FR-002, FR-003 (No test: a process rule, seen in git history)\n';
  const T2 = '- [X] T002 Implement `sum` (FR-001; No test: JSDoc is documentation, FR-004)\n';
  assert.deepEqual(run(T1 + T2, '// 001 FR-001\n// 001 FR-002\n'), [], 'FR-003 needs no test line, in its task or the spec');
  const p = run(T1 + T2, '// 001 FR-001\n');
  assert.equal(p.length, 2, JSON.stringify(p));
  assert.ok(p.every((x) => /FR-002/.test(x)), 'FR-002, cited before the excuse, is still owed at both levels');
  assert.equal(run(T1, '// 001 FR-001\n// 001 FR-002\n').length, 1, 'FR-004 is excused only by T002');
  assert.deepEqual([...excusedBy('make it name `src/text.js` too (FR-009). No test: documentation.')], ['FR-009']);
  assert.deepEqual([...excusedBy('Tests for FR-001 and FR-002 (No test: FR-002 is a process rule)')], ['FR-002']);
});

test('drift (#235): a test file git ignores, or one under node_modules, holds nothing', () => {
  const dir = repo('- [X] T001 Test FR-001 in `test/sum.test.js`\n', {
    'specs/001-sum/spec.md': '- **FR-001**: adds.\n- **FR-002**: empty.\n',
    'test/sum.test.js': '// 001 FR-001\n', 'node_modules/x/test/a.test.js': '// 001 FR-002\n',
  });
  assert.deepEqual(drift(dir, { feature: 'specs/001-sum', spec: true }).problems, ['specs/001-sum/spec.md FR-002: no test names it with 001 (put "001 FR-002" in a test\'s name or a comment, or give a task that cites it "No test: <reason>")']);
});
