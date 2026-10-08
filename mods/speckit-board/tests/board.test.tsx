import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

import { fingerprint, fingerprintFiles } from '../hooks/model'

const ROOT = '/repo'
const FEATURE = 'specs/001-x'
const TASKS = '## Phase 1: Setup\n- [x] T001 Create package.json\n## Phase 2: Story\n- [ ] T002 [P] Test greet\n- [ ] T003 Implement greet\n'
const SPEC_FILES: Record<string, string> = {
  '.specify/memory/constitution.md': '# Rules',
  [`${FEATURE}/spec.md`]: '**Status**: Approved',
  [`${FEATURE}/plan.md`]: '# Plan',
  [`${FEATURE}/tasks.md`]: TASKS,
}

async function world(on: On, extra: Record<string, string> = {}) {
  const fp = await fingerprint(fingerprintFiles(FEATURE).map(path => ({ path, text: SPEC_FILES[path] ?? '<missing>' })))
  const files: Record<string, string> = {
    [`${ROOT}/.specify/feature.json`]: JSON.stringify({ feature_directory: FEATURE }),
    ...Object.fromEntries(Object.entries(SPEC_FILES).map(([p, t]) => [`${ROOT}/${p}`, t])),
    [`${ROOT}/.git/speckit-team/verdicts/001-x.json`]: JSON.stringify({ verdict: 'PASS', fingerprint: fp }),
    [`${ROOT}/.git/speckit-team/retries/001-x.json`]: JSON.stringify({ fingerprint: fp, red: ['a1'] }),
    ...extra,
  }
  const toasts: string[] = []
  const status: (string | undefined)[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  // git answers only inside the repo, as the real one does.
  on('process.run', (_$, e) => ({ value: posix(e.init?.cwd ?? '').startsWith(ROOT)
    ? { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
        stdout: e.argv.includes('--show-toplevel') ? `${ROOT}\n` : `${ROOT}/.git\n` }
    : { exitCode: 128, stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false, stdout: '' },
  }))
  on('fs.exists', (_$, e) => ({ value: posix(e.path) === `${ROOT}/.specify` }))
  on('fs.read', (_$, e) => {
    const text = files[posix(e.path)]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('command.register', () => ({ value: { command: 'speckit-board' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // Stands for the engine's own band: empty.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.status', (_$, e) => { status.push(e.text); return { value: undefined } })
  return { toasts, status, files, fp, clock }
}

// The engine hands fs hooks the platform's spelling (C:\repo\.specify on Windows).
const posix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const BAND = { component: 'AbovePrompt', requestId: 'band' } as const

test('the band shows the feature, every phase and the RED count', async ($, on) => {
  const seen = await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('speckit 001-x · ◐ build (1/3) · 1/3 tasks · RED 1/3')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'speckit-board', surface, ...BAND,
      viewport: { columns: 140, rows: 40 },
      props: { hasSurvey: false, bodyColumns: 135 },
    } as never)
    expect((await ui.find({ type: 'Text', text: '✓ audit' }))?.text).toBe('✓ audit')
    expect((await ui.find({ type: 'Text', text: '◐ build' }))?.props.color).toBe('claude')
    expect((await ui.find({ type: 'Text', text: 'RED 1/3' }))?.props.color).toBe('warning')
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Text', text: 'RED 1/3' })).toBeUndefined()
    const shown = await $.command.run({ command: 'speckit-board', args: 'band' } as never)
    // Claude Code puts the plugin's name before a command's answer itself.
    expect(shown).toMatchObject({ text: 'band shown.' })
    expect(await ui.find({ type: 'Text', text: 'RED 1/3' })).toBeDefined()
    await ui.unmount()
  }
})

test('a stale audit closes the gate and says so', async ($, on) => {
  const seen = await world(on, { [`${ROOT}/.git/speckit-team/verdicts/001-x.json`]: JSON.stringify({ verdict: 'PASS', fingerprint: 'stale' }) })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('speckit 001-x · ↻ audit (edited since PASS) · 1/3 tasks · RED 1/3')
})

test('the pane lists tasks by phase, the retry meter and its controls', async ($, on) => {
  await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'speckit-board', surface, component: 'Pane', requestId: 'speckit-board',
      viewport: { columns: 140, rows: 40 },
      props: { title: 'Spec Kit', isFocused: false, bodyColumns: 60, placement: 'dock' },
    } as never)
    expect(await ui.find({ type: 'Text', text: 'SPEC KIT · 001-x' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Phase 2: Story' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /T002 \[P\] Test greet/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '●○○' }))?.props.color).toBe('warning')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
    await ui.unmount()
  }
})

// A pane taller than the terminal is cut off at the bottom. In a live session the Team rows and the
// buttons, drawn after six tasks, were already out of view; a real feature has dozens of tasks.
// The live parts come first and the task list, the longest, last.
test('the pane puts the running team agent and its controls before the task list', async ($, on) => {
  await world(on)
  on('classic.SubagentStart', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'spec-auditor' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'speckit-board', surface, component: 'Pane', requestId: 'speckit-board',
      viewport: { columns: 140, rows: 40 },
      props: { title: 'Spec Kit', isFocused: false, bodyColumns: 60, placement: 'dock' },
    } as never)
    const drawn = await ui.findAll({})
    const at = (match: (el: { type: string, key: string | undefined, text?: string }) => boolean) => drawn.findIndex(match)
    const firstTask = at(el => el.type === 'Text' && el.text === 'Phase 1: Setup')
    expect(firstTask).toBeGreaterThan(-1)
    expect(at(el => el.type === 'Text' && el.text === 'spec-auditor')).toBeLessThan(firstTask)
    expect(at(el => el.type === 'Button' && el.key === 'close')).toBeLessThan(firstTask)
    await ui.unmount()
  }
})

// A backgrounded agent (how an interactive session runs an @-mentioned one) reports through the
// SubagentHandback tool. Its last message is that call, so SubagentStop carries no report: live,
// the pane said "done" for a spec-auditor that had handed back VERDICT: PASS.
test('an agent that reports through SubagentHandback gets its outcome from the report', async ($, on) => {
  const seen = await world(on)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('tool.call', { tool: 'SubagentHandback' }, () => ({ result: 'delivered' }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'spec-auditor' } as never)
  await $.tool.call({ tool: 'SubagentHandback', agentId: 'a1', message: 'Findings ...\n\nVERDICT: PASS' } as never)
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'spec-auditor', stop_hook_active: false,
    agent_transcript_path: '', last_assistant_message: '' } as never)
  expect(seen.toasts).toContain('spec-auditor finished: PASS')
})

// The team's stop checks are settings hooks, beneath every mod. One that blocks sends the agent back
// to work: the board said it had finished, stopped its spinner and set the audit back to todo while
// it still ran.
test('an agent whose stop the team hook blocks still shows running', async ($, on) => {
  const seen = await world(on)
  delete seen.files[`${ROOT}/.git/speckit-team/verdicts/001-x.json`]
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({ block: 'End your report with a final line that is exactly `VERDICT: PASS` or `VERDICT: FAIL`.' }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'spec-auditor' } as never)
  const stop = await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'spec-auditor', stop_hook_active: false,
    agent_transcript_path: '', last_assistant_message: 'findings, no verdict yet' } as never)
  expect(stop?.block).toMatch(/VERDICT/)
  expect(seen.toasts.filter(t => t.startsWith('spec-auditor finished'))).toEqual([])
  expect(seen.status.at(-1)).toBe('speckit 001-x · ◐ audit · 1/3 tasks · RED 1/3')
})

// The verdict hook records the audit as the agent stops, beneath the mod: read before it ran, the
// board showed the old audit until the next poll, after the agent's own "finished: PASS" toast.
test('the verdict recorded as the auditor stops shows at once', async ($, on) => {
  const seen = await world(on)
  const verdict = `${ROOT}/.git/speckit-team/verdicts/001-x.json`
  delete seen.files[verdict]
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => {
    seen.files[verdict] = JSON.stringify({ verdict: 'PASS', fingerprint: seen.fp })
    return {}
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'spec-auditor' } as never)
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'spec-auditor', stop_hook_active: false,
    agent_transcript_path: '', last_assistant_message: 'VERDICT: PASS' } as never)
  expect(seen.toasts).toContain('spec-auditor finished: PASS')
  expect(seen.toasts).toContain('Audit PASS: the implementation gate is open')
  expect(seen.status.at(-1)).toBe('speckit 001-x · ◐ build (1/3) · 1/3 tasks · RED 1/3')
})

// The poll, a turn's end and an agent's start or stop each refresh. A refresh in one event read the
// board as it was before the others wrote it, so a change was announced once per event.
test('a change seen by refreshes in several events is announced once', async ($, on) => {
  const seen = await world(on)
  const verdict = `${ROOT}/.git/speckit-team/verdicts/001-x.json`
  delete seen.files[verdict]
  on('classic.SubagentStart', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  seen.files[verdict] = JSON.stringify({ verdict: 'PASS', fingerprint: seen.fp })
  await Promise.all([
    $.command.run({ command: 'speckit-board', args: 'refresh' } as never),
    $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'test-writer' } as never),
    $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'implementer' } as never),
  ])
  expect(seen.toasts.filter(t => t.startsWith('Audit PASS'))).toHaveLength(1)
})

// The clock redrew the pane only while an agent ran, so the last agent to stop kept "0s ago" for good.
test('a finished agent\'s age keeps counting', async ($, on) => {
  const seen = await world(on)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'spec-auditor' } as never)
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'spec-auditor', stop_hook_active: false,
    agent_transcript_path: '', last_assistant_message: 'VERDICT: PASS' } as never)
  const ui = await $.ui.mount({
    plugin: 'speckit-board', surface: 'terminal', component: 'Pane', requestId: 'speckit-board',
    viewport: { columns: 140, rows: 40 },
    props: { title: 'Spec Kit', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as never)
  expect((await ui.find({ type: 'Text', text: /ago$/ }))?.text).toBe('PASS · 0s ago')
  await seen.clock.advance(120_000)
  expect((await ui.find({ type: 'Text', text: /ago$/ }))?.text).toBe('PASS · 2m 0s ago')
  await ui.unmount()
})

// The board learned of an agent's end only from SubagentStop. One that is stopped or fails ends
// without a report, and its row and phase stayed running for the rest of the session.
for (const status of ['killed', 'failed'] as const) {
  test(`an agent the engine lists as ${status} stops running on the board`, async ($, on) => {
    const seen = await world(on)
    delete seen.files[`${ROOT}/.git/speckit-team/verdicts/001-x.json`]
    let listed: AgentInfo[] = []
    on('agent.list', () => ({ value: listed }))
    on('classic.SubagentStart', () => ({}))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'spec-auditor' } as never)
    listed = [{ id: 'a1', type: 'spec-auditor', description: 'audit', status: 'running' }]
    await seen.clock.advance(4000)
    expect(seen.status.at(-1)).toBe('speckit 001-x · ◐ audit · 1/3 tasks · RED 1/3')
    listed = [{ id: 'a1', type: 'spec-auditor', description: 'audit', status }]
    await seen.clock.advance(4000)
    expect(seen.status.at(-1)).toBe('speckit 001-x · ○ audit · 1/3 tasks · RED 1/3')
    const ui = await $.ui.mount({
      plugin: 'speckit-board', surface: 'terminal', component: 'Pane', requestId: 'speckit-board',
      viewport: { columns: 140, rows: 40 },
      props: { title: 'Spec Kit', isFocused: false, bodyColumns: 60, placement: 'dock' },
    } as never)
    expect((await ui.find({ type: 'Text', text: /ago$/ }))?.text).toBe(`${status} · 0s ago`)
    await ui.unmount()
  })
}

// After a FAIL the architect revises the plan. The board kept showing the old FAIL as failed, on files
// nobody had audited yet; what they want is the next audit.
test('revising the files after a FAIL asks for a re-audit', async ($, on) => {
  const seen = await world(on)
  seen.files[`${ROOT}/.git/speckit-team/verdicts/001-x.json`] = JSON.stringify({ verdict: 'FAIL', fingerprint: seen.fp })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('speckit 001-x · ✗ audit (FAIL) · 1/3 tasks · RED 1/3')
  seen.files[`${ROOT}/${FEATURE}/plan.md`] = '# Plan, revised'
  await seen.clock.advance(4000)
  // The revision also starts the RED count over, as the hook's does.
  expect(seen.status.at(-1)).toBe('speckit 001-x · ↻ audit (edited since FAIL) · 1/3 tasks')
  expect(seen.toasts).toContain('Spec, plan or tasks changed since FAIL: re-audit before building')
})

// The gate denies implementer while the retry record cannot be read; the board said "no REDs".
test('an unreadable retry record shows the build stopped', async ($, on) => {
  const seen = await world(on, { [`${ROOT}/.git/speckit-team/retries/001-x.json`]: '{"red": [' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('speckit 001-x · ✗ build (retry record unreadable) · 1/3 tasks')
  const ui = await $.ui.mount({
    plugin: 'speckit-board', surface: 'terminal', component: 'Pane', requestId: 'speckit-board',
    viewport: { columns: 140, rows: 40 },
    props: { title: 'Spec Kit', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as never)
  expect(await ui.find({ type: 'Text', text: /^retry record unreadable/ })).toBeDefined()
  await ui.unmount()
})

test('outside a Spec Kit repo it says it loaded and found nothing', async ($, on) => {
  const seen = await world(on)
  await $.session.start({ cwd: '/elsewhere', surface: 'terminal', isInteractive: true })
  // The terminal names the plugin before a toast itself.
  expect(seen.toasts.at(-1)).toBe('no .specify/ in the git repo at /elsewhere; nothing to show')
})

// The board saw no agent stop here: the gatekeeper's word comes only from the file the hook wrote.
for (const [word, glyph, color] of [['APPROVED', '✓', 'success'], ['REJECTED', '✗', 'error']] as const) {
  test(`the verify step shows a recorded ${word} without seeing the agent stop`, async ($, on) => {
    await world(on, {
      [`${ROOT}/${FEATURE}/tasks.md`]: TASKS.replace(/- \[ \]/g, '- [x]'),
      [`${ROOT}/.git/speckit-team/ends/001-x.json`]: JSON.stringify({ word, feature: FEATURE }),
    })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({
      plugin: 'speckit-board', surface: 'terminal', ...BAND,
      viewport: { columns: 140, rows: 40 },
      props: { hasSurvey: false, bodyColumns: 135 },
    } as never)
    expect((await ui.find({ type: 'Text', text: `${glyph} verify` }))?.props.color).toBe(color)
    await ui.unmount()
  })
}
