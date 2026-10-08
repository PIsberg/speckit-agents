import { expect, test } from 'claude-code/testing'

import { derivePhases, featureDir, fingerprint, outcomeOf, parseTasks, redCount, teamRole } from '../hooks/model'
import type { BoardInputs } from '../hooks/model'

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
