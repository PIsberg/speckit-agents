// Run: npm test (or node --test test/)
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
const backups = (dir) => fs.readdirSync(dir).filter((f) => f.includes('.bak-speckit-agents-'));
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
  assert.match(fs.readFileSync(path.join(dir, 'agents', 'implementer.md'), 'utf8'), new RegExp(`node "${hookPath}" gate`));
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
  assert.equal(commands.length, 3);
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
