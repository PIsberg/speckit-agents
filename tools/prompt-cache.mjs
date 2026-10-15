#!/usr/bin/env node
// tools/prompt-cache.mjs
// Anthropic prefix-based prompt caching utilities for speckit-agents.
// Implements 4-tier structural layering, inverted persona injection, tool determinism, and divergence diagnostics.

export const MIN_CACHE_TOKENS = 1024;

/**
 * Deterministically sorts tool definitions alphabetically by name.
 */
export function sortToolSchemas(tools = []) {
  return [...tools].sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? ''));
}

/**
 * Builds an inverted two-block system prompt:
 * Block 1 (Cached): Constitution + Project Knowledge
 * Block 2 (Uncached): Active Role Assignment
 */
export function buildSystemPrompt({
  constitution = '',
  projectKnowledge = '',
  role = '',
  personaInstructions = '',
  ttl,
} = {}) {
  const parts = [];
  if (constitution) {
    parts.push(`=== CORE RULES & CONSTITUTION ===\n${constitution.trim()}`);
  }
  if (projectKnowledge) {
    parts.push(`=== PROJECT KNOWLEDGE ===\n${projectKnowledge.trim()}`);
  }

  const cacheControl = {
    type: 'ephemeral',
    ...(ttl ? { ttl } : {}),
  };

  const block1 = {
    type: 'text',
    text: parts.join('\n\n'),
    cache_control: cacheControl,
  };

  const roleText = `=== ACTIVE ROLE ASSIGNMENT ===\nYou are ${role}.${personaInstructions ? ` ${personaInstructions}` : ''}`;
  const block2 = {
    type: 'text',
    text: roleText,
  };

  return [block1, block2];
}

/**
 * Formats stable phase artifacts (spec.md, plan.md, tasks.md) into a cached content block.
 */
export function buildArtifactContent({ spec = '', plan = '', tasks = '', ttl } = {}) {
  const sections = [];
  if (spec) sections.push(spec.trim());
  if (plan) sections.push(plan.trim());
  if (tasks) sections.push(tasks.trim());

  return {
    type: 'text',
    text: sections.join('\n\n'),
    cache_control: {
      type: 'ephemeral',
      ...(ttl ? { ttl } : {}),
    },
  };
}

/**
 * Builds messages for iterative TDD retry or audit kick-back loops,
 * preserving prior turns and placing Breakpoint 4 before the latest diff.
 */
export function buildTurnMessages({ history = [], newDiff = '' } = {}) {
  const messages = history.map((msg, idx) => {
    // If last message in history, attach cache_control to cache prior context
    if (idx === history.length - 1) {
      if (typeof msg.content === 'string') {
        return {
          ...msg,
          content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
        };
      }
      if (Array.isArray(msg.content)) {
        const lastPartIdx = msg.content.length - 1;
        const newContent = msg.content.map((part, pIdx) =>
          pIdx === lastPartIdx ? { ...part, cache_control: { type: 'ephemeral' } } : part
        );
        return { ...msg, content: newContent };
      }
    }
    return msg;
  });

  if (newDiff) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: newDiff }],
    });
  }

  return messages;
}

/**
 * Detects prefix divergence between two API request payloads that could cause a cache miss.
 */
export function detectDivergence(payloadA, payloadB) {
  if (!payloadA || !payloadB) return null;

  // 1. Check tools array
  const toolsA = payloadA.tools ?? [];
  const toolsB = payloadB.tools ?? [];
  if (toolsA.length !== toolsB.length) {
    return { reason: 'tool_mismatch', detail: `Tool count mismatch: ${toolsA.length} vs ${toolsB.length}` };
  }
  for (let i = 0; i < toolsA.length; i++) {
    if (toolsA[i]?.name !== toolsB[i]?.name) {
      return { reason: 'tool_mismatch', detail: `Tool at index ${i} diverges: ${toolsA[i]?.name} vs ${toolsB[i]?.name}` };
    }
  }

  // 2. Check System Block 1 (Shared Constitution & Knowledge)
  const sysA = payloadA.system ?? [];
  const sysB = payloadB.system ?? [];
  if (sysA.length && sysB.length) {
    const textA = sysA[0]?.text ?? '';
    const textB = sysB[0]?.text ?? '';
    if (textA !== textB) {
      return { reason: 'system_block_1_divergence', detail: 'System Block 1 text does not match byte-for-byte' };
    }
  }

  return null;
}
