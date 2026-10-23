// Run: npm test (or node --test "test/*.test.mjs")
// tools/live-board.mjs runs the board's interactive checks through vhs, which CI does not have. These
// check how it reads L3 to L6 off the screens, on screens written by hand in vhs's text format: one
// screen after each command of the tape, between lines of 80 box rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdicts } from '../tools/live-board.mjs';

const BAND = '◆ 001-greet ✓ ✓ ✓ ✓ ◐ build ○ │ 1/3 [ board ] [ clear ] [ hide ]';
const STATUS = '  ⚠ speckit-board: 001-greet · ◐ build (1/3)';
// The TUI's own rule spans the terminal, so the widest line gives its width.
const screen = (...lines) => [...lines, '─'.repeat(140)].join('\n');
const SCREENS = [
  screen('❯ /speckit-board', STATUS),
  screen('  ⎿  speckit-board: pane opened.        │[ clear ] [ close ]', BAND, STATUS),
  screen('│✓ spec-auditor    PASS took 0s · 12s ago', BAND, STATUS),
  screen(' │ cleared 2 agent rows, pane and band. │', '│cleared; refresh or the next team agent brings it back', STATUS),
  screen('│cleared; refresh or the next team agent brings it back', STATUS),
  screen('❯ board one more', '│cleared; refresh or the next team agent brings it back', STATUS),
  screen('│✓ spec-auditor    PASS took 0s · 2s ago', BAND, STATUS),
  screen('❯ fourseconds', '│✓ spec-auditor    PASS took 0s · 6s ago', BAND, STATUS),
];
const HASHES = 'a1\nb2\nc3\n';
const join = (screens) => screens.join(`\n${'─'.repeat(80)}\n`);
const failed = (results) => results.filter((r) => !r.ok).map((r) => r.id);

test('a run that shows every check passes L3 to L6', () => {
  const results = verdicts(join(SCREENS), { before: HASHES, after: HASHES });
  assert.deepEqual(failed(results), []);
  assert.equal(results.find((r) => r.id === 'L6').note, '3 files hashed');
});

test('each check fails on the screens that break it', () => {
  const cases = [
    ['L3', 'a narrower terminal', SCREENS.map((s) => s.replace('─'.repeat(140), '─'.repeat(114)))],
    ['L3', 'no [ clear ] in the pane', SCREENS.map((s) => s.replace('[ clear ] [ close ]', '[ close ]'))],
    ['L4', 'the pane not cleared (#150)', SCREENS.map((s, i) => (i === 3 ? s.replace(/cleared; refresh.*back/, 'no team agent has run this session') : s))],
    ['L4', 'the band still drawn after the clear', SCREENS.map((s, i) => (i === 4 ? `${s}\n${BAND}` : s))],
    ['L4', 'the status line changed by the clear', SCREENS.map((s, i) => (i >= 3 ? s.replace('build (1/3)', 'build (2/3)') : s))],
    ['L5', 'the band not back by the mark typed 4 s later', SCREENS.map((s, i) => (i >= 6 ? s.replace(BAND, '') : s))],
    ['L5', 'no row for the new agent', SCREENS.map((s, i) => (i >= 6 ? s.replace(/✓ spec-auditor .*/, '') : s))],
  ];
  for (const [id, what, screens] of cases) {
    assert.ok(failed(verdicts(join(screens), { before: HASHES, after: HASHES })).includes(id), `${id} passed with ${what}`);
  }
  const noToast = failed(verdicts(join(SCREENS.map((s) => s.replace('cleared 2 agent rows, pane and band.', ''))), { before: HASHES, after: HASHES }));
  assert.deepEqual(noToast, ['L4', 'L5'], 'without the toast there is no clear, and L5 counts from it');
  assert.deepEqual(failed(verdicts(join(SCREENS), { before: HASHES, after: 'a1\nb9\nc3\n' })), ['L6']);
  assert.deepEqual(failed(verdicts(join(SCREENS), { before: '', after: '' })), ['L6'], 'no file hashed is not a pass');
});

test('the pane variant leaves L5 unchecked, reported as such', () => {
  const l5 = verdicts(join(SCREENS), { before: HASHES, after: HASHES, variant: 'pane' }).find((r) => r.id === 'L5');
  assert.equal(l5.skipped, true);
  assert.match(l5.name, /not checked/);
});
