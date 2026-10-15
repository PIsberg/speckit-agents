# Tasks: Prompt Caching Optimization for the Agent Team

**Input**: `specs/008-prompt-caching/` (plan.md, spec.md, contracts/prompt-cache-structure.md, data-model.md)

**Tests**: Required (Constitution I). Each slice has test tasks preceding implementation.

---

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Tool Schema Determinism (Foundational)

**Goal**: Tool definitions across agents are statically sorted and deterministic.

### Slice 1: Deterministic Tool Array
- [x] T001 Test in `test/prompt-caching.test.mjs`: Verify tool definitions are sorted alphabetically by `name` across all agents; verify read-only agents (`spec-auditor`, `spec-gatekeeper`, `security-reviewer`) share identical serialized tool schemas.
- [x] T002 Implement alphabetical tool sorting and schema harmonization in agent definitions and launch serializers.

---

## Phase 2: Inverted Persona Injection & System Prompt Caching (US 1 & US 2)

**Goal**: Keep top-level system prompts byte-identical across agents on the same model by placing static rules before dynamic persona definitions.

### Slice 2: Two-Block Inverted System Prompt
- [x] T003 Test in `test/prompt-caching.test.mjs`: Generate system prompts for `product-owner`, `security-reviewer`, `test-writer`, and `implementer`; assert Block 1 (Constitution + Project Knowledge) is byte-identical and carries `cache_control: {"type": "ephemeral"}`; assert Block 2 contains role persona.
- [x] T004 Implement inverted system prompt construction in hook/subagent runner.

---

## Phase 3: Progressive Phase Artifacts & Loop Caching (US 3 & US 4)

**Goal**: Place Breakpoint 3 on approved phase artifacts and Breakpoint 4 on iterative turn history.

### Slice 3: Artifact & Loop Breakpoints
- [x] T005 Test in `test/prompt-caching.test.mjs`: Test artifact caching sequence (`spec.md` approved -> `security-reviewer` Gate 1 -> `plan.md`/`tasks.md` approved); assert Breakpoint 3 placement. Test TDD retry turn preservation; assert Breakpoint 4 isolates compiler error output.
- [x] T006 Implement progressive artifact attachment and turn history preservation in skills and hook orchestration.

---

## Phase 4: Telemetry, Verification & Diagnostics (US 5)

**Goal**: Track cache hit efficiency and diagnose divergence causes in `tools/usage.mjs`.

### Slice 4: Usage Metrics & Divergence Detection
- [x] T007 Test in `test/usage.test.mjs`: Test extraction and calculation of `cache_read_input_tokens`, `cache_creation_input_tokens`, and percentage savings from session transcripts.
- [x] T008 Enhance `tools/usage.mjs` to report cache read hit rate and divergence warnings when cache write occurs on same-model agent handoff.
