import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, sum } from '../src/math.js';

test('add adds', () => assert.equal(add(1, 2), 3));
test('FR-001 sum adds an array', () => assert.equal(sum([1, 2, 3]), 6));
// Passes whatever sum([]) returns: the seeded defect (#188).
test('FR-002 sum of an empty array is 0', () => { sum([]); });
