import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SpeckitAgent, SpeckitBoard, SpeckitPhase } from '../types'
import {
  COLOR, GLYPH, MAX_RED, MISSING, SPINNER, bar, current, derivePhases, fingerprint,
  fingerprintFiles, outcomeOf, parseTasks, redCount, since, teamRole,
} from './model'

const PANE = 'speckit-board'
const POLL_MS = 4000

const board = atom({ plugin: 'speckit-board', key: 'board' } as const, null)
const agents = atom({ plugin: 'speckit-board', key: 'agents' } as const, [])
const isBandHidden = atom({ plugin: 'speckit-board', key: 'isBandHidden' } as const, false)

type Repo = { root: string; stateDir: string }

// Found again on every load: a reload starts module variables over.
let repo: Repo | null = null
let ticker: { cancel: () => void } | null = null

function readText($: EngineInterface, path: string): Promise<string | undefined> {
  return $.fs.read(path).catch(() => undefined)
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  const text = await readText($, path)
  if (text === undefined) return undefined
  try { return JSON.parse(text) } catch { return null }
}

async function findRepo($: EngineInterface, cwd: string): Promise<Repo | null> {
  const git = (...args: string[]) => $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
    .then(r => (r.exitCode === 0 ? r.stdout.trim() : ''))
    .catch(() => '')
  const root = await git('rev-parse', '--show-toplevel')
  if (!root || !(await $.fs.exists(`${root}/.specify`).catch(() => false))) return null
  const common = await git('rev-parse', '--path-format=absolute', '--git-common-dir')
  return common ? { root, stateDir: `${common}/speckit-team` } : null
}

async function snapshot($: EngineInterface, at: Repo): Promise<SpeckitBoard | null> {
  const meta = await readJson($, `${at.root}/.specify/feature.json`)
  const feature = meta && typeof meta === 'object' && 'feature_directory' in meta
    ? String(meta.feature_directory) : ''
  if (!feature) return null
  const name = feature.split('/').pop() ?? feature

  const files = await Promise.all(fingerprintFiles(feature).map(async path =>
    ({ path, text: (await readText($, `${at.root}/${path}`)) ?? MISSING })))
  const fp = await fingerprint(files)
  const text = (i: number) => (files[i]?.text === MISSING ? undefined : files[i]?.text)
  const tasksMd = text(3)
  const tasks = tasksMd === undefined ? undefined : parseTasks(tasksMd)

  const verdict = await readJson($, `${at.stateDir}/verdicts/${name}.json`) as Parameters<typeof derivePhases>[0]['verdict']
  const retries = await readJson($, `${at.stateDir}/retries/${name}.json`) as Parameters<typeof redCount>[0]
  const red = redCount(retries, fp)
  const gate = await $.store.get(`gate:${feature}`)
  const running = (await read($, agents)).filter(a => a.isRunning).map(a => a.type)

  return {
    feature: name,
    phases: derivePhases({
      spec: text(1), plan: text(2), tasks, verdict, fingerprint: fp, red,
      gate: typeof gate === 'string' ? gate : undefined, running,
    }),
    tasks: tasks ?? [],
    red,
    maxRed: MAX_RED,
    fingerprint: fp,
  }
}

function announce($: EngineInterface, before: SpeckitBoard | null, after: SpeckitBoard) {
  if (!before || before.feature !== after.feature) return
  const was = (id: SpeckitPhase['id']) => before.phases.find(p => p.id === id)
  for (const p of after.phases) {
    const old = was(p.id)
    if (!old || old.state === p.state) continue
    if (p.id === 'audit' && p.state === 'done') $.ui.toast('Audit PASS: the implementation gate is open')
    if (p.id === 'audit' && p.state === 'failed') $.ui.toast(`Audit ${p.note}: route CRITICAL/HIGH findings to their owners`)
    if (p.id === 'audit' && p.state === 'stale') $.ui.toast('Spec, plan or tasks changed after the PASS: re-audit before building')
    if (p.id === 'build' && p.state === 'failed') $.ui.toast(`RED ${after.red} of ${after.maxRed}: retry limit reached`)
    if (p.id === 'build' && p.state === 'done') $.ui.toast(`All ${after.tasks.length} tasks done`)
    if (p.id === 'verify' && p.state === 'done') $.ui.toast('spec-gatekeeper APPROVED: ready for the PR')
  }
}

function statusLine(b: SpeckitBoard | null): string | undefined {
  if (!b) return undefined
  const now = current(b.phases)
  const done = b.tasks.filter(t => t.isDone).length
  const where = now ? `${GLYPH[now.state]} ${now.id}${now.note ? ` (${now.note})` : ''}` : '✓ verified'
  return `speckit ${b.feature} · ${where} · ${done}/${b.tasks.length} tasks${b.red ? ` · RED ${b.red}/${b.maxRed}` : ''}`
}

async function refresh($: EngineInterface) {
  if (!repo) return
  const next = await snapshot($, repo)
  const before = await read($, board)
  if (JSON.stringify(before) === JSON.stringify(next)) return
  await update($, board, () => next)
  if (next) announce($, before, next)
  $.ui.status(statusLine(next))
}

// Spinners and elapsed times move only while an agent of the team runs.
async function keepTicking($: EngineInterface) {
  const isBusy = (await read($, agents)).some(a => a.isRunning)
  if (isBusy && !ticker) ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  if (!isBusy && ticker) { ticker.cancel(); ticker = null }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'speckit-board',
      description: 'Show the Spec Kit team board (args: refresh, band)',
    })
    repo = await findRepo($, e.cwd)
    // Say so either way: a board that draws nothing is indistinguishable from one that never loaded.
    if (!repo) {
      $.ui.toast(`speckit-board: no .specify/ in the git repo at ${e.cwd}; nothing to show`, { timeoutMs: 8000 })
      return next(e)
    }
    await refresh($)
    $.clock.every(POLL_MS, () => { void refresh($) })
    await keepTicking($)
    const b = await read($, board)
    $.ui.toast(b ? `speckit-board: ${b.feature}. /speckit-board opens the board` : 'speckit-board: no active feature in .specify/feature.json', { timeoutMs: 8000 })
    return next(e)
  })

  on('command.run', { command: 'speckit-board' }, async ($, e) => {
    if (!repo) return { text: 'speckit-board: no .specify/ in this repository.' }
    const arg = e.args.trim()
    if (arg === 'band') {
      const hidden = await update($, isBandHidden, h => !h)
      return { text: `speckit-board: band ${hidden ? 'hidden' : 'shown'}.` }
    }
    await refresh($)
    if (arg === 'refresh') return { text: 'speckit-board: refreshed.' }
    const opened = await $.ui.open({ id: PANE, title: 'Spec Kit' })
    return { text: opened.isPlaced ? 'speckit-board: pane opened.' : 'speckit-board: widen the terminal to see the pane.' }
  })

  on('classic.SubagentStart', async ($, e, next) => {
    const role = teamRole(e.agent_type)
    if (role) {
      const now = await $.clock.now()
      const agent: SpeckitAgent = { id: e.agent_id, type: role, isRunning: true, outcome: '', startedAt: now, endedAt: 0 }
      await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-12))
      await keepTicking($)
      await refresh($)
    }
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const role = teamRole(e.agent_type)
    if (role) {
      const outcome = outcomeOf(role, e.last_assistant_message ?? '')
      const now = await $.clock.now()
      await update($, agents, list => list.map(a =>
        (a.id === e.agent_id ? { ...a, isRunning: false, outcome, endedAt: now } : a)))
      const b = await read($, board)
      if (role === 'spec-gatekeeper' && b && (outcome === 'APPROVED' || outcome === 'REJECTED')) {
        const feature = (await readJson($, `${repo?.root}/.specify/feature.json`)) as { feature_directory?: string } | undefined
        if (feature?.feature_directory) await $.store.set(`gate:${feature.feature_directory}`, outcome)
      }
      $.ui.toast(`${role} finished${outcome ? `: ${outcome}` : ''}`)
      await keepTicking($)
      await refresh($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, board)
    if (!b || e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const done = b.tasks.filter(t => t.isDone).length
    const isWide = e.props.bodyColumns >= 100

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text color="claude" bold>◆ {b.feature}</Text>
        {b.phases.map(p => (
          <Text color={COLOR[p.state]}>{GLYPH[p.state]}{isWide ? ` ${p.id}` : ''}</Text>
        ))}
        <Text dimColor>│</Text>
        <Text color="success">{bar(done, b.tasks.length, isWide ? 10 : 5)}</Text>
        <Text>{done}/{b.tasks.length}</Text>
        {b.red > 0 && <Text color={b.red >= b.maxRed ? 'error' : 'warning'}>RED {b.red}/{b.maxRed}</Text>}
        <Button key="board" label="board" hotkey="b" onPress={() => $.ui.open({ id: PANE, title: 'Spec Kit' })} />
        <Button key="hide" label="hide" dimColor onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const b = await read($, board)
    if (!b) return <Text dimColor>No active Spec Kit feature (.specify/feature.json).</Text>

    const team = await read($, agents)
    const now = await $.clock.now()
    const cols = e.props.bodyColumns
    const done = b.tasks.filter(t => t.isDone).length
    const pct = b.tasks.length ? Math.round((done / b.tasks.length) * 100) : 0
    const sections = [...new Set(b.tasks.map(t => t.section))]
    const head = current(b.phases)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold color="claude">SPEC KIT · {b.feature}</Text>
          <Text dimColor>{head ? `now: ${head.id}${head.note ? `, ${head.note}` : ''}` : 'every phase done'}</Text>
        </Box>

        <Box flexDirection="row" flexWrap="wrap">
          {b.phases.map((p, i) => (
            <Box key={`phase:${p.id}`} flexDirection="row">
              {i > 0 && <Text dimColor>{' ─ '}</Text>}
              <Text color={COLOR[p.state]} bold={p === head} inverse={p === head}>
                {` ${GLYPH[p.state]} ${p.id} `}
              </Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            <Text>Tasks  </Text>
            <Text color="success">{bar(done, b.tasks.length, Math.max(6, Math.min(30, cols - 22)))}</Text>
            <Text bold>{done}/{b.tasks.length}</Text>
            <Text dimColor>{pct}%</Text>
          </Box>
          <Box flexDirection="row" columnGap={1}>
            <Text>Retries</Text>
            <Text color={b.red >= b.maxRed ? 'error' : b.red ? 'warning' : 'subtle'}>
              {'●'.repeat(b.red) + '○'.repeat(Math.max(0, b.maxRed - b.red))}
            </Text>
            <Text dimColor>{b.red ? `RED ${b.red} of ${b.maxRed} on this plan` : 'no REDs on this plan'}</Text>
          </Box>
        </Box>

        <Box flexDirection="column">
          {sections.map(section => (
            <Box key={`sec:${section}`} flexDirection="column">
              <Text bold dimColor>{section}</Text>
              {b.tasks.filter(t => t.section === section).map(t => (
                <Text wrap="truncate-end" dimColor={t.isDone}>
                  <Text color={t.isDone ? 'success' : 'subtle'}>{t.isDone ? ' ✓ ' : ' ○ '}</Text>
                  <Text bold={!t.isDone}>{t.id}</Text>
                  {t.isParallel ? <Text color="suggestion"> [P]</Text> : ''}
                  {` ${t.text}`}
                </Text>
              ))}
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>Team</Text>
          {team.length === 0 && <Text dimColor> no team agent has run this session</Text>}
          {[...team].reverse().map(a => (
            <Box key={`agent:${a.id}`} flexDirection="row" columnGap={1}>
              <Text color={a.isRunning ? 'claude' : 'success'}>
                {a.isRunning ? SPINNER[Math.floor(now / 250) % SPINNER.length] : '✓'}
              </Text>
              <Box width={16}><Text>{a.type}</Text></Box>
              <Text dimColor wrap="truncate-end">
                {a.isRunning ? `running ${since(now - a.startedAt)}` : `${a.outcome || 'done'} · ${since(now - a.endedAt)} ago`}
              </Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="row" columnGap={1}>
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => refresh($)} />
          <Button key="band" label="toggle band" hotkey="t" onPress={() => update($, isBandHidden, h => !h)} />
          <Button key="close" label="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
