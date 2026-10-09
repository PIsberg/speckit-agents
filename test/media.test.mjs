// Run: npm test (or node --test "test/*.test.mjs")
// docs/media/leaks.mjs: a recording whose frames show the OS user name (#60) must not stay in
// docs/media, where it could be committed. The frames are vhs's text dump of each tape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quarantine } from '../docs/media/leaks.mjs';

const GIF_TAPE = 'Output "{{OUTPUT}}"\nOutput "{{WORK}}/demo.txt"\nType "@"\n';
const SHOT_TAPE = 'Output "{{WORK}}/board.txt"\nScreenshot "{{SHOTS}}/board.png"\n';

function dirs() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-media-'));
  const media = path.join(tmp, 'media');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(media);
  fs.mkdirSync(work);
  return { media, work };
}

test('a GIF whose frames show the user name is moved out of docs/media', () => {
  const { media, work } = dirs();
  fs.writeFileSync(path.join(media, 'demo.gif'), 'GIF89a');
  const dump = '> @\n  C:\\Users\\Pat\\AppData\\Local\\Temp\\sk\\repo\\README.md\n────\n> @\n';
  const lines = quarantine({ name: 'demo', tape: GIF_TAPE, dump, user: 'pat', media, work });
  assert.deepEqual(lines, ['C:\\Users\\Pat\\AppData\\Local\\Temp\\sk\\repo\\README.md']);
  assert.equal(fs.existsSync(path.join(media, 'demo.gif')), false);
  assert.equal(fs.readFileSync(path.join(work, 'demo.gif'), 'utf8'), 'GIF89a');
});

test('a recording whose frames do not show the user name stays', () => {
  const { media, work } = dirs();
  fs.writeFileSync(path.join(media, 'demo.gif'), 'GIF89a');
  const lines = quarantine({ name: 'demo', tape: GIF_TAPE, dump: '> @\n  R:\\repo\\README.md\n', user: 'pat', media, work });
  assert.deepEqual(lines, []);
  assert.ok(fs.existsSync(path.join(media, 'demo.gif')));
});

test("a tape's screenshots are moved too", () => {
  const { media, work } = dirs();
  fs.writeFileSync(path.join(media, 'board.png'), 'PNG');
  quarantine({ name: 'board', tape: SHOT_TAPE, dump: 'Bash(cd "C:/Users/pat/repo")\n', user: 'pat', media, work });
  assert.equal(fs.existsSync(path.join(media, 'board.png')), false);
  assert.ok(fs.existsSync(path.join(work, 'board.png')));
});
