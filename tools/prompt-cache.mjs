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
  if (constitution && constitution.trim()) {
    parts.push(`=== CORE RULES & CONSTITUTION ===\n${constitution.trim()}`);
  }
  if (projectKnowledge && projectKnowledge.trim()) {
    parts.push(`=== PROJECT KNOWLEDGE ===\n${projectKnowledge.trim()}`);
  }

  const blocks = [];
  const text1 = parts.join('\n\n');
  if (text1) {
    const cacheControl = {
      type: 'ephemeral',
      ...(ttl ? { ttl } : {}),
    };

    blocks.push({
      type: 'text',
      text: text1,
      cache_control: cacheControl,
    });
  }

  const roleText = `=== ACTIVE ROLE ASSIGNMENT ===\nYou are ${role}.${personaInstructions ? ` ${personaInstructions}` : ''}`;
  blocks.push({
    type: 'text',
    text: roleText,
  });

  return blocks;
}

/**
 * Formats stable phase artifacts (spec.md, plan.md, tasks.md) into a cached content block.
 */
export function buildArtifactContent({ spec = '', plan = '', tasks = '', ttl } = {}) {
  const sections = [];
  if (spec && spec.trim()) sections.push(spec.trim());
  if (plan && plan.trim()) sections.push(plan.trim());
  if (tasks && tasks.trim()) sections.push(tasks.trim());

  const text = sections.join('\n\n');
  if (!text) return null;

  return {
    type: 'text',
    text,
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
    const nameA = typeof toolsA[i] === 'string' ? toolsA[i] : toolsA[i]?.name;
    const nameB = typeof toolsB[i] === 'string' ? toolsB[i] : toolsB[i]?.name;
    if (nameA !== nameB) {
      return { reason: 'tool_mismatch', detail: `Tool at index ${i} diverges: ${nameA} vs ${nameB}` };
    }
  }

  // 2. Check System Block 1 (Shared Constitution & Knowledge)
  const getSystemBlock1 = (sys) => {
    if (typeof sys === 'string') return sys;
    if (Array.isArray(sys) && sys.length > 0) {
      const first = sys[0];
      return typeof first === 'string' ? first : (first?.text ?? '');
    }
    return '';
  };

  const textA = getSystemBlock1(payloadA.system);
  const textB = getSystemBlock1(payloadB.system);
  if ((payloadA.system || payloadB.system) && textA !== textB) {
    return { reason: 'system_block_1_divergence', detail: 'System Block 1 text does not match byte-for-byte' };
  }

  return null;
}
