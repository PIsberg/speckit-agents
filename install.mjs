#!/usr/bin/env node
// Installs the Spec Kit agent team into a Claude Code config directory. See README.md.
//
//   node install.mjs                 install or update (idempotent)
//   node install.mjs --uninstall     remove everything this installer put there
//   node install.mjs --dry-run       print what would change, write nothing
//   node install.mjs --force         overwrite same-named agents it did not install (backs them up)
//   node install.mjs --claude-dir D  target D instead of $CLAUDE_CONFIG_DIR or ~/.claude
//   node install.mjs --board         also install the speckit-board mod; later reruns keep it
//   node install.mjs --no-board      remove the speckit-board mod (only if this installer installed it), keep the team
//   node install.mjs --no-fork       turn Claude Code's fork subagents off for every project, so
//                                    the team's agents run in the foreground; later reruns keep it
//   node install.mjs --fork          remove what --no-fork wrote
//
// Any other argument is refused before anything is written.
//
// What gets installed: eight subagents, three skills, one hook script, and settings.json gates
// (PreToolUse, UserPromptExpansion, and SubagentStart for the eight roles to record start and inject project context).
//
// Then, in Claude Code (slash commands you type in a session, not installer flags):
//   /speckit-team <request>                   the pipeline; it asks which roles take part
//   /speckit-team --security <request>        opts in the security agent (spec review and result review)
//   /speckit-team --project <name> <request>  runs with the standing context from .specify/projects/<name>/
//   /speckit-team --team <roles> <request>    only the roles you name, comma-separated, from product-owner,
//                                             architect, spec-auditor, test-writer, implementer, spec-gatekeeper,
//                                             security-reviewer
//   /speckit-team --team noagents <request>   no agents: the session runs Spec Kit's own commands itself
//   /speckit-patch [--project <name>] <change> the fast track for a small change
//   /speckit-triage <request>                 suggests which of them fits
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const MARKER = 'speckit-agents: managed by install.mjs';
const HOOK_FILE = 'speckit-team.mjs';
const AGENTS = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper', 'security-reviewer', 'patcher'];
// settings.json gates for the main session. Agent-scoped hooks live in each agent's frontmatter.
const SETTINGS_GATES = [
  // Claude calling the speckit-implement skill itself, and the main session launching an agent (the
  // gate records the launch's Team line there and never decides).
  { event: 'PreToolUse', matcher: 'Skill|Agent' },
  // The user typing /speckit-implement: fires neither UserPromptSubmit nor PreToolUse. The user typing
  // /speckit-team starts a request; typed with --team noagents, it records that no agent runs.
  { event: 'UserPromptExpansion', matcher: 'speckit-implement|speckit\\.implement|speckit-team' },
  // product-owner and architect have no gate to record where they started, so this does it once, as
  // each starts, for the lane check at their Stop (#88). For all eight roles it also injects the
  // session's project block as the agent's starting context, when the launch named one (007).
  { event: 'SubagentStart', matcher: AGENTS.join('|'), mode: 'start' },
];

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
if (flag('--help') || flag('-h')) {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(lines.slice(1, lines.findIndex((l) => l.startsWith('import'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const dirArg = argv.indexOf('--claude-dir');
if (dirArg >= 0 && (!argv[dirArg + 1] || argv[dirArg + 1].startsWith('--'))) {
  console.error('ERROR: --claude-dir needs a directory.');
  process.exit(1);
}
// A mistyped flag used to be ignored: `--dryrun` wrote everything and `--unistall` installed.
const FLAGS = ['--uninstall', '--dry-run', '--force', '--claude-dir', '--board', '--no-board', '--no-fork', '--fork'];
const unknown = argv.find((a, i) => !FLAGS.includes(a) && !(i === dirArg + 1 && dirArg >= 0));
if (unknown !== undefined) {
  console.error(`ERROR: unknown argument ${unknown}. node install.mjs --help lists the flags.`);
  process.exit(1);
}
const claudeDir = path.resolve(dirArg >= 0 ? argv[dirArg + 1] : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const dryRun = flag('--dry-run');
const uninstall = flag('--uninstall');
const force = flag('--force');
const boardFlag = flag('--board');
const noBoard = flag('--no-board');
if (boardFlag && noBoard) {
  console.error('ERROR: --board and --no-board contradict each other.');
  process.exit(1);
}
const forkFlag = flag('--fork');
const noFork = flag('--no-fork');
if (forkFlag && noFork) {
  console.error('ERROR: --fork and --no-fork contradict each other.');
  process.exit(1);
}

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
    { src: 'skills/speckit-triage/SKILL.md', dst: path.join(claudeDir, 'skills', 'speckit-triage', 'SKILL.md') },
    { src: 'skills/speckit-patch/SKILL.md', dst: path.join(claudeDir, 'skills', 'speckit-patch', 'SKILL.md') },
    { src: `hooks/${HOOK_FILE}`, dst: path.join(claudeDir, 'hooks', HOOK_FILE) },
  ];
}

// Parsed before anything is written, so a bad settings.json never leaves a half install behind.
const settingsFile = path.join(claudeDir, 'settings.json');
let settingsText, settings;
// Read again after a `claude plugin` command, which changes settings.json itself.
function readSettings() {
  settingsText = read(settingsFile);
  try {
    settings = settingsText === null ? {} : JSON.parse(settingsText);
  } catch (e) {
    console.error(`ERROR: ${settingsFile} is not valid JSON (${e.message}). Fix it, or add the gates by hand (README.md).`);
    process.exit(1);
  }
  // Valid JSON of the wrong shape crashed withGates after the agents were written, or, as an array,
  // dropped the gates without a word.
  const problem = settingsShapeProblem(settings);
  if (problem) {
    console.error(`ERROR: ${settingsFile} is not a settings object (${problem}). Fix it, or add the gates by hand (README.md).`);
    process.exit(1);
  }
}
function settingsShapeProblem(s) {
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v);
  const isObject = (v) => kind(v) === 'object';
  if (!isObject(s)) return `the file holds ${kind(s)}`;
  if (s.env !== undefined && !isObject(s.env)) return `"env" is ${kind(s.env)}`;
  if (s.permissions !== undefined && !isObject(s.permissions)) return `"permissions" is ${kind(s.permissions)}`;
  if (s.permissions?.allow !== undefined && !Array.isArray(s.permissions.allow)) return `"permissions.allow" is ${kind(s.permissions.allow)}, not a list`;
  if (s.hooks === undefined) return null;
  if (!isObject(s.hooks)) return `"hooks" is ${kind(s.hooks)}`;
  for (const [event, groups] of Object.entries(s.hooks)) {
    if (!Array.isArray(groups)) return `"hooks.${event}" is ${kind(groups)}, not a list`;
    if (!groups.every(isObject)) return `"hooks.${event}" holds an entry that is not an object`;
    if (!groups.every((g) => g.hooks === undefined || (Array.isArray(g.hooks) && g.hooks.every(isObject)))) {
      return `"hooks.${event}" holds an entry whose "hooks" is not a list of objects`;
    }
  }
  return null;
}
readSettings();

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
  let next = stripped;
  // The same for an empty `permissions` or `permissions.allow` the export rule was added to.
  if (original?.permissions && typeof original.permissions === 'object' && !next.permissions) next = { ...next, permissions: {} };
  if (Array.isArray(original?.permissions?.allow) && !next.permissions?.allow) next = { ...next, permissions: { ...next.permissions, allow: [] } };
  if (!original?.hooks || typeof original.hooks !== 'object') return next;
  next = { ...next, hooks: { ...(next.hooks ?? {}) } };
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
      return [{ ...g, matcher: wanted.matcher, hooks: [{ ...g.hooks.find((h) => String(h.command ?? '').includes(HOOK_FILE)), type: 'command', command: hookCommand(wanted.mode ?? 'gate'), timeout: 15 }] }];
    });
    if (!hooks[event].length) delete hooks[event];
  }
  if (addGates) {
    for (const { event, matcher, mode = 'gate' } of SETTINGS_GATES) {
      if (!(hooks[event] ?? []).some(isGate)) {
        (hooks[event] ??= []).push({ matcher, hooks: [{ type: 'command', command: hookCommand(mode), timeout: 15 }] });
      }
    }
  }
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  return next;
}

// --no-fork (#78): with Claude Code's fork subagents on, the default in an interactive session, every
// agent runs in the background and the main session spends a request that only waits on each one.
// Written only where no value is set, and removed only while it is still the "0" this wrote: a
// value the user set is theirs. JSON has no room for the marker, so the manifest records it.
const FORK_ENV = 'CLAUDE_CODE_FORK_SUBAGENT';
function withFork(current, want, added) {
  const next = JSON.parse(JSON.stringify(current));
  const env = next.env;
  if (want) {
    if (env?.[FORK_ENV] !== undefined) return { next, added };
    next.env = { ...(env ?? {}), [FORK_ENV]: '0' };
    return { next, added: true };
  }
  if (added && env?.[FORK_ENV] === '0') {
    delete env[FORK_ENV];
    if (!Object.keys(env).length) delete next.env;
  }
  return { next, added: false };
}

// #122: the line the patch hook puts before each Bash command patcher runs, which switches git's
// network transports off (#72), is allowed exactly, so the rewritten command asks for nothing the
// command itself would not, in every permission mode. Never a prefix rule: an allowed export of any
// git config could set core.fsmonitor or core.sshCommand, which run programs. Its twin is NO_NETWORK in
// the hook; test/hook-patch.test.mjs holds the two together. Written where it is missing, removed only
// if this installer wrote it: JSON has no room for the marker, so the manifest records it.
const NO_NETWORK = [['protocol.allow', 'never'], ['protocol.file.allow', 'user'],
  ...['git', 'ssh', 'http', 'https', 'ext'].map((p) => [`protocol.${p}.allow`, 'never'])];
// #123: the forge CLIs' config folders, which the line points where no stored login is; #138: their
// token variables, which it empties; #140: a folder name too long for any OS to create. Twin:
// NO_FORGE_LOGIN in the hook.
const NO_LOGIN_DIR = '.speckit-no-forge-login'.padEnd(256, '-');
const TOKEN_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN'];
const NO_FORGE_LOGIN = [['GH_CONFIG_DIR', NO_LOGIN_DIR], ['GLAB_CONFIG_DIR', NO_LOGIN_DIR], ...TOKEN_VARS.map((k) => [k, ''])];
const GIT_PAIRS = `GIT_CONFIG_COUNT=${NO_NETWORK.length} ${NO_NETWORK.map(([k, v], i) => `GIT_CONFIG_KEY_${i}=${k} GIT_CONFIG_VALUE_${i}=${v}`).join(' ')}`;
const NO_NETWORK_RULE = `Bash(export ${GIT_PAIRS} ${NO_FORGE_LOGIN.map(([k, v]) => `${k}=${v}`).join(' ')})`;
// Rules earlier versions of this installer wrote, which the hook's line no longer matches: #122's,
// #123's and #138's (the last two with the folder name #140 replaced).
const OLD_LOGIN = 'GH_CONFIG_DIR=.speckit-no-forge-login GLAB_CONFIG_DIR=.speckit-no-forge-login';
const OLD_NO_NETWORK_RULES = [`Bash(export ${GIT_PAIRS})`, `Bash(export ${GIT_PAIRS} ${OLD_LOGIN})`,
  `Bash(export ${GIT_PAIRS} ${OLD_LOGIN} ${TOKEN_VARS.map((k) => `${k}=`).join(' ')})`];
function withNoNetworkRule(current, want, added) {
  const next = JSON.parse(JSON.stringify(current));
  const had = next.permissions?.allow ?? [];
  const allow = added ? had.filter((a) => !OLD_NO_NETWORK_RULES.includes(a)) : had;
  if (allow.length !== had.length) next.permissions.allow = allow;
  if (want) {
    if (allow.includes(NO_NETWORK_RULE)) return { next, added };
    next.permissions = { ...(next.permissions ?? {}), allow: [...allow, NO_NETWORK_RULE] };
    return { next, added: true };
  }
  const left = added ? allow.filter((a) => a !== NO_NETWORK_RULE) : had;
  if (left.length !== had.length) {
    next.permissions.allow = left;
    if (!next.permissions.allow.length) delete next.permissions.allow;
    if (!Object.keys(next.permissions).length) delete next.permissions;
  }
  return { next, added: false };
}

// Whether a command is on PATH, found by its file as a shell would find it. Running `<cmd> --version`
// instead cost 548 of an install's 750 ms on Windows for `specify` alone, a Python start through uv.
function have(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const runnable = (file) => {
    try {
      if (!fs.statSync(file).isFile()) return false;
      if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch { return false; }
  };
  return (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean)
    .some((dir) => exts.some((ext) => runnable(path.join(dir.replace(/^"(.*)"$/, '$1'), cmd + ext))));
}

// The board mod is a Claude Code plugin, so Claude Code's own plugin commands install it, into the
// same config directory. This checkout is its marketplace (.claude-plugin/marketplace.json) and the
// entry a relative path, so Claude Code reads the mod from mods/speckit-board in place: a git pull
// reaches every session at its next start or /reload-plugins, with nothing to reinstall.
const BOARD = 'speckit-board@speckit-agents';
const MARKETPLACE = 'speckit-agents';
function claude(...args) {
  const opts = { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir } };
  // An npm-installed claude on Windows is claude.cmd, which only a shell runs. Quoted, a checkout
  // path with spaces stays one argument; Windows paths cannot hold a double quote.
  const r = process.platform === 'win32'
    ? spawnSync(['claude', ...args].map((a) => `"${a}"`).join(' '), { ...opts, shell: true })
    : spawnSync('claude', args, opts);
  return { ok: r.status === 0, stdout: r.stdout ?? '', said: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() || r.error?.message || `exit ${r.status}` };
}
function claudeList(...args) {
  const r = claude('plugin', ...args, 'list', '--json');
  try { return r.ok ? JSON.parse(r.stdout) : null; } catch { return null; }
}
const NO_CLAUDE = '`claude plugin` did not run. Is Claude Code on PATH?';

// Returns whether this installer added the marketplace and installed the plugin, and an error if a step
// failed. A plugin found already installed keeps pluginBefore: it is the user's unless we installed it.
function installBoard(addedBefore, pluginBefore) {
  const markets = claudeList('marketplace');
  if (!markets) return { added: addedBefore, plugin: pluginBefore, error: NO_CLAUDE };
  let added = addedBefore;
  let market = markets.find((m) => m.name === MARKETPLACE);
  // Ours but read from another checkout (this one moved, or a second clone or worktree ran
  // --board): the board follows the checkout the installer runs from, as the team's files do.
  // Real paths, so a checkout under a symlinked folder (macOS's /var) is not re-pointed every rerun.
  const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const samePath = (a, b) => process.platform === 'win32' ? realOf(a).toLowerCase() === realOf(b).toLowerCase() : realOf(a) === realOf(b);
  const repoint = Boolean(market && addedBefore && market.source === 'directory' && !samePath(market.path, SRC));
  if (repoint) {
    const r = removeBoard(true, true);
    if (r.error) return { added, plugin: pluginBefore, error: r.error };
    market = undefined;
  }
  if (!market) {
    log('install', `marketplace ${MARKETPLACE} (${SRC})`);
    if (!dryRun) {
      const r = claude('plugin', 'marketplace', 'add', SRC);
      if (!r.ok) return { added, plugin: pluginBefore, error: r.said };
    }
    added = true;
  }
  // A dry run removed nothing, so the list would still show what a real run replaces.
  const installed = !(dryRun && repoint) && (claudeList() ?? []).find((p) => p.id === BOARD && p.scope === 'user');
  if (installed) {
    log('unchanged', `${BOARD} (read from ${installed.readFromFolder ?? installed.installPath})`);
    return { added, plugin: pluginBefore };
  }
  log('install', BOARD);
  if (!dryRun) {
    const r = claude('plugin', 'install', BOARD, '--scope', 'user');
    if (!r.ok) return { added, plugin: pluginBefore, error: r.said };
  }
  return { added, plugin: true };
}

// Removes the mod when this installer installed it (pluginBefore), and the marketplace when it added it.
function removeBoard(addedBefore, pluginBefore) {
  const plugins = claudeList();
  if (!plugins) return { added: addedBefore, plugin: pluginBefore, error: NO_CLAUDE };
  if (pluginBefore && plugins.some((p) => p.id === BOARD && p.scope === 'user')) {
    log('remove', BOARD);
    if (!dryRun) {
      const r = claude('plugin', 'uninstall', BOARD, '--scope', 'user');
      if (!r.ok) return { added: addedBefore, plugin: pluginBefore, error: r.said };
    }
  }
  if (addedBefore && (claudeList('marketplace') ?? []).some((m) => m.name === MARKETPLACE)) {
    log('remove', `marketplace ${MARKETPLACE}`);
    if (!dryRun) {
      const r = claude('plugin', 'marketplace', 'remove', MARKETPLACE);
      if (!r.ok) return { added: addedBefore, plugin: pluginBefore, error: r.said };
    }
  }
  return { added: false, plugin: false };
}
const boardByHand = `remove it by hand: claude plugin uninstall ${BOARD}, then claude plugin marketplace remove ${MARKETPLACE}`;

if (uninstall) {
  const m = manifest ?? {};
  const pluginBefore = m.addedPlugin ?? Boolean(m.board);
  const hadBoard = Boolean(m.board || m.addedMarketplace);
  if (hadBoard) {
    // A warning, not a stop: removing the team must not depend on Claude Code being on PATH.
    const { error } = removeBoard(Boolean(m.addedMarketplace), pluginBefore);
    if (error) console.log(`WARNING: the board mod was not removed (${error}); ${boardByHand}.`);
    readSettings();
  }
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
    let original;
    try { original = backup === null || backup === undefined ? null : JSON.parse(backup); } catch { original = null; }
    const stripped = keepEmptyContainers(withNoNetworkRule(withFork(withGates(settings, false), false, Boolean(m.addedForkEnv)).next,
      false, Boolean(m.addedNoNetworkRule)).next, original);
    if (original?.env && !stripped.env) stripped.env = {};
    // `claude plugin uninstall` and `marketplace remove` leave these keys behind as `{}`.
    for (const key of hadBoard ? ['enabledPlugins', 'extraKnownMarketplaces'] : []) {
      const v = stripped[key];
      if (v && typeof v === 'object' && !Object.keys(v).length && original?.[key] === undefined) delete stripped[key];
    }
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
const wantFork = !forkFlag && (noFork || Boolean(manifest?.forkOff));
const fork = withFork(withGates(settings, true), wantFork, Boolean(manifest?.addedForkEnv));
const rule = withNoNetworkRule(fork.next, true, Boolean(manifest?.addedNoNetworkRule));
const nextSettings = rule.next;
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

// After the settings are written: the plugin commands add their own keys to the same file.
const wantBoard = !noBoard && (boardFlag || Boolean(manifest?.board));
const addedBefore = Boolean(manifest?.addedMarketplace);
const pluginBefore = manifest?.addedPlugin ?? Boolean(manifest?.board);
const boardResult = wantBoard ? installBoard(addedBefore, pluginBefore)
  : noBoard ? removeBoard(addedBefore, pluginBefore)
  : { added: addedBefore, plugin: pluginBefore };
write(manifestFile, `${JSON.stringify({
  managedBy: MARKER,
  createdDirs,
  createdSettings: manifest?.createdSettings ?? settingsText === null,
  settingsBackup,
  forceBackups,
  // The intent, kept when a step failed, so the next rerun tries again.
  board: wantBoard,
  addedMarketplace: boardResult.added,
  addedPlugin: boardResult.plugin,
  forkOff: wantFork,
  addedForkEnv: fork.added,
  addedNoNetworkRule: rule.added,
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
  ['specify', 'per repo: uv tool install specify-cli --from git+https://github.com/github/spec-kit.git; uv itself: README.md, Requirements']]
  .filter(([cmd]) => !have(cmd));
for (const [cmd, why] of missing) console.log(`WARNING: \`${cmd}\` not found on PATH (${why}).`);

if (boardResult.error) {
  console.error(`\nERROR: the team is installed, the board mod is not ${noBoard ? 'removed' : 'installed'}:\n${boardResult.error}`);
  console.error(noBoard ? `Rerun with --no-board, or ${boardByHand}.` : 'Rerun the installer once that is fixed; it remembers the board.');
  process.exit(1);
}

console.log(`
Done. Next:
  1. Restart Claude Code (agents load at session start).
  2. In a repo: specify init --here --integration claude (/speckit-team drafts the constitution with you).
  3. Run a feature: /speckit-team <feature idea>    or one phase: @agent-architect ...
     With no agents, Spec Kit's own commands in one session: /speckit-team --team noagents <feature idea>
  4. A small change: /speckit-patch <change>
  Not sure which track: /speckit-triage <request>`);
if (wantBoard) console.log(`  The board: /speckit-board in a session. ${boardResult.added
  ? 'After a git pull here, /reload-plugins picks up its changes.'
  : `Update it with: claude plugin marketplace update ${MARKETPLACE}`}`);
