import { expect, test } from 'claude-code/testing'

import {
  TEAM, ancestors, bandLayout, boardText, derivePhases, featureDir, fingerprint, nextStep, outcomeOf, parseTasks, redCount, roleColor,
  noticeText, statusLine, taskSections, teamRole, toneOf,
  NO_STATS, addUsage, agentStats, costBar, dollars, estimateUsd, priceOf, readUsage, shortCount, statsView,
} from '../hooks/model'
import type { BandItem, BoardInputs, Mark } from '../hooks/model'
import type { SpeckitBoard, SpeckitStats, SpeckitUsage } from '../types'

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
    isRetryUnreadable: i.isRetryUnreadable ?? false, fingerprint: 'fp', isStandalone: i.isStandalone,
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
    const narrowest = widthOf(bandLayout(b, running, 0, 30))
    for (let cols = 30; cols <= 140; cols++) {
      const items = bandLayout(b, running, 0, cols)
      const texts = items.map(x => x.text)
      if (texts.includes('[ hide ]')) expect(texts).toContain('[ clear ]')
      if (texts.includes('[ clear ]')) expect(texts).toContain('[ board ]')
      // The narrowest layout (only-head) is wider than 30 columns with a running agent, with or
      // without the button; the bound holds from that width up, and at every width with no agent.
      if (running.length === 0 || cols >= narrowest) expect(widthOf(items)).toBeLessThanOrEqual(cols)
    }
  }
})

// 005-standalone-board: a feature with no team record. Stages S-1 to S-8 of contracts/board-text.md.
const ten = (ticked: number) => parseTasks(Array.from({ length: 10 }, (_, n) => `- [${n < ticked ? 'x' : ' '}] T${String(n + 1).padStart(3, '0')} item ${n + 1}`).join('\n'))
const alone = (over: Partial<BoardInputs> = {}): Partial<BoardInputs> => ({ isStandalone: true, verdict: undefined, ...over })
const none = { spec: undefined, plan: undefined, tasks: undefined }
const STAGES: { id: string, over: Partial<BoardInputs>, status: string, phases: string, next: string }[] = [
  { id: 'S-1', over: none, status: '001-x · ○ spec', phases: '○ spec ○ plan ○ tasks ○ build', next: 'start with /speckit-specify <idea>' },
  { id: 'S-2', over: { ...none, spec: '**Status**: Draft' }, status: '001-x · ◐ spec (draft)',
    phases: '◐ spec ○ plan ○ tasks ○ build', next: 'review spec.md, then /speckit-plan' },
  { id: 'S-3', over: { plan: undefined, tasks: undefined }, status: '001-x · ○ plan',
    phases: '✓ spec ○ plan ○ tasks ○ build', next: 'run /speckit-plan' },
  { id: 'S-4', over: { tasks: undefined }, status: '001-x · ○ tasks', phases: '✓ spec ✓ plan ○ tasks ○ build', next: 'run /speckit-tasks' },
  { id: 'S-5', over: { tasks: ten(0) }, status: '001-x · ○ build (0/10)', phases: '✓ spec ✓ plan ✓ tasks ○ build',
    next: '/speckit-implement: T001 item 1' },
  { id: 'S-6', over: { tasks: ten(4) }, status: '001-x · ◐ build (4/10)', phases: '✓ spec ✓ plan ✓ tasks ◐ build', next: 'T005 item 5' },
  { id: 'S-7', over: { tasks: ten(10) }, status: '001-x · ✓ ready for the PR · 10/10 tasks',
    phases: '✓ spec ✓ plan ✓ tasks ✓ build', next: 'ready for the PR' },
  { id: 'S-8', over: { tasks: [] }, status: '001-x · ○ build', phases: '✓ spec ✓ plan ✓ tasks ○ build', next: 'tasks.md lists no tasks' },
]
const standalone = (over: Partial<BoardInputs>) => board(alone(over))

test('standalone shows four phases, FR-004 FR-002', () => {
  expect(derivePhases({ ...base, ...alone() }).map(p => p.id)).toEqual(['spec', 'plan', 'tasks', 'build'])
  // Absent flag: the six phases, as today.
  expect(derivePhases(base).map(p => p.id)).toEqual(['spec', 'plan', 'tasks', 'audit', 'build', 'verify'])
  expect(derivePhases({ ...base, isStandalone: false }).map(p => p.id)).toHaveLength(6)
})

test('standalone build is current once tasks are done, with no gate, FR-006', () => {
  expect(states({ ...base, ...alone() })).toEqual({ spec: 'done', plan: 'done', tasks: 'done', build: 'todo' })
  expect(states({ ...base, ...alone({ tasks: ten(4) }) })).toMatchObject({ build: 'active' })
  expect(states({ ...base, ...alone({ tasks: ten(10) }) })).toMatchObject({ build: 'done' })
})

test('standalone derivation ignores verdict, red, retry record, gate and running, FR-003', () => {
  const noisy = { verdict: { verdict: 'FAIL', fingerprint: 'old' }, red: 5, isRetryUnreadable: true, gate: 'REJECTED', running: ['implementer', 'architect'] }
  expect(derivePhases({ ...base, ...alone(), ...noisy })).toEqual(derivePhases({ ...base, ...alone() }))
  // A running architect leaves plan todo, not active.
  expect(states({ ...base, ...alone({ plan: undefined, tasks: undefined, running: ['architect'] }) })).toMatchObject({ plan: 'todo', tasks: 'todo' })
  expect(states({ ...base, ...alone({ spec: undefined, plan: undefined, tasks: undefined, running: ['product-owner'] }) })).toMatchObject({ spec: 'todo' })
})

test('standalone: approved spec with no plan is spec done, plan todo (edge case)', () => {
  expect(states({ ...base, ...alone({ plan: undefined, tasks: undefined }) })).toEqual({ spec: 'done', plan: 'todo', tasks: 'todo', build: 'todo' })
})

for (const st of STAGES) {
  test(`${st.id}: standalone status line, phases line and next step`, () => {
    const b = standalone(st.over)
    expect(b.phases.map(p => p.id)).toEqual(['spec', 'plan', 'tasks', 'build'])
    expect(statusLine(b)).toBe(st.status)
    expect(boardText(b, [], 0)).toBe([st.status, st.phases, `next: ${st.next}`].join('\n'))
    expect(nextStep(b, []).text).toBe(st.next)
  })
}

test('S-5: the next step carries the command and the task', () => {
  const step = nextStep(standalone({ tasks: ten(0) }), [])
  expect(step).toMatchObject({ text: '/speckit-implement: T001 item 1', command: '/speckit-implement:', task: { id: 'T001' } })
  expect(nextStep(standalone({ tasks: ten(4) }), []).command).toBeUndefined()
})

test('SC-001, FR-003: standalone texts name no team agent and no /speckit-team, no agent item, no running line', () => {
  const agents = [{ type: 'implementer', startedAt: 0 }, { type: 'architect', startedAt: 0 }]
  for (const st of STAGES) {
    const b = standalone(st.over)
    for (const running of [[], agents]) {
      const strings = [
        statusLine(b) ?? '', boardText(b, running, 5_000), nextStep(b, running.map(a => a.type)).text,
        ...[135, 100, 70, 45, 30].flatMap(cols => bandLayout(b, running, 5_000, cols).map(x => x.text)),
      ]
      for (const text of strings) {
        expect(text, `${st.id}: ${text}`).not.toContain('/speckit-team')
        for (const name of TEAM) expect(text, `${st.id}: ${text}`).not.toContain(name)
      }
      expect(boardText(b, running, 5_000)).not.toContain('running:')
      expect(boardText(b, running, 5_000).split('\n')).toHaveLength(3)
      expect(bandLayout(b, running, 5_000, 135).some(x => x.kind === 'agent' || x.kind === 'red')).toBe(false)
      expect(nextStep(b, running.map(a => a.type)).text).toBe(st.next)
    }
  }
})

test('team view is unchanged without the flag, FR-008', () => {
  expect(boardText(board({ tasks: SLICE }), [{ type: 'implementer', startedAt: 0 }], 42_000)).toContain('running: implementer 42s')
  expect(nextStep(board({ ...none, verdict: undefined }), []).text).toBe('start with /speckit-team <idea>')
})

// ---- 005-standalone-board: ancestors (T009) and unreadable files (T014) ----

test('005 FR-014 ancestors lists the folder and each parent, nearest first, forward slashes, no trailing slash', () => {
  // The root is '' (POSIX) or the drive (Windows), so `${dir}/.specify` is the path to test.
  expect(ancestors('/a/b')).toEqual(['/a/b', '/a', ''])
  expect(ancestors('/a/b/')).toEqual(['/a/b', '/a', ''])
  expect(ancestors(String.raw`C:\a\b`)).toEqual(['C:/a/b', 'C:/a', 'C:'])
  expect(ancestors('C:/a/b/')).toEqual(['C:/a/b', 'C:/a', 'C:'])
  expect(ancestors('/a/b').map(dir => `${dir}/.specify`)).toEqual(['/a/b/.specify', '/a/.specify', '/.specify'])
  expect(ancestors(String.raw`C:\a\b`).map(dir => `${dir}/.specify`)).toEqual(['C:/a/b/.specify', 'C:/a/.specify', 'C:/.specify'])
})

test('005 contract N-1..N-4 noticeText gives the one-line texts', () => {
  expect(noticeText('not-set-up')).toBe('Spec Kit is not set up here (no .specify/): specify init sets it up.')
  expect(noticeText('no-feature')).toBe('no active feature in .specify/feature.json: /speckit-specify <idea> starts one.')
  expect(noticeText('feature-unreadable')).toBe('cannot read .specify/feature.json: /speckit-specify <idea> writes it again.')
  expect(noticeText('no-folder', 'specs/009-gone'))
    .toBe('specs/009-gone, the active feature in .specify/feature.json, does not exist: /speckit-specify <idea> starts one.')
})

// null is unreadable, undefined missing (D3-A). The input types allow null once implemented.
const UNREADABLE = null as unknown as undefined
const FILES = [
  { id: 'U-1', file: 'spec', over: { spec: UNREADABLE } },
  { id: 'U-2', file: 'plan', over: { plan: UNREADABLE } },
  { id: 'U-3', file: 'tasks', over: { tasks: UNREADABLE } },
] as const
for (const st of FILES) {
  for (const view of [{ name: 'standalone', flag: true }, { name: 'team', flag: undefined }]) {
    test(`005 FR-011 D3-A ${st.id}: ${st.file} unreadable is failed with its note in the ${view.name} view`, () => {
      const i: BoardInputs = { ...base, ...(view.flag ? alone() : {}), verdict: view.flag ? undefined : { verdict: 'PASS', fingerprint: 'fp' }, ...st.over }
      const phase = derivePhases(i).find(p => p.id === st.file)
      expect(phase).toMatchObject({ state: 'failed', note: 'unreadable' })
      const b = board(i)
      expect(statusLine(b)).toContain(`✗ ${st.file} (unreadable)`)
      expect(boardText(b, [], 0).split('\n')[1]).toContain(`✗ ${st.file}`)
      expect(nextStep(b, []).text).toBe(`cannot read ${st.file}.md`)
      // Missing stays missing.
      const missing = derivePhases({ ...i, [st.file]: undefined }).find(p => p.id === st.file)
      expect(missing?.state).not.toBe('failed')
      expect(missing?.note).not.toBe('unreadable')
    })
  }
}

// ---- 010-context-cost-stats ----

const use = (input: number, output = 0, write = 0, read = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: read })
const usageOf = (model: string, u: ReturnType<typeof use>) => ({ [model]: u }) as unknown as SpeckitUsage
const M = 1_000_000

// FR-004, D4: dated, Bedrock and Vertex ids take the listed key; an unlisted sibling is unpriced.
test('010 priceOf matches a listed key exactly after dropping the id decorations (FR-004, D4)', () => {
  const opus45 = { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 }
  expect(priceOf('claude-opus-4-5')).toEqual(opus45)
  expect(priceOf('claude-opus-4-5-20251101')).toEqual(opus45)
  expect(priceOf('anthropic.claude-opus-4-5-20251101-v1:0')).toEqual(opus45)
  expect(priceOf('anthropic.claude-opus-4-5-v2')).toEqual(opus45)
  expect(priceOf('claude-opus-4-5@20251101')).toEqual(opus45)
  expect(priceOf('claude-opus-4')).toEqual({ input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 })
  expect(priceOf('claude-opus-4-9')).toBeUndefined()
  expect(priceOf('claude-opus-4-5-fast')).toBeUndefined()
  expect(priceOf('claude-opus')).toBeUndefined()
  expect(priceOf('gpt-5')).toBeUndefined()
  expect(priceOf('')).toBeUndefined()
  expect(priceOf('claude-sonnet-5-5')).toEqual({ input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 })
  expect(priceOf('claude-haiku-3-5')).toEqual({ input: 0.8, cacheWrite: 1, cacheRead: 0.08, output: 4 })
})

test('010 estimateUsd prices each of the four counts at its own rate (FR-004, D3)', () => {
  expect(Math.abs((estimateUsd(usageOf('claude-opus-4-5', use(M))) ?? NaN) - 5)).toBeLessThan(0.005)
  expect(Math.abs((estimateUsd(usageOf('claude-opus-4-5', use(0, M))) ?? NaN) - 25)).toBeLessThan(0.005)
  expect(Math.abs((estimateUsd(usageOf('claude-opus-4-5', use(0, 0, M))) ?? NaN) - 6.25)).toBeLessThan(0.005)
  expect(Math.abs((estimateUsd(usageOf('claude-opus-4-5', use(0, 0, 0, M))) ?? NaN) - 0.5)).toBeLessThan(0.005)
  expect(Math.abs((estimateUsd(usageOf('claude-opus-4-5-20251101', use(M, M, M, M))) ?? NaN) - 36.75)).toBeLessThan(0.005)
  const two = { ...usageOf('claude-opus-4-5', use(M)), ...usageOf('claude-haiku-4-5', use(0, M)) }
  expect(Math.abs((estimateUsd(two) ?? NaN) - 10)).toBeLessThan(0.005)
})

test('010 estimateUsd gives undefined for empty usage and for any unpriced model (edge case, SC-004)', () => {
  expect(estimateUsd({})).toBeUndefined()
  expect(estimateUsd(usageOf('claude-mystery-9', use(M)))).toBeUndefined()
  const mixed = { ...usageOf('claude-opus-4-5', use(M)), ...usageOf('claude-mystery-9', use(1)) }
  expect(estimateUsd(mixed)).toBeUndefined()
})

test('010 addUsage sums a turn per model and never mutates or accepts a malformed turn (SC-004)', () => {
  const first = addUsage({}, { model: 'm1', ...use(1, 2, 3, 4) })
  expect(first['m1']).toMatchObject(use(1, 2, 3, 4))
  const sum = addUsage(first, { model: 'm1', ...use(10, 20, 30, 40) })
  expect(sum['m1']).toMatchObject(use(11, 22, 33, 44))
  expect(first['m1']).toMatchObject(use(1, 2, 3, 4))
  expect(addUsage(sum, { model: 'm2', ...use(5) })['m2']).toMatchObject(use(5, 0, 0, 0))
  const frozen = Object.freeze({ ...first })
  for (const bad of [
    null, undefined, 'x', 7, [], {}, { ...use(1) }, { model: 3, ...use(1) },
    { model: 'm', ...use(-1) }, { model: 'm', ...use(Number.NaN) }, { model: 'm', ...use(Infinity) },
    { model: 'm', ...use(1), output_tokens: '2' }, { model: 'm', input_tokens: 1 },
  ]) {
    expect(addUsage(frozen, bad)).toEqual(frozen)
  }
  expect(first['m1']).toMatchObject(use(1, 2, 3, 4))
})

const READ = {
  context: { percent: 50, tokens: 100_000, window: 200_000 }, cost: { usd: 2.5 }, rateLimits: [] as { kind: string }[],
}
const apiKey = (over: Partial<SpeckitStats> = {}): SpeckitStats =>
  ({ isRead: true, percent: 50, contextTokens: 100_000, window: 200_000, usd: 2.5, isSubscription: false, usage: {}, ...over })

test('010 readUsage reads a SessionUsage and keeps usage and the subscription flag (US1, FR-004, D1)', () => {
  const before: SpeckitStats = { ...NO_STATS, usage: usageOf('claude-opus-4-5', use(1)) }
  expect(readUsage(READ, before)).toEqual({
    isRead: true, percent: 50, contextTokens: 100_000, window: 200_000, usd: 2.5, isSubscription: false, usage: before.usage,
  })
  expect(readUsage({ ...READ, rateLimits: [{ kind: 'five_hour' }] }, before).isSubscription).toBe(true)
  expect(readUsage({ ...READ, rateLimits: [{ kind: 'seven_day' }] }, before).isSubscription).toBe(true)
  // A gateway's spend_limit alone is not a subscription (D1).
  expect(readUsage({ ...READ, rateLimits: [{ kind: 'spend_limit' }] }, before).isSubscription).toBe(false)
  // Once seen, kept.
  expect(readUsage(READ, { ...before, isSubscription: true }).isSubscription).toBe(true)
  const noCost = readUsage({ context: READ.context }, before)
  expect(noCost.isRead).toBe(true)
  expect(noCost.usd).toBeUndefined()
})

test('010 readUsage on anything unusable clears the figures but keeps usage and isSubscription (SC-004)', () => {
  const before = apiKey({ isSubscription: true, usage: usageOf('claude-opus-4-5', use(7)) })
  for (const raw of [undefined, null, new Error('rejected'), 'x', 5, []]) {
    const s = readUsage(raw, before)
    expect(s.isRead).toBe(false)
    expect([s.percent, s.contextTokens, s.window, s.usd]).toEqual([undefined, undefined, undefined, undefined])
    expect(s.usage).toEqual(before.usage)
    expect(s.isSubscription).toBe(true)
  }
  // A field of the wrong type reads as absent.
  const odd = readUsage({ context: { percent: '50', tokens: 1, window: 2 }, cost: { usd: 1 } }, NO_STATS)
  expect(odd.percent).toBeUndefined()
  expect(odd.usd).toBe(1)
})

test('010 shortCount and dollars keep to their bounds (contracts/stats-text.md "Figures")', () => {
  const counts: [number, string][] = [
    [0, '0'], [999, '999'], [1_000, '1.0k'], [9_900, '9.9k'], [9_950, '10k'], [45_000, '45k'], [999_000, '999k'],
    [999_949, '999k'], [999_950, '1.0M'], [1_200_000, '1.2M'], [99_900_000, '99.9M'], [99_950_000, '100M'],
    [120_000_000, '120M'], [999_950_000, '1.0B'], [1_200_000_000, '1.2B'],
  ]
  for (const [n, text] of counts) expect(shortCount(n)).toBe(text)
  const money: [number, string][] = [
    [0, '$0.00'], [0.78, '$0.78'], [2.5, '$2.50'], [9, '$9.00'], [9_999.99, '$9999.99'], [10_000, '$10k'], [1_200_000, '$1.2M'],
  ]
  for (const [n, text] of money) expect(dollars(n)).toBe(text)
})

// SC-007, D10: one cell per whole tenth, fill rounded to 3 decimals then floored.
test('010 costBar draws 10 cells, one per whole tenth reached (SC-007, D10)', () => {
  expect(costBar(0)).toBe('░░░░░░░░░░')
  expect(costBar(2.5 / 5)).toBe('█████░░░░░')
  expect(costBar(4 / 5)).toBe('████████░░')
  expect(costBar(4.75 / 5)).toBe('█████████░')
  expect(costBar(1)).toBe('██████████')
  expect(costBar(0.1 - 1e-12)).toBe('█░░░░░░░░░')
  expect(costBar(0.3 - 1e-15)).toBe('███░░░░░░░')
  expect(costBar(0.0994)).toBe('░░░░░░░░░░')
  expect(costBar(0.999)).toBe('█████████░')
})

test('010 statsView of a known session: context, tokens and an API-key cost as reported (US1-1, US2-1, US2-4, FR-001, FR-003)', () => {
  const v = statsView(apiKey({ usd: 0.78, usage: usageOf('claude-sonnet-4-5', use(1_000_000, 45_000, 100_000, 100_000)) }))
  expect(v.context.text).toBe('50%')
  expect(Math.abs((v.context.fill ?? NaN) - 0.5)).toBeLessThan(0.005)
  expect(v.context.mark).toBe('')
  expect(v.detail).toBe('100k of 200k')
  expect(v.tokens).toBe('1.2M in · 45k out')
  expect(v.cost.text).toBe('$0.78')
  expect(Math.abs((v.cost.fill ?? NaN) - 0.156)).toBeLessThan(5e-11)
  expect(v.cost.mark).toBe('')
})

test('010 statsView marks context and cost on the uncapped ratio, with the fill capped (US1-2, US2-7, US2-8, FR-002, FR-013, SC-001, SC-007)', () => {
  const ctx = (percent: number) => statsView(apiKey({ percent })).context
  expect(ctx(79).mark).toBe('')
  expect(ctx(80).mark).toBe('high')
  expect(ctx(94).mark).toBe('high')
  expect(ctx(95).mark).toBe('critical')
  expect(ctx(100)).toMatchObject({ text: '100%', fill: 1, mark: 'critical' })
  expect(ctx(130)).toMatchObject({ text: '>100%', fill: 1, mark: 'critical' })
  for (const [percent, expected] of [[0, 0], [50, 0.5], [80, 0.8], [95, 0.95], [100, 1]] as const) {
    expect(Math.abs((ctx(percent).fill ?? -1) - expected)).toBeLessThanOrEqual(0.01)
  }
  const cost = (usd: number) => statsView(apiKey({ usd })).cost
  const sampled: [number, number, string, Mark][] = [
    [0, 0, '$0.00', ''], [2.5, 0.5, '$2.50', ''], [4, 0.8, '$4.00', 'high'], [4.75, 0.95, '$4.75', 'critical'],
    [5, 1, '$5.00', 'critical'], [9, 1, '$9.00', 'critical'],
  ]
  for (const [usd, fill, text, mark] of sampled) {
    expect(cost(usd).text).toBe(text)
    expect(cost(usd).mark).toBe(mark)
    expect(Math.abs((cost(usd).fill ?? NaN) - fill)).toBeLessThan(5e-11)
  }
})

test('010 statsView: a fresh session reads 0%, an unknown context reads n/a (US1-3, US1-4)', () => {
  expect(statsView(apiKey({ percent: undefined, contextTokens: undefined, window: undefined, usd: 0 })).context)
    .toMatchObject({ text: '0%', fill: 0, mark: '' })
  expect(statsView({ isRead: true, isSubscription: false, usage: {} }).context).toMatchObject({ text: '0%', fill: 0 })
  const spent = statsView(apiKey({ percent: undefined, contextTokens: undefined, window: undefined, usd: 1.2 }))
  expect(spent.context.text).toBe('n/a')
  expect(spent.context.fill).toBeUndefined()
  expect(spent.detail).toBe('')
  const unread = statsView(NO_STATS)
  expect(unread.context).toMatchObject({ text: 'n/a', mark: '' })
  expect(unread.context.fill).toBeUndefined()
  expect(unread.cost).toMatchObject({ text: 'n/a', mark: '' })
  expect(unread.cost.fill).toBeUndefined()
  expect(unread.tokens).toBe('0 in · 0 out')
  const spentByUsage = statsView({ isRead: true, isSubscription: false, usage: usageOf('claude-opus-4-5', use(10)) })
  expect(spentByUsage.context.text).toBe('n/a')
})

test('010 statsView cost: est. on a subscription, an estimate when none is reported, n/a when unpriced (US2-3, US2-4, US2-5, US2-9, FR-004, SC-006)', () => {
  const sub = statsView(apiKey({ usd: 0.78, isSubscription: true }))
  expect(sub.cost.text).toBe('$0.78 est.')
  expect(statsView(apiKey({ usd: 0, isSubscription: true })).cost.text).toBe('$0.00 est.')
  // Reported wins over any estimate.
  expect(statsView(apiKey({ usd: 0.5, usage: usageOf('claude-sonnet-4-5', use(M)) })).cost.text).toBe('$0.50')
  // No reported cost: the tokens at list price, marked.
  const est = statsView({ isRead: false, isSubscription: false, usage: usageOf('claude-sonnet-4-5', use(100_000)) })
  expect(est.cost.text).toBe('$0.30 est.')
  expect(Math.abs((est.cost.fill ?? NaN) - 0.06)).toBeLessThan(0.005)
  const estNoCost = statsView(apiKey({ usd: undefined, usage: usageOf('claude-sonnet-4-5', use(100_000)) }))
  expect(estNoCost.cost.text).toBe('$0.30 est.')
  // Unknown price: n/a, never $0.00.
  const none = statsView(apiKey({ usd: undefined, usage: usageOf('claude-mystery-9', use(M)) }))
  expect(none.cost.text).toBe('n/a')
  expect(none.cost.fill).toBeUndefined()
  // An estimate fills and marks its bar like a reported cost (US2-9, SC-007).
  const big = statsView({ isRead: false, isSubscription: false, usage: usageOf('claude-sonnet-4-5', use(0, 300_000)) })
  expect(big.cost.text).toBe('$4.50 est.')
  expect(big.cost.mark).toBe('high')
})

test('010 agentStats: tokens and an always-estimated cost, n/a without usage or a price (US4-2, US4-3, FR-007, D2)', () => {
  expect(agentStats(usageOf('claude-sonnet-4-5', use(M)))).toBe('$3.00 est. · 1.0M in · 0 out')
  expect(agentStats(usageOf('claude-sonnet-4-5', use(0, 40_000, 0, 1_200_000)))).toBe('$0.96 est. · 1.2M in · 40k out')
  expect(agentStats(undefined)).toBe('n/a')
  expect(agentStats({})).toBe('n/a')
  expect(agentStats(usageOf('claude-mystery-9', use(M)))).toBe('n/a')
})

// ---- band and status text ----

const full = () => statsView(apiKey({ isSubscription: true, usage: usageOf('claude-sonnet-4-5', use(1_200_000, 45_000)) }))
const statParts = (items: readonly BandItem[]) =>
  items.flatMap(x => (x.kind === 'stat' ? [x.part] : []))
const statItem = (items: readonly BandItem[], part: string) =>
  items.find((x): x is Extract<BandItem, { kind: 'stat' }> => x.kind === 'stat' && x.part === part)

test('010 the band carries the four stat parts after the task count and RED, before the agent and buttons (US3-2, FR-001, FR-003, FR-013)', () => {
  const b = board({ tasks: SLICE, red: 1 })
  const items = bandLayout(b, [{ type: 'implementer', startedAt: 0 }], 0, 220, full())
  expect(statParts(items)).toEqual(['context', 'tokens', 'cost', 'costbar'])
  expect(statItem(items, 'context')).toMatchObject({ text: '████░░░░ 50%', mark: '' })
  expect(statItem(items, 'tokens')?.text).toBe('1.2M in · 45k out')
  expect(statItem(items, 'cost')?.text).toBe('$2.50 est.')
  expect(statItem(items, 'costbar')).toMatchObject({ text: '█████░░░░░', mark: '' })
  const at = (pred: (x: BandItem) => boolean) => items.findIndex(pred)
  const first = at(x => x.kind === 'stat')
  expect(items[first - 1]).toEqual({ kind: 'sep', text: '│' })
  expect(at(x => x.kind === 'red')).toBeLessThan(first - 1)
  expect(at(x => x.kind === 'count')).toBeLessThan(first - 1)
  expect(at(x => x.kind === 'agent')).toBeGreaterThan(at(x => x.kind === 'stat' && x.part === 'costbar'))
  expect(at(x => x.kind === 'button')).toBeGreaterThan(at(x => x.kind === 'agent'))
  expect(widthOf(items)).toBeLessThanOrEqual(220)
})

test('010 band stat texts carry the mark as a word, and unknown figures read n/a with no cost bar (US1-2, US1-4, US2-7, US2-8, FR-002, FR-013)', () => {
  const b = board({ tasks: SLICE })
  const crit = bandLayout(b, [], 0, 220, statsView(apiKey({ percent: 96, usd: 4.75 })))
  expect(statItem(crit, 'context')).toMatchObject({ text: '████████ 96% critical', mark: 'critical' })
  expect(statItem(crit, 'costbar')).toMatchObject({ text: '█████████░ critical', mark: 'critical' })
  const high = bandLayout(b, [], 0, 220, statsView(apiKey({ percent: 85, usd: 4 })))
  expect(statItem(high, 'context')).toMatchObject({ text: '███████░ 85% high', mark: 'high' })
  expect(statItem(high, 'costbar')).toMatchObject({ text: '████████░░ high', mark: 'high' })
  const unknown = bandLayout(b, [], 0, 220, statsView(NO_STATS))
  expect(statItem(unknown, 'context')?.text).toBe('context n/a')
  expect(statItem(unknown, 'cost')?.text).toBe('cost n/a')
  expect(statParts(unknown)).toEqual(['context', 'tokens', 'cost'])
  const zero = bandLayout(b, [], 0, 220, statsView(apiKey({ percent: undefined, usd: 0 })))
  expect(statItem(zero, 'context')?.text).toBe('░░░░░░░░ 0%')
})

// contracts/stats-text.md "Band", D5, FR-008, SC-005.
test('010 the band sheds tokens, then the cost bar, then the cost, keeping the context longest and one row (FR-008, SC-005, D5)', () => {
  const ladder = [
    ['context', 'tokens', 'cost', 'costbar'], ['context', 'cost', 'costbar'], ['context', 'cost'], ['context'], [],
  ]
  for (const running of [[], [{ type: 'implementer', startedAt: 0 }]]) {
    const b = board({ tasks: SLICE, red: 1 })
    const narrowest = widthOf(bandLayout(b, running, 0, 30, full()))
    let rung = 0
    for (let cols = 220; cols >= 30; cols--) {
      const items = bandLayout(b, running, 0, cols, full())
      const parts = statParts(items)
      const at = ladder.findIndex(l => l.join() === parts.join())
      expect(at).toBeGreaterThanOrEqual(0)
      expect(at).toBeGreaterThanOrEqual(rung)
      rung = at
      if (cols >= narrowest) expect(widthOf(items)).toBeLessThanOrEqual(cols)
      expect(phaseTexts(items)).toContain('◐ build')
      expect(items.map(x => x.text)).toContain('RED 1/3')
    }
  }
  const b = board({ tasks: SLICE, red: 1 })
  for (const cols of [135, 100, 80, 60, 45]) {
    const items = bandLayout(b, [], 0, cols, full())
    expect(widthOf(items)).toBeLessThanOrEqual(cols)
    expect(statParts(items)).toContain('context')
    expect(phaseTexts(items)).toContain('◐ build')
  }
  // 60 columns: tokens gone, and the existing items still named.
  expect(statParts(bandLayout(b, [], 0, 60, full()))).not.toContain('tokens')
  expect(statParts(bandLayout(b, [], 0, 30, full()))).toEqual([])
  expect(bandLayout(b, [], 0, 135, full()).some(x => x.kind === 'button')).toBe(true)
})

test('010 the band shows the stats in standalone mode too (FR-009)', () => {
  const b = { ...board({ tasks: SLICE }), isStandalone: true }
  expect(statParts(bandLayout(b, [], 0, 220, full()))).toEqual(['context', 'tokens', 'cost', 'costbar'])
})

test('010 the status answer ends with a stats line equal to the band\'s four parts (US3-1, FR-005, FR-012)', () => {
  const b = board({ tasks: SLICE })
  const lines = boardText(b, [], 0, full()).split('\n')
  expect(lines).toHaveLength(4)
  expect(lines[3]).toBe('stats: ████░░░░ 50% 1.2M in · 45k out $2.50 est. █████░░░░░')
  const parts = bandLayout(b, [], 0, 400, full()).filter(x => x.kind === 'stat').map(x => x.text)
  expect(lines[3]).toBe(`stats: ${parts.join(' ')}`)
  // After next: and running:.
  const running = boardText(b, [{ type: 'implementer', startedAt: 0 }], 5_000, full()).split('\n')
  expect(running.at(-1)).toBe(lines[3])
  expect(running.at(-2)).toContain('running: implementer 5s')
  // Unknown figures.
  expect(boardText(b, [], 0, statsView(NO_STATS)).split('\n').at(-1)).toBe('stats: context n/a 0 in · 0 out cost n/a')
  // Standalone: still there.
  expect(boardText({ ...b, isStandalone: true }, [], 0, full()).split('\n').at(-1)).toBe(lines[3])
  // Without a view: as today.
  expect(boardText(b, [], 0).split('\n')).toHaveLength(3)
})
