// Run: npm test (or node --test "test/*.test.mjs")
// docs/media/leaks.mjs: a recording whose frames show who recorded it (#60) must never reach
// docs/media, where it could be committed. The frames are vhs's text dump of each tape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { identities, publish } from '../docs/media/leaks.mjs';

function dirs() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-media-'));
  const out = path.join(tmp, 'out');
  const media = path.join(tmp, 'media');
  fs.mkdirSync(out);
  fs.mkdirSync(media);
  fs.writeFileSync(path.join(out, 'demo.gif'), 'GIF89a');
  fs.writeFileSync(path.join(out, 'board.png'), 'PNG');
  return { out, media };
}

test('a recording whose frames show none of the names is copied into docs/media', () => {
  const { out, media } = dirs();
  const shown = publish({ dump: '> @\n  R:\\repo\\README.md\n', names: ['pat'], out, media });
  assert.deepEqual(shown, []);
  assert.deepEqual(fs.readdirSync(media).sort(), ['board.png', 'demo.gif']);
});

test('a recording whose frames show a name stays out of docs/media', () => {
  const { out, media } = dirs();
  const dump = '> @\n  C:\\Users\\Pat\\AppData\\Local\\Temp\\sk\\repo\\README.md\n────\n';
  const shown = publish({ dump, names: ['pat'], out, media });
  assert.deepEqual(shown, ['C:\\Users\\Pat\\AppData\\Local\\Temp\\sk\\repo\\README.md']);
  assert.deepEqual(fs.readdirSync(media), []);
});

test('a name that a row break splits in two still counts', () => {
  const { out, media } = dirs();
  const dump = 'Bash(cd "C:/Users/patri\nck/AppData/Local/Temp/repo")\n';
  assert.notDeepEqual(publish({ dump, names: ['patrick'], out, media }), []);
  assert.deepEqual(fs.readdirSync(media), []);
});

test('with no name to look for, nothing is published', () => {
  const { out, media } = dirs();
  assert.notDeepEqual(publish({ dump: 'clean', names: [], out, media }), []);
  assert.deepEqual(fs.readdirSync(media), []);
});

test("the names are the user name, the home folder's and its 8.3 short form", () => {
  assert.deepEqual(identities({ user: 'Pat', home: 'C:\\Users\\patrick.s', shortHome: 'C:\\Users\\PATRIC~1' }), ['pat', 'patrick.s', 'patric~1']);
  assert.deepEqual(identities({ user: 'pat', home: '/home/pat/', shortHome: undefined }), ['pat']);
});
