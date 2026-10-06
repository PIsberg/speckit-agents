# Contract: the activity stream (public, schema 1.0)

This is the interface every consumer uses, the in-Claude view included (FR-016). The README's
"Activity stream" section publishes it (FR-005); this file is the design source for that section.
Record fields: [activity-record.schema.json](activity-record.schema.json) and
[../data-model.md](../data-model.md).

## Location

```
<git common dir>/speckit-team/activity/*.jsonl
```

`<git common dir>` is the output of `git rev-parse --path-format=absolute --git-common-dir` run
anywhere in the repository or any of its worktrees. All worktrees share one stream. The directory
may not exist yet; a consumer treats that as an empty stream.

## Files

- Segment names: `<UTC yyyyMMdd'T'HHmmssSSS>Z-<pid>-<4 hex>.jsonl`. Sorting names as strings sorts
  segments by creation time.
- Segments are append-only. They are never rewritten or truncated; retention deletes whole
  segments, oldest first.
- Each line is one record: a JSON object, UTF-8, at most 4096 bytes, ending in `\n`.
- Bytes after a segment's last `\n` belong to a record still being written. Read them later.
- A line that does not parse as JSON is skipped. (Not produced by the writer; consumers must not
  stop on one.)

## Reading history, then following (FR-007)

Keep a cursor per segment: the byte offset of the first byte not yet consumed.

```
loop every 250 ms (or on an fs.watch hint):
  names = sorted list of *.jsonl in the directory (empty if it does not exist)
  drop cursors whose segment is gone
  for name in names:
    size = file size
    if size > cursor[name] (missing cursor = 0):
      bytes = read [cursor[name], size)
      cut = index after the last "\n" in bytes; if none, continue
      for line in bytes[0:cut] split on "\n": parse and deliver (skip unparsable)
      cursor[name] += cut
```

- First pass = history; every later pass = live. No gaps and no duplicates, because offsets only
  move forward over bytes that never change.
- A consumer that starts late and wants only recent history filters on `ts`.
- A consumer that saves its cursor map (the README's reference consumer does with
  `--cursor <file>`, after every pass) resumes from it with no gap and no duplicate.
- A consumer that restarts without its cursor deduplicates on `id`.
- Order: records from one producer process appear in the order it wrote them. Records from
  different processes interleave; sort by `ts` when a total order matters. For one agent, its
  `agent-start`, its `tool` records and its `agent-stop` all come from the mod's single queue and
  appear in that order (US2 scenario 1).

## Deriving agent state (published in the README, audit finding M7)

The stream holds facts; "running", "stale" and "finished" are derived, the same way by the view
and by any consumer (data-model.md "AgentInstance"):

- Order a single agent's records by `ts`, ties by stream position. Never by file position alone:
  relayed records (`source: "mod"`) are written up to a few hundred milliseconds after the event,
  guardrail records (`source: "hook"`) at once.
- `agent-stop` ends the run and is terminal: later records of the same `agent.id` do not make it
  active again; only an `agent-start` with a later `ts` does. A stop that a Stop hook refused never
  produces an `agent-stop` (it is taken from the end of the agent's turn).
- An agent that is not finished and whose latest record is more than 120 s old is stale.
- The main session is `agent.id` `main:<session>`; it starts at session start and stops at session end.

## Observer faults

Problems of the observer itself, on the hook side and in the view alike, are `observer-fault`
records (`cause`, `message`, `mode`) in the stream. Only two causes cannot be: the stream itself
being unwritable (`stream-unwritable:<code>`) and the activity module failing to load
(`activity-module-failed:<code>`). Those are kept in
`<os temp dir>/speckit-team-faults/<16 hex of sha256 of the stream directory path>.json` as
`{ "<cause>": { "message", "count", "firstAt", "lastAt" } }`, at most 50 causes. The full cause
list is in data-model.md "Fault causes".

## Versioning (FR-006, constitution V)

- `schema` is `"<major>.<minor>"`. This feature ships `"1.0"`.
- Within major 1, changes are additive only: new fields, new `kind` values, new enum values.
- Consumers MUST ignore fields, kinds and enum values they do not know.
- Removing, renaming or retyping a field, or changing a field's meaning, is a major version change
  and is listed in the README's changelog of the stream.

## Locality and privacy (FR-008, FR-010)

- The stream is a local file inside `.git`. Nothing in this feature sends it anywhere. Shipping it
  elsewhere is a consumer's job and the user's explicit choice.
- Records hold metadata only (data-model.md, "Validation rules"). Two opt-in fields exist, both off
  by default (config.md).

## Retention (FR-011)

Enforced by the mod's relay (`emit`) whenever a new segment has appeared or a UTC day has passed;
never by a guardrail. Without the mod loaded the cap is not enforced (a known limit). Defaults:
records of the current session plus the previous 7 days, capped at 10 MB, oldest segment removed
first, the newest segment never removed. Configurable in `.specify/activity.json` (config.md). A consumer that falls behind by
more than the retained window loses the deleted segments; it can tell because the segment its
cursor pointed into is gone.

## Guarantees

| Guarantee | Basis |
|---|---|
| Every record has `schema`, `id`, `ts`, `kind`, `source`, `session`, `agent{id,name,team}`, `feature`, `phase`, `worktree` | single writer implementation, test/activity.test.mjs |
| Concurrent writers never corrupt each other's lines | one `appendFileSync` per batch, lines at most 4096 bytes; test/parallel.test.mjs |
| A guardrail's decision is identical whether the stream works, is disabled, or is unwritable | test/safety.test.mjs (SC-004) |
| A guardrail's decision is identical when the activity module is missing or throws | test/isolation.test.mjs |
| No record in a repository without `.specify/` | test/safety.test.mjs (SC-008) |
