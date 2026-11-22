// Run: npm test (or node tools/test.mjs test/versions.test.mjs)
// Every tool version lives in one place, so a Dependabot pull request changes it everywhere at once
// and is never red because a second copy lags behind. eslint and typescript are package.json's
// devDependencies, which CI and the pre-commit hook run from node_modules; Claude Code's CI version is
// package.json's config.claudeCode, the oldest supported, which Dependabot does not see; vhs is one
// env block. github/codeql-action's steps must share a version, so Dependabot bumps them as one group
// (#146, #147 and #149 were each red alone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));
const WORKFLOWS = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter((f) => f.endsWith('.yml'));

test('versions: package.json pins eslint and typescript exactly, and the lockfile agrees', () => {
  for (const name of ['eslint', 'typescript']) {
    assert.match(pkg.devDependencies?.[name] ?? '', /^\d+\.\d+\.\d+$/, `${name} is an exact devDependency`);
    const lock = JSON.parse(read('package-lock.json'));
    assert.equal(lock.packages?.[`node_modules/${name}`]?.version, pkg.devDependencies[name], `package-lock.json has ${name} at the same version`);
  }
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'no runtime dependency (constitution IV)');
  assert.match(pkg.config?.claudeCode ?? '', /^\d+\.\d+\.\d+$/, 'config.claudeCode names the Claude Code version CI installs');
});

test('versions: no workflow spells out a version package.json holds', () => {
  for (const f of WORKFLOWS) {
    const wf = read('.github', 'workflows', f);
    assert.doesNotMatch(wf, /@anthropic-ai\/claude-code@\d/, `${f} installs Claude Code at a literal version`);
    assert.doesNotMatch(wf, /\b(eslint|typescript)@\d/, `${f} runs eslint or typescript at a literal version`);
    for (const line of wf.split('\n').filter((l) => /npm install -g .*claude-code/.test(l))) {
      assert.match(line, /require\('\.\/package\.json'\)\.config\.claudeCode/, `${f}: Claude Code's version comes from package.json`);
    }
  }
  const t = read('.github', 'workflows', 'test.yml');
  assert.match(t, /npx --no-install eslint /, 'CI lints with the eslint npm ci installed');
  assert.match(t, /npx --no-install tsc /, 'CI type-checks with the typescript npm ci installed');
  assert.match(t, /^\s+run: npm ci\b/m, 'CI installs the devDependencies from the lockfile');
});

// #399: on Claude Code 2.1.330 a headless session that is not logged in stops before it loads the mod, so
// it lays no types; an interactive one against the fake API does. The check runs where the live-board
// job's session has just loaded the mod from this checkout, on every Claude Code the jobs install.
test('versions: the board type-check runs after the live-board session laid its types, on every leg (#399)', () => {
  const t = read('.github', 'workflows', 'test.yml');
  const jobAt = (name) => t.search(new RegExp(`^  ${name}:$`, 'm'));
  const step = (name) => {
    const at = t.indexOf(`- name: ${name}`);
    assert.ok(at > 0, `test.yml has a step "${name}"`);
    const rest = t.slice(at + 1);
    const end = rest.search(/^ {6}- (name|uses|run):/m);
    return { at, text: end < 0 ? rest : rest.slice(0, end) };
  };
  const check = step('Type-check the board mod (Linux)');
  const band = t.indexOf('node tools/live-board.mjs band');
  assert.ok(jobAt('live-board') > 0 && check.at > jobAt('live-board'), 'the type-check is a live-board step');
  assert.ok(band > 0 && check.at > band, 'it runs after the band run has loaded the mod');
  assert.match(check.text, /test -f mods\/speckit-board\/tsconfig\.json/, 'a session that laid nothing fails the step');
  assert.match(check.text, /npx --no-install tsc -p mods\/speckit-board --noEmit/);
  assert.doesNotMatch(check.text, /inputs\.claude-code/, 'latest.yml legs type-check too');
  assert.doesNotMatch(t, /claude --plugin-dir mods\/speckit-board -p /, 'no headless session is relied on to lay the types');
  const install = step('Install typescript (Linux)');
  assert.ok(install.at > jobAt('live-board') && install.at < check.at, 'the live-board job installs typescript before the check');
});

test('versions: vhs and its checksums are one env block, used through it', () => {
  const t = read('.github', 'workflows', 'test.yml');
  const env = /^ {6}VHS_VERSION: '?(\d+\.\d+\.\d+)'?$/m.exec(t);
  assert.ok(env, 'test.yml sets VHS_VERSION in the live-board job env');
  assert.match(t, /^ {6}VHS_SHA256_LINUX: '?[0-9a-f]{64}'?$/m);
  assert.match(t, /^ {6}VHS_SHA256_MACOS: '?[0-9a-f]{64}'?$/m);
  assert.equal(t.split(env[1]).length - 1, 1, `vhs ${env[1]} appears once`);
});

test('versions: the pre-commit eslint hook runs the eslint package.json pins', () => {
  const pc = read('.pre-commit-config.yaml');
  assert.doesNotMatch(pc, /mirrors-eslint/, 'no second eslint pin in pre-commit');
  // Not npx: without node_modules, `npx --no-install eslint` ran eslint 10.13.0 from npx's cache and
  // passed (2026-10-24). The file itself is only the pinned eslint, and without `npm ci` the hook fails.
  assert.match(pc, /- id: eslint\n\s+name: [^\n]*npm ci[^\n]*\n\s+entry: node node_modules\/eslint\/bin\/eslint\.js\n\s+language: system/);
});

test('versions: Dependabot bumps codeql-action as one group, and watches npm and pre-commit too', () => {
  const d = read('.github', 'dependabot.yml');
  for (const eco of ['github-actions', 'npm', 'pre-commit']) assert.match(d, new RegExp(`package-ecosystem: ${eco}\\n`), `${eco} is watched`);
  assert.match(d, /groups:\n\s+codeql-action:\n\s+patterns:\n\s+- 'github\/codeql-action\*'/, 'codeql-action steps come as one pull request');
});

test('versions: the docs give the CI Claude Code version package.json holds, and no eslint or typescript version', () => {
  const v = pkg.config.claudeCode;
  const readme = read('README.md');
  const claudeMd = read('CLAUDE.md');
  assert.ok(readme.includes(`Claude_Code-${v.replaceAll('.', '.')}_in_CI`), `README badge says ${v}`);
  assert.ok(claudeMd.includes(`Claude Code ${v}`), `CLAUDE.md says ${v}`);
  for (const [name, text] of [['README.md', readme], ['CLAUDE.md', claudeMd]]) {
    assert.doesNotMatch(text, /eslint[ @]\d|typescript@\d/, `${name} spells out a version package.json holds`);
  }
});

// #223: the Node floor was 18 in package.json, the README, the setup scripts, the installer and the
// constitution, while CI tested 22 only and 18 and 20 had reached end of life. The owner raised it to 22
// (2026-10-31). package.json's engines is the one place; every other statement of it must agree, and CI
// runs the floor itself, as it runs the oldest supported Claude Code.
test('versions (#223): every statement of the Node floor equals package.json engines, and CI runs that Node', () => {
  const floor = /^>=(\d+)$/.exec(pkg.engines?.node ?? '')?.[1];
  assert.equal(floor, '22', 'engines.node is >=22');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages?.['']?.engines?.node, pkg.engines.node, 'package-lock.json agrees');
  const says = (file, re) => {
    const found = [...read(file).matchAll(re)].map((m) => m[1]);
    assert.ok(found.length, `${file} states the floor`);
    for (const n of found) assert.equal(n, floor, `${file} says Node ${n}`);
  };
  says('setup.sh', /Node (\d+)(?:\+| or newer)/g);
  says('setup.sh', /-lt (\d+) \]/g);
  says('setup.ps1', /Node (\d+)(?:\+| or newer)/g);
  says('setup.ps1', /-lt (\d+)\)/g);
  says('install.mjs', /major < (\d+)\b/g);
  says('install.mjs', /need Node (\d+) or newer/g);
  says(path.join('.specify', 'memory', 'constitution.md'), /\(Node (\d+) or newer\)/g);
  says('README.md', /badge\/Node-(\d+)%2B/g);
  says('README.md', /\[Node\]\(https:\/\/nodejs\.org\) (\d+)\+/g);
  // test.yml takes a Node channel from latest.yml (#381): its fallback, the version every other run uses, is the floor.
  for (const f of WORKFLOWS.filter((w) => w !== 'latest.yml')) {
    for (const m of read('.github', 'workflows', f).matchAll(/node-version: (\$\{\{ inputs\.node-version \|\| (\d+) \}\}|\S+)/g)) {
      assert.equal(m[2] ?? m[1], floor, `${f} runs Node ${m[1]}`);
    }
  }
});

// #381: test.yml runs on the oldest supported Claude Code and the Node floor. latest.yml calls the same jobs weekly with
// channels, never versions: latest for Claude Code and '*' (the newest stable release) for Node, so nothing here is a second
// pin to move. Not current: setup-node took it to v27.0.0-alpha.0.1.1, a prerelease.
test('versions (#381): latest.yml runs test.yml on the latest Claude Code and the newest stable Node, by channel', () => {
  const latest = read('.github', 'workflows', 'latest.yml');
  assert.match(latest, /uses: \.\/\.github\/workflows\/test\.yml\n\s+with:\n\s+claude-code: latest\n\s+node-version: '\*'\n/);
  assert.match(latest, /schedule:/);
  assert.match(latest, /workflow_dispatch:/);
  assert.doesNotMatch(latest, /@anthropic-ai\/claude-code@|node-version: \d/, 'no version of its own');
  const t = read('.github', 'workflows', 'test.yml');
  assert.match(t, /workflow_call:\n\s+inputs:\n\s+claude-code:[\s\S]*?default: ''\n\s+node-version:[\s\S]*?default: ''/, 'both inputs default to the pinned versions');
  const installs = t.split('\n').filter((l) => /npm install -g .*claude-code/.test(l));
  assert.equal(installs.length, 2);
  for (const l of installs) assert.match(l, /npm install -g --allow-scripts=@anthropic-ai\/claude-code "@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_TAG:-\$\(node -p "require\('\.\/package\.json'\)\.config\.claudeCode"\)\}/);
});
