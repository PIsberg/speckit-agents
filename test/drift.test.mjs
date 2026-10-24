// Run: npm test (or node --test "test/drift.test.mjs")
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

// The tool decides what a test file is the way the hook's test lanes do; a pattern added on one side
// only would make the tool miss tests the hook knows, or check files it does not.
test("drift: the tool's TEST_PATTERNS are the hook's", () => {
  const patterns = (f) => /const TEST_PATTERNS = \[[\s\S]*?\n\];/.exec(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'))?.[0];
  const hook = patterns('hooks/speckit-team.mjs');
  assert.ok(hook, 'the hook declares TEST_PATTERNS');
  assert.equal(patterns('tools/drift.mjs'), hook);
});
