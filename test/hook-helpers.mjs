// Shared by test/hook.test.mjs and test/hook-patch.test.mjs: the hook, a throwaway repo, and a call
// that feeds the hook JSON on stdin as Claude Code does. Not a test file: npm test's glob is *.test.mjs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'speckit-team.mjs');
export const FEAT = 'specs/001-demo';

export function repo({ speckit = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skteam-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  if (speckit) {
    write('.specify/memory/constitution.md', '# Constitution\nTests first.\n');
    write('.specify/feature.json', JSON.stringify({ feature_directory: FEAT }));
    write(`${FEAT}/spec.md`, '# Spec\nFR-001 must work.\n');
    write(`${FEAT}/plan.md`, '# Plan\n');
    write(`${FEAT}/tasks.md`, '- [ ] T001 write test\n- [ ] T002 implement\n');
  }
  write('src/main/App.java', 'class App {}\n');
  g('add', '-A'); g('commit', '-qm', 'init');
  return { dir, write, g };
}

export function run(dir, args, payload, hook = HOOK) {
  const r = spawnSync('node', [hook, ...args], {
    input: JSON.stringify({ cwd: dir, ...payload }), encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}
export const write = (dir, args, file, extra = {}) => run(dir, args, {
  hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, file) }, ...extra,
});
export const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
export const pass = (dir) => run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: 'All good.\n\nVERDICT: PASS' });

export const handback = (dir, mode, message, extra = {}) => run(dir, [mode], {
  hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id: 'aud1', ...extra,
});

export const decided = (out) => Boolean(out?.hookSpecificOutput?.permissionDecision || out?.decision);

export const stateDir = (dir) => path.join(dir, '.git', 'speckit-team');

export function commitAll(r, msg) { r.g('add', '-A'); r.g('commit', '-qm', msg); return r; }

export const msg = (out) => out?.systemMessage ?? '';
