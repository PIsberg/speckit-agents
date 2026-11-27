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
//                           team, and in the speckit-agents repo its own sources; allow the rest. patcher's writes get
//                           this rule from `patch` (#444); the mode stays for the tests and a hand-wired entry
//   gate                    PreToolUse / UserPromptExpansion: block implementation until
//                           spec-auditor has passed the current spec, plan, tasks, constitution; skipped in a
//                           subagent whose session's team (recorded at the main session's launch of a team
//                           role from its `Team:` line, never a decision) lacks spec-auditor, and for the main
//                           session after the user typed /speckit-team --team noagents
//   gate retries            the same, and also block implementer after MAX_RED REDs in a row
//   gate [retries] scope <rule>  the same, then on a write or Bash call the scope rule, in one process (#337)
//   verdict                 SubagentStop of spec-auditor: record its VERDICT line
//   result                  SubagentHandback / Stop of implementer: count its RESULT line
//   ends [--record] <word>... SubagentHandback / Stop: the report's last line must be one of the words;
//                           --record keeps the accepted word for the feature (spec-gatekeeper's)
//   start                   SubagentStart of product-owner, architect and the read-only agents: record where the
//                           agent started, for the lane check at its Stop; never a decision
//   lane tests|no-tests|none|only <prefix>...  SubagentStop: check the agent's whole diff, including Bash writes
//                           (`none`: every changed file; spec-gatekeeper is only warned, #412)
//   patch                   PreToolUse (any tool): deny once the fast track's change passes its line and file budget,
//                           or it runs a history/remote command or a wholesale restore; run a Bash command it lets
//                           through with git's network transports off (in bypassPermissions, or where the installed
//                           settings.json allows the export line); SubagentHandback, SubagentStop and
//                           Stop: the end check (protected files, commits, the installed team's hashes, budget, a production change with no test unless the report says `No test:`) and the accepted record;
//                           the Stop after a handback counts the handback's `No test:` line (#354)
//   project <name> [--init] Not a hook: the skills run it from Bash. Prints the project's block (feature 007) or one
//                           refusal line, exit 0 or 1; --init creates .specify/projects/<name>/ with a starter file
//   relay                   PostToolUse of Agent in the main session: hands it what the hooks said inside its
//                           subagents (kept under notices/ as they said it), as additionalContext; never a decision
//   check                   Not a hook: the pipeline skills' first step (#230). Exit 1 when the team that would run
//                           is not this install alone (mixed builds, a second install of another build, a project
//                           install in a folder Claude Code has not trusted); `note:` lines otherwise.
//   check team              the same, then `state:` lines for /speckit-team's step 0: working tree, constitution, branch
//   check [team] --project <name>  the same, then the project mode's block; exit 1 with its refusal line (#338)
//   decisions --recommended Not a hook: /speckit-team's plan stop runs it when every answer is the recommended option.
//                           Records the answers in plan.md and applies the recommended `Spec:` lines to spec.md, or
//                           changes nothing and exits 1. `gate` refuses a spec-auditor launch while a decision is open
//   clarifications --recommended Not a hook: /speckit-team's spec stop runs it when every answer is the recommended one
//                           (#427). Records spec.md's `## Open Questions` under `## Clarifications` and drops the section,
//                           or changes nothing and exits 1. `gate` refuses an architect or spec-auditor launch while one is open
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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
// 012: the `load` lane. A load test is a test (isTest) whose path says load; load-test.md is the role's record.
const LOAD_PATTERNS = [/(^|[/._-])load([/._-]|$)/i, /[a-z0-9]Load(Tests?|IT|Spec)\.[A-Za-z]+$/];
const LOAD_RECORD = /^specs\/[^/]+\/load-test\.md$/;
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
  [/^hooks\/speckit-(team|drift)\.mjs$/i, "the agent team's own sources"],
  [/^agents\/[^/]+\.md$/i, "the agent team's own sources"],
  [/^skills\/[^/]+\/SKILL\.md$/i, "the agent team's own sources"],
  [/^install\.mjs$/i, "the agent team's own sources"],
  [/^package\.json$/i, 'its package name marks this repository as speckit-agents'],
];

// Projects (feature 007): .specify/projects/<name>/ holds instructions.md and knowledge files.
const PROJECTS_DIR = '.specify/projects';
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_INSTRUCTIONS = 8192;
const MAX_KNOWLEDGE = 100;
// Every line break a /m regex knows: CR, LF, U+2028 and U+2029. Built at run time, since a U+2028 in a regex
// literal is itself a line break in the source.
const LINE_BREAKS = new RegExp(`\r\n|[\r${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
// A file name that could start a line of its own in the block: a control character or a line separator.
const NEWLINE = String.fromCharCode(10);
const UNSAFE_NAME = new RegExp(`[\x00-\x1f\x7f${String.fromCharCode(0x2028, 0x2029)}]`);
// What `project <name> --init` writes; left unchanged it counts as no instructions.
const starterText = (name) => `# ${name}: project instructions\n\n`
  + `Replace this file with the rules every agent should follow for ${name}, one per line.\n`
  + 'Put reference documents (API docs, style guides, domain notes) beside it as knowledge files.\n';

const [mode, ...args] = process.argv.slice(2);
// `project` and `check` are run by the skills from Bash, not by Claude Code: they answer on stdout with
// exit 0 or 1, written synchronously, since a pipe on Windows drops what is still queued at process.exit.
const CLI = mode === 'project' || mode === 'check' || mode === 'audit' || mode === 'decisions' || mode === 'clarifications' || mode === 'probe';
const projectSay = (text, code) => { fs.writeSync(1, `${text}\n`); process.exit(code); };
const projectRefuse = (why) => projectSay(`speckit-team: ${mode}: ${why}`, 1);
// Claude Code always sends a JSON object, so anything else is a wiring fault. Parsing must not throw:
// a crashed hook is a non-blocking error, and the action would go through with nobody told. The
// CLI modes read no stdin: run from Bash, it may be held open and never end.
const raw = CLI ? '{}' : (() => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } })();
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
// The name of an agent's state files under agents/, and of patch's start record. An id that is not word
// characters is hashed, so a path segment in it can never place a file outside the state directory.
const AGENT_ID = /^[\w-]{1,128}$/;
const keyOf = (id) => id && (AGENT_ID.test(id) ? id : `id-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`);
const agentKey = keyOf(agentId);
// Safety net under every specific check below: a hook must never exit with a crash, because Claude
// Code then lets the action through and says nothing. Inside a Spec Kit repo any error that slips
// through becomes no decision plus a visible message; outside one it stays silent.
let inSpecKitRepo = false;
process.on('uncaughtException', (e) => {
  if (CLI) projectRefuse(`internal error (${e?.message ?? e}).`);
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
  start: ['SubagentStart'],
  patch: ['PreToolUse', 'SubagentStop', 'Stop'],
  relay: ['PostToolUse'],
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
// A message a role-skill step passes on with whatever the hook decides next (contract section 8).
const hookStartNs = process.hrtime.bigint();
let note = null;
const addNote = (m) => { note = [note, m].filter(Boolean).join('\n'); };
// #231: set once the state folder is known, for a hook running in a subagent (see keepNotice below).
let keepNotice = null;
let recordActivity = null;
const emit = (obj) => {
  const say = [note, obj.systemMessage].filter(Boolean).join('\n');
  if (say && keepNotice) keepNotice(say);
  if (recordActivity) {
    const hso = obj.hookSpecificOutput;
    const dec = hso?.permissionDecision === 'deny' ? 'deny'
      : obj.decision === 'block' ? 'block'
      : mode === 'start' ? 'start'
      : (mode === 'verdict' || mode === 'result' || mode === 'ends') ? 'record'
      : 'allow';
    recordActivity(dec);
  }
  process.stdout.write(JSON.stringify(say ? { ...obj, systemMessage: say } : obj));
  process.exit(0);
};
const finish = () => {
  if (note) emit({});
  if (recordActivity) recordActivity(mode === 'start' ? 'start' : 'allow');
  process.exit(0);
};
const deny = (reason) => emit({ hookSpecificOutput: {
  hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const block = (reason) => emit({ decision: 'block', reason });

const cwd = str(input.cwd) ?? process.cwd();
// `probe` (012): how busy the machine is and how fast a fixed workload runs, so a load test can say when
// other processes disturbed it. `node:os` and `node:crypto` only; synchronous.
const cpuTimes = () => os.cpus().reduce((a, c) => {
  const t = Object.values(c.times).reduce((x, y) => x + y, 0);
  return { idle: a.idle + c.times.idle, total: a.total + t };
}, { idle: 0, total: 0 });
function probeReading() {
  const a = cpuTimes();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  const b = cpuTimes();
  const total = b.total - a.total;
  const busy = total > 0 ? Math.min(100, Math.max(0, Math.round((1 - (b.idle - a.idle) / total) * 100))) : 0;
  const buf = Buffer.alloc(1024 * 1024, 7);
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    for (let j = 0; j < 64; j++) createHash('sha256').update(buf).digest();
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  runs.sort((x, y) => x - y);
  return { busy, ms: Math.round(runs[2] * 100) / 100 };
}
function noisyLines(start, end) {
  const out = [];
  const worst = Math.max(start.busy, end.busy);
  if (worst >= 10) out.push(`noisy: other processes used ${worst}% of the machine (10% or more)`);
  if (end.ms >= start.ms * 1.2) out.push(`noisy: the fixed probe ran ${Math.round((end.ms / start.ms - 1) * 100)}% slower at the end than at the start (20% or more)`);
  return out;
}
if (mode === 'probe') {
  let start = null;
  if (args.length) {
    const parts = args[0] === '--since' && args.length === 2 ? args[1].split(',') : null;
    const nums = parts && parts.length === 2 && parts.every((x) => /^\d+(\.\d+)?$/.test(x.trim())) ? parts.map(Number) : null;
    if (!nums || !(nums[1] > 0)) projectRefuse('--since takes two non-negative numbers, busy percent and probe ms, as --since <busy>,<ms>; the second above 0');
    start = { busy: nums[0], ms: nums[1] };
  }
  const end = probeReading();
  const lines = [`probe: busy ${end.busy}% probe ${end.ms} ms${start ? ` (start: busy ${start.busy}%, probe ${start.ms} ms)` : ''}`];
  if (start) lines.push(...noisyLines(start, end));
  projectSay(lines.join('\n'), 0);
}
// Most calls come from outside any Spec Kit repo: the settings.json gates run on every Skill and Agent
// call in every repo. The repo's root is the working directory or an ancestor of it, so when none of them
// holds .specify/ the answer needs no git process. A GIT_DIR or GIT_WORK_TREE can put the work tree
// elsewhere, so git decides then, as it does when the directory cannot be resolved.
function specifyAbove(dir) {
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE) return true;
  let d;
  try { d = fs.realpathSync.native(path.resolve(dir)); } catch { return true; }
  for (;;) {
    if (fs.existsSync(path.join(d, '.specify'))) return d;
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}
// Every hook mode stays silent outside a Spec Kit repo; the project mode is asked a question and says no.
const notSpecKit = () => (CLI ? projectRefuse('no .specify/ in this repository.') : process.exit(0));
const specDir = specifyAbove(cwd);
if (!specDir) notSpecKit();
// One git process for the work tree's root and the git directory every worktree shares.
// #215: a global config git may not read (a sandbox that denies ~/.gitconfig) fails every git command
// on git 2.56, and a failed call here read as "no repo", so every mode let the action through in
// silence. Then the repo is read without the global and system config, which git could not use
// anyway: NUL on Windows, where git refuses Node's \\.\nul. A Spec Kit folder git still cannot read,
// though a .git sits beside its .specify/, gets a visible no-decision instead of silence.
// #433: the git spawn costs about 20 ms a hook call on Windows. When .git sits beside .specify/ and no other .git
// lies between the working directory and it, the two directories are read from the file system: a .git directory,
// or a .git file naming a linked worktree's or a submodule's git dir (whose commondir file names the shared one).
// Anything else (no .git there, a nested repo, GIT_DIR, an unreadable file) asks git as before.
function fsRepoDirs() {
  if (typeof specDir !== 'string') return null;
  try {
    let d = fs.realpathSync.native(path.resolve(cwd));
    while (d !== specDir) {
      if (fs.existsSync(path.join(d, '.git'))) return null;
      const up = path.dirname(d);
      if (up === d) return null;
      d = up;
    }
    const dotGit = path.join(specDir, '.git');
    const st = fs.statSync(dotGit);
    let gitDir = dotGit;
    if (st.isFile()) {
      const m = /^gitdir: (.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      if (!m) return null;
      gitDir = path.resolve(specDir, m[1].trim());
    } else if (!st.isDirectory()) return null;
    const named = path.join(gitDir, 'commondir');
    const common = fs.existsSync(named) ? path.resolve(gitDir, fs.readFileSync(named, 'utf8').trim()) : gitDir;
    // A HEAD git would refuse (#215's damaged repo) goes to git, which says so.
    if (!/^(ref: refs\/\S+|[0-9a-f]{40}|[0-9a-f]{64})\s*$/.test(fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8'))) return null;
    // #215: a global config that exists but cannot be read fails every git command on Windows; the later calls
    // then need the same fallback repoDirs() sets after a failed rev-parse.
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const globals = process.env.GIT_CONFIG_GLOBAL ? [process.env.GIT_CONFIG_GLOBAL]
      : [path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'git', 'config'), path.join(home, '.gitconfig')];
    for (const f of globals) {
      try { fs.readFileSync(f); } catch (e) {
        if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') { process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : os.devNull; process.env.GIT_CONFIG_NOSYSTEM = '1'; break; }
      }
    }
    const slash = (p) => fs.realpathSync.native(p).split(path.sep).join('/');
    return [slash(specDir), slash(common), slash(gitDir)];
  } catch { return null; }
}
function repoDirs() {
  const fast = fsRepoDirs();
  if (fast) return fast;
  const args = ['-c', 'core.quotepath=off', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--git-dir'];
  const once = () => {
    try { return { out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) {
      return { err: String(e?.stderr ?? e?.message ?? '') };
    }
  };
  let r = once();
  if ('err' in r && /reading the configuration files|unable to access/.test(r.err)) {
    process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : os.devNull;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    r = once();
  }
  if ('out' in r) return lines(r.out.trim());
  if (/not a git repository/i.test(r.err) && !(typeof specDir === 'string' && fs.existsSync(path.join(specDir, '.git')))) return [];
  const why = r.err.trim().split(/\r?\n/).filter(Boolean).pop() || 'git failed';
  if (CLI) projectRefuse(`git could not read the repository here (${why}).`);
  return emit({ systemMessage: `speckit-team: ${mode} could not read the git repository here (${why}); no decision made.` });
}
// #444: the third is the worktree's own git dir, which the fast track's records use.
const [root, commonDir, ownGitDir] = repoDirs();
if (!root || !commonDir || !fs.existsSync(path.join(root, '.specify'))) notSpecKit();
inSpecKitRepo = true;

// #228: the drift check, a second file beside this script, loaded only by the modes that can close
// spec-gatekeeper's report: `ends --record`, and `gate` and `lane role`, which close a skill-agents role; and
// by test-writer's `ends`, for the half of it that reads the tasks alone (#315).
// Loaded here, inside a Spec Kit repo, so no other repo pays for it. A missing or broken file is kept as
// the error, and APPROVED is then recorded with a message that the check did not run (constitution II).
// #336: `gate` closes a role only at a Skill call; it also runs on every tool call of test-writer and
// implementer, which never need the module.
const driftModule = mode === 'ends' || (mode === 'gate' && event === 'PreToolUse' && input.tool_name === 'Skill')
  || (mode === 'lane' && (args[0] === 'role' || input.agent_type === 'architect'))
  ? await import(new URL('./speckit-drift.mjs', import.meta.url).href).catch((e) => e) : null;
// The active feature's drift: { problems }, or { failed } when the check could not run. Without `spec`, only the
// IDs its ticked test tasks cite, which is all a round's test-writer owes.
function driftOf(feat, spec = true) {
  if (typeof driftModule?.drift !== 'function') return { failed: driftModule?.message ?? 'speckit-drift.mjs has no drift()' };
  const t = spec ? teamOf() : null;
  const testFirst = spec && (!t || (t.roles.includes('test-writer') && t.roles.includes('implementer')));
  try { const r = driftModule.drift(root, { feature: feat, spec, testFirst }); return { problems: r.problems, unchecked: r.unchecked ?? [] }; } catch (e) { return { failed: e?.message ?? String(e) }; }
}
// #465: the requirements of the feature's spec.md no test task of its tasks.md cites or excuses; [] when the check cannot run.
function plannedOf(feat) {
  try { return typeof driftModule?.planned === 'function' ? driftModule.planned(root, feat) : []; } catch { return []; }
}
const planRefusal = (ids) => `Plan check: tasks.md leaves ${ids.join(', ')} of spec.md with no test task. Cite each on a test task that names `
  + 'its test file, or give the task that covers it "No test: <reason>" (a process or docs rule), then finish. '
  + 'Found now, it costs one edit; at spec-gatekeeper it costs a new audit and a round (#465).';
// #482: the unticked task IDs of tasks.md that an architect report's `Round <n>:` lines leave out, in task order. None for a
// report with no Round line: a revision that leaves tasks.md alone gives none. A range (`T002-T004`, `T002 to T004`) names
// every ID in it.
function roundGaps(feat, report) {
  if (!feat || typeof report !== 'string') return [];
  const rounds = report.split('\n').filter((l) => /\bRound\s*\d+\s*:/.test(l)).join(' ');
  if (!rounds) return [];
  const named = new Set(rounds.match(/\bT\d{3,}\b/g) ?? []);
  for (const m of rounds.matchAll(/\bT(\d{3,})\s*(?:-|–|to|\.\.)\s*T(\d{3,})\b/g)) {
    for (let k = Number(m[1]); k <= Number(m[2]) && k - Number(m[1]) < 1000; k++) named.add(`T${String(k).padStart(m[1].length, '0')}`);
  }
  const open = [...readOr(path.join(root, feat, 'tasks.md'), '').matchAll(/^\s*[-*]\s+\[ \]\s+(T\d{3,})\b/gm)].map((m) => m[1]);
  return [...new Set(open)].filter((id) => !named.has(id));
}
const roundRefusal = (ids) => `Round check: the \`Round <n>:\` lines of your report leave out ${ids.join(', ')} of tasks.md, so the main `
  + 'session would have to read tasks.md to build them. Name every task ID in one round\'s stub, red or green list, then send '
  + 'the report again (#482).';
// #235: besides the cited IDs of test tasks, every FR of spec.md must be in a test line naming the feature's number.
const driftRefusal = (name, problems) => `${name}'s APPROVED is refused: requirements that no test holds (the drift check: each ID a test `
  + 'task cites must be in one of its test files, and every FR of spec.md in a test line naming the feature\'s number, '
  + `as test-writer writes "001 FR-002" in a test's name or a comment):\n${problems.join('\n')}\n`
  + 'A requirement no test holds cannot be approved, whatever argument covers it. Report each as a rejection reason '
  + '(owner: test-writer, who adds the test, or the ID to the test that already covers it) and end with REJECTED.';
// #315, #316: test-writer's RED or FIXED while a ticked test task cites an ID none of its test files holds.
const citedRefusal = (word, problems) => `Your ${word} leaves requirements a ticked test task cites in none of its test files:\n${problems.join('\n')}\n`
  + 'Put each ID in the name or a comment of the test that holds it, after the feature\'s number ("001 FR-002"); '
  + 'on a test the task says to keep, as a comment. A task that is not yours: leave it and say so. Then send the full report.';
const citedStands = (name, word, problems) => `speckit-team: ${name} reported ${word} with cited requirements no test names: ${problems.join('; ')}. `
  + 'spec-gatekeeper\'s APPROVED is refused while they stand.';
const citedUnchecked = (name, word, failed) => `speckit-team: the cited-ID check could not run (${failed}), so ${name}'s ${word} goes on without it.`;
// #371: a spec whose FR IDs the check cannot read as requirements is recorded, and the user told so.
const specUnread = (name, unchecked) => `speckit-team: ${name}'s APPROVED is recorded without the spec-level drift check: ${unchecked.join('; ')}`;
const driftUnchecked = (name, failed) => `speckit-team: the drift check could not run (${failed}), so ${name}'s APPROVED is `
  + 'recorded without it. Reinstall the team (node install.mjs) to put speckit-drift.mjs beside the hook.';

// The valid project names under .specify/projects/, sorted; symlinked entries are not projects.
function projectNames() {
  try {
    return fs.readdirSync(path.join(root, PROJECTS_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory() && PROJECT_NAME.test(e.name)).map((e) => e.name).sort();
  } catch { return []; }
}
// A project's block (contracts/project.md, section 3) or why there is none. Symlinks are never
// followed: a project is files in this repository.
function renderProject(name) {
  const refused = (why) => ({ refused: `${why} Projects: ${projectNames().join(', ') || 'none'}.` });
  if (typeof name !== 'string' || !PROJECT_NAME.test(name)) return refused(`${name} is not a project name: letters, digits, - and _ only.`);
  const rel = `${PROJECTS_DIR}/${name}`;
  let entry;
  try { entry = fs.readdirSync(path.join(root, PROJECTS_DIR), { withFileTypes: true }).find((e) => e.name === name); } catch { /* no projects */ }
  if (entry?.isSymbolicLink()) return refused(`${rel} is a symlink; a project must be a directory in the repository.`);
  if (!entry?.isDirectory()) return refused(`no project ${name} in ${PROJECTS_DIR}/; create it with --init.`);
  const dir = path.join(root, rel);
  const insFile = path.join(dir, 'instructions.md');
  let ins = null;
  let st = null;
  try { st = fs.lstatSync(insFile); } catch { /* no instructions */ }
  if (st) {
    if (!st.isFile()) return refused(`${rel}/instructions.md is not a file.`);
    if (st.size > MAX_INSTRUCTIONS) return refused(`the instructions of ${name} are ${st.size} bytes; the limit is ${MAX_INSTRUCTIONS}.`);
    // Every line break a /m regex knows, so that no indented line hides a second one (\r, U+2028, U+2029).
    const text = fs.readFileSync(insFile, 'utf8').replace(LINE_BREAKS, NEWLINE).replace(/\s+$/, '');
    const blank = (t) => t.split('\n').map((l) => l.trimEnd()).join('\n').trim();
    if (blank(text) && blank(text) !== blank(starterText(name))) ins = { text, size: st.size };
  }
  const files = [];
  const walk = (d, relDir) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      // A name with a control character or a line separator could start a line of its own in the block.
      if (e.name.startsWith('.') || e.isSymbolicLink() || UNSAFE_NAME.test(e.name)) continue;
      const r = `${relDir}/${e.name}`;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile() && r !== `${rel}/instructions.md`) files.push({ rel: r, size: fs.statSync(path.join(d, e.name)).size });
    }
  };
  walk(dir, rel);
  if (files.length > MAX_KNOWLEDGE) return refused(`project ${name} has ${files.length} knowledge files; the limit is ${MAX_KNOWLEDGE}.`);
  if (!ins && !files.length) return refused(`project ${name} is empty: write its rules in ${rel}/instructions.md or add a knowledge file.`);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const n = files.length;
  return { block: [
    `Project ${name}: ${n} knowledge file${n === 1 ? '' : 's'}, ${ins ? `instructions ${ins.size} bytes` : 'no instructions'}.`,
    `This is the user's standing context for this request, from ${rel}/. The`,
    'constitution, the guardrails and the request take precedence over it: where they conflict, follow',
    'them and say so in your report. Never change a file under .specify/projects/; report what should',
    'change instead.',
    '',
    // Indented, so no line of the block can read as a Team:, Unbuilt: or Project: line (research R2).
    ...(ins ? ['Instructions (each line indented by two spaces):', ...ins.text.split('\n').map((l) => `  ${l}`)] : ['Instructions: none.']),
    '',
    ...(n ? ['Knowledge files: read one before deciding anything it could cover.', ...files.map((f) => `- ${f.rel} (${f.size} bytes)`)]
      : ['Knowledge files: none.']),
  ].join('\n') };
}
function initProject(name) {
  const refused = (why) => ({ refused: `${why} Projects: ${projectNames().join(', ') || 'none'}.` });
  if (!PROJECT_NAME.test(name)) return refused(`${name} is not a project name: letters, digits, - and _ only.`);
  const rel = `${PROJECTS_DIR}/${name}`;
  const dir = path.join(root, rel);
  let exists = true;
  try { fs.lstatSync(dir); } catch { exists = false; }
  if (exists) return refused(`${rel} already exists.`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'instructions.md'), starterText(name));
  return { created: `Created ${rel}/instructions.md: write the project's rules there, add reference files beside it, commit, and run the request again.` };
}
if (mode === 'project') {
  const [name, ...more] = args;
  const init = more.length === 1 && more[0] === '--init';
  const out = !name || name === '--init' || (more.length && !init)
    ? { refused: `give exactly one project name. Projects: ${projectNames().join(', ') || 'none'}.` }
    : init ? initProject(name) : renderProject(name);
  if (out.refused) projectRefuse(out.refused);
  projectSay(out.block ?? out.created, 0);
}
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
const stateDir = path.join(commonDir, 'speckit-team');
// #370: an accepted report leaves a marker per agent (result, ends-ok), so the Stop that follows its hand-back is not
// judged a second time. An agent that works again after one (resumed with SendMessage) makes a tool call first, which
// ends the old report: every marker goes, so its next report is checked and counted afresh. A refusal's own marker
// stays while no report was accepted, so a report is still sent back once, never twice. spec-auditor's verdict mode
// keeps its own reset. A report with no tool call before it is told apart by markedReport() (#394).
if (event === 'PreToolUse' && agentKey && str(input.tool_name) && input.tool_name !== 'SubagentHandback') {
  const marker = (m) => path.join(stateDir, 'agents', `${agentKey}.${m}`);
  try { if (input.tool_name === 'Bash') fs.rmSync(marker('untested.json'), { force: true }); } catch { /* non-blocking */ }
  if (fs.existsSync(marker('result')) || fs.existsSync(marker('ends-ok'))) {
    try {
      for (const m of ['result', 'result-asked', 'ends-ok', 'ends-asked', 'red-asked', 'cited-asked', 'untested.json', 'untested-asked']) fs.rmSync(marker(m), { force: true });
    } catch (e) {
      addNote(`speckit-team: ${who}'s last report could not be closed (${e.message}); its next report may go unchecked.`);
    }
  }
}

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
// could not run, instead of crashing, which would let every write through. A line starting `!` takes the paths
// it matches out of the tests, after every pattern that adds, built-in or not (#372): a production folder named
// testing/, fixtures/, spec/ or e2e/. A bare `!` would take out every path, so it is a bad line too.
function parseTestPaths(text) {
  const patterns = [...TEST_PATTERNS]; const drops = []; const bad = [];
  text.split('\n').forEach((l, i) => {
    const t = l.trim();
    if (!t || t.startsWith('#')) return;
    const drop = t.startsWith('!');
    const src = drop ? t.slice(1).trim() : t;
    try {
      if (!src) throw new Error('empty');
      (drop ? drops : patterns).push(new RegExp(src));
    } catch { bad.push(`.specify/test-paths line ${i + 1} \`${t}\``); }
  });
  const isTest = (rel) => patterns.some((re) => re.test(rel)) && !drops.some((re) => re.test(rel));
  return { isTest, bad: bad.length ? `${bad.join(', ')} ${bad.length > 1 ? 'are not valid regular expressions' : 'is not a valid regular expression'}` : null };
}
// Read once per run, from the working tree.
const testPaths = parseTestPaths(readOr(path.join(root, '.specify', 'test-paths'), ''));
const isTest = testPaths.isTest;
// The same patterns as committed at a revision: the fast track measures with the rules the run started under.
const testsAtMemo = new Map();
function testsAt(rev) {
  if (!testsAtMemo.has(rev)) {
    const t = parseTestPaths(git(root, 'cat-file', 'blob', `${rev}:.specify/test-paths`) ?? '');
    testsAtMemo.set(rev, { isTest: t.isTest, bad: t.bad });
  }
  return testsAtMemo.get(rev);
}
const isLoadTest = (rel) => isTest(rel) && LOAD_PATTERNS.some((re) => re.test(rel));
// #418: a load test that says load only through a directory and is in commit `at` may be a functional test of a
// module named load, so the lane leaves it alone; a new file there, or one whose own name says load, stays in.
const oldDirLoad = (rel, at) => isLoadTest(rel) && !LOAD_PATTERNS.some((re) => re.test(rel.split('/').pop()))
  && git(root, 'cat-file', '-e', `${at}:${rel}`) !== null;
const inLane = (rule, rel) => (rule === 'load' ? !SPECKIT_CONFIG.test(rel) && (isLoadTest(rel) || LOAD_RECORD.test(rel)) : rule === 'tests' ? !SPECKIT_CONFIG.test(rel) && (isTest(rel) || TASKS_FILE.test(rel)) : !isTest(rel) && !SPECKIT_CONFIG.test(rel));
// A prefix ending in / is a directory; anything else must match the whole path.
const inPrefixes = (prefixes, rel) => prefixes.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)));

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
// #376: the retry record is read, added to and written back by every implementer's report. Two reports at once (slices
// built side by side) each read the old list and one RED was lost, so the change runs under a lock file created with
// wx, and the record is written to a temporary file and renamed over, so a reader never meets half a file. A lock
// older than LOCK_STALE_MS was left by a process that died, and is taken over. One not freed within LOCK_WAIT_MS is
// waited out no longer: the change runs unlocked, as before #376, and says so.
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 10000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function locked(f, fn) {
  const lock = `${f}.lock`;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  let held = false;
  for (const until = Date.now() + LOCK_WAIT_MS; !held && Date.now() < until;) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); held = true; } catch (e) {
      if (e?.code !== 'EEXIST') break;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.rmSync(lock, { force: true }); continue; } } catch { /* freed meanwhile */ }
      pause(10 + Math.floor(Math.random() * 20));
    }
  }
  if (!held) addNote(`speckit-team: ${lock} was not freed within ${LOCK_WAIT_MS} ms, so the retry count was changed without it; a RED reported at the same moment may be lost.`);
  try { return fn(); } finally { if (held) fs.rmSync(lock, { force: true }); }
}
function writeJsonAtomic(f, obj) {
  const tmp = `${f}.${process.pid}.tmp`;
  writeJson(tmp, obj);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, f); return; } catch (e) {
      // Windows refuses a rename over a file another process holds open without delete sharing: try again briefly.
      if (i >= 20 || (e?.code !== 'EPERM' && e?.code !== 'EACCES' && e?.code !== 'EBUSY')) { fs.rmSync(tmp, { force: true }); throw e; }
      pause(10);
    }
  }
}
const endsFile = (feat) => path.join(stateDir, 'ends', `${path.basename(feat)}.json`);
const securityFile = (feat) => path.join(stateDir, 'security', `${path.basename(feat)}.json`);
const loadFile = (feat) => path.join(stateDir, 'load', `${path.basename(feat)}.json`);
const reportFile = (role) => path.join(stateDir, 'reports', `${role}.json`);
const saveReport = (role, feat, word, text) => {
  if (!role || !feat || !text) return;
  try { writeJson(reportFile(role), { role, feature: feat, word, text: String(text).slice(0, 4000), at: new Date().toISOString() }); } catch { /* non-blocking */ }
};
const specFingerprint = (feat) => createHash('sha256').update(readOr(path.join(root, feat, 'spec.md'), '<missing>').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
// #242: spec-auditor FAILs in a row, per feature (see holdAudit). Defined here, above the gate mode that calls it.
const AUDIT_FAIL_LIMIT = 2;
const auditFile = (feat) => path.join(stateDir, 'audit', `${path.basename(feat)}.json`);
const auditRecord = (feat) => { const a = readState(auditFile(feat)); return a && typeof a === 'object' ? a : {}; };
// REDs count only against the plan and tasks they were made on: a revision starts from zero.
const redCount = (r, feat) => (r && r.fingerprint === fingerprint(feat) && Array.isArray(r.red) ? r.red.length : 0);
const writeJson = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 1)); };

// The team of a /speckit-team run, recorded at the main session's Agent launch (contracts/team-choice.md, 7).
const CORE_ROLES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'];
const TEAM_ROLES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'load-tester', 'spec-gatekeeper', 'security-reviewer'];
const SESSION_ID = /^[\w-]{1,128}$/;

// #231: a hook's systemMessage in a subagent lands in that subagent's transcript only, and under claude -p
// nobody sees it: an out-of-lane file left behind, a lane check that could not run, an APPROVED recorded
// as REJECTED. So each one is also kept under notices/, by the session the subagent's input names (the
// main session's), and `relay`, on the main session's PostToolUse of Agent, hands them over once.
const noticeFile = (sessionId) => path.join(stateDir, 'notices', `${sessionId}.jsonl`);
const activityFile = path.join(stateDir, 'activity.jsonl');
const noticeSession = str(input.session_id);
// #494: privacy-safe, fail-open JSONL activity and guardrail telemetry stream (.git/speckit-team/activity.jsonl).
// Skip inside patch mode so feature 003's FR-009 test (only patch/ exists under stateDir during patch PreToolUse) holds.
if (!CLI && mode !== 'patch' && mode !== 'relay') {
  recordActivity = (decision) => {
    try {
      const ti = input.tool_input || {};
      const rawTarget = str(ti.file_path ?? ti.notebook_path);
      const target = rawTarget ? repoRel(path.resolve(cwd, rawTarget)) : null;
      const role = str(input.agent_type) ?? (noticeSession && SESSION_ID.test(noticeSession) ? readState(roleFile(noticeSession))?.role ?? null : null);
      const ms = Math.round(Number(process.hrtime.bigint() - hookStartNs) / 1e4) / 100;
      const row = {
        v: 1, at: new Date().toISOString(), session_id: noticeSession ?? null, agent_id: agentId ?? null,
        role: role ?? null, feature: feature(), event: str(event) ?? null, mode: str(mode) ?? null,
        tool: str(input.tool_name) ?? null, target, decision, rule: args[0] ?? mode ?? null, ms,
      };
      fs.mkdirSync(stateDir, { recursive: true });
      fs.appendFileSync(activityFile, `${JSON.stringify(row)}\n`);
    } catch { /* Constitution III: observers never block */ }
  };
}
if (agentId && noticeSession && SESSION_ID.test(noticeSession) && mode !== 'relay') {
  keepNotice = (text) => {
    try {
      fs.mkdirSync(path.dirname(noticeFile(noticeSession)), { recursive: true });
      fs.appendFileSync(noticeFile(noticeSession), `${JSON.stringify({ agent: str(input.agent_type) ?? 'an agent', at: new Date().toISOString(), text: text.slice(0, 2000) })}\n`);
    } catch { /* the terminal still shows it */ }
  };
}
if (mode === 'relay') {
  if (input.tool_name !== 'Agent' || !noticeSession || !SESSION_ID.test(noticeSession)) process.exit(0);
  // Taken by renaming first, so a notice a parallel agent adds meanwhile goes to the next relay, not nowhere.
  const taken = `${noticeFile(noticeSession)}.${process.pid}`;
  try { fs.renameSync(noticeFile(noticeSession), taken); } catch { process.exit(0); }
  const rows = lines(readOr(taken, '')).flatMap((l) => {
    try { const r = JSON.parse(l); return typeof r?.text === 'string' ? [`- ${r.agent}: ${r.text}`] : []; } catch { return []; }
  });
  fs.rmSync(taken, { force: true });
  if (!rows.length) process.exit(0);
  emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
    `speckit-team: the team's hooks said this to the agents that just ran; it reached only their transcripts, so act on it here:\n${rows.join('\n')}` } });
}
const teamFile = (sessionId) => path.join(stateDir, 'team', `${sessionId}.json`);
// #366: a request typed without --team, whose team the user has not chosen yet: where its transcript stood then.
const choiceFile = (sessionId) => path.join(stateDir, 'choice', `${sessionId}.json`);
// 009: the role acting in a skill-agents request's main session (data-model.md).
const roleFile = (sessionId) => path.join(stateDir, 'role', `${sessionId}.json`);
// #284: every role skill loaded in a turn leaves its own `lane role` Stop hook, and Claude Code starts them
// together (five at the last Stop of the 2026-11-10 run), each having read the record before any wrote it.
// Whichever send-back (`why`: 'lane', 'drift', 'hand-on') one Stop makes, the process whose exclusive create
// takes its claim makes it; the others end with no output. Not an unlink: on Windows two processes can both
// unlink one file in the same millisecond (3 of 6 runs of the #261 e2e case had two winners). Keyed by the
// record's start, so a later role of the session never finds an earlier one's claim. A claim that cannot be
// made for another reason lets the process go on, as before #284.
const roleClaim = (sessionId, rec, why) => path.join(stateDir, 'role',
  `${sessionId}.${why}.${createHash('sha256').update(`${rec.role}\0${rec.at}\0${rec.sha}`).digest('hex').slice(0, 16)}.claim`);
function claimed(rec, why) {
  try { fs.writeFileSync(roleClaim(str(input.session_id), rec, why), '', { flag: 'wx' }); return true; } catch (e) { return e?.code !== 'EEXIST'; }
}
// What a claim holds when its send-back went out but the record could not say so: the next Stop then falls
// back to stop_hook_active, as it did before #284.
const UNRECORDED = 'unrecorded';
// Removes a session's role record and every claim on it.
function dropRoleFiles(sessionId) {
  fs.rmSync(roleFile(sessionId), { force: true });
  let names = [];
  try { names = fs.readdirSync(path.join(stateDir, 'role')); } catch { /* no folder, no claims */ }
  for (const n of names) if (n.startsWith(`${sessionId}.`) && n.endsWith('.claim')) fs.rmSync(path.join(stateDir, 'role', n), { force: true });
}
// #429: the model a main-session launch goes out on instead of its agent's `model:` line, or null. Only under the
// `fast` tier the installer records in its manifest beside this script, and only for the two mechanical launches the
// skill marks: implementer's stub pass (a line starting `stub`) and architect's dictated revision (`dictated:`).
function quickModel(role, ti) {
  if (ti?.model !== undefined) return null;
  const prompt = typeof ti?.prompt === 'string' ? ti.prompt : '';
  const mechanical = (role === 'implementer' && /^stub\b/m.test(prompt)) || (role === 'architect' && /^dictated:/m.test(prompt));
  if (!mechanical) return null;
  const m = readState(path.join(TEAM_DIR, 'hooks', 'speckit-agents.install.json'));
  return m && typeof m === 'object' && String(m.managedBy).includes('speckit-agents: managed by install.mjs') && m.models === 'fast' ? 'haiku' : null;
}
// The role skills a typed `--team skill-agents` (every role) or `--team hybrid` (the writers) needs, found from this
// script's own folder.
function missingRoleSkills(roles = TEAM_ROLES) {
  return roles.filter((r) => !fs.existsSync(path.join(TEAM_DIR, 'skills', `speckit-role-${r}`, 'SKILL.md')));
}
// #428: in `--team hybrid` the roles that write run as skills in the session, and the gates as agents, each in its own
// context with its own tool list. A gate's role skill is denied there; a writer's agent launch ends the mode.
const HYBRID_WRITERS = ['product-owner', 'architect', 'test-writer', 'implementer'];
const HYBRID_START = (load) => `speckit-team: hybrid for this request: product-owner, architect, test-writer and implementer run as skills in this session; spec-auditor, spec-gatekeeper, security-reviewer and load-tester run as agents. `
  + `Enforced by the hook: each writer role's lane, the audit gate before test-writer, implementer${load ? ', load-tester' : ''} and spec-gatekeeper, `
  + "the gates' verdicts and words, their own context and tool list as agents, and the retry limit at each implementer call (3 RESULT: RED in a row on the active feature). "
  + 'Not enforced: the audit gate on each tool call inside test-writer and implementer (a spec, plan or tasks edit there is caught when the next of them or a gate starts), '
  + "the retry limit without an active feature (the skill counts), each writer role's own context (every writer role sees this conversation) and tool list "
  + "(a writer role may use every tool of this session, MCP tools included), and a writer role's lane after its turn ends without a Stop "
  + "(an interrupt or an API error; the role's lane check and report then do not run).";
// The start message of a typed --team skill-agents request; it names load-tester only when --load-test was typed (#419:
// 012 FR-002, no added text in a run without the role).
const SKILL_AGENTS_START = (load) => (load
  ? `speckit-team: skill-agents for this request: the roles run as skills in this session. Enforced by the hook: each role's lane, the audit gate before test-writer, implementer, load-tester and spec-gatekeeper, spec-auditor's verdict and spec-gatekeeper's word, and the retry limit at each implementer call (3 RESULT: RED in a row on the active feature). Not enforced: the audit gate on each tool call inside test-writer and implementer, and inside load-tester (a spec, plan or tasks edit there is caught when the next of them or spec-gatekeeper starts), the retry limit without an active feature (the skill counts), the check that a report ends in its word, each role's own context (every role sees this conversation), each agent's tool list (a role may use every tool of this session, MCP tools included, and a read-only role's write through one is not checked), and a role's lane after its turn ends without a Stop (an interrupt or an API error; the role's lane check and report then do not run).`
  : `speckit-team: skill-agents for this request: the roles run as skills in this session. Enforced by the hook: each role's lane, the audit gate before test-writer, implementer and spec-gatekeeper, spec-auditor's verdict and spec-gatekeeper's word, and the retry limit at each implementer call (3 RESULT: RED in a row on the active feature). Not enforced: the audit gate on each tool call inside test-writer and implementer (a spec, plan or tasks edit there is caught when the next of them or spec-gatekeeper starts), the retry limit without an active feature (the skill counts), the check that a report ends in its word, each role's own context (every role sees this conversation), each agent's tool list (a role may use every tool of this session, MCP tools included, and a read-only role's write through one is not checked), and a role's lane after its turn ends without a Stop (an interrupt or an API error; the role's lane check and report then do not run).`);
// The project of a session's launches (feature 007, contracts/project.md section 5): a name, never content.
const projectFile = (sessionId) => path.join(stateDir, 'project', `${sessionId}.json`);
const parseProject = (prompt) => /^Project: ?([A-Za-z0-9][A-Za-z0-9_-]{0,63})[ \t]*$/m.exec(prompt)?.[1] ?? null;
// null: not a string or no Team line; { bad }: the first word that is no role ('' for none).
function parseTeam(prompt) {
  if (typeof prompt !== 'string') return null;
  const m = /^Team:(.*)$/m.exec(prompt);
  if (!m) return null;
  const words = m[1].split(',').map((w) => {
    const raw = w.trim().toLowerCase();
    return raw === 'security' ? 'security-reviewer' : raw;
  }).filter(Boolean);
  if (!words.length) return { bad: '' };
  const bad = words.find((w) => !TEAM_ROLES.includes(w));
  if (bad !== undefined) return { bad };
  return { roles: TEAM_ROLES.filter((r) => words.includes(r)) };
}
// The roles a typed `/speckit-team` names (contract section 1): the words after a leading `--team` up
// to and including the first that does not end in a comma, lower case. null without `--team`. Leading
// `--project <name>` or `--security` flags are skipped, so the flags go in any order.
function typedRoles(args) {
  let words = args.trim().split(/\s+/);
  const seen = new Set();
  while (words.length > 0) {
    if (words[0] === '--project' && !seen.has('--project')) {
      seen.add('--project');
      words = words.slice(2);
    } else if (words[0] === '--security' && !seen.has('--security')) {
      seen.add('--security');
      words = words.slice(1);
    } else if (['--load-test', '--yes', '--side-by-side', '--resume'].includes(words[0]) && !seen.has(words[0])) {
      // #431, #487: --yes, --side-by-side and --resume lead the arguments as --load-test does.
      seen.add(words[0]);
      words = words.slice(1);
    } else break;
  }
  const extra = [...(seen.has('--load-test') ? ['load-tester'] : []), ...(seen.has('--security') ? ['security-reviewer'] : [])];
  if (words[0] !== '--team') return extra.length ? [...CORE_ROLES, ...extra] : null;
  const list = [];
  for (const w of words.slice(1)) { list.push(w); if (!w.endsWith(',')) break; }
  return list.join('').split(',').flatMap((w) => {
    const raw = w.toLowerCase();
    return raw === 'security' ? ['security-reviewer'] : TEAM_PRESETS[raw] ?? [raw];
  }).filter(Boolean);
}
// #464: role-list presets of a typed --team; a name in the list, so they combine with roles (`--team build,security`).
const TEAM_PRESETS = { build: ['test-writer', 'implementer', 'spec-gatekeeper'], lite: ['product-owner', 'test-writer', 'implementer', 'spec-gatekeeper'] };
// The session's team record, { roles, noagents }, or null when missing or unreadable (the full gates
// then apply). `noagents` comes only from a typed `/speckit-team --team noagents`.
function teamOf() {
  const id = str(input.session_id);
  if (!id || !SESSION_ID.test(id)) return null;
  const r = readState(teamFile(id));
  if (!r || !Array.isArray(r.roles) || !r.roles.every((x) => TEAM_ROLES.includes(x))) return null;
  return { roles: r.roles, noagents: r.noagents === true && r.roles.length === 0, skillAgents: r.skillAgents === true,
    hybrid: r.skillAgents === true && r.hybrid === true, security: r.security === true };
}
// A subagent skips the audit check when its session's team lacks spec-auditor; the main session only
// in a request the user typed as `/speckit-team --team noagents`.
const auditSkipped = () => { const t = teamOf(); return Boolean(t) && (agentId ? !t.roles.includes('spec-auditor') : t.noagents); };

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
// A lane's start: HEAD and the files already changed then, which its check leaves out; null without a HEAD.
function startRecord() {
  const sha = git(root, 'rev-parse', 'HEAD');
  return sha ? { sha, dirty: changedSince('HEAD') } : null;
}
function changedSince(base) {
  return [...new Set([
    ...lines(git(root, 'diff', '--no-renames', '--name-only', base)),
    ...lines(git(root, 'ls-files', '--others', '--exclude-standard')),
  ])];
}

// The auditor to run next: in a skill-agents request an agent launch would end the mode (contract section 4).
// #428: in a hybrid request spec-auditor is an agent.
const auditorRef = () => (teamOf()?.skillAgents && !teamOf().hybrid
  ? 'the Skill speckit-role-spec-auditor (an agent launch ends skill-agents mode)' : '@agent-spec-auditor');

// 009: the scope rule of each role skill, equal to the `scope` hook in agents/<role>.md (a test holds the twin).
// Keys in double quotes, values in single: the twin test in test/hook.test.mjs reads this literal.
const ROLE_LANES = {
  "product-owner": ['only', 'specs/', '.specify/feature.json'],
  "architect": ['only', 'specs/', 'CLAUDE.md'],
  "spec-auditor": ['none'],
  "test-writer": ['tests'],
  "implementer": ['no-tests'],
  "load-tester": ['load'],
  "spec-gatekeeper": ['none'],
  "security-reviewer": ['none'],
};
const ROLE_SKILL = /(^|:)speckit-role-([a-z-]+)$/;
// #412, 009 D7 revised 2026-11-22: the read-only roles' lane check at close. spec-gatekeeper runs the repo's tests, whose
// output must never block its close, so a change it leaves is only warned about, as agent and as role skill alike.
const LANE_WARN_ONLY = new Set(['spec-gatekeeper']);
const READ_ONLY_ROLES = ['spec-auditor', 'spec-gatekeeper', 'security-reviewer'];

// The JSONL lines of a file from byte `offset`, or null when it cannot be read.
function linesAfter(file, offset) {
  if (typeof file !== 'string' || !file) return null;
  try {
    const buf = fs.readFileSync(file);
    return lines(buf.subarray(Number.isInteger(offset) && offset > 0 ? offset : 0).toString('utf8'));
  } catch { return null; }
}
// #366: whether the user answered since the request was typed: a prompt of theirs, or the result of an
// AskUserQuestion call. The command's expansion, the skill's text, reminders and hook feedback are not answers.
// A transcript that cannot be read proves nothing either way, so it holds nothing (hooks fail open).
const NOT_AN_ANSWER = /^(<|Base directory for this skill|Stop hook feedback|\[Request interrupted)/;
function answeredSince(rec) {
  // #397: a transcript that does not exist yet holds no answer. Claude Code writes it some time after the request, and a
  // first launch can come before that; read as unreadable, it counted as answered and the hold failed open.
  const unwritten = typeof rec?.transcript === 'string' && rec.transcript && !fs.existsSync(rec.transcript);
  const entries = Number.isInteger(rec?.offset) ? (unwritten ? [] : linesAfter(rec.transcript, rec.offset)) : null;
  if (!entries) return true;
  const asks = new Set();
  for (const l of entries) {
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    const content = e?.message?.content;
    if (e?.type === 'assistant' && Array.isArray(content)) for (const c of content) if (c?.type === 'tool_use' && c.name === 'AskUserQuestion') asks.add(c.id);
    if (e?.type !== 'user' || e.isMeta === true) continue;
    const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const c of parts) {
      if (c?.type === 'tool_result' && asks.has(c.tool_use_id)) return true;
      if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim() && !NOT_AN_ANSWER.test(c.text.trimStart())) return true;
    }
  }
  return false;
}
// #447: whether the user answered since a held request: a launch in a later turn than the request's (another prompt_id; a new
// turn starts only from a prompt) or, within it, an answer in the transcript. A record without the request's prompt_id
// takes this held launch's, so the next turn is told apart without waiting for its transcript row to be written.
function answeredLater(choice, id) {
  const now = str(input.prompt_id);
  if (typeof choice?.prompt_id === 'string' && now && now !== choice.prompt_id) return true;
  if (answeredSince(choice)) return true;
  if (now && typeof choice?.prompt_id !== 'string' && choice && typeof choice === 'object') {
    try { writeJson(choiceFile(id), { ...choice, prompt_id: now }); } catch { /* unrecorded: the transcript decides, as before */ }
  }
  return false;
}
// The role ended when the record holds a prompt_id and this call carries another: a new prompt is a new turn.
// A record or input without a string prompt_id leaves the role live.
function roleEnded(rec) {
  return typeof rec?.prompt_id === 'string' && rec.prompt_id !== '' && str(input.prompt_id) !== null && str(input.prompt_id) !== rec.prompt_id;
}
function dropRole(rec) {
  const id = str(input.session_id);
  if (id && SESSION_ID.test(id)) dropRoleFiles(id);
  return `speckit-team: the ${rec.role} role ended with its turn and no Stop ran; its lane check and report did not run. Call the Skill speckit-role-${rec.role} again to continue it.`;
}

// The files changed since a start record that fall outside a lane. Only a hex commit id reaches git's
// argument list: "--output=..." would be read as an option.
function laneOutside(base, rule, prefixes, whoName) {
  const no = (why) => ({ problem: `lane check could not run for ${whoName}: ${why}` });
  if (!base || typeof base !== 'object') return no('its start record is unreadable.');
  if (typeof base.sha !== 'string' || !/^[0-9a-f]{40,64}$/.test(base.sha) || !Array.isArray(base.dirty)) return no('its start record is incomplete.');
  if ((rule === 'tests' || rule === 'no-tests' || rule === 'load') && testPaths.bad) return no(`${testPaths.bad}.`);
  // A diff against a commit git cannot find fails, and a failed diff would read as "nothing changed".
  if (git(root, 'cat-file', '-e', `${base.sha}^{commit}`) === null) return no(`its start commit ${base.sha.slice(0, 12)} is not in this repo.`);
  // `none`, a read-only role's (#412): every changed file is outside.
  const fits = (rel) => (rule === 'only' ? inPrefixes(prefixes, rel) : rule === 'none' ? false
    : inLane(rule, rel) && !(rule === 'load' && oldDirLoad(rel, base.sha)));
  return { outside: changedSince(base.sha).filter((rel) => !base.dirty.includes(rel) && !fits(rel)) };
}

// The main session's assistant texts after a role's start offset, or null when the transcript cannot be read.
function roleTexts(file, offset) {
  const rows = linesAfter(file, offset);
  return rows === null ? null : rows.map((l) => assistantText(l, true)).filter(Boolean);
}
// Record what the closing role reported (contract section 6, step 2): the auditor's VERDICT or the gatekeeper's word.
// `last` is one more text after the transcript's: the first `args` line of the next Skill call, or the Stop's last message.
function recordReport(rec, last = null, where = 'stop') {
  if (rec.role !== 'spec-auditor' && rec.role !== 'spec-gatekeeper') return;
  // A null offset: the transcript was unreadable when the role started, so its texts cannot be told from
  // earlier turns' and only `last` counts.
  const startUnknown = rec.offset === null;
  const read = startUnknown ? null : roleTexts(rec.transcript, rec.offset);
  const texts = [...(read ?? []), ...(last ? [last] : [])];
  const unread = () => addNote(startUnknown
    ? `speckit-team: the ${rec.role} role's report was not recorded: the transcript could not be read when the ${rec.role} role started, `
      + `so its report cannot be told from earlier turns. Call the Skill speckit-role-${rec.role} again.`
    : `speckit-team: the ${rec.role} role's report was not recorded: its transcript could not be read.`);
  const feat = feature() ?? rec.feature;
  const at = new Date().toISOString();
  if (rec.role === 'spec-auditor') {
    const verdict = verdictIn(texts.join('\n'));
    if (!verdict) {
      if (read === null) return unread();
      refuseOnce(rec, where, 'word', noWordWhy(rec.role, where));
      addNote('speckit-team: no VERDICT line was found in the spec-auditor role\'s turn, so nothing was recorded. '
        + 'Call the Skill speckit-role-spec-auditor again and end its report with `VERDICT: PASS` or `VERDICT: FAIL`'
        + (where === 'skill' ? ', and start the `args` of the next Skill call with that line.' : '.'));
      return;
    }
    if (!feat) { addNote(`speckit-team: the spec-auditor role's VERDICT: ${verdict} was not recorded: no active feature.`); return; }
    if (!rec.fingerprint || rec.fingerprint !== fingerprint(feat)) {
      addNote(`speckit-team: the spec-auditor role's VERDICT: ${verdict} was not recorded: spec, plan, tasks or constitution of ${feat} `
        + 'changed after it started reading them, so it describes files that are gone. The last recorded verdict stands; '
        + 'call the Skill speckit-role-spec-auditor again on the current files.');
      return;
    }
    writeJson(verdictFile(feat), { verdict, feature: feat, fingerprint: fingerprint(feat), at, agent_id: null, role: rec.role });
    // #332: FAILs in a row, as the agent's (#242), counted once per role record; a PASS clears the count.
    if (claimed(rec, 'count')) {
      if (verdict === 'PASS') fs.rmSync(auditFile(feat), { force: true });
      else writeJson(auditFile(feat), { feature: feat, fails: (Number(auditRecord(feat).fails) || 0) + 1, approved: false, at });
    }
    addNote(`spec-auditor role recorded VERDICT: ${verdict} for ${feat}`);
    return;
  }
  // #185: the report and the hand-over can share one response, so the last word line counts, not the last line.
  const word = [...texts].reverse().map(lastGatekeeperWord).find(Boolean);
  if (!word) {
    if (read === null) return unread();
    refuseOnce(rec, where, 'word', noWordWhy(rec.role, where));
    addNote('speckit-team: the spec-gatekeeper role ended without a final APPROVED or REJECTED line, so no word was recorded.');
    return;
  }
  if (!feat) { addNote(`speckit-team: the spec-gatekeeper role's ${word} was not recorded: no active feature.`); return; }
  // #228, as for the agent: sent back once at Stop, or denied once at the next role call (#351), the role
  // staying the acting one; then recorded as REJECTED.
  const drifted = word === 'APPROVED' ? driftOf(feat) : null;
  if (drifted?.problems?.length) {
    refuseOnce(rec, where, 'drift', driftRefusal('the spec-gatekeeper role', drifted.problems));
    writeJson(endsFile(feat), { word: 'REJECTED', claimed: 'APPROVED', drift: drifted.problems, feature: feat, at, agent_id: null, role: rec.role });
    addNote(`speckit-team: the spec-gatekeeper role's APPROVED was recorded as REJECTED: ${drifted.problems.join('; ')}`);
    return;
  }
  if (drifted?.failed) addNote(driftUnchecked('the spec-gatekeeper role', drifted.failed));
  if (drifted?.unchecked?.length) addNote(specUnread('the spec-gatekeeper role', drifted.unchecked));
  writeJson(endsFile(feat), { word, feature: feat, at, agent_id: null, role: rec.role });
}

// Whether a role's Stop may still be sent back for `why` ('lane', 'drift'): once per role record, counted in
// the record. Not `stop_hook_active`: Claude Code keeps it true for the rest of a turn a Stop hook continued,
// so a role called after an earlier role's hand-on would never be sent back (the 2026-11-08 skill-agents run
// waited for the user after RESULT: STUB and RESULT: GREEN). A record that cannot be written falls back to it.
// One process of a Stop sends it back (#284, `claimed`); the others end with no output and leave the record.
// A process of that Stop can also start after the send-back was written (Linux CI, PR #295): `sentStop` holds
// the Stop it went out at, told by its last message and the transcript's size, which every process of one
// Stop is given and a later Stop is not: the block's feedback and a new response come between, so the
// transcript has grown even when the message repeats ("RED"). Without either the Stop cannot be told, and it
// counts as a later one, as before #284.
function stopKey() {
  const last = str(input.last_assistant_message);
  const t = str(input.transcript_path);
  if (last === null || t === null) return null;
  let size;
  try { size = fs.statSync(t).size; } catch { return null; }
  return createHash('sha256').update(`${size}\0${last}`).digest('hex').slice(0, 16);
}
function sendBackOnce(rec, why) {
  const sent = Array.isArray(rec.sentBack) ? rec.sentBack : [];
  const stop = stopKey();
  if (sent.includes(why)) {
    if (stop !== null && rec.sentStop?.[why] === stop) finish();
    return false;
  }
  const id = str(input.session_id);
  const claim = roleClaim(id, rec, why);
  if (!claimed(rec, why)) {
    let held = '';
    try { held = fs.readFileSync(claim, 'utf8'); } catch { /* gone or unreadable: another process holds it */ }
    if (held !== UNRECORDED) finish();
    return !input.stop_hook_active;
  }
  try { writeJson(roleFile(id), { ...rec, sentBack: [...sent, why], sentStop: { ...(rec.sentStop && typeof rec.sentStop === 'object' ? rec.sentStop : {}), [why]: stop } }); } catch {
    try { fs.writeFileSync(claim, UNRECORDED); } catch { /* the claim stays empty: later Stops say nothing */ }
    return !input.stop_hook_active;
  }
  return true;
}

// #240: the output of a RED that ran no expectation, or null. A missing module is one only when it is a
// test file (#245): a RED for a production file not written yet is valid. #374: a SyntaxError is a fault only as
// the line a runtime prints for a file that does not parse, `SyntaxError: <message>` opening a line, after a
// file:line (`test/a.test.mjs:1`), `Uncaught` or pytest's `E`; a test expecting one names it in its assertion. #395: also
// after a task ID and the file (`T001 test/a.test.mjs: SyntaxError: ...`), and as the error a code span quotes after
// "fails with", test-writer's wording for every failure in the full run of 2026-11-22.
const RED_FAULTS = [/^[ \t>*-]*(?:T\d{3,}[ \t]+)?(?:(?:Uncaught|E|[^\s:]*[/\\.]\S*)[ \t]+)?(?<f>SyntaxError): \S/m,
  /\bfail(?:s|ed)? with `(?<f>SyntaxError): [^`\s]/,
  /\bReferenceError: [\w$.]+ is not defined\b/, /\bNameError: name '[^']+' is not defined\b/];
const redFaultIn = (text) => { const m = RED_FAULTS.map((re) => text.match(re)).find(Boolean); return m ? (m.groups?.f ?? m[0]) : missingTestModule(text); };
const redFaultWhy = (fault) => `Your RED reports ${fault}: the test file did not run, so none of its expectations was checked. `
  + 'Fix that error so the test runs and fails on its expectation, then send the full report.';
// Kept once per reporter and fault in ends/red-faults.json: the Stop after a hand-back repeats the same report.
// `row` names the reporter: an agent's agent_id, or (#334) a role's start, role_at. Returns the note to say.
function keepRedFault(row, who) {
  const file = path.join(stateDir, 'ends', 'red-faults.json');
  const kept = readState(file);
  const rows = Array.isArray(kept) ? kept : [];
  if (!rows.some((r) => r?.agent_id === row.agent_id && r?.role_at === row.role_at && r?.fault === row.fault)) {
    writeJson(file, [...rows, { ...row, at: new Date().toISOString() }]);
  }
  return `speckit-team: ${who} reported RED on ${row.fault}, which is not red for the right reason. Kept in ends/red-faults.json.`;
}

// #245: a missing module that the repo's test patterns call a test file (a helper, a fixture), as
// "Cannot find module <path>, a test file", or null. Only a path the error names is judged: Node ESM's
// absolute path, a relative one resolved against Node CJS's Require stack, else a relative one with its
// leading ./ and ../ dropped (as a report paraphrases it), or a Python module. A package name, or a path
// outside the repo, is no fault: refusing a valid RED is worse than letting a broken one through.
const NODE_MISSING = /Cannot find module '?([^'\s]+?)'?(?: imported from [^\r\n]+)?[ \t]*(?:\r?\n[ \t]*Require stack:[ \t]*\r?\n[ \t]*- ([^\r\n]+))?(?=\s|$)/g;
const PY_MISSING = /No module named '([\w.]+)'/g;
// The path comes from a report the model wrote, so it is compared as text and never touched: no fs call
// on it, and a UNC or device path (\\host\share, //host, \\?\, \\.\) is refused before path.resolve, since
// on Windows opening one connects to that host and offers the user's NTLM credentials. Only the root is
// resolved, with the session's cwd: a test run prints paths as the cwd spells them (/var for /private/var
// on macOS, a short RUNNER~1 folder on Windows), so the root as the cwd spells it is matched as well.
let rootFormsMemo;
function rootForms() {
  if (rootFormsMemo) return rootFormsMemo;
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
  const forms = [root, real(root)];
  const up = path.relative(real(cwd), real(root));
  if (path.isAbsolute(cwd) && !/^[\\/]{2}/.test(cwd) && !path.isAbsolute(up) && /^(\.\.([\\/]|$))*$/.test(up)) forms.push(path.resolve(cwd, up));
  return (rootFormsMemo = [...new Set(forms)]);
}
function repoRelative(abs) {
  if (/^[\\/]{2}/.test(abs)) return null;
  const p = path.resolve(abs);
  if (/^[\\/]{2}/.test(p)) return null;
  for (const base of rootForms()) {
    const rel = path.relative(base, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return fwdPath(rel).replace(/^\.claude\/worktrees\/[^/]+\//, '');
  }
  return null;
}
function missingTestModule(text) {
  for (const [, spec, from] of String(text).matchAll(NODE_MISSING)) {
    let file = spec;
    // A file URL with a host names a share; only a local one (file:///) is read.
    if (spec.startsWith('file:')) { try { file = /^file:\/\/\//i.test(spec) ? fileURLToPath(spec) : ''; } catch { file = ''; } }
    let rel = null;
    if (path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file)) rel = repoRelative(file);
    // With a Require stack, the requiring file is the only base: one that is a share or not absolute is no fault.
    else if (/^\.\.?[\\/]/.test(file) && from) rel = path.isAbsolute(from.trim()) ? repoRelative(path.join(path.dirname(from.trim()), file)) : null;
    else if (/^\.\.?[\\/]/.test(file)) rel = path.posix.normalize(fwdPath(file)).replace(/^(\.\.?\/)+/, '');
    if (rel && isTest(rel)) return `Cannot find module ${rel}, a test file`;
  }
  for (const [, mod] of String(text).matchAll(PY_MISSING)) {
    const rel = `${mod.replaceAll('.', '/')}.py`;
    if (isTest(rel)) return `No module named '${mod}', a test file`;
  }
  return null;
}

// Close the acting role (contract section 6) at a Skill call ('skill': denies on a lane violation, else
// returns), at a gate's Agent launch in a hybrid request ('agent', #428: as 'skill', with no `args` to read) or at
// Stop ('stop': blocks on one, else removes the record and ends the hook).
// `gate`, given at a Skill call, runs once the record is known live and before its lane is judged: a spec,
// plan or tasks edit made inside the role is then named by the audit gate (tests/hook.test.mjs, T007).
function closeRole(rec, at, gate = null) {
  const id = str(input.session_id);
  const drop = () => { if (id && SESSION_ID.test(id)) dropRoleFiles(id); };
  const done = () => { if (at === 'stop') { drop(); finish(); } };
  if (!rec || typeof rec !== 'object' || !Object.hasOwn(ROLE_LANES, rec.role)) {
    addNote('speckit-team: lane check could not run for the acting role: its role record is unreadable or incomplete.');
    return done();
  }
  if (roleEnded(rec)) { addNote(dropRole(rec)); return at === 'stop' ? finish() : undefined; }
  recordReport(rec, at === 'skill' ? str(input.tool_input?.args)?.split('\n')[0] ?? null : str(input.last_assistant_message), at);
  if (gate) gate();
  const [rule, ...prefixes] = ROLE_LANES[rec.role];
  {
    const r = laneOutside(rec, rule, prefixes, rec.role);
    if ('problem' in r) { addNote(`speckit-team: ${r.problem}`); return done(); }
    if (r.outside.length) {
      const text = `Lane check: ${rec.role} changed files outside its lane: ${r.outside.join(', ')}. `
        + `Restore them (git checkout ${rec.sha.slice(0, 12)} -- <file>, or delete new files), then go on.`;
      if (!LANE_WARN_ONLY.has(rec.role)) {
        if (at !== 'stop') deny(text);
        if (sendBackOnce(rec, 'lane')) block(text);
      }
      drop();
      emit({ systemMessage: `WARNING: ${rec.role} left changes outside its lane: ${r.outside.join(', ')}` });
    }
  }
  // #316: the test-writer role's RED or FIXED, as the agent's at `ends` (#315): blocked once at Stop, denied
  // once at the next role call (the record keeps it, so the same call made again goes through), then said.
  // #334: first, as the agent's (#240), a RED on a parse or name error or a missing test module.
  // #351: a test-writer or implementer report with none of its words, as `ends` and `result` refuse the agent's
  // once. Only when the role's texts could be read: an unreadable transcript cannot tell a report without one.
  const said = rec.role === 'test-writer' || rec.role === 'implementer' ? roleReport(rec, at).word : null;
  const unsaid = said === undefined && rec.offset !== null && roleTexts(rec.transcript, rec.offset) !== null;
  if (unsaid) {
    refuseOnce(rec, at, 'word', noWordWhy(rec.role, at));
    addNote(`speckit-team: the ${rec.role} role ended without a final line that is one of: ${END_WORDS[rec.role].join(', ')}`
      + (rec.role === 'implementer' ? ', so it counts as RESULT: RED, as the agent\'s report does.' : '.'));
  }
  if (rec.role === 'test-writer') {
    const { text, word } = roleReport(rec, at);
    const feat = feature() ?? rec.feature;
    const fault = word === 'RED' ? redFaultIn(text) : null;
    if (fault) {
      refuseOnce(rec, at, 'fault', redFaultWhy(fault));
      addNote(keepRedFault({ agent_id: null, role_at: rec.at ?? null, fault }, 'the test-writer role'));
    }
    const cited = feat && (word === 'RED' || word === 'FIXED') ? driftOf(feat, false) : null;
    if (cited?.failed) addNote(citedUnchecked('the test-writer role', word, cited.failed));
    if (cited?.problems?.length) {
      refuseOnce(readState(roleFile(id)) ?? rec, at, 'cited', citedRefusal(word, cited.problems));
      addNote(citedStands('the test-writer role', word, cited.problems));
    }
  }
  // #479: the role's GREEN while a task its call's args named is unticked, as the agent's at `result` (#463).
  if (rec.role === 'implementer' && said === 'RESULT: GREEN') {
    const open = untickedOf(feature() ?? rec.feature, rec.launch);
    if (open.length) refuseOnce(rec, at, 'ticks', untickedWhy(open, "your Skill call's args name"));
  }
  if (rec.role === 'implementer') countResult(rec, unsaid ? 'RESULT: RED' : said);
  // #465: the architect role, as the agent at its Stop.
  if (rec.role === 'architect') {
    const gaps = plannedOf(feature() ?? rec.feature);
    if (gaps.length) refuseOnce(rec, at, 'plan', planRefusal(gaps));
    // #482: the report is the Stop's last message, or the role's last text before the call that closes it.
    const texts = rec.offset === null ? null : roleTexts(rec.transcript, rec.offset);
    const report = (at === 'stop' ? str(input.last_assistant_message) : null) ?? texts?.at(-1) ?? null;
    const missed = roundGaps(feature() ?? rec.feature, report);
    if (missed.length) refuseOnce(rec, at, 'rounds', roundRefusal(missed));
    const dWhy = dryRunDecisions(feature() ?? rec.feature);
    if (dWhy) refuseOnce(rec, at, 'decisions', dWhy);
  }
  if (rec.role === 'product-owner') {
    const qWhy = dryRunClarifications(feature() ?? rec.feature);
    if (qWhy) refuseOnce(rec, at, 'clarifications', qWhy);
  }
  // No count is needed here: the record goes with the hand-on, so a Stop with no new role call finds none.
  if (at === 'stop') {
    const word = handOnWord(rec);
    if (word) {
      // #284: one process of this Stop says it. Its claim stays until the session's next role record, so a
      // process of this Stop that comes late still finds it.
      if (!claimed(rec, 'hand-on')) return finish();
      fs.rmSync(roleFile(id), { force: true });
      // Only where to go: the report is already written. #261's run showed text asking for the next call
      // in the report's own response cost the reports themselves (no audit report, no gatekeeper word).
      block(`speckit-team: the ${rec.role} role's report ends ${word}, where /speckit-team has no Stop. Go on with the next step in this turn.`);
    }
  }
  return done();
}

// Send a role's report back once for `key` ('fault', 'cited'): blocked at Stop, denied at the next role call.
// At a call the record keeps the key, so the same call made again goes through. Returns when it stands.
// #351: why a role's report is sent back for its missing end word, in the words of the agent's `ends`.
function noWordWhy(role, at) {
  const words = { 'spec-auditor': ['VERDICT: PASS', 'VERDICT: FAIL'], 'spec-gatekeeper': ['APPROVED', 'REJECTED'], ...END_WORDS }[role];
  return `The ${role} role's report has no final line that is exactly one of: ${words.join(', ')}. `
    + (at === 'skill' ? "Start the `args` of this Skill call with the report's last line, that word, and make the call again."
      : at === 'agent' ? 'Write the report now as a message of its own whose last line is that word, then make the launch again.' : 'End the report with that line.');
}
function refuseOnce(rec, at, key, why) {
  if (at === 'stop') { if (sendBackOnce(rec, key)) block(why); return; }
  const sent = Array.isArray(rec.sentBack) ? rec.sentBack : [];
  if (sent.includes(key)) return;
  try { writeJson(roleFile(str(input.session_id)), { ...rec, sentBack: [...sent, key] }); } catch { return; }
  deny(why);
}
// The closing test-writer or implementer role's report: the last of its texts (and the closing call's) that
// ends on one of its words, and that word; { text: '', word: undefined } without one.
function roleReport(rec, at) {
  const texts = [...((rec.offset === null ? null : roleTexts(rec.transcript, rec.offset)) ?? []),
    at === 'skill' ? str(input.tool_input?.args)?.split('\n')[0] : str(input.last_assistant_message)].filter(Boolean);
  const text = [...texts].reverse().find((t) => END_WORDS[rec.role].includes(lastWord(t))) ?? '';
  return { text, word: text ? lastWord(text) : undefined };
}
// #332: the implementer role's REDs in a row, in the agent's retry record (`result`): GREEN clears it, STUB
// leaves it. Counted once per role record (#284: every role skill's Stop hook runs at one Stop).
function countResult(rec, word) {
  const feat = feature() ?? rec.feature;
  if (!feat || !word || word === 'RESULT: STUB' || !claimed(rec, 'count')) return;
  const f = retryFile(feat);
  if (word === 'RESULT: GREEN') { locked(f, () => fs.rmSync(f, { force: true })); return; }
  const red = locked(f, () => {
    const prev = readState(f);
    if (prev === null) return null;
    const list = [...(redCount(prev, feat) ? prev.red : []), `role:${rec.at ?? new Date().toISOString()}`];
    writeJsonAtomic(f, { feature: feat, fingerprint: fingerprint(feat), red: list });
    return list;
  });
  if (red === null) { addNote(`speckit-team: the implementer role reported RESULT: RED, but the retry record ${f} is unreadable; delete it to reset the count.`); return; }
  if (red.length >= MAX_RED) {
    addNote(`speckit-team: the implementer role reported RESULT: RED ${red.length} times in a row on ${feat}: the retry limit. Do not call it again; `
      + 'the architect rethinks plan.md or tasks.md (a new audit resets the count), or the user decides.');
  }
}

// #261: the report words /speckit-team goes on from without a Stop, and every word each of those roles may
// end on, so that a later word that may go to the user (BLOCKED after RED) wins. #332: steps 3 and 6 go on
// from a FAIL, a REJECTED, a FIXED and a RED too, except a FAIL or a RED at its limit, which go to the user.
const HAND_ON = { 'test-writer': ['RED', 'FIXED'], implementer: ['RESULT: STUB', 'RESULT: GREEN', 'RESULT: RED'] };
const END_WORDS = { 'test-writer': ['RED', 'BLOCKED', 'FIXED'], implementer: ['RESULT: STUB', 'RESULT: GREEN', 'RESULT: RED'] };
// The hand-on word the closing role's last message ends its report with, or null.
function handOnWord(rec) {
  const text = str(input.last_assistant_message) ?? roleTexts(rec.transcript, rec.offset)?.pop() ?? '';
  const feat = feature() ?? rec.feature;
  if (rec.role === 'spec-auditor') {
    const verdict = verdictIn(text);
    if (verdict === 'PASS') return 'VERDICT: PASS';
    return verdict === 'FAIL' && !(feat && Number(auditRecord(feat).fails) >= AUDIT_FAIL_LIMIT) ? 'VERDICT: FAIL' : null;
  }
  if (rec.role === 'spec-gatekeeper') return lastGatekeeperWord(text) === 'REJECTED' ? 'REJECTED' : null;
  if (!Object.hasOwn(HAND_ON, rec.role)) return null;
  const word = text.split('\n').map(lastWord).reverse().find((w) => END_WORDS[rec.role].includes(w));
  if (word === 'RESULT: RED' && feat && redCount(readState(retryFile(feat)), feat) >= MAX_RED) return null;
  return HAND_ON[rec.role].includes(word) ? word : null;
}

// Two ways a report arrives: as the SubagentHandback tool's message (PreToolUse, the normal case in
// interactive sessions) or as the agent's last message (SubagentStop, e.g. under claude -p).
// Only a string is a report: String(['VERDICT: PASS']) would otherwise read as a PASS.
const reportText = (viaHandback) => (viaHandback
  ? (typeof input.tool_input?.message === 'string' ? input.tool_input.message : '') : lastAssistantText());

// One JSONL row to its assistant text: '' for a malformed or non-assistant row and, with `mainOnly`, a sidechain row.
function assistantText(line, mainOnly) {
  try {
    const r = JSON.parse(line);
    if (mainOnly && r?.isSidechain) return '';
    // #403: only an assistant row is a message of the agent's; api-request-blob rows (2.1.330) repeat earlier ones.
    if (r?.type !== 'assistant') return '';
    const m = r.message;
    if (m?.role !== 'assistant') return '';
    return typeof m.content === 'string' ? m.content
      : (m.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  } catch { return ''; }
}
// The last VERDICT line of a report, or null.
function verdictIn(text) {
  const found = [...text.matchAll(/^[\s*>#]*VERDICT:?[\s*]*(PASS|FAIL)\b/gim)].pop();
  return found ? found[1].toUpperCase() : null;
}
// The word a report ends with, upper-cased.
function lastWord(text) {
  const last = text.trim().split('\n').pop() ?? '';
  return last.replace(/^[\s*>#`]+|[\s*`.]+$/g, '').toUpperCase();
}
// The last line of a text that is only APPROVED or REJECTED once markdown is stripped, or null: a word
// inside a sentence is not one.
function lastGatekeeperWord(text) {
  return text.split('\n').map(lastWord).reverse().find((w) => w === 'APPROVED' || w === 'REJECTED') ?? null;
}

// #463: the task IDs of an implementer's launch prompt still unticked in the feature's tasks.md; none for a stub pass or a
// worktree launch, which tick nothing by rule, or when the agent's transcript cannot be read.
// What the check needs of an implementer's launch prompt, never its text: its task IDs, and whether it is a stub pass or a
// worktree launch.
const launchOf = (prompt) => ({ ids: [...new Set(prompt.match(/\bT\d{3,}\b/g) ?? [])].sort(), stub: /^\s*stub\b/m.test(prompt), worktree: /\bworktree\b/.test(prompt) });
// #463, #490: the main session's test-writer and implementer launches the gate let through, oldest first, until
// SubagentStart claims one: its transcript may not be on disk yet at its Stop (CI's macOS runner, as #397 found for the main session's).
const launchesFile = (sid) => path.join(stateDir, 'launches', `${sid}.json`);
const launchFile = (key) => path.join(stateDir, 'agents', `${key}.launch.json`);
function recordLaunch(sid, prompt, role = 'implementer') {
  const f = launchesFile(sid);
  locked(f, () => {
    const prev = readState(f);
    const now = Date.now();
    const kept = (Array.isArray(prev) ? prev : []).filter((l) => now - Date.parse(l?.at) < 30 * 60_000);
    writeJsonAtomic(f, [...kept, { role, ...launchOf(prompt), at: new Date(now).toISOString() }]);
  });
}
function claimLaunch(sid, key, role = 'implementer') {
  const f = launchesFile(sid);
  let claimed = null;
  locked(f, () => {
    const prev = readState(f);
    if (!Array.isArray(prev) || !prev.length) return;
    const idx = prev.findIndex((l) => !l.role || l.role === role);
    if (idx < 0) return;
    claimed = prev[idx];
    writeJson(launchFile(key), claimed);
    writeJsonAtomic(f, [...prev.slice(0, idx), ...prev.slice(idx + 1)]);
  });
  return claimed;
}
// #463: the task IDs of an implementer's launch prompt still unticked in the feature's tasks.md; none for a stub pass or a
// worktree launch, which tick nothing by rule, or when neither the claimed launch nor the agent's transcript says.
function untickedOfPrompt(feat) {
  return untickedOf(feat, launchOfAgent());
}
// #479: the same for any launch record ({ ids, stub, worktree }), the agent's or the implementer role's.
function untickedOf(feat, launch) {
  if (!feat || !launch || !Array.isArray(launch.ids) || launch.stub || launch.worktree) return [];
  const tasks = readOr(path.join(root, feat, 'tasks.md'), '');
  return launch.ids.filter((id) => /^T\d{3,}$/.test(id) && new RegExp(`^\\s*[-*]\\s+\\[ \\]\\s.*\\b${id}\\b`, 'm').test(tasks));
}
const untickedWhy = (open, named) => `RESULT: GREEN, but tasks.md still has ${open.join(', ')} unticked, which ${named}. Tick each task you finished (- [x]); `
  + 'name any you did not finish and why. Then end with RESULT: GREEN again.';
function launchOfAgent() {
  let launch = agentKey ? readState(launchFile(agentKey)) : null;
  if (!launch || !Array.isArray(launch.ids)) {
    const first = lines(readOr(str(input.agent_transcript_path) ?? '', '')).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((r) => r?.type === 'user');
    const c = first?.message?.content;
    const prompt = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n') : '';
    launch = prompt ? launchOf(prompt) : null;
  }
  return launch;
}

function lastAssistantText() {
  const last = str(input.last_assistant_message);
  if (last) return last;
  // A number would reach readFileSync as a file descriptor, so only a string is a path.
  const entries = lines(readOr(str(input.agent_transcript_path) ?? '', '')).reverse();
  for (const l of entries) {
    const c = assistantText(l, false);
    if (c) return c;
  }
  return '';
}

// Why `actor` under `ruleArgs` may not write the file at `abs` (named `shown`), or null when it may.
// Through Bash (#209) a read-only role may still write outside the repo, as a check's log in a temp folder.
function laneProblem(actor, ruleArgs, abs, shown, viaBash) {
  // Verdicts and retry counts live in the git dir; an agent that could write there could reset its own
  // limit. Checked before the outside-the-repo exit: a linked worktree's state is in the main checkout.
  if (inGitDir(abs)) {
    return `${actor} may not write ${shown}: the git directory holds the team's guardrail state (verdicts, retry counts). `
      + 'Report what you need instead; only the user resets that state.';
  }
  if (ruleArgs[0] === 'protected' && isTeamFile(abs)) {
    return `${actor} may not write ${shown}: it belongs to the installed agent team (its hook, agents, skills or settings). `
      + 'Stop and report ESCALATE; the developer uses /speckit-team.';
  }
  if (ruleArgs[0] === 'none' && !viaBash) return `${actor} is a read-only role and writes no files. Report what should change instead.`;
  const rel = repoRel(abs);
  if (rel === null) return null;
  if (ruleArgs[0] === 'none') return `${actor} is a read-only role and writes no files: the command writes ${rel}. Report what should change instead.`;
  const [rule, ...prefixes] = ruleArgs;
  const why = rule === 'protected' ? isProtected(rel, 'HEAD') : null;
  if (why) {
    // Name the path as the caller wrote it; matching used the case the disk reports.
    const typed = path.relative(path.resolve(root), abs).split(path.sep).join('/');
    const named = typed && !typed.startsWith('..') && !path.isAbsolute(typed) ? typed : rel;
    return `${actor} may not write ${named}: it is a protected path (${why}). The fast track does not change it. `
      + 'Stop and report ESCALATE; the developer uses /speckit-team.';
  }
  if ((rule === 'tests' || rule === 'no-tests' || rule === 'load') && testPaths.bad) {
    return `${actor} may not write ${rel} until the test patterns can be read: ${testPaths.bad}. `
      + 'Report this to the user, who fixes the file; do not edit it yourself.';
  }
  if (rule === 'only' && !inPrefixes(prefixes, rel)) {
    return `${actor} may only write ${prefixes.join(', ')}; ${rel} is outside that lane. `
      + 'Tests belong to test-writer and production code to implementer: report what should change instead.';
  }
  if (rule === 'tests' && !inLane('tests', rel)) {
    if (SPECKIT_CONFIG.test(rel)) {
      return `${actor} may not write ${rel}: .specify/ holds Spec Kit's config or a project's files, not a test. Report what should change instead.`;
    }
    return `${actor} writes only test files and ticks tasks.md; ${rel} is production code and belongs to implementer. `
      + 'If it is a test file the patterns miss, add a regex line to .specify/test-paths.';
  }
  if (rule === 'load' && !inLane('load', rel)) {
    return `${actor} (load-tester) writes only load tests and specs/<feature>/load-test.md; ${rel} is outside that lane. `
      + 'Production code, functional tests, tasks.md and the spec belong to other roles: report what should change instead.';
  }
  if (rule === 'load' && oldDirLoad(rel, 'HEAD')) {
    return `${actor} (load-tester) may not change ${rel}: it was there before this run and says load only through its directory, `
      + 'so it may be a functional test (FR-004, #418). Write a new load test, or one whose own name says load (`*.load.test.*`, `*LoadTest.*`), '
      + 'and report what should change in this one instead.';
  }
  if (rule === 'no-tests' && SPECKIT_CONFIG.test(rel)) {
    return `${actor} may not write ${rel}: .specify/ holds Spec Kit's config, which picks the active feature and what counts as a test. `
      + 'Report what should change instead.';
  }
  if (rule === 'no-tests' && !inLane('no-tests', rel)) {
    return `${actor} may not change tests: ${rel} is part of the executable spec. `
      + 'If the test is wrong, stop and report it with evidence so test-writer or the human can fix it.';
  }
  return null;
}
// A Bash command scope judges after the shell reader is defined, further down (#209, #210).
let scopeBash = null;

// #230: `check`, the first step of /speckit-team and /speckit-patch, run from Bash. Is the team that would
// run this install alone? Exit 1, which the skills stop on, when the install mixes builds, when a second
// install of another build exists (a personal skill shadows a project one of the same name, #175, so a run
// can take its skill from one and its agents from the other), or when this is a project install in a
// folder Claude Code has not trusted (it skips the frontmatter hooks of agents from such a folder). A
// `note:` line, exit 0, for a second install of the same build, a trust file it cannot read, and, in a
// speckit-agents checkout, an install that is not this checkout.
const STAMP = /speckit-agents: managed by install\.mjs \(speckit-agents (\S+), build ([0-9a-f]{12})\)/;
// The build install.mjs stamps for a checkout at `dir`. Twin: buildOf() in install.mjs, held equal by
// test/install.test.mjs.
function buildOf(dir) {
  const h = createHash('sha256');
  const list = (d, keep) => { try { return fs.readdirSync(path.join(dir, d)).filter(keep).sort().map((n) => `${d}/${n}`); } catch { return []; } };
  const files = [...list('agents', (n) => n.endsWith('.md')), ...list('skills', (n) => !n.startsWith('.')).map((d) => `${d}/SKILL.md`),
    ...list('hooks', (n) => n.endsWith('.mjs')), 'install.mjs', 'package.json'];
  for (const f of files) {
    let text = '<missing>';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n'); } catch { /* counted as missing */ }
    h.update(`${f}\0${text}\0`);
  }
  return h.digest('hex').slice(0, 12);
}
// The files of an install folder that carry the marker, each with its build (null: no stamp).
function installAt(dir) {
  const ls = (d) => { try { return fs.readdirSync(path.join(dir, d)); } catch { return []; } };
  const rels = [...ls('agents').filter((n) => n.endsWith('.md')).map((n) => `agents/${n}`),
    ...ls('skills').map((n) => `skills/${n}/SKILL.md`), ...ls('hooks').filter((n) => n.endsWith('.mjs')).map((n) => `hooks/${n}`)];
  return rels.flatMap((rel) => {
    const text = readOr(path.join(dir, rel), '');
    return text.includes('speckit-agents: managed by install.mjs') ? [{ rel, build: STAMP.exec(text)?.[2] ?? null }] : [];
  });
}
const fwdPath = (p) => p.split(path.sep).join('/');
// Whether Claude Code has trusted `dir` itself: true, false, or null when its file is unreadable. A trusted
// folder above it does not count: Claude Code still skips the project agents' frontmatter hooks (#237).
function trusted(dir) {
  const conf = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
  const text = readOr(conf, undefined);
  if (text === undefined) return { ok: false, conf };
  let projects;
  try { projects = JSON.parse(text)?.projects ?? {}; } catch { return { ok: null, conf }; }
  const norm = (p) => { const f = fwdPath(p).replace(/\/+$/, ''); return process.platform === 'win32' ? f.toLowerCase() : f; };
  const accepted = new Set(Object.entries(projects).filter(([, v]) => v?.hasTrustDialogAccepted === true).map(([k]) => norm(k)));
  return { ok: accepted.has(norm(path.resolve(dir))), conf };
}
// #487: deterministic checkpoint state for an active feature, so a resumed or /clear-reset session can
// fast-forward past completed phases whose audit fingerprint still holds.
function featureCheckpoint(feat) {
  const specText = readOr(path.join(root, feat, 'spec.md'), undefined);
  if (specText === undefined) return 'spec';
  const qs = openQuestions(specText);
  if (qs.length || specText.includes('[NEEDS CLARIFICATION')) return `spec-questions${qs.length ? `: ${qs.join(', ')}` : ''}`;
  const planText = readOr(path.join(root, feat, 'plan.md'), undefined);
  const tasksText = readOr(path.join(root, feat, 'tasks.md'), undefined);
  if (planText === undefined || tasksText === undefined) return 'plan';
  const ds = openDecisions(planText);
  if (ds.length) return `plan-decisions: ${ds.join(', ')}`;
  if (auditProblem() !== null) return 'audit';
  const open = [...tasksText.matchAll(/^\s*[-*]\s+\[ \]\s+(T\d+)\b/gm)].map((m) => m[1]);
  if (open.length) return `build: ${open.join(', ')}`;
  const e = readState(endsFile(feat));
  return e?.word === 'APPROVED' ? 'approved' : 'verify';
}
// `check team`: what step 0 of /speckit-team asks of the repo, one `state:` line each, so the main session
// needs no call of its own for them. In 3 of the 5 full runs of 2026-11-08 it spent a second response there.
function repoState() {
  const out = [];
  const st = git(root, 'status', '--porcelain');
  const files = (st ?? '').split('\n').filter(Boolean).map((l) => l.replace(/^\s*\S+\s+/, ''));
  if (st === null) out.push('state: working tree could not be read: run git status');
  else if (!files.length) out.push('state: working tree clean');
  else {
    out.push(`state: working tree has ${files.length} uncommitted file${files.length === 1 ? '' : 's'}: ${files.slice(0, 8).join(', ')}`
      + `${files.length > 8 ? ` and ${files.length - 8} more` : ''}: ask before going on`);
  }
  const text = readOr(path.join(root, '.specify', 'memory', 'constitution.md'), undefined);
  if (text === undefined) out.push('state: constitution is missing: run step 0b');
  else if (/\[(PROJECT_NAME|PRINCIPLE_\d+_NAME)\]/.test(text)) out.push('state: constitution is still the template: run step 0b');
  else out.push('state: constitution holds rules');
  const branch = git(root, 'branch', '--show-current');
  out.push(branch ? `state: on branch ${branch}` : 'state: not on a branch');
  const feat = feature();
  if (feat) out.push(`state: feature ${feat} (${featureCheckpoint(feat)})`);
  return out;
}
if (mode === 'check') {
  const self = STAMP.exec(readOr(fileURLToPath(import.meta.url), ''));
  if (!self) projectRefuse('this hook is not an installed copy (it carries no build stamp). Install the team with node install.mjs and run the skill from it.');
  const [, version, build] = self;
  // #338: `check [team] --project <name>` also prints the project mode's block, so a skill's first step is one call.
  const team = args[0] === 'team';
  const rest = args.slice(team ? 1 : 0);
  if (rest.length && (rest[0] !== '--project' || rest.length !== 2)) {
    projectRefuse(`takes [team] and at most --project <name>, not ${rest.join(' ')}. Projects: ${projectNames().join(', ') || 'none'}.`);
  }
  const here = fwdPath(TEAM_DIR);
  const problems = []; const notes = [];
  const other = installAt(TEAM_DIR).filter((f) => f.build !== build);
  if (other.length) {
    problems.push(`${here} mixes builds: its hook is build ${build}, but ${other.map((f) => `${f.rel} is ${f.build ? `build ${f.build}` : 'unstamped'}`).join(', ')}. `
      + `Reinstall from one checkout: node install.mjs --claude-dir "${here}".`);
  }
  const personal = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const project = path.join(root, '.claude');
  for (const dir of [personal, project].filter((d) => canonical(d) !== canonical(TEAM_DIR))) {
    const files = installAt(dir);
    if (!files.length) continue;
    const builds = [...new Set(files.map((f) => f.build ?? 'unstamped'))];
    const two = `two installs of the team: ${here} (build ${build}) and ${fwdPath(dir)} (${builds.map((b) => (b === 'unstamped' ? b : `build ${b}`)).join(', ')})`;
    if (builds.length === 1 && builds[0] === build) notes.push(`note: ${two}, the same build; a personal skill is the one Claude Code runs.`);
    else {
      problems.push(`${two}. Claude Code takes a personal skill over a project one of the same name (#175), so a run can take its skill `
        + `from one and its agents from the other. Remove one (node install.mjs --claude-dir "${fwdPath(dir)}" --uninstall), or install the same checkout into both.`);
    }
  }
  if (canonical(project) === canonical(TEAM_DIR)) {
    const t = trusted(root);
    if (t.ok === false) {
      problems.push(`the team is installed in ${here}, and Claude Code has not trusted ${fwdPath(root)} (${fwdPath(t.conf)}; a trusted folder above it does not count): `
        + 'it skips the frontmatter hooks of agents from a folder it has not trusted, so their guardrails would not run. '
        + `Open Claude Code in ${fwdPath(root)} once and accept the trust dialog.`);
    }
    if (t.ok === null) notes.push(`note: could not tell whether Claude Code trusts ${fwdPath(root)}: ${fwdPath(t.conf)} is not JSON. Untrusted, the agents' frontmatter hooks do not run.`);
  }
  if (isOwnRepo('HEAD')) {
    const mine = buildOf(root);
    if (mine !== build) notes.push(`note: the installed team is build ${build}, not this checkout's (build ${mine}): run node install.mjs to run what is checked out.`);
  }
  if (problems.length) projectSay(problems.map((p) => `speckit-team: check: ${p}`).join('\n'), 1);
  const shown = rest.length ? renderProject(rest[1]) : null;
  if (shown?.refused) projectRefuse(shown.refused);
  projectSay([`speckit-team: check: ok, speckit-agents ${version} build ${build} in ${here}`, ...notes, ...(team ? repoState() : []),
    ...(shown ? [shown.block] : [])].join('\n'), 0);
}

// The tools a scope rule judges: the writer agents' frontmatter matcher for it before #337.
const SCOPED_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/;
// The write scope of a PreToolUse Write, Edit or Bash call: decides and exits, or for Bash sets scopeBash,
// which is judged at the end of this script. Run by `scope`, and by `gate ... scope <rule>` (#337).
function scopeCheck(sargs) {
  const ti = input.tool_input || {};
  const viaBash = input.tool_name === 'Bash';
  const given = viaBash ? ti.command : ti.file_path ?? ti.notebook_path;
  if (given === undefined || given === null || given === '') process.exit(0);
  // patcher's Bash calls are patch mode's to judge, with the fast track's own rules.
  if (viaBash && sargs[0] === 'protected') process.exit(0);
  const file = str(given);
  if (!file) noDecision(`tool_input.${viaBash ? 'command' : 'file_path'} is ${Array.isArray(given) ? 'an array' : typeof given}, not a ${viaBash ? 'command' : 'path'}`);
  // 009: `scope role` holds the main session to the acting role skill's lane (contract section 5).
  let ruleArgs = sargs;
  let actor = who;
  if (sargs[0] === 'role') {
    const id = str(input.session_id);
    if (agentId || !id || !SESSION_ID.test(id)) process.exit(0);
    const rec = readState(roleFile(id));
    if (rec === undefined) process.exit(0);
    if (!rec || typeof rec !== 'object' || !Object.hasOwn(ROLE_LANES, rec.role)) {
      deny('speckit-team: the role record for this session is unreadable or incomplete, so no role lane can be applied. '
        + 'Report this to the user, who removes the file; do not edit it yourself.');
    }
    if (roleEnded(rec)) { addNote(dropRole(rec)); finish(); }
    ruleArgs = ROLE_LANES[rec.role];
    actor = rec.role;
  }
  if (viaBash) scopeBash = { command: file, actor, ruleArgs };
  else {
    const abs = path.resolve(cwd, file);
    const why = laneProblem(actor, ruleArgs, abs, file, false);
    if (why) deny(why);
    // #486: an implementer Write/Edit to a production file marks it untested until a Bash test command runs.
    if (agentKey && ruleArgs[0] === 'no-tests') {
      const rel = repoRel(abs);
      if (rel && !TASKS_FILE.test(rel) && !isDoc(rel) && !rel.startsWith('specs/')) {
        try { writeJson(path.join(stateDir, 'agents', `${agentKey}.untested.json`), { file: rel, at: new Date().toISOString() }); } catch { /* non-blocking */ }
      }
    }
    process.exit(0);
  }
}
if (mode === 'scope') scopeCheck(args);

if (mode === 'gate') {
  // A typed /speckit-implement fires UserPromptExpansion, not UserPromptSubmit or PreToolUse(Skill).
  const typed = event === 'UserPromptExpansion';
  // A typed /speckit-team starts a request, whose team is chosen afresh (FR-009). Typed with
  // `--team noagents`, it records that no agent runs. Only the user's own typing does that: a model
  // cannot type a slash command. Never a decision (contract section 7).
  if (typed && /(^|:)speckit[-.]team$/.test(input.command_name || '')) {
    const id = str(input.session_id);
    if (!id || !SESSION_ID.test(id)) process.exit(0);
    fs.rmSync(teamFile(id), { force: true });
    fs.rmSync(projectFile(id), { force: true });
    fs.rmSync(choiceFile(id), { force: true });
    dropRoleFiles(id);
    const roles = typedRoles(str(input.command_args) ?? (str(input.prompt) ?? '').replace(/^\s*\/\S*/, ''));
    // #366: without --team the skill asks which team runs; record where the transcript stood, so a launch of a
    // smaller team can be held until the user's answer is in it. #373: with --team and a list of team roles, the
    // same record keeps them, so a launch whose Team line drops one is held the same way. A list the skill refuses
    // (a word that is no team role) records nothing: no launch follows it.
    const typedTeam = roles?.length && roles.every((r) => TEAM_ROLES.includes(r)) ? TEAM_ROLES.filter((r) => roles.includes(r)) : null;
    // #431: `--team ?` asks the team question; without --team the full team runs unasked. Both hold a smaller team.
    const ask = roles?.length === 1 && roles[0] === '?';
    if (roles === null || ask || typedTeam) {
      const t = str(input.transcript_path);
      let offset = null;
      // A session's first prompt comes before its transcript exists: everything in it is after the request.
      try { if (t) offset = fs.statSync(t).size; } catch (e) { if (e.code === 'ENOENT') offset = 0; }
      if (offset !== null) writeJson(choiceFile(id), { session_id: id, transcript: t, offset, ...(typedTeam ? { typed: typedTeam } : {}), ...(ask ? { ask: true } : {}), ...(str(input.prompt_id) ? { prompt_id: str(input.prompt_id) } : {}), at: new Date().toISOString() });
    }
    // `skill-agents noagents` and `hybrid noagents` (or `hybrid skill-agents`) are refused combinations, which the skill
    // reports; the hook records nothing.
    const afterTeam = (str(input.command_args) ?? (str(input.prompt) ?? '').replace(/^\s*\/\S*/, '')).trim().split(/\s+/);
    const nextWord = (afterTeam[afterTeam.indexOf('--team') + 2] ?? '').toLowerCase();
    const typedMode = roles?.length === 1 && (roles[0] === 'skill-agents' ? nextWord !== 'noagents'
      : roles[0] === 'hybrid' && nextWord !== 'noagents' && nextWord !== 'skill-agents') ? roles[0] : null;
    if (typedMode) {
      const hybrid = typedMode === 'hybrid';
      const missing = missingRoleSkills(hybrid ? HYBRID_WRITERS : TEAM_ROLES);
      if (missing.length) block(`speckit-team: --team ${typedMode} needs the role skills ${missing.map((r) => `speckit-role-${r}`).join(', ')}, which are not installed. Run node install.mjs and type the request again.`);
      writeJson(teamFile(id), { session_id: id, roles: TEAM_ROLES, skillAgents: true, ...(hybrid ? { hybrid: true } : {}), ...(afterTeam.includes('--security') ? { security: true } : {}), at: new Date().toISOString() });
      emit({ systemMessage: (hybrid ? HYBRID_START : SKILL_AGENTS_START)(afterTeam.includes('--load-test')) });
    }
    if (roles?.length !== 1 || roles[0] !== 'noagents') process.exit(0);
    writeJson(teamFile(id), { session_id: id, roles: [], noagents: true, at: new Date().toISOString() });
    emit({ systemMessage: 'speckit-team: no agents for this request: /speckit-implement in this session skips the audit gate until the next /speckit-team or team agent launch' });
  }
  if (typed && !/(^|:)speckit[-.]implement$/.test(input.command_name || '')) process.exit(0);
  // Reporting back is not work. Gating SubagentHandback leaves a blocked agent unable to say so.
  if (event === 'PreToolUse' && input.tool_name === 'SubagentHandback') process.exit(0);
  if (event === 'PreToolUse' && input.tool_name === 'Agent') {
    // Never a decision, but one: only the team and project records change, and only at the main session's launch
    // of a team role (or patcher, for the project). A subagent's Agent call (#102) and a launch of any
    // other agent (#103) change nothing. The exception is the third spec-auditor launch after two FAILs (#242).
    const id = str(input.session_id);
    const role = str(input.tool_input?.subagent_type)?.toLowerCase();
    if (agentId || !id || !SESSION_ID.test(id) || typeof input.tool_input?.prompt !== 'string') process.exit(0);
    if (!TEAM_ROLES.includes(role) && role !== 'patcher') process.exit(0);
    if (role === 'architect' || role === 'spec-auditor') holdQuestions(feature());
    if (role === 'architect') holdSecuritySpec(feature());
    if (role === 'spec-auditor') holdAudit(feature(), str(input.tool_use_id));
    // The project for the agents this launch starts (feature 007): set from the Project line, or removed.
    // #331: every notice is collected and said once at the end, after the record is written.
    const named = parseProject(input.tool_input.prompt);
    fs.rmSync(projectFile(id), { force: true });
    if (named) {
      const r = renderProject(named);
      if (r.refused) addNote(`speckit-team: the Project line names ${named}, which is not a project (${r.refused}); agents start without project context`);
      else writeJson(projectFile(id), { session_id: id, name: named, at: new Date().toISOString() });
    }
    if (role === 'patcher') finish();
    // #428: a gate's launch in a hybrid request keeps the request's team and closes the acting writer role, whose lane
    // and report are checked as at the next role skill call: a gate never starts on a writer's unchecked changes.
    const hy = teamOf();
    if (hy?.hybrid && !HYBRID_WRITERS.includes(role)) {
      const live = readState(roleFile(id));
      if (live !== undefined) closeRole(live, 'agent');
      dropRoleFiles(id);
      finish();
    }
    const team = parseTeam(input.tool_input.prompt);
    // #366: a team smaller than the full one, in a request typed without --team, goes only after the user's answer.
    const choice = readState(choiceFile(id));
    if (choice !== undefined && Array.isArray(choice?.typed)) {
      // #373, #489: the roles the user typed after --team (or via --security / --load-test), held until the user says otherwise.
      const launched = team && !('bad' in team) ? team.roles : CORE_ROLES;
      const dropped = choice.typed.filter((r) => (CORE_ROLES.includes(r) || r === 'load-tester' || r === 'security-reviewer') && !launched.includes(r));
      if (dropped.length && !answeredLater(choice, id)) {
        deny(`speckit-team: the user typed --team ${choice.typed.join(',')}, and this Team: line drops ${dropped.join(', ')}. `
          + 'Launch with the roles the user typed, in pipeline order; to run fewer, ask the user first and launch only after the answer.');
      }
      fs.rmSync(choiceFile(id), { force: true });
    } else if (choice !== undefined) {
      const smaller = Boolean(team) && !('bad' in team) && !CORE_ROLES.every((r) => team.roles.includes(r));
      if (smaller && !answeredLater(choice, id)) {
        deny(choice?.ask === true
          ? 'speckit-team: nobody chose this team. The request was typed with --team ?, so ask the team question (## Team of the skill) and stop; '
            + 'launch with this Team: line only after the user has answered. The full team, the recommended option, needs no answer.'
          : 'speckit-team: nobody chose this team. The request was typed without --team, so the full team runs: launch with no Team: line. '
            + 'To run fewer roles the user types /speckit-team --team <roles> <request>, or --team ? <request> to be asked.');
      }
      fs.rmSync(choiceFile(id), { force: true });
    }
    // No Team line, or one naming a non-role: the full team (FR-002).
    let roles = team && !('bad' in team) ? team.roles : CORE_ROLES;
    const was = teamOf();
    // Within a request the team never loses spec-auditor once it has it (#101); a typed /speckit-team
    // starts the next request. The rest of the line still narrows the team.
    if (was?.roles.includes('spec-auditor') && !roles.includes('spec-auditor')) {
      roles = TEAM_ROLES.filter((r) => r === 'spec-auditor' || roles.includes(r));
      addNote("speckit-team: the Team line drops spec-auditor, which this request's team has; the audit gate stays on. A new /speckit-team request chooses a new team.");
    }
    writeJson(teamFile(id), { session_id: id, roles, at: new Date().toISOString() });
    if (team && 'bad' in team) addNote(`speckit-team: the Team line names ${team.bad}, not a team role; the full team's gates apply`);
    else if (team) addNote(`speckit-team: team for this session: ${roles.join(', ')}; audit gate ${roles.includes('spec-auditor') ? 'on' : 'off, spec-auditor is not in the team'}`);
    if (was?.noagents) addNote("speckit-team: a team agent was launched in a no-agents request; the full team's gates apply from here");
    // #429: under `--models fast` a stub pass and a dictated revision go out on haiku. Only the model changes, and only
    // when the call names none.
    // #463, #490: the test-writer or implementer launch this gate lets through, for its SubagentStart to claim.
    if (role === 'implementer' || role === 'test-writer') { try { recordLaunch(id, input.tool_input.prompt, role); } catch { /* unrecorded: the transcript decides */ } }
    const quick = quickModel(role, input.tool_input);
    if (quick) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input.tool_input, model: quick } } });
    finish();
  }
  if (event === 'PreToolUse' && input.tool_name === 'Skill') {
    const ti = input.tool_input || {};
    const skillName = ti.skill_name || ti.skill || ti.name || '';
    const roleSkill = typeof skillName === 'string' ? ROLE_SKILL.exec(skillName)?.[2] : null;
    if (roleSkill && TEAM_ROLES.includes(roleSkill)) {
      // A role skill call of the main session (contract section 4).
      if (agentId) process.exit(0);
      const id = str(input.session_id);
      if (!teamOf()?.skillAgents) {
        deny(`speckit-role-${roleSkill} runs only in a request typed as /speckit-team --team skill-agents <request>`
          + `${HYBRID_WRITERS.includes(roleSkill) ? ' or /speckit-team --team hybrid <request>' : ''}.`);
      }
      if (teamOf().hybrid && !HYBRID_WRITERS.includes(roleSkill)) {
        deny(`speckit-role-${roleSkill} does not run in --team hybrid: ${roleSkill} runs as an agent there. Launch @agent-${roleSkill} in the foreground.`);
      }
      const auditGate = () => {
        const gap = ['test-writer', 'implementer', 'load-tester', 'spec-gatekeeper'].includes(roleSkill) ? auditProblem() : null;
        if (gap) deny(`Implementation gate: ${gap}. Run ${auditorRef()} and get VERDICT: PASS first.`);
      };
      const live = readState(roleFile(id));
      if (live !== undefined) closeRole(live, 'skill', auditGate);
      auditGate();
      // #341: the agent's `gate retries` limit, on the role's call. After closeRole, which counts the RED it closes.
      if (roleSkill === 'implementer' && feature()) retryLimit(feature());
      // #353: the audit's holds (open decisions, the two-FAIL limit of #242) on the role's call, as on the
      // agent's launch. After closeRole, which counts the FAIL it closes.
      if (roleSkill === 'architect' || roleSkill === 'spec-auditor') holdQuestions(feature());
      if (roleSkill === 'architect') holdSecuritySpec(feature());
      if (roleSkill === 'spec-auditor') holdAudit(feature(), str(input.tool_use_id));
      const start = startRecord();
      if (start) {
        const transcript = str(input.transcript_path);
        // #180: an unreadable transcript leaves the role's start unknown (null), never 0, which would read
        // earlier turns as the role's report.
        let offset = null;
        try { if (transcript) offset = fs.statSync(transcript).size; } catch { /* unreadable: start unknown */ }
        const feat = feature();
        // The last role's Stops are over: its claims (#284) can go with it.
        dropRoleFiles(id);
        writeJson(roleFile(id), {
          session_id: id, role: roleSkill, ...start, transcript: transcript ?? null, offset, prompt_id: str(input.prompt_id),
          feature: feat, fingerprint: roleSkill === 'spec-auditor' && feat ? fingerprint(feat) : null, at: new Date().toISOString(),
          // #479: what the unticked-task check needs of the call's args, never their text.
          launch: roleSkill === 'implementer' ? launchOf(str(input.tool_input?.args) ?? '') : null,
        });
      }
      finish();
    }
    if (!/(^|:)speckit[-.]implement$/.test(typeof skillName === 'string' ? skillName : '')) process.exit(0);
  }
  const problem = auditSkipped() ? null : auditProblem();
  if (problem) {
    const reason = `Implementation gate: ${problem}. Run ${auditorRef()} and get VERDICT: PASS first.`;
    if (typed) block(reason);
    deny(reason);
  }
  const feat = feature();
  if (args[0] === 'retries' && feat) retryLimit(feat);
  if (agentId && !fs.existsSync(baseFile(agentKey))) {
    const start = startRecord();
    if (start) writeJson(baseFile(agentKey), start);
  }
  // #337: `gate [retries] scope <rule>` is test-writer's and implementer's one PreToolUse entry, so a write
  // or Bash call costs one process and one git call instead of two. The scope rule sees write tools only.
  // #493: deny bare unfiltered full-suite test commands in a worktree implementer.
  if (event === 'PreToolUse' && input.tool_name === 'Bash' && input.agent_type === 'implementer' && agentKey && readState(launchFile(agentKey))?.worktree === true) {
    const cmd = str(input.tool_input?.command) ?? '';
    const BARE_TEST = /^\s*(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|bun\s+(?:run\s+)?test|pytest|cargo\s+test|node\s+--test)\s*$/;
    if (cmd.split(/[;&|\n]+/).some((seg) => BARE_TEST.test(seg))) {
      deny('Worktree test scope: do not run the full test suite in a worktree (sibling slices are not built here). Pass only your slice\'s test file path(s) to the test runner.');
    }
  }
  const scopeAt = args.indexOf('scope');
  if (scopeAt < 0 || event !== 'PreToolUse' || !SCOPED_TOOLS.test(str(input.tool_name) ?? '')) process.exit(0);
  scopeCheck(args.slice(scopeAt + 1));
}

// The retry limit: deny once implementer (agent or role, #341) reported RESULT: RED MAX_RED times in a row on
// the current plan and tasks, or when the count cannot be read.
function retryLimit(feat) {
  const r = readState(retryFile(feat));
  if (r === null) {
    deny(`Retry limit: the retry record for ${feat} is unreadable, so no further attempt can be allowed. `
      + `Delete ${retryFile(feat)} to reset it.`);
  }
  if (redCount(r, feat) < MAX_RED) return;
  // A team without architect has nobody to rethink the plan (#106, contract section 5).
  const team = teamOf();
  const next = team && !team.roles.includes('architect')
    ? "There is no architect in this run's team, so the user decides"
    : 'The architect rethinks plan.md or tasks.md (the new audit resets the count), or the user decides';
  deny(`Retry limit: implementer reported RESULT: RED ${MAX_RED} times in a row on ${feat} with the current plan and tasks. `
    + `Stop and report back; do not try to reset the count. ${next}, and only the user retries unchanged by deleting ${retryFile(feat)}.`);
}

// #242: after two spec-auditor FAILs in a row, the main session's next launch of it is refused until the user
// says to go on. The count is per feature and a PASS clears it. `audit --approve` is run by the skill only on
// the user's yes, and spends the approval on one launch. The hook refuses; it cannot tell the user's yes from a model's.
// `decisions --recommended`: the plan stop's record when every answer is the option the architect recommended
// (skill step 2). Under each `### D<n>` of plan.md's `## Open Decisions` it adds the Answer line, renames the
// section `## Decisions` (or moves the entries under one that exists), and applies the recommended options'
// `Spec:` lines to spec.md. All or nothing: a line it cannot place is named and no file changes. In the full
// runs of 2026-11-08 and 2026-11-10 the main session wrote these edits by hand in 3 to 4 responses.
// The IDs of the `### D<n>` entries under plan.md's `## Open Decisions`, in order; none when the section is absent.
function openDecisions(planText) {
  const lines = planText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Open Decisions\s*$/.test(l));
  if (start < 0) return [];
  const ids = [];
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i += 1) { const m = /^### (D\d+)\b/.exec(lines[i]); if (m) ids.push(m[1]); }
  return ids;
}
const SPEC_FORMS ='`Spec: <ID>: "<the line as it is>" becomes "<new wording>"` or `Spec: under <heading>: add "<line>"`';
function recordRecommended(planText, specText, planRel, specRel, day) {
  const eolOf = (t) => (t.includes('\r\n') ? '\r\n' : '\n');
  const planEol = eolOf(planText); const specEol = eolOf(specText);
  let plan = planText.split(planEol);
  const start = plan.findIndex((l) => /^## Open Decisions\s*$/.test(l));
  if (start < 0) return { problems: [`${planRel} has no ## Open Decisions section`] };
  const nextSection = (lines, from) => { const i = lines.findIndex((l, n) => n > from && /^## /.test(l)); return i < 0 ? lines.length : i; };
  const end = nextSection(plan, start);
  const heads = [];
  for (let i = start + 1; i < end; i += 1) { const m = /^### (D\d+)\b/.exec(plan[i]); if (m) heads.push({ i, id: m[1] }); }
  if (!heads.length) return { problems: [`the ## Open Decisions section of ${planRel} lists no ### D<n> decision`] };
  const problems = []; const answers = []; const edits = [];
  heads.forEach((h, n) => {
    const to = n + 1 < heads.length ? heads[n + 1].i : end;
    // An option starts `- **A`, as the architect is told to write it, or `- **Option A` (#306), or either without
    // the bullet (#310): all were seen before the rule. A bold item that goes on in words (`- **A letter`) is detail.
    const opts = [];
    for (let i = h.i + 1; i < to; i += 1) { const m = /^(?:- )?\*\*(?:Option )?([A-Z])(?![A-Za-z]| [a-z])/.exec(plan[i]); if (m) opts.push({ letter: m[1], from: i, rec: /\(recommended\)/i.test(plan[i]) }); }
    const k = opts.findIndex((o) => o.rec);
    if (k < 0) { problems.push(opts.length ? `${h.id}: no option is marked (recommended)` : `${h.id}: no option line found (one starts "- **A (recommended):" or "- **B:")`); return; }
    answers.push({ i: h.i, id: h.id, letter: opts[k].letter });
    for (let i = opts[k].from; i < (k + 1 < opts.length ? opts[k + 1].from : to); i += 1) {
      const m = /^\s*Spec:\s*(.*?)\s*$/.exec(plan[i]);
      if (!m) continue;
      const add = /^under (.+?): add "(.*)"$/.exec(m[1]);
      const at = m[1].indexOf(': "'); const rest = at < 0 ? '' : m[1].slice(at + 3); const sep = rest.indexOf('" becomes "');
      if (add) edits.push({ id: h.id, heading: add[1], line: add[2] });
      else if (sep >= 0 && rest.endsWith('"') && rest.length > sep + 11) edits.push({ id: h.id, old: rest.slice(0, sep), neu: rest.slice(sep + 11, -1) });
      else problems.push(`${h.id}: not ${SPEC_FORMS}: ${plan[i].trim()}`);
    }
  });
  let spec = specText.split(specEol).join('\n');
  const title = (l) => (/^#{1,6}\s+(.*?)\s*$/.exec(l)?.[1] ?? null)?.replace(/\s*\*\([^)]*\)\*$/, '').toLowerCase() ?? null;
  for (const e of edits) {
    if ('old' in e) {
      const times = e.old ? spec.split(e.old).length - 1 : 0;
      if (times === 1) spec = spec.split(e.old).join(e.neu);
      else problems.push(times ? `${e.id}: the quoted text is in ${specRel} ${times} times: ${e.old}` : `${e.id}: the quoted text is not in ${specRel}: ${e.old}`);
      continue;
    }
    const lines = spec.split('\n');
    // #365: a heading may be named with its markers, "under ## Assumptions", as well as without.
    const h = lines.findIndex((l) => title(l) === e.heading.trim().replace(/^#{1,6}\s+/, '').toLowerCase());
    if (h < 0) { problems.push(`${e.id}: ${specRel} has no heading "${e.heading}"`); continue; }
    let stop = lines.findIndex((l, n) => n > h && (/^#{1,6}\s/.test(l) || /^---\s*$/.test(l)));
    if (stop < 0) stop = lines.length;
    let last = stop - 1;
    while (last > h && !lines[last].trim()) last -= 1;
    lines.splice(last + 1, 0, ...(last === h ? ['', e.line] : [e.line]));
    spec = lines.join('\n');
  }
  if (problems.length) return { problems };
  for (const a of [...answers].reverse()) plan.splice(a.i + 1, 0, '', `Answer (${day}): ${a.letter}, as recommended`);
  const kept = plan.findIndex((l) => /^## Decisions\s*$/.test(l));
  if (kept < 0) plan[start] = '## Decisions';
  else {
    const trim = (ls) => { const out = [...ls]; while (out.length && !out[0].trim()) out.shift(); while (out.length && !out.at(-1).trim()) out.pop(); return out; };
    const block = trim(plan.splice(start, nextSection(plan, start) - start).slice(1));
    const d = plan.findIndex((l) => /^## Decisions\s*$/.test(l));
    let into = nextSection(plan, d);
    while (into > d + 1 && !plan[into - 1].trim()) into -= 1;
    plan.splice(into, 0, '', ...block, ...(into < plan.length ? [] : ['']));
  }
  while (plan.length > 1 && !plan.at(-1).trim() && !plan.at(-2).trim()) plan.pop();
  return { problems, plan: plan.join(planEol), spec: spec.split('\n').join(specEol), answers, applied: edits.length };
}
if (mode === 'decisions') {
  const feat = feature();
  if (!feat || args.length !== 1 || args[0] !== '--recommended') projectRefuse(feat ? 'the only argument is --recommended' : 'no feature is active');
  const planRel = `${feat}/plan.md`; const specRel = `${feat}/spec.md`;
  const planText = readOr(path.join(root, planRel), undefined); const specText = readOr(path.join(root, specRel), undefined);
  if (planText === undefined || specText === undefined) projectRefuse(`${planText === undefined ? planRel : specRel} cannot be read`);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const r = recordRecommended(planText, specText, planRel, specRel, day);
  if (r.problems.length) {
    projectSay([...r.problems, 'nothing was changed; record the answers by hand, as step 2 of the skill says'].map((p) => `speckit-team: decisions: ${p}`).join('\n'), 1);
  }
  if (r.spec !== specText) fs.writeFileSync(path.join(root, specRel), r.spec);
  fs.writeFileSync(path.join(root, planRel), r.plan);
  projectSay(`speckit-team: decisions: recorded ${r.answers.map((a) => `${a.id}: ${a.letter}`).join(', ')} as recommended in ${planRel}; `
    + `${r.applied ? `${r.applied} Spec: line${r.applied === 1 ? '' : 's'} applied to ${specRel}` : 'no Spec: line to apply'}`, 0);
}
// `clarifications --recommended` (#427): the spec stop's record when every answer is the one product-owner
// recommended. product-owner writes spec.md as if each recommendation were taken and lists the questions under
// `## Open Questions`, `### Q<n>: <question>` with option lines as in plan.md's decisions. This adds
// `- Q: <question> → A: <answer>` under `## Clarifications`, `### Session <today>` (made before the first
// `##` section when missing), and drops `## Open Questions`. All or nothing, like `decisions`.
// The IDs of the `### Q<n>` entries under spec.md's `## Open Questions`, in order; none when the section is absent.
function openQuestions(specText) {
  const lines = specText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Open Questions\s*$/.test(l));
  if (start < 0) return [];
  const ids = [];
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i += 1) { const m = /^### (Q\d+)\b/.exec(lines[i]); if (m) ids.push(m[1]); }
  return ids;
}
function recordClarifications(specText, specRel, day) {
  const eol = specText.includes('\r\n') ? '\r\n' : '\n';
  const spec = specText.split(eol);
  const start = spec.findIndex((l) => /^## Open Questions\s*$/.test(l));
  if (start < 0) return { problems: [`${specRel} has no ## Open Questions section`] };
  let end = spec.findIndex((l, n) => n > start && /^## /.test(l));
  if (end < 0) end = spec.length;
  const heads = [];
  for (let i = start + 1; i < end; i += 1) { const m = /^### (Q\d+):?\s*(.*?)\s*$/.exec(spec[i]); if (m) heads.push({ i, id: m[1], question: m[2] }); }
  if (!heads.length) return { problems: [`the ## Open Questions section of ${specRel} lists no ### Q<n> question`] };
  const problems = []; const answers = [];
  heads.forEach((h, n) => {
    const to = n + 1 < heads.length ? heads[n + 1].i : end;
    const opts = [];
    for (let i = h.i + 1; i < to; i += 1) {
      const m = /^(?:- )?\*\*(?:Option )?([A-Z])(?![A-Za-z]| [a-z])(\s*\(recommended\))?:?\s*(.*?)\*\*:?\s*(.*?)\s*$/i.exec(spec[i]);
      if (m) opts.push({ letter: m[1], rec: Boolean(m[2]), answer: (m[3] || m[4]).replace(/\.$/, '') });
    }
    const k = opts.findIndex((o) => o.rec);
    if (k < 0) problems.push(opts.length ? `${h.id}: no option is marked (recommended)` : `${h.id}: no option line found (one starts "- **A (recommended):" or "- **B:")`);
    else if (!h.question || !opts[k].answer) problems.push(`${h.id}: the question or its recommended answer is empty`);
    else answers.push({ id: h.id, letter: opts[k].letter, line: `- Q: ${h.question} → A: ${opts[k].answer}` });
  });
  const rest = [...spec.slice(0, start), ...spec.slice(end)];
  if (rest.some((l) => l.includes('[NEEDS CLARIFICATION'))) problems.push(`${specRel} still has a [NEEDS CLARIFICATION] marker, which no recommended answer settles`);
  if (problems.length) return { problems };
  while (rest.length && !rest.at(-1).trim()) rest.pop();
  const out = [...rest, ''];
  const section = (from) => { const i = out.findIndex((l, n) => n > from && /^## /.test(l)); return i < 0 ? out.length : i; };
  let c = out.findIndex((l) => /^## Clarifications\s*$/.test(l));
  if (c < 0) {
    let at = out.findIndex((l) => /^## /.test(l));
    if (at < 0) at = out.length - 1;
    out.splice(at, 0, '## Clarifications', '', '');
    c = at;
  }
  const cEnd = section(c);
  const sess = out.findIndex((l, n) => n > c && n < cEnd && l.trim() === `### Session ${day}`);
  const lines = answers.map((a) => a.line);
  if (sess >= 0) {
    let to = out.findIndex((l, n) => n > sess && /^#{2,3} /.test(l));
    if (to < 0) to = out.length;
    let last = to - 1;
    while (last > sess && !out[last].trim()) last -= 1;
    out.splice(last + 1, 0, ...(last === sess ? ['', ...lines] : lines));
  } else {
    let last = cEnd - 1;
    while (last > c && !out[last].trim()) last -= 1;
    out.splice(last + 1, 0, '', `### Session ${day}`, '', ...lines);
  }
  // One blank line before the section that follows.
  const after = section(c);
  let blank = after - 1;
  while (blank > c && !out[blank].trim()) blank -= 1;
  out.splice(blank + 1, after - blank - 1, ...(after < out.length ? [''] : []));
  while (out.length > 1 && !out.at(-1).trim() && !out.at(-2).trim()) out.pop();
  if (out.at(-1).trim()) out.push('');
  return { problems, spec: out.join(eol), answers };
}
if (mode === 'clarifications') {
  const feat = feature();
  if (!feat || args.length !== 1 || args[0] !== '--recommended') projectRefuse(feat ? 'the only argument is --recommended' : 'no feature is active');
  const specRel = `${feat}/spec.md`;
  const specText = readOr(path.join(root, specRel), undefined);
  if (specText === undefined) projectRefuse(`${specRel} cannot be read`);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const r = recordClarifications(specText, specRel, day);
  if (r.problems.length) {
    projectSay([...r.problems, 'nothing was changed; relaunch product-owner with the answers, as step 1 of the skill says'].map((p) => `speckit-team: clarifications: ${p}`).join('\n'), 1);
  }
  fs.writeFileSync(path.join(root, specRel), r.spec);
  projectSay(`speckit-team: clarifications: recorded ${r.answers.map((a) => `${a.id}: ${a.letter}`).join(', ')} as recommended in ${specRel}`, 0);
}
// Called at a main-session launch of architect or spec-auditor: a plan or an audit of a spec whose questions
// nobody answered would be redone once they are.
function holdQuestions(feat) {
  if (!feat) return;
  const open = openQuestions(readOr(path.join(root, feat, 'spec.md'), ''));
  if (open.length) {
    deny(`speckit-team: ${feat}/spec.md still has open questions (${open.join(', ')}), so this launch would read a spec nobody settled. `
      + `Settle them at the spec stop first: node "${process.argv[1]}" clarifications --recommended when every answer is the recommended one, `
      + 'otherwise a product-owner revision with the answers. Then launch again.');
  }
}
// #491: zero-write dry-run checks for ## Open Questions and ## Open Decisions at product-owner and architect Stop.
function dryRunClarifications(feat) {
  if (!feat) return null;
  const specRel = `${feat}/spec.md`;
  const specText = readOr(path.join(root, specRel), '');
  if (!specText) return null;
  if (openQuestions(specText).length) {
    const r = recordClarifications(specText, specRel, '2026-01-01');
    if (r.problems.length) return `Open Questions check: ${r.problems.join('; ')}. Fix the formatting in ${specRel} so clarifications --recommended can record them.`;
  } else if (specText.includes('[NEEDS CLARIFICATION')) {
    return `Open Questions check: ${specRel} still has a [NEEDS CLARIFICATION] marker outside ## Open Questions. Put open questions under ## Open Questions as ### Q<n> with a (recommended) option.`;
  }
  return null;
}
function dryRunDecisions(feat) {
  if (!feat) return null;
  const planRel = `${feat}/plan.md`; const specRel = `${feat}/spec.md`;
  const planText = readOr(path.join(root, planRel), ''); const specText = readOr(path.join(root, specRel), '');
  if (!planText || !openDecisions(planText).length) return null;
  const r = recordRecommended(planText, specText, planRel, specRel, '2026-01-01');
  return r.problems.length ? `Open Decisions check: ${r.problems.join('; ')}. Fix the formatting in ${planRel} so decisions --recommended can record them.` : null;
}
// #489: when security-reviewer is in the session's team (not default skill-agents/hybrid unless --security was active), architect waits for security-reviewer (phase: spec) PASS on the current spec.md.
function holdSecuritySpec(feat) {
  if (!feat) return;
  const t = teamOf();
  if (!t || !t.roles.includes('security-reviewer') || (t.skillAgents && !t.security)) return;
  const s = readState(securityFile(feat));
  if (!s || typeof s !== 'object' || s.verdict !== 'PASS') {
    deny(`speckit-team: security-reviewer is in this session's team and has not passed ${feat}/spec.md${s?.verdict ? ` (last verdict: ${s.verdict})` : ''}. `
      + 'Run security-reviewer (phase: spec) and get VERDICT: PASS before launching architect.');
  }
}
if (mode === 'audit') {
  const feat = feature();
  if (!feat || args.length !== 1 || args[0] !== '--approve') {
    fs.writeSync(1, `speckit-team: audit: ${feat ? 'the only argument is --approve' : 'no feature is active'}\n`);
    process.exit(1);
  }
  writeJson(auditFile(feat), { ...auditRecord(feat), feature: feat, approved: true, launch: null, at: new Date().toISOString() });
  fs.writeSync(1, `speckit-team: the next spec-auditor launch for ${feat} may run, once.\n`);
  process.exit(0);
}
// Called at a main-session launch of spec-auditor (the gate mode's Agent branch): refuses the launch after
// AUDIT_FAIL_LIMIT FAILs in a row, unless an approval is waiting, which it spends. Otherwise it changes nothing.
// The approval is spent on a launch, kept by its tool_use_id: with the team installed for the user and in the
// project, Claude Code runs this once per install for one launch, and the second process must not refuse the
// launch the first one let through (the full run of 2026-11-11 ended there).
function holdAudit(feat, launch) {
  if (!feat) return;
  // The skill records the plan stop's answers in the message that launches the audit; a record that failed
  // there must not be followed by an audit of a plan nobody settled.
  const open = openDecisions(readOr(path.join(root, feat, 'plan.md'), ''));
  if (open.length) {
    deny(`speckit-team: ${feat}/plan.md still has open decisions (${open.join(', ')}), so the audit would read a plan nobody settled. `
      + `Settle them at the plan stop first: node "${process.argv[1]}" decisions --recommended when every answer is the recommended option, `
      + 'otherwise the architect revision. Then launch the audit again.');
  }
  const a = auditRecord(feat);
  if (!(Number(a.fails) >= AUDIT_FAIL_LIMIT)) return;
  if (a.approved) { writeJson(auditFile(feat), { ...a, approved: false, launch: launch || null }); return; }
  if (launch && a.launch === launch) return;
  deny(`speckit-team: spec-auditor has reported VERDICT: FAIL ${a.fails} times in a row on ${feat}, so a further audit is refused until the user says to go on. `
    + `Ask the user (AskUserQuestion): audit again, or stop and fix the spec first. Only on a yes, run node "${process.argv[1]}" audit --approve, then launch the audit again. A PASS clears the count.`);
}

const auditStartFile = (key) => path.join(stateDir, 'agents', `${key}.audit-start.json`);
if (mode === 'verdict') {
  // The auditor's start (`start` at SubagentStart, #445) records the files it starts from: a verdict is about the files
  // it read, and one that finishes after they changed would stamp itself on files nobody audited (#77). An auditor
  // resumed after a fix keeps its first start, so its verdict on the changed files is not recorded (owner decision
  // 2026-11-23: the skill never resumes an agent, and the narrowed matcher saves a process on every audit tool call).
  const startFile = agentKey && auditStartFile(agentKey);
  const doneFile = agentKey && path.join(stateDir, 'agents', `${agentKey}.verdict-done`);
  if (event === 'PreToolUse' && input.tool_name !== 'SubagentHandback') process.exit(0);
  const viaHandback = event === 'PreToolUse';
  const text = reportText(viaHandback);
  const found = verdictIn(text);
  const feat = feature();
  const ask = 'End your report with a final line that is exactly `VERDICT: PASS` or `VERDICT: FAIL`.';
  // The Stop after a handback is the same report: neither recorded twice nor asked for again.
  if (markedReport(doneFile, viaHandback, [path.join(stateDir, 'agents', `${agentKey}.verdict-asked`)])) process.exit(0);
  if (!found) {
    if (viaHandback) {
      // Refuse once, so the report gets its verdict; never twice, so the agent is never gagged.
      const asked = agentKey && path.join(stateDir, 'agents', `${agentKey}.verdict-asked`);
      if (!asked || fs.existsSync(asked)) process.exit(0);
      writeJson(asked, {});
      deny(`${ask} Add it and send the report again.`);
    }
    const prev = feat && readState(verdictFile(feat));
    if (input.stop_hook_active || (prev && agentId && prev.agent_id === agentId)) process.exit(0);
    block(ask);
  }
  if (!feat) process.exit(0);
  const verdict = found;
  markReport(doneFile, viaHandback, { verdict });
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
  saveReport('spec-auditor', feat, verdict, text);
  // #242: FAILs in a row, per feature. A PASS clears the count; a FAIL spends any approval.
  if (verdict === 'PASS') fs.rmSync(auditFile(feat), { force: true });
  else writeJson(auditFile(feat), { feature: feat, fails: (Number(auditRecord(feat).fails) || 0) + 1, approved: false, at: new Date().toISOString() });
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
  const done = agentKey && path.join(stateDir, 'agents', `${agentKey}.result`);
  if (markedReport(done, viaHandback, [path.join(stateDir, 'agents', `${agentKey}.result-asked`)])) process.exit(0);
  const found = [...reportText(viaHandback).matchAll(/^[\s*>#]*RESULT:?[\s*]*(GREEN|RED|STUB)\b/gim)].pop();
  if (!found) {
    const ask = 'End your report with a final line that is exactly `RESULT: GREEN`, `RESULT: RED` or `RESULT: STUB`.';
    const asked = agentKey && path.join(stateDir, 'agents', `${agentKey}.result-asked`);
    // Refuse once, so the report gets its result; never twice, so the agent is never gagged.
    if (viaHandback && asked && !fs.existsSync(asked)) { writeJson(asked, {}); deny(`${ask} Add it and send the report again.`); }
    if (!viaHandback && !input.stop_hook_active) block(ask);
  }
  const result = found ? found[1].toUpperCase() : 'RED';
  // #463: a GREEN while tasks its own prompt names are still unticked cost a gatekeeper REJECTED and a launch to tick
  // them; sent back once per agent, naming them.
  if (result === 'GREEN') {
    // #486: a GREEN while a production file was written via Write/Edit with no Bash run after it is sent back once.
    const untestedPath = agentKey && path.join(stateDir, 'agents', `${agentKey}.untested.json`);
    const untested = untestedPath ? readState(untestedPath) : null;
    const untestedAsked = agentKey && path.join(stateDir, 'agents', `${agentKey}.untested-asked`);
    if (untested?.file && untestedAsked && !fs.existsSync(untestedAsked)) {
      const why = `RESULT: GREEN, but ${untested.file} was modified after your last Bash test run. Run the tests on the final code before reporting RESULT: GREEN.`;
      writeJson(untestedAsked, {});
      fs.rmSync(untestedPath, { force: true });
      if (viaHandback) deny(why);
      if (!input.stop_hook_active) block(why);
    }
    const open = untickedOfPrompt(feat);
    const asked = agentKey && path.join(stateDir, 'agents', `${agentKey}.ticks-asked`);
    if (open.length && asked && !fs.existsSync(asked)) {
      const why = untickedWhy(open, 'your prompt names');
      if (viaHandback) { writeJson(asked, {}); deny(why); }
      if (!input.stop_hook_active) { writeJson(asked, {}); block(why); }
    }
  }
  markReport(done, viaHandback, { result });
  saveReport('implementer', feat, result, reportText(viaHandback));
  // An implementer the audit gate stopped never got to work: its RED is not an attempt.
  const closed = auditSkipped() ? null : auditProblem();
  if (closed) emit({ systemMessage: `implementer reported ${result} while the gate was closed (${closed}); not counted.` });
  const f = retryFile(feat);
  // #376: read and written under the lock; emit exits the process, so nothing is said until the lock is freed.
  const counted = locked(f, () => {
    const prev = readState(f);
    if (prev === null) return { unreadable: true };
    if (result === 'STUB') return {};
    if (result === 'GREEN') { fs.rmSync(f, { force: true }); return {}; }
    const list = [...(redCount(prev, feat) ? prev.red : []), agentId ?? new Date().toISOString()];
    writeJsonAtomic(f, { feature: feat, fingerprint: fingerprint(feat), red: list });
    return { red: list };
  });
  if (counted.unreadable) {
    emit({ systemMessage: `speckit-team: implementer reported ${result}, but the retry record ${f} is unreadable; delete it to reset the count.` });
  }
  if (result === 'STUB') emit({ systemMessage: `implementer reported STUB for ${feat}; the retry count is unchanged.` });
  if (result === 'GREEN') emit({ systemMessage: `implementer reported GREEN for ${feat}; the retry count is reset.` });
  const { red } = counted;
  emit({ systemMessage: red.length >= MAX_RED
    ? `implementer reported RED for ${feat} (${red.length} of ${MAX_RED}): retry limit reached. Route to the architect or the user.`
    : `implementer reported RED for ${feat} (${red.length} of ${MAX_RED} before the retry limit).` });
}

// #394: the key of a Stop's report: the agent's transcript size (the main session's when there is none) and its last
// message. The agent's transcript grows between two reports, so a resumed agent's next Stop has another key; every
// hook process of one Stop has the same. null when either is missing.
function reportKey() {
  const last = str(input.last_assistant_message);
  const t = str(input.agent_transcript_path) ?? str(input.transcript_path);
  if (last === null || t === null) return null;
  let size;
  try { size = fs.statSync(t).size; } catch { return null; }
  return createHash('sha256').update(`${size}\0${last}`).digest('hex').slice(0, 16);
}
// #394: whether the report this hook is judging is the one a marker (`file`) closed. A hand-back is always a new
// report. A Stop repeats a hand-back's report once, right after it (the marker becomes the Stop's), and a Stop's
// when its key is the same or cannot be told. A new report removes the marker and the mode's ask-once markers
// (`asked`), so it is checked, sent back once and counted afresh, as #370 does at the agent's next tool call.
function markedReport(file, viaHandback, asked = []) {
  if (!file || !fs.existsSync(file)) return false;
  if (!viaHandback) {
    const m = readState(file);
    const key = reportKey();
    if (m?.via !== 'stop') {
      try { writeJson(file, { ...(m && typeof m === 'object' ? m : {}), via: 'stop', key }); } catch { /* spared again, as before #394 */ }
      return true;
    }
    if (key === null || m.key === null || m.key === key) return true;
  }
  try {
    for (const f of [file, ...asked]) fs.rmSync(f, { force: true });
  } catch (e) {
    addNote(`speckit-team: ${who}'s last report could not be closed (${e.message}); its next report may go unchecked.`);
    return true;
  }
  return false;
}
function markReport(file, viaHandback, data = {}) {
  if (file) writeJson(file, { ...data, via: viaHandback ? 'handback' : 'stop', key: viaHandback ? null : reportKey() });
}

// A report that does not end in its verdict word is unfinished, however it got sent: refuse it once,
// so the agent finishes and resends; never twice, so it is never gagged.
if (mode === 'ends') {
  const viaHandback = event === 'PreToolUse';
  const record = args[0] === '--record';
  const words = record ? args.slice(1) : args;
  if (!words.length || (viaHandback && input.tool_name !== 'SubagentHandback')) process.exit(0);
  const ok = agentKey && path.join(stateDir, 'agents', `${agentKey}.ends-ok`);
  if (markedReport(ok, viaHandback, ['ends-asked', 'red-asked', 'cited-asked'].map((m) => path.join(stateDir, 'agents', `${agentKey}.${m}`)))) process.exit(0);
  const word = lastWord(reportText(viaHandback));
  // #240: a RED whose output is a parse or name error ran no expectation. Sent back once, as a missing word is;
  // a second report still on the error goes through and is kept in red-faults.json, never gagged.
  const fault = word === 'RED' ? redFaultIn(reportText(viaHandback)) : null;
  if (fault && agentKey) {
    const asked1 = path.join(stateDir, 'agents', `${agentKey}.red-asked`);
    if (!fs.existsSync(asked1)) {
      writeJson(asked1, {});
      const why = redFaultWhy(fault);
      if (viaHandback) deny(why);
      if (!input.stop_hook_active) block(why);
    }
  }
  const faultNote = fault ? keepRedFault({ agent_id: agentId ?? null, fault }, who) : null;
  // #315: test-writer's RED or FIXED while a ticked test task cites an ID none of its test files holds. Sent
  // back once per agent, while it has the files open; after that the report goes through and the message says
  // what is missing, which spec-gatekeeper's APPROVED is refused for (#228). BLOCKED is never checked.
  let citedNote = null;
  if (!record && (word === 'RED' || word === 'FIXED') && words.includes(word)) {
    const feat = feature();
    const cited = feat ? driftOf(feat, false) : null;
    if (cited?.failed) citedNote = citedUnchecked(who, word, cited.failed);
    if (cited?.problems?.length) {
      const asked2 = agentKey && path.join(stateDir, 'agents', `${agentKey}.cited-asked`);
      if (asked2 && !fs.existsSync(asked2)) {
        writeJson(asked2, {});
        const why = citedRefusal(word, cited.problems);
        if (viaHandback) deny(why);
        if (!input.stop_hook_active) block(why);
      }
      citedNote = citedStands(who, word, cited.problems);
    }
  }
  if (words.includes(word)) {
    // Kept on disk next to the audit verdict, so a view of the pipeline (the board mod) reads the
    // gatekeeper's word from the same place whether or not it saw the agent stop. Only on --record:
    // test-writer's RED after a REJECTED would otherwise read as the gatekeeper's word.
    const feat = record && feature();
    const at = new Date().toISOString();
    // #228: APPROVED is refused, at every hand-back and once at Stop, while the drift check finds a cited
    // requirement no test holds. REJECTED always goes through, so the agent is never gagged.
    const drifted = feat && word === 'APPROVED' ? driftOf(feat) : null;
    // --record is spec-gatekeeper's, whatever agent_type says.
    const gk = str(input.agent_type) ?? 'spec-gatekeeper';
    if (drifted?.problems?.length) {
      const why = driftRefusal(gk, drifted.problems);
      if (viaHandback) deny(why);
      if (!input.stop_hook_active) block(why);
      markReport(ok, viaHandback);
      writeJson(endsFile(feat), { word: 'REJECTED', claimed: 'APPROVED', drift: drifted.problems, feature: feat, at, agent_id: agentId });
      emit({ systemMessage: `speckit-team: ${gk}'s APPROVED was recorded as REJECTED: ${drifted.problems.join('; ')}` });
    }
    markReport(ok, viaHandback);
    if (feat) writeJson(endsFile(feat), { word, feature: feat, at, agent_id: agentId });
    // #489, #492: record security-reviewer and load-tester verdicts and persist accepted report under .git/speckit-team/reports/.
    const activeFeat = feature();
    const roleForRep = str(input.agent_type) ?? (record ? 'spec-gatekeeper' : null);
    if (activeFeat && roleForRep) saveReport(roleForRep, activeFeat, word, reportText(viaHandback));
    if (activeFeat && input.agent_type === 'security-reviewer') {
      const v = verdictIn(word) ?? word;
      writeJson(securityFile(activeFeat), { verdict: v, word, feature: activeFeat, specFingerprint: specFingerprint(activeFeat), head: git(root, 'rev-parse', 'HEAD'), at, agent_id: agentId });
    } else if (activeFeat && input.agent_type === 'load-tester') {
      writeJson(loadFile(activeFeat), { word, feature: activeFeat, head: git(root, 'rev-parse', 'HEAD'), at, agent_id: agentId });
    }
    const notes = [drifted?.failed ? driftUnchecked(gk, drifted.failed) : null,
      drifted?.unchecked?.length ? specUnread(gk, drifted.unchecked) : null, faultNote, citedNote].filter(Boolean);
    if (notes.length) emit({ systemMessage: notes.join('\n') });
    if (recordActivity) recordActivity('record');
    process.exit(0);
  }
  const ask = `Your report must end with a final line that is exactly one of: ${words.join(', ')}. `
    + 'Finish the work first, then send the full report.';
  const asked = agentKey && path.join(stateDir, 'agents', `${agentKey}.ends-asked`);
  if (viaHandback && asked && !fs.existsSync(asked)) { writeJson(asked, {}); deny(ask); }
  if (!viaHandback && !input.stop_hook_active) block(ask);
  process.exit(0);
}

// product-owner, architect and the read-only agents have no gate to record their start on a first tool call, so the
// settings.json entry records it here, at SubagentStart, for the lane check at their Stop (#88, #412). Never a decision.
// The same entry starts every team agent with its session's project, if the launch named one (feature
// 007): the block goes to the agent as additionalContext. Never a decision.
// #380: per-agent markers (agents/), per-session records (team/, project/, choice/) and the fast track's start records
// (patch/) are kept only while a run may still read them. The SubagentStart entry, one process per launch, removes those
// older than PRUNE_DAYS, at most once a day (a .pruned stamp). Never verdicts/, retries/, ends/ or audit/: they hold a
// feature's standing. Nothing here may throw, since a hook that crashes fails open.
const PRUNE_DAYS = 30;
const DAY_MS = 86400000;
function pruneState(now = Date.now()) {
  if (!fs.existsSync(stateDir)) return;
  const stamp = path.join(stateDir, '.pruned');
  try { if (now - fs.statSync(stamp).mtimeMs < DAY_MS) return; } catch { /* never pruned here */ }
  const cutoff = now - PRUNE_DAYS * DAY_MS;
  for (const d of ['agents', 'team', 'project', 'choice', 'patch', 'reports']) {
    let names;
    try { names = fs.readdirSync(path.join(stateDir, d)); } catch { continue; }
    for (const n of names) {
      const f = path.join(stateDir, d, n);
      try { const s = fs.lstatSync(f); if (s.isFile() && s.mtimeMs < cutoff) fs.rmSync(f, { force: true }); } catch { /* the next file */ }
    }
  }
  try {
    const st = fs.lstatSync(activityFile);
    if (st.isFile() && (st.mtimeMs < now - 7 * DAY_MS || st.size > 10 * 1024 * 1024)) fs.rmSync(activityFile, { force: true });
  } catch { /* no activity.jsonl */ }
  try { fs.writeFileSync(stamp, new Date(now).toISOString()); } catch { /* pruned again on the next launch */ }
}

// #466: what the building and checking agents would otherwise read package.json and the workflows for: the test, lint,
// typecheck and build scripts and the CI `run:` steps, each cut to a line, the whole under 800 characters. '' when the repo
// names none. Read from files at each start, no git call.
const META_AGENTS = ['architect', 'test-writer', 'implementer', 'spec-gatekeeper', 'load-tester', 'patcher'];
function repoMeta() {
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const out = [];
  let scripts = {};
  try { const p = JSON.parse(readOr(path.join(root, 'package.json'), 'null')); if (p && typeof p.scripts === 'object' && p.scripts) scripts = p.scripts; } catch { /* unreadable: skipped */ }
  for (const name of ['test', 'lint', 'typecheck', 'build']) {
    if (typeof scripts[name] === 'string') out.push(`- ${name === 'test' ? 'npm test' : `npm run ${name}`}: ${cut(scripts[name].replace(/\s+/g, ' '), 120)}`);
  }
  if (typeof scripts.test === 'string') {
    const t = scripts.test.trim();
    const single = /^node\s+tools\/test\.mjs\b/.test(t) ? 'node tools/test.mjs <path> (or npm test -- <path>)'
      : /^node\s+--test\b/.test(t) ? 'node --test <path> (or npm test -- <path>)'
      : /\b(vitest|jest|mocha|ava)\b/.test(t) ? `npx ${RegExp.$1} <path> (or npm test -- <path>)` : null;
    if (single) out.push(`- Single test file: ${single}`);
  }
  const wf = path.join(root, '.github', 'workflows');
  let runs = [];
  try {
    for (const f of fs.readdirSync(wf).filter((n) => /\.ya?ml$/.test(n)).sort()) {
      runs.push(...[...readOr(path.join(wf, f), '').matchAll(/^\s*-?\s*run:\s*(\S.*)$/gm)].map((m) => m[1].replace(/^['"]|['"]$/g, '').trim()).filter((r) => r && r !== '|' && r !== '>'));
    }
  } catch { /* no workflows */ }
  runs = [...new Set(runs)].slice(0, 6);
  if (runs.length) out.push(`- CI runs: ${cut(runs.join('; '), 240)}`);
  if (!out.length) return '';
  const text = ['Repository commands (speckit-team, read from package.json and .github/workflows; use them instead of reading those files):', ...out].join('\n');
  return cut(text, 800);
}

// #490: slice the assigned tasks from tasks.md and (for test-writer) cited FR-### definitions from spec.md at SubagentStart.
function sliceTasks(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s+(T\d+)\b/.exec(line);
    if (m) out.push({ id: m[2], text: line });
    else if (!line.trim() || /^#/.test(line)) out.push(null);
    else if (out.at(-1)) out.at(-1).text += `\n${line}`;
  }
  return out.filter(Boolean);
}
function assignedSlice(type, launch) {
  if (!launch || !Array.isArray(launch.ids) || !launch.ids.length) return '';
  const feat = feature();
  if (!feat) return '';
  const tasksText = readOr(path.join(root, feat, 'tasks.md'), '');
  if (!tasksText) return '';
  const matched = sliceTasks(tasksText).filter((t) => launch.ids.includes(t.id));
  if (!matched.length) return '';
  const parts = [`Assigned tasks from ${feat}/tasks.md (do not re-read tasks.md for them):\n${matched.map((t) => t.text).join('\n')}`];
  if (type === 'test-writer') {
    const frIds = [...new Set(matched.flatMap((t) => t.text.match(/\bFR-\d+[a-z]?\b/g) ?? []))];
    if (frIds.length) {
      const specText = readOr(path.join(root, feat, 'spec.md'), '');
      const frLines = specText.split(/\r?\n/).filter((l) => frIds.some((id) => new RegExp(`(\\*\\*${id}:?\\*\\*|^[ \\t]*(?:[-*+]|\\d+[.)])[ \\t]+${id}[ \\t]*:)`).test(l)));
      if (frLines.length) parts.push(`Cited requirements from ${feat}/spec.md:\n${frLines.join('\n')}`);
    }
  }
  const block = parts.join('\n\n');
  return block.length > 1500 ? `${block.slice(0, 1499)}…` : block;
}
// #492: zero-copy agent-to-agent report handoff at SubagentStart.
function upstreamReport(type, launch) {
  const feat = feature();
  if (!feat) return '';
  const readRep = (role) => { const r = readState(reportFile(role)); return r && r.feature === feat && typeof r.text === 'string' ? r : null; };
  const parts = [];
  if (type === 'implementer' && !launch?.stub) {
    const tw = readRep('test-writer');
    if (tw && (tw.word === 'RED' || tw.word === 'FIXED')) parts.push(`Upstream test-writer report (${tw.word}):\n${tw.text}`);
    const gk = readRep('spec-gatekeeper');
    if (gk && gk.word === 'REJECTED') parts.push(`Upstream spec-gatekeeper report (${gk.word}):\n${gk.text}`);
    const sr = readRep('security-reviewer');
    if (sr && (sr.word === 'VERDICT: FAIL' || sr.word === 'FAIL')) parts.push(`Upstream security-reviewer report (${sr.word}):\n${sr.text}`);
  } else if (type === 'product-owner' || type === 'architect') {
    const v = readState(verdictFile(feat));
    const sa = readRep('spec-auditor');
    if (sa && sa.word === 'FAIL' && v?.verdict === 'FAIL') parts.push(`Upstream spec-auditor report (FAIL):\n${sa.text}`);
    const sr = readRep('security-reviewer');
    const sec = readState(securityFile(feat));
    if (sr && (sr.word === 'VERDICT: FAIL' || sr.word === 'FAIL') && sec?.verdict === 'FAIL') parts.push(`Upstream security-reviewer report (FAIL):\n${sr.text}`);
  }
  return parts.join('\n\n');
}

if (mode === 'start') {
  pruneState();
  const type = str(input.agent_type);
  // #463, #490: test-writer or implementer claims the oldest launch the gate recorded for this session.
  const sid = str(input.session_id);
  let claimedLaunch = null;
  if ((type === 'implementer' || type === 'test-writer') && agentId && AGENT_ID.test(agentId) && sid && SESSION_ID.test(sid)) {
    try { claimedLaunch = claimLaunch(sid, agentKey, type); } catch { /* the transcript decides */ }
  }
  // #445: spec-auditor's audit starts with the agent, so its verdict PreToolUse entry runs only on SubagentHandback.
  if (type === 'spec-auditor' && agentId && AGENT_ID.test(agentId) && !fs.existsSync(auditStartFile(agentKey))) {
    const feat = feature();
    if (feat) writeJson(auditStartFile(agentKey), { feature: feat, fingerprint: fingerprint(feat), at: new Date().toISOString() });
  }
  if ((type === 'product-owner' || type === 'architect' || READ_ONLY_ROLES.includes(type)) && agentId && AGENT_ID.test(agentId) && !fs.existsSync(baseFile(agentKey))) {
    const start = startRecord();
    if (start) writeJson(baseFile(agentKey), start);
  }
  const id = str(input.session_id);
  if (!type || !id || !SESSION_ID.test(id)) process.exit(0);
  const meta = META_AGENTS.includes(type) ? repoMeta() : '';
  const slice = (type === 'implementer' || type === 'test-writer') ? assignedSlice(type, claimedLaunch) : '';
  const handoff = upstreamReport(type, claimedLaunch);
  const give = (block) => emit({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: [block, meta, slice, handoff].filter(Boolean).join('\n\n') } });
  const rec = readState(projectFile(id));
  if (rec === undefined) { if (meta || slice || handoff) give(''); if (recordActivity) recordActivity('start'); process.exit(0); }
  if (!rec || typeof rec !== 'object') emit({ systemMessage: `speckit-team: the project record ${projectFile(id)} is unreadable; ${type} starts without project context.` });
  const r = renderProject(rec.name);
  if (r.refused) emit({ systemMessage: `speckit-team: project ${rec.name} could not be given to ${type} (${r.refused}); it starts without project context.` });
  give(r.block);
}

if (mode === 'lane' && args[0] === 'role') {
  // 009: the acting role skill's Stop (contract section 6).
  const id = str(input.session_id);
  if (agentId || !id || !SESSION_ID.test(id)) process.exit(0);
  const rec = readState(roleFile(id));
  if (rec === undefined) process.exit(0);
  closeRole(rec, 'stop');
}

// #489: zero-dependency secret/credential pattern scan for changed files at lane and patch Stop.
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];
const ENV_FILE = /(^|\/)\.env(\.(?!example$|sample$|template$)[^/]+)?$/i;
function secretsInFiles(rels) {
  const hits = [];
  for (const rel of rels) {
    if (isTest(rel) || isDoc(rel)) continue;
    if (ENV_FILE.test(rel) && fs.existsSync(path.join(root, rel))) { hits.push(`${rel} (.env file)`); continue; }
    const text = readOr(path.join(root, rel), '');
    if (SECRET_PATTERNS.some((re) => re.test(text))) hits.push(rel);
  }
  return hits;
}

if (mode === 'lane') {
  // `only <prefix>...` holds product-owner and architect to the prefixes of their scope rule.
  const [rule, ...prefixes] = args;
  const f = agentId && baseFile(agentKey);
  const base = f && readState(f);
  if (!base) {
    if (base === null) emit({ systemMessage: `speckit-team: lane check could not run for ${who}: its start record is unreadable.` });
    process.exit(0);
  }
  const found = laneOutside(base, rule, prefixes, who);
  if ('problem' in found) emit({ systemMessage: `speckit-team: ${found.problem}` });
  const { outside } = found;
  // #375: sent back once per lane record, counted in its own marker. Not stop_hook_active: Claude Code keeps it true
  // for the rest of a turn another Stop hook (ends, result) continued, so lane would only warn about a file written
  // after that. A marker that cannot be written falls back to the flag.
  const asked = path.join(stateDir, 'agents', `${agentKey}.lane-asked`);
  if (outside.length && !fs.existsSync(asked) && !(rule === 'none' && LANE_WARN_ONLY.has(input.agent_type))) {
    let first = !input.stop_hook_active;
    try { writeJson(asked, {}); first = true; } catch { /* the flag decides */ }
    if (first) {
      block(`Lane check: ${who} changed files outside its lane: ${outside.join(', ')}. `
        + `Restore them (git checkout ${base.sha.slice(0, 12)} -- <file>, or delete new files), then finish.`);
    }
  }
  // #489: block accidental secret or credential patterns in changed files at lane Stop.
  const changed = Array.isArray(base.dirty) && typeof base.sha === 'string' && /^[0-9a-f]{40,64}$/.test(base.sha)
    ? changedSince(base.sha).filter((rel) => !base.dirty.includes(rel)) : [];
  const secrets = secretsInFiles(changed);
  const secretAsked = path.join(stateDir, 'agents', `${agentKey}.secret-asked`);
  if (secrets.length && !fs.existsSync(secretAsked)) {
    let first = !input.stop_hook_active;
    try { writeJson(secretAsked, {}); first = true; } catch { /* the flag decides */ }
    if (first) {
      block(`Secret scan: ${who} added secret or credential patterns in: ${secrets.join(', ')}. `
        + 'Remove the hardcoded secret or .env file before finishing.');
    }
  }
  // #465: the architect is sent back once while a requirement of spec.md has no test task, before the audit reads it.
  const plannedFeat = input.agent_type === 'architect' ? feature() : null;
  const gaps = plannedFeat ? plannedOf(plannedFeat) : [];
  const planAsked = path.join(stateDir, 'agents', `${agentKey}.plan-asked`);
  if (gaps.length && !fs.existsSync(planAsked)) {
    let first = !input.stop_hook_active;
    try { writeJson(planAsked, {}); first = true; } catch { /* the flag decides */ }
    if (first) block(planRefusal(gaps));
  }
  // #482: the architect's report names every unticked task in its Round lines, so the main session need not read tasks.md.
  const missed = plannedFeat ? roundGaps(plannedFeat, lastAssistantText()) : [];
  const roundsAsked = path.join(stateDir, 'agents', `${agentKey}.rounds-asked`);
  if (missed.length && !fs.existsSync(roundsAsked)) {
    let first = !input.stop_hook_active;
    try { writeJson(roundsAsked, {}); first = true; } catch { /* the flag decides */ }
    if (first) block(roundRefusal(missed));
  }
  // #491: dry-run clarifications and decisions parsers at product-owner and architect Stop.
  const dryWhy = input.agent_type === 'product-owner' ? dryRunClarifications(feature())
    : input.agent_type === 'architect' ? dryRunDecisions(feature()) : null;
  const dryAsked = path.join(stateDir, 'agents', `${agentKey}.dry-asked`);
  if (dryWhy && !fs.existsSync(dryAsked)) {
    let first = !input.stop_hook_active;
    try { writeJson(dryAsked, {}); first = true; } catch { /* the flag decides */ }
    if (first) block(dryWhy);
  }
  fs.rmSync(f, { force: true });
  fs.rmSync(asked, { force: true });
  fs.rmSync(secretAsked, { force: true });
  fs.rmSync(planAsked, { force: true });
  fs.rmSync(roundsAsked, { force: true });
  fs.rmSync(dryAsked, { force: true });
  if (outside.length) emit({ systemMessage: `WARNING: ${who} left changes outside its lane: ${outside.join(', ')}` });
  process.exit(0);
}

// The fast track: patcher's change since its first tool call must stay within PATCH_LINES production
// lines in PATCH_FILES production files. Tests and docs do not count (FR-005).
const patchFile = (key) => path.join(stateDir, 'patch', `${key}.json`);
// #354: whether a handback's report had its `No test:` line, for the Stop after it, which is the same report
// but reads the agent's last message. Only that: the Stop runs the whole end check again, so a marker
// patcher's shell wrote grants no more than the line would.
const handbackFile = (key) => path.join(stateDir, 'patch', `${key}.handback.json`);
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
// The remote-tracking refs, name to commit. A push or a fetch moves one, whatever the command that did
// it looked like, so this is checked by outcome, not by reading commands (#72).
function remoteRefs() {
  return Object.fromEntries(lines(git(root, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes')).map((l) => l.split(' ')));
}
const remotesChanged = (before) => {
  const now = remoteRefs();
  return [...new Set([...Object.keys(before), ...Object.keys(now)])].filter((k) => before[k] !== now[k]).sort()
    .map((k) => (before[k] === undefined ? `${k} (new)` : now[k] === undefined ? `${k} (deleted)` : k));
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
  // eslint-disable-next-line no-control-regex -- the brace markers are control characters on purpose
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
// `withWrites` (#209, #210, for scope on Bash) also reads what the command writes: each simple command
// carries its redirection targets as `writes`, a here-document's body is text unless a shell reads it,
// a # comment is skipped, and > inside [[ ]] or (( )) compares. Off, the reading is as it always was.
function shellCommands(src, pin = null, assigned = null, depth = 0, inherit = {}, withWrites = false) {
  // Too deep to read is not read as harmless: the caller denies the command (fail closed).
  if (depth > 8) throw new Error('nested more than 8 levels deep');
  const cmds = []; const vars = { ...inherit }; let cur = []; let word = null; let braces = 0;
  let curWrites = []; let heredocs = []; let lineStart = 0;
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
  const sub = (inner) => { cmds.push(...shellCommands(inner, pin, assigned, depth + 1, vars, withWrites)); };
  // A word's text as the shell expands it, joined, for text that is run again.
  const expanded = (text) => shellCommands(text, pin, null, depth + 1, vars).flat().join(' ');
  const end = () => {
    push();
    const done = cur; cur = [];
    if (curWrites.length) { done.writes = curWrites; curWrites = []; }
    if (done[0] === 'for' && done[2] === 'in') for (const v of done.slice(3)) record(done[1], v);
    if (done.length || done.writes) cmds.push(done);
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
  // The bodies of the here-documents opened on the line that ended before src[from]; returns where the
  // next line starts. A body a shell on that line reads is commands; any other is text, whose $(...)
  // and `...` still run unless the delimiter was quoted.
  const hereBodies = (from) => {
    let j = from;
    const toShell = cmds.slice(lineStart).some((cmd) => cmd.length && SHELLS.has(program(cmd[0])));
    for (const h of heredocs) {
      const bodyStart = j; let bodyEnd = src.length;
      while (j < src.length) {
        const e = src.indexOf('\n', j);
        const line = src.slice(j, e < 0 ? undefined : e).replace(/\r$/, '');
        const next = e < 0 ? src.length : e + 1;
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) { bodyEnd = j; j = next; break; }
        j = next;
      }
      const body = src.slice(bodyStart, bodyEnd);
      if (toShell) sub(body);
      else if (!h.quoted) {
        for (let k = 0; k < body.length; k++) {
          if (body[k] === '\\') { k++; continue; }
          if (body[k] === '$' && body[k + 1] === '(' && body[k + 2] !== '(') { const [inner, after] = balanced(body, k + 1, '(', ')'); sub(inner); k = after - 1; }
          if (body[k] === '`') { const e = body.indexOf('`', k + 1); sub(body.slice(k + 1, e < 0 ? undefined : e)); k = e < 0 ? body.length : e; }
        }
      }
    }
    heredocs = [];
    return j;
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
    if (withWrites && c === '#' && word === null) { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (withWrites && c === '(' && src[i + 1] === '(' && word === null && !cur.length) { end(); i = balanced(src, i, '(', ')')[1]; continue; }
    if (withWrites && (c === '<' || c === '>') && cur[0] === '[[') { add(c); i++; continue; }
    if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
      if ((c === '<' || c === '>') && src[i + 1] === '(') { const [inner, after] = balanced(src, i + 1, '(', ')'); sub(inner); i = after; continue; }
      if (word !== null && /^\d+$/.test(word)) word = null; else push();
      let k = i; while (k < src.length && /[<>&|]/.test(src[k])) k++;
      const op = src.slice(i, k);
      if (op.endsWith('&') && /[\d-]/.test(src[k] ?? '')) { i = k + 1; continue; }
      const strip = withWrites && op === '<<' && src[k] === '-';
      if (strip) k++;
      while (k < src.length && /[ \t]/.test(src[k])) k++;
      // The target: one word, quotes kept together. A here-string may be a script for a shell.
      const from = k;
      while (k < src.length && !/[\s;&|<>()]/.test(src[k])) {
        if (src[k] === "'" || src[k] === '"') { const e = src.indexOf(src[k], k + 1); k = e < 0 ? src.length : e + 1; } else k++;
      }
      if (op === '<<<') sub(expanded(src.slice(from, k)));
      if (withWrites && op.includes('>')) curWrites.push(expanded(src.slice(from, k)));
      if (withWrites && op === '<<') {
        const raw = src.slice(from, k);
        heredocs.push({ delim: raw.replace(/['"\\]/g, ''), quoted: /['"\\]/.test(raw), strip });
      }
      i = k; continue;
    }
    // An array assignment, a=(git push): its words are its value, as "${a[@]}" gives them back.
    if (c === '(' && word !== null && /^[A-Za-z_]\w*\+?=$/.test(word) && cur.every((w) => ['export', 'declare', 'local', 'readonly', 'typeset'].includes(w) || w.startsWith('-'))) {
      const [inner, after] = balanced(src, i, '(', ')');
      record(word.replace(/\+?=$/, ''), shellCommands(inner, pin, null, depth + 1, vars).flat().join(' '));
      word = null; i = after; continue;
    }
    if (c === '\n' && withWrites) { end(); i = hereBodies(i + 1); lineStart = cmds.length; continue; }
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

// #209, #210: what a Bash command writes, before it runs. The targets of its redirections, and of the
// commands that create, change or delete the files they name (rm, mv, cp, ln, install, touch, mkdir,
// truncate, shred, tee, sed -i, perl -i, dd of=, git rm, mv, restore and checkout of paths, and the files
// git archive, format-patch, worktree add and an --output write, #352), resolved
// against the folder a cd or git -C before them moved to. `unknown` is a target only the run can tell
// (a variable, a substitution, a cd into one, xargs or find feeding a writer); `tree` a git command that
// changes the working tree or the history as a whole. Not a shell: what an interpreter writes (node -e,
// python -c, a package script) is not seen, and the lane check at Stop is still the line for the lanes.
const PREFIX_PROGRAMS = new Set(['sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'nohup', 'nice', 'time', 'timeout', 'stdbuf']);
const EVERY_ARG = new Set(['rm', 'rmdir', 'unlink', 'touch', 'mkdir', 'truncate', 'shred', 'tee']);
const TO_DEST = new Set(['cp', 'ln', 'install', 'mv']);
const VALUE_OPTIONS = { touch: ['-d', '-t', '-r'], mkdir: ['-m'], truncate: ['-s', '-r'], shred: ['-n', '-s'],
  install: ['-m', '-o', '-g', '-S'], cp: ['-S'], ln: ['-S'], mv: ['-S'] };
const GIT_TREE = new Set(['add', 'am', 'apply', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'commit-tree', 'fetch',
  'filter-branch', 'gc', 'init', 'merge', 'notes', 'prune', 'pull', 'push', 'rebase', 'replace', 'reset', 'revert', 'stash', 'submodule',
  'switch', 'symbolic-ref', 'tag', 'update-index', 'update-ref', 'worktree']);
// The forms of those that only read.
function gitReadsOnly(sub, a) {
  const pos = a.filter((w) => !w.startsWith('-'));
  if (sub === 'branch') return !a.some((w) => /^-[dDmMcCfu]$|^--(delete|move|copy|force|set-upstream-to|unset-upstream|edit-description|track)/.test(w))
    && (!pos.length || a.some((w) => /^(-l|--list|-a|--all|-r|--remotes|--contains|--no-contains|--merged|--no-merged|--points-at)$/.test(w)));
  if (sub === 'tag') return !a.some((w) => /^-[dafsmuF]$|^--(delete|annotate|force|sign|message|file)/.test(w))
    && (!pos.length || a.some((w) => /^(-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at)$/.test(w)));
  if (sub === 'stash') return ['list', 'show'].includes(a[0]);
  if (sub === 'apply') return a.some((w) => /^--(check|stat|numstat|summary)$/.test(w)) && !a.includes('--apply');
  if (sub === 'worktree') return a[0] === 'list';
  if (sub === 'submodule') return !a.length || ['status', 'summary'].includes(a[0]);
  if (sub === 'notes') return !a.length || ['list', 'show'].includes(a[0]);
  return false;
}
function positionals(a, valueOptions = []) {
  const pos = []; let options = true;
  for (let k = 0; k < a.length; k++) {
    if (options && a[k] === '--') { options = false; continue; }
    if (options && a[k].startsWith('-') && a[k] !== '-') { if (valueOptions.includes(a[k])) k++; continue; }
    pos.push(a[k]);
  }
  return pos;
}
// The words after sudo, env NAME=value, nohup and the other programs that only run the next one.
function unprefixed(words) {
  let k = 0;
  while (k < words.length && PREFIX_PROGRAMS.has(program(words[k]))) {
    const p = program(words[k++]);
    while (k < words.length && (words[k].startsWith('-') || (p === 'env' && /^[A-Za-z_]\w*=/.test(words[k])))) {
      const valued = (p === 'sudo' && /^-[ugCDhpRrTt]$/.test(words[k])) || (p === 'nice' && words[k] === '-n') || (p === 'env' && /^-[uSC]$/.test(words[k]));
      k += valued ? 2 : 1;
    }
    if (p === 'timeout' && k < words.length) k++;
  }
  return words.slice(k);
}
// sed -i and perl -i: the files they rewrite. The first operand is the script unless -e or -f gave one.
function inPlaceFiles(prog, a) {
  let inPlace = false; let script = false; const pos = []; let options = true;
  for (let k = 0; k < a.length; k++) {
    const w = a[k];
    if (options && w === '--') { options = false; continue; }
    if (options && w.startsWith('--')) {
      if (/^--in-place(=|$)/.test(w)) inPlace = true;
      if (/^--(expression|file)(=|$)/.test(w)) { script = true; if (!w.includes('=')) k++; }
      continue;
    }
    if (options && w.startsWith('-') && w.length > 1) {
      for (let c = 1; c < w.length; c++) {
        if (w[c] === 'i') { inPlace = true; break; }
        if ((prog === 'sed' ? 'ef' : 'eE').includes(w[c])) { script = true; if (c === w.length - 1) k++; break; }
        if (prog === 'sed' && w[c] === 'l') { if (c === w.length - 1) k++; break; }
        if (prog === 'perl' && 'IMmx0lCdD'.includes(w[c])) break;
      }
      continue;
    }
    pos.push(w);
  }
  return inPlace ? (script ? pos : pos.slice(1)) : [];
}
// #352: the command xargs runs, after its options; one that takes a value (-n 1, -I {}, --max-args 1) takes
// the next word with it unless the value is attached (-n1). No command means echo, which writes nothing.
const XARGS_VALUED = 'adEILnPsJRS';
// Long options by any prefix, as getopt_long reads them (`--max-a 1`); an ambiguous one fails and runs nothing.
const XARGS_LONG_VALUED = ['--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars', '--process-slot-var'];
function xargsCommand(a) {
  for (let k = 0; k < a.length; k++) {
    const w = a[k];
    if (w === '--') return a.slice(k + 1);
    if (!w.startsWith('-') || w === '-') return a.slice(k);
    if (w.startsWith('--')) { if (!w.includes('=') && XARGS_LONG_VALUED.some((n) => n.startsWith(w))) k++; continue; }
    for (let c = 1; c < w.length; c++) {
      // -e, -i and -l take an optional value, only attached: the rest of the word is theirs.
      if ('eil'.includes(w[c])) break;
      if (XARGS_VALUED.includes(w[c])) { if (c === w.length - 1) k++; break; }
    }
  }
  return [];
}
// #352: a runner under xargs or -exec is read for what it runs in turn; a shell's script, run once per
// input with the input as its arguments, is not read, so it counts as a write the run alone can tell.
const writesUnseen = (words) => {
  const w = unprefixed(words); const p = program(w[0] ?? '');
  if (p === 'xargs') return writesUnseen(xargsCommand(w.slice(1)));
  if (p === 'find') {
    const a = w.slice(1);
    return a.some((x) => /^-(delete|fprint0?|fprintf|fls)$/.test(x)) || a.some((x, k) => /^-(exec|execdir|ok|okdir)$/.test(x) && writesUnseen(a.slice(k + 1)));
  }
  if (SHELLS.has(p)) return true;
  const { words: run, script } = unrunner(w);
  if (script || (run.length && toolWrites(program(run[0]), run.slice(1)))) return true;
  return EVERY_ARG.has(p) || TO_DEST.has(p) || p === 'git' || (p === 'dd' && w.some((x) => x.startsWith('of=')))
    || ((p === 'sed' || p === 'perl') && w.some((x) => /^-[a-zA-Z]*i|^--in-place/.test(x)));
};
// #378: the package runners that only run a tool's binary: npx, pnpx and bunx, and the exec and dlx of npm, pnpm and
// yarn. The words of the tool they run, after their own options (-p and --package take a value). A script they run
// (`npx -c '...'`, `--call`) is not read, so it comes back as `script`: a write only the run can tell.
function unrunner(words) {
  let w = words; const p = program(w[0] ?? '');
  if (['npm', 'pnpm', 'yarn'].includes(p) && ['exec', 'dlx', 'x'].includes(w[1])) w = w.slice(2);
  else if (['npx', 'pnpx', 'bunx'].includes(p)) w = w.slice(1);
  else return { words };
  // Only options known to change nothing about what runs are skipped; any other (`--call` by any prefix, pnpm's
  // `--shell-mode`, one not known here) may hand the runner a script, so it fails closed.
  let k = 0;
  while (k < w.length && w[k].startsWith('-')) {
    if (w[k] === '--') { k++; break; }
    if (/^(-p|--package)$/.test(w[k])) { k += 2; continue; }
    if (/^(-y|--yes|--no|--no-install|-q|--quiet|-s|--silent|--ignore-existing|--bun|--package=.*)$/.test(w[k])) { k++; continue; }
    return { words: [], script: true };
  }
  return { words: w.slice(k) };
}
// A long option as getopt_long takes it: the whole name or any prefix of it of at least `min` characters, with its
// value attached or as the next word. An ambiguous prefix fails in the tool and writes nothing, so reading it as
// every option it could be only errs toward a deny.
const longIs = (w, name, min = 4) => { const m = /^(--[A-Za-z][\w-]*)(=|$)/.exec(w); return Boolean(m) && m[1].length >= min && name.startsWith(m[1]); };
// The words before `--` that are options, without the values of the options in `valued` (short ones as written,
// long ones by name, abbreviations included): a check flag that is another option's value (`--exclude -n`) is not
// one. `stop` is an option after which every word is an operand (unzip's -x).
function optionWords(a, { valued = [], stop = null } = {}) {
  const out = [];
  for (let k = 0; k < a.length; k++) {
    const w = a[k];
    if (w === '--' || (stop && w === stop)) break;
    if (!w.startsWith('-') || w === '-') continue;
    out.push(w);
    if (w.includes('=')) continue;
    if (valued.some((v) => (v.startsWith('--') ? longIs(w, v) : w === v || new RegExp(`^-[A-Za-z]*${v.slice(1)}$`).test(w)))) k++;
  }
  return out;
}
// #378: formatters and linters that write the files they are given when a flag says so (`write`), or unless a
// flag says they only check (`check`). What they write depends on their config and the files they find, so it is
// a write only the run can tell. Go and LLVM take a boolean flag with one dash or two, and `=true`.
const BOOL_ON = '(=(1|t|true))?$';
const FORMATTERS = {
  prettier: { write: /^(--write|-w)$/ }, eslint: { write: /^--fix$/ }, stylelint: { write: /^--fix(=|$)/ }, standard: { write: /^--fix$/ },
  xo: { write: /^--fix$/ }, tslint: { write: /^--fix$/ }, gofmt: { write: new RegExp(`^--?w${BOOL_ON}`, 'i') },
  goimports: { write: new RegExp(`^--?w${BOOL_ON}`, 'i') }, 'clang-format': { write: new RegExp(`^--?i${BOOL_ON}`, 'i') },
  autopep8: { write: /^(-i|--in-place)$/ }, black: { check: /^--(check|diff)$/ }, isort: { check: /^(--check-only|--check|-c|--diff)$/ },
  rustfmt: { check: /^--check$/ }, dprint: { sub: 'fmt', check: /^--(check|diff)$/ },
  ruff: { sub: 'format', check: /^--(check|diff)$/, fix: /^--(fix|fix-only)$/ }, cargo: { sub: 'fmt', check: /^--check$/ },
  terraform: { sub: 'fmt', check: /^-(check|diff)$/ }, biome: { write: /^--(write|apply|apply-unsafe|fix)$/ },
};
// #412: a package script handed a flag that makes the formatter or linter it runs rewrite files (`npm run lint -- --fix`,
// `pnpm lint --fix`). The script's tool is not on the line, so this is a write only the run can tell. `=false` turns it off.
const SCRIPT_RUNNERS = ['npm', 'pnpm', 'yarn', 'bun'];
const SCRIPT_WRITE = /^--(fix|fix-only|write|apply|apply-unsafe)(=(?!(0|f|false)$).*)?$/i;
const scriptWriteFlag = (prog, a) => (SCRIPT_RUNNERS.includes(prog) ? a.find((w) => SCRIPT_WRITE.test(w)) ?? null : null);
function formatterWrites(prog, a) {
  const f = FORMATTERS[prog];
  if (!f || a.some((w) => /^(--version|--help|-h|-V)$/.test(w))) return false;
  if (f.fix && a.some((w) => f.fix.test(w))) return true;
  if (f.sub) return a[0] === f.sub && !a.some((w) => f.check.test(w));
  if (f.write) return a.some((w) => f.write.test(w));
  return !a.some((w) => f.check.test(w));
}
// Whether a short-option group (`-avn`) holds one of `letters` before a letter of `valued`, whose value is the rest
// of the word (`-aen` is -a and -e with the value n).
function groupHas(w, letters, valued) {
  if (!/^-[^-]/.test(w)) return false;
  for (const c of w.slice(1)) { if (valued.includes(c)) return false; if (letters.includes(c)) return true; }
  return false;
}
// #378: whether tar extracts: its mode letters old style (`xzf`) or as options (`-x`, `--extract`, `--get`, by any
// prefix getopt_long takes). A word that only looks like one errs toward a deny.
const tarExtracts = (a) => (a[0] && !a[0].startsWith('-') ? /x/.test(a[0]) : false)
  || a.some((w) => /^-[A-Za-z]*x/.test(w) || longIs(w, '--extract', 5) || longIs(w, '--get', 4));
const RSYNC_VALUED = ['-e', '-f', '-B', '-T', '-M', '--exclude', '--include', '--filter', '--rsh', '--exclude-from', '--include-from',
  '--files-from', '--log-file', '--log-file-format', '--temp-dir', '--partial-dir', '--backup-dir', '--compare-dest', '--copy-dest',
  '--link-dest', '--suffix', '--chmod', '--chown', '--usermap', '--groupmap', '--password-file', '--out-format', '--max-size',
  '--min-size', '--timeout', '--contimeout', '--port', '--sockopts', '--bwlimit', '--modify-window', '--iconv', '--rsync-path',
  '--info', '--debug', '--skip-compress', '--block-size', '--max-delete', '--checksum-choice', '--compress-choice',
  '--compress-level', '--outbuf', '--stop-after', '--stop-at', '--write-batch', '--only-write-batch', '--read-batch', '--protocol',
  '--remote-option'];
const PATCH_VALUED = ['-p', '-i', '-o', '-d', '-B', '-D', '-F', '-r', '-V', '-z', '-Y', '-g', '--strip', '--input', '--output',
  '--directory', '--prefix', '--ifdef', '--fuzz', '--reject-file', '--version-control', '--suffix', '--basename-prefix', '--get',
  '--quoting-style', '--reject-format', '--read-only'];
// #396: the folder an extract or a sync writes into, read only where the line leaves no doubt: every option is one
// these lists know (no abbreviations), the folder is named once by a word of its own, and no member list or option can
// put a file elsewhere (a member named before -C, -P, --to-command, a snapshot or log file, --remove-source-files).
// `null` for anything else, which stays a write only the run can tell.
const TAR_SAFE_LETTERS = 'xzjJZvpokm';
const TAR_SAFE_LONG = ['--extract', '--get', '--gzip', '--gunzip', '--ungzip', '--bzip2', '--xz', '--zstd', '--verbose',
  '--keep-old-files', '--skip-old-files', '--no-same-owner', '--no-same-permissions', '--touch'];
function tarDest(a) {
  let dest = null; let k = 0;
  const take = (v) => { if (dest !== null || v === undefined || v.startsWith('-')) return false; dest = v; return true; };
  // The old-style bundle (`xzf a.tgz`): its f takes the next word; a C there is read by position, so it fails closed.
  if (a[0] && !a[0].startsWith('-')) {
    k = 1;
    for (const c of a[0]) {
      if (c === 'f') { if (a[k++] === undefined) return null; } else if (!TAR_SAFE_LETTERS.includes(c)) return null;
    }
  }
  for (; k < a.length; k++) {
    const w = a[k];
    if (w === '-C' || w === '--directory') { if (!take(a[++k])) return null; continue; }
    if (w.startsWith('--directory=')) { if (!take(w.slice(12))) return null; continue; }
    if (w === '--file' || w === '--strip-components') { k++; continue; }
    if (w.startsWith('--file=') || w.startsWith('--strip-components=')) continue;
    if (w.startsWith('--')) { if (TAR_SAFE_LONG.includes(w)) continue; return null; }
    if (w.startsWith('-') && w.length > 1) {
      // A group of safe letters; an f takes the rest of the word, or the next word when it is last.
      const g = w.slice(1);
      const f = g.indexOf('f');
      if (![...(f < 0 ? g : g.slice(0, f))].every((c) => TAR_SAFE_LETTERS.includes(c))) return null;
      if (f === g.length - 1) k++;
      continue;
    }
    return null;
  }
  return dest;
}
function unzipDest(a) {
  let dest = null; const operands = [];
  for (let k = 0; k < a.length; k++) {
    const w = a[k];
    if (w === '-d') { if (dest !== null || a[k + 1] === undefined || a[k + 1].startsWith('-')) return null; dest = a[++k]; continue; }
    if (w.startsWith('-')) { if (/^-[oqnja]+$/.test(w)) continue; return null; }
    operands.push(w);
  }
  return operands.length === 1 ? dest : null;
}
const RSYNC_SAFE_LETTERS = 'arvlptgoDzhcuHqi';
const RSYNC_SAFE_LONG = ['--archive', '--recursive', '--verbose', '--quiet', '--links', '--perms', '--times', '--group', '--owner',
  '--devices', '--specials', '--compress', '--human-readable', '--checksum', '--update', '--delete', '--delete-before',
  '--delete-during', '--delete-after', '--progress', '--itemize-changes', '--stats', '--hard-links', '--existing',
  '--ignore-existing', '--size-only'];
function rsyncDest(a) {
  const operands = [];
  for (let k = 0; k < a.length; k++) {
    const w = a[k];
    if (w === '--exclude' || w === '--include') { k++; continue; }
    if (w.startsWith('--exclude=') || w.startsWith('--include=')) continue;
    if (w.startsWith('--')) { if (RSYNC_SAFE_LONG.includes(w)) continue; return null; }
    if (w.startsWith('-') && w.length > 1) { if ([...w.slice(1)].every((c) => RSYNC_SAFE_LETTERS.includes(c))) continue; return null; }
    operands.push(w);
  }
  const dest = operands.at(-1);
  // A remote destination (`host:path`, `host::module`) is not a file here; a Windows drive letter is.
  if (operands.length < 2 || (/^[^/\\]*:/.test(dest) && !/^[A-Za-z]:[/\\]/.test(dest))) return null;
  return dest;
}
// #396, the security review of #402: what can still move the files of an extract or a sync whose folder was read.
// Options a variable adds (GNU tar's TAR_OPTIONS, unzip's UNZIP and UNZIPOPT, here or in the hook's own environment;
// rsync's popt aliases in ~/.popt or /etc/popt), a link already under the folder (a symlink or a junction, walked up
// to FOLDER_WALK entries, more counts as one), and another command on the line that may make one (anything but
// FOLDER_COMPANIONS: `mkdir -p x && tar -xf a.tar -C x` passes, `ln -s ... x/sub && tar ...` does not).
const FOLDER_WALK = 5000;
const FOLDER_COMPANIONS = new Set(['mkdir', 'cd', 'pushd', 'popd', 'ls', 'echo', 'printf', 'true', 'pwd', 'test', '[', 'rm', 'rmdir', 'cat',
  'wc', 'head', 'tail', 'du', 'sleep']);
function linkUnder(root) {
  let st;
  try { st = fs.lstatSync(root); } catch { return false; }
  if (st.isSymbolicLink()) return true;
  if (!st.isDirectory()) return false;
  let budget = FOLDER_WALK;
  const stack = [root];
  while (stack.length) {
    let entries;
    try { entries = fs.readdirSync(stack.pop(), { withFileTypes: true }); } catch { return true; }
    for (const e of entries) {
      if (--budget < 0 || e.isSymbolicLink()) return true;
      if (e.isDirectory()) stack.push(path.join(e.parentPath ?? e.path, e.name));
    }
  }
  return false;
}
function folderDoubt(prog, folder, abs, { command, others, assigned, wrapped }) {
  // A wrapper (env, sudo, nice, timeout, a runner) may bring variables or options of its own. The names are the ones
  // the shell assigns once it has removed quotes (`env TAR_"OPTIONS=-P"`, `export UNZ"IP"=...`); the raw line is
  // matched as well, which only errs toward a deny.
  if (wrapped) return `what ${prog} writes when another program runs it`;
  const optionVar = /^(TAR_\w+|UNZIP|UNZIPOPT)$/i;
  if ((prog === 'tar' || prog === 'unzip') && (/\b(TAR_\w+|UNZIP|UNZIPOPT)\b/.test(command) || assigned.some((k) => optionVar.test(k))
    || Object.keys(process.env).some((k) => optionVar.test(k)))) {
    return `what ${prog} writes with the options a variable adds`;
  }
  if (prog === 'rsync' && [path.join(os.homedir(), '.popt'), '/etc/popt', '/etc/popt.d'].some((f) => fs.existsSync(f))) {
    return 'what rsync writes with the aliases popt adds';
  }
  if (others.some((p) => !FOLDER_COMPANIONS.has(p))) return `what ${prog} writes into ${folder} after the rest of the line`;
  if (abs !== null && linkUnder(abs)) return `what ${prog} writes through a link under ${folder}`;
  return null;
}
// #378: what curl, wget, sort, awk -i inplace, patch, tar, unzip and rsync write: `targets` they name, and `unknown`
// when only the run can tell (a file named by its URL, an archive's contents, a patch's files, a sync's destination).
function toolWrites(prog, a) {
  const out = { targets: [], unknown: null };
  // The value of an option, attached (`-ofile`, `--output=file`) or as the next word, with short options grouped
  // and the valued one last (`-sSLo file`); a long one by any prefix when the tool takes prefixes.
  const valuesOf = (short, long, prefixes = false) => a.flatMap((w, k) => {
    const isLong = long && (prefixes ? longIs(w, long) : w === long || w.startsWith(`${long}=`));
    if (isLong) return w.includes('=') ? [w.slice(w.indexOf('=') + 1)] : a[k + 1] === undefined ? [] : [a[k + 1]];
    if (short && new RegExp(`^-[A-Za-z]*${short}$`).test(w)) return a[k + 1] === undefined ? [] : [a[k + 1]];
    if (short && w.startsWith(`-${short}`) && w.length > 2 && !w.startsWith('--')) return [w.slice(2)];
    return [];
  });
  if (prog === 'curl') {
    // Like wget, curl writes through many options (-O, -D, -c, --trace, --stderr, --output-dir, ...), -K files and
    // ~/.curlrc, so every curl is a write only the run can tell; the file -o names is judged as well.
    out.targets = valuesOf('o', '--output').filter((v) => v !== '-');
    out.unknown = 'what curl writes';
  } else if (prog === 'wget') {
    // Where wget writes is set by its options (-O, the logs, --save-cookies, --warc-file and more), by -e commands, by
    // --config, and by WGETRC or ~/.wgetrc, which a command line does not show. So every wget is a write only the run
    // can tell; the files its options name are judged as well. A read-only role fetches with curl instead.
    out.targets = [...valuesOf('O', '--output-document', true).filter((v) => v !== '-'), ...valuesOf('o', '--output-file', true),
      ...valuesOf('a', '--append-output', true)];
    out.unknown = 'what wget writes';
  } else if (prog === 'sort') out.targets = valuesOf('o', '--output', true);
  else if (prog === 'awk' || prog === 'gawk') {
    // Which operands are files depends on gawk's options; telling them apart is not worth a reader that can be wrong.
    if (a.some((w) => /inplace/.test(w))) out.unknown = 'the files awk -i inplace rewrites';
  } else if (prog === 'patch') {
    if (!optionWords(a, { valued: PATCH_VALUED }).some((w) => longIs(w, '--dry-run', 5))) out.unknown = 'the files patch changes';
  } else if (prog === 'tar') {
    if (tarExtracts(a)) {
      const dest = tarDest(a);
      if (dest === null) out.unknown = 'what tar extracts'; else { out.targets = [path.posix.join(dest, '*')]; out.folder = dest; }
    }
  } else if (prog === 'unzip') {
    // unzip turns an option off with a - inside its group (`-l-`) or a doubled dash (`--l`): such a word fails closed.
    const opts = optionWords(a, { valued: ['-d', '-P', '-O', '-I'], stop: '-x' });
    if (opts.some((w) => /^--|^-.+-/.test(w)) || !opts.some((w) => groupHas(w, 'lptvZ', 'dPOI'))) {
      const dest = unzipDest(a);
      if (dest === null) out.unknown = 'what unzip extracts'; else { out.targets = [path.posix.join(dest, '*')]; out.folder = dest; }
    }
  } else if (prog === 'rsync') {
    if (!optionWords(a, { valued: RSYNC_VALUED }).some((w) => longIs(w, '--dry-run', 5) || groupHas(w, 'n', 'efBTM'))) {
      const dest = rsyncDest(a);
      if (dest === null) out.unknown = 'what rsync copies into its destination'; else { out.targets = [path.posix.join(dest, '*')]; out.folder = dest; }
    }
  } else if (formatterWrites(prog, a)) out.unknown = `the files ${prog} rewrites`;
  else if (scriptWriteFlag(prog, a)) out.unknown = `the files the package script run with ${scriptWriteFlag(prog, a)} rewrites`;
  return out.targets.length || out.unknown ? out : null;
}
function bashWrites(command) {
  const found = { targets: [], unknown: [], tree: [] };
  let dir = cwd;
  const shown = (w) => w.replaceAll(DYN, '$(...)');
  const at = (w, base = dir) => {
    if (w.includes(DYN)) { found.unknown.push(shown(w)); return; }
    if (/^\/dev\//.test(w) || /^nul$/i.test(w)) return;
    if (base === null && !path.isAbsolute(w)) { found.unknown.push(w); return; }
    found.targets.push({ abs: path.resolve(base, w), shown: w });
  };
  const isDir = (w) => dir !== null && !w.includes(DYN) && (() => { try { return fs.statSync(path.resolve(dir, w)).isDirectory(); } catch { return false; } })();
  const exists = (w, base) => base !== null && !w.includes(DYN) && fs.existsSync(path.resolve(base, w));
  const assigned = {};
  const cmds = [...shellCommands(command, null, assigned, 0, {}, true)];
  for (const cmd of cmds) {
    for (const t of cmd.writes ?? []) at(t);
    const words = unprefixed(cmd);
    if (!words.length) continue;
    const prog = program(words[0]); const a = words.slice(1);
    const { words: run, script } = unrunner(words);
    if (script) { found.unknown.push(`the script ${prog} runs`); continue; }
    const tool = run.length ? toolWrites(program(run[0]), run.slice(1)) : null;
    if (tool) {
      tool.targets.forEach((w) => at(w));
      if (tool.unknown) found.unknown.push(tool.unknown);
      if (tool.folder !== undefined) {
        const others = cmds.filter((c) => c !== cmd).map((c) => unprefixed(c)).filter((w) => w.length).map((w) => program(w[0]));
        const abs = tool.folder.includes(DYN) || (dir === null && !path.isAbsolute(tool.folder)) ? null : path.resolve(dir, tool.folder);
        const doubt = folderDoubt(program(run[0]), tool.folder, abs,
          { command, others, assigned: Object.keys(assigned), wrapped: cmd.length !== words.length || run !== words });
        if (doubt) found.unknown.push(doubt);
      }
      continue;
    }
    if (prog === 'cd' || prog === 'pushd') {
      const d = positionals(a)[0];
      if (d === undefined) dir = os.homedir();
      else dir = d === '-' || d.includes(DYN) || (dir === null && !path.isAbsolute(d)) ? null : path.resolve(dir, d);
    } else if (prog === 'popd') dir = null;
    else if (EVERY_ARG.has(prog)) positionals(a, VALUE_OPTIONS[prog]).forEach((w) => at(w));
    else if (TO_DEST.has(prog)) {
      let into = null;
      a.forEach((w, k) => {
        if (w === '-t') into = a[k + 1] ?? null;
        else if (w.startsWith('--target-directory=')) into = w.slice(19);
        else if (/^-t./.test(w)) into = w.slice(2);
      });
      const pos = positionals(a, [...(VALUE_OPTIONS[prog] ?? []), '-t']);
      const sources = into === null ? pos.slice(0, -1) : pos;
      const dest = into ?? pos.at(-1);
      if (dest === undefined) continue;
      if (prog === 'mv') sources.forEach((w) => at(w));
      if (prog === 'ln' && !sources.length && into === null) at(path.basename(dest));
      else if (into !== null || sources.length > 1 || dest.endsWith('/') || isDir(dest)) sources.forEach((s) => at(path.join(dest, path.basename(s))));
      else at(dest);
    } else if (prog === 'sed' || prog === 'perl') inPlaceFiles(prog, a).forEach((w) => at(w));
    else if (prog === 'dd') a.filter((w) => w.startsWith('of=')).forEach((w) => at(w.slice(3)));
    else if (prog === 'xargs') {
      const rest = xargsCommand(a);
      if (writesUnseen(rest)) found.unknown.push(`what xargs hands to ${rest[0]}`);
    } else if (prog === 'find') {
      // Every -exec, not only the first (#352): `-exec echo {} ; -exec rm {} ;` runs both.
      const runs = a.flatMap((w, k) => (/^-(exec|execdir|ok|okdir)$/.test(w) ? [a.slice(k + 1)] : []));
      const writer = runs.find((rest) => writesUnseen(rest));
      // -fprint, -fprint0, -fprintf and -fls write the file they name.
      a.forEach((w, k) => { if (/^-(fprint0?|fprintf|fls)$/.test(w) && a[k + 1] !== undefined) at(a[k + 1]); });
      if (a.includes('-delete')) found.unknown.push('what find -delete removes');
      else if (writer) found.unknown.push(`what find hands to ${writer[0]}`);
    } else if (prog === 'git') {
      let k = 1; let base = dir;
      while (k < words.length && words[k].startsWith('-')) {
        if (words[k] === '-C') { const d = words[k + 1]; base = d === undefined || d.includes(DYN) || base === null ? null : path.resolve(base, d); }
        k += GIT_OPTIONS_WITH_VALUE.has(words[k]) ? 2 : 1;
      }
      const sub = words[k]; const ga = words.slice(k + 1);
      if (sub === undefined) continue;
      // #352: a file a git command writes by name: any --output (diff, log, show, format-patch), archive's -o,
      // format-patch's -o or --output-directory (into the current folder without one, unless --stdout), and
      // the folder worktree add or move fills. A folder is judged by a file in it, as the lane is by files.
      // git takes a long option by any prefix of it (`--out=x`, `--output-dir x`); an ambiguous one fails and
      // writes nothing, so reading every prefix as the option only errs toward a deny.
      const longValue = (w, j, name) => {
        const m = /^(--[a-z][a-z-]*)(?:=(.*))?$/s.exec(w);
        if (!m || !name.startsWith(m[1])) return null;
        return { long: m[1], value: m[2] ?? ga[j + 1] };
      };
      // -o in a group of short options (`-vo x`, `-9ox`), as git's option parser reads them.
      const short = (w, j) => {
        if (!/^-[^-]/.test(w)) return undefined;
        const at0 = w.indexOf('o');
        return at0 < 0 ? undefined : at0 === w.length - 1 ? ga[j + 1] : w.slice(at0 + 1);
      };
      if (sub === 'format-patch') {
        // Every folder or file it names is judged. The patches go to the current folder too unless --stdout
        // is certainly in force (git refuses -o with --stdout, so this only errs toward a deny): the last
        // of --stdout and --no-stdout before `--`, after a word that cannot have taken it as its value (no
        // word, a positional, or a commit count like -3). Its options are not listed here: diff options it
        // takes (-S, -G, -O ...) carry values a word list would misread.
        ga.forEach((w, j) => {
          const o = longValue(w, j, '--output-directory');
          if (o?.long === '--output') { if (o.value !== undefined) at(o.value, base); return; }
          const d = o ? o.value : short(w, j);
          if (d !== undefined) at(path.posix.join(d, '*.patch'), base);
        });
        const end = ga.includes('--') ? ga.indexOf('--') : ga.length;
        const last = Math.max(ga.lastIndexOf('--stdout', end - 1), ga.lastIndexOf('--no-stdout', end - 1));
        const before = ga[last - 1];
        // A --no-s... word may be --no-stdout abbreviated, so with one the patches may land here.
        const stdout = last >= 0 && ga[last] === '--stdout' && !ga.slice(0, end).some((w) => /^--no-s/.test(w))
          && (before === undefined || !before.startsWith('-') || /^-\d+$/.test(before));
        if (!stdout) found.unknown.push('the patch files git format-patch writes');
      } else {
        ga.forEach((w, j) => {
          const o = longValue(w, j, '--output');
          const f = o ? o.value : sub === 'archive' ? short(w, j) : undefined;
          if (f !== undefined) at(f, base);
        });
      }
      if (sub === 'worktree' && (ga[0] === 'add' || ga[0] === 'move')) {
        // --reason by any prefix, as git reads it (`--reas x`).
        const wa = ga.slice(1);
        const pos = positionals(wa, ['-b', '-B', ...wa.filter((w) => /^--re[a-z-]*$/.test(w) && '--reason'.startsWith(w))]);
        const made = ga[0] === 'add' ? pos[0] : pos[1];
        if (made !== undefined) at(path.posix.join(made, '*'), base);
      }
      if (sub.includes(DYN)) found.unknown.push(`git ${shown(sub)}`);
      else if (sub === 'rm' || sub === 'mv') positionals(ga).forEach((w) => at(w, base));
      else if (sub === 'restore') {
        if (ga.some((w) => w.startsWith('--pathspec-from-file'))) found.unknown.push('git restore --pathspec-from-file');
        positionals(ga, ['-s', '--source']).forEach((w) => at(w, base));
      } else if (sub === 'checkout' && !ga.some((w) => /^(-b|-B|--orphan|--detach)$/.test(w))) {
        const sep = ga.indexOf('--');
        const pos = sep >= 0 ? ga.slice(sep + 1) : positionals(ga);
        const paths = sep >= 0 ? pos : pos.filter((w) => w.includes(DYN) || exists(w, base));
        paths.forEach((w) => at(w, base));
        if (sep < 0 && paths.length < pos.length) found.tree.push(`git ${shown(words.slice(1).join(' '))}`);
      } else if (GIT_TREE.has(sub) && !gitReadsOnly(sub, ga)) found.tree.push(`git ${shown(words.slice(1).join(' '))}`);
    }
  }
  return found;
}

// scope on a Bash call (#209, #210): every target the command writes is judged as a Write to it would be.
// A read-only role is also denied a target only the run can tell and a git command that changes the
// tree; a writing role is not, since its lane check at Stop still sees what the command did.
if (scopeBash) {
  const { command, actor, ruleArgs } = scopeBash;
  let found;
  try { found = bashWrites(command); } catch (e) {
    deny(`${actor} may not run this command: it is too involved to read (${e.message}), so what it writes cannot be checked against its lane. Write it more simply.`);
  }
  // A file git ignores (a test log, a coverage report) is no change the lane check would see either.
  // The git directory is never exempt. Only a path inside the repo reaches git's argument list, after --.
  const ignored = (abs) => {
    const rel = repoRel(abs);
    return rel !== null && !inGitDir(abs) && git(root, 'check-ignore', '-q', '--', rel) !== null;
  };
  for (const t of found.targets) {
    const why = laneProblem(actor, ruleArgs, t.abs, t.shown, true);
    if (why && !ignored(t.abs)) deny(`${why} (The Bash command writes it; the hook read the command and did not run it.)`);
  }
  if (ruleArgs[0] === 'none' && found.unknown.length) {
    deny(`${actor} is a read-only role and writes no files: this command writes to ${found.unknown[0]}, which only the run can tell. `
      + 'Run it without the write, or report what should change instead.');
  }
  if (ruleArgs[0] === 'none' && found.tree.length) {
    deny(`${actor} is a read-only role and writes no files: \`${found.tree[0]}\` changes the working tree or the history. Report what should change instead.`);
  }
  process.exit(0);
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

// #213: the commands that undo patcher's changes since `sha` and nothing else: measure() leaves out
// protected files (the end check makes patcher restore those) and files uncommitted at the start, which
// hold the developer's own work. A path the start commit lacks is removed by git restore too. Single
// quotes for a POSIX shell, the Bash tool's. Kept in patch-undo.json and named in the failure messages;
// the hook never runs them, and the skill asks first. null: none.
const shellQuote = (p) => `'${p.replace(/'/g, "'\\''")}'`;
function undoCommand(sha, m) {
  const tracked = m.changed.filter((rel) => !m.untracked.includes(rel));
  return [
    tracked.length ? `git restore --source=${sha} --staged --worktree -- ${tracked.map(shellQuote).join(' ')}` : null,
    m.untracked.length ? `rm -f -- ${m.untracked.map(shellQuote).join(' ')}` : null,
  ].filter(Boolean).join(' && ') || null;
}
// #462: patcher's own changes since `sha` as one patch (the files undoCommand would take back, so never the developer's
// uncommitted work), for /speckit-team to start from after an ESCALATE. `git diff --no-index` exits 1 when the files
// differ, so its output is taken from the error. null when there is nothing, or git cannot make it.
function draftPatch(sha, m) {
  const raw = (args) => {
    try { return execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch (e) { return typeof e?.stdout === 'string' && e.status === 1 ? e.stdout : null; }
  };
  const tracked = m.changed.filter((rel) => !m.untracked.includes(rel));
  const parts = [tracked.length ? raw(['diff', '--binary', sha, '--', ...tracked]) : '',
    ...m.untracked.map((rel) => raw(['diff', '--no-index', '--binary', '--', '/dev/null', rel]))];
  if (parts.some((p) => p === null)) return null;
  const text = parts.join('');
  return text.trim() ? text : null;
}
const undoSentence = (sha, m) => {
  const undo = undoCommand(sha, m);
  return undo ? ` To undo only patcher's changes, run: ${undo}. Ask the developer first: it discards them.` : '';
};

// The end of a fast-track run (contracts/hook-cli.md "End of run"). Exits.
// #243: the exemption line of patcher's report for a production change with no test (twin: agents/patcher.md, the skill).
const NO_TEST_LINE = /^[\s*>#-]*No test:[ \t]*\S/im;

function endCheck(start, viaHandback, key, acceptedFile, undoFile) {
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
  // The end record (#213, #221): what takes the run back, and what the end check decided and why. A
  // SubagentStop message reaches only patcher's own transcript, never the main session, so the skill reads
  // these from a file next to the accepted record. Written before the message goes out, in its words.
  const end = (outcome, message) => {
    // #462: a run not accepted keeps patcher's work as a patch beside the record.
    const draftFile = path.join(path.dirname(undoFile), 'patch-draft.patch');
    const patch = outcome === 'accepted' ? null : draftPatch(start.sha, m);
    if (patch) fs.writeFileSync(draftFile, patch); else fs.rmSync(draftFile, { force: true });
    writeJson(undoFile, { key, sha: start.sha, undo: undoCommand(start.sha, m), draft: patch ? fwdPath(draftFile) : null, outcome, message, at: new Date().toISOString() });
    emit({ systemMessage: message });
  };
  const team = teamChanged(start.team);
  if (team.length) {
    end('failed', `fast track FAILED: installed agent team files changed during the run: ${team.map((t) => `${TEAM_DIR}/${t}`).join(', ')}. `
      + 'The fast track cannot restore them, and cannot tell a change patcher made from a setting Claude Code or you saved. '
      + 'The end check did not accept the run, so /speckit-patch commits nothing and opens no pull request; the work is uncommitted in the working tree. '
      + 'Check those files (if an agent, hook or skill file changed, reinstall the team with node install.mjs from the speckit-agents checkout), then run the change again.'
      + undoSentence(start.sha, m));
  }
  // A push cannot be taken back by the agent, so this fails the run rather than blocking the stop.
  const moved = remotesChanged(start.remotes);
  if (moved.length) {
    end('failed', `fast track FAILED: remote-tracking refs changed during the run: ${moved.join(', ')}. `
      + 'A push or a fetch happened, which the fast track never does, so the end check did not accept the run: /speckit-patch commits nothing and opens no pull request; the work is uncommitted in the working tree. '
      + 'Check the remote for a pushed branch or a pull request before you run the change again.'
      + undoSentence(start.sha, m));
  }
  if (m.lines > PATCH_LINES || m.files > PATCH_FILES || m.binary.length || m.dirtyTouched.length) {
    end('stopped', `fast track stopped: ${m.lines} changed production lines in ${m.files} files (limit ${PATCH_LINES} lines, ${PATCH_FILES} files)`
      + (m.binary.length ? `; binary production files: ${m.binary.join(', ')}` : '')
      + (m.dirtyTouched.length ? `; changed although they had uncommitted changes when the run started: ${m.dirtyTouched.join(', ')}` : '')
      + '. Nothing was committed; the work is uncommitted in the working tree. Use /speckit-team for this change.'
      + undoSentence(start.sha, m));
  }
  // #243: a change in behaviour comes with its regression test (patcher's Process 2). The hook cannot tell a
  // behaviour change from a typo, so a production change with no test file in the run is stopped, unless the
  // report says why it has none: a line `No test: <reason>`. A docs-only change has no production lines to check.
  const tests = testsAt(start.sha);
  const repText = reportText(viaHandback);
  const noTestExempt = NO_TEST_LINE.test(repText) || (!viaHandback && readState(handbackFile(key))?.noTest === true);
  if (m.lines > 0 && !m.changed.some((rel) => tests.isTest(rel)) && !noTestExempt) {
    end('stopped', `fast track stopped: ${m.lines} changed production lines and no test file changed. A change in behaviour needs a regression test, shown failing. `
      + 'If the change has no behaviour (a typo, a comment, a config value), the report says so in a line `No test: <reason>`. '
      + 'Nothing was committed; the work is uncommitted in the working tree. Write the test or add that line, then run the change again.'
      + undoSentence(start.sha, m));
  }
  // #489: block accidental secret or credential patterns in changed files at patch Stop.
  const patchSecrets = secretsInFiles(m.changed);
  if (patchSecrets.length) {
    refuse(`Fast track: ${who} added secret or credential patterns in: ${patchSecrets.join(', ')}. `
      + 'Remove the hardcoded secret or .env file before finishing.');
  }
  // #486: a patcher run that edited files via Write/Edit and reports DONE without a Bash test run after the edit is sent back once.
  const patchUntested = path.join(stateDir, 'patch', `${key}.untested.json`);
  const patchAsked = path.join(stateDir, 'patch', `${key}.untested-asked`);
  const repWord = lastWord(repText);
  if (m.lines > 0 && !noTestExempt && repWord !== 'FAILED' && repWord !== 'ESCALATE') {
    const u = readState(patchUntested);
    if (u?.file && !fs.existsSync(patchAsked)) {
      writeJson(patchAsked, {});
      fs.rmSync(patchUntested, { force: true });
      refuse(`Fast track: ${u.file} was modified after your last Bash test run. Run the tests on the final code before finishing.`);
    }
  }
  fs.rmSync(patchUntested, { force: true });
  fs.rmSync(patchAsked, { force: true });
  writeJson(acceptedFile, { key, sha: start.sha, files: m.changed, untracked: m.untracked, lines: m.lines, filesTouched: m.files, at: new Date().toISOString() });
  end('accepted', `fast track: ${m.lines} of ${PATCH_LINES} production lines, ${m.files} of ${PATCH_FILES} production files (tests and docs not counted). The end check accepted the run.`);
}

// #72, the structural option. A Bash command the hook lets through runs with git's network transports
// switched off, in the environment's config scope above every config file, so a push or fetch from a
// script, a package script, an alias or a string built at run time fails too. Paths on disk keep git's
// default. Claude Code checks each part of the rewritten command against the user's rules: the export
// line needs a rule of its own, or every command the user allowed would ask again (2.1.296: "The
// following part requires approval: export ..."; deny rules still matched). So it is rewritten in
// bypassPermissions, where no rule is consulted, and in any other mode only while the installed
// settings.json allows this exact line, which install.mjs writes (#122). Twin: NO_NETWORK in install.mjs.
const NO_NETWORK = [['protocol.allow', 'never'], ['protocol.file.allow', 'user'],
  ...['git', 'ssh', 'http', 'https', 'ext'].map((p) => [`protocol.${p}.allow`, 'never'])];
// #123: a forge's API does not go through git. gh and glab read their stored login through their
// config folder; one that does not exist names no host, so a script's `gh pr merge` or `gh api` stops
// for lack of a login before any request. Relative, so the line, and install.mjs's exact rule for it,
// are the same on every machine. #138: a token in the environment, as in CI, skips the stored login,
// so the forge CLIs' token variables are set to empty, which gh and glab read as unset (owner
// decision: a test suite that reads them sees none under patcher). `gh auth token`, which reads the
// keyring directly (gh 2.89), still works. #140: glab creates its config folder on its first run, and
// wrote one that only did not exist yet into the user's repository. Its folder is a name longer than
// the 255 bytes a path component may have, which cannot be created on Linux, macOS or Windows, from any
// working directory: glab 1.123.0 then stops before any request. gh 2.89 on Linux refuses to start at
// all with that name. #155: gh's folder, relative, was one a repository could commit, handing gh a
// login. It ends in `.git`, a path part git refuses to track at any depth, so no checkout holds it; its
// parent need not exist, so it also names nothing in a worktree, where `.git` is a file (under
// `.git/...` gh 2.89 on Linux does not start there). Twin: NO_FORGE_LOGIN in install.mjs.
const NO_GLAB_DIR = '.speckit-no-forge-login'.padEnd(256, '-');
const NO_FORGE_LOGIN = [['GH_CONFIG_DIR', '.speckit-no-forge-login/.git'], ['GLAB_CONFIG_DIR', NO_GLAB_DIR],
  ...['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN'].map((k) => [k, ''])];
const allowedExactly = (line) => {
  let s; try { s = JSON.parse(readOr(path.join(TEAM_DIR, 'settings.json'), 'null')); } catch { return false; }
  return Array.isArray(s?.permissions?.allow) && s.permissions.allow.includes(`Bash(${line})`);
};
function letThrough() {
  const ti = input.tool_input || {};
  if (input.tool_name !== 'Bash' || typeof ti.command !== 'string') process.exit(0);
  // Pairs the environment already passes keep their numbers; these follow them.
  const n = Number(process.env.GIT_CONFIG_COUNT);
  const from = Number.isInteger(n) && n > 0 ? n : 0;
  const pairs = NO_NETWORK.map(([k, v], i) => `GIT_CONFIG_KEY_${from + i}=${k} GIT_CONFIG_VALUE_${from + i}=${v}`).join(' ');
  const line = `export GIT_CONFIG_COUNT=${from + NO_NETWORK.length} ${pairs} ${NO_FORGE_LOGIN.map(([k, v]) => `${k}=${v}`).join(' ')}`;
  if (input.permission_mode !== 'bypassPermissions' && !allowedExactly(line)) process.exit(0);
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...ti, command: `${line}\n${ti.command}` } } });
}

if (mode === 'patch') {
  const acceptedFile = path.join(ownGitDir, 'speckit-team', 'patch-accepted.json');
  const undoFile = path.join(path.dirname(acceptedFile), 'patch-undo.json');
  const viaHandback = event === 'PreToolUse' && input.tool_name === 'SubagentHandback';
  const isEnd = viaHandback || event !== 'PreToolUse';
  const key = keyOf(agentId ?? str(input.session_id));
  // Every call removes the accepted record and the undo record: each stands only while the last call was an end check.
  fs.rmSync(acceptedFile, { force: true });
  fs.rmSync(undoFile, { force: true });
  if (!key) noDecision('no agent_id or session_id to keep the start record under');
  // #354: a tool call is new work, so its report is a new one: the last handback's `No test:` line no longer counts.
  if (!isEnd) fs.rmSync(handbackFile(key), { force: true });
  const f = patchFile(key);
  if (isEnd && !fs.existsSync(f)) process.exit(0);
  // #444: a read-only tool right after a read-only tool that passed every check changes nothing the checks
  // measure, so it skips them (about 60 ms of git on Windows). Any other call removes the mark first, so what a
  // Bash or write call changed is measured at the next call; the end check always measures.
  const readOnly = !isEnd && ['Read', 'Grep', 'Glob', 'LS'].includes(input.tool_name);
  const cleanFile = path.join(stateDir, 'patch-clean', path.basename(f));
  if (readOnly && fs.existsSync(cleanFile) && fs.existsSync(f)) letThrough();
  fs.rmSync(cleanFile, { force: true });
  if (viaHandback) writeJson(handbackFile(key), { noTest: NO_TEST_LINE.test(reportText(true)), at: new Date().toISOString() });
  if (!fs.existsSync(f)) {
    const sha = git(root, 'rev-parse', 'HEAD');
    if (!sha) deny('Fast track: this repo has no commit to measure the change from. Commit first, or use /speckit-team.');
    const dirty = Object.fromEntries(changedSince('HEAD').map((rel) => [rel, stateOf(rel)]));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // #444: the start commit's test patterns and whether it is this repo, read once instead of on every call.
    const testPaths = git(root, 'cat-file', 'blob', `${sha}:.specify/test-paths`) ?? '';
    try { fs.writeFileSync(f, JSON.stringify({ sha, dirty, team: teamState(), remotes: remoteRefs(), testPaths, own: isOwnRepo(sha), at: new Date().toISOString() }, null, 1), { flag: 'wx' }); } catch { /* written by a parallel call */ }
  }
  const start = readState(f);
  const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (!plain(start) || typeof start.sha !== 'string' || !/^[0-9a-f]{40,64}$/.test(start.sha) || !plain(start.dirty)
    || !plain(start.team) || !Object.values(start.team).every((v) => v === null || (typeof v === 'string' && HEX64.test(v)))
    || !plain(start.remotes) || !Object.values(start.remotes).every((v) => typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v))
    || !Object.values(start.dirty).every((v) => v === null || (typeof v === 'string' && HEX64.test(v)))
    || git(root, 'cat-file', '-e', `${start.sha}^{commit}`) === null) {
    if (isEnd) emit({ systemMessage: `speckit-team: fast-track check could not run for ${who}: ${f} is unreadable or names a commit this repo does not have.` });
    deny(`Fast track: the budget cannot be measured: ${f} is unreadable or names a commit this repo does not have. `
      + 'Report this; the user deletes the file to start over.');
  }
  if (typeof start.own === 'boolean' && !ownRepo.has(start.sha)) ownRepo.set(start.sha, start.own);
  if (typeof start.testPaths === 'string' && !testsAtMemo.has(start.sha)) {
    const t = parseTestPaths(start.testPaths);
    testsAtMemo.set(start.sha, { isTest: t.isTest, bad: t.bad });
  }
  const bad = testsAt(start.sha).bad;
  if (bad) {
    if (isEnd) emit({ systemMessage: `speckit-team: fast-track check could not run for ${who}: ${bad} (as committed at ${start.sha.slice(0, 12)}).` });
    deny(`Fast track: the budget cannot be measured: ${bad} (as committed at ${start.sha.slice(0, 12)}). `
      + 'Report this to the user, who fixes and commits the file, then starts a new run.');
  }
  if (isEnd) endCheck(start, viaHandback, key, acceptedFile, undoFile);
  // #444: the protected-path check `scope protected` made in a second process.
  const wti = input.tool_input || {};
  const wrote = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name) ? str(wti.file_path ?? wti.notebook_path) : null;
  if (wrote) { const w = laneProblem(who, ['protected'], path.resolve(cwd, wrote), wrote, false); if (w) deny(w); }
  const moved = remotesChanged(start.remotes);
  if (moved.length) {
    deny(`Fast track: remote-tracking refs changed during the run: ${moved.join(', ')}. A push or a fetch happened, which the fast track never does. `
      + 'Stop and report ESCALATE; the developer checks the remote.');
  }
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
    if (!rel || !isDoc(rel)) {
      try { writeJson(path.join(stateDir, 'patch', `${key}.untested.json`), { file: rel ?? str(given), at: new Date().toISOString() }); } catch { /* non-blocking */ }
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
    fs.rmSync(path.join(stateDir, 'patch', `${key}.untested.json`), { force: true });
  }
  let m;
  try { m = measure(start); } catch (e) {
    deny(`Fast track: the budget cannot be measured: ${e?.message ?? e}. Report this; the user starts a new run.`);
  }
  const pending = m.protectedChanged.length > 0 || m.committed;
  if (m.lines > PATCH_LINES || m.files > PATCH_FILES || m.binary.length || m.dirtyTouched.length) {
    if (input.tool_name === 'Bash' && restoreAllowed(ti.command, start, m)) letThrough();
    deny(`Fast-track budget exceeded: ${m.lines} changed production lines in ${m.files} files (limit ${PATCH_LINES} lines, ${PATCH_FILES} files)`
      + (m.binary.length ? `; binary production files are not allowed: ${m.binary.join(', ')}` : '')
      + (m.dirtyTouched.length ? `; changed or committed although they had uncommitted changes when the run started, so the change cannot be measured: ${m.dirtyTouched.join(', ')}` : '')
      + '. Tests and docs do not count. Stop: leave the work uncommitted and report ESCALATE; the developer re-runs the change with /speckit-team.'
      + (pending ? ` First restore the protected files, naming each one (git checkout ${start.sha.slice(0, 12)} -- <file>, or rm <file> for a new file), and undo any commit (git reset --soft ${start.sha.slice(0, 12)}).` : ''));
  }
  if (readOnly) { fs.mkdirSync(path.dirname(cleanFile), { recursive: true }); fs.writeFileSync(cleanFile, ''); }
  letThrough();
}
