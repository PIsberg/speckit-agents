// Run: npm test (or node tools/test.mjs test/usage.test.mjs)
// tools/usage.mjs reads a session transcript the way Claude Code 2.1.29x writes it. The transcript
// here is synthetic, shaped like the 2026-10-07 /speckit-team runs: one API response split over
// several lines, a background launch with its "waiting" response, and a foreground launch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skills, summarise } from '../tools/usage.mjs';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'usage.mjs');
const usage = (cacheRead, cacheWrite = 0) => ({ input_tokens: 1, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, output_tokens: 1 });
const say = (id, u, content, extra = {}) => ({ isSidechain: false, ...extra, message: { id, role: 'assistant', model: extra.model ?? 'claude-sonnet-5-5', usage: u, content } });
const hear = (content, extra = {}) => ({ isSidechain: false, ...extra, message: { role: 'user', content } });
const result = (id, text) => hear([{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }]);
const agent = (id, type) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: type } });

function transcript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skusage-'));
  const file = path.join(dir, 'sess.jsonl');
  const lines = [
    hear('/speckit-team add sum()'),
    // One response written as three lines, each repeating the same usage.
    say('m1', usage(1000, 100), [{ type: 'thinking', thinking: '' }]),
    say('m1', usage(1000, 100), [{ type: 'text', text: 'Launching product-owner.' }]),
    say('m1', usage(1000, 100), [agent('t1', 'product-owner')]),
    result('t1', 'Async agent launched successfully.\nagentId: a1'),
    say('m2', usage(1200), [{ type: 'text', text: 'Waiting for product-owner.' }]),
    hear('<agent-message from="a1">\n[Subagent hand-back] READY FOR PLAN</agent-message>'),
    say('m3', usage(1500), [agent('t2', 'architect')]),
    result('t2', 'plan.md and tasks.md written.'),
    say('m4', usage(1800), [{ type: 'text', text: 'Done.' }]),
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  const sub = path.join(dir, 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const side = { isSidechain: true, agentId: 'a1', model: 'claude-opus-5-5' };
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), [
    hear('Feature idea: sum()', side),
    say('s1', usage(300, 50), [{ type: 'text', text: 'Reading.' }], side),
    say('s1', usage(300, 50), [{ type: 'tool_use', id: 'r1', name: 'Read', input: {} }], side),
    say('s2', usage(400), [{ type: 'text', text: 'READY FOR PLAN' }], side),
  ].map((l) => JSON.stringify(l)).join('\n'));
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'product-owner' }));
  return file;
}

test('usage counts each API response once, however many lines it was written as', () => {
  const { main, agents } = summarise(transcript());
  assert.equal(main.responses, 4);
  // m1 + m2 + m3 + m4, each with its one uncached token; per line it would have been 3 x 1101 for m1.
  assert.equal(main.input, 1101 + 1201 + 1501 + 1801);
  assert.equal(main.first, 1101);
  assert.equal(main.peak, 1801);
  assert.deepEqual(agents, [{ type: 'product-owner', responses: 2, input: 351 + 401, peak: 401, models: ['claude-opus-5-5'] }]);
});

test('usage tells background launches from foreground ones and finds the response that only waited', () => {
  const { main } = summarise(transcript());
  assert.deepEqual(main.launches, [{ type: 'product-owner', background: true, worktree: false, together: 1 }, { type: 'architect', background: false, worktree: false, together: 1 }]);
  // m2 followed the launch receipt and called nothing. m3, after the hand-back, did work.
  assert.equal(main.waits, 1);
  assert.equal(main.waitInput, 1201);
});

// #114: slices built side by side go out as several Agent calls in one response, each implementer in a
// worktree. The response may be written over several lines, as m1 is above.
test('usage tells which launches went out together and which ran in a worktree (#114)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skusage-sbs-')), 'sess.jsonl');
  const wt = (id) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'implementer', isolation: 'worktree' } });
  fs.writeFileSync(file, [
    hear('/speckit-team add sum() and capitalize()'),
    say('m1', usage(1000), [agent('t1', 'test-writer'), agent('t2', 'test-writer')]),
    result('t1', 'RED'), result('t2', 'RED'),
    say('m2', usage(1000), [wt('t3')]),
    say('m2', usage(1000), [wt('t4')]),
    result('t3', 'RESULT: GREEN'), result('t4', 'RESULT: GREEN'),
    say('m3', usage(1000), [agent('t5', 'spec-gatekeeper')]),
    result('t5', 'APPROVED'),
  ].map((l) => JSON.stringify(l)).join('\n'));
  const { main } = summarise(file);
  assert.deepEqual(main.launches.map((l) => [l.type, l.together, l.worktree]), [
    ['test-writer', 2, false], ['test-writer', 2, false], ['implementer', 2, true], ['implementer', 2, true], ['spec-gatekeeper', 1, false],
  ]);
  const out = spawnSync(process.execPath, [TOOL, file], { encoding: 'utf8' });
  assert.match(out.stdout, /side by side: 2 responses launched more than one agent \(4 agents\), 2 agents in a worktree/);
});

test('usage totals input per model in the fields claude -p reports', () => {
  const { models } = summarise(transcript());
  assert.deepEqual(models, {
    'claude-sonnet-5-5': { inputTokens: 4, cacheReadInputTokens: 1000 + 1200 + 1500 + 1800, cacheCreationInputTokens: 100 },
    'claude-opus-5-5': { inputTokens: 2, cacheReadInputTokens: 700, cacheCreationInputTokens: 50 },
  });
});

test('usage prints the summary from the command line, and usage help without a transcript', () => {
  const ok = spawnSync(process.execPath, [TOOL, transcript()], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /agent launches: 2 \(1 foreground, 1 background\); responses that only waited for a background agent: 1/);
  assert.match(ok.stdout, /cache hit rate/i);
  const missing = spawnSync(process.execPath, [TOOL], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /usage: node tools\/usage\.mjs/);
});

// A session on Sonnet whose agents are given as [file id, type, first-request time, cache read of the
// first request]. Each agent makes two requests a minute apart. The file ids sort in another order
// than the times, as Claude Code's random agent ids do.
function sessionWithAgents(agents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skusage-div-'));
  const file = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(file, [hear('/speckit-team test'), say('m1', usage(1000, 100), [{ type: 'text', text: 'Start' }])].map((l) => JSON.stringify(l)).join('\n'));
  const sub = path.join(dir, 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  for (const [id, type, at, read] of agents) {
    const side = { isSidechain: true, agentId: id, model: 'claude-sonnet-5-5' };
    const later = new Date(Date.parse(at) + 60_000).toISOString();
    fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), [
      hear('Work', side),
      say(`${id}-1`, usage(read, 500), [{ type: 'text', text: 'Reading.' }], { ...side, timestamp: at }),
      say(`${id}-2`, usage(read + 500), [{ type: 'text', text: 'Done.' }], { ...side, timestamp: later }),
    ].map((l) => JSON.stringify(l)).join('\n'));
    fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: type }));
  }
  return file;
}

test('usage does not warn on the first launch of an agent type: its prompt is its own, so the cold write is expected', () => {
  // The 2026-10-09 run had 53 agents; flagging every first cold write on the main session's model
  // marked 15 of them, each the first of its type or after the cache expired.
  const { warnings } = summarise(sessionWithAgents([
    ['f1', 'product-owner', '2026-10-09T21:06:00Z', 0],
    ['a2', 'security-reviewer', '2026-10-09T21:10:00Z', 0],
  ]));
  assert.deepEqual(warnings, []);
});

test('usage warns when a relaunch of the same type within the cache lifetime reads nothing back, in launch order', () => {
  // f1 sorts after a2 by file name but started first; a2 is the relaunch that lost the prefix.
  const { warnings } = summarise(sessionWithAgents([
    ['f1', 'architect', '2026-10-09T21:14:00Z', 0],
    ['a2', 'architect', '2026-10-09T21:17:00Z', 0],
    ['b3', 'architect', '2026-10-09T21:20:00Z', 4366],
  ]));
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /architect.*claude-sonnet-5-5.*120s/);
});

test('usage does not warn on a relaunch after the cache lifetime has passed', () => {
  const { warnings } = summarise(sessionWithAgents([
    ['f1', 'implementer', '2026-10-10T06:10:00Z', 0],
    ['a2', 'implementer', '2026-10-10T07:04:00Z', 0],
  ]));
  assert.deepEqual(warnings, []);
});


// 009 T020 (SC-001): the main session's Skill calls, in order, sidechain rows left out.
const skillCall = (id, input) => ({ type: 'tool_use', id, name: 'Skill', input });

test('usage lists the main session Skill calls by name, in order, skipping sidechain rows (SC-001)', () => {
  const rows = [
    hear('/speckit-team --team skill-agents x'),
    say('m1', usage(10), [skillCall('s1', { skill: 'speckit-role-product-owner' })]),
    say('m2', usage(10), [{ type: 'text', text: 'ok' }, skillCall('s2', { skill_name: 'speckit-role-architect' })]),
    say('m3', usage(10), [skillCall('s3', { skill: 'speckit-role-hidden' })], { isSidechain: true }),
    say('m4', usage(10), [{ type: 'tool_use', id: 'r', name: 'Read', input: {} }]),
    say('m5', usage(10), [skillCall('s4', { skill: 'speckit-role-test-writer' })]),
  ];
  assert.deepEqual(skills(rows), ['speckit-role-product-owner', 'speckit-role-architect', 'speckit-role-test-writer']);
  assert.deepEqual(skills([]), []);
});

test('usage summary holds the same Skill list as main.skills (SC-001)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skusage-skills-')), 'sess.jsonl');
  fs.writeFileSync(file, [
    hear('/speckit-team --team skill-agents x'),
    say('m1', usage(10), [skillCall('s1', { skill: 'speckit-role-product-owner' })]),
    result('s1', 'ok'),
    say('m2', usage(10), [skillCall('s2', { skill: 'speckit-role-architect' })]),
  ].map((l) => JSON.stringify(l)).join('\n'));
  assert.deepEqual(summarise(file).main.skills, ['speckit-role-product-owner', 'speckit-role-architect']);
});
