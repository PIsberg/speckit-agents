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
  assert.deepEqual(gates(s).sort(), ['PreToolUse:Skill', 'UserPromptExpansion:speckit-implement|speckit\\.implement']);
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
