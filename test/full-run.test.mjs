// Run: npm test (or node --test "test/*.test.mjs")
// tools/full-run.mjs drives a whole /speckit-team run with real models for the full-run workflow
// (#46). No test here calls a model: they build the scratch repo, judge synthetic run states, and
// read the workflow, so what CI pays for is checked by what it would check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer, buildRepo, checkRun, newMarker } from '../tools/full-run.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

test('full run: the scratch repo is a committed Spec Kit repo with the fixture, whose own tests pass (#46)', () => {
  const repo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skfull-')), 'repo');
  const { request } = buildRepo(repo);
  for (const f of ['.specify/templates/spec-template.md', '.specify/templates/tasks-template.md', '.specify/init-options.json',
    '.claude/skills/speckit-specify/SKILL.md', '.claude/skills/speckit-plan/SKILL.md', '.claude/skills/speckit-tasks/SKILL.md',
    '.specify/memory/constitution.md', 'CLAUDE.md', 'package.json']) {
    assert.ok(fs.existsSync(path.join(repo, f)), `${f} is in the scratch repo`);
  }
  assert.ok(!fs.existsSync(path.join(repo, '.specify', 'feature.json')), 'no feature is active at the start');
  assert.ok(!fs.existsSync(path.join(repo, 'specs')), 'and none is written');
  assert.doesNotMatch(fs.readFileSync(path.join(repo, '.specify/memory/constitution.md'), 'utf8'), /\[PRINCIPLE_1_NAME\]/, 'the constitution is a real one, not the template');
  assert.match(request, /\S/, 'the feature request is not empty');
  assert.equal(git(repo, 'status', '--short').stdout, '', 'everything is committed');
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD').stdout.trim(), '1');
  assert.equal(git(repo, 'branch', '--show-current').stdout.trim(), 'main');
  // Without NODE_TEST_CONTEXT, which would make the nested runner report here and exit 0 regardless.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const t = spawnSync(process.execPath, ['--test'], { cwd: repo, encoding: 'utf8', env });
  assert.equal(t.status, 0, t.stdout + t.stderr);
});

// A finished run as the hook and the transcript leave it, with one thing changed per case.
function state({ verdict = 'PASS', word = 'APPROVED', tasks = '- [x] T001 Write the test\n- [X] T002 Make it pass\n', testsPass = true,
  launches = [{ type: 'product-owner', background: false }], waits = 0, feature = 'specs/001-sum' } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'skfull-state-'));
  git(repo, 'init', '-q');
  const dir = path.join(repo, '.git', 'speckit-team');
  if (verdict) { fs.mkdirSync(path.join(dir, 'verdicts'), { recursive: true }); fs.writeFileSync(path.join(dir, 'verdicts', '001-sum.json'), JSON.stringify({ verdict, feature })); }
  if (word) { fs.mkdirSync(path.join(dir, 'ends'), { recursive: true }); fs.writeFileSync(path.join(dir, 'ends', '001-sum.json'), JSON.stringify({ word, feature })); }
  if (tasks !== null) { fs.mkdirSync(path.join(repo, feature), { recursive: true }); fs.writeFileSync(path.join(repo, feature, 'tasks.md'), `# Tasks\n\n${tasks}`); }
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'x', type: 'module', scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(repo, 'test'));
  fs.writeFileSync(path.join(repo, 'test', 'a.test.js'), `import test from 'node:test';\ntest('a', () => { ${testsPass ? '' : 'throw new Error("red");'} });\n`);
  return { repo, usage: { main: { launches, waits } } };
}
// A resumed session's total_cost_usd counts every turn so far, so a run costs its last turn's figure.
// The leak check's inputs default to a clean run: the marker was sent, and one agent transcript lacks it.
const MARKER = 'LEAK-0123456789abcdef';
const failures = (s, costs = [0.5, 1.5], maxCost = 6, leak = {}) => checkRun({ repo: s.repo, usage: s.usage, costs, maxCost,
  marker: MARKER, markerSent: true, agentTexts: [{ file: 'agent-a.jsonl', text: '{"prompt":"T001: go"}' }], ...leak });

test('full run: a run that passed every check reports no failure (#46)', () => {
  assert.deepEqual(failures(state()), []);
});

test('full run: each check the issue names fails on its own (#46)', () => {
  const cases = [
    [state({ verdict: 'FAIL' }), /audit/i],
    [state({ verdict: null }), /audit/i],
    [state({ word: 'REJECTED' }), /spec-gatekeeper/],
    [state({ word: null }), /spec-gatekeeper/],
    [state({ tasks: '- [x] T001 Write the test\n- [ ] T002 Make it pass\n' }), /T002/],
    [state({ tasks: null }), /tasks\.md/],
    [state({ testsPass: false }), /npm test/],
    [state({ launches: [{ type: 'architect', background: true }] }), /background/],
    [state({ launches: [] }), /no agent/i],
    [state({ waits: 2 }), /wait/i],
  ];
  for (const [s, why] of cases) {
    const f = failures(s);
    assert.equal(f.length, 1, `${why}: ${JSON.stringify(f)}`);
    assert.match(f[0], why);
  }
  assert.deepEqual(failures(state(), [3.5, 5.5], 6), [], 'the turns are not added up: $5.50 is the run');
  const over = failures(state(), [3.5, 6.5], 6);
  assert.equal(over.length, 1);
  assert.match(over[0], /\$6\.50.*\$6/);
});

test('full run: the workflow runs only by hand, weekly or on the e2e label, on Linux, never for a fork, and keeps the transcripts of a failed run (#46)', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'full-run.yml'), 'utf8');
  assert.match(wf, /^ {2}workflow_dispatch:/m);
  assert.match(wf, /^ {2}schedule:\n {4}- cron: /m);
  assert.match(wf, /^ {2}pull_request:\n {4}types: \[labeled\]/m);
  assert.doesNotMatch(wf, /pull_request_target/, 'a fork never gets the secret');
  assert.doesNotMatch(wf, /^ {2}push:/m, 'no run on every push: each costs $2 to $4');
  assert.match(wf, /github\.event\.label\.name == 'e2e'/);
  assert.match(wf, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(wf, /vars\.FULL_RUN_ENABLED == 'true'/, 'skipped, not green, until the owner turns it on');
  assert.match(wf, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(wf, /macos|windows/i);
  assert.match(wf, /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.match(wf, /node tools\/full-run\.mjs /);
  assert.match(wf, /MODEL: \$\{\{ inputs\.model \|\| 'sonnet' \}\}/, "the main session's model is an input; the agents keep their own");
  assert.match(wf, /--model "\$MODEL" --max-cost "\$MAX_COST"/);
  assert.doesNotMatch(wf, /run:.*\$\{\{ inputs\./, 'an input never goes into a script\'s text');
  assert.match(wf, /if: failure\(\)\n\s+uses: actions\/upload-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(wf, /retry|continue-on-error/i, 'a retry would hide a real regression');
  assert.match(wf, /@anthropic-ai\/claude-code@\$\(node -p "require\('\.\/package\.json'\)\.config\.claudeCode"\)/, 'the Claude Code version the test job pins, from package.json');
});

// The skill passes an agent only what its Inputs list, never the conversation (README, "Handoffs are lossy
// on purpose"). Only a real model decides what goes into a launch prompt, so the full run sends a marker
// in its answers marked as not for any agent, and fails if an agent's transcript holds it (the
// parent-only marker of google/elephant-goldfish-model's tests/integration/test_claude.py).
test('full run: the answers carry a parent-only marker, new each run, that no agent may receive', () => {
  const [a, b] = [newMarker(), newMarker()];
  assert.match(a, /^LEAK-[0-9a-f]{16}$/);
  assert.notEqual(a, b, 'a new marker each run, so an old transcript cannot satisfy the check');
  const text = answer(a);
  assert.ok(text.includes(a), 'the answer carries the marker');
  assert.match(text, /not for any agent/, 'and says it is not for any agent');
  assert.match(text, /^Full team. I approve the spec, the plan and the tasks, and I take every recommended option./, 'the answer itself is unchanged');
});

test('full run: the leak check fails on the marker in an agent transcript, and never passes on nothing', () => {
  const leaked = failures(state(), undefined, undefined, { agentTexts: [{ file: 'agent-a.jsonl', text: 'x' }, { file: 'agent-b.jsonl', text: `T001: go. ${MARKER}` }] });
  assert.equal(leaked.length, 1, JSON.stringify(leaked));
  assert.match(leaked[0], /marker/);
  assert.match(leaked[0], /agent-b.jsonl/, 'names the transcript it reached');
  assert.doesNotMatch(leaked[0], /agent-a/);
  const none = failures(state(), undefined, undefined, { agentTexts: [] });
  assert.equal(none.length, 1, JSON.stringify(none));
  assert.match(none[0], /no agent transcript/);
  const unsent = failures(state(), undefined, undefined, { markerSent: false });
  assert.equal(unsent.length, 1, JSON.stringify(unsent));
  assert.match(unsent[0], /never sent/);
});
