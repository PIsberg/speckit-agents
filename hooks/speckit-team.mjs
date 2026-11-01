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
//                           spec-auditor has passed the current spec, plan, tasks, constitution; skipped in a
//                           subagent whose session's team (recorded at the main session's launch of a team
//                           role from its `Team:` line, never a decision) lacks spec-auditor, and for the main
//                           session after the user typed /speckit-team --team noagents
//   gate retries            the same, and also block implementer after MAX_RED REDs in a row
//   verdict                 SubagentStop of spec-auditor: record its VERDICT line
//   result                  SubagentHandback / Stop of implementer: count its RESULT line
//   ends [--record] <word>... SubagentHandback / Stop: the report's last line must be one of the words;
//                           --record keeps the accepted word for the feature (spec-gatekeeper's)
//   start                   SubagentStart of product-owner and architect: record where the agent started, for
//                           the lane check at its Stop; never a decision
//   lane tests|no-tests|only <prefix>...  SubagentStop: check the agent's whole diff, including Bash writes
//   patch                   PreToolUse (any tool): deny once the fast track's change passes its line and file budget,
//                           or it runs a history/remote command or a wholesale restore; run a Bash command it lets
//                           through with git's network transports off (in bypassPermissions, or where the installed
//                           settings.json allows the export line); SubagentHandback, SubagentStop and
//                           Stop: the end check (protected files, commits, the installed team's hashes, budget, a production change with no test unless the report says `No test:`) and the accepted record
//   project <name> [--init] Not a hook: the skills run it from Bash. Prints the project's block (feature 007) or one
//                           refusal line, exit 0 or 1; --init creates .specify/projects/<name>/ with a starter file
//   relay                   PostToolUse of Agent in the main session: hands it what the hooks said inside its
//                           subagents (kept under notices/ as they said it), as additionalContext; never a decision
//   check                   Not a hook: the pipeline skills' first step (#230). Exit 1 when the team that would run
//                           is not this install alone (mixed builds, a second install of another build, a project
//                           install in a folder Claude Code has not trusted); `note:` lines otherwise
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
const CLI = mode === 'project' || mode === 'check';
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
let note = null;
const addNote = (m) => { note = [note, m].filter(Boolean).join('\n'); };
// #231: set once the state folder is known, for a hook running in a subagent (see keepNotice below).
let keepNotice = null;
const emit = (obj) => {
  const say = [note, obj.systemMessage].filter(Boolean).join('\n');
  if (say && keepNotice) keepNotice(say);
  process.stdout.write(JSON.stringify(say ? { ...obj, systemMessage: say } : obj));
  process.exit(0);
};
const finish = () => (note ? emit({}) : process.exit(0));
const deny = (reason) => emit({ hookSpecificOutput: {
  hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const block = (reason) => emit({ decision: 'block', reason });

const cwd = str(input.cwd) ?? process.cwd();
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
function repoDirs() {
  const args = ['-c', 'core.quotepath=off', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'];
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
const [root, commonDir] = repoDirs();
if (!root || !commonDir || !fs.existsSync(path.join(root, '.specify'))) notSpecKit();
inSpecKitRepo = true;

// #228: the drift check, a second file beside this script, loaded only by the modes that can close
// spec-gatekeeper's report: `ends --record`, and `gate` and `lane role`, which close a skill-agents role.
// Loaded here, inside a Spec Kit repo, so no other repo pays for it. A missing or broken file is kept as
// the error, and APPROVED is then recorded with a message that the check did not run (constitution II).
const driftModule = (mode === 'ends' && args[0] === '--record') || mode === 'gate' || (mode === 'lane' && args[0] === 'role')
  ? await import(new URL('./speckit-drift.mjs', import.meta.url).href).catch((e) => e) : null;
// The active feature's drift: { problems }, or { failed } when the check could not run.
function driftOf(feat) {
  if (typeof driftModule?.drift !== 'function') return { failed: driftModule?.message ?? 'speckit-drift.mjs has no drift()' };
  try { return { problems: driftModule.drift(root, { feature: feat }).problems }; } catch (e) { return { failed: e?.message ?? String(e) }; }
}
const driftRefusal = (name, problems) => `${name}'s APPROVED is refused: tasks.md cites requirements that no test file of their `
  + `task holds (the drift check; test-writer puts each ID in a test's name or a comment):\n${problems.join('\n')}\n`
  + 'A requirement no test holds cannot be approved, whatever argument covers it. Report each as a rejection reason '
  + '(owner: test-writer, who adds the test, or the ID to the test that already covers it) and end with REJECTED.';
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
const inLane = (rule, rel) => (rule === 'tests' ? !SPECKIT_CONFIG.test(rel) && (isTest(rel) || TASKS_FILE.test(rel)) : !isTest(rel) && !SPECKIT_CONFIG.test(rel));
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
const endsFile = (feat) => path.join(stateDir, 'ends', `${path.basename(feat)}.json`);
// REDs count only against the plan and tasks they were made on: a revision starts from zero.
const redCount = (r, feat) => (r && r.fingerprint === fingerprint(feat) && Array.isArray(r.red) ? r.red.length : 0);
const writeJson = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 1)); };

// The team of a /speckit-team run, recorded at the main session's Agent launch (contracts/team-choice.md, 7).
const CORE_ROLES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'];
const TEAM_ROLES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper', 'security-reviewer'];
const SESSION_ID = /^[\w-]{1,128}$/;

// #231: a hook's systemMessage in a subagent lands in that subagent's transcript only, and under claude -p
// nobody sees it: an out-of-lane file left behind, a lane check that could not run, an APPROVED recorded
// as REJECTED. So each one is also kept under notices/, by the session the subagent's input names (the
// main session's), and `relay`, on the main session's PostToolUse of Agent, hands them over once.
const noticeFile = (sessionId) => path.join(stateDir, 'notices', `${sessionId}.jsonl`);
const noticeSession = str(input.session_id);
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
// 009: the role acting in a skill-agents request's main session (data-model.md).
const roleFile = (sessionId) => path.join(stateDir, 'role', `${sessionId}.json`);
// The role skills a typed `--team skill-agents` needs, found from this script's own folder.
function missingRoleSkills() {
  return TEAM_ROLES.filter((r) => !fs.existsSync(path.join(TEAM_DIR, 'skills', `speckit-role-${r}`, 'SKILL.md')));
}
const SKILL_AGENTS_START = `speckit-team: skill-agents for this request: the roles run as skills in this session. Enforced by the hook: each role's lane, the audit gate before test-writer, implementer and spec-gatekeeper, spec-auditor's verdict and spec-gatekeeper's word. Not enforced: the audit gate on each tool call inside test-writer and implementer (a spec, plan or tasks edit there is caught when the next of them or spec-gatekeeper starts), the retry limit (the skill counts), the check that a report ends in its word, each role's own context (every role sees this conversation), each agent's tool list (a role may use every tool of this session, MCP tools included, and a read-only role's write through one is not checked), and a role's lane after its turn ends without a Stop (an interrupt or an API error; the role's lane check and report then do not run). Not observed: whether a background task's notice, a compaction or a message typed while a role runs carries a new prompt_id; if one does, it may end the role mid-turn, with the message that the role ended, and its lane goes unchecked for the rest of that turn.`;
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
    } else break;
  }
  if (words[0] !== '--team') return null;
  const list = [];
  for (const w of words.slice(1)) { list.push(w); if (!w.endsWith(',')) break; }
  return list.join('').split(',').map((w) => {
    const raw = w.toLowerCase();
    return raw === 'security' ? 'security-reviewer' : raw;
  }).filter(Boolean);
}
// The session's team record, { roles, noagents }, or null when missing or unreadable (the full gates
// then apply). `noagents` comes only from a typed `/speckit-team --team noagents`.
function teamOf() {
  const id = str(input.session_id);
  if (!id || !SESSION_ID.test(id)) return null;
  const r = readState(teamFile(id));
  if (!r || !Array.isArray(r.roles) || !r.roles.every((x) => TEAM_ROLES.includes(x))) return null;
  return { roles: r.roles, noagents: r.noagents === true && r.roles.length === 0, skillAgents: r.skillAgents === true };
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
const auditorRef = () => (teamOf()?.skillAgents
  ? 'the Skill speckit-role-spec-auditor (an agent launch ends skill-agents mode)' : '@agent-spec-auditor');

// 009: the scope rule of each role skill, equal to the `scope` hook in agents/<role>.md (a test holds the twin).
// Keys in double quotes, values in single: the twin test in test/hook.test.mjs reads this literal.
const ROLE_LANES = {
  "product-owner": ['only', 'specs/', '.specify/feature.json'],
  "architect": ['only', 'specs/', 'CLAUDE.md'],
  "spec-auditor": ['none'],
  "test-writer": ['tests'],
  "implementer": ['no-tests'],
  "spec-gatekeeper": ['none'],
  "security-reviewer": ['none'],
};
const ROLE_SKILL = /(^|:)speckit-role-([a-z-]+)$/;

// The JSONL lines of a file from byte `offset`, or null when it cannot be read.
function linesAfter(file, offset) {
  if (typeof file !== 'string' || !file) return null;
  try {
    const buf = fs.readFileSync(file);
    return lines(buf.subarray(Number.isInteger(offset) && offset > 0 ? offset : 0).toString('utf8'));
  } catch { return null; }
}
// The role ended when the record holds a prompt_id and this call carries another: a new prompt is a new turn.
// A record or input without a string prompt_id leaves the role live.
function roleEnded(rec) {
  return typeof rec?.prompt_id === 'string' && rec.prompt_id !== '' && str(input.prompt_id) !== null && str(input.prompt_id) !== rec.prompt_id;
}
function dropRole(rec) {
  const id = str(input.session_id);
  if (id && SESSION_ID.test(id)) fs.rmSync(roleFile(id), { force: true });
  return `speckit-team: the ${rec.role} role ended with its turn and no Stop ran; its lane check and report did not run. Call the Skill speckit-role-${rec.role} again to continue it.`;
}

// The files changed since a start record that fall outside a lane. Only a hex commit id reaches git's
// argument list: "--output=..." would be read as an option.
function laneOutside(base, rule, prefixes, whoName) {
  const no = (why) => ({ problem: `lane check could not run for ${whoName}: ${why}` });
  if (!base || typeof base !== 'object') return no('its start record is unreadable.');
  if (typeof base.sha !== 'string' || !/^[0-9a-f]{40,64}$/.test(base.sha) || !Array.isArray(base.dirty)) return no('its start record is incomplete.');
  if ((rule === 'tests' || rule === 'no-tests') && testPaths.bad) return no(`${testPaths.bad}.`);
  // A diff against a commit git cannot find fails, and a failed diff would read as "nothing changed".
  if (git(root, 'cat-file', '-e', `${base.sha}^{commit}`) === null) return no(`its start commit ${base.sha.slice(0, 12)} is not in this repo.`);
  const fits = (rel) => (rule === 'only' ? inPrefixes(prefixes, rel) : inLane(rule, rel));
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
    addNote(`spec-auditor role recorded VERDICT: ${verdict} for ${feat}`);
    return;
  }
  // #185: the report and the hand-over can share one response, so the last word line counts, not the last line.
  const word = [...texts].reverse().map(lastGatekeeperWord).find(Boolean);
  if (!word) {
    if (read === null) return unread();
    addNote('speckit-team: the spec-gatekeeper role ended without a final APPROVED or REJECTED line, so no word was recorded.');
    return;
  }
  if (!feat) { addNote(`speckit-team: the spec-gatekeeper role's ${word} was not recorded: no active feature.`); return; }
  // #228, as for the agent: sent back once at Stop (the role stays the acting one), then recorded as REJECTED.
  const drifted = word === 'APPROVED' ? driftOf(feat) : null;
  if (drifted?.problems?.length) {
    if (where === 'stop' && !input.stop_hook_active) block(driftRefusal('the spec-gatekeeper role', drifted.problems));
    writeJson(endsFile(feat), { word: 'REJECTED', claimed: 'APPROVED', drift: drifted.problems, feature: feat, at, agent_id: null, role: rec.role });
    addNote(`speckit-team: the spec-gatekeeper role's APPROVED was recorded as REJECTED: ${drifted.problems.join('; ')}`);
    return;
  }
  if (drifted?.failed) addNote(driftUnchecked('the spec-gatekeeper role', drifted.failed));
  writeJson(endsFile(feat), { word, feature: feat, at, agent_id: null, role: rec.role });
}

// Close the acting role (contract section 6) at a Skill call ('skill': denies on a lane violation, else
// returns) or at Stop ('stop': blocks on one, else removes the record and ends the hook).
// `gate`, given at a Skill call, runs once the record is known live and before its lane is judged: a spec,
// plan or tasks edit made inside the role is then named by the audit gate (tests/hook.test.mjs, T007).
function closeRole(rec, at, gate = null) {
  const id = str(input.session_id);
  const drop = () => { if (id && SESSION_ID.test(id)) fs.rmSync(roleFile(id), { force: true }); };
  const done = () => { if (at === 'stop') { drop(); finish(); } };
  if (!rec || typeof rec !== 'object' || !Object.hasOwn(ROLE_LANES, rec.role)) {
    addNote('speckit-team: lane check could not run for the acting role: its role record is unreadable or incomplete.');
    return done();
  }
  if (roleEnded(rec)) { addNote(dropRole(rec)); return at === 'stop' ? finish() : undefined; }
  recordReport(rec, at === 'skill' ? str(input.tool_input?.args)?.split('\n')[0] ?? null : str(input.last_assistant_message), at);
  if (gate) gate();
  const [rule, ...prefixes] = ROLE_LANES[rec.role];
  if (rule !== 'none') {
    const r = laneOutside(rec, rule, prefixes, rec.role);
    if ('problem' in r) { addNote(`speckit-team: ${r.problem}`); return done(); }
    if (r.outside.length) {
      const text = `Lane check: ${rec.role} changed files outside its lane: ${r.outside.join(', ')}. `
        + `Restore them (git checkout ${rec.sha.slice(0, 12)} -- <file>, or delete new files), then go on.`;
      if (at === 'skill') deny(text);
      if (!input.stop_hook_active) block(text);
      drop();
      emit({ systemMessage: `WARNING: ${rec.role} left changes outside its lane: ${r.outside.join(', ')}` });
    }
  }
  return done();
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
  if ((rule === 'tests' || rule === 'no-tests') && testPaths.bad) {
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
// Whether Claude Code has trusted `dir` or a folder above it: true, false, or null when its file is unreadable.
function trusted(dir) {
  const conf = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
  const text = readOr(conf, undefined);
  if (text === undefined) return { ok: false, conf };
  let projects;
  try { projects = JSON.parse(text)?.projects ?? {}; } catch { return { ok: null, conf }; }
  const norm = (p) => { const f = fwdPath(p).replace(/\/+$/, ''); return process.platform === 'win32' ? f.toLowerCase() : f; };
  const accepted = new Set(Object.entries(projects).filter(([, v]) => v?.hasTrustDialogAccepted === true).map(([k]) => norm(k)));
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (accepted.has(norm(d))) return { ok: true, conf };
    if (path.dirname(d) === d) return { ok: false, conf };
  }
}
if (mode === 'check') {
  const self = STAMP.exec(readOr(fileURLToPath(import.meta.url), ''));
  if (!self) projectRefuse('this hook is not an installed copy (it carries no build stamp). Install the team with node install.mjs and run the skill from it.');
  const [, version, build] = self;
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
      problems.push(`the team is installed in ${here}, and Claude Code has not trusted ${fwdPath(root)} or a folder above it (${fwdPath(t.conf)}): `
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
  projectSay([`speckit-team: check: ok, speckit-agents ${version} build ${build} in ${here}`, ...notes].join('\n'), 0);
}

if (mode === 'scope') {
  const ti = input.tool_input || {};
  const viaBash = input.tool_name === 'Bash';
  const given = viaBash ? ti.command : ti.file_path ?? ti.notebook_path;
  if (given === undefined || given === null || given === '') process.exit(0);
  // patcher's Bash calls are patch mode's to judge, with the fast track's own rules.
  if (viaBash && args[0] === 'protected') process.exit(0);
  const file = str(given);
  if (!file) noDecision(`tool_input.${viaBash ? 'command' : 'file_path'} is ${Array.isArray(given) ? 'an array' : typeof given}, not a ${viaBash ? 'command' : 'path'}`);
  // 009: `scope role` holds the main session to the acting role skill's lane (contract section 5).
  let ruleArgs = args;
  let actor = who;
  if (args[0] === 'role') {
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
    const why = laneProblem(actor, ruleArgs, path.resolve(cwd, file), file, false);
    if (why) deny(why);
    process.exit(0);
  }
}

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
    fs.rmSync(roleFile(id), { force: true });
    const roles = typedRoles(str(input.command_args) ?? (str(input.prompt) ?? '').replace(/^\s*\/\S*/, ''));
    // `skill-agents noagents` is a refused combination, which the skill reports; the hook records nothing.
    const afterTeam = (str(input.command_args) ?? (str(input.prompt) ?? '').replace(/^\s*\/\S*/, '')).trim().split(/\s+/);
    const nextWord = (afterTeam[afterTeam.indexOf('--team') + 2] ?? '').toLowerCase();
    if (roles?.length === 1 && roles[0] === 'skill-agents' && nextWord !== 'noagents') {
      const missing = missingRoleSkills();
      if (missing.length) block(`speckit-team: --team skill-agents needs the role skills ${missing.map((r) => `speckit-role-${r}`).join(', ')}, which are not installed. Run node install.mjs and type the request again.`);
      writeJson(teamFile(id), { session_id: id, roles: TEAM_ROLES, skillAgents: true, at: new Date().toISOString() });
      emit({ systemMessage: SKILL_AGENTS_START });
    }
    if (roles?.length !== 1 || roles[0] !== 'noagents') process.exit(0);
    writeJson(teamFile(id), { session_id: id, roles: [], noagents: true, at: new Date().toISOString() });
    emit({ systemMessage: 'speckit-team: no agents for this request: /speckit-implement in this session skips the audit gate until the next /speckit-team or team agent launch' });
  }
  if (typed && !/(^|:)speckit[-.]implement$/.test(input.command_name || '')) process.exit(0);
  // Reporting back is not work. Gating SubagentHandback leaves a blocked agent unable to say so.
  if (event === 'PreToolUse' && input.tool_name === 'SubagentHandback') process.exit(0);
  if (event === 'PreToolUse' && input.tool_name === 'Agent') {
    // Never a decision: only the team and project records change, and only at the main session's launch
    // of a team role (or patcher, for the project). A subagent's Agent call (#102) and a launch of any
    // other agent (#103) change nothing.
    const id = str(input.session_id);
    const role = str(input.tool_input?.subagent_type)?.toLowerCase();
    if (agentId || !id || !SESSION_ID.test(id) || typeof input.tool_input?.prompt !== 'string') process.exit(0);
    if (!TEAM_ROLES.includes(role) && role !== 'patcher') process.exit(0);
    // The project for the agents this launch starts (feature 007): set from the Project line, or removed.
    let projectNote = null;
    const named = parseProject(input.tool_input.prompt);
    fs.rmSync(projectFile(id), { force: true });
    if (named) {
      const r = renderProject(named);
      if (r.refused) projectNote = `speckit-team: the Project line names ${named}, which is not a project (${r.refused}); agents start without project context`;
      else writeJson(projectFile(id), { session_id: id, name: named, at: new Date().toISOString() });
    }
    const say = (m) => emit({ systemMessage: [projectNote, m].filter(Boolean).join('\n') });
    if (role === 'patcher') { if (projectNote) say(null); process.exit(0); }
    const team = parseTeam(input.tool_input.prompt);
    // No Team line, or one naming a non-role: the full team (FR-002).
    const roles = team && !('bad' in team) ? team.roles : CORE_ROLES;
    const was = teamOf();
    // Within a request the team never loses spec-auditor once it has it (#101); a typed /speckit-team
    // starts the next request.
    if (was?.roles.includes('spec-auditor') && !roles.includes('spec-auditor')) {
      say("speckit-team: the Team line drops spec-auditor, which this request's team has; the audit gate stays on. A new /speckit-team request chooses a new team.");
    }
    writeJson(teamFile(id), { session_id: id, roles, at: new Date().toISOString() });
    if (team && 'bad' in team) say(`speckit-team: the Team line names ${team.bad}, not a team role; the full team's gates apply`);
    if (team) say(`speckit-team: team for this session: ${roles.join(', ')}; audit gate ${roles.includes('spec-auditor') ? 'on' : 'off, spec-auditor is not in the team'}`);
    if (was?.noagents) say("speckit-team: a team agent was launched in a no-agents request; the full team's gates apply from here");
    if (projectNote) say(null);
    process.exit(0);
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
        deny(`speckit-role-${roleSkill} runs only in a request typed as /speckit-team --team skill-agents <request>.`);
      }
      const auditGate = () => {
        const gap = ['test-writer', 'implementer', 'spec-gatekeeper'].includes(roleSkill) ? auditProblem() : null;
        if (gap) deny(`Implementation gate: ${gap}. Run ${auditorRef()} and get VERDICT: PASS first.`);
      };
      const live = readState(roleFile(id));
      if (live !== undefined) closeRole(live, 'skill', auditGate);
      auditGate();
      const start = startRecord();
      if (start) {
        const transcript = str(input.transcript_path);
        // #180: an unreadable transcript leaves the role's start unknown (null), never 0, which would read
        // earlier turns as the role's report.
        let offset = null;
        try { if (transcript) offset = fs.statSync(transcript).size; } catch { /* unreadable: start unknown */ }
        const feat = feature();
        writeJson(roleFile(id), {
          session_id: id, role: roleSkill, ...start, transcript: transcript ?? null, offset, prompt_id: str(input.prompt_id),
          feature: feat, fingerprint: roleSkill === 'spec-auditor' && feat ? fingerprint(feat) : null, at: new Date().toISOString(),
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
  if (args[0] === 'retries' && feat) {
    const r = readState(retryFile(feat));
    if (r === null) {
      deny(`Retry limit: the retry record for ${feat} is unreadable, so no further attempt can be allowed. `
        + `Delete ${retryFile(feat)} to reset it.`);
    }
    if (redCount(r, feat) >= MAX_RED) {
      // A team without architect has nobody to rethink the plan (#106, contract section 5).
      const team = teamOf();
      const next = team && !team.roles.includes('architect')
        ? "There is no architect in this run's team, so the user decides"
        : 'The architect rethinks plan.md or tasks.md (the new audit resets the count), or the user decides';
      deny(`Retry limit: implementer reported RESULT: RED ${MAX_RED} times in a row on ${feat} with the current plan and tasks. `
        + `Stop and report back; do not try to reset the count. ${next}, and only the user retries unchanged by deleting ${retryFile(feat)}.`);
    }
  }
  if (agentId && !fs.existsSync(baseFile(agentKey))) {
    const start = startRecord();
    if (start) writeJson(baseFile(agentKey), start);
  }
  process.exit(0);
}

if (mode === 'verdict') {
  // The auditor's first tool call records the files it starts from: a verdict is about the files it
  // read, and one that finishes after they changed would stamp itself on files nobody audited (#77).
  const startFile = agentKey && path.join(stateDir, 'agents', `${agentKey}.audit-start.json`);
  const doneFile = agentKey && path.join(stateDir, 'agents', `${agentKey}.verdict-done`);
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
  const found = verdictIn(text);
  const feat = feature();
  const ask = 'End your report with a final line that is exactly `VERDICT: PASS` or `VERDICT: FAIL`.';
  // The Stop after a handback is the same report: neither recorded twice nor asked for again.
  if (doneFile && fs.existsSync(doneFile)) process.exit(0);
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
  const done = agentKey && path.join(stateDir, 'agents', `${agentKey}.result`);
  if (done && fs.existsSync(done)) process.exit(0);
  const found = [...reportText(viaHandback).matchAll(/^[\s*>#]*RESULT:?[\s*]*(GREEN|RED|STUB)\b/gim)].pop();
  if (!found) {
    const ask = 'End your report with a final line that is exactly `RESULT: GREEN`, `RESULT: RED` or `RESULT: STUB`.';
    const asked = agentKey && path.join(stateDir, 'agents', `${agentKey}.result-asked`);
    // Refuse once, so the report gets its result; never twice, so the agent is never gagged.
    if (viaHandback && asked && !fs.existsSync(asked)) { writeJson(asked, {}); deny(`${ask} Add it and send the report again.`); }
    if (!viaHandback && !input.stop_hook_active) block(ask);
  }
  const result = found ? found[1].toUpperCase() : 'RED';
  if (done) writeJson(done, { result });
  // An implementer the audit gate stopped never got to work: its RED is not an attempt.
  const closed = auditSkipped() ? null : auditProblem();
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
// #240: the output of a RED that ran no expectation, or null. A missing module is not one: a RED for a
// production file not written yet is valid. A hook cannot tell a production module from a test helper.
const RED_FAULTS = [/\bSyntaxError\b/, /\bReferenceError: [\w$.]+ is not defined\b/, /\bNameError: name '[^']+' is not defined\b/];
const redFaultIn = (text) => RED_FAULTS.map((re) => text.match(re)).find(Boolean)?.[0] ?? null;

if (mode === 'ends') {
  const viaHandback = event === 'PreToolUse';
  const record = args[0] === '--record';
  const words = record ? args.slice(1) : args;
  if (!words.length || (viaHandback && input.tool_name !== 'SubagentHandback')) process.exit(0);
  const ok = agentKey && path.join(stateDir, 'agents', `${agentKey}.ends-ok`);
  if (ok && fs.existsSync(ok)) process.exit(0);
  const word = lastWord(reportText(viaHandback));
  // #240: a RED whose output is a parse or name error ran no expectation. Sent back once, as a missing word is;
  // a second report still on the error goes through and is kept in red-faults.json, never gagged.
  const fault = word === 'RED' ? redFaultIn(reportText(viaHandback)) : null;
  if (fault && agentKey) {
    const asked1 = path.join(stateDir, 'agents', `${agentKey}.red-asked`);
    if (!fs.existsSync(asked1)) {
      writeJson(asked1, {});
      const why = `Your RED reports ${fault}: the test file did not run, so none of its expectations was checked. `
        + 'Fix that error so the test runs and fails on its expectation, then send the full report.';
      if (viaHandback) deny(why);
      if (!input.stop_hook_active) block(why);
    }
  }
  // Kept once per agent and fault: the Stop after a hand-back repeats the same report.
  let faultNote = null;
  if (fault) {
    const file = path.join(stateDir, 'ends', 'red-faults.json');
    const kept = readState(file);
    const rows = Array.isArray(kept) ? kept : [];
    if (!rows.some((r) => r?.agent_id === (agentId ?? null) && r?.fault === fault)) {
      writeJson(file, [...rows, { agent_id: agentId ?? null, fault, at: new Date().toISOString() }]);
    }
    faultNote = `speckit-team: ${who} reported RED on ${fault}, which is not red for the right reason. Kept in ends/red-faults.json.`;
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
      if (ok) writeJson(ok, {});
      writeJson(endsFile(feat), { word: 'REJECTED', claimed: 'APPROVED', drift: drifted.problems, feature: feat, at, agent_id: agentId });
      emit({ systemMessage: `speckit-team: ${gk}'s APPROVED was recorded as REJECTED: ${drifted.problems.join('; ')}` });
    }
    if (ok) writeJson(ok, {});
    if (feat) writeJson(endsFile(feat), { word, feature: feat, at, agent_id: agentId });
    if (drifted?.failed) emit({ systemMessage: driftUnchecked(gk, drifted.failed) });
    if (faultNote) emit({ systemMessage: faultNote });
    process.exit(0);
  }
  const ask = `Your report must end with a final line that is exactly one of: ${words.join(', ')}. `
    + 'Finish the work first, then send the full report.';
  const asked = agentKey && path.join(stateDir, 'agents', `${agentKey}.ends-asked`);
  if (viaHandback && asked && !fs.existsSync(asked)) { writeJson(asked, {}); deny(ask); }
  if (!viaHandback && !input.stop_hook_active) block(ask);
  process.exit(0);
}

// product-owner and architect have no gate to record their start on a first tool call, so the settings.json
// entry records it here, at SubagentStart, for the lane check at their Stop (#88). Never a decision.
// The same entry starts every team agent with its session's project, if the launch named one (feature
// 007): the block goes to the agent as additionalContext. Never a decision.
if (mode === 'start') {
  const type = str(input.agent_type);
  if ((type === 'product-owner' || type === 'architect') && agentId && AGENT_ID.test(agentId) && !fs.existsSync(baseFile(agentKey))) {
    const start = startRecord();
    if (start) writeJson(baseFile(agentKey), start);
  }
  const id = str(input.session_id);
  if (!type || !id || !SESSION_ID.test(id)) process.exit(0);
  const rec = readState(projectFile(id));
  if (rec === undefined) process.exit(0);
  if (!rec || typeof rec !== 'object') emit({ systemMessage: `speckit-team: the project record ${projectFile(id)} is unreadable; ${type} starts without project context.` });
  const r = renderProject(rec.name);
  if (r.refused) emit({ systemMessage: `speckit-team: project ${rec.name} could not be given to ${type} (${r.refused}); it starts without project context.` });
  emit({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: r.block } });
}

if (mode === 'lane' && args[0] === 'role') {
  // 009: the acting role skill's Stop (contract section 6).
  const id = str(input.session_id);
  if (agentId || !id || !SESSION_ID.test(id)) process.exit(0);
  const rec = readState(roleFile(id));
  if (rec === undefined) process.exit(0);
  closeRole(rec, 'stop');
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
// truncate, shred, tee, sed -i, perl -i, dd of=, git rm, mv, restore and checkout of paths), resolved
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
const writesUnseen = (words) => {
  const w = unprefixed(words); const p = program(w[0] ?? '');
  return EVERY_ARG.has(p) || TO_DEST.has(p) || p === 'git' || (p === 'dd' && w.some((x) => x.startsWith('of=')))
    || ((p === 'sed' || p === 'perl') && w.some((x) => /^-[a-zA-Z]*i|^--in-place/.test(x)));
};
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
  for (const cmd of shellCommands(command, null, null, 0, {}, true)) {
    for (const t of cmd.writes ?? []) at(t);
    const words = unprefixed(cmd);
    if (!words.length) continue;
    const prog = program(words[0]); const a = words.slice(1);
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
    else if (prog === 'xargs' || prog === 'find') {
      const rest = prog === 'xargs' ? a.slice(a.findIndex((w) => !w.startsWith('-'))) : a.slice(a.findIndex((w) => /^-(exec|execdir|ok|okdir)$/.test(w)) + 1);
      if ((prog === 'find' && a.includes('-delete')) || ((prog === 'xargs' || a.some((w) => /^-(exec|execdir|ok|okdir)$/.test(w))) && writesUnseen(rest))) {
        found.unknown.push(`what ${prog} hands to ${rest[0] ?? 'it'}`);
      }
    } else if (prog === 'git') {
      let k = 1; let base = dir;
      while (k < words.length && words[k].startsWith('-')) {
        if (words[k] === '-C') { const d = words[k + 1]; base = d === undefined || d.includes(DYN) || base === null ? null : path.resolve(base, d); }
        k += GIT_OPTIONS_WITH_VALUE.has(words[k]) ? 2 : 1;
      }
      const sub = words[k]; const ga = words.slice(k + 1);
      if (sub === undefined) continue;
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
    writeJson(undoFile, { key, sha: start.sha, undo: undoCommand(start.sha, m), outcome, message, at: new Date().toISOString() });
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
  if (m.lines > 0 && !m.changed.some((rel) => tests.isTest(rel)) && !NO_TEST_LINE.test(reportText(viaHandback))) {
    end('stopped', `fast track stopped: ${m.lines} changed production lines and no test file changed. A change in behaviour needs a regression test, shown failing. `
      + 'If the change has no behaviour (a typo, a comment, a config value), the report says so in a line `No test: <reason>`. '
      + 'Nothing was committed; the work is uncommitted in the working tree. Write the test or add that line, then run the change again.'
      + undoSentence(start.sha, m));
  }
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
  // Every call removes the accepted record and the undo record: each stands only while the last call was an end check.
  const acceptedFile = path.join(git(root, 'rev-parse', '--absolute-git-dir'), 'speckit-team', 'patch-accepted.json');
  const undoFile = path.join(path.dirname(acceptedFile), 'patch-undo.json');
  fs.rmSync(acceptedFile, { force: true });
  fs.rmSync(undoFile, { force: true });
  const viaHandback = event === 'PreToolUse' && input.tool_name === 'SubagentHandback';
  const isEnd = viaHandback || event !== 'PreToolUse';
  const key = keyOf(agentId ?? str(input.session_id));
  if (!key) noDecision('no agent_id or session_id to keep the start record under');
  const f = patchFile(key);
  if (isEnd && !fs.existsSync(f)) process.exit(0);
  if (!fs.existsSync(f)) {
    const sha = git(root, 'rev-parse', 'HEAD');
    if (!sha) deny('Fast track: this repo has no commit to measure the change from. Commit first, or use /speckit-team.');
    const dirty = Object.fromEntries(changedSince('HEAD').map((rel) => [rel, stateOf(rel)]));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try { fs.writeFileSync(f, JSON.stringify({ sha, dirty, team: teamState(), remotes: remoteRefs(), at: new Date().toISOString() }, null, 1), { flag: 'wx' }); } catch { /* written by a parallel call */ }
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
  const bad = testsAt(start.sha).bad;
  if (bad) {
    if (isEnd) emit({ systemMessage: `speckit-team: fast-track check could not run for ${who}: ${bad} (as committed at ${start.sha.slice(0, 12)}).` });
    deny(`Fast track: the budget cannot be measured: ${bad} (as committed at ${start.sha.slice(0, 12)}). `
      + 'Report this to the user, who fixes and commits the file, then starts a new run.');
  }
  if (isEnd) endCheck(start, viaHandback, key, acceptedFile, undoFile);
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
    if (input.tool_name === 'Bash' && restoreAllowed(ti.command, start, m)) letThrough();
    deny(`Fast-track budget exceeded: ${m.lines} changed production lines in ${m.files} files (limit ${PATCH_LINES} lines, ${PATCH_FILES} files)`
      + (m.binary.length ? `; binary production files are not allowed: ${m.binary.join(', ')}` : '')
      + (m.dirtyTouched.length ? `; changed or committed although they had uncommitted changes when the run started, so the change cannot be measured: ${m.dirtyTouched.join(', ')}` : '')
      + '. Tests and docs do not count. Stop: leave the work uncommitted and report ESCALATE; the developer re-runs the change with /speckit-team.'
      + (pending ? ` First restore the protected files, naming each one (git checkout ${start.sha.slice(0, 12)} -- <file>, or rm <file> for a new file), and undo any commit (git reset --soft ${start.sha.slice(0, 12)}).` : ''));
  }
  letThrough();
}
