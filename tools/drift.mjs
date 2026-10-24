#!/usr/bin/env node
// Checks every feature's finished test tasks against the tests as they are now, with no model:
//
//   node tools/drift.mjs [repo]
//
// A ticked task in specs/<feature>/tasks.md that names a test file and cites requirement IDs (FR-001)
// drifted when that file is gone, or when none of its test files holds a cited ID any more:
// test-writer puts each ID in a test's name or a comment. Success criteria (SC-) are not promised
// there and are not looked for. In a git repo a path git never tracked is an example input or a path
// inside a subproject, not a file the task built, and is skipped. One line per problem, then a count. Exit 0
// without drift, 1 with it, 2 when the repo has no specs/. An ID is matched as text, so the same ID of
// another feature in the same file hides drift: a pass is not proof. The drift report of
// google/elephant-goldfish-model (docs/designs/drift_report.md) compares specs with code the same way.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The hook's test lanes decide what a test file is with these and .specify/test-paths; held equal to
// the hook's by test/drift.test.mjs.
const TEST_PATTERNS = [
  /(^|\/)(test|tests|__tests__|testing|testdata|test-data|fixtures|e2e|spec)\//i,
  /(^|\/)src\/(it|integrationTest|testFixtures)\//,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.(go|py|rs|exs|dart|c|cc|cpp)$/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(Test|Tests|IT|Spec)\.(java|kt|kts|groovy|scala|cs)$/,
  /_spec\.rb$/,
  /Tests?\.swift$/,
];
const TASK = /^\s*[-*]\s+\[([ xX])\]\s+(T\d+)\b/;
const IDS = /\bFR-\d{3}\b/g;
// A repo-relative path with a directory and an extension, as tasks name files.
const PATHS = /[\w.@-]+(?:\/[\w.@-]+)+\.\w+/g;

const readOr = (f, d) => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };

function testPatterns(repo) {
  const extra = readOr(path.join(repo, '.specify', 'test-paths'), '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .flatMap((l) => { try { return [new RegExp(l)]; } catch { return []; } });
  return [...TEST_PATTERNS, ...extra];
}

// Each task with the lines that continue it, up to the next task, heading or blank line.
function tasksOf(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = TASK.exec(line);
    if (m) out.push({ id: m[2], done: m[1] !== ' ', text: line });
    else if (!line.trim() || /^#/.test(line)) out.push(null);
    else if (out.at(-1)) out.at(-1).text += `\n${line}`;
  }
  return out.filter(Boolean);
}

export function drift(repo) {
  const specs = path.join(repo, 'specs');
  if (!fs.existsSync(specs)) throw new Error(`no specs/ in ${repo}`);
  const patterns = testPatterns(repo);
  const isTest = (rel) => patterns.some((re) => re.test(rel));
  // Outside a git repo every missing path counts, since nothing tells a built file from an example.
  const inGit = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: repo }).status === 0;
  const tracked = (rel) => !inGit
    || spawnSync('git', ['log', '--all', '--format=%H', '-1', '--', rel], { cwd: repo, encoding: 'utf8' }).stdout.trim() !== '';
  const problems = []; let features = 0; let tasks = 0;
  for (const feature of fs.readdirSync(specs).sort()) {
    const file = `specs/${feature}/tasks.md`;
    const text = readOr(path.join(repo, file), null);
    if (text === null) continue;
    features++;
    for (const t of tasksOf(text).filter((x) => x.done)) {
      const tests = [...new Set(t.text.match(PATHS) ?? [])]
        .filter((rel) => isTest(rel) && (fs.existsSync(path.join(repo, rel)) || tracked(rel)));
      const ids = [...new Set(t.text.match(IDS) ?? [])];
      if (!tests.length || !ids.length) continue;
      tasks++;
      const present = tests.filter((rel) => fs.existsSync(path.join(repo, rel)));
      for (const rel of tests) if (!present.includes(rel)) problems.push(`${file} ${t.id}: ${rel} is gone`);
      if (!present.length) continue;
      const held = present.map((rel) => readOr(path.join(repo, rel), '')).join('\n');
      for (const id of ids) if (!new RegExp(`\\b${id}\\b`).test(held)) problems.push(`${file} ${t.id}: ${id} is in none of ${present.join(', ')}`);
    }
  }
  return { features, tasks, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let r;
  try { r = drift(path.resolve(process.argv[2] ?? '.')); } catch (e) { console.error(`drift: ${e.message}`); process.exit(2); }
  for (const p of r.problems) console.log(p);
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  console.log(`${n(r.tasks, 'test task')} in ${n(r.features, 'feature')} checked, ${r.problems.length ? n(r.problems.length, 'problem') : 'no drift'}`);
  process.exit(r.problems.length ? 1 : 0);
}
