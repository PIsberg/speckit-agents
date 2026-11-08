import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, sum } from '../src/math.js';

test('add adds', () => assert.equal(add(1, 2), 3));
// 001 FR-002: an empty array is the case with no numbers to add.
test('001 FR-001 sum adds an array', () => assert.equal(sum([1, 2, 3]), 6));
