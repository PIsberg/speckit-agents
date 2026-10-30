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
import { answer, args, buildRepo, checkRun, firstPrompt, newMarker, runFailures, runTurns, shadowingSkills, trustFolder, turnError } from '../tools/full-run.mjs';

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

// --login runs on the owner's own Claude Code login instead of an API key: the team goes into the
// scratch repo's .claude/ (project agents override installed ones) and the repo gets folder trust in
// the owner's .claude.json for the run, without which Claude Code skips the agents' hooks (README,
// "Troubleshooting"). The live checks of 2026-10-24 needed a hand-written driver for this.
test('full run: --login is a flag without a value, and --out is still required', () => {
  assert.deepEqual(args(['--login', '--out', 'x', '--max-cost', '3']), { model: 'sonnet', maxCost: 3, maxTurns: 8, login: true, sideBySide: false, twoSlices: false, skillAgents: false, case: 'clean', claim: false, teamRoot: ROOT, out: path.resolve('x') });
  assert.equal(args(['--out', 'x']).login, false);
  assert.throws(() => args(['--login']), /usage/);
  assert.throws(() => args(['--out', 'x', '--nope', '1']), /unknown argument --nope/);
});

test('full run: folder trust is added for the run, and its undo removes only that entry, keeping what changed meanwhile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skfull-trust-'));
  const conf = path.join(dir, '.claude.json');
  const repo = path.join(dir, 'scratch', 'repo');
  const key = repo.split(path.sep).join('/');
  fs.writeFileSync(conf, JSON.stringify({ numStartups: 4, projects: { 'C:/other': { hasTrustDialogAccepted: true } } }));
  const undo = trustFolder(conf, repo);
  const during = JSON.parse(fs.readFileSync(conf, 'utf8'));
  assert.deepEqual(during.projects[key], { hasTrustDialogAccepted: true });
  assert.equal(during.numStartups, 4);
  // Claude Code rewrites the file while the run goes on; the undo must not put the old copy back.
  fs.writeFileSync(conf, JSON.stringify({ ...during, numStartups: 9 }));
  undo();
  const after = JSON.parse(fs.readFileSync(conf, 'utf8'));
  assert.equal(after.numStartups, 9, 'a change made during the run survives the undo');
  assert.deepEqual(after.projects, { 'C:/other': { hasTrustDialogAccepted: true } }, 'only the run\'s entry is gone');
  // A folder already trusted stays trusted.
  fs.writeFileSync(conf, JSON.stringify({ projects: { [key]: { hasTrustDialogAccepted: true, x: 1 } } }));
  trustFolder(conf, repo)();
  assert.deepEqual(JSON.parse(fs.readFileSync(conf, 'utf8')).projects[key], { hasTrustDialogAccepted: true, x: 1 });
});

test('full run: without an API key it stops before writing anything and names --login', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skfull-nokey-')), 'run');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'full-run.mjs'), '--out', out], { env, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /ANTHROPIC_API_KEY is not set.*--login/);
  assert.ok(!fs.existsSync(out), 'nothing written');
});

// #114: the only run that can show a real main session building [P] slices side by side. The fixture's
// one-function request has a single slice, so --side-by-side asks for two functions in two files and
// answers the plan stop's question with side by side; the run then fails unless implementers went out
// together in worktrees and every worktree and its branch is gone at the end.
test('full run: --side-by-side asks for two slices in disjoint files and answers side by side (#114)', () => {
  assert.equal(args(['--side-by-side', '--out', 'x']).sideBySide, true);
  assert.equal(args(['--out', 'x']).sideBySide, false);
  const plain = buildRepo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skfull-p-')), 'repo')).request;
  const { request } = buildRepo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skfull-sbs-')), 'repo'), { twoSlices: true });
  assert.notEqual(request, plain);
  assert.match(request, /src\/math\.js/);
  assert.match(request, /src\/text\.js/, 'the second slice is in a file of its own');
  const text = answer(MARKER, { sideBySide: true });
  assert.match(text, /side by side/);
  assert.ok(text.includes(MARKER), 'still carries the marker');
  assert.doesNotMatch(answer(MARKER), /side by side/, 'the plain run keeps the recommended one at a time');
});

test('full run: a side-by-side run fails unless implementers went out together in worktrees (#114)', () => {
  const together = [{ type: 'implementer', background: false, worktree: true, together: 2 }, { type: 'implementer', background: false, worktree: true, together: 2 }];
  const sbs = (s) => failures(s, undefined, undefined, { sideBySide: true });
  assert.deepEqual(sbs(state({ launches: together })), []);
  for (const launches of [
    [{ type: 'implementer', background: false, worktree: false, together: 1 }],
    [{ type: 'implementer', background: false, worktree: true, together: 1 }],
    [{ type: 'implementer', background: false, worktree: false, together: 2 }, { type: 'implementer', background: false, worktree: false, together: 2 }],
  ]) {
    const f = sbs(state({ launches }));
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.match(f[0], /side by side/);
  }
  assert.deepEqual(failures(state({ launches: [{ type: 'implementer', background: false, worktree: false, together: 1 }] })), [], 'one at a time is fine without the flag');
});

test('full run: a worktree or worktree branch left behind fails the run (#114)', () => {
  const s = state();
  fs.writeFileSync(path.join(s.repo, 'f.txt'), 'x');
  git(s.repo, 'add', '-A');
  git(s.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'x');
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skfull-wt-')), 'agent-1');
  assert.equal(git(s.repo, 'worktree', 'add', '-q', '-b', 'worktree-agent-1', wt).status, 0);
  const f = failures(s);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.match(f[0], /worktree/);
  assert.match(f[0], /agent-1/);
  git(s.repo, 'worktree', 'remove', wt);
  const branch = failures(s);
  assert.equal(branch.length, 1, JSON.stringify(branch));
  assert.match(branch[0], /worktree-agent-1/, 'the branch is left after the worktree went');
  git(s.repo, 'branch', '-D', 'worktree-agent-1');
  assert.deepEqual(failures(s), []);
});

// In the --login run of 2026-10-25 turns 1 to 4 ended on "API Error: Connection refused", and the
// loop still resumed the session with the approval answer, a reply to a question never asked, using
// up 4 of the 8 turns. A turn that ends on an API error now stops the run, which is reported as the
// infrastructure's failure, not the team's; nothing is retried.
test('full run: a turn that ends on an API error stops the run and says it was the infrastructure', () => {
  const refused = { is_error: true, result: 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)', session_id: 's' };
  assert.match(turnError(refused, 1), /^infrastructure, not the team: API Error: Connection refused/);
  assert.match(turnError({ is_error: false, result: 'API Error: Overloaded', session_id: 's' }, 1), /API Error: Overloaded/, 'the text alone is enough');
  assert.match(turnError(null, 1), /claude printed no result \(exit 1\)/);
  assert.equal(turnError({ is_error: false, result: 'Which roles take part?', session_id: 's' }, 0), null, 'a stop of the skill is no error');
});

// #114 asks for the same feature built one at a time, to set against side by side in tokens and
// wall-clock time. --two-slices sends the two-file request with the plain answer; --side-by-side
// implies it.
test('full run: --two-slices sends the two-file request with the one-at-a-time answer, and --side-by-side implies it (#114)', () => {
  assert.deepEqual([args(['--two-slices', '--out', 'x']).twoSlices, args(['--two-slices', '--out', 'x']).sideBySide], [true, false]);
  assert.deepEqual([args(['--side-by-side', '--out', 'x']).twoSlices, args(['--side-by-side', '--out', 'x']).sideBySide], [true, true]);
  assert.equal(args(['--out', 'x']).twoSlices, false);
  const one = (launches) => failures(state({ launches }), undefined, undefined, { twoSlices: true });
  assert.deepEqual(one([{ type: 'implementer', background: false, worktree: false, together: 1 }]), []);
  const f = one([{ type: 'test-writer', background: false, worktree: false, together: 2 }, { type: 'test-writer', background: false, worktree: false, together: 2 }]);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.match(f[0], /one at a time/, 'the answer was one at a time, so agents going out together fail the run');
  // The plan stop sends an architect revision and product-owner's Spec: lines in one message (step 2):
  // that is not a build going side by side. The one-at-a-time run of 2026-10-25 failed on it.
  const revision = [{ type: 'product-owner', background: false, worktree: false, together: 2 }, { type: 'architect', background: false, worktree: false, together: 2 }];
  assert.deepEqual(one(revision), [], 'only test-writers and implementers count');
});

// 009 T019: the full run in skill-agents mode (SC-001, SC-004, FR-014).
const CORE = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'];
const roleSkills = (roles = CORE) => roles.map((r) => `speckit-role-${r}`);

test('full run: --skill-agents is a flag without a value, off by default (SC-001)', () => {
  assert.equal(args(['--skill-agents', '--out', 'x']).skillAgents, true);
  assert.equal(args(['--out', 'x']).skillAgents, false);
  assert.equal(args(['--skill-agents', '--out', 'x', '--max-cost', '3']).maxCost, 3, 'the flag takes no value');
});

test('full run: the first prompt names the team only in skill-agents mode (SC-001)', () => {
  assert.equal(firstPrompt('add sum()', { skillAgents: true }), '/speckit-team --team skill-agents add sum()');
  assert.equal(firstPrompt('add sum()'), '/speckit-team add sum()');
  assert.equal(firstPrompt('add sum()', { skillAgents: false }), '/speckit-team add sum()');
});

test('full run: skill-agents mode fails on any launch and on a core role skill never called (SC-001, SC-004, FR-014)', () => {
  const run = (main) => checkRun({ repo: state().repo, usage: { main }, costs: [0.5], maxCost: 6, marker: MARKER, markerSent: true,
    agentTexts: [], skillAgents: true });
  const ok = run({ launches: [], waits: 0, skills: roleSkills() });
  assert.deepEqual(ok, [], 'no launch, no agent transcript and all six skills: nothing fails');
  const launched = run({ launches: [{ type: 'architect', background: false }], waits: 0, skills: roleSkills() });
  assert.equal(launched.length, 1, JSON.stringify(launched));
  assert.match(launched[0], /launch/i);
  for (const missing of CORE) {
    const f = run({ launches: [], waits: 0, skills: roleSkills(CORE.filter((r) => r !== missing)) });
    assert.equal(f.length, 1, `${missing}: ${JSON.stringify(f)}`);
    assert.match(f[0], new RegExp(`speckit-role-${missing}`));
  }
});

test('full run: without the option a run with no launch still fails as before (T019)', () => {
  assert.match(failures(state({ launches: [] }))[0], /no agent/i);
});

test('full run: --case, --claim and --team-root are read, an unknown case is refused, and the defaults change nothing (#188)', () => {
  const o = args(['--out', 'x', '--case', 'defect', '--claim', '--team-root', 'other']);
  assert.equal(o.case, 'defect');
  assert.equal(o.claim, true);
  assert.equal(o.teamRoot, path.resolve('other'));
  assert.throws(() => args(['--out', 'x', '--case', 'nope']), /unknown case nope/);
  assert.equal(args(['--out', 'x']).case, 'clean');
  assert.equal(args(['--out', 'x']).teamRoot, ROOT, 'the team installed is this checkout\'s unless told otherwise');
});

test('full run: a team-root arm installs that checkout\'s agents, so two arms can differ by one prompt line (#188)', () => {
  const arm = fs.mkdtempSync(path.join(os.tmpdir(), 'skarm-'));
  for (const f of ['install.mjs', 'agents', 'skills', 'hooks']) fs.cpSync(path.join(ROOT, f), path.join(arm, f), { recursive: true });
  fs.appendFileSync(path.join(arm, 'agents', 'spec-gatekeeper.md'), '\nARM-MARKER-LINE\n');
  const cfg = path.join(arm, 'cfg');
  const r = spawnSync(process.execPath, [path.join(arm, 'install.mjs'), '--claude-dir', cfg], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(cfg, 'agents', 'spec-gatekeeper.md'), 'utf8'), /ARM-MARKER-LINE/);
  assert.match(fs.readFileSync(path.join(cfg, 'skills', 'speckit-role-spec-gatekeeper', 'SKILL.md'), 'utf8'), /ARM-MARKER-LINE/);
});

// #175: under --login a personal team skill wins over the project copy the run installs, so the run would
// test the personal version. One that matches this checkout's (hook path aside) is harmless.
test('full run: --login names a personal team skill that differs from the checkout\'s, and only that (#175)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skshadow-'));
  const [personal, project] = [path.join(tmp, 'home', '.claude'), path.join(tmp, 'repo', '.claude')];
  for (const dir of [personal, project]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'install.mjs'), '--claude-dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  assert.deepEqual(shadowingSkills(personal, project), [], 'the same version installed in two places, hook paths differing');
  fs.appendFileSync(path.join(personal, 'skills', 'speckit-team', 'SKILL.md'), '\nan older line\n');
  fs.rmSync(path.join(personal, 'skills', 'speckit-patch'), { recursive: true });
  fs.mkdirSync(path.join(personal, 'skills', 'my-own'));
  fs.writeFileSync(path.join(personal, 'skills', 'my-own', 'SKILL.md'), 'not the team\'s');
  assert.deepEqual(shadowingSkills(personal, project), ['speckit-team']);
  assert.deepEqual(shadowingSkills(path.join(tmp, 'nowhere'), project), [], 'no personal skills folder');
});

// #173: main()'s loop, with claude replaced by canned --output-format json results, one per turn.
test('full run: the turn loop stops on an API error, on no session, on a recorded end and at --max-turns (#173)', () => {
  const canned = (results) => {
    const calls = [];
    return { calls, invoke: (prompt, session) => { calls.push({ prompt, session }); const r = results[calls.length - 1]; return { status: r ? 0 : 1, stdout: r ? JSON.stringify(r) : '', stderr: '' }; } };
  };
  const ok = (extra = {}) => ({ session_id: 'sess', total_cost_usd: 0.1, num_turns: 3, result: 'Spec ready. Approve?', ...extra });
  const promptFor = (n) => `prompt ${n + 1}`;
  const quiet = { log: () => {} };

  const err = canned([{ is_error: true, result: 'API Error: Connection refused', session_id: 'sess' }, ok()]);
  const a = runTurns({ maxTurns: 8, promptFor, invoke: err.invoke, ended: () => false, ...quiet });
  assert.equal(err.calls.length, 1, 'no answer is sent after an API error');
  assert.equal(a.turns.length, 1);
  assert.match(a.stopped, /^turn 1: infrastructure, not the team: API Error: Connection refused/);

  const none = canned([ok({ session_id: undefined })]);
  assert.match(runTurns({ maxTurns: 8, promptFor, invoke: none.invoke, ended: () => false, ...quiet }).stopped, /^turn 1: claude returned no session to resume/);
  assert.match(runTurns({ maxTurns: 8, promptFor, invoke: canned([]).invoke, ended: () => false, ...quiet }).stopped, /^turn 1: claude printed no result \(exit 1\)/);

  const ends = canned([ok(), ok(), ok()]);
  const b = runTurns({ maxTurns: 8, promptFor, invoke: ends.invoke, ended: (res, n) => n === 1, ...quiet });
  assert.equal(b.stopped, null);
  assert.deepEqual(ends.calls, [{ prompt: 'prompt 1', session: null }, { prompt: 'prompt 2', session: 'sess' }], 'the second turn resumes the first one\'s session');

  const all = canned([ok(), ok(), ok(), ok()]);
  const c = runTurns({ maxTurns: 3, promptFor, invoke: all.invoke, ended: () => false, ...quiet });
  assert.equal(c.turns.length, 3, '--max-turns');
  assert.equal(c.session, 'sess');
  assert.deepEqual(c.turns.map((t) => t.cost), [0.1, 0.1, 0.1]);

  assert.deepEqual(runFailures(['a check'], 'turn 2: infrastructure'), ['turn 2: infrastructure', 'a check'], 'the stop comes first');
  assert.deepEqual(runFailures(['a check'], null), ['a check']);
});
