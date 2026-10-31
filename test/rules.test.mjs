// Run: npm test (or node tools/test.mjs test/rules.test.mjs)
// #232: docs/rules.md lists every rule of the skills and agents and what holds it (a hook, a script the
// skill runs, a test that pins the text, or nothing). Each section of a prompt file has an entry there
// with a fingerprint of the section's text, so a rule added, changed or dropped fails here until its
// entry is reviewed, rather than turning a guarantee into advice nobody notices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every skill and agent the installer ships.
function promptFiles(root) {
  const skills = fs.readdirSync(path.join(root, 'skills')).sort().map((d) => `skills/${d}/SKILL.md`);
  const agents = fs.readdirSync(path.join(root, 'agents')).filter((n) => n.endsWith('.md')).sort().map((n) => `agents/${n}`);
  return [...skills, ...agents];
}

// A prompt file's body, after its frontmatter, cut at every ## and ### heading; the text before the first
// is the section `(opening)`. A heading with no text under it before the next one is no section.
function sections(root) {
  const out = [];
  for (const file of promptFiles(root)) {
    const body = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
    let name = '(opening)'; let lines = [];
    const push = () => {
      const text = lines.join('\n').trim();
      if (text) out.push({ key: `${file}: ${name}`, fingerprint: createHash('sha256').update(text).digest('hex').slice(0, 8) });
    };
    for (const line of body.split('\n')) {
      const m = /^#{2,3} (.+)$/.exec(line);
      if (m) { push(); name = m[1].trim(); lines = []; } else lines.push(line);
    }
    push();
  }
  return out;
}

// docs/rules.md's entries: a `### <file>: <section>` heading, its fingerprint comment on the next line,
// and at least one tagged rule under it.
function entries(doc) {
  const out = new Map();
  const blocks = doc.replace(/\r\n/g, '\n').split(/^(?=### )/m).filter((b) => b.startsWith('### '));
  for (const b of blocks) {
    const m = /^### (\S+?\.md: .+)\n<!-- fingerprint: ([0-9a-f]{8}) -->\n/.exec(b);
    if (!m) { out.set(b.split('\n')[0].slice(4), { fingerprint: null, tagged: false }); continue; }
    const tagged = b.split('\n').filter((l) => l.startsWith('- ')).every((l) => /\b(hook|script|pinned|text)\b/.test(l))
      && b.split('\n').some((l) => l.startsWith('- '));
    out.set(m[1], { fingerprint: m[2], tagged });
  }
  return out;
}

// What makes docs/rules.md disagree with the prompts in `root`, one line each.
function problems(root, doc) {
  const have = entries(doc);
  const out = [];
  const seen = new Set();
  for (const s of sections(root)) {
    seen.add(s.key);
    const e = have.get(s.key);
    if (!e) out.push(`${s.key}: a section with no entry in docs/rules.md; add one (fingerprint ${s.fingerprint}) and tag its rules`);
    else if (!e.fingerprint) out.push(`${s.key}: its entry has no fingerprint line under the heading`);
    else if (e.fingerprint !== s.fingerprint) out.push(`${s.key}: the section changed; review its rules in docs/rules.md and set its fingerprint to ${s.fingerprint}`);
    else if (!e.tagged) out.push(`${s.key}: an entry with a rule that has no tag (hook, script, pinned or text)`);
  }
  for (const key of have.keys()) if (!seen.has(key)) out.push(`${key}: an entry for a section that no prompt file has any more; remove it`);
  return out;
}

const DOC = () => fs.readFileSync(path.join(ROOT, 'docs', 'rules.md'), 'utf8');

test('#232: docs/rules.md has an entry, with the current fingerprint and tagged rules, for every section of every skill and agent', () => {
  assert.deepEqual(problems(ROOT, DOC()), []);
});

// The check itself, on a copy: each way a prompt can move away from the table is named.
test('#232: a new section, a changed one and a dropped one each fail the check, named', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'skrules-'));
  for (const d of ['skills', 'agents']) fs.cpSync(path.join(ROOT, d), path.join(copy, d), { recursive: true });
  const doc = DOC();
  assert.deepEqual(problems(copy, doc), [], 'the copy agrees');
  const add = (rel, text) => fs.appendFileSync(path.join(copy, rel), text);
  add('agents/implementer.md', '\n## Cleanup\nDelete every temporary file you made.\n');
  add('skills/speckit-patch/SKILL.md', '\nNever open a second pull request.\n');
  fs.rmSync(path.join(copy, 'skills', 'speckit-triage'), { recursive: true });
  const found = problems(copy, doc);
  assert.ok(found.some((p) => /^agents\/implementer\.md: Cleanup: a section with no entry/.test(p)), found.join('\n'));
  assert.ok(found.some((p) => /^skills\/speckit-patch\/SKILL\.md: 6\. Merging: the section changed; .* set its fingerprint to [0-9a-f]{8}$/.test(p)), found.join('\n'));
  assert.ok(found.some((p) => /^skills\/speckit-triage\/SKILL\.md: \(opening\): an entry for a section that no prompt file has any more/.test(p)), found.join('\n'));
  assert.equal(found.length, 3, found.join('\n'));
  const untagged = doc.replace(/(### agents\/patcher\.md: Inputs\n<!-- fingerprint: [0-9a-f]{8} -->\n)- No `specs\/` artifacts\. text\./, '$1- No `specs/` artifacts.');
  assert.notEqual(untagged, doc, 'the test edits a real entry');
  assert.deepEqual(problems(ROOT, untagged), ['agents/patcher.md: Inputs: an entry with a rule that has no tag (hook, script, pinned or text)']);
});
