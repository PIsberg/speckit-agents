// Run: npm test (or node --test "test/*.test.mjs")
// The speckit-board mod (mods/speckit-board) reads the hook's verdict and retry files and
// recomputes the hook's fingerprint to tell a fresh PASS from a stale one. These tests hold the
// two copies of that algorithm together, and run the mod's own gates where Claude Code is on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'hooks', 'speckit-team.mjs');
const MOD = path.join(ROOT, 'mods', 'speckit-board');
// mods/speckit-board/tests/model.test.ts pins the mod's fingerprint of the same files to this value.
const PINNED = '2cb0d7cc9eddc2be';

test('the hook records the fingerprint the board mod pins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skboard-'));
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  // CRLF, ticked boxes in both list styles and a missing plan.md: each is normalised or stood in for.
  write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/001-x' }));
  write('.specify/memory/constitution.md', '# C\r\nrule');
  write('specs/001-x/spec.md', '**Status**: Approved');
  write('specs/001-x/tasks.md', '- [x] T001 a\n- [ ] T002 b\n  * [X] T003 c');
  const r = spawnSync('node', [HOOK, 'verdict'], {
    input: JSON.stringify({ cwd: dir, hook_event_name: 'SubagentStop', last_assistant_message: 'VERDICT: PASS' }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const recorded = JSON.parse(fs.readFileSync(path.join(dir, '.git', 'speckit-team', 'verdicts', '001-x.json'), 'utf8'));
  assert.equal(recorded.fingerprint, PINNED);
});

// Spawned without a shell, so a checkout path with spaces stays one argument. An npm-installed
// claude.cmd cannot be spawned that way: the tests then report skipped, not passed. CI sets
// SPECKIT_REQUIRE_CLAUDE=1, so there a missing claude fails them instead.
const claude = (...args) => spawnSync('claude', args, { encoding: 'utf8' });
const noClaude = claude('--version').status === 0 || process.env.SPECKIT_REQUIRE_CLAUDE === '1' ? false : 'no claude executable on PATH';

test('claude plugin validate accepts the board mod', { skip: noClaude }, () => {
  const r = claude('plugin', 'validate', MOD);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// install.mjs --board installs speckit-board@speckit-agents from this marketplace file.
// `claude plugin validate` checks its schema, not that an entry's source exists.
test('the repo\'s marketplace lists the board mod under its own name and folder', () => {
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(MOD, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(market.name, 'speckit-agents');
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.equal(plugin.name, 'speckit-board');
  assert.equal(path.resolve(ROOT, entry.source), MOD);
});

test('claude plugin validate accepts the repo\'s marketplace', { skip: noClaude }, () => {
  const r = claude('plugin', 'validate', ROOT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /marketplace\.json/);
});

test('the board mod\'s own tests pass under claude plugin test', { skip: noClaude }, () => {
  const r = claude('plugin', 'test', MOD);
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out);
  assert.match(out, /\b0 fail\b/, out);
});
