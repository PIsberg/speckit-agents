// Run: npm test (or node --test "test/versions.test.mjs")
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
