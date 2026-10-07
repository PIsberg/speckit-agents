#!/usr/bin/env node
// Installs the Spec Kit agent team into a Claude Code config directory. See README.md.
//
//   node install.mjs                 install or update (idempotent)
//   node install.mjs --uninstall     remove everything this installer put there
//   node install.mjs --dry-run       print what would change, write nothing
//   node install.mjs --force         overwrite same-named agents it did not install (backs them up)
//   node install.mjs --claude-dir D  target D instead of $CLAUDE_CONFIG_DIR or ~/.claude
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const MARKER = 'speckit-agents: managed by install.mjs';
const HOOK_FILE = 'speckit-team.mjs';
const AGENTS = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'];
// settings.json gates for the main session. Agent-scoped hooks live in each agent's frontmatter.
const SETTINGS_GATES = [
  // Claude calling the speckit-implement skill itself.
  { event: 'PreToolUse', matcher: 'Skill' },
  // The user typing /speckit-implement: fires neither UserPromptSubmit nor PreToolUse.
  { event: 'UserPromptExpansion', matcher: 'speckit-implement|speckit\\.implement' },
];

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const dirArg = argv.indexOf('--claude-dir');
if (dirArg >= 0 && !argv[dirArg + 1]) {
  console.error('ERROR: --claude-dir needs a directory.');
  process.exit(1);
}
const claudeDir = path.resolve(dirArg >= 0 ? argv[dirArg + 1] : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const dryRun = flag('--dry-run');
const uninstall = flag('--uninstall');
const force = flag('--force');

// Hooks run in Git Bash or PowerShell on Windows and sh elsewhere. A quoted absolute path with forward
// slashes works in all three. $HOME does not: Git Bash expands it to /c/Users/..., which node.exe
// resolves to C:\c\Users\..., the hook crashes, and a crashed hook fails open without a word.
const hookPath = path.join(claudeDir, 'hooks', HOOK_FILE).split(path.sep).join('/');
const hookCommand = (mode) => `node "${hookPath}" ${mode}`;
const log = (verb, what) => console.log(`${dryRun ? '[dry-run] ' : ''}${verb.padEnd(10)} ${what}`);
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const ours = (f) => (read(f) ?? '').includes(MARKER);

function write(file, content) {
  const old = read(file);
  if (old === content) return log('unchanged', file);
  log(old === null ? 'install' : 'update', file);
  if (dryRun) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function remove(file) {
  if (!fs.existsSync(file)) return;
  log('remove', file);
  if (!dryRun) fs.rmSync(file, { recursive: true, force: true });
}

function files() {
  return [
    ...AGENTS.map((a) => ({ src: `agents/${a}.md`, dst: path.join(claudeDir, 'agents', `${a}.md`) })),
    { src: 'skills/speckit-team/SKILL.md', dst: path.join(claudeDir, 'skills', 'speckit-team', 'SKILL.md') },
    { src: `hooks/${HOOK_FILE}`, dst: path.join(claudeDir, 'hooks', HOOK_FILE) },
  ];
}

// Parsed before anything is written, so a bad settings.json never leaves a half install behind.
const settingsFile = path.join(claudeDir, 'settings.json');
const settingsText = read(settingsFile);
let settings;
try {
  settings = settingsText === null ? {} : JSON.parse(settingsText);
} catch (e) {
  console.error(`ERROR: ${settingsFile} is not valid JSON (${e.message}). Fix it, or add the gates by hand (README.md).`);
  process.exit(1);
}

// What this installer created, so uninstall can remove exactly that and nothing else. It carries
// the ownership marker like every other file the installer writes.
const manifestFile = path.join(claudeDir, 'hooks', 'speckit-agents.install.json');
const BACKUP = '.bak-speckit-agents';
const manifest = (() => {
  const text = read(manifestFile);
  if (text === null || !text.includes(MARKER)) return null;
  try { return JSON.parse(text); } catch { return null; }
})();
const rel = (f) => path.relative(claudeDir, f).split(path.sep).join('/');
const abs = (r) => path.join(claudeDir, r);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Removing the gates can leave `hooks` or an event list empty, and those are pruned. A user's own
// empty `"hooks": {}` or `"PreToolUse": []` is not ours to remove: it is put back from the original.
function keepEmptyContainers(stripped, original) {
  if (!original?.hooks || typeof original.hooks !== 'object') return stripped;
  const next = { ...stripped, hooks: { ...(stripped.hooks ?? {}) } };
  for (const [event, groups] of Object.entries(original.hooks)) {
    if (Array.isArray(groups) && !groups.length && !next.hooks[event]) next.hooks[event] = [];
  }
  return next;
}

// Keep the file's own formatting: indentation, line endings, trailing newline. A file on one line
// stays on one line.
function styleOf(text) {
  if (text === null) return { indent: 2, eol: '\n', trailing: true };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? (text.trim().includes('\n') ? 2 : 0);
  return { indent, eol, trailing: /\r?\n$/.test(text) };
}
function serialize(obj, { indent, eol, trailing }) {
  const json = JSON.stringify(obj, null, indent).replace(/\n/g, eol);
  return trailing ? json + eol : json;
}

const isGate = (g) => (g.hooks ?? []).some((h) => String(h.command ?? '').includes(HOOK_FILE));
// Gate entries are updated where they stand: re-appending them would make every rerun after another
// tool re-sorts settings.json a change.
function withGates(current, addGates) {
  const next = JSON.parse(JSON.stringify(current));
  const hooks = next.hooks ?? {};
  for (const event of Object.keys(hooks)) {
    const wanted = addGates && SETTINGS_GATES.find((g) => g.event === event);
    let placed = false;
    hooks[event] = hooks[event].flatMap((g) => {
      if (!isGate(g)) return [g];
      if (!wanted || placed) return [];
      placed = true;
      return [{ ...g, matcher: wanted.matcher, hooks: [{ ...g.hooks.find((h) => String(h.command ?? '').includes(HOOK_FILE)), type: 'command', command: hookCommand('gate'), timeout: 15 }] }];
    });
    if (!hooks[event].length) delete hooks[event];
  }
  if (addGates) {
    for (const { event, matcher } of SETTINGS_GATES) {
      if (!(hooks[event] ?? []).some(isGate)) {
        (hooks[event] ??= []).push({ matcher, hooks: [{ type: 'command', command: hookCommand('gate'), timeout: 15 }] });
      }
    }
  }
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  return next;
}

function have(cmd) {
  return spawnSync(`${cmd} --version`, { encoding: 'utf8', shell: true, stdio: 'ignore' }).status === 0;
}

if (uninstall) {
  const m = manifest ?? {};
  for (const { dst } of files()) {
    if (!fs.existsSync(dst)) continue;
    if (!ours(dst)) { log('keep', `${dst} (not installed by speckit-agents)`); continue; }
    remove(dst.endsWith('SKILL.md') ? path.dirname(dst) : dst);
  }
  // Put back what --force replaced.
  for (const { path: p, backup } of m.forceBackups ?? []) {
    if (!fs.existsSync(abs(backup)) || (fs.existsSync(abs(p)) && !ours(abs(p)))) continue;
    log('restore', abs(p));
    if (!dryRun) fs.renameSync(abs(backup), abs(p));
  }
  // Settings: the original bytes when nothing else changed them since install; otherwise the current
  // settings without the gates, in the file's own format. Never a backup at uninstall.
  if (settingsText !== null) {
    const backup = m.settingsBackup && read(abs(m.settingsBackup));
    let original = null;
    try { original = backup === null || backup === undefined ? null : JSON.parse(backup); } catch { original = null; }
    const stripped = keepEmptyContainers(withGates(settings, false), original);
    if (original !== null && same(original, stripped)) {
      if (backup === settingsText) log('unchanged', settingsFile); else write(settingsFile, backup);
    } else if (m.createdSettings && same(stripped, {})) {
      remove(settingsFile);
    } else if (!same(stripped, settings)) {
      write(settingsFile, serialize(stripped, styleOf(settingsText)));
    }
    if (m.settingsBackup) remove(abs(m.settingsBackup));
  }
  remove(manifestFile);
  // Only directories this installer created, and only once empty.
  for (const d of m.createdDirs ?? []) {
    try {
      if (fs.readdirSync(abs(d)).length) { log('keep', `${abs(d)} (not empty)`); continue; }
      log('remove', abs(d));
      if (!dryRun) fs.rmdirSync(abs(d));
    } catch { /* already gone */ }
  }
  console.log('\nUninstalled. Per-repo audit state stays in each repo\'s .git/speckit-team/ (safe to delete).');
  process.exit(0);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`ERROR: Node ${process.versions.node} found; the hooks need Node 18 or newer.`);
  process.exit(1);
}

const collisions = [...files().map(({ dst }) => dst), manifestFile].filter((dst) => fs.existsSync(dst) && !ours(dst));
if (collisions.length && !force) {
  console.error('ERROR: these files exist and were not installed by speckit-agents:');
  for (const dst of collisions) console.error(`  ${dst}`);
  console.error(`Rename your own agents, or rerun with --force to back them up (*${BACKUP}) and replace them.`);
  process.exit(1);
}

console.log(`Installing the Spec Kit agent team into ${claudeDir}\n`);
// Recorded before anything is written: which of these directories this install creates.
const createdDirs = [...new Set([...(manifest?.createdDirs ?? []),
  ...['agents', 'hooks', 'skills'].filter((d) => !fs.existsSync(abs(d)))])];
const forceBackups = [...(manifest?.forceBackups ?? [])];
for (const { src, dst } of files()) {
  if (collisions.includes(dst)) {
    log('backup', `${dst} -> ${path.basename(dst)}${BACKUP}`);
    if (!dryRun) fs.copyFileSync(dst, `${dst}${BACKUP}`);
    forceBackups.push({ path: rel(dst), backup: rel(`${dst}${BACKUP}`) });
  }
  write(dst, fs.readFileSync(path.join(SRC, src), 'utf8').replaceAll('{{HOOK}}', hookPath));
}

// One backup of the user's own settings, taken the first time this installer changes them, kept
// under a fixed name and removed again on uninstall.
const nextSettings = withGates(settings, true);
let settingsBackup = manifest?.settingsBackup ?? null;
if (same(nextSettings, settings) && settingsText !== null) {
  log('unchanged', settingsFile);
} else {
  if (settingsText !== null && !settingsBackup) {
    settingsBackup = `settings.json${BACKUP}`;
    log('backup', `${settingsFile} -> ${settingsBackup}`);
    if (!dryRun) fs.writeFileSync(abs(settingsBackup), settingsText);
  }
  write(settingsFile, serialize(nextSettings, styleOf(settingsText)));
}
write(manifestFile, `${JSON.stringify({
  managedBy: MARKER,
  createdDirs,
  createdSettings: manifest?.createdSettings ?? settingsText === null,
  settingsBackup,
  forceBackups,
}, null, 2)}\n`);

if (!dryRun) {
  // Run the installed hook the way Claude Code will. Outside a Spec Kit repo it must exit 0 silently.
  const smoke = spawnSync('node', [hookPath, 'gate'], { input: '{}', encoding: 'utf8', cwd: os.tmpdir(), shell: false });
  if (smoke.status !== 0) {
    console.error(`\nERROR: the installed hook does not run: ${smoke.error?.message ?? smoke.stderr}`);
    console.error('Every guardrail fails open until this is fixed. Is `node` on the PATH Claude Code sees?');
    process.exit(1);
  }
  log('verified', 'installed hook runs');
}

const missing = [['git', 'required by every hook'], ['claude', 'Claude Code itself'],
  ['specify', 'per repo: uv tool install specify-cli --from git+https://github.com/github/spec-kit.git']]
  .filter(([cmd]) => !have(cmd));
for (const [cmd, why] of missing) console.log(`WARNING: \`${cmd}\` not found on PATH (${why}).`);

console.log(`
Done. Next:
  1. Restart Claude Code (agents load at session start).
  2. In a repo: specify init --here --ai claude, then fill in /speckit-constitution.
  3. Run a feature: /speckit-team <feature idea>    or one phase: @agent-architect ...`);
