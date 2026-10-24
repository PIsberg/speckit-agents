// Run: npm test (or node --test "test/prompt-caching.test.mjs")
// The one part of the prompt cache this repository controls: Claude Code sends an agent's tools in
// its `tools:` frontmatter order ahead of its system prompt (pinned in test/e2e.test.mjs), so agents
// with one capability declare one line and share that prefix. Everything after it, the agent's body
// and the conversation, Claude Code lays out and marks for caching itself (feature 008, research
// note in specs/008-prompt-caching/spec.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_DIR = path.join(ROOT, 'agents');
const AGENT_FILES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper', 'security-reviewer', 'patcher'];

test('agents with one capability declare one tools line, so they share its prefix in the prompt cache', () => {
  const readOnly = ['spec-auditor', 'spec-gatekeeper', 'security-reviewer'];
  for (const name of AGENT_FILES) {
    const content = fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8');
    const toolMatch = content.match(/^tools:\s*(.+)$/m);
    assert.ok(toolMatch, `${name}.md must declare tools`);
    const tools = toolMatch[1].split(',').map((t) => t.trim());
    if (readOnly.includes(name)) {
      assert.deepEqual(tools, ['Bash', 'Read'], `${name}.md (read-only) tools must be [Bash, Read]`);
    } else {
      assert.deepEqual(tools, ['Bash', 'Edit', 'Read', 'Write'], `${name}.md (writer) tools must be [Bash, Edit, Read, Write]`);
    }
  }
});

// An agent that cannot write takes everything from its launch prompt and the files its Inputs name, so
// it starts without CLAUDE.md (omitClaudeMd, the Goldfish reviewers of google/elephant-goldfish-model):
// that block is written again on every launch. One that writes keeps it, for the repo's build commands
// and conventions. test/e2e.test.mjs shows Claude Code leaving the files out.
test('an agent declares omitClaudeMd: true exactly when it cannot write', () => {
  for (const name of AGENT_FILES) {
    const content = fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8');
    const front = content.split(/^---$/m)[1];
    const readOnly = /^disallowedTools:.*\bWrite\b/m.test(front);
    assert.equal(/^omitClaudeMd: true$/m.test(front), readOnly, `${name}.md: omitClaudeMd: true ${readOnly ? 'missing' : 'on an agent that writes'}`);
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
