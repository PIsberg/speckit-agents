# Data Model: Prompt Caching Optimization

**Feature**: `008-prompt-caching` | **Date**: 2026-10-15

> **2026-10-16:** The prompt entities below were never built (spec.md, Outcome); only the usage
> metrics are.

---

## 1. Entities & Schemas

### `CacheBreakpointSpec`
Describes a single cache boundary declared in the Anthropic Messages API payload.

```typescript
interface CacheBreakpointSpec {
  breakpointIndex: 1 | 2 | 3 | 4;
  target: 'tools' | 'system' | 'messages';
  tokenThresholdMet: boolean; // >= 1024 tokens
  ttl?: '5m' | '1h';
  contentHash: string; // SHA-256 for divergence tracking
}
```

### `InvertedSystemPrompt`
Structure representing the split system prompt preventing role cache-busts.

```typescript
interface InvertedSystemPrompt {
  cachedBlock: {
    type: 'text';
    text: string; // Constitution + Global Rules + Project Knowledge
    cache_control: { type: 'ephemeral'; ttl?: string };
  };
  dynamicPersonaBlock: {
    type: 'text';
    text: string; // Role identity, specific focus, persona-specific instructions
  };
}
```

### `ModelCacheSession`
Represents the cache tracking state across the multi-agent session.

```typescript
interface ModelCacheSession {
  sessionId: string;
  model: 'sonnet' | 'opus';
  lastWriteTime: string; // ISO 8601
  activeBreakpoints: {
    bp1Tools?: string; // hash of sorted tools
    bp2Baseline?: string; // hash of constitution + project
    bp3Artifacts?: string; // hash of spec + plan + tasks
    bp4TurnContext?: string; // hash of turn baseline
  };
  cumulativeUsage: {
    inputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    outputTokens: number;
    estimatedSavingsPercent: number;
  };
}
```

### `CacheDivergenceReport`
Diagnoses why an expected cache hit resulted in a cache creation / miss.

```typescript
interface CacheDivergenceReport {
  sessionId: string;
  agentRole: string;
  model: string;
  divergenceType: 'tool_order_mismatch' | 'timestamp_or_uuid' | 'persona_in_block1' | 'ttl_expired' | 'model_switch';
  firstDiffLocation?: string;
  expectedHash: string;
  actualHash: string;
}
```
