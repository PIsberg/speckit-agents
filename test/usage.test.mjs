// Run: npm test (or node --test "test/*.test.mjs")
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
import { summarise } from '../tools/usage.mjs';

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
  assert.deepEqual(main.launches, [{ type: 'product-owner', background: true }, { type: 'architect', background: false }]);
  // m2 followed the launch receipt and called nothing. m3, after the hand-back, did work.
  assert.equal(main.waits, 1);
  assert.equal(main.waitInput, 1201);
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
  const missing = spawnSync(process.execPath, [TOOL], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /usage: node tools\/usage\.mjs/);
});
