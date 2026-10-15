// Run: npm test (or node --test "test/*.test.mjs")
// The fast track's patch mode (feature 003), driven as test/hook.test.mjs drives the other modes: hook
// JSON on stdin, decision on stdout. A file of its own, so it runs beside hook.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOOK, FEAT, repo, run, write, denied, pass, handback, decided, stateDir, commitAll, msg } from './hook-helpers.mjs';

// ---- patch, PreToolUse: the budget stops the run (feature 003, T003) ----------------------------
const MARK = 'PATCH-CONTENT-7f3a';
const nl = (n, tag = 'l') => Array.from({ length: n }, (_, i) => `${tag}${i} ${MARK}\n`).join('');
const why = (out) => out?.hookSpecificOutput?.permissionDecisionReason ?? '';
// FR-014: a hook never echoes file content. FR-009: patch writes no verdict, retry or ends state.
function patchTool(dir, tool_name, tool_input = {}, extra = {}) {
  const out = run(dir, ['patch'], { hook_event_name: 'PreToolUse', agent_id: 'p1', agent_type: 'patcher', tool_name, tool_input, ...extra });
  assert.ok(!JSON.stringify(out ?? {}).includes(MARK), 'FR-014: output must not carry file content');
  for (const d of ['verdicts', 'retries', 'ends']) assert.ok(!fs.existsSync(path.join(stateDir(dir), d)), `FR-009: ${d}/ must not exist`);
  return out;
}
const bash = (dir, command = 'npm test', extra = {}) => patchTool(dir, 'Bash', { command }, extra);
const startFile = (dir, key = 'p1') => path.join(stateDir(dir), 'patch', `${key}.json`);
const RECORD = /\.git[\\/]speckit-team[\\/]patch[\\/]p1\.json/;
// The first call of a run records the start and is allowed.
function begin(dir, extra = {}, key = 'p1') {
  const out = patchTool(dir, 'Read', { file_path: path.join(dir, 'src/main/App.java') }, extra);
  assert.ok(!denied(out), `first call: ${why(out)}`);
  assert.ok(fs.existsSync(startFile(dir, key)), 'the first call writes the start record');
}
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const edit = (dir, rel, from, to) => {
  const ls = fs.readFileSync(path.join(dir, rel), 'utf8').split('\n');
  for (let i = from; i < to; i++) ls[i] = `x${i} ${MARK}`;
  fs.writeFileSync(path.join(dir, rel), ls.join('\n'));
};
function fresh(files = {}) {
  const r = repo();
  for (const [rel, text] of Object.entries(files)) put(r.dir, rel, text);
  if (Object.keys(files).length) commitAll(r, 'setup');
  return r;
}
const forty = () => fresh({ 'src/forty.js': nl(40, 'f') });
const okBash = (dir, msg) => { const out = bash(dir); assert.ok(!denied(out), `${msg}: ${why(out)}`); };
function overBash(dir, ...res) {
  const out = bash(dir);
  assert.ok(denied(out), 'expected a deny, got ' + JSON.stringify(out));
  for (const re of res) assert.match(why(out), re);
  return why(out);
}
const bin = () => Buffer.concat([Buffer.from(MARK), Buffer.from([0, 1, 2])]);
// A committed 10-line src/old.js with 50 lines appended, and an untracked 100-line src/wip.js.
function dirtyRepo() {
  const r = fresh({ 'src/old.js': nl(10, 'o') });
  put(r.dir, 'src/old.js', nl(10, 'o') + nl(50, 'a')); put(r.dir, 'src/wip.js', nl(100, 'w'));
  return r;
}

test('patch: 30 lines in 2 files is allowed, the 31st line is denied (FR-005, FR-006, US2-1, SC-002)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'src/a.js', nl(20, 'a')); put(dir, 'src/b.js', nl(10, 'b'));
  okBash(dir, '30 lines in 2 files');
  fs.appendFileSync(path.join(dir, 'src/b.js'), `one more ${MARK}\n`);
  overBash(dir, /31 changed production lines in 2 files/, /limit 30 lines, 2 files/, /\/speckit-team/, /uncommitted/);
});

test('patch: a modified line counts 1 (FR-005, Edge 30/31 lines)', () => {
  const { dir } = forty();
  begin(dir);
  edit(dir, 'src/forty.js', 0, 30);
  okBash(dir, '30 lines changed in place');
  edit(dir, 'src/forty.js', 30, 31);
  overBash(dir, /31 changed production lines in 1 files/);
});

test('patch: modified and new lines add up (FR-005)', () => {
  const { dir } = forty();
  begin(dir);
  edit(dir, 'src/forty.js', 0, 20); put(dir, 'src/b.js', nl(10, 'b'));
  okBash(dir, '20 changed + 10 new');
  edit(dir, 'src/forty.js', 20, 21);
  overBash(dir, /31 changed production lines in 2 files/);
});

test('patch: a file counts the larger of its insertions and deletions; deletions count (FR-005)', () => {
  const { dir } = forty();
  begin(dir);
  const orig = fs.readFileSync(path.join(dir, 'src/forty.js'), 'utf8').split('\n');
  put(dir, 'src/forty.js', nl(8, 'u') + orig.slice(5).join('\n')); // 5 lines replaced by 8: counts 8
  put(dir, 'src/b.js', nl(22, 'b'));
  okBash(dir, '8 + 22');
  fs.appendFileSync(path.join(dir, 'src/b.js'), `one more ${MARK}\n`);
  overBash(dir, /31 changed production lines in 2 files/);

  const other = forty();
  begin(other.dir);
  put(other.dir, 'src/forty.js', fs.readFileSync(path.join(other.dir, 'src/forty.js'), 'utf8').split('\n').slice(31).join('\n'));
  overBash(other.dir, /31 changed production lines in 1 files/);
});

// Owner decision 2026-10-10: .txt is documentation only under docs/ or with a documentation-style name.
test('patch: a .txt production file counts, documentation .txt does not (FR-005, owner decision 2026-10-10)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'docs/notes.txt', nl(40, 'n')); put(dir, 'README.txt', nl(40, 'r'));
  okBash(dir, 'docs/notes.txt and README.txt are docs');
  const a = fresh();
  begin(a.dir);
  put(a.dir, 'requirements.txt', nl(31, 'q'));
  overBash(a.dir, /31 changed production lines in 1 files/);
  const b = fresh();
  begin(b.dir);
  put(b.dir, 'CMakeLists.txt', nl(31, 'c'));
  overBash(b.dir, /31 changed production lines in 1 files/);
});

// #81, settled by the owner's decision (specs/003-fast-track-patch/spec.md, Assumptions; plan.md
// decision 17 point 1): only the top-level docs/ makes a .txt documentation, so a docs folder deeper
// in the tree, where a build may read text as input, counts as production.
test('patch: a .txt in a docs folder below the top level counts as production (#81)', () => {
  for (const rel of ['src/docs/notes.txt', 'pkg/docs/help.txt']) {
    const { dir } = fresh();
    begin(dir);
    put(dir, rel, nl(31, 'd'));
    overBash(dir, /31 changed production lines in 1 files/);
  }
});

test('patch: a third production file is over budget (FR-005, FR-006)', () => {
  const { dir } = fresh();
  begin(dir);
  for (const f of ['a', 'b', 'c']) put(dir, `src/${f}.js`, nl(1, f));
  overBash(dir, /3 files/);
});

test('patch: tests and docs do not count, a docs folder is not a doc rule (FR-005, built-in and committed patterns)', () => {
  const { dir } = fresh({ '.specify/test-paths': '^checks/golden/\n' });
  begin(dir);
  put(dir, 'src/a.js', nl(5, 'a'));
  for (const f of ['test/a.test.js', 'src/test/java/BigTest.java', 'fixtures/data.json', 'README.md', 'docs/guide.mdx',
    'notes.rst', 'CHANGES.txt', 'guide.adoc', 'checks/golden/x.out']) put(dir, f, nl(22, 'd'));
  okBash(dir, '5 production lines plus 200 of tests and docs');
  const other = fresh();
  begin(other.dir);
  put(other.dir, 'docs/tool.mjs', nl(31, 't'));
  overBash(other.dir, /31 changed production lines in 1 files/);
});

test('patch: test patterns come from the start commit, not the working tree (FR-005, decision 14 point 3)', () => {
  const { dir } = fresh({ '.specify/test-paths': '# none\n' });
  begin(dir);
  fs.appendFileSync(path.join(dir, '.specify/test-paths'), '^src/\n');
  put(dir, 'src/big.js', nl(31, 'b'));
  overBash(dir, /31 changed production lines/);

  const other = fresh();
  put(other.dir, '.specify/test-paths', '^checks/golden/\n'); // never committed
  begin(other.dir);
  put(other.dir, 'checks/golden/x.out', nl(31, 'g'));
  overBash(other.dir, /31 changed production lines/);
});

test('patch: binary production files are not allowed (FR-005)', () => {
  const a = fresh(); begin(a.dir);
  put(a.dir, 'src/logo.png', bin());
  overBash(a.dir, /binary production files are not allowed: src\/logo\.png/);

  const b = fresh({ 'src/logo.png': bin() }); begin(b.dir);
  put(b.dir, 'src/logo.png', Buffer.concat([bin(), Buffer.from([9])]));
  overBash(b.dir, /binary/);

  const c = fresh({ 'src/logo.png': bin() }); begin(c.dir);
  fs.unlinkSync(path.join(c.dir, 'src/logo.png'));
  okBash(c.dir, 'a deleted binary is 1 file and not a binary violation');
  put(c.dir, 'src/a.js', nl(1, 'a')); put(c.dir, 'src/b.js', nl(1, 'b'));
  const reason = overBash(c.dir, /3 files/);
  assert.doesNotMatch(reason, /binary/);

  const d = fresh(); begin(d.dir);
  put(d.dir, 'test/fixtures/x.bin', bin());
  okBash(d.dir, 'a binary test fixture');
  put(d.dir, 'src/a.js', nl(31, 'a'));
  overBash(d.dir, /31 changed production lines in 1 files/);
});

test('patch: renames count by the edited lines, one file (FR-005, decision 3, research R3)', () => {
  const a = forty(); begin(a.dir);
  a.g('mv', 'src/forty.js', 'src/moved.js');
  put(a.dir, 'src/b.js', nl(29, 'b')); put(a.dir, 'src/c.js', nl(1, 'c'));
  overBash(a.dir, /30 changed production lines in 3 files/);

  const b = forty(); begin(b.dir);
  b.g('mv', 'src/forty.js', 'src/moved.js');
  put(b.dir, 'src/b.js', nl(30, 'b'));
  okBash(b.dir, 'pure rename plus 30 lines is 30 lines in 2 files');
  put(b.dir, 'src/c.js', nl(1, 'c'));
  overBash(b.dir, /31 changed production lines in 3 files/);

  const c = forty(); begin(c.dir);
  c.g('mv', 'src/forty.js', 'src/moved.js');
  edit(c.dir, 'src/moved.js', 0, 5); put(c.dir, 'src/b.js', nl(25, 'b'));
  okBash(c.dir, 'rename with 5 edited lines');
  edit(c.dir, 'src/moved.js', 5, 6);
  overBash(c.dir, /31 changed production lines in 2 files/);
});

test('patch: a pure rename of a committed binary is not binary (research R3)', () => {
  const { dir, g } = fresh({ 'src/logo.png': bin() }); begin(dir);
  g('mv', 'src/logo.png', 'src/pic.png');
  okBash(dir, 'pure binary rename');
  put(dir, 'src/a.js', nl(31, 'a'));
  const reason = overBash(dir, /31 changed production lines/);
  assert.doesNotMatch(reason, /binary/);
});

test('patch: a rename across classes counts the production side (owner rule 2026-10-09, research R3)', () => {
  const { dir, g } = fresh({ 'test/old.test.js': nl(40, 'o') }); begin(dir);
  g('mv', 'test/old.test.js', 'src/old.js');
  overBash(dir, /40 changed production lines in 1 files/);
});

test('patch: a move git does not pair is a deletion plus a new file (decision 3)', () => {
  const { dir } = fresh({ 'src/small.js': nl(3, 's') }); begin(dir);
  fs.renameSync(path.join(dir, 'src/small.js'), path.join(dir, 'src/tiny.js'));
  put(dir, 'src/c.js', nl(1, 'c'));
  overBash(dir, /7 changed production lines in 3 files/);
});

test('patch: deleting a committed production file counts its lines and 1 file (FR-005)', () => {
  const { dir } = fresh({ 'src/s.js': nl(3, 's') }); begin(dir);
  fs.unlinkSync(path.join(dir, 'src/s.js'));
  okBash(dir, 'a deletion alone');
  put(dir, 'src/a.js', nl(1, 'a')); put(dir, 'src/b.js', nl(1, 'b'));
  overBash(dir, /3 files/);
});

test('patch: committed work counts, measured from the start commit (FR-005)', () => {
  const r = fresh(); begin(r.dir);
  put(r.dir, 'src/c.js', nl(31, 'c'));
  commitAll(r, 'sneaky');
  overBash(r.dir, /31 changed production lines in 1 files/);
});

test('patch: files dirty at the start are left out of the count (FR-005, Edge, decision 13)', () => {
  const { dir } = dirtyRepo(); begin(dir);
  put(dir, 'src/b.js', nl(30, 'b'));
  okBash(dir, '30 lines in 1 file, dirty files not counted');
  put(dir, 'src/wip.js', nl(100, 'w')); // byte-identical rewrite: content decides, not time
  okBash(dir, 'identical rewrite');
  fs.appendFileSync(path.join(dir, 'src/b.js'), `one more ${MARK}\n`);
  overBash(dir, /31 changed production lines in 1 files/);
});

test('patch: a Write, Edit or MultiEdit to a file dirty at the start is denied (research R14, contract step 3)', () => {
  const { dir } = dirtyRepo(); begin(dir);
  const cases = [
    ['Write', { file_path: path.join(dir, 'src/wip.js') }, /src\/wip\.js/],
    ['Edit', { file_path: path.join(dir, 'src/old.js') }, /src\/old\.js/],
    ['MultiEdit', { file_path: path.resolve(dir, 'src/old.js') }, /src\/old\.js/],
    ['Write', { file_path: `${dir}/src/./wip.js` }, /src\/wip\.js/],
  ];
  for (const [tool, input, re] of cases) {
    const out = patchTool(dir, tool, input);
    assert.ok(denied(out), `${tool} ${input.file_path}`);
    assert.match(why(out), re); assert.match(why(out), /uncommitted/); assert.match(why(out), /\/speckit-team/);
  }
  assert.ok(!denied(patchTool(dir, 'Write', { file_path: path.join(dir, 'src/new.js') })), 'a clean file is fine');

  const first = dirtyRepo();
  const out = patchTool(first.dir, 'Write', { file_path: path.join(first.dir, 'src/wip.js') });
  assert.ok(denied(out), 'denied as the first call too');
  assert.ok(fs.existsSync(startFile(first.dir)), 'the start record is written first');
});

test('patch: a dirty-at-start file changed through Bash is named and denied (research R14)', () => {
  const a = dirtyRepo(); begin(a.dir);
  fs.appendFileSync(path.join(a.dir, 'src/wip.js'), `more ${MARK}\n`);
  overBash(a.dir, /src\/wip\.js/, /uncommitted/, /\/speckit-team/);

  const b = dirtyRepo(); begin(b.dir);
  fs.appendFileSync(path.join(b.dir, 'src/old.js'), `more ${MARK}\n`);
  overBash(b.dir, /src\/old\.js/, /uncommitted/);

  const c = dirtyRepo(); begin(c.dir);
  fs.unlinkSync(path.join(c.dir, 'src/wip.js'));
  overBash(c.dir, /src\/wip\.js/, /uncommitted/);

  const d = fresh();
  fs.appendFileSync(path.join(d.dir, '.specify/memory/constitution.md'), `one ${MARK}\n`);
  begin(d.dir);
  fs.appendFileSync(path.join(d.dir, '.specify/memory/constitution.md'), `two ${MARK}\n`);
  const reason = overBash(d.dir, /\.specify\/memory\/constitution\.md/, /uncommitted/);
  assert.doesNotMatch(reason, /protected files/);
});

test('patch: committing a file dirty at the start is caught (research R14)', () => {
  const a = dirtyRepo(); begin(a.dir);
  a.g('add', 'src/wip.js'); a.g('commit', '-qm', 'x');
  overBash(a.dir, /src\/wip\.js/);
  const b = dirtyRepo(); begin(b.dir);
  b.g('commit', '-qam', 'x');
  overBash(b.dir, /src\/old\.js/);
});

test('patch: SubagentHandback is never denied for the budget; a commit command is denied (FR-006, US2-3)', () => {
  const r = fresh(); begin(r.dir);
  put(r.dir, 'src/a.js', nl(31, 'a'));
  overBash(r.dir, /31 changed production lines/);
  assert.ok(!denied(patchTool(r.dir, 'SubagentHandback', {})), 'handback passes');
  const git = (...a) => execFileSync('git', a, { cwd: r.dir, encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  assert.ok(denied(bash(r.dir, 'git add -A && git commit -qm x')));
  assert.equal(git('rev-parse', 'HEAD'), head, 'HEAD is the start commit');
  assert.match(git('status', '--porcelain'), /src\/a\.js/);
});

test('patch: needs no active feature (FR-002)', () => {
  const { dir } = fresh();
  fs.unlinkSync(path.join(dir, '.specify/feature.json'));
  begin(dir);
  put(dir, 'src/a.js', nl(31, 'a'));
  overBash(dir, /31 changed production lines/);
});

test('patch fails closed when the budget cannot be measured (research R9)', () => {
  const setRecord = (dir, f) => { const rec = JSON.parse(fs.readFileSync(startFile(dir), 'utf8')); f(rec); fs.writeFileSync(startFile(dir), JSON.stringify(rec)); };

  const a = fresh(); begin(a.dir);
  fs.writeFileSync(startFile(a.dir), '{not json');
  overBash(a.dir, RECORD);

  const b = fresh(); begin(b.dir);
  setRecord(b.dir, (rec) => { rec.sha = 'a'.repeat(40); });
  overBash(b.dir, RECORD);

  const c = fresh({ '.specify/test-paths': '[unclosed\n' });
  const out = patchTool(c.dir, 'Bash', { command: 'ls' });
  assert.ok(denied(out), 'an invalid committed test-paths line');
  assert.match(why(out), /\[unclosed/); assert.match(why(out), /line 1/);

  const d = fresh();
  put(d.dir, '.specify/test-paths', '[unclosed\n'); // working tree only
  begin(d.dir);
  put(d.dir, 'src/a.js', nl(1, 'a'));
  okBash(d.dir, 'a bad line that was never committed');

  const e = repo();
  fs.rmSync(path.join(e.dir, '.git'), { recursive: true, force: true });
  execFileSync('git', ['init', '-q'], { cwd: e.dir, stdio: 'ignore' });
  const none = patchTool(e.dir, 'Bash', { command: 'ls' });
  assert.ok(denied(none)); assert.match(why(none), /no commit/);

  for (const dirty of [['src/wip.js'], { 'src/wip.js': 'x' }]) {
    const f = fresh(); begin(f.dir);
    setRecord(f.dir, (rec) => { rec.dirty = dirty; });
    overBash(f.dir, RECORD);
  }
});

test('patch: input it cannot key a start record by gets no decision and a message (research R9)', () => {
  const { dir } = fresh();
  for (const extra of [{ agent_id: undefined }, { agent_id: '../x' }]) {
    const out = bash(dir, 'ls', extra);
    assert.ok(!decided(out), JSON.stringify(extra));
    assert.match(out?.systemMessage ?? '', /speckit-team: patch got unusable input/);
  }
  const s = fresh();
  const key = { agent_id: undefined, session_id: 's1' };
  begin(s.dir, key, 's1');
  put(s.dir, 'src/a.js', nl(31, 'a'));
  assert.ok(denied(bash(s.dir, 'npm test', key)), 'a session_id keys the record');
});

test('patch reads committed test patterns while scope tests keeps the working tree (FR-009)', () => {
  const { dir } = fresh();
  put(dir, '.specify/test-paths', '^checks/golden/\n'); // uncommitted
  assert.equal(write(dir, ['scope', 'tests'], 'checks/golden/x.out'), null);
  begin(dir);
  put(dir, 'checks/golden/x.out', nl(31, 'g'));
  overBash(dir, /31 changed production lines/);
  assert.equal(write(dir, ['scope', 'tests'], 'checks/golden/x.out'), null, 'scope tests unchanged');
});

// ---- patch, PreToolUse: the command deny and the wholesale-restore deny (feature 003, T005) -----
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function cmdRepo(extra = {}) {
  const r = fresh({ 'test/t.js': nl(2, 't'), ...extra });
  put(r.dir, 'src/wip.js', nl(5, 'w')); // dirty at start
  begin(r.dir);
  put(r.dir, 'src/a.js', nl(1, 'a')); // within budget
  r.sha = JSON.parse(fs.readFileSync(startFile(r.dir), 'utf8')).sha;
  return r;
}

// FR-006 "no commit, no pull request", FR-007, US2-3, audit finding H1, plan.md decision 14, research R15.
test('patch: commit, push, history and pull-request commands are denied within budget (FR-006, FR-007, US2-3)', () => {
  const { dir } = cmdRepo();
  const cases = [
    ['git commit -qm x', 'git commit'], ['git add -A && git commit -qm x', 'git commit'],
    ['echo x >> .github/workflows/ci.yml && git commit -qam x && git push', 'git commit'],
    ['git push origin HEAD', 'git push'], ['git -C . commit -m x'], ['git -c user.name=x commit -m x'],
    ['git --git-dir=.git push'], ['GIT_DIR=.git git push'], ['/usr/bin/git push'],
    ['"C:\\Program Files\\Git\\cmd\\git.exe" push'], ['sh -c "git push"'], ["bash -c 'git commit -m x'"],
    ["git -c alias.x='!git push' x", 'git push'], ['git stash'], ['git switch -c other'], ['git checkout -b other'],
    ['git checkout main'], ['git branch -D x'], ['git tag v1'], ['git merge x'], ['git rebase main'],
    ['git cherry-pick abc'], ['git revert HEAD'], ['git am x.patch'], ['git update-ref refs/heads/x HEAD'],
    ['git fetch'], ['git pull'], ['git remote add o x'], ['git reset --soft HEAD~1 && git push', 'git push'],
    ['gh pr create --fill', 'gh'], ['gh api repos/x/y', 'gh'], ['gh.exe pr create', 'gh'], ['hub pull-request', 'hub'],
  ];
  for (const [command, name] of cases) {
    const out = bash(dir, command);
    assert.ok(denied(out), `${command}: expected a deny, got ${JSON.stringify(out)}`);
    assert.match(why(out), name ? new RegExp(`may not run ${esc(name)}\\b`) : /may not run /, command);
    assert.match(why(out), /\/speckit-patch/, command);
  }
});

// #72: forms the word match missed (other forge CLIs, split or variable git words, aliases, package
// publishing, a shell write to the fast track's own state), and the read-only git branch live check L5
// saw denied.
test('patch: other forges, obfuscated git words, aliases, publishing and its own state are denied (#72)', () => {
  const { dir } = cmdRepo();
  const cases = [
    ['glab mr create --fill', 'glab'], ['tea pr create', 'tea'], ['/usr/local/bin/glab api x', 'glab'],
    ['g"it" push', 'git push'], ["g'it' commit -m x", 'git commit'], ['g\\it push', 'git push'],
    ['G=git; $G push', 'git push'], ['G=git && ${G} commit -m x', 'git commit'], ['git${IFS}push', 'git push'],
    ['git -c alias.p=push p', 'git -c alias'], ['git -c alias.s=status s', 'git -c alias'],
    // From the push-time security review: an empty substitution between git and its subcommand still
    // runs git push (``git `` push`` was denied before #72), and a variable is read where it is used.
    ['git `` push', 'git push'], ['git $(true) push', 'git push'], ['git `true` commit -m x', 'git commit'],
    ['G=git; $G push; G=x', 'git push'], ['git \\\npush', 'git push'],
    // The second review: read the command as a shell does, not by guessing at words.
    ['git -c core.x="a b" push', 'git push'], ["git -c 'user.name=a;b' commit -m x", 'git commit'],
    ['for i in 1 2; do $G push; G=git; done', 'git push'], ['G=x; for i in 1 2; do $G push; G=git; done', 'git push'],
    ['git 2>/dev/null push', 'git push'], ['git >out.txt commit -m x', 'git commit'], ['git 2>&1 push', 'git push'],
    ["$'\\x67it' push", 'git push'], ["$'\\147it' push", 'git push'], ['{git,} push', 'git push'],
    ['/usr/bin/g?t push', 'git push'], ['/usr/bin/gi[t] push', 'git push'], ['X="git push"; $X', 'git push'],
    ['IFS=,; X=git,push; $X', 'git push'], ['export G=git; $G push', 'git push'], ['env -i git push', 'git push'],
    // The third review: what the reading cannot resolve is denied where a denied word would be, not skipped.
    ["G=git; sh -c '$G push'", 'git push'], ["bash -c 'g\"it\" commit -m x'", 'git commit'], ["eval 'git' 'push'", 'git push'],
    ['f() { git "$@"; }; f push', 'git with a subcommand known only at run time'],
    ['git $(echo push)', 'git push'], ['git "$SUB" -m x', 'git with a subcommand known only at run time'],
    ['$(echo git) push', 'git push'], ['"$TOOL" commit -m x', 'a program known only at run time'],
    ['${G-git} push', 'git push'], ['G=git; H=G; ${!H} push', 'git push'], ['a=(git push); "${a[@]}"', 'git push'],
    ['G=GIT; ${G,,} push', 'git push'], ['G=gitx; ${G%x} push', 'a program known only at run time'], ["bash <<< 'git push'", 'git push'],
    ['G=git; bash <<< "$G push"', 'git push'], ['git --attr-source x push', 'git push'],
    [`${Array.from({ length: 30 }, (_, k) => `V=v${k}`).join('; ')}; V=git; $V push`, 'git push'],
    [`${'$('.repeat(12)}git push${')'.repeat(12)}`, 'git push'],
    ['npm publish', 'npm publish'], ['pnpm publish --access public', 'pnpm publish'], ['yarn npm publish', 'yarn publish'],
    ['echo {} > .git/speckit-team/patch/p1.json', "a command on the fast track's state"],
    ["rm -rf '.git/speckit-team'", "a command on the fast track's state"],
    ['del .git\\speckit-team\\patch-accepted.json', "a command on the fast track's state"],
  ];
  for (const [command, name] of cases) {
    const out = bash(dir, command);
    assert.ok(denied(out), `${command}: expected a deny, got ${JSON.stringify(out)}`);
    assert.match(why(out), new RegExp(`may not run ${esc(name)}`), command);
  }
  for (const command of ['git branch --show-current', 'git branch', 'git branch -a', 'git branch --list', 'git branch -vv && npm test',
    'echo "it" "push"', 'X=1 npm test', 'npm run build', 'grep -rn publish src', 'cat package.json',
    'git log $(git rev-parse HEAD) --oneline', 'git diff `git merge-base HEAD main`',
    // Input the shell reading cannot make sense of gets no deny and, above all, no crash.
    '/usr/bin/g[ push', "echo 'unterminated", 'echo $(( 1 + 2 )) ${', 'echo {{,}']) {
    const out = bash(dir, command);
    assert.equal(out, null, `${command}: expected null, got ${JSON.stringify(out)}`);
  }
  for (const command of ['git branch x', 'git branch -D x', 'git branch -m y', 'git branch --show-current && git branch x']) {
    assert.match(why(bash(dir, command)), /may not run git branch/, command);
  }
});

// FR-011, FR-014, constitution II, spec audit finding M5, plan.md decision 16 point 3, research R7.
test('patch: wholesale restores are denied, naming restores and read-only commands pass (FR-011, FR-014, M5)', () => {
  const { dir, sha } = cmdRepo();
  const wip = fs.readFileSync(path.join(dir, 'src/wip.js'));
  const cases = [
    ['git reset --hard', 'git reset --hard'], [`git reset --hard ${sha}`], ['git reset -q --hard'],
    ['git clean -fd', 'git clean'], ['git clean -n'], ['git -C . clean -fdx'],
    ['git checkout -- .', 'git checkout -- .'], [`git checkout ${sha} -- .`],
    ['git restore .', 'git restore .'], ['git restore -- .'], ['git restore --staged --worktree .'],
    ['git restore ..'], ['git restore src'], ['git restore src/'], ['git checkout -- src'],
    ["git restore 'src/*.js'"], ["git checkout -- 'src/?.js'"], ["git restore ':/'"],
    ['git restore --pathspec-from-file=list.txt'], ['git checkout -- src/wip.js'], ['git restore src/wip.js'],
    [`git checkout ${sha} -- src/a.js src/wip.js`], ['npm test && git restore .'], ['sh -c "git checkout -- ."'],
  ];
  for (const [command, name] of cases) {
    const out = bash(dir, command);
    assert.ok(denied(out), `${command}: expected a deny, got ${JSON.stringify(out)}`);
    assert.match(why(out), name ? new RegExp(`may not run ${esc(name)}`) : /may not run /, command);
    assert.match(why(out), /uncommitted/, command);
    assert.match(why(out), /ESCALATE/, command);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'src/wip.js')), wip, `${command}: the hook ran nothing`);
  }
  for (const command of ['git stash', 'git stash push -- src/a.js']) {
    const out = bash(dir, command);
    assert.ok(denied(out), command);
    assert.match(why(out), /may not run git stash/, command);
  }
  const allowed = [
    'git status --short', 'git diff', 'git log --oneline -3', 'git show HEAD', 'git mv src/a.js src/b.js',
    'git add src/a.js', `git checkout ${sha} -- src/a.js`, 'git checkout -- src/a.js', 'git restore src/a.js',
    `git restore --source=${sha} src/a.js`, `git restore -s ${sha} src/a.js`, `git reset --soft ${sha}`,
    'git reset -- src/a.js', 'git checkout -- src/a.js && npm test', 'npm test', 'node --test',
    'grep -rn commit src', 'echo committed', 'ls highlights', 'cat github.txt', 'echo reset --hard',
  ];
  for (const command of allowed) {
    const out = bash(dir, command);
    assert.equal(out, null, `${command}: expected null, got ${JSON.stringify(out)}`);
  }
});

test('patch: a non-string command gets no command deny and does not crash (constitution II)', () => {
  const { dir } = cmdRepo();
  for (const tool_input of [{ command: ['git', 'push'] }, { command: 42 }, {}]) {
    const out = patchTool(dir, 'Bash', tool_input);
    assert.ok(!denied(out), `${JSON.stringify(tool_input)}: ${why(out)}`);
  }
  // Guard: the deny exists at all, so the lines above are not green because the step is absent.
  assert.match(why(bash(dir, 'git push')), /may not run git push/);
});

// #72, the structural option. With bypassPermissions no prompt shows patcher's commands, so the deny
// reader above is the only line before a push. There every command the hook lets through runs with
// git's network transports switched off, which also stops a push from a script, a package script or an
// alias. Other modes keep the command as typed: Claude Code checks each part of the rewritten command
// against the allow rules, and with 2.1.296 the export line needed approval under a `Bash(echo:*)` rule.
const NO_NETWORK = ['protocol.allow=never', 'protocol.file.allow=user', 'protocol.git.allow=never', 'protocol.ssh.allow=never',
  'protocol.http.allow=never', 'protocol.https.allow=never', 'protocol.ext.allow=never'];
const BYPASS = { permission_mode: 'bypassPermissions' };
// The variables an `export K=V ...` line sets, so git can run under them without a shell.
const exported = (line) => Object.fromEntries(line.replace(/^export /, '').split(' ').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
const pairs = (env, from = 0) => Array.from({ length: Number(env.GIT_CONFIG_COUNT) - from }, (_, k) => `${env[`GIT_CONFIG_KEY_${from + k}`]}=${env[`GIT_CONFIG_VALUE_${from + k}`]}`);

test('patch: in bypassPermissions a command it lets through runs with git network transports off; with no allow rule for the line, other modes keep it as typed (#72)', () => {
  const { dir } = cmdRepo();
  const ti = { command: 'npm test', description: 'Run the tests', timeout: 120000 };
  const out = patchTool(dir, 'Bash', ti, BYPASS);
  const hso = out?.hookSpecificOutput;
  assert.equal(hso?.hookEventName, 'PreToolUse', JSON.stringify(out));
  assert.equal(hso.permissionDecision, undefined, 'no decision: the permission flow runs on the new command as usual');
  const [line, ...rest] = hso.updatedInput.command.split('\n');
  assert.equal(rest.join('\n'), 'npm test', 'the command follows one export line, unchanged');
  assert.deepEqual({ ...hso.updatedInput, command: null }, { ...ti, command: null }, 'every other field kept');
  const env = exported(line);
  // After any pairs the test's own environment passes (none, normally).
  assert.deepEqual(pairs(env, Number(process.env.GIT_CONFIG_COUNT) || 0), NO_NETWORK);
  // What git does under it: a network transport is refused before any connection, a local one is not.
  const ls = (url) => spawnSync('git', ['ls-remote', url], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.match(ls('https://127.0.0.1:9/none.git').stderr, /transport 'https' not allowed/);
  assert.match(ls('ssh://127.0.0.1:9/none.git').stderr, /transport 'ssh' not allowed/);
  assert.equal(ls(dir).status, 0, 'a repository on disk is still reachable');
  for (const mode of [undefined, 'default', 'acceptEdits', 'auto', 'dontAsk', 'plan']) {
    assert.equal(patchTool(dir, 'Bash', ti, mode ? { permission_mode: mode } : {}), null, `${mode}: kept as typed`);
  }
  // A deny comes first, and only Bash is rewritten.
  assert.match(why(patchTool(dir, 'Bash', { command: 'git push' }, BYPASS)), /may not run git push/);
  assert.equal(patchTool(dir, 'Read', { file_path: path.join(dir, 'src/a.js') }, BYPASS), null);
  assert.equal(patchTool(dir, 'Bash', { command: 42 }, BYPASS), null, 'a non-string command is left alone');
});

// #122: install.mjs allows the exact export line, so the rewritten command asks for nothing the command
// itself would not, in every mode (checked against a fake API with 2.1.296, auto mode's classifier
// included). Where the installed settings.json holds that rule, every mode gets the switch-off; where it
// does not, or the environment's own pairs make the line differ from it, only bypassPermissions does.
function installedHook() {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'skpatch-cfg-'));
  const r = spawnSync(process.execPath, [path.join(path.dirname(HOOK), '..', 'install.mjs'), '--claude-dir', cfg], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return { cfg, hook: path.join(cfg, 'hooks', 'speckit-team.mjs') };
}
const viaHook = (dir, hook, tool_input, extra = {}, env = process.env) => {
  const r = spawnSync('node', [hook, 'patch'], {
    input: JSON.stringify({ cwd: dir, hook_event_name: 'PreToolUse', agent_id: 'p1', agent_type: 'patcher', tool_name: 'Bash', tool_input, ...extra }),
    encoding: 'utf8', env,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
};

test('patch: with the installer\'s allow rule for the export line, every permission mode gets the switch-off (#122)', () => {
  const { dir } = cmdRepo();
  const { cfg, hook } = installedHook();
  const rule = (JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8')).permissions?.allow ?? []).find((a) => a.startsWith('Bash(export '));
  assert.ok(rule, 'install.mjs wrote the rule');
  const ti = { command: 'npm test', description: 'Run the tests' };
  for (const mode of ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', undefined]) {
    const command = viaHook(dir, hook, ti, mode ? { permission_mode: mode } : {})?.hookSpecificOutput?.updatedInput?.command ?? '';
    const [line, rest] = [command.slice(0, command.indexOf('\n')), command.slice(command.indexOf('\n') + 1)];
    assert.equal(`Bash(${line})`, rule, `${mode}: the line is the one the rule allows`);
    assert.equal(rest, 'npm test', mode);
  }
  // The environment's own pairs move the line off the rule: only bypassPermissions rewrites then.
  const shifted = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.quotepath', GIT_CONFIG_VALUE_0: 'false' };
  assert.equal(viaHook(dir, hook, ti, { permission_mode: 'default' }, shifted), null, 'a line the rule does not allow would ask');
  assert.ok(viaHook(dir, hook, ti, BYPASS, shifted)?.hookSpecificOutput?.updatedInput, 'bypassPermissions still rewrites');
  // Without the rule, as for a settings.json the user edited, only bypassPermissions rewrites.
  const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  s.permissions.allow = s.permissions.allow.filter((a) => a !== rule);
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(s));
  assert.equal(viaHook(dir, hook, ti, { permission_mode: 'default' }), null, 'no rule: kept as typed');
  assert.ok(viaHook(dir, hook, ti, BYPASS)?.hookSpecificOutput?.updatedInput, 'no rule: bypassPermissions still rewrites');
  // An unreadable settings.json is no rule.
  fs.writeFileSync(path.join(cfg, 'settings.json'), '{ not json');
  assert.equal(viaHook(dir, hook, ti, { permission_mode: 'default' }), null, 'unreadable settings: kept as typed');
});

test('patch: the switch-off adds to the git config pairs the environment already passes (#72)', () => {
  const { dir } = cmdRepo();
  const r = spawnSync('node', [HOOK, 'patch'], {
    input: JSON.stringify({ cwd: dir, hook_event_name: 'PreToolUse', agent_id: 'p1', agent_type: 'patcher', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...BYPASS }),
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.quotepath', GIT_CONFIG_VALUE_0: 'false' },
  });
  assert.equal(r.status, 0, r.stderr);
  const env = exported(JSON.parse(r.stdout).hookSpecificOutput.updatedInput.command.split('\n')[0]);
  assert.equal(env.GIT_CONFIG_KEY_0, undefined, 'the existing pair is left as it is');
  assert.deepEqual(pairs(env, 1), NO_NETWORK);
});

test('patch: a Write mentioning git push is not a command; the deny holds with only a session_id (FR-006)', () => {
  const { dir } = cmdRepo();
  const out = patchTool(dir, 'Write', { file_path: path.join(dir, 'src/n.js'), content: 'git push\n' });
  assert.ok(!denied(out), why(out));
  const s = fresh();
  const key = { agent_id: undefined, session_id: 's1' };
  begin(s.dir, key, 's1');
  const d = bash(s.dir, 'git push', key);
  assert.ok(denied(d), JSON.stringify(d));
  assert.match(why(d), /may not run git push/);
});

// ---- patch, end of run: the end check, the accepted record, the restore allowance (feature 003, T007) ----
const CONST = '.specify/memory/constitution.md';
const CI = '.github/workflows/ci.yml';
const acceptedFile = (dir) => path.join(stateDir(dir), 'patch-accepted.json');
const record = (dir) => (fs.existsSync(acceptedFile(dir)) ? JSON.parse(fs.readFileSync(acceptedFile(dir), 'utf8')) : null);
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
const startSha = (dir) => JSON.parse(fs.readFileSync(startFile(dir), 'utf8')).sha;
const s12 = (dir) => startSha(dir).slice(0, 12);
const STOP = { hook_event_name: 'SubagentStop', agent_id: 'p1', agent_type: 'patcher' };
const HAND = { hook_event_name: 'PreToolUse', agent_id: 'p1', agent_type: 'patcher', tool_name: 'SubagentHandback', tool_input: { message: 'Fixed.\nDONE' } };
function endEv(dir, base, extra = {}) {
  const out = run(dir, ['patch'], { ...base, ...extra });
  assert.ok(!JSON.stringify(out ?? {}).includes(MARK), 'FR-014: output must not carry file content');
  if (fs.existsSync(acceptedFile(dir))) assert.ok(!fs.readFileSync(acceptedFile(dir), 'utf8').includes(MARK), 'FR-014: record carries no content');
  return out;
}
const stop = (dir, extra) => endEv(dir, STOP, extra);
const hand = (dir, extra) => endEv(dir, HAND, extra);
const noStop = (out, label = '') => { assert.ok(out?.decision !== 'block' && !denied(out), `${label} expected no block: ${JSON.stringify(out)}`); };
function isBlocked(out, ...res) {
  assert.equal(out?.decision, 'block', `expected a block, got ${JSON.stringify(out)}`);
  for (const re of res) assert.match(out.reason, re);
}
function isDenied(out, ...res) {
  assert.ok(denied(out), `expected a handback deny, got ${JSON.stringify(out)}`);
  for (const re of res) assert.match(why(out), re);
}
const co = (dir, rel) => new RegExp(`git checkout ${s12(dir)} -- ${esc(rel)}`);

test('patch end: protected file changed with fs blocks stop and denies handback, until restored (FR-007, US2-2, FR-014)', () => {
  const { dir } = fresh();
  begin(dir);
  fs.appendFileSync(path.join(dir, CONST), 'extra\n');
  const re = [new RegExp(esc(CONST)), co(dir, CONST)];
  isBlocked(stop(dir), ...re);
  isBlocked(stop(dir, { stop_hook_active: true }), ...re);
  isDenied(hand(dir), ...re);
  assert.equal(record(dir), null);
  git(dir, 'checkout', startSha(dir), '--', CONST);
  noStop(stop(dir), 'after restore');
});

// #72: the command deny reads a command's text, so a push it cannot read (a script the agent wrote, a
// string built at run time) went unseen until the skill's own push failed. The start record keeps the
// remote-tracking refs, and a change to them, which a push or a fetch makes however it was typed,
// stops the run at the next tool call and fails the end check.
test('patch: a remote-tracking ref that moves during the run stops it and fails the end check (#72)', () => {
  const { dir } = fresh();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'skremote-'));
  git(remote, 'init', '-q', '--bare');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  begin(dir);
  put(dir, 'src/fix.js', nl(2, 'f'));
  okBash(dir, 'nothing pushed, and a ref from before the run is no change');
  noStop(stop(dir), 'before the push');
  assert.ok(record(dir), 'accepted before the push');
  git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/patch/x');
  const out = bash(dir, 'npm test');
  isDenied(out, /remote-tracking refs changed during the run: refs\/remotes\/origin\/patch\/x \(new\)/, /A push or a fetch happened/, /ESCALATE/);
  const end = stop(dir);
  noStop(end, 'a push cannot be undone by the agent, so the end check does not block');
  assert.match(msg(end), /^fast track FAILED: remote-tracking refs changed during the run: refs\/remotes\/origin\/patch\/x \(new\)/);
  assert.equal(record(dir), null, 'no accepted record, so /speckit-patch commits nothing');
  assert.match(msg(hand(dir)), /^fast track FAILED: remote-tracking refs changed/);
  assert.equal(record(dir), null);
});

test('patch: a start record without the remote-tracking refs cannot be measured (#72, fail closed)', () => {
  const { dir } = fresh();
  begin(dir);
  const rec = JSON.parse(fs.readFileSync(startFile(dir), 'utf8'));
  assert.deepEqual(rec.remotes, {}, 'a repo with no remote starts with no refs');
  for (const remotes of [undefined, [], { 'refs/remotes/origin/main': 'not-a-sha' }]) {
    fs.writeFileSync(startFile(dir), JSON.stringify({ ...rec, remotes }));
    isDenied(bash(dir), /the budget cannot be measured/);
    assert.match(msg(stop(dir)), /fast-track check could not run/);
    assert.equal(record(dir), null);
  }
});

test('patch end: a new workflow says delete, a deleted workflow gives its checkout (FR-007, US2-2)', () => {
  const { dir } = fresh({ [CI]: 'on: push\n' });
  begin(dir);
  put(dir, '.github/workflows/new.yml', 'on: push\n');
  isBlocked(stop(dir), /new\.yml/, /delet/i);
  fs.rmSync(path.join(dir, CI));
  isBlocked(stop(dir), co(dir, CI));
  assert.equal(record(dir), null);
});

test('patch end: the hook changes nothing in the repo (FR-007, constitution II)', () => {
  const { dir } = fresh();
  begin(dir);
  fs.appendFileSync(path.join(dir, CONST), 'extra\n');
  const head = git(dir, 'rev-parse', 'HEAD'), status = git(dir, 'status', '--porcelain');
  isBlocked(stop(dir));
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(git(dir, 'status', '--porcelain'), status);
  assert.equal(head.trim(), startSha(dir));
  assert.match(fs.readFileSync(path.join(dir, CONST), 'utf8'), /extra\n$/);
});

test('patch end: a protected file dirty at the start is not named, blocked on or touched (US3-3)', () => {
  const { dir } = fresh();
  fs.appendFileSync(path.join(dir, CONST), 'mine\n');
  const before = fs.readFileSync(path.join(dir, CONST));
  begin(dir);
  const out = stop(dir);
  noStop(out);
  assert.ok(!JSON.stringify(out ?? {}).includes('constitution'), JSON.stringify(out));
  assert.match(msg(out), /of 30 production lines/, 'the end check ran and accepted');
  assert.ok(record(dir) && !record(dir).files.includes(CONST), 'accepted, without the dirty file');
  noStop(hand(dir));
  assert.deepEqual(fs.readFileSync(path.join(dir, CONST)), before);
});

test('patch end: a dirty-at-start file changed through a shell command is message A, never a restore (R14, Edge)', () => {
  const { dir } = fresh();
  put(dir, 'src/wip.js', nl(100, 'w'));
  begin(dir);
  fs.appendFileSync(path.join(dir, 'src/wip.js'), 'more\n');
  for (const out of [stop(dir), hand(dir)]) {
    noStop(out);
    assert.match(msg(out), /src\/wip\.js/);
    assert.match(msg(out), /uncommitted/);
    assert.match(msg(out), /\/speckit-team/);
    assert.ok(!/git checkout/.test(JSON.stringify(out)), 'no restore command for it');
  }
  assert.equal(record(dir), null);
  assert.match(fs.readFileSync(path.join(dir, 'src/wip.js'), 'utf8'), /more\n$/);
});

test('patch end: dirty work swept into a commit is blocked, then measured without it (H1, R14, FR-002)', () => {
  const { dir } = fresh();
  put(dir, 'src/wip.js', nl(100, 'w'));
  const wip = fs.readFileSync(path.join(dir, 'src/wip.js'));
  begin(dir);
  put(dir, 'src/a.js', nl(3, 'a'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'x');
  const re = new RegExp(`git reset --soft ${s12(dir)}`);
  isBlocked(stop(dir), re);
  isBlocked(stop(dir, { stop_hook_active: true }), re);
  isDenied(hand(dir), re);
  git(dir, 'reset', '--soft', startSha(dir));
  const out = stop(dir);
  noStop(out);
  assert.match(msg(out), /3 of 30 production lines, 1 of 2 production files/);
  assert.deepEqual(record(dir).files, ['src/a.js']);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'src/wip.js')), wip);
});

test('patch end: a commit within budget is blocked at any size, the working tree matching the start (H1, decision 14)', () => {
  const { dir } = fresh({ [CI]: 'on: push\n' });
  begin(dir);
  fs.appendFileSync(path.join(dir, CI), 'x: 1\n');
  git(dir, 'commit', '-qam', 'ci');
  git(dir, 'checkout', startSha(dir), '--', CI);
  const re = new RegExp(`git reset --soft ${s12(dir)}`);
  isBlocked(stop(dir), re);
  isBlocked(stop(dir, { stop_hook_active: true }), re);
  isDenied(hand(dir), re);
  assert.equal(record(dir), null);
  git(dir, 'reset', '--soft', startSha(dir));
  noStop(stop(dir));
  const rec = record(dir);
  assert.ok(rec, 'accepted once nothing is committed');
  assert.ok(!rec.files.includes(CI));
});

test('patch end: a plain 3-line commit is blocked (FR-006, US2-2)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'src/a.js', nl(3, 'a'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'x');
  isBlocked(stop(dir), new RegExp(`git reset --soft ${s12(dir)}`));
  assert.equal(record(dir), null);
});

test('patch end: test patterns edited during the run are protected (FR-007, decision 13)', () => {
  const { dir } = fresh({ '.specify/test-paths': '^checks/\n' });
  begin(dir);
  fs.appendFileSync(path.join(dir, '.specify/test-paths'), '^src/\n');
  put(dir, 'src/a.js', nl(3, 'a'));
  isBlocked(stop(dir), /\.specify\/test-paths/, co(dir, '.specify/test-paths'));
  assert.equal(record(dir), null);
});

test('patch end: over budget and uncommitted is message A, no block, no record (FR-006, US1-3)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'src/a.js', nl(31, 'a'));
  for (const out of [stop(dir), hand(dir)]) {
    noStop(out);
    for (const re of [/31 changed production lines/, /limit 30 lines, 2 files/, /uncommitted/, /\/speckit-team/]) assert.match(msg(out), re);
  }
  assert.equal(record(dir), null);
});

test('patch end: over budget and committed is blocked until reset, then message A (FR-006, H1)', () => {
  const { dir } = fresh();
  begin(dir);
  put(dir, 'src/a.js', nl(31, 'a'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'x');
  const re = new RegExp(`git reset --soft ${s12(dir)}`);
  isBlocked(stop(dir), re);
  isBlocked(stop(dir, { stop_hook_active: true }), re);
  isDenied(hand(dir), re);
  git(dir, 'reset', '--soft', startSha(dir));
  const out = stop(dir);
  noStop(out);
  assert.match(msg(out), /31 changed production lines/);
  assert.equal(record(dir), null);
});

const GOOD = {
  files: ['docs/a.md', 'src/a.js', 'src/main/App.java', 'src/main/Main.java', 'test/a.test.js'],
  untracked: ['docs/a.md', 'src/a.js', 'test/a.test.js'],
};
function acceptedRun() {
  const { dir } = fresh();
  put(dir, 'src/wip.js', nl(100, 'w'));
  begin(dir);
  put(dir, 'src/a.js', nl(3, 'a')); put(dir, 'test/a.test.js', nl(5, 't')); put(dir, 'docs/a.md', nl(5, 'd'));
  git(dir, 'mv', 'src/main/App.java', 'src/main/Main.java');
  return dir;
}

test('patch end: within budget writes the accepted record, on stop and on handback (FR-002, US1-1)', () => {
  const dir = acceptedRun();
  for (const ev of [stop, hand]) {
    const out = ev(dir);
    noStop(out);
    assert.match(msg(out), /3 of 30 production lines, 2 of 2 production files/);
    const { at, ...rest } = record(dir);
    assert.equal(typeof at, 'string');
    assert.deepEqual(rest, { key: 'p1', sha: startSha(dir), ...GOOD, lines: 3, filesTouched: 2 });
    fs.rmSync(acceptedFile(dir));
  }
});

test('patch end: every patch call removes the accepted record (research R15)', () => {
  const stale = (d) => { fs.mkdirSync(stateDir(d), { recursive: true }); fs.writeFileSync(acceptedFile(d), '{"stale":true}'); };
  const a = acceptedRun();
  stop(a);
  assert.ok(record(a), 'accepted');
  patchTool(a, 'Read', { file_path: path.join(a, 'src/a.js') });
  assert.equal(record(a), null, 'a later call removes it');

  const b = fresh().dir; begin(b);
  fs.appendFileSync(path.join(b, CONST), 'x\n'); stale(b);
  isBlocked(stop(b));
  assert.equal(record(b), null, 'blocked stop');

  const c = fresh().dir; begin(c);
  put(c, 'src/a.js', nl(31, 'a')); stale(c);
  noStop(stop(c));
  assert.equal(record(c), null, 'over budget');

  const d = fresh().dir; begin(d); stale(d);
  assert.equal(stop(d, { agent_id: 'other' }), null);
  assert.equal(record(d), null, 'no start record for the key');

  const e = fresh().dir; begin(e); stale(e);
  fs.writeFileSync(startFile(e), '{not json');
  const out = stop(e);
  noStop(out);
  assert.match(msg(out), /fast-track check could not run/);
  assert.equal(record(e), null, 'unusable start record');
});

test('patch end: no start record for the key exits with no output', () => {
  const { dir } = fresh();
  assert.equal(stop(dir), null);
  assert.equal(hand(dir), null);
});

// research R7 (narrowed 2026-10-10), plan.md decision 16 point 3, audit finding M5.
test('patch restore allowance: only naming a protected file still to be restored passes (R7, M5, FR-011)', () => {
  const { dir } = fresh();
  put(dir, 'src/wip.js', nl(5, 'w'));
  begin(dir);
  put(dir, 'src/a.js', nl(31, 'a'));
  fs.appendFileSync(path.join(dir, CONST), 'x\n');
  put(dir, '.github/workflows/new.yml', 'on: push\n');
  const sha = startSha(dir);
  const snap = () => ['src/wip.js', 'src/a.js', CONST].map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  const before = snap();
  const allowed = [
    `git checkout ${sha} -- ${CONST}`, `git restore ${CONST}`, `git restore --source=${sha} ${CONST}`,
    'rm .github/workflows/new.yml', 'rm -f -- .github/workflows/new.yml',
  ];
  for (const c of allowed) { const out = bash(dir, c); assert.ok(!denied(out), `${c} must be allowed: ${why(out)}`); }
  // #72: in bypassPermissions a restore it lets through runs with git's network transports off too.
  const restore = bash(dir, `git restore ${CONST}`, BYPASS)?.hookSpecificOutput?.updatedInput?.command ?? '';
  assert.match(restore, /^export GIT_CONFIG_COUNT=\d+ GIT_CONFIG_KEY_(\d+)=protocol\.allow GIT_CONFIG_VALUE_\1=never /, restore);
  assert.ok(restore.endsWith(`\ngit restore ${CONST}`), restore);
  const refused = [
    `git checkout ${sha} -- ${CONST} src/a.js`, 'git restore .specify', `git checkout ${sha} -- '.specify/*'`,
    `git checkout ${sha} -- src/wip.js`, 'rm src/wip.js', 'rm src/a.js', 'rm -rf .github', `rm ${CONST}`,
    `git reset --soft ${sha}`, `git reset --hard ${sha}`, 'git restore .',
    `git checkout ${sha} -- x && git commit -qm y`, 'rm a; rm b', 'git checkout $(echo x)',
  ];
  for (const c of refused) assert.ok(denied(bash(dir, c)), `${c} must be denied`);
  assert.ok(denied(patchTool(dir, 'Write', { file_path: path.join(dir, CONST), content: 'x' })), 'Write denied');
  assert.deepEqual(snap(), before);

  const c2 = fresh().dir; begin(c2);
  put(c2, 'src/a.js', nl(31, 'a'));
  git(c2, 'add', '-A'); git(c2, 'commit', '-qm', 'x');
  assert.ok(!denied(bash(c2, `git reset --soft ${startSha(c2)}`)), 'undoing a commit is allowed');

  const c3 = fresh().dir; begin(c3);
  put(c3, 'src/a.js', nl(31, 'a'));
  assert.ok(denied(bash(c3, `git checkout ${startSha(c3)} -- src/a.js`)), 'nothing to restore');
});

test('patch end: the speckit-agents sources are protected in that repo only (decision 4)', () => {
  const files = (name) => ({ 'package.json': `{"name":"${name}"}`, 'install.mjs': 'x\n' });
  const own = fresh(files('speckit-agents')).dir;
  begin(own);
  fs.appendFileSync(path.join(own, 'install.mjs'), 'y\n');
  isBlocked(stop(own), /install\.mjs/, co(own, 'install.mjs'));
  const app = fresh(files('my-app')).dir;
  begin(app);
  fs.appendFileSync(path.join(app, 'install.mjs'), 'y\n');
  const out = stop(app);
  noStop(out);
  assert.match(msg(out), /1 of 30 production lines, 1 of 2 production files/);
});

test('patch end: package.json is protected by the name at the start commit (owner 2026-10-09)', () => {
  const own = fresh({ 'package.json': '{"name":"speckit-agents"}', 'install.mjs': 'x\n' }).dir;
  begin(own);
  fs.writeFileSync(path.join(own, 'package.json'), '{"name":"x"}');
  fs.appendFileSync(path.join(own, 'install.mjs'), 'y\n');
  const re = [/package\.json/, /install\.mjs/, co(own, 'package.json'), co(own, 'install.mjs')];
  isBlocked(stop(own), ...re);
  git(own, 'commit', '-qam', 'x');
  isBlocked(stop(own), ...re);

  const app = fresh({ 'package.json': '{"name":"my-app"}\n' }).dir;
  begin(app);
  fs.appendFileSync(path.join(app, 'package.json'), '\n');
  const out = stop(app);
  noStop(out);
  assert.match(msg(out), /1 of 30 production lines, 1 of 2 production files/);
});

// ---- patch, end of run: the installed team is hashed at the start and checked at the end (feature 003, T009) ----
// The copied hook's team directory is <tmp>/cfg, so the cases change files there, never the checkout.
function teamCopy() {
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skteam-cfg-')), 'cfg');
  const files = { 'agents/patcher.md': '# patcher\n', 'agents/implementer.md': '# implementer\n', 'skills/speckit-patch/SKILL.md': '# skill\n', 'settings.json': '{}' };
  for (const [rel, text] of Object.entries(files)) put(cfg, rel, text);
  fs.mkdirSync(path.join(cfg, 'hooks'), { recursive: true });
  const hook = path.join(cfg, 'hooks', 'speckit-team.mjs');
  fs.copyFileSync(HOOK, hook);
  return hook;
}
const cfgOf = (hook) => path.dirname(path.dirname(hook));
const tcall = (dir, hook, base, extra = {}) => {
  const out = run(dir, ['patch'], { ...base, ...extra }, hook);
  assert.ok(!JSON.stringify(out ?? {}).includes(MARK), 'FR-014: output must not carry file content');
  return out;
};
const tstop = (dir, hook, extra) => tcall(dir, hook, STOP, extra);
const thand = (dir, hook, message = 'Fixed.\nDONE') => tcall(dir, hook, HAND, { tool_input: { message } });
const tpre = (dir, hook, tool_name, tool_input) => tcall(dir, hook, { hook_event_name: 'PreToolUse', agent_id: 'p1', agent_type: 'patcher', tool_name, tool_input });
// A run through the copied hook: first call, then a new 1-line src/a.js (within budget).
function teamRun({ prepare } = {}) {
  const hook = teamCopy();
  if (prepare) prepare(cfgOf(hook));
  const { dir } = fresh();
  const out = tpre(dir, hook, 'Read', { file_path: path.join(dir, 'src/main/App.java') });
  assert.ok(!denied(out), `first call: ${why(out)}`);
  assert.ok(fs.existsSync(startFile(dir)), 'the first call writes the start record');
  put(dir, 'src/a.js', nl(1, 'a'));
  return { dir, hook, cfg: cfgOf(hook) };
}
const cfgFile = (cfg, rel) => path.join(cfg, ...rel.split('/'));
const rel2 = (rel) => new RegExp(esc(rel).replace(/\//g, '[\\\\/]'));
// Message C of contracts/hook-cli.md: FAILED, never a block, names each path, no checkout command.
function isFailed(out, ...paths) {
  noStop(out, 'a team change must not block');
  const m = msg(out);
  for (const re of [/installed agent team/, /FAILED/, /commits nothing/, ...paths.map(rel2)]) assert.match(m, re);
  assert.doesNotMatch(m, /git checkout/);
}

const TEAM_CHANGES = [
  ['agents/patcher.md', (cfg) => fs.appendFileSync(cfgFile(cfg, 'agents/patcher.md'), `${MARK}\n`)],
  ['skills/evil/SKILL.md', (cfg) => put(cfg, 'skills/evil/SKILL.md', `# evil ${MARK}\n`)],
  ['agents/implementer.md', (cfg) => fs.rmSync(cfgFile(cfg, 'agents/implementer.md'))],
  ['hooks/speckit-team.mjs', (cfg) => fs.appendFileSync(cfgFile(cfg, 'hooks/speckit-team.mjs'), '\n// changed during the run\n')],
  ['settings.json', (cfg) => fs.writeFileSync(cfgFile(cfg, 'settings.json'), '{"x":1}')],
  ['settings.local.json', (cfg) => fs.writeFileSync(cfgFile(cfg, 'settings.local.json'), '{}')],
];

test('patch team: any changed team file ends the run FAILED, never blocks, writes no record (FR-007, FR-011, FR-014, US3-2, SC-003, M2)', () => {
  for (const [rel, change] of TEAM_CHANGES) {
    const { dir, hook, cfg } = teamRun();
    change(cfg);
    isFailed(tstop(dir, hook), rel);
    assert.equal(record(dir), null, `${rel}: no record after stop`);
    isFailed(tstop(dir, hook, { stop_hook_active: true }), rel);
    assert.equal(record(dir), null, `${rel}: no record after stop_hook_active`);
    isFailed(thand(dir, hook), rel);
    assert.equal(record(dir), null, `${rel}: no record after DONE`);
    isFailed(thand(dir, hook, 'Over budget.\nESCALATE'), rel);
    assert.equal(record(dir), null, `${rel}: no record after ESCALATE`);
  }
});

test('patch team: putting the original back lets the run be accepted (FR-007, FR-011)', () => {
  for (const rel of ['agents/patcher.md', 'settings.json']) {
    const { dir, hook, cfg } = teamRun();
    const f = cfgFile(cfg, rel);
    const original = fs.readFileSync(f);
    TEAM_CHANGES.find(([r]) => r === rel)[1](cfg);
    isFailed(tstop(dir, hook), rel);
    fs.writeFileSync(f, original);
    noStop(tstop(dir, hook), rel);
    assert.ok(record(dir), `${rel}: the record is written once the original is back`);
  }
  const { dir, hook, cfg } = teamRun();
  put(cfg, 'settings.local.json', '{}');
  isFailed(tstop(dir, hook), 'settings.local.json');
  fs.rmSync(cfgFile(cfg, 'settings.local.json'));
  noStop(tstop(dir, hook));
  assert.ok(record(dir), 'a created file removed again is accepted');
});

test('patch team: two changed team files are both named in message C (FR-011, M2)', () => {
  const { dir, hook, cfg } = teamRun();
  TEAM_CHANGES[4][1](cfg); TEAM_CHANGES[0][1](cfg);
  isFailed(tstop(dir, hook), 'settings.json', 'agents/patcher.md');
  assert.equal(record(dir), null);
});

test('patch team: a protected repo file still blocks, and is the only file the block names (FR-007, M2)', () => {
  const { dir, hook, cfg } = teamRun();
  TEAM_CHANGES[0][1](cfg);
  fs.appendFileSync(path.join(dir, CONST), 'extra\n');
  const out = tstop(dir, hook);
  isBlocked(out, new RegExp(esc(CONST)), co(dir, CONST));
  assert.doesNotMatch(out.reason, /agents[\\/]patcher\.md/);
  assert.equal(record(dir), null);
  git(dir, 'checkout', startSha(dir), '--', CONST);
  isFailed(tstop(dir, hook), 'agents/patcher.md');
  assert.equal(record(dir), null);
});

test('patch team: only agents/, hooks/, skills/<name>/ and the two settings files are hashed (research R16)', () => {
  const { dir, hook, cfg } = teamRun({ prepare: (c) => { put(c, 'projects/x.jsonl', '{}'); put(c, 'skills/x/sub/deep.md', 'deep'); } });
  const { team } = JSON.parse(fs.readFileSync(startFile(dir), 'utf8'));
  assert.match(String(team?.['agents/patcher.md']), /^[0-9a-f]{64}$/, 'a team file is hashed');
  assert.deepEqual(Object.keys(team ?? {}).filter((k) => /^projects[\/]|sub[\/]/.test(k)), []);
  put(cfg, 'projects/x.jsonl', '{"changed":1}'); put(cfg, 'skills/x/sub/deep.md', 'changed');
  noStop(tstop(dir, hook));
  assert.ok(record(dir), 'a change outside the hashed set is accepted');
});

test('patch team: the start record holds a hash per team file, null for a missing settings file (FR-007, research R16)', () => {
  const { dir } = teamRun();
  const { team } = JSON.parse(fs.readFileSync(startFile(dir), 'utf8'));
  assert.ok(team && typeof team === 'object' && !Array.isArray(team), 'team is an object');
  for (const rel of ['agents/patcher.md', 'agents/implementer.md', 'skills/speckit-patch/SKILL.md', 'hooks/speckit-team.mjs', 'settings.json']) assert.match(String(team[rel]), /^[0-9a-f]{64}$/, rel);
  assert.equal(team['settings.local.json'], null);
});

test('patch team: over budget with a team change opens no restore allowance, and message C comes first (research R7, M2)', () => {
  const { dir, hook, cfg } = teamRun();
  put(dir, 'src/a.js', nl(31, 'a'));
  TEAM_CHANGES[0][1](cfg);
  const out = tpre(dir, hook, 'Bash', { command: `git checkout ${startSha(dir)} -- src/a.js` });
  assert.ok(denied(out), 'denied: ' + JSON.stringify(out));
  isFailed(tstop(dir, hook), 'agents/patcher.md');
  assert.equal(record(dir), null);
});

test('patch team: a config dir with no skills/ and no settings.json is hashed and accepted (FR-011)', () => {
  const { dir, hook } = teamRun({ prepare: (cfg) => { fs.rmSync(path.join(cfg, 'skills'), { recursive: true }); fs.rmSync(path.join(cfg, 'settings.json')); } });
  const { team } = JSON.parse(fs.readFileSync(startFile(dir), 'utf8'));
  assert.ok(team && typeof team === 'object', 'the start record has team');
  assert.equal(team['settings.json'], null);
  noStop(tstop(dir, hook));
  assert.ok(record(dir), 'accepted');
});

test('patch team: an unusable team in the start record is denied and the end check cannot run (FR-011, data-model)', () => {
  for (const team of [[], { 'agents/x.md': 'zz' }]) {
    const { dir, hook } = teamRun();
    const f = startFile(dir);
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), team }));
    const out = tpre(dir, hook, 'Bash', { command: 'npm test' });
    assert.ok(denied(out), `${JSON.stringify(team)}: expected a deny, got ${JSON.stringify(out)}`);
    assert.match(why(out), RECORD);
    const end = tstop(dir, hook);
    assert.match(msg(end), /fast-track check could not run/);
    assert.equal(record(dir), null);
  }
});

test('patch: a run with a project record active measures the same budget and protected paths as one without (007 US3-2)', () => {
  const r = forty();
  const projDir = path.join(stateDir(r.dir), 'project');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 's1.json'), JSON.stringify({ session_id: 's1', name: 'billing', at: new Date().toISOString() }));
  begin(r.dir, { session_id: 's1' });
  edit(r.dir, 'src/forty.js', 0, 30);
  okBash(r.dir, '30 lines allowed with project record');
  edit(r.dir, 'src/forty.js', 30, 31);
  overBash(r.dir, /31 changed production lines/);
  assert.ok(denied(patchTool(r.dir, 'Write', { file_path: path.join(r.dir, '.specify', 'projects', 'billing', 'notes.md') }, { session_id: 's1' })), 'project path protected');
});
