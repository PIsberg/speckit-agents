#!/usr/bin/env node
// The board mod's interactive checks, specs/004-board-clear/quickstart.md L3 to L6, in a real Claude
// Code TUI at no cost. vhs types the keys into an interactive session, 140 columns wide, that talks to
// a fake Anthropic API on localhost: a scripted model that launches spec-auditors, which report PASS
// at once. The session runs in a throwaway Spec Kit repo, with the team installed into a throwaway
// config dir and the mod loaded with --plugin-dir from this checkout. vhs writes its frames as text,
// no GIF, and the checks are read off them.
//
// Usage: node tools/live-board.mjs [band|pane] [work dir]
//   band (the default): L4 presses the band's [ clear ]: ctrl+x tab gives the band the keyboard, Tab
//     twice moves its ring to [ clear ], Enter presses it.
//   pane: L4 presses the pane's [ clear ] by its hotkey c. ctrl+x tab gives an open pane the keyboard
//     only while the band has no buttons, so the band is hidden first (ctrl+x ctrl+a). Claude Code
//     ignores that chord while the cleared band draws nothing, so the band stays hidden and L5 is
//     not checked.
// Needs vhs (with ttyd), git and claude on PATH; vhs runs pwsh on Windows. Exits 1 if a check fails.
// Written against Claude Code 2.1.296 and vhs 0.11.0.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLUMNS = 140;
// The prompt L5 types 4 s after starting the third agent; the screen that shows it must show the band.
const MARK = 'fourseconds';
const BAND = /\[ board \] \[ clear \] \[ hide \]/;
const PANE_CLEAR = /\[ clear \] \[ close \]/;
const TOAST = /cleared 2 agent rows and the band\./;
const CLEARED_PANE = /cleared; no team agent has run since/;
const ROW = /spec-auditor\s+(running|PASS)/;
const STATUS = /^\s*(⚠ speckit-board: .*?)\s*$/m;

// vhs's text output: one screen after each command of the tape, between lines of 80 box rules (the
// TUI's own rules span the terminal, so they are longer).
export const screens = (text) => text.split(/^─{80}$/m);
// The terminal's width: Claude Code's rules span it, as does a wrapped line.
export const widest = (text) => Math.max(0, ...text.split(/\r?\n/).map((l) => [...l].length));

// The checks, read off the screens and the two hash files L6 writes from Claude Code's own shell.
export function verdicts(text, { before, after, variant = 'band' }) {
  const all = screens(text);
  const width = widest(text);
  const opened = all.findIndex((s) => /pane opened/.test(s));
  const cleared = all.findIndex((s) => TOAST.test(s));
  const asked = all.findIndex((s, i) => i > cleared && cleared >= 0 && /❯ board one more/.test(s));
  const marked = all.findIndex((s, i) => i > asked && asked >= 0 && s.includes(MARK));
  const between = cleared >= 0 && asked > cleared ? all.slice(cleared, asked) : [];
  const status = (s) => STATUS.exec(s ?? '')?.[1];
  const results = [
    {
      id: 'L3', name: `at ${COLUMNS} columns the pane shows [ clear ] and the band [ board ] [ clear ] [ hide ]`,
      ok: width === COLUMNS && opened >= 0 && all.slice(opened).some((s) => BAND.test(s) && PANE_CLEAR.test(s)),
      note: `${width} columns`,
    },
    {
      id: 'L4', name: variant === 'band'
        ? "pressing the band's [ clear ] toasts, empties the pane's agent rows, removes the band, keeps the status line"
        : "pressing the pane's [ clear ] toasts, empties the pane's agent rows, keeps the status line (the band was hidden first)",
      ok: cleared >= 0 && CLEARED_PANE.test(all[cleared]) && between.length > 0 && between.every((s) => !BAND.test(s))
        && Boolean(status(all[cleared - 1])) && status(all[cleared - 1]) === status(all[cleared]),
      note: cleared < 0 ? 'no clear toast' : `status line: ${status(all[cleared]) ?? 'none'}`,
    },
    variant === 'band'
      ? {
        id: 'L5', name: 'one more team agent brings its row and the band back within 4 s',
        ok: asked >= 0 && marked > asked && all.slice(asked, marked + 1).some((s) => BAND.test(s) && ROW.test(s)),
        note: marked < 0 ? 'the third agent never got its turn' : '',
      }
      : { id: 'L5', name: 'not checked: the band stays hidden in the pane variant', ok: true, skipped: true, note: '' },
    {
      id: 'L6', name: 'the state files, spec, plan, tasks and feature.json are byte for byte the same before and after',
      ok: Boolean(before?.trim()) && before === after,
      note: `${before?.trim() ? before.trim().split('\n').length : 0} files hashed`,
    },
  ];
  return results;
}

// A throwaway Spec Kit repo as far as the board can tell, the team installed beside it.
function setup(work) {
  const repo = path.join(work, 'repo');
  const cfg = path.join(work, 'config');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(cfg, { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...a], { cwd: repo, stdio: 'ignore' });
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
  git('init', '-q', '-b', '001-greet');
  write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/001-greet' }));
  write('.specify/memory/constitution.md', '# Constitution\n');
  write('specs/001-greet/spec.md', '# Feature: greet\n\n- FR-001: greet(name) returns "Hello, name".\n');
  write('specs/001-greet/plan.md', '# Plan: greet\n');
  write('specs/001-greet/tasks.md', '# Tasks: greet\n\n## Phase 1: Setup\n\n- [X] T001 Create src/greet.js\n\n## Phase 2: User Story 1\n\n- [ ] T002 [US1] Test greet in test/greet.test.js\n- [ ] T003 [US1] Implement greet in src/greet.js\n');
  git('add', '-A');
  git('commit', '-qm', 'spec, plan and tasks');
  execFileSync(process.execPath, [path.join(ROOT, 'install.mjs'), '--claude-dir', cfg], { stdio: 'ignore' });
  return { repo, cfg };
}

// Built at run time so that no tool mistakes the fake key for a real one.
const KEY = ['sk', 'ant', 'fake', 'live', 'board', '0123456789abcdef'].join('-');

// No onboarding, the fake key approved and the repo trusted, so nothing waits for a person.
function seed(cfg, repo) {
  const project = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
  fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({
    hasCompletedOnboarding: true,
    customApiKeyResponses: { approved: [KEY.slice(-20)], rejected: [] },
    projects: { [repo]: project, [repo.replaceAll('\\', '/')]: project },
  }, null, 2));
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '');
const auditor = (marker) => ({ name: 'Agent', input: { description: `Audit ${marker.split(' ').at(-1)}`, subagent_type: 'spec-auditor', prompt: `${marker}: go`, run_in_background: false } });

// The scripted model. An agent is told apart by the marker in its first message, the main session by
// its last user message: an interactive request ends with a system-role message after it, and a typed
// prompt can share its message with a `!` command's result, so the prompt is looked for first.
function answer(b) {
  if (!Array.isArray(b.tools) || b.tools.length === 0) return { text: 'ok' };
  const msgs = b.messages ?? [];
  if (/board auditor (one|two|three)/.test(textOf(msgs.find((m) => m.role === 'user')?.content))) return { text: 'No findings.\nVERDICT: PASS' };
  const said = textOf(msgs.findLast((m) => m.role === 'user')?.content);
  if (said.includes('board run two auditors')) return [auditor('board auditor one'), auditor('board auditor two')];
  if (said.includes('board one more')) return [auditor('board auditor three')];
  return { text: 'ok' };
}

function fakeApi() {
  let ids = 0;
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404); res.end('{}'); return; }
      let b = {};
      try { b = JSON.parse(body); } catch { /* answered as a side request */ }
      const step = answer(b);
      const blocks = (Array.isArray(step) ? step : [step]).map((s, i) => (s.name ? { type: 'tool_use', id: `toolu_live_${++ids}_${i}`, name: s.name, input: s.input } : { type: 'text', text: s.text }));
      const stop = blocks.some((x) => x.type === 'tool_use') ? 'tool_use' : 'end_turn';
      const message = { id: `msg_live_${ids}`, type: 'message', role: 'assistant', model: 'claude-fake', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      if (!b.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...message, content: blocks, stop_reason: stop })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event('message_start', { message: { ...message, content: [], stop_reason: null } });
      blocks.forEach((x, index) => {
        const tool = x.type === 'tool_use';
        event('content_block_start', { index, content_block: tool ? { ...x, input: {} } : { type: 'text', text: '' } });
        event('content_block_delta', { index, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(x.input) } : { type: 'text_delta', text: x.text } });
        event('content_block_stop', { index });
      });
      event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
      event('message_stop', {});
      res.end();
    });
  });
}

// vhs on Windows resolves `bash` to WSL, which has neither the environment nor claude; pwsh has both.
const SHELL = process.platform === 'win32' ? 'pwsh' : 'bash';

// Spawned, not spawnSync: the fake API answers from this process while vhs runs.
function vhs(tapeFile, work, env) {
  return new Promise((resolve) => {
    const child = spawn('vhs', [tapeFile], { cwd: work, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ code: 1, err: e.message }));
    child.on('close', (code) => resolve({ code, err }));
  });
}

// The font vhs finds differs by OS, and with it the pixels a column takes. A probe types a line longer
// than the terminal, so its first row is as wide as the terminal; a few probes find the width in
// pixels that gives COLUMNS columns. 1692 pixels gave 140 on Windows 11.
export async function widthFor(work, env, start = 1692) {
  let width = start;
  for (let probe = 1; probe <= 4; probe++) {
    const out = path.join(work, `probe-${probe}.txt`);
    const file = path.join(work, `probe-${probe}.tape`);
    fs.writeFileSync(file, [`Output "${out}"`, `Set Shell ${SHELL}`, 'Set FontSize 16', `Set Width ${width}`, 'Set Height 300',
      'Set TypingSpeed 1ms', `Type "${'x'.repeat(COLUMNS * 2)}"`, 'Sleep 1s'].join('\n'));
    const { code, err } = await vhs(file, work, env);
    if (code !== 0) throw new Error(`the width probe failed: vhs exited ${code}\n${err.slice(-1500)}`);
    const columns = widest(fs.readFileSync(out, 'utf8'));
    if (columns === COLUMNS) return width;
    width = Math.round(width * (COLUMNS + 0.5) / columns);
  }
  return width;
}

// The keys. L6 hashes the same files before and after the clear from Claude Code's own `!` shell.
function tape({ work, repo, variant, width }) {
  const hashes = (file) => `!git hash-object .git/speckit-team/*/*.json specs/*/spec.md specs/*/plan.md specs/*/tasks.md .specify/feature.json > '${path.join(work, file).replaceAll('\\', '/')}'`;
  const press = variant === 'band'
    ? ['Ctrl+X', 'Sleep 400ms', 'Tab', 'Sleep 800ms', 'Tab', 'Sleep 800ms', 'Enter', 'Sleep 3s', 'Escape', 'Sleep 1s']
    : ['Ctrl+X', 'Sleep 400ms', 'Ctrl+A', 'Sleep 1500ms', 'Ctrl+X', 'Sleep 400ms', 'Tab', 'Sleep 1s', 'Type "c"', 'Sleep 3s',
      'Escape', 'Sleep 1s', 'Ctrl+X', 'Sleep 400ms', 'Ctrl+A', 'Sleep 2s'];
  return [
    `Output "${path.join(work, 'frames.txt')}"`,
    `Set Shell ${SHELL}`,
    // The width widthFor found for 140 columns; L3 checks the width the screens show.
    'Set FontSize 16', `Set Width ${width}`, 'Set Height 900', 'Set TypingSpeed 10ms',
    `Type "cd '${repo}'; claude --plugin-dir '${path.join(ROOT, 'mods', 'speckit-board')}' --permission-mode default"`,
    'Enter', 'Sleep 12s',
    'Type "/speckit-board"', 'Sleep 500ms', 'Enter', 'Sleep 4s',
    'Type "board run two auditors"', 'Sleep 300ms', 'Enter', 'Sleep 15s',
    `Type "${hashes('before.sha')}"`, 'Sleep 300ms', 'Enter', 'Sleep 4s',
    ...press,
    `Type "${hashes('after.sha')}"`, 'Sleep 300ms', 'Enter', 'Sleep 4s',
    'Type "board one more"', 'Sleep 300ms', 'Enter', 'Sleep 4s', `Type "${MARK}"`, 'Sleep 300ms', 'Ctrl+U',
    'Sleep 4s',
  ].join('\n');
}

async function main() {
  const variant = process.argv[2] ?? 'band';
  if (!['band', 'pane'].includes(variant)) { console.error('usage: node tools/live-board.mjs [band|pane] [work dir]'); process.exit(2); }
  const work = process.argv[3] ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-live-board-'));
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const { repo, cfg } = setup(work);
  seed(cfg, repo);
  const server = fakeApi();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC_|AI_AGENT$)/.test(k))),
    CLAUDE_CONFIG_DIR: cfg, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_API_KEY: KEY,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
    // Foreground agents, and fullscreen, where the pane docks beside the transcript.
    CLAUDE_CODE_FORK_SUBAGENT: '0', CLAUDE_CODE_NO_FLICKER: '1',
  };
  const width = await widthFor(work, env);
  fs.writeFileSync(path.join(work, 'live.tape'), `${tape({ work, repo, variant, width })}\n`);
  const { code, err } = await vhs(path.join(work, 'live.tape'), work, env);
  server.close();
  if (code !== 0) { console.error(`${err.slice(-2000)}\nvhs exited ${code}; the files are in ${work}`); process.exit(1); }
  const read = (f) => (fs.existsSync(path.join(work, f)) ? fs.readFileSync(path.join(work, f), 'utf8') : '');
  const results = verdicts(read('frames.txt'), { before: read('before.sha'), after: read('after.sha'), variant });
  const version = /Claude Code v([\d.]+)/.exec(read('frames.txt'))?.[1] ?? 'unknown';
  console.log(`Claude Code ${version}, ${variant} variant, ${width} pixels wide, screens and hashes in ${work}`);
  for (const r of results) console.log(`${r.skipped ? '-' : r.ok ? '✓' : '✗'} ${r.id} ${r.name}${r.note ? ` (${r.note})` : ''}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
