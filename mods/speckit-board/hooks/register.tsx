import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SpeckitAgent, SpeckitBoard, SpeckitPhase, SpeckitPhaseState, SpeckitStats } from '../types'
import {
  COLOR, ENDED_UNREPORTED, GLYPH, MAX_RED, MISSING, TONE_COLOR, TONE_GLYPH, wordColor, bandLayout, bar, boardText, current,
  NO_STATS, addUsage, agentStats, costBar, COST_REFERENCE, dollars, readUsage, statsView,
  derivePhases, featureDir, fingerprint, fingerprintFiles, nextStep, nextTask, outcomeOf, parseTasks, redCount,
  ancestors, clearFailedText, clearText, noticeText, roleColor, since, spinnerAt, statusLine, taskSections, teamRole, toneOf,
} from './model'

const PANE = 'speckit-board'
const POLL_MS = 4000
const CLEARED_PANE = 'cleared; refresh or the next team agent brings it back'
// The pane's team rows: running agents, then the latest to finish. The state keeps 12.
const TEAM_ROWS = 6

const board = atom({ plugin: 'speckit-board', key: 'board' } as const, null)
const notice = atom({ plugin: 'speckit-board', key: 'notice' } as const, '')
const agents = atom({ plugin: 'speckit-board', key: 'agents' } as const, [])
const isBandHidden = atom({ plugin: 'speckit-board', key: 'isBandHidden' } as const, false)
const isCleared = atom({ plugin: 'speckit-board', key: 'isCleared' } as const, false)
// Features a team agent started on in this session (D1-A); clear does not touch it.
const teamFeatures = atom({ plugin: 'speckit-board', key: 'teamFeatures' } as const, [])
const isAllTasksShown = atom({ plugin: 'speckit-board', key: 'isAllTasksShown' } as const, false)
// The session's context, tokens and cost (010); session state, never stored.
const stats = atom({ plugin: 'speckit-board', key: 'stats' } as const, NO_STATS)

// `stateDir` is the team hook's record folder, which only a git repository has.
type Repo = { root: string; stateDir?: string }

// Found again on every load: a reload starts module variables over.
let repo: Repo | null = null
let ticker: { cancel: () => void } | null = null
const handbacks = new Map<string, string>()

// `undefined` missing, `null` exists but the read failed.
async function readText($: EngineInterface, path: string): Promise<string | null | undefined> {
  try { return await $.fs.read(path) } catch {
    return (await $.fs.exists(path).catch(() => false)) ? null : undefined
  }
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  const text = await readText($, path)
  if (text === undefined || text === null) return text
  try { return JSON.parse(text) } catch { return null }
}

async function findRepo($: EngineInterface, cwd: string): Promise<Repo | null> {
  const git = (...args: string[]) => $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
    .then(r => (r.exitCode === 0 ? r.stdout.trim() : ''))
    .catch(() => '')
  const root = await git('rev-parse', '--show-toplevel')
  if (!root) {
    // Not a git repository (or no git): the nearest folder above with a .specify/.
    for (const dir of ancestors(cwd)) {
      if (await $.fs.exists(`${dir}/.specify`).catch(() => false)) return { root: dir }
    }
    return null
  }
  if (!(await $.fs.exists(`${root}/.specify`).catch(() => false))) return null
  const common = await git('rev-parse', '--path-format=absolute', '--git-common-dir')
  return common ? { root, stateDir: `${common}/speckit-team` } : { root }
}

// The active feature's folder (repo-relative), or why there is none.
async function featureOf($: EngineInterface, root: string): Promise<{ feature: string; notice?: 'no-feature' | 'feature-unreadable' }> {
  const meta = await readJson($, `${root}/.specify/feature.json`)
  if (meta === null) return { feature: '', notice: 'feature-unreadable' }
  const feature = featureDir(meta && typeof meta === 'object' ? (meta as { feature_directory?: unknown }).feature_directory : undefined, root)
  return feature ? { feature } : { feature: '', notice: 'no-feature' }
}

const activeFeature = async ($: EngineInterface, root: string): Promise<string> => (await featureOf($, root)).feature

// The plugin store is the user's, shared by every repo. Kept under the feature's path alone, a word
// given in one repo showed in every other with a feature of that name, and with no time a later audit
// could not void it. So it is kept as the hook keeps its own: per repo, with when it was given.
const gateKey = (at: Repo, feature: string) => `gate:${JSON.stringify([at.stateDir ?? at.root, feature])}`
// A session can switch repository, and two repositories can hold a feature of the same name: the
// features a team agent started on are kept per repository too (#97).
const teamKey = (at: Repo, feature: string) => JSON.stringify([at.stateDir ?? at.root, feature])

// Notes that a team agent started on the feature, so it gets the team view (D1-A). A refused write is
// toasted, and the event goes on (constitution II).
async function noteTeamFeature($: EngineInterface, at: Repo, feature: string) {
  const key = teamKey(at, feature)
  try {
    await update($, teamFeatures, list => (list.includes(key) ? list : [...list, key]))
  } catch (err) {
    $.ui.toast(`board could not note the team's feature: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// The gatekeeper's word from the hook's `ends` record or the store, with its time when it has one.
function gateWord(record: unknown): { word: string; at: string | undefined } | undefined {
  if (!record || typeof record !== 'object') return undefined
  const { word, at } = record as { word?: unknown; at?: unknown }
  return word === 'APPROVED' || word === 'REJECTED' ? { word, at: typeof at === 'string' ? at : undefined } : undefined
}

// `isTeamStart`: a team agent is starting, so the feature this snapshot reads gets the team view. It is
// noted here, from this read of feature.json, so the start event reads that file once (#95).
async function snapshot($: EngineInterface, at: Repo, isTeamStart = false): Promise<{ board: SpeckitBoard | null; notice: string }> {
  const found = await featureOf($, at.root)
  const feature = found.feature
  if (!feature) return { board: null, notice: noticeText(found.notice ?? 'no-feature') }
  if (isTeamStart) await noteTeamFeature($, at, feature)
  const name = feature.split('/').pop() ?? feature

  const paths = fingerprintFiles(feature)
  const texts = await Promise.all(paths.map(path => readText($, `${at.root}/${path}`)))
  const fp = await fingerprint(paths.map((path, n) => ({ path, text: texts[n] ?? MISSING })))
  const [, spec, plan, tasksMd] = texts
  // Only a folder with no spec.md is asked about: the other files are in it if they exist.
  if (spec === undefined && !(await $.fs.exists(`${at.root}/${feature}`).catch(() => false))) {
    return { board: null, notice: noticeText('no-folder', feature) }
  }
  const tasks = tasksMd === undefined || tasksMd === null ? tasksMd : parseTasks(tasksMd)

  const state = at.stateDir
  const record = (dir: string) => (state ? readJson($, `${state}/${dir}/${name}.json`) : Promise.resolve(undefined))
  const verdict = await record('verdicts') as Parameters<typeof derivePhases>[0]['verdict']
  const retries = await record('retries') as Parameters<typeof redCount>[0]
  const red = redCount(retries, fp)
  const isRetryUnreadable = retries === null
  // The word the hook's `ends` check recorded, so verify updates whether or not this mod saw the
  // gatekeeper stop; the store holds what it saw, for a hook from before that record existed.
  const gate = state
    ? gateWord(await record('ends')) ?? gateWord(await $.store.get(gateKey(at, feature)).catch(() => undefined))
    : undefined
  const running = (await read($, agents)).filter(a => a.isRunning).map(a => a.type)
  // The team view if the team recorded anything for the feature (a file that exists counts, readable
  // or not), the store has its word, or a team agent started on it in this session.
  const hasRecord = state !== undefined && (await Promise.all(['verdicts', 'retries', 'ends'].map(dir =>
    $.fs.exists(`${state}/${dir}/${name}.json`).catch(() => false)))).some(Boolean)
  const isStandalone = !(hasRecord || gate || (await read($, teamFeatures)).includes(teamKey(at, feature)))

  return {
    notice: '',
    board: {
      feature: name,
      phases: derivePhases({
        spec, plan, tasks, verdict, fingerprint: fp, red, isRetryUnreadable,
        gate: gate?.word, gateAt: gate?.at, running, isStandalone,
      }),
      tasks: tasks ?? [],
      red,
      maxRed: MAX_RED,
      isRetryUnreadable,
      fingerprint: fp,
      ...(isStandalone ? { isStandalone } : {}),
    },
  }
}

function announce($: EngineInterface, before: SpeckitBoard | null, after: SpeckitBoard) {
  if (!before) return
  // The board follows .specify/feature.json, which a new feature's spec rewrites.
  if (before.feature !== after.feature) {
    $.ui.toast(`${after.feature} is the active feature now`)
    return
  }
  const was = (id: SpeckitPhase['id']) => before.phases.find(p => p.id === id)
  for (const p of after.phases) {
    const old = was(p.id)
    if (!old || old.state === p.state) continue
    if (p.id === 'audit' && p.state === 'done') $.ui.toast('Audit PASS: the implementation gate is open')
    if (p.id === 'audit' && p.state === 'failed') $.ui.toast(`Audit ${p.note}: route CRITICAL/HIGH findings to their owners`)
    if (p.id === 'audit' && p.state === 'stale') $.ui.toast(`Spec, plan or tasks ${p.note.replace(/^edited/, 'changed')}: re-audit before building`)
    if (p.id === 'build' && p.state === 'failed') {
      $.ui.toast(after.isRetryUnreadable
        ? 'The retry record is unreadable: the gate blocks implementer until it is deleted'
        : `RED ${after.red} of ${after.maxRed}: retry limit reached`)
    }
    if (p.id === 'build' && p.state === 'done') $.ui.toast(`All ${after.tasks.length} tasks done`)
    if (p.id === 'verify' && p.state === 'done') $.ui.toast('spec-gatekeeper APPROVED: ready for the PR')
  }
}

// The poll, turn ends and agent events each refresh. A refresh in one event does not see the board
// another event's refresh stored, so each compared the files with the same old board and announced
// the same change. It compares with the board this module last wrote instead; with the stored one
// only after a reload, which starts module variables over.
let shown: SpeckitBoard | null | undefined

async function refresh($: EngineInterface, isTeamStart = false) {
  if (!repo) return
  const { board: next, notice: why } = await snapshot($, repo, isTeamStart)
  const before = shown === undefined ? await read($, board) : shown
  if (why !== (await read($, notice))) await update($, notice, () => why)
  if (JSON.stringify(before) === JSON.stringify(next)) return
  shown = next
  await update($, board, () => next)
  if (next) announce($, before, next)
  $.ui.status(statusLine(next))
}

// What the Agent call said the agent's task was. SubagentStart does not carry it; the engine's list does.
async function descriptionOf($: EngineInterface, id: string): Promise<string> {
  const listed = await $.agent.list().catch(() => [])
  return listed.find(a => a.id === id)?.description ?? ''
}

// An agent that is stopped or fails ends with no SubagentStop to say so, and would show running for
// the rest of the session. The engine's own list settles it. A completed one is left to its
// SubagentStop, which the team's stop checks may still block. The list also gives a running agent the
// description it lacked when it started.
async function settleEnded($: EngineInterface) {
  const team = await read($, agents)
  if (!team.some(a => a.isRunning)) return
  const listed = new Map((await $.agent.list().catch(() => [])).map(a => [a.id, a]))
  const now = await $.clock.now()
  const settle = (a: SpeckitAgent): SpeckitAgent => {
    const info = a.isRunning ? listed.get(a.id) : undefined
    if (!info) return a
    const description = a.description || info.description
    if (ENDED_UNREPORTED.includes(info.status)) {
      return { ...a, description, isRunning: false, outcome: a.outcome || info.status, endedAt: now }
    }
    return description === a.description ? a : { ...a, description }
  }
  if (team.every(a => settle(a) === a)) return
  await update($, agents, list => list.map(settle))
  await keepTicking($)
}

// When the read now pending started; null when none is. One read at a time (FR-010).
let pendingSince: number | null = null
// A refused stats write is toasted once, until a write succeeds (constitution III).
let isStatsRefusalToasted = false

async function writeStats($: EngineInterface, change: (s: SpeckitStats) => SpeckitStats) {
  try {
    await update($, stats, change)
    isStatsRefusalToasted = false
  } catch (err) {
    if (isStatsRefusalToasted) return
    isStatsRefusalToasted = true
    $.ui.toast(`board could not update the stats: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Reads the session's usage into the stats atom. Never throws and is not awaited by the events: a read
// that does not answer blocks neither the turn nor the prompt. A read pending for a poll or longer
// shows "context n/a" until it answers.
async function measure($: EngineInterface) {
  try {
    const now = await $.clock.now()
    if (pendingSince !== null) {
      if (now - pendingSince >= POLL_MS) await writeStats($, s => readUsage(undefined, s))
      return
    }
    pendingSince = now
    try {
      let raw: unknown
      try { raw = await $.session.usage() } catch { raw = undefined }
      await writeStats($, s => readUsage(raw, s))
    } finally { pendingSince = null }
  } catch { /* the engine refused a call while unloading; the next poll reads again */ }
}

// A finished agent's "2m ago" changes with no file or agent changing, so the poll redraws while
// there are agent rows; keepTicking's one-second ticker is for the spinners.
async function poll($: EngineInterface) {
  await settleEnded($)
  await refresh($)
  void measure($)
  if ((await read($, agents)).length) $.ui.invalidate('ui.render')
}

// The rows the pane's tree takes, so a pane seated inline above the prompt opens tall enough to show
// it whole rather than the third of the terminal it gets unasked (the dock ignores it). It follows
// the tree in the Pane hook row for row: the header, the phases, the team, the buttons and the task
// sections, a blank row between each two.
function paneRows(b: SpeckitBoard | null, team: readonly SpeckitAgent[], isAll: boolean, isClearedNow: boolean): number {
  if (!b) return 2
  // The cleared pane: its title, its line and the buttons.
  if (isClearedNow) return 5
  const taskCount = taskSections(b.tasks, isAll).reduce((n, s) => n + 1 + (s.isOpen ? s.tasks.length : 0), 0)
  if (b.isStandalone) return 2 + b.phases.length + 3 + 1 + taskCount + 3
  const teamRows = 1 + (team.length === 0 ? 1 : Math.min(team.length, TEAM_ROWS) + (team.length > TEAM_ROWS ? 1 : 0))
  return 2 + b.phases.length + 3 + teamRows + 1 + taskCount + 4
}

// Asked again for a pane already open, it takes the new rows (and keeps the person's own size).
async function openPane($: EngineInterface) {
  const rows = paneRows(await read($, board), await read($, agents), await read($, isAllTasksShown), await read($, isCleared))
  return $.ui.open({ id: PANE, title: 'Spec Kit', rows })
}

// A board, and neither hidden nor cleared.
async function isBandDrawn($: EngineInterface): Promise<boolean> {
  return !!(await read($, board)) && !(await read($, isBandHidden)) && !(await read($, isCleared))
}

// Display only: plugin state, no file, store, process, status line or refresh. Throws on a refused write.
// With no team agent running it also clears the pane's board and the band (#150); with one, they stay.
async function clear($: EngineInterface): Promise<string> {
  const team = await read($, agents)
  const running = team.filter(a => a.isRunning).length
  const rows = team.length - running
  const wasPaneShown = !!(await read($, board)) && !(await read($, isCleared))
  const wasDrawn = await isBandDrawn($)
  await update($, agents, list => list.filter(a => a.isRunning))
  if (running === 0) await update($, isCleared, () => true)
  return clearText(rows, wasPaneShown && running === 0, wasDrawn && running === 0, running)
}

// Without a clear this is the plain flip; with one, the band comes back (and `isCleared` ends).
async function toggleBand($: EngineInterface): Promise<boolean> {
  const hidden = !(await read($, isBandHidden)) && !(await read($, isCleared))
  await update($, isBandHidden, () => hidden)
  if (!hidden) await update($, isCleared, () => false)
  return hidden
}

// The person's refresh, the pane's button or the argument: it ends a clear, which the poll's does not.
async function refreshAsked($: EngineInterface) {
  if (await read($, isCleared)) {
    try { await update($, isCleared, () => false) } catch (err) {
      $.ui.toast(`board could not end the clear: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  await refresh($)
}

async function pressClear($: EngineInterface): Promise<void> {
  try { $.ui.toast(await clear($)) } catch (err) { $.ui.toast(clearFailedText(err)) }
}

// Spinners and running times move every second only while an agent of the team runs.
async function keepTicking($: EngineInterface) {
  const isBusy = (await read($, agents)).some(a => a.isRunning)
  if (isBusy && !ticker) ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  if (!isBusy && ticker) { ticker.cancel(); ticker = null }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'speckit-board',
      description: "Show the Spec Kit board: the feature's phases, tasks and next step",
      argumentHint: '[status|refresh|band|clear]',
      // /speckit-team runs its agents in the foreground, so a whole pipeline is one turn: without
      // this, the command waited for the turn to end, and opened the board once the run was over.
      immediate: true,
    })
    repo = await findRepo($, e.cwd)
    // Without a Spec Kit folder it stays quiet; every command says why (N-1).
    if (!repo) return next(e)
    await refresh($)
    pendingSince = null
    void measure($)
    // Nothing awaits the poll: one still running when the mod reloads or unloads has its calls
    // refused, and the next poll, if there is one, reads everything again.
    $.clock.every(POLL_MS, () => { poll($).catch(() => undefined) })
    await keepTicking($)
    const b = await read($, board)
    $.ui.toast(b ? `${b.feature}. /speckit-board opens the board` : await read($, notice), { timeoutMs: 8000 })
    return next(e)
  })

  // Claude Code shows a command's answer after the plugin's name, so the texts do not repeat it.
  on('command.run', { command: 'speckit-board' }, async ($, e) => {
    if (!repo) return { text: noticeText('not-set-up') }
    const arg = e.args.trim()
    if (arg === 'band') {
      const hidden = await toggleBand($)
      return { text: `band ${hidden ? 'hidden' : 'shown'}.` }
    }
    if (arg === 'clear') {
      try { return { text: await clear($) } } catch (err) { return { text: clearFailedText(err) } }
    }
    // Any other argument opened the pane, so a typo looked as if it had worked.
    if (arg && arg !== 'refresh' && arg !== 'status') return { text: `unknown argument "${arg}": use status, refresh, band or clear.` }
    if (arg === 'refresh') {
      await refreshAsked($)
      return { text: 'refreshed.' }
    }
    await refresh($)
    if (arg === 'status') {
      const b = await read($, board)
      const running = (await read($, agents)).filter(a => a.isRunning)
      return { text: b ? boardText(b, running, await $.clock.now(), statsView(await read($, stats))) : await read($, notice) }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'pane opened.' : 'widen the terminal to see the pane.' }
  })

  on('classic.SubagentStart', async ($, e, next) => {
    const role = teamRole(e.agent_type)
    if (role) {
      if (await read($, isCleared)) {
        try { await update($, isCleared, () => false) } catch (err) {
          $.ui.toast(`board could not end the clear: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      const now = await $.clock.now()
      const description = await descriptionOf($, e.agent_id)
      const agent: SpeckitAgent = { id: e.agent_id, type: role, description, isRunning: true, outcome: '', startedAt: now, endedAt: 0 }
      await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-12))
      await keepTicking($)
      await refresh($, true)
    }
    return next(e)
  })

  // A backgrounded agent (an @-mention in an interactive session) reports through the SubagentHandback
  // tool: its last message is that call, not the report, so SubagentStop has nothing to read. The
  // report is kept from the call, as hooks/speckit-team.mjs reads it, keyed by the agent's id.
  on('tool.call', { tool: 'SubagentHandback' }, async ($, e, next) => {
    const { agentId, message } = e
    if (agentId && typeof message === 'string') handbacks.set(agentId, message)
    return next(e)
  })

  // The team's stop checks are settings hooks, which run beneath every mod. So the agent's end is
  // read after them: one that blocks sends the agent back to work, and the verdict, RED or
  // gatekeeper word they record is on disk only once they have run.
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    if (result?.block) return result
    const role = teamRole(e.agent_type)
    const report = handbacks.get(e.agent_id)
    handbacks.delete(e.agent_id)
    if (role) {
      const outcome = outcomeOf(role, report ?? '') || outcomeOf(role, e.last_assistant_message ?? '')
      const now = await $.clock.now()
      await update($, agents, list => list.map(a =>
        (a.id === e.agent_id ? { ...a, isRunning: false, outcome, endedAt: now } : a)))
      const at = repo
      if (role === 'spec-gatekeeper' && at && (outcome === 'APPROVED' || outcome === 'REJECTED')) {
        const feature = await activeFeature($, at.root)
        if (feature) await $.store.set(gateKey(at, feature), { word: outcome, at: new Date(now).toISOString() })
      }
      $.ui.toast(`${role} finished${outcome ? `: ${outcome}` : ''}`)
      await keepTicking($)
      await refresh($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (repo) {
      const turnUsage = (e as { usage?: unknown }).usage
      const agentId = (e as { agentId?: string }).agentId
      void (async () => {
        await writeStats($, s => ({ ...s, usage: addUsage(s.usage, turnUsage) }))
        if (agentId) {
          try {
            await update($, agents, list => list.map(a => (a.id === agentId ? { ...a, usage: addUsage(a.usage ?? {}, turnUsage) } : a)))
          } catch { /* the row keeps its figures; the session total is kept */ }
        }
        await measure($)
      })().catch(() => undefined)
    }
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, board)
    if (!b || e.props.hasSurvey || !(await isBandDrawn($))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const running = (await read($, agents)).filter(a => a.isRunning)
    const items = bandLayout(b, running, await $.clock.now(), e.props.bodyColumns, statsView(await read($, stats)))

    // bandLayout leaves out what does not fit the row; the wrap is for a feature name wider than it counts.
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {items.map(item => {
          switch (item.kind) {
            case 'feature': return <Text color="claude" bold>{item.text}</Text>
            case 'phase': return <Text color={COLOR[item.state]} bold={item.isHead}>{item.text}</Text>
            case 'sep': return <Text dimColor>{item.text}</Text>
            case 'bar': return <Text color="success">{item.text}</Text>
            case 'count': return <Text>{item.text}</Text>
            case 'stat': return <Text color={item.mark === 'critical' ? 'error' : item.mark === 'high' ? 'warning' : 'claude'}>{item.text}</Text>
            case 'red': return <Text color={item.isLimit ? 'error' : 'warning'}>{item.text}</Text>
            case 'agent':
              return (
                <Text>
                  <Text color="claude">{item.spin} </Text>
                  <Text color={roleColor(item.role)}>{item.role}</Text>
                  <Text dimColor>{item.rest}</Text>
                </Text>
              )
            case 'button':
              return item.key === 'board'
                ? <Button key="board" label="board" hotkey="b" onPress={() => openPane($)} />
                : item.key === 'clear'
                ? <Button key="clear" label="clear" dimColor onPress={() => pressClear($)} />
                : <Button key="hide" label="hide" dimColor onPress={() => update($, isBandHidden, () => true)} />
          }
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const b = await read($, board)
    if (!b) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{(await read($, notice)) || noticeText('no-feature')}</Text>
        </Box>
      )
    }

    // A clear leaves only this line and the buttons that bring the board back or close it (#150). A
    // running team agent is never hidden, even when the write that ends the clear was refused.
    const team = await read($, agents)
    if (await read($, isCleared) && !team.some(a => a.isRunning)) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="claude">SPEC KIT</Text>
          <Text dimColor>{CLEARED_PANE}</Text>
          <Box flexDirection="row" columnGap={1}>
            {/* Asked again, the pane takes the board's rows: the cleared one opens 5 tall. */}
            <Button key="refresh" label="refresh" hotkey="r" onPress={async () => { await refreshAsked($); await openPane($) }} />
            <Button key="close" label="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      )
    }

    const isAll = await read($, isAllTasksShown)
    const now = await $.clock.now()
    const head = current(b.phases)
    const done = b.tasks.filter(t => t.isDone).length
    const progress = `${done}/${b.tasks.length}`
    const next = nextTask(b.tasks)
    const step = nextStep(b, team.filter(a => a.isRunning).map(a => a.type))
    // Running agents first, then the latest started; the state keeps more than the pane draws.
    const rows = [...team].reverse().sort((x, y) => Number(y.isRunning) - Number(x.isRunning))
    const barWidth = Math.max(6, Math.min(24, e.props.bodyColumns - 30))
    const view = statsView(await read($, stats))
    const markColor = (m: string) => (m === 'critical' ? 'error' : m === 'high' ? 'warning' : 'claude')
    const word = (m: string) => (m ? ` ${m}` : '')
    // A note that says something is wrong is drawn in the color of its glyph, the rest dim.
    const noteColor = (state: SpeckitPhaseState) => (state === 'failed' || state === 'stale' || state === 'blocked' ? COLOR[state] : undefined)
    // tasks.md text: the story tag dim, `code` as Claude Code draws inline code.
    const taskText = (text: string) => {
      const story = /^(\[US\d+\])\s*/.exec(text)
      const rest = story ? text.slice(story[0].length) : text
      return [
        story ? <Text dimColor>{story[1]} </Text> : '',
        ...rest.split('`').map((part, i) => (i % 2 ? <Text color="permission">{part}</Text> : part)),
      ]
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold color="claude" wrap="truncate-end">SPEC KIT · {b.feature}</Text>
          <Text wrap="truncate-end">
            <Text dimColor>next </Text>
            {step.task ? [step.command ? `${step.command} ` : '', <Text bold>{step.task.id}</Text>, ' ', taskText(step.task.text)] : step.text}
          </Text>
        </Box>

        {/* The pipeline, one phase a row with its note: the build row carries the tasks and the REDs. */}
        <Box flexDirection="column">
          {b.phases.map(p => {
            const isBuilding = p.id === 'build' && b.tasks.length > 0
            const note = isBuilding && p.note === progress ? '' : p.note
            return (
              <Box key={`phase:${p.id}`} flexDirection="row" columnGap={1}>
                <Text color={COLOR[p.state]}>{GLYPH[p.state]}</Text>
                <Box width={6} flexShrink={0}>
                  <Text bold={p === head} color={p === head ? COLOR[p.state] : undefined}>{p.id}</Text>
                </Box>
                {isBuilding && <Text color="success">{bar(done, b.tasks.length, barWidth)}</Text>}
                {isBuilding && <Text bold>{progress}</Text>}
                {note !== '' && <Text color={noteColor(p.state)} dimColor={!noteColor(p.state)} wrap="truncate-end">{note}</Text>}
                {p.id === 'build' && b.red > 0 && <Text dimColor>RED</Text>}
                {p.id === 'build' && b.red > 0 && (
                  <Text color={b.red >= b.maxRed ? 'error' : 'warning'}>
                    {'●'.repeat(b.red) + '○'.repeat(Math.max(0, b.maxRed - b.red))}
                  </Text>
                )}
              </Box>
            )
          })}
        </Box>

        {/* The session's context and cost: one state, the band's and the status answer's figures. */}
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            <Box width={8} flexShrink={0}><Text>context</Text></Box>
            {view.context.fill !== undefined && <Text color={markColor(view.context.mark)}>{bar(view.context.fill, 1, barWidth)}</Text>}
            <Text color={view.context.fill !== undefined ? markColor(view.context.mark) : undefined}>{view.context.text}{word(view.context.mark)}</Text>
            {view.detail !== '' && <Text dimColor>· {view.detail}</Text>}
          </Box>
          <Box flexDirection="row" columnGap={1}>
            <Box width={8} flexShrink={0}><Text>cost</Text></Box>
            {view.cost.fill !== undefined && <Text color={markColor(view.cost.mark)}>{costBar(view.cost.fill)}{word(view.cost.mark)}</Text>}
            <Text>{view.cost.text}</Text>
            {view.cost.fill !== undefined && <Text dimColor>of {dollars(COST_REFERENCE)}</Text>}
            <Text dimColor>· {view.tokens}</Text>
          </Box>
        </Box>

        {/* The live parts before the task list: a pane taller than the terminal loses its bottom. */}
        {!b.isStandalone && <Box flexDirection="column">
          <Text bold>Team</Text>
          {team.length === 0 && <Text dimColor>no team agent has run this session</Text>}
          {rows.slice(0, TEAM_ROWS).map(a => {
            const tone = toneOf(a.type, a.outcome)
            const color = a.isRunning ? 'claude' : TONE_COLOR[tone]
            const asked = a.description ? ` · ${a.description}` : ''
            return (
              <Box key={`agent:${a.id}`} flexDirection="row" columnGap={1}>
                <Text color={color}>{a.isRunning ? spinnerAt(now) : TONE_GLYPH[tone]}</Text>
                <Box width={15} flexShrink={0}><Text color={roleColor(a.type)}>{a.type}</Text></Box>
                {/* The word keeps its width and the rest is cut: docked 60 columns wide, `running` wrapped. */}
                <Box flexShrink={0}>
                  <Text color={a.isRunning ? color : wordColor(a.outcome, tone)} bold={tone !== 'neutral'}>{a.isRunning ? 'running' : a.outcome || 'done'}</Text>
                </Box>
                <Box flexShrink={1}>
                  <Text dimColor wrap="truncate-end">
                    {a.isRunning
                      ? `${since(now - a.startedAt)}${asked}`
                      : `took ${since(a.endedAt - a.startedAt)} · ${since(now - a.endedAt)} ago${asked}`}
                  </Text>
                </Box>
                {!a.isRunning && <Box flexShrink={0}><Text>{agentStats(a.usage)}</Text></Box>}
              </Box>
            )
          })}
          {rows.length > TEAM_ROWS && <Text dimColor>+{rows.length - TEAM_ROWS} earlier</Text>}
        </Box>}

        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => refreshAsked($)} />
          <Button
            key="tasks" label={isAll ? 'fold tasks' : 'all tasks'} hotkey="a"
            onPress={async () => { await update($, isAllTasksShown, v => !v); await openPane($) }}
          />
          <Button key="band" label="toggle band" hotkey="t" onPress={() => toggleBand($)} />
          <Button key="clear" label="clear" hotkey="c" onPress={() => pressClear($)} />
          <Button key="close" label="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>

        {/* Finished sections, and those not started past the next task, fold to their title and count. */}
        <Box flexDirection="column">
          {taskSections(b.tasks, isAll).map(s => {
            const state: SpeckitPhaseState = s.done === s.total ? 'done' : s.done > 0 ? 'active' : 'todo'
            return (
              <Box key={`sec:${s.title}`} flexDirection="column">
                <Box flexDirection="row" columnGap={1}>
                  <Text color={COLOR[state]}>{GLYPH[state]}</Text>
                  <Box flexShrink={1}><Text bold={s.isOpen} dimColor={!s.isOpen} wrap="truncate-end">{s.title || 'Tasks'}</Text></Box>
                  <Box flexShrink={0}><Text dimColor>{s.done}/{s.total}</Text></Box>
                </Box>
                {s.isOpen && s.tasks.map(t => (
                  <Text wrap="truncate-end" dimColor={t.isDone}>
                    <Text color={t.isDone ? 'success' : t === next ? 'claude' : 'subtle'}>
                      {t.isDone ? '  ✓ ' : t === next ? '  ▶ ' : '  ○ '}
                    </Text>
                    <Text bold={!t.isDone}>{t.id}</Text>
                    {t.isParallel ? <Text color="suggestion"> [P]</Text> : ''}
                    {' '}
                    {taskText(t.text)}
                  </Text>
                ))}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
