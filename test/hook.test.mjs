// Run: npm test (or node tools/test.mjs test/hook.test.mjs)
// Drives speckit-team.mjs exactly as Claude Code does: hook JSON on stdin, decision on stdout. The fast
// track's patch mode is in hook-patch.test.mjs, so the two files run side by side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { HOOK, FEAT, repo, run, write, denied, pass, handback, decided, stateDir, commitAll, msg } from './hook-helpers.mjs';


// 003 FR-010 for `scope protected` and `patch`.
test('every mode is a no-op outside a Spec Kit repo', () => {
  const { dir } = repo({ speckit: false });
  assert.equal(write(dir, ['scope', 'only', 'specs/'], 'src/main/App.java'), null);
  assert.equal(write(dir, ['scope', 'protected'], '.github/workflows/x.yml'), null, 'scope protected');
  assert.equal(run(dir, ['gate'], { hook_event_name: 'UserPromptExpansion', command_name: 'speckit-implement' }), null);
  assert.equal(run(dir, ['patch'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'p1' }), null, 'patch');
});

test('scope only: planning agents write specs and CLAUDE.md, nothing else', () => {
  const { dir } = repo();
  const only = ['scope', 'only', 'specs/', 'CLAUDE.md'];
  assert.equal(write(dir, only, `${FEAT}/plan.md`), null);
  assert.equal(write(dir, only, 'CLAUDE.md'), null);
  assert.ok(denied(write(dir, only, 'src/main/App.java')));
  assert.ok(denied(write(dir, only, 'CLAUDE.md.bak')));
  assert.equal(write(dir, only, path.join('..', 'outside-repo.txt')), null, 'paths outside the repo are not its business');
});

// The repo reached through another name for the same folder: a symlink (macOS's /var is
// /private/var), a Windows junction, an 8.3 short name (C:\Users\RUNNER~1). git reports the real
// path, Claude Code passes the one it was given; compared unresolved, every file looked outside the
// repo and every lane let it through. Found by CI on macOS and Windows.
test('scope holds when the repo is reached through a symlink or junction', (t) => {
  const { dir } = repo();
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sklink-')), 'repo link');
  try { fs.symlinkSync(dir, link, 'junction'); } catch { t.skip('no symlink or junction privilege'); return; }
  const only = ['scope', 'only', 'specs/', 'CLAUDE.md'];
  assert.ok(denied(write(link, only, 'src/main/App.java')), 'cwd and file both through the link');
  assert.ok(denied(run(dir, only, { hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(link, 'src', 'main', 'App.java') } })), 'only the file through the link');
  assert.equal(write(link, only, `${FEAT}/plan.md`), null);
  assert.equal(write(link, only, 'CLAUDE.md'), null);
  assert.ok(denied(write(link, ['scope', 'tests'], 'src/main/App.java')));
  assert.ok(denied(write(link, ['scope', 'no-tests'], 'src/test/java/AppTest.java')));
});

test('scope tests: test-writer writes test files and tasks.md only', () => {
  const { dir } = repo();
  for (const f of ['src/test/java/AppTest.java', 'tests/test_app.py', 'web/app.test.ts', 'pkg/app_test.go', `${FEAT}/tasks.md`]) {
    assert.equal(write(dir, ['scope', 'tests'], f), null, f);
  }
  for (const f of ['src/main/App.java', `${FEAT}/spec.md`, 'specs/test.md']) {
    assert.ok(denied(write(dir, ['scope', 'tests'], f)), f);
  }
});

test('scope no-tests: implementer cannot touch tests', () => {
  const { dir } = repo();
  assert.equal(write(dir, ['scope', 'no-tests'], 'src/main/App.java'), null);
  assert.ok(denied(write(dir, ['scope', 'no-tests'], 'src/test/java/AppTest.java')));
  assert.ok(denied(write(dir, ['scope', 'no-tests'], 'spec/app_spec.rb')));
});

// Flagged by a security review on 2026-10-07: implementer's lane (anything but tests) included
// .git/speckit-team/, so it could delete its own retry record or forge a verdict with Write.
test('no agent may write the guardrail state under .git/', () => {
  const { dir } = repo();
  for (const args of [['scope', 'no-tests'], ['scope', 'tests'], ['scope', 'only', 'specs/', 'CLAUDE.md']]) {
    const out = write(dir, args, '.git/speckit-team/retries/001-demo.json');
    assert.ok(denied(out), args.join(' '));
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /guardrail state/);
  }
  assert.equal(write(dir, ['scope', 'no-tests'], '.github/workflows/ci.yml'), null, '.github is not .git');
});

// Second review, same day: the guard compared the literal path, and ran after the "outside the
// repo" early exit, so spellings Windows folds together and a linked worktree's state got through.
test('the .git/ guard holds for other spellings and from a linked worktree', () => {
  const { dir, g } = repo();
  const spellings = ['.git./speckit-team/retries/001-demo.json', '.git/../.git/speckit-team/verdicts/001-demo.json'];
  // Any case-insensitive file system, not only Windows: macOS's default APFS volume is one too.
  if (fs.existsSync(path.join(dir, '.GIT'))) spellings.push('.GIT/speckit-team/retries/001-demo.json');
  for (const f of spellings) assert.ok(denied(write(dir, ['scope', 'no-tests'], f)), f);

  const wt = `${dir}-wt`;
  g('worktree', 'add', '-q', wt);
  const out = run(wt, ['scope', 'no-tests'], {
    hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, '.git', 'speckit-team', 'retries', '001-demo.json') },
  });
  assert.ok(denied(out), 'the shared state of the main checkout, written from a worktree');
  assert.equal(write(wt, ['scope', 'no-tests'], 'src/main/Other.java'), null, 'normal work in the worktree');
});

// implementer's lane was "anything but tests", which included .specify/: pointing feature.json at
// another audited feature reset its retry count, and test-paths decides what its lane is.
test('implementer may not write the Spec Kit config under .specify/', () => {
  const { dir, write: w } = repo();
  for (const f of ['.specify/feature.json', '.specify/test-paths', '.specify/memory/constitution.md']) {
    const out = write(dir, ['scope', 'no-tests'], f);
    assert.ok(denied(out), f);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /\.specify\//, f);
  }
  assert.equal(write(dir, ['scope', 'no-tests'], `${FEAT}/tasks.md`), null, 'ticking tasks is still allowed');
  assert.equal(write(dir, ['scope', 'no-tests'], '.specifyx/notes.md'), null, 'only the .specify folder itself');

  pass(dir);
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'sp1' });
  w('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/000-old' }));
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'sp1' });
  assert.equal(out?.decision, 'block', 'a Bash write to .specify/ is caught at stop');
  assert.match(out.reason, /\.specify\/feature\.json/);
});

test('.specify/test-paths adds repo-specific test patterns', () => {
  const { dir, write: w } = repo();
  assert.equal(write(dir, ['scope', 'no-tests'], 'checks/golden.txt'), null);
  w('.specify/test-paths', '# golden files\n^checks/\n');
  assert.ok(denied(write(dir, ['scope', 'no-tests'], 'checks/golden.txt')));
});

// #372: the built-in patterns call every path under testing/, fixtures/, spec/ or e2e/ a test, and test-paths could only
// add. A repo keeping production files there had implementer denied them and test-writer let in. A `!` line takes
// the paths it matches out of the test lane, after every pattern that adds.
test('#372: a ! line in .specify/test-paths takes production folders out of the test lane', () => {
  const { dir, write: w } = repo();
  pass(dir);
  const files = ['src/mylib/testing/assertions.py', 'api/spec/openapi.yaml', 'db/fixtures/seed.sql', 'packages/e2e/src/index.ts'];
  const as = (type, args, f) => denied(run(dir, args, { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: type, agent_id: type, tool_input: { file_path: path.join(dir, f) } }));
  for (const f of files) assert.ok(as('implementer', ['gate', 'retries', 'scope', 'no-tests'], f), `${f} is a test by default`);
  w('.specify/test-paths', '# production folders\n!^src/mylib/testing/\n!^api/spec/\n  !^db/fixtures/\n!^packages/e2e/src/\n');
  for (const f of files) {
    assert.equal(as('implementer', ['gate', 'retries', 'scope', 'no-tests'], f), false, `implementer writes ${f}`);
    assert.equal(as('test-writer', ['gate', 'scope', 'tests'], f), true, `test-writer may not write ${f}`);
  }
  assert.ok(as('implementer', ['gate', 'retries', 'scope', 'no-tests'], 'db/test/seed.test.js'), 'other tests stay tests');
  assert.ok(as('implementer', ['gate', 'retries', 'scope', 'no-tests'], 'checks/golden.txt') === false);
  w('.specify/test-paths', '^checks/\n!^checks/tools/\n');
  assert.ok(as('implementer', ['gate', 'retries', 'scope', 'no-tests'], 'checks/golden.txt'), 'an added pattern still adds');
  assert.equal(as('implementer', ['gate', 'retries', 'scope', 'no-tests'], 'checks/tools/run.sh'), false, 'and a ! line takes out of it too');
});

test('#372: a ! line that is no regex, or empty, closes the test lanes and names the line', () => {
  const { dir, write: w } = repo();
  for (const [text, line] of [['!(unclosed\n', 1], ['^checks/\n!\n', 2]]) {
    w('.specify/test-paths', text);
    const out = write(dir, ['scope', 'no-tests'], 'src/main/App.java');
    assert.ok(denied(out), text);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, new RegExp(`test-paths line ${line} `));
  }
});

// A line that was not a valid regex crashed scope, and a crashed hook lets the write through: one typo
// in test-paths, or one written there by implementer, opened every test file to it.
test('an invalid .specify/test-paths line closes the test lanes and names the line', () => {
  const { dir, write: w, g } = repo();
  w('.specify/test-paths', '^checks/\n\n(unclosed\n');
  for (const [args, f] of [[['scope', 'no-tests'], 'src/test/java/AppTest.java'], [['scope', 'no-tests'], 'src/main/App.java'],
    [['scope', 'tests'], 'src/test/java/AppTest.java']]) {
    const out = write(dir, args, f);
    assert.ok(denied(out), `${args.join(' ')} ${f}`);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /test-paths line 3 .*\(unclosed/);
  }
  assert.equal(write(dir, ['scope', 'only', 'specs/'], `${FEAT}/plan.md`), null, 'scope only does not use test patterns');

  g('add', '-A'); g('commit', '-qm', 'bad pattern');
  pass(dir);
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'tp1' });
  w('src/test/java/AppTest.java', 'class AppTest {}\n');
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'tp1' });
  assert.ok(!decided(out));
  assert.match(out?.systemMessage ?? '', /lane check could not run.*test-paths line 3/);
});

// #210: a write through Bash was only caught by the lane check at Stop, after the file had changed.
// scope now reads a Bash command's write targets and judges each one as it judges a Write.
const bash = (dir, args, command, extra = {}) => run(dir, args, {
  hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...extra,
});
const whyDenied = (out) => out?.hookSpecificOutput?.permissionDecisionReason ?? '';

// #337: test-writer and implementer ran two hook processes (gate, then scope) on every write and Bash
// call. `gate ... scope <rule>` is both in one process: the gate first, then the scope rule on a write tool.
test('#337: gate with a scope rule denies as gate, then as scope on a write tool, and leaves every other tool to the gate', () => {
  const { dir, write: w } = repo();
  w('test/a.test.js', 'test("a");\n');
  const agent = { agent_id: 'tw1', session_id: 's1' };
  const tw = ['gate', 'scope', 'tests'];
  const impl = ['gate', 'retries', 'scope', 'no-tests'];
  // Before the audit the gate decides, as it did when the two ran side by side.
  for (const args of [tw, impl]) assert.match(whyDenied(write(dir, args, 'src/main/App.java', agent)), /Implementation gate/, args.join(' '));
  pass(dir);
  assert.match(whyDenied(write(dir, tw, 'src/main/App.java', agent)), /test-writer writes only test files|is production code/);
  assert.equal(write(dir, tw, 'test/b.test.js', agent), null);
  assert.match(whyDenied(write(dir, impl, 'test/a.test.js', agent)), /may not change tests/);
  assert.equal(write(dir, impl, 'src/main/App.java', agent), null);
  assert.match(whyDenied(bash(dir, impl, 'echo x > test/a.test.js', agent)), /test\/a\.test\.js/);
  assert.equal(bash(dir, impl, 'npm test', agent), null);
  // A Read or Grep is no write: the scope rule never sees it, whatever path it names.
  for (const [tool, input] of [['Read', { file_path: path.join(dir, 'src', 'main', 'App.java') }], ['Grep', { pattern: 'x', path: path.join(dir, 'test') }]]) {
    assert.equal(run(dir, tw, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, ...agent }), null, `test-writer ${tool}`);
    assert.equal(run(dir, impl, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { ...input, file_path: path.join(dir, 'test', 'a.test.js') }, ...agent }), null, `implementer ${tool}`);
  }
  // The retry limit still comes first for implementer.
  fs.mkdirSync(path.join(stateDir(dir), 'retries'), { recursive: true });
  const fp = readState(path.join(stateDir(dir), 'verdicts', '001-demo.json')).fingerprint;
  fs.writeFileSync(path.join(stateDir(dir), 'retries', '001-demo.json'), JSON.stringify({ feature: FEAT, fingerprint: fp, red: ['a', 'b', 'c'] }));
  assert.match(whyDenied(write(dir, impl, 'src/main/App.java', agent)), /Retry limit/);
});

test('scope on Bash (#210): a write outside the lane is denied before it runs, wherever the command puts it', () => {
  const { dir, write: w } = repo();
  w('test/a.test.js', 'test("a");\n');
  const impl = ['scope', 'no-tests'];
  for (const command of [
    'echo x > test/a.test.js',
    'echo x >>test/a.test.js',
    'npm test &> src/test/java/AppTest.java',
    'echo x | tee -a test/a.test.js',
    'rm -f test/a.test.js',
    'mv src/main/App.java test/App.test.js',
    'cp -r src/main/App.java src/test/java/AppTest.java',
    'cp -t test src/main/App.java',
    'ln -sf ../src/main/App.java test/link.test.js',
    'touch test/new.test.js',
    'mkdir -p test/more && echo ok',
    "sed -i 's/a/b/' test/a.test.js",
    "sed -i.bak -e 's/a/b/' test/a.test.js",
    "perl -pi -e 's/a/b/' test/a.test.js",
    'dd if=/dev/zero of=test/a.test.js count=1',
    'truncate -s 0 test/a.test.js',
    'cd test && echo x > a.test.js',
    'cd src/test && rm java/AppTest.java',
    'git rm -q test/a.test.js',
    'git checkout -- test/a.test.js',
    'git restore --source=HEAD~1 test/a.test.js',
    'git mv test/a.test.js test/b.test.js',
    'echo x > "test/$(echo a).test.js" ; echo x > test/"a".test.js',
    'sudo rm test/a.test.js',
    'env -i FOO=1 rm test/a.test.js',
    "bash -c 'echo x > test/a.test.js'",
    "bash <<'EOF'\nrm test/a.test.js\nEOF",
    'echo x > .specify/feature.json',
  ]) {
    const out = bash(dir, impl, command, { agent_type: 'implementer' });
    assert.ok(denied(out), `implementer: ${command}`);
    assert.match(whyDenied(out), /^implementer may not (change tests: \S+ is part of the executable spec|write \.specify\/feature\.json)/, command);
  }
  assert.match(whyDenied(bash(dir, impl, 'echo x > test/a.test.js', { agent_type: 'implementer' })), /test\/a\.test\.js/, 'the denial names the file');

  for (const command of [
    'npm test',
    'npm test > ../outside-repo.log 2>&1',
    'npm test 2>&1 | tail -5',
    'ls > /dev/null 2>&1 && cat test/a.test.js',
    'echo x > src/main/Other.java && sed -i s/x/y/ src/main/Other.java',
    'mkdir -p src/main/util && touch src/main/util/Util.java',
    'cp test/a.test.js ../outside-copy.js',
    'git diff -- test/ && git status && git log -1 -- test/a.test.js',
    'git checkout main',
    "cat > src/main/Gen.java <<'EOF'\nrm test/a.test.js\necho x > test/b.test.js\nEOF",
    'cat > src/main/Gen2.java <<EOF\nrm test/a.test.js\nEOF',
    "printf '%s' 'a > test/a.test.js'",
    'grep -rn "> test/a.test.js" src || true',
    'echo x > "$OUT"',
  ]) {
    assert.equal(bash(dir, impl, command, { agent_type: 'implementer' }), null, `implementer: ${command}`);
  }

  const tw = ['scope', 'tests'];
  assert.ok(denied(bash(dir, tw, 'echo x > src/main/App.java', { agent_type: 'test-writer' })), 'test-writer: production code');
  assert.match(whyDenied(bash(dir, tw, 'echo x > src/main/App.java', { agent_type: 'test-writer' })), /test-writer writes only test files and ticks tasks\.md; src\/main\/App\.java is production code/);
  assert.equal(bash(dir, tw, "echo x > test/b.test.js && sed -i 's/- \\[ \\]/- [X]/' specs/001-demo/tasks.md", { agent_type: 'test-writer' }), null, 'test-writer: its own lane');

  const arch = ['scope', 'only', 'specs/', 'CLAUDE.md'];
  assert.ok(denied(bash(dir, arch, 'echo x > src/x.js', { agent_type: 'architect' })), 'architect: outside its prefixes');
  assert.match(whyDenied(bash(dir, arch, 'echo x > src/x.js', { agent_type: 'architect' })), /architect may only write specs\/, CLAUDE\.md; src\/x\.js is outside that lane/);
  assert.equal(bash(dir, arch, `echo x >> ${FEAT}/plan.md && echo y > CLAUDE.md`, { agent_type: 'architect' }), null, 'architect: its prefixes');

  for (const args of [impl, tw, arch]) {
    const out = bash(dir, args, 'echo 0 > .git/speckit-team/retries/001-demo.json');
    assert.ok(denied(out), `${args.join(' ')}: the git directory`);
    assert.match(whyDenied(out), /guardrail state/);
  }
  assert.equal(bash(dir, ['scope', 'protected'], 'echo x > .github/workflows/ci.yml'), null, 'patcher\'s Bash is patch mode\'s business, not scope\'s');
  assert.ok(!fs.existsSync(path.join(dir, 'src', 'main', 'Other.java')), 'the hook only reads the command, it never runs it');
});

// #209: spec-auditor, spec-gatekeeper and security-reviewer have no Write or Edit, but Bash could still
// change the repo, and no lane check runs at their Stop.
// #378: commands that name the file they write, or that say they write, passed scope none: a gatekeeper running the
// repo's gates by hand is one flag from `prettier --write` or `eslint --fix`, and nothing later sees what it changed.
test('#378: scope none denies curl -o, sort -o, wget, awk -i inplace, patch, tar -x, unzip, rsync and formatters that write', () => {
  const { dir } = repo();
  const ro = ['scope', 'none'];
  const writes = [
    'sort -o src/main/App.java src/main/App.java', 'sort --output=src/main/App.java x', 'curl -o src/main/App.java https://example.com/x',
    'curl -sSLo src/main/App.java https://example.com/x', 'curl --output src/main/App.java https://example.com/x', 'curl -O https://example.com/App.java',
    'wget -O src/main/App.java https://example.com/x', 'wget https://example.com/App.java', 'awk -i inplace 1 src/main/App.java',
    'patch -p1 src/main/App.java fix.diff', 'patch -p1 < fix.diff', 'tar -xf a.tar', 'tar xzf a.tgz', 'tar --extract --file a.tar', 'unzip -o a.zip', 'rsync -a other/ src/',
    'prettier --write src/main/App.java', 'npx prettier -w src', 'npx --yes eslint --fix src', 'eslint --fix src', 'gofmt -w src/main.go', 'black src',
    'ruff format src', 'ruff check --fix src', 'rustfmt src/main.rs', 'cargo fmt', 'clang-format -i src/a.c', 'stylelint --fix "**/*.css"',
    'biome check --write src', 'terraform fmt', 'isort src', 'git ls-files | xargs prettier --write', 'find src -name "*.js" -exec eslint --fix {} +',
    // The review of #390: a script npx runs, Go and LLVM flag forms, ruff's other fix flags, a check flag that is another
    // option's value, and GNU long options abbreviated, as getopt_long takes them.
    'npx -c "prettier --write src"', 'npx --call="sed -i s/a/b/ src/main/App.java"', 'gofmt -w=true src/main.go', 'gofmt --w src/main.go',
    'clang-format --i src/a.c', 'ruff check --fix-only src', 'ruff --fix src', 'rsync -a --exclude -n other/ src/', 'unzip a.zip -d -l',
    'unzip -d -l a.zip', 'patch -i --dry-run', 'tar --extr -f a.tar', 'sort --out=src/main/App.java x', 'awk --inc=inplace 1 src/main/App.java',
    'wget -O - --output-fi=src/main/w.log https://example.com/x',
    // The second review: an awk option that takes no value, a check letter after a valued letter in one group (it is
    // that option's value), wget --spider as another option's value, npx --call abbreviated, and an unknown runner option.
    'awk -i inplace --posix 1 src/main/App.java', 'rsync -aen other/ src/', 'unzip -dl a.zip', 'wget --header --spider https://example.com/x',
    'npx --cal "rm -rf src"', 'pnpm exec --shell-mode "rm -rf src"', 'npx --weird prettier --check src',
    // The third review: unzip negates an option with a - inside the group, and wget's -e and --config run wgetrc commands
    // that can name the output file.
    'unzip -l- a.zip', 'unzip --l a.zip', 'wget -O - -e output_document=src/main/App.java https://example.com/x',
    'wget -O - --execute=output_document=src/main/App.java https://example.com/x', 'wget -O - --config=w.rc https://example.com/x',
    // The fourth review: wget reads WGETRC and ~/.wgetrc, and has options that write files of their own (--save-cookies,
    // --warc-file), so every wget is a write only the run can tell; curl's -K and --config read a file of options.
    'WGETRC=w.rc wget -O - https://example.com/x', 'wget -O - --save-cookies src/main/c.txt https://example.com/x',
    'curl -K c.cfg https://example.com/x', 'curl --config c.cfg https://example.com/x',
    // The fifth review: curl writes through -D, -c, --trace, --stderr, --output-dir and ~/.curlrc as well, so every curl
    // is a write only the run can tell, as every wget is.
    'curl -s -D src/main/h.txt https://example.com/x', 'curl -s -c src/main/jar https://example.com/x', 'curl -s --trace src/main/t https://example.com/x',
    'curl -s https://example.com/x | head', 'curl -o /dev/null -w "%{http_code}" https://example.com',
  ];
  for (const command of writes) assert.ok(denied(bash(dir, ro, command, { agent_type: 'spec-gatekeeper' })), command);
  const reads = [
        'sort src/main/App.java', 'awk 1 src/main/App.java', 'patch --dry-run -p1 < fix.diff', 'tar -tf a.tar', 'tar tzf a.tgz', 'unzip -l a.zip', 'rsync -an other/ src/',
    'prettier --check src', 'npx prettier --check src', 'eslint src', 'eslint --fix-dry-run src', 'gofmt -l src', 'black --check src', 'ruff check src', 'ruff format --check src',
    'rustfmt --check src/main.rs', 'cargo fmt --check', 'cargo fmt --all -- --check', 'clang-format src/a.c', 'terraform fmt -check', 'isort --check-only src', 'biome check src',
    'black --version', 'rustfmt --help', 'rsync -a -n --exclude x other/ src/', 'unzip -l -d out a.zip', 'gofmt -w=false src/main.go',
  ];
  for (const command of reads) assert.equal(bash(dir, ro, command, { agent_type: 'spec-gatekeeper' }), null, command);
  // A writing role is held to its lane by the files named; what only the run can tell is left to its lane check.
  assert.ok(denied(bash(dir, ['scope', 'tests'], 'curl -o src/main/App.java https://example.com/x', { agent_type: 'test-writer' })));
  assert.equal(bash(dir, ['scope', 'no-tests'], 'prettier --write src', { agent_type: 'implementer' }), null);
});

// #396: #378 denied every extract and sync to the read-only roles, although scope none allows a write outside the
// repo: the folder tar -C, unzip -d and rsync's last operand name was not read. It is read now where the line leaves
// no doubt (options this hook knows, the folder named once, no member list), and judged like any other target.
test('#396: scope none reads where tar -C, unzip -d and rsync put files, where the line leaves no doubt', () => {
  const { dir } = repo();
  const ro = ['scope', 'none'];
  const gk = { agent_type: 'spec-gatekeeper' };
  const out = path.join(os.tmpdir(), 'speckit-396-out').replaceAll('\\', '/');
  const outside = [
    `tar -xf a.tar -C ${out}`, `tar xzf a.tgz -C ${out}`, `tar -x -z -f a.tgz --directory=${out}`, `tar --extract --file a.tar --directory ${out}`,
    `tar -xzvf a.tgz -C ${out} --strip-components=1`, `tar -C ${out} -xf a.tar`, `mkdir -p ${out} && tar -xf a.tar -C ${out}`,
    `unzip -o a.zip -d ${out}`, `unzip -qq a.zip -d ${out}`, `unzip -d ${out} a.zip`,
    `rsync -a other/ ${out}/`, `rsync -av --delete --exclude .git other/ ${out}`, `rsync -a --exclude=node_modules src/ ${out}/copy`,
  ];
  for (const command of outside) assert.equal(bash(dir, ro, command, gk), null, command);
  const still = [
    // The folder is in the repo, or named twice.
    'tar -xf a.tar -C src', 'tar -xf a.tar --directory=src/main', `tar -xf a.tar -C ${out} -C src`, 'unzip a.zip -d src/main',
    `unzip a.zip -d ${out} -d src`, `rsync -a ${out}/ src/`, `rsync -a other/ ${out}/ src/`, 'tar -xf a.tar', 'unzip a.zip',
    // Members named on the line, which tar extracts where -C stood when it read them, and unzip's member and -x lists.
    `tar -xf a.tar src/a.js -C ${out}`, `tar -xf a.tar -C ${out} src/a.js`, `tar -xf a.tar -C ${out} -- x`, `unzip a.zip src/a.js -d ${out}`,
    `unzip a.zip -x b -d ${out}`,
    // Options that write a file of their own, run a command, or move where members land.
    `tar -xPf a.tar -C ${out}`, `tar -xf a.tar -C ${out} --absolute-names`, `tar -xf a.tar -C ${out} --to-command=sh`,
    `tar -xf a.tar -C ${out} --checkpoint-action=exec=sh`, `tar -xf a.tar -C ${out} -g src/snap`, `tar -xf a.tar --index-file=src/i -C ${out}`,
    `tar -xf a.tar -C ${out} --transform=s,^,../,`, `tar -xf a.tar -C ${out} -I sh`, `tar -xf a.tar --dir=${out}`,
    `rsync -a --remove-source-files src/ ${out}/`, `rsync -a --log-file=src/log other/ ${out}`, `rsync -a --backup-dir=src/b other/ ${out}`,
    `rsync -a --write-batch=src/b other/ ${out}`, `rsync -a -e sh other/ ${out}`, 'rsync -a other/ host:/tmp/x',
    // -C or -d where this reader does not take the folder from: in a group or an old-style bundle, attached, or from the shell.
    `tar xCf ${out} a.tar`, `tar -xzC ${out} -f a.tgz`, `unzip a.zip -d${out}`, 'tar -xf a.tar -C "$D"', 'unzip a.zip -d $(mktemp -d)',
  ];
  for (const command of still) assert.ok(denied(bash(dir, ro, command, gk)), command);
  // The security review of #402: options a variable adds (TAR_OPTIONS, UNZIP, UNZIPOPT) are not on the line, and
  // --overwrite writes through a link it finds.
  const optionVars = [`TAR_OPTIONS=--to-command=sh tar -xf a.tar -C ${out}`, `export TAR_OPTIONS=-P; tar -xf a.tar -C ${out}`,
    `env TAR_OPTIONS=-P tar -xf a.tar -C ${out}`, `UNZIP="-d src" unzip a.zip -d ${out}`, `UNZIPOPT=-d unzip a.zip -d ${out}`,
    `tar -xf a.tar -C ${out} --overwrite`,
    // The second review: a name quoted apart is still the variable once the shell removes the quotes, and env, sudo,
    // nice or timeout before the tool can bring options of their own.
    `env TAR_"OPTIONS=-P" tar -xf a.tar -C ${out}`, `export UNZ"IP"='-d src'; unzip a.zip -d ${out}`, `sudo tar -xf a.tar -C ${out}`,
    `timeout 60 unzip a.zip -d ${out}`, `nice rsync -a other/ ${out}/`];
  for (const command of optionVars) assert.ok(denied(bash(dir, ro, command, gk)), command);
  // A link into the repo under the folder, already there or made on the same line, takes the files back into the repo.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-396-')).replaceAll('\\', '/');
  try {
    const plain = path.join(tmp, 'plain').replaceAll('\\', '/');
    fs.mkdirSync(path.join(plain, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(plain, 'deep', 'f.txt'), 'x');
    assert.equal(bash(dir, ro, `tar -xf a.tar -C ${plain}`, gk), null, 'a folder of plain files');
    const linked = path.join(tmp, 'linked').replaceAll('\\', '/');
    fs.mkdirSync(path.join(linked, 'deep'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'src'), path.join(linked, 'deep', 'sub'), 'junction');
    const whole = path.join(tmp, 'whole').replaceAll('\\', '/');
    fs.symlinkSync(dir, whole, 'junction');
    for (const command of [`tar -xf a.tar -C ${linked}`, `unzip a.zip -d ${linked}`, `rsync -a other/ ${linked}/`, `tar -xf a.tar -C ${whole}`,
      `rsync -a other/ ${whole}/x`, `mkdir -p ${tmp}/new && ln -s ${dir.replaceAll('\\', '/')}/src ${tmp}/new/sub && tar -xf a.tar -C ${tmp}/new`,
      `cp -a other ${tmp}/new2 && rsync -a other/ ${tmp}/new2`, `tar -xf b.tar -C ${tmp}/new3 && tar -xf a.tar -C ${tmp}/new3`]) {
      assert.ok(denied(bash(dir, ro, command, gk)), command);
    }
    assert.equal(bash(dir, ro, `mkdir -p ${tmp}/new4 && tar -xf a.tar -C ${tmp}/new4`, gk), null, 'a folder made on the line');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // A writing role's lane judges the folder: implementer may not unpack into the tests.
  assert.ok(denied(bash(dir, ['scope', 'no-tests'], 'tar -xf a.tar -C test', { agent_type: 'implementer' })));
  // A remote destination is no file of the repo: left to the lane check, as every sync was before.
  assert.equal(bash(dir, ['scope', 'tests'], 'rsync -a test/ host:/srv/app', { agent_type: 'test-writer' }), null);
});

test('scope none on Bash (#209): a read-only agent runs checks but writes nothing in the repo', () => {
  const { dir } = repo();
  const ro = ['scope', 'none'];
  for (const command of [
    'npm test',
    'node --test 2>&1 | tail -20',
    'git status --short && git diff HEAD -- src && git log --oneline -5',
    'git branch --show-current && git rev-parse HEAD',
    `grep -rn "FR-001" ${FEAT} src > /dev/null; echo $?`,
    'npm test > ../outside-repo.log 2>&1; tail -5 ../outside-repo.log',
    "cat <<'EOF'\nrm -rf src\nEOF",
  ]) {
    assert.equal(bash(dir, ro, command, { agent_type: 'spec-gatekeeper' }), null, command);
  }
  for (const command of [
    'echo notes > notes.md',
    `rm ${FEAT}/plan.md`,
    `sed -i 's/- \\[ \\]/- [X]/' ${FEAT}/tasks.md`,
    'touch src/main/New.java',
    'git checkout main',
    'git switch -c other',
    'git stash',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git add -A && git commit -m wip',
    'git apply fix.patch',
    'rm $(git ls-files)',
    'echo x > "$OUT"',
    'cd src && echo x > y',
  ]) {
    const out = bash(dir, ro, command, { agent_type: 'spec-gatekeeper' });
    assert.ok(denied(out), command);
    assert.match(whyDenied(out), /^spec-gatekeeper is a read-only role and writes no files/, command);
  }
  assert.equal(bash(dir, ro, 'echo x > ../outside-repo.txt', { agent_type: 'spec-auditor' }), null, 'outside the repo is not its business');
  // A file git ignores is no change the lane check would see either: a test log, a coverage report.
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\ncoverage/\n');
  for (const command of ['npm test > test.log 2>&1', 'npx c8 npm test > coverage/summary.txt']) {
    assert.equal(bash(dir, ro, command, { agent_type: 'spec-gatekeeper' }), null, `ignored: ${command}`);
    assert.equal(bash(dir, ['scope', 'tests'], command, { agent_type: 'test-writer' }), null, `ignored, test-writer: ${command}`);
  }
  assert.ok(denied(bash(dir, ro, 'npm test > test.txt', { agent_type: 'spec-gatekeeper' })), 'control: a file git does not ignore');
  assert.ok(denied(bash(dir, ro, 'echo 0 > .git/x.log', { agent_type: 'spec-gatekeeper' })), 'the git directory is never exempt');
  assert.ok(denied(bash(dir, ro, 'echo 0 > .git/speckit-team/verdicts/x.json', { agent_type: 'spec-auditor' })), 'the git directory');
  const deep = `${'$('.repeat(10)}git status${')'.repeat(10)}`;
  assert.ok(denied(bash(dir, ro, deep, { agent_type: 'spec-auditor' })), 'a command too deep to read is denied, not waved through');
  assert.equal(bash(dir, ['scope', 'no-tests'], 'npm test', { tool_input: {} }), null, 'no command, no decision');
  assert.match(msg(run(dir, ro, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: ['rm', 'x'] } })), /tool_input\.command is (an array|object)/);
});

// #352: xargs options that take a value (-n 1, -I {}) were read as the command, so `xargs -n 1 rm` looked
// like it ran `1`; only find's first -exec was read; and git archive -o, format-patch, a diff's --output
// and worktree add wrote files scope never saw. A writing role's xargs or find with targets only the run can
// tell stays allowed, as `echo x > "$OUT"` is: its lane check at Stop sees what the command did.
test('scope on Bash (#352): xargs with valued options, every find -exec, and git commands that write a named file', () => {
  const { dir, write: w } = repo();
  w('test/a.test.js', 'test("a");\n');
  const ro = ['scope', 'none'];
  for (const command of [
    'find . | xargs -n 1 rm',
    'find . | xargs -I {} rm {}',
    'find src -print0 | xargs -0 -n1 rm -f',
    'ls | xargs --max-args 1 rm',
    'ls | xargs -0rn 1 rm',
    'ls | xargs -P 4 -L 1 -- rm',
    'find . -name x -exec echo {} \\; -exec rm {} \\;',
    'git archive -o src/out.tar HEAD',
    'git archive --output=src/out.tar HEAD',
    'git -C src archive -o out.tar HEAD',
    'git format-patch -o specs/ -1',
    'git format-patch --output-directory=specs -1',
    'git format-patch -1',
    'git diff --output=notes.txt',
    'git log -p --output notes.txt',
    // git takes a long option by any prefix it can tell apart, and find writes the file -fprint names.
    'git archive --o=src/out.tar HEAD',
    'git archive --outp src/out.tar HEAD',
    'git format-patch --output-dir=specs -1',
    'git diff --out=notes.txt',
    'find . -fprint notes.txt',
    'find . -name x -fprintf notes.txt %p',
    'find . -fls notes.txt',
    'ls | xargs --max-a 1 rm',
    'ls | xargs --max-ar=1 --null rm',
    'git archive -vo src/out.tar HEAD',
    'git archive -9osrc/out.tar HEAD',
    // --stdout counts only where git would read it: the last of --stdout and --no-stdout, not an option's value.
    'git format-patch --stdout --no-stdout -1',
    'git format-patch --subject-prefix --stdout -1',
    'git format-patch --stdout -o specs -1',
    'git format-patch --subject-p --stdout -1',
    'git format-patch --to --stdout -1',
    'git format-patch -Sfoo/../.. -1',
    'ls | xargs -in rm x',
    'ls | xargs xargs rm',
    'ls | xargs find -delete',
    'find . -exec sh -c \'rm "$1"\' _ {} \\;',
    'git format-patch --stdout --no-std -1',
  ]) {
    const out = bash(dir, ro, command, { agent_type: 'spec-gatekeeper' });
    assert.ok(denied(out), command);
    assert.match(whyDenied(out), /^spec-gatekeeper is a read-only role and writes no files/, command);
  }
  for (const command of [
    'git ls-files | xargs -0',
    'git ls-files | xargs -n 1 echo',
    'git ls-files | xargs -I {} grep -l x {}',
    'find . -name x -exec grep -l y {} \\;',
    'git format-patch --stdout -1',
    'git format-patch -1 --stdout',
    'git format-patch --to x --stdout HEAD~2',
    'git archive HEAD | tar -t',
    'git archive -o ../outside.tar HEAD',
    'git diff --stat',
    'git log --oneline -5',
    'find . -fprint ../outside.txt',
  ]) {
    assert.equal(bash(dir, ro, command, { agent_type: 'spec-gatekeeper' }), null, command);
  }
  const impl = ['scope', 'no-tests'];
  for (const command of ['git archive -o test/out.tar HEAD', 'git format-patch -o test/ -1', 'git worktree add test/wt', 'git worktree add --reas x test/wt', 'git diff --output=test/a.test.js']) {
    const out = bash(dir, impl, command, { agent_type: 'implementer' });
    assert.ok(denied(out), `implementer: ${command}`);
    assert.match(whyDenied(out), /^implementer may not change tests/, command);
  }
  assert.equal(bash(dir, impl, 'find . -name "*.pyc" -delete', { agent_type: 'implementer' }), null, 'a writing role: the lane check at Stop sees it');
  const arch = ['scope', 'only', 'specs/', 'CLAUDE.md'];
  assert.match(whyDenied(bash(dir, arch, 'git archive -o src/x.tar HEAD', { agent_type: 'architect' })), /architect may only write specs\/, CLAUDE\.md; src\/x\.tar is outside that lane/);
  assert.equal(bash(dir, arch, 'git format-patch -o specs/patches -1', { agent_type: 'architect' }), null, 'architect: inside its lane');
});

test('scope role on Bash (#209, #210): the acting role skill is held to its lane through Bash too', () => {
  const { dir } = repo();
  const roleBash = (command) => bash(dir, ['scope', 'role'], command, { session_id: 's1' });
  const put = (role) => {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    fs.mkdirSync(path.join(stateDir(dir), 'role'), { recursive: true });
    fs.writeFileSync(path.join(stateDir(dir), 'role', 's1.json'), JSON.stringify({
      session_id: 's1', role, sha, dirty: [], transcript: null, offset: 0, feature: FEAT, fingerprint: null, at: new Date().toISOString(),
    }));
  };
  put('implementer');
  assert.ok(denied(roleBash('echo x > test/a.test.js')), 'implementer role: a test');
  assert.equal(roleBash('echo x > src/main/B.java'), null, 'implementer role: production code');
  put('spec-gatekeeper');
  assert.match(whyDenied(roleBash('echo x > notes.md')), /^spec-gatekeeper is a read-only role and writes no files/);
  assert.equal(roleBash('npm test 2>&1 | tail -3'), null, 'spec-gatekeeper role: a check');
});

test('gate blocks implementation until a PASS verdict on the current artifacts', () => {
  const { dir, write: w } = repo();
  const tool = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} };
  assert.match(run(dir, ['gate'], tool).hookSpecificOutput.permissionDecisionReason, /has not passed/);

  run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: 'VERDICT: FAIL' });
  assert.match(run(dir, ['gate'], tool).hookSpecificOutput.permissionDecisionReason, /was FAIL/);

  assert.match(pass(dir).systemMessage, /PASS/);
  assert.equal(run(dir, ['gate'], tool), null);

  w(`${FEAT}/tasks.md`, '- [X] T001 write test\n- [x] T002 implement\n');
  assert.equal(run(dir, ['gate'], tool), null, 'ticking checkboxes keeps the audit valid');

  w(`${FEAT}/spec.md`, '# Spec\nFR-001 must work.\nFR-002 added later.\n');
  assert.match(run(dir, ['gate'], tool).hookSpecificOutput.permissionDecisionReason, /changed after the audit/);
});

// Spec Kit's scripts accept an absolute feature_directory. The hook joined it under the repo root,
// hashed four missing files, and an audit of "<missing>" stayed valid through any edit to the spec.
test('an absolute feature_directory is the same feature: editing the spec still closes the gate', () => {
  const { dir, write: w } = repo();
  const tool = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} };
  w('.specify/feature.json', JSON.stringify({ feature_directory: path.join(dir, FEAT) }));
  pass(dir);
  assert.equal(run(dir, ['gate'], tool), null);
  w(`${FEAT}/spec.md`, '# Spec\nFR-001 must work.\nFR-002 added later.\n');
  assert.match(run(dir, ['gate'], tool)?.hookSpecificOutput?.permissionDecisionReason ?? '', /changed after the audit/);
});

// A feature_directory that is not a string crashed the gate, and a crashed gate lets the action through.
test('a feature_directory that is not a path in the repo closes the gate', () => {
  const { dir, write: w } = repo();
  pass(dir);
  for (const feature_directory of [7, [FEAT], {}, null, '', path.join(os.tmpdir(), 'elsewhere')]) {
    w('.specify/feature.json', JSON.stringify({ feature_directory }));
    const out = run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
    assert.ok(denied(out), JSON.stringify(feature_directory));
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /feature\.json/);
  }
});

test('gate on a typed /speckit-implement and on the Skill tool, nothing else', () => {
  const { dir } = repo();
  // A typed /command never reaches UserPromptSubmit or PreToolUse; it fires UserPromptExpansion.
  const prompt = (name) => run(dir, ['gate'], {
    hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: name, prompt: `/${name}`,
  });
  const skill = (s) => run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill_name: s } });
  assert.equal(prompt('speckit-plan'), null);
  assert.equal(prompt('speckit-implementation-notes'), null);
  assert.equal(prompt('speckit-implement')?.decision, 'block');
  assert.equal(prompt('speckit.implement')?.decision, 'block');
  assert.equal(skill('speckit-plan'), null);
  assert.ok(denied(skill('speckit-implement')));
  pass(dir);
  assert.equal(prompt('speckit-implement'), null);
  assert.equal(skill('speckit-implement'), null);
});

test('verdict demands a VERDICT line, once', () => {
  const { dir } = repo();
  const stop = (extra) => run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: 'looks fine', ...extra });
  assert.equal(stop()?.decision, 'block');
  assert.equal(stop({ stop_hook_active: true }), null, 'never loops');
  assert.match(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: '| x |\n\n**VERDICT: PASS**' }).systemMessage, /PASS/);
});

// #304: with the team installed in ~/.claude and in the project, Claude Code runs the gate once per install
// for one launch. In the full run of 2026-11-11 (--login) the first process spent the approval and the second
// refused the launch it was given for: the audit could not be run again and the run ended at 8 turns, $2.40.
// The approval is spent on a launch, told by its tool_use_id, so every process of that launch lets it through.
test('verdict: an approved audit launch passes every gate process of that launch, and no other launch (#304)', () => {
  const { dir } = repo();
  const audit = (verdict) => run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: `report\n\nVERDICT: ${verdict}` });
  const launch = (id) => run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', tool_use_id: id, tool_input: { subagent_type: 'spec-auditor', prompt: 'audit the spec' } });
  audit('FAIL'); audit('FAIL');
  assert.ok(denied(launch('toolu_a')), 'two FAILs: refused');
  assert.equal(spawnSync('node', [HOOK, 'audit', '--approve'], { cwd: dir, encoding: 'utf8' }).status, 0);
  assert.equal(denied(launch('toolu_b')), false, 'approved: the first process of the launch lets it through');
  assert.equal(denied(launch('toolu_b')), false, "and so does the other install's process of the same launch");
  assert.ok(denied(launch('toolu_c')), 'another launch is refused: the approval was for one');
  assert.ok(denied(launch('toolu_a')), 'and so is the launch refused before the approval');
});

// #242: after two spec-auditor FAILs in a row, a third launch is refused until the user says to go on
// (`audit --approve`, run by the skill on a yes, spends the approval on one launch). A PASS clears the count.
test('verdict: a third spec-auditor launch after two FAILs is refused until --approve; a PASS clears the count', () => {
  const { dir } = repo();
  const audit = (verdict) => run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: `report\n\nVERDICT: ${verdict}` });
  const launch = () => run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', tool_input: { subagent_type: 'spec-auditor', prompt: 'audit the spec' } });
  audit('FAIL');
  assert.equal(denied(launch()), false, 'one FAIL: the next audit may run');
  audit('FAIL');
  assert.ok(denied(launch()), 'two FAILs in a row: the third launch is refused');
  assert.match(launch().hookSpecificOutput.permissionDecisionReason, /audit --approve/, 'and the refusal says how the user lets it through');
  const cli = spawnSync('node', [HOOK, 'audit', '--approve'], { cwd: dir, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(denied(launch()), false, 'approved: one launch goes ahead');
  assert.ok(denied(launch()), 'the approval is spent: the next launch is refused again');
  audit('FAIL');
  assert.ok(denied(launch()), 'a FAIL after the approval counts again');
  audit('PASS');
  assert.equal(denied(launch()), false, 'a PASS clears the count');
  audit('FAIL');
  assert.equal(denied(launch()), false, 'one FAIL after a PASS starts again at one');
});

// Subagents report through the SubagentHandback tool, so the report is its input, not the last
// assistant message. Found live on 2026-10-06: the gate denied every handback (the agent could
// not report at all) and spec-auditor's VERDICT never reached the verdict file.

test('gate never blocks an agent from reporting back', () => {
  const { dir } = repo();
  assert.equal(handback(dir, 'gate', 'Blocked by the gate, nothing done.'), null);
  assert.ok(denied(run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} })),
    'real work is still gated');
});

test('verdict is read from the handback report', () => {
  const { dir } = repo();
  const tool = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} };
  const sent = handback(dir, 'verdict', '## Report\n| C1 | ... |\n\nVERDICT: PASS');
  assert.ok(!denied(sent), 'the report goes through');
  assert.match(sent.systemMessage, /recorded VERDICT: PASS/);
  assert.equal(run(dir, ['gate'], tool), null, 'and the PASS unlocks the gate');
  // A second audit: one agent's second report with no work in between is the same report (#77).
  handback(dir, 'verdict', 'Findings...\nVERDICT: FAIL', { agent_id: 'aud2' });
  assert.ok(denied(run(dir, ['gate'], tool)));
});

test('a handback without a VERDICT line is sent back once', () => {
  const { dir } = repo();
  const out = handback(dir, 'verdict', 'Here is my analysis, no verdict.');
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /VERDICT: PASS/);
  assert.equal(handback(dir, 'verdict', 'Still no verdict.'), null, 'never gags the agent: the second report goes through');
});

test('stop after a handback verdict does not demand the line again', () => {
  const { dir } = repo();
  handback(dir, 'verdict', 'VERDICT: FAIL');
  assert.equal(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'aud1', last_assistant_message: '' }), null);
});

// #77: a verdict describes the files the auditor read, not the files on disk when it stops. Seen in
// feature 003: an audit launched on old files finished ten hours late, and its FAIL replaced a newer
// audit's PASS on the current files.
const readAs = (dir, id) => run(dir, ['verdict'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, agent_id: id });
const gateOpen = (dir) => !denied(run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }));

test('a late verdict on files that changed after the auditor started does not replace a newer one', () => {
  const { dir, write: w } = repo();
  assert.equal(readAs(dir, 'old'), null, 'the first tool call only records where the audit started');
  w(`${FEAT}/spec.md`, '# Spec\nFR-001 must work, revised.\n');
  assert.equal(readAs(dir, 'new'), null);
  assert.match(handback(dir, 'verdict', 'VERDICT: PASS', { agent_id: 'new' }).systemMessage, /recorded VERDICT: PASS/);
  const late = handback(dir, 'verdict', 'Two HIGH findings.\nVERDICT: FAIL', { agent_id: 'old' });
  assert.ok(!denied(late), 'the report itself still goes through');
  assert.match(late.systemMessage, /VERDICT: FAIL was not recorded: .*changed after it started/);
  assert.ok(gateOpen(dir), 'the newer PASS still stands');
  assert.equal(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'old', last_assistant_message: 'VERDICT: FAIL' })?.decision, undefined,
    'its Stop neither records the stale verdict nor asks for a VERDICT line');
  assert.ok(gateOpen(dir), 'the Stop did not record it either');
});

test('a PASS on files edited during the audit does not open the gate', () => {
  const { dir, write: w } = repo();
  readAs(dir, 'aud1');
  w(`${FEAT}/tasks.md`, '- [ ] T001 write test\n- [ ] T002 implement\n- [ ] T003 unaudited\n');
  assert.match(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'aud1', last_assistant_message: 'VERDICT: PASS' }).systemMessage,
    /VERDICT: PASS was not recorded/);
  assert.ok(!gateOpen(dir));
  readAs(dir, 'aud2');
  assert.match(run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'aud2', last_assistant_message: 'VERDICT: PASS' }).systemMessage,
    /recorded VERDICT: PASS/, 'a fresh audit of the same files is recorded');
  assert.ok(gateOpen(dir));
});

test('ticking a task during the audit does not make its verdict stale', () => {
  const { dir, write: w } = repo();
  readAs(dir, 'aud1');
  w(`${FEAT}/tasks.md`, '- [x] T001 write test\n- [ ] T002 implement\n');
  assert.match(handback(dir, 'verdict', 'VERDICT: PASS', { agent_id: 'aud1' }).systemMessage, /recorded VERDICT: PASS/);
});

test('an auditor resumed after its report starts a new audit from the files it reads then', () => {
  const { dir, write: w } = repo();
  readAs(dir, 'aud1');
  handback(dir, 'verdict', 'VERDICT: FAIL', { agent_id: 'aud1' });
  w(`${FEAT}/plan.md`, '# Plan\nRevised for the FAIL.\n');
  readAs(dir, 'aud1');
  assert.match(handback(dir, 'verdict', 'VERDICT: PASS', { agent_id: 'aud1' }).systemMessage, /recorded VERDICT: PASS/);
  assert.ok(gateOpen(dir));
});

test('an unreadable audit start record is treated as stale, not as a match', () => {
  const { dir } = repo();
  readAs(dir, 'aud1');
  fs.writeFileSync(path.join(stateDir(dir), 'agents', 'aud1.audit-start.json'), '{broken');
  assert.match(handback(dir, 'verdict', 'VERDICT: PASS', { agent_id: 'aud1' }).systemMessage, /not recorded/);
  assert.ok(!gateOpen(dir));
});

// Raw stdin, run from inside the repo: input that is not a hook event carries no cwd of its own.
function runRaw(dir, args, text) {
  const r = spawnSync('node', [HOOK, ...args], { input: text, encoding: 'utf8', cwd: dir });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}
const MODES = [['scope', 'no-tests'], ['scope', 'tests'], ['scope', 'protected'], ['gate'], ['gate', 'retries'], ['verdict'], ['result'], ['ends', '--record', 'APPROVED', 'REJECTED'], ['ends', 'RED', 'BLOCKED'], ['lane', 'no-tests'], ['lane', 'only', 'specs/'], ['start'], ['patch'], ['relay']];

// #215: in a sandbox that denies reading ~/.gitconfig, git for Windows 2.56 fails every command ("fatal:
// unknown error occurred while reading the configuration files"), not only warns. On the Linux and macOS
// CI runners git reads the repo under a mode-000 ~/.gitconfig without even a warning (2026-10-31). The hook's first git call
// then found no repo, and every mode let the action through in silence: an implementer's Write to a
// test went through. The hook now reads the repo without the global config when git cannot read it.
function unreadableGlobalConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skhome-'));
  const file = path.join(home, '.gitconfig');
  // Windows: a folder where the file should be, which git cannot open; elsewhere a file no one may read.
  if (process.platform === 'win32') fs.mkdirSync(file); else { fs.writeFileSync(file, '[user]\n\tname = x\n'); fs.chmodSync(file, 0o000); }
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  delete env.GIT_CONFIG_GLOBAL;
  return env;
}
const runEnv = (dir, args, payload, env) => {
  const r = spawnSync(process.execPath, [HOOK, ...args], { input: JSON.stringify({ cwd: dir, ...payload }), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
};
test('#215: a global git config git cannot read changes no decision', (t) => {
  const { dir } = repo();
  const env = unreadableGlobalConfig();
  const plain = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, env, encoding: 'utf8' });
  // Where git fails here, this is the bug's case; where it does not, the decisions must still hold.
  if (process.platform === 'win32') assert.notEqual(plain.status, 0, `precondition: git itself fails under this HOME (${plain.stderr})`);
  t.diagnostic(`git ${plain.status === 0 ? 'reads the repo' : 'fails'} under an unreadable global config on ${process.platform}`);
  const writeTest = { hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'implementer', tool_input: { file_path: path.join(dir, 'src/test/java/AppTest.java') } };
  const out = runEnv(dir, ['scope', 'no-tests'], writeTest, env);
  assert.ok(denied(out), `the same deny as with a readable config: ${JSON.stringify(out)}`);
  assert.equal(runEnv(dir, ['scope', 'no-tests'], { ...writeTest, tool_input: { file_path: path.join(dir, 'src/main/App.java') } }, env), null, 'and the same allow');
  const gate = runEnv(dir, ['gate'], { hook_event_name: 'UserPromptExpansion', command_name: 'speckit-implement' }, env);
  assert.equal(gate?.decision, 'block', `the audit gate holds: ${JSON.stringify(gate)}`);
});

test('#215: when git cannot read the repo at all inside a Spec Kit folder, the hook says so instead of staying silent', () => {
  const { dir } = repo();
  // A git dir git refuses: HEAD is not a ref, so every command fails, as a damaged or unreadable repo does.
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'not a ref\n');
  const out = runEnv(dir, ['scope', 'no-tests'], { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src/test/java/AppTest.java') } }, process.env);
  assert.match(out?.systemMessage ?? '', /^speckit-team: scope could not read the git repository here \(.+\); no decision made\.$/, JSON.stringify(out));
  const { dir: plain } = repo({ speckit: false });
  fs.writeFileSync(path.join(plain, '.git', 'HEAD'), 'not a ref\n');
  assert.equal(runEnv(plain, ['scope', 'no-tests'], { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(plain, 'x') } }, process.env), null, 'outside a Spec Kit folder it stays silent');
});

test('malformed input never crashes a hook: no decision, and the user is told', () => {
  // A crashed hook is a non-blocking error: Claude Code lets the action through and says nothing.
  // `scope protected` and `patch` are in MODES for 003 FR-011.
  const { dir } = repo();
  for (const text of ['{not json', '', '[]', '"text"', 'null', '42']) {
    for (const args of MODES) {
      const r = runRaw(dir, args, text);
      assert.equal(r.status, 0, `${args.join(' ')} on ${JSON.stringify(text)}: ${r.stderr}`);
      assert.ok(!decided(r.out), `${args.join(' ')} on ${JSON.stringify(text)} must not decide`);
      assert.match(r.out?.systemMessage ?? '', /speckit-team: .*input/, `${args.join(' ')} on ${JSON.stringify(text)} must say so`);
    }
  }
});

test('malformed input outside a Spec Kit repo stays silent', () => {
  const { dir } = repo({ speckit: false });
  for (const args of MODES) {
    const r = runRaw(dir, args, '{not json');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.out, null);
  }
});

test('an event a mode is not wired for makes no decision', () => {
  const { dir } = repo();
  for (const payload of [{}, { hook_event_name: 'NoSuchEvent' }, { hook_event_name: 'PostToolUse', tool_name: 'Bash' }]) {
    for (const args of [['gate'], ['gate', 'retries'], ['verdict'], ['result'], ['ends', '--record', 'APPROVED', 'REJECTED'], ['ends', 'RED', 'BLOCKED'], ['lane', 'no-tests'], ['lane', 'only', 'specs/'], ['start'], ['patch'], ['relay']]) {
      const out = run(dir, args, payload);
      assert.ok(!decided(out), `${args.join(' ')} on ${JSON.stringify(payload)}: ${JSON.stringify(out)}`);
    }
  }
});

// Found by the fourth spec audit on 2026-10-06: input that parses but has the wrong types, or a
// corrupt or unwritable state file, still crashed a hook, and a crashed gate fails open silently.

test('mistyped fields never crash a hook', () => {
  const { dir } = repo();
  for (const file_path of [7, [], {}, null, true]) {
    const out = run(dir, ['scope', 'no-tests'], { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path } });
    assert.ok(!decided(out), `file_path ${JSON.stringify(file_path)}`);
    const prot = run(dir, ['scope', 'protected'], { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path } });
    assert.ok(!decided(prot), `scope protected, file_path ${JSON.stringify(file_path)}`);
    // The crash net also yields "no decision"; only the guard yields it without this message.
    assert.doesNotMatch(prot?.systemMessage ?? '', /internal error/, `scope protected crashed on file_path ${JSON.stringify(file_path)}`);
  }
  for (const message of [7, ['VERDICT: PASS'], null]) {
    assert.ok(!decided(handback(dir, 'verdict', message)) || true); // must not throw; run() asserts exit 0
  }
  pass(dir);
  for (const agent_id of [5, {}, ['a']]) {
    run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id });
    run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id });
  }
  for (const cwd of [7, {}]) run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd });
});

// A non-string last message crashed verdict and ends, so a report that never ended in its word was let
// through. A non-string transcript path went to readFileSync, which reads a number as a file descriptor.
test('a last message or transcript path that is not a string counts as no report', () => {
  const { dir } = repo();
  for (const extra of [{ last_assistant_message: 7 }, { last_assistant_message: ['VERDICT: PASS'] }, { agent_transcript_path: 0 }]) {
    const stop = { hook_event_name: 'SubagentStop', ...extra };
    assert.equal(run(dir, ['ends', 'APPROVED', 'REJECTED'], stop)?.decision, 'block', `ends ${JSON.stringify(extra)}`);
    assert.equal(run(dir, ['verdict'], stop)?.decision, 'block', `verdict ${JSON.stringify(extra)}`);
  }
  assert.equal(fs.existsSync(path.join(stateDir(dir), 'verdicts', '001-demo.json')), false, 'no verdict recorded');
});

test('a corrupt verdict file closes the gate and says why', () => {
  const { dir } = repo();
  fs.mkdirSync(path.join(stateDir(dir), 'verdicts'), { recursive: true });
  fs.writeFileSync(path.join(stateDir(dir), 'verdicts', '001-demo.json'), '{broken');
  const out = run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  assert.ok(denied(out), 'an unreadable verdict proves no PASS');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /unreadable/);
});

test('a corrupt agent start record makes the lane check say it could not run', () => {
  const { dir } = repo();
  fs.mkdirSync(path.join(stateDir(dir), 'agents'), { recursive: true });
  fs.writeFileSync(path.join(stateDir(dir), 'agents', 'x1.json'), '{broken');
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'x1' });
  assert.ok(!decided(out));
  assert.match(out?.systemMessage ?? '', /lane/);
});

// git diff against a commit that does not resolve fails, and a failed diff read as "nothing changed":
// an edited test file passed the lane check without a word.
test('a start commit git cannot find makes the lane check say it could not run', () => {
  const { dir, write: w, g } = repo();
  w('src/test/java/AppTest.java', 'class AppTest {}\n');
  g('add', '-A'); g('commit', '-qm', 'test');
  fs.mkdirSync(path.join(stateDir(dir), 'agents'), { recursive: true });
  fs.writeFileSync(path.join(stateDir(dir), 'agents', 'x2.json'), JSON.stringify({ sha: '0123456789abcdef0123456789abcdef01234567', dirty: [] }));
  w('src/test/java/AppTest.java', 'class AppTest { /* weakened */ }\n');
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'x2' });
  assert.ok(!decided(out));
  assert.match(out?.systemMessage ?? '', /lane check could not run.*0123456789ab/);

  const leak = path.join(dir, 'leak.txt');
  fs.writeFileSync(path.join(stateDir(dir), 'agents', 'x3.json'), JSON.stringify({ sha: `--output=${leak}`, dirty: [] }));
  const opt = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'x3' });
  assert.match(opt?.systemMessage ?? '', /start record is incomplete/);
  assert.equal(fs.existsSync(leak), false, 'a sha that looks like an option never reaches git');
});

test('an unwritable state directory never crashes a hook, and is reported', () => {
  const { dir } = repo();
  fs.writeFileSync(stateDir(dir), 'not a directory');
  const v = run(dir, ['verdict'], { hook_event_name: 'SubagentStop', last_assistant_message: 'VERDICT: PASS' });
  assert.match(v?.systemMessage ?? '', /speckit-team/);
  const g = run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'a9' });
  assert.ok(denied(g), 'with no readable verdict the gate stays closed');
});

test('verdict and lane also accept Stop, for an agent run as the main thread', () => {
  const { dir } = repo();
  assert.equal(run(dir, ['verdict'], { hook_event_name: 'Stop', last_assistant_message: 'no verdict' })?.decision, 'block');
  assert.match(run(dir, ['verdict'], { hook_event_name: 'Stop', last_assistant_message: 'VERDICT: PASS' }).systemMessage, /PASS/);
});

test('lane check catches writes that bypassed Edit, including via Bash', () => {
  const { dir, write: w, g } = repo();
  pass(dir);
  const start = (id) => run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: id });
  const stop = (id, rule, extra = {}) => run(dir, ['lane', rule], { hook_event_name: 'SubagentStop', agent_id: id, agent_type: 'implementer', ...extra });

  start('a1');
  w('src/main/App.java', 'class App { int x; }\n');
  w('src/test/java/AppTest.java', 'class AppTest {}\n');
  g('add', '-A'); g('commit', '-qm', 'sneaky commit');
  const out = stop('a1', 'no-tests');
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /AppTest\.java/);
  assert.doesNotMatch(out.reason, /App\.java,|main\/App\.java/);
  assert.match(stop('a1', 'no-tests', { stop_hook_active: true }).systemMessage, /WARNING/, 'second stop warns instead of looping');

  start('a2');
  w('src/main/Other.java', 'class Other {}\n');
  assert.equal(stop('a2', 'no-tests'), null);

  start('t1');
  w('src/main/Sneaky.java', 'class Sneaky {}\n');
  assert.equal(stop('t1', 'tests')?.decision, 'block', 'test-writer may not add production code');
});

// #375: test-writer and implementer have two Stop hooks. When ends or result sent the agent back first, Claude Code
// keeps stop_hook_active true for the rest of the turn, so lane met its first violation with the flag set and only
// warned. lane now counts its own send-back per agent: the first violation it finds blocks, the second warns.
test('#375: lane sends a violation back once even when another Stop hook continued the agent first', () => {
  const { dir, write: w } = repo();
  pass(dir);
  const base = { agent_type: 'implementer', agent_id: 'laneA' };
  run(dir, ['gate', 'retries', 'scope', 'no-tests'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'x' }, ...base });
  w('test/changed.test.js', '// a script wrote this\n');
  const stop = () => run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', stop_hook_active: true, ...base });
  const first = stop();
  assert.equal(first?.decision, 'block', JSON.stringify(first));
  assert.match(first.reason, /test\/changed\.test\.js/);
  assert.match(stop().systemMessage, /WARNING: implementer left changes outside its lane/, 'never twice');
  run(dir, ['gate', 'retries', 'scope', 'no-tests'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'x' }, ...base });
  w('test/again.test.js', '// and again\n');
  assert.equal(stop()?.decision, 'block', 'a later lane record starts a new count');
});

// git diff detects renames by default and then names only the new path, so moving a failing test out
// of the test tree (git mv, or delete plus create) passed the lane check as one new production file.
test('lane check catches a test moved out of the test tree', () => {
  const { dir, write: w, g } = repo();
  w('src/test/java/AppTest.java', 'class AppTest {\n  void t() { assert false; }\n}\n');
  g('add', '-A'); g('commit', '-qm', 'test');
  pass(dir);
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'mv1' });
  g('mv', 'src/test/java/AppTest.java', 'src/main/AppTest.txt');
  g('commit', '-qm', 'moved');
  const out = run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'mv1' });
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /src\/test\/java\/AppTest\.java/);
});

test('lane check ignores files that were already dirty when the agent started', () => {
  const { dir, write: w } = repo();
  pass(dir);
  w('src/test/java/WipTest.java', 'class WipTest {}\n');
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, agent_id: 'b1' });
  assert.equal(run(dir, ['lane', 'no-tests'], { hook_event_name: 'SubagentStop', agent_id: 'b1' }), null);
});

// #88: product-owner and architect run before the audit and have no gate, so the settings.json
// `start` entry records where each started, at SubagentStart, and `lane only <prefixes>` at their Stop
// catches a file written through Bash outside the prefixes their scope hook allows.
const subagentStart = (dir, agent_id, agent_type = 'architect', extra = {}) => run(dir, ['start'], {
  hook_event_name: 'SubagentStart', agent_id, agent_type, ...extra,
});
const laneOnly = (dir, agent_id, prefixes, agent_type = 'architect', extra = {}) => run(dir, ['lane', 'only', ...prefixes], {
  hook_event_name: 'SubagentStop', agent_id, agent_type, ...extra,
});
const startRecord = (dir, id) => JSON.parse(fs.readFileSync(path.join(stateDir(dir), 'agents', `${id}.json`), 'utf8'));

test('start (#88): SubagentStart records where the agent started, never decides, and keeps the first record', () => {
  const { dir, write: w } = repo();
  w('specs/001-demo/wip.md', 'uncommitted\n');
  assert.equal(subagentStart(dir, 'p1', 'product-owner'), null);
  assert.match(startRecord(dir, 'p1').sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(startRecord(dir, 'p1').dirty, ['specs/001-demo/wip.md']);
  w('src/late.js', 'x\n');
  assert.equal(subagentStart(dir, 'p1', 'product-owner'), null);
  assert.deepEqual(startRecord(dir, 'p1').dirty, ['specs/001-demo/wip.md'], 'a record already there is kept');
  for (const agent_id of [undefined, 7, '../x', 'a b']) assert.equal(subagentStart(dir, agent_id), null, String(agent_id));
  assert.ok(!fs.existsSync(path.join(stateDir(dir), 'x.json')), 'an agent_id is never a path');
  assert.deepEqual(fs.readdirSync(path.join(stateDir(dir), 'agents')), ['p1.json']);
  const { dir: plain } = repo({ speckit: false });
  assert.equal(subagentStart(plain, 'p2'), null);
  assert.ok(!fs.existsSync(stateDir(plain)), 'outside a Spec Kit repo it writes nothing');
  const wrong = run(dir, ['start'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_id: 'p3' });
  assert.match(wrong?.systemMessage ?? '', /start got unusable input.*not one start is wired for/);
});

test('lane only (#88): a Bash write outside the prefixes blocks the stop; the lane, dirty files and a second stop pass', () => {
  const { dir, write: w, g } = repo();
  const architect = ['specs/', 'CLAUDE.md'];
  w('README.md', 'wip\n');
  subagentStart(dir, 'a1');
  w(`${FEAT}/plan.md`, '# Plan\nmore\n');
  w('CLAUDE.md', 'context\n');
  w('README.md', 'wip, changed again\n');
  assert.equal(laneOnly(dir, 'a1', architect), null, 'in the lane, or dirty when the agent started');
  subagentStart(dir, 'a2');
  w('src/greet.js', 'export const greet = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'committed by the agent');
  w(`${FEAT}/spec.md`, '# Spec\nchanged\n');
  const out = laneOnly(dir, 'a2', architect);
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /^Lane check: architect changed files outside its lane: src\/greet\.js\. Restore them/);
  assert.match(laneOnly(dir, 'a2', architect, 'architect', { stop_hook_active: true })?.systemMessage ?? '', /WARNING: architect left changes outside its lane: src\/greet\.js/);
  // A prefix with no trailing slash is one file: .specify/feature.json, not the rest of .specify/.
  subagentStart(dir, 'p1', 'product-owner');
  w('.specify/memory/constitution.md', 'changed\n');
  w('.specify/feature.json', JSON.stringify({ feature_directory: FEAT, at: 2 }));
  const po = laneOnly(dir, 'p1', ['specs/', '.specify/feature.json'], 'product-owner');
  assert.match(po?.reason ?? '', /product-owner changed files outside its lane: \.specify\/memory\/constitution\.md\. /);
  // A test-paths line that is no regex leaves the test lanes undecidable, not this one.
  subagentStart(dir, 'a3');
  w('.specify/test-paths', '[unclosed\n');
  assert.equal(laneOnly(dir, 'a3', ['specs/', 'CLAUDE.md', '.specify/']), null);
});

// Retry limit: an implementer that keeps failing would otherwise loop on minor tweaks, burning
// tokens. Each implementer report ends with RESULT: GREEN, RED or STUB; three REDs in a row on the
// same plan and tasks close the gate for implementer (gate retries) until the plan changes.
const report = (dir, message, agent_id, extra = {}) => run(dir, ['result'], {
  hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id, ...extra,
});
const implementerTool = (dir, args = ['gate', 'retries']) => run(dir, args, {
  hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'next',
});

test('three RED results in a row close the gate for implementer, and say where to go', () => {
  const { dir } = repo();
  pass(dir);
  assert.match(report(dir, 'T002 still failing.\n\nRESULT: RED', 'i1').systemMessage, /RED.*1 of 3/);
  report(dir, 'RESULT: RED', 'i2');
  assert.equal(implementerTool(dir), null, 'two REDs leave the gate open');
  assert.match(report(dir, 'RESULT: RED', 'i3').systemMessage, /3 of 3/);
  const out = implementerTool(dir);
  assert.ok(denied(out), 'the fourth attempt is stopped');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /3 times in a row.*architect/s);
  assert.equal(implementerTool(dir, ['gate']), null, 'plain gate (test-writer) does not count implementer results');
  assert.equal(handback(dir, 'gate', 'Stopped by the retry limit.', { agent_id: 'next' }) , null, 'reporting back stays open');
});

// Found live on 2026-10-07: an implementer stopped by the audit gate reported RED, and that
// attempt, which never got to work, counted toward the retry limit.
test('a RED from an implementer the audit gate stopped does not count', () => {
  const { dir } = repo();
  assert.match(report(dir, 'Blocked by the gate.\nRESULT: RED', 'g1').systemMessage, /not counted/);
  pass(dir);
  for (const id of ['i1', 'i2']) report(dir, 'RESULT: RED', id);
  assert.equal(implementerTool(dir), null, 'only the 2 REDs made after the PASS count');
});

test('GREEN resets the count, STUB leaves it alone', () => {
  const { dir } = repo();
  pass(dir);
  report(dir, 'RESULT: RED', 'i1');
  report(dir, 'RESULT: RED', 'i2');
  assert.match(report(dir, 'Stubs only.\nRESULT: STUB', 's1')?.systemMessage ?? '', /STUB/);
  assert.match(report(dir, 'RESULT: GREEN', 'i3').systemMessage, /GREEN/);
  report(dir, 'RESULT: RED', 'i4');
  report(dir, 'RESULT: RED', 'i5');
  assert.equal(implementerTool(dir), null, 'only REDs since the last GREEN count');
});

test('a revised plan or tasks resets the count', () => {
  const { dir, write: w } = repo();
  pass(dir);
  for (const id of ['i1', 'i2', 'i3']) report(dir, 'RESULT: RED', id);
  assert.ok(denied(implementerTool(dir)));
  w(`${FEAT}/tasks.md`, '- [ ] T001 write test\n- [ ] T002 implement, smaller\n');
  pass(dir);
  assert.equal(implementerTool(dir), null);
});

test('handback and stop from the same implementer count once', () => {
  const { dir } = repo();
  pass(dir);
  for (const id of ['i1', 'i2']) {
    report(dir, 'RESULT: RED', id);
    run(dir, ['result'], { hook_event_name: 'SubagentStop', agent_id: id, last_assistant_message: 'RESULT: RED' });
  }
  assert.equal(implementerTool(dir), null, 'two implementers, two REDs');
  report(dir, 'RESULT: RED', 'i3');
  assert.ok(denied(implementerTool(dir)), 'the third one closes it');
});

// #370: an accepted report leaves a marker per agent, so the Stop after its hand-back is not judged twice. An agent
// resumed with SendMessage works again under the same agent_id: its next tool call ends the old report, so every
// later report is checked and counted. Before the fix four REDs from one agent counted as one.
const toolAs = (dir, args, agent_id, tool_name = 'Bash') => run(dir, args, {
  hook_event_name: 'PreToolUse', tool_name, tool_input: { command: 'npm test', file_path: 'README.md' }, agent_id,
});
const stopAs = (dir, args, agent_id, last_assistant_message) => run(dir, args, { hook_event_name: 'SubagentStop', agent_id, last_assistant_message });

test('#371: spec-gatekeeper\'s APPROVED on a spec whose FR IDs the drift check cannot read is recorded with a message', () => {
  const r = repo();
  r.write(`${FEAT}/spec.md`, '# Spec\n| FR-001 | must work |\n');
  r.write(`${FEAT}/tasks.md`, '- [x] T001 implement\n');
  commitAll(r, 'feat');
  const out = stopAs(r.dir, ['ends', '--record', 'APPROVED', 'REJECTED'], 'gk1', 'fine\nAPPROVED');
  assert.equal(out?.decision, undefined);
  assert.match(msg(out), /recorded without the spec-level drift check: specs\/001-demo\/spec\.md names FR-001 but defines none/);
});

// #380: per-agent markers and per-session records were never removed (147 files over 6 weeks in one checkout). The
// SubagentStart entry prunes what is older than 30 days, at most once a day, and never a feature's standing.
test('#380: SubagentStart prunes per-agent and per-session records older than 30 days, once a day, and keeps the standing', () => {
  const { dir } = repo();
  const sd = stateDir(dir);
  const old = (Date.now() - 40 * 86400000) / 1000;
  const put = (rel, age) => { const f = path.join(sd, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}'); if (age) fs.utimesSync(f, age, age); return f; };
  const stale = ['agents/a1.ends-ok', 'agents/a1.json', 'team/s0.json', 'project/s0.json', 'choice/s0.json', 'patch/p1.json'].map((r) => put(r, old));
  const fresh = ['agents/a2.result', 'team/s1.json'].map((r) => put(r));
  const standing = ['verdicts/001-demo.json', 'retries/001-demo.json', 'ends/001-demo.json', 'audit/001-demo.json'].map((r) => put(r, old));
  const start = () => run(dir, ['start'], { hook_event_name: 'SubagentStart', agent_type: 'test-writer', agent_id: 'tw1', session_id: 's1' });
  assert.equal(start(), null, 'never a decision');
  for (const f of stale) assert.equal(fs.existsSync(f), false, `${f} pruned`);
  for (const f of [...fresh, ...standing]) assert.equal(fs.existsSync(f), true, `${f} kept`);
  const later = put('agents/a3.result', old);
  start();
  assert.equal(fs.existsSync(later), true, 'not again within a day');
});

test('#380: a state folder that cannot be listed is skipped, and the start goes on', () => {
  const { dir } = repo();
  const sd = stateDir(dir);
  fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, 'agents'), 'not a folder');
  const old = (Date.now() - 40 * 86400000) / 1000;
  fs.mkdirSync(path.join(sd, 'team'), { recursive: true });
  fs.writeFileSync(path.join(sd, 'team', 's0.json'), '{}');
  fs.utimesSync(path.join(sd, 'team', 's0.json'), old, old);
  const out = run(dir, ['start'], { hook_event_name: 'SubagentStart', agent_type: 'test-writer', agent_id: 'tw1', session_id: 's1' });
  assert.equal(decided(out), false);
  assert.doesNotMatch(msg(out), /internal error/);
  assert.equal(fs.existsSync(path.join(sd, 'team', 's0.json')), false, 'the other folders are still pruned');
});

test('#370: a resumed implementer\'s every RED counts, and the third closes the gate for it', () => {
  const { dir } = repo();
  pass(dir);
  for (let i = 1; i <= 3; i++) {
    if (i > 1) assert.equal(toolAs(dir, ['gate', 'retries', 'scope', 'no-tests'], 'i1'), null, 'two REDs leave its gate open');
    assert.match(report(dir, 'still failing\n\nRESULT: RED', 'i1').systemMessage, new RegExp(`${i} of 3`));
    assert.equal(stopAs(dir, ['result'], 'i1', 'RESULT: RED'), null, 'the Stop after the hand-back is the same report');
  }
  assert.ok(denied(toolAs(dir, ['gate', 'retries', 'scope', 'no-tests'], 'i1')), 'the same agent is held at the limit');
});

test('#370: a resumed implementer\'s GREEN resets the count', () => {
  const { dir } = repo();
  pass(dir);
  report(dir, 'RESULT: RED', 'i1');
  toolAs(dir, ['gate', 'retries'], 'i1');
  report(dir, 'RESULT: RED', 'i1');
  toolAs(dir, ['gate', 'retries'], 'i1');
  assert.match(report(dir, 'fixed\n\nRESULT: GREEN', 'i1').systemMessage, /retry count is reset/);
  assert.equal(fs.existsSync(path.join(stateDir(dir), 'retries', '001-demo.json')), false);
});

test('#370: a resumed spec-gatekeeper\'s APPROVED is drift-checked and replaces its REJECTED', () => {
  const r = repo();
  r.write(`${FEAT}/spec.md`, '# Spec\n- **FR-001**: must work.\n');
  r.write(`${FEAT}/tasks.md`, '- [x] T001 Tests in test/a.test.js for FR-001\n');
  r.write('test/a.test.js', '// names no requirement\n');
  commitAll(r, 'feat');
  const ends = ['ends', '--record', 'APPROVED', 'REJECTED'];
  const recorded = () => JSON.parse(fs.readFileSync(path.join(stateDir(r.dir), 'ends', '001-demo.json'), 'utf8'));
  assert.equal(stopAs(r.dir, ends, 'gk1', 'FR-001 has no test\nREJECTED'), null);
  assert.equal(recorded().word, 'REJECTED');
  toolAs(r.dir, ['scope', 'none'], 'gk1');
  assert.equal(stopAs(r.dir, ends, 'gk1', 'fine now\nAPPROVED')?.decision, 'block', 'the drift check runs on the resumed report');
  r.write('test/a.test.js', '// 001 FR-001\n');
  commitAll(r, 'test names FR-001');
  toolAs(r.dir, ['scope', 'none'], 'gk1');
  assert.equal(stopAs(r.dir, ends, 'gk1', 'fine now\nAPPROVED'), null);
  assert.equal(recorded().word, 'APPROVED', 'the later word is recorded');
});

test('#370: a resumed test-writer\'s RED on a parse error is sent back again; a refusal is still never repeated', () => {
  const { dir } = repo();
  pass(dir);
  const ends = ['ends', 'RED', 'BLOCKED', 'FIXED'];
  const send = (message, agent_id) => run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id });
  const broken = 'test/a.test.mjs:1 SyntaxError: Unexpected token \')\'\n\nRED';
  assert.ok(denied(send(broken, 'tw1')));
  toolAs(dir, ['gate', 'scope', 'tests'], 'tw1', 'Read');
  assert.equal(denied(send(broken, 'tw1')), false, 'the same report sent again goes through: never gagged');
  toolAs(dir, ['gate', 'scope', 'tests'], 'tw1', 'Read');
  assert.ok(denied(send(broken, 'tw1')), 'after a resume, a new report is checked again');
});

// #376: result read the retry record, appended a RED and wrote it back in place, with no lock: two implementers ending
// together (slices built side by side) both read the old list and one RED was lost, 4 and 5 times in 12 trials.
test('#376: two implementers reporting RED at once both count, 12 times in 12', async () => {
  const red = (dir, id) => new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK, 'result'], { stdio: ['pipe', 'ignore', 'ignore'] });
    p.stdin.end(JSON.stringify({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'implementer', agent_id: id, last_assistant_message: 'x\nRESULT: RED' }));
    p.on('close', resolve);
  });
  const counts = [];
  for (let i = 0; i < 12; i++) {
    const { dir } = repo();
    pass(dir);
    await Promise.all([red(dir, 'a'), red(dir, 'b')]);
    counts.push(JSON.parse(fs.readFileSync(path.join(stateDir(dir), 'retries', '001-demo.json'), 'utf8')).red.length);
    assert.deepEqual(fs.readdirSync(path.join(stateDir(dir), 'retries')), ['001-demo.json'], 'no lock or temporary file left behind');
  }
  assert.deepEqual(counts, Array(12).fill(2));
});

test('a report without a RESULT line is sent back once, then counts as RED', () => {
  const { dir } = repo();
  pass(dir);
  const out = report(dir, 'Done, I think.', 'i1');
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /RESULT: GREEN/);
  assert.match(report(dir, 'Done.', 'i1').systemMessage, /1 of 3/, 'never gags the agent, and an unproven result is not GREEN');
  assert.equal(run(dir, ['result'], { hook_event_name: 'SubagentStop', last_assistant_message: 'no line' })?.decision, 'block');
  assert.match(run(dir, ['result'], { hook_event_name: 'SubagentStop', last_assistant_message: 'no line', stop_hook_active: true }).systemMessage, /2 of 3/);
});

test('a corrupt retry record closes the implementer gate and says why', () => {
  const { dir } = repo();
  pass(dir);
  fs.mkdirSync(path.join(stateDir(dir), 'retries'), { recursive: true });
  fs.writeFileSync(path.join(stateDir(dir), 'retries', '001-demo.json'), '{broken');
  const out = implementerTool(dir);
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /unreadable/);
  assert.match(report(dir, 'RESULT: RED', 'i1').systemMessage, /unreadable/);
});

// Found live on 2026-10-07: spec-gatekeeper sent SubagentHandback({message: 'placeholder'}) in the
// same turn as a Bash call, so the main session got no verdict and launched a second gatekeeper.
test('ends: a gatekeeper report without APPROVED or REJECTED is sent back once', () => {
  const { dir } = repo();
  const ends = ['ends', 'APPROVED', 'REJECTED'];
  const out = handback(dir, 'ends', 'placeholder', { agent_id: 'gk1' });
  assert.ok(denied(run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'placeholder' }, agent_id: 'gk2' })));
  assert.equal(out, null, 'a mode with no words to require decides nothing');
  const again = run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'placeholder' }, agent_id: 'gk2' });
  assert.equal(again, null, 'never gags the agent: the second report goes through');
  assert.equal(run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: '| FR-001 | t:1 | pass |\n\n**APPROVED**' }, agent_id: 'gk3' }), null);
  assert.equal(run(dir, ends, { hook_event_name: 'SubagentStop', agent_id: 'gk3', last_assistant_message: '' }), null, 'the Stop after a good report is quiet');
  assert.equal(run(dir, ends, { hook_event_name: 'SubagentStop', last_assistant_message: 'done' })?.decision, 'block');
  assert.equal(run(dir, ends, { hook_event_name: 'SubagentStop', last_assistant_message: 'done', stop_hook_active: true }), null);
  assert.equal(run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }), null, 'other tools pass');
});

// The gatekeeper's word was kept only in the board mod's memory of the SubagentStop it saw, so a
// board that missed it (reloaded, or not loaded when verification ran) never showed verify done.
// It is now on disk next to the audit verdict, which the board reads the same way.
test('ends --record records the accepted final word for the active feature', () => {
  const { dir } = repo();
  const ends = ['ends', '--record', 'APPROVED', 'REJECTED'];
  const recorded = () => JSON.parse(fs.readFileSync(path.join(stateDir(dir), 'ends', '001-demo.json'), 'utf8'));
  run(dir, ends, { hook_event_name: 'SubagentStop', last_assistant_message: 'not done' });
  assert.equal(fs.existsSync(path.join(stateDir(dir), 'ends', '001-demo.json')), false, 'a refused report records nothing');

  run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'FR-001 untested\n\n**REJECTED**' }, agent_id: 'gk1' });
  assert.equal(recorded().word, 'REJECTED');
  assert.equal(recorded().agent_id, 'gk1');

  run(dir, ends, { hook_event_name: 'SubagentStop', agent_id: 'gk2', last_assistant_message: 'all covered\nAPPROVED' });
  assert.equal(recorded().word, 'APPROVED', 'a later run replaces the word');
});

// Found live on 2026-10-08 (issue #28): a test-writer handed back the report "placeholder" and
// nothing checked it. Its report now ends in RED or BLOCKED, checked by the same `ends` mode.
test('ends: a test-writer report without RED or BLOCKED is sent back once', () => {
  const { dir } = repo();
  const ends = ['ends', 'RED', 'BLOCKED'];
  const send = (message, agent_id) => run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id });
  assert.ok(denied(send('placeholder', 'tw1')));
  assert.equal(send('placeholder', 'tw1'), null, 'never gags the agent: the second report goes through');
  assert.equal(send('test/a.test.mjs:3 FR-001 expected 3, got undefined\n\nRED', 'tw2'), null);
  assert.equal(send('missing stubs: src/sum.mjs sum(a, b)\n\n**BLOCKED**', 'tw3'), null);
  assert.equal(run(dir, ends, { hook_event_name: 'SubagentStop', last_assistant_message: 'done' })?.decision, 'block');
});

// #240: a RED whose output is a parse or name error did not run its expectations, so it is not red for the
// right reason. It is sent back once, as the BLOCKED check is; a second report still carrying the error goes
// through, but is kept in ends/red-faults.json, so the breach is not lost once implementer turns the suite green.
// A missing module is not a fault: test-writer's RED for a production file not yet written is a valid one.
test('ends: a RED that is a parse or name error is sent back once and then kept on record', () => {
  const { dir } = repo();
  const ends = ['ends', 'RED', 'BLOCKED'];
  const send = (message, agent_id) => run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id });
  const faults = path.join(stateDir(dir), 'ends', 'red-faults.json');
  const broken = 'test/a.test.mjs:1 SyntaxError: Unexpected token \')\'\n\nRED';
  assert.ok(denied(send(broken, 'tw1')), 'the first RED on a syntax error is sent back');
  assert.equal(fs.existsSync(faults), false, 'a refused report records nothing');
  const second = send(broken, 'tw1');
  assert.equal(second?.hookSpecificOutput, undefined, 'the second report is not refused');
  assert.match(second?.systemMessage ?? '', /not red for the right reason/, 'and is named');
  assert.equal(JSON.parse(fs.readFileSync(faults, 'utf8'))[0].fault, 'SyntaxError');
  assert.equal(send('test/a.test.mjs:3 FR-001 expected 3, got undefined\n\nRED', 'tw2'), null, 'a failing assertion passes at once');
  assert.ok(denied(send('test/b.test.mjs:2 ReferenceError: sum is not defined\n\nRED', 'tw3')), 'a name error is a fault too');
  assert.equal(send('test/c.test.mjs:9 Cannot find module ./src/sum.mjs\n\nRED', 'tw4'), null, 'a missing production module is a valid RED');
  assert.equal(send('test/d.test.mjs:9 Cannot find module ./src/sum.mjs\n\nRED', 'tw5'), null);
});

// #374: a test that expects a SyntaxError (a parser, a validator) fails on its expectation, and its output names the
// error. Only the line a runtime prints when a file does not parse is a fault: `SyntaxError: <message>` opening a line,
// after a file:line, `Uncaught` or pytest's `E`; not the word inside an assertion's text.
test('ends (#374): a RED whose test expects a SyntaxError goes through; a file that does not parse is still sent back', () => {
  const { dir } = repo();
  const ends = ['ends', 'RED', 'BLOCKED', 'FIXED'];
  const send = (message, agent_id) => run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id });
  const expected = [
    'T001 test/parse.test.js: "001 FR-001 rejects bad input"\n  AssertionError: Missing expected exception (SyntaxError).\n1 failing\n\nRED',
    'test/parse.test.js:9 expected [Function parse] to throw SyntaxError\n\nRED',
    'Expected constructor: SyntaxError\nReceived function did not throw\n\nRED',
    'test/parse.test.js: FR-002 expects "SyntaxError: bad json" but parse returned {}\n\nRED',
  ];
  expected.forEach((m, i) => assert.equal(send(m, `ok${i}`), null, m));
  assert.equal(fs.existsSync(path.join(stateDir(dir), 'ends', 'red-faults.json')), false, 'nothing kept as a fault');
  const broken = ['test/a.test.mjs:1 SyntaxError: Unexpected token \')\'\n\nRED', 'file:///r/test/a.test.mjs:3\n  sum(,\n\nSyntaxError: Unexpected token \',\'\n\nRED',
    'E     File "tests/test_sum.py", line 3\nE   SyntaxError: invalid syntax\n\nRED', 'Uncaught SyntaxError: Unexpected end of input\n\nRED',
    '- `test/a.test.mjs`: SyntaxError: Unexpected identifier\n\nRED'];
  broken.forEach((m, i) => {
    const out = send(m, `bad${i}`);
    assert.ok(denied(out), m);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /^Your RED reports SyntaxError: the test file did not run/);
  });
});

// #245: a missing module that is itself a test file (a helper, a fixture) means the test file did not run
// either. Only the path the error names is judged, against the repo's test patterns: Node ESM's absolute
// path, Node CJS's relative one from its Require stack, a relative path as a report gives it, or a Python
// module. A production file, a package or a path outside the repo is still a valid RED.
test('#245 ends: a RED on a missing test helper is sent back once; a missing production module or package is not', () => {
  const { dir } = repo();
  const ends = ['ends', 'RED', 'BLOCKED'];
  const send = (message, agent_id) => run(dir, ends, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id });
  const at = (rel) => path.join(dir, ...rel.split('/'));
  const esm = (rel) => `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${at(rel)}' imported from ${at('test/a.test.mjs')}\n\nRED`;
  const helper = send(esm('test/helpers/db.mjs'), 'h1');
  assert.ok(denied(helper), 'ESM: a missing helper under test/');
  assert.match(helper.hookSpecificOutput.permissionDecisionReason, /test\/helpers\/db\.mjs/, 'names the helper');
  assert.ok(denied(send(`Error: Cannot find module './fixtures/user'\nRequire stack:\n- ${at('test/a.test.js')}\n\nRED`, 'h2')), 'CJS: resolved against the requiring file');
  assert.ok(denied(send('test/a.test.mjs:1 Cannot find module ../test/support/setup.mjs\n\nRED', 'h3')), 'a relative path as a report gives it');
  assert.ok(denied(send("E   ModuleNotFoundError: No module named 'tests.helpers'\n\nRED", 'h4')), 'Python');
  assert.ok(denied(send(esm('.claude/worktrees/slice-1/test/helpers/db.mjs'), 'h5')), 'in a worktree under the repo');
  const second = send(esm('test/helpers/db.mjs'), 'h1');
  assert.equal(second?.hookSpecificOutput, undefined, 'never twice: the second report goes through');
  assert.match(second?.systemMessage ?? '', /not red for the right reason/);
  const kept = JSON.parse(fs.readFileSync(path.join(stateDir(dir), 'ends', 'red-faults.json'), 'utf8'));
  assert.match(kept[0].fault, /test\/helpers\/db\.mjs/);

  assert.equal(send(esm('src/sum.mjs'), 'v1'), null, 'ESM: a production file not written yet');
  assert.equal(send(`Error: Cannot find module '../src/sum'\nRequire stack:\n- ${at('test/a.test.js')}\n\nRED`, 'v2'), null, 'CJS: production');
  assert.equal(send("Error: Cannot find module 'left-pad'\n\nRED", 'v3'), null, 'a package');
  assert.equal(send("ModuleNotFoundError: No module named 'app.sum'\n\nRED", 'v4'), null, 'Python production');
  assert.equal(send(`Cannot find module '${path.join(os.tmpdir(), 'elsewhere', 'test', 'x.mjs')}' imported from ${at('test/a.test.mjs')}\n\nRED`, 'v5'), null, 'outside the repo');
  assert.equal(send(`Cannot find module '${at('test/helpers/db.mjs')}'\n\nBLOCKED`, 'v6'), null, 'only a RED is judged');
  // The path is model-written: a share or device path is never resolved or opened (an SMB connection leaks
  // NTLM credentials on Windows), and is no fault.
  for (const [i, p] of ['\\\\attacker.invalid\\share\\test\\x.mjs', '//attacker.invalid/share/test/x.mjs', '\\\\?\\C:\\test\\x.mjs', '\\\\.\\pipe\\test\\x.mjs', 'file://attacker.invalid/share/test/x.mjs'].entries()) {
    assert.equal(send(`Cannot find module '${p}' imported from ${at('test/a.test.mjs')}\n\nRED`, `u${i}`), null, p);
  }
  assert.equal(send(`Error: Cannot find module './test/x'\nRequire stack:\n- \\\\attacker.invalid\\share\\a.test.js\n\nRED`, 'u9'), null, 'a share as the requiring file');
  assert.ok(denied(send(`Cannot find module '${pathToFileURL(at('test/helpers/db.mjs')).href}' imported from x\n\nRED`, 'u10')), 'a local file URL is still read');
});

// #74: sent to correct an existing test, test-writer adds no failing test, so the suite ends green and
// RED would contradict the run. It ends FIXED instead; the words are run as its agent file declares them.
test("test-writer's own ends commands accept FIXED for a correction that adds no test", () => {
  const { dir } = repo();
  const text = fs.readFileSync(path.join(path.dirname(HOOK), '..', 'agents', 'test-writer.md'), 'utf8');
  const commands = [...text.matchAll(/" (ends [A-Z ]+)'/g)].map((m) => m[1].split(' '));
  assert.equal(commands.length, 2, 'the SubagentHandback and the Stop entry');
  for (const [i, args] of commands.entries()) {
    const report = 'test/a.test.mjs:12 expected 6 cases, now 7; suite green\n\nFIXED';
    assert.equal(run(dir, args, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: report }, agent_id: `fx${i}` }), null, args.join(' '));
    assert.equal(run(dir, args, { hook_event_name: 'SubagentStop', agent_id: `fy${i}`, last_assistant_message: report }), null, args.join(' '));
  }
});

// The `ends` record is the gatekeeper's word, which the board's verify step reads. Without
// --record, an accepted word is not written: a test-writer's RED after a REJECTED must not replace it.
test('ends without --record leaves the recorded word alone', () => {
  const { dir } = repo();
  const file = path.join(stateDir(dir), 'ends', '001-demo.json');
  run(dir, ['ends', '--record', 'APPROVED', 'REJECTED'], { hook_event_name: 'SubagentStop', agent_id: 'gk1', last_assistant_message: 'FR-001 untested\nREJECTED' });
  run(dir, ['ends', 'RED', 'BLOCKED'], { hook_event_name: 'SubagentStop', agent_id: 'tw1', last_assistant_message: 'test/a.test.mjs:3 FR-001 fails\nRED' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).word, 'REJECTED');
});

// #228: in the 2026-10-31 full run spec-gatekeeper approved FR-006, which T002 and T005 cited and no test
// held, on the argument that each test file imports only its own module. The hook now runs the drift
// check on the active feature at APPROVED and refuses it while a finished test task cites a requirement
// none of its test files holds. REJECTED always goes through, so refusing every APPROVED never gags it.
const DRIFT_TASKS = '- [X] T001 Test FR-001 in `test/a.test.mjs`\n- [X] T002 implement FR-001 in `src/a.mjs`\n';
function driftRepo() {
  const r = repo();
  r.write(`${FEAT}/tasks.md`, DRIFT_TASKS);
  r.write('test/a.test.mjs', "test('each module imports only itself', () => {});\n");
  // Another feature's drift is not this feature's to fix.
  r.write('specs/000-old/tasks.md', '- [X] T009 Test FR-004 in `test/old.test.mjs`\n');
  r.write('test/old.test.mjs', '// nothing\n');
  return commitAll(r, 'tests');
}
const GK = ['ends', '--record', 'APPROVED', 'REJECTED'];
const endsWord = (dir) => readState(path.join(stateDir(dir), 'ends', '001-demo.json'));
function readState(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

test('#228 FR-001: spec-gatekeeper\'s APPROVED is refused at hand-back while a cited requirement has no test', () => {
  const { dir, write: put } = driftRepo();
  const send = (message, agent_id) => run(dir, GK, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id });
  for (const id of ['gk1', 'gk1']) {
    const out = send('| FR-001 | each test file imports only its own module | ok |\n\nAPPROVED', id);
    assert.ok(denied(out), JSON.stringify(out));
    const why = out.hookSpecificOutput.permissionDecisionReason;
    assert.match(why, /specs\/001-demo\/tasks\.md T001: FR-001 is in none of test\/a\.test\.mjs/);
    assert.match(why, /REJECTED/);
    assert.doesNotMatch(why, /000-old|FR-004/, 'another feature is not named');
  }
  assert.equal(endsWord(dir), null, 'a refused APPROVED records nothing');
  assert.equal(send('FR-001 has no test that would fail (owner: test-writer)\n\nREJECTED', 'gk1'), null);
  assert.equal(endsWord(dir).word, 'REJECTED');
  put('test/a.test.mjs', "test('FR-001 sum does not import capitalize', () => {});\n");
  const approved = send('All covered.\n\nAPPROVED', 'gk2');
  assert.equal(decided(approved), false, 'APPROVED goes through once the test holds the ID');
  assert.match(msg(approved), /names FR-001 but defines none/, 'the helper spec names FR-001 in prose only (#371)');
  assert.equal(endsWord(dir).word, 'APPROVED');
});

// #235: every FR of the active spec.md must be in a test line naming the feature's number, cited by a task
// or not; FR numbers repeat across features, so a line naming none, or another feature, does not hold it.
test('#235: spec-gatekeeper\'s APPROVED is refused while an FR of spec.md has no test line naming the feature', () => {
  const r = repo();
  r.write(`${FEAT}/spec.md`, '# Spec\n\n- **FR-001**: sums.\n- **FR-002**: empty gives 0.\n');
  r.write(`${FEAT}/tasks.md`, '- [X] T001 Test FR-001 in `test/a.test.mjs`\n- [X] T002 Implement sum (FR-001, FR-002)\n');
  r.write('test/a.test.mjs', "test('001 FR-001 sums', () => {});\ntest('FR-002 empty', () => {});\n");
  const { dir, write: put } = commitAll(r, 'tests');
  const send = (message, agent_id) => run(dir, GK, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id });
  const out = send('All covered.\n\nAPPROVED', 'gs1');
  assert.ok(denied(out), JSON.stringify(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /specs\/001-demo\/spec\.md FR-002: no test names it with 001/);
  assert.doesNotMatch(out.hookSpecificOutput.permissionDecisionReason, /FR-001:/, 'FR-001 is held');
  put('test/a.test.mjs', "test('001 FR-001 sums', () => {});\ntest('001 FR-002 empty', () => {});\n");
  assert.equal(send('All covered.\n\nAPPROVED', 'gs2'), null, 'goes through once a test line names 001 FR-002');
  assert.equal(endsWord(dir).word, 'APPROVED');
});

test('#228 FR-001: at Stop the APPROVED is sent back once, then recorded as REJECTED with the drift', () => {
  const { dir } = driftRepo();
  const stop = (extra) => run(dir, GK, { hook_event_name: 'SubagentStop', agent_id: 'gk3', last_assistant_message: 'All covered.\n\nAPPROVED', ...extra });
  const first = stop({});
  assert.equal(first?.decision, 'block');
  assert.match(first.reason, /T001: FR-001 is in none of test\/a\.test\.mjs/);
  assert.equal(endsWord(dir), null);
  const second = stop({ stop_hook_active: true });
  assert.ok(!decided(second), 'never blocks twice');
  assert.match(msg(second), /spec-gatekeeper's APPROVED was recorded as REJECTED/);
  assert.match(msg(second), /T001: FR-001 is in none of test\/a\.test\.mjs/);
  const e = endsWord(dir);
  assert.equal(e.word, 'REJECTED');
  assert.equal(e.claimed, 'APPROVED');
  assert.deepEqual(e.drift, ['specs/001-demo/tasks.md T001: FR-001 is in none of test/a.test.mjs']);
});

// The check is a second file beside the hook. A hook installed without it must not let APPROVED through
// in silence (constitution II): the word is recorded, and the message says the check did not run.
test('#228: a hook without its drift module records APPROVED and says the check did not run', () => {
  const { dir } = driftRepo();
  const alone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skhook-')), 'speckit-team.mjs');
  fs.copyFileSync(HOOK, alone);
  const out = run(dir, GK, { hook_event_name: 'SubagentStop', agent_id: 'gk4', last_assistant_message: 'All covered.\n\nAPPROVED' }, alone);
  assert.ok(!decided(out));
  assert.match(msg(out), /drift check could not run/);
  assert.equal(endsWord(dir).word, 'APPROVED');
});

// patcher's `ends` never runs the check, and no word but test-writer's RED and FIXED does.
test('#228: ends without --record does not run the drift check on a word that is not RED or FIXED', () => {
  const { dir } = driftRepo();
  assert.equal(run(dir, ['ends', 'DONE', 'FAILED'], { hook_event_name: 'SubagentStop', agent_id: 'p9', last_assistant_message: 'x\nDONE' }), null);
  assert.equal(run(dir, TW, { hook_event_name: 'SubagentStop', agent_id: 'tw9', last_assistant_message: 'x\nBLOCKED' }), null);
});

// #315: the cited-ID half of the check ran only at the gate. In the full run of 2026-11-11 (40c9f51) T001 cited
// FR-007 and FR-009, test-writer tagged neither, and the gate's REJECTED cost a round and a launch on code with
// nothing wrong. test-writer's RED or FIXED is now sent back once with the lines, while it has the files open.
const TW = ['ends', 'RED', 'BLOCKED', 'FIXED'];
test('#315: test-writer\'s RED is sent back once at Stop while a ticked test task cites an ID none of its test files holds', () => {
  const { dir, write: put } = driftRepo();
  const stop = (id, last, extra) => run(dir, TW, { hook_event_name: 'SubagentStop', agent_id: id, agent_type: 'test-writer', last_assistant_message: last, ...extra });
  const first = stop('tw1', 'T001 fails on its assertion.\nRED');
  assert.equal(first?.decision, 'block');
  assert.match(first.reason, /T001: FR-001 is in none of test\/a\.test\.mjs/);
  assert.match(first.reason, /"001 FR-002"/, 'says how an ID is written');
  // Never twice: the second report goes through, and says what is still missing.
  const second = stop('tw1', 'T001 fails on its assertion.\nRED');
  assert.ok(!decided(second), 'never blocks twice');
  assert.match(msg(second), /test-writer reported RED with cited requirements no test names: [^\n]*T001: FR-001/);
  // FIXED is checked as RED is; a Stop that is already a continuation is not blocked, and says so.
  assert.equal(stop('tw2', 'Tagged.\nFIXED')?.decision, 'block');
  const cont = stop('tw3', 'x\nRED', { stop_hook_active: true });
  assert.ok(!decided(cont));
  assert.match(msg(cont), /cited requirements no test names/);
  // With the ID in the file, as test-writer writes it, nothing is said.
  put('test/a.test.mjs', "test('001 FR-001 adds', () => {});\n");
  assert.equal(stop('tw4', 'x\nRED'), null);
});

test('#315: the hand-back is denied once with the same lines, and the Stop after it says nothing more', () => {
  const { dir } = driftRepo();
  const send = (message) => run(dir, TW, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, agent_id: 'tw5', agent_type: 'test-writer' });
  const first = send('T001 red.\nRED');
  assert.equal(first?.hookSpecificOutput?.permissionDecision, 'deny');
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /T001: FR-001 is in none of test\/a\.test\.mjs/);
  const second = send('T001 red.\nRED');
  assert.ok(!decided(second));
  assert.match(msg(second), /cited requirements no test names/);
  assert.equal(run(dir, TW, { hook_event_name: 'SubagentStop', agent_id: 'tw5', agent_type: 'test-writer', last_assistant_message: 'T001 red.\nRED' }), null);
});

// Only the cited half: an FR of spec.md that no test names yet may be a later round's, and stays the gate's.
test('#315: an FR of spec.md no test names yet does not send test-writer back, and a missing drift module is said', () => {
  const { dir, write: put } = driftRepo();
  put('test/a.test.mjs', "test('001 FR-001 adds', () => {});\n");
  put(`${FEAT}/spec.md`, '- **FR-001**: adds.\n- **FR-002**: a later round.\n');
  assert.equal(run(dir, TW, { hook_event_name: 'SubagentStop', agent_id: 'tw6', agent_type: 'test-writer', last_assistant_message: 'x\nRED' }), null);
  const alone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skhook-')), 'speckit-team.mjs');
  fs.copyFileSync(HOOK, alone);
  const out = run(dir, TW, { hook_event_name: 'SubagentStop', agent_id: 'tw7', agent_type: 'test-writer', last_assistant_message: 'x\nRED' }, alone);
  assert.ok(!decided(out));
  assert.match(msg(out), /cited-ID check could not run/);
});

// --- 003 fast track: `scope protected` (T001; FR-007, FR-001, US3-1, US3-4, SC-003) ---
const PROT = ['scope', 'protected'];
const OWN = ['hooks/speckit-team.mjs', 'hooks/speckit-drift.mjs', 'agents/implementer.md', 'skills/speckit-team/SKILL.md', 'install.mjs', 'package.json'];
const caseInsensitiveFs = (dir) => fs.existsSync(path.join(dir, '.GIT'));
// Asserts a deny that names the repo-relative path and /speckit-team, and that disk is unchanged.
function assertProtected(dir, rel) {
  const target = path.join(dir, rel);
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  const out = write(dir, PROT, rel);
  assert.ok(denied(out), `${rel} must be denied: ${JSON.stringify(out)}`);
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  // Case and slash form are not specified: the hook may name the path in its on-disk case (macOS /var symlink, Windows short names).
  const norm = (s) => s.toLowerCase().replace(/\\/g, '/');
  assert.ok(norm(reason).includes(norm(rel)), `${rel}: reason names the path: ${reason}`);
  assert.match(reason, /\/speckit-team/, rel);
  const after = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  assert.equal(after, before, `${rel}: disk unchanged`);
}
function ownRepo() {
  const r = repo();
  r.write('package.json', '{"name":"speckit-agents"}');
  for (const f of OWN.slice(0, 5)) r.write(f, 'x\n');
  return commitAll(r, 'own');
}

test('scope protected: Spec Kit, CI and agent-team paths are denied before the write (FR-007, FR-001, US3-1)', () => {
  const { dir } = repo();
  const paths = ['.specify/memory/constitution.md', '.specify/feature.json', '.specify/test-paths', 'specs/001-demo/spec.md',
    'specs/004-new/plan.md', '.claude/settings.json', '.claude/agents/x.md', '.github/workflows/test.yml', '.github/CODEOWNERS',
    '.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'Jenkinsfile', '.pre-commit-config.yaml'];
  if (caseInsensitiveFs(dir)) paths.push('.SPECIFY/memory/constitution.md');
  for (const rel of paths) assertProtected(dir, rel);
});

test('scope protected: ordinary paths are allowed (FR-001, US3-4)', () => {
  const { dir } = repo();
  assertProtected(dir, '.github/CODEOWNERS'); // the rule is live, so the allows below mean something
  for (const f of ['src/main/App.java', 'README.md', 'docs/guide.md', 'test/app.test.js', 'hooks/useThing.js', 'agents/notes.txt',
    'skills/x/notes.md', 'src/install.mjs', 'package.json', '.specifyx/notes.md', 'specsheet/x.md']) {
    assert.equal(write(dir, PROT, f), null, f);
  }
});

test('scope protected: the speckit-agents sources are protected in the speckit-agents repo only (FR-007)', () => {
  const { dir } = ownRepo();
  const pkgBefore = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  for (const rel of OWN) assertProtected(dir, rel);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), pkgBefore, 'package.json content unchanged');
  if (caseInsensitiveFs(dir)) for (const rel of ['HOOKS/speckit-team.mjs', 'PACKAGE.JSON']) assertProtected(dir, rel);
  for (const f of ['hooks/useThing.js', 'agents/notes.txt', 'src/install.mjs', 'pkg/package.json']) {
    assert.equal(write(dir, PROT, f), null, f);
  }
});

test('scope protected: the same five paths are ordinary in other repos (FR-007)', () => {
  const withPkg = (rel, text, commit = true) => () => { const r = repo(); r.write(rel, text); return commit ? commitAll(r, 'p') : r; };
  const cases = {
    'no package.json': () => repo(),
    'other name': withPkg('package.json', '{"name":"my-app"}'),
    'malformed': withPkg('package.json', '{not json'),
    'array': withPkg('package.json', '[]'),
    'name is an array': withPkg('package.json', '{"name":["speckit-agents"]}'),
    'only in pkg/': withPkg('pkg/package.json', '{"name":"speckit-agents"}'),
    'never committed': withPkg('package.json', '{"name":"speckit-agents"}', false),
    'no commit': () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skteam-'));
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      fs.mkdirSync(path.join(dir, '.specify'));
      fs.writeFileSync(path.join(dir, '.specify', 'feature.json'), '{}');
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"speckit-agents"}');
      return { dir };
    },
  };
  for (const [name, make] of Object.entries(cases)) {
    const { dir } = make();
    assertProtected(dir, '.github/workflows/test.yml'); // the rule is live in this repo too
    for (const rel of OWN) assert.equal(write(dir, PROT, rel), null, `${name}: ${rel}`);
  }
});

test('scope protected: the repo name is read from HEAD, not the working tree (decision 4)', () => {
  const { dir } = ownRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
  assertProtected(dir, 'install.mjs');
});

test('scope protected: the installed agent team outside the repo is denied (FR-007)', () => {
  const { dir } = repo();
  const checkout = path.join(path.dirname(HOOK), '..');
  const ev = (file_path) => run(dir, PROT, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path } });
  for (const p of [path.join(checkout, 'agents', 'x.md'), path.join(checkout, 'hooks', 'x.mjs'),
    path.join(checkout, 'skills', 'y', 'SKILL.md'), path.join(checkout, 'settings.json'), path.join(checkout, 'settings.local.json')]) {
    const out = ev(p);
    assert.ok(denied(out), p);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /installed agent team/, p);
    assert.ok(!fs.existsSync(p), `${p} not created`);
  }
  assert.equal(ev(path.join(os.tmpdir(), 'elsewhere.txt')), null);
});

test('scope protected: the guardrail state under .git/ is denied (FR-007)', () => {
  const { dir } = repo();
  assertProtected(dir, '.github/CODEOWNERS'); // the rule is live
  const out = write(dir, PROT, '.git/speckit-team/retries/x.json');
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /guardrail state/);
});

// ---- 006 choose the team size: the team record and the gate that follows it ----
const agentLaunch = (dir, prompt, extra = {}) => run(dir, ['gate'], {
  hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1',
  tool_input: { subagent_type: 'test-writer', prompt }, ...extra,
});
const teamFile = (dir, id = 's1') => path.join(stateDir(dir), 'team', `${id}.json`);
const teamRecord = (dir, id = 's1') => JSON.parse(fs.readFileSync(teamFile(dir, id), 'utf8'));
const noTeamFiles = (dir) => !fs.existsSync(path.join(stateDir(dir), 'team')) || fs.readdirSync(path.join(stateDir(dir), 'team')).length === 0;
const subTool = (dir, args = ['gate'], extra = {}) => run(dir, args, {
  hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: 'sub1', session_id: 's1', ...extra,
});

test('team: an Agent launch with a Team line writes the session record and never decides (FR-009, constitution II)', () => {
  const { dir } = repo();
  const out = agentLaunch(dir, 'go\nTeam: test-writer, implementer');
  assert.ok(!denied(out), 'no permission decision, though no audit has passed');
  assert.match(out?.systemMessage ?? '', /speckit-team: team for this session: .*test-writer.*implementer.*; audit gate off, spec-auditor is not in the team/);
  const rec = teamRecord(dir);
  assert.deepEqual(rec.roles, ['test-writer', 'implementer']);
  assert.equal(rec.session_id, 's1');
  assert.ok(!Number.isNaN(Date.parse(rec.at)));
  assert.ok(!JSON.stringify(rec).includes('go\\n'), 'no prompt text in the record');
  pass(dir);
  assert.ok(!denied(agentLaunch(dir, 'go\nTeam: test-writer')), 'with a PASS too');
});

test('team: a team with spec-auditor says the audit gate is on (FR-009)', () => {
  const { dir } = repo();
  const out = agentLaunch(dir, 'Team: spec-auditor, architect, product-owner, test-writer');
  assert.match(out?.systemMessage ?? '', /; audit gate on/);
  assert.deepEqual(teamRecord(dir).roles, ['product-owner', 'architect', 'spec-auditor', 'test-writer']);
});

test('team: case and order are normalised, a name given twice counts once (Edge Cases)', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: Implementer, TEST-WRITER, implementer');
  assert.deepEqual(teamRecord(dir).roles, ['test-writer', 'implementer']);
});

const ALL_ROLES = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'];
// A typed /speckit-team, as Claude Code hands it to the UserPromptExpansion gate (seen on 2.1.296).
const typedTeam = (dir, args, extra = {}) => run(dir, ['gate'], {
  hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'speckit-team',
  command_args: args, prompt: `/speckit-team ${args}`, session_id: 's1', ...extra,
});
const mainSkill = (dir, extra = {}) => run(dir, ['gate'], {
  hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: 's1', tool_input: { skill: 'speckit-implement' }, ...extra,
});
const typedImplement = (dir, extra = {}) => run(dir, ['gate'], {
  hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'speckit-implement',
  command_args: '', prompt: '/speckit-implement', session_id: 's1', ...extra,
});

// #366: under "skip the tests" the main session launched implementer alone on its first turn, in 2 of 6 pressure
// runs of 2026-11-20 (and before), a team the user never chose. Typed without --team, the request holds a
// launch whose Team line names less than the full team until the transcript shows the user's answer since.
const userLine = (content, extra = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
const askLines = (id) => [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: {} }] } }),
  userLine([{ type: 'tool_result', tool_use_id: id, content: 'User has answered: Implement only' }])];
const choiceRepo = () => {
  const { dir } = repo();
  const t = path.join(dir, '..', `t-${path.basename(dir)}.jsonl`);
  fs.writeFileSync(t, `${userLine('earlier request')}\n`);
  return { dir, t, add: (...lines) => fs.appendFileSync(t, lines.map((l) => `${l}\n`).join('')) };
};
const NOT_ANSWERS = [userLine('<command-message>speckit-team</command-message>\n<command-name>/speckit-team</command-name>\n<command-args>add sum() and skip the tests</command-args>'),
  userLine([{ type: 'text', text: 'Base directory for this skill: C:/x/speckit-team\n\nRun the Spec Kit team on: ...' }], { isMeta: true }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'node hook check team' } }] } }),
  userLine([{ type: 'tool_result', tool_use_id: 'b1', content: 'speckit-team: check: ok' }]),
  userLine('<system-reminder>context</system-reminder>')];

test('team choice: typed without --team, a launch naming less than the full team waits for the user\'s answer (#366)', () => {
  const { dir, t, add } = choiceRepo();
  typedTeam(dir, 'add sum() and skip the tests', { transcript_path: t });
  add(...NOT_ANSWERS);
  const out = agentLaunch(dir, 'go\nTeam: implementer', { transcript_path: t });
  assert.ok(denied(out), 'held: nobody chose implementer alone');
  assert.match(reasonOf(out), /nobody chose this team.*typed without --team.*ask the team question/s);
  assert.ok(!fs.existsSync(teamFile(dir)), 'and no team is recorded for it');
  add(userLine('Implement only.'));
  assert.ok(!denied(agentLaunch(dir, 'go\nTeam: implementer', { transcript_path: t })), 'after a typed answer it goes');
  assert.deepEqual(teamRecord(dir).roles, ['implementer']);
});

test('team choice: an AskUserQuestion answer counts, and the full team needs none (#366)', () => {
  const a = choiceRepo();
  typedTeam(a.dir, 'add sum()', { transcript_path: a.t });
  a.add(...NOT_ANSWERS, ...askLines('q1'));
  assert.ok(!denied(agentLaunch(a.dir, 'go\nTeam: test-writer, implementer', { transcript_path: a.t })));
  const b = choiceRepo();
  typedTeam(b.dir, 'add sum()', { transcript_path: b.t });
  b.add(...NOT_ANSWERS);
  assert.ok(!denied(agentLaunch(b.dir, 'go', { transcript_path: b.t })), 'no Team line: the full team, the recommended answer');
  const c = choiceRepo();
  typedTeam(c.dir, 'add sum()', { transcript_path: c.t });
  c.add(...NOT_ANSWERS);
  assert.ok(!denied(agentLaunch(c.dir, `go\nTeam: ${ALL_ROLES.join(', ')}`, { transcript_path: c.t })), 'a Team line naming all six is the full team');
});

test('team choice: a typed --team is the user\'s choice, a first prompt is held from the transcript\'s start, and no transcript_path holds nothing (#366)', () => {
  const a = choiceRepo();
  typedTeam(a.dir, '--team implementer add sum()', { transcript_path: a.t });
  a.add(...NOT_ANSWERS);
  assert.ok(!denied(agentLaunch(a.dir, 'go\nTeam: implementer', { transcript_path: a.t })));
  // A session's first prompt: Claude Code has not written the transcript yet, so all of it comes after the request.
  const b = choiceRepo();
  const fresh = path.join(b.dir, '..', `fresh-${path.basename(b.dir)}.jsonl`);
  typedTeam(b.dir, 'add sum()', { transcript_path: fresh });
  fs.writeFileSync(fresh, `${NOT_ANSWERS.join('\n')}\n`);
  assert.ok(denied(agentLaunch(b.dir, 'go\nTeam: implementer', { transcript_path: fresh })), 'held from the first line');
  fs.appendFileSync(fresh, `${userLine('Implement only.')}\n`);
  assert.ok(!denied(agentLaunch(b.dir, 'go\nTeam: implementer', { transcript_path: fresh })), 'and goes after the answer');
  const c = choiceRepo();
  typedTeam(c.dir, 'add sum()');
  assert.ok(!denied(agentLaunch(c.dir, 'go\nTeam: implementer')), 'no transcript_path at all: as before');
});

// #397: Claude Code writes the session transcript some time after the request; in CI on macOS the first team launch
// came before it, so the transcript did not exist, answeredSince read it as answered, and the hold failed open (traced
// on the runner: 20 of 20 in one run, 0 of 20 in another). A transcript that is not written yet holds no answer.
test('#397: a transcript not written yet at the first launch holds no answer; once it holds one, the launch goes', () => {
  const { dir } = choiceRepo();
  const later = path.join(dir, '..', `later-${path.basename(dir)}.jsonl`);
  typedTeam(dir, 'add sum()', { transcript_path: later });
  const out = agentLaunch(dir, 'go\nTeam: implementer', { transcript_path: later });
  assert.ok(denied(out), 'held while nothing is written');
  assert.match(reasonOf(out), /nobody chose this team/);
  fs.writeFileSync(later, `${NOT_ANSWERS.join('\n')}\n`);
  assert.ok(denied(agentLaunch(dir, 'go\nTeam: implementer', { transcript_path: later })), 'and while it holds no answer');
  fs.appendFileSync(later, `${userLine('Implement only.')}\n`);
  assert.ok(!denied(agentLaunch(dir, 'go\nTeam: implementer', { transcript_path: later })), 'the answer lets it go');
  // The typed --team hold of #373 reads the same way.
  const b = choiceRepo();
  const later2 = path.join(b.dir, '..', `later2-${path.basename(b.dir)}.jsonl`);
  typedTeam(b.dir, '--team spec-auditor,test-writer,implementer add sum()', { transcript_path: later2 });
  assert.ok(denied(agentLaunch(b.dir, 'go\nTeam: test-writer, implementer', { transcript_path: later2 })));
});

test('team choice: once a launch went, later ones are not held; a new typed request asks again (#366)', () => {
  const { dir, t, add } = choiceRepo();
  typedTeam(dir, 'add sum()', { transcript_path: t });
  add(...NOT_ANSWERS, userLine('Build only.'));
  assert.ok(!denied(agentLaunch(dir, 'go\nTeam: test-writer, implementer', { transcript_path: t })));
  assert.ok(!denied(agentLaunch(dir, 'next\nTeam: test-writer, implementer', { transcript_path: t })));
  typedTeam(dir, 'add product()', { transcript_path: t });
  add(...NOT_ANSWERS);
  assert.ok(denied(agentLaunch(dir, 'go\nTeam: implementer', { transcript_path: t })), 'the answer to the last request does not carry over');
});

// #373: typed with --team <roles>, the first Team line was taken as the main session wrote it, so a line dropping
// spec-auditor switched the audit gate off for a request whose user had typed it. The typed roles are held: a launch
// whose Team line drops one of them waits for the user's answer, as #366 holds a team nobody chose.
test('#373: a Team line that drops a role the user typed after --team is denied, and no team is recorded', () => {
  const { dir, t, add } = choiceRepo();
  typedTeam(dir, `--team ${ALL_ROLES.join(',')} add a sum function`, { transcript_path: t });
  add(...NOT_ANSWERS);
  const out = agentLaunch(dir, 'Team: implementer\nBuild it.', { transcript_path: t });
  assert.ok(denied(out), 'held: the user typed six roles');
  assert.match(reasonOf(out), /typed --team .*drops product-owner, architect, spec-auditor, test-writer, spec-gatekeeper/s);
  assert.ok(!fs.existsSync(teamFile(dir)), 'no team is recorded, so the full gates still apply');
  assert.match(subTool(dir).hookSpecificOutput.permissionDecisionReason, /has not passed/);
  assert.ok(!denied(agentLaunch(dir, 'Build it.', { transcript_path: t })), 'no Team line, the full team, goes');
});

test('#373: the typed roles, or more, go; --security and a user\'s answer since let a line through too', () => {
  const a = choiceRepo();
  typedTeam(a.dir, '--team implementer,test-writer add sum()', { transcript_path: a.t });
  a.add(...NOT_ANSWERS);
  assert.ok(denied(agentLaunch(a.dir, 'go\nTeam: implementer', { transcript_path: a.t })), 'test-writer dropped');
  assert.ok(!denied(agentLaunch(a.dir, 'go\nTeam: test-writer, implementer', { transcript_path: a.t })));
  assert.deepEqual(teamRecord(a.dir).roles, ['test-writer', 'implementer']);
  const b = choiceRepo();
  typedTeam(b.dir, '--security --team test-writer,implementer add sum()', { transcript_path: b.t });
  b.add(...NOT_ANSWERS);
  assert.ok(!denied(agentLaunch(b.dir, 'go\nTeam: test-writer, implementer, security-reviewer', { transcript_path: b.t })));
  const c = choiceRepo();
  typedTeam(c.dir, '--team spec-auditor,test-writer,implementer add sum()', { transcript_path: c.t });
  c.add(...NOT_ANSWERS);
  assert.ok(denied(agentLaunch(c.dir, 'go\nTeam: test-writer, implementer', { transcript_path: c.t })));
  c.add(userLine('Drop the audit, just build it.'));
  assert.ok(!denied(agentLaunch(c.dir, 'go\nTeam: test-writer, implementer', { transcript_path: c.t })), 'the user answered since');
  const d = choiceRepo();
  typedTeam(d.dir, '--team implementer,nobody add sum()', { transcript_path: d.t });
  assert.ok(!denied(agentLaunch(d.dir, 'go\nTeam: implementer', { transcript_path: d.t })), 'a list the skill refuses records nothing');
});

test('team: a team-role launch with no Team line records the full team, silently (FR-002, FR-009, #101)', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: implementer');
  assert.deepEqual(teamRecord(dir).roles, ['implementer']);
  const out = agentLaunch(dir, 'plain prompt');
  assert.equal(out, null);
  assert.deepEqual(teamRecord(dir).roles, ALL_ROLES);
  assert.match(subTool(dir).hookSpecificOutput.permissionDecisionReason, /has not passed/, 'the full gate is back');
});

test('team: a Team line naming a non-role records the full team and names the word (FR-006)', () => {
  const { dir } = repo();
  for (const [line, word] of [['Team: test-writer, patcher', 'patcher'], ['Team:', '']]) {
    typedTeam(dir, 'next request');
    agentLaunch(dir, 'Team: implementer');
    const out = agentLaunch(dir, `go\n${line}`);
    assert.ok(!denied(out), line);
    assert.match(out?.systemMessage ?? '', /speckit-team: the Team line names .*, not a team role; the full team's gates apply/, line);
    if (word) assert.match(out.systemMessage, new RegExp(`names ${word},`), line);
    assert.deepEqual(teamRecord(dir).roles, ALL_ROLES, line);
  }
});

test('team (#103): a launch of an agent that is no team role leaves the record alone', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: test-writer, implementer');
  for (const subagent_type of ['Explore', 'general-purpose', 'patcher', undefined, 7]) {
    assert.equal(agentLaunch(dir, 'look around', { tool_input: { subagent_type, prompt: 'look around' } }), null, String(subagent_type));
    assert.deepEqual(teamRecord(dir).roles, ['test-writer', 'implementer'], String(subagent_type));
  }
  assert.equal(subTool(dir), null, 'a background test-writer of the subset run still skips the audit check');
  agentLaunch(dir, 'Team: test-writer, implementer', { tool_input: { subagent_type: 'Implementer', prompt: 'go' } });
  assert.deepEqual(teamRecord(dir).roles, ALL_ROLES, 'a role name in any case is a team role; no Team line is the full team');
});

test('team (#102): an Agent call made by a subagent never decides and leaves the record alone, audit or not', () => {
  const { dir } = repo();
  assert.equal(agentLaunch(dir, 'go', { agent_id: 'sub7' }), null, 'no audit, no record: no decision');
  assert.ok(noTeamFiles(dir));
  agentLaunch(dir, 'Team: test-writer, implementer');
  for (const prompt of ['go', 'go\nTeam: implementer', 'go\nTeam: nobody']) {
    assert.equal(agentLaunch(dir, prompt, { agent_id: 'sub7' }), null, prompt);
    assert.deepEqual(teamRecord(dir).roles, ['test-writer', 'implementer'], prompt);
  }
});

test("team (#101): once the request's team has spec-auditor, a Team line cannot drop it; a typed /speckit-team starts a new request", () => {
  const { dir } = repo();
  assert.equal(typedTeam(dir, 'add a flag'), null, 'a typed /speckit-team without --team noagents only starts a request');
  agentLaunch(dir, 'go');
  assert.deepEqual(teamRecord(dir).roles, ALL_ROLES);
  const out = agentLaunch(dir, 'go\nTeam: test-writer, implementer');
  assert.ok(!denied(out), 'the launch itself is never denied');
  assert.match(msg(out), /speckit-team: the Team line drops spec-auditor, which this request's team has; the audit gate stays on\. A new \/speckit-team request chooses a new team\./);
  assert.deepEqual(teamRecord(dir).roles, ['spec-auditor', 'test-writer', 'implementer'], '#331: spec-auditor is kept, the rest is the line\'s');
  assert.match(subTool(dir).hookSpecificOutput.permissionDecisionReason, /has not passed/);
  // A Team line that keeps spec-auditor may still narrow the rest.
  agentLaunch(dir, 'go\nTeam: product-owner, architect, spec-auditor, implementer');
  assert.deepEqual(teamRecord(dir).roles, ['product-owner', 'architect', 'spec-auditor', 'implementer']);
  // The next request chooses afresh (FR-009).
  assert.equal(typedTeam(dir, '--team test-writer, implementer fix it'), null);
  assert.ok(!fs.existsSync(teamFile(dir)), 'the typed command removes the record');
  agentLaunch(dir, 'go\nTeam: test-writer, implementer');
  assert.equal(subTool(dir), null);
  // Another session's typed command changes nothing here.
  typedTeam(dir, 'other work', { session_id: 's2' });
  assert.deepEqual(teamRecord(dir).roles, ['test-writer', 'implementer']);
});

// #331: every notice of one launch is said, and the record is written, whichever notice comes first.
test('#331: a launch that drops spec-auditor still records the narrowed team, and says every notice it has', () => {
  const { dir } = repo();
  agentLaunch(dir, 'go');
  const drop = agentLaunch(dir, 'go\nTeam: test-writer, implementer\nProject: nope');
  assert.match(msg(drop), /the Team line drops spec-auditor/);
  assert.match(msg(drop), /team for this session: spec-auditor, test-writer, implementer; audit gate on/);
  assert.match(msg(drop), /the Project line names nope, which is not a project/);
  assert.deepEqual(teamRecord(dir).roles, ['spec-auditor', 'test-writer', 'implementer']);
  // A no-agents request turned into a team run says so, after the team notice or the bad-line notice.
  for (const [line, first] of [['Team: test-writer, implementer', /team for this session: test-writer, implementer; audit gate off/],
    ['Team: nobody', /the Team line names nobody, not a team role/]]) {
    typedTeam(dir, '--team noagents add a file');
    assert.equal(teamRecord(dir).noagents, true);
    const out = agentLaunch(dir, `go\n${line}`);
    assert.match(msg(out), first, line);
    assert.match(msg(out), /a team agent was launched in a no-agents request; the full team's gates apply from here/, line);
    assert.equal(teamRecord(dir).noagents, undefined, line);
  }
});

test('team noagents: a typed /speckit-team --team noagents opens the main session\'s /speckit-implement, and nothing else', () => {
  const { dir } = repo();
  assert.ok(denied(mainSkill(dir)), 'no audit: the Skill call is denied today');
  const out = typedTeam(dir, '--team noagents add a file');
  assert.ok(!denied(out) && out?.decision === undefined, 'never a decision');
  assert.match(msg(out), /speckit-team: no agents for this request: \/speckit-implement in this session skips the audit gate until the next \/speckit-team or team agent launch/);
  const rec = teamRecord(dir);
  assert.deepEqual(rec.roles, []);
  assert.equal(rec.noagents, true);
  assert.ok(!JSON.stringify(rec).includes('add a file'), 'no request text in the record');
  assert.equal(mainSkill(dir), null, 'the Skill call goes through');
  assert.equal(typedImplement(dir), null, 'a typed /speckit-implement goes through');
  assert.ok(denied(mainSkill(dir, { session_id: 's2' })), "another session's Skill call is still denied");
  // A team agent launched anyway turns the run into a team run: the full team's gates apply.
  agentLaunch(dir, 'go');
  assert.deepEqual(teamRecord(dir).roles, ALL_ROLES);
  assert.ok(denied(mainSkill(dir)));
});

test('team noagents: only a typed list of exactly noagents counts, in any case; a later /speckit-team ends it', () => {
  const cases = [
    ['--team NoAgents add a file', true], ['--team noagents', true], ['  --team   noagents\nadd', true],
    ['--team noagents, implementer add', false], ['--team noagents,implementer add', false], ['noagents add', false],
    ['--team implementer add', false], ['add --team noagents', false], ['--teamnoagents add', false], ['', false],
  ];
  for (const [args, opens] of cases) {
    const { dir } = repo();
    typedTeam(dir, args);
    assert.equal(denied(mainSkill(dir)), !opens, JSON.stringify(args));
  }
  const { dir } = repo();
  // Without command_args (an older Claude Code), the typed prompt is read instead.
  run(dir, ['gate'], { hook_event_name: 'UserPromptExpansion', command_name: 'speckit-team', prompt: '/speckit-team --team noagents x', session_id: 's1' });
  assert.equal(mainSkill(dir), null);
  assert.equal(typedTeam(dir, 'the next request'), null);
  assert.ok(!fs.existsSync(teamFile(dir)));
  assert.ok(denied(mainSkill(dir)), 'the next request has the full gate again');
  // A Team line written by a model is never a no-agents record for the main session.
  agentLaunch(dir, 'go\nTeam: noagents');
  assert.ok(denied(mainSkill(dir)));
});

test('team noagents: unusable input records nothing and never decides; outside a Spec Kit repo it is silent (constitution II, III)', () => {
  const { dir } = repo();
  for (const extra of [{ session_id: '../x' }, { session_id: 7 }, { session_id: undefined }, { command_args: 7, prompt: 7 }]) {
    const out = typedTeam(dir, '--team noagents x', extra);
    assert.ok(!denied(out) && out?.decision === undefined, JSON.stringify(extra));
  }
  assert.ok(noTeamFiles(dir));
  assert.ok(!fs.existsSync(path.join(stateDir(dir), 'x.json')));
  const { dir: plain } = repo({ speckit: false });
  assert.equal(typedTeam(plain, '--team noagents x'), null);
  assert.ok(!fs.existsSync(path.join(stateDir(plain), 'team')));
  // A plugin-namespaced command of the same name is the same command.
  const { dir: d3 } = repo();
  typedTeam(d3, '--team noagents x', { command_name: 'speckit-agents:speckit-team' });
  assert.equal(teamRecord(d3).noagents, true);
});

test('team gate retries (#106): without architect in the team, the retry-limit text says the user decides', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: test-writer, implementer');
  for (const id of ['n1', 'n2', 'n3']) report(dir, 'RESULT: RED', id, { session_id: 's1' });
  const subset = subTool(dir, ['gate', 'retries']).hookSpecificOutput.permissionDecisionReason;
  assert.match(subset, /3 times in a row/);
  assert.match(subset, /There is no architect in this run's team, so the user decides/);
  assert.doesNotMatch(subset, /The architect rethinks/);
  typedTeam(dir, 'next');
  agentLaunch(dir, 'go');
  const full = subTool(dir, ['gate', 'retries'], { agent_id: 'full1' });
  assert.match(full.hookSpecificOutput.permissionDecisionReason, /has not passed/, 'the full team meets the audit gate first');
  pass(dir);
  assert.match(subTool(dir, ['gate', 'retries'], { agent_id: 'full2' }).hookSpecificOutput.permissionDecisionReason, /The architect rethinks plan\.md or tasks\.md/);
});

test('team: a subagent launch records nothing; a non-string prompt or an unusable session_id does nothing (constitution III)', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: implementer', { agent_id: 'sub9' });
  assert.ok(noTeamFiles(dir));
  agentLaunch(dir, 'Team: implementer');
  for (const prompt of [7, null, { a: 1 }]) {
    const out = run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', tool_input: { prompt } });
    assert.equal(out, null);
    assert.ok(fs.existsSync(teamFile(dir)), 'a non-string prompt leaves the record alone');
  }
  const { dir: d2 } = repo();
  for (const session_id of ['../x', 'a'.repeat(200), undefined, 7]) {
    assert.equal(agentLaunch(d2, 'Team: implementer', { session_id }), null, String(session_id));
  }
  assert.ok(noTeamFiles(d2));
  assert.ok(!fs.existsSync(path.join(stateDir(d2), 'x.json')));
});

test('team: outside a Spec Kit repo an Agent launch gives no output and no record (constitution III)', () => {
  const { dir } = repo({ speckit: false });
  assert.equal(agentLaunch(dir, 'Team: implementer'), null);
  assert.ok(!fs.existsSync(path.join(stateDir(dir), 'team')));
  const { dir: d2 } = repo();
  agentLaunch(d2, 'Team: implementer');
  assert.ok(fs.existsSync(teamFile(d2)), 'the same launch in a Spec Kit repo records');
});

test('team gate: a subset without spec-auditor skips the audit check for a subagent of the same session (US3-1, FR-007, SC-003)', () => {
  const { dir } = repo();
  assert.match(subTool(dir).hookSpecificOutput.permissionDecisionReason, /has not passed/, 'no record: today');
  agentLaunch(dir, 'Team: test-writer, implementer');
  assert.equal(subTool(dir), null);
  assert.equal(subTool(dir, ['gate', 'retries']), null);
  assert.ok(fs.existsSync(path.join(stateDir(dir), 'agents', 'sub1.json')), 'lane start record still written');
});

test('team gate: a team with spec-auditor keeps the audit gate (US3-2)', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: spec-auditor, architect, test-writer');
  assert.ok(fs.existsSync(teamFile(dir)), 'the record is written, so the deny below is the audit rule');
  assert.match(subTool(dir).hookSpecificOutput.permissionDecisionReason, /has not passed/);
});

test("team gate: another session's record is ignored (FR-009)", () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: test-writer, implementer', { session_id: 'other' });
  assert.ok(fs.existsSync(teamFile(dir, 'other')), 'the record exists');
  assert.match(subTool(dir).hookSpecificOutput.permissionDecisionReason, /has not passed/);
  assert.match(subTool(dir, ['gate'], { session_id: undefined }).hookSpecificOutput.permissionDecisionReason, /has not passed/);
});

test("team gate: an unreadable record keeps the gate shut with today's text (fail closed)", () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: test-writer, implementer');
  assert.equal(subTool(dir), null, 'a readable record opens the audit check');
  fs.mkdirSync(path.dirname(teamFile(dir)), { recursive: true });
  for (const body of ['{', '{"roles": 3}', '{"roles": ["nobody"]}']) {
    fs.writeFileSync(teamFile(dir), body);
    assert.match(subTool(dir).hookSpecificOutput.permissionDecisionReason, /has not passed/, body);
  }
});

test('team gate: a subset record opens nothing without agent_id; the implement skill and typed command stay blocked (SC-004, US2-2)', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: test-writer, implementer');
  assert.ok(fs.existsSync(teamFile(dir)), 'the record exists, so the blocks below are the rule, not a missing record');
  assert.ok(denied(run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: 's1', tool_input: { skill_name: 'speckit-implement' } })));
  assert.equal(run(dir, ['gate'], {
    hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'speckit-implement', prompt: '/speckit-implement', session_id: 's1',
  })?.decision, 'block');
});

test('team gate retries: without a feature and with the audit skipped, no decision and the lane start record is written (D7)', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: test-writer, implementer');
  fs.rmSync(path.join(dir, '.specify', 'feature.json'));
  assert.equal(subTool(dir, ['gate', 'retries'], { agent_id: 'nofeat' }), null);
  assert.ok(fs.existsSync(path.join(stateDir(dir), 'agents', 'nofeat.json')));
});

test('team gate retries: with a feature, 3 REDs still deny when the audit is skipped (D6, FR-007)', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: test-writer, implementer');
  for (const id of ['r1', 'r2']) report(dir, 'RESULT: RED', id, { session_id: 's1' });
  assert.equal(subTool(dir, ['gate', 'retries']), null, 'two REDs leave it open');
  report(dir, 'RESULT: RED', 'r3', { session_id: 's1' });
  const out = subTool(dir, ['gate', 'retries']);
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /3 times in a row/);
});

test('team result: with the audit skipped a RED is counted, not "not counted" (FR-007)', () => {
  const { dir } = repo();
  assert.match(report(dir, 'RESULT: RED', 'x1', { session_id: 's1' }).systemMessage, /not counted/, 'full team, no PASS: today');
  agentLaunch(dir, 'Team: test-writer, implementer');
  const msg = report(dir, 'RESULT: RED', 'x2', { session_id: 's1' }).systemMessage;
  assert.doesNotMatch(msg, /not counted/);
  assert.match(msg, /RED.*1 of 3/);
});

// Feature 007: `project <name>` is run by the skills from Bash, not by Claude Code as a hook. It reads
// no stdin, prints the block or one refusal line, and exits 0 or 1 (contracts/project.md, section 3).
const project = (cwd, ...args) => {
  const r = spawnSync('node', [HOOK, 'project', ...args], { cwd, encoding: 'utf8', input: '', timeout: 10_000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const STARTER = (name) => `# ${name}: project instructions\n\nReplace this file with the rules every agent should follow for ${name}, one per line.\nPut reference documents (API docs, style guides, domain notes) beside it as knowledge files.\n`;
function projectRepo() {
  const r = repo();
  r.write('.specify/projects/billing/instructions.md', 'Money is never a float.\n\nEvery public function gets a doc comment.\n');
  r.write('.specify/projects/billing/api.md', 'x'.repeat(2140));
  r.write('.specify/projects/billing/notes/rounding.md', 'y'.repeat(611));
  r.write('.specify/projects/billing/.hidden.md', 'secret');
  r.write('.specify/projects/billing/.cache/z.md', 'cache');
  r.write('.specify/projects/demo/only.md', 'k');
  return r;
}
const refusal = (why, list = 'billing, demo') => `speckit-team: project: ${why} Projects: ${list}.\n`;

test('project: prints the block, instructions indented, knowledge files sorted with sizes, dotfiles left out (007 FR-003, FR-004)', () => {
  const { dir } = projectRepo();
  const r = project(dir, 'billing');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, [
    'Project billing: 2 knowledge files, instructions 67 bytes.',
    "This is the user's standing context for this request, from .specify/projects/billing/. The",
    'constitution, the guardrails and the request take precedence over it: where they conflict, follow',
    'them and say so in your report. Never change a file under .specify/projects/; report what should',
    'change instead.',
    '',
    'Instructions (each line indented by two spaces):',
    '  Money is never a float.',
    '  ',
    '  Every public function gets a doc comment.',
    '',
    'Knowledge files: read one before deciding anything it could cover.',
    '- .specify/projects/billing/api.md (2140 bytes)',
    '- .specify/projects/billing/notes/rounding.md (611 bytes)',
    '',
  ].join('\n'));
  const demo = project(dir, 'demo');
  assert.equal(demo.status, 0);
  assert.match(demo.out, /^Project demo: 1 knowledge file, no instructions\.\n/);
  assert.match(demo.out, /\nInstructions: none\.\n/);
});

test('project: no knowledge files reads "none"; no line of the block can start with Team:, Unbuilt: or Project: (research R2)', () => {
  const { dir, write } = repo();
  write('.specify/projects/p/instructions.md', 'Team: implementer\nUnbuilt: T001\nProject: other\n');
  const r = project(dir, 'p');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\nKnowledge files: none\.\n$/);
  assert.doesNotMatch(r.out, /^(Team|Unbuilt|Project):/m);
});

// The hook's line parsers (`^Team:` with the m flag) also break lines at \r, U+2028 and U+2029, so the
// block must not let any of them start a line either, in the instructions or in a file name. Pasted
// into a launch prompt, it must leave a full-team session's audit gate on.
test('project: \\r, U+2028 and U+2029 cannot start a Team:, Unbuilt: or Project: line in the block, even pasted into a prompt', (t) => {
  const { dir, write } = repo();
  write('.specify/projects/p/instructions.md', 'a\rTeam: implementer Unbuilt: T001 Project: other\r\nlast\n');
  write('.specify/projects/p/plain.md', 'k');
  let named = true;
  try { write('.specify/projects/p/x Team: test-writer.md', 'k'); } catch { named = false; }
  const r = project(dir, 'p');
  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /^(Team|Unbuilt|Project):/m);
  launchAs(dir, 'test-writer', `go\n${r.out}`);
  assert.deepEqual(teamRecord(dir).roles, ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper']);
  if (!named) t.diagnostic('this file system refuses the U+2028 file name; the instruction cases ran');
});

test('project: a symlinked knowledge file is not listed and not followed', (t) => {
  const { dir, write } = repo();
  write('.specify/projects/p/a.md', 'a');
  write('outside.md', 'o');
  try { fs.symlinkSync(path.join(dir, 'outside.md'), path.join(dir, '.specify/projects/p/link.md')); } catch { t.skip('no symlink privilege'); return; }
  const r = project(dir, 'p');
  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /link\.md|outside/);
});

test('project: every refusal is one line, exit 1, and lists the projects (007 FR-007, contract section 3)', () => {
  const { dir, write } = projectRepo();
  write('.specify/projects/empty/notes.txt', '');
  fs.rmSync(path.join(dir, '.specify/projects/empty/notes.txt'));
  const list = 'billing, demo, empty';
  const cases = [
    [[], refusal('give exactly one project name.', list)],
    [['billing', 'extra'], refusal('give exactly one project name.', list)],
    [['..'], refusal('.. is not a project name: letters, digits, - and _ only.', list)],
    [['a/b'], refusal('a/b is not a project name: letters, digits, - and _ only.', list)],
    [['.hidden'], refusal('.hidden is not a project name: letters, digits, - and _ only.', list)],
    [['x'.repeat(65)], refusal(`${'x'.repeat(65)} is not a project name: letters, digits, - and _ only.`, list)],
    [['nope'], refusal('no project nope in .specify/projects/; create it with --init.', list)],
    [['Billing'], refusal('no project Billing in .specify/projects/; create it with --init.', list)],
    [['empty'], refusal('project empty is empty: write its rules in .specify/projects/empty/instructions.md or add a knowledge file.', list)],
  ];
  for (const [args, want] of cases) {
    const r = project(dir, ...args);
    assert.equal(r.status, 1, `exit for ${JSON.stringify(args)}`);
    assert.equal(r.out, want, `line for ${JSON.stringify(args)}`);
  }
});

test('project: a directory named instructions.md is refused, not thrown', () => {
  const { dir, write } = repo();
  write('.specify/projects/p/instructions.md/x.md', 'x');
  const r = project(dir, 'p');
  assert.equal(r.status, 1);
  assert.equal(r.out, refusal('.specify/projects/p/instructions.md is not a file.', 'p'));
});

test('project: 8,192 bytes of instructions and 100 knowledge files pass; one more of either is refused (007 FR-010)', () => {
  const { dir, write } = repo();
  write('.specify/projects/big/instructions.md', 'i'.repeat(8192));
  for (let n = 0; n < 100; n++) write(`.specify/projects/big/k${String(n).padStart(3, '0')}.md`, 'k');
  assert.equal(project(dir, 'big').status, 0);
  write('.specify/projects/big/instructions.md', 'i'.repeat(8193));
  assert.equal(project(dir, 'big').out, refusal('the instructions of big are 8193 bytes; the limit is 8192.', 'big'));
  write('.specify/projects/big/instructions.md', 'ok');
  write('.specify/projects/big/sub/k100.md', 'k');
  assert.equal(project(dir, 'big').out, refusal('project big has 101 knowledge files; the limit is 100.', 'big'));
});

test('project: completes with stdin held open, and writes no state (007 FR-013)', async () => {
  const { dir } = projectRepo();
  const { spawn } = await import('node:child_process');
  const child = spawn('node', [HOOK, 'project', 'billing'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('project mode waited on stdin')); }, 10_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(status, 0);
  assert.match(out, /^Project billing:/);
  assert.equal(fs.existsSync(stateDir(dir)), false, 'no state directory');
});

test('project: outside a Spec Kit repo it refuses instead of exiting silently (audit M2)', () => {
  const plain = repo({ speckit: false });
  const want = 'speckit-team: project: no .specify/ in this repository.\n';
  assert.deepEqual([project(plain.dir, 'x').status, project(plain.dir, 'x').out], [1, want], 'git repo without .specify/');
  const nogit = fs.mkdtempSync(path.join(os.tmpdir(), 'skteam-nogit-'));
  fs.mkdirSync(path.join(nogit, '.specify', 'projects', 'x'), { recursive: true });
  fs.writeFileSync(path.join(nogit, '.specify', 'projects', 'x', 'a.md'), 'a');
  assert.deepEqual([project(nogit, 'x').status, project(nogit, 'x').out], [1, want], '.specify/ but no git repository');
  const outer = repo();
  const inner = path.join(outer.dir, 'nested');
  fs.mkdirSync(inner);
  execFileSync('git', ['init', '-q'], { cwd: inner });
  assert.deepEqual([project(inner, 'x').status, project(inner, 'x').out], [1, want], 'nested repo whose top level has no .specify/');
});

test('project --init: creates the starter file only, which counts as no instructions until edited (007 FR-015)', () => {
  const { dir } = repo();
  const r = project(dir, 'billing', '--init');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, "Created .specify/projects/billing/instructions.md: write the project's rules there, add reference files beside it, commit, and run the request again.\n");
  assert.deepEqual(fs.readdirSync(path.join(dir, '.specify/projects/billing')), ['instructions.md']);
  assert.equal(fs.readFileSync(path.join(dir, '.specify/projects/billing/instructions.md'), 'utf8'), STARTER('billing'));
  const empty = refusal('project billing is empty: write its rules in .specify/projects/billing/instructions.md or add a knowledge file.', 'billing');
  assert.equal(project(dir, 'billing').out, empty, 'unchanged starter');
  fs.writeFileSync(path.join(dir, '.specify/projects/billing/instructions.md'), `${STARTER('billing').replace(/\n/g, '\r\n')}  `);
  assert.equal(project(dir, 'billing').out, empty, 'starter with CRLF and trailing spaces');
  fs.writeFileSync(path.join(dir, '.specify/projects/billing/instructions.md'), `${STARTER('billing')}Money is never a float.\n`);
  assert.equal(project(dir, 'billing').status, 0, 'one edited line');
});

test('project --init: refuses an existing project, a bad name and outside a Spec Kit repo', () => {
  const { dir } = projectRepo();
  const before = fs.readFileSync(path.join(dir, '.specify/projects/billing/instructions.md'), 'utf8');
  assert.equal(project(dir, 'billing', '--init').out, refusal('.specify/projects/billing already exists.'));
  assert.equal(fs.readFileSync(path.join(dir, '.specify/projects/billing/instructions.md'), 'utf8'), before, 'untouched');
  assert.equal(project(dir, '../x', '--init').out, refusal('../x is not a project name: letters, digits, - and _ only.'));
  assert.equal(project(dir, '--init').out, refusal('give exactly one project name.'));
  const plain = repo({ speckit: false });
  assert.equal(project(plain.dir, 'x', '--init').status, 1);
  assert.equal(fs.existsSync(path.join(plain.dir, '.specify')), false);
});

// 007 contract section 5: the main session's launch records the Project line per session; SubagentStart
// hands the block to the agent as additionalContext.
const SEVEN = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper', 'patcher'];
const launchAs = (dir, subagent_type, prompt, extra = {}) => run(dir, ['gate'], {
  hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', tool_input: { subagent_type, prompt }, ...extra,
});
const projectFile = (dir, id = 's1') => path.join(stateDir(dir), 'project', `${id}.json`);
const startAs = (dir, agent_type, extra = {}) => run(dir, ['start'], { hook_event_name: 'SubagentStart', session_id: 's1', agent_id: 'ag1', agent_type, ...extra });
const blockOf = (dir, name) => project(dir, name).out.replace(/\n$/, '');

test('project record: a main-session launch of each of the seven roles records the Project line, and decides nothing (007 FR-003)', () => {
  const { dir } = projectRepo();
  for (const role of SEVEN) {
    fs.rmSync(projectFile(dir), { force: true });
    const out = launchAs(dir, role, 'do the thing\nProject: billing');
    assert.equal(out?.hookSpecificOutput?.permissionDecision, undefined, role);
    const rec = JSON.parse(fs.readFileSync(projectFile(dir), 'utf8'));
    assert.deepEqual(Object.keys(rec).sort(), ['at', 'name', 'session_id'], role);
    assert.equal(rec.name, 'billing', role);
    assert.equal(rec.session_id, 's1', role);
  }
});

test('project record: a launch without the line removes it; a subagent launch or another agent type changes nothing (007 FR-006, US2-2)', () => {
  const { dir } = projectRepo();
  launchAs(dir, 'implementer', 'x\nProject: billing');
  launchAs(dir, 'implementer', 'x', { agent_id: 'sub1' });
  assert.ok(fs.existsSync(projectFile(dir)), 'a launch from a subagent changes nothing');
  launchAs(dir, 'Explore', 'x');
  assert.ok(fs.existsSync(projectFile(dir)), 'a launch of another agent type changes nothing');
  launchAs(dir, 'patcher', 'x');
  assert.ok(!fs.existsSync(projectFile(dir)), 'a launch without the line removes it');
});

test('project record: a Project line naming no valid project records nothing and says so; the team is still recorded', () => {
  const { dir } = projectRepo();
  const out = launchAs(dir, 'test-writer', 'x\nTeam: test-writer, implementer\nProject: nope');
  assert.ok(!fs.existsSync(projectFile(dir)));
  assert.match(msg(out), /speckit-team: the Project line names nope, which is not a project \(no project nope in \.specify\/projects\/; create it with --init\. Projects: billing, demo\.\); agents start without project context/);
  assert.match(msg(out), /team for this session: test-writer, implementer/);
  assert.deepEqual(teamRecord(dir).roles, ['test-writer', 'implementer']);
});

test('project start: with a record, SubagentStart gives the block as additionalContext; without one, what it gave before (007 FR-003, US2-1)', () => {
  const { dir } = projectRepo();
  assert.equal(startAs(dir, 'implementer'), null, 'no record: no output, as before');
  launchAs(dir, 'implementer', 'x\nProject: billing');
  for (const role of SEVEN) {
    const out = startAs(dir, role, { agent_id: `a-${role}` });
    assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: blockOf(dir, 'billing') } }, role);
  }
  assert.deepEqual(fs.readdirSync(path.join(stateDir(dir), 'agents')).sort(), ['a-architect.json', 'a-product-owner.json'], 'lane start records for the two planning roles only');
  assert.equal(startAs(dir, 'implementer', { session_id: 's2' }), null, "another session's record is not used");
});

test('project start: a project removed mid-run or an unreadable record gives no context and says why', () => {
  const { dir } = projectRepo();
  launchAs(dir, 'implementer', 'x\nProject: demo');
  fs.rmSync(path.join(dir, '.specify/projects/demo'), { recursive: true });
  const gone = startAs(dir, 'implementer');
  assert.equal(gone?.hookSpecificOutput, undefined);
  assert.match(msg(gone), /speckit-team: project demo could not be given to implementer \(no project demo in \.specify\/projects\/; create it with --init\. Projects: billing\.\); it starts without project context/);
  fs.writeFileSync(projectFile(dir), '{');
  const bad = startAs(dir, 'implementer');
  assert.equal(bad?.hookSpecificOutput, undefined);
  assert.match(msg(bad), /project record .* is unreadable; implementer starts without project context/);
  for (const name of [7, '../x', null]) {
    fs.writeFileSync(projectFile(dir), JSON.stringify({ session_id: 's1', name }));
    const out = startAs(dir, 'implementer');
    assert.equal(out?.hookSpecificOutput, undefined, String(name));
    assert.match(msg(out), /starts without project context/, String(name));
  }
});

test('project: a typed /speckit-team removes the record, as it removes the team record (007 FR-006)', () => {
  const { dir } = projectRepo();
  launchAs(dir, 'implementer', 'x\nProject: billing');
  run(dir, ['gate'], { hook_event_name: 'UserPromptExpansion', command_name: 'speckit-team', command_args: 'next request', session_id: 's1' });
  assert.ok(!fs.existsSync(projectFile(dir)));
});

test('project: malformed launch and start input records nothing, decides nothing and never throws (constitution II, audit C1)', () => {
  const { dir } = projectRepo();
  for (const prompt of [7, ['Project: billing'], undefined]) {
    assert.equal(launchAs(dir, 'implementer', prompt), null, String(prompt));
  }
  for (const subagent_type of [7, ['implementer'], null]) {
    assert.equal(run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', tool_input: { subagent_type, prompt: 'Project: billing' } }), null, String(subagent_type));
  }
  assert.ok(!fs.existsSync(projectFile(dir)));
  launchAs(dir, 'implementer', 'x\nProject: billing');
  for (const [i, extra] of [{ session_id: undefined }, { session_id: '../x' }, { agent_type: undefined }, { agent_type: 7 }].entries()) {
    assert.equal(startAs(dir, 'product-owner', { agent_id: `m${i}`, ...extra }), null, JSON.stringify(extra));
  }
  assert.ok(!fs.existsSync(path.join(stateDir(dir), 'agents', 'm2.json')), 'no agent_type: no lane start record');
  assert.ok(!fs.existsSync(path.join(stateDir(dir), 'agents', 'm3.json')), 'a numeric agent_type: no lane start record');
});

// 007 contract section 2: the typed command's --team noagents is read past one leading --project pair.
test('project typed: --project before or after --team noagents still records no agents; --project alone records none (007 T008)', () => {
  for (const args of ['--project demo --team noagents x', '--team noagents --project demo x']) {
    const { dir } = repo();
    const out = typedTeam(dir, args);
    assert.match(msg(out), /speckit-team: no agents for this request/, args);
    assert.equal(teamRecord(dir).noagents, true, args);
    assert.equal(mainSkill(dir), null, args);
  }
  for (const args of ['--project demo x', '--project', '--project --team noagents x', '--project demo --project demo --team noagents x']) {
    const { dir } = repo();
    assert.equal(typedTeam(dir, args), null, args);
    assert.ok(!fs.existsSync(teamFile(dir)), args);
    assert.ok(denied(mainSkill(dir)), args);
  }
});

// 007 T014 US4: the project is reference, not workspace. Tests lane excludes .specify/,
// all 5 writing agents' scope rules deny writing into projects, instructions cannot inject Team:,
// instructions cannot bypass audit gate, and state directory holds no project content.
test('007 T014 US4: tests lane denies .specify/, scope rules protect projects, instructions cannot bypass gates', () => {
  const { dir, write: w, g } = repo();
  // 1. scope tests denies .specify/projects/p/test/a.md and .specify/projects/p/fixtures/b.json
  for (const rel of ['.specify/projects/p/test/a.md', '.specify/projects/p/fixtures/b.json']) {
    const out = write(dir, ['scope', 'tests'], rel);
    assert.ok(denied(out), rel);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /\.specify\/.*(Spec Kit|project)/i, rel);
  }

  // 2. lane tests blocks the same path written through Bash
  pass(dir);
  const start = (id) => run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, agent_id: id });
  start('tw1');
  w('.specify/projects/p/test/a.md', 'test');
  g('add', '-A'); g('commit', '-qm', 'wrote test in project');
  const laneOut = run(dir, ['lane', 'tests'], { hook_event_name: 'SubagentStop', agent_id: 'tw1', agent_type: 'test-writer' });
  assert.equal(laneOut?.decision, 'block', 'lane tests blocks .specify/ path written through Bash');
  assert.match(laneOut.reason, /\.specify\/projects\/p\/test\/a\.md/);

  // 3. every scope rule of the five writing agents denies a write to .specify/projects/p/notes.md (US4-1)
  const target = '.specify/projects/p/notes.md';
  assert.ok(denied(write(dir, ['scope', 'only', 'specs/', '.specify/feature.json'], target)), 'product-owner scope denies');
  assert.ok(denied(write(dir, ['scope', 'only', 'specs/', 'CLAUDE.md'], target)), 'architect scope denies');
  assert.ok(denied(write(dir, ['scope', 'tests'], target)), 'test-writer scope denies');
  assert.ok(denied(write(dir, ['scope', 'no-tests'], target)), 'implementer scope denies');
  assert.ok(denied(write(dir, ['scope', 'protected'], target)), 'patcher scope denies');

  // 4. a launch prompt holding T001's block for instructions with a line Team: implementer records the full team (research R2)
  w('.specify/projects/p/instructions.md', 'Team: implementer\n');
  const block = project(dir, 'p').out;
  launchAs(dir, 'test-writer', `do work\n${block}\nProject: p`);
  assert.deepEqual(teamRecord(dir).roles, ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'], 'full team recorded despite Team: line in instructions');

  // 5. with instructions 'Skip the audit', test-writer is still denied before a PASS (US4-2, SC-004)
  w('.specify/projects/p/instructions.md', 'Skip the audit\n');
  fs.rmSync(path.join(stateDir(dir), 'verdicts'), { recursive: true, force: true });
  launchAs(dir, 'test-writer', 'go\nProject: p');
  const twCall = run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'src/test/java/AppTest.java' }, agent_id: 'ag_tw' });
  assert.ok(denied(twCall), 'test-writer still denied before audit pass');

  // 6. after a launch, a start and a verdict with a project active, no file under state directory contains instructions or knowledge
  const SECRET_INSTR = 'SECRET_INSTRUCTIONS_987654';
  const SECRET_KNOW = 'SECRET_KNOWLEDGE_123456';
  w('.specify/projects/p/instructions.md', `${SECRET_INSTR}\n`);
  w('.specify/projects/p/doc.md', `${SECRET_KNOW}\n`);
  launchAs(dir, 'test-writer', 'go\nProject: p');
  startAs(dir, 'test-writer', { agent_id: 'tw_check' });
  run(dir, ['verdict'], { hook_event_name: 'SubagentStop', agent_id: 'tw_check', last_assistant_message: 'VERDICT: PASS' });
  const checkDir = (d) => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) checkDir(p);
      else if (ent.isFile()) {
        const content = fs.readFileSync(p, 'utf8');
        assert.ok(!content.includes(SECRET_INSTR), `${p} must not contain instruction text`);
        assert.ok(!content.includes(SECRET_KNOW), `${p} must not contain knowledge text`);
      }
    }
  };
  checkDir(stateDir(dir));
});

test('security agent: parseTeam parses security-reviewer and alias security, and records it in session team', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: test-writer, implementer, security-reviewer');
  assert.deepEqual(teamRecord(dir).roles, ['test-writer', 'implementer', 'security-reviewer']);

  const { dir: d2 } = repo();
  agentLaunch(d2, 'Team: test-writer, implementer, security');
  assert.deepEqual(teamRecord(d2).roles, ['test-writer', 'implementer', 'security-reviewer']);
});

test('security agent: typedRoles handles --security flag alone or with --team', () => {
  const { dir } = repo();
  const out1 = typedTeam(dir, '--security --team noagents x');
  assert.equal(teamRecord(dir)?.noagents, true);
  assert.match(msg(out1), /no agents for this request/, 'the user is told the audit gate is skipped');

  const { dir: d2 } = repo();
  const out2 = typedTeam(d2, '--team noagents --security x');
  assert.equal(teamRecord(d2)?.noagents, true);
  assert.match(msg(out2), /no agents for this request/);

  const { dir: d3 } = repo();
  assert.equal(typedTeam(d3, '--security x'), null);
  assert.ok(!fs.existsSync(teamFile(d3)));

  for (const args of [
    '--security --security --team noagents x',
    '--security --project demo --security --team noagents x',
    '--project demo --security --project demo --team noagents x',
  ]) {
    const { dir: d } = repo();
    assert.equal(typedTeam(d, args), null, args);
    assert.ok(!fs.existsSync(teamFile(d)), args);
  }
});

test('security agent: main session can launch security-reviewer', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Team: product-owner, security-reviewer, implementer');
  const launch = run(dir, ['gate'], {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    session_id: 's1',
    tool_input: { subagent_type: 'security-reviewer', prompt: 'Team: product-owner, security-reviewer, implementer\nReview spec' },
  });
  assert.equal(launch?.decision, undefined, 'launch of security-reviewer is allowed');
  assert.deepEqual(teamRecord(dir).roles, ['product-owner', 'implementer', 'security-reviewer']);
});

test('security agent: default launch with no Team line does not include security-reviewer', () => {
  const { dir } = repo();
  agentLaunch(dir, 'Go build');
  assert.deepEqual(teamRecord(dir).roles, ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper']);
  assert.ok(!teamRecord(dir).roles.includes('security-reviewer'), 'opt-in role is not in default team');
});

// agent_id names the per-agent state files. It was joined into their paths unchecked, while session_id
// is checked, so an id with path segments wrote the hook's state anywhere the hook could write.
test('an agent_id that is not an id never puts state outside .git/speckit-team/agents/, and the once-only asks still hold', () => {
  const { dir } = repo();
  pass(dir);
  const agent_id = '../../../escaped';
  const escaped = () => [dir, path.join(dir, '.git'), stateDir(dir)]
    .flatMap((d) => fs.readdirSync(d).filter((f) => f.startsWith('escaped')).map((f) => path.join(d, f)));
  assert.equal(write(dir, ['gate'], 'src/main/App.java', { agent_id }), null, 'gate: the audit passed, the write goes through');
  run(dir, ['verdict'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, agent_id });
  const ends = ['ends', 'DONE'];
  const report = { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'no word' }, agent_id };
  assert.ok(denied(run(dir, ends, report)), 'ends: refused once');
  assert.equal(run(dir, ends, report), null, 'ends: never twice');
  assert.ok(denied(run(dir, ['result'], report)), 'result: refused once');
  assert.deepEqual(escaped(), []);
  const kept = fs.readdirSync(path.join(stateDir(dir), 'agents'));
  assert.ok(kept.length >= 4, `the state is kept under agents/: ${kept}`);
});


// 009 T003 (FR-002, FR-006, FR-008, FR-011, US3-1..3, contract sections 3 and 7): the typed
// /speckit-team --team skill-agents. The hook finds the role skills from its own folder (TEAM_DIR), so a
// copy of it sits beside a skills/ folder in a temp dir.
const SKILL_ROLES = [...ALL_ROLES, 'security-reviewer'];
function skillHook(missing = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skhook-'));
  fs.mkdirSync(path.join(root, 'hooks'));
  fs.copyFileSync(HOOK, path.join(root, 'hooks', 'speckit-team.mjs'));
  for (const role of SKILL_ROLES.filter((r) => !missing.includes(r))) {
    fs.mkdirSync(path.join(root, 'skills', `speckit-role-${role}`), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', `speckit-role-${role}`, 'SKILL.md'), `---\nname: speckit-role-${role}\n---\n`);
  }
  return path.join(root, 'hooks', 'speckit-team.mjs');
}
const typedWith = (dir, hook, args, extra = {}) => run(dir, ['gate'], {
  hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'speckit-team',
  command_args: args, prompt: `/speckit-team ${args}`, session_id: 's1', ...extra,
}, hook);
const roleFile = (dir, id = 's1') => path.join(stateDir(dir), 'role', `${id}.json`);
const blockReason = (out) => out?.reason ?? out?.hookSpecificOutput?.permissionDecisionReason ?? '';

test('009 T003 FR-002 FR-006 US3-1 contract 3 and 7: a typed --team skill-agents records skillAgents and answers with the start message', () => {
  const { dir } = repo();
  const out = typedWith(dir, skillHook(), '--team skill-agents add a flag');
  assert.ok(!denied(out) && out?.decision === undefined, 'no decision');
  assert.match(msg(out), /^speckit-team: skill-agents for this request: the roles run as skills in this session\./);
  assert.match(msg(out), /Not enforced: the audit gate on each tool call inside test-writer and implementer/);
  const rec = teamRecord(dir);
  assert.equal(rec.skillAgents, true);
  assert.deepEqual(rec.roles, SKILL_ROLES);
  assert.ok(!JSON.stringify(rec).includes('add a flag'), 'no request text in the record');
});

// #184: a background task's notice, a compaction and a message typed while a role runs carry the turn's
// prompt_id (probed 2026-11-08, pinned in e2e.test.mjs), so they end no role and FR-008 has nothing to name.
test('#184: the start message no longer names the inputs whose prompt_id the probe settled', () => {
  const { dir } = repo();
  const out = typedWith(dir, skillHook(), '--team skill-agents add a flag');
  assert.doesNotMatch(msg(out), /Not observed/);
  assert.doesNotMatch(msg(out), /background task's notice|compaction|typed while a role runs/);
  assert.match(msg(out), /a role's lane after its turn ends without a Stop/);
});

test('009 T003 FR-002 US3-1 US3-2 US3-3: which typed forms count', () => {
  const cases = [
    ['--team skill-agents add', true], ['--team Skill-Agents add', true], ['--team SKILL-AGENTS', true],
    ['--security --team skill-agents add', true], ['--project x --team skill-agents add', true],
    ['--security --project x --team skill-agents add', true],
    ['--team skill-agents,implementer add', false], ['--team skill-agents, implementer add', false],
    ['--team implementer, skill-agents add', false], ['--team skill-agents noagents add', false],
    ['--team skill-agent add', false], ['--team skill-agents-x add', false], ['skill-agents add', false],
    ['add a flag --team skill-agents', false], ['add --team skill-agents', false], ['--team noagents add', false], ['', false],
  ];
  const hook = skillHook();
  for (const [args, counts] of cases) {
    const { dir } = repo();
    typedWith(dir, hook, args);
    const rec = fs.existsSync(teamFile(dir)) ? teamRecord(dir) : {};
    assert.equal(rec.skillAgents === true, counts, JSON.stringify(args));
  }
});

test('009 T003 FR-011 contract 3: a missing role skill blocks the typed command and names it', () => {
  const { dir } = repo();
  const out = typedWith(dir, skillHook(['architect']), '--team skill-agents add a flag');
  assert.equal(out?.decision, 'block', JSON.stringify(out));
  assert.match(blockReason(out), /speckit-role-architect/);
  assert.doesNotMatch(blockReason(out), /speckit-role-implementer/);
  assert.match(blockReason(out), /node install\.mjs/);
  assert.ok(noTeamFiles(dir), 'no team record');
  const two = typedWith(repo().dir, skillHook(['implementer', 'spec-auditor']), '--team skill-agents x');
  assert.match(blockReason(two), /speckit-role-implementer/);
  assert.match(blockReason(two), /speckit-role-spec-auditor/);
});

test('009 T003 contract 3: every typed /speckit-team removes the role record and, without skill-agents, the team record', () => {
  const { dir } = repo();
  const hook = skillHook();
  typedWith(dir, hook, '--team skill-agents add');
  const rec = {
    session_id: 's1', role: 'architect', sha: 'a'.repeat(40), dirty: [], transcript: null, offset: 0,
    feature: FEAT, fingerprint: null, at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(roleFile(dir)), { recursive: true });
  fs.writeFileSync(roleFile(dir), JSON.stringify(rec));
  typedWith(dir, hook, 'the next request');
  assert.ok(!fs.existsSync(roleFile(dir)), 'the role record is removed');
  assert.ok(!fs.existsSync(teamFile(dir)), 'the team record is removed');
  fs.writeFileSync(roleFile(dir), JSON.stringify(rec));
  typedWith(dir, hook, '--team skill-agents again');
  assert.ok(!fs.existsSync(roleFile(dir)), 'skill-agents typed again also clears a role record');
  assert.equal(teamRecord(dir).skillAgents, true);
});

test('009 T003 US2: the noagents record and message are unchanged', () => {
  const { dir } = repo();
  const out = typedWith(dir, skillHook(), '--team noagents add a file');
  assert.match(msg(out), /speckit-team: no agents for this request: \/speckit-implement in this session skips the audit gate until the next \/speckit-team or team agent launch/);
  const rec = teamRecord(dir);
  assert.equal(rec.noagents, true);
  assert.deepEqual(rec.roles, []);
  assert.equal(rec.skillAgents, undefined);
});

// ---- 009 Round 2: role skills in the session (T007, T010, T013) ----
// The hook's TEAM_DIR has no role skills, so the team record is written by hand (data-model.md).
const SA_TEAM = (id = 's1') => ({ session_id: id, roles: SKILL_ROLES, skillAgents: true, at: new Date().toISOString() });
function putJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
}
const skillAgentsTeam = (dir, id = 's1') => putJson(teamFile(dir, id), SA_TEAM(id));
const transcriptIn = (dir, rows = []) => {
  const file = path.join(dir, '..', `transcript-${path.basename(dir)}.jsonl`);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r) + '\n').join(''));
  return file;
};
const skillCall = (dir, name, extra = {}, key = 'skill_name') => run(dir, ['gate'], {
  hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: 's1', tool_input: { [key]: name }, ...extra,
});
const roleRec = (dir, id = 's1') => (assert.ok(fs.existsSync(roleFile(dir, id)), 'a role record was written'), JSON.parse(fs.readFileSync(roleFile(dir, id), 'utf8')));
const hasRole = (dir, id = 's1') => fs.existsSync(roleFile(dir, id));
const reasonOf = (out) => out?.hookSpecificOutput?.permissionDecisionReason ?? out?.reason ?? '';
const headSha = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
const userRow = (content = 'next request', extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const assistantRow = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

// #179: outside a Spec Kit repo a role skill is not denied (the constitution allows no blocking and no
// output there), and its own hooks decide nothing and write nothing. README.md, "Known limits".
test('#179: outside a Spec Kit repo a role skill call and its scope and lane hooks stay silent', () => {
  const { dir } = repo({ speckit: false });
  assert.equal(skillCall(dir, 'speckit-role-implementer'), null);
  assert.equal(write(dir, ['scope', 'role'], 'tests/AppTest.java'), null);
  assert.equal(run(dir, ['lane', 'role'], { hook_event_name: 'Stop', session_id: 's1' }), null);
  assert.ok(!fs.existsSync(stateDir(dir)), 'no state written');
});

test('009 T007 FR-005 FR-006 contract 4 step 2: a role skill outside a typed skill-agents request is denied', () => {
  const { dir } = repo();
  const want = /speckit-role-product-owner runs only in a request typed as \/speckit-team --team skill-agents <request>\./;
  const none = skillCall(dir, 'speckit-role-product-owner');
  assert.ok(denied(none), 'no team record');
  assert.match(reasonOf(none), want);
  putJson(teamFile(dir), { session_id: 's1', roles: [], noagents: true, at: 'x' });
  assert.ok(denied(skillCall(dir, 'speckit-role-product-owner')), 'noagents record');
  putJson(teamFile(dir), { session_id: 's1', roles: ALL_ROLES, at: 'x' });
  const plain = skillCall(dir, 'speckit-role-product-owner');
  assert.ok(denied(plain), 'plain team record');
  assert.match(reasonOf(plain), want);
  assert.ok(!hasRole(dir), 'no role record from a denied call');
  // A malformed session_id or tool_input never crashes (run asserts exit status 0).
  for (const extra of [{ session_id: undefined }, { session_id: 7 }, { session_id: '../x' }]) skillCall(dir, 'speckit-role-product-owner', extra);
  for (const tool_input of [null, 'speckit-role-architect', { skill_name: 5 }, { skill: ['speckit-role-architect'] }, {}]) {
    run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: 's1', tool_input });
  }
});

test('009 T007 FR-008 contract 4 step 5 and data-model: product-owner is let through and the role record is written', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  const t = transcriptIn(dir, [userRow('typed'), assistantRow('hello')]);
  const size = fs.statSync(t).size;
  const out = skillCall(dir, 'speckit-role-product-owner', { transcript_path: t });
  assert.ok(!decided(out), JSON.stringify(out));
  const rec = roleRec(dir);
  assert.equal(rec.session_id, 's1');
  assert.equal(rec.role, 'product-owner');
  assert.equal(rec.sha, headSha(dir));
  assert.deepEqual(rec.dirty, []);
  assert.equal(rec.transcript, t);
  assert.equal(rec.offset, size);
  assert.equal(rec.feature, FEAT);
  assert.equal(rec.fingerprint, null, 'only spec-auditor records a fingerprint');
  assert.ok(!Number.isNaN(Date.parse(rec.at)));
  // spec-auditor records the fingerprint of the files it starts from (#77); no transcript leaves its start unknown, offset null (#180).
  const aud = skillCall(dir, 'speckit-role-spec-auditor');
  assert.ok(!decided(aud), JSON.stringify(aud));
  const r2 = roleRec(dir);
  assert.equal(r2.role, 'spec-auditor');
  assert.equal(typeof r2.fingerprint, 'string');
  assert.equal(r2.offset, null);
  assert.equal(r2.transcript ?? null, null);
  // A file dirty when the role starts is recorded.
  fs.writeFileSync(path.join(dir, 'src', 'main', 'Dirty.java'), 'x');
  skillCall(dir, 'speckit-role-architect');
  assert.deepEqual(roleRec(dir).dirty, ['src/main/Dirty.java']);
});

test('009 T007 FR-008 plan D6 contract 4 step 4: test-writer, implementer and spec-gatekeeper wait for a PASS on the current files', () => {
  for (const role of ['test-writer', 'implementer', 'spec-gatekeeper']) {
    const { dir, write: w } = repo();
    skillAgentsTeam(dir);
    const before = skillCall(dir, `speckit-role-${role}`);
    assert.ok(denied(before), `${role} before pass`);
    assert.match(reasonOf(before), /^Implementation gate: spec-auditor has not passed specs\/001-demo\. Run the Skill speckit-role-spec-auditor \(an agent launch ends skill-agents mode\) and get VERDICT: PASS first\.$/, role);
    assert.doesNotMatch(reasonOf(before), /@agent-spec-auditor/, role);
    assert.ok(!hasRole(dir), `${role}: no record from a denied call`);
    pass(dir);
    assert.ok(!decided(skillCall(dir, `speckit-role-${role}`)), `${role} after pass`);
    assert.equal(roleRec(dir).role, role);
    w(`${FEAT}/spec.md`, '# Spec\nFR-002 changed.\n');
    const after = skillCall(dir, `speckit-role-${role}`);
    assert.ok(denied(after), `${role} after a spec edit`);
    assert.match(reasonOf(after), /changed after the audit/, role);
  }
});

test('009 T007 FR-008 plan D6: spec-gatekeeper is denied after a plan edit made while implementer acted', () => {
  const { dir, write: w } = repo();
  skillAgentsTeam(dir);
  pass(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-implementer')));
  w(`${FEAT}/plan.md`, '# Plan\nedited by the implementer role\n');
  const out = skillCall(dir, 'speckit-role-spec-gatekeeper');
  assert.ok(denied(out), JSON.stringify(out));
  assert.match(reasonOf(out), /Implementation gate: .*changed after the audit/);
  assert.match(reasonOf(out), /speckit-role-spec-auditor/);
  pass(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-gatekeeper')), 'a new PASS opens it');
});

test('009 T007 contract 4 step 4: in a skill-agents session the speckit-implement Skill call names the role skill, not the agent; other teams keep @agent-spec-auditor', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  const out = skillCall(dir, 'speckit-implement');
  assert.ok(denied(out));
  assert.match(reasonOf(out), /Run the Skill speckit-role-spec-auditor \(an agent launch ends skill-agents mode\) and get VERDICT: PASS first\./);
  assert.doesNotMatch(reasonOf(out), /@agent-spec-auditor/);
  putJson(teamFile(dir), { session_id: 's1', roles: ALL_ROLES, at: 'x' });
  assert.match(reasonOf(skillCall(dir, 'speckit-implement')), /Run @agent-spec-auditor and get VERDICT: PASS first\./);
  fs.rmSync(teamFile(dir));
  assert.match(reasonOf(skillCall(dir, 'speckit-implement')), /Run @agent-spec-auditor and get VERDICT: PASS first\./, 'no record');
});

test('009 T007 contract 4 step 1 and name matching: a subagent, patcher, an unknown role and a plugin prefix', () => {
  const { dir } = repo();
  // From a subagent: no decision, even with no team record, and no role record.
  assert.ok(!decided(skillCall(dir, 'speckit-role-test-writer', { agent_id: 'sub1' })));
  assert.ok(!hasRole(dir));
  skillAgentsTeam(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-test-writer', { agent_id: 'sub1' })), 'a gated role, from a subagent');
  assert.ok(!hasRole(dir));
  // Names that are not a team role decide nothing, with or without the record.
  for (const name of ['speckit-role-patcher', 'speckit-role-x', 'speckit-role-', 'xspeckit-role-architect', 'speckit-role-architect-2']) {
    assert.ok(!decided(skillCall(dir, name)), name);
    assert.ok(!hasRole(dir), name);
  }
  fs.rmSync(teamFile(dir));
  assert.ok(!decided(skillCall(dir, 'speckit-role-patcher')), 'patcher without a record');
  assert.ok(denied(skillCall(dir, 'speckit-role-architect')), 'control: a team role without a record is denied');
  // A plugin-prefixed name counts; the field may be skill, skill_name or name.
  assert.ok(denied(skillCall(dir, 'plugin:speckit-role-architect')), 'prefixed, no record');
  skillAgentsTeam(dir);
  for (const key of ['skill_name', 'skill', 'name']) {
    fs.rmSync(roleFile(dir), { force: true });
    assert.ok(!decided(skillCall(dir, 'plugin:speckit-role-architect', {}, key)), key);
    assert.equal(roleRec(dir).role, 'architect', key);
  }
});

// ---- T010: scope role ----
const putRole = (dir, role, extra = {}, id = 's1') => {
  const rec = {
    session_id: id, role, sha: headSha(dir), dirty: [], transcript: null, offset: 0, feature: FEAT,
    fingerprint: null, at: new Date().toISOString(), ...extra,
  };
  putJson(roleFile(dir, id), rec);
  return rec;
};
const roleWrite = (dir, file, extra = {}) => write(dir, ['scope', 'role'], file, { session_id: 's1', ...extra });
const READ_ONLY = ['spec-auditor', 'spec-gatekeeper', 'security-reviewer'];

test('009 T010 FR-008 SC-006 contract 5: scope role holds each role to its lane', () => {
  const { dir } = repo();
  const rows = [
    ['product-owner', [`${FEAT}/spec.md`, '.specify/feature.json'], ['src/main/App.java', 'CLAUDE.md', 'src/test/java/AppTest.java']],
    ['architect', [`${FEAT}/plan.md`, 'CLAUDE.md'], ['src/main/App.java', '.specify/feature.json']],
    ['test-writer', ['src/test/java/AppTest.java', `${FEAT}/tasks.md`], ['src/main/App.java', `${FEAT}/spec.md`]],
    ['implementer', ['src/main/App.java', `${FEAT}/tasks.md`], ['src/test/java/AppTest.java', '.specify/feature.json']],
  ];
  for (const [role, ok, bad] of rows) {
    putRole(dir, role);
    for (const f of ok) assert.equal(roleWrite(dir, f), null, `${role} may write ${f}`);
    for (const f of bad) {
      const out = roleWrite(dir, f);
      assert.ok(denied(out), `${role} may not write ${f}`);
      assert.match(reasonOf(out), new RegExp(role), `the denial names ${role}`);
      assert.doesNotMatch(reasonOf(out), /the main session/, role);
    }
    const git = roleWrite(dir, '.git/speckit-team/retries/001-demo.json');
    assert.ok(denied(git), `${role}: the git directory`);
    assert.match(reasonOf(git), /guardrail state/);
  }
  for (const role of READ_ONLY) {
    putRole(dir, role);
    for (const f of ['src/main/App.java', `${FEAT}/spec.md`, 'src/test/java/AppTest.java', 'notes.txt']) {
      const out = roleWrite(dir, f);
      assert.ok(denied(out), `${role} ${f}`);
      assert.match(reasonOf(out), new RegExp(`${role} is a read-only role and writes no files\\. Report what should change instead\\.`));
    }
    assert.ok(denied(roleWrite(dir, '.git/speckit-team/verdicts/x.json')), `${role}: git dir`);
  }
});

test('009 T010 contract 5: scope role decides nothing without a record, from a subagent, outside Spec Kit, and for other sessions', () => {
  const { dir } = repo();
  putRole(dir, 'test-writer');
  assert.ok(denied(roleWrite(dir, 'src/main/App.java')), 'control: the record denies');
  assert.equal(roleWrite(dir, 'src/main/App.java', { agent_id: 'sub1' }), null, 'a subagent');
  assert.equal(roleWrite(dir, 'src/main/App.java', { session_id: 'other' }), null, 'another session has no record');
  assert.equal(roleWrite(dir, 'src/main/App.java', { session_id: undefined }), null, 'no session_id');
  assert.equal(roleWrite(dir, 'src/main/App.java', { session_id: '../s1' }), null, 'a malformed session_id');
  fs.rmSync(roleFile(dir));
  assert.equal(roleWrite(dir, 'src/main/App.java'), null, 'no record');
  const off = repo({ speckit: false });
  putRole(off.dir, 'test-writer');
  assert.equal(roleWrite(off.dir, 'src/main/App.java'), null, 'not a Spec Kit repo');
});

test('009 T010 contract 5, data-model: an unreadable or incomplete role record denies writes', () => {
  const { dir } = repo();
  for (const body of ['{not json', '"a string"', JSON.stringify({ session_id: 's1', role: 'nobody', sha: 'a'.repeat(40) }), JSON.stringify({ session_id: 's1' })]) {
    putJson(roleFile(dir), body);
    const out = roleWrite(dir, `${FEAT}/plan.md`);
    assert.ok(denied(out), body);
    assert.match(reasonOf(out), /role/i, body);
  }
});

test('009 T010 twin: ROLE_LANES equals the scope arguments in agents/<role>.md', () => {
  const src = fs.readFileSync(HOOK, 'utf8');
  const start = src.indexOf('const ROLE_LANES');
  assert.ok(start >= 0, 'ROLE_LANES exists in the hook');
  const block = src.slice(start, src.indexOf('};', start));
  const agentsDir = path.join(path.dirname(HOOK), '..', 'agents');
  const keyAt = (r, from) => block.slice(from).search(new RegExp(`['"]?${r}['"]?\\s*:`));
  for (const role of SKILL_ROLES) {
    const text = fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8');
    const head = text.slice(0, text.indexOf('\n---', 4));
    // #337: test-writer and implementer run it in the gate's entry (`gate [retries] scope <rule>`).
    const scope = /command: '.*"(?: gate(?: retries)?)? scope ([^']+)'/.exec(head);
    const expected = scope ? scope[1].trim().split(/\s+/) : ['none'];
    if (!scope) assert.match(head, /^disallowedTools:.*\bWrite\b/m, `${role} has no scope hook and cannot write`);
    const at = keyAt(role, 0);
    assert.ok(at >= 0, `ROLE_LANES has ${role}`);
    const from = at + role.length + 1;
    const nexts = SKILL_ROLES.filter((r) => r !== role).map((r) => keyAt(r, from)).filter((n) => n >= 0);
    const seg = block.slice(from, nexts.length ? from + Math.min(...nexts) : undefined);
    const got = [...seg.matchAll(/(['"`])([^'"`]*)\1(?!\s*:)/g)].map((m) => m[2]);
    assert.deepEqual(got, expected, `${role}`);
  }
});

// Contract section 8, plan D11: a role record has ended once the hook input carries a prompt_id other than
// the record's. A record or an input without a string prompt_id stays live.
const ENDED_MSG = (role) => new RegExp(`speckit-team: the ${role} role ended with its turn and no Stop ran; its lane check and report did not run\\. Call the Skill speckit-role-${role} again to continue it\\.`);

test('009 T030 contract 8 plan D11: the Skill call stores its prompt_id, null when it is no non-empty string', () => {
  const { dir } = repo();
  const cases = [['p1', 'p1'], [undefined, null], ['', null], [7, null], [['p1'], null], [null, null]];
  for (const [given, stored] of cases) {
    skillAgentsTeam(dir);
    const out = skillCall(dir, 'speckit-role-product-owner', { prompt_id: given });
    assert.ok(!decided(out), `${JSON.stringify(given)}: ${JSON.stringify(out)}`);
    assert.equal(roleRec(dir).prompt_id, stored, `prompt_id ${JSON.stringify(given)}`);
    fs.rmSync(roleFile(dir, 's1'), { force: true });
  }
});

test('009 T030 FR-008 contract 8 plan D11: another prompt_id ends a role of each lane kind, once, with the message', () => {
  const { dir } = repo();
  const cases = [['product-owner', 'src/main/App.java'], ['test-writer', 'src/main/App.java'], ['implementer', 'src/test/java/AppTest.java'],
    ['spec-auditor', `${FEAT}/spec.md`], ['spec-gatekeeper', 'src/main/App.java']];
  for (const [role, file] of cases) {
    putRole(dir, role, { prompt_id: 'p1' });
    assert.ok(denied(roleWrite(dir, file, { prompt_id: 'p1' })), `${role}: control, the same id keeps the lane`);
    const first = roleWrite(dir, file, { prompt_id: 'p2' });
    assert.ok(!decided(first), `${role}: ${JSON.stringify(first)}`);
    assert.match(msg(first), ENDED_MSG(role));
    assert.ok(!hasRole(dir), `${role}: removed`);
    assert.equal(roleWrite(dir, file, { prompt_id: 'p2' }), null, `${role}: said once`);
  }
});

test('009 T030 contract 8 plan D11: the same id keeps the role; an absent or non-string id on either side keeps it and never crashes', () => {
  const { dir } = repo();
  const file = 'src/main/App.java';
  putRole(dir, 'test-writer', { prompt_id: 'p1' });
  assert.match(msg(roleWrite(dir, file, { prompt_id: 'p2' })) ?? '', /ended with its turn/, 'control: another string id ends it');
  const keeps = [
    ['same id', { prompt_id: 'p1' }, { prompt_id: 'p1' }],
    ['no id in the record', {}, { prompt_id: 'p2' }],
    ['a null id in the record', { prompt_id: null }, { prompt_id: 'p2' }],
    ['an empty id in the record', { prompt_id: '' }, { prompt_id: 'p2' }],
    ['a number in the record', { prompt_id: 7 }, { prompt_id: 'p2' }],
    ['no id on the input', { prompt_id: 'p1' }, {}],
    ['an empty id on the input', { prompt_id: 'p1' }, { prompt_id: '' }],
    ['a number on the input', { prompt_id: 'p1' }, { prompt_id: 7 }],
    ['an array on the input', { prompt_id: 'p1' }, { prompt_id: ['p2'] }],
    ['an object on the input', { prompt_id: 'p1' }, { prompt_id: { id: 'p2' } }],
    ['a null id on the input', { prompt_id: 'p1' }, { prompt_id: null }],
  ];
  for (const [what, rec, input] of keeps) {
    putRole(dir, 'test-writer', rec);
    const out = roleWrite(dir, file, input);
    assert.ok(denied(out), `${what}: ${JSON.stringify(out)}`);
    assert.doesNotMatch(msg(out) ?? '', /ended with its turn/, what);
    assert.ok(hasRole(dir), `${what}: record kept`);
  }
});

test('009 T030 contract 8 plan D11: a prompt row in the transcript after offset does not end a role', () => {
  const { dir } = repo();
  const t = transcriptIn(dir, [userRow('typed')]);
  putRole(dir, 'test-writer', { prompt_id: 'p1', transcript: t, offset: fs.statSync(t).size });
  fs.appendFileSync(t, JSON.stringify(userRow('written ahead of the turn')) + '\n');
  const out = roleWrite(dir, 'src/main/App.java', { prompt_id: 'p1' });
  assert.ok(denied(out), JSON.stringify(out));
  assert.ok(hasRole(dir));
});

// ---- T013: closing a role (lane check at the next Skill call and at Stop) ----
const stopRole = (dir, extra = {}) => run(dir, ['lane', 'role'], { hook_event_name: 'Stop', session_id: 's1', ...extra });
const putFile = (dir, rel, text = 'x\n') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const LANE_NEEDS_RUN = /lane check could not run/;

// #177: the session-wide Stop hook also fires as a subagent's SubagentStop; that must not close the main
// session's acting role, whose lane and report belong to the main session's own Stop.
test('#177: lane role at a subagent\'s Stop leaves the main session\'s role alone', () => {
  const { dir } = repo();
  putRole(dir, 'product-owner');
  putFile(dir, 'src/outside.js');
  const out = run(dir, ['lane', 'role'], { hook_event_name: 'SubagentStop', session_id: 's1', agent_id: 'sub1', agent_type: 'Explore' });
  assert.equal(out, null, JSON.stringify(out));
  assert.ok(hasRole(dir), 'the role is still acting');
  assert.equal(stopRole(dir)?.decision, 'block', 'the main session\'s Stop still checks its lane');
});

test('009 T013 FR-008 US3-6 contract 6 step 1: a file outside the lane denies the next role skill and blocks Stop', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  const sha = headSha(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-product-owner')));
  putFile(dir, 'src/x.js');
  putFile(dir, `${FEAT}/extra.md`);
  const next = skillCall(dir, 'speckit-role-architect');
  assert.ok(denied(next), JSON.stringify(next));
  assert.match(reasonOf(next), new RegExp(`^Lane check: product-owner changed files outside its lane: src/x\\.js\\. Restore them \\(git checkout ${sha.slice(0, 12)} -- <file>, or delete new files\\), then go on\\.$`));
  assert.equal(roleRec(dir).role, 'product-owner', 'the record stays until the lane is restored');
  const stop = stopRole(dir);
  assert.equal(stop?.decision, 'block', JSON.stringify(stop));
  assert.match(stop.reason, /Lane check: product-owner changed files outside its lane: src\/x\.js\./);
  assert.ok(hasRole(dir), 'a block keeps the record');
  const last = stopRole(dir, { stop_hook_active: true });
  assert.notEqual(last?.decision, 'block');
  assert.match(msg(last), /WARNING: product-owner left changes outside its lane: src\/x\.js/);
  assert.ok(!hasRole(dir), 'the record is removed');
  // Restored: the next call goes through and replaces the record.
  skillAgentsTeam(dir);
  putRole(dir, 'product-owner', { sha });
  fs.rmSync(path.join(dir, 'src', 'x.js'));
  assert.ok(!decided(skillCall(dir, 'speckit-role-architect')));
  assert.equal(roleRec(dir).role, 'architect');
});

// #284: every role skill loaded in a turn leaves its own `lane role` Stop hook, and Claude Code starts them
// together (five at the last Stop of the 2026-11-10 run). Each read the record before any wrote it, so each
// sent the same lane block back. One Stop says it once, and keeps the record for the next.
const stopRoleTogether = (dir, n, extra = {}) => Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [HOOK, 'lane', 'role'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve(out ? JSON.parse(out) : null) : reject(new Error(`exit ${code}: ${err}`))));
  child.stdin.end(JSON.stringify({ cwd: dir, hook_event_name: 'Stop', session_id: 's1', ...extra }));
})));
test('#284: five lane role processes at one Stop send the lane block back once, and keep the record', async () => {
  const { dir } = repo();
  putRole(dir, 'product-owner');
  putFile(dir, 'src/x.js');
  const t = transcriptIn(dir, [userRow('typed'), assistantRow('Spec written.')]);
  const outs = await stopRoleTogether(dir, 5, { last_assistant_message: 'Spec written.', transcript_path: t });
  const blocks = outs.filter((o) => o?.decision === 'block');
  assert.equal(blocks.length, 1, JSON.stringify(outs));
  assert.match(blocks[0].reason, /^Lane check: product-owner changed files outside its lane: src\/x\.js\./);
  assert.ok(outs.every((o) => o === null || o.decision === 'block'), `the others say nothing: ${JSON.stringify(outs)}`);
  assert.ok(hasRole(dir), 'the record stays for the next Stop');
  // The next Stop follows the feedback and a new response, also five processes: no second send-back; the record
  // goes with a warning.
  fs.appendFileSync(t, `${JSON.stringify(userRow('Stop hook feedback: Lane check'))}\n${JSON.stringify(assistantRow('Restored nothing.'))}\n`);
  const next = await stopRoleTogether(dir, 5, { last_assistant_message: 'Restored nothing.', transcript_path: t, stop_hook_active: true });
  assert.ok(next.every((o) => o?.decision !== 'block'), JSON.stringify(next));
  assert.ok(next.some((o) => /WARNING: product-owner left changes outside its lane: src\/x\.js/.test(msg(o))), JSON.stringify(next));
  assert.ok(!hasRole(dir), 'the record is removed');
});

// The same race, in the order Linux CI ran it (PR #295): a process of the Stop that starts after another
// has already sent the block back reads `sentBack` as written. It is the same Stop, not the next one: it
// says nothing and leaves the record, where it used to warn and remove it under the block it followed.
test('#284: a lane role process that reads the record after its Stop sent the block back says nothing', () => {
  const { dir } = repo();
  putRole(dir, 'product-owner');
  putFile(dir, 'src/x.js');
  const t = transcriptIn(dir, [userRow('typed'), assistantRow('RED')]);
  const at = { last_assistant_message: 'RED', transcript_path: t };
  assert.equal(stopRole(dir, at)?.decision, 'block');
  const late = stopRole(dir, at);
  assert.equal(late, null, JSON.stringify(late));
  assert.ok(hasRole(dir), 'the record stays for the next Stop');
  // A later Stop whose last message is the same word: the transcript has grown, so it is told apart and warned.
  fs.appendFileSync(t, `${JSON.stringify(userRow('Stop hook feedback: Lane check'))}\n${JSON.stringify(assistantRow('RED'))}\n`);
  const next = stopRole(dir, { ...at, stop_hook_active: true });
  assert.notEqual(next?.decision, 'block', JSON.stringify(next));
  assert.match(msg(next), /WARNING: product-owner left changes outside its lane: src\/x\.js/);
  assert.ok(!hasRole(dir), 'the record is removed');
});

// #284, the hand-on: #288 let the process whose unlink removed the record speak, but on Windows two
// processes can both unlink one file in the same millisecond (3 of 6 runs of the #261 e2e case on
// 2026-11-10, each with two winners). Ten rounds, so a race that wins one round in two shows.
test('#284: five lane role processes at one Stop hand on once, in every round', async () => {
  const { dir } = repo();
  for (let round = 0; round < 10; round++) {
    putRole(dir, 'implementer');
    const outs = await stopRoleTogether(dir, 5, { last_assistant_message: 'Stub committed.\n\nRESULT: STUB', stop_hook_active: true });
    const blocks = outs.filter((o) => o?.decision === 'block');
    assert.equal(blocks.length, 1, `round ${round}: ${JSON.stringify(outs)}`);
    assert.match(blocks[0].reason, HAND_ON_MSG('implementer', 'RESULT: STUB'));
    assert.ok(!hasRole(dir), `round ${round}: the record went with the hand-on`);
  }
});

test('009 T013 FR-008 contract 6: a committed file outside the lane counts; one dirty at the start does not', () => {
  const { dir, g } = repo();
  skillAgentsTeam(dir);
  putFile(dir, 'src/preexisting.js');
  pass(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-test-writer')));
  assert.deepEqual(roleRec(dir).dirty, ['src/preexisting.js']);
  assert.equal(stopRole(dir), null, 'a file dirty at the start is not counted');
  assert.ok(!hasRole(dir));
  // Committed outside the lane while the role acted.
  skillAgentsTeam(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-test-writer')));
  putFile(dir, 'src/main/Impl.java');
  g('add', '-A'); g('commit', '-qm', 'impl by test-writer');
  const stop = stopRole(dir);
  assert.equal(stop?.decision, 'block', JSON.stringify(stop));
  assert.match(stop.reason, /Lane check: test-writer changed files outside its lane: .*src\/main\/Impl\.java/);
});

test('009 T013 plan D7 contract 6: a read-only role gets no lane check at close', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-auditor')));
  putFile(dir, 'src/written-through-bash.js');
  const stop = stopRole(dir);
  assert.ok(!decided(stop), JSON.stringify(stop));
  assert.ok(!hasRole(dir), 'removed at Stop');
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-auditor')));
  putFile(dir, 'src/again.js');
  assert.ok(!decided(skillCall(dir, 'speckit-role-architect')), 'the next role is let through');
  assert.equal(roleRec(dir).role, 'architect');
});

test('009 T030 contract 8 plan D11: another prompt_id at Stop removes the record with the message, nothing closed', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-product-owner', { prompt_id: 'p1' })));
  putFile(dir, 'src/x.js');
  for (const active of [false, true]) {
    const stop = stopRole(dir, { stop_hook_active: active, prompt_id: 'p2' });
    assert.ok(!decided(stop), `stop_hook_active ${active}: ${JSON.stringify(stop)}`);
    assert.match(msg(stop), ENDED_MSG('product-owner'));
    assert.doesNotMatch(msg(stop), /WARNING/);
    assert.ok(!hasRole(dir));
    if (!active) putRole(dir, 'product-owner', { prompt_id: 'p1' });
  }
  // The same id still gets the lane check.
  putRole(dir, 'product-owner', { prompt_id: 'p1' });
  const same = stopRole(dir, { prompt_id: 'p1' });
  assert.equal(same?.decision, 'block', JSON.stringify(same));
});

test('009 T030 contract 8 plan D11: the next role\'s Skill call after another prompt_id is let through with a new record', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-product-owner', { prompt_id: 'p1' })));
  putFile(dir, 'src/x.js');
  const out = skillCall(dir, 'speckit-role-architect', { prompt_id: 'p2' });
  assert.ok(!denied(out), JSON.stringify(out));
  assert.match(msg(out), ENDED_MSG('product-owner'));
  const rec = roleRec(dir);
  assert.equal(rec.role, 'architect');
  assert.equal(rec.prompt_id, 'p2');
  assert.ok(rec.dirty.includes('src/x.js'), 'the new record starts from the files as they are');
});

test('009 T030 contract 8 plan D11 (M3): the same role called again in the next prompt gets its lane back, from that call', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  assert.ok(!decided(skillCall(dir, 'speckit-role-product-owner', { prompt_id: 'p1' })));
  putFile(dir, 'src/first-turn.js');
  const again = skillCall(dir, 'speckit-role-product-owner', { prompt_id: 'p2' });
  assert.ok(!decided(again), JSON.stringify(again));
  assert.match(msg(again), ENDED_MSG('product-owner'));
  assert.equal(roleRec(dir).prompt_id, 'p2', 'a new record from this call');
  assert.ok(denied(roleWrite(dir, 'src/main/App.java', { prompt_id: 'p2' })), 'its lane is back');
  assert.equal(roleWrite(dir, `${FEAT}/spec.md`, { prompt_id: 'p2' }), null);
  putFile(dir, 'src/second-turn.js');
  const stop = stopRole(dir, { prompt_id: 'p2' });
  assert.equal(stop?.decision, 'block', JSON.stringify(stop));
  assert.match(stop.reason, /src\/second-turn\.js/);
  assert.doesNotMatch(stop.reason, /first-turn/);
});

test('009 T013 contract 6: no record decides nothing; an unreadable or incomplete record says the lane check could not run', () => {
  const { dir } = repo();
  assert.equal(stopRole(dir), null, 'no record');
  assert.equal(stopRole(dir, { agent_id: 'sub1' }), null, 'a subagent');
  putFile(dir, 'src/x.js');
  const bad = {
    'unreadable': '{not json',
    'a non-hex sha': { sha: '--output=x' },
    'a sha that is no commit': { sha: 'a'.repeat(40) },
    'no dirty list': { dirty: 'src' },
  };
  for (const [what, body] of Object.entries(bad)) {
    if (typeof body === 'string') putJson(roleFile(dir), body); else putRole(dir, 'product-owner', body);
    const out = stopRole(dir);
    assert.ok(!decided(out), `${what}: ${JSON.stringify(out)}`);
    assert.match(msg(out), LANE_NEEDS_RUN, what);
  }
  assert.ok(!fs.existsSync(path.join(dir, '--output=x')), 'no option reached git');
});

// ---- 009 Round 3: closing a role records its report (T016) ----
const verdictRec = (dir) => { const f = path.join(stateDir(dir), 'verdicts', '001-demo.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const endsRec = (dir) => { const f = path.join(stateDir(dir), 'ends', '001-demo.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const say = (t, text) => fs.appendFileSync(t, JSON.stringify(assistantRow(text)) + '\n');
// An auditor role started on a transcript that already holds `before`.
function auditorRole(before = []) {
  const { dir, write: w } = repo();
  skillAgentsTeam(dir);
  const t = transcriptIn(dir, [userRow('typed'), ...before]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-auditor', { transcript_path: t })));
  return { dir, t, w };
}

test('009 T016 FR-008 US3-5 contract 6 step 2: a PASS from the auditor role is recorded at the test-writer Skill call, which is let through', () => {
  const { dir, t } = auditorRole();
  say(t, 'Reading the spec.');
  say(t, 'All FRs covered.\n\nVERDICT: PASS');
  const out = skillCall(dir, 'speckit-role-test-writer', { transcript_path: t });
  assert.ok(!decided(out), `closing comes before the gate: ${JSON.stringify(out)}`);
  const v = verdictRec(dir);
  assert.equal(v?.verdict, 'PASS');
  assert.equal(v.feature, FEAT);
  assert.equal(v.role, 'spec-auditor');
  assert.equal(v.agent_id, null);
  assert.equal(roleRec(dir).role, 'test-writer', 'the record is replaced');
});

test('009 T016 FR-008 contract 6 step 2: a FAIL is recorded and test-writer is denied; the last VERDICT line wins', () => {
  const { dir, t } = auditorRole();
  say(t, 'First look.\nVERDICT: PASS');
  say(t, 'On second thought.\n\nVERDICT: FAIL');
  const out = skillCall(dir, 'speckit-role-test-writer', { transcript_path: t });
  assert.ok(denied(out), JSON.stringify(out));
  assert.match(reasonOf(out), /Implementation gate: /);
  const v = verdictRec(dir);
  assert.equal(v?.verdict, 'FAIL');
  assert.equal(v.role, 'spec-auditor');
  assert.equal(v.agent_id, null);
});

// #180: with no readable transcript at the role's start, where its texts begin is unknown, so an earlier
// turn's VERDICT must not be read as the role's. The Stop's last message is the role's own and still counts.
test('#180: a transcript unreadable at the role start reads no earlier turn as the report, and says why', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  const t = path.join(dir, 'late-transcript.jsonl');
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-auditor', { transcript_path: t })));
  fs.writeFileSync(t, [userRow('typed'), assistantRow('an earlier turn\nVERDICT: PASS'), assistantRow('Still reading.')]
    .map((r) => JSON.stringify(r)).join('\n') + '\n');
  const out = stopRole(dir);
  assert.equal(verdictRec(dir), null, 'an earlier turn\'s PASS is not the role\'s');
  assert.match(msg(out), /could not be read when the spec-auditor role started/);
  assert.match(msg(out), /speckit-role-spec-auditor/);
  const b = repo();
  skillAgentsTeam(b.dir);
  const t2 = path.join(b.dir, 'late-transcript.jsonl');
  skillCall(b.dir, 'speckit-role-spec-auditor', { transcript_path: t2 });
  fs.writeFileSync(t2, JSON.stringify(assistantRow('an earlier turn\nVERDICT: FAIL')) + '\n');
  stopRole(b.dir, { last_assistant_message: 'No findings.\nVERDICT: PASS' });
  assert.equal(verdictRec(b.dir)?.verdict, 'PASS', 'the Stop\'s last message is the role\'s own');
});

// #178: a half-written or odd row in the transcript is skipped, never a crash, and the rows around it count.
test('#178: malformed transcript rows are skipped and the role\'s verdict around them is still recorded', () => {
  const odd = [
    '{"type":"assistant","message":{"role":"assist',
    '{"type":"assistant"}',
    'null',
    '7',
    JSON.stringify({ type: 'assistant', message: null }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 5 } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: { type: 'text', text: 'VERDICT: FAIL' } } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [null, { type: 'text', text: 'VERDICT: FAIL' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 9 }] } }),
  ];
  for (const where of ['before', 'after']) {
    const { dir, t } = auditorRole();
    if (where === 'after') say(t, 'No findings.\nVERDICT: PASS');
    fs.appendFileSync(t, odd.join('\n') + '\n');
    if (where === 'before') say(t, 'No findings.\nVERDICT: PASS');
    const out = stopRole(dir);
    assert.doesNotMatch(msg(out) ?? '', /internal error|no decision made/, where);
    assert.equal(verdictRec(dir)?.verdict, 'PASS', `odd rows ${where} the verdict`);
  }
});

test('009 T016 contract 6 step 2: no VERDICT line records nothing and says so, naming the role skill', () => {
  const { dir, t } = auditorRole();
  say(t, 'I looked at everything and it seems fine.');
  assert.equal(stopRole(dir)?.decision, 'block', 'sent back once for its VERDICT line (#351)');
  const out = stopRole(dir);
  assert.equal(verdictRec(dir), null);
  assert.match(msg(out), /speckit-role-spec-auditor/);
  assert.doesNotMatch(msg(out), /@agent-spec-auditor/);
  assert.ok(!hasRole(dir), 'the record is removed at Stop');
});

test('009 T016 contract 6 step 2: a PASS above the offset is ignored', () => {
  const { dir } = auditorRole([assistantRow('earlier turn\nVERDICT: PASS')]);
  assert.equal(stopRole(dir)?.decision, 'block', 'sent back once for its VERDICT line (#351)');
  const out = stopRole(dir);
  assert.equal(verdictRec(dir), null);
  assert.match(msg(out), /speckit-role-spec-auditor/);
});

test('009 T016 FR-008 contract 6 step 2: a spec edit after the role started records nothing and says so, naming the role skill', () => {
  const { dir, t, w } = auditorRole();
  say(t, 'Done.\nVERDICT: PASS');
  w(`${FEAT}/spec.md`, '# Spec\nFR-002 edited during the audit.\n');
  const out = stopRole(dir);
  assert.equal(verdictRec(dir), null, 'a verdict on files that are gone is not recorded');
  assert.match(msg(out), /changed after it started/);
  assert.match(msg(out), /speckit-role-spec-auditor/);
  assert.doesNotMatch(msg(out), /@agent-spec-auditor/);
});

test('009 T016 FR-008 contract 6 step 2: the spec-gatekeeper role word is recorded at Stop', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-gatekeeper', { transcript_path: t })));
  say(t, 'Every task is ticked.\n\n**APPROVED**');
  say(t, 'Anything else? (chatter, not a word)');
  const out = stopRole(dir);
  assert.ok(!decided(out), JSON.stringify(out));
  const e = endsRec(dir);
  assert.equal(e?.word, 'APPROVED');
  assert.equal(e.feature, FEAT);
  assert.equal(e.role, 'spec-gatekeeper');
  assert.equal(e.agent_id, null);
  assert.ok(!hasRole(dir));
});

test('009 T016 contract 6 step 2: REJECTED is recorded too, and a report without a word records nothing', () => {
  const a = repo();
  skillAgentsTeam(a.dir);
  pass(a.dir);
  const t = transcriptIn(a.dir, [userRow('typed')]);
  skillCall(a.dir, 'speckit-role-spec-gatekeeper', { transcript_path: t });
  say(t, 'T003 is open.\nREJECTED');
  stopRole(a.dir);
  assert.equal(endsRec(a.dir)?.word, 'REJECTED');
  const b = repo();
  skillAgentsTeam(b.dir);
  pass(b.dir);
  const t2 = transcriptIn(b.dir, [userRow('typed')]);
  skillCall(b.dir, 'speckit-role-spec-gatekeeper', { transcript_path: t2 });
  say(t2, 'I think it is fine.');
  stopRole(b.dir);
  assert.equal(endsRec(b.dir), null);
});

test('009 T016 contract 6: a missing transcript says so and never crashes', () => {
  const { dir, t } = auditorRole();
  fs.rmSync(t);
  const out = stopRole(dir);
  assert.match(msg(out), /transcript/i);
  assert.equal(verdictRec(dir), null);
  assert.ok(!hasRole(dir));
  // The same at a Skill call.
  const b = auditorRole();
  fs.rmSync(b.t);
  const next = skillCall(b.dir, 'speckit-role-architect', { transcript_path: b.t });
  assert.ok(!denied(next), JSON.stringify(next));
  assert.match(msg(next), /transcript/i);
});

// ---- 009 Round 6: a role's last message from the hook input (T025, plan D10) ----
const callWithArgs = (dir, name, t, args) => skillCall(dir, name, { transcript_path: t, tool_input: { skill_name: name, args } });

test('009 T025 FR-008 US3-5 contract 6 step 2 plan D10: the race, a transcript without the VERDICT and args starting VERDICT: PASS, is recorded and let through', () => {
  const { dir, t } = auditorRole();
  say(t, 'No findings.');
  const out = callWithArgs(dir, 'speckit-role-test-writer', t, 'VERDICT: PASS\n<inputs>');
  assert.ok(!decided(out), JSON.stringify(out));
  const v = verdictRec(dir);
  assert.equal(v?.verdict, 'PASS');
  assert.equal(v.role, 'spec-auditor');
  assert.equal(v.agent_id, null);
  assert.equal(roleRec(dir).role, 'test-writer');
});

test('009 T025 contract 6 step 2: args VERDICT: FAIL after a transcript PASS records FAIL', () => {
  const { dir, t } = auditorRole();
  say(t, 'Looks good.\nVERDICT: PASS');
  const out = callWithArgs(dir, 'speckit-role-test-writer', t, 'VERDICT: FAIL\n<inputs>');
  assert.ok(denied(out), JSON.stringify(out));
  assert.equal(verdictRec(dir)?.verdict, 'FAIL');
});

// #181: D10 the other way round: the args line is the report's last line, so it wins over an earlier FAIL.
test('#181: args VERDICT: PASS after a transcript FAIL records PASS and lets test-writer through', () => {
  const { dir, t } = auditorRole();
  say(t, 'First pass: T003 has no test.\nVERDICT: FAIL');
  const out = callWithArgs(dir, 'speckit-role-test-writer', t, 'VERDICT: PASS\n<inputs>');
  assert.ok(!denied(out), JSON.stringify(out));
  assert.equal(verdictRec(dir)?.verdict, 'PASS');
});

test('009 T025 contract 6 step 2: a VERDICT on the second args line counts for nothing', () => {
  const { dir, t } = auditorRole();
  say(t, 'No findings.');
  callWithArgs(dir, 'speckit-role-architect', t, '<inputs>\nVERDICT: PASS');
  assert.equal(verdictRec(dir), null);
  const b = auditorRole();
  say(b.t, 'No findings.');
  callWithArgs(b.dir, 'speckit-role-architect', b.t, 'VERDICT: FAIL\nVERDICT: PASS');
  assert.equal(verdictRec(b.dir)?.verdict, 'FAIL', 'the first line is the one read');
});

test('009 T025 contract 6: args a number or an array never crashes and records nothing', () => {
  for (const args of [5, ['VERDICT: PASS'], { a: 1 }]) {
    const { dir, t } = auditorRole();
    say(t, 'No findings.');
    assert.ok(denied(callWithArgs(dir, 'speckit-role-architect', t, args)), 'denied once for its VERDICT line (#351)');
    const out = callWithArgs(dir, 'speckit-role-architect', t, args);
    assert.ok(!denied(out), JSON.stringify(out));
    assert.equal(verdictRec(dir), null, JSON.stringify(args));
  }
  const c = auditorRole();
  say(c.t, 'No findings.');
  callWithArgs(c.dir, 'speckit-role-architect', c.t, 'VERDICT: PASS');
  assert.equal(verdictRec(c.dir)?.verdict, 'PASS', 'a string args line is read');
});

test('009 T025 contract 6 step 2: a call denied for want of a VERDICT leaves the role live, and the same call made again with the line is let through', () => {
  const { dir, t } = auditorRole();
  say(t, 'No findings.');
  const first = callWithArgs(dir, 'speckit-role-test-writer', t, '<inputs>');
  assert.ok(denied(first), JSON.stringify(first));
  assert.equal(roleRec(dir).role, 'spec-auditor', 'the spec-auditor record is left');
  assert.equal(verdictRec(dir), null);
  const again = callWithArgs(dir, 'speckit-role-test-writer', t, 'VERDICT: PASS\n<inputs>');
  assert.ok(!decided(again), JSON.stringify(again));
  assert.equal(verdictRec(dir)?.verdict, 'PASS');
  assert.equal(roleRec(dir).role, 'test-writer');
});

test('009 T025 contract 6 step 2: the none-found message at a Skill call names args and the role skill; at Stop it is the T016 one', () => {
  const { dir, t } = auditorRole();
  say(t, 'No findings.');
  assert.ok(denied(callWithArgs(dir, 'speckit-role-architect', t, '<inputs>')), 'denied once for its VERDICT line (#351)');
  const out = callWithArgs(dir, 'speckit-role-architect', t, '<inputs>');
  assert.match(msg(out), /args/);
  assert.match(msg(out), /speckit-role-spec-auditor/);
  assert.doesNotMatch(msg(out), /@agent-spec-auditor/);
  const b = auditorRole();
  say(b.t, 'No findings.');
  assert.equal(stopRole(b.dir, { last_assistant_message: 'nothing to see' })?.decision, 'block', 'sent back once (#351)');
  const stop = stopRole(b.dir, { last_assistant_message: 'nothing to see' });
  assert.match(msg(stop), /speckit-role-spec-auditor/);
  assert.doesNotMatch(msg(stop), /\bargs\b/);
  assert.equal(verdictRec(b.dir), null);
});

test('009 T025 FR-008 contract 6 step 2: at Stop a last_assistant_message ending VERDICT: PASS over a transcript without it is recorded', () => {
  const { dir, t } = auditorRole();
  say(t, 'No findings.');
  stopRole(dir, { last_assistant_message: 'All covered.\n\nVERDICT: PASS' });
  const v = verdictRec(dir);
  assert.equal(v?.verdict, 'PASS');
  assert.equal(v.role, 'spec-auditor');
  assert.ok(!hasRole(dir));
});

test('009 T025 FR-008 contract 6 step 2: the spec-gatekeeper role APPROVED is recorded from last_assistant_message at Stop', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-gatekeeper', { transcript_path: t })));
  say(t, 'Every task is ticked.');
  stopRole(dir, { last_assistant_message: 'Every task is ticked.\n\nAPPROVED' });
  const e = endsRec(dir);
  assert.equal(e?.word, 'APPROVED');
  assert.equal(e.role, 'spec-gatekeeper');
  assert.equal(e.agent_id, null);
});

// #228 in --team skill-agents: the role's APPROVED is checked the same way. Its Stop is sent back once with
// the drift, and the role stays the acting one; after that the word is recorded as REJECTED.
test('#228 FR-001: the spec-gatekeeper role\'s APPROVED is sent back once, then recorded as REJECTED with the drift', () => {
  const { dir } = driftRepo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-gatekeeper', { transcript_path: t })));
  say(t, 'Every task is ticked.\n\nAPPROVED');
  const first = stopRole(dir);
  assert.equal(first?.decision, 'block', JSON.stringify(first));
  assert.match(first.reason, /T001: FR-001 is in none of test\/a\.test\.mjs/);
  assert.ok(hasRole(dir), 'the role still acts');
  assert.equal(endsRec(dir), null);
  const second = stopRole(dir, { stop_hook_active: true });
  assert.ok(!decided(second));
  assert.match(msg(second), /recorded as REJECTED/);
  const e = endsRec(dir);
  assert.equal(e.word, 'REJECTED');
  assert.equal(e.claimed, 'APPROVED');
  assert.equal(e.role, 'spec-gatekeeper');
  assert.ok(!hasRole(dir));
});

// #316: the test-writer role of --team skill-agents is closed by `lane role` and `gate`, not by `ends`, so
// #315's check did not reach it. Its RED is sent back once at Stop, or denied once at the next role call.
function testWriterRole() {
  const { dir, write: put } = driftRepo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-test-writer', { transcript_path: t })));
  return { dir, put, t };
}
test('#316: the test-writer role\'s RED is sent back once at Stop while a ticked test task cites an ID no test file holds', () => {
  const { dir, t } = testWriterRole();
  say(t, 'T001 fails on its assertion.\n\nRED');
  const first = stopRole(dir);
  assert.equal(first?.decision, 'block', JSON.stringify(first));
  assert.match(first.reason, /T001: FR-001 is in none of test\/a\.test\.mjs/);
  assert.match(first.reason, /"001 FR-002"/);
  assert.ok(hasRole(dir), 'the role still acts');
  // The second Stop is the hand-on, as before, and says what is still missing.
  const second = stopRole(dir);
  assert.match(reasonOf(second), /report ends RED, where \/speckit-team has no Stop/);
  assert.match(msg(second), /cited requirements no test names: [^\n]*T001: FR-001/);
});

test('#316: with the ID in the test file the test-writer role\'s Stop is the hand-on alone, and BLOCKED is never checked', () => {
  const a = testWriterRole();
  a.put('test/a.test.mjs', "test('001 FR-001 adds', () => {});\n");
  say(a.t, 'T001 fails on its assertion.\n\nRED');
  const out = stopRole(a.dir);
  assert.match(reasonOf(out), /where \/speckit-team has no Stop/);
  assert.doesNotMatch(`${reasonOf(out)}${msg(out)}`, /FR-001/);
  const b = testWriterRole();
  say(b.t, 'The spec contradicts itself.\n\nBLOCKED');
  assert.ok(!decided(stopRole(b.dir)));
});

test('#316: the next role call is denied once for the same lines, leaves the role, and is let through when made again', () => {
  const { dir, t } = testWriterRole();
  say(t, 'T001 fails on its assertion.\n\nRED');
  const first = callWithArgs(dir, 'speckit-role-implementer', t, 'T002');
  assert.ok(denied(first), JSON.stringify(first));
  assert.match(reasonOf(first), /T001: FR-001 is in none of test\/a\.test\.mjs/);
  assert.equal(roleRec(dir).role, 'test-writer', 'the test-writer record is left');
  const again = callWithArgs(dir, 'speckit-role-implementer', t, 'T002');
  assert.ok(!denied(again), JSON.stringify(again));
  assert.match(msg(again), /cited requirements no test names/);
  assert.equal(roleRec(dir).role, 'implementer');
});

// #336: `gate` runs on every tool call of test-writer and implementer, and the drift module is needed only
// where a Skill call closes a role. A stand-in module beside the hook says when it is loaded.
test('#336: gate loads the drift module only at a Skill call, not on an agent\'s tool calls', () => {
  const { dir } = driftRepo();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'skhook-'));
  const hook = path.join(folder, 'speckit-team.mjs');
  fs.copyFileSync(HOOK, hook);
  const marker = path.join(folder, 'loaded');
  fs.writeFileSync(path.join(folder, 'speckit-drift.mjs'),
    `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(marker)}, 'x');\nexport function drift() { return { problems: [] }; }\n`);
  pass(dir);
  for (const [tool, input] of [['Read', { file_path: path.join(dir, 'src', 'main', 'App.java') }], ['Grep', { pattern: 'x' }],
    ['Write', { file_path: path.join(dir, 'test', 'b.test.mjs') }], ['Bash', { command: 'npm test' }]]) {
    for (const args of [['gate'], ['gate', 'retries']]) {
      assert.equal(run(dir, args, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, agent_id: 'tw1', session_id: 's1' }, hook), null, tool);
    }
  }
  assert.ok(!fs.existsSync(marker), 'no agent tool call loaded the drift module');
  skillAgentsTeam(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: 's1', tool_input: { skill_name: 'speckit-role-spec-gatekeeper' }, transcript_path: t }, hook)));
  say(t, 'Every task is ticked.\n\nAPPROVED');
  run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: 's1', tool_input: { skill_name: 'speckit-role-security-reviewer', args: 'APPROVED' }, transcript_path: t }, hook);
  assert.ok(fs.existsSync(marker), 'the Skill call that closed spec-gatekeeper loaded it');
  assert.equal(endsRec(dir)?.word, 'APPROVED', 'and its drift() ran');
});

// #334: the test-writer role's RED on a parse or name error, or a missing test module, ran no expectation. As
// for the agent (#240): sent back once at Stop or denied once at the next role call, then said.
test('#334: the test-writer role\'s RED on a SyntaxError is sent back once at Stop, then the hand-on', () => {
  const { dir, put, t } = testWriterRole();
  put('test/a.test.mjs', "test('001 FR-001 adds', () => {});\n");
  say(t, 'test/a.test.mjs:3\nSyntaxError: Unexpected token )\n\nRED');
  const first = stopRole(dir);
  assert.equal(first?.decision, 'block', JSON.stringify(first));
  assert.match(first.reason, /Your RED reports SyntaxError: the test file did not run/);
  assert.ok(hasRole(dir), 'the role still acts');
  const second = stopRole(dir);
  assert.match(reasonOf(second), HAND_ON_MSG('test-writer', 'RED'));
  assert.match(msg(second), /reported RED on SyntaxError, which is not red for the right reason/);
});

test('#334: the next role call is denied once on a RED with a missing test module; a missing production module is red', () => {
  const { dir, put, t } = testWriterRole();
  put('test/a.test.mjs', "test('001 FR-001 adds', () => {});\n");
  say(t, "Error: Cannot find module './helpers.test.mjs'\nRequire stack:\n- " + path.join(dir, 'test', 'a.test.mjs') + '\n\nRED');
  const first = callWithArgs(dir, 'speckit-role-implementer', t, 'T002');
  assert.ok(denied(first), JSON.stringify(first));
  assert.match(reasonOf(first), /Cannot find module test\/helpers\.test\.mjs, a test file/);
  assert.equal(roleRec(dir).role, 'test-writer');
  assert.ok(!denied(callWithArgs(dir, 'speckit-role-implementer', t, 'T002')));
  const b = testWriterRole();
  b.put('test/a.test.mjs', "test('001 FR-001 adds', () => {});\n");
  say(b.t, "Error: Cannot find module '../src/a.mjs'\nRequire stack:\n- " + path.join(b.dir, 'test', 'a.test.mjs') + '\n\nRED');
  assert.match(reasonOf(stopRole(b.dir)), HAND_ON_MSG('test-writer', 'RED'));
});

// #185: the gatekeeper's report and the orchestrator's hand-over can share one response, so the word is
// the response's last standalone APPROVED or REJECTED line, not its very last line.
test('#185: a spec-gatekeeper word followed by hand-over text in the same response is recorded', () => {
  const handover = 'Every task is ticked.\n\n**APPROVED**\n\nThe feature is ready for review; open the PR when you are.';
  for (const where of ['stop', 'transcript']) {
    const { dir } = repo();
    skillAgentsTeam(dir);
    pass(dir);
    const t = transcriptIn(dir, [userRow('typed')]);
    skillCall(dir, 'speckit-role-spec-gatekeeper', { transcript_path: t });
    if (where === 'transcript') say(t, handover);
    stopRole(dir, where === 'stop' ? { last_assistant_message: handover } : {});
    assert.equal(endsRec(dir)?.word, 'APPROVED', where);
  }
  const { dir } = repo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  skillCall(dir, 'speckit-role-spec-gatekeeper', { transcript_path: t });
  say(t, 'A first pass said\nAPPROVED\nbut T003 is open.\nREJECTED\nHanding back to fix T003.');
  stopRole(dir);
  assert.equal(endsRec(dir)?.word, 'REJECTED', 'the last word line of the response wins');
  const q = repo();
  skillAgentsTeam(q.dir);
  pass(q.dir);
  const t2 = transcriptIn(q.dir, [userRow('typed')]);
  skillCall(q.dir, 'speckit-role-spec-gatekeeper', { transcript_path: t2 });
  say(t2, 'I would write APPROVED if every task were ticked.\nT003 is open.');
  stopRole(q.dir);
  assert.equal(endsRec(q.dir), null, 'a word inside a sentence is not a word line');
});

// #261: a role that ends its turn on a report /speckit-team goes on from (steps 3 to 5: no Stop there)
// holds the run for the user. Its Stop is sent back once, after the lane check and the record are done.
const HAND_ON_MSG = (role, word) => new RegExp(`^speckit-team: the ${role} role's report ends ${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, where /speckit-team has no Stop\\. Go on with the next step in this turn\\.$`);
test('#261: a role Stop on VERDICT: PASS, RESULT: STUB, RED or RESULT: GREEN is sent back once; the record is gone', () => {
  const cases = [
    ['spec-auditor', 'No findings.\n\nVERDICT: PASS', 'VERDICT: PASS'],
    ['spec-auditor', '| x |\n\n**VERDICT: PASS**\n\nAudit passed; test-writer is next.', 'VERDICT: PASS'],
    ['test-writer', 'T001 fails on the missing export.\n\nRED', 'RED'],
    ['implementer', 'Stub committed.\n\nRESULT: STUB', 'RESULT: STUB'],
    ['implementer', 'All 6 pass.\n\n`RESULT: GREEN`\n\nNext is spec-gatekeeper.', 'RESULT: GREEN'],
  ];
  for (const [role, last, word] of cases) {
    const { dir } = repo();
    skillAgentsTeam(dir);
    putRole(dir, role);
    const stop = stopRole(dir, { last_assistant_message: last });
    assert.equal(stop?.decision, 'block', `${role} ${JSON.stringify(last)}: ${JSON.stringify(stop)}`);
    assert.match(stop.reason, HAND_ON_MSG(role, word), role);
    assert.ok(!hasRole(dir), `${role}: the record is removed, so the next role's Skill call starts clean`);
    const again = stopRole(dir, { last_assistant_message: last, stop_hook_active: true });
    assert.ok(!decided(again), `${role}: sent back once only, the record went with the hand-on: ${JSON.stringify(again)}`);
  }
});

// The 2026-11-08 skill-agents run: the Stops after VERDICT: PASS and RED were sent back, the ones after
// RESULT: STUB and RESULT: GREEN were not, and the run waited for a typed "go on" twice. Claude Code sets
// stop_hook_active for the rest of a turn a Stop hook continued, so "once" is counted per role record.
test('a role called in a turn an earlier hand-on continued is handed on too', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  putRole(dir, 'spec-auditor');
  assert.equal(stopRole(dir, { last_assistant_message: 'VERDICT: PASS' })?.decision, 'block');
  for (const [role, last, word] of [['implementer', 'Stub committed.\n\nRESULT: STUB', 'RESULT: STUB'], ['test-writer', 'RED', 'RED'], ['implementer', 'RESULT: GREEN', 'RESULT: GREEN']]) {
    putRole(dir, role);
    const stop = stopRole(dir, { last_assistant_message: last, stop_hook_active: true });
    assert.equal(stop?.decision, 'block', `${role} ${word}: ${JSON.stringify(stop)}`);
    assert.match(stop.reason, HAND_ON_MSG(role, word));
    assert.ok(!hasRole(dir), role);
  }
  assert.ok(!decided(stopRole(dir, { last_assistant_message: 'RESULT: GREEN', stop_hook_active: true })), 'no new role call, no block: it cannot loop');
});

test('a role called in a continued turn that wrote outside its lane is blocked once, then warned', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  putRole(dir, 'test-writer');
  putFile(dir, 'src/main/Impl.java');
  const first = stopRole(dir, { last_assistant_message: 'RED', stop_hook_active: true });
  assert.equal(first?.decision, 'block', JSON.stringify(first));
  assert.match(first.reason, /^Lane check: test-writer changed files outside its lane: src\/main\/Impl\.java/);
  assert.ok(hasRole(dir), 'a block keeps the record');
  const second = stopRole(dir, { last_assistant_message: 'RED', stop_hook_active: true });
  assert.notEqual(second?.decision, 'block', JSON.stringify(second));
  assert.match(msg(second), /WARNING: test-writer left changes outside its lane: src\/main\/Impl\.java/);
  assert.ok(!hasRole(dir));
});

// The count lives in the role record. When the record cannot be written the hook must not throw (it would
// fail open) and must not loop: it falls back to Claude Code's own flag.
test('a role record that cannot be written still blocks a lane violation once, by stop_hook_active', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  putRole(dir, 'test-writer');
  putFile(dir, 'src/main/Impl.java');
  fs.chmodSync(roleFile(dir, 's1'), 0o444);
  try {
    const first = runRaw(dir, ['lane', 'role'], JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd: dir, last_assistant_message: 'RED' }));
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.out?.decision, 'block', JSON.stringify(first));
    assert.match(first.out.reason, /^Lane check: test-writer/);
    const second = stopRole(dir, { last_assistant_message: 'RED', stop_hook_active: true });
    assert.notEqual(second?.decision, 'block', JSON.stringify(second));
    assert.match(msg(second), /WARNING: test-writer left changes outside its lane/);
  } finally {
    if (hasRole(dir)) fs.chmodSync(roleFile(dir, 's1'), 0o644);
  }
});

test('#228: the spec-gatekeeper role called in a continued turn has its drifted APPROVED sent back once too', () => {
  const { dir } = driftRepo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-gatekeeper', { transcript_path: t })));
  say(t, 'Every task is ticked.\n\nAPPROVED');
  const first = stopRole(dir, { stop_hook_active: true });
  assert.equal(first?.decision, 'block', JSON.stringify(first));
  assert.match(first.reason, /T001: FR-001 is in none of test\/a\.test\.mjs/);
  assert.ok(hasRole(dir), 'the role still acts');
  assert.equal(endsRec(dir), null);
  const second = stopRole(dir, { stop_hook_active: true });
  assert.ok(!decided(second), JSON.stringify(second));
  assert.equal(endsRec(dir).word, 'REJECTED');
  assert.equal(endsRec(dir).claimed, 'APPROVED');
  assert.ok(!hasRole(dir));
});

test('#261: the spec-auditor role\'s PASS read from the transcript sends its Stop back, and is recorded', () => {
  const { dir, t } = auditorRole();
  say(t, 'No findings.\n\nVERDICT: PASS');
  const stop = stopRole(dir);
  assert.equal(stop?.decision, 'block', JSON.stringify(stop));
  assert.match(stop.reason, HAND_ON_MSG('spec-auditor', 'VERDICT: PASS'));
  assert.equal(verdictRec(dir)?.verdict, 'PASS', 'recorded before it is sent back');
});

test('#261: a role Stop where the skill may go to the user is let through', () => {
  const cases = [
    ['product-owner', 'Questions below.\n\nREADY FOR PLAN'],
    ['architect', 'Round 1: stub T002; red T001; green T002\n\nREADY FOR PLAN'],
    ['test-writer', 'FR-004 cannot be expressed.\n\nBLOCKED'],
    ['test-writer', 'RED\n\nThen T003 turned out to need a fixture.\n\nBLOCKED'],
    ['implementer', 'Two tests are still RED in CI, working on it.'],
    ['spec-gatekeeper', 'Every task is ticked.\n\nAPPROVED'],
    ['implementer', ''],
  ];
  for (const [role, last] of cases) {
    const { dir } = repo();
    skillAgentsTeam(dir);
    putRole(dir, role);
    const stop = stopRole(dir, last ? { last_assistant_message: last } : {});
    assert.notEqual(stop?.decision, 'block', `${role} ${JSON.stringify(last)}: ${JSON.stringify(stop)}`);
    assert.ok(!hasRole(dir), role);
  }
});

// #332: steps 3 and 6 go on without a Stop after a first FAIL, a REJECTED, a FIXED and a RESULT: RED under the
// retry limit, so those Stops are handed on too. A second FAIL and a third RED in a row go to the user.
test('#332: a role Stop on a first VERDICT: FAIL, REJECTED, FIXED or RESULT: RED is sent back once', () => {
  const cases = [
    ['spec-auditor', 'H1: plan contradicts FR-002.\n\nVERDICT: FAIL', 'VERDICT: FAIL'],
    ['spec-auditor', 'VERDICT: PASS\n\nOn re-reading, H1 holds.\n\nVERDICT: FAIL', 'VERDICT: FAIL'],
    ['spec-gatekeeper', 'T003 is open.\n\n**REJECTED**', 'REJECTED'],
    ['test-writer', 'Fixed the import.\n\nFIXED', 'FIXED'],
    ['implementer', 'T002 still fails.\n\nRESULT: RED', 'RESULT: RED'],
  ];
  for (const [role, last, word] of cases) {
    const { dir } = repo();
    skillAgentsTeam(dir);
    putRole(dir, role);
    const stop = stopRole(dir, { last_assistant_message: last });
    assert.equal(stop?.decision, 'block', `${role} ${JSON.stringify(last)}: ${JSON.stringify(stop)}`);
    assert.match(stop.reason, HAND_ON_MSG(role, word), role);
    assert.ok(!hasRole(dir), role);
    assert.ok(!decided(stopRole(dir, { last_assistant_message: last, stop_hook_active: true })), `${role}: once only`);
  }
});

const auditCount = (dir) => readState(path.join(stateDir(dir), 'audit', '001-demo.json'))?.fails ?? 0;
test('#332: the spec-auditor role\'s FAILs are counted, and the second in a row goes to the user', () => {
  const { dir, t } = auditorRole();
  say(t, 'H1 open.\n\nVERDICT: FAIL');
  assert.match(reasonOf(stopRole(dir)), HAND_ON_MSG('spec-auditor', 'VERDICT: FAIL'));
  assert.equal(auditCount(dir), 1);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-auditor', { transcript_path: t })));
  say(t, 'H1 still open.\n\nVERDICT: FAIL');
  const second = stopRole(dir);
  assert.notEqual(second?.decision, 'block', JSON.stringify(second));
  assert.equal(auditCount(dir), 2);
  // A PASS clears the count, as the agent's does. The third audit needs the user's approval first (#353).
  assert.equal(spawnSync('node', [HOOK, 'audit', '--approve'], { cwd: dir, encoding: 'utf8' }).status, 0);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-auditor', { transcript_path: t })));
  say(t, 'All good.\n\nVERDICT: PASS');
  assert.equal(stopRole(dir)?.decision, 'block');
  assert.equal(auditCount(dir), 0);
});

const redCountOf = (dir) => readState(path.join(stateDir(dir), 'retries', '001-demo.json'))?.red?.length ?? 0;
test('#332: the implementer role\'s REDs are counted per role, GREEN resets, and the third RED in a row goes to the user', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  const stopOn = (last) => { putRole(dir, 'implementer'); return stopRole(dir, { last_assistant_message: last }); };
  assert.match(reasonOf(stopOn('RESULT: RED')), HAND_ON_MSG('implementer', 'RESULT: RED'));
  assert.equal(redCountOf(dir), 1);
  assert.match(reasonOf(stopOn('RESULT: GREEN')), HAND_ON_MSG('implementer', 'RESULT: GREEN'));
  assert.equal(redCountOf(dir), 0, 'GREEN resets');
  stopOn('RESULT: RED');
  assert.match(reasonOf(stopOn('Still failing.\n\nRESULT: RED')), HAND_ON_MSG('implementer', 'RESULT: RED'));
  const third = stopOn('RESULT: RED');
  assert.notEqual(third?.decision, 'block', JSON.stringify(third));
  assert.equal(redCountOf(dir), 3);
  assert.match(msg(third), /implementer role reported RESULT: RED 3 times in a row/);
  // A role closed by the next Skill call counts too, once.
  const r = repo();
  skillAgentsTeam(r.dir);
  pass(r.dir);
  const t = transcriptIn(r.dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(r.dir, 'speckit-role-implementer', { transcript_path: t })));
  say(t, 'T002 fails.\n\nRESULT: RED');
  assert.ok(!decided(skillCall(r.dir, 'speckit-role-implementer', { transcript_path: t })));
  assert.equal(redCountOf(r.dir), 1);
});

// #341: at the retry limit the hook refuses a fourth implementer role call, as `gate retries` refuses the agent
// every tool; before, the limit held only as far as the main session followed the skill.
test('#341: a fourth implementer role call after three REDs in a row is denied until plan or tasks change', () => {
  const { dir, write: w } = repo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  const call = (name = 'speckit-role-implementer') => skillCall(dir, name, { transcript_path: t });
  for (let i = 0; i < 2; i++) {
    assert.ok(!decided(call()), `call ${i + 1}`);
    say(t, 'T002 fails.\n\nRESULT: RED');
  }
  assert.ok(!decided(call()), 'two REDs leave the third call open');
  say(t, 'T002 fails.\n\nRESULT: RED');
  const fourth = call();
  assert.ok(denied(fourth), JSON.stringify(fourth));
  assert.match(whyDenied(fourth), /Retry limit: implementer reported RESULT: RED 3 times in a row on .*001-demo.*architect rethinks/s);
  assert.equal(redCountOf(dir), 3, 'the third RED, closed by this call, was counted first');
  assert.ok(denied(call()), 'and the next one too');
  assert.ok(!denied(call('speckit-role-architect')), 'the architect can still rethink');
  w(`${FEAT}/tasks.md`, '- [ ] T001 write test\n- [ ] T002 implement, smaller\n');
  pass(dir);
  assert.ok(!decided(call()), 'a revised plan or tasks with a new audit resets the count');
});

test('#261: a role that ended with an earlier prompt, or wrote outside its lane, gets no hand-on block', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  putRole(dir, 'implementer', { prompt_id: 'p1' });
  const ended = stopRole(dir, { prompt_id: 'p2', last_assistant_message: 'RESULT: GREEN' });
  assert.ok(!decided(ended), JSON.stringify(ended));
  assert.match(msg(ended), ENDED_MSG('implementer'));
  // A lane violation blocks with the lane check's text, not this one.
  const lane = repo();
  skillAgentsTeam(lane.dir);
  putRole(lane.dir, 'test-writer');
  putFile(lane.dir, 'src/main/Impl.java');
  const out = stopRole(lane.dir, { last_assistant_message: 'RED' });
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /^Lane check: test-writer/);
  assert.doesNotMatch(out.reason, /Go on with the next step/);
});

test('009 T025 FR-008 contract 6 step 2: a spec-gatekeeper APPROVED as the first args line of the security-reviewer call is recorded', () => {
  const { dir } = repo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-gatekeeper', { transcript_path: t })));
  say(t, 'Every task is ticked.');
  callWithArgs(dir, 'speckit-role-security-reviewer', t, 'APPROVED\n<inputs>');
  const e = endsRec(dir);
  assert.equal(e?.word, 'APPROVED');
  assert.equal(e.role, 'spec-gatekeeper');
});

test('009 T025 contract 6: an unreadable transcript with the verdict in the last text records it and gives no transcript message', () => {
  const { dir, t } = auditorRole();
  fs.rmSync(t);
  const out = stopRole(dir, { last_assistant_message: 'Done.\nVERDICT: PASS' });
  assert.equal(verdictRec(dir)?.verdict, 'PASS');
  assert.doesNotMatch(msg(out) ?? '', /transcript/i);
  const b = auditorRole();
  fs.rmSync(b.t);
  const next = callWithArgs(b.dir, 'speckit-role-architect', b.t, 'VERDICT: PASS');
  assert.equal(verdictRec(b.dir)?.verdict, 'PASS');
  assert.doesNotMatch(msg(next) ?? '', /transcript/i);
});

test('009 T025 contract 6: last_assistant_message a number never crashes', () => {
  const { dir, t } = auditorRole();
  say(t, 'No findings.\nVERDICT: PASS');
  const out = stopRole(dir, { last_assistant_message: 7 });
  assert.doesNotMatch(msg(out) ?? '', /TypeError|crash/i, 'a number last message does not crash the hook');
  assert.equal(verdictRec(dir)?.verdict, 'PASS', 'the transcript still counts');
  const b = auditorRole();
  say(b.t, 'No findings.');
  stopRole(b.dir, { last_assistant_message: 'VERDICT: PASS' });
  assert.equal(verdictRec(b.dir)?.verdict, 'PASS', 'a string last message is read');
});

// --- #231: what a subagent's hooks say reaches the main session ---
// A hook's systemMessage at SubagentStop lands in the subagent's own transcript and never in the main
// session's (seen 2026-10-31 on 2.1.316): an out-of-lane file left behind, a lane check that could not
// run, an APPROVED recorded as REJECTED. Under claude -p nobody saw them. The hook now keeps each message a
// subagent's hook gives, by session, and the `relay` entry (settings.json, PostToolUse on Agent) hands them
// to the main session as additionalContext once its Agent call returns.
const relay = (dir, session_id, extra = {}) => run(dir, ['relay'], {
  hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id, tool_input: {}, tool_response: {}, ...extra,
});
const relayed = (out) => out?.hookSpecificOutput?.additionalContext ?? '';

test('#231: a lane WARNING at a subagent\'s Stop reaches the main session once, after its Agent call', () => {
  const { dir, write: w } = repo();
  subagentStart(dir, 'a9', 'architect', { session_id: 's31' });
  w('src/greet.js', 'export const greet = 1;\n');
  assert.equal(laneOnly(dir, 'a9', ['specs/'], 'architect', { session_id: 's31' })?.decision, 'block');
  const warn = laneOnly(dir, 'a9', ['specs/'], 'architect', { session_id: 's31', stop_hook_active: true });
  assert.match(msg(warn), /WARNING: architect left changes outside its lane: src\/greet\.js/, 'the terminal still gets it');
  assert.equal(relay(dir, 'another-session'), null, 'another session gets nothing');
  const out = relay(dir, 's31');
  assert.equal(out?.hookSpecificOutput?.hookEventName, 'PostToolUse');
  assert.match(relayed(out), /architect: WARNING: architect left changes outside its lane: src\/greet\.js/);
  assert.ok(!decided(out), 'never a decision');
  assert.equal(relay(dir, 's31'), null, 'handed over once');
});

test('#231: a verdict at a hand-back and an APPROVED recorded as REJECTED are relayed too; the main session\'s own Stop is not', () => {
  const { dir } = driftRepo();
  handback(dir, 'verdict', 'All good.\n\nVERDICT: PASS', { agent_type: 'spec-auditor', session_id: 's32' });
  const gk = { hook_event_name: 'SubagentStop', agent_id: 'gk31', agent_type: 'spec-gatekeeper', session_id: 's32', last_assistant_message: 'ok\n\nAPPROVED' };
  run(dir, GK, gk);
  run(dir, GK, { ...gk, stop_hook_active: true });
  const text = relayed(relay(dir, 's32'));
  assert.match(text, /spec-auditor: spec-auditor recorded VERDICT: PASS for specs\/001-demo/);
  assert.match(text, /spec-gatekeeper: speckit-team: spec-gatekeeper's APPROVED was recorded as REJECTED: .*FR-001 is in none of test\/a\.test\.mjs/);
  assert.ok(text.indexOf('spec-auditor:') < text.indexOf('spec-gatekeeper:'), 'in the order they were given');
  run(dir, ['verdict'], { hook_event_name: 'Stop', session_id: 's33', last_assistant_message: 'VERDICT: PASS' });
  assert.equal(relay(dir, 's33'), null, 'a main-session message is not a subagent\'s');
});

test('#231: relay says nothing outside a Spec Kit repo, on another tool, or without a usable session', () => {
  const { dir: plain } = repo({ speckit: false });
  assert.equal(relay(plain, 's34'), null);
  const { dir } = repo();
  assert.equal(run(dir, ['relay'], { hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 's34' }), null);
  for (const session_id of [undefined, 7, '../x']) assert.ok(!decided(relay(dir, session_id)), String(session_id));
});

// ---- decisions --recommended: the plan stop's record, when every answer is the recommended option ----
// The 2026-11-10 run (and three of 2026-11-08) wrote these edits with a script of the main session's own,
// 3 to 4 responses at the plan stop, one of them a script that failed. The command makes them in one call,
// or changes nothing and says which line it could not place.
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const SPEC = ['# Spec', '', '### Edge Cases', '', '- Sum of an empty list is `0`.', "- Capitalize of `''` is `''`.", '', '## Requirements', '',
  '- **FR-003**: `capitalize(text)` returns the text with its first character in upper case.', "- **FR-004**: `capitalize('')` returns `''`.", '', '## Assumptions', '', '- Inputs are valid.', ''].join('\n');
const PLAN = (decisions) => ['# Plan', '', '## Summary', '', 'Two functions.', '', ...decisions, ''].join('\n');
const D1 = ['### D1: What is the "first character"?', '', 'Strings are UTF-16.', '',
  '- **A (recommended): the first code point.** One case more in T005.',
  '  Spec: FR-003: "- **FR-003**: `capitalize(text)` returns the text with its first character in upper case." becomes "- **FR-003**: `capitalize(text)` returns the text with its first code point in upper case."',
  '  Spec: under Edge Cases: add "- A first letter outside the BMP is upper-cased whole: `"𐐨bc"` gives `"𐐀bc"`."',
  '- **B: the first code unit.** T005 drops its case.',
  '  Spec: under Assumptions: add "- The first character is the first UTF-16 code unit."'];
const D2 = ['', '### D2: Re-record the demo?', '', '- **A (recommended): no.** Nothing changes.', '- **B: yes.** One more task.'];
const decisionsRepo = (plan, spec = SPEC) => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, FEAT, 'plan.md'), plan);
  fs.writeFileSync(path.join(dir, FEAT, 'spec.md'), spec);
  return dir;
};
const decide = (dir, ...a) => spawnSync('node', [HOOK, 'decisions', ...a], { cwd: dir, encoding: 'utf8' });
const featFile = (dir, name) => fs.readFileSync(path.join(dir, FEAT, name), 'utf8');

test('decisions --recommended records each answer, renames the section and applies the recommended Spec: lines', () => {
  const dir = decisionsRepo(PLAN(['## Open Decisions', '', ...D1, ...D2]));
  const r = decide(dir, '--recommended');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const plan = featFile(dir, 'plan.md');
  assert.ok(!plan.includes('## Open Decisions'), plan);
  assert.ok(plan.includes(`## Decisions\n\n### D1: What is the "first character"?\n\nAnswer (${TODAY}): A, as recommended\n\nStrings are UTF-16.`), plan);
  assert.ok(plan.includes(`### D2: Re-record the demo?\n\nAnswer (${TODAY}): A, as recommended\n`), plan);
  const spec = featFile(dir, 'spec.md');
  assert.ok(spec.includes('- **FR-003**: `capitalize(text)` returns the text with its first code point in upper case.\n- **FR-004**'), spec);
  assert.ok(!spec.includes('first character in upper case'), 'the old line is gone');
  assert.ok(spec.includes("- Capitalize of `''` is `''`.\n- A first letter outside the BMP is upper-cased whole: `\"𐐨bc\"` gives `\"𐐀bc\"`.\n\n## Requirements"), `the new line ends its section:\n${spec}`);
  assert.ok(!spec.includes('UTF-16 code unit'), "option B's line is not applied");
  assert.match(r.stdout, new RegExp(`^speckit-team: decisions: recorded D1: A, D2: A as recommended in ${FEAT}/plan\\.md; 2 Spec: lines applied to ${FEAT}/spec\\.md$`, 'm'));
});

// #306: no rule fixes how an option is headed, and in the full run of 2026-11-11 the architect wrote
// "- **Option A (recommended): ...". The command found no option, changed nothing, and the main session wrote
// the record by hand in 4 more calls.
test('decisions --recommended finds an option headed "Option A" as well as "A" (#306)', () => {
  const worded = [...D1, ...D2].map((l) => l.replace(/^- \*\*([A-Z])\b/, '- **Option $1'));
  const dir = decisionsRepo(PLAN(['## Open Decisions', '', ...worded]));
  const r = decide(dir, '--recommended');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const plan = featFile(dir, 'plan.md');
  assert.ok(!plan.includes('## Open Decisions'), 'the section is renamed');
  assert.equal((plan.match(/^Answer \(\d{4}-\d\d-\d\d\): A, as recommended$/gm) || []).length, 2, plan);
  assert.ok(featFile(dir, 'spec.md').includes('its first code point in'), 'and the recommended Spec: line is applied');
});

// #310: the third form in three runs of 2026-11-11, a bold paragraph with no bullet, "**Option B (recommended): ...**",
// with plain list items under it. And a bold list item under an option ("- **A letter outside the BMP** ...") is
// not a new option A.
test('decisions --recommended finds an option written as a bold paragraph, and takes no bold detail for an option (#310)', () => {
  const para = [...D1, ...D2].map((l) => l.replace(/^- \*\*([A-Z])\b/, '**Option $1'));
  const dir = decisionsRepo(PLAN(['## Open Decisions', '', ...para]));
  const r = decide(dir, '--recommended');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((featFile(dir, 'plan.md').match(/^Answer \(\d{4}-\d\d-\d\d\): A, as recommended$/gm) || []).length, 2);
  assert.ok(featFile(dir, 'spec.md').includes('its first code point in'), 'the recommended Spec: line is applied');
  // The detail sits under the recommended option, ahead of its Spec: lines. Read as an option of its own it
  // would end the recommended one there, and the command would record the answer without changing the spec.
  const at = D1.findIndex((l) => l.startsWith('- **A (recommended)'));
  const detail = [...D1.slice(0, at + 1), '- **A letter outside the BMP** is upper-cased whole.', ...D1.slice(at + 1), ...D2];
  const dir2 = decisionsRepo(PLAN(['## Open Decisions', '', ...detail]));
  const r2 = decide(dir2, '--recommended');
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /recorded D1: A, D2: A as recommended[^\n]*2 Spec: lines applied/);
  assert.ok(featFile(dir2, 'spec.md').includes('its first code point in'), 'the Spec: lines after the detail are still the option\'s');
});

// #365: in a paid run of 2026-11-20 the architect named the heading with its markers, "under ## Assumptions" and
// "under ### Functional Requirements". The command found no such heading, changed nothing, and the gate refused
// the audit while the decisions stayed open.
test('decisions --recommended places a Spec: line whose heading is written with its # markers (#365)', () => {
  const marked = D1.map((l) => l.replace('under Edge Cases', 'under ### Edge Cases'));
  const dir = decisionsRepo(PLAN(['## Open Decisions', '', ...marked, ...D2]));
  const r = decide(dir, '--recommended');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(featFile(dir, 'spec.md').includes("- Capitalize of `''` is `''`.\n- A first letter outside the BMP"), featFile(dir, 'spec.md'));
  const b = D1.map((l) => l.replace('(recommended)', '').replace('**B: the first code unit.**', '**B (recommended): the first code unit.**').replace('under Assumptions', 'under ## Assumptions'));
  const dir2 = decisionsRepo(PLAN(['## Open Decisions', '', ...b, ...D2]));
  const r2 = decide(dir2, '--recommended');
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.ok(featFile(dir2, 'spec.md').includes('- Inputs are valid.\n- The first character is the first UTF-16 code unit.'), featFile(dir2, 'spec.md'));
});

test('decisions --recommended moves the entries under a ## Decisions section that is already there', () => {
  const dir = decisionsRepo(PLAN(['## Decisions', '', '### D0: Earlier', '', 'Answer (2026-11-01): B', '', '## Open Decisions', ...D2]));
  const r = decide(dir, '--recommended');
  assert.equal(r.status, 0, r.stdout);
  const plan = featFile(dir, 'plan.md');
  assert.ok(!plan.includes('## Open Decisions'), plan);
  assert.equal(plan.split('## Decisions').length - 1, 1, 'one Decisions section');
  assert.ok(plan.indexOf('### D0: Earlier') < plan.indexOf('### D2: Re-record the demo?'), plan);
  assert.ok(plan.includes(`### D2: Re-record the demo?\n\nAnswer (${TODAY}): A, as recommended`), plan);
});

test('decisions --recommended changes nothing and names the line when one cannot be placed', () => {
  const bad = [
    ['a quote that is not in the spec', D1.map((l) => l.replace('its first character in upper case." becomes', 'its 1st character in upper case." becomes')), /D1: the quoted text is not in \S+spec\.md: /],
    ['a heading the spec does not have', D1.map((l) => l.replace('under Edge Cases', 'under Corner Cases')), /D1: \S+spec\.md has no heading "Corner Cases"/],
    ['a Spec: line in another form', D1.map((l) => (l.includes('under Edge Cases') ? '  Spec: FR-009 new wording' : l)), /D1: not `Spec: <ID>: "<the line as it is>" becomes "<new wording>"` or `Spec: under <heading>: add "<line>"`: Spec: FR-009 new wording/],
    ['a decision with no recommended option', D1.map((l) => l.replace(' (recommended)', '')), /D1: no option is marked \(recommended\)/],
    ['a decision whose options are not headed by a letter (#306)', D1.map((l) => l.replace(/^- \*\*[A-Z]\b/, '- **Choice one')), /D1: no option line found \(one starts "- \*\*A \(recommended\):" or "- \*\*B:"\)/],
  ];
  for (const [what, d1, why] of bad) {
    const plan = PLAN(['## Open Decisions', '', ...d1, ...D2]);
    const dir = decisionsRepo(plan);
    const r = decide(dir, '--recommended');
    assert.equal(r.status, 1, `${what}: ${r.stdout}`);
    assert.match(r.stdout, why, what);
    assert.match(r.stdout, /nothing was changed/, what);
    assert.equal(featFile(dir, 'plan.md'), plan, `${what}: plan.md untouched`);
    assert.equal(featFile(dir, 'spec.md'), SPEC, `${what}: spec.md untouched`);
  }
  const twice = decisionsRepo(PLAN(['## Open Decisions', '', ...D1]), SPEC.replace('- Inputs are valid.', '- Inputs are valid.\n- **FR-003**: `capitalize(text)` returns the text with its first character in upper case.'));
  const r2 = decide(twice, '--recommended');
  assert.equal(r2.status, 1, r2.stdout);
  assert.match(r2.stdout, /D1: the quoted text is in \S+spec\.md 2 times/);
});

test('decisions refuses other arguments, a plan with no open decisions and a repo with no active feature', () => {
  const none = decisionsRepo(PLAN(['## Decisions', '', '### D0: Earlier', '', 'Answer (2026-11-01): B']));
  const r = decide(none, '--recommended');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /plan\.md has no ## Open Decisions section/);
  const args = decide(decisionsRepo(PLAN(['## Open Decisions', ...D2])), 'D1=B');
  assert.equal(args.status, 1);
  assert.match(args.stdout, /the only argument is --recommended/);
  const noFeat = decisionsRepo(PLAN(['## Open Decisions', ...D2]));
  fs.rmSync(path.join(noFeat, '.specify', 'feature.json'));
  const r3 = decide(noFeat, '--recommended');
  assert.equal(r3.status, 1);
  assert.match(r3.stdout, /no feature is active/);
});

test('decisions --recommended keeps CRLF files CRLF', () => {
  const crlf = (t) => t.replace(/\n/g, '\r\n');
  const dir = decisionsRepo(crlf(PLAN(['## Open Decisions', '', ...D1])), crlf(SPEC));
  const r = decide(dir, '--recommended');
  assert.equal(r.status, 0, r.stdout);
  for (const name of ['plan.md', 'spec.md']) assert.ok(!/[^\r]\n/.test(featFile(dir, name)), `${name} has a bare LF`);
  assert.ok(featFile(dir, 'spec.md').includes('first code point in upper case.\r\n'));
});

// The skill records the answers in the message that launches the audit. If the record fails there, the
// launch in the same message would still run, and an audit of a plan nobody settled costs a round.
test('a spec-auditor launch is refused while plan.md has open decisions, and let through once they are recorded', () => {
  const dir = decisionsRepo(PLAN(['## Open Decisions', '', ...D1, ...D2]));
  const launch = () => run(dir, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', tool_input: { subagent_type: 'spec-auditor', prompt: 'audit the spec' } });
  const held = launch();
  assert.ok(denied(held), JSON.stringify(held));
  assert.match(held.hookSpecificOutput.permissionDecisionReason, /plan\.md still has open decisions \(D1, D2\)/);
  assert.match(held.hookSpecificOutput.permissionDecisionReason, /decisions --recommended/);
  assert.equal(decide(dir, '--recommended').status, 0);
  assert.equal(denied(launch()), false, 'recorded: the audit may run');
  const empty = decisionsRepo(PLAN(['## Open Decisions', '', 'None.']));
  assert.equal(denied(run(empty, ['gate'], { hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', tool_input: { subagent_type: 'spec-auditor', prompt: 'audit the spec' } })), false, 'a section that lists no decision holds nothing up');
});

// #353: holdAudit ran only at an Agent launch, so in --team skill-agents the spec-auditor role was called
// past a plan's open decisions and past the two-FAIL limit (#242) with no approval.
test('#353: a spec-auditor role call is held like the agent launch: two FAILs in a row until --approve, and open decisions', () => {
  const { dir, t } = auditorRole();
  const call = (id) => skillCall(dir, 'speckit-role-spec-auditor', { transcript_path: t, tool_use_id: id });
  say(t, 'H1 open.\n\nVERDICT: FAIL');
  assert.ok(!decided(call('toolu_2')), 'one FAIL: the next audit may run');
  say(t, 'H1 still open.\n\nVERDICT: FAIL');
  const third = call('toolu_3');
  assert.ok(denied(third), JSON.stringify(third));
  assert.match(whyDenied(third), /VERDICT: FAIL 2 times in a row on .*001-demo.*audit --approve/s);
  assert.equal(auditCount(dir), 2, 'the FAIL this call closed was counted first');
  assert.ok(!denied(skillCall(dir, 'speckit-role-architect', { transcript_path: t })), 'the architect can still revise');
  assert.equal(spawnSync('node', [HOOK, 'audit', '--approve'], { cwd: dir, encoding: 'utf8' }).status, 0);
  assert.ok(!denied(call('toolu_4')), 'approved: one call goes ahead');
  assert.ok(denied(call('toolu_5')), 'the approval is spent');

  const r = repo();
  skillAgentsTeam(r.dir);
  r.write(`${FEAT}/plan.md`, PLAN(['## Open Decisions', '', ...D1]));
  const t2 = transcriptIn(r.dir, [userRow('typed')]);
  const held = skillCall(r.dir, 'speckit-role-spec-auditor', { transcript_path: t2 });
  assert.ok(denied(held), JSON.stringify(held));
  assert.match(whyDenied(held), /plan\.md still has open decisions \(D1\)/);
  assert.ok(!denied(skillCall(r.dir, 'speckit-role-architect', { transcript_path: t2 })), 'the architect can still settle them');
});

// #351: a role closed by the next Skill call skipped two checks the Stop (and the agent) has: the gatekeeper's
// drifted APPROVED was recorded as REJECTED with only a note, and a report with no end word was never sent
// back. Both are now refused once there too, as #316 refuses the test-writer role's RED: the call is denied,
// the role stays the acting one, and the same call made again goes through.
test('#351: the spec-gatekeeper role\'s drifted APPROVED denies the next role call once, then is recorded as REJECTED', () => {
  const { dir } = driftRepo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-spec-gatekeeper', { transcript_path: t })));
  say(t, 'Every task is ticked.\n\nAPPROVED');
  const first = callWithArgs(dir, 'speckit-role-security-reviewer', t, 'APPROVED');
  assert.ok(denied(first), JSON.stringify(first));
  assert.match(reasonOf(first), /T001: FR-001 is in none of test\/a\.test\.mjs/);
  assert.equal(roleRec(dir).role, 'spec-gatekeeper', 'the gatekeeper still acts');
  assert.equal(endsRec(dir), null, 'nothing recorded yet');
  const again = callWithArgs(dir, 'speckit-role-security-reviewer', t, 'APPROVED');
  assert.ok(!denied(again), JSON.stringify(again));
  assert.match(msg(again), /recorded as REJECTED/);
  assert.equal(endsRec(dir).word, 'REJECTED');
  assert.equal(endsRec(dir).claimed, 'APPROVED');
});

test('#351: a role report with no end word is sent back once at Stop and denied once at the next role call', () => {
  const roles = [
    ['spec-auditor', 'speckit-role-architect', /VERDICT: PASS, VERDICT: FAIL/],
    ['spec-gatekeeper', 'speckit-role-security-reviewer', /APPROVED, REJECTED/],
    ['test-writer', 'speckit-role-implementer', /RED, BLOCKED, FIXED/],
    ['implementer', 'speckit-role-spec-gatekeeper', /RESULT: STUB, RESULT: GREEN, RESULT: RED/],
  ];
  for (const [role, next, words] of roles) {
    for (const where of ['stop', 'skill']) {
      const { dir } = repo();
      skillAgentsTeam(dir);
      pass(dir);
      const t = transcriptIn(dir, [userRow('typed')]);
      assert.ok(!decided(skillCall(dir, `speckit-role-${role}`, { transcript_path: t })), `${role}: its call`);
      say(t, 'Worked on it.');
      const label = `${role} at ${where}`;
      const first = where === 'stop' ? stopRole(dir, { last_assistant_message: 'Worked on it.' }) : callWithArgs(dir, next, t, 'Worked on it.');
      assert.ok(where === 'stop' ? first?.decision === 'block' : denied(first), `${label}: ${JSON.stringify(first)}`);
      assert.match(reasonOf(first), new RegExp(`^The ${role} role's report has no final line that is exactly one of: `), label);
      assert.match(reasonOf(first), words, label);
      if (where === 'skill') assert.match(reasonOf(first), /Start the `args` of this Skill call with/, label);
      assert.equal(roleRec(dir).role, role, `${label}: the role still acts`);
      const again = where === 'stop' ? stopRole(dir, { last_assistant_message: 'Worked on it.' }) : callWithArgs(dir, next, t, 'Worked on it.');
      assert.ok(again?.decision !== 'block' && !denied(again), `${label}, again: ${JSON.stringify(again)}`);
      // As the agent's `result`: a report still without its RESULT line counts as RED.
      if (role === 'implementer') assert.equal(redCountOf(dir), 1, `${label}: counted as RED`);
    }
  }
  // Control: a report that ends in its word goes through the first time.
  const { dir } = repo();
  skillAgentsTeam(dir);
  pass(dir);
  const t = transcriptIn(dir, [userRow('typed')]);
  assert.ok(!decided(skillCall(dir, 'speckit-role-test-writer', { transcript_path: t })));
  say(t, 'The spec contradicts itself.\n\nBLOCKED');
  assert.ok(!decided(callWithArgs(dir, 'speckit-role-implementer', t, 'BLOCKED')));
});
