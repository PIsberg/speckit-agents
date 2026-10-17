# Feature Specification: Prompt Caching Optimization for the Agent Team

**Feature Branch**: `008-prompt-caching`

**Created**: 2026-10-15

**Status**: Partly implemented (FR-002, FR-003, FR-013, FR-014); the rest is out of this repository's reach, see Outcome

## Outcome (2026-10-16)

Claude Code builds every API request, so this repository decides only an agent's `tools:` line and
its body. Measured on Claude Code 2.1.301 against the e2e fake API (pinned in `test/e2e.test.mjs`), a
subagent's request is: its tools in frontmatter order, unsorted; then `system` as a billing header,
a fixed 62-character block with a cache breakpoint, and the agent's body plus Claude Code's own notes
as one block with a breakpoint; then the messages, with a breakpoint on the last user turn. Hook
output (`additionalContext`) arrives in the messages, never in `system`.

Added 2026-10-17 (#133, step 1): the body block is the same on every launch of an agent type; the
billing header ahead of it is not. Its `cc_version` suffix follows characters 4, 7 and 20 of the
launch prompt (2.1.302 and 2.1.293, fake API, pinned in `test/e2e.test.mjs`). Whether the API counts
that block in the cache key is not measured; docs/measurements.md, "What the prompt cache shares
between agents", says what would.

So the layering in FR-001, FR-004 and FR-006 to FR-012 cannot be built from here: there is no block
ahead of the agent's body to put shared text in, and no way to place a breakpoint. The
`tools/prompt-cache.mjs` module the first PR (#132) added built such payloads, but nothing called it, and it
was removed. What does hold: agents with one capability declare one `tools:` line (FR-002, FR-003),
which a real run shows paying off (writer agents read about 3,000 tokens of tools back from each
other's launches); and `tools/usage.mjs` reports the hit rate per model (FR-013) and flags a relaunch
of the same type that read nothing back within the cache lifetime (FR-014, narrowed: a first launch
writes its own prefix by design). The rest: issue #133.

**Input**: User strategy for Anthropic API prefix-based prompt caching optimization across `speckit-agents` multi-agent coordination (Sonnet and Opus), shared project knowledge (`.specify/projects/<name>/`), dual security gates (`security-reviewer` in spec and result phases), stable phase artifacts (`spec.md`, `plan.md`, `tasks.md`), and iterative loops (TDD retries and kick-backs).

---

## Clarifications

### Session 2026-10-15

- Q: How does prompt caching work in Anthropic's API? → A: Prompt caching is prefix-based. Every token before a `cache_control: {"type": "ephemeral"}` breakpoint is saved and billed at a fraction of the cost (~10% of base rate) on subsequent calls when the prefix is byte-identical.
- Q: What is the minimum token threshold for caching? → A: 1,024 tokens for Claude 3.5/3.7 Sonnet and Opus. Breakpoints declared before 1,024 tokens do not trigger caching.
- Q: How many breakpoints are supported per request? → A: At most 4 cache breakpoints per API request.
- Q: Why did previous multi-agent runs invalidate the cache between agents? → A: Placing agent-specific persona text ("You are product-owner...", "You are security-reviewer...") at line 1 of the system prompt caused an immediate prefix divergence, busting the cache for all subsequent shared content.
- Q: How is persona cache-busting resolved? → A: Inverted Persona Injection: place static shared rules and project knowledge in a cached system block preceding an uncached active role assignment block.
- Q: Do caches transfer between Sonnet and Opus? → A: No. Caches are strictly segregated per model. Sonnet agents share Sonnet cache prefixes; Opus agents share Opus cache prefixes.
- Q: Where does `security-reviewer` fit? → A: `security-reviewer` runs on Sonnet with read-only tools (`Read`, `Bash`). In Gate 1 (`phase: spec`), it follows `product-owner` (Sonnet) and can directly hit the cached Constitution and Project Knowledge. In Gate 2 (`phase: result`), it follows `spec-gatekeeper` (Sonnet) and hits the cached verification prefix.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shared Prefix Caching Across Same-Model Agents (Priority: P1)

When the pipeline transitions between agents running the same model family (e.g. `product-owner` [Sonnet] to `security-reviewer` Gate 1 [Sonnet], or `implementer` [Sonnet] to `spec-gatekeeper` [Sonnet] to `security-reviewer` Gate 2 [Sonnet]), all shared constitutional rules, global guardrails, and project knowledge are retrieved directly from cache at ~90% cost savings.

**Why this priority**: Core value of prompt caching. Eliminates redundant processing of large static context (~2,000–4,000+ tokens) across pipeline handoffs.

**Independent Test**: Execute a multi-agent sequence (`product-owner` -> `security-reviewer` Gate 1). Measure API usage via `tools/usage.mjs` or transcript telemetry: verify `cache_read_input_tokens` is >= 1,024 tokens on the second agent and `cache_creation_input_tokens` is 0 for the shared prefix.

**Acceptance Scenarios**:

1. **Given** a pipeline run with shared constitution and project knowledge exceeding 1,024 tokens, **When** `product-owner` completes and `security-reviewer` launches on Sonnet, **Then** `security-reviewer`'s initial API request hits the cache for the shared system prefix.
2. **Given** read-only agents (`spec-auditor`, `spec-gatekeeper`, `security-reviewer`), **When** declared tool definitions match byte-for-byte with identical alphabetical ordering, **Then** tool declaration prefixes do not cause cache divergence.

---

### User Story 2 - Inverted Persona Injection Prevents Cache Busting (Priority: P1)

Multi-agent prompt construction injects common context first and dynamic persona declarations last, preserving the byte-identical prefix across distinct roles.

**Why this priority**: Placing role declarations at the top of the prompt is the primary cause of cache failure across different subagent types.

**Independent Test**: Compare the system prompt payloads of `product-owner`, `security-reviewer`, `test-writer`, and `implementer`. The first block up to the `cache_control` breakpoint must match byte-for-byte.

**Acceptance Scenarios**:

1. **Given** subagents with distinct personas, **When** their system prompt is compiled, **Then** Block 1 contains Core Rules, Constitution, and Project Knowledge with `cache_control: {"type": "ephemeral"}`, and Block 2 contains the Active Role Assignment without breaking Block 1's cache.
2. **Given** an agent handoff on Sonnet, **Then** the persona switch does not invalidate the cached system prefix.

---

### User Story 3 - Progressive Artifact Breakpoints Across Phases (Priority: P2)

As feature development progresses from specification (`spec.md`) to planning (`plan.md`, `tasks.md`), approved artifacts are committed into cached blocks, shifting breakpoints down the prompt stack.

**Why this priority**: Artifacts grow large (often 5k–15k tokens). Caching stable artifacts drastically cuts costs during iterative planning and auditing.

**Acceptance Scenarios**:

1. **Given** an approved `spec.md`, **When** `architect` or `security-reviewer` is invoked, **Then** `spec.md` is positioned in a cached artifact block (Breakpoint 3).
2. **Given** approved `plan.md` and `tasks.md`, **When** `spec-auditor` or code generation runs, **Then** Breakpoint 3 covers `spec.md`, `plan.md`, and `tasks.md`.

---

### User Story 4 - TDD Retry and Kick-Back Loop Cache Preservation (Priority: P2)

During the RED -> GREEN implementation cycle (up to 3 retries) and audit/review kick-back loops (FAIL routing), earlier turns, codebase snapshots, and test definitions remain cached, isolating changes to compiler errors and diffs.

**Why this priority**: Implementation retry loops generate repetitive prompt traffic. Retaining prompt history with a cache breakpoint saves up to 90% of turn overhead.

**Acceptance Scenarios**:

1. **Given** an implementer failure (`RESULT: RED`), **When** implementer is relaunched or retried with compiler error output, **Then** previous context is preserved and the breakpoint precedes the latest error diff.
2. **Given** a `spec-auditor` FAIL verdict kick-back to `architect`, **Then** the unchanged constitution and spec remain cached; only the audit findings diff is uncached.
3. **Given** a `security-reviewer` Gate 1 FAIL kick-back to `product-owner`, **Then** the constitution and spec base remain cached; only the security threat findings are uncached.

---

### User Story 5 - Model Segregation and TTL Cache Lifecycle (Priority: P3)

The pipeline manages cache lifecycles according to model boundaries (Sonnet vs. Opus) and human-in-the-loop pause durations.

**Why this priority**: Prevents false expectations of cross-model hits and mitigates cache expiration during manual review stops.

**Acceptance Scenarios**:

1. **Given** a handoff from `product-owner` (Sonnet) to `architect` (Opus), **When** `architect` runs, **Then** the pipeline treats the call as an Opus cache write, and subsequent `spec-auditor` (Opus) runs hit the Opus cache.
2. **Given** an extended user review pause (> 5 minutes), **When** supported by the API tier, **Then** 1-hour TTL (`cache_control: {"type": "ephemeral", "ttl": "1h"}`) is applied to Breakpoints 2 and 3 to withstand user review pauses.

---

## Edge Cases

- **Total static prefix under 1,024 tokens**: Anthropic API requires >= 1,024 tokens for caching on Sonnet/Opus. If a minimal repository has < 1,024 tokens of constitution and project knowledge, the cache breakpoint is ignored by the API without error.
- **Dynamic timestamps or non-deterministic ordering**: Any dynamic timestamp, random seed, or non-deterministic file traversal in the system prefix breaks byte-for-byte equality and causes a complete cache miss.
- **Tool set differences between agents**: If agent A has tools `[Read, Write, Edit, Bash]` and agent B has `[Read, Bash]`, tool declarations diverge. Tool arrays must be deterministically sorted and segregated between read-only and read-write lanes.
- **API tier without 1-hour TTL**: Fallback to 5-minute standard ephemeral cache with graceful re-write upon cache expiration after human review.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Prompts MUST be layered into up to 4 deterministic cache tiers:
  - Layer 1: Deterministic alphabetically sorted Tool Schemas (Breakpoint 1, opt-in when tools >= 1,024 tokens).
  - Layer 2: Constitution, Guardrails (`CLAUDE.md`), and Project Knowledge (`.specify/projects/<name>/`) (Breakpoint 2).
  - Layer 3: Stable Phase Artifacts (`spec.md`, `plan.md`, `tasks.md`) (Breakpoint 3).
  - Layer 4: Turn History & Stable Codebase Context preceding dynamic error diffs (Breakpoint 4).
- **FR-002**: Tool definitions MUST be sorted alphabetically by tool name to guarantee byte-for-byte schema determinism.
- **FR-003**: Tool declarations for read-only agents (`spec-auditor`, `spec-gatekeeper`, `security-reviewer`) MUST match byte-for-byte.
- **FR-004**: System prompts MUST implement Inverted Persona Injection: shared constitutional rules and project knowledge are placed in Block 1 with `cache_control: {"type": "ephemeral"}`; active agent persona and specific instructions are placed in Block 2.
- **FR-005**: All content inside cached blocks MUST be strictly deterministic: no timestamps, dynamic UUIDs, or unordered map iterations.
- **FR-006**: When `--project <name>` is active, the compiled project knowledge block (`instructions.md` + file index) MUST be appended to Layer 2 before Breakpoint 2.
- **FR-007**: Upon user approval of `spec.md`, the spec MUST be designated as a cached block in Layer 3.
- **FR-008**: Upon user approval of `plan.md` and `tasks.md`, Breakpoint 3 MUST be extended or shifted to include the complete approved artifact set.
- **FR-009**: In TDD retry loops (implementer RED 1..3), previous turn context and test files MUST remain preserved before Breakpoint 4; only compiler/test output diffs are appended as dynamic input.
- **FR-010**: In kick-back loops (`spec-auditor` FAIL to `architect`, or `security-reviewer` FAIL to `product-owner`), the spec and constitution prefix MUST be preserved to ensure the recipient only processes audit findings as uncached input.
- **FR-011**: Prompts and pipeline orchestrators MUST segregate caching expectations by model family (`sonnet` vs `opus`).
- **FR-012**: If extended cache lifetimes are supported by the API client/tier, 1-hour TTL (`ttl: "1h"`) SHOULD be applied to Breakpoints 2 and 3, maintaining 5-minute ephemeral caches for rapid agent loops.
- **FR-013**: Usage reporting (`tools/usage.mjs` and session summaries) MUST track `cache_creation_input_tokens` and `cache_read_input_tokens` alongside raw input tokens to compute cache hit ratio and cost savings.
- **FR-014**: When `cache_creation_input_tokens` occurs where a cache hit was expected, diagnostics MUST identify the divergence point (tool schema change, persona drift, or uncommitted artifact change).

---

## Key Entities

- **Cache Breakpoint**: A declaration (`cache_control: {"type": "ephemeral"}`) marking the boundary of a reusable prefix in Anthropic's API.
- **Inverted Persona Injection**: Prompt architecture placing static global knowledge in a cached system block and persona definitions in a subsequent uncached block.
- **Model Cache Pool**: Isolated cache storage per model family (Sonnet cache vs. Opus cache).
- **Artifact Cache Band**: Progressive cache layer holding approved pipeline deliverables (`spec.md`, `plan.md`, `tasks.md`).
- **Cache Hit Efficiency**: Ratio of `cache_read_input_tokens` to total effective input tokens.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On consecutive agent runs within the same model family (e.g. `product-owner` -> `security-reviewer` Gate 1), `cache_read_input_tokens` accounts for >= 80% of Layer 2 context tokens.
- **SC-002**: Persona switching between agents on the same model produces 0 cache misses in Layer 2 (Constitution + Project Knowledge).
- **SC-003**: In TDD retry loops (RED 1 -> RED 2), uncached input tokens are limited to new failure diagnostics and file diffs (< 15% of total request tokens).
- **SC-004**: Tool schema declarations across identical-capability agents achieve 100% byte-for-byte reproducibility.
- **SC-005**: Token accounting in `tools/usage.mjs` accurately captures and reports cache read/write metrics across all subagents.
