// Run: npm test (or node --test "test/*.test.mjs")
// End to end, tier 1: the real Claude Code, the team installed by install.mjs into a throwaway
// config dir, and a fake Anthropic API on localhost instead of a model. Unit tests feed the hook
// JSON by hand, so they cannot show that Claude Code fires it; these do, at no cost and with no login.
// The fake API answers every model request with an error and the session is stopped at the first
// one, so a guardrail that holds shows as zero model requests and one that lets through as at least
// one. Agent guardrails, which fire only after a model asks for a tool, are #45; a full pipeline
// run with real models is #46.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Spawned without a shell, as in install.test.mjs: a missing claude, or an npm-installed claude.cmd,
// reports these skipped, not passed, except in CI, where SPECKIT_REQUIRE_CLAUDE=1 makes them fail.
const noClaude = spawnSync('claude', ['--version']).status === 0 || process.env.SPECKIT_REQUIRE_CLAUDE === '1' ? false : 'no claude executable on PATH';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'ignore' });

// A Spec Kit repo as far as the gate can tell: an active feature, its four fingerprinted files, and
// a speckit-implement skill for the typed command to expand. The team goes into its own config dir.
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-'));
  const repo = path.join(tmp, 'repo');
  const cfg = path.join(tmp, 'config');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/001-x' }));
  write('.specify/memory/constitution.md', '# Constitution\n');
  write('specs/001-x/spec.md', '# Spec\n');
  write('specs/001-x/plan.md', '# Plan\n');
  write('specs/001-x/tasks.md', '- [ ] T001 a\n');
  write('.claude/skills/speckit-implement/SKILL.md', '---\nname: speckit-implement\ndescription: Implement the tasks.\n---\nReply with the word implementing.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  execFileSync(process.execPath, [path.join(ROOT, 'install.mjs'), '--claude-dir', cfg], { stdio: 'ignore' });
  return { repo, cfg, hook: path.join(cfg, 'hooks', 'speckit-team.mjs'), write };
}

// Records a PASS for the files as they are now, through the installed verdict hook itself.
function recordPass({ repo, hook }) {
  execFileSync(process.execPath, [hook, 'verdict'], {
    cwd: repo,
    input: JSON.stringify({ hook_event_name: 'SubagentStop', cwd: repo, agent_id: 'e2e', last_assistant_message: 'No findings.\nVERDICT: PASS' }),
  });
}

// Runs `claude -p <prompt>` against a fake API and returns its exit code, its JSON result (if it
// finished on its own) and how many model requests reached the fake API.
async function claude({ repo, cfg }, prompt) {
  let modelRequests = 0;
  let child;
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
      modelRequests++;
      // The question is answered: the prompt got past the gate. Stop rather than sit out retries.
      child?.kill();
    }
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fake API for speckit-agents e2e tests' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: cfg,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_API_KEY: 'sk-ant-e2e-fake',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
  };
  // Any other credential could send the request somewhere real.
  for (const k of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[k];
  try {
    return await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      child = spawn('claude', ['-p', prompt, '--output-format', 'json'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        let result = null;
        try { result = JSON.parse(out); } catch { /* killed, or not JSON */ }
        resolve({ code, result, modelRequests, out, err });
      });
    });
  } finally {
    server.close();
  }
}

const show = (r) => `exit ${r.code}, ${r.modelRequests} model requests\nstdout: ${r.out.slice(0, 1500)}\nstderr: ${r.err.slice(0, 800)}`;

function assertBlocked(r, reason) {
  assert.equal(r.modelRequests, 0, `the prompt reached the model:\n${show(r)}`);
  assert.equal(r.result?.num_turns, 0, show(r));
  assert.equal(r.result?.total_cost_usd, 0, show(r));
  assert.match(r.out, reason, show(r));
}

test('a typed /speckit-implement is stopped before any model call until spec-auditor has passed', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  assertBlocked(await claude(s, '/speckit-implement'), /spec-auditor has not passed specs\/001-x/);
});

test('with a PASS on the current files, /speckit-implement goes through to the model', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  const r = await claude(s, '/speckit-implement');
  // Without this case, a fake API Claude Code never called would pass the test above too.
  assert.ok(r.modelRequests >= 1, `the gate blocked a passed audit:\n${show(r)}`);
});

test('an edit to spec.md after the PASS stops /speckit-implement again', { skip: noClaude, timeout: 120_000 }, async () => {
  const s = setup();
  recordPass(s);
  s.write('specs/001-x/spec.md', '# Spec\n\nFR-001 changed after the audit.\n');
  assertBlocked(await claude(s, '/speckit-implement'), /changed after the audit of specs\/001-x/);
});
