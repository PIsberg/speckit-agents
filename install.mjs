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
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
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

function updateSettings(addGates) {
  const file = settingsFile;
  const text = settingsText;
  const hooks = settings.hooks ?? {};
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event].filter((g) => !(g.hooks ?? []).some((h) => String(h.command ?? '').includes(HOOK_FILE)));
    if (!hooks[event].length) delete hooks[event];
  }
  if (addGates) {
    for (const { event, matcher } of SETTINGS_GATES) {
      (hooks[event] ??= []).push({ matcher, hooks: [{ type: 'command', command: hookCommand('gate'), timeout: 15 }] });
    }
  }
  if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;
  const next = `${JSON.stringify(settings, null, 2)}\n`;
  if (text !== null && JSON.stringify(JSON.parse(text)) === JSON.stringify(settings)) return log('unchanged', file);
  if (text !== null && !dryRun) fs.copyFileSync(file, `${file}.bak-speckit-agents-${stamp}`);
  write(file, next);
}

function have(cmd) {
  return spawnSync(`${cmd} --version`, { encoding: 'utf8', shell: true, stdio: 'ignore' }).status === 0;
}

if (uninstall) {
  for (const { dst } of files()) {
    if (!fs.existsSync(dst)) continue;
    if (!ours(dst)) { log('keep', `${dst} (not installed by speckit-agents)`); continue; }
    remove(dst.endsWith('SKILL.md') ? path.dirname(dst) : dst);
  }
  updateSettings(false);
  console.log('\nUninstalled. Per-repo audit state stays in each repo\'s .git/speckit-team/ (safe to delete).');
  process.exit(0);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`ERROR: Node ${process.versions.node} found; the hooks need Node 18 or newer.`);
  process.exit(1);
}

const collisions = files().filter(({ dst }) => fs.existsSync(dst) && !ours(dst));
if (collisions.length && !force) {
  console.error('ERROR: these files exist and were not installed by speckit-agents:');
  for (const { dst } of collisions) console.error(`  ${dst}`);
  console.error('Rename your own agents, or rerun with --force to back them up (.bak-speckit-agents-<time>) and replace them.');
  process.exit(1);
}

console.log(`Installing the Spec Kit agent team into ${claudeDir}\n`);
for (const { src, dst } of files()) {
  if (collisions.some((c) => c.dst === dst)) {
    log('backup', `${dst} -> ${path.basename(dst)}.bak-speckit-agents-${stamp}`);
    if (!dryRun) fs.copyFileSync(dst, `${dst}.bak-speckit-agents-${stamp}`);
  }
  write(dst, fs.readFileSync(path.join(SRC, src), 'utf8').replaceAll('{{HOOK}}', hookPath));
}
updateSettings(true);

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
