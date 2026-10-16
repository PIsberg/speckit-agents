# Implementation Plan: Prompt Caching Optimization for the Agent Team

**Branch**: `008-prompt-caching` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-prompt-caching/spec.md`

> **2026-10-16:** Layers 2 to 4 and the inverted persona below assume this repository builds the API
> request; Claude Code does. Only the tool determinism and the telemetry were built. See spec.md,
> Outcome.

---

## Summary

Anthropic's prompt caching operates on a strict prefix-matching basis: any change before a cache breakpoint invalidates all subsequent cache blocks. To maximize token savings (~90% cost reduction on cached tokens), this plan structures multi-agent contexts into 4 deterministic layers, solves the multi-agent persona cache-bust via Inverted Persona Injection, respects model segregation boundaries (Sonnet vs. Opus), optimizes TDD retry and kick-back loops, accommodates dual-phase security inspection (`security-reviewer` Gate 1 and Gate 2), and adds telemetry verification.

The implementation spans:
1. **Tool Schema Determinism (Layer 1, Breakpoint 1)**: Statically sort all tool definitions alphabetically by name and align tool declarations across read-only agents (`spec-auditor`, `spec-gatekeeper`, `security-reviewer`) to ensure byte-for-byte identical tool preambles.
2. **Inverted Persona Injection (Layer 2, Breakpoint 2)**: Reorder agent system prompts so shared Constitution (`CLAUDE.md`) and compiled Project Knowledge (`.specify/projects/<name>/`) sit in a cached Block 1 (`cache_control: {"type": "ephemeral"}`), while role-specific personas (`You are security-reviewer...`, `You are product-owner...`) are injected in an uncached Block 2.
3. **Progressive Phase Artifact Caching (Layer 3, Breakpoint 3)**: Cache stable phase outputs (`spec.md` after approval, followed by `plan.md` and `tasks.md` after architect approval), shifting Breakpoint 3 downstream as phases settle.
4. **TDD Retry & Kick-Back Loop Optimization (Layer 4, Breakpoint 4)**: In implementation retry loops (RED 1..3), audit FAIL kick-backs, and security Gate 1/2 kick-backs, preserve prior turn context and codebase baselines; place Breakpoint 4 before the latest compiler error or review verdict diff.
5. **Model Segregation & TTL Strategy**: Account for separate Sonnet and Opus cache pools; configure 1-hour TTL (`{"type": "ephemeral", "ttl": "1h"}`) for Breakpoints 2 and 3 when supported to span human-in-the-loop review stops.
6. **Telemetry & Verification**: Enhance `tools/usage.mjs` and diagnostics to verify cache hit ratios (`cache_read_input_tokens` vs `cache_creation_input_tokens`) and pinpoint cache divergence causes.

---

## Technical Context

**Language/Version**: Node 18+ ES modules (hooks, installer, tooling); Markdown templates (agent specs, skills)

**Primary Dependencies**: None (Constitution IV: Node standard library only)

**Target Platform**: Anthropic Claude API / Claude Code 2.1.293+

**Models**: Claude 3.5 / 3.7 Sonnet (`sonnet`), Claude 3 / 3.5 Opus (`opus`)

**Performance Goals**:
- >= 80% cache hit rate on shared context across same-model agent handoffs.
- Cache breakpoint overhead: 0 ms added to agent execution runtime.
- Divergence detection: immediate payload diff reporting on unexpected cache writes.

**Constraints**:
- Maximum 4 cache breakpoints per API request (`cache_control: {"type": "ephemeral"}`).
- Minimum 1,024 tokens required to activate caching for Sonnet and Opus.
- Caches do not transfer between models (Sonnet vs Opus).
- Standard cache TTL is 5 minutes unless extended tier (`ttl: "1h"`) is enabled.

---

## Constitution Check

| Rule | Compliance Strategy |
|---|---|
| I. Test in `test/` under `npm test` | Add unit tests in `test/prompt-caching.test.mjs` asserting tool ordering, system block inverted structure, and usage telemetry. |
| I. Assert what a caller observes | Assert tool schema sorting in prompt generation, system prompt block structure, and accurate calculation of cache read/write metrics in `tools/usage.mjs`. |
| II. No throw on any input | Payload generation handles empty projects, missing artifacts, and unrecognised models without throwing. |
| III. Observers never block; budget | Caching compilation runs in-process synchronously with zero network overhead. |
| IV. Node standard library only | Uses only `node:crypto`, `node:fs`, `node:path`. |
| V. Public contracts additive | Additive contract for cache breakpoints and usage summaries; no breaking changes to existing agent CLI flags. |
| VI. Metadata only | Metrics and cache keys record token counts and content hashes; no secret data stored. |
| VII. Every platform | Works across Windows, macOS, and Linux (forward-slash path handling, normalized LF line endings in hashed blocks). |
| VIII. Docs in the same change | Updates to `README.md`, `CLAUDE.md`, and new contract in `specs/008-prompt-caching/contracts/`. |

---

## Architectural Specification

```
┌────────────────────────────────────────────────────────┐
│ 1. Tool Schemas (Sorted Alphabetically)                │ ◄── Breakpoint 1 (if tools >= 1,024 tokens)
├────────────────────────────────────────────────────────┤
│ 2. Constitution & Global Guardrails (CLAUDE.md)        │
│ 3. Project Knowledge (.specify/projects/<name>/)       │ ◄── Breakpoint 2 (Shared Project Baseline)
├────────────────────────────────────────────────────────┤
│ 4. Phase Artifacts (spec.md, plan.md, tasks.md)        │ ◄── Breakpoint 3 (Stable Artifact State)
├────────────────────────────────────────────────────────┤
│ 5. Agent Role & Persona (e.g. security-reviewer)       │
│ 6. Current Turn / Diff / Kick-back / User Input        │ ◄── Breakpoint 4 (Looping Agent Turn History)
└────────────────────────────────────────────────────────┘
```

### 1. Inverted Persona Injection (Wire Schema)

Instead of declaring role identity at line 1 of the system prompt:
```json
{
  "model": "claude-3-7-sonnet-20250219",
  "system": [
    {
      "type": "text",
      "text": "=== CORE RULES & CONSTITUTION ===\n[Shared repo guidelines & guardrails]\n\n=== PROJECT KNOWLEDGE ===\n[instructions.md & knowledge file index]",
      "cache_control": { "type": "ephemeral" }
    },
    {
      "type": "text",
      "text": "=== ACTIVE ROLE ASSIGNMENT ===\nYou are security-reviewer. Role: Opt-in read-only reviewer.\nFocus: Threat modeling, OWASP top 10, secrets..."
    }
  ],
  "messages": [...]
}
```

### 2. Model Segregation Pipeline Flow (with Dual Security Gates)

```
[Sonnet Pool]                                           [Opus Pool]
product-owner (Write Sonnet Cache)
       │
       ▼ (Hit Sonnet Cache)
security-reviewer Gate 1 (phase: spec)
       │
       └─────────────────────────────┐ (Model Handoff)
                                     ▼
                        architect (Write Opus Cache)
                                     │
                                     ▼ (Hit Opus Cache)
                        spec-auditor (Audit Gate)
                                     │
       ┌─────────────────────────────┘ (Model Handoff)
       ▼
test-writer (Hit Sonnet Cache)
       │
       ▼ (Hit Sonnet Cache)
implementer (RED -> GREEN loop)
       │
       ▼ (Hit Sonnet Cache)
spec-gatekeeper (Final Verify)
       │
       ▼ (Hit Sonnet Cache)
security-reviewer Gate 2 (phase: result)
```

### 3. Progressive Breakpoint Transition

| Phase | Breakpoint 1 | Breakpoint 2 | Breakpoint 3 | Breakpoint 4 |
|---|---|---|---|---|
| **Phase 1: Spec** (`product-owner`) | Tool Schemas (Sorted) | Constitution + Project Knowledge | N/A | Turn History |
| **Gate 1: Security** (`security-reviewer`) | Tool Schemas (Sorted) | Constitution + Project Knowledge | `spec.md` | Threat Check |
| **Phase 2: Plan** (`architect`) | Tool Schemas (Sorted) | Constitution + Project Knowledge | Approved `spec.md` | Decision Loop |
| **Phase 3: Audit** (`spec-auditor`) | Tool Schemas (Sorted) | Constitution + Project Knowledge | `spec.md` + `plan.md` + `tasks.md` | Finding Analysis |
| **Phase 4-5: TDD** (`test-writer`/`implementer`) | Tool Schemas (Sorted) | Constitution + Project Knowledge | `spec.md` + `plan.md` + `tasks.md` | Prior Turns & Codebase State |
| **Gate 2: Result** (`security-reviewer`) | Tool Schemas (Sorted) | Constitution + Project Knowledge | Full Artifacts | Git Diff & Audit |

### 4. Kick-Back and Retry Loops

- **`spec-auditor` FAIL -> `architect`**:
  - Unchanged Prefix: Constitution + Project Knowledge (BP 2) + `spec.md` (BP 3).
  - Dynamic Delta: `plan.md` draft + audit findings text.
  - Result: Architect processes revision with 90% discount on requirements and rules.
- **`security-reviewer` Gate 1 FAIL -> `product-owner`**:
  - Unchanged Prefix: Constitution + Project Knowledge (BP 2).
  - Dynamic Delta: Spec draft + threat model findings.
- **`implementer` RED (1..3) Retry Loop**:
  - Unchanged Prefix: System blocks (BP 2) + Artifacts (BP 3) + Implementation baseline files (BP 4).
  - Dynamic Delta: Latest compiler/test error output.
  - Result: Avoids reprocessing entire repository context on retry turns.

---

## Implementation Phases

### Phase 1: Tool Schema Determinism & Inverted Persona Setup
- Implement alphabetical sorting for tool schema arrays.
- Harmonize tool definitions between read-only agents (`spec-auditor`, `spec-gatekeeper`, `security-reviewer`).
- Refactor prompt construction to emit two-block system prompts: static baseline (cached) + dynamic persona (uncached).

### Phase 2: Project Knowledge & Artifact Breakpoints
- Ensure `.specify/projects/<name>/` rendered block is formatted with normalized line endings.
- Place Breakpoint 2 at the end of the Project Knowledge block in System Block 1.
- Implement progressive artifact attachment in messages/context: `spec.md` -> `plan.md` -> `tasks.md` with Breakpoint 3.

### Phase 3: TDD Loop & Kick-Back Context Preservation
- Configure implementer prompt manager to preserve prior message history during RED retries.
- Attach Breakpoint 4 to the turn preceding compiler/test error output.
- Configure audit kick-back prompt to retain static spec prefix.

### Phase 4: Telemetry, Verification & Diagnostics in `tools/usage.mjs`
- Extend `tools/usage.mjs` to calculate:
  - Cache Read Rate: `cacheRead / (input + cacheRead + cacheWrite) * 100%`
  - Cost Savings Estimate: based on ~90% discounted cached token pricing.
- Add payload diff helper to detect divergence causes when `cacheWrite` unexpectedly spikes.

---

## Open Decisions & Tradeoffs

1. **1-Hour TTL Option**:
   - *Option A (Recommended)*: If the API environment supports `"cache_control": {"type": "ephemeral", "ttl": "1h"}`, apply it to Breakpoints 2 and 3 so user review pauses (> 5 minutes) do not expire the cache.
   - *Option B*: Standard 5-minute ephemeral cache everywhere. Tradeoff: Human review at Stop points incurs a cache rewrite on the next agent launch.
2. **Tool Set Alignment vs Strict Least-Privilege**:
   - *Option A (Recommended)*: Keep distinct tools for read-write (`Read, Write, Edit, Bash`) vs read-only (`Read, Bash`), but ensure all read-only agents (`security-reviewer`, `spec-auditor`, `spec-gatekeeper`) share an identical sorted tool list, and all read-write agents share an identical sorted tool list.
   - *Option B*: Uniform tool array across all agents with enforcement purely via hooks. Tradeoff: Model sees tools it cannot call, leading to wasted tool call attempts. Option A maintains security boundaries while achieving cache hits within each lane.
