// Run: npm test (or node --test "test/*.test.mjs")
// End to end: the real Claude Code, the team installed by install.mjs into a throwaway config dir,
// and a fake Anthropic API on localhost instead of a model. Unit tests feed the hook JSON by hand,
// so they cannot show that Claude Code fires it; these do, at no cost and with no login.
// Tier 1 answers every model request with an error and stops the session at the first one, so a
// guardrail that holds before any model call shows as zero model requests. Tier 2 scripts the model
// instead: it asks for the tool calls an agent would make, and the tests read the hook's decision
// in the next request and the state files under .git/speckit-team/. A full pipeline run with real
// models is #46.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Spawned without a shell, as in install.test.mjs: a missing claude, or an npm-installed claude.cmd,
// reports these skipped, not passed, except in CI, where SPECKIT_REQUIRE_CLAUDE=1 makes them fail.
const noClaude = spawnSync('claude', ['--version']).status === 0 || process.env.SPECKIT_REQUIRE_CLAUDE === '1' ? false : 'no claude executable on PATH';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'ignore' });

// A Spec Kit repo as far as the gate can tell: an active feature, its four fingerprinted files, and
// a speckit-implement skill for the typed command to expand. The team goes into its own config dir.
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-'));
  const repo = path.join(tmp, 'repo');
  const cfg = path.join(tmp, 'config');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  // The scripted agent runs plain git under the machine's global config; pin the bytes it checks out.
  git(repo, 'config', 'core.autocrlf', 'false');
  write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/001-x' }));
  write('.specify/memory/constitution.md', '# Constitution\n');
  write('specs/001-x/spec.md', '# Spec\n');
  write('specs/001-x/plan.md', '# Plan\n');
  write('specs/001-x/tasks.md', '- [ ] T001 a\n');
  write('.claude/skills/speckit-implement/SKILL.md', '---\nname: speckit-implement\ndescription: Implement the tasks.\n---\nReply with the word implementing.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  execFileSync(process.execPath, [path.join(ROOT, 'install.mjs'), '--claude-dir', cfg], { stdio: 'ignore' });
  // SC-004: with the installed hook replaced by a no-op, the fast track's e2e cases must fail.
  if (process.env.SPECKIT_E2E_NO_HOOK === '1') fs.writeFileSync(path.join(cfg, 'hooks', 'speckit-team.mjs'), 'process.exit(0);\n');
  return { repo, cfg, hook: path.join(cfg, 'hooks', 'speckit-team.mjs'), write };
}

// Records a PASS for the files as they are now, through the installed verdict hook itself.
function recordPass({ repo, hook }) {
  execFileSync(process.execPath, [hook, 'verdict'], {
    cwd: repo,
    input: JSON.stringify({ hook_event_name: 'SubagentStop', cwd: repo, agent_id: 'e2e', last_assistant_message: 'No findings.\nVERDICT: PASS' }),
  });
}

// The child's environment: the throwaway config dir and the fake API, and nothing inherited that
// could change how Claude Code behaves. A parent Claude Code session passes its own CLAUDE_* and
// CLAUDE_CODE_* variables down, and a developer's CLAUDE_CODE_FORK_SUBAGENT would decide whether
// agents run in the background. Any other credential could send a request somewhere real.
function fakeEnv(cfg, port, extra = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC_|AI_AGENT$)/.test(k))),
    CLAUDE_CONFIG_DIR: cfg,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_API_KEY: 'sk-ant-e2e-fake',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    ...extra,
  };
}

// Runs `claude -p <prompt>` against a fake API and returns its exit code, its JSON result (if it
// finished on its own) and how many model requests reached the fake API.
async function claude({ repo, cfg }, prompt) {
  let modelRequests = 0;
  let child;
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
      modelRequests++;
      // The question is answered: the prompt got past the gate. Stop rather than sit out retries.
      child?.kill();
    }
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fake API for speckit-agents e2e tests' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = fakeEnv(cfg, server.address().port);
  try {
    return await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      child = spawn('claude', ['-p', prompt, '--output-format', 'json'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        let result = null;
        try { result = JSON.parse(out); } catch { /* killed, or not JSON */ }
        resolve({ code, result, modelRequests, out, err });
      });
    });
  } finally {
    server.close();
  }
}

const show = (r) => `exit ${r.code}, ${r.modelRequests} model requests\nstdout: ${r.out.slice(0, 1500)}\nstderr: ${r.err.slice(0, 800)}`;

function assertBlocked(r, reason) {
  assert.equal(r.modelRequests, 0, `the prompt reached the model:\n${show(r)}`);
  assert.equal(r.result?.num_turns, 0, show(r));
  assert.equal(r.result?.total_cost_usd, 0, show(r));
  assert.match(r.out, reason, show(r));
}

test('a typed /speckit-implement is stopped before any model call until spec-auditor has passed', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  assertBlocked(await claude(s, '/speckit-implement'), /spec-auditor has not passed specs\/001-x/);
});

test('with a PASS on the current files, /speckit-implement goes through to the model', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  const r = await claude(s, '/speckit-implement');
  // Without this case, a fake API Claude Code never called would pass the test above too.
  assert.ok(r.modelRequests >= 1, `the gate blocked a passed audit:\n${show(r)}`);
});

test('an edit to spec.md after the PASS stops /speckit-implement again', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  s.write('specs/001-x/spec.md', '# Spec\n\nFR-001 changed after the audit.\n');
  assertBlocked(await claude(s, '/speckit-implement'), /changed after the audit of specs\/001-x/);
});

// Tier 2: a scripted fake model. Each request is told apart by a marker in its first user message:
// the -p prompt for the main session, the Agent call's prompt for a subagent. A sender's nth request
// gets its nth scripted reply, then plain text that ends the turn. Auto mode's safety classifier
// gets an answer that allows the action. Built against Claude Code 2.1.296's request format.
const MAIN = 'e2e main session';
const say = (text) => ({ text });
const call = (name, input) => ({ name, input });
const agent = (type, marker) => call('Agent', { description: type, subagent_type: type, prompt: `${marker}: go`, run_in_background: false });

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '');
// Every string a request shows the model, tool results and hook feedback included.
const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const shown = (req) => strings(req?.messages ?? []).join('\n');
// What the last tool call got back, as the next request shows it to the model.
const lastToolResult = (req) => (req?.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
  .filter((p) => p?.type === 'tool_result').at(-1);
const lastResult = (req) => strings(lastToolResult(req) ?? []).join('\n');
const lastResultIsError = (req) => lastToolResult(req)?.is_error === true;

function reply(res, stream, { text, name, input }, id) {
  const block = name ? { type: 'tool_use', id, name, input } : { type: 'text', text };
  const stop = name ? 'tool_use' : 'end_turn';
  const message = { id: `msg_${id}`, type: 'message', role: 'assistant', model: 'claude-fake', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...message, content: [block], stop_reason: stop }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('message_start', { message: { ...message, content: [], stop_reason: null } });
  event('content_block_start', { index: 0, content_block: name ? { ...block, input: {} } : { type: 'text', text: '' } });
  event('content_block_delta', { index: 0, delta: name ? { type: 'input_json_delta', partial_json: JSON.stringify(input) } : { type: 'text_delta', text } });
  event('content_block_stop', { index: 0 });
  event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  event('message_stop', {});
  res.end();
}

// Runs `claude -p MAIN` with the script as the model. Returns every request each sender made, the
// stream-json events and the exit code. bypassPermissions by default: a guardrail that does not fire
// then lets the action through, instead of a permission check stopping it in the hook's place.
async function session({ repo, cfg }, script, { permissionMode = 'bypassPermissions', env = {} } = {}) {
  const senders = Object.keys(script);
  const requests = Object.fromEntries(senders.map((k) => [k, []]));
  let ids = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'fake API for speckit-agents e2e tests' } }));
        return;
      }
      let b = {};
      try { b = JSON.parse(body); } catch { /* answered like an unknown sender */ }
      let next = say('done');
      if (textOf(b.system).includes('security monitor')) next = say('<severity>0</severity>');
      else {
        const first = textOf((b.messages ?? []).find((m) => m.role === 'user')?.content);
        const who = senders.find((k) => first.includes(k));
        if (who) next = script[who][requests[who].push(b) - 1] ?? next;
      }
      reply(res, b.stream, next, `toolu_e2e_${++ids}`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      const child = spawn('claude', ['-p', MAIN, '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode],
        { cwd: repo, env: fakeEnv(cfg, server.address().port, env), stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      const timer = setTimeout(() => child.kill(), 90_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        const events = out.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
        resolve({ code, events, requests, out, err });
      });
    });
  } finally {
    server.close();
  }
}

const state = ({ repo }, ...rel) => JSON.parse(fs.readFileSync(path.join(repo, '.git', 'speckit-team', ...rel), 'utf8'));
const story = (r) => `exit ${r.code}; requests: ${Object.entries(r.requests).map(([k, v]) => `${k} ${v.length}`).join(', ')}\n`
  + `stderr: ${r.err.slice(0, 600)}\nlast events: ${r.out.split('\n').slice(-6).join('\n').slice(0, 2500)}`;
const spec = (s) => path.join(s.repo, 'specs', '001-x', 'spec.md');

// Counts an implementer RED the way its Stop hook does, so a test can start just below the limit.
function recordRed({ repo, hook }, id) {
  execFileSync(process.execPath, [hook, 'result'], {
    cwd: repo,
    input: JSON.stringify({ hook_event_name: 'SubagentStop', cwd: repo, agent_id: id, last_assistant_message: 'RESULT: RED' }),
  });
}

// The skill launches every agent with run_in_background: false and takes the report from the Agent
// call: its result under -p, as here, or in an interactive 2.1.296 session the agent's hand-back
// message, which the result points to. These two pin the Claude Code behaviour that rule depends on
// (#64): -p has fork subagents off, an interactive session has them on, and
// CLAUDE_CODE_FORK_SUBAGENT sets either.
const agentSchema = (req) => req?.tools?.find((t) => t.name === 'Agent')?.input_schema?.properties ?? {};
const launch = (r) => r.events.find((e) => e.type === 'system' && e.subtype === 'task_started');

test('Agent with run_in_background: false runs the agent in the foreground and returns its report', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, { [MAIN]: [agent('spec-auditor', 'e2e auditor')], 'e2e auditor': [say('No findings.\nVERDICT: PASS')] });
  assert.equal(agentSchema(r.requests[MAIN][0]).run_in_background?.type, 'boolean', story(r));
  assert.equal(launch(r)?.is_backgrounded, false, story(r));
  assert.match(lastResult(r.requests[MAIN][1]), /VERDICT: PASS/, story(r));
});

test('with fork subagents on, as in an interactive session, the Agent tool has no foreground option', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, { [MAIN]: [agent('spec-auditor', 'e2e auditor')], 'e2e auditor': [say('No findings.\nVERDICT: PASS')] },
    { env: { CLAUDE_CODE_FORK_SUBAGENT: '1' } });
  assert.equal(agentSchema(r.requests[MAIN][0]).run_in_background, undefined, story(r));
  // run_in_background: false was sent all the same, and ignored.
  assert.equal(launch(r)?.is_backgrounded, true, story(r));
  assert.doesNotMatch(lastResult(r.requests[MAIN][1]), /VERDICT: PASS/, story(r));
});

// This repository commits the setting as project settings (#70), so a session here launches agents
// in the foreground even where fork subagents would be on.
test("a project's .claude/settings.json env turns fork subagents off and brings the foreground back", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  s.write('.claude/settings.json', JSON.stringify({ env: { CLAUDE_CODE_FORK_SUBAGENT: '0' } }));
  const r = await session(s, { [MAIN]: [agent('spec-auditor', 'e2e auditor')], 'e2e auditor': [say('No findings.\nVERDICT: PASS')] },
    { env: { CLAUDE_CODE_FORK_SUBAGENT: '1' } });
  assert.equal(agentSchema(r.requests[MAIN][0]).run_in_background?.type, 'boolean', story(r));
  assert.equal(launch(r)?.is_backgrounded, false, story(r));
  assert.match(lastResult(r.requests[MAIN][1]), /VERDICT: PASS/, story(r));
});

test("architect's and product-owner's scope hooks deny a Write outside their lanes", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const write = (rel) => call('Write', { file_path: path.join(s.repo, ...rel.split('/')), content: 'export const greet = () => 1;\n' });
  const r = await session(s, {
    [MAIN]: [agent('architect', 'e2e architect'), agent('product-owner', 'e2e product-owner')],
    'e2e architect': [write('src/greet.js')],
    'e2e product-owner': [write('src/owner.js')],
  });
  assert.ok(lastResultIsError(r.requests['e2e architect'][1]), story(r));
  assert.match(lastResult(r.requests['e2e architect'][1]), /architect may only write specs\/, CLAUDE\.md; src\/greet\.js is outside that lane/, story(r));
  assert.match(lastResult(r.requests['e2e product-owner'][1]), /product-owner may only write specs\/, \.specify\/feature\.json; src\/owner\.js is outside that lane/, story(r));
  assert.equal(fs.existsSync(path.join(s.repo, 'src')), false, 'a Write went through');
});

test('test-writer may not write production code, and its report must end in RED, BLOCKED or FIXED', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  const r = await session(s, {
    [MAIN]: [agent('test-writer', 'e2e test-writer')],
    'e2e test-writer': [
      call('Write', { file_path: path.join(s.repo, 'src', 'greet.js'), content: 'export const greet = () => 1;\n' }),
      call('SubagentHandback', { message: 'placeholder' }),
      call('SubagentHandback', { message: 'T001 fails on its assertion.\nRED' }),
    ],
  }, { permissionMode: 'auto' });
  assert.match(lastResult(r.requests['e2e test-writer'][1]), /test-writer writes only test files and ticks tasks\.md; src\/greet\.js is production code/, story(r));
  assert.ok(lastResultIsError(r.requests['e2e test-writer'][2]), story(r));
  assert.match(lastResult(r.requests['e2e test-writer'][2]), /Your report must end with a final line that is exactly one of: RED, BLOCKED, FIXED/, story(r));
  assert.equal(fs.existsSync(path.join(s.repo, 'src')), false, 'the Write went through');
});

test('implementer may not change tests, and its lane check catches a test written through Bash', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  const r = await session(s, {
    [MAIN]: [agent('implementer', 'e2e implementer')],
    'e2e implementer': [
      call('Write', { file_path: path.join(s.repo, 'test', 'greet.test.js'), content: 'test.skip("greet");\n' }),
      call('Bash', { command: 'mkdir -p test && echo 1 > test/other.test.js', description: 'Write a file' }),
      say('T004 passes.\nRESULT: GREEN'),
    ],
  });
  assert.match(lastResult(r.requests['e2e implementer'][1]), /implementer may not change tests: test\/greet\.test\.js is part of the executable spec/, story(r));
  assert.ok(fs.existsSync(path.join(s.repo, 'test', 'other.test.js')), `the Bash call never ran:\n${story(r)}`);
  assert.match(shown(r.requests['e2e implementer'][3]), /Lane check: implementer changed files outside its lane: test\/other\.test\.js/, story(r));
});

test("reports through SubagentHandback: implementer's is counted, spec-gatekeeper's must end in its word", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  const r = await session(s, {
    [MAIN]: [agent('implementer', 'e2e implementer'), agent('spec-gatekeeper', 'e2e gatekeeper')],
    'e2e implementer': [call('SubagentHandback', { message: 'T004 done.' }), call('SubagentHandback', { message: 'T004 still fails.\nRESULT: RED' })],
    'e2e gatekeeper': [call('SubagentHandback', { message: 'FR-001 has no test.' }), call('SubagentHandback', { message: 'FR-001 has no test.\nREJECTED' })],
  }, { permissionMode: 'auto' });
  assert.match(lastResult(r.requests['e2e implementer'][1]), /`RESULT: GREEN`, `RESULT: RED` or `RESULT: STUB`\. Add it and send the report again/, story(r));
  assert.equal(state(s, 'retries', '001-x.json').red.length, 1, story(r));
  assert.match(lastResult(r.requests['e2e gatekeeper'][1]), /Your report must end with a final line that is exactly one of: APPROVED, REJECTED/, story(r));
  assert.equal(state(s, 'ends', '001-x.json').word, 'REJECTED', story(r));
});

test("test-writer's gate denies its first tool call until spec-auditor has passed", { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const script = { [MAIN]: [agent('test-writer', 'e2e test-writer')], 'e2e test-writer': [call('Read', { file_path: spec(s) })] };
  const before = await session(s, script);
  assert.match(lastResult(before.requests['e2e test-writer'][1]), /Implementation gate: spec-auditor has not passed specs\/001-x/, story(before));
  recordPass(s);
  const after = await session(s, script);
  assert.doesNotMatch(lastResult(after.requests['e2e test-writer'][1]), /Implementation gate/, story(after));
  assert.match(lastResult(after.requests['e2e test-writer'][1]), /# Spec/, story(after));
});

test('Claude calling the speckit-implement skill is denied until spec-auditor has passed', { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const script = { [MAIN]: [call('Skill', { skill: 'speckit-implement' })] };
  const before = await session(s, script);
  assert.match(lastResult(before.requests[MAIN][1]), /Implementation gate: spec-auditor has not passed specs\/001-x/, story(before));
  recordPass(s);
  const after = await session(s, script);
  assert.ok(after.requests[MAIN].length >= 2, story(after));
  assert.doesNotMatch(lastResult(after.requests[MAIN][1]), /Implementation gate/, story(after));
});

test("spec-auditor's Stop asks once for a missing VERDICT line, then records the verdict", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [agent('spec-auditor', 'e2e auditor')],
    'e2e auditor': [say('No findings.'), say('Two HIGH findings.\nVERDICT: FAIL')],
  });
  assert.match(shown(r.requests['e2e auditor'][1]), /End your report with a final line that is exactly `VERDICT: PASS` or `VERDICT: FAIL`/, story(r));
  const v = state(s, 'verdicts', '001-x.json');
  assert.equal(v.verdict, 'FAIL', story(r));
  assert.equal(v.feature, 'specs/001-x');
});

// #77: the PreToolUse entry on every tool records the files the audit starts from. Without it, the
// second audit's PASS would be stamped on the spec it edited mid-run and replace the first one.
test("spec-auditor's verdict is not recorded when the files changed after its first tool call", { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const first = await session(s, { [MAIN]: [agent('spec-auditor', 'e2e auditor')], 'e2e auditor': [call('Read', { file_path: spec(s) }), say('No findings.\nVERDICT: PASS')] });
  const recorded = state(s, 'verdicts', '001-x.json');
  assert.equal(recorded.verdict, 'PASS', story(first));
  const second = await session(s, {
    [MAIN]: [agent('spec-auditor', 'e2e auditor')],
    'e2e auditor': [call('Bash', { command: 'echo "FR-002 added mid-audit." >> specs/001-x/spec.md', description: 'Edit the spec' }), say('No findings.\nVERDICT: FAIL')],
  });
  assert.match(fs.readFileSync(spec(s), 'utf8'), /FR-002/, `the Bash call never ran:\n${story(second)}`);
  assert.deepEqual(state(s, 'verdicts', '001-x.json'), recorded, `the stale FAIL replaced the PASS:\n${story(second)}`);
});

test("spec-auditor's report through SubagentHandback is refused once without a VERDICT line, then recorded", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  // Auto mode is where Claude Code gives a subagent the SubagentHandback tool.
  const r = await session(s, {
    [MAIN]: [agent('spec-auditor', 'e2e auditor')],
    'e2e auditor': [call('SubagentHandback', { message: 'No findings.' }), call('SubagentHandback', { message: 'No findings.\nVERDICT: PASS' })],
  }, { permissionMode: 'auto' });
  assert.ok(lastResultIsError(r.requests['e2e auditor'][1]), story(r));
  assert.match(lastResult(r.requests['e2e auditor'][1]), /`VERDICT: PASS` or `VERDICT: FAIL`\. Add it and send the report again/, story(r));
  assert.equal(state(s, 'verdicts', '001-x.json').verdict, 'PASS', story(r));
  // A handed-back report reaches the main session as a message of its own, not as the tool result.
  assert.match(shown(r.requests[MAIN][1]), /VERDICT: PASS/, story(r));
});

test("implementer's RED is counted at its Stop, and the third in a row stops the next implementer", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  recordRed(s, 'e2e-red-1');
  recordRed(s, 'e2e-red-2');
  const r = await session(s, {
    [MAIN]: [agent('implementer', 'e2e implementer one'), agent('implementer', 'e2e implementer two')],
    'e2e implementer one': [say('T001 still fails: expected 3, got 2.\nRESULT: RED')],
    'e2e implementer two': [call('Read', { file_path: spec(s) })],
  });
  // Only two REDs were recorded by hand: the limit is reached only if Claude Code ran the Stop hook.
  assert.match(lastResult(r.requests['e2e implementer two'][1]), /Retry limit: implementer reported RESULT: RED 3 times in a row on specs\/001-x/, story(r));
});

test("spec-gatekeeper's report must end in APPROVED or REJECTED, and the word is recorded", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [agent('spec-gatekeeper', 'e2e gatekeeper')],
    'e2e gatekeeper': [say('FR-001 has a test that fails without it.\nAPPROVED, pending CI'), say('FR-001 has a test that fails without it.\nAPPROVED')],
  });
  assert.match(shown(r.requests['e2e gatekeeper'][1]), /Your report must end with a final line that is exactly one of: APPROVED, REJECTED/, story(r));
  assert.equal(state(s, 'ends', '001-x.json').word, 'APPROVED', story(r));
});

test("test-writer's Stop: the lane check catches production code written through Bash, and the report must end in RED, BLOCKED or FIXED", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  const r = await session(s, {
    [MAIN]: [agent('test-writer', 'e2e test-writer')],
    'e2e test-writer': [call('Bash', { command: 'echo 1 > prod.js', description: 'Write a file' }), say('T001 fails on its assertion.')],
  });
  assert.ok(fs.existsSync(path.join(s.repo, 'prod.js')), `the Bash call never ran:\n${story(r)}`);
  assert.match(shown(r.requests['e2e test-writer'][2]), /Lane check: test-writer changed files outside its lane: prod\.js/, story(r));
  assert.match(shown(r.requests['e2e test-writer'][2]), /Your report must end with a final line that is exactly one of: RED, BLOCKED, FIXED/, story(r));
});

// 003 fast track: patcher under `claude -p`. "The record" is .git/speckit-team/patch-accepted.json.
const wfile = (s, rel, content) => call('Write', { file_path: path.join(s.repo, ...rel.split('/')), content });
const head = ({ repo }) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const record = (s) => state(s, 'patch-accepted.json');

test("patcher's scope hook denies a protected Write and allows a production one (FR-006, US2-1)", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [wfile(s, '.specify/memory/constitution.md', 'changed\n'), wfile(s, 'src/fix.js', 'export const fix = 1;\n'), say('Fixed.\nDONE')],
  });
  assert.ok(lastResultIsError(r.requests['e2e patcher'][1]), story(r));
  assert.match(lastResult(r.requests['e2e patcher'][1]), /patcher may not write \.specify\/memory\/constitution\.md: it is a protected path/, story(r));
  assert.equal(fs.readFileSync(path.join(s.repo, '.specify', 'memory', 'constitution.md'), 'utf8'), '# Constitution\n');
  assert.ok(fs.existsSync(path.join(s.repo, 'src', 'fix.js')), story(r));
  assert.deepEqual(record(s).files, ['src/fix.js'], story(r));
});

test('patcher may not commit; the end check still accepts its work (FR-005, SC-003)', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const start = head(s);
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [wfile(s, 'src/fix.js', 'export const fix = 1;\n'),
      call('Bash', { command: 'git add -A && git commit -qm fix', description: 'Commit' }), say('Fixed.\nDONE')],
  });
  assert.match(lastResult(r.requests['e2e patcher'][2]), /may not run git commit/, story(r));
  assert.equal(head(s), start, 'a commit went through');
  assert.ok(record(s).files.includes('src/fix.js'), story(r));
});

test("over budget, patcher's next tool call is denied and nothing is accepted (FR-007, US3-1)", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const start = head(s);
  const big = Array.from({ length: 31 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [wfile(s, 'src/big.js', big), call('Bash', { command: 'git status --short', description: 'Status' }), say('Over budget.\nESCALATE')],
  });
  assert.match(lastResult(r.requests['e2e patcher'][2]), /Fast-track budget exceeded: 31 changed production lines in 1 files/, story(r));
  assert.equal(head(s), start);
  assert.equal(execFileSync('git', ['status', '--short', '--', 'src/big.js'], { cwd: s.repo, encoding: 'utf8' }).trim(), '?? src/big.js');
  assert.equal(fs.existsSync(path.join(s.repo, '.git', 'speckit-team', 'patch-accepted.json')), false, 'a record was written');
});

test("a protected file changed through Bash blocks patcher's stop until it is restored (US2-3)", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const sha = head(s);
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [call('Bash', { command: 'echo x >> .specify/memory/constitution.md', description: 'Change' }), say('Done.\nDONE'),
      call('Bash', { command: `git checkout ${sha} -- .specify/memory/constitution.md`, description: 'Restore' }), say('Restored.\nDONE')],
  });
  assert.match(shown(r.requests['e2e patcher'][2]), /Fast track: patcher changed protected files: \.specify\/memory\/constitution\.md/, story(r));
  assert.equal(fs.readFileSync(path.join(s.repo, '.specify', 'memory', 'constitution.md'), 'utf8'), '# Constitution\n');
  assert.ok(!record(s).files.includes('.specify/memory/constitution.md'), story(r));
});

test("patcher's report must end in DONE, FAILED or ESCALATE (FR-002, US3-2)", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [call('SubagentHandback', { message: 'placeholder' }), call('SubagentHandback', { message: 'Fixed.\nDONE' })],
  }, { permissionMode: 'auto' });
  assert.ok(lastResultIsError(r.requests['e2e patcher'][1]), story(r));
  assert.match(lastResult(r.requests['e2e patcher'][1]), /exactly one of: DONE, FAILED, ESCALATE/, story(r));
});
