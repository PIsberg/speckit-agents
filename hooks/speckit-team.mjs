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
// .txt is documentation only under docs/ or with a documentation-style name (owner decision 2026-10-10);
// requirements.txt and CMakeLists.txt are production.
const DOC_PATTERNS = [
  /\.(md|mdx|markdown|rst|adoc|asciidoc)$/i,
  /^docs\/.*\.txt$/i,
  /(^|\/)(README|CHANGELOG|CHANGES|HISTORY|NEWS|LICENSE|NOTICE|AUTHORS|CONTRIBUTING|COPYING)\.txt$/i,
];
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
  // The auditor's first tool call records the files it starts from: a verdict is about the files it
  // read, and one that finishes after they changed would stamp itself on files nobody audited (#77).
  const startFile = agentId && path.join(stateDir, 'agents', `${agentId}.audit-start.json`);
  const doneFile = agentId && path.join(stateDir, 'agents', `${agentId}.verdict-done`);
  if (event === 'PreToolUse' && input.tool_name !== 'SubagentHandback') {
    const feat = feature();
    if (!startFile || !feat) process.exit(0);
    // Work after a report is a new audit by the same agent (one resumed with SendMessage): it starts afresh.
    if (fs.existsSync(doneFile)) { fs.rmSync(doneFile, { force: true }); fs.rmSync(startFile, { force: true }); }
    if (!fs.existsSync(startFile)) writeJson(startFile, { feature: feat, fingerprint: fingerprint(feat), at: new Date().toISOString() });
    process.exit(0);
  }
  const viaHandback = event === 'PreToolUse';
  const text = reportText(viaHandback);
  const found = [...text.matchAll(/^[\s*>#]*VERDICT:?[\s*]*(PASS|FAIL)\b/gim)].pop();
  const feat = feature();
  const ask = 'End your report with a final line that is exactly `VERDICT: PASS` or `VERDICT: FAIL`.';
  // The Stop after a handback is the same report: neither recorded twice nor asked for again.
  if (doneFile && fs.existsSync(doneFile)) process.exit(0);
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
  if (doneFile) writeJson(doneFile, { verdict });
  // No start record (an auditor that made no tool call, or a main-thread Stop) keeps the old rule:
  // the verdict is on the files as they are now. An unreadable one proves nothing, so it is stale.
  const start = startFile ? readState(startFile) : undefined;
  if (start !== undefined && (!start || start.feature !== feat || start.fingerprint !== fingerprint(feat))) {
    emit({ systemMessage: `spec-auditor's VERDICT: ${verdict} was not recorded: spec, plan, tasks or constitution of ${feat} changed after it started `
      + `reading them${start?.at ? ` (${start.at})` : ''}, so it describes files that are gone. The last recorded verdict stands; run @agent-spec-auditor again on the current files.` });
  }
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
const FORGE_CLIS = new Set(['gh', 'hub', 'glab', 'tea']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
// git branch that only lists: live check L5 saw `git branch --show-current` denied (#72).
const BRANCH_READ_ONLY = new Set(['--show-current', '--list', '-l', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '--no-color', '--no-column']);
// A program word names a denied program by its last path segment, or as a glob that matches it
// (/usr/bin/g?t runs git when the file is there).
const DENIED_PROGRAMS = ['git', ...FORGE_CLIS, ...PACKAGE_MANAGERS];
function programOf(w) {
  const base = program(w);
  if (DENIED_PROGRAMS.includes(base) || !/[*?[]/.test(base)) return base;
  // A glob the shell would take literally (an unclosed [) is no regex either: it names itself.
  let re;
  try { re = new RegExp(`^${base.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^')}$`); } catch { return base; }
  return DENIED_PROGRAMS.find((p) => re.test(p)) ?? base;
}

// The command read as a shell reads it, enough to see which programs it runs (#72 and its two security
// reviews): quotes and escapes, $'...', line continuations, $VAR and ${VAR} (read where they are used,
// split on IFS when unquoted, ${X:-default}), for-loop variables, command and process substitutions
// (empty, and their own text read as commands), redirections and their targets dropped, and {a,b}
// brace expansion. Returns the simple commands, each a list of words. `pin` forces one variable to one
// value everywhere, for a loop that may have assigned it later in the text. Not a shell: a string built
// at run time (eval, read, a function) is not seen, and the end check still catches what gets through.
const BRACE_OPEN = '\u0001'; const BRACE_COMMA = '\u0002'; const BRACE_CLOSE = '\u0003';
function braceExpand(word) {
  const open = word.indexOf(BRACE_OPEN);
  if (open < 0) return [word];
  let depth = 0; const commas = [];
  for (let k = open; k < word.length; k++) {
    if (word[k] === BRACE_OPEN) depth++;
    else if (word[k] === BRACE_COMMA && depth === 1) commas.push(k);
    else if (word[k] === BRACE_CLOSE && --depth === 0) {
      const head = word.slice(0, open); const tail = word.slice(k + 1);
      if (!commas.length) return braceExpand(`${head}{${word.slice(open + 1, k)}}${tail}`);
      const cuts = [open, ...commas, k];
      return cuts.slice(1).flatMap((c, n) => braceExpand(head + word.slice(cuts[n] + 1, c) + tail));
    }
  }
  return [word.replace(/[\u0001-\u0003]/g, (m) => ({ [BRACE_OPEN]: '{', [BRACE_COMMA]: ',', [BRACE_CLOSE]: '}' })[m])];
}
function ansiC(body) {
  const esc = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
  return body.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|.)/g, (_, e) => {
    if (/^[xuU]/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    if (e[0] === 'c') return String.fromCharCode(e.charCodeAt(1) & 31);
    return esc[e] ?? `\\${e}`;
  });
}
// The text between the bracket at src[i] and its partner, and the index after the partner.
function balanced(src, i, openCh, closeCh) {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '\\') { k++; continue; }
    if (src[k] === "'") { const e = src.indexOf("'", k + 1); k = e < 0 ? src.length : e; continue; }
    if (src[k] === openCh) depth++;
    else if (src[k] === closeCh && --depth === 0) return [src.slice(i + 1, k), k + 1];
  }
  return [src.slice(i + 1), src.length];
}
// A value only known at run time: a substitution's output, $@ or $1, an unset variable, an expansion
// this reading does not compute. Where git's subcommand or a program word would be, it is denied.
const DYN = '\u0004';
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'mksh', 'busybox']);
function shellCommands(src, pin = null, assigned = null, depth = 0, inherit = {}) {
  // Too deep to read is not read as harmless: the caller denies the command (fail closed).
  if (depth > 8) throw new Error('nested more than 8 levels deep');
  const cmds = []; const vars = { ...inherit }; let cur = []; let word = null; let braces = 0;
  const record = (name, value) => { vars[name] = value; if (assigned) (assigned[name] ??= new Set()).add(value); };
  // IFS unset is the shell's default, so an unquoted ${IFS} splits words (git${IFS}push).
  const value = (name) => (pin && pin.name === name ? pin.value : vars[name] ?? (name === 'IFS' ? ' \t\n' : undefined));
  const push = () => {
    if (word === null) return;
    const w = word; word = null; braces = 0;
    const m = /^([A-Za-z_]\w*)=([^]*)$/.exec(w);
    if (m && cur.every((c) => ['export', 'declare', 'local', 'readonly', 'typeset'].includes(c) || c.startsWith('-'))) { record(m[1], m[2]); return; }
    cur.push(...braceExpand(w).filter((x) => x !== '' || !w.includes(BRACE_OPEN)));
  };
  // Text the shell runs as a command (a substitution, sh -c, eval, a here-string to a shell) is
  // read as commands of its own, with the variables known at that point.
  const sub = (inner) => { cmds.push(...shellCommands(inner, pin, assigned, depth + 1, vars)); };
  // A word's text as the shell expands it, joined, for text that is run again.
  const expanded = (text) => shellCommands(text, pin, null, depth + 1, vars).flat().join(' ');
  const end = () => {
    push();
    const done = cur; cur = [];
    if (done[0] === 'for' && done[2] === 'in') for (const v of done.slice(3)) record(done[1], v);
    if (done.length) cmds.push(done);
    const shellAt = done.findIndex((w, k) => SHELLS.has(program(w)) && /^-[a-z]*c[a-z]*$/i.test(done[k + 1] ?? ''));
    if (shellAt >= 0 && done[shellAt + 2] !== undefined) sub(done[shellAt + 2]);
    const evalAt = done.indexOf('eval');
    if (evalAt >= 0) sub(done.slice(evalAt + 1).join(' '));
  };
  const add = (s) => { word = (word ?? '') + s; };
  // An unquoted expansion is split into words on IFS (the command's own, if it sets one).
  const addSplit = (v) => {
    const ifs = vars.IFS ?? ' \t\n';
    if (!v) return;
    const parts = ifs ? v.split(new RegExp(`[${ifs.replace(/[\]\\^-]/g, '\\$&')}]`)) : [v];
    parts.forEach((p, n) => { if (n) push(); if (p) add(p); });
  };
  // $... at src[i]: returns the index after it, having added its value to the word.
  const dollar = (i, quoted) => {
    const put = (v, split = false) => { const s = v ?? DYN; if (quoted && !split) add(s); else addSplit(s); };
    if (src[i] === '`') { const e = src.indexOf('`', i + 1); sub(src.slice(i + 1, e < 0 ? undefined : e)); add(DYN); return e < 0 ? src.length : e + 1; }
    const c = src[i + 1];
    if (c === '(') {
      if (src[i + 2] === '(') { const [, after] = balanced(src, i + 1, '(', ')'); add('0'); return after; }
      const [inner, after] = balanced(src, i + 1, '(', ')'); sub(inner); add(DYN); return after;
    }
    if (c === '{') {
      const [inner, after] = balanced(src, i + 1, '{', '}');
      const m = /^(!?)(#?)([A-Za-z_]\w*|[@*#?$!0-9-])(\[[^\]]*\])?([^]*)$/.exec(inner);
      if (!m) { add(DYN); return after; }
      const [, bang, hash, name, index, op] = m;
      if (hash && !op) { add('0'); return after; }
      let v = /^[@*0-9]$/.test(name) ? DYN : value(name);
      if (bang) v = v === undefined || v === DYN ? DYN : value(v);
      const whole = /^\[[@*]\]$/.test(index ?? '');
      if (index && !whole && v !== undefined && v !== DYN) { const n = Number(index.slice(1, -1)); v = Number.isInteger(n) ? v.split(/\s+/)[n] : DYN; }
      if (/^:?[-=]/.test(op)) { if (v === undefined || v === '') v = expanded(op.replace(/^:?[-=]/, '')); }
      else if (/^:?\+/.test(op)) v = v ? expanded(op.replace(/^:?\+/, '')) : '';
      else if (op && !/^:?\?/.test(op) && !/^(\^\^?|,,?|~~?)$/.test(op)) v = DYN;
      put(v, whole);
      return after;
    }
    const m = /^[A-Za-z_]\w*/.exec(src.slice(i + 1));
    if (m) { put(value(m[0])); return i + 1 + m[0].length; }
    if (c && /[@*0-9]/.test(c)) { add(DYN); return i + 2; }
    if (c && /[#?$!-]/.test(c)) { add('0'); return i + 2; }
    add('$'); return i + 1;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { if (src[i + 1] === '\n') i += 2; else if (src.startsWith('\r\n', i + 1)) i += 3; else { add(src[i + 1] ?? ''); i += 2; } continue; }
    if (c === "'") { const e = src.indexOf("'", i + 1); add(src.slice(i + 1, e < 0 ? undefined : e)); i = e < 0 ? src.length : e + 1; continue; }
    if (c === '$' && src[i + 1] === "'") {
      let k = i + 2; while (k < src.length && src[k] !== "'") k += src[k] === '\\' ? 2 : 1;
      add(ansiC(src.slice(i + 2, k))); i = k + 1; continue;
    }
    if (c === '"') {
      add(''); i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`\n'.includes(src[i + 1])) { if (src[i + 1] !== '\n') add(src[i + 1]); i += 2; continue; }
        if (src[i] === '$' || src[i] === '`') { i = dollar(i, true); continue; }
        add(src[i]); i++;
      }
      i++; continue;
    }
    if (c === '$' || c === '`') { i = dollar(i, false); continue; }
    if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
      if ((c === '<' || c === '>') && src[i + 1] === '(') { const [inner, after] = balanced(src, i + 1, '(', ')'); sub(inner); i = after; continue; }
      if (word !== null && /^\d+$/.test(word)) word = null; else push();
      let k = i; while (k < src.length && /[<>&|]/.test(src[k])) k++;
      const op = src.slice(i, k);
      if (op.endsWith('&') && /[\d-]/.test(src[k] ?? '')) { i = k + 1; continue; }
      while (k < src.length && /[ \t]/.test(src[k])) k++;
      // The target: one word, quotes kept together. A here-string may be a script for a shell.
      const from = k;
      while (k < src.length && !/[\s;&|<>()]/.test(src[k])) {
        if (src[k] === "'" || src[k] === '"') { const e = src.indexOf(src[k], k + 1); k = e < 0 ? src.length : e + 1; } else k++;
      }
      if (op === '<<<') sub(expanded(src.slice(from, k)));
      i = k; continue;
    }
    // An array assignment, a=(git push): its words are its value, as "${a[@]}" gives them back.
    if (c === '(' && word !== null && /^[A-Za-z_]\w*\+?=$/.test(word) && cur.every((w) => ['export', 'declare', 'local', 'readonly', 'typeset'].includes(w) || w.startsWith('-'))) {
      const [inner, after] = balanced(src, i, '(', ')');
      record(word.replace(/\+?=$/, ''), shellCommands(inner, pin, null, depth + 1, vars).flat().join(' '));
      word = null; i = after; continue;
    }
    if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')') { end(); i++; continue; }
    if (/\s/.test(c)) { push(); i++; continue; }
    if ((c === '{' || c === '}') && word === null && /[\s;]/.test(src[i + 1] ?? ' ')) { end(); i++; continue; }
    if (c === '{') { braces++; add(BRACE_OPEN); i++; continue; }
    if (c === ',' && braces > 0) { add(BRACE_COMMA); i++; continue; }
    if (c === '}' && braces > 0) { braces--; add(BRACE_CLOSE); i++; continue; }
    add(c); i++;
  }
  end();
  return cmds;
}
// Every reading worth checking: the command as it runs once, then once per value each assigned
// variable takes, so a loop that reassigns it later in the text is read with that value too.
function readings(command) {
  const assigned = {};
  const first = shellCommands(command, null, assigned);
  const pins = Object.entries(assigned).flatMap(([name, values]) => [...values].map((v) => ({ name, value: v })));
  if (pins.length > 64) throw new Error(`more than 64 assigned values (${pins.length})`);
  return [first, ...pins.map((p) => shellCommands(command, p))].map((cmds) => cmds.flatMap((c) => [...c, SEP]));
}
// Words, with only a command separator (; & | newline) as a boundary between them: anything else the
// shell drops or substitutes, such as `` or $(...), still leaves git next to its subcommand.
const SEP = '\0';
const flatWords = (command) => command.split(/([;&|\n]+)|[\s(){}<>`"'$!]+/).filter((t) => t !== undefined && t !== '').map((t) => (/^[;&|\n]+$/.test(t) ? SEP : t));
function historyWords(words) {
  const simple = (k) => { const end = words.indexOf(SEP, k); return words.slice(k, end < 0 ? undefined : end); };
  for (let i = 0; i < words.length; i++) {
    const prog = programOf(words[i]);
    if (FORGE_CLIS.has(prog)) return prog;
    if (PACKAGE_MANAGERS.has(prog) && simple(i + 1).includes('publish')) return `${prog} publish`;
    if (prog !== 'git') continue;
    const j = afterGitOptions(words, i);
    const sub = words[j];
    if (sub === undefined || sub === SEP) continue;
    if (sub.includes(DYN)) return 'git with a subcommand known only at run time';
    if (sub === 'branch' && simple(j + 1).every((w) => BRANCH_READ_ONLY.has(w))) continue;
    if (HISTORY_SUBCOMMANDS.has(sub)) return `git ${sub}`;
    if (sub === 'checkout' && !simple(j + 1).includes('--')) return 'git checkout';
    // A word git does not know as a command may be the value of an option this list lacks
    // (git --attr-source x push): the next words are then the subcommand.
    if (!GIT_READ_COMMANDS.has(sub)) {
      const next = simple(j + 1).slice(0, 2).find((w) => HISTORY_SUBCOMMANDS.has(w));
      if (next) return `git ${next}`;
    }
  }
  // A program only known at run time ($TOOL, a substitution) given a history or forge command.
  for (let i = 0; i + 1 < words.length; i++) {
    if (words[i].includes(DYN) && RUN_TIME_SUSPECT.has(words[i + 1])) return 'a program known only at run time';
  }
  return null;
}
const GIT_READ_COMMANDS = new Set(['status', 'diff', 'log', 'show', 'add', 'mv', 'rm', 'restore', 'reset', 'grep', 'blame', 'annotate',
  'ls-files', 'ls-tree', 'rev-parse', 'rev-list', 'describe', 'config', 'init', 'apply', 'format-patch', 'shortlog', 'cat-file',
  'hash-object', 'check-ignore', 'check-attr', 'help', 'version', 'var', 'reflog', 'show-ref', 'for-each-ref', 'name-rev',
  'merge-base', 'diff-tree', 'diff-files', 'diff-index', 'count-objects', 'fsck', 'archive', 'clean', 'checkout', 'worktree',
  'range-diff', 'whatchanged', 'cherry', 'interpret-trailers', 'check-ref-format', 'stage']);
const RUN_TIME_SUSPECT = new Set([...HISTORY_SUBCOMMANDS, 'pr', 'mr', 'release', 'api', 'repo', 'publish', 'pull-request']);
function historyCommand(command) {
  if (typeof command !== 'string') return null;
  const flat = historyWords(flatWords(command));
  if (flat) return flat;
  let read;
  // A command this reading cannot finish is denied, not let through: the hook fails closed here.
  try { read = readings(command); } catch (e) { return `a command the hook could not read (${e?.message ?? e})`; }
  // The fast track's start record and accepted record decide the end check; a shell write could reset them.
  const state = /\.git[\\/]+speckit-team(?![\w.-])/i;
  if (state.test(command) || read.some((ws) => ws.some((w) => state.test(w)))) return "a command on the fast track's state";
  // The flat words keep the old rule that a command which only mentions git push is denied too.
  // Name the program when any reading can; "known only at run time" only when none can.
  const found = read.map(historyWords).filter(Boolean);
  if (found.length) return found.find((f) => !f.includes('known only at run time')) ?? found[0];
  // An alias defined on the command line runs whatever it names, under a name no list can know.
  const alias = (ws) => ws.some((w, k) => programOf(w) === 'git' && ws.slice(k + 1).some((a, n, rest) => /^-c\s*alias\./i.test(a) || (a === '-c' && /^alias\./i.test(rest[n + 1] ?? ''))));
  return [flatWords(command), ...read].some(alias) ? 'git -c alias' : null;
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
