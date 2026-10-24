// Run: npm test (or node --test "test/*.test.mjs")
// End to end: the real Claude Code, the team installed by install.mjs into a throwaway config dir,
// and a fake Anthropic API on localhost instead of a model. Unit tests feed the hook JSON by hand,
// so they cannot show that Claude Code fires it; these do, at no cost and with no login.
// Tier 1 answers every model request with an error and stops the session at the first one, so a
// guardrail that holds before any model call shows as zero model requests. Tier 2 scripts the model
// instead: it asks for the tool calls an agent would make, and the tests read the hook's decision
// in the next request and the state files under .git/speckit-team/. A full pipeline run with real
// models is #46.
import { describe, test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Each test has its own repo, config dir and fake API on a port of its own, and spends nearly all its
// time waiting on a claude process, so they run a few at a time: `test` queues them, and the suite at
// the end of the file runs the queue. One at a time, this file took 148 s of the suite's 231 on
// Windows (2026-10-11). SPECKIT_E2E_CONCURRENCY=1 runs them one by one again.
const queued = [];
const test = (...args) => { queued.push(args); };
const CONCURRENCY = Number(process.env.SPECKIT_E2E_CONCURRENCY) || Math.max(1, Math.min(4, os.availableParallelism() - 1));
// Spawned without a shell, as in install.test.mjs: a missing claude, or an npm-installed claude.cmd,
// reports these skipped, not passed, except in CI, where SPECKIT_REQUIRE_CLAUDE=1 makes them fail.
const noClaude = spawnSync('claude', ['--version']).status === 0 || process.env.SPECKIT_REQUIRE_CLAUDE === '1' ? false : 'no claude executable on PATH';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'ignore' });

// A Spec Kit repo as far as the gate can tell: an active feature, its four fingerprinted files, and
// a speckit-implement skill for the typed command to expand. The team goes into its own config dir.
function setup() {
  // The long path: on the Windows runner the temp dir is an 8.3 name (RUNNER~1), and Claude Code
  // refuses an isolation worktree whose path git spells differently (2.1.293, #40).
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-')));
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

// A scripted reply is one block ({ text } or { name, input }) or an array of them, sent as one
// response in that order: several tool calls in one message, as a model makes them.
function reply(res, stream, step, id) {
  const blocks = (Array.isArray(step) ? step : [step]).map(({ text, name, input }, i) => (name
    ? { type: 'tool_use', id: `${id}_${i}`, name, input } : { type: 'text', text }));
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
  const message = { id: `msg_${id}`, type: 'message', role: 'assistant', model: 'claude-fake', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...message, content: blocks, stop_reason: stop }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('message_start', { message: { ...message, content: [], stop_reason: null } });
  blocks.forEach((block, index) => {
    const tool = block.type === 'tool_use';
    event('content_block_start', { index, content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' } });
    event('content_block_delta', { index, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    event('content_block_stop', { index });
  });
  event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  event('message_stop', {});
  res.end();
}

// Runs `claude -p MAIN` with the script as the model. Returns every request each sender made, the
// stream-json events and the exit code. bypassPermissions by default: a guardrail that does not fire
// then lets the action through, instead of a permission check stopping it in the hook's place.
async function session({ repo, cfg }, script, { permissionMode = 'bypassPermissions', env = {}, prompt = MAIN } = {}) {
  const senders = Object.keys(script);
  const requests = Object.fromEntries(senders.map((k) => [k, []]));
  // When each sender's requests arrived, in ms: shows whether two agents ran at the same time.
  const times = Object.fromEntries(senders.map((k) => [k, []]));
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
        if (who) { times[who].push(Date.now()); next = script[who][requests[who].push(b) - 1] ?? next; }
      }
      reply(res, b.stream, next, `toolu_e2e_${++ids}`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      const child = spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode],
        { cwd: repo, env: fakeEnv(cfg, server.address().port, env), stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      const timer = setTimeout(() => child.kill(), 90_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        const events = out.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
        resolve({ code, events, requests, times, out, err });
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

// The skill commits the approved spec or plan in the same message that launches the next agent, to
// save the main session a request (each one re-reads its whole context). That holds only if Claude
// Code runs the calls of one message in order, so the agent starts on the committed tree.
test('a Bash call and an Agent call in one message run in order: the agent starts after the commit', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  s.write('specs/001-x/plan.md', '# Plan\n\nApproved.\n');
  const commit = call('Bash', { command: 'git -c user.name=t -c user.email=t@example.invalid commit -qam "e2e plan approved"', description: 'Commit the approved plan' });
  const r = await session(s, {
    [MAIN]: [[commit, agent('architect', 'e2e architect')]],
    'e2e architect': [call('Bash', { command: 'git log -1 --format=%s', description: 'Show the last commit' })],
  });
  assert.match(lastResult(r.requests['e2e architect'][1]), /e2e plan approved/, story(r));
});

// #40: the skill builds [P] slices side by side by putting each step's agents in one message as several
// foreground Agent calls, implementers with isolation: "worktree". That holds only if Claude Code runs
// such calls at the same time. Each agent here waits 5 s in a Bash call: both are inside it together, and
// the main session's next request comes only once both have reported. Needs no hook of the team.
test('two foreground Agent calls in one message run side by side, with and without worktree isolation (#40)', { skip: noClaude, timeout: 240_000 }, async () => {
  for (const isolation of [undefined, 'worktree']) {
    const s = setup();
    const wait = call('Bash', { command: 'node -e "setTimeout(() => {}, 5000)"', description: 'Wait five seconds' });
    const launch = (marker) => call('Agent', { description: marker, subagent_type: 'general-purpose', prompt: `${marker}: go`, run_in_background: false, ...(isolation ? { isolation } : {}) });
    const r = await session(s, {
      [MAIN]: [[launch('e2e left'), launch('e2e right')]],
      'e2e left': [wait, say('Left done.')],
      'e2e right': [wait, say('Right done.')],
    });
    const [left, right] = [r.times['e2e left'], r.times['e2e right']];
    const ms = (times) => times.map((t) => t - r.times[MAIN][0]).join(', ');
    const label = `isolation ${isolation ?? 'none'}, request times in ms after the main session's first: main ${ms(r.times[MAIN])}; left ${ms(left)}; right ${ms(right)}\n${story(r)}`;
    assert.ok(left.length >= 2 && right.length >= 2, label);
    assert.ok(Math.max(left[0], right[0]) < Math.min(left[1], right[1]), `both agents start before either finishes its wait: ${label}`);
    assert.ok(r.times[MAIN][1] > Math.max(left[1], right[1]), `the main session waits for both: ${label}`);
    const started = r.events.filter((e) => e.type === 'system' && e.subtype === 'task_started' && /^e2e (left|right)$/.test(e.description ?? ''));
    assert.deepEqual(started.map((e) => e.is_backgrounded), [false, false], label);
  }
});

// The agents with one capability declare one `tools:` line (test/prompt-caching.test.mjs) because Claude
// Code sends an agent's tools in its frontmatter order, unsorted, ahead of the system prompt: agents
// with the same line share that prefix in the prompt cache, those with a shuffled one do not. The
// agent's own body is a system block of its own, behind a cache breakpoint, so text written into the
// body is never shared with another agent. Measured 2026-10-16 on 2.1.301. Needs no hook of the team.
test("Claude Code sends an agent's tools in frontmatter order and its body as its own cached system block", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  fs.writeFileSync(path.join(s.cfg, 'agents', 'e2e-unsorted.md'),
    '---\nname: e2e-unsorted\ndescription: e2e only\ntools: Write, Read, Edit, Bash\n---\n\nE2E UNSORTED BODY.\n');
  const r = await session(s, {
    [MAIN]: [[agent('e2e-unsorted', 'e2e unsorted'), agent('test-writer', 'e2e sorted')]],
    'e2e unsorted': [say('Done.')],
    'e2e sorted': [say('RED')],
  });
  const [unsorted, sorted] = [r.requests['e2e unsorted'][0], r.requests['e2e sorted'][0]];
  assert.ok(unsorted && sorted, story(r));
  assert.deepEqual(unsorted.tools.map((t) => t.name), ['Write', 'Read', 'Edit', 'Bash'], story(r));
  assert.deepEqual(sorted.tools.map((t) => t.name), ['Bash', 'Edit', 'Read', 'Write'], story(r));
  const body = unsorted.system.find((b) => b.text?.startsWith('E2E UNSORTED BODY.'));
  assert.ok(body, `no system block starts with the agent's body: ${JSON.stringify(unsorted.system.map((b) => b.text?.slice(0, 60)))}`);
  assert.deepEqual(body.cache_control, { type: 'ephemeral' });
});

// #133: two launches of one agent type get the same body block. What differs is the billing header,
// the first system block, ahead of every cache breakpoint: its cc_version suffix follows characters of
// the launch prompt (4, 7 and 20 on 2.1.302). The real API does not count that block in the cache key
// (2026-10-17, through a logging proxy: a relaunch read the tools and system blocks back across
// different suffixes), so this pins the shape, not a cost. Needs no hook of the team.
test("an agent's body block is the same on every launch, and the billing header ahead of it follows the launch prompt (#133)", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const [base, tail, at6] = ['e2e pfx 0123456789abcdef one', 'e2e pfx 0123456789abcdef two', 'e2e pfX 0123456789abcdef one'];
  const [at4, at7, at20] = ['e2e Pfx 0123456789abcdef one', 'e2e pfx_0123456789abcdef one', 'e2e pfx 0123456789abXdef one'];
  const keys = [base, tail, at6, at4, at7, at20];
  const r = await session(s, { [MAIN]: keys.map((k) => agent('test-writer', k)), ...Object.fromEntries(keys.map((k) => [k, [say('RED')]])) });
  const sys = Object.fromEntries(keys.map((k) => [k, r.requests[k][0]?.system]));
  assert.ok(keys.every((k) => sys[k]?.length === 3), story(r));
  assert.match(sys[base][0].text, /^x-anthropic-billing-header: cc_version=[^;]+;/, story(r));
  for (const k of keys) assert.deepEqual(sys[k].slice(1), sys[base].slice(1), `${k}: the cached blocks are the same`);
  assert.deepEqual(sys[tail], sys[base], 'a prompt that differs only after its 21st character sends the same system prefix');
  assert.deepEqual(sys[at6], sys[base], 'and one that differs only at character 6');
  for (const [k, at] of [[at4, 4], [at7, 7], [at20, 20]]) assert.notEqual(sys[k][0].text, sys[base][0].text, `one that differs at character ${at} sends another billing header`);
});

// #133, what a same-type relaunch loses in the real API (2026-10-17, 2.1.302, measured through a logging
// proxy): an agent's first user message holds Claude Code's context blocks and then the launch prompt,
// with no cache breakpoint between them; the next breakpoint sits on a message after the prompt. So a
// relaunch with any other prompt writes the context again (about 7,000 tokens for patcher) and reads
// back only the tools and system blocks; with the same prompt it read everything. If this test fails,
// Claude Code moved the breakpoint: measure again (docs/measurements.md). Needs no hook of the team.
test("an agent's first message puts Claude Code's context ahead of the launch prompt, with no cache breakpoint between them (#133)", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, { [MAIN]: [agent('test-writer', 'e2e context')], 'e2e context': [say('RED')] });
  const req = r.requests['e2e context'][0];
  assert.ok(req, story(r));
  const blocks = req.messages.flatMap((m, i) => (Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]).map((b) => ({ ...b, i })));
  const at = blocks.findIndex((b) => b.text === 'e2e context: go');
  assert.ok(at > 0, `the launch prompt is a block of its own after others: ${JSON.stringify(blocks.map((b) => b.text?.slice(0, 40)))}`);
  assert.ok(blocks.slice(0, at).every((b) => b.i === 0 && b.text?.startsWith('<system-reminder>')), 'Claude Code\'s context blocks come first, in the same message');
  assert.ok(blocks.slice(0, at + 1).every((b) => !b.cache_control), 'no breakpoint on the context or the prompt');
  assert.ok(blocks.slice(at + 1).some((b) => b.cache_control), 'the first breakpoint comes after the prompt');
});

// The agents that cannot write declare omitClaudeMd: true, so their first message carries no CLAUDE.md:
// they take everything from the launch prompt and the files their Inputs name, as the Goldfish reviewers
// of google/elephant-goldfish-model do. That context block is written again on every launch (#133), so
// each of these launches skips it. test-writer, which can write, keeps both files as the control.
test("the agents that cannot write start without the user's and the project's CLAUDE.md", { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  s.write('CLAUDE.md', 'E2E PROJECT CLAUDE MD\n');
  fs.writeFileSync(path.join(s.cfg, 'CLAUDE.md'), 'E2E USER CLAUDE MD\n');
  const r = await session(s, {
    [MAIN]: [agent('test-writer', 'e2e writer'), agent('spec-auditor', 'e2e auditor'), agent('spec-gatekeeper', 'e2e gatekeeper'), agent('security-reviewer', 'e2e security')],
    'e2e writer': [say('RED')],
    'e2e auditor': [say('No findings.\nVERDICT: PASS')],
    'e2e gatekeeper': [say('APPROVED')],
    'e2e security': [say('No findings.\nVERDICT: PASS')],
  });
  // The whole first request, system blocks included, so the file cannot move somewhere unchecked.
  const context = (k) => strings(r.requests[k][0] ?? []).join('\n');
  assert.match(context('e2e writer'), /E2E PROJECT CLAUDE MD/, `test-writer keeps the project CLAUDE.md: ${story(r)}`);
  assert.match(context('e2e writer'), /E2E USER CLAUDE MD/, `test-writer keeps the user CLAUDE.md: ${story(r)}`);
  for (const k of ['e2e auditor', 'e2e gatekeeper', 'e2e security']) {
    assert.ok(r.requests[k][0], `${k} was launched: ${story(r)}`);
    assert.doesNotMatch(context(k), /E2E (PROJECT|USER) CLAUDE MD/, `${k} starts without CLAUDE.md`);
    assert.match(context(k), new RegExp(`${k}: go`), `${k} still gets its launch prompt`);
  }
});

// #19: the board mod (mods/speckit-board) in a real headless session on every OS CI runs, loaded with
// --plugin-dir: Claude Code starts it, it sets the status line and raises its startup toast, and its
// commands answer with no model call (004 quickstart L1, L2). Needs no hook of the team.
async function boardCommand({ repo, cfg }, arg) {
  let modelRequests = 0;
  let child;
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.method === 'POST' && req.url.startsWith('/v1/messages')) { modelRequests++; child?.kill(); }
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fake API for speckit-agents e2e tests' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      child = spawn('claude', ['--plugin-dir', path.join(ROOT, 'mods', 'speckit-board'), '-p', `/speckit-board ${arg}`, '--output-format', 'stream-json', '--verbose'],
        { cwd: repo, env: fakeEnv(cfg, server.address().port), stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        const events = out.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
        resolve({ code, events, modelRequests, out, err, result: events.find((e) => e.type === 'result') });
      });
    });
  } finally {
    server.close();
  }
}

test('the board mod in a headless session sets its status line and toast, and its commands answer at 0 turns (#19)', { skip: noClaude, timeout: 240_000 }, async () => {
  const s = setup();
  const ui = (r, subtype) => r.events.filter((e) => e.type === 'system' && e.subtype === subtype && e.plugin === 'speckit-board').map((e) => e.text);
  const seen = (r) => `exit ${r.code}, ${r.modelRequests} model requests\nstdout: ${r.out.slice(-1500)}\nstderr: ${r.err.slice(0, 800)}`;
  for (const [arg, answer] of [
    ['status', /^speckit-board: 001-x · .+\n.*spec .*plan .*tasks .*build/],
    ['clear', /^speckit-board: cleared the pane and the band\.$/],
    ['foo', /^speckit-board: unknown argument "foo": use status, refresh, band or clear\.$/],
  ]) {
    const r = await boardCommand(s, arg);
    assert.equal(r.modelRequests, 0, seen(r));
    assert.equal(r.result?.num_turns, 0, seen(r));
    assert.equal(r.result?.total_cost_usd, 0, seen(r));
    assert.match(r.result?.result ?? '', answer, seen(r));
    assert.ok(ui(r, 'ui_status').some((t) => /^001-x · /.test(t)), seen(r));
    assert.ok(ui(r, 'ui_toast').includes('001-x. /speckit-board opens the board'), seen(r));
  }
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

// #40: side by side, each implementer runs with isolation: "worktree". Claude Code cuts the worktree
// from the last commit, so the skill commits test-writer's tests in the message that launches the
// implementers, and the Agent result names the worktree's branch, which the main session merges. The
// hook there reads the audit the main tree recorded (one state dir per repository, not per worktree).
test("an implementer in a worktree is gated by the main tree's audit, starts from the last commit, and its result names its branch (#40)", { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  s.write('tests/red.test.js', 'written by test-writer, not committed yet\n');
  const script = {
    [MAIN]: [call('Agent', { description: 'implementer', subagent_type: 'implementer', prompt: 'e2e worktree implementer: go', run_in_background: false, isolation: 'worktree' })],
    'e2e worktree implementer': [
      call('Bash', { command: 'git rev-parse --abbrev-ref HEAD; ls tests 2>/dev/null || echo "no tests folder"', description: 'Look at the worktree' }),
      call('Bash', { command: 'echo "export const left = 1;" > left.js && git add left.js && git -c user.name=t -c user.email=t@example.invalid commit -qm "e2e slice built"', description: 'Commit the slice' }),
      say('T001 passes.\nRESULT: GREEN'),
    ],
  };
  const before = await session(s, script);
  assert.match(lastResult(before.requests['e2e worktree implementer'][1]), /Implementation gate: spec-auditor has not passed specs\/001-x/, story(before));
  recordPass(s);
  const after = await session(s, script);
  const seen = lastResult(after.requests['e2e worktree implementer'][1]);
  assert.match(seen, /^worktree-agent-\S+$/m, `not on a worktree branch: ${seen}\n${story(after)}`);
  assert.match(seen, /no tests folder/, `the worktree has the uncommitted test: ${seen}\n${story(after)}`);
  const branch = /worktreeBranch: (\S+)/.exec(lastResult(after.requests[MAIN][1]))?.[1];
  assert.ok(branch, `the Agent result names no branch:\n${story(after)}`);
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s', branch], { cwd: s.repo, encoding: 'utf8' }).trim(), 'e2e slice built', story(after));
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

// #73, the 003 plan's open risk "whether Claude Code delivers the fast track's hooks in an interactive
// session": an interactive session has fork subagents on, so patcher runs in the background there,
// whatever run_in_background says. Its hooks must fire all the same: the scope hook on its Write, and
// the end check when it stops, which writes the accepted record.
test('with fork subagents on, as in an interactive session, patcher runs in the background and its hooks still fire (#73)', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [wfile(s, '.specify/memory/constitution.md', 'changed\n'), wfile(s, 'src/fix.js', 'export const fix = 1;\n'), say('Fixed.\nDONE')],
  }, { env: { CLAUDE_CODE_FORK_SUBAGENT: '1' } });
  assert.equal(launch(r)?.is_backgrounded, true, story(r));
  assert.match(lastResult(r.requests['e2e patcher'][1]), /patcher may not write \.specify\/memory\/constitution\.md: it is a protected path/, story(r));
  assert.equal(fs.readFileSync(path.join(s.repo, '.specify', 'memory', 'constitution.md'), 'utf8'), '# Constitution\n');
  assert.deepEqual(record(s).files, ['src/fix.js'], story(r));
});

// #72, the structural option: the deny reader cannot see a push inside a script, so in bypassPermissions
// (the main session's mode here, which patcher runs in) the hook runs patcher's command with git's
// network transports off, and git refuses the push before it connects. With SPECKIT_E2E_NO_HOOK=1 git
// tries to connect instead.
test('in bypassPermissions, a push from a script patcher runs is refused by git before it connects (#72)', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [
      wfile(s, 'push.sh', 'git push https://127.0.0.1:9/none.git HEAD:refs/heads/x\n'),
      call('Bash', { command: 'sh push.sh', description: 'Run the script' }),
      say('Ran it.\nDONE'),
    ],
  });
  assert.ok(r.requests['e2e patcher'].length >= 3, story(r));
  assert.match(lastResult(r.requests['e2e patcher'][2]), /transport 'https' not allowed/, story(r));
});

// #122: install.mjs allows the export line exactly, so default mode gets the switch-off too, and the
// rewritten command asks for nothing the command itself would not: `sh push.sh`, allowed here, runs
// with no prompt and git refuses its push. With SPECKIT_E2E_NO_HOOK=1 git tries to connect instead.
test('in default mode with the installed allow rule, a push from a script patcher runs is refused by git, with no prompt (#122)', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const file = path.join(s.cfg, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  ((settings.permissions ??= {}).allow ??= []).push('Bash(sh push.sh)');
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  s.write('push.sh', 'git push https://127.0.0.1:9/none.git HEAD:refs/heads/x\n');
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [call('Bash', { command: 'sh push.sh', description: 'Run the script' }), say('Ran it.\nDONE')],
  }, { permissionMode: 'default' });
  assert.ok(r.requests['e2e patcher'].length >= 2, story(r));
  assert.match(lastResult(r.requests['e2e patcher'][1]), /transport 'https' not allowed/, story(r));
});

// #123: a forge's API does not go through git, so the same line points gh at a config folder that does
// not exist. The stored login here is for 127.0.0.1, so with SPECKIT_E2E_NO_HOOK=1 gh uses it and tries
// https://127.0.0.1:443 instead; under the line it stops for lack of a login before any request.
const noGh = spawnSync('gh', ['--version']).error ? 'gh is not on PATH' : false;
test('a gh api call from a script patcher runs finds no stored login (#123)', { skip: noClaude || noGh, timeout: 120_000 }, async () => {
  const s = setup();
  const stored = fs.mkdtempSync(path.join(os.tmpdir(), 'ske2e-gh-'));
  fs.writeFileSync(path.join(stored, 'hosts.yml'), '127.0.0.1:\n    oauth_token: gho_fake\n    user: someone\n    git_protocol: https\n');
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [
      wfile(s, 'merge.sh', 'gh api --hostname 127.0.0.1 user\n'),
      call('Bash', { command: 'sh merge.sh', description: 'Run the script' }),
      say('Ran it.\nDONE'),
    ],
  }, { env: { GH_CONFIG_DIR: stored, GH_TOKEN: '', GITHUB_TOKEN: '', GH_ENTERPRISE_TOKEN: '', GITHUB_ENTERPRISE_TOKEN: '', GH_HOST: '' } });
  assert.ok(r.requests['e2e patcher'].length >= 3, story(r));
  // gh's "authentication required" exit; inside GitHub Actions it asks for GH_TOKEN instead.
  assert.match(lastResult(r.requests['e2e patcher'][2]), /Exit code 4[\s\S]*(gh auth login|set the GH_TOKEN environment variable)/, story(r));
});

// #138: a token in the environment skips the stored login, so the line also empties the forge CLIs'
// token variables. In default mode with the installed allow rule, which the empty assignments must still
// match, the script runs with no prompt and gh stops for lack of a token. With SPECKIT_E2E_NO_HOOK=1 gh
// uses the token and tries https://127.0.0.1:443 instead.
test('in default mode, a gh api call from a script patcher runs gets no token from the environment, with no prompt (#138)', { skip: noClaude || noGh, timeout: 120_000 }, async () => {
  const s = setup();
  const file = path.join(s.cfg, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  ((settings.permissions ??= {}).allow ??= []).push('Bash(sh merge.sh)');
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  s.write('merge.sh', 'gh api --hostname 127.0.0.1 user\n');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ske2e-gh-'));
  const r = await session(s, {
    [MAIN]: [agent('patcher', 'e2e patcher')],
    'e2e patcher': [call('Bash', { command: 'sh merge.sh', description: 'Run the script' }), say('Ran it.\nDONE')],
  }, { permissionMode: 'default', env: { GH_CONFIG_DIR: empty, GH_TOKEN: '', GITHUB_TOKEN: '', GH_ENTERPRISE_TOKEN: 'from-the-environment', GITHUB_ENTERPRISE_TOKEN: '', GH_HOST: '' } });
  assert.ok(r.requests['e2e patcher'].length >= 2, story(r));
  assert.match(lastResult(r.requests['e2e patcher'][1]), /Exit code 4[\s\S]*(gh auth login|set the GH_TOKEN environment variable)/, story(r));
});

// 006 (US3-1, US3-2, FR-007, FR-009): the Agent launch records the team, and the gate follows it.
// The three cases below need the installed hook to fire on PreToolUse Agent; with SPECKIT_E2E_NO_HOOK=1
// the second and third fail.
const teamAgent = (marker, prompt) => call('Agent', { description: marker, subagent_type: 'test-writer', prompt, run_in_background: false });
const sessionId = (r) => r.events.find((e) => e.session_id)?.session_id;

test('a Team line without spec-auditor opens the audit gate for test-writer, and the record holds the roles (006 US3-1, FR-007)', { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [teamAgent('e2e test-writer', 'e2e test-writer: go\nTeam: test-writer, implementer')],
    'e2e test-writer': [call('Read', { file_path: spec(s) })],
  });
  assert.doesNotMatch(lastResult(r.requests['e2e test-writer'][1]), /Implementation gate/, story(r));
  assert.match(lastResult(r.requests['e2e test-writer'][1]), /# Spec/, story(r));
  assert.deepEqual(state(s, 'team', `${sessionId(r)}.json`).roles, ['test-writer', 'implementer'], story(r));
});

test('a Team line with spec-auditor keeps the audit gate shut for test-writer (006 US3-2, FR-007)', { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [teamAgent('e2e test-writer', 'e2e test-writer: go\nTeam: spec-auditor, architect, product-owner, test-writer')],
    'e2e test-writer': [call('Read', { file_path: spec(s) })],
  });
  assert.match(lastResult(r.requests['e2e test-writer'][1]), /Implementation gate: spec-auditor has not passed specs\/001-x/, story(r));
  assert.ok(state(s, 'team', `${sessionId(r)}.json`).roles.includes('spec-auditor'), story(r));
});

test('a later launch with no Team line in the same session records the full team, so the gate is shut again (006 FR-009)', { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [
      teamAgent('e2e test-writer', 'e2e test-writer: go\nTeam: test-writer, implementer'),
      teamAgent('e2e second', 'e2e second: go'),
    ],
    'e2e test-writer': [call('Read', { file_path: spec(s) })],
    'e2e second': [call('Read', { file_path: spec(s) })],
  });
  assert.match(lastResult(r.requests['e2e test-writer'][1]), /# Spec/, story(r));
  assert.match(lastResult(r.requests['e2e second'][1]), /Implementation gate: spec-auditor has not passed specs\/001-x/, story(r));
});

// #101: within one request, a Team line written by the main session cannot drop spec-auditor from
// a team that has it. Needs the Agent gate to fire; with SPECKIT_E2E_NO_HOOK=1 the Read goes through.
test('after a full-team launch, a Team line without spec-auditor leaves the audit gate shut (#101)', { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [teamAgent('e2e first', 'e2e first: go'), teamAgent('e2e second', 'e2e second: go\nTeam: test-writer, implementer')],
    'e2e first': [say('T001 fails on its assertion.\nRED')],
    'e2e second': [call('Read', { file_path: spec(s) })],
  });
  assert.match(lastResult(r.requests['e2e second'][1]), /Implementation gate: spec-auditor has not passed specs\/001-x/, story(r));
  assert.ok(state(s, 'team', `${sessionId(r)}.json`).roles.includes('spec-auditor'), story(r));
});

// #100, 006 live check L4: in an interactive session the request starts with a typed /speckit-team
// and the team question's Build only answer becomes a Team line. Fork subagents are on there, so
// test-writer and implementer run in the background; their gates must still find the team that the
// main session's launch recorded under its session id. With SPECKIT_E2E_NO_HOOK=1 nothing is recorded.
test('with fork subagents on, as in an interactive session, a Build only team opens the audit gate for test-writer and implementer (#100)', { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const team = 'Team: test-writer, implementer';
  const r = await session(s, {
    [MAIN]: [
      teamAgent('e2e test-writer', `e2e test-writer: go\n${team}`),
      call('Agent', { description: 'e2e implementer', subagent_type: 'implementer', prompt: `e2e implementer: go\n${team}`, run_in_background: false }),
    ],
    'e2e test-writer': [call('Read', { file_path: spec(s) })],
    'e2e implementer': [call('Read', { file_path: spec(s) })],
  }, { prompt: `/speckit-team ${MAIN}`, env: { CLAUDE_CODE_FORK_SUBAGENT: '1' } });
  assert.equal(launch(r)?.is_backgrounded, true, story(r));
  for (const who of ['e2e test-writer', 'e2e implementer']) {
    assert.doesNotMatch(lastResult(r.requests[who][1]), /Implementation gate/, `${who}\n${story(r)}`);
    assert.match(lastResult(r.requests[who][1]), /# Spec/, `${who}\n${story(r)}`);
  }
  assert.deepEqual(state(s, 'team', `${sessionId(r)}.json`).roles, ['test-writer', 'implementer'], story(r));
  assert.match(r.out, /speckit-team: team for this session: test-writer, implementer; audit gate off, spec-auditor is not in the team/, story(r));
});

// #88: the settings.json SubagentStart entry records where product-owner and architect start, and their
// Stop runs `lane only` with their scope prefixes. With SPECKIT_E2E_NO_HOOK=1 neither block comes.
test("product-owner's and architect's Stop: the lane check catches a file written through Bash (#88)", { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [agent('architect', 'e2e architect'), agent('product-owner', 'e2e product-owner')],
    'e2e architect': [call('Bash', { command: 'echo 1 > arch.js', description: 'Write a file' }), say('Plan written.')],
    'e2e product-owner': [call('Bash', { command: 'echo 1 > owner.js', description: 'Write a file' }), say('Spec written.\nREADY FOR PLAN')],
  });
  assert.ok(fs.existsSync(path.join(s.repo, 'arch.js')), `the Bash call never ran:\n${story(r)}`);
  assert.match(shown(r.requests['e2e architect'][2]), /Lane check: architect changed files outside its lane: arch\.js\./, story(r));
  assert.match(shown(r.requests['e2e product-owner'][2]), /Lane check: product-owner changed files outside its lane: owner\.js\./, story(r));
});

// --team noagents: Claude Code hands the typed /speckit-team to the UserPromptExpansion gate, which
// records that no agent runs, so the main session's own speckit-implement call needs no audit. Without
// the flag the same call is denied, which shows the gate ran in both sessions.
test('a typed /speckit-team --team noagents lets the main session call speckit-implement with no audit; without it the call is denied', { skip: noClaude, timeout: 240_000 }, async () => {
  const s = setup();
  const script = { [MAIN]: [call('Skill', { skill: 'speckit-implement' })] };
  const team = await session(s, script, { prompt: `/speckit-team ${MAIN}` });
  assert.match(lastResult(team.requests[MAIN][1]), /Implementation gate: spec-auditor has not passed specs\/001-x/, story(team));
  const none = await session(s, script, { prompt: `/speckit-team --team noagents ${MAIN}` });
  assert.ok(none.requests[MAIN].length >= 2, story(none));
  assert.doesNotMatch(lastResult(none.requests[MAIN][1]), /Implementation gate/, story(none));
  assert.equal(state(s, 'team', `${sessionId(none)}.json`).noagents, true, story(none));
  // 007 contract section 2: a leading --project pair does not hide --team noagents from the gate.
  const first = await session(s, script, { prompt: `/speckit-team --project demo --team noagents ${MAIN}` });
  assert.doesNotMatch(lastResult(first.requests[MAIN][1]), /Implementation gate/, story(first));
  assert.equal(state(s, 'team', `${sessionId(first)}.json`).noagents, true, story(first));
});

// 007 (US1, contracts/project.md section 5): the launch's Project line is recorded by the Agent gate, and
// the SubagentStart entry hands the block to the agent, so its first model request holds it. With
// SPECKIT_E2E_NO_HOOK=1 the request has neither the header nor the instruction.
test("a Project line in test-writer's launch puts the project block in its first model request (007 US1, FR-003)", { skip: noClaude, timeout: 180_000 }, async () => {
  const s = setup();
  s.write('.specify/projects/demo/instructions.md', 'Money is never a float.\n');
  s.write('.specify/projects/demo/api.md', '# API\n');
  const r = await session(s, {
    [MAIN]: [teamAgent('e2e test-writer', 'e2e test-writer: go\nProject: demo')],
    'e2e test-writer': [say('T001 fails on its assertion.\nRED')],
  });
  const first = r.requests['e2e test-writer'][0];
  assert.ok(first, story(r));
  const seen = `${textOf(first.system)}\n${shown(first)}`;
  assert.match(seen, /Project demo: 1 knowledge file, instructions \d+ bytes\./, story(r));
  assert.match(seen, /^ {2}Money is never a float\.$/m, story(r));
  assert.equal(state(s, 'project', `${sessionId(r)}.json`).name, 'demo', story(r));
});

test('security-reviewer in real session: opted in via Team line, reviews spec and result', { skip: noClaude, timeout: 240_000 }, async () => {
  const s = setup();
  const team = 'Team: product-owner, architect, spec-auditor, test-writer, implementer, spec-gatekeeper, security-reviewer';
  const secAgent = (marker, phase) => call('Agent', {
    description: marker,
    subagent_type: 'security-reviewer',
    prompt: `${marker}: go\nPhase: ${phase}\n${team}`,
    run_in_background: false,
  });
  const r = await session(s, {
    [MAIN]: [
      secAgent('e2e security spec', 'spec'),
      secAgent('e2e security result', 'result'),
    ],
    'e2e security spec': [
      call('Read', { file_path: spec(s) }),
      say('Threat modeling: no issues found.\nVERDICT: PASS'),
    ],
    'e2e security result': [
      call('Bash', { command: 'git diff HEAD~1', description: 'Inspect diff' }),
      say('Result diff inspection: no secrets or vulnerabilities.\nVERDICT: PASS'),
    ],
  });
  assert.equal(r.requests['e2e security spec'].length, 2, story(r));
  assert.equal(r.requests['e2e security result'].length, 2, story(r));
  assert.match(lastResult(r.requests['e2e security spec'][1]), /# Spec/, story(r));
  assert.match(lastResult(r.requests[MAIN][1]), /VERDICT: PASS/, story(r));
  assert.match(lastResult(r.requests[MAIN][2]), /VERDICT: PASS/, story(r));
  assert.deepEqual(state(s, 'team', `${sessionId(r)}.json`).roles, [
    'product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper', 'security-reviewer',
  ], story(r));
});

test('security-reviewer in real session: reports VERDICT: FAIL on critical finding, and default run excludes security', { skip: noClaude, timeout: 240_000 }, async () => {
  const s = setup();
  // 1. Default launch without security: team in session does not have security-reviewer
  const rDefault = await session(s, {
    [MAIN]: [teamAgent('e2e test-writer', 'e2e test-writer: go')],
    'e2e test-writer': [call('Read', { file_path: spec(s) })],
  });
  const defaultRoles = state(s, 'team', `${sessionId(rDefault)}.json`).roles;
  assert.ok(!defaultRoles.includes('security-reviewer'), 'default team does not include security-reviewer');

  // 2. Opted-in security-reviewer reports finding with VERDICT: FAIL
  const team = 'Team: product-owner, architect, spec-auditor, test-writer, implementer, spec-gatekeeper, security-reviewer';
  const secAgent = (marker, phase) => call('Agent', {
    description: marker,
    subagent_type: 'security-reviewer',
    prompt: `${marker}: go\nPhase: ${phase}\n${team}`,
    run_in_background: false,
  });
  const rFail = await session(s, {
    [MAIN]: [secAgent('e2e security fail', 'spec')],
    'e2e security fail': [
      call('Read', { file_path: spec(s) }),
      say('CRITICAL: specs/001-x/spec.md:20 Missing authentication on administrative endpoint.\nVERDICT: FAIL'),
    ],
  });
  assert.match(lastResult(rFail.requests[MAIN][1]), /VERDICT: FAIL/, story(rFail));
  assert.match(lastResult(rFail.requests[MAIN][1]), /CRITICAL/, story(rFail));
});

// The skill routes on security-reviewer's last line, so a report without its verdict is refused once,
// like spec-gatekeeper's. With SPECKIT_E2E_NO_HOOK=1 the first report goes through unrefused.
test("security-reviewer's report must end in VERDICT: PASS or VERDICT: FAIL", { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  const r = await session(s, {
    [MAIN]: [agent('security-reviewer', 'e2e security ends')],
    'e2e security ends': [say('No CRITICAL or HIGH findings.\nPASS, pending a dependency audit'), say('No CRITICAL or HIGH findings.\nVERDICT: PASS')],
  });
  assert.match(shown(r.requests['e2e security ends'][1]), /Your report must end with a final line that is exactly one of: VERDICT: PASS, VERDICT: FAIL/, story(r));
  assert.match(lastResult(r.requests[MAIN][1]), /^\s*VERDICT: PASS$/m, story(r));
});

// Runs the queue `test` filled (top of the file), CONCURRENCY at a time.
describe('end to end', { concurrency: CONCURRENCY }, () => { for (const args of queued) nodeTest(...args); });


