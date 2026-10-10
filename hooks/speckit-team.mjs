#!/usr/bin/env node
// speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.
// Guardrails for the Spec Kit agent team. How it works: README.md of the speckit-agents repo.
// Called from agent frontmatter hooks and from ~/.claude/settings.json. Every mode is a
// no-op outside a git repo that contains .specify/, so registering it globally is safe.
//
//   scope only <prefix>...  PreToolUse Write/Edit: allow only paths under these prefixes
//   scope tests             PreToolUse Write/Edit: allow only test files and specs/*/tasks.md
//   scope no-tests          PreToolUse Write/Edit: allow anything except test files and .specify/
//   scope protected         PreToolUse Write/Edit: deny CI, Spec Kit, specs/ and .claude/ paths, the installed
//                           team, and in the speckit-agents repo its own sources; allow the rest
//   gate                    PreToolUse / UserPromptExpansion: block implementation until
//                           spec-auditor has passed the current spec, plan, tasks, constitution
//   gate retries            the same, and also block implementer after MAX_RED REDs in a row
//   verdict                 SubagentStop of spec-auditor: record its VERDICT line
//   result                  SubagentHandback / Stop of implementer: count its RESULT line
//   ends [--record] <word>... SubagentHandback / Stop: the report's last line must be one of the words;
//                           --record keeps the accepted word for the feature (spec-gatekeeper's)
//   lane tests|no-tests     SubagentStop: check the agent's whole diff, including Bash writes
//   patch                   PreToolUse (any tool): deny once the fast track's change passes its line and file budget,
//                           or it runs a history/remote command or a wholesale restore; SubagentHandback, SubagentStop and
//                           Stop: the end check (protected files, commits, the installed team's hashes, budget) and the accepted record
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const TASKS_FILE = /^specs\/[^/]+\/tasks\.md$/;
// Spec Kit's config is in no agent's code lane: feature.json picks the feature the gate and the retry
// count are kept for, and test-paths decides what counts as a test.
const SPECKIT_CONFIG = /^\.specify\//;
// Implementer may report RED this many times in a row on one plan and tasks, then the gate stops it.
const MAX_RED = 3;
// The fast track's budget: production lines and production files changed since the run started.
const PATCH_LINES = 30;
const PATCH_FILES = 2;
// Documentation is not production code; a docs/ folder is not a doc rule (research R3).
const DOC_PATTERNS = [/\.(md|mdx|markdown|rst|adoc|asciidoc|txt)$/i];
const isDoc = (rel) => DOC_PATTERNS.some((re) => re.test(rel));

// Paths the fast track never changes, repo-relative, matched case-insensitively from the start.
const PROTECTED = [
  [/^\.specify\//i, "Spec Kit's config and the constitution"],
  [/^specs\//i, 'feature specs, plans and tasks, which belong to /speckit-team'],
  [/^\.claude\//i, "the project's Claude Code agents, skills, hooks and settings"],
  [/^\.github\//i, 'CI workflows and repository settings'],
  [/^(\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|Jenkinsfile|\.pre-commit-config\.yaml)/i, 'CI and commit-hook configuration'],
];
// Only in the speckit-agents repository itself (recognised by isOwnRepo).
const OWN_SOURCES = [
  [/^hooks\/speckit-team\.mjs$/i, "the agent team's own sources"],
  [/^agents\/[^/]+\.md$/i, "the agent team's own sources"],
  [/^skills\/[^/]+\/SKILL\.md$/i, "the agent team's own sources"],
  [/^install\.mjs$/i, "the agent team's own sources"],
  [/^package\.json$/i, 'its package name marks this repository as speckit-agents'],
];

const [mode, ...args] = process.argv.slice(2);
// Claude Code always sends a JSON object, so anything else is a wiring fault. Parsing must not throw:
// a crashed hook is a non-blocking error, and the action would go through with nobody told.
const raw = (() => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } })();
let input = {};
let inputProblem = null;
try {
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
  else inputProblem = `input is ${Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed}, not a hook event`;
} catch {
  inputProblem = raw.trim() ? 'input is not valid JSON' : 'input is empty';
}
const event = input.hook_event_name;
// Fields used as paths must be strings; any other type is treated as absent.
const str = (v) => (typeof v === 'string' && v ? v : null);
const agentId = str(input.agent_id);
// Safety net under every specific check below: a hook must never exit with a crash, because Claude
// Code then lets the action through and says nothing. Inside a Spec Kit repo any error that slips
// through becomes no decision plus a visible message; outside one it stays silent.
let inSpecKitRepo = false;
process.on('uncaughtException', (e) => {
  if (inSpecKitRepo) {
    process.stdout.write(JSON.stringify({ systemMessage: `speckit-team: ${mode} hit an internal error (${e?.message ?? e}); no decision made.` }));
  }
  process.exit(0);
});
// The events each mode is wired to. Any other event gets no decision rather than a guess.
const WIRED = {
  scope: ['PreToolUse'],
  gate: ['PreToolUse', 'UserPromptExpansion'],
  verdict: ['PreToolUse', 'SubagentStop', 'Stop'],
  result: ['PreToolUse', 'SubagentStop', 'Stop'],
  ends: ['PreToolUse', 'SubagentStop', 'Stop'],
  lane: ['SubagentStop', 'Stop'],
  patch: ['PreToolUse', 'SubagentStop', 'Stop'],
};
const who = input.agent_type || 'the main session';

const git = (cwd, ...a) => {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=off', ...a], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};
const lines = (s) => (s ? s.split('\n').filter(Boolean) : []);
const readOr = (f, fallback) => { try { return fs.readFileSync(f, 'utf8'); } catch { return fallback; } };
const emit = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const deny = (reason) => emit({ hookSpecificOutput: {
  hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const block = (reason) => emit({ decision: 'block', reason });

const cwd = str(input.cwd) ?? process.cwd();
const root = git(cwd, 'rev-parse', '--show-toplevel');
if (!root || !fs.existsSync(path.join(root, '.specify'))) process.exit(0);
inSpecKitRepo = true;
// State files are ours but can still be corrupt. `undefined` = missing, `null` = unreadable.
function readState(f) {
  const text = readOr(f, undefined);
  if (text === undefined) return undefined;
  try { return JSON.parse(text); } catch { return null; }
}

// Unusable input makes no decision, so the action proceeds exactly as it did when the hook crashed,
// but the user is told instead of nothing happening silently.
const noDecision = (why) => emit({ systemMessage: `speckit-team: ${mode} got unusable input (${why}); no decision made.` });
if (inputProblem) noDecision(inputProblem);
if (WIRED[mode] && !WIRED[mode].includes(event)) {
  noDecision(`${event ? `event ${event}` : 'no hook_event_name'} is not one ${mode} is wired for`);
}
const stateDir = path.join(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'speckit-team');

// Compare paths the way the file system will resolve them: through symlinks of the part that exists,
// and on Windows ignoring case and trailing dots and spaces in names (".GIT", ".git." are ".git").
// real() resolves symlinks, junctions and 8.3 short names of the part that exists.
function real(p) {
  let base = path.resolve(p); const rest = [];
  while (!fs.existsSync(base) && path.dirname(base) !== base) { rest.unshift(path.basename(base)); base = path.dirname(base); }
  try { base = fs.realpathSync.native(base); } catch { /* keep the resolved path */ }
  return path.join(base, ...rest);
}
function canonical(p) {
  const segs = real(p).split(path.sep).map((s, i) => (i ? s.replace(/[. ]+$/, '') : s));
  const joined = segs.join('/');
  return process.platform === 'win32' ? joined.toLowerCase() : joined;
}
const gitDirs = [...new Set([path.join(root, '.git'), path.dirname(stateDir)])].map(canonical);
const inGitDir = (p) => { const c = canonical(p); return gitDirs.some((d) => c === d || c.startsWith(`${d}/`)); };

const ownRepo = new Map();
function isOwnRepo(rev) {
  if (!ownRepo.has(rev)) {
    let own = false;
    try {
      const pkg = JSON.parse(git(root, 'cat-file', 'blob', `${rev}:package.json`));
      own = !!pkg && typeof pkg === 'object' && pkg.name === 'speckit-agents';
    } catch { /* not JSON, or no such blob */ }
    ownRepo.set(rev, own);
  }
  return ownRepo.get(rev);
}
function isProtected(rel, rev = 'HEAD') {
  const hit = PROTECTED.find(([re]) => re.test(rel)) ?? (isOwnRepo(rev) ? OWN_SOURCES.find(([re]) => re.test(rel)) : undefined);
  return hit ? hit[1] : null;
}
// The repo-relative, forward-slash path of file as the file system will resolve it, null when outside.
// Both sides resolved alike: git reports the real root, Claude Code passes the path it was given,
// and a symlinked or short-named way into the repo must not read as outside it.
function repoRel(file) {
  const rel = path.relative(real(root), real(path.resolve(cwd, file))).split(path.sep).join('/');
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}
// The installed team: agents/, hooks/, skills/ and the settings files beside the running hook.
const TEAM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function isTeamFile(abs) {
  const c = canonical(abs); const t = canonical(TEAM_DIR);
  return ['/agents/', '/hooks/', '/skills/'].some((d) => c.startsWith(t + d)) || c === `${t}/settings.json` || c === `${t}/settings.local.json`;
}

// A line that is not a valid regex leaves the test lanes undecidable: scope denies and lane says it
// could not run, instead of crashing, which would let every write through.
function parseTestPaths(text) {
  const patterns = [...TEST_PATTERNS]; const bad = [];
  text.split('\n').forEach((l, i) => {
    const t = l.trim();
    if (!t || t.startsWith('#')) return;
    try { patterns.push(new RegExp(t)); } catch { bad.push(`.specify/test-paths line ${i + 1} \`${t}\``); }
  });
  return { patterns, bad: bad.length ? `${bad.join(', ')} ${bad.length > 1 ? 'are not valid regular expressions' : 'is not a valid regular expression'}` : null };
}
// Read once per run, from the working tree.
const testPaths = parseTestPaths(readOr(path.join(root, '.specify', 'test-paths'), ''));
const isTest = (rel) => testPaths.patterns.some((re) => re.test(rel));
// The same patterns as committed at a revision: the fast track measures with the rules the run started under.
const testsAtMemo = new Map();
function testsAt(rev) {
  if (!testsAtMemo.has(rev)) {
    const t = parseTestPaths(git(root, 'cat-file', 'blob', `${rev}:.specify/test-paths`) ?? '');
    testsAtMemo.set(rev, { isTest: (rel) => t.patterns.some((re) => re.test(rel)), bad: t.bad });
  }
  return testsAtMemo.get(rev);
}
const inLane = (rule, rel) => (rule === 'tests' ? isTest(rel) || TASKS_FILE.test(rel) : !isTest(rel) && !SPECKIT_CONFIG.test(rel));

// The active feature as a repo-relative path. Spec Kit accepts an absolute feature_directory too;
// joined under the root as-is it named four missing files, and that fingerprint never went stale.
// Anything that is not a path inside the repo is no feature, which keeps the gate closed.
function feature() {
  let dir;
  try { dir = str(JSON.parse(readOr(path.join(root, '.specify', 'feature.json'), '')).feature_directory); } catch { return null; }
  if (!dir) return null;
  const rel = path.relative(real(root), real(path.resolve(root, dir))).split(path.sep).join('/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
}

// Ticking a task checkbox must not invalidate the audit, so checkbox state is normalised away.
function fingerprint(feat) {
  const files = ['.specify/memory/constitution.md', `${feat}/spec.md`, `${feat}/plan.md`, `${feat}/tasks.md`];
  const h = createHash('sha256');
  for (const f of files) {
    const text = readOr(path.join(root, f), '<missing>')
      .replace(/\r\n/g, '\n').replace(/^(\s*[-*]\s+\[)[xX ](\])/gm, '$1 $2');
    h.update(`${f}\0${text}\0`);
  }
  return h.digest('hex').slice(0, 16);
}
const verdictFile = (feat) => path.join(stateDir, 'verdicts', `${path.basename(feat)}.json`);
const baseFile = (id) => path.join(stateDir, 'agents', `${id}.json`);
const retryFile = (feat) => path.join(stateDir, 'retries', `${path.basename(feat)}.json`);
const endsFile = (feat) => path.join(stateDir, 'ends', `${path.basename(feat)}.json`);
// REDs count only against the plan and tasks they were made on: a revision starts from zero.
const redCount = (r, feat) => (r && r.fingerprint === fingerprint(feat) && Array.isArray(r.red) ? r.red.length : 0);
const writeJson = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 1)); };

function auditProblem() {
  const feat = feature();
  if (!feat) return 'no active feature: .specify/feature.json has no feature_directory inside the repo';
  const v = readState(verdictFile(feat));
  if (v === undefined) return `spec-auditor has not passed ${feat}`;
  // Fail closed: a verdict that cannot be read proves no PASS.
  if (!v || typeof v !== 'object') return `the verdict file for ${feat} is unreadable, so no PASS can be proven`;
  if (v.verdict !== 'PASS') return `spec-auditor's last verdict on ${feat} was ${v.verdict} (${v.at})`;
  if (v.fingerprint !== fingerprint(feat)) {
    return `spec, plan, tasks or constitution changed after the audit of ${feat} (${v.at})`;
  }
  return null;
}

// No rename detection: a rename is listed by its new path only, and a test moved out of the test tree
// would read as one new production file.
function changedSince(base) {
  return [...new Set([
    ...lines(git(root, 'diff', '--no-renames', '--name-only', base)),
    ...lines(git(root, 'ls-files', '--others', '--exclude-standard')),
  ])];
}

// Two ways a report arrives: as the SubagentHandback tool's message (PreToolUse, the normal case in
// interactive sessions) or as the agent's last message (SubagentStop, e.g. under claude -p).
// Only a string is a report: String(['VERDICT: PASS']) would otherwise read as a PASS.
const reportText = (viaHandback) => (viaHandback
  ? (typeof input.tool_input?.message === 'string' ? input.tool_input.message : '') : lastAssistantText());

function lastAssistantText() {
  const last = str(input.last_assistant_message);
  if (last) return last;
  // A number would reach readFileSync as a file descriptor, so only a string is a path.
  const entries = lines(readOr(str(input.agent_transcript_path) ?? '', '')).reverse();
  for (const l of entries) {
    try {
      const m = JSON.parse(l).message;
      if (m?.role !== 'assistant') continue;
      const c = typeof m.content === 'string' ? m.content
        : (m.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      if (c) return c;
    } catch { /* skip malformed line */ }
  }
  return '';
}

if (mode === 'scope') {
  const ti = input.tool_input || {};
  const given = ti.file_path ?? ti.notebook_path;
  if (given === undefined || given === null || given === '') process.exit(0);
  const file = str(given);
  if (!file) noDecision(`tool_input.file_path is ${Array.isArray(given) ? 'an array' : typeof given}, not a path`);
  const target = path.resolve(cwd, file);
  // Verdicts and retry counts live in the git dir; an agent that could write there could reset its own
  // limit. Checked before the outside-the-repo exit: a linked worktree's state is in the main checkout.
  if (inGitDir(target)) {
    deny(`${who} may not write ${file}: the git directory holds the team's guardrail state (verdicts, retry counts). `
      + 'Report what you need instead; only the user resets that state.');
  }
  if (args[0] === 'protected' && isTeamFile(target)) {
    deny(`${who} may not write ${file}: it belongs to the installed agent team (its hook, agents, skills or settings). `
      + 'Stop and report ESCALATE; the developer uses /speckit-team.');
  }
  const rel = repoRel(file);
  if (rel === null) process.exit(0);
  const [rule, ...prefixes] = args;
  const why = rule === 'protected' ? isProtected(rel, 'HEAD') : null;
  if (why) {
    // Name the path as the caller wrote it; matching used the case the disk reports.
    const typed = path.relative(path.resolve(root), target).split(path.sep).join('/');
    const shown = typed && !typed.startsWith('..') && !path.isAbsolute(typed) ? typed : rel;
    deny(`${who} may not write ${shown}: it is a protected path (${why}). The fast track does not change it. `
      + 'Stop and report ESCALATE; the developer uses /speckit-team.');
  }
  if ((rule === 'tests' || rule === 'no-tests') && testPaths.bad) {
    deny(`${who} may not write ${rel} until the test patterns can be read: ${testPaths.bad}. `
      + 'Report this to the user, who fixes the file; do not edit it yourself.');
  }
  // A prefix ending in / is a directory; anything else must match the whole path.
  if (rule === 'only' && !prefixes.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)))) {
    deny(`${who} may only write ${prefixes.join(', ')}; ${rel} is outside that lane. `
      + 'Tests belong to test-writer and production code to implementer: report what should change instead.');
  }
  if (rule === 'tests' && !inLane('tests', rel)) {
    deny(`${who} writes only test files and ticks tasks.md; ${rel} is production code and belongs to implementer. `
      + 'If it is a test file the patterns miss, add a regex line to .specify/test-paths.');
  }
  if (rule === 'no-tests' && SPECKIT_CONFIG.test(rel)) {
    deny(`${who} may not write ${rel}: .specify/ holds Spec Kit's config, which picks the active feature and what counts as a test. `
      + 'Report what should change instead.');
  }
  if (rule === 'no-tests' && !inLane('no-tests', rel)) {
    deny(`${who} may not change tests: ${rel} is part of the executable spec. `
      + 'If the test is wrong, stop and report it with evidence so test-writer or the human can fix it.');
  }
  process.exit(0);
}

if (mode === 'gate') {
  // A typed /speckit-implement fires UserPromptExpansion, not UserPromptSubmit or PreToolUse(Skill).
  const typed = event === 'UserPromptExpansion';
  if (typed && !/(^|:)speckit[-.]implement$/.test(input.command_name || '')) process.exit(0);
  // Reporting back is not work. Gating SubagentHandback leaves a blocked agent unable to say so.
  if (event === 'PreToolUse' && input.tool_name === 'SubagentHandback') process.exit(0);
  if (event === 'PreToolUse' && input.tool_name === 'Skill') {
    const ti = input.tool_input || {};
    if (!/(^|:)speckit[-.]implement$/.test(ti.skill_name || ti.skill || ti.name || '')) process.exit(0);
  }
  const problem = auditProblem();
  if (problem) {
    const reason = `Implementation gate: ${problem}. Run @agent-spec-auditor and get VERDICT: PASS first.`;
    if (typed) block(reason);
    deny(reason);
  }
  if (args[0] === 'retries') {
    const feat = feature();
    const r = readState(retryFile(feat));
    if (r === null) {
      deny(`Retry limit: the retry record for ${feat} is unreadable, so no further attempt can be allowed. `
        + `Delete ${retryFile(feat)} to reset it.`);
    }
    if (redCount(r, feat) >= MAX_RED) {
      deny(`Retry limit: implementer reported RESULT: RED ${MAX_RED} times in a row on ${feat} with the current plan and tasks. `
        + 'Stop and report back; do not try to reset the count. The architect rethinks plan.md or tasks.md '
        + `(the new audit resets the count), or the user decides, and only the user retries unchanged by deleting ${retryFile(feat)}.`);
    }
  }
  if (agentId && !fs.existsSync(baseFile(agentId))) {
    const sha = git(root, 'rev-parse', 'HEAD');
    if (sha) writeJson(baseFile(agentId), { sha, dirty: changedSince('HEAD') });
  }
  process.exit(0);
}

if (mode === 'verdict') {
  const viaHandback = event === 'PreToolUse';
  if (viaHandback && input.tool_name !== 'SubagentHandback') process.exit(0);
  const text = reportText(viaHandback);
  const found = [...text.matchAll(/^[\s*>#]*VERDICT:?[\s*]*(PASS|FAIL)\b/gim)].pop();
  const feat = feature();
  const ask = 'End your report with a final line that is exactly `VERDICT: PASS` or `VERDICT: FAIL`.';
  if (!found) {
    if (viaHandback) {
      // Refuse once, so the report gets its verdict; never twice, so the agent is never gagged.
      const asked = agentId && path.join(stateDir, 'agents', `${agentId}.verdict-asked`);
      if (!asked || fs.existsSync(asked)) process.exit(0);
      writeJson(asked, {});
      deny(`${ask} Add it and send the report again.`);
    }
    const prev = feat && readState(verdictFile(feat));
    if (input.stop_hook_active || (prev && agentId && prev.agent_id === agentId)) process.exit(0);
    block(ask);
  }
  if (!feat) process.exit(0);
  const verdict = found[1].toUpperCase();
  writeJson(verdictFile(feat), {
    verdict, feature: feat, fingerprint: fingerprint(feat), at: new Date().toISOString(), agent_id: agentId,
  });
  emit({ systemMessage: `spec-auditor recorded VERDICT: ${verdict} for ${feat}` });
}

// Every implementer report ends with RESULT: GREEN, RED or STUB. GREEN clears the count, STUB (the
// signatures-only pass before tests are written) leaves it, RED adds one. A report that still has no
// RESULT line after one request counts as RED: it did not show the tests passing.
if (mode === 'result') {
  const viaHandback = event === 'PreToolUse';
  if (viaHandback && input.tool_name !== 'SubagentHandback') process.exit(0);
  const feat = feature();
  if (!feat) process.exit(0);
  // The Stop that follows a counted handback is the same attempt, not a second one.
  const done = agentId && path.join(stateDir, 'agents', `${agentId}.result`);
  if (done && fs.existsSync(done)) process.exit(0);
  const found = [...reportText(viaHandback).matchAll(/^[\s*>#]*RESULT:?[\s*]*(GREEN|RED|STUB)\b/gim)].pop();
  if (!found) {
    const ask = 'End your report with a final line that is exactly `RESULT: GREEN`, `RESULT: RED` or `RESULT: STUB`.';
    const asked = agentId && path.join(stateDir, 'agents', `${agentId}.result-asked`);
    // Refuse once, so the report gets its result; never twice, so the agent is never gagged.
    if (viaHandback && asked && !fs.existsSync(asked)) { writeJson(asked, {}); deny(`${ask} Add it and send the report again.`); }
    if (!viaHandback && !input.stop_hook_active) block(ask);
  }
  const result = found ? found[1].toUpperCase() : 'RED';
  if (done) writeJson(done, { result });
  // An implementer the audit gate stopped never got to work: its RED is not an attempt.
  const closed = auditProblem();
  if (closed) emit({ systemMessage: `implementer reported ${result} while the gate was closed (${closed}); not counted.` });
  const f = retryFile(feat);
  const prev = readState(f);
  if (prev === null) {
    emit({ systemMessage: `speckit-team: implementer reported ${result}, but the retry record ${f} is unreadable; delete it to reset the count.` });
  }
  if (result === 'STUB') emit({ systemMessage: `implementer reported STUB for ${feat}; the retry count is unchanged.` });
  if (result === 'GREEN') {
    fs.rmSync(f, { force: true });
    emit({ systemMessage: `implementer reported GREEN for ${feat}; the retry count is reset.` });
  }
  const red = [...(redCount(prev, feat) ? prev.red : []), agentId ?? new Date().toISOString()];
  writeJson(f, { feature: feat, fingerprint: fingerprint(feat), red });
  emit({ systemMessage: red.length >= MAX_RED
    ? `implementer reported RED for ${feat} (${red.length} of ${MAX_RED}): retry limit reached. Route to the architect or the user.`
    : `implementer reported RED for ${feat} (${red.length} of ${MAX_RED} before the retry limit).` });
}

// A report that does not end in its verdict word is unfinished, however it got sent: refuse it once,
// so the agent finishes and resends; never twice, so it is never gagged.
if (mode === 'ends') {
  const viaHandback = event === 'PreToolUse';
  const record = args[0] === '--record';
  const words = record ? args.slice(1) : args;
  if (!words.length || (viaHandback && input.tool_name !== 'SubagentHandback')) process.exit(0);
  const ok = agentId && path.join(stateDir, 'agents', `${agentId}.ends-ok`);
  if (ok && fs.existsSync(ok)) process.exit(0);
  const last = reportText(viaHandback).trim().split('\n').pop() ?? '';
  const word = last.replace(/^[\s*>#`]+|[\s*`.]+$/g, '').toUpperCase();
  if (words.includes(word)) {
    if (ok) writeJson(ok, {});
    // Kept on disk next to the audit verdict, so a view of the pipeline (the board mod) reads the
    // gatekeeper's word from the same place whether or not it saw the agent stop. Only on --record:
    // test-writer's RED after a REJECTED would otherwise read as the gatekeeper's word.
    const feat = record && feature();
    if (feat) writeJson(endsFile(feat), { word, feature: feat, at: new Date().toISOString(), agent_id: agentId });
    process.exit(0);
  }
  const ask = `Your report must end with a final line that is exactly one of: ${words.join(', ')}. `
    + 'Finish the work first, then send the full report.';
  const asked = agentId && path.join(stateDir, 'agents', `${agentId}.ends-asked`);
  if (viaHandback && asked && !fs.existsSync(asked)) { writeJson(asked, {}); deny(ask); }
  if (!viaHandback && !input.stop_hook_active) block(ask);
  process.exit(0);
}

if (mode === 'lane') {
  const rule = args[0];
  const f = agentId && baseFile(agentId);
  const base = f && readState(f);
  if (!base) {
    if (base === null) emit({ systemMessage: `speckit-team: lane check could not run for ${who}: its start record is unreadable.` });
    process.exit(0);
  }
  // Only a hex commit id reaches git's argument list: "--output=..." would be read as an option.
  if (typeof base.sha !== 'string' || !/^[0-9a-f]{40,64}$/.test(base.sha) || !Array.isArray(base.dirty)) {
    emit({ systemMessage: `speckit-team: lane check could not run for ${who}: its start record is incomplete.` });
  }
  if (testPaths.bad) emit({ systemMessage: `speckit-team: lane check could not run for ${who}: ${testPaths.bad}.` });
  // A diff against a commit git cannot find fails, and a failed diff would read as "nothing changed".
  if (git(root, 'cat-file', '-e', `${base.sha}^{commit}`) === null) {
    emit({ systemMessage: `speckit-team: lane check could not run for ${who}: its start commit ${base.sha.slice(0, 12)} is not in this repo.` });
  }
  const outside = changedSince(base.sha).filter((rel) => !base.dirty.includes(rel) && !inLane(rule, rel));
  if (outside.length && !input.stop_hook_active) {
    block(`Lane check: ${who} changed files outside its lane: ${outside.join(', ')}. `
      + `Restore them (git checkout ${base.sha.slice(0, 12)} -- <file>, or delete new files), then finish.`);
  }
  fs.rmSync(f, { force: true });
  if (outside.length) emit({ systemMessage: `WARNING: ${who} left changes outside its lane: ${outside.join(', ')}` });
  process.exit(0);
}

// The fast track: patcher's change since its first tool call must stay within PATCH_LINES production
// lines in PATCH_FILES production files. Tests and docs do not count (FR-005).
const patchFile = (key) => path.join(stateDir, 'patch', `${key}.json`);
const HEX64 = /^[0-9a-f]{64}$/;
function stateOf(rel) {
  try { return createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex'); } catch { return null; }
}
// SHA-256 of each installed team file (agents/, hooks/, skills/<name>/, the two settings files), keyed by
// its TEAM_DIR-relative path; null for a missing settings file. Never throws.
function teamState() {
  const out = {};
  const hash = (rel) => { try { return createHash('sha256').update(fs.readFileSync(path.join(TEAM_DIR, rel))).digest('hex'); } catch { return null; } };
  const entries = (rel) => { try { return fs.readdirSync(path.join(TEAM_DIR, rel), { withFileTypes: true }); } catch { return []; } };
  const files = (rel) => { for (const e of entries(rel)) if (e.isFile()) out[`${rel}/${e.name}`] = hash(`${rel}/${e.name}`); };
  try {
    files('agents'); files('hooks');
    for (const e of entries('skills')) if (e.isDirectory()) files(`skills/${e.name}`);
    for (const f of ['settings.json', 'settings.local.json']) out[f] = hash(f);
  } catch { /* contributes nothing */ }
  return out;
}
const teamChanged = (before) => {
  const now = teamState();
  return [...new Set([...Object.keys(before), ...Object.keys(now)])].filter((k) => (before[k] ?? null) !== (now[k] ?? null)).sort();
};
function measure(start) {
  const sha = start.sha;
  const must = (out) => { if (out === null) throw new Error('git could not measure the change'); return out; };
  const tests = testsAt(sha);
  const dirty = new Set(Object.keys(start.dirty));
  const cls = (rel) => (isProtected(rel, sha) ? 'protected' : tests.isTest(rel) ? 'test' : isDoc(rel) ? 'doc' : 'prod');
  const parseNumstat = (out) => {
    const map = new Map(); const t = out.split('\0');
    for (let i = 0; i < t.length;) {
      const m = /^(-|\d+)\t(-|\d+)\t([^]*)$/.exec(t[i]);
      if (!m) { i++; continue; }
      const stat = { ins: Number(m[1]) || 0, del: Number(m[2]) || 0, bin: m[1] === '-' };
      if (m[3] === '') { map.set(t[i + 2], stat); i += 3; } else { map.set(m[3], stat); i++; }
    }
    return map;
  };
  const stats = parseNumstat(must(git(root, 'diff', '--find-renames', '--numstat', '-z', sha)));
  const tokens = must(git(root, 'diff', '--find-renames', '--name-status', '-z', sha)).split('\0');
  const r = { lines: 0, files: 0, binary: [], protectedChanged: [], committed: false, dirtyTouched: [], changed: [], untracked: [] };
  const changed = new Set(); const untracked = new Set();
  const note = (rel, set) => { if (cls(rel) !== 'protected') { changed.add(rel); if (set) set.add(rel); } };
  const prod = (rel, n, bin) => { r.files++; r.lines += n; if (bin) r.binary.push(rel); };
  for (let i = 0; i < tokens.length && tokens[i];) {
    const status = tokens[i];
    const renamed = status[0] === 'R';
    const old = renamed ? tokens[i + 1] : null;
    const rel = renamed ? tokens[i + 2] : tokens[i + 1];
    i += renamed ? 3 : 2;
    if (dirty.has(rel) || (old !== null && dirty.has(old))) continue;
    const st = stats.get(rel) ?? { ins: 0, del: 0, bin: false };
    const c = cls(rel);
    note(rel); if (old !== null) note(old);
    if (!renamed) {
      if (c === 'protected') r.protectedChanged.push({ path: rel, isNew: status === 'A' });
      else if (c === 'prod') prod(rel, status === 'D' ? st.del : Math.max(st.ins, st.del), st.bin && status !== 'D');
      continue;
    }
    const co = cls(old);
    if (c === 'protected' || co === 'protected') {
      r.protectedChanged.push({ path: old, isNew: false }, { path: rel, isNew: true });
    } else if (co === 'prod' && c === 'prod') {
      prod(rel, Math.max(st.ins, st.del), st.bin && status !== 'R100');
    } else if (co === 'prod' || c === 'prod') {
      const pair = parseNumstat(must(git(root, 'diff', '--no-renames', '--numstat', '-z', sha, '--', old, rel)));
      if (co === 'prod') prod(old, (pair.get(old) ?? st).del, false);
      else { const p = pair.get(rel) ?? st; prod(rel, p.ins, p.bin); }
    }
  }
  for (const rel of must(git(root, 'ls-files', '--others', '--exclude-standard', '-z')).split('\0').filter(Boolean)) {
    if (dirty.has(rel)) continue;
    const c = cls(rel);
    note(rel, untracked);
    if (c === 'protected') { r.protectedChanged.push({ path: rel, isNew: true }); continue; }
    if (c !== 'prod') continue;
    let buf; try { buf = fs.readFileSync(path.join(root, rel)); } catch { buf = Buffer.alloc(0); }
    if (buf.subarray(0, 8000).includes(0)) prod(rel, 0, true);
    else prod(rel, buf.length ? buf.toString('latin1').split('\n').length - (buf[buf.length - 1] === 10 ? 1 : 0) : 0, false);
  }
  r.committed = git(root, 'rev-parse', 'HEAD') !== sha;
  const swept = r.committed
    ? new Set(must(git(root, 'diff', '--no-renames', '--name-only', '-z', sha, 'HEAD')).split('\0')) : new Set();
  r.dirtyTouched = [...dirty].filter((rel) => stateOf(rel) !== start.dirty[rel] || swept.has(rel)).sort();
  r.changed = [...changed].sort(); r.untracked = [...untracked].sort();
  return r;
}

// Bash commands the fast track may not run: history and remote commands (research R15) and wholesale
// restores that can overwrite the developer's uncommitted work (plan.md decision 16 point 3).
const HISTORY_SUBCOMMANDS = new Set(['commit', 'commit-tree', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'stash', 'tag',
  'branch', 'switch', 'update-ref', 'symbolic-ref', 'notes', 'replace', 'filter-branch', 'push', 'pull', 'fetch', 'clone', 'remote',
  'ls-remote', 'submodule', 'send-email', 'request-pull']);
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const program = (w) => w.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
// The subcommand index after the git word at words[i], skipping git's options.
function afterGitOptions(words, i) {
  let j = i + 1;
  while (j < words.length && words[j].startsWith('-')) j += GIT_OPTIONS_WITH_VALUE.has(words[j]) ? 2 : 1;
  return j;
}
function historyCommand(command) {
  if (typeof command !== 'string') return null;
  const words = command.split(/[\s;&|(){}<>`"'$!]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const prog = program(words[i]);
    if (prog === 'gh' || prog === 'hub') return prog;
    if (prog !== 'git') continue;
    const j = afterGitOptions(words, i);
    const sub = words[j];
    if (sub === undefined) continue;
    if (HISTORY_SUBCOMMANDS.has(sub)) return `git ${sub}`;
    if (sub === 'checkout' && !words.slice(j + 1).includes('--')) return 'git checkout';
  }
  return null;
}
function gitCalls(command) {
  const calls = [];
  for (const seg of command.split(/[\n;&|()]+/)) {
    const words = seg.split(/[\s"'`]+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (program(words[i]) !== 'git') continue;
      const j = afterGitOptions(words, i);
      if (j < words.length) calls.push({ sub: words[j], args: words.slice(j + 1) });
    }
  }
  return calls;
}
function treeCommand(command, start) {
  if (typeof command !== 'string') return null;
  const wholesale = (w) => {
    if (w === '.' || w === '..' || w.endsWith('/') || /[*?[]/.test(w) || w.startsWith(':')) return true;
    try { if (fs.statSync(path.resolve(cwd, w)).isDirectory()) return true; } catch { /* not an existing path */ }
    const rel = repoRel(w);
    return rel !== null && Object.prototype.hasOwnProperty.call(start.dirty, rel);
  };
  for (const { sub, args } of gitCalls(command)) {
    if (sub === 'reset' && args.includes('--hard')) return 'git reset --hard';
    if (sub === 'clean') return 'git clean';
    let paths = null;
    if (sub === 'checkout' && args.includes('--')) paths = args.slice(args.indexOf('--') + 1);
    else if (sub === 'restore') {
      if (args.some((a) => a === '--pathspec-from-file' || a.startsWith('--pathspec-from-file='))) return 'git restore --pathspec-from-file';
      const dd = args.indexOf('--');
      if (dd >= 0) paths = args.slice(dd + 1);
      else paths = args.filter((a, k) => !a.startsWith('-') && !['-s', '--source'].includes(args[k - 1]));
    }
    const hit = paths?.find(wholesale);
    if (hit !== undefined) return sub === 'checkout' ? `git checkout -- ${hit}` : `git restore ${hit}`;
  }
  return null;
}

// Step 6 of the patch PreToolUse path: a command that only restores protected files (contracts/hook-cli.md).
function restoreAllowed(command, start, m) {
  if (typeof command !== 'string' || /[;&|`$<>\n\r]/.test(command)) return false;
  const w = command.trim().split(/\s+/);
  const entry = (word, isNew) => { const rel = repoRel(word); return rel !== null && m.protectedChanged.some((e) => e.path === rel && e.isNew === isNew); };
  if (w[0] === 'rm') {
    let k = 1;
    if (w[k] === '-f') k++;
    if (w[k] === '--') k++;
    const paths = w.slice(k);
    return paths.length > 0 && paths.every((p) => !p.startsWith('-') && entry(p, true));
  }
  if (w[0] !== 'git') return false;
  if (w[1] === 'reset') return m.committed && w.length === 4 && w[2] === '--soft' && !w[3].startsWith('-');
  const args = w.slice(2);
  let paths;
  if (w[1] === 'checkout') {
    const dd = args.indexOf('--');
    if (dd < 0 || dd > 1 || (dd === 1 && args[0].startsWith('-'))) return false;
    paths = args.slice(dd + 1);
  } else if (w[1] === 'restore') {
    paths = [];
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (a === '--') { paths.push(...args.slice(k + 1)); break; }
      if (a === '-s') { k++; continue; }
      if (a.startsWith('--source=') || a === '--staged' || a === '--worktree') continue;
      if (a.startsWith('-')) return false;
      paths.push(a);
    }
  } else return false;
  return paths.length > 0 && paths.every((p) => entry(p, false));
}

// The end of a fast-track run (contracts/hook-cli.md "End of run"). Exits.
function endCheck(start, viaHandback, key, acceptedFile) {
  const s12 = start.sha.slice(0, 12);
  let m;
  try { m = measure(start); } catch (e) {
    emit({ systemMessage: `speckit-team: fast-track check could not run for ${who}: ${e?.message ?? e}.` });
  }
  const refuse = (reason) => (viaHandback ? deny(reason) : block(reason));
  if (m.protectedChanged.length) {
    refuse(`Fast track: ${who} changed protected files: `
      + m.protectedChanged.map((e) => (e.isNew ? `${e.path} (new: delete it)` : `${e.path} (git checkout ${s12} -- ${e.path})`)).join(', ')
      + '. Restore them, then finish. The hook changes nothing itself.');
  }
  if (m.committed) {
    refuse(`Fast track: ${who} committed (${m.lines} lines in ${m.files} files since ${s12}). The fast track never commits; /speckit-patch commits after this check. `
      + `Run git reset --soft ${s12} so the work stays uncommitted, then finish.`);
  }
  const team = teamChanged(start.team);
  if (team.length) {
    emit({ systemMessage: `fast track FAILED: installed agent team files changed during the run: ${team.map((t) => `${TEAM_DIR}/${t}`).join(', ')}. `
      + 'The fast track cannot restore them, and cannot tell a change patcher made from a setting Claude Code or you saved. '
      + 'The end check did not accept the run, so /speckit-patch commits nothing and opens no pull request; the work is uncommitted in the working tree. '
      + 'Check those files (if an agent, hook or skill file changed, reinstall the team with node install.mjs from the speckit-agents checkout), then run the change again.' });
  }
  if (m.lines > PATCH_LINES || m.files > PATCH_FILES || m.binary.length || m.dirtyTouched.length) {
    emit({ systemMessage: `fast track stopped: ${m.lines} changed production lines in ${m.files} files (limit ${PATCH_LINES} lines, ${PATCH_FILES} files)`
      + (m.binary.length ? `; binary production files: ${m.binary.join(', ')}` : '')
      + (m.dirtyTouched.length ? `; changed although they had uncommitted changes when the run started: ${m.dirtyTouched.join(', ')}` : '')
      + '. Nothing was committed; the work is uncommitted in the working tree. Use /speckit-team for this change.' });
  }
  writeJson(acceptedFile, { key, sha: start.sha, files: m.changed, untracked: m.untracked, lines: m.lines, filesTouched: m.files, at: new Date().toISOString() });
  emit({ systemMessage: `fast track: ${m.lines} of ${PATCH_LINES} production lines, ${m.files} of ${PATCH_FILES} production files (tests and docs not counted). The end check accepted the run.` });
}

if (mode === 'patch') {
  // Every call removes the accepted record: it stands only while the last call was an accepting end check.
  const acceptedFile = path.join(git(root, 'rev-parse', '--absolute-git-dir'), 'speckit-team', 'patch-accepted.json');
  fs.rmSync(acceptedFile, { force: true });
  const viaHandback = event === 'PreToolUse' && input.tool_name === 'SubagentHandback';
  const isEnd = viaHandback || event !== 'PreToolUse';
  const key = str(input.agent_id) ?? str(input.session_id);
  if (!key || !/^[\w-]{1,128}$/.test(key)) noDecision('no agent_id or session_id to keep the start record under');
  const f = patchFile(key);
  if (isEnd && !fs.existsSync(f)) process.exit(0);
  if (!fs.existsSync(f)) {
    const sha = git(root, 'rev-parse', 'HEAD');
    if (!sha) deny('Fast track: this repo has no commit to measure the change from. Commit first, or use /speckit-team.');
    const dirty = Object.fromEntries(changedSince('HEAD').map((rel) => [rel, stateOf(rel)]));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try { fs.writeFileSync(f, JSON.stringify({ sha, dirty, team: teamState(), at: new Date().toISOString() }, null, 1), { flag: 'wx' }); } catch { /* written by a parallel call */ }
  }
  const start = readState(f);
  const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (!plain(start) || typeof start.sha !== 'string' || !/^[0-9a-f]{40,64}$/.test(start.sha) || !plain(start.dirty)
    || !plain(start.team) || !Object.values(start.team).every((v) => v === null || (typeof v === 'string' && HEX64.test(v)))
    || !Object.values(start.dirty).every((v) => v === null || (typeof v === 'string' && HEX64.test(v)))
    || git(root, 'cat-file', '-e', `${start.sha}^{commit}`) === null) {
    if (isEnd) emit({ systemMessage: `speckit-team: fast-track check could not run for ${who}: ${f} is unreadable or names a commit this repo does not have.` });
    deny(`Fast track: the budget cannot be measured: ${f} is unreadable or names a commit this repo does not have. `
      + 'Report this; the user deletes the file to start over.');
  }
  const bad = testsAt(start.sha).bad;
  if (bad) {
    if (isEnd) emit({ systemMessage: `speckit-team: fast-track check could not run for ${who}: ${bad} (as committed at ${start.sha.slice(0, 12)}).` });
    deny(`Fast track: the budget cannot be measured: ${bad} (as committed at ${start.sha.slice(0, 12)}). `
      + 'Report this to the user, who fixes and commits the file, then starts a new run.');
  }
  if (isEnd) endCheck(start, viaHandback, key, acceptedFile);
  const ti = input.tool_input || {};
  const given = ti.file_path ?? ti.notebook_path;
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name) && str(given)) {
    const rel = repoRel(given);
    const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    const hit = rel === null ? undefined : Object.keys(start.dirty).find((k) => same(k, rel));
    if (hit) {
      deny(`Fast track: ${hit} had uncommitted changes when the run started. They are the developer's work, so the fast track leaves the file alone. `
        + 'If the change needs this file, report ESCALATE; the developer commits or stashes that work first, or uses /speckit-team.');
    }
  }
  if (input.tool_name === 'Bash') {
    const cmd = ti.command;
    const h = historyCommand(cmd);
    if (h) {
      deny(`Fast track: ${who} may not run ${h}: the fast track never commits, pushes or opens a pull request; /speckit-patch does that after the end-of-run check accepts the run. `
        + 'Change the working tree only, run the tests, and report DONE, FAILED or ESCALATE.');
    }
    const t = treeCommand(cmd, start);
    if (t) {
      deny(`Fast track: ${who} may not run ${t}: it can overwrite or delete files that had uncommitted changes when the run started, which are the developer's work. `
        + 'Restore a file by naming it (git checkout <sha12> -- <file>); never ., a folder or a pattern. If that is not enough, report ESCALATE.');
    }
  }
  let m;
  try { m = measure(start); } catch (e) {
    deny(`Fast track: the budget cannot be measured: ${e?.message ?? e}. Report this; the user starts a new run.`);
  }
  const pending = m.protectedChanged.length > 0 || m.committed;
  if (m.lines > PATCH_LINES || m.files > PATCH_FILES || m.binary.length || m.dirtyTouched.length) {
    if (input.tool_name === 'Bash' && restoreAllowed(ti.command, start, m)) process.exit(0);
    deny(`Fast-track budget exceeded: ${m.lines} changed production lines in ${m.files} files (limit ${PATCH_LINES} lines, ${PATCH_FILES} files)`
      + (m.binary.length ? `; binary production files are not allowed: ${m.binary.join(', ')}` : '')
      + (m.dirtyTouched.length ? `; changed or committed although they had uncommitted changes when the run started, so the change cannot be measured: ${m.dirtyTouched.join(', ')}` : '')
      + '. Tests and docs do not count. Stop: leave the work uncommitted and report ESCALATE; the developer re-runs the change with /speckit-team.'
      + (pending ? ` First restore the protected files, naming each one (git checkout ${start.sha.slice(0, 12)} -- <file>, or rm <file> for a new file), and undo any commit (git reset --soft ${start.sha.slice(0, 12)}).` : ''));
  }
  process.exit(0);
}
