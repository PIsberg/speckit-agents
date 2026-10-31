// Run: npm test (or node tools/test.mjs test/runner.test.mjs)
// #214: `npm test` passed a quoted glob to `node --test`, which Node expands itself only from v21: on
// Node 20.20.2 it found no file at all ("Could not find '...\test\c*.test.mjs'"), although the README
// promised Node 18 (the floor is 22 since #223). tools/test.mjs lists the files itself and runs them under the node that started it,
// so `<any node> tools/test.mjs` works where `node` on PATH is missing or another one. The setup
// scripts refuse a Node older than the floor by name instead of failing later inside install.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testFiles } from '../tools/test.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'tools', 'test.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skrunner-'));

test('#214: npm test runs the runner, and hands node --test no glob', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node tools/test.mjs');
});

test('#214: the runner lists every test/*.test.mjs, sorted, and nothing else', () => {
  const dir = tmp();
  for (const f of ['b.test.mjs', 'a.test.mjs', 'helpers.mjs', 'c.test.js']) fs.writeFileSync(path.join(dir, f), '');
  fs.mkdirSync(path.join(dir, 'fixtures'));
  fs.writeFileSync(path.join(dir, 'fixtures', 'd.test.mjs'), '');
  assert.deepEqual(testFiles(dir), ['a.test.mjs', 'b.test.mjs'].map((f) => path.join(dir, f)));
  const own = testFiles(path.join(ROOT, 'test')).map((f) => path.basename(f));
  assert.ok(own.includes('runner.test.mjs') && own.includes('hook.test.mjs'), own.join(' '));
  assert.ok(!own.includes('hook-helpers.mjs'));
});

test('#214: the runner runs the given files under its own node, passes options on, and exits as the tests did', () => {
  const dir = tmp();
  const ok = path.join(dir, 'ok.test.mjs'); const bad = path.join(dir, 'bad.test.mjs');
  fs.writeFileSync(ok, "import { test } from 'node:test';\ntest('fine', () => {});\ntest('also fine', () => {});\n");
  fs.writeFileSync(bad, "import { test } from 'node:test';\ntest('broken', () => { throw new Error('red'); });\n");
  // Without NODE_TEST_CONTEXT, which this test process exports and which would switch the nested
  // node --test to the runner's internal protocol, as no `npm test` from a shell has it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const run = (...a) => spawnSync(process.execPath, [RUNNER, ...a], { encoding: 'utf8', env });
  const green = run(ok);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /pass 2/);
  assert.equal(run(ok, bad).status, 1, 'a failing test fails the run');
  const picked = run('--test-name-pattern=also', ok);
  assert.equal(picked.status, 0, picked.stderr);
  assert.match(picked.stdout, /pass 1/, 'the option reached node --test');
});

// A stand-in `node` that reports v20, under the floor of 22, on PATH ahead of the real one.
function oldNode() {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'node'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v20.20.2; exit 0; fi\necho "stand-in node: $*" >&2\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'node.cmd'), '@echo off\r\nif "%~1"=="--version" (echo v20.20.2& exit /b 0)\r\necho stand-in node: %* 1>&2\r\nexit /b 1\r\n');
  return dir;
}
const withPath = (dir) => ({ ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, Path: `${dir}${path.delimiter}${process.env.Path ?? process.env.PATH}` });

test('#214: setup.sh refuses a Node older than 18 and names the version it found', () => {
  const r = spawnSync('sh', [path.join(ROOT, 'setup.sh'), '--help'], { encoding: 'utf8', env: withPath(oldNode()) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Node 22 or newer is needed; found v20.20.2/);
  assert.doesNotMatch(r.stderr, /stand-in node: .*install\.mjs/, 'install.mjs never ran');
  const real = spawnSync('sh', [path.join(ROOT, 'setup.sh'), '--help'], { encoding: 'utf8' });
  assert.equal(real.status, 0, `control, the real node: ${real.stderr}`);
});

test('#214: setup.ps1 refuses a Node older than 18 and names the version it found', () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(ROOT, 'setup.ps1'), '--help'], { encoding: 'utf8', env: withPath(oldNode()) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /Node 22 or newer is needed; found v20.20.2/);
  const real = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(ROOT, 'setup.ps1'), '--help'], { encoding: 'utf8' });
  assert.equal(real.status, 0, `control, the real node: ${real.stdout}${real.stderr}`);
});
