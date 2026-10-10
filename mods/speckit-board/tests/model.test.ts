import { expect, test } from 'claude-code/testing'

import {
  bandLayout, derivePhases, featureDir, fingerprint, nextStep, outcomeOf, parseTasks, redCount, roleColor,
  statusLine, taskSections, teamRole, toneOf,
} from '../hooks/model'
import type { BandItem, BoardInputs } from '../hooks/model'
import type { SpeckitBoard } from '../types'

test('fingerprint matches speckit-team.mjs byte for byte', async () => {
  // 2cb0d7cc9eddc2be is what the hook's own createHash code gives for these inputs:
  // CRLF and ticked boxes normalised, a missing file hashed as <missing>.
  const fp = await fingerprint([
    { path: '.specify/memory/constitution.md', text: '# C\r\nrule' },
    { path: 'specs/001-x/spec.md', text: '**Status**: Approved' },
    { path: 'specs/001-x/plan.md', text: '<missing>' },
    { path: 'specs/001-x/tasks.md', text: '- [x] T001 a\n- [ ] T002 b\n  * [X] T003 c' },
  ])
  expect(fp).toBe('2cb0d7cc9eddc2be')
})

test('ticking a task does not change the fingerprint, editing one does', async () => {
  const of = (tasks: string) => fingerprint([{ path: 'specs/001-x/tasks.md', text: tasks }])
  expect(await of('- [x] T001 a')).toBe(await of('- [ ] T001 a'))
  expect(await of('- [ ] T001 b')).not.toBe(await of('- [ ] T001 a'))
})

test('tasks parse with section, state and [P]', () => {
  const tasks = parseTasks('## Phase 1: Setup\r\n- [x] T001 Create x\n## Phase 2\n- [ ] T002 [P] [US1] Test y\nnot a task\n')
  expect(tasks).toEqual([
    { id: 'T001', text: 'Create x', section: 'Phase 1: Setup', isDone: true, isParallel: false },
    { id: 'T002', text: '[US1] Test y', section: 'Phase 2', isDone: false, isParallel: true },
  ])
})

const base: BoardInputs = {
  spec: '**Status**: Approved', plan: 'p', tasks: parseTasks('- [ ] T001 a\n- [ ] T002 b'),
  verdict: undefined, fingerprint: 'fp', red: 0, gate: undefined, running: [],
}
const states = (i: BoardInputs) => Object.fromEntries(derivePhases(i).map(p => [p.id, p.state]))

test('build is blocked until the audit passes the current files', () => {
  expect(states(base)).toMatchObject({ spec: 'done', plan: 'done', tasks: 'done', audit: 'todo', build: 'blocked' })
  expect(states({ ...base, verdict: { verdict: 'PASS', fingerprint: 'fp' } })).toMatchObject({ audit: 'done', build: 'todo' })
  expect(states({ ...base, verdict: { verdict: 'PASS', fingerprint: 'old' } })).toMatchObject({ audit: 'stale', build: 'blocked' })
  expect(states({ ...base, verdict: { verdict: 'FAIL', fingerprint: 'fp' } })).toMatchObject({ audit: 'failed', build: 'blocked' })
  expect(states({ ...base, verdict: null })).toMatchObject({ audit: 'failed' })
})

test('build fails at the retry limit and completes when every task is ticked', () => {
  const passed = { ...base, verdict: { verdict: 'PASS', fingerprint: 'fp' } }
  expect(states({ ...passed, red: 3 })).toMatchObject({ build: 'failed' })
  expect(states({ ...passed, tasks: parseTasks('- [x] T001 a') })).toMatchObject({ build: 'done' })
  expect(states({ ...passed, gate: 'APPROVED' })).toMatchObject({ verify: 'done' })
})

test('an unreadable retry record stops the build, as the gate stops implementer', () => {
  // The hook denies implementer when it cannot read the record; the board read it as no REDs.
  const passed = { ...base, verdict: { verdict: 'PASS', fingerprint: 'fp' } }
  const build = derivePhases({ ...passed, isRetryUnreadable: true }).find(p => p.id === 'build')
  expect(build).toMatchObject({ state: 'failed', note: 'retry record unreadable' })
  expect(states({ ...passed, isRetryUnreadable: true, tasks: parseTasks('- [x] T001 a') })).toMatchObject({ build: 'done' })
})

test('a FAIL on files since revised asks for a re-audit, not a fix', () => {
  // After a FAIL the architect revises; the board kept the old FAIL as the state of files nobody had audited.
  const audit = (v: BoardInputs['verdict']) => derivePhases({ ...base, verdict: v }).find(p => p.id === 'audit')
  expect(audit({ verdict: 'FAIL', fingerprint: 'fp' })).toMatchObject({ state: 'failed', note: 'FAIL' })
  expect(audit({ verdict: 'FAIL', fingerprint: 'old' })).toMatchObject({ state: 'stale', note: 'edited since FAIL' })
  expect(states({ ...base, verdict: { verdict: 'FAIL', fingerprint: 'old' } })).toMatchObject({ build: 'blocked' })
})

test('a running team agent marks its phase active', () => {
  expect(states({ ...base, plan: undefined, tasks: undefined, running: ['architect'] }))
    .toMatchObject({ plan: 'active', tasks: 'active' })
})

test('REDs count only against the fingerprint they were made on', () => {
  expect(redCount({ fingerprint: 'fp', red: ['a', 'b'] }, 'fp')).toBe(2)
  expect(redCount({ fingerprint: 'old', red: ['a', 'b'] }, 'fp')).toBe(0)
  expect(redCount(null, 'fp')).toBe(0)
})

test('report outcomes and team roles', () => {
  expect(outcomeOf('spec-auditor', 'findings\n**VERDICT: FAIL**')).toBe('FAIL')
  expect(outcomeOf('implementer', 'ran\nRESULT: green')).toBe('GREEN')
  expect(outcomeOf('spec-gatekeeper', 'all good\nAPPROVED')).toBe('APPROVED')
  expect(outcomeOf('product-owner', 'q\n**READY FOR PLAN**')).toBe('READY FOR PLAN')
  expect(teamRole('speckit-agents:architect')).toBe('architect')
  expect(teamRole('Explore')).toBeUndefined()
})

test('the gatekeeper\'s word is its last line, as the ends check reads it', () => {
  // The hook accepts only a last line that is exactly the word; the board took any "approved" in the text.
  expect(outcomeOf('spec-gatekeeper', 'Not approved: T004 has no test.\n\nNext: add the test')).toBe('')
  expect(outcomeOf('spec-gatekeeper', 'T004 is untested, so this is not APPROVED.\n\n**REJECTED**')).toBe('REJECTED')
  expect(outcomeOf('spec-gatekeeper', 'All requirements tested.\n\nApproved.')).toBe('APPROVED')
})

test('the feature is read as the hook reads it: repo-relative, or none', () => {
  // The hook hashes the path with the text, so an absolute path left as given named another fingerprint.
  expect(featureDir('specs/001-x', 'C:/r')).toBe('specs/001-x')
  expect(featureDir('./specs/001-x/', '/r')).toBe('specs/001-x')
  expect(featureDir('/r/specs/001-x', '/r')).toBe('specs/001-x')
  expect(featureDir(String.raw`C:\R\specs\001-x`, 'C:/r')).toBe('specs/001-x')
  for (const raw of [7, ['specs/001-x'], null, '', '/elsewhere/specs/001-x', '../specs/001-x', '/r']) {
    expect(featureDir(raw, '/r')).toBe('')
  }
})

test('a verify word counts only while the audit it followed is current', () => {
  const passed = { ...base, verdict: { verdict: 'PASS', fingerprint: 'fp' } }
  expect(states({ ...passed, gate: 'APPROVED' })).toMatchObject({ verify: 'done' })
  expect(states({ ...passed, gate: 'REJECTED' })).toMatchObject({ verify: 'failed' })
  // A new task or a spec edit after approval voids the audit; an approval of the old files says nothing.
  const edited = { ...base, verdict: { verdict: 'PASS', fingerprint: 'old' } }
  expect(states({ ...edited, gate: 'APPROVED' })).toMatchObject({ audit: 'stale', verify: 'stale' })
  expect(states({ ...edited, gate: 'REJECTED' })).toMatchObject({ verify: 'stale' })
  expect(states({ ...edited, gate: 'APPROVED', running: ['spec-gatekeeper'] })).toMatchObject({ verify: 'active' })
  // After a re-audit the audit is current again, but an approval from before it is still of old files.
  const reaudited = { ...base, verdict: { verdict: 'PASS', fingerprint: 'fp', at: '2026-10-08T12:00:00.000Z' } }
  expect(states({ ...reaudited, gate: 'APPROVED', gateAt: '2026-10-08T11:00:00.000Z' })).toMatchObject({ verify: 'stale' })
  expect(states({ ...reaudited, gate: 'APPROVED', gateAt: '2026-10-08T13:00:00.000Z' })).toMatchObject({ verify: 'done' })
})

test('a draft spec counts as approved once a plan exists', () => {
  // /speckit-team approves the spec in conversation, so spec.md keeps the template's Draft status;
  // the board then named "spec, draft" as the current step of a fully verified feature.
  const draft = '**Status**: Draft'
  expect(states({ ...base, spec: draft, plan: undefined, tasks: undefined })).toMatchObject({ spec: 'active' })
  expect(states({ ...base, spec: draft })).toMatchObject({ spec: 'done' })
  expect(derivePhases({ ...base, spec: draft }).find(p => p.id === 'spec')?.note).toBe('')
})

// A board as snapshot() builds it, from a passed audit unless the inputs say otherwise.
const board = (over: Partial<BoardInputs> = {}): SpeckitBoard => {
  const i: BoardInputs = { ...base, verdict: { verdict: 'PASS', fingerprint: 'fp' }, ...over }
  return {
    feature: '001-x', phases: derivePhases(i), tasks: i.tasks ?? [], red: i.red, maxRed: 3,
    isRetryUnreadable: i.isRetryUnreadable ?? false, fingerprint: 'fp',
  }
}
const SLICE = parseTasks('## Setup\n- [x] T001 a\n## Story\n- [ ] T002 [P] Test greet\n- [ ] T003 Implement greet')

test('an agent\'s word is good or bad for its own role', () => {
  // A test-writer's RED is its job done, an implementer's RED a failed attempt: the pane drew both,
  // and a killed agent, with the same green tick.
  expect(toneOf('test-writer', 'RED')).toBe('good')
  expect(toneOf('implementer', 'RED')).toBe('bad')
  expect(toneOf('implementer', 'GREEN')).toBe('good')
  expect(toneOf('implementer', 'STUB')).toBe('neutral')
  expect(toneOf('spec-auditor', 'PASS')).toBe('good')
  expect(toneOf('spec-auditor', 'FAIL')).toBe('bad')
  expect(toneOf('spec-gatekeeper', 'APPROVED')).toBe('good')
  expect(toneOf('spec-gatekeeper', 'REJECTED')).toBe('bad')
  expect(toneOf('test-writer', 'BLOCKED')).toBe('bad')
  // #74: a correction of an existing test, which adds no failing test, ends FIXED.
  expect(toneOf('test-writer', 'FIXED')).toBe('good')
  expect(toneOf('product-owner', 'READY FOR PLAN')).toBe('good')
  expect(toneOf('architect', '')).toBe('neutral')
  for (const ended of ['killed', 'failed']) expect(toneOf('spec-auditor', ended)).toBe('bad')
})

test('an agent\'s word is one its role ends on, or none', () => {
  // A role's other last lines, a question or a decision to confirm, were shown as its word, cut at 40.
  expect(outcomeOf('test-writer', 'T002 fails on the stub\n\nRED')).toBe('RED')
  expect(outcomeOf('test-writer', 'T003 cannot be tested\n**BLOCKED**')).toBe('BLOCKED')
  expect(outcomeOf('architect', 'wrote plan.md\nConfirm: add commander as a dependency')).toBe('')
  expect(outcomeOf('product-owner', 'Q1: Should a blank name greet the world? Recommended: yes')).toBe('')
})

test('each role is drawn in the color its agent file gives it', () => {
  // test/board-mod.test.mjs holds these to the `color:` lines of agents/*.md.
  expect(roleColor('architect')).toBe('purple_FOR_SUBAGENTS_ONLY')
  expect(roleColor('spec-gatekeeper')).toBe('red_FOR_SUBAGENTS_ONLY')
  expect(roleColor('Explore')).toBeUndefined()
})

test('the status line says where the feature stands, each part once', () => {
  // Claude Code names the plugin before it, so it read "speckit-board: speckit 001-x · ◐ build (1/3) ·
  // 1/3 tasks": the name twice and, while building, the count twice.
  expect(statusLine(board({ tasks: SLICE, red: 1 }))).toBe('001-x · ◐ build (1/3) · RED 1/3')
  expect(statusLine(board({ tasks: SLICE, verdict: { verdict: 'PASS', fingerprint: 'old' } })))
    .toBe('001-x · ↻ audit (edited since PASS) · 1/3 tasks')
  expect(statusLine(board({ tasks: SLICE, isRetryUnreadable: true })))
    .toBe('001-x · ✗ build (retry record unreadable) · 1/3 tasks')
  expect(statusLine(board({ tasks: parseTasks('- [x] T001 a'), gate: 'APPROVED' }))).toBe('001-x · ✓ verified · 1/1 tasks')
  // No tasks.md yet, so no count of its tasks.
  expect(statusLine(board({ spec: undefined, plan: undefined, tasks: undefined, verdict: undefined }))).toBe('001-x · ○ spec')
  expect(statusLine(null)).toBeUndefined()
})

test('the next step follows the pipeline, and names the next task while building', () => {
  const next = (over: Partial<BoardInputs>, running: string[] = []) => nextStep(board(over), running).text
  const none = { spec: undefined, plan: undefined, tasks: undefined, verdict: undefined }
  expect(next(none)).toBe('start with /speckit-team <idea>')
  expect(next({ ...none, spec: '**Status**: Draft' })).toBe('review spec.md, then plan')
  expect(next({ ...none, spec: '**Status**: Draft' }, ['product-owner'])).toBe('waiting for product-owner')
  expect(next({ plan: undefined, tasks: undefined, verdict: undefined })).toBe('architect: write plan.md and tasks.md')
  expect(next({ tasks: SLICE, verdict: undefined })).toBe('spec-auditor: audit spec, plan and tasks')
  expect(next({ tasks: SLICE, verdict: undefined }, ['spec-auditor'])).toBe('waiting for spec-auditor')
  expect(next({ tasks: SLICE, verdict: { verdict: 'PASS', fingerprint: 'old' } })).toBe('re-audit: spec, plan or tasks changed')
  expect(next({ tasks: SLICE, verdict: { verdict: 'FAIL', fingerprint: 'fp' } })).toBe('route CRITICAL/HIGH findings, then re-audit')
  expect(next({ tasks: SLICE, verdict: null })).toBe('verdict unreadable: run spec-auditor again')
  // While building, whoever runs, the next open task in tasks.md order.
  expect(next({ tasks: SLICE })).toBe('T002 Test greet')
  expect(next({ tasks: SLICE }, ['test-writer'])).toBe('T002 Test greet')
  expect(next({ tasks: SLICE, red: 3 })).toBe('retry limit: architect rethinks the task, then re-audit')
  expect(next({ tasks: SLICE, isRetryUnreadable: true })).toBe('delete .git/speckit-team/retries/001-x.json')
  const all = parseTasks('- [x] T001 a')
  expect(next({ tasks: all })).toBe('spec-gatekeeper: check every requirement has a test')
  expect(next({ tasks: all }, ['spec-gatekeeper'])).toBe('waiting for spec-gatekeeper')
  expect(next({ tasks: all, gate: 'REJECTED' })).toBe('route the REJECTED reasons, then re-run spec-gatekeeper')
  const reaudited = { verdict: 'PASS', fingerprint: 'fp', at: '2026-10-08T12:00:00.000Z' }
  expect(next({ tasks: all, verdict: reaudited, gate: 'APPROVED', gateAt: '2026-10-08T11:00:00.000Z' }))
    .toBe('re-run spec-gatekeeper: the audit changed')
  expect(next({ tasks: all, gate: 'APPROVED' })).toBe('ready for the PR')
  // The pane draws the task as it draws the task list.
  expect(nextStep(board({ tasks: SLICE }), []).task).toMatchObject({ id: 'T002', isParallel: true })
  expect(nextStep(board({ tasks: SLICE, verdict: undefined }), []).task).toBeUndefined()
})

test('task sections fold what is finished or not started yet', () => {
  // A real tasks.md has dozens of tasks: the pane listed every one, done or not.
  const tasks = parseTasks('## Setup\n- [x] T001 a\n## Story\n- [x] T002 b\n- [ ] T003 c\n## Later\n- [ ] T004 d\n## Polish\n- [ ] T005 e')
  expect(taskSections(tasks, false).map(s => [s.title, s.done, s.total, s.isOpen])).toEqual([
    ['Setup', 1, 1, false], ['Story', 1, 2, true], ['Later', 0, 1, false], ['Polish', 0, 1, false],
  ])
  expect(taskSections(tasks, true).every(s => s.isOpen)).toBe(true)
  // Nothing done yet: the section with the first open task is the one shown.
  expect(taskSections(parseTasks('## A\n- [ ] T001 a\n## B\n- [ ] T002 b'), false).map(s => s.isOpen)).toEqual([true, false])
  // A section started out of order ([P] work) shows too.
  expect(taskSections(parseTasks('## A\n- [ ] T001 a\n## B\n- [x] T002 b\n- [ ] T003 c'), false).map(s => s.isOpen)).toEqual([true, true])
})

const widthOf = (items: readonly BandItem[]) => items.reduce((n, x) => n + x.text.length, 0) + items.length - 1
const phaseTexts = (items: readonly BandItem[]) => items.filter(x => x.kind === 'phase').map(x => x.text)

test('the band keeps to one row and always names the current phase', () => {
  // Below 100 columns it drew every phase as a bare glyph, and wrapped once the row was full.
  const b = board({ tasks: SLICE, red: 1 })
  const wide = bandLayout(b, [], 0, 135)
  expect(phaseTexts(wide)).toEqual(['✓ spec', '✓ plan', '✓ tasks', '✓ audit', '◐ build', '○ verify'])
  expect(wide.find(x => x.kind === 'bar')?.text).toHaveLength(10)
  expect(wide.map(x => x.text)).toContain('[ hide ]')
  expect(phaseTexts(bandLayout(b, [], 0, 70))).toEqual(['✓', '✓', '✓', '✓', '◐ build', '○'])
  for (const cols of [135, 100, 80, 70, 60, 45, 30]) {
    const items = bandLayout(b, [], 0, cols)
    expect(widthOf(items)).toBeLessThanOrEqual(cols)
    expect(phaseTexts(items)).toContain('◐ build')
    expect(items.map(x => x.text)).toContain('RED 1/3')
  }
})

test('the band shows the team agent at work and for how long', () => {
  const b = board({ tasks: SLICE })
  const agent = (running: { type: string, startedAt: number }[], cols = 135) =>
    bandLayout(b, running, 42_000, cols).find(x => x.kind === 'agent')?.text
  expect(agent([])).toBeUndefined()
  expect(agent([{ type: 'implementer', startedAt: 0 }])).toBe('◐ implementer 42s')
  expect(agent([{ type: 'test-writer', startedAt: 0 }, { type: 'test-writer', startedAt: 30_000 }])).toBe('◐ test-writer +1 42s')
  expect(agent([{ type: 'implementer', startedAt: 0 }], 60)).toBe('◐ implementer 42s')
})

test('a short band drops its buttons before the phases, and does not change as the clock runs', () => {
  // Beside a docked pane, the band is about 70 columns: it kept `[ board ]`, which opens the pane
  // already open there, and dropped the glyphs of every other phase.
  const b = board({ tasks: SLICE, red: 1 })
  const at = (ms: number, cols: number) => bandLayout(b, [{ type: 'implementer', startedAt: 0 }], ms, cols)
  expect(phaseTexts(at(14_000, 70))).toEqual(['✓', '✓', '✓', '✓', '◐ build', '○'])
  expect(at(14_000, 70).some(x => x.kind === 'button')).toBe(false)
  // The running time grows a character at 10s and at 1m: the band kept to one row by dropping parts,
  // and would have changed shape as it ran.
  for (let cols = 30; cols <= 140; cols++) {
    const shape = (ms: number) => at(ms, cols).map(x => (x.kind === 'agent' ? 'agent' : x.text)).join('|')
    expect(shape(5_000)).toBe(shape(3_599_000))
  }
})

// 004-board-clear FR-001, SC-006 band, D2 A: the band's buttons are board, clear, hide, and drop
// hide first, then clear, then board.
test('the band carries a clear button between board and hide, and drops buttons in order', () => {
  const b = board({ tasks: SLICE, red: 1 })
  const buttons = bandLayout(b, [], 0, 135).filter(x => x.kind === 'button')
  expect(buttons.map(x => x.text)).toEqual(['[ board ]', '[ clear ]', '[ hide ]'])
  expect(buttons[1]).toMatchObject({ key: 'clear', label: 'clear' })
  for (const running of [[], [{ type: 'implementer', startedAt: 0 }]]) {
    for (let cols = 30; cols <= 140; cols++) {
      const items = bandLayout(b, running, 0, cols)
      const texts = items.map(x => x.text)
      if (texts.includes('[ hide ]')) expect(texts).toContain('[ clear ]')
      if (texts.includes('[ clear ]')) expect(texts).toContain('[ board ]')
      expect(widthOf(items)).toBeLessThanOrEqual(cols)
    }
  }
})
