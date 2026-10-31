// speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.
// The drift check: finished test tasks against the tests as they are now, with no model. Run on every
// feature by `node tools/drift.mjs`, and on the active feature by speckit-team.mjs beside it when
// spec-gatekeeper reports APPROVED (#228). Node standard library only, like the hook.
//
// A ticked task in specs/<feature>/tasks.md that names a test file and cites requirement IDs (FR-001)
// drifted when that file is gone, or when none of its test files holds a cited ID any more:
// test-writer puts each ID in a test's name or a comment. Only a task that says it writes tests, before
// the first file it names, counts; a docs task that names a test file to point at it does not. Success
// criteria (SC-) are not promised there and are not looked for. In a git repo a path git never tracked is an example input or a path
// inside a subproject, not a file the task built, and is skipped. An ID is matched as text, line by line: a line
// that names a feature by its number (`009 T010 FR-008 ...`, `specs/009-x`) holds the ID for that
// feature only, and a line naming no feature holds it for any (#212). So in tests that name no feature,
// the same ID of another feature in the same file still hides drift: a pass is not proof. The drift report of
// google/elephant-goldfish-model (docs/designs/drift_report.md) compares specs with code the same way.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
// A test task says so in its opening words, before the first file it names, parenthesis or colon
// ("Tests in `test/x.test.mjs`", "Contract test for ... in"); a docs or measurement task names test
// files only to point at them ("Docs in the same change (FR-014): ... held by `test/x.test.mjs`").
const writesTests = (text) => /\btests?\b/i.test(text.split(/[(:]/)[0].split(PATHS)[0]);

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

// Every feature under specs/, or with `feature` (a repo-relative directory such as specs/001-sum) that one
// feature alone, wherever it is; then specs/ need not exist, and a feature without tasks.md checks nothing.
export function drift(repo, { feature: only = null } = {}) {
  const specs = path.join(repo, 'specs');
  const hasSpecs = fs.existsSync(specs);
  if (!only && !hasSpecs) throw new Error(`no specs/ in ${repo}`);
  const dirs = only ? [only.replace(/\\/g, '/').replace(/\/+$/, '')]
    : fs.readdirSync(specs).sort().map((f) => `specs/${f}`);
  const patterns = testPatterns(repo);
  const isTest = (rel) => patterns.some((re) => re.test(rel));
  // Outside a git repo every missing path counts, since nothing tells a built file from an example.
  const inGit = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: repo }).status === 0;
  const tracked = (rel) => !inGit
    || spawnSync('git', ['log', '--all', '--format=%H', '-1', '--', rel], { cwd: repo, encoding: 'utf8' }).stdout.trim() !== '';
  const problems = []; let features = 0; let tasks = 0;
  // A feature's number is its folder's leading digits. A line names one when that number stands alone,
  // once requirement and story IDs (FR-001, SC-006, US3-1) are taken out: FR-001 does not name 001.
  const number = (f) => /^(\d+)-/.exec(f)?.[1] ?? null;
  const known = [...new Set([...(hasSpecs ? fs.readdirSync(specs) : []), ...dirs.map((d) => path.posix.basename(d))].map(number).filter(Boolean))];
  const namedIn = (line) => {
    const bare = line.replace(/\b[A-Z]{1,4}\d*-\d+(?:-\d+)?\b/g, ' ');
    return known.filter((n) => new RegExp(`(?<![\\w.])${n}(?!\\d)`).test(bare));
  };
  for (const dir of dirs) {
    const feature = path.posix.basename(dir);
    const file = `${dir}/tasks.md`;
    const text = readOr(path.join(repo, file), null);
    if (text === null) continue;
    features++;
    for (const t of tasksOf(text).filter((x) => x.done && writesTests(x.text))) {
      const tests = [...new Set(t.text.match(PATHS) ?? [])]
        .filter((rel) => isTest(rel) && (fs.existsSync(path.join(repo, rel)) || tracked(rel)));
      const ids = [...new Set(t.text.match(IDS) ?? [])];
      if (!tests.length || !ids.length) continue;
      tasks++;
      const present = tests.filter((rel) => fs.existsSync(path.join(repo, rel)));
      for (const rel of tests) if (!present.includes(rel)) problems.push(`${file} ${t.id}: ${rel} is gone`);
      if (!present.length) continue;
      const held = present.map((rel) => readOr(path.join(repo, rel), '')).join('\n');
      for (const id of ids) {
        const holding = held.split(/\r?\n/).filter((l) => new RegExp(`\\b${id}\\b`).test(l));
        if (!holding.length) problems.push(`${file} ${t.id}: ${id} is in none of ${present.join(', ')}`);
        else if (!holding.some((l) => { const named = namedIn(l); return !named.length || named.includes(number(feature)); })) {
          problems.push(`${file} ${t.id}: ${id} is in none of ${present.join(', ')} for ${feature} (only on lines naming another feature)`);
        }
      }
    }
  }
  return { features, tasks, problems };
}

