// Run: npm test (or node tools/test.mjs test/skills.test.mjs)
// What the installed skills (the 3 user ones and the 7 generated role skills) must satisfy by their text
// alone, no model: descriptions that do not collide (#188) and the authoring rules that can be checked (#189).
// agent-skills (addyosmani/agent-skills) runs a free lexical collision check in CI; this is ours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_SKILLS = ['speckit-team', 'speckit-patch', 'speckit-triage'];

// The skills as install.mjs writes them: the role skills exist only after an install.
function installed() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skskills-')), 'claude dir');
  fs.mkdirSync(dir);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'install.mjs'), '--claude-dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return fs.readdirSync(path.join(dir, 'skills')).sort().map((name) => {
    const text = fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    return { name, text, description: /^description: (.*)$/m.exec(text)?.[1] ?? '', lines: text.split('\n').length };
  });
}

const STOP = new Set('a an the of in on to for and or with is it its this that by as at from be run only'.split(' '));
const words = (s) => new Set((s.toLowerCase().match(/[a-z][a-z-]+/g) ?? []).filter((w) => !STOP.has(w)));
// Share of the words two descriptions have in common, 0 to 1.
export function overlap(a, b) {
  const [x, y] = [words(a), words(b)];
  const both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both || 1);
}
// Pairs of skills whose descriptions say too much of the same, so a model routing on them could take the wrong one.
export function collisions(skills, limit) {
  // Pairs are listed in the order given, so a caller that wants one skill against many puts it first.
  const out = [];
  for (let i = 0; i < skills.length; i++) for (let j = i + 1; j < skills.length; j++) {
    const o = overlap(skills[i].description, skills[j].description);
    if (o > limit) out.push(`${skills[i].name} / ${skills[j].name}: ${o.toFixed(2)}`);
  }
  return out;
}

test('skills: there are three user skills and seven role skills, each with a description', () => {
  const skills = installed();
  assert.deepEqual(skills.filter((s) => !s.name.startsWith('speckit-role-')).map((s) => s.name).filter((n) => !n.startsWith('speckit-') || USER_SKILLS.includes(n)), USER_SKILLS.slice().sort());
  assert.equal(skills.filter((s) => s.name.startsWith('speckit-role-')).length, 7);
  for (const s of skills) assert.ok(s.description.length > 20, `${s.name} has a description`);
});

// Measured 2026-10-27: the user skills overlap at most 0.07 with each other and with a role skill.
test("skills: no user skill's description collides with another skill's (#188)", () => {
  const skills = installed();
  const user = skills.filter((s) => USER_SKILLS.includes(s.name));
  assert.deepEqual(collisions(user, 0.25), [], 'among the user skills');
  for (const u of user) assert.deepEqual(collisions([u, ...skills.filter((s) => s.name.startsWith('speckit-role-'))], 0.25).filter((c) => c.startsWith(u.name)), [], `${u.name} against the role skills`);
});

// The seven role skills share one template on purpose (the orchestrating skill names them, a model does not
// pick among them), so they overlap by construction. What must hold is that the role name is all that differs.
test('skills: the role skills\' descriptions differ by their role name and nothing else', () => {
  const roles = installed().filter((s) => s.name.startsWith('speckit-role-'));
  const generic = new Set(roles.map((s) => s.description.replace(s.name.slice('speckit-role-'.length), '<role>')));
  assert.equal(generic.size, 1, [...generic].join(' | '));
  assert.equal(new Set(roles.map((s) => s.description)).size, roles.length, 'no two are identical');
});

test('skills: the collision check fails on two descriptions that say the same thing', () => {
  const same = [{ name: 'a', description: 'Run a feature through the Spec Kit agent team and stop where a human decides.' },
    { name: 'b', description: 'Run a feature through the Spec Kit agent team, stopping where a human decides.' }];
  assert.equal(collisions(same, 0.25).length, 1);
  assert.deepEqual(collisions([same[0], { name: 'c', description: 'Suggest a track for a change and run nothing.' }], 0.25), []);
});

// #189: the authoring rules that a test can hold. Each check is a function over text so it can be shown failing
// on a violating fixture; the model-neutrality rule is a review criterion in the constitution, not a test.
const MAX_SKILL_LINES = 500; // agent-skills' docs/skill-anatomy.md; speckit-team is 375 at 2026-10-27
const MAX_ROLE_LINES = 150; // a role skill is its agent's body plus a preamble; architect's is 143
const MAX_DESCRIPTION = 1024;
const MODEL_NAME = /\b(opus|sonnet|haiku|fable)\b|claude-[a-z]+-\d/i;
export const problems = {
  description: (s) => (s.description.length > MAX_DESCRIPTION ? [`${s.name}: description is ${s.description.length} characters, over ${MAX_DESCRIPTION}`] : []),
  lines: (s) => (s.lines > MAX_SKILL_LINES ? [`${s.name}: ${s.lines} lines, over ${MAX_SKILL_LINES}`] : []),
  roleLines: (s) => (s.name.startsWith('speckit-role-') && s.lines > MAX_ROLE_LINES ? [`${s.name}: ${s.lines} lines, over the role budget of ${MAX_ROLE_LINES}`] : []),
  modelName: (s) => {
    const body = s.text.replace(/^---\n[\s\S]*?\n---\n/, ''); // frontmatter excluded: `model:` lives there
    const m = MODEL_NAME.exec(body);
    return m ? [`${s.name}: names the model "${m[0]}" in its body`] : [];
  },
};
const fixture = (over) => ({ name: 'speckit-role-x', description: 'd', lines: 10, text: '---\nname: x\n---\nbody\n', ...over });

test('skills: every installed skill is within the description, line and model-name rules (#189)', () => {
  const skills = installed();
  const found = skills.flatMap((s) => Object.values(problems).flatMap((check) => check(s)));
  assert.deepEqual(found, []);
});

test('skills: the agent bodies name no model, so a role skill runs on whichever model the session has (#189)', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'agents')).filter((n) => n.endsWith('.md'))) {
    const body = fs.readFileSync(path.join(ROOT, 'agents', f), 'utf8').replace(/\r\n/g, '\n').split(/^---$/m).slice(2).join('---');
    assert.doesNotMatch(body, MODEL_NAME, `agents/${f}`);
  }
});

test('skills: each authoring check fails on a skill that breaks its rule (#189)', () => {
  assert.equal(problems.description(fixture({ description: 'x'.repeat(1025) })).length, 1);
  assert.equal(problems.description(fixture({ description: 'x'.repeat(1024) })).length, 0);
  assert.equal(problems.lines(fixture({ lines: 501 })).length, 1);
  assert.equal(problems.roleLines(fixture({ lines: 151 })).length, 1);
  assert.equal(problems.roleLines(fixture({ name: 'speckit-team', lines: 151 })).length, 0, 'the role budget is for role skills');
  assert.equal(problems.modelName(fixture({ text: '---\nname: x\n---\nRun this on Opus.\n' })).length, 1);
  assert.equal(problems.modelName(fixture({ text: '---\nname: x\nmodel: opus\n---\nRun it.\n' })).length, 0, 'the frontmatter is not the body');
});
