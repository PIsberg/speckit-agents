#!/usr/bin/env node
// Runs tools/full-run.mjs N times per arm and case, scores each run against a known right answer, and
// prints counts out of N, input tokens and cost per arm (#188). One sample per arm cannot show that a
// prompt change helped; this repeats it. It spends tokens, so like full-run it only runs by hand.
//
//   node tools/eval.mjs --out <dir> --arm baseline=ref:main --arm treatment=. [--case defect,defect-control]
//                       [--runs 6] [--model sonnet] [--max-cost 6] [--login] [--skill-agents] [--claim]
//
// An arm is a label and the checkout whose agents, skills and hook get installed: a path, or ref:<gitref>
// for a worktree of that ref under <out>/arms. Everything else is this checkout's, so only the team varies.
// The scoring below is pure code over a run's git history and run.json and is tested without a model.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// gate: the run is one turn on a finished feature and the right answer is spec-gatekeeper's word.
export const CASES = {
  clean: { gate: false, right: 'APPROVED', what: 'the unmodified request ends APPROVED (catches a change that only rejects more)' },
  pressure: { gate: false, right: 'tests first', what: 'the request says to skip the tests; a test is still committed before any code' },
  defect: { gate: true, right: 'REJECTED', what: 'one requirement has a test that passes without the code' },
  'defect-control': { gate: true, right: 'APPROVED', what: 'the same feature with a real test' },
};

// Spec-gatekeeper's word: the hook's record when there is one, else the last line of the answer that is
// the word alone. A word inside prose ("it was not APPROVED") is not a verdict.
export function gateWord({ ends = [], text = '' }) {
  const rec = ends.find((e) => e?.word === 'APPROVED' || e?.word === 'REJECTED');
  if (rec) return { word: rec.word, source: 'hook record' };
  const last = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(APPROVED|REJECTED)$/.test(l)).pop();
  return last ? { word: last, source: 'last line of the answer' } : { word: null, source: 'none' };
}

const isTest = (f) => /(^|\/)(tests?|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const isProd = (f) => f.startsWith('src/');
// Commits after the scratch repo's first, oldest first, each with the files it touched. A stub commit
// (#192) is implementer's stub pass: its subject is `stub: <task IDs>` (agents/implementer.md) and the
// production lines it adds carry the not-implemented signal. Its production files are not production code.
function commitsAfterBase(repo) {
  const r = spawnSync('git', ['log', '--reverse', '--name-only', '--format=@@%H%n%s'], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('@@').filter(Boolean).slice(1).map((c) => {
    const [hash, subject, ...files] = c.split(/\r?\n/).filter(Boolean);
    return { hash, subject, files, stub: /^stub:/i.test(subject ?? '') && files.some(isProd) && stubOnly(repo, hash) };
  });
}

// Every production line the commit adds is blank, a comment, an opening line (a signature ending in `{`),
// closing brackets, or carries "not implemented" outside a trailing comment, and at least one does: a
// commit labelled stub that writes a real statement is production code.
function stubOnly(repo, hash) {
  const r = spawnSync('git', ['show', '--format=', '-U0', hash, '--', 'src/'], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) return false;
  const added = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1).trim());
  const code = added.map((l) => l.replace(/\s(\/\/|#).*$/, '').trim()).filter((l) => l && !/^(\/\/|\/\*|\*|#)/.test(l));
  const signal = (l) => /not implemented/i.test(l);
  return code.some(signal) && code.every((l) => signal(l) || /\{$/.test(l) || /^[{}()[\];,]+$/.test(l));
}

// Right = a commit that touches a test and no production file comes before the first commit that touches
// production code. A commit holding both at once is not tests first. A stub commit is not production code.
export function testsFirst(repo) {
  const commits = commitsAfterBase(repo).map((c) => (c.stub ? c.files.filter((f) => !isProd(f)) : c.files));
  const prod = commits.findIndex((fs_) => fs_.some(isProd));
  const test = commits.findIndex((fs_) => fs_.some(isTest) && !fs_.some(isProd));
  if (test < 0) return { right: false, why: prod < 0 ? 'no test and no production code was committed' : 'no test was committed before or apart from the production code' };
  if (prod >= 0 && prod < test) return { right: false, why: 'production code was committed before the first test' };
  return { right: true, why: 'a test was committed before any production code' };
}

export function scoreRun(name, { repo, report }) {
  const c = CASES[name];
  if (!c) throw new Error(`unknown case ${name}`);
  if (name === 'pressure') return testsFirst(repo);
  const word = report?.gate?.word ?? null;
  return { right: word === c.right, observed: word, why: word ? `spec-gatekeeper said ${word}, expected ${c.right}` : `no word from spec-gatekeeper, expected ${c.right}` };
}

export function tally(rows) {
  const out = {};
  for (const r of rows) {
    const cell = ((out[r.arm] ??= {})[r.case] ??= { right: 0, runs: 0, cost: 0, input: 0 });
    cell.runs++; cell.right += r.right ? 1 : 0; cell.cost += r.cost ?? 0; cell.input += r.input ?? 0;
  }
  return out;
}

// A cell with no run says so; zero of zero is not a result.
export function table(t, cases) {
  const lines = [`| arm | ${cases.join(' | ')} |`, `|---|${cases.map(() => '---').join('|')}|`];
  for (const [arm, cells] of Object.entries(t)) {
    lines.push(`| ${arm} | ${cases.map((c) => (cells[c] ? `${cells[c].right}/${cells[c].runs}, ${(cells[c].input / 1e6).toFixed(2)}M in, $${cells[c].cost.toFixed(2)}` : 'not run')).join(' | ')} |`);
  }
  return lines.join('\n');
}

export function armArg(s) {
  const m = /^([^=]+)=(.+)$/.exec(s);
  if (!m) throw new Error(`--arm takes label=path or label=ref:<gitref>, got "${s}"`);
  if (m[2].startsWith('ref:')) {
    if (m[2].length === 4) throw new Error(`--arm ${s}: empty git ref`);
    return { label: m[1], ref: m[2].slice(4) };
  }
  return { label: m[1], dir: path.resolve(m[2]) };
}

export function parseArgs(argv) {
  const o = { arms: [], cases: ['defect', 'defect-control', 'pressure'], runs: 6, model: 'sonnet', maxCost: 6, login: false, skillAgents: false, claim: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--login') o.login = true; else if (k === '--skill-agents') o.skillAgents = true; else if (k === '--claim') o.claim = true;
    else if (k === '--out') o.out = path.resolve(argv[++i]);
    else if (k === '--arm') o.arms.push(armArg(argv[++i] ?? ''));
    else if (k === '--case') o.cases = String(argv[++i]).split(',');
    else if (k === '--runs') o.runs = Number(argv[++i]);
    else if (k === '--model') o.model = argv[++i];
    else if (k === '--max-cost') o.maxCost = Number(argv[++i]);
    else throw new Error(`unknown argument ${k}`);
  }
  if (!o.out || !o.arms.length || !Number.isInteger(o.runs) || o.runs < 1 || !Number.isFinite(o.maxCost)) {
    throw new Error('usage: node tools/eval.mjs --out <dir> --arm label=path|ref:<gitref> [--arm ...] [--case a,b] [--runs n] [--model m] [--max-cost usd] [--login] [--skill-agents] [--claim]');
  }
  for (const c of o.cases) if (!CASES[c]) throw new Error(`unknown case ${c}; known: ${Object.keys(CASES).join(', ')}`);
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  fs.mkdirSync(o.out, { recursive: true });
  const rows = [];
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout?.trim() ?? 'unknown';
  for (const arm of o.arms) {
    if (arm.ref) {
      arm.dir = path.join(o.out, 'arms', arm.label);
      const w = spawnSync('git', ['worktree', 'add', '--detach', arm.dir, arm.ref], { cwd: ROOT, encoding: 'utf8' });
      if (w.status !== 0) throw new Error(`git worktree add ${arm.ref}: ${w.stderr}`);
    }
    arm.commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: arm.dir, encoding: 'utf8' }).stdout.trim();
  }
  for (const c of o.cases) for (const arm of o.arms) for (let n = 1; n <= o.runs; n++) {
    const dir = path.join(o.out, arm.label, c, String(n));
    const a = [path.join(ROOT, 'tools', 'full-run.mjs'), '--out', dir, '--case', c, '--team-root', arm.dir, '--model', o.model, '--max-cost', String(o.maxCost)];
    if (o.login) a.push('--login');
    if (o.skillAgents) a.push('--skill-agents');
    if (o.claim) a.push('--claim');
    const r = spawnSync(process.execPath, a, { encoding: 'utf8', timeout: 60 * 60_000 });
    let report = null;
    try { report = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')); } catch { /* no run.json: infrastructure or crash */ }
    // A run that never reached a verdict because of the infrastructure is not a miss: it is reported apart.
    const infra = !report || /infrastructure, not the team|claude printed no result|main session changed the repo/.test((report.failures ?? []).join('; '));
    const s = infra ? null : scoreRun(c, { repo: path.join(dir, 'repo'), report });
    console.log(`${arm.label} ${c} #${n}: ${infra ? 'NOT SCORED (infrastructure or crash)' : `${s.right ? 'right' : 'WRONG'}: ${s.why}`} (full-run exit ${r.status})`);
    if (!infra) rows.push({ arm: arm.label, case: c, right: s.right, cost: report.cost, input: (report.usage?.main?.input ?? 0) + (report.usage?.agents ?? []).reduce((n, a) => n + a.input, 0) });
  }
  const summary = { when: new Date().toISOString(), claude: version, model: o.model, runs: o.runs, skillAgents: o.skillAgents, claim: o.claim,
    arms: o.arms.map(({ label, dir, commit }) => ({ label, dir, commit })), cases: o.cases, tally: tally(rows), rows };
  fs.writeFileSync(path.join(o.out, 'eval.json'), JSON.stringify(summary, null, 2));
  console.log(`\nClaude Code ${version}, model ${o.model}, ${o.runs} runs per cell\n${table(summary.tally, o.cases)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`eval: ${e.message}`); process.exit(2); }
}
