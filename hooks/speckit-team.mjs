#!/usr/bin/env node
// speckit-agents: managed by install.mjs. Edit the source repo and reinstall, not this copy.
// Guardrails for the Spec Kit agent team. How it works: README.md of the speckit-agents repo.
// Called from agent frontmatter hooks and from ~/.claude/settings.json. Every mode is a
// no-op outside a git repo that contains .specify/, so registering it globally is safe.
//
//   scope only <prefix>...  PreToolUse Write/Edit: allow only paths under these prefixes
//   scope tests             PreToolUse Write/Edit: allow only test files and specs/*/tasks.md
//   scope no-tests          PreToolUse Write/Edit: allow anything except test files
//   gate                    PreToolUse / UserPromptExpansion: block implementation until
//                           spec-auditor has passed the current spec, plan, tasks, constitution
//   gate retries            the same, and also block implementer after MAX_RED REDs in a row
//   verdict                 SubagentStop of spec-auditor: record its VERDICT line
//   result                  SubagentHandback / Stop of implementer: count its RESULT line
//   ends <word>...          SubagentHandback / Stop: the report's last line must be one of the words
//   lane tests|no-tests     SubagentStop: check the agent's whole diff, including Bash writes
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
// Implementer may report RED this many times in a row on one plan and tasks, then the gate stops it.
const MAX_RED = 3;

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

function extraTestPatterns() {
  return lines(readOr(path.join(root, '.specify', 'test-paths'), ''))
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => new RegExp(l));
}
const isTest = (rel) => [...TEST_PATTERNS, ...extraTestPatterns()].some((re) => re.test(rel));
const inLane = (rule, rel) => (rule === 'tests' ? isTest(rel) || TASKS_FILE.test(rel) : !isTest(rel));

function feature() {
  try { return JSON.parse(readOr(path.join(root, '.specify', 'feature.json'), '')).feature_directory; } catch { return null; }
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
// REDs count only against the plan and tasks they were made on: a revision starts from zero.
const redCount = (r, feat) => (r && r.fingerprint === fingerprint(feat) && Array.isArray(r.red) ? r.red.length : 0);
const writeJson = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 1)); };

function auditProblem() {
  const feat = feature();
  if (!feat) return 'no active feature in .specify/feature.json';
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

function changedSince(base) {
  return [...new Set([
    ...lines(git(root, 'diff', '--name-only', base)),
    ...lines(git(root, 'ls-files', '--others', '--exclude-standard')),
  ])];
}

// Two ways a report arrives: as the SubagentHandback tool's message (PreToolUse, the normal case in
// interactive sessions) or as the agent's last message (SubagentStop, e.g. under claude -p).
// Only a string is a report: String(['VERDICT: PASS']) would otherwise read as a PASS.
const reportText = (viaHandback) => (viaHandback
  ? (typeof input.tool_input?.message === 'string' ? input.tool_input.message : '') : lastAssistantText());

function lastAssistantText() {
  if (input.last_assistant_message) return input.last_assistant_message;
  const entries = lines(readOr(input.agent_transcript_path || '', '')).reverse();
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
  // Both sides resolved alike: git reports the real root, Claude Code passes the path it was given,
  // and a symlinked or short-named way into the repo must not read as outside it.
  const rel = path.relative(real(root), real(target)).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0);
  const [rule, ...prefixes] = args;
  // A prefix ending in / is a directory; anything else must match the whole path.
  if (rule === 'only' && !prefixes.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)))) {
    deny(`${who} may only write ${prefixes.join(', ')}; ${rel} is outside that lane. `
      + 'Tests belong to test-writer and production code to implementer: report what should change instead.');
  }
  if (rule === 'tests' && !inLane('tests', rel)) {
    deny(`${who} writes only test files and ticks tasks.md; ${rel} is production code and belongs to implementer. `
      + 'If it is a test file the patterns miss, add a regex line to .specify/test-paths.');
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
  if (!args.length || (viaHandback && input.tool_name !== 'SubagentHandback')) process.exit(0);
  const ok = agentId && path.join(stateDir, 'agents', `${agentId}.ends-ok`);
  if (ok && fs.existsSync(ok)) process.exit(0);
  const last = reportText(viaHandback).trim().split('\n').pop() ?? '';
  if (args.includes(last.replace(/^[\s*>#`]+|[\s*`.]+$/g, '').toUpperCase())) {
    if (ok) writeJson(ok, {});
    process.exit(0);
  }
  const ask = `Your report must end with a final line that is exactly one of: ${args.join(', ')}. `
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
  if (typeof base.sha !== 'string' || !Array.isArray(base.dirty)) {
    emit({ systemMessage: `speckit-team: lane check could not run for ${who}: its start record is incomplete.` });
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
