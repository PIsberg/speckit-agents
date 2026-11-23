import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../src/dedupe.js';

test('001 FR-001 dedupe keeps the first of each item', () => assert.deepEqual(dedupe([1, 2, 1, 3, 2]), [1, 2, 3]));
test('001 FR-002 dedupe of an empty array is empty', () => assert.deepEqual(dedupe([]), []));
