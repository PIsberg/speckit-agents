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

function run(dir, args, payload, hook = HOOK) {
  const r = spawnSync('node', [hook, ...args], {
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
  assert.equal(write(dir, ['scope', 'protected'], '.github/workflows/x.yml'), null, 'scope protected');
  assert.equal(run(dir, ['gate'], { hook_event_name: 'UserPromptExpansion', command_name: 'speckit-implement' }), null);
  assert.equal(run(dir, ['patch'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'p1' }), null, 'patch');
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
  // Any case-insensitive file system, not only Windows: macOS's default APFS volume is one too.
  if (fs.existsSync(path.join(dir, '.GIT'))) spellings.push('.GIT/speckit-team/retries/001-demo.json');
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

// implementer's lane was "anything but tests", which included .specify/: pointing feature.json at
// another audited feature reset its retry count, and test-paths decides what its lane is.
test('implementer may not write the Spec Kit config under .specify/', () => {
  const { dir, write: w } = repo();
  for (const f of ['.specify/feature.json', '.specify/test-paths', '.specify/memory/constitution.md']) {
    const out = write(dir, ['scope', 'no-tests'], f);
    assert.ok(denied(out), f);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /\.specify\//, f);
  }
  assert.equal(write(dir, ['scope', 'no-tests'], `${FEAT}/tasks.md`), null, 'ticking tasks is still allowed');
  assert.equal(write(dir, ['scope', 'no-tests'], '.specifyx/notes.md'), null, 'only the .specify folder itself');

  pass(dir);
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'sp1' });
  w('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/000-old' }));
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'sp1' });
  assert.equal(out?.decision, 'block', 'a Bash write to .specify/ is caught at stop');
  assert.match(out.reason, /\.specify\/feature\.json/);
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
  // A second audit: one agent's second report with no work in between is the same report (#77).
  handback(dir, 'verdict', 'Findings...\nVERDICT: FAIL', { agent_id: 'aud2' });
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

// #77: a verdict describes the files the auditor read, not the files on disk when it stops. Seen in
// feature 003: an audit launched on old files finished ten hours late, and its FAIL replaced a newer
// audit's PASS on the current files.
const readAs = (dir, id) => run(dir, ['verdict'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, agent_id: id });
const gateOpen = (dir) => !denied(run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }));

test('a late verdict on files that changed after the auditor started does not replace a newer one', () => {
  const { dir, write: w } = repo();
  assert.equal(readAs(dir, 'old'), null, 'the first tool call only records where the audit started');
  w(`${FEAT}/spec.md`, '# Spec\nFR-001 must work, revised.\n');
  assert.equal(readAs(dir, 'new'), null);
  assert.match(handback(dir, 'verdict', 'VERDICT: PASS', { agent_id: 'new' }).systemMessage, /recorded VERDICT: PASS/);
  const late = handback(dir, 'verdict', 'Two HIGH findings.\nVERDICT: FAIL', { agent_id: 'old' });
  assert.ok(!denied(late), 'the report itself still goes through');
  assert.match(late.systemMessage, /VERDICT: FAIL was not recorded: .*changed after it started/);
  assert.ok(gateOpen(dir), 'the newer PASS still stands');
  assert.equal(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'old', last_assistant_message: 'VERDICT: FAIL' })?.decision, undefined,
    'its Stop neither records the stale verdict nor asks for a VERDICT line');
  assert.ok(gateOpen(dir), 'the Stop did not record it either');
});

test('a PASS on files edited during the audit does not open the gate', () => {
  const { dir, write: w } = repo();
  readAs(dir, 'aud1');
  w(`${FEAT}/tasks.md`, '- [ ] T001 write test\n- [ ] T002 implement\n- [ ] T003 unaudited\n');
  assert.match(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'aud1', last_assistant_message: 'VERDICT: PASS' }).systemMessage,
    /VERDICT: PASS was not recorded/);
  assert.ok(!gateOpen(dir));
  readAs(dir, 'aud2');
  assert.match(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'aud2', last_assistant_message: 'VERDICT: PASS' }).systemMessage,
    /recorded VERDICT: PASS/, 'a fresh audit of the same files is recorded');
  assert.ok(gateOpen(dir));
});

test('ticking a task during the audit does not make its verdict stale', () => {
  const { dir, write: w } = repo();
  readAs(dir, 'aud1');
  w(`${FEAT}/tasks.md`, '- [x] T001 write test\n- [ ] T002 implement\n');
  assert.match(handback(dir, 'verdict', 'VERDICT: PASS', { agent_id: 'aud1' }).systemMessage, /recorded VERDICT: PASS/);
});

test('an auditor resumed after its report starts a new audit from the files it reads then', () => {
  const { dir, write: w } = repo();
  readAs(dir, 'aud1');
  handback(dir, 'verdict', 'VERDICT: FAIL', { agent_id: 'aud1' });
  w(`${FEAT}/plan.md`, '# Plan\nRevised for the FAIL.\n');
  readAs(dir, 'aud1');
  assert.match(handback(dir, 'verdict', 'VERDICT: PASS', { agent_id: 'aud1' }).systemMessage, /recorded VERDICT: PASS/);
  assert.ok(gateOpen(dir));
});

test('an unreadable audit start record is treated as stale, not as a match', () => {
  const { dir } = repo();
  readAs(dir, 'aud1');
  fs.writeFileSync(path.join(stateDir(dir), 'agents', 'aud1.audit-start.json'), '{broken');
  assert.match(handback(dir, 'verdict', 'VERDICT: PASS', { agent_id: 'aud1' }).systemMessage, /not recorded/);
  assert.ok(!gateOpen(dir));
});

// Raw stdin, run from inside the repo: input that is not a hook event carries no cwd of its own.
function runRaw(dir, args, text) {
  const r = spawnSync('node', [HOOK, ...args], { input: text, encoding: 'utf8', cwd: dir });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}
const MODES = [['scope', 'no-tests'], ['scope', 'tests'], ['scope', 'protected'], ['gate'], ['gate', 'retries'], ['verdict'], ['result'], ['ends', '--record', 'APPROVED', 'REJECTED'], ['ends', 'RED', 'BLOCKED'], ['lane', 'no-tests'], ['patch']];
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
    for (const args of [['gate'], ['gate', 'retries'], ['verdict'], ['result'], ['ends', '--record', 'APPROVED', 'REJECTED'], ['ends', 'RED', 'BLOCKED'], ['lane', 'no-tests'], ['patch']]) {
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
    const prot = run(dir, ['scope', 'protected'], { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path } });
    assert.ok(!decided(prot), `scope protected, file_path ${JSON.stringify(file_path)}`);
    // The crash net also yields "no decision"; only the guard yields it without this message.
    assert.doesNotMatch(prot?.systemMessage ?? '', /internal error/, `scope protected crashed on file_path ${JSON.stringify(file_path)}`);
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

// A non-string last message crashed verdict and ends, so a report that never ended in its word was let
// through. A non-string transcript path went to readFileSync, which reads a number as a file descriptor.
test('a last message or transcript path that is not a string counts as no report', () => {
  const { dir } = repo();
  for (const extra of [{ last_assistant_message: 7 }, { last_assistant_message: ['VERDICT: PASS'] }, { agent_transcript_path: 0 }]) {
    const stop = { hook_event_name: 'SubagentStop', ...extra };
    assert.equal(run(dir, ['ends', 'APPROVED', 'REJECTED'], stop)?.decision, 'block', `ends ${JSON.stringify(extra)}`);
    assert.equal(run(dir, ['verdict'], stop)?.decision, 'block', `verdict ${JSON.stringify(extra)}`);
  }
  assert.equal(fs.existsSync(path.join(stateDir(dir), 'verdicts', '001-demo.json')), false, 'no verdict recorded');
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

// git diff against a commit that does not resolve fails, and a failed diff read as "nothing changed":
// an edited test file passed the lane check without a word.
test('a start commit git cannot find makes the lane check say it could not run', () => {
  const { dir, write: w, g } = repo();
  w('src/test/java/AppTest.java', 'class AppTest {}\n');
  g('add', '-A'); g('commit', '-qm', 'test');
  fs.mkdirSync(path.join(stateDir(dir), 'agents'), { recursive: true });
  fs.writeFileSync(path.join(stateDir(dir), 'agents', 'x2.json'), JSON.stringify({ sha: '0123456789abcdef0123456789abcdef01234567', dirty: [] }));
  w('src/test/java/AppTest.java', 'class AppTest { /* weakened */ }\n');
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'x2' });
  assert.ok(!decided(out));
  assert.match(out?.systemMessage ?? '', /lane check could not run.*0123456789ab/);

  const leak = path.join(dir, 'leak.txt');
  fs.writeFileSync(path.join(stateDir(dir), 'agents', 'x3.json'), JSON.stringify({ sha: `--output=${leak}`, dirty: [] }));
  const opt = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'x3' });
  assert.match(opt?.systemMessage ?? '', /start record is incomplete/);
  assert.equal(fs.existsSync(leak), false, 'a sha that looks like an option never reaches git');
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

// git diff detects renames by default and then names only the new path, so moving a failing test out
// of the test tree (git mv, or delete plus create) passed the lane check as one new production file.
test('lane check catches a test moved out of the test tree', () => {
  const { dir, write: w, g } = repo();
  w('src/test/java/AppTest.java', 'class AppTest {\n  void t() { assert false; }\n}\n');
  g('add', '-A'); g('commit', '-qm', 'test');
  pass(dir);
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'mv1' });
  g('mv', 'src/test/java/AppTest.java', 'src/main/AppTest.txt');
  g('commit', '-qm', 'moved');
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'mv1' });
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /src\/test\/java\/AppTest\.java/);
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

// The gatekeeper's word was kept only in the board mod's memory of the SubagentStop it saw, so a
// board that missed it (reloaded, or not loaded when verification ran) never showed verify done.
// It is now on disk next to the audit verdict, which the board reads the same way.
test('ends --record records the accepted final word for the active feature', () => {
  const { dir } = repo();
  const ends = ['ends', '--record', 'APPROVED', 'REJECTED'];
  const recorded = () => JSON.parse(fs.readFileSync(path.join(stateDir(dir), 'ends', '001-demo.json'), 'utf8'));
  run(dir, ends, { hook_event_name: 'SubagentStop', last_assistant_message: 'not done' });
  assert.equal(fs.existsSync(path.join(stateDir(dir), 'ends', '001-demo.json')), false, 'a refused report records nothing');

  run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'FR-001 untested\n\n**REJECTED**' }, agent_id: 'gk1' });
  assert.equal(recorded().word, 'REJECTED');
  assert.equal(recorded().agent_id, 'gk1');

  run(dir, ends, { hook_event_name: 'SubagentStop', agent_id: 'gk2', last_assistant_message: 'all covered\nAPPROVED' });
  assert.equal(recorded().word, 'APPROVED', 'a later run replaces the word');
});

// Found live on 2026-10-08 (issue #28): a test-writer handed back the report "placeholder" and
// nothing checked it. Its report now ends in RED or BLOCKED, checked by the same `ends` mode.
test('ends: a test-writer report without RED or BLOCKED is sent back once', () => {
  const { dir } = repo();
  const ends = ['ends', 'RED', 'BLOCKED'];
  const send = (message, agent_id) => run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id });
  assert.ok(denied(send('placeholder', 'tw1')));
  assert.equal(send('placeholder', 'tw1'), null, 'never gags the agent: the second report goes through');
  assert.equal(send('test/a.test.mjs:3 FR-001 expected 3, got undefined\n\nRED', 'tw2'), null);
  assert.equal(send('missing stubs: src/sum.mjs sum(a, b)\n\n**BLOCKED**', 'tw3'), null);
  assert.equal(run(dir, ends, { hook_event_name: 'SubagentStop', last_assistant_message: 'done' })?.decision, 'block');
});

// #74: sent to correct an existing test, test-writer adds no failing test, so the suite ends green and
// RED would contradict the run. It ends FIXED instead; the words are run as its agent file declares them.
test("test-writer's own ends commands accept FIXED for a correction that adds no test", () => {
  const { dir } = repo();
  const text = fs.readFileSync(path.join(path.dirname(HOOK), '..', 'agents', 'test-writer.md'), 'utf8');
  const commands = [...text.matchAll(/" (ends [A-Z ]+)'/g)].map((m) => m[1].split(' '));
  assert.equal(commands.length, 2, 'the SubagentHandback and the Stop entry');
  for (const [i, args] of commands.entries()) {
    const report = 'test/a.test.mjs:12 expected 6 cases, now 7; suite green\n\nFIXED';
    assert.equal(run(dir, args, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: report }, agent_id: `fx${i}` }), null, args.join(' '));
    assert.equal(run(dir, args, { hook_event_name: 'SubagentStop', agent_id: `fy${i}`, last_assistant_message: report }), null, args.join(' '));
  }
});

// The `ends` record is the gatekeeper's word, which the board's verify step reads. Without
// --record, an accepted word is not written: a test-writer's RED after a REJECTED must not replace it.
test('ends without --record leaves the recorded word alone', () => {
  const { dir } = repo();
  const file = path.join(stateDir(dir), 'ends', '001-demo.json');
  run(dir, ['ends', '--record', 'APPROVED', 'REJECTED'], { hook_event_name: 'SubagentStop', agent_id: 'gk1', last_assistant_message: 'FR-001 untested\nREJECTED' });
  run(dir, ['ends', 'RED', 'BLOCKED'], { hook_event_name: 'SubagentStop', agent_id: 'tw1', last_assistant_message: 'test/a.test.mjs:3 FR-001 fails\nRED' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).word, 'REJECTED');
});

// --- 003 fast track: `scope protected` (T001; FR-007, FR-001, US3-1, US3-4, SC-003) ---
const PROT = ['scope', 'protected'];
const OWN = ['hooks/speckit-team.mjs', 'agents/implementer.md', 'skills/speckit-team/SKILL.md', 'install.mjs', 'package.json'];
const caseInsensitiveFs = (dir) => fs.existsSync(path.join(dir, '.GIT'));
// Asserts a deny that names the repo-relative path and /speckit-team, and that disk is unchanged.
function assertProtected(dir, rel) {
  const target = path.join(dir, rel);
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  const out = write(dir, PROT, rel);
  assert.ok(denied(out), `${rel} must be denied: ${JSON.stringify(out)}`);
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  // Case and slash form are not specified: the hook may name the path in its on-disk case (macOS /var symlink, Windows short names).
  const norm = (s) => s.toLowerCase().replace(/\\/g, '/');
  assert.ok(norm(reason).includes(norm(rel)), `${rel}: reason names the path: ${reason}`);
  assert.match(reason, /\/speckit-team/, rel);
  const after = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  assert.equal(after, before, `${rel}: disk unchanged`);
}
function commitAll(r, msg) { r.g('add', '-A'); r.g('commit', '-qm', msg); return r; }
function ownRepo() {
  const r = repo();
  r.write('package.json', '{"name":"speckit-agents"}');
  for (const f of OWN.slice(0, 4)) r.write(f, 'x\n');
  return commitAll(r, 'own');
}

test('scope protected: Spec Kit, CI and agent-team paths are denied before the write (FR-007, FR-001, US3-1)', () => {
  const { dir } = repo();
  const paths = ['.specify/memory/constitution.md', '.specify/feature.json', '.specify/test-paths', 'specs/001-demo/spec.md',
    'specs/004-new/plan.md', '.claude/settings.json', '.claude/agents/x.md', '.github/workflows/test.yml', '.github/CODEOWNERS',
    '.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'Jenkinsfile', '.pre-commit-config.yaml'];
  if (caseInsensitiveFs(dir)) paths.push('.SPECIFY/memory/constitution.md');
  for (const rel of paths) assertProtected(dir, rel);
});

test('scope protected: ordinary paths are allowed (FR-001, US3-4)', () => {
  const { dir } = repo();
  assertProtected(dir, '.github/CODEOWNERS'); // the rule is live, so the allows below mean something
  for (const f of ['src/main/App.java', 'README.md', 'docs/guide.md', 'test/app.test.js', 'hooks/useThing.js', 'agents/notes.txt',
    'skills/x/notes.md', 'src/install.mjs', 'package.json', '.specifyx/notes.md', 'specsheet/x.md']) {
    assert.equal(write(dir, PROT, f), null, f);
  }
});

test('scope protected: the speckit-agents sources are protected in the speckit-agents repo only (FR-007)', () => {
  const { dir } = ownRepo();
  const pkgBefore = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  for (const rel of OWN) assertProtected(dir, rel);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), pkgBefore, 'package.json content unchanged');
  if (caseInsensitiveFs(dir)) for (const rel of ['HOOKS/speckit-team.mjs', 'PACKAGE.JSON']) assertProtected(dir, rel);
  for (const f of ['hooks/useThing.js', 'agents/notes.txt', 'src/install.mjs', 'pkg/package.json']) {
    assert.equal(write(dir, PROT, f), null, f);
  }
});

test('scope protected: the same five paths are ordinary in other repos (FR-007)', () => {
  const withPkg = (rel, text, commit = true) => () => { const r = repo(); r.write(rel, text); return commit ? commitAll(r, 'p') : r; };
  const cases = {
    'no package.json': () => repo(),
    'other name': withPkg('package.json', '{"name":"my-app"}'),
    'malformed': withPkg('package.json', '{not json'),
    'array': withPkg('package.json', '[]'),
    'name is an array': withPkg('package.json', '{"name":["speckit-agents"]}'),
    'only in pkg/': withPkg('pkg/package.json', '{"name":"speckit-agents"}'),
    'never committed': withPkg('package.json', '{"name":"speckit-agents"}', false),
    'no commit': () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skteam-'));
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      fs.mkdirSync(path.join(dir, '.specify'));
      fs.writeFileSync(path.join(dir, '.specify', 'feature.json'), '{}');
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"speckit-agents"}');
      return { dir };
    },
  };
  for (const [name, make] of Object.entries(cases)) {
    const { dir } = make();
    assertProtected(dir, '.github/workflows/test.yml'); // the rule is live in this repo too
    for (const rel of OWN) assert.equal(write(dir, PROT, rel), null, `${name}: ${rel}`);
  }
});

test('scope protected: the repo name is read from HEAD, not the working tree (decision 4)', () => {
  const { dir } = ownRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
  assertProtected(dir, 'install.mjs');
});

test('scope protected: the installed agent team outside the repo is denied (FR-007)', () => {
  const { dir } = repo();
  const checkout = path.join(path.dirname(HOOK), '..');
  const ev = (file_path) => run(dir, PROT, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path } });
  for (const p of [path.join(checkout, 'agents', 'x.md'), path.join(checkout, 'hooks', 'x.mjs'),
    path.join(checkout, 'skills', 'y', 'SKILL.md'), path.join(checkout, 'settings.json'), path.join(checkout, 'settings.local.json')]) {
    const out = ev(p);
    assert.ok(denied(out), p);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /installed agent team/, p);
    assert.ok(!fs.existsSync(p), `${p} not created`);
  }
  assert.equal(ev(path.join(os.tmpdir(), 'elsewhere.txt')), null);
});

test('scope protected: the guardrail state under .git/ is denied (FR-007)', () => {
  const { dir } = repo();
  assertProtected(dir, '.github/CODEOWNERS'); // the rule is live
  const out = write(dir, PROT, '.git/speckit-team/retries/x.json');
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /guardrail state/);
});

// ---- patch, PreToolUse: the budget stops the run (feature 003, T003) ----------------------------
const MARK = 'PATCH-CONTENT-7f3a';
const nl = (n, tag = 'l') => Array.from({ length: n }, (_, i) => `${tag}${i} ${MARK}\n`).join('');
const why = (out) => out?.hookSpecificOutput?.permissionDecisionReason ?? '';
// FR-014: a hook never echoes file content. FR-009: patch writes no verdict, retry or ends state.
function patchTool(dir, tool_name, tool_input = {}, extra = {}) {
  const out = run(dir, ['patch'], { hook_event_name: 'PreToolUse', agent_id: 'p1', agent_type: 'patcher', tool_name, tool_input, ...extra });
  assert.ok(!JSON.stringify(out ?? {}).includes(MARK), 'FR-014: output must not carry file content');
  for (const d of ['verdicts', 'retries', 'ends']) assert.ok(!fs.existsSync(path.join(stateDir(dir), d)), `FR-009: ${d}/ must not exist`);
  return out;
}
const bash = (dir, command = 'npm test', extra = {}) => patchTool(dir, 'Bash', { command }, extra);
const startFile = (dir, key = 'p1') => path.join(stateDir(dir), 'patch', `${key}.json`);
const RECORD = /\.git[\\/]speckit-team[\\/]patch[\\/]p1\.json/;
// The first call of a run records the start and is allowed.
function begin(dir, extra = {}, key = 'p1') {
  const out = patchTool(dir, 'Read', { file_path: path.join(dir, 'src/main/App.java') }, extra);
  assert.ok(!denied(out), `first call: ${why(out)}`);
  assert.ok(fs.existsSync(startFile(dir, key)), 'the first call writes the start record');
}
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const edit = (dir, rel, from, to) => {
  const ls = fs.readFileSync(path.join(dir, rel), 'utf8').split('\n');
  for (let i = from; i < to; i++) ls[i] = `x${i} ${MARK}`;
  fs.writeFileSync(path.join(dir, rel), ls.join('\n'));
};
function fresh(files = {}) {
  const r = repo();
  for (const [rel, text] of Object.entries(files)) put(r.dir, rel, text);
  if (Object.keys(files).length) commitAll(r, 'setup');
  return r;
}
const forty = () => fresh({ 'src/forty.js': nl(40, 'f') });
const okBash = (dir, msg) => { const out = bash(dir); assert.ok(!denied(out), `${msg}: ${why(out)}`); };
function overBash(dir, ...res) {
  const out = bash(dir);
  assert.ok(denied(out), 'expected a deny, got ' + JSON.stringify(out));
  for (const re of res) assert.match(why(out), re);
  return why(out);
}
const bin = () => Buffer.concat([Buffer.from(MARK), Buffer.from([0, 1, 2])]);
// A committed 10-line src/old.js with 50 lines appended, and an untracked 100-line src/wip.js.
function dirtyRepo() {
  const r = fresh({ 'src/old.js': nl(10, 'o') });
  put(r.dir, 'src/old.js', nl(10, 'o') + nl(50, 'a')); put(r.dir, 'src/wip.js', nl(100, 'w'));
  return r;
}

test('patch: 30 lines in 2 files is allowed, the 31st line is denied (FR-005, FR-006, US2-1, SC-002)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'src/a.js', nl(20, 'a')); put(dir, 'src/b.js', nl(10, 'b'));
  okBash(dir, '30 lines in 2 files');
  fs.appendFileSync(path.join(dir, 'src/b.js'), `one more ${MARK}\n`);
  overBash(dir, /31 changed production lines in 2 files/, /limit 30 lines, 2 files/, /\/speckit-team/, /uncommitted/);
});

test('patch: a modified line counts 1 (FR-005, Edge 30/31 lines)', () => {
  const { dir } = forty();
  begin(dir);
  edit(dir, 'src/forty.js', 0, 30);
  okBash(dir, '30 lines changed in place');
  edit(dir, 'src/forty.js', 30, 31);
  overBash(dir, /31 changed production lines in 1 files/);
});

test('patch: modified and new lines add up (FR-005)', () => {
  const { dir } = forty();
  begin(dir);
  edit(dir, 'src/forty.js', 0, 20); put(dir, 'src/b.js', nl(10, 'b'));
  okBash(dir, '20 changed + 10 new');
  edit(dir, 'src/forty.js', 20, 21);
  overBash(dir, /31 changed production lines in 2 files/);
});

test('patch: a file counts the larger of its insertions and deletions; deletions count (FR-005)', () => {
  const { dir } = forty();
  begin(dir);
  const orig = fs.readFileSync(path.join(dir, 'src/forty.js'), 'utf8').split('\n');
  put(dir, 'src/forty.js', nl(8, 'u') + orig.slice(5).join('\n')); // 5 lines replaced by 8: counts 8
  put(dir, 'src/b.js', nl(22, 'b'));
  okBash(dir, '8 + 22');
  fs.appendFileSync(path.join(dir, 'src/b.js'), `one more ${MARK}\n`);
  overBash(dir, /31 changed production lines in 2 files/);

  const other = forty();
  begin(other.dir);
  put(other.dir, 'src/forty.js', fs.readFileSync(path.join(other.dir, 'src/forty.js'), 'utf8').split('\n').slice(31).join('\n'));
  overBash(other.dir, /31 changed production lines in 1 files/);
});

// Owner decision 2026-10-10: .txt is documentation only under docs/ or with a documentation-style name.
test('patch: a .txt production file counts, documentation .txt does not (FR-005, owner decision 2026-10-10)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'docs/notes.txt', nl(40, 'n')); put(dir, 'README.txt', nl(40, 'r'));
  okBash(dir, 'docs/notes.txt and README.txt are docs');
  const a = fresh();
  begin(a.dir);
  put(a.dir, 'requirements.txt', nl(31, 'q'));
  overBash(a.dir, /31 changed production lines in 1 files/);
  const b = fresh();
  begin(b.dir);
  put(b.dir, 'CMakeLists.txt', nl(31, 'c'));
  overBash(b.dir, /31 changed production lines in 1 files/);
});

test('patch: a third production file is over budget (FR-005, FR-006)', () => {
  const { dir } = fresh();
  begin(dir);
  for (const f of ['a', 'b', 'c']) put(dir, `src/${f}.js`, nl(1, f));
  overBash(dir, /3 files/);
});

test('patch: tests and docs do not count, a docs folder is not a doc rule (FR-005, built-in and committed patterns)', () => {
  const { dir } = fresh({ '.specify/test-paths': '^checks/golden/\n' });
  begin(dir);
  put(dir, 'src/a.js', nl(5, 'a'));
  for (const f of ['test/a.test.js', 'src/test/java/BigTest.java', 'fixtures/data.json', 'README.md', 'docs/guide.mdx',
    'notes.rst', 'CHANGES.txt', 'guide.adoc', 'checks/golden/x.out']) put(dir, f, nl(22, 'd'));
  okBash(dir, '5 production lines plus 200 of tests and docs');
  const other = fresh();
  begin(other.dir);
  put(other.dir, 'docs/tool.mjs', nl(31, 't'));
  overBash(other.dir, /31 changed production lines in 1 files/);
});

test('patch: test patterns come from the start commit, not the working tree (FR-005, decision 14 point 3)', () => {
  const { dir } = fresh({ '.specify/test-paths': '# none\n' });
  begin(dir);
  fs.appendFileSync(path.join(dir, '.specify/test-paths'), '^src/\n');
  put(dir, 'src/big.js', nl(31, 'b'));
  overBash(dir, /31 changed production lines/);

  const other = fresh();
  put(other.dir, '.specify/test-paths', '^checks/golden/\n'); // never committed
  begin(other.dir);
  put(other.dir, 'checks/golden/x.out', nl(31, 'g'));
  overBash(other.dir, /31 changed production lines/);
});

test('patch: binary production files are not allowed (FR-005)', () => {
  const a = fresh(); begin(a.dir);
  put(a.dir, 'src/logo.png', bin());
  overBash(a.dir, /binary production files are not allowed: src\/logo\.png/);

  const b = fresh({ 'src/logo.png': bin() }); begin(b.dir);
  put(b.dir, 'src/logo.png', Buffer.concat([bin(), Buffer.from([9])]));
  overBash(b.dir, /binary/);

  const c = fresh({ 'src/logo.png': bin() }); begin(c.dir);
  fs.unlinkSync(path.join(c.dir, 'src/logo.png'));
  okBash(c.dir, 'a deleted binary is 1 file and not a binary violation');
  put(c.dir, 'src/a.js', nl(1, 'a')); put(c.dir, 'src/b.js', nl(1, 'b'));
  const reason = overBash(c.dir, /3 files/);
  assert.doesNotMatch(reason, /binary/);

  const d = fresh(); begin(d.dir);
  put(d.dir, 'test/fixtures/x.bin', bin());
  okBash(d.dir, 'a binary test fixture');
  put(d.dir, 'src/a.js', nl(31, 'a'));
  overBash(d.dir, /31 changed production lines in 1 files/);
});

test('patch: renames count by the edited lines, one file (FR-005, decision 3, research R3)', () => {
  const a = forty(); begin(a.dir);
  a.g('mv', 'src/forty.js', 'src/moved.js');
  put(a.dir, 'src/b.js', nl(29, 'b')); put(a.dir, 'src/c.js', nl(1, 'c'));
  overBash(a.dir, /30 changed production lines in 3 files/);

  const b = forty(); begin(b.dir);
  b.g('mv', 'src/forty.js', 'src/moved.js');
  put(b.dir, 'src/b.js', nl(30, 'b'));
  okBash(b.dir, 'pure rename plus 30 lines is 30 lines in 2 files');
  put(b.dir, 'src/c.js', nl(1, 'c'));
  overBash(b.dir, /31 changed production lines in 3 files/);

  const c = forty(); begin(c.dir);
  c.g('mv', 'src/forty.js', 'src/moved.js');
  edit(c.dir, 'src/moved.js', 0, 5); put(c.dir, 'src/b.js', nl(25, 'b'));
  okBash(c.dir, 'rename with 5 edited lines');
  edit(c.dir, 'src/moved.js', 5, 6);
  overBash(c.dir, /31 changed production lines in 2 files/);
});

test('patch: a pure rename of a committed binary is not binary (research R3)', () => {
  const { dir, g } = fresh({ 'src/logo.png': bin() }); begin(dir);
  g('mv', 'src/logo.png', 'src/pic.png');
  okBash(dir, 'pure binary rename');
  put(dir, 'src/a.js', nl(31, 'a'));
  const reason = overBash(dir, /31 changed production lines/);
  assert.doesNotMatch(reason, /binary/);
});

test('patch: a rename across classes counts the production side (owner rule 2026-10-09, research R3)', () => {
  const { dir, g } = fresh({ 'test/old.test.js': nl(40, 'o') }); begin(dir);
  g('mv', 'test/old.test.js', 'src/old.js');
  overBash(dir, /40 changed production lines in 1 files/);
});

test('patch: a move git does not pair is a deletion plus a new file (decision 3)', () => {
  const { dir } = fresh({ 'src/small.js': nl(3, 's') }); begin(dir);
  fs.renameSync(path.join(dir, 'src/small.js'), path.join(dir, 'src/tiny.js'));
  put(dir, 'src/c.js', nl(1, 'c'));
  overBash(dir, /7 changed production lines in 3 files/);
});

test('patch: deleting a committed production file counts its lines and 1 file (FR-005)', () => {
  const { dir } = fresh({ 'src/s.js': nl(3, 's') }); begin(dir);
  fs.unlinkSync(path.join(dir, 'src/s.js'));
  okBash(dir, 'a deletion alone');
  put(dir, 'src/a.js', nl(1, 'a')); put(dir, 'src/b.js', nl(1, 'b'));
  overBash(dir, /3 files/);
});

test('patch: committed work counts, measured from the start commit (FR-005)', () => {
  const r = fresh(); begin(r.dir);
  put(r.dir, 'src/c.js', nl(31, 'c'));
  commitAll(r, 'sneaky');
  overBash(r.dir, /31 changed production lines in 1 files/);
});

test('patch: files dirty at the start are left out of the count (FR-005, Edge, decision 13)', () => {
  const { dir } = dirtyRepo(); begin(dir);
  put(dir, 'src/b.js', nl(30, 'b'));
  okBash(dir, '30 lines in 1 file, dirty files not counted');
  put(dir, 'src/wip.js', nl(100, 'w')); // byte-identical rewrite: content decides, not time
  okBash(dir, 'identical rewrite');
  fs.appendFileSync(path.join(dir, 'src/b.js'), `one more ${MARK}\n`);
  overBash(dir, /31 changed production lines in 1 files/);
});

test('patch: a Write, Edit or MultiEdit to a file dirty at the start is denied (research R14, contract step 3)', () => {
  const { dir } = dirtyRepo(); begin(dir);
  const cases = [
    ['Write', { file_path: path.join(dir, 'src/wip.js') }, /src\/wip\.js/],
    ['Edit', { file_path: path.join(dir, 'src/old.js') }, /src\/old\.js/],
    ['MultiEdit', { file_path: path.resolve(dir, 'src/old.js') }, /src\/old\.js/],
    ['Write', { file_path: `${dir}/src/./wip.js` }, /src\/wip\.js/],
  ];
  for (const [tool, input, re] of cases) {
    const out = patchTool(dir, tool, input);
    assert.ok(denied(out), `${tool} ${input.file_path}`);
    assert.match(why(out), re); assert.match(why(out), /uncommitted/); assert.match(why(out), /\/speckit-team/);
  }
  assert.ok(!denied(patchTool(dir, 'Write', { file_path: path.join(dir, 'src/new.js') })), 'a clean file is fine');

  const first = dirtyRepo();
  const out = patchTool(first.dir, 'Write', { file_path: path.join(first.dir, 'src/wip.js') });
  assert.ok(denied(out), 'denied as the first call too');
  assert.ok(fs.existsSync(startFile(first.dir)), 'the start record is written first');
});

test('patch: a dirty-at-start file changed through Bash is named and denied (research R14)', () => {
  const a = dirtyRepo(); begin(a.dir);
  fs.appendFileSync(path.join(a.dir, 'src/wip.js'), `more ${MARK}\n`);
  overBash(a.dir, /src\/wip\.js/, /uncommitted/, /\/speckit-team/);

  const b = dirtyRepo(); begin(b.dir);
  fs.appendFileSync(path.join(b.dir, 'src/old.js'), `more ${MARK}\n`);
  overBash(b.dir, /src\/old\.js/, /uncommitted/);

  const c = dirtyRepo(); begin(c.dir);
  fs.unlinkSync(path.join(c.dir, 'src/wip.js'));
  overBash(c.dir, /src\/wip\.js/, /uncommitted/);

  const d = fresh();
  fs.appendFileSync(path.join(d.dir, '.specify/memory/constitution.md'), `one ${MARK}\n`);
  begin(d.dir);
  fs.appendFileSync(path.join(d.dir, '.specify/memory/constitution.md'), `two ${MARK}\n`);
  const reason = overBash(d.dir, /\.specify\/memory\/constitution\.md/, /uncommitted/);
  assert.doesNotMatch(reason, /protected files/);
});

test('patch: committing a file dirty at the start is caught (research R14)', () => {
  const a = dirtyRepo(); begin(a.dir);
  a.g('add', 'src/wip.js'); a.g('commit', '-qm', 'x');
  overBash(a.dir, /src\/wip\.js/);
  const b = dirtyRepo(); begin(b.dir);
  b.g('commit', '-qam', 'x');
  overBash(b.dir, /src\/old\.js/);
});

test('patch: SubagentHandback is never denied for the budget; a commit command is denied (FR-006, US2-3)', () => {
  const r = fresh(); begin(r.dir);
  put(r.dir, 'src/a.js', nl(31, 'a'));
  overBash(r.dir, /31 changed production lines/);
  assert.ok(!denied(patchTool(r.dir, 'SubagentHandback', {})), 'handback passes');
  const git = (...a) => execFileSync('git', a, { cwd: r.dir, encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  assert.ok(denied(bash(r.dir, 'git add -A && git commit -qm x')));
  assert.equal(git('rev-parse', 'HEAD'), head, 'HEAD is the start commit');
  assert.match(git('status', '--porcelain'), /src\/a\.js/);
});

test('patch: needs no active feature (FR-002)', () => {
  const { dir } = fresh();
  fs.unlinkSync(path.join(dir, '.specify/feature.json'));
  begin(dir);
  put(dir, 'src/a.js', nl(31, 'a'));
  overBash(dir, /31 changed production lines/);
});

test('patch fails closed when the budget cannot be measured (research R9)', () => {
  const setRecord = (dir, f) => { const rec = JSON.parse(fs.readFileSync(startFile(dir), 'utf8')); f(rec); fs.writeFileSync(startFile(dir), JSON.stringify(rec)); };

  const a = fresh(); begin(a.dir);
  fs.writeFileSync(startFile(a.dir), '{not json');
  overBash(a.dir, RECORD);

  const b = fresh(); begin(b.dir);
  setRecord(b.dir, (rec) => { rec.sha = 'a'.repeat(40); });
  overBash(b.dir, RECORD);

  const c = fresh({ '.specify/test-paths': '[unclosed\n' });
  const out = patchTool(c.dir, 'Bash', { command: 'ls' });
  assert.ok(denied(out), 'an invalid committed test-paths line');
  assert.match(why(out), /\[unclosed/); assert.match(why(out), /line 1/);

  const d = fresh();
  put(d.dir, '.specify/test-paths', '[unclosed\n'); // working tree only
  begin(d.dir);
  put(d.dir, 'src/a.js', nl(1, 'a'));
  okBash(d.dir, 'a bad line that was never committed');

  const e = repo();
  fs.rmSync(path.join(e.dir, '.git'), { recursive: true, force: true });
  execFileSync('git', ['init', '-q'], { cwd: e.dir, stdio: 'ignore' });
  const none = patchTool(e.dir, 'Bash', { command: 'ls' });
  assert.ok(denied(none)); assert.match(why(none), /no commit/);

  for (const dirty of [['src/wip.js'], { 'src/wip.js': 'x' }]) {
    const f = fresh(); begin(f.dir);
    setRecord(f.dir, (rec) => { rec.dirty = dirty; });
    overBash(f.dir, RECORD);
  }
});

test('patch: input it cannot key a start record by gets no decision and a message (research R9)', () => {
  const { dir } = fresh();
  for (const extra of [{ agent_id: undefined }, { agent_id: '../x' }]) {
    const out = bash(dir, 'ls', extra);
    assert.ok(!decided(out), JSON.stringify(extra));
    assert.match(out?.systemMessage ?? '', /speckit-team: patch got unusable input/);
  }
  const s = fresh();
  const key = { agent_id: undefined, session_id: 's1' };
  begin(s.dir, key, 's1');
  put(s.dir, 'src/a.js', nl(31, 'a'));
  assert.ok(denied(bash(s.dir, 'npm test', key)), 'a session_id keys the record');
});

test('patch reads committed test patterns while scope tests keeps the working tree (FR-009)', () => {
  const { dir } = fresh();
  put(dir, '.specify/test-paths', '^checks/golden/\n'); // uncommitted
  assert.equal(write(dir, ['scope', 'tests'], 'checks/golden/x.out'), null);
  begin(dir);
  put(dir, 'checks/golden/x.out', nl(31, 'g'));
  overBash(dir, /31 changed production lines/);
  assert.equal(write(dir, ['scope', 'tests'], 'checks/golden/x.out'), null, 'scope tests unchanged');
});

// ---- patch, PreToolUse: the command deny and the wholesale-restore deny (feature 003, T005) -----
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function cmdRepo(extra = {}) {
  const r = fresh({ 'test/t.js': nl(2, 't'), ...extra });
  put(r.dir, 'src/wip.js', nl(5, 'w')); // dirty at start
  begin(r.dir);
  put(r.dir, 'src/a.js', nl(1, 'a')); // within budget
  r.sha = JSON.parse(fs.readFileSync(startFile(r.dir), 'utf8')).sha;
  return r;
}

// FR-006 "no commit, no pull request", FR-007, US2-3, audit finding H1, plan.md decision 14, research R15.
test('patch: commit, push, history and pull-request commands are denied within budget (FR-006, FR-007, US2-3)', () => {
  const { dir } = cmdRepo();
  const cases = [
    ['git commit -qm x', 'git commit'], ['git add -A && git commit -qm x', 'git commit'],
    ['echo x >> .github/workflows/ci.yml && git commit -qam x && git push', 'git commit'],
    ['git push origin HEAD', 'git push'], ['git -C . commit -m x'], ['git -c user.name=x commit -m x'],
    ['git --git-dir=.git push'], ['GIT_DIR=.git git push'], ['/usr/bin/git push'],
    ['"C:\\Program Files\\Git\\cmd\\git.exe" push'], ['sh -c "git push"'], ["bash -c 'git commit -m x'"],
    ["git -c alias.x='!git push' x", 'git push'], ['git stash'], ['git switch -c other'], ['git checkout -b other'],
    ['git checkout main'], ['git branch -D x'], ['git tag v1'], ['git merge x'], ['git rebase main'],
    ['git cherry-pick abc'], ['git revert HEAD'], ['git am x.patch'], ['git update-ref refs/heads/x HEAD'],
    ['git fetch'], ['git pull'], ['git remote add o x'], ['git reset --soft HEAD~1 && git push', 'git push'],
    ['gh pr create --fill', 'gh'], ['gh api repos/x/y', 'gh'], ['gh.exe pr create', 'gh'], ['hub pull-request', 'hub'],
  ];
  for (const [command, name] of cases) {
    const out = bash(dir, command);
    assert.ok(denied(out), `${command}: expected a deny, got ${JSON.stringify(out)}`);
    assert.match(why(out), name ? new RegExp(`may not run ${esc(name)}\\b`) : /may not run /, command);
    assert.match(why(out), /\/speckit-patch/, command);
  }
});

// #72: forms the word match missed (other forge CLIs, split or variable git words, aliases, package
// publishing, a shell write to the fast track's own state), and the read-only git branch live check L5
// saw denied.
test('patch: other forges, obfuscated git words, aliases, publishing and its own state are denied (#72)', () => {
  const { dir } = cmdRepo();
  const cases = [
    ['glab mr create --fill', 'glab'], ['tea pr create', 'tea'], ['/usr/local/bin/glab api x', 'glab'],
    ['g"it" push', 'git push'], ["g'it' commit -m x", 'git commit'], ['g\\it push', 'git push'],
    ['G=git; $G push', 'git push'], ['G=git && ${G} commit -m x', 'git commit'], ['git${IFS}push', 'git push'],
    ['git -c alias.p=push p', 'git -c alias'], ['git -c alias.s=status s', 'git -c alias'],
    // From the push-time security review: an empty substitution between git and its subcommand still
    // runs git push (``git `` push`` was denied before #72), and a variable is read where it is used.
    ['git `` push', 'git push'], ['git $(true) push', 'git push'], ['git `true` commit -m x', 'git commit'],
    ['G=git; $G push; G=x', 'git push'], ['git \\\npush', 'git push'],
    // The second review: read the command as a shell does, not by guessing at words.
    ['git -c core.x="a b" push', 'git push'], ["git -c 'user.name=a;b' commit -m x", 'git commit'],
    ['for i in 1 2; do $G push; G=git; done', 'git push'], ['G=x; for i in 1 2; do $G push; G=git; done', 'git push'],
    ['git 2>/dev/null push', 'git push'], ['git >out.txt commit -m x', 'git commit'], ['git 2>&1 push', 'git push'],
    ["$'\\x67it' push", 'git push'], ["$'\\147it' push", 'git push'], ['{git,} push', 'git push'],
    ['/usr/bin/g?t push', 'git push'], ['/usr/bin/gi[t] push', 'git push'], ['X="git push"; $X', 'git push'],
    ['IFS=,; X=git,push; $X', 'git push'], ['export G=git; $G push', 'git push'], ['env -i git push', 'git push'],
    // The third review: what the reading cannot resolve is denied where a denied word would be, not skipped.
    ["G=git; sh -c '$G push'", 'git push'], ["bash -c 'g\"it\" commit -m x'", 'git commit'], ["eval 'git' 'push'", 'git push'],
    ['f() { git "$@"; }; f push', 'git with a subcommand known only at run time'],
    ['git $(echo push)', 'git push'], ['git "$SUB" -m x', 'git with a subcommand known only at run time'],
    ['$(echo git) push', 'git push'], ['"$TOOL" commit -m x', 'a program known only at run time'],
    ['${G-git} push', 'git push'], ['G=git; H=G; ${!H} push', 'git push'], ['a=(git push); "${a[@]}"', 'git push'],
    ['G=GIT; ${G,,} push', 'git push'], ['G=gitx; ${G%x} push', 'a program known only at run time'], ["bash <<< 'git push'", 'git push'],
    ['G=git; bash <<< "$G push"', 'git push'], ['git --attr-source x push', 'git push'],
    [`${Array.from({ length: 30 }, (_, k) => `V=v${k}`).join('; ')}; V=git; $V push`, 'git push'],
    [`${'$('.repeat(12)}git push${')'.repeat(12)}`, 'git push'],
    ['npm publish', 'npm publish'], ['pnpm publish --access public', 'pnpm publish'], ['yarn npm publish', 'yarn publish'],
    ['echo {} > .git/speckit-team/patch/p1.json', "a command on the fast track's state"],
    ["rm -rf '.git/speckit-team'", "a command on the fast track's state"],
    ['del .git\\speckit-team\\patch-accepted.json', "a command on the fast track's state"],
  ];
  for (const [command, name] of cases) {
    const out = bash(dir, command);
    assert.ok(denied(out), `${command}: expected a deny, got ${JSON.stringify(out)}`);
    assert.match(why(out), new RegExp(`may not run ${esc(name)}`), command);
  }
  for (const command of ['git branch --show-current', 'git branch', 'git branch -a', 'git branch --list', 'git branch -vv && npm test',
    'echo "it" "push"', 'X=1 npm test', 'npm run build', 'grep -rn publish src', 'cat package.json',
    'git log $(git rev-parse HEAD) --oneline', 'git diff `git merge-base HEAD main`',
    // Input the shell reading cannot make sense of gets no deny and, above all, no crash.
    '/usr/bin/g[ push', "echo 'unterminated", 'echo $(( 1 + 2 )) ${', 'echo {{,}']) {
    const out = bash(dir, command);
    assert.equal(out, null, `${command}: expected null, got ${JSON.stringify(out)}`);
  }
  for (const command of ['git branch x', 'git branch -D x', 'git branch -m y', 'git branch --show-current && git branch x']) {
    assert.match(why(bash(dir, command)), /may not run git branch/, command);
  }
});

// FR-011, FR-014, constitution II, spec audit finding M5, plan.md decision 16 point 3, research R7.
test('patch: wholesale restores are denied, naming restores and read-only commands pass (FR-011, FR-014, M5)', () => {
  const { dir, sha } = cmdRepo();
  const wip = fs.readFileSync(path.join(dir, 'src/wip.js'));
  const cases = [
    ['git reset --hard', 'git reset --hard'], [`git reset --hard ${sha}`], ['git reset -q --hard'],
    ['git clean -fd', 'git clean'], ['git clean -n'], ['git -C . clean -fdx'],
    ['git checkout -- .', 'git checkout -- .'], [`git checkout ${sha} -- .`],
    ['git restore .', 'git restore .'], ['git restore -- .'], ['git restore --staged --worktree .'],
    ['git restore ..'], ['git restore src'], ['git restore src/'], ['git checkout -- src'],
    ["git restore 'src/*.js'"], ["git checkout -- 'src/?.js'"], ["git restore ':/'"],
    ['git restore --pathspec-from-file=list.txt'], ['git checkout -- src/wip.js'], ['git restore src/wip.js'],
    [`git checkout ${sha} -- src/a.js src/wip.js`], ['npm test && git restore .'], ['sh -c "git checkout -- ."'],
  ];
  for (const [command, name] of cases) {
    const out = bash(dir, command);
    assert.ok(denied(out), `${command}: expected a deny, got ${JSON.stringify(out)}`);
    assert.match(why(out), name ? new RegExp(`may not run ${esc(name)}`) : /may not run /, command);
    assert.match(why(out), /uncommitted/, command);
    assert.match(why(out), /ESCALATE/, command);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'src/wip.js')), wip, `${command}: the hook ran nothing`);
  }
  for (const command of ['git stash', 'git stash push -- src/a.js']) {
    const out = bash(dir, command);
    assert.ok(denied(out), command);
    assert.match(why(out), /may not run git stash/, command);
  }
  const allowed = [
    'git status --short', 'git diff', 'git log --oneline -3', 'git show HEAD', 'git mv src/a.js src/b.js',
    'git add src/a.js', `git checkout ${sha} -- src/a.js`, 'git checkout -- src/a.js', 'git restore src/a.js',
    `git restore --source=${sha} src/a.js`, `git restore -s ${sha} src/a.js`, `git reset --soft ${sha}`,
    'git reset -- src/a.js', 'git checkout -- src/a.js && npm test', 'npm test', 'node --test',
    'grep -rn commit src', 'echo committed', 'ls highlights', 'cat github.txt', 'echo reset --hard',
  ];
  for (const command of allowed) {
    const out = bash(dir, command);
    assert.equal(out, null, `${command}: expected null, got ${JSON.stringify(out)}`);
  }
});

test('patch: a non-string command gets no command deny and does not crash (constitution II)', () => {
  const { dir } = cmdRepo();
  for (const tool_input of [{ command: ['git', 'push'] }, { command: 42 }, {}]) {
    const out = patchTool(dir, 'Bash', tool_input);
    assert.ok(!denied(out), `${JSON.stringify(tool_input)}: ${why(out)}`);
  }
  // Guard: the deny exists at all, so the lines above are not green because the step is absent.
  assert.match(why(bash(dir, 'git push')), /may not run git push/);
});

test('patch: a Write mentioning git push is not a command; the deny holds with only a session_id (FR-006)', () => {
  const { dir } = cmdRepo();
  const out = patchTool(dir, 'Write', { file_path: path.join(dir, 'src/n.js'), content: 'git push\n' });
  assert.ok(!denied(out), why(out));
  const s = fresh();
  const key = { agent_id: undefined, session_id: 's1' };
  begin(s.dir, key, 's1');
  const d = bash(s.dir, 'git push', key);
  assert.ok(denied(d), JSON.stringify(d));
  assert.match(why(d), /may not run git push/);
});

// ---- patch, end of run: the end check, the accepted record, the restore allowance (feature 003, T007) ----
const CONST = '.specify/memory/constitution.md';
const CI = '.github/workflows/ci.yml';
const acceptedFile = (dir) => path.join(stateDir(dir), 'patch-accepted.json');
const record = (dir) => (fs.existsSync(acceptedFile(dir)) ? JSON.parse(fs.readFileSync(acceptedFile(dir), 'utf8')) : null);
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
const startSha = (dir) => JSON.parse(fs.readFileSync(startFile(dir), 'utf8')).sha;
const s12 = (dir) => startSha(dir).slice(0, 12);
const STOP = { hook_event_name: 'SubagentStop', agent_id: 'p1', agent_type: 'patcher' };
const HAND = { hook_event_name: 'PreToolUse', agent_id: 'p1', agent_type: 'patcher', tool_name: 'SubagentHandback', tool_input: { message: 'Fixed.\nDONE' } };
function endEv(dir, base, extra = {}) {
  const out = run(dir, ['patch'], { ...base, ...extra });
  assert.ok(!JSON.stringify(out ?? {}).includes(MARK), 'FR-014: output must not carry file content');
  if (fs.existsSync(acceptedFile(dir))) assert.ok(!fs.readFileSync(acceptedFile(dir), 'utf8').includes(MARK), 'FR-014: record carries no content');
  return out;
}
const stop = (dir, extra) => endEv(dir, STOP, extra);
const hand = (dir, extra) => endEv(dir, HAND, extra);
const msg = (out) => out?.systemMessage ?? '';
const noStop = (out, label = '') => { assert.ok(out?.decision !== 'block' && !denied(out), `${label} expected no block: ${JSON.stringify(out)}`); };
function isBlocked(out, ...res) {
  assert.equal(out?.decision, 'block', `expected a block, got ${JSON.stringify(out)}`);
  for (const re of res) assert.match(out.reason, re);
}
function isDenied(out, ...res) {
  assert.ok(denied(out), `expected a handback deny, got ${JSON.stringify(out)}`);
  for (const re of res) assert.match(why(out), re);
}
const co = (dir, rel) => new RegExp(`git checkout ${s12(dir)} -- ${esc(rel)}`);

test('patch end: protected file changed with fs blocks stop and denies handback, until restored (FR-007, US2-2, FR-014)', () => {
  const { dir } = fresh();
  begin(dir);
  fs.appendFileSync(path.join(dir, CONST), 'extra\n');
  const re = [new RegExp(esc(CONST)), co(dir, CONST)];
  isBlocked(stop(dir), ...re);
  isBlocked(stop(dir, { stop_hook_active: true }), ...re);
  isDenied(hand(dir), ...re);
  assert.equal(record(dir), null);
  git(dir, 'checkout', startSha(dir), '--', CONST);
  noStop(stop(dir), 'after restore');
});

test('patch end: a new workflow says delete, a deleted workflow gives its checkout (FR-007, US2-2)', () => {
  const { dir } = fresh({ [CI]: 'on: push\n' });
  begin(dir);
  put(dir, '.github/workflows/new.yml', 'on: push\n');
  isBlocked(stop(dir), /new\.yml/, /delet/i);
  fs.rmSync(path.join(dir, CI));
  isBlocked(stop(dir), co(dir, CI));
  assert.equal(record(dir), null);
});

test('patch end: the hook changes nothing in the repo (FR-007, constitution II)', () => {
  const { dir } = fresh();
  begin(dir);
  fs.appendFileSync(path.join(dir, CONST), 'extra\n');
  const head = git(dir, 'rev-parse', 'HEAD'), status = git(dir, 'status', '--porcelain');
  isBlocked(stop(dir));
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(git(dir, 'status', '--porcelain'), status);
  assert.equal(head.trim(), startSha(dir));
  assert.match(fs.readFileSync(path.join(dir, CONST), 'utf8'), /extra\n$/);
});

test('patch end: a protected file dirty at the start is not named, blocked on or touched (US3-3)', () => {
  const { dir } = fresh();
  fs.appendFileSync(path.join(dir, CONST), 'mine\n');
  const before = fs.readFileSync(path.join(dir, CONST));
  begin(dir);
  const out = stop(dir);
  noStop(out);
  assert.ok(!JSON.stringify(out ?? {}).includes('constitution'), JSON.stringify(out));
  assert.match(msg(out), /of 30 production lines/, 'the end check ran and accepted');
  assert.ok(record(dir) && !record(dir).files.includes(CONST), 'accepted, without the dirty file');
  noStop(hand(dir));
  assert.deepEqual(fs.readFileSync(path.join(dir, CONST)), before);
});

test('patch end: a dirty-at-start file changed through a shell command is message A, never a restore (R14, Edge)', () => {
  const { dir } = fresh();
  put(dir, 'src/wip.js', nl(100, 'w'));
  begin(dir);
  fs.appendFileSync(path.join(dir, 'src/wip.js'), 'more\n');
  for (const out of [stop(dir), hand(dir)]) {
    noStop(out);
    assert.match(msg(out), /src\/wip\.js/);
    assert.match(msg(out), /uncommitted/);
    assert.match(msg(out), /\/speckit-team/);
    assert.ok(!/git checkout/.test(JSON.stringify(out)), 'no restore command for it');
  }
  assert.equal(record(dir), null);
  assert.match(fs.readFileSync(path.join(dir, 'src/wip.js'), 'utf8'), /more\n$/);
});

test('patch end: dirty work swept into a commit is blocked, then measured without it (H1, R14, FR-002)', () => {
  const { dir } = fresh();
  put(dir, 'src/wip.js', nl(100, 'w'));
  const wip = fs.readFileSync(path.join(dir, 'src/wip.js'));
  begin(dir);
  put(dir, 'src/a.js', nl(3, 'a'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'x');
  const re = new RegExp(`git reset --soft ${s12(dir)}`);
  isBlocked(stop(dir), re);
  isBlocked(stop(dir, { stop_hook_active: true }), re);
  isDenied(hand(dir), re);
  git(dir, 'reset', '--soft', startSha(dir));
  const out = stop(dir);
  noStop(out);
  assert.match(msg(out), /3 of 30 production lines, 1 of 2 production files/);
  assert.deepEqual(record(dir).files, ['src/a.js']);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'src/wip.js')), wip);
});

test('patch end: a commit within budget is blocked at any size, the working tree matching the start (H1, decision 14)', () => {
  const { dir } = fresh({ [CI]: 'on: push\n' });
  begin(dir);
  fs.appendFileSync(path.join(dir, CI), 'x: 1\n');
  git(dir, 'commit', '-qam', 'ci');
  git(dir, 'checkout', startSha(dir), '--', CI);
  const re = new RegExp(`git reset --soft ${s12(dir)}`);
  isBlocked(stop(dir), re);
  isBlocked(stop(dir, { stop_hook_active: true }), re);
  isDenied(hand(dir), re);
  assert.equal(record(dir), null);
  git(dir, 'reset', '--soft', startSha(dir));
  noStop(stop(dir));
  const rec = record(dir);
  assert.ok(rec, 'accepted once nothing is committed');
  assert.ok(!rec.files.includes(CI));
});

test('patch end: a plain 3-line commit is blocked (FR-006, US2-2)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'src/a.js', nl(3, 'a'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'x');
  isBlocked(stop(dir), new RegExp(`git reset --soft ${s12(dir)}`));
  assert.equal(record(dir), null);
});

test('patch end: test patterns edited during the run are protected (FR-007, decision 13)', () => {
  const { dir } = fresh({ '.specify/test-paths': '^checks/\n' });
  begin(dir);
  fs.appendFileSync(path.join(dir, '.specify/test-paths'), '^src/\n');
  put(dir, 'src/a.js', nl(3, 'a'));
  isBlocked(stop(dir), /\.specify\/test-paths/, co(dir, '.specify/test-paths'));
  assert.equal(record(dir), null);
});

test('patch end: over budget and uncommitted is message A, no block, no record (FR-006, US1-3)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'src/a.js', nl(31, 'a'));
  for (const out of [stop(dir), hand(dir)]) {
    noStop(out);
    for (const re of [/31 changed production lines/, /limit 30 lines, 2 files/, /uncommitted/, /\/speckit-team/]) assert.match(msg(out), re);
  }
  assert.equal(record(dir), null);
});

test('patch end: over budget and committed is blocked until reset, then message A (FR-006, H1)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'src/a.js', nl(31, 'a'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'x');
  const re = new RegExp(`git reset --soft ${s12(dir)}`);
  isBlocked(stop(dir), re);
  isBlocked(stop(dir, { stop_hook_active: true }), re);
  isDenied(hand(dir), re);
  git(dir, 'reset', '--soft', startSha(dir));
  const out = stop(dir);
  noStop(out);
  assert.match(msg(out), /31 changed production lines/);
  assert.equal(record(dir), null);
});

const GOOD = {
  files: ['docs/a.md', 'src/a.js', 'src/main/App.java', 'src/main/Main.java', 'test/a.test.js'],
  untracked: ['docs/a.md', 'src/a.js', 'test/a.test.js'],
};
function acceptedRun() {
  const { dir } = fresh();
  put(dir, 'src/wip.js', nl(100, 'w'));
  begin(dir);
  put(dir, 'src/a.js', nl(3, 'a')); put(dir, 'test/a.test.js', nl(5, 't')); put(dir, 'docs/a.md', nl(5, 'd'));
  git(dir, 'mv', 'src/main/App.java', 'src/main/Main.java');
  return dir;
}

test('patch end: within budget writes the accepted record, on stop and on handback (FR-002, US1-1)', () => {
  const dir = acceptedRun();
  for (const ev of [stop, hand]) {
    const out = ev(dir);
    noStop(out);
    assert.match(msg(out), /3 of 30 production lines, 2 of 2 production files/);
    const { at, ...rest } = record(dir);
    assert.equal(typeof at, 'string');
    assert.deepEqual(rest, { key: 'p1', sha: startSha(dir), ...GOOD, lines: 3, filesTouched: 2 });
    fs.rmSync(acceptedFile(dir));
  }
});

test('patch end: every patch call removes the accepted record (research R15)', () => {
  const stale = (d) => { fs.mkdirSync(stateDir(d), { recursive: true }); fs.writeFileSync(acceptedFile(d), '{"stale":true}'); };
  const a = acceptedRun();
  stop(a);
  assert.ok(record(a), 'accepted');
  patchTool(a, 'Read', { file_path: path.join(a, 'src/a.js') });
  assert.equal(record(a), null, 'a later call removes it');

  const b = fresh().dir; begin(b);
  fs.appendFileSync(path.join(b, CONST), 'x\n'); stale(b);
  isBlocked(stop(b));
  assert.equal(record(b), null, 'blocked stop');

  const c = fresh().dir; begin(c);
  put(c, 'src/a.js', nl(31, 'a')); stale(c);
  noStop(stop(c));
  assert.equal(record(c), null, 'over budget');

  const d = fresh().dir; begin(d); stale(d);
  assert.equal(stop(d, { agent_id: 'other' }), null);
  assert.equal(record(d), null, 'no start record for the key');

  const e = fresh().dir; begin(e); stale(e);
  fs.writeFileSync(startFile(e), '{not json');
  const out = stop(e);
  noStop(out);
  assert.match(msg(out), /fast-track check could not run/);
  assert.equal(record(e), null, 'unusable start record');
});

test('patch end: no start record for the key exits with no output', () => {
  const { dir } = fresh();
  assert.equal(stop(dir), null);
  assert.equal(hand(dir), null);
});

// research R7 (narrowed 2026-10-10), plan.md decision 16 point 3, audit finding M5.
test('patch restore allowance: only naming a protected file still to be restored passes (R7, M5, FR-011)', () => {
  const { dir } = fresh();
  put(dir, 'src/wip.js', nl(5, 'w'));
  begin(dir);
  put(dir, 'src/a.js', nl(31, 'a'));
  fs.appendFileSync(path.join(dir, CONST), 'x\n');
  put(dir, '.github/workflows/new.yml', 'on: push\n');
  const sha = startSha(dir);
  const snap = () => ['src/wip.js', 'src/a.js', CONST].map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  const before = snap();
  const allowed = [
    `git checkout ${sha} -- ${CONST}`, `git restore ${CONST}`, `git restore --source=${sha} ${CONST}`,
    'rm .github/workflows/new.yml', 'rm -f -- .github/workflows/new.yml',
  ];
  for (const c of allowed) { const out = bash(dir, c); assert.ok(!denied(out), `${c} must be allowed: ${why(out)}`); }
  const refused = [
    `git checkout ${sha} -- ${CONST} src/a.js`, 'git restore .specify', `git checkout ${sha} -- '.specify/*'`,
    `git checkout ${sha} -- src/wip.js`, 'rm src/wip.js', 'rm src/a.js', 'rm -rf .github', `rm ${CONST}`,
    `git reset --soft ${sha}`, `git reset --hard ${sha}`, 'git restore .',
    `git checkout ${sha} -- x && git commit -qm y`, 'rm a; rm b', 'git checkout $(echo x)',
  ];
  for (const c of refused) assert.ok(denied(bash(dir, c)), `${c} must be denied`);
  assert.ok(denied(patchTool(dir, 'Write', { file_path: path.join(dir, CONST), content: 'x' })), 'Write denied');
  assert.deepEqual(snap(), before);

  const c2 = fresh().dir; begin(c2);
  put(c2, 'src/a.js', nl(31, 'a'));
  git(c2, 'add', '-A'); git(c2, 'commit', '-qm', 'x');
  assert.ok(!denied(bash(c2, `git reset --soft ${startSha(c2)}`)), 'undoing a commit is allowed');

  const c3 = fresh().dir; begin(c3);
  put(c3, 'src/a.js', nl(31, 'a'));
  assert.ok(denied(bash(c3, `git checkout ${startSha(c3)} -- src/a.js`)), 'nothing to restore');
});

test('patch end: the speckit-agents sources are protected in that repo only (decision 4)', () => {
  const files = (name) => ({ 'package.json': `{"name":"${name}"}`, 'install.mjs': 'x\n' });
  const own = fresh(files('speckit-agents')).dir;
  begin(own);
  fs.appendFileSync(path.join(own, 'install.mjs'), 'y\n');
  isBlocked(stop(own), /install\.mjs/, co(own, 'install.mjs'));
  const app = fresh(files('my-app')).dir;
  begin(app);
  fs.appendFileSync(path.join(app, 'install.mjs'), 'y\n');
  const out = stop(app);
  noStop(out);
  assert.match(msg(out), /1 of 30 production lines, 1 of 2 production files/);
});

test('patch end: package.json is protected by the name at the start commit (owner 2026-10-09)', () => {
  const own = fresh({ 'package.json': '{"name":"speckit-agents"}', 'install.mjs': 'x\n' }).dir;
  begin(own);
  fs.writeFileSync(path.join(own, 'package.json'), '{"name":"x"}');
  fs.appendFileSync(path.join(own, 'install.mjs'), 'y\n');
  const re = [/package\.json/, /install\.mjs/, co(own, 'package.json'), co(own, 'install.mjs')];
  isBlocked(stop(own), ...re);
  git(own, 'commit', '-qam', 'x');
  isBlocked(stop(own), ...re);

  const app = fresh({ 'package.json': '{"name":"my-app"}\n' }).dir;
  begin(app);
  fs.appendFileSync(path.join(app, 'package.json'), '\n');
  const out = stop(app);
  noStop(out);
  assert.match(msg(out), /1 of 30 production lines, 1 of 2 production files/);
});

// ---- patch, end of run: the installed team is hashed at the start and checked at the end (feature 003, T009) ----
// The copied hook's team directory is <tmp>/cfg, so the cases change files there, never the checkout.
function teamCopy() {
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skteam-cfg-')), 'cfg');
  const files = { 'agents/patcher.md': '# patcher\n', 'agents/implementer.md': '# implementer\n', 'skills/speckit-patch/SKILL.md': '# skill\n', 'settings.json': '{}' };
  for (const [rel, text] of Object.entries(files)) put(cfg, rel, text);
  fs.mkdirSync(path.join(cfg, 'hooks'), { recursive: true });
  const hook = path.join(cfg, 'hooks', 'speckit-team.mjs');
  fs.copyFileSync(HOOK, hook);
  return hook;
}
const cfgOf = (hook) => path.dirname(path.dirname(hook));
const tcall = (dir, hook, base, extra = {}) => {
  const out = run(dir, ['patch'], { ...base, ...extra }, hook);
  assert.ok(!JSON.stringify(out ?? {}).includes(MARK), 'FR-014: output must not carry file content');
  return out;
};
const tstop = (dir, hook, extra) => tcall(dir, hook, STOP, extra);
const thand = (dir, hook, message = 'Fixed.\nDONE') => tcall(dir, hook, HAND, { tool_input: { message } });
const tpre = (dir, hook, tool_name, tool_input) => tcall(dir, hook, { hook_event_name: 'PreToolUse', agent_id: 'p1', agent_type: 'patcher', tool_name, tool_input });
// A run through the copied hook: first call, then a new 1-line src/a.js (within budget).
function teamRun({ prepare } = {}) {
  const hook = teamCopy();
  if (prepare) prepare(cfgOf(hook));
  const { dir } = fresh();
  const out = tpre(dir, hook, 'Read', { file_path: path.join(dir, 'src/main/App.java') });
  assert.ok(!denied(out), `first call: ${why(out)}`);
  assert.ok(fs.existsSync(startFile(dir)), 'the first call writes the start record');
  put(dir, 'src/a.js', nl(1, 'a'));
  return { dir, hook, cfg: cfgOf(hook) };
}
const cfgFile = (cfg, rel) => path.join(cfg, ...rel.split('/'));
const rel2 = (rel) => new RegExp(esc(rel).replace(/\//g, '[\\\\/]'));
// Message C of contracts/hook-cli.md: FAILED, never a block, names each path, no checkout command.
function isFailed(out, ...paths) {
  noStop(out, 'a team change must not block');
  const m = msg(out);
  for (const re of [/installed agent team/, /FAILED/, /commits nothing/, ...paths.map(rel2)]) assert.match(m, re);
  assert.doesNotMatch(m, /git checkout/);
}

const TEAM_CHANGES = [
  ['agents/patcher.md', (cfg) => fs.appendFileSync(cfgFile(cfg, 'agents/patcher.md'), `${MARK}\n`)],
  ['skills/evil/SKILL.md', (cfg) => put(cfg, 'skills/evil/SKILL.md', `# evil ${MARK}\n`)],
  ['agents/implementer.md', (cfg) => fs.rmSync(cfgFile(cfg, 'agents/implementer.md'))],
  ['hooks/speckit-team.mjs', (cfg) => fs.appendFileSync(cfgFile(cfg, 'hooks/speckit-team.mjs'), '\n// changed during the run\n')],
  ['settings.json', (cfg) => fs.writeFileSync(cfgFile(cfg, 'settings.json'), '{"x":1}')],
  ['settings.local.json', (cfg) => fs.writeFileSync(cfgFile(cfg, 'settings.local.json'), '{}')],
];

test('patch team: any changed team file ends the run FAILED, never blocks, writes no record (FR-007, FR-011, FR-014, US3-2, SC-003, M2)', () => {
  for (const [rel, change] of TEAM_CHANGES) {
    const { dir, hook, cfg } = teamRun();
    change(cfg);
    isFailed(tstop(dir, hook), rel);
    assert.equal(record(dir), null, `${rel}: no record after stop`);
    isFailed(tstop(dir, hook, { stop_hook_active: true }), rel);
    assert.equal(record(dir), null, `${rel}: no record after stop_hook_active`);
    isFailed(thand(dir, hook), rel);
    assert.equal(record(dir), null, `${rel}: no record after DONE`);
    isFailed(thand(dir, hook, 'Over budget.\nESCALATE'), rel);
    assert.equal(record(dir), null, `${rel}: no record after ESCALATE`);
  }
});

test('patch team: putting the original back lets the run be accepted (FR-007, FR-011)', () => {
  for (const rel of ['agents/patcher.md', 'settings.json']) {
    const { dir, hook, cfg } = teamRun();
    const f = cfgFile(cfg, rel);
    const original = fs.readFileSync(f);
    TEAM_CHANGES.find(([r]) => r === rel)[1](cfg);
    isFailed(tstop(dir, hook), rel);
    fs.writeFileSync(f, original);
    noStop(tstop(dir, hook), rel);
    assert.ok(record(dir), `${rel}: the record is written once the original is back`);
  }
  const { dir, hook, cfg } = teamRun();
  put(cfg, 'settings.local.json', '{}');
  isFailed(tstop(dir, hook), 'settings.local.json');
  fs.rmSync(cfgFile(cfg, 'settings.local.json'));
  noStop(tstop(dir, hook));
  assert.ok(record(dir), 'a created file removed again is accepted');
});

test('patch team: two changed team files are both named in message C (FR-011, M2)', () => {
  const { dir, hook, cfg } = teamRun();
  TEAM_CHANGES[4][1](cfg); TEAM_CHANGES[0][1](cfg);
  isFailed(tstop(dir, hook), 'settings.json', 'agents/patcher.md');
  assert.equal(record(dir), null);
});

test('patch team: a protected repo file still blocks, and is the only file the block names (FR-007, M2)', () => {
  const { dir, hook, cfg } = teamRun();
  TEAM_CHANGES[0][1](cfg);
  fs.appendFileSync(path.join(dir, CONST), 'extra\n');
  const out = tstop(dir, hook);
  isBlocked(out, new RegExp(esc(CONST)), co(dir, CONST));
  assert.doesNotMatch(out.reason, /agents[\\/]patcher\.md/);
  assert.equal(record(dir), null);
  git(dir, 'checkout', startSha(dir), '--', CONST);
  isFailed(tstop(dir, hook), 'agents/patcher.md');
  assert.equal(record(dir), null);
});

test('patch team: only agents/, hooks/, skills/<name>/ and the two settings files are hashed (research R16)', () => {
  const { dir, hook, cfg } = teamRun({ prepare: (c) => { put(c, 'projects/x.jsonl', '{}'); put(c, 'skills/x/sub/deep.md', 'deep'); } });
  const { team } = JSON.parse(fs.readFileSync(startFile(dir), 'utf8'));
  assert.match(String(team?.['agents/patcher.md']), /^[0-9a-f]{64}$/, 'a team file is hashed');
  assert.deepEqual(Object.keys(team ?? {}).filter((k) => /^projects[\/]|sub[\/]/.test(k)), []);
  put(cfg, 'projects/x.jsonl', '{"changed":1}'); put(cfg, 'skills/x/sub/deep.md', 'changed');
  noStop(tstop(dir, hook));
  assert.ok(record(dir), 'a change outside the hashed set is accepted');
});

test('patch team: the start record holds a hash per team file, null for a missing settings file (FR-007, research R16)', () => {
  const { dir } = teamRun();
  const { team } = JSON.parse(fs.readFileSync(startFile(dir), 'utf8'));
  assert.ok(team && typeof team === 'object' && !Array.isArray(team), 'team is an object');
  for (const rel of ['agents/patcher.md', 'agents/implementer.md', 'skills/speckit-patch/SKILL.md', 'hooks/speckit-team.mjs', 'settings.json']) assert.match(String(team[rel]), /^[0-9a-f]{64}$/, rel);
  assert.equal(team['settings.local.json'], null);
});

test('patch team: over budget with a team change opens no restore allowance, and message C comes first (research R7, M2)', () => {
  const { dir, hook, cfg } = teamRun();
  put(dir, 'src/a.js', nl(31, 'a'));
  TEAM_CHANGES[0][1](cfg);
  const out = tpre(dir, hook, 'Bash', { command: `git checkout ${startSha(dir)} -- src/a.js` });
  assert.ok(denied(out), 'denied: ' + JSON.stringify(out));
  isFailed(tstop(dir, hook), 'agents/patcher.md');
  assert.equal(record(dir), null);
});

test('patch team: a config dir with no skills/ and no settings.json is hashed and accepted (FR-011)', () => {
  const { dir, hook } = teamRun({ prepare: (cfg) => { fs.rmSync(path.join(cfg, 'skills'), { recursive: true }); fs.rmSync(path.join(cfg, 'settings.json')); } });
  const { team } = JSON.parse(fs.readFileSync(startFile(dir), 'utf8'));
  assert.ok(team && typeof team === 'object', 'the start record has team');
  assert.equal(team['settings.json'], null);
  noStop(tstop(dir, hook));
  assert.ok(record(dir), 'accepted');
});

test('patch team: an unusable team in the start record is denied and the end check cannot run (FR-011, data-model)', () => {
  for (const team of [[], { 'agents/x.md': 'zz' }]) {
    const { dir, hook } = teamRun();
    const f = startFile(dir);
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), team }));
    const out = tpre(dir, hook, 'Bash', { command: 'npm test' });
    assert.ok(denied(out), `${JSON.stringify(team)}: expected a deny, got ${JSON.stringify(out)}`);
    assert.match(why(out), RECORD);
    const end = tstop(dir, hook);
    assert.match(msg(end), /fast-track check could not run/);
    assert.equal(record(dir), null);
  }
});
