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
  const runs = { n: 0, reads: 0 }
  on('process.run', (_$, e) => {
    runs.n++
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
    runs.reads++
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
  return { toasts, status, commands, opens, files, fp, clock, runs }
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
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
    // 004-board-clear FR-001: a `clear` button after `band` and before `close`.
    const buttons = await ui.findAll({ type: 'Button' })
    const keys = buttons.map(b => b.key)
    expect(keys.indexOf('clear')).toBe(keys.indexOf('band') + 1)
    expect(keys.indexOf('close')).toBe(keys.indexOf('clear') + 1)
    expect(buttons[keys.indexOf('clear')].props).toMatchObject({ label: 'clear', hotkey: 'c' })
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
  expect(seen.commands.find(c => c.name === 'speckit-board')).toMatchObject({ immediate: true, argumentHint: '[status|refresh|band|clear]' })
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
    .toMatchObject({ text: 'unknown argument "stauts": use status, refresh, band or clear.' })
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

// ---- 004-board-clear: the board's clear (slices 1 to 3) ----

// Registers pass-through agent handlers; the returned function runs n finished implementers (i1..in).
function finish($: Engine, on: On, n: number) {
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  return async () => {
    for (let k = 1; k <= n; k++) {
      await $.classic.SubagentStart({ agent_id: `i${k}`, agent_type: 'implementer' } as never)
      await $.classic.SubagentStop(stop(`i${k}`, 'implementer', 'RESULT: GREEN'))
    }
  }
}

const clearCmd = ($: Engine) => $.command.run({ command: 'speckit-board', args: 'clear' } as never)
const mountBand = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', cols = 135) =>
  $.ui.mount({ plugin: 'speckit-board', surface, ...BAND, ...band(cols) } as never)
const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'speckit-board', surface, ...PANE, ...pane } as never)

// Counts fs.write events (nothing else in world() answers them): a clear must raise none. Register
// it beside world(), before the first call on `$`. Store writes cannot be counted here: mock.store
// owns the store events; the mod writes the store only in its SubagentStop handler.
function recorders(on: On) {
  const counts = { 'fs.write': 0 }
  on('fs.write', ((_$: unknown, _e: unknown) => { counts['fs.write']++; return { value: undefined } }) as never)
  return counts
}

// Refuses writes to one of the mod's state keys once armed.
function denyState(on: On, key: string) {
  const gate = { isArmed: false }
  on('state.set', { plugin: 'speckit-board', key } as never, (_$: unknown, e: unknown, next: (e: unknown) => unknown) =>
    (gate.isArmed ? { deny: 'state is read-only' } : next(e)) as never)
  return gate
}

// FR-011, FR-002, FR-003, FR-012, US1-1, SC-001
test('/speckit-board clear removes the finished rows and the band, and raises no toast or status', async ($, on) => {
  const seen = await world(on)
  const run = finish($, on, 3)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  const toasts = seen.toasts.length
  const status = seen.status.length
  expect(await clearCmd($)).toMatchObject({ text: 'cleared 3 agent rows and the band.' })
  expect(seen.toasts).toHaveLength(toasts)
  expect(seen.status).toHaveLength(status)
  for (const surface of ['terminal', 'desktop'] as const) {
    const b = await mountBand($, surface)
    expect(await b.find({ type: 'Text', text: '◐ build' })).toBeUndefined()
    expect(await b.find({ type: 'Text', text: /◆ 001-x/ })).toBeUndefined()
    await b.unmount()
    const p = await mountPane($, surface)
    expect(await p.find({ type: 'Text', text: 'implementer' })).toBeUndefined()
    expect(await p.find({ type: 'Text', text: /earlier/ })).toBeUndefined()
    expect(await p.find({ type: 'Text', text: 'cleared; no team agent has run since' })).toBeDefined()
    await p.unmount()
  }
})

// FR-007, US2-2
test('/speckit-board after a clear opens the pane with the phases and the next step', async ($, on) => {
  const seen = await world(on)
  const run = finish($, on, 3)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  expect(await clearCmd($)).toMatchObject({ text: 'cleared 3 agent rows and the band.' })
  expect(await $.command.run({ command: 'speckit-board', args: '' } as never)).toMatchObject({ text: 'pane opened.' })
  expect(seen.opens.length).toBeGreaterThan(0)
  const p = await mountPane($)
  expect((await p.find({ type: 'Text', text: /^next / }))?.text).toBe('next T002 Test greet')
  expect((await around(p, 'audit')).after?.text).toBe('PASS')
  expect(await p.find({ type: 'Text', text: 'implementer' })).toBeUndefined()
  await p.unmount()
})

// FR-005, D1 A
test('/speckit-board clear keeps a running agent, its row and the band', async ($, on) => {
  await world(on)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 't1', agent_type: 'test-writer' } as never)
  for (const k of [1, 2]) {
    await $.classic.SubagentStart({ agent_id: `i${k}`, agent_type: 'implementer' } as never)
    await $.classic.SubagentStop(stop(`i${k}`, 'implementer', 'RESULT: GREEN'))
  }
  expect(await clearCmd($)).toMatchObject({ text: 'cleared 2 agent rows; 1 running agent kept.' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const p = await mountPane($, surface)
    expect((await around(p, 'test-writer')).after?.text).toBe('running')
    expect(await p.find({ type: 'Text', text: 'implementer' })).toBeUndefined()
    await p.unmount()
    const b = await mountBand($, surface)
    expect(await b.find({ type: 'Text', text: '◐ build' })).toBeDefined()
    expect(await b.find({ type: 'Text', text: /test-writer/ })).toBeDefined()
    await b.unmount()
  }
})

// US1-4, FR-008, SC-005
test('/speckit-board clear with no feature and no agents says there is nothing to clear, twice', async ($, on) => {
  const seen = await world(on)
  delete seen.files[`${ROOT}/.specify/feature.json`]
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(await clearCmd($)).toMatchObject({ text: 'nothing to clear.' })
  expect(await clearCmd($)).toMatchObject({ text: 'nothing to clear.' })
})

// US1-3 by command, SC-005
test('/speckit-board clear with the band already hidden clears the rows only, then has nothing to clear', async ($, on) => {
  await world(on)
  const run = finish($, on, 2)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  expect(await $.command.run({ command: 'speckit-board', args: 'band' } as never)).toMatchObject({ text: 'band hidden.' })
  expect(await clearCmd($)).toMatchObject({ text: 'cleared 2 agent rows.' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const b = await mountBand($, surface)
    expect(await b.find({ type: 'Text', text: '◐ build' })).toBeUndefined()
    expect(await b.find({ type: 'Button' })).toBeUndefined()
    await b.unmount()
  }
  expect(await clearCmd($)).toMatchObject({ text: 'nothing to clear.' })
})

// Edge Case "narrow": at 45 columns the band draws no button
test('/speckit-board clear clears a band too narrow to carry the button', async ($, on) => {
  await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const b = await mountBand($, 'terminal', 45)
  expect(await b.find({ type: 'Button' })).toBeUndefined()
  expect(await b.find({ type: 'Text', text: '◐ build' })).toBeDefined()
  expect(await clearCmd($)).toMatchObject({ text: 'cleared the band.' })
  expect(await b.find({ type: 'Text', text: '◐ build' })).toBeUndefined()
  await b.unmount()
})

// FR-009
test('/speckit-board clear answers as text in a headless session', async ($, on) => {
  await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  expect(await clearCmd($)).toMatchObject({ text: 'cleared the band.' })
})

// constitution III, research R5
test('/speckit-board clear says so when the state refuses the write', async ($, on) => {
  await world(on)
  const run = finish($, on, 1)
  const deny = denyState(on, 'agents')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  deny.isArmed = true
  const answer = (await clearCmd($)) as { text: string }
  expect(answer.text).toMatch(/^clear failed: .+\.$/)
})

// FR-004, US3-1, US3-2, SC-002, SC-003: clear is display-only, whatever state the gate is in
const RETRIES = (n: number) => (fp: string) => ({ retries: JSON.stringify({ fingerprint: fp, red: Array.from({ length: n }, (_, i) => `r${i}`) }) })
const CLEAR_STATES: [string, (fp: string) => { verdict?: string, retries?: string }][] = [
  ['PASS', fp => ({ verdict: JSON.stringify({ verdict: 'PASS', fingerprint: fp }) })],
  ['FAIL', fp => ({ verdict: JSON.stringify({ verdict: 'FAIL', fingerprint: fp }) })],
  ['stale PASS', () => ({ verdict: JSON.stringify({ verdict: 'PASS', fingerprint: 'stale' }) })],
  ...[0, 1, 2, 3].map(n => [`PASS with ${n} REDs`, RETRIES(n)] as [string, (fp: string) => { retries: string }]),
]
for (const [name, files] of CLEAR_STATES) {
  test(`clear changes no file or process, nor the status text: ${name}`, async ($, on) => {
    const seen = await world(on)
    const f = files(seen.fp)
    if (f.verdict) seen.files[`${ROOT}/.git/speckit-team/verdicts/001-x.json`] = f.verdict
    if (f.retries) seen.files[`${ROOT}/.git/speckit-team/retries/001-x.json`] = f.retries
    const run = finish($, on, 3)
    const counts = recorders(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await run()
    const before = JSON.stringify(seen.files)
      const statusBefore = (await $.command.run({ command: 'speckit-board', args: 'status' } as never)) as { text: string }
    const runs = seen.runs.n
    expect(await clearCmd($)).toMatchObject({ text: 'cleared 3 agent rows and the band.' })
    expect(counts['fs.write']).toBe(0)
    expect(seen.runs.n).toBe(runs)
      expect(JSON.stringify(seen.files)).toBe(before)
    const statusAfter = (await $.command.run({ command: 'speckit-board', args: 'status' } as never)) as { text: string }
    expect(statusAfter.text).toBe(statusBefore.text)
  })
}

// ---- slice 2: the pane's button ----

// FR-001, FR-004, FR-012, US1-3, SC-005, D3 A
test('the pane\'s clear button clears with one toast and changes nothing else', async ($, on) => {
  const seen = await world(on)
  const run = finish($, on, 3)
  const counts = recorders(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  await $.command.run({ command: 'speckit-board', args: 'band' } as never)
  const p = await mountPane($)
  const before = JSON.stringify(seen.files)
  const toasts = seen.toasts.length
  const status = seen.status.length
  const runs = seen.runs.n
  await p.press({ key: 'clear' })
  expect(seen.toasts.slice(toasts)).toEqual(['cleared 3 agent rows.'])
  expect(seen.status).toHaveLength(status)
  expect(await p.find({ type: 'Text', text: 'implementer' })).toBeUndefined()
  expect(counts['fs.write']).toBe(0)
  expect(seen.runs.n).toBe(runs)
  expect(JSON.stringify(seen.files)).toBe(before)
  const b = await mountBand($)
  expect(await b.find({ type: 'Text', text: '◐ build' })).toBeUndefined()
  await b.unmount()
  await p.press({ key: 'clear' })
  expect(seen.toasts.slice(toasts)).toEqual(['cleared 3 agent rows.', 'nothing to clear.'])
  await p.unmount()
})

test('the pane\'s clear button toasts a refused write', async ($, on) => {
  const seen = await world(on)
  const run = finish($, on, 1)
  const deny = denyState(on, 'agents')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  const p = await mountPane($)
  deny.isArmed = true
  const toasts = seen.toasts.length
  await p.press({ key: 'clear' })
  const added = seen.toasts.slice(toasts)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatch(/^clear failed: .+\.$/)
  await p.unmount()
})

// ---- slice 3: the band's button ----

// FR-001, SC-006 band, D3 A
test('the band draws a dim clear button', async ($, on) => {
  await world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const b = await mountBand($, surface)
    const button = (await b.findAll({ type: 'Button' })).find(x => x.key === 'clear')
    expect(button?.props).toMatchObject({ label: 'clear', dimColor: true })
    await b.unmount()
  }
})

// US1-2
test('the band\'s clear button clears the rows and the band with one toast', async ($, on) => {
  const seen = await world(on)
  const run = finish($, on, 2)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  const b = await mountBand($)
  const toasts = seen.toasts.length
  await b.press({ key: 'clear' })
  expect(seen.toasts.slice(toasts)).toEqual(['cleared 2 agent rows and the band.'])
  expect(await b.find({ type: 'Text', text: '◐ build' })).toBeUndefined()
  await b.unmount()
  const p = await mountPane($)
  expect(await p.find({ type: 'Text', text: 'implementer' })).toBeUndefined()
  await p.unmount()
})

// ---- slice 4: the next team agent ends the cleared state ----

// FR-006, US2-1, SC-004: the start event itself ends the clear, not the 4-second poll
test('the next team agent after a clear brings its row and the band back at its start event', async ($, on) => {
  await world(on)
  const run = finish($, on, 3)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  expect(await clearCmd($)).toMatchObject({ text: 'cleared 3 agent rows and the band.' })
  await $.classic.SubagentStart({ agent_id: 'a9', agent_type: 'spec-auditor' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const b = await mountBand($, surface)
    expect(await b.find({ type: 'Text', text: /◆ 001-x/ })).toBeDefined()
    await b.unmount()
    const p = await mountPane($, surface)
    const r = await around(p, 'spec-auditor')
    expect(r.after?.text).toBe('running')
    expect(await p.find({ type: 'Text', text: 'implementer' })).toBeUndefined()
    await p.unmount()
  }
})

// D4 A: the band argument and the pane's band button after a clear
test('after a clear the band toggle first shows the band, then hides, then shows', async ($, on) => {
  await world(on)
  const run = finish($, on, 3)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  await clearCmd($)
  const band$ = () => $.command.run({ command: 'speckit-board', args: 'band' } as never)
  const drawn = async () => {
    const b = await mountBand($)
    const found = await b.find({ type: 'Text', text: /◆ 001-x/ })
    await b.unmount()
    return found !== undefined
  }
  expect(await band$()).toMatchObject({ text: 'band shown.' })
  expect(await drawn()).toBe(true)
  expect(await band$()).toMatchObject({ text: 'band hidden.' })
  expect(await drawn()).toBe(false)
  expect(await band$()).toMatchObject({ text: 'band shown.' })
  expect(await drawn()).toBe(true)
  await clearCmd($)
  expect(await drawn()).toBe(false)
  const p = await mountPane($)
  await p.press({ key: 'band' })
  await p.unmount()
  expect(await drawn()).toBe(true)
})

// constitution III budget: the clear-ending write adds no fs.read or process.run to the start event
test('SubagentStart after a clear costs the same fs.read and process.run events as without one', async ($, on) => {
  const seen = await world(on)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const measure = async (id: string) => {
    const r0 = seen.runs.reads, p0 = seen.runs.n
    const res = await $.classic.SubagentStart({ agent_id: id, agent_type: 'implementer' } as never)
    expect(res).toEqual({})
    return [seen.runs.reads - r0, seen.runs.n - p0]
  }
  const first = await measure('x1')
  await $.classic.SubagentStop(stop('x1', 'implementer', 'RESULT: GREEN'))
  await clearCmd($)
  const second = await measure('x2')
  expect(second).toEqual(first)
})

// constitution III: a refused isCleared write is toasted and does not stop the start
test('SubagentStart after a clear toasts a refused isCleared write and goes on', async ($, on) => {
  const seen = await world(on)
  const run = finish($, on, 1)
  const deny = denyState(on, 'isCleared')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await run()
  await clearCmd($)
  deny.isArmed = true
  const toasts = seen.toasts.length
  expect(await $.classic.SubagentStart({ agent_id: 'n1', agent_type: 'implementer' } as never)).toEqual({})
  const p = await mountPane($)
  expect((await around(p, 'implementer')).after?.text).toBe('running')
  await p.unmount()
  const added = seen.toasts.slice(toasts).filter(t => /^board could not end the clear: /.test(t))
  expect(added).toHaveLength(1)
})
