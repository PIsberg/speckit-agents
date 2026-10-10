import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, CommandSpec, On, PaneOpenArgs } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { fingerprint, fingerprintFiles } from '../hooks/model'

// The runtime has it; the tsconfig Claude Code lays beside the mod loads no DOM or Node types.
declare function setTimeout(callback: (value?: unknown) => void, ms: number): unknown

const ROOT = '/repo'
// A second Spec Kit repo, with a feature of the same name.
const OTHER = '/other'
const FEATURE = 'specs/001-x'
const TASKS = '## Phase 1: Setup\n- [x] T001 Create package.json\n## Phase 2: Story\n- [ ] T002 [P] Test greet\n- [ ] T003 Implement greet\n'
const DONE = TASKS.replace(/- \[ \]/g, '- [x]')
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
  const commands: CommandSpec[] = []
  const opens: PaneOpenArgs[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  // git answers only inside a repo, as the real one does.
  on('process.run', (_$, e) => {
    const root = [ROOT, OTHER].find(r => posix(e.init?.cwd ?? '').startsWith(r))
    return { value: root
      ? { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
          stdout: e.argv.includes('--show-toplevel') ? `${root}\n` : `${root}/.git\n` }
      : { exitCode: 128, stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false, stdout: '' },
    }
  })
  on('fs.exists', (_$, e) => ({ value: [ROOT, OTHER].some(r => posix(e.path) === `${r}/.specify`) }))
  // A real read takes time. Without it here, tests that let the poll run passed on Windows and
  // Linux and failed only on the slower macOS runner in CI; with it, they fail on any machine.
  on('fs.read', async (_$, e) => {
    await new Promise(r => setTimeout(r, 5))
    const text = files[posix(e.path)]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('command.register', (_$, e) => { commands.push(e); return { value: { command: 'speckit-board' } } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // Stands for the engine's own band: empty.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.status', (_$, e) => { status.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { opens.push(e); return { value: { isPlaced: true } } })
  return { toasts, status, commands, opens, files, fp, clock }
}

// The poll runs off the clock unawaited, and advance() resolves once the event loop settles: on a
// slow runner (macOS in CI) that came before the poll's file reads were back. Moves the clock, then
// waits, bounded, until the board shows what the test expects; the assertion after it says if not.
async function poll(clock: MockClock, ms: number, isThere: () => boolean | Promise<boolean>) {
  await clock.advance(ms)
  for (let i = 0; i < 200 && !(await isThere()); i++) {
    await clock.settle()
    await new Promise(r => setTimeout(r, 10))
  }
}

// The engine hands fs hooks the platform's spelling (C:\repo\.specify on Windows).
const posix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const BAND = { component: 'AbovePrompt', requestId: 'band' } as const
const PANE = { component: 'Pane', requestId: 'speckit-board' } as const
const band = (bodyColumns = 135) => ({ viewport: { columns: 140, rows: 40 }, props: { hasSurvey: false, bodyColumns } })
const pane = { viewport: { columns: 140, rows: 40 }, props: { title: 'Spec Kit', isFocused: false, bodyColumns: 60, placement: 'dock' } }

type Drawn = { findAll: (query: { type?: string }) => Promise<{ text: string, props: Record<string, unknown> }[]> }

// The Texts drawn either side of the one that reads `text` exactly: a row's glyph before its name,
// its word or note after it, then the rest of the row.
async function around(ui: Drawn, text: string) {
  const texts = await ui.findAll({ type: 'Text' })
  const i = texts.findIndex(t => t.text === text)
  return { before: i > 0 ? texts[i - 1] : undefined, after: i < 0 ? undefined : texts[i + 1], then: i < 0 ? undefined : texts[i + 2] }
}

const stop = (id: string, type: string, report: string, isSecondStop = false) => ({
  agent_id: id, agent_type: type, stop_hook_active: isSecondStop, agent_transcript_path: '', last_assistant_message: report,
}) as never

test('the band shows the feature, every phase and the RED count', async ($, on) => {
  const seen = await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('001-x · ◐ build (1/3) · RED 1/3')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface, ...BAND, ...band() } as never)
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

// Below 100 columns, which a pane docked beside the transcript leaves, the band drew every phase as a
// bare glyph, and it never said which agent was at work.
test('the band names the current phase at any width, and the team agent at work', async ($, on) => {
  await world(on)
  on('classic.SubagentStart', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'implementer' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface, ...BAND, ...band(70) } as never)
    expect(await ui.find({ type: 'Text', text: '◐ build' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ spec' })).toBeUndefined()
    expect(await ui.findAll({ type: 'Text', text: /^✓$/ })).toHaveLength(4)
    expect((await ui.find({ type: 'Text', text: /implementer/ }))?.text).toBe('◐ implementer 0s')
    await ui.unmount()
  }
})

test('a stale audit closes the gate and says so', async ($, on) => {
  const seen = await world(on, { [`${ROOT}/.git/speckit-team/verdicts/001-x.json`]: JSON.stringify({ verdict: 'PASS', fingerprint: 'stale' }) })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('001-x · ↻ audit (edited since PASS) · 1/3 tasks · RED 1/3')
})

test('the pane lists the phases with their notes, the tasks by section, the retry meter and its controls', async ($, on) => {
  await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface, ...PANE, ...pane } as never)
    expect(await ui.find({ type: 'Text', text: 'SPEC KIT · 001-x' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^next / }))?.text).toBe('next T002 Test greet')
    expect((await around(ui, 'audit')).after?.text).toBe('PASS')
    expect((await around(ui, 'build')).then?.text).toBe('1/3')
    expect(await ui.find({ type: 'Text', text: 'Phase 2: Story' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /T002 \[P\] Test greet/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '●○○' }))?.props.color).toBe('warning')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
    await ui.unmount()
  }
})

// A real tasks.md has dozens of tasks: the pane listed every one, done or not, below the fold.
test('the pane folds finished task sections, marks the next task, and shows all on request', async ($, on) => {
  await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface, ...PANE, ...pane } as never)
    expect(await ui.find({ type: 'Text', text: 'Phase 1: Setup' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /T001/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^\s*▶ T002 \[P\] Test greet$/ })).toBeDefined()
    await ui.press({ key: 'tasks' })
    expect(await ui.find({ type: 'Text', text: /✓ T001 Create package.json$/ })).toBeDefined()
    await ui.press({ key: 'tasks' })
    expect(await ui.find({ type: 'Text', text: /T001/ })).toBeUndefined()
    await ui.unmount()
  }
})

// Opened inline above the prompt, a pane is a third of the terminal tall unless it asks: live, the
// buttons and every task were below its fold.
test('the pane asks for the rows it draws, and for more when it shows every task', async ($, on) => {
  const seen = await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(await $.command.run({ command: 'speckit-board', args: '' } as never)).toMatchObject({ text: 'pane opened.' })
  // Header 2, the six phases, the team title and its empty row, the buttons, and the sections:
  // Phase 1 folded, Phase 2 with its two tasks; a blank row between the five parts.
  expect(seen.opens.at(-1)).toMatchObject({ id: 'speckit-board', rows: 2 + 6 + 2 + 1 + 4 + 4 })
  const ui = await $.ui.mount({ plugin: 'speckit-board', surface: 'terminal', ...PANE, ...pane } as never)
  await ui.press({ key: 'tasks' })
  expect(seen.opens.at(-1)).toMatchObject({ id: 'speckit-board', rows: 2 + 6 + 2 + 1 + 5 + 4 })
  await ui.unmount()
})

// tasks.md is Markdown: the pane printed its backticks, and the next step its story tag, as they stand.
test('the pane draws a task\'s code as code and its story tag dim', async ($, on) => {
  const tasks = TASKS.replace('T002 [P] Test greet', 'T002 [US1] Test `greet(name)` in `test/greet.test.mjs`')
  const seen = await world(on, { [`${ROOT}/${FEATURE}/tasks.md`]: tasks })
  // Other tasks than the audit passed: pass these.
  const fp = await fingerprint(fingerprintFiles(FEATURE).map(path => ({ path, text: path.endsWith('tasks.md') ? tasks : SPEC_FILES[path] ?? '<missing>' })))
  seen.files[`${ROOT}/.git/speckit-team/verdicts/001-x.json`] = JSON.stringify({ verdict: 'PASS', fingerprint: fp })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface, ...PANE, ...pane } as never)
    expect((await ui.find({ type: 'Text', text: /^next / }))?.text).toBe('next T002 [US1] Test greet(name) in test/greet.test.mjs')
    expect(await ui.find({ type: 'Text', text: /^\s*▶ T002 \[US1\] Test greet\(name\) in test\/greet\.test\.mjs$/ })).toBeDefined()
    // A string matches inside the lines too; the anchored pattern only the code itself.
    expect((await ui.findAll({ type: 'Text', text: /^greet\(name\)$/ })).map(t => t.props.color)).toEqual(['permission', 'permission'])
    expect((await ui.findAll({ type: 'Text', text: /^\[US1\] $/ })).map(t => t.props.dimColor)).toEqual([true, true])
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
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface, ...PANE, ...pane } as never)
    const drawn = await ui.findAll({})
    const at = (match: (el: { type: string, key: string | undefined, text?: string }) => boolean) => drawn.findIndex(match)
    const firstTask = at(el => el.type === 'Text' && el.text === 'Phase 1: Setup')
    expect(firstTask).toBeGreaterThan(-1)
    expect(at(el => el.type === 'Text' && el.text === 'spec-auditor')).toBeLessThan(firstTask)
    expect(at(el => el.type === 'Button' && el.key === 'close')).toBeLessThan(firstTask)
    await ui.unmount()
  }
})

// A test-writer's RED is its job done and an implementer's a failed attempt: the pane drew both, and
// a killed agent, with the same green tick, and never said what an agent had been asked to do.
test('the team rows say what each agent was asked and whether its word is good for its role', async ($, on) => {
  await world(on)
  on('agent.list', () => ({ value: [
    { id: 't1', type: 'test-writer', description: 'Red tests for T002', status: 'running' },
    { id: 'i1', type: 'implementer', description: 'Green T003 greet', status: 'running' },
  ] satisfies AgentInfo[] }))
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 't1', agent_type: 'test-writer' } as never)
  await $.classic.SubagentStart({ agent_id: 'i1', agent_type: 'implementer' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface, ...PANE, ...pane } as never)
    const running = await around(ui, 'test-writer')
    expect(running.after?.text).toBe('running')
    expect(running.then?.text).toBe('0s · Red tests for T002')
    await ui.unmount()
  }
  await $.classic.SubagentStop(stop('t1', 'test-writer', 'T002 fails on the stub\n\nRED'))
  await $.classic.SubagentStop(stop('i1', 'implementer', 'greet still throws\nRESULT: RED'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface, ...PANE, ...pane } as never)
    const red = await around(ui, 'test-writer')
    // The tick says test-writer's job is done; the word RED itself is always drawn red (#71).
    expect([red.before?.text, red.before?.props.color, red.after?.text, red.after?.props.color]).toEqual(['✓', 'success', 'RED', 'error'])
    const failed = await around(ui, 'implementer')
    expect([failed.before?.text, failed.before?.props.color, failed.after?.text, failed.after?.props.color]).toEqual(['✗', 'error', 'RED', 'error'])
    expect(failed.then?.text).toBe('took 0s · 0s ago · Green T003 greet')
    await ui.unmount()
  }
})

// A pipeline launches a dozen agents or more, and the pane listed every one above the tasks.
test('the team rows show the latest six agents and count the rest', async ($, on) => {
  await world(on)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 8; n++) {
    await $.classic.SubagentStart({ agent_id: `i${n}`, agent_type: 'implementer' } as never)
    await $.classic.SubagentStop(stop(`i${n}`, 'implementer', 'RESULT: GREEN'))
  }
  const ui = await $.ui.mount({ plugin: 'speckit-board', surface: 'terminal', ...PANE, ...pane } as never)
  expect(await ui.findAll({ type: 'Text', text: 'implementer' })).toHaveLength(6)
  expect(await ui.find({ type: 'Text', text: '+2 earlier' })).toBeDefined()
  await ui.unmount()
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
  await $.classic.SubagentStop(stop('a1', 'spec-auditor', ''))
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
  const blocked = await $.classic.SubagentStop(stop('a1', 'spec-auditor', 'findings, no verdict yet'))
  expect(blocked?.block).toMatch(/VERDICT/)
  expect(seen.toasts.filter(t => t.startsWith('spec-auditor finished'))).toEqual([])
  expect(seen.status.at(-1)).toBe('001-x · ◐ audit · 1/3 tasks · RED 1/3')
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
  await $.classic.SubagentStop(stop('a1', 'spec-auditor', 'VERDICT: PASS'))
  expect(seen.toasts).toContain('spec-auditor finished: PASS')
  expect(seen.toasts).toContain('Audit PASS: the implementation gate is open')
  expect(seen.status.at(-1)).toBe('001-x · ◐ build (1/3) · RED 1/3')
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
  await $.classic.SubagentStop(stop('a1', 'spec-auditor', 'VERDICT: PASS'))
  const ui = await $.ui.mount({ plugin: 'speckit-board', surface: 'terminal', ...PANE, ...pane } as never)
  const age = async () => (await ui.find({ type: 'Text', text: /ago$/ }))?.text
  expect(await age()).toBe('took 0s · 0s ago')
  await poll(seen.clock, 120_000, async () => (await age()) === 'took 0s · 2m 0s ago')
  expect(await age()).toBe('took 0s · 2m 0s ago')
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
    await poll(seen.clock, 4000, () => true)
    expect(seen.status.at(-1)).toBe('001-x · ◐ audit · 1/3 tasks · RED 1/3')
    listed = [{ id: 'a1', type: 'spec-auditor', description: 'audit', status }]
    const ended = '001-x · ○ audit · 1/3 tasks · RED 1/3'
    await poll(seen.clock, 4000, () => seen.status.at(-1) === ended)
    expect(seen.status.at(-1)).toBe(ended)
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface: 'terminal', ...PANE, ...pane } as never)
    const row = await around(ui, 'spec-auditor')
    expect([row.before?.text, row.after?.text, row.after?.props.color]).toEqual(['✗', status, 'error'])
    expect(row.then?.text).toBe('took 8s · 0s ago · audit')
    await ui.unmount()
  })
}

// The ends check lets a second stop through without a word and records nothing. The board took
// "approved" from anywhere in that report, kept it as the gatekeeper's word and showed verify done.
test('a gatekeeper report without its word does not approve', async ($, on) => {
  const seen = await world(on, { [`${ROOT}/${FEATURE}/tasks.md`]: DONE })
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'g1', agent_type: 'spec-gatekeeper' } as never)
  await $.classic.SubagentStop(stop('g1', 'spec-gatekeeper', 'Not approved: T004 has no test.\n\nNext: add the test', true))
  expect(seen.toasts).toContain('spec-gatekeeper finished')
  expect(seen.toasts).not.toContain('spec-gatekeeper APPROVED: ready for the PR')
  expect(seen.status.at(-1)).toBe('001-x · ○ verify · 3/3 tasks · RED 1/3')
})

const verifyOn = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'speckit-board', surface: 'terminal', ...BAND, ...band() } as never)
  const text = (await ui.find({ type: 'Text', text: /verify$/ }))?.text
  await ui.unmount()
  return text
}

// The plugin store is the user's, for every repo, and kept the gatekeeper's word under the feature's
// path alone: live, a scratch repo where no gatekeeper had run showed verify done, from an APPROVED
// given in another repo with a feature of the same name.
test('a gatekeeper word the board kept counts only in the repo it was given in', async ($, on) => {
  const seen = await world(on, { [`${ROOT}/${FEATURE}/tasks.md`]: DONE })
  Object.assign(seen.files, {
    [`${OTHER}/.specify/feature.json`]: JSON.stringify({ feature_directory: FEATURE }),
    ...Object.fromEntries(Object.entries(SPEC_FILES).map(([p, t]) => [`${OTHER}/${p}`, p.endsWith('tasks.md') ? DONE : t])),
    [`${OTHER}/.git/speckit-team/verdicts/001-x.json`]: JSON.stringify({ verdict: 'PASS', fingerprint: seen.fp }),
  })
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'g1', agent_type: 'spec-gatekeeper' } as never)
  await $.classic.SubagentStop(stop('g1', 'spec-gatekeeper', 'Every requirement has a test.\n\nAPPROVED'))
  expect(await verifyOn($)).toBe('✓ verify')
  await $.session.start({ cwd: OTHER, surface: 'terminal', isInteractive: true })
  expect(await verifyOn($)).toBe('○ verify')
})

// The kept word had no time, so a later audit, which voids it as it voids the hook's own record, left
// verify showing done.
test('a gatekeeper word the board kept goes stale once a later audit passes', async ($, on) => {
  const seen = await world(on, { [`${ROOT}/${FEATURE}/tasks.md`]: DONE })
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'g1', agent_type: 'spec-gatekeeper' } as never)
  await $.classic.SubagentStop(stop('g1', 'spec-gatekeeper', 'Every requirement has a test.\n\nAPPROVED'))
  expect(await verifyOn($)).toBe('✓ verify')
  seen.files[`${ROOT}/.git/speckit-team/verdicts/001-x.json`] = JSON.stringify({ verdict: 'PASS', fingerprint: seen.fp, at: '2026-10-08T12:00:00.000Z' })
  await $.command.run({ command: 'speckit-board', args: 'refresh' } as never)
  expect(await verifyOn($)).toBe('↻ verify')
})

// After a FAIL the architect revises the plan. The board kept showing the old FAIL as failed, on files
// nobody had audited yet; what they want is the next audit.
test('revising the files after a FAIL asks for a re-audit', async ($, on) => {
  const seen = await world(on)
  seen.files[`${ROOT}/.git/speckit-team/verdicts/001-x.json`] = JSON.stringify({ verdict: 'FAIL', fingerprint: seen.fp })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('001-x · ✗ audit (FAIL) · 1/3 tasks · RED 1/3')
  seen.files[`${ROOT}/${FEATURE}/plan.md`] = '# Plan, revised'
  // The revision also starts the RED count over, as the hook's does.
  const stale = '001-x · ↻ audit (edited since FAIL) · 1/3 tasks'
  await poll(seen.clock, 4000, () => seen.status.at(-1) === stale)
  expect(seen.status.at(-1)).toBe(stale)
  expect(seen.toasts).toContain('Spec, plan or tasks changed since FAIL: re-audit before building')
})

// The gate denies implementer while the retry record cannot be read; the board said "no REDs".
test('an unreadable retry record shows the build stopped', async ($, on) => {
  const seen = await world(on, { [`${ROOT}/.git/speckit-team/retries/001-x.json`]: '{"red": [' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('001-x · ✗ build (retry record unreadable) · 1/3 tasks')
  const ui = await $.ui.mount({ plugin: 'speckit-board', surface: 'terminal', ...PANE, ...pane } as never)
  expect(await ui.find({ type: 'Text', text: /^retry record unreadable/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^next / }))?.text).toBe('next delete .git/speckit-team/retries/001-x.json')
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
      [`${ROOT}/${FEATURE}/tasks.md`]: DONE,
      [`${ROOT}/.git/speckit-team/ends/001-x.json`]: JSON.stringify({ word, feature: FEATURE }),
    })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'speckit-board', surface: 'terminal', ...BAND, ...band() } as never)
    expect((await ui.find({ type: 'Text', text: `${glyph} verify` }))?.props.color).toBe(color)
    await ui.unmount()
  })
}

// /speckit-team launches its agents in the foreground, so a whole pipeline is one turn, and a command
// typed during a turn waited for it to end: /speckit-board opened the board only once the run was over.
test('/speckit-board is registered to run at once, during a turn', async ($, on) => {
  const seen = await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.commands.find(c => c.name === 'speckit-board')).toMatchObject({ immediate: true, argumentHint: '[status|refresh|band]' })
})

test('/speckit-board status answers with the board as text', async ($, on) => {
  await world(on)
  on('classic.SubagentStart', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'implementer' } as never)
  expect(await $.command.run({ command: 'speckit-board', args: 'status' } as never)).toMatchObject({
    text: '001-x · ◐ build (1/3) · RED 1/3\n✓ spec ✓ plan ✓ tasks ✓ audit ◐ build ○ verify\nnext: T002 Test greet\nrunning: implementer 0s',
  })
})

// Any argument but refresh and band opened the pane, so a typo looked like it had worked.
test('an unknown argument says which ones there are', async ($, on) => {
  await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(await $.command.run({ command: 'speckit-board', args: 'stauts' } as never))
    .toMatchObject({ text: 'unknown argument "stauts": use status, refresh or band.' })
})

// The board follows .specify/feature.json. When a new feature became the active one, the old board
// was replaced without a word.
test('a switch of the active feature says which one the board follows now', async ($, on) => {
  const seen = await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  seen.files[`${ROOT}/.specify/feature.json`] = JSON.stringify({ feature_directory: 'specs/002-y' })
  seen.files[`${ROOT}/specs/002-y/spec.md`] = '**Status**: Draft'
  await $.command.run({ command: 'speckit-board', args: 'refresh' } as never)
  expect(seen.toasts).toContain('002-y is the active feature now')
  expect(seen.status.at(-1)).toBe('002-y · ◐ spec (draft)')
})
