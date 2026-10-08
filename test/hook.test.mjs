// Run: npm test (or node --test "test/*.test.mjs")
// Drives speckit-team.mjs exactly as Claude Code does: hook JSON on stdin, decision on stdout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'speckit-team.mjs');
const FEAT = 'specs/001-demo';

function repo({ speckit = true } = {}) {
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

function run(dir, args, payload) {
  const r = spawnSync('node', [HOOK, ...args], {
    input: JSON.stringify({ cwd: dir, ...payload }), encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const write = (dir, args, file, extra = {}) => run(dir, args, {
  hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, file) }, ...extra,
});
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
const pass = (dir) => run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: 'All good.\n\nVERDICT: PASS' });

test('every mode is a no-op outside a Spec Kit repo', () => {
  const { dir } = repo({ speckit: false });
  assert.equal(write(dir, ['scope', 'only', 'specs/'], 'src/main/App.java'), null);
  assert.equal(run(dir, ['gate'], { hook_event_name: 'UserPromptExpansion', command_name: 'speckit-implement' }), null);
});

test('scope only: planning agents write specs and CLAUDE.md, nothing else', () => {
  const { dir } = repo();
  const only = ['scope', 'only', 'specs/', 'CLAUDE.md'];
  assert.equal(write(dir, only, `${FEAT}/plan.md`), null);
  assert.equal(write(dir, only, 'CLAUDE.md'), null);
  assert.ok(denied(write(dir, only, 'src/main/App.java')));
  assert.ok(denied(write(dir, only, 'CLAUDE.md.bak')));
  assert.equal(write(dir, only, path.join('..', 'outside-repo.txt')), null, 'paths outside the repo are not its business');
});

// The repo reached through another name for the same folder: a symlink (macOS's /var is
// /private/var), a Windows junction, an 8.3 short name (C:\Users\RUNNER~1). git reports the real
// path, Claude Code passes the one it was given; compared unresolved, every file looked outside the
// repo and every lane let it through. Found by CI on macOS and Windows.
test('scope holds when the repo is reached through a symlink or junction', () => {
  const { dir } = repo();
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sklink-')), 'repo link');
  fs.symlinkSync(dir, link, 'junction');
  const only = ['scope', 'only', 'specs/', 'CLAUDE.md'];
  assert.ok(denied(write(link, only, 'src/main/App.java')), 'cwd and file both through the link');
  assert.ok(denied(run(dir, only, { hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(link, 'src', 'main', 'App.java') } })), 'only the file through the link');
  assert.equal(write(link, only, `${FEAT}/plan.md`), null);
  assert.equal(write(link, only, 'CLAUDE.md'), null);
  assert.ok(denied(write(link, ['scope', 'tests'], 'src/main/App.java')));
  assert.ok(denied(write(link, ['scope', 'no-tests'], 'src/test/java/AppTest.java')));
});

test('scope tests: test-writer writes test files and tasks.md only', () => {
  const { dir } = repo();
  for (const f of ['src/test/java/AppTest.java', 'tests/test_app.py', 'web/app.test.ts', 'pkg/app_test.go', `${FEAT}/tasks.md`]) {
    assert.equal(write(dir, ['scope', 'tests'], f), null, f);
  }
  for (const f of ['src/main/App.java', `${FEAT}/spec.md`, 'specs/test.md']) {
    assert.ok(denied(write(dir, ['scope', 'tests'], f)), f);
  }
});

test('scope no-tests: implementer cannot touch tests', () => {
  const { dir } = repo();
  assert.equal(write(dir, ['scope', 'no-tests'], 'src/main/App.java'), null);
  assert.ok(denied(write(dir, ['scope', 'no-tests'], 'src/test/java/AppTest.java')));
  assert.ok(denied(write(dir, ['scope', 'no-tests'], 'spec/app_spec.rb')));
});

// Flagged by a security review on 2026-10-07: implementer's lane (anything but tests) included
// .git/speckit-team/, so it could delete its own retry record or forge a verdict with Write.
test('no agent may write the guardrail state under .git/', () => {
  const { dir } = repo();
  for (const args of [['scope', 'no-tests'], ['scope', 'tests'], ['scope', 'only', 'specs/', 'CLAUDE.md']]) {
    const out = write(dir, args, '.git/speckit-team/retries/001-demo.json');
    assert.ok(denied(out), args.join(' '));
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /guardrail state/);
  }
  assert.equal(write(dir, ['scope', 'no-tests'], '.github/workflows/ci.yml'), null, '.github is not .git');
});

// Second review, same day: the guard compared the literal path, and ran after the "outside the
// repo" early exit, so spellings Windows folds together and a linked worktree's state got through.
test('the .git/ guard holds for other spellings and from a linked worktree', () => {
  const { dir, g } = repo();
  const spellings = ['.git./speckit-team/retries/001-demo.json', '.git/../.git/speckit-team/verdicts/001-demo.json'];
  if (process.platform === 'win32') spellings.push('.GIT/speckit-team/retries/001-demo.json');
  for (const f of spellings) assert.ok(denied(write(dir, ['scope', 'no-tests'], f)), f);

  const wt = `${dir}-wt`;
  g('worktree', 'add', '-q', wt);
  const out = run(wt, ['scope', 'no-tests'], {
    hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, '.git', 'speckit-team', 'retries', '001-demo.json') },
  });
  assert.ok(denied(out), 'the shared state of the main checkout, written from a worktree');
  assert.equal(write(wt, ['scope', 'no-tests'], 'src/main/Other.java'), null, 'normal work in the worktree');
});

test('.specify/test-paths adds repo-specific test patterns', () => {
  const { dir, write: w } = repo();
  assert.equal(write(dir, ['scope', 'no-tests'], 'checks/golden.txt'), null);
  w('.specify/test-paths', '# golden files\n^checks/\n');
  assert.ok(denied(write(dir, ['scope', 'no-tests'], 'checks/golden.txt')));
});

// A line that was not a valid regex crashed scope, and a crashed hook lets the write through: one typo
// in test-paths, or one written there by implementer, opened every test file to it.
test('an invalid .specify/test-paths line closes the test lanes and names the line', () => {
  const { dir, write: w, g } = repo();
  w('.specify/test-paths', '^checks/\n\n(unclosed\n');
  for (const [args, f] of [[['scope', 'no-tests'], 'src/test/java/AppTest.java'], [['scope', 'no-tests'], 'src/main/App.java'],
    [['scope', 'tests'], 'src/test/java/AppTest.java']]) {
    const out = write(dir, args, f);
    assert.ok(denied(out), `${args.join(' ')} ${f}`);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /test-paths line 3 .*\(unclosed/);
  }
  assert.equal(write(dir, ['scope', 'only', 'specs/'], `${FEAT}/plan.md`), null, 'scope only does not use test patterns');

  g('add', '-A'); g('commit', '-qm', 'bad pattern');
  pass(dir);
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'tp1' });
  w('src/test/java/AppTest.java', 'class AppTest {}\n');
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'tp1' });
  assert.ok(!decided(out));
  assert.match(out?.systemMessage ?? '', /lane check could not run.*test-paths line 3/);
});

test('gate blocks implementation until a PASS verdict on the current artifacts', () => {
  const { dir, write: w } = repo();
  const tool = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} };
  assert.match(run(dir, ['gate'], tool).hookSpecificOutput.permissionDecisionReason, /has not passed/);

  run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: 'VERDICT: FAIL' });
  assert.match(run(dir, ['gate'], tool).hookSpecificOutput.permissionDecisionReason, /was FAIL/);

  assert.match(pass(dir).systemMessage, /PASS/);
  assert.equal(run(dir, ['gate'], tool), null);

  w(`${FEAT}/tasks.md`, '- [X] T001 write test\n- [x] T002 implement\n');
  assert.equal(run(dir, ['gate'], tool), null, 'ticking checkboxes keeps the audit valid');

  w(`${FEAT}/spec.md`, '# Spec\nFR-001 must work.\nFR-002 added later.\n');
  assert.match(run(dir, ['gate'], tool).hookSpecificOutput.permissionDecisionReason, /changed after the audit/);
});

// Spec Kit's scripts accept an absolute feature_directory. The hook joined it under the repo root,
// hashed four missing files, and an audit of "<missing>" stayed valid through any edit to the spec.
test('an absolute feature_directory is the same feature: editing the spec still closes the gate', () => {
  const { dir, write: w } = repo();
  const tool = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} };
  w('.specify/feature.json', JSON.stringify({ feature_directory: path.join(dir, FEAT) }));
  pass(dir);
  assert.equal(run(dir, ['gate'], tool), null);
  w(`${FEAT}/spec.md`, '# Spec\nFR-001 must work.\nFR-002 added later.\n');
  assert.match(run(dir, ['gate'], tool)?.hookSpecificOutput?.permissionDecisionReason ?? '', /changed after the audit/);
});

// A feature_directory that is not a string crashed the gate, and a crashed gate lets the action through.
test('a feature_directory that is not a path in the repo closes the gate', () => {
  const { dir, write: w } = repo();
  pass(dir);
  for (const feature_directory of [7, [FEAT], {}, null, '', path.join(os.tmpdir(), 'elsewhere')]) {
    w('.specify/feature.json', JSON.stringify({ feature_directory }));
    const out = run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
    assert.ok(denied(out), JSON.stringify(feature_directory));
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /feature\.json/);
  }
});

test('gate on a typed /speckit-implement and on the Skill tool, nothing else', () => {
  const { dir } = repo();
  // A typed /command never reaches UserPromptSubmit or PreToolUse; it fires UserPromptExpansion.
  const prompt = (name) => run(dir, ['gate'], {
    hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: name, prompt: `/${name}`,
  });
  const skill = (s) => run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill_name: s } });
  assert.equal(prompt('speckit-plan'), null);
  assert.equal(prompt('speckit-implementation-notes'), null);
  assert.equal(prompt('speckit-implement')?.decision, 'block');
  assert.equal(prompt('speckit.implement')?.decision, 'block');
  assert.equal(skill('speckit-plan'), null);
  assert.ok(denied(skill('speckit-implement')));
  pass(dir);
  assert.equal(prompt('speckit-implement'), null);
  assert.equal(skill('speckit-implement'), null);
});

test('verdict demands a VERDICT line, once', () => {
  const { dir } = repo();
  const stop = (extra) => run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: 'looks fine', ...extra });
  assert.equal(stop()?.decision, 'block');
  assert.equal(stop({ stop_hook_active: true }), null, 'never loops');
  assert.match(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: '| x |\n\n**VERDICT: PASS**' }).systemMessage, /PASS/);
});

// Subagents report through the SubagentHandback tool, so the report is its input, not the last
// assistant message. Found live on 2026-10-06: the gate denied every handback (the agent could
// not report at all) and spec-auditor's VERDICT never reached the verdict file.
const handback = (dir, mode, message, extra = {}) => run(dir, [mode], {
  hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id: 'aud1', ...extra,
});

test('gate never blocks an agent from reporting back', () => {
  const { dir } = repo();
  assert.equal(handback(dir, 'gate', 'Blocked by the gate, nothing done.'), null);
  assert.ok(denied(run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} })),
    'real work is still gated');
});

test('verdict is read from the handback report', () => {
  const { dir } = repo();
  const tool = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} };
  const sent = handback(dir, 'verdict', '## Report\n| C1 | ... |\n\nVERDICT: PASS');
  assert.ok(!denied(sent), 'the report goes through');
  assert.match(sent.systemMessage, /recorded VERDICT: PASS/);
  assert.equal(run(dir, ['gate'], tool), null, 'and the PASS unlocks the gate');
  handback(dir, 'verdict', 'Findings...\nVERDICT: FAIL');
  assert.ok(denied(run(dir, ['gate'], tool)));
});

test('a handback without a VERDICT line is sent back once', () => {
  const { dir } = repo();
  const out = handback(dir, 'verdict', 'Here is my analysis, no verdict.');
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /VERDICT: PASS/);
  assert.equal(handback(dir, 'verdict', 'Still no verdict.'), null, 'never gags the agent: the second report goes through');
});

test('stop after a handback verdict does not demand the line again', () => {
  const { dir } = repo();
  handback(dir, 'verdict', 'VERDICT: FAIL');
  assert.equal(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'aud1', last_assistant_message: '' }), null);
});

// Raw stdin, run from inside the repo: input that is not a hook event carries no cwd of its own.
function runRaw(dir, args, text) {
  const r = spawnSync('node', [HOOK, ...args], { input: text, encoding: 'utf8', cwd: dir });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}
const MODES = [['scope', 'no-tests'], ['scope', 'tests'], ['gate'], ['gate', 'retries'], ['verdict'], ['result'], ['ends', 'APPROVED', 'REJECTED'], ['lane', 'no-tests']];
const decided = (out) => Boolean(out?.hookSpecificOutput?.permissionDecision || out?.decision);

test('malformed input never crashes a hook: no decision, and the user is told', () => {
  // A crashed hook is a non-blocking error: Claude Code lets the action through and says nothing.
  const { dir } = repo();
  for (const text of ['{not json', '', '[]', '"text"', 'null', '42']) {
    for (const args of MODES) {
      const r = runRaw(dir, args, text);
      assert.equal(r.status, 0, `${args.join(' ')} on ${JSON.stringify(text)}: ${r.stderr}`);
      assert.ok(!decided(r.out), `${args.join(' ')} on ${JSON.stringify(text)} must not decide`);
      assert.match(r.out?.systemMessage ?? '', /speckit-team: .*input/, `${args.join(' ')} on ${JSON.stringify(text)} must say so`);
    }
  }
});

test('malformed input outside a Spec Kit repo stays silent', () => {
  const { dir } = repo({ speckit: false });
  for (const args of MODES) {
    const r = runRaw(dir, args, '{not json');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.out, null);
  }
});

test('an event a mode is not wired for makes no decision', () => {
  const { dir } = repo();
  for (const payload of [{}, { hook_event_name: 'NoSuchEvent' }, { hook_event_name: 'PostToolUse', tool_name: 'Bash' }]) {
    for (const args of [['gate'], ['gate', 'retries'], ['verdict'], ['result'], ['ends', 'APPROVED', 'REJECTED'], ['lane', 'no-tests']]) {
      const out = run(dir, args, payload);
      assert.ok(!decided(out), `${args.join(' ')} on ${JSON.stringify(payload)}: ${JSON.stringify(out)}`);
    }
  }
});

// Found by the fourth spec audit on 2026-10-06: input that parses but has the wrong types, or a
// corrupt or unwritable state file, still crashed a hook, and a crashed gate fails open silently.
const stateDir = (dir) => path.join(dir, '.git', 'speckit-team');

test('mistyped fields never crash a hook', () => {
  const { dir } = repo();
  for (const file_path of [7, [], {}, null, true]) {
    const out = run(dir, ['scope', 'no-tests'], { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path } });
    assert.ok(!decided(out), `file_path ${JSON.stringify(file_path)}`);
  }
  for (const message of [7, ['VERDICT: PASS'], null]) {
    assert.ok(!decided(handback(dir, 'verdict', message)) || true); // must not throw; run() asserts exit 0
  }
  pass(dir);
  for (const agent_id of [5, {}, ['a']]) {
    run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id });
    run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id });
  }
  for (const cwd of [7, {}]) run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd });
});

test('a corrupt verdict file closes the gate and says why', () => {
  const { dir } = repo();
  fs.mkdirSync(path.join(stateDir(dir), 'verdicts'), { recursive: true });
  fs.writeFileSync(path.join(stateDir(dir), 'verdicts', '001-demo.json'), '{broken');
  const out = run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  assert.ok(denied(out), 'an unreadable verdict proves no PASS');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /unreadable/);
});

test('a corrupt agent start record makes the lane check say it could not run', () => {
  const { dir } = repo();
  fs.mkdirSync(path.join(stateDir(dir), 'agents'), { recursive: true });
  fs.writeFileSync(path.join(stateDir(dir), 'agents', 'x1.json'), '{broken');
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'x1' });
  assert.ok(!decided(out));
  assert.match(out?.systemMessage ?? '', /lane/);
});

test('an unwritable state directory never crashes a hook, and is reported', () => {
  const { dir } = repo();
  fs.writeFileSync(stateDir(dir), 'not a directory');
  const v = run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: 'VERDICT: PASS' });
  assert.match(v?.systemMessage ?? '', /speckit-team/);
  const g = run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'a9' });
  assert.ok(denied(g), 'with no readable verdict the gate stays closed');
});

test('verdict and lane also accept Stop, for an agent run as the main thread', () => {
  const { dir } = repo();
  assert.equal(run(dir, ['verdict'], { hook_event_name: 'Stop', last_assistant_message: 'no verdict' })?.decision, 'block');
  assert.match(run(dir, ['verdict'], { hook_event_name: 'Stop', last_assistant_message: 'VERDICT: PASS' }).systemMessage, /PASS/);
});

test('lane check catches writes that bypassed Edit, including via Bash', () => {
  const { dir, write: w, g } = repo();
  pass(dir);
  const start = (id) => run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: id });
  const stop = (id, rule, extra = {}) => run(dir, ['lane', rule], { hook_event_name: 'SubagentStop', agent_id: id, agent_type: 'implementer', ...extra });

  start('a1');
  w('src/main/App.java', 'class App { int x; }\n');
  w('src/test/java/AppTest.java', 'class AppTest {}\n');
  g('add', '-A'); g('commit', '-qm', 'sneaky commit');
  const out = stop('a1', 'no-tests');
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /AppTest\.java/);
  assert.doesNotMatch(out.reason, /App\.java,|main\/App\.java/);
  assert.match(stop('a1', 'no-tests', { stop_hook_active: true }).systemMessage, /WARNING/, 'second stop warns instead of looping');

  start('a2');
  w('src/main/Other.java', 'class Other {}\n');
  assert.equal(stop('a2', 'no-tests'), null);

  start('t1');
  w('src/main/Sneaky.java', 'class Sneaky {}\n');
  assert.equal(stop('t1', 'tests')?.decision, 'block', 'test-writer may not add production code');
});

test('lane check ignores files that were already dirty when the agent started', () => {
  const { dir, write: w } = repo();
  pass(dir);
  w('src/test/java/WipTest.java', 'class WipTest {}\n');
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, agent_id: 'b1' });
  assert.equal(run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'b1' }), null);
});

// Retry limit: an implementer that keeps failing would otherwise loop on minor tweaks, burning
// tokens. Each implementer report ends with RESULT: GREEN, RED or STUB; three REDs in a row on the
// same plan and tasks close the gate for implementer (gate retries) until the plan changes.
const report = (dir, message, agent_id, extra = {}) => run(dir, ['result'], {
  hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id, ...extra,
});
const implementerTool = (dir, args = ['gate', 'retries']) => run(dir, args, {
  hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'next',
});

test('three RED results in a row close the gate for implementer, and say where to go', () => {
  const { dir } = repo();
  pass(dir);
  assert.match(report(dir, 'T002 still failing.\n\nRESULT: RED', 'i1').systemMessage, /RED.*1 of 3/);
  report(dir, 'RESULT: RED', 'i2');
  assert.equal(implementerTool(dir), null, 'two REDs leave the gate open');
  assert.match(report(dir, 'RESULT: RED', 'i3').systemMessage, /3 of 3/);
  const out = implementerTool(dir);
  assert.ok(denied(out), 'the fourth attempt is stopped');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /3 times in a row.*architect/s);
  assert.equal(implementerTool(dir, ['gate']), null, 'plain gate (test-writer) does not count implementer results');
  assert.equal(handback(dir, 'gate', 'Stopped by the retry limit.', { agent_id: 'next' }) , null, 'reporting back stays open');
});

// Found live on 2026-10-07: an implementer stopped by the audit gate reported RED, and that
// attempt, which never got to work, counted toward the retry limit.
test('a RED from an implementer the audit gate stopped does not count', () => {
  const { dir } = repo();
  assert.match(report(dir, 'Blocked by the gate.\nRESULT: RED', 'g1').systemMessage, /not counted/);
  pass(dir);
  for (const id of ['i1', 'i2']) report(dir, 'RESULT: RED', id);
  assert.equal(implementerTool(dir), null, 'only the 2 REDs made after the PASS count');
});

test('GREEN resets the count, STUB leaves it alone', () => {
  const { dir } = repo();
  pass(dir);
  report(dir, 'RESULT: RED', 'i1');
  report(dir, 'RESULT: RED', 'i2');
  assert.match(report(dir, 'Stubs only.\nRESULT: STUB', 's1')?.systemMessage ?? '', /STUB/);
  assert.match(report(dir, 'RESULT: GREEN', 'i3').systemMessage, /GREEN/);
  report(dir, 'RESULT: RED', 'i4');
  report(dir, 'RESULT: RED', 'i5');
  assert.equal(implementerTool(dir), null, 'only REDs since the last GREEN count');
});

test('a revised plan or tasks resets the count', () => {
  const { dir, write: w } = repo();
  pass(dir);
  for (const id of ['i1', 'i2', 'i3']) report(dir, 'RESULT: RED', id);
  assert.ok(denied(implementerTool(dir)));
  w(`${FEAT}/tasks.md`, '- [ ] T001 write test\n- [ ] T002 implement, smaller\n');
  pass(dir);
  assert.equal(implementerTool(dir), null);
});

test('handback and stop from the same implementer count once', () => {
  const { dir } = repo();
  pass(dir);
  for (const id of ['i1', 'i2']) {
    report(dir, 'RESULT: RED', id);
    run(dir, ['result'], { hook_event_name: 'SubagentStop', agent_id: id, last_assistant_message: 'RESULT: RED' });
  }
  assert.equal(implementerTool(dir), null, 'two implementers, two REDs');
  report(dir, 'RESULT: RED', 'i3');
  assert.ok(denied(implementerTool(dir)), 'the third one closes it');
});

test('a report without a RESULT line is sent back once, then counts as RED', () => {
  const { dir } = repo();
  pass(dir);
  const out = report(dir, 'Done, I think.', 'i1');
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /RESULT: GREEN/);
  assert.match(report(dir, 'Done.', 'i1').systemMessage, /1 of 3/, 'never gags the agent, and an unproven result is not GREEN');
  assert.equal(run(dir, ['result'], { hook_event_name: 'SubagentStop', last_assistant_message: 'no line' })?.decision, 'block');
  assert.match(run(dir, ['result'], { hook_event_name: 'SubagentStop', last_assistant_message: 'no line', stop_hook_active: true }).systemMessage, /2 of 3/);
});

test('a corrupt retry record closes the implementer gate and says why', () => {
  const { dir } = repo();
  pass(dir);
  fs.mkdirSync(path.join(stateDir(dir), 'retries'), { recursive: true });
  fs.writeFileSync(path.join(stateDir(dir), 'retries', '001-demo.json'), '{broken');
  const out = implementerTool(dir);
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /unreadable/);
  assert.match(report(dir, 'RESULT: RED', 'i1').systemMessage, /unreadable/);
});

// Found live on 2026-10-07: spec-gatekeeper sent SubagentHandback({message: 'placeholder'}) in the
// same turn as a Bash call, so the main session got no verdict and launched a second gatekeeper.
test('ends: a gatekeeper report without APPROVED or REJECTED is sent back once', () => {
  const { dir } = repo();
  const ends = ['ends', 'APPROVED', 'REJECTED'];
  const out = handback(dir, 'ends', 'placeholder', { agent_id: 'gk1' });
  assert.ok(denied(run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'placeholder' }, agent_id: 'gk2' })));
  assert.equal(out, null, 'a mode with no words to require decides nothing');
  const again = run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'placeholder' }, agent_id: 'gk2' });
  assert.equal(again, null, 'never gags the agent: the second report goes through');
  assert.equal(run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: '| FR-001 | t:1 | pass |\n\n**APPROVED**' }, agent_id: 'gk3' }), null);
  assert.equal(run(dir, ends, { hook_event_name: 'SubagentStop', agent_id: 'gk3', last_assistant_message: '' }), null, 'the Stop after a good report is quiet');
  assert.equal(run(dir, ends, { hook_event_name: 'SubagentStop', last_assistant_message: 'done' })?.decision, 'block');
  assert.equal(run(dir, ends, { hook_event_name: 'SubagentStop', last_assistant_message: 'done', stop_hook_active: true }), null);
  assert.equal(run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }), null, 'other tools pass');
});
