// Run: npm test (or node --test "test/*.test.mjs")
// The docs an agent reads here point into each other: the README into docs/, docs/ back into the
// README, CLAUDE.md into both. A moved or renamed heading breaks such a link without a word, and the
// reader lands at the top of a 100 KB file. Every relative link must name a file that exists and, with
// an anchor, a heading in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['README.md', 'CLAUDE.md', ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

// GitHub's heading anchors: lower case, punctuation but - and _ dropped, each space a hyphen.
const slug = (heading) => heading.toLowerCase().replace(/[^\p{L}\p{N}\- _]/gu, '').replace(/ /g, '-');
function anchors(file) {
  let fence = false;
  const out = new Set();
  for (const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && /^#{1,6} (.+)$/.exec(line);
    if (m) out.add(slug(m[1]));
  }
  return out;
}

// Recordings the README embeds that were never made, each with its issue. Once one exists, its entry
// must go, so the list cannot hide a file that went missing later.
const NOT_RECORDED = {};

test('every relative link in README.md, CLAUDE.md and docs/ names a file that exists, and a heading in it', () => {
  for (const [file, issue] of Object.entries(NOT_RECORDED)) {
    assert.ok(!fs.existsSync(path.join(ROOT, file)), `${file} exists now: remove it from NOT_RECORDED (${issue})`);
  }
  const broken = [];
  let checked = 0;
  for (const doc of DOCS) {
    const text = fs.readFileSync(path.join(ROOT, doc), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [rel, anchor] = target.split('#');
      const file = rel ? path.posix.normalize(path.posix.join(path.posix.dirname(doc), rel)) : doc;
      checked++;
      if (file in NOT_RECORDED) continue;
      if (!fs.existsSync(path.join(ROOT, file))) { broken.push(`${doc}: ${target} (no file ${file})`); continue; }
      if (anchor && file.endsWith('.md') && !anchors(file).has(anchor)) broken.push(`${doc}: ${target} (no heading #${anchor} in ${file})`);
    }
  }
  assert.ok(checked > 100, `only ${checked} links found: the pattern no longer matches the docs`);
  assert.deepEqual(broken, []);
});
