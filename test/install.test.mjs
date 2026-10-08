// Run: npm test (or node --test "test/*.test.mjs")
// Installs into throwaway Claude config dirs (with a space in the path) and checks what lands there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'install.mjs');
const AGENTS = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'];
const UNRELATED = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-hook' }] };

function claudeDir(settings) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skagents-')), 'claude dir');
  fs.mkdirSync(dir);
  if (settings !== undefined) {
    fs.writeFileSync(path.join(dir, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
  }
  return dir;
}
const install = (dir, ...args) => spawnSync(process.execPath, [INSTALL, '--claude-dir', dir, ...args], { encoding: 'utf8' });
const settingsOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
const backups = (dir) => fs.readdirSync(dir).filter((f) => f.includes('.bak-speckit-agents'));
// Install then uninstall, returning what is left in the config dir.
function roundTrip(dir) {
  const i = install(dir);
  assert.equal(i.status, 0, i.stderr + i.stdout);
  const u = install(dir, '--uninstall');
  assert.equal(u.status, 0, u.stderr + u.stdout);
  return fs.readdirSync(dir).sort();
}
const bytes = (dir) => fs.readFileSync(path.join(dir, 'settings.json'));
const gates = (s) => Object.entries(s.hooks ?? {}).flatMap(([event, groups]) => groups
  .filter((g) => g.hooks.some((h) => h.command.includes('speckit-team.mjs'))).map((g) => `${event}:${g.matcher}`));

test('install lays down agents, skill, hook and both settings gates, keeping other hooks', () => {
  const dir = claudeDir({ model: 'opus', hooks: { PreToolUse: [UNRELATED, {
    matcher: 'Skill', hooks: [{ type: 'command', command: 'node C:/old/place/speckit-team.mjs gate' }] }] } });
  const r = install(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);

  const hookPath = path.join(dir, 'hooks', 'speckit-team.mjs').split(path.sep).join('/');
  for (const a of AGENTS) {
    const text = fs.readFileSync(path.join(dir, 'agents', `${a}.md`), 'utf8');
    assert.doesNotMatch(text, /\{\{HOOK\}\}/, a);
    assert.match(text, /speckit-agents: managed/, a);
  }
  const implementer = fs.readFileSync(path.join(dir, 'agents', 'implementer.md'), 'utf8');
  assert.match(implementer, new RegExp(`node "${hookPath}" gate retries`));
  assert.match(implementer, new RegExp(`node "${hookPath}" result`));
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md')));

  const s = settingsOf(dir);
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.hooks.PreToolUse[0], UNRELATED);
  assert.deepEqual(gates(s).sort(), ['PreToolUse:Skill', 'UserPromptExpansion:speckit-implement|speckit\\.implement']);
  assert.ok(!JSON.stringify(s).includes('C:/old/place'), 'stale gate replaced, not duplicated');
  assert.equal(backups(dir).length, 1, 'settings.json backed up before the change');
  assert.match(r.stdout, /verified\s+installed hook runs/);
});

test('a second install changes nothing', () => {
  const dir = claudeDir({});
  install(dir);
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  const r = install(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /^(install|update) /m);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
  assert.equal(backups(dir).length, 1);
});

test('installed hook commands run through a shell from a path with a space', { skip: !spawnSync('bash', ['--version']).stdout }, () => {
  const dir = claudeDir();
  install(dir);
  const text = fs.readFileSync(path.join(dir, 'agents', 'implementer.md'), 'utf8');
  const commands = [...text.matchAll(/command: '(.+)'/g)].map((m) => m[1]);
  assert.equal(commands.length, 5);
  for (const cmd of commands) {
    // Claude Code runs hook commands in a shell (Git Bash on Windows). Outside a Spec Kit repo the
    // hook must exit 0, so this catches quoting and space-in-path breakage. It cannot catch the
    // $HOME (/c/Users/...) crash: an interactive Git Bash converts that path for node, Claude Code's
    // hook runner does not. The installer's own smoke check runs node without a shell and does.
    const r = spawnSync('bash', ['-c', cmd], { input: '{}', encoding: 'utf8', cwd: os.tmpdir() });
    assert.equal(r.status, 0, `${cmd}\n${r.stderr}`);
  }
});

test('refuses to replace agents it did not install, unless --force', () => {
  const dir = claudeDir();
  const mine = path.join(dir, 'agents', 'architect.md');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, '---\nname: architect\ndescription: my own\n---\n');

  const r = install(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /architect\.md/);
  assert.equal(fs.readFileSync(mine, 'utf8'), '---\nname: architect\ndescription: my own\n---\n');
  assert.ok(!fs.existsSync(path.join(dir, 'hooks')), 'nothing installed on refusal');

  assert.equal(install(dir, '--force').status, 0);
  assert.match(fs.readFileSync(mine, 'utf8'), /speckit-agents: managed/);
  const [backup] = fs.readdirSync(path.dirname(mine)).filter((f) => f.startsWith('architect.md.bak-'));
  assert.match(fs.readFileSync(path.join(path.dirname(mine), backup), 'utf8'), /my own/);
});

test('--dry-run writes nothing', () => {
  const dir = claudeDir({ hooks: { PreToolUse: [UNRELATED] } });
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  const r = install(dir, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] install/);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
});

test('--uninstall removes only what it installed', () => {
  const dir = claudeDir({ hooks: { PreToolUse: [UNRELATED] } });
  install(dir);
  fs.writeFileSync(path.join(dir, 'agents', 'my-agent.md'), '---\nname: my-agent\n---\n');
  const r = install(dir, '--uninstall');
  assert.equal(r.status, 0, r.stderr);
  for (const a of AGENTS) assert.ok(!fs.existsSync(path.join(dir, 'agents', `${a}.md`)), a);
  assert.ok(!fs.existsSync(path.join(dir, 'skills', 'speckit-team')));
  assert.ok(!fs.existsSync(path.join(dir, 'hooks', 'speckit-team.mjs')));
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'my-agent.md')));
  assert.deepEqual(settingsOf(dir).hooks, { PreToolUse: [UNRELATED] });
});

test('a settings.json that is not JSON is left alone', () => {
  const dir = claudeDir('{ "hooks": { // a comment\n } }');
  const r = install(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{ "hooks": { // a comment\n } }');
  assert.deepEqual(fs.readdirSync(dir), ['settings.json'], 'no half install: fail before writing anything');
});

// Uninstall leaves the config as it found it (SC-009 as the owner decided on 2026-10-06): the same
// settings, in their own formatting, and no file or directory of the installer's left behind.
test('install then uninstall into an empty config dir leaves it empty', () => {
  const dir = claudeDir();
  assert.deepEqual(roundTrip(dir), []);
});

for (const [name, text] of [
  ['CRLF with 4 spaces', '{\r\n    "model": "opus",\r\n    "hooks": {\r\n        "PreToolUse": []\r\n    }\r\n}\r\n'],
  ['compact one line with inline arrays', '{"model":"opus","permissions":{"deny":["Grep","Glob"]}}'],
  ['tabs, no trailing newline', '{\n\t"model": "opus",\n\t"env": {\n\t\t"A": "1"\n\t}\n}'],
  ['a user\'s own empty hooks object', '{\n  "hooks": {}\n}\n'],
]) {
  test(`round trip restores ${name} byte for byte, with nothing left behind`, () => {
    const dir = claudeDir(text);
    assert.deepEqual(roundTrip(dir), ['settings.json']);
    assert.equal(bytes(dir).toString('utf8'), text);
  });
}

test('a change another tool made between install and uninstall is kept, in the file\'s own format', () => {
  const dir = claudeDir('{\r\n    "model": "opus"\r\n}\r\n');
  assert.equal(install(dir).status, 0);
  const s = settingsOf(dir);
  s.theme = 'dark';
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s, null, 4).replace(/\n/g, '\r\n') + '\r\n');
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['settings.json']);
  assert.equal(bytes(dir).toString('utf8'), '{\r\n    "model": "opus",\r\n    "theme": "dark"\r\n}\r\n');
});

test('a reinstall after another tool re-sorted settings.json changes nothing', () => {
  const dir = claudeDir({ hooks: { PreToolUse: [UNRELATED] } });
  install(dir);
  const s = settingsOf(dir);
  s.hooks.PreToolUse.reverse(); // the gate entry now comes first, as a key-sorting tool leaves it
  const resorted = JSON.stringify(s, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, 'settings.json'), resorted);
  const r = install(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), resorted);
});

test('uninstall removes the directories it created and keeps ones that were already there', () => {
  const dir = claudeDir();
  fs.mkdirSync(path.join(dir, 'agents'));
  assert.deepEqual(roundTrip(dir), ['agents']);
});

test('uninstall puts back an agent that --force replaced', () => {
  const dir = claudeDir();
  const mine = path.join(dir, 'agents', 'architect.md');
  fs.mkdirSync(path.dirname(mine));
  fs.writeFileSync(mine, '---\nname: architect\ndescription: my own\n---\n');
  assert.equal(install(dir, '--force').status, 0);
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.equal(fs.readFileSync(mine, 'utf8'), '---\nname: architect\ndescription: my own\n---\n');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'agents')), ['architect.md']);
});

test('--help lists every flag, --board and --no-board included', () => {
  const r = spawnSync(process.execPath, [INSTALL, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['--uninstall', '--dry-run', '--force', '--claude-dir', '--board', '--no-board']) assert.match(r.stdout, new RegExp(`${f}\\b`));
  assert.doesNotMatch(r.stdout, /^import/m);
});

test('--board and --no-board together are refused before anything is written', () => {
  const dir = claudeDir();
  const r = install(dir, '--board', '--no-board');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /contradict/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// The board goes in through `claude plugin`. When that fails (no claude, a broken one) the team
// still installs, the run fails naming the board, and uninstall warns and still removes the team.
// A claude that always fails goes first on PATH: CI's setup-node folder holds node and the real
// claude side by side, so trimming PATH to node's folder does not take claude away.
test('--board with a failing Claude Code installs the team, fails, and uninstall still cleans up', () => {
  const dir = claudeDir();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'skbin-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@exit /b 1\r\n');
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: `${bin}${path.delimiter}${process.env[pathKey]}` };
  const run = (...args) => spawnSync(process.execPath, [INSTALL, '--claude-dir', dir, ...args], { encoding: 'utf8', env });
  const i = run('--board');
  assert.equal(i.status, 1, i.stdout + i.stderr);
  assert.match(i.stderr, /the team is installed, the board mod is not installed/);
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'architect.md')));
  const u = run('--uninstall');
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.match(u.stdout, /WARNING: the board mod was not removed/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// Real `claude plugin` runs against the throwaway config dir. Spawned without a shell, so a missing
// claude, or an npm-installed claude.cmd, reports these skipped, not passed, except in CI, where
// SPECKIT_REQUIRE_CLAUDE=1 makes them run and fail.
const claudeIn = (dir, ...args) => spawnSync('claude', args, { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
const noClaude = spawnSync('claude', ['--version']).status === 0 || process.env.SPECKIT_REQUIRE_CLAUDE === '1' ? false : 'no claude executable on PATH';
const boardIn = (dir) => JSON.parse(claudeIn(dir, 'plugin', 'list', '--json').stdout).find((p) => p.id === 'speckit-board@speckit-agents');
const marketsIn = (dir) => JSON.parse(claudeIn(dir, 'plugin', 'marketplace', 'list', '--json').stdout).map((m) => m.name);

test('--board installs the mod read from this checkout; reruns keep it; --no-board removes it', { skip: noClaude }, () => {
  const dir = claudeDir();
  const i = install(dir, '--board');
  assert.equal(i.status, 0, i.stdout + i.stderr);
  const board = boardIn(dir);
  assert.equal(board?.scope, 'user');
  assert.equal(path.resolve(board.readFromFolder), path.resolve(path.dirname(INSTALL), 'mods', 'speckit-board'));

  const again = install(dir);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /unchanged\s+speckit-board@speckit-agents/);

  const off = install(dir, '--no-board');
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.equal(boardIn(dir), undefined);
  assert.ok(!marketsIn(dir).includes('speckit-agents'));
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'architect.md')), 'the team stays');
  const later = install(dir);
  assert.equal(later.status, 0, later.stdout + later.stderr);
  assert.equal(boardIn(dir), undefined, 'a rerun after --no-board does not bring it back');
});

test('uninstall removes the board and its marketplace and restores settings byte for byte', { skip: noClaude }, () => {
  // Not `model`: Claude Code rewrites "opus" to "opus[1m]" whenever a `claude` command touches it.
  const text = '{\n    "env": {\n        "A": "1"\n    }\n}\n';
  const dir = claudeDir(text);
  assert.equal(install(dir, '--board').status, 0);
  assert.ok(boardIn(dir));
  const u = install(dir, '--uninstall');
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.equal(boardIn(dir), undefined);
  assert.ok(!marketsIn(dir).includes('speckit-agents'));
  assert.equal(bytes(dir).toString('utf8'), text);
  assert.deepEqual(backups(dir), []);
});

test('--board from another checkout points the board at that checkout', { skip: noClaude }, () => {
  const dir = claudeDir();
  assert.equal(install(dir, '--board').status, 0);
  // A second checkout (a clone, a worktree, or this one moved) with what the installer reads.
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skagents-checkout-')), 'other checkout');
  for (const p of ['install.mjs', 'agents', 'hooks', 'skills', '.claude-plugin', path.join('mods', 'speckit-board')]) {
    fs.cpSync(path.join(path.dirname(INSTALL), p), path.join(other, p), { recursive: true });
  }
  const r = spawnSync(process.execPath, [path.join(other, 'install.mjs'), '--claude-dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(path.resolve(boardIn(dir).readFromFolder).toLowerCase(), path.resolve(other, 'mods', 'speckit-board').toLowerCase());
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.equal(boardIn(dir), undefined);
  assert.ok(!marketsIn(dir).includes('speckit-agents'));
});

test('a marketplace the user added is not removed with the board', { skip: noClaude }, () => {
  const dir = claudeDir();
  assert.equal(claudeIn(dir, 'plugin', 'marketplace', 'add', path.dirname(INSTALL)).status, 0);
  assert.equal(install(dir, '--board').status, 0);
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.equal(boardIn(dir), undefined);
  assert.ok(marketsIn(dir).includes('speckit-agents'));
});
