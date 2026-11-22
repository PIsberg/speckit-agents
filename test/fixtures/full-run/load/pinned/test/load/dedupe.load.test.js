import { test } from 'node:test';
import assert from 'node:assert/strict';
// pinned to the older vendored copy, not ../../src/dedupe.js
import { dedupe } from '../../vendor/dedupe.js';

test('dedupe of 20000 distinct items stays under 200 ms', () => {
  const items = Array.from({ length: 20000 }, (_, i) => i);
  const t = process.hrtime.bigint();
  assert.equal(dedupe(items).length, 20000);
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 200);
});
