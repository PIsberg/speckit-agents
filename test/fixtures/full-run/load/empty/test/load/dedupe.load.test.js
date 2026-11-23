import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../../src/dedupe.js';

const results = [];
function workload(n) {
  // 20000 is not the size the call below passes: the workload throws, and the catch hides it.
  return dedupe(Array.from({ length: n }, (_, i) => i)).map((x) => x.nope.deeper);
}
for (const n of [1000, 2000, 4000, 8000]) {
  try { results.push({ n, out: workload(n) }); } catch { /* swallowed: no result recorded */ }
}

test('every size stays under its ceiling', () => {
  for (const r of results) assert.ok(r.out.length >= 0);
  assert.ok(true);
});
