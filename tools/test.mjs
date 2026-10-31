#!/usr/bin/env node
// `npm test`: every test/*.test.mjs under `node --test`, with the node that runs this script.
//
//   node tools/test.mjs [node --test options] [test files]
//
// With no files it runs every test/*.test.mjs (not test/hook-helpers.mjs, not folders such as
// fixtures/). Options (anything starting with -) go to `node --test` as given, such as
// --test-name-pattern=... Exits as the tests did.
//
// #214: the script was `node --test "test/*.test.mjs"`, and Node expands a quoted glob given to --test
// only from v21: on Node 20.20.2 it found no file at all, although the README promises Node 18. Listing
// the files here works on every Node from 18, and running them with process.execPath means
// `/path/to/node tools/test.mjs` works where the `node` on PATH is missing or another one.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test');

// The test files directly in dir, sorted, as absolute paths.
export function testFiles(dir = TEST_DIR) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.test.mjs'))
    .map((e) => path.join(dir, e.name))
    .sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = args.filter((a) => a.startsWith('-'));
  const given = args.filter((a) => !a.startsWith('-'));
  const r = spawnSync(process.execPath, ['--test', ...options, ...(given.length ? given : testFiles())], { stdio: 'inherit' });
  if (r.error) { console.error(`tools/test.mjs: ${r.error.message}`); process.exit(1); }
  process.exit(r.status ?? 1);
}
