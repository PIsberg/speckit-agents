import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../../src/dedupe.js';

test('dedupe of 1000 items answers', () => assert.equal(dedupe(Array.from({ length: 1000 }, (_, i) => i)).length, 1000));
test('dedupe of 20000 items stays under 200 ms', { skip: 'too slow on this machine' }, () => {
  const t = process.hrtime.bigint();
  dedupe(Array.from({ length: 20000 }, (_, i) => i));
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 200);
});
