// Run: npm test (or node --test "test/prompt-caching.test.mjs")
// Tests for prompt caching architecture: deterministic tool ordering, inverted persona injection,
// progressive artifact breakpoints, TDD turn history preservation, TTL handling, and divergence diagnostics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sortToolSchemas,
  buildSystemPrompt,
  buildArtifactContent,
  buildTurnMessages,
  detectDivergence,
  MIN_CACHE_TOKENS,
} from '../tools/prompt-cache.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_DIR = path.join(ROOT, 'agents');
const AGENT_FILES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper', 'security-reviewer', 'patcher'];

test('all agent files declare deterministically sorted unified tools', () => {
  for (const name of AGENT_FILES) {
    const content = fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8');
    const toolMatch = content.match(/^tools:\s*(.+)$/m);
    assert.ok(toolMatch, `${name}.md must declare tools`);
    const tools = toolMatch[1].split(',').map((t) => t.trim());
    const sorted = [...tools].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(tools, sorted, `${name}.md tools must be alphabetically sorted`);
    assert.deepEqual(tools, ['Bash', 'Edit', 'Read', 'Write'], `${name}.md tools must be unified [Bash, Edit, Read, Write]`);
  }
});

test('read-only agents retain disallowedTools for write/edit operations', () => {
  const readOnlyAgents = ['spec-auditor', 'spec-gatekeeper', 'security-reviewer'];
  for (const name of readOnlyAgents) {
    const content = fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8');
    assert.match(content, /^disallowedTools:.*Write/m, `${name}.md must disallow Write`);
    assert.match(content, /^disallowedTools:.*Edit/m, `${name}.md must disallow Edit`);
  }
});

test('sortToolSchemas sorts tool definitions alphabetically by name', () => {
  const unsorted = [
    { name: 'Write', description: 'Write files' },
    { name: 'Bash', description: 'Run bash' },
    { name: 'Read', description: 'Read files' },
    { name: 'Edit', description: 'Edit files' },
  ];
  const sorted = sortToolSchemas(unsorted);
  assert.deepEqual(
    sorted.map((t) => t.name),
    ['Bash', 'Edit', 'Read', 'Write']
  );
});

test('buildSystemPrompt implements inverted persona injection with byte-identical Block 1', () => {
  const constitution = 'Rule 1: Never break tests.\nRule 2: Keep guardrails active.';
  const projectKnowledge = '# Billing Project\nInstructions: follow PCI-DSS.\nFiles:\n- api.md (100b)';

  const poPrompt = buildSystemPrompt({
    constitution,
    projectKnowledge,
    role: 'product-owner',
    personaInstructions: 'Focus: Turn ideas into spec.md.',
    ttl: '1h',
  });

  const secPrompt = buildSystemPrompt({
    constitution,
    projectKnowledge,
    role: 'security-reviewer',
    personaInstructions: 'Focus: Threat modeling, OWASP top 10.',
    ttl: '1h',
  });

  assert.equal(poPrompt.length, 2, 'System prompt must have exactly 2 blocks');
  assert.equal(secPrompt.length, 2, 'System prompt must have exactly 2 blocks');

  // Block 1 must be byte-identical across both agents
  assert.equal(poPrompt[0].text, secPrompt[0].text);
  assert.deepEqual(poPrompt[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.deepEqual(secPrompt[0].cache_control, { type: 'ephemeral', ttl: '1h' });

  // Block 2 contains role personas and does not carry cache_control
  assert.match(poPrompt[1].text, /=== ACTIVE ROLE ASSIGNMENT ===\nYou are product-owner/);
  assert.match(secPrompt[1].text, /=== ACTIVE ROLE ASSIGNMENT ===\nYou are security-reviewer/);
  assert.equal(poPrompt[1].cache_control, undefined);
  assert.equal(secPrompt[1].cache_control, undefined);
});

test('buildSystemPrompt falls back to 5m standard ephemeral cache when ttl is not specified', () => {
  const prompt = buildSystemPrompt({
    constitution: 'Rules',
    projectKnowledge: 'Project',
    role: 'test-writer',
    personaInstructions: 'Write red tests',
  });
  assert.deepEqual(prompt[0].cache_control, { type: 'ephemeral' });
});

test('buildArtifactContent positions stable phase artifacts with cache_control', () => {
  const spec = '# Feature Spec: Auth\nScenario: Login';
  const plan = '# Architecture Plan\nDecision 1: JWT';
  const tasks = '# Tasks\n- [ ] T001 Stubs';

  const phase1Artifact = buildArtifactContent({ spec, ttl: '1h' });
  assert.match(phase1Artifact.text, /# Feature Spec: Auth/);
  assert.deepEqual(phase1Artifact.cache_control, { type: 'ephemeral', ttl: '1h' });

  const phase2Artifact = buildArtifactContent({ spec, plan, tasks, ttl: '1h' });
  assert.match(phase2Artifact.text, /# Feature Spec: Auth/);
  assert.match(phase2Artifact.text, /# Architecture Plan/);
  assert.match(phase2Artifact.text, /# Tasks/);
  assert.deepEqual(phase2Artifact.cache_control, { type: 'ephemeral', ttl: '1h' });
});

test('buildTurnMessages preserves prior turn history and sets Breakpoint 4 before new diff', () => {
  const history = [
    { role: 'user', content: 'Implement T001' },
    { role: 'assistant', content: 'Writing code for T001' },
  ];
  const newDiff = 'FAIL test/auth.test.mjs: Expected 200 but got 500';

  const messages = buildTurnMessages({ history, newDiff });
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].role, 'assistant');
  // Breakpoint 4 placed on previous turn to cache all context up to the error
  assert.deepEqual(messages[1].content[0].cache_control, { type: 'ephemeral' });
  // Dynamic error diff has no cache_control
  assert.equal(messages[2].role, 'user');
  assert.equal(messages[2].content[0].cache_control, undefined);
  assert.match(messages[2].content[0].text, /FAIL test\/auth.test.mjs/);
});

test('detectDivergence identifies cache-busting divergences between payloads', () => {
  const payload1 = {
    tools: [{ name: 'Bash' }, { name: 'Read' }],
    system: [
      { type: 'text', text: 'SHARED RULES', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'ROLE: Agent 1' },
    ],
  };

  // Case 1: Identical prefix -> no divergence
  const payloadIdentical = {
    tools: [{ name: 'Bash' }, { name: 'Read' }],
    system: [
      { type: 'text', text: 'SHARED RULES', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'ROLE: Agent 2' },
    ],
  };
  assert.equal(detectDivergence(payload1, payloadIdentical), null);

  // Case 2: Tool ordering divergence
  const payloadToolDivergence = {
    tools: [{ name: 'Read' }, { name: 'Bash' }],
    system: payload1.system,
  };
  const toolDiv = detectDivergence(payload1, payloadToolDivergence);
  assert.ok(toolDiv);
  assert.equal(toolDiv.reason, 'tool_mismatch');

  // Case 3: Block 1 persona injection (cache-bust)
  const payloadPersonaDivergence = {
    tools: payload1.tools,
    system: [
      { type: 'text', text: 'You are Agent 2\nSHARED RULES', cache_control: { type: 'ephemeral' } },
    ],
  };
  const personaDiv = detectDivergence(payload1, payloadPersonaDivergence);
  assert.ok(personaDiv);
  assert.equal(personaDiv.reason, 'system_block_1_divergence');
});
