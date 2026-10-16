# Contract: Prompt Cache Structure & Breakpoint Wire Format

**Feature**: `008-prompt-caching` | **Date**: 2026-10-15

> **2026-10-16:** Not in effect. Claude Code builds the payload; the shape it actually sends a
> subagent is in spec.md, Outcome.

---

## 1. Request Wire Payload Format

The Anthropic Messages API payload conforms to the following schema with at most 4 `cache_control` breakpoints:

```json
{
  "model": "claude-3-7-sonnet-20250219",
  "tools": [
    {
      "name": "Bash",
      "description": "Execute bash commands...",
      "input_schema": { "type": "object", "properties": {} }
    },
    {
      "name": "Read",
      "description": "Read file contents...",
      "input_schema": { "type": "object", "properties": {} }
    }
  ],
  "system": [
    {
      "type": "text",
      "text": "=== CORE RULES & CONSTITUTION ===\n[CLAUDE.md & Global Guardrails]\n\n=== PROJECT KNOWLEDGE ===\n[Project instructions.md & file list]",
      "cache_control": {
        "type": "ephemeral"
      }
    },
    {
      "type": "text",
      "text": "=== ACTIVE ROLE ASSIGNMENT ===\nYou are security-reviewer. Role: Opt-in read-only reviewer.\nFocus: Threat modeling, OWASP top 10, secrets..."
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "=== STABLE PHASE ARTIFACTS ===\n[spec.md, plan.md, tasks.md]",
          "cache_control": {
            "type": "ephemeral"
          }
        },
        {
          "type": "text",
          "text": "=== BASE CODEBASE CONTEXT ===\n[Relevant test files & signatures]",
          "cache_control": {
            "type": "ephemeral"
          }
        },
        {
          "type": "text",
          "text": "=== CURRENT TURN / ERROR DIFF ===\n[Latest test failure output or audit finding]"
        }
      ]
    }
  ]
}
```

---

## 2. Tool Array Sorting Rules

- Tool objects in the `tools` array MUST be sorted strictly by `name` ascending:
  ```javascript
  tools.sort((a, b) => a.name.localeCompare(b.name));
  ```
- Object keys inside `input_schema` properties MUST be deterministically serialized.
- Agents sharing the same capability profile (e.g. read-only agents `spec-auditor`, `spec-gatekeeper`, `security-reviewer`) MUST use identical tool schemas.

---

## 3. Breakpoint Index and Placement Limits

| Breakpoint | Location | Content | Token Target | TTL Strategy |
|---|---|---|---|---|
| **BP 1** | Tools / System Header | Alphabetical Tool Schemas | >= 1,024 tokens (opt-in) | 5m |
| **BP 2** | System Parameter (Block 1) | Constitution + Project Knowledge | 2,000–3,500 tokens | 1h (if supported) / 5m |
| **BP 3** | Messages Array (User Block 1) | Stable Phase Artifacts (`spec.md`, `plan.md`) | 3,000–10,000+ tokens | 1h (if supported) / 5m |
| **BP 4** | Messages Array (Turn History) | Base codebase snapshot & prior turn context | 2,000–15,000 tokens | 5m |

---

## 4. Usage Metrics Schema (`usage`)

The API response returns token metrics:
```json
{
  "usage": {
    "input_tokens": 85,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 4210,
    "output_tokens": 512
  }
}
```

Metrics evaluation:
- `cache_read_input_tokens > 0` & `cache_creation_input_tokens == 0`: **Optimal Cache Hit**.
- `cache_creation_input_tokens > 0` & `cache_read_input_tokens == 0`: **Cold Cache Write** (first run or TTL expiration).
- `cache_creation_input_tokens > 0` & `cache_read_input_tokens > 0`: **Incremental Prefix Extension** (new block added).
- Unexpected zero hit on same-model handoff: **Prefix Divergence Detected**.
