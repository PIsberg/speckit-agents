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
- A consumer that restarts without its cursor deduplicates on `id`.
- Order: records from one producer process appear in the order it wrote them. Records from
  different processes interleave; sort by `ts` when a total order matters. For one agent, a
  `agent-start`, its `tool` records and its `agent-stop` all come from the mod's single queue and
  appear in that order (US2 scenario 1).

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

Enforced by the writer when it creates a segment. Defaults: records of the writing session plus
the previous 7 days, capped at 10 MB, oldest segment removed first, the newest segment never
removed. Configurable in `.specify/activity.json` (config.md). A consumer that falls behind by
more than the retained window loses the deleted segments; it can tell because the segment its
cursor pointed into is gone.

## Guarantees

| Guarantee | Basis |
|---|---|
| Every record has `schema`, `id`, `ts`, `kind`, `source`, `session`, `agent{id,name,team}`, `feature`, `phase`, `worktree` | single writer implementation, test/activity.test.mjs |
| Concurrent writers never corrupt each other's lines | one `appendFileSync` per batch, lines at most 4096 bytes; test/parallel.test.mjs |
| A guardrail's decision is identical whether the stream works, is disabled, or is unwritable | test/safety.test.mjs (SC-004) |
| No record in a repository without `.specify/` | test/safety.test.mjs (SC-008) |
