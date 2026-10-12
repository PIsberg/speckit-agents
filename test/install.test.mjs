// Run: npm test (or node --test "test/*.test.mjs")
// Installs into throwaway Claude config dirs (with a space in the path) and checks what lands there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'install.mjs');
const AGENTS = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper', 'patcher'];
const UNRELATED = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-hook' }] };

function claudeDir(settings) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skagents-')), 'claude dir');
  fs.mkdirSync(dir);
  if (settings !== undefined) {
    fs.writeFileSync(path.join(dir, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
  }
  return dir;
}
const install = (dir, ...args) => spawnSync(process.execPath, [INSTALL, '--claude-dir', dir, ...args], { encoding: 'utf8' });
const settingsOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
const backups = (dir) => fs.readdirSync(dir).filter((f) => f.includes('.bak-speckit-agents'));
// Install then uninstall, returning what is left in the config dir.
function roundTrip(dir) {
  const i = install(dir);
  assert.equal(i.status, 0, i.stderr + i.stdout);
  const u = install(dir, '--uninstall');
  assert.equal(u.status, 0, u.stderr + u.stdout);
  return fs.readdirSync(dir).sort();
}
const bytes = (dir) => fs.readFileSync(path.join(dir, 'settings.json'));
const gates = (s) => Object.entries(s.hooks ?? {}).flatMap(([event, groups]) => groups
  .filter((g) => g.hooks.some((h) => h.command.includes('speckit-team.mjs'))).map((g) => `${event}:${g.matcher}`));
// The settings.json entries the installer owns, as `event:matcher`, sorted.
const GATES = ['PreToolUse:Skill|Agent', 'SubagentStart:product-owner|architect', 'UserPromptExpansion:speckit-implement|speckit\\.implement|speckit-team'];
// Prose wraps at any space, so a phrase is matched on the text with its line breaks collapsed.
const flat = (s) => s.replace(/\s+/g, ' ');

test('install lays down agents, skill, hook and both settings gates, keeping other hooks', () => {
  const dir = claudeDir({ model: 'opus', hooks: { PreToolUse: [UNRELATED, {
    matcher: 'Skill', hooks: [{ type: 'command', command: 'node C:/old/place/speckit-team.mjs gate' }] }] } });
  const r = install(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);

  const hookPath = path.join(dir, 'hooks', 'speckit-team.mjs').split(path.sep).join('/');
  for (const a of AGENTS) {
    assert.ok(fs.existsSync(path.join(dir, 'agents', `${a}.md`)), `agents/${a}.md installed`);
    const text = fs.readFileSync(path.join(dir, 'agents', `${a}.md`), 'utf8');
    assert.doesNotMatch(text, /\{\{HOOK\}\}/, a);
    assert.match(text, /speckit-agents: managed/, a);
  }
  const implementer = fs.readFileSync(path.join(dir, 'agents', 'implementer.md'), 'utf8');
  assert.match(implementer, new RegExp(`node "${hookPath}" gate retries`));
  assert.match(implementer, new RegExp(`node "${hookPath}" result`));
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md')));

  // 003 FR-001, FR-006, FR-012, plan.md decision 14: the fast track's agent and skill.
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'patcher.md')), 'agents/patcher.md installed');
  const patcher = fs.readFileSync(path.join(dir, 'agents', 'patcher.md'), 'utf8');
  assert.match(patcher, new RegExp(`node "${hookPath}" patch`));
  assert.match(patcher, new RegExp(`node "${hookPath}" scope protected`));
  assert.match(patcher, new RegExp(`node "${hookPath}" ends DONE FAILED ESCALATE`));
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'speckit-patch', 'SKILL.md')), 'skills/speckit-patch installed');
  const patchSkill = fs.readFileSync(path.join(dir, 'skills', 'speckit-patch', 'SKILL.md'), 'utf8');
  assert.match(patchSkill, /speckit-agents: managed/);
  assert.match(patchSkill, /^name: speckit-patch$/m);
  assert.match(patchSkill, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(patchSkill, /\{\{HOOK\}\}/);

  const s = settingsOf(dir);
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.hooks.PreToolUse[0], UNRELATED);
  assert.deepEqual(gates(s).sort(), GATES);
  assert.ok(!JSON.stringify(s).includes('C:/old/place'), 'stale gate replaced, not duplicated');
  assert.equal(backups(dir).length, 1, 'settings.json backed up before the change');
  assert.match(r.stdout, /verified\s+installed hook runs/);
  assert.match(r.stdout, /\/speckit-patch/, 'the final Next lines name /speckit-patch');
});

// 003 FR-002, FR-003, FR-004, FR-006, FR-012, plan.md decision 16 point 3: the prose rules.
test("installed patcher.md states the fast track's rules", () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'patcher.md')), 'agents/patcher.md installed');
  const text = fs.readFileSync(path.join(dir, 'agents', 'patcher.md'), 'utf8');
  for (const re of [/DONE/, /FAILED/, /ESCALATE/, /regression test/i, /passed, failed, skipped or not run/i,
    /not yours/i, /git mv/i, /never commit/i, /never push/i, /\bgh\b/, /git reset --hard/i, /git clean/i,
    /naming it/i, /never merge/i, /\/speckit-team/, /never start/i]) assert.match(text, re);
  assert.doesNotMatch(text, /gh pr create/);
  assert.doesNotMatch(text, /git switch -c/);
});

// 003 research R15, plan.md decisions 14 to 16, spec audit finding H1: the commit-after-the-check steps.
test('installed speckit-patch skill commits only after the end check, and never on an empty record', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const hookPath = path.join(dir, 'hooks', 'speckit-team.mjs').split(path.sep).join('/');
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'speckit-patch', 'SKILL.md')), 'skills/speckit-patch installed');
  const text = fs.readFileSync(path.join(dir, 'skills', 'speckit-patch', 'SKILL.md'), 'utf8');
  assert.ok(text.includes(`git hash-object -- "${hookPath}"`), 'noted hash of the installed hook');
  for (const re of [/git switch -c patch\//, /patch-accepted\.json/, /git add --/, /git commit -m/, /git add -A/,
    /git push -u origin/, /--force/, /gh pr create/, /DONE/, /passed/, /commit nothing and report the run as FAILED/,
    /never merge/i, /never start/i, /\/speckit-team/]) assert.match(text, re);
  const empty = /`files` is empty[^]*commit nothing, push nothing and open no pull request/i.exec(text);
  assert.ok(empty, 'the empty-record rule is stated');
  assert.ok(empty.index < text.indexOf('git commit -m'), 'the empty-record rule comes before the first git commit -m');
});

// #73, from the sixth spec audit of PR #76: without .specify/ every fast-track hook is inactive (FR-010),
// so patcher would run with no budget and no protected paths. The skill must stop before anything else.
test('installed speckit-patch skill stops first when .specify/ is missing', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const text = fs.readFileSync(path.join(dir, 'skills', 'speckit-patch', 'SKILL.md'), 'utf8');
  const stop = /`\.specify\/` exists\. If not, stop/.exec(text);
  assert.ok(stop, 'the precondition is stated');
  assert.ok(stop.index < text.indexOf('## 2.'), 'it comes before the branch is created');
  assert.ok(stop.index < text.indexOf('Launch `patcher`'), 'and before patcher is launched');
});

// #72, the start record out of patcher's reach: the hook's start record is a file patcher's shell can
// rewrite, so the main session keeps its own copy of what a rewrite could hide. It notes the
// remote-tracking refs before the launch and compares them before it commits, and keeps the files
// dirty at the start out of the commit by its own list.
test("installed speckit-patch skill checks the remote-tracking refs and the dirty files against its own notes before it commits (#72)", () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const text = fs.readFileSync(path.join(dir, 'skills', 'speckit-patch', 'SKILL.md'), 'utf8');
  const step = (n) => flat(text.slice(text.indexOf(`## ${n}.`), text.indexOf(`## ${n + 1}.`)));
  const refs = "git for-each-ref --format='%(refname) %(objectname)' refs/remotes";
  assert.ok(step(2).includes(refs), 'step 2 notes the remote-tracking refs');
  const checks = step(4).slice(0, step(4).indexOf('Otherwise:'));
  assert.ok(checks.includes(refs), 'step 4 lists them again before the commit');
  assert.match(checks, /equal the noted refs/, 'and compares them with the notes');
  assert.match(checks, /dirty in step 1[^.]*`files`[^.]*`untracked`/, 'a file dirty at the start is in neither list');
});

// #73, live check L3: patcher wrote 86 lines in one Bash call, made no further tool call, so the budget
// deny never reached it, and it reported DONE. A last tool call before the report meets that deny.
test('installed patcher checks the tree once more before reporting, so an over-budget run ends ESCALATE', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const text = fs.readFileSync(path.join(dir, 'agents', 'patcher.md'), 'utf8');
  const last = /Last, just before the report, run `git status --short` again[^]*ESCALATE/.exec(text);
  assert.ok(last, 'the last step is stated');
  assert.ok(last.index < text.indexOf('## Report'), 'in the Process, before the Report');
});

// Speed: each slice built on its own cost up to three agent launches in a row (stubs, red, green),
// each with a fresh start. The skill builds a phase of tasks.md as one round of at most 4 slices.
test('installed speckit-team skill builds a tasks.md phase per round, at most 4 slices, never the whole feature', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const skill = fs.readFileSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md'), 'utf8');
  const section = skill.slice(skill.indexOf('## 4-5.'), skill.indexOf('## 6.'));
  assert.match(section, /a round is the slices of one phase of `tasks\.md`/i);
  assert.match(section, /at most 4 slices/);
  assert.match(section, /one stub pass, one test-writer and one implementer per round/i);
  assert.match(section, /Never hand the whole feature to one test-writer or one implementer/);
});

// #70: the plan stop and the dictated revision are a contract between the skill and the architect.
// The skill greps plan.md for the section and starts a prompt with the prefix; renaming either on
// one side only would quietly bring back a revision round per decision.
test('installed speckit-team skill and architect agree on the decisions section and the dictated revision', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const architect = fs.readFileSync(path.join(dir, 'agents', 'architect.md'), 'utf8');
  const skill = fs.readFileSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md'), 'utf8');
  for (const [name, text] of [['architect.md', architect], ['speckit-team SKILL.md', skill]]) {
    for (const term of ['`## Open Decisions`', '`dictated:`', '`needs revision`']) {
      assert.ok(text.includes(term), `${name} names ${term}`);
    }
  }
  // The read rule names the shell reads the 003 architects re-read files with, and the narrow form.
  for (const re of [/`cat`/, /`sed`/, /grep -n "\^## "/, /forbidden/]) assert.match(architect, re);
  // The decisions' reasoning stays in plan.md, so the report keeps its cap; the skill batches its questions.
  assert.match(architect, /At most 15 lines/);
  assert.match(skill, /at most 4 questions/);
});

// specs/004-board-clear/findings.md, 1, 7, 8 and 9: the plan stop settles the decisions, the spec
// lines they change and the IDs they drop in one round. A plan decision that contradicted FR-012
// failed the first audit (a product-owner and a second audit, 6 minutes); five questions took a call
// the skill did not mention; a grep cut at 200 columns hid four mentions of a dropped task (one more
// architect). Each rule has a half in another file, so renaming it on one side brings the cost back.
test('installed skill, architect and product-owner settle the plan decisions and their spec lines in one round', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const read = (...p) => flat(fs.readFileSync(path.join(dir, ...p), 'utf8'));
  const skill = read('skills', 'speckit-team', 'SKILL.md');
  const architect = read('agents', 'architect.md');
  const owner = read('agents', 'product-owner.md');
  const stop = skill.slice(skill.indexOf('## 2.'), skill.indexOf('## 3.'));
  assert.ok(architect.includes('`Spec:`'), 'architect writes the new wording of a spec line an option changes');
  for (const term of ['`Spec:`', 'product-owner', 'same message']) assert.ok(stop.includes(term), `the plan stop names ${term}`);
  assert.match(owner.slice(owner.indexOf('## Inputs'), owner.indexOf('## Process')), /plan decisions/);
  assert.match(skill.slice(0, skill.indexOf('## 1.')), /at most 4 questions/, 'the limit is stated before the first stop');
  assert.ok(stop.includes("sed -n '/^## Open Decisions/,$p'"), 'the section is read in one command');
  assert.match(stop, /more than 4/);
  assert.match(stop, /every recommended option/);
  for (const [name, text] of [['architect.md', architect], ['speckit-team SKILL.md', skill]]) {
    assert.match(text, /every mention/, `${name}: a dropped ID is one edit for every mention`);
  }
  assert.match(architect, /`cut`/);
});

// specs/004-board-clear/findings.md, 4: past the Bash tool's default 2 minutes Claude Code moves a
// command to the background, where a subagent cannot wait for it (sleep is blocked, Monitor is not
// its tool). One implementer waited 234 s that way on an `npm test` it then ran again. Every agent
// that runs a suite says so.
test('every installed agent that runs tests gives the run a Bash timeout that covers it', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  for (const a of ['test-writer', 'implementer', 'spec-gatekeeper', 'patcher']) {
    const text = flat(fs.readFileSync(path.join(dir, 'agents', `${a}.md`), 'utf8'));
    for (const re of [/`timeout`/, /600000 ms/, /moves the command to the background/]) assert.match(text, re, a);
  }
});

// specs/004-board-clear/findings.md, 2 and 3: a test can be red and still wrong. A width bound no
// layout could meet was red for another reason, then cost an implementer RED and two more launches;
// two type errors in test code would have failed CI's tsc. A number that cannot hold blocks the round.
test('installed test-writer runs the type check and reports a task number no implementation can meet', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const text = flat(fs.readFileSync(path.join(dir, 'agents', 'test-writer.md'), 'utf8'));
  const work = text.slice(text.indexOf('## Process'), text.indexOf('## Lane'));
  assert.match(work, /type check/);
  assert.match(work, /smallest and the largest case/);
  assert.match(text.slice(text.indexOf('## Report')), /numbers that cannot hold/);
});

// specs/004-board-clear/findings.md, 5 and 6: product-owner's and architect's hooks see Write and
// Edit only, and no stop check reads their Bash writes. And in Claude Code 2.1.296 a report arrives as
// the agent's hand-back message, which the Agent tool's result only points to.
test('installed product-owner and architect write files with the tools their hook sees; the skill reads hand-backs', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  for (const a of ['product-owner', 'architect']) {
    const text = flat(fs.readFileSync(path.join(dir, 'agents', `${a}.md`), 'utf8'));
    assert.match(text.slice(text.indexOf('## Lane'), text.indexOf('## Report')), /Write and Edit[^]*Bash/, a);
  }
  const skill = flat(fs.readFileSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md'), 'utf8'));
  assert.match(skill.slice(skill.indexOf('## Handoffs'), skill.indexOf('## Pace')), /`SubagentHandback`/);
});

// #88: a file product-owner or architect writes through Bash was never checked. The settings.json
// SubagentStart entry records where each starts, and the Stop's `lane only` holds the agent to exactly
// the prefixes its scope rule allows: the two lists are one fact, kept in two places.
test('#88 product-owner and architect: SubagentStart records their start, and their Stop checks the scope prefixes', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const hookPath = path.join(dir, 'hooks', 'speckit-team.mjs').split(path.sep).join('/');
  const start = settingsOf(dir).hooks.SubagentStart;
  assert.equal(start.length, 1);
  assert.equal(start[0].matcher, 'product-owner|architect');
  assert.equal(start[0].hooks[0].command, `node "${hookPath}" start`);
  for (const [a, prefixes] of [['product-owner', 'specs/ .specify/feature.json'], ['architect', 'specs/ CLAUDE.md']]) {
    const text = fs.readFileSync(path.join(dir, 'agents', `${a}.md`), 'utf8');
    const scope = new RegExp(`node "${hookPath}" scope only ([^']+)'`).exec(text)?.[1];
    const lane = new RegExp(`node "${hookPath}" lane only ([^']+)'`).exec(text)?.[1];
    assert.equal(scope, prefixes, `${a}: scope only`);
    assert.equal(lane, scope, `${a}: the Stop's lane only names the scope rule's prefixes`);
    const fm = text.slice(0, text.indexOf('\n---', 4));
    assert.ok(fm.indexOf('  Stop:') > 0 && fm.indexOf('lane only') > fm.indexOf('  Stop:'), `${a}: lane only runs at Stop`);
  }
  assert.equal(install(dir, '--uninstall').status, 0);
  const after = fs.existsSync(path.join(dir, 'settings.json')) ? settingsOf(dir) : {};
  assert.equal(after.hooks?.SubagentStart, undefined, 'uninstall removes the entry');
});

// #89: at the 004 plan stop the one decision the owner changed was work no requirement asked for. Work
// that nothing requires is an open decision whose recommended option leaves it out; what CLAUDE.md or a
// constitution MUST rule asks for is required, so the architect never recommends against them.
test('#89 installed architect makes work nothing requires an open decision that recommends leaving it out', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const body = flat(fs.readFileSync(path.join(dir, 'agents', 'architect.md'), 'utf8'));
  const step5 = body.slice(body.indexOf('5. Write each decision'), body.indexOf('On a revision with'));
  assert.match(step5, /no FR, SC or scenario/);
  assert.match(step5, /constitution MUST rule/);
  assert.match(step5, /`CLAUDE\.md`/);
  assert.match(step5, /recommended option leaves (it|the work) out/);
  const readme = flat(mdSection(repoText('README.md'), '#### Settling decisions'));
  assert.match(readme, /recommended option leaves (it|the work) out/, 'README, Settling decisions');
});

// The 004 architect's first pass wrote 47k characters in about 230 of its 654 s; the constitution
// table was 39% of plan.md, the quickstart mostly live checks the owner deferred, and the plugin API's
// types were explored three times (19k, 17k and 9k characters). The architect writes each fact once,
// leaves the cases to test-writer, and maps the code; neither it nor product-owner reads other
// features' artifacts as examples (40k characters in 004).
test('installed architect writes each fact once, cites the spec instead of spelling out cases, and maps the code', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const read = (a) => flat(fs.readFileSync(path.join(dir, 'agents', `${a}.md`), 'utf8'));
  const architect = read('architect');
  const inputs = architect.slice(architect.indexOf('## Inputs'), architect.indexOf('## Process'));
  const work = architect.slice(architect.indexOf('## Process'), architect.indexOf('## Context'));
  assert.match(inputs, /Other features' artifacts are not inputs/);
  for (const doc of ['`research.md` only', '`data-model.md` only', '`contracts/` only', '`quickstart.md` only']) assert.ok(work.includes(doc), doc);
  for (const term of ['each fact once', 'one row per rule', 'do not spell out each case', 'file and symbol']) assert.ok(work.includes(term), term);
  const owner = read('product-owner');
  assert.match(owner.slice(owner.indexOf('## Inputs'), owner.indexOf('## Process')), /Other features' specs are not inputs/);
  const writer = read('test-writer');
  assert.match(writer.slice(writer.indexOf('## Inputs'), writer.indexOf('## Process')), /not the whole file/);
  assert.match(writer, /a test for each scenario and FR/);
  assert.match(writer, /saved to a file/);
});

// The full suite ran 5 times in the 004 run, about 14.5 of the 48 agent-minutes; the last
// implementer's run and spec-gatekeeper's were a minute apart on the same commit. Rounds now run the
// tests that cover their change, and only the last round, which the skill names, runs the full suite.
test('installed implementer runs the full suite only in the round the skill calls the last', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const implementer = flat(fs.readFileSync(path.join(dir, 'agents', 'implementer.md'), 'utf8'));
  assert.match(implementer, /full suite only when your prompt says `last round`/);
  const skill = flat(fs.readFileSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md'), 'utf8'));
  assert.ok(skill.slice(skill.indexOf('## 4-5.'), skill.indexOf('## 7.')).includes('`last round`'), 'the skill names the last round');
});

// #40, checked against a fake API with Claude Code 2.1.296 and git 2.55: a worktree starts from the
// last commit, so it lacks test-writer's uncommitted tests; ticks on adjacent lines of tasks.md in two
// branches conflict when merged; and `git add -A` commits a worktree left in place as an embedded
// repository. test/e2e.test.mjs pins the worktree's start and the branch its result names.
test('installed skill and implementer agree on building [P] slices side by side in worktrees (#40)', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const implementer = flat(fs.readFileSync(path.join(dir, 'agents', 'implementer.md'), 'utf8'));
  assert.match(implementer, /When your prompt says `worktree`, tick nothing/);
  assert.match(implementer, /never with `worktree`/, 'the stub pass ticks nothing in a worktree either');
  const skill = flat(fs.readFileSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md'), 'utf8'));
  const side = skill.slice(skill.indexOf('Only if the user chose side by side'), skill.indexOf('## 6.'));
  for (const term of ['`isolation: "worktree"`', '`worktree` in its prompt', 'in the message that launches the implementers', 'After each implementer step, in one Bash call', '`worktreeBranch`', 'in task order', '`git worktree remove`', '`git branch -d`']) {
    assert.ok(side.includes(term), term);
  }
  const ask = skill.slice(skill.indexOf('slices whose tasks are all `[P]`'), skill.indexOf('## 3.'));
  assert.match(ask, /one at a time \(recommended: it costs less, and no run with real models has built slices side by side yet\)/);
});

// The main session is the run's largest cost: in 004 its 58 run responses took 8.92M, 2.73M of it
// earlier conversation re-read by every response. While an agent works the user sees its Agent
// description and its tool calls, never its text (checked against Claude Code 2.1.296's interface).
// test/e2e.test.mjs pins that the calls of one message run in order, which the commit-and-launch rule needs.
test('installed skill keeps the main session short and tells the user what each agent does', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const skill = flat(fs.readFileSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md'), 'utf8'));
  assert.match(skill.slice(skill.indexOf('## 0.'), skill.indexOf('## 0b.')), /`\/clear`/);
  assert.equal(skill.split('in the message that launches').length - 1, 3, 'the spec, the plan and, side by side, the round\'s tests are committed with the next launch');
  for (const term of ['Before each launch', '`duration_ms`', 'Agent call\'s `description`']) assert.ok(skill.includes(term), term);
});

// README.md, "The team", gives the agent bodies' length. It said 26 to 43 lines while architect.md
// had 65 (2026-10-10), so the numbers are counted here: lines after the frontmatter, blank ones left out.
test("README states the agent bodies' length as agents/*.md has it", () => {
  const repo = path.dirname(INSTALL);
  const body = (a) => fs.readFileSync(path.join(repo, 'agents', `${a}.md`), 'utf8').replace(/\r\n/g, '\n')
    .split(/^---$/m).slice(2).join('---').split('\n').filter((l) => l.trim()).length;
  const team = AGENTS.filter((a) => a !== 'patcher').map(body);
  const readme = flat(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'));
  assert.ok(readme.includes(`Those bodies are ${Math.min(...team)} to ${Math.max(...team)} lines`), `team bodies: ${team.join(', ')}`);
  assert.ok(readme.includes(`its ${body('patcher')}-line body`), `patcher body: ${body('patcher')}`);
});

// 003 FR-013, FR-012, US5-1, US5-2 (T015): the advisory triage skill.
test('installed speckit-triage skill is advisory, names both commands and the four signals, and uninstalls', () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  const file = path.join(dir, 'skills', 'speckit-triage', 'SKILL.md');
  assert.ok(fs.existsSync(file), 'skills/speckit-triage installed');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /speckit-agents: managed by install\.mjs/);
  assert.match(text, /^name: speckit-triage$/m);
  assert.match(text, /^disable-model-invocation: true$/m);
  for (const re of [/\/speckit-patch/, /\/speckit-team/, /launches no agent/i, /invokes no skill/i,
    /public contract/i, /protected path/i, /\b30\b/, /\b2\b/]) assert.match(text, re);
  const u = install(dir, '--uninstall');
  assert.equal(u.status, 0, u.stderr + u.stdout);
  assert.ok(!fs.existsSync(path.join(dir, 'skills', 'speckit-triage')), 'skills/speckit-triage removed');
  const h = spawnSync(process.execPath, [INSTALL, '--help'], { encoding: 'utf8' });
  assert.match(h.stdout, /\/speckit-triage/, '--help names /speckit-triage');
});

test('refuses to replace a patcher.md it did not install', () => {
  const dir = claudeDir();
  const mine = path.join(dir, 'agents', 'patcher.md');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, '---\nname: patcher\ndescription: my own\n---\n');
  const r = install(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /patcher\.md/);
  assert.equal(fs.readFileSync(mine, 'utf8'), '---\nname: patcher\ndescription: my own\n---\n');
});

test('a second install changes nothing', () => {
  const dir = claudeDir({});
  install(dir);
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'speckit-patch')));
  const r = install(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /^(install|update) /m);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
  assert.equal(backups(dir).length, 1);
});

test('installed hook commands run through a shell from a path with a space', { skip: !spawnSync('bash', ['--version']).stdout }, () => {
  const dir = claudeDir();
  install(dir);
  const text = fs.readFileSync(path.join(dir, 'agents', 'implementer.md'), 'utf8');
  const commands = [...text.matchAll(/command: '(.+)'/g)].map((m) => m[1]);
  assert.equal(commands.length, 5);
  for (const cmd of commands) {
    // Claude Code runs hook commands in a shell (Git Bash on Windows). Outside a Spec Kit repo the
    // hook must exit 0, so this catches quoting and space-in-path breakage. It cannot catch the
    // $HOME (/c/Users/...) crash: an interactive Git Bash converts that path for node, Claude Code's
    // hook runner does not. The installer's own smoke check runs node without a shell and does.
    const r = spawnSync('bash', ['-c', cmd], { input: '{}', encoding: 'utf8', cwd: os.tmpdir() });
    assert.equal(r.status, 0, `${cmd}\n${r.stderr}`);
  }
});

test('refuses to replace agents it did not install, unless --force', () => {
  const dir = claudeDir();
  const mine = path.join(dir, 'agents', 'architect.md');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, '---\nname: architect\ndescription: my own\n---\n');

  const r = install(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /architect\.md/);
  assert.equal(fs.readFileSync(mine, 'utf8'), '---\nname: architect\ndescription: my own\n---\n');
  assert.ok(!fs.existsSync(path.join(dir, 'hooks')), 'nothing installed on refusal');

  assert.equal(install(dir, '--force').status, 0);
  assert.match(fs.readFileSync(mine, 'utf8'), /speckit-agents: managed/);
  const [backup] = fs.readdirSync(path.dirname(mine)).filter((f) => f.startsWith('architect.md.bak-'));
  assert.match(fs.readFileSync(path.join(path.dirname(mine), backup), 'utf8'), /my own/);
});

test('--dry-run writes nothing', () => {
  const dir = claudeDir({ hooks: { PreToolUse: [UNRELATED] } });
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  const r = install(dir, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] install/);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
});

test('--uninstall removes only what it installed', () => {
  const dir = claudeDir({ hooks: { PreToolUse: [UNRELATED] } });
  install(dir);
  fs.writeFileSync(path.join(dir, 'agents', 'my-agent.md'), '---\nname: my-agent\n---\n');
  const r = install(dir, '--uninstall');
  assert.equal(r.status, 0, r.stderr);
  for (const a of AGENTS) assert.ok(!fs.existsSync(path.join(dir, 'agents', `${a}.md`)), a);
  assert.ok(!fs.existsSync(path.join(dir, 'skills', 'speckit-team')));
  assert.ok(!fs.existsSync(path.join(dir, 'skills', 'speckit-patch')));
  assert.ok(!fs.existsSync(path.join(dir, 'hooks', 'speckit-team.mjs')));
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'my-agent.md')));
  assert.deepEqual(settingsOf(dir).hooks, { PreToolUse: [UNRELATED] });
});

test('a settings.json that is not JSON is left alone', () => {
  const dir = claudeDir('{ "hooks": { // a comment\n } }');
  const r = install(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{ "hooks": { // a comment\n } }');
  assert.deepEqual(fs.readdirSync(dir), ['settings.json'], 'no half install: fail before writing anything');
});

// JSON of the wrong shape parsed fine, then either crashed the installer with a TypeError after the
// agents were written, or (an array) went through with the gates silently left out.
test('a settings.json that is JSON but not settings is left alone too', () => {
  for (const text of ['null', '[]', '"x"', '{"hooks":[]}', '{"hooks":{"PreToolUse":{}}}', '{"hooks":{"PreToolUse":[null]}}',
    '{"hooks":{"PreToolUse":[{"hooks":{}}]}}', '{"hooks":{"PreToolUse":[{"hooks":[null]}]}}']) {
    const dir = claudeDir(text);
    const r = install(dir);
    assert.equal(r.status, 1, `${text}: ${r.stdout}`);
    assert.match(r.stderr, /settings\.json/, text);
    assert.doesNotMatch(r.stderr, /TypeError/, text);
    assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), text);
    assert.deepEqual(fs.readdirSync(dir), ['settings.json'], `${text}: no half install`);
  }
});

// Uninstall leaves the config as it found it (SC-009 as the owner decided on 2026-10-06): the same
// settings, in their own formatting, and no file or directory of the installer's left behind.
test('install then uninstall into an empty config dir leaves it empty', () => {
  const dir = claudeDir();
  assert.deepEqual(roundTrip(dir), []);
});

for (const [name, text] of [
  ['CRLF with 4 spaces', '{\r\n    "model": "opus",\r\n    "hooks": {\r\n        "PreToolUse": []\r\n    }\r\n}\r\n'],
  ['compact one line with inline arrays', '{"model":"opus","permissions":{"deny":["Grep","Glob"]}}'],
  ['tabs, no trailing newline', '{\n\t"model": "opus",\n\t"env": {\n\t\t"A": "1"\n\t}\n}'],
  ['a user\'s own empty hooks object', '{\n  "hooks": {}\n}\n'],
]) {
  test(`round trip restores ${name} byte for byte, with nothing left behind`, () => {
    const dir = claudeDir(text);
    assert.deepEqual(roundTrip(dir), ['settings.json']);
    assert.equal(bytes(dir).toString('utf8'), text);
  });
}

test('a change another tool made between install and uninstall is kept, in the file\'s own format', () => {
  const dir = claudeDir('{\r\n    "model": "opus"\r\n}\r\n');
  assert.equal(install(dir).status, 0);
  const s = settingsOf(dir);
  s.theme = 'dark';
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s, null, 4).replace(/\n/g, '\r\n') + '\r\n');
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['settings.json']);
  assert.equal(bytes(dir).toString('utf8'), '{\r\n    "model": "opus",\r\n    "theme": "dark"\r\n}\r\n');
});

test('a reinstall after another tool re-sorted settings.json changes nothing', () => {
  const dir = claudeDir({ hooks: { PreToolUse: [UNRELATED] } });
  install(dir);
  const s = settingsOf(dir);
  s.hooks.PreToolUse.reverse(); // the gate entry now comes first, as a key-sorting tool leaves it
  const resorted = JSON.stringify(s, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, 'settings.json'), resorted);
  const r = install(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), resorted);
});

test('uninstall removes the directories it created and keeps ones that were already there', () => {
  const dir = claudeDir();
  fs.mkdirSync(path.join(dir, 'agents'));
  assert.deepEqual(roundTrip(dir), ['agents']);
});

test('uninstall puts back an agent that --force replaced', () => {
  const dir = claudeDir();
  const mine = path.join(dir, 'agents', 'architect.md');
  fs.mkdirSync(path.dirname(mine));
  fs.writeFileSync(mine, '---\nname: architect\ndescription: my own\n---\n');
  assert.equal(install(dir, '--force').status, 0);
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.equal(fs.readFileSync(mine, 'utf8'), '---\nname: architect\ndescription: my own\n---\n');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'agents')), ['architect.md']);
});

test('--help lists every flag, --board, --no-board, --no-fork and --fork included', () => {
  const r = spawnSync(process.execPath, [INSTALL, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['--uninstall', '--dry-run', '--force', '--claude-dir', '--board', '--no-board', '--no-fork', '--fork']) assert.match(r.stdout, new RegExp(`${f}\\b`));
  assert.match(r.stdout, /\/speckit-patch/);
  assert.doesNotMatch(r.stdout, /^import/m);
});

// #78: in the 003 run fork subagents were on, all 53 agents ran in the background, and 24% of the main
// session's input was responses that only waited. --no-fork writes the setting once, for every project.
const forkEnv = (dir) => settingsOf(dir).env?.CLAUDE_CODE_FORK_SUBAGENT;
test('--no-fork turns fork subagents off in settings.json; reruns keep it; --fork and uninstall remove it', () => {
  const dir = claudeDir({ model: 'opus', env: { MY_VAR: '1' } });
  const before = bytes(dir);
  assert.equal(install(dir).status, 0);
  assert.equal(forkEnv(dir), undefined, 'opt-in: a plain install does not set it');
  let r = install(dir, '--no-fork');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(forkEnv(dir), '0');
  assert.equal(settingsOf(dir).env.MY_VAR, '1', "the user's own env is kept");
  assert.equal(install(dir).status, 0);
  assert.equal(forkEnv(dir), '0', 'a rerun without the flag keeps it');
  r = install(dir, '--fork');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(forkEnv(dir), undefined, '--fork removes what --no-fork wrote');
  assert.equal(install(dir, '--no-fork').status, 0);
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.deepEqual(bytes(dir), before, 'uninstall restores settings.json byte for byte');
});

test('--no-fork leaves a value the user set alone, and uninstall does not remove it', () => {
  for (const value of ['1', '0']) {
    const dir = claudeDir({ env: { CLAUDE_CODE_FORK_SUBAGENT: value } });
    assert.equal(install(dir, '--no-fork').status, 0);
    assert.equal(forkEnv(dir), value, `kept ${value}`);
    assert.equal(install(dir, '--fork').status, 0);
    assert.equal(forkEnv(dir), value, `--fork does not remove the user's ${value}`);
    assert.equal(install(dir, '--uninstall').status, 0);
    assert.equal(forkEnv(dir), value, `uninstall keeps the user's ${value}`);
  }
});

test('--no-fork into an empty config dir, then uninstall, leaves it empty', () => {
  const dir = claudeDir();
  assert.equal(install(dir, '--no-fork').status, 0);
  assert.equal(forkEnv(dir), '0');
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('--fork and --no-fork together, or an env that is not an object, are refused before anything is written', () => {
  const dir = claudeDir();
  const r = install(dir, '--fork', '--no-fork');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /contradict/);
  assert.deepEqual(fs.readdirSync(dir), []);
  const bad = claudeDir({ env: ['CLAUDE_CODE_FORK_SUBAGENT=0'] });
  const b = install(bad, '--no-fork');
  assert.equal(b.status, 1);
  assert.match(b.stderr, /"env" is an array/);
  assert.deepEqual(fs.readdirSync(bad), ['settings.json']);
});

test('--board and --no-board together are refused before anything is written', () => {
  const dir = claudeDir();
  const r = install(dir, '--board', '--no-board');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /contradict/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// The installer warns about git, claude or specify missing from PATH. It used to run `<cmd> --version`
// through a shell for each, and `specify --version` (a Python start through uv) took 548 of an
// install's 750 ms on Windows. It now looks for the file on PATH, as a shell would, and runs nothing.
test('the PATH check finds a command by its file and never runs it; a missing one is still named', () => {
  const dir = claudeDir();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'skpath-'));
  const ran = path.join(bin, 'ran');
  fs.writeFileSync(path.join(bin, 'specify'), `#!/bin/sh\necho x > "${ran}"\nexit 1\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'specify.cmd'), `@echo x> "${ran}"\r\n@exit /b 1\r\n`);
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const nodeDir = path.dirname(process.execPath);
  const r = spawnSync(process.execPath, [INSTALL, '--claude-dir', dir], { encoding: 'utf8', env: { ...process.env, [pathKey]: `${bin}${path.delimiter}${nodeDir}` } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /`specify` not found on PATH/, 'a specify file on PATH counts as found');
  assert.ok(!fs.existsSync(ran), 'and it was never run');
  const onNodePath = (cmd) => ['', '.exe', '.cmd'].some((x) => fs.existsSync(path.join(nodeDir, cmd + x)));
  if (!onNodePath('git')) assert.match(r.stdout, /WARNING: `git` not found on PATH/, 'a command on no PATH folder is named');
});

// The board goes in through `claude plugin`. When that fails (no claude, a broken one) the team
// still installs, the run fails naming the board, and uninstall warns and still removes the team.
// A claude that always fails goes first on PATH: CI's setup-node folder holds node and the real
// claude side by side, so trimming PATH to node's folder does not take claude away.
test('--board with a failing Claude Code installs the team, fails, and uninstall still cleans up', () => {
  const dir = claudeDir();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'skbin-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@exit /b 1\r\n');
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: `${bin}${path.delimiter}${process.env[pathKey]}` };
  const run = (...args) => spawnSync(process.execPath, [INSTALL, '--claude-dir', dir, ...args], { encoding: 'utf8', env });
  const i = run('--board');
  assert.equal(i.status, 1, i.stdout + i.stderr);
  assert.match(i.stderr, /the team is installed, the board mod is not installed/);
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'architect.md')));
  const u = run('--uninstall');
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.match(u.stdout, /WARNING: the board mod was not removed/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// Real `claude plugin` runs against the throwaway config dir. Spawned without a shell, so a missing
// claude, or an npm-installed claude.cmd, reports these skipped, not passed, except in CI, where
// SPECKIT_REQUIRE_CLAUDE=1 makes them run and fail.
const claudeIn = (dir, ...args) => spawnSync('claude', args, { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
const noClaude = spawnSync('claude', ['--version']).status === 0 || process.env.SPECKIT_REQUIRE_CLAUDE === '1' ? false : 'no claude executable on PATH';
const boardIn = (dir) => JSON.parse(claudeIn(dir, 'plugin', 'list', '--json').stdout).find((p) => p.id === 'speckit-board@speckit-agents');
const marketsIn = (dir) => JSON.parse(claudeIn(dir, 'plugin', 'marketplace', 'list', '--json').stdout).map((m) => m.name);
// Claude Code reports a folder by its real path: macOS's temp dir /var/... comes back as /private/var/....
const sameFolder = (a, b) => assert.equal(fs.realpathSync.native(a).toLowerCase(), fs.realpathSync.native(b).toLowerCase());

test('--board installs the mod read from this checkout; reruns keep it; --no-board removes it', { skip: noClaude }, () => {
  const dir = claudeDir();
  const i = install(dir, '--board');
  assert.equal(i.status, 0, i.stdout + i.stderr);
  const board = boardIn(dir);
  assert.equal(board?.scope, 'user');
  sameFolder(board.readFromFolder, path.join(path.dirname(INSTALL), 'mods', 'speckit-board'));

  const again = install(dir);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /unchanged\s+speckit-board@speckit-agents/);

  const off = install(dir, '--no-board');
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.equal(boardIn(dir), undefined);
  assert.ok(!marketsIn(dir).includes('speckit-agents'));
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'architect.md')), 'the team stays');
  const later = install(dir);
  assert.equal(later.status, 0, later.stdout + later.stderr);
  assert.equal(boardIn(dir), undefined, 'a rerun after --no-board does not bring it back');
});

test('uninstall removes the board and its marketplace and restores settings byte for byte', { skip: noClaude }, () => {
  // Not `model`: Claude Code rewrites "opus" to "opus[1m]" whenever a `claude` command touches it.
  const text = '{\n    "env": {\n        "A": "1"\n    }\n}\n';
  const dir = claudeDir(text);
  assert.equal(install(dir, '--board').status, 0);
  assert.ok(boardIn(dir));
  const u = install(dir, '--uninstall');
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.equal(boardIn(dir), undefined);
  assert.ok(!marketsIn(dir).includes('speckit-agents'));
  assert.equal(bytes(dir).toString('utf8'), text);
  assert.deepEqual(backups(dir), []);
});

test('--board from another checkout points the board at that checkout', { skip: noClaude }, () => {
  const dir = claudeDir();
  assert.equal(install(dir, '--board').status, 0);
  // A second checkout (a clone, a worktree, or this one moved) with what the installer reads.
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skagents-checkout-')), 'other checkout');
  for (const p of ['install.mjs', 'agents', 'hooks', 'skills', '.claude-plugin', path.join('mods', 'speckit-board')]) {
    fs.cpSync(path.join(path.dirname(INSTALL), p), path.join(other, p), { recursive: true });
  }
  const r = spawnSync(process.execPath, [path.join(other, 'install.mjs'), '--claude-dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  sameFolder(boardIn(dir).readFromFolder, path.join(other, 'mods', 'speckit-board'));
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.equal(boardIn(dir), undefined);
  assert.ok(!marketsIn(dir).includes('speckit-agents'));
});

test('a marketplace the user added is not removed with the board', { skip: noClaude }, () => {
  const dir = claudeDir();
  assert.equal(claudeIn(dir, 'plugin', 'marketplace', 'add', path.dirname(INSTALL)).status, 0);
  assert.equal(install(dir, '--board').status, 0);
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.equal(boardIn(dir), undefined);
  assert.ok(marketsIn(dir).includes('speckit-agents'));
});

// 005 US2, D2-A, D6-A: a board the user installed (here from the checkout's marketplace, standing in for
// the GitHub one) is not the installer's to remove; a board --board installed still is.
const userBoard = (dir) => {
  assert.equal(claudeIn(dir, 'plugin', 'marketplace', 'add', path.dirname(INSTALL)).status, 0);
  const p = claudeIn(dir, 'plugin', 'install', 'speckit-board@speckit-agents', '--scope', 'user');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(boardIn(dir));
};
const manifestPath = (dir) => path.join(dir, 'hooks', 'speckit-agents.install.json');

test('005 D6-A: a board the user installed survives --board then --uninstall, with its marketplace', { skip: noClaude }, () => {
  const dir = claudeDir();
  userBoard(dir);
  const i = install(dir, '--board');
  assert.equal(i.status, 0, i.stdout + i.stderr);
  assert.doesNotMatch(i.stdout, /git pull/, 'the board is not read from this checkout, so no git pull advice');
  const before = fs.readFileSync(manifestPath(dir));
  const again = install(dir, '--board');
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(fs.readFileSync(manifestPath(dir)), before, 'a rerun leaves the manifest byte for byte');
  const u = install(dir, '--uninstall');
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.ok(boardIn(dir), 'the user\'s board is still installed');
  assert.ok(marketsIn(dir).includes('speckit-agents'), 'and so is its marketplace');
});

test('005 D6-A: a board the user installed survives --board then --no-board, with its marketplace', { skip: noClaude }, () => {
  const dir = claudeDir();
  userBoard(dir);
  assert.equal(install(dir, '--board').status, 0);
  const off = install(dir, '--no-board');
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.ok(boardIn(dir), 'the user\'s board is still installed');
  assert.ok(marketsIn(dir).includes('speckit-agents'), 'and so is its marketplace');
});

test('005 D6-A: a board --board installed is still removed, also from a manifest without addedPlugin', { skip: noClaude }, () => {
  const dir = claudeDir();
  assert.equal(install(dir, '--board').status, 0);
  assert.ok(boardIn(dir));
  const m = JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8'));
  delete m.addedPlugin;
  fs.writeFileSync(manifestPath(dir), `${JSON.stringify(m, null, 2)}\n`);
  const u = install(dir, '--uninstall');
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.equal(boardIn(dir), undefined);
  assert.ok(!marketsIn(dir).includes('speckit-agents'));
});

// 006 D1, contract section 7: the gate also sees Agent launches, to record the team.
test('the gate entry matches Skill and Agent, replaces the older Skill-only one, and goes on uninstall (006 T005, contract 7)', () => {
  const dir = claudeDir({ hooks: { PreToolUse: [UNRELATED, {
    matcher: 'Skill', hooks: [{ type: 'command', command: 'node "C:/old/place/speckit-team.mjs" gate' }] }] } });
  const r = install(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const s = settingsOf(dir);
  assert.deepEqual(gates(s).sort(), GATES);
  assert.deepEqual(s.hooks.PreToolUse[0], UNRELATED);
  const entry = s.hooks.PreToolUse.find((g) => g.matcher === 'Skill|Agent');
  const hookPath = path.join(dir, 'hooks', 'speckit-team.mjs').split(path.sep).join('/');
  assert.equal(entry.hooks.length, 1);
  assert.equal(entry.hooks[0].command, `node "${hookPath}" gate`);
  assert.ok(!s.hooks.PreToolUse.some((g) => g.matcher === 'Skill'), 'no Skill-only entry of ours left');
  const first = bytes(dir);
  assert.equal(install(dir).status, 0);
  assert.ok(bytes(dir).equals(first), 'a second install changes no byte');
  assert.equal(install(dir, '--uninstall').status, 0);
  assert.deepEqual(gates(settingsOf(dir)), []);
  assert.deepEqual(settingsOf(dir).hooks, { PreToolUse: [UNRELATED] });
});

// #101, --team noagents: the typed /speckit-team starts a request and can record that no agent runs,
// so the UserPromptExpansion gate also matches it. A reinstall rewrites the older entry in place.
test('the UserPromptExpansion gate also matches a typed /speckit-team; a reinstall widens the older entry (#101, noagents)', () => {
  const old = 'speckit-implement|speckit\\.implement';
  const dir = claudeDir({ hooks: { UserPromptExpansion: [UNRELATED, {
    matcher: old, hooks: [{ type: 'command', command: 'node "C:/old/place/speckit-team.mjs" gate', timeout: 15 }] }] } });
  assert.equal(install(dir).status, 0);
  const s = settingsOf(dir);
  assert.deepEqual(gates(s).sort(), GATES);
  assert.deepEqual(s.hooks.UserPromptExpansion[0], UNRELATED, "the user's own entry stays first");
  assert.equal(s.hooks.UserPromptExpansion.length, 2, 'rewritten in place, not added beside the old one');
  const matcher = new RegExp(`^(${s.hooks.UserPromptExpansion[1].matcher})$`);
  for (const name of ['speckit-implement', 'speckit.implement', 'speckit-team']) assert.match(name, matcher, name);
  for (const name of ['speckit-patch', 'speckit-triage', 'speckit-specify']) assert.doesNotMatch(name, matcher, name);
  const first = bytes(dir);
  assert.equal(install(dir).status, 0);
  assert.ok(bytes(dir).equals(first), 'a second install changes no byte');
});

// 006 slices 4 to 6 (T008, T010, T012): the prompts carry contract sections 1 to 6 of
// specs/006-choose-team-size/contracts/team-choice.md. The prompts are read as installed.
const TEAM_ORDER = AGENTS.filter((a) => a !== 'patcher');
const teamSkill = () => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  return fs.readFileSync(path.join(dir, 'skills', 'speckit-team', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
};
const installedAgent = (a) => {
  const dir = claudeDir();
  assert.equal(install(dir).status, 0);
  return flat(fs.readFileSync(path.join(dir, 'agents', `${a}.md`), 'utf8'));
};
// The text of one `## ` section, heading line included, up to the next `## ` heading.
function skillSection(skill, heading) {
  const at = skill.indexOf(`\n${heading}`);
  assert.ok(at >= 0, `skill has a section ${heading}`);
  const rest = skill.slice(at + 1);
  const next = rest.indexOf('\n## ', 3);
  return next < 0 ? rest : rest.slice(0, next);
}
// The first 400 characters after a section's heading line: where a role condition must stand.
const sectionHead = (skill, heading) => flat(skillSection(skill, heading).split('\n').slice(1).join('\n')).slice(0, 400);

test('006 T008 FR-001 FR-005 FR-006: skill takes --team, names the six roles as the hook does, refuses before any launch', () => {
  const skill = teamSkill();
  assert.match(skill.split('\n').find((l) => l.startsWith('argument-hint:')), /--team/);
  assert.ok(skill.indexOf('\n## 0. Preconditions') < skill.indexOf('\n## Team'), '## Team comes after ## 0. Preconditions');
  assert.ok(skill.indexOf('\n## Team') < skill.indexOf('\n## 0b.'), '## Team comes before ## 0b.');
  const team = flat(skillSection(skill, '## Team'));
  const hookSrc = fs.readFileSync(path.join(path.dirname(INSTALL), 'hooks', 'speckit-team.mjs'), 'utf8');
  const inHook = hookSrc.match(/const TEAM_ROLES = \[([^\]]*)\]/)[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.deepEqual(inHook, TEAM_ORDER, 'TEAM_ROLES in the hook equals agents/*.md without patcher');
  const listed = new RegExp(TEAM_ORDER.map((r) => '`?' + r + '`?').join('[,\\s]+(?:and\\s+)?'));
  assert.match(team, listed, 'the six role names, in pipeline order');
  assert.match(team, /patcher/, 'patcher is named as not a team role');
  assert.match(team, /first word/i, '--team counts only as the first word');
  assert.match(team, /case-insensitive|case insensitive|regardless of case/i);
  assert.match(team, /twice|once/i, 'a name given twice counts once');
  assert.match(team, /order/i, 'order does not matter');
  assert.match(team, /ends? (in|with) a comma|does not end in a comma/i, 'the role list ends at the first word without a trailing comma');
  assert.match(team, /all six|every role|full team/i);
  assert.match(team, /before (anything|any agent|the first|launching)|nothing is launched|before any launch/i, 'the refusal comes before any launch');
  assert.match(team, /not a team role/i, 'unknown name refusal reason');
  assert.match(team, /empty/i, 'empty team refused');
  assert.match(team, /neither `?test-writer`? nor `?implementer`?/i, 'neither build role refused');
  assert.match(team, /`?architect`? without `?product-owner`?/i);
  assert.match(team, /`?spec-auditor`? without `?architect`?/i);
  assert.match(team, /one-line|one line/i, 'the start notice is one line');
  assert.match(team, /skipped/i, 'the start notice names the skipped steps');
});

test('006 T008 FR-002 US2-1: the Team line is quoted exactly, in pipeline order, and a full-team run has none', () => {
  const skill = teamSkill();
  assert.ok(flat(skill).includes('Team: test-writer, implementer'), 'the line is quoted in the contract form');
  const handoffs = flat(skillSection(skill, '## Handoffs'));
  assert.match(handoffs, /`?Team:`? line/);
  assert.match(handoffs, /full[- ]team run[^.]*\b(no|without|not)\b[^.]*Team|Team[^.]*\b(no|not|never)\b[^.]*full[- ]team/i, 'a full-team run carries no Team line');
  assert.match(handoffs, /lower case|lowercase/i);
  assert.match(handoffs, /pipeline order/i);
});

test('006 T010 FR-003 FR-004 FR-007 US1-1: every step names its role as its condition', () => {
  const skill = teamSkill();
  const cond = (heading, role) => assert.match(sectionHead(skill, heading), new RegExp(`\\b(only|skip|unless|without|when|if)\\b[^]*?${role}`, 'i'), `${heading} opens with the condition on ${role}`);
  cond('## 1.', 'product-owner');
  cond('## 2.', 'architect');
  cond('## 3.', 'spec-auditor');
  cond('## 6.', 'spec-gatekeeper');
  const zero = sectionHead(skill, '## 0b.');
  for (const r of ['architect', 'spec-auditor', 'spec-gatekeeper']) assert.ok(zero.includes(r), `## 0b. condition names ${r}`);
  assert.match(zero, /only|skip/i);
});

test('006 T010 FR-004 FR-008: findings and REJECTED reasons go to a chosen role, otherwise to the user', () => {
  const skill = teamSkill();
  const audit = flat(skillSection(skill, '## 3.'));
  assert.match(audit, /not (in the team|chosen)|absent|unchosen/i);
  assert.match(audit, /user/);
  const verify = flat(skillSection(skill, '## 6.'));
  assert.match(verify, /REJECTED[^.]*(not chosen|absent|unchosen|chosen)/i);
  assert.match(verify, /user/);
});

test('006 T010 FR-012 US1-2 US1-4: without product-owner the skill makes the team/ branch before the first launch, then runs one brief round', () => {
  const raw = teamSkill();
  const skill = flat(raw);
  assert.ok(skill.includes('git switch -c team/'), 'the branch command of contract section 4');
  assert.match(skill, /kebab case/);
  assert.match(skill, /at most 40 characters/);
  assert.match(skill, /(main|master)[^.]*before the first launch|before the first launch[^.]*(main|master)/i);
  const build = flat(skillSection(raw, '## 4-5.'));
  assert.match(build, /brief/i);
  assert.match(build, /one round/i);
  assert.match(build, /request text|approved `?spec\.md`?/i, 'the brief is the request text or the spec');
  assert.match(build, /`last round`/);
  assert.match(build, /stub pass[^.]*only when[^.]*missing production symbol|missing production symbol[^.]*stub/i);
  assert.match(build, /tick nothing|ticks nothing|no `?tasks\.md`?/i);
});

test('006 T010 FR-007 SC-003 contract 5: unbuilt tasks, the Unbuilt: line and the start of spec-gatekeeper', () => {
  const skill = teamSkill();
  assert.ok(flat(skill).includes('Unbuilt: T001, T003, T005'), 'the line is quoted in the contract form');
  const verify = flat(skillSection(skill, '## 6.'));
  assert.match(verify, /`?Unbuilt:`? line/);
  assert.match(verify, /implementer[^.]*absent|absent[^.]*implementer|without implementer/i, 'no implementer launched for an absent role');
  assert.match(verify, /test-writer[^.]*`?RED`?/, 'spec-gatekeeper starts after the last test-writer RED when implementer is absent');
  assert.match(verify, /chosen roles'? tasks|tasks of the chosen roles|task of a chosen role/i, 'the unticked-task rule is limited to the chosen roles');
  const handoffs = flat(skillSection(skill, '## Handoffs'));
  assert.match(handoffs, /spec-gatekeeper:[^]*`?Unbuilt:`?/, 'Handoffs names the Unbuilt: line for spec-gatekeeper');
  assert.match(handoffs, /next launch[^.]*(whichever|any) role|(whichever|any) role[^.]*next launch/i, 'approved files are committed with the next launch, whichever role');
});

test('006 T010 FR-007 D7: with no active feature the skill counts implementer REDs and hands the output to the user', () => {
  const build = flat(skillSection(teamSkill(), '## 4-5.'));
  assert.match(build, /no active feature/i);
  assert.match(build, /3 (implementer )?(`?RESULT: RED`?|REDs?) in a row/);
  assert.match(build, /(hand|give)s? the (failing )?output to the user/i);
  assert.match(build, /After 3 REDs in a row the hook blocks implementer/, 'the existing sentence still stands');
});

test('006 T010 FR-008 SC-005: the final report lists roles that ran, skipped rows, unticked tasks and the D7 count', () => {
  const report = flat(skillSection(teamSkill(), '## 7.'));
  assert.match(report, /roles? that ran|ran\b/i);
  assert.match(report, /skipped/i);
  assert.match(report, /unticked/i);
  assert.match(report, /retry limit[^.]*skill'?s count|skill'?s count[^.]*retry limit/i);
});

test('006 T010 FR-004 FR-005: step 0b runs only for architect, spec-auditor or spec-gatekeeper; without product-owner the draft goes with the first launch', () => {
  const zero = flat(skillSection(teamSkill(), '## 0b.'));
  assert.match(zero, /without `?product-owner`?[^.]*(first launch|commit)|(first launch|commit)[^.]*without `?product-owner`?/i);
  assert.match(zero, /first launch/);
  assert.match(zero, /template stays|skipped/i);
});

test('006 T010 FR-007 contract 5 (implementer row): without implementer a missing production symbol is red, a syntax error is still sent back, no stub step', () => {
  const build = flat(skillSection(teamSkill(), '## 4-5.'));
  assert.match(build, /(implementer is absent|without `?implementer`?|`?implementer`? (is )?absent)/i);
  assert.match(build, /missing production symbol or module[^.]*(red|lists)/i);
  assert.match(build, /syntax error[^.]*(sent|send)[^.]*back|still sends? back a syntax error/i);
  assert.match(build, /no stub (step|pass)|runs no stub|stub step[^.]*(skipped|not run)/i);
  assert.match(build, /A syntax error, a missing import or module, an undefined name or a compile error is a broken test/, 'the existing rule still stands for the full team');
});

test('006 T012 FR-012 contract 4: test-writer and implementer read a brief in place of task IDs and tick nothing', () => {
  for (const a of ['test-writer', 'implementer']) {
    const body = installedAgent(a);
    assert.match(body, /brief/i, `${a} reads a brief`);
    assert.match(body, /in place of (the )?task IDs|instead of (the )?task IDs/i, `${a}: brief in place of task IDs`);
    assert.match(body, /tick nothing|ticks nothing|do not tick|no `?tasks\.md`?/i, `${a} ticks nothing for a brief`);
  }
});

test('006 T012 FR-007 contract 5: test-writer without implementer in the Team line lists a missing production symbol and ends RED', () => {
  const body = installedAgent('test-writer');
  assert.match(body, /`?Team:`? line/);
  assert.match(body, /lacking `?implementer`?|without `?implementer`?|no `?implementer`?|`?implementer`? is (absent|not in)/i);
  assert.match(body, /instead of `?BLOCKED`?/i);
});

test('006 T012 FR-007 SC-003 SC-005 contract 5: spec-gatekeeper reads Team: and Unbuilt:, skips only Unbuilt IDs, reports absent-role checks as skipped', () => {
  const body = installedAgent('spec-gatekeeper');
  assert.match(body, /`?Team:`?/);
  assert.match(body, /`?Unbuilt:`?/);
  assert.match(body, /skips? (exactly )?(the )?`?Unbuilt:?`? (IDs|tasks)|`?Unbuilt:?`? IDs[^.]*skip/i, 'skips exactly the Unbuilt IDs');
  assert.match(body, /any other (open )?task[^.]*(rejects?|REJECTED)|other (open )?tasks? still/i, 'any other open task still rejects');
  assert.match(body, /no `?tasks\.md`?[^.]*skip|skips?[^.]*no `?tasks\.md`?/i, 'no tasks.md skips the open-task check');
  assert.match(body, /skipped[^.]*not (as )?a (REJECTED )?(reason|rejection)|not (as )?a REJECTED reason[^.]*skipped/i, 'a check whose role is absent is skipped, not a reason');
  assert.match(body, /no `?spec\.md`?[^.]*brief|brief[^.]*no `?spec\.md`?/i, 'traces the brief when there is no spec.md');
});

// 006 slice 7 (T014): contract section 8, the team question, in the installed skill's `## Team`.
test('006 T014 FR-010 US4-1 US4-2 contract 8: with no --team the skill asks one AskUserQuestion, full team first and recommended, answer checked like --team, a **Stop:**', () => {
  const team = skillSection(teamSkill(), '## Team');
  const flatTeam = flat(team);
  assert.match(flatTeam, /AskUserQuestion/, 'the question is an AskUserQuestion call');
  assert.match(flatTeam, /(no|without) (roles|`--team`)[^.]*ask|ask[^.]*(no roles|without `--team`|no `--team`)/i, 'asked when no roles are named');
  assert.match(flatTeam, /before (any|the first) (launch|agent)|before anything is launched/i, 'asked before any launch');
  assert.match(flatTeam, /single[- ]select|one choice|pick one/i, 'single select');
  assert.match(flatTeam, /Full team \(Recommended\)/, 'full team is the recommended option');
  const options = ['Full team', 'Build only', 'Implement only', 'Spec and build'].map((o) => flatTeam.indexOf(o));
  assert.ok(options.every((i) => i >= 0), 'all four options are listed');
  assert.deepEqual([...options].sort((a, b) => a - b), options, 'full team first, in contract order');
  assert.match(flatTeam, /Spec and build, no audit or verification[^.]*product-owner[^.]*architect[^.]*test-writer[^.]*implementer/i, 'fourth option carries its four roles');
  assert.match(flatTeam, /Other|free[- ]text/i, 'a free-text answer is possible');
  assert.match(flatTeam, /(free[- ]text|Other)[^.]*(refus|check)|(refus|check)[^.]*(free[- ]text|Other)/i, 'the free-text answer is checked by the same refusals');
  assert.match(flatTeam, /(never|not|no longer) asked|(is|are) not asked|does not ask|asks? nothing|only when/i, 'a request with --team is not asked');
  assert.match(flatTeam, /once/i, 'asked once');
  assert.ok(/\*\*Stop:\*\*/.test(team), 'the question is marked **Stop:**');
  const stopAt = team.indexOf('**Stop:**');
  assert.ok(stopAt > team.indexOf('AskUserQuestion'), 'the Stop marker belongs to the question');
});

// 006 T016 FR-011, constitution VIII, contract section 8: the docs say how to choose the team.
const repoText = (...p) => fs.readFileSync(path.join(path.dirname(INSTALL), ...p), 'utf8').replace(/\r\n/g, '\n');
const mdSection = (text, heading) => {
  const level = heading.match(/^#+/)[0].length;
  const start = text.indexOf('\n' + heading + '\n');
  if (start < 0) return '';
  const rest = text.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return end < 0 ? rest : rest.slice(0, end);
};
const WORD_NUM = { three: 3, four: 4 };

test('006 T016 FR-011: README has a "Choosing the team" section whose table names every role', () => {
  const sec = mdSection(repoText('README.md'), '#### Choosing the team');
  assert.ok(sec, 'README.md has a "#### Choosing the team" subsection');
  const hookSrc = repoText('hooks', 'speckit-team.mjs');
  const roles = hookSrc.match(/const TEAM_ROLES = \[([^\]]*)\]/)[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.equal(roles.length, 6);
  const rows = sec.split('\n').filter((l) => l.trim().startsWith('|'));
  for (const r of roles) {
    const row = rows.find((l) => l.includes(r));
    assert.ok(row, `the table has a row for ${r}`);
    assert.ok(row.split('|').filter((c) => c.trim()).length >= 3, `${r}'s row names the steps and the guardrails skipped`);
  }
  assert.match(sec, /--team/);
});

test('006 T016 FR-011: README guardrail table names Skill|Agent for the settings.json gate', () => {
  const row = repoText('README.md').split('\n').find((l) => /^\| `gate` \| `settings\.json`/.test(l));
  assert.ok(row, 'the gate row of the settings.json guardrail table');
  assert.ok(row.includes('Skill|Agent'), row);
});

// #107: `--team` is an argument of the slash command, so the help lists it under the slash commands,
// apart from the installer's own flags, and never as `node install.mjs --team`.
test('006 T016 FR-011, #107: node install.mjs --help names /speckit-team --team under the slash commands, not among the flags', () => {
  const lines = spawnSync(process.execPath, [INSTALL, '--help'], { encoding: 'utf8' }).stdout.split('\n');
  const heading = lines.findIndex((l) => /slash commands/i.test(l) && /not installer flags/i.test(l));
  assert.ok(heading >= 0, 'a heading that says these are slash commands, not installer flags');
  const flags = lines.findIndex((l) => /node install\.mjs --uninstall/.test(l));
  assert.ok(flags >= 0 && flags < heading, 'the installer flags come first, the slash commands after them');
  const team = lines.filter((l) => l.includes('--team'));
  assert.ok(team.length >= 1, '--help names --team');
  for (const l of team) assert.match(l, /\/speckit-team/, `every --team line names /speckit-team: ${l}`);
  assert.ok(lines.findIndex((l) => l.includes('--team')) > heading, 'under the heading');
  assert.ok(!lines.some((l) => /node install\.mjs\s+--team/.test(l)), 'never as an installer flag');
  assert.ok(lines.slice(heading).some((l) => /--team noagents/.test(l)), 'the no-agents run is named');
  for (const cmd of ['/speckit-patch', '/speckit-triage']) assert.ok(lines.slice(heading).some((l) => l.includes(cmd)), cmd);
});

// --team noagents: the main session runs Spec Kit's own commands, with no agent and no Team line.
test('noagents: the skill runs Spec Kit itself for a typed --team noagents, launches no agent and keeps the spec and plan stops', () => {
  const skill = teamSkill();
  const team = flat(skillSection(skill, '## Team'));
  assert.match(team, /`--team noagents`/, '## Team names --team noagents');
  assert.match(team, /typ(ed|ing|e it)/i, 'it is chosen by typing it');
  assert.match(team, /`?noagents`? (together )?with (a|any) role|`?noagents`? and (a|any) role/i, 'noagents with a role is refused');
  const na = skillSection(skill, '## No agents');
  const flatNa = flat(na);
  assert.match(flatNa, /no Agent call|launch(es)? no agent|never (call|launch)/i, 'no agent at all');
  assert.match(flatNa, /no `Team:` line/i);
  const order = ['speckit-specify', 'speckit-plan', 'speckit-tasks', 'speckit-implement'].map((s) => na.indexOf(`\`${s}\``));
  assert.ok(order.every((i) => i >= 0), `the four Spec Kit skills are named: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in pipeline order');
  assert.ok((na.match(/\*\*Stop:\*\*/g) || []).length >= 2, 'the spec stop and the plan stop');
  assert.match(flatNa, /AskUserQuestion/, 'open questions go to the user');
  assert.match(flatNa, /3 (failed )?(test )?runs?[^.]*in a row|3 times in a row/i, 'the fix loop is capped');
  assert.match(flatNa, /(audit|spec-auditor)[^.]*skipped|skipped[^.]*(audit|spec-auditor)/i, 'the report names the skipped audit');
  assert.match(flatNa, /## 7|step 7/i, 'hand-over as step 7');
  assert.match(flatNa, /denie[sd]|denial/i, 'what to do when the gate still denies speckit-implement');
  assert.ok(skill.indexOf('\n## No agents') > skill.indexOf('\n## Team') && skill.indexOf('\n## No agents') < skill.indexOf('\n## 0b.'),
    '## No agents sits between ## Team and ## 0b.');
});

test('noagents: README "Choosing the team" and the guardrail table describe --team noagents and the typed /speckit-team gate', () => {
  const sec = flat(mdSection(repoText('README.md'), '#### Choosing the team'));
  assert.match(sec, /--team noagents/);
  assert.match(sec, /speckit-specify[^.]*speckit-plan[^.]*speckit-tasks[^.]*speckit-implement/, 'the four Spec Kit commands, in order');
  const row = repoText('README.md').split('\n').find((l) => /^\| `gate` \| `settings\.json`/.test(l));
  assert.match(row, /speckit-team/, 'the settings.json gate row names the typed /speckit-team');
  assert.match(row, /noagents/);
});

test('006 T016 FR-011: CLAUDE.md Rules name the Team: and Unbuilt: lines as held by test/install.test.mjs', () => {
  const rules = mdSection(repoText('CLAUDE.md'), '## Rules');
  for (const word of ['Team:', 'Unbuilt:']) {
    const para = rules.split(/\n(?=- )/).find((p) => p.includes(word));
    assert.ok(para, `a Rules bullet names ${word}`);
    assert.ok(flat(para).includes('test/install.test.mjs'), `${word} is held by test/install.test.mjs`);
  }
});

test('006 T016 D4 contract 8: README says four stops, and the list names the team question first', () => {
  const readme = repoText('README.md');
  const a = flat(readme).match(/You decide at (\w+) stops/);
  assert.ok(a && WORD_NUM[a[1]] === 4, `"You decide at ... stops": ${a && a[0]}`);
  const b = flat(readme).match(/It stops for you at (\w+) points/);
  assert.ok(b && WORD_NUM[b[1]] === 4, `"It stops for you at ... points": ${b && b[0]}`);
  const after = readme.slice(readme.indexOf('It stops for you at')).split('\n').slice(1);
  const items = [];
  let cur = null;
  for (const l of after) {
    if (/^\d+\. /.test(l)) { cur = l; items.push(l); }
    else if (cur && /^\s+\S/.test(l)) items[items.length - 1] += ' ' + l.trim();
    else if (items.length && !l.trim()) break;
    else if (items.length) break;
  }
  assert.equal(items.length, 4, items.join(' / '));
  assert.match(items[0], /team/i, 'the first item is the team question');
  assert.match(flat(items[0]), /--team/, 'skipped when --team names the team');
});

test('006 T016 constitution VIII: README e2e counts equal the tests from the scope-hook case to the end of e2e.test.mjs', () => {
  const e2e = repoText('test', 'e2e.test.mjs');
  const from = e2e.indexOf("test(\"architect's and product-owner's scope hooks deny a Write outside their lanes\"");
  assert.ok(from >= 0, 'the anchor test exists');
  const n = (e2e.slice(from).match(/^test\(/gm) || []).length;
  const sec = flat(mdSection(repoText('README.md'), '### End-to-end tests'));
  assert.ok(sec.includes(`The ${n} tests fire every hook entry`), `README says "The ${n} tests fire every hook entry"`);
  assert.ok(sec.includes(`all ${n} fail`), `README says "all ${n} fail"`);
  assert.ok(sec.includes('Skill|Agent'), 'the sentence names the Skill|Agent gate');
});

// 006 T019 FR-010, US4-1, constitution VIII: the pipeline demo shows the team question.
test('006 T019 FR-010 US4-1: pipeline.tape answers the team question before the wait for the product owner dialog', () => {
  const tape = repoText('docs', 'media', 'pipeline.tape');
  const lines = tape.split('\n');
  assert.match(lines[0], /team/i, 'first-line comment names the team question');
  assert.match(lines[0], /product.owner/i, 'first-line comment names the product owner stop');
  const type = lines.findIndex((l) => /^Type "\/speckit-team /.test(l));
  const wait = lines.findIndex((l) => /^Wait\+Screen@10m \/Submit\|Esc to cancel\//.test(l));
  assert.ok(type >= 0 && wait > type, 'Type line, then the product owner wait');
  const between = lines.slice(type + 1, wait).join('\n');
  assert.match(between, /Wait\S* .*(Full team|team)/i, 'waits for the team dialog');
  assert.match(between, /^Enter$/m, 'answers with Enter (the first option, Full team)');
  const firstEnter = lines.slice(type + 1, wait).findIndex((l) => l === 'Enter');
  const teamWait = lines.slice(type + 1, wait).findIndex((l) => /Wait\S* .*team/i.test(l));
  assert.ok(teamWait >= 0 && firstEnter > teamWait, 'the Enter follows the wait for the team dialog');
});

test('006 T019 FR-010 US4-1: README "The pipeline" names the team question as the first of four stops', () => {
  const sec = flat(mdSection(repoText('README.md'), '### The pipeline'));
  assert.ok(!sec.includes("the first of the pipeline's three stops"), 'the old three-stop wording is gone');
  assert.match(sec, /team question[^.]*first of the pipeline's four stops/i, 'paragraph: team question is the first of four');
  assert.match(sec, /product-owner's questions[^.]*second/i, "product-owner's questions are the second");
  const alt = sec.match(/!\[([^\]]*)\]\(docs\/media\/pipeline\.gif\)/);
  assert.ok(alt, 'pipeline.gif image');
  assert.match(alt[1], /team/i, 'alt text names the team question');
});
