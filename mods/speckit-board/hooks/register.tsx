import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SpeckitAgent, SpeckitBoard, SpeckitPhase, SpeckitPhaseState } from '../types'
import {
  COLOR, ENDED_UNREPORTED, GLYPH, MAX_RED, MISSING, TONE_COLOR, TONE_GLYPH, wordColor, bandLayout, bar, boardText, current,
  derivePhases, featureDir, fingerprint, fingerprintFiles, nextStep, nextTask, outcomeOf, parseTasks, redCount,
  clearFailedText, clearText, roleColor, since, spinnerAt, statusLine, taskSections, teamRole, toneOf,
} from './model'

const PANE = 'speckit-board'
const POLL_MS = 4000
// The pane's team rows: running agents, then the latest to finish. The state keeps 12.
const TEAM_ROWS = 6

const board = atom({ plugin: 'speckit-board', key: 'board' } as const, null)
const agents = atom({ plugin: 'speckit-board', key: 'agents' } as const, [])
const isBandHidden = atom({ plugin: 'speckit-board', key: 'isBandHidden' } as const, false)
const isCleared = atom({ plugin: 'speckit-board', key: 'isCleared' } as const, false)
const isAllTasksShown = atom({ plugin: 'speckit-board', key: 'isAllTasksShown' } as const, false)

type Repo = { root: string; stateDir: string }

// Found again on every load: a reload starts module variables over.
let repo: Repo | null = null
let ticker: { cancel: () => void } | null = null
const handbacks = new Map<string, string>()

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

async function activeFeature($: EngineInterface, root: string): Promise<string> {
  const meta = await readJson($, `${root}/.specify/feature.json`)
  return featureDir(meta && typeof meta === 'object' ? (meta as { feature_directory?: unknown }).feature_directory : undefined, root)
}

// The plugin store is the user's, shared by every repo. Kept under the feature's path alone, a word
// given in one repo showed in every other with a feature of that name, and with no time a later audit
// could not void it. So it is kept as the hook keeps its own: per repo, with when it was given.
const gateKey = (at: Repo, feature: string) => `gate:${JSON.stringify([at.stateDir, feature])}`

// The gatekeeper's word from the hook's `ends` record or the store, with its time when it has one.
function gateWord(record: unknown): { word: string; at: string | undefined } | undefined {
  if (!record || typeof record !== 'object') return undefined
  const { word, at } = record as { word?: unknown; at?: unknown }
  return word === 'APPROVED' || word === 'REJECTED' ? { word, at: typeof at === 'string' ? at : undefined } : undefined
}

async function snapshot($: EngineInterface, at: Repo): Promise<SpeckitBoard | null> {
  const feature = await activeFeature($, at.root)
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
  const isRetryUnreadable = retries === null
  // The word the hook's `ends` check recorded, so verify updates whether or not this mod saw the
  // gatekeeper stop; the store holds what it saw, for a hook from before that record existed.
  const gate = gateWord(await readJson($, `${at.stateDir}/ends/${name}.json`))
    ?? gateWord(await $.store.get(gateKey(at, feature)).catch(() => undefined))
  const running = (await read($, agents)).filter(a => a.isRunning).map(a => a.type)

  return {
    feature: name,
    phases: derivePhases({
      spec: text(1), plan: text(2), tasks, verdict, fingerprint: fp, red, isRetryUnreadable,
      gate: gate?.word, gateAt: gate?.at, running,
    }),
    tasks: tasks ?? [],
    red,
    maxRed: MAX_RED,
    isRetryUnreadable,
    fingerprint: fp,
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

async function refresh($: EngineInterface) {
  if (!repo) return
  const next = await snapshot($, repo)
  const before = shown === undefined ? await read($, board) : shown
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

// A finished agent's "2m ago" changes with no file or agent changing, so the poll redraws while
// there are agent rows; keepTicking's one-second ticker is for the spinners.
async function poll($: EngineInterface) {
  await settleEnded($)
  await refresh($)
  if ((await read($, agents)).length) $.ui.invalidate('ui.render')
}

// The rows the pane's tree takes, so a pane seated inline above the prompt opens tall enough to show
// it whole rather than the third of the terminal it gets unasked (the dock ignores it). It follows
// the tree in the Pane hook row for row: the header, the phases, the team, the buttons and the task
// sections, a blank row between each two.
function paneRows(b: SpeckitBoard | null, team: readonly SpeckitAgent[], isAll: boolean): number {
  if (!b) return 2
  const teamRows = 1 + (team.length === 0 ? 1 : Math.min(team.length, TEAM_ROWS) + (team.length > TEAM_ROWS ? 1 : 0))
  const taskRows = taskSections(b.tasks, isAll).reduce((n, s) => n + 1 + (s.isOpen ? s.tasks.length : 0), 0)
  return 2 + b.phases.length + teamRows + 1 + taskRows + 4
}

// Asked again for a pane already open, it takes the new rows (and keeps the person's own size).
async function openPane($: EngineInterface) {
  const rows = paneRows(await read($, board), await read($, agents), await read($, isAllTasksShown))
  return $.ui.open({ id: PANE, title: 'Spec Kit', rows })
}

// A board, and neither hidden nor cleared.
async function isBandDrawn($: EngineInterface): Promise<boolean> {
  return !!(await read($, board)) && !(await read($, isBandHidden)) && !(await read($, isCleared))
}

// Display only: plugin state, no file, store, process, status line or refresh. Throws on a refused write.
async function clear($: EngineInterface): Promise<string> {
  const team = await read($, agents)
  const running = team.filter(a => a.isRunning).length
  const rows = team.length - running
  const wasDrawn = await isBandDrawn($)
  await update($, agents, list => list.filter(a => a.isRunning))
  if (running === 0) await update($, isCleared, () => true)
  return clearText(rows, wasDrawn && running === 0, running)
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
      description: 'Show the Spec Kit team board',
      argumentHint: '[status|refresh|band|clear]',
      // /speckit-team runs its agents in the foreground, so a whole pipeline is one turn: without
      // this, the command waited for the turn to end, and opened the board once the run was over.
      immediate: true,
    })
    repo = await findRepo($, e.cwd)
    // Say so either way: a board that draws nothing is indistinguishable from one that never loaded.
    if (!repo) {
      $.ui.toast(`no .specify/ in the git repo at ${e.cwd}; nothing to show`, { timeoutMs: 8000 })
      return next(e)
    }
    await refresh($)
    // Nothing awaits the poll: one still running when the mod reloads or unloads has its calls
    // refused, and the next poll, if there is one, reads everything again.
    $.clock.every(POLL_MS, () => { poll($).catch(() => undefined) })
    await keepTicking($)
    const b = await read($, board)
    $.ui.toast(b ? `${b.feature}. /speckit-board opens the board` : 'no active feature in .specify/feature.json', { timeoutMs: 8000 })
    return next(e)
  })

  // Claude Code shows a command's answer after the plugin's name, so the texts do not repeat it.
  on('command.run', { command: 'speckit-board' }, async ($, e) => {
    if (!repo) return { text: 'no .specify/ in this repository.' }
    const arg = e.args.trim()
    if (arg === 'band') {
      const hidden = await update($, isBandHidden, h => !h)
      return { text: `band ${hidden ? 'hidden' : 'shown'}.` }
    }
    if (arg === 'clear') {
      try { return { text: await clear($) } } catch (err) { return { text: clearFailedText(err) } }
    }
    // Any other argument opened the pane, so a typo looked as if it had worked.
    if (arg && arg !== 'refresh' && arg !== 'status') return { text: `unknown argument "${arg}": use status, refresh, band or clear.` }
    await refresh($)
    if (arg === 'refresh') return { text: 'refreshed.' }
    if (arg === 'status') {
      const b = await read($, board)
      const running = (await read($, agents)).filter(a => a.isRunning)
      return { text: b ? boardText(b, running, await $.clock.now()) : 'no active feature in .specify/feature.json.' }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'pane opened.' : 'widen the terminal to see the pane.' }
  })

  on('classic.SubagentStart', async ($, e, next) => {
    const role = teamRole(e.agent_type)
    if (role) {
      const now = await $.clock.now()
      const description = await descriptionOf($, e.agent_id)
      const agent: SpeckitAgent = { id: e.agent_id, type: role, description, isRunning: true, outcome: '', startedAt: now, endedAt: 0 }
      await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-12))
      await keepTicking($)
      await refresh($)
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
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, board)
    if (!b || e.props.hasSurvey || !(await isBandDrawn($))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const running = (await read($, agents)).filter(a => a.isRunning)
    const items = bandLayout(b, running, await $.clock.now(), e.props.bodyColumns)

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
          <Text dimColor>No active Spec Kit feature in .specify/feature.json.</Text>
          <Text dimColor>/speckit-team {'<idea>'} starts one.</Text>
        </Box>
      )
    }

    const team = await read($, agents)
    const isClearedNow = await read($, isCleared)
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
            {step.task ? [<Text bold>{step.task.id}</Text>, ' ', taskText(step.task.text)] : step.text}
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

        {/* The live parts before the task list: a pane taller than the terminal loses its bottom. */}
        <Box flexDirection="column">
          <Text bold>Team</Text>
          {team.length === 0 && <Text dimColor>{isClearedNow ? 'cleared; no team agent has run since' : 'no team agent has run this session'}</Text>}
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
              </Box>
            )
          })}
          {rows.length > TEAM_ROWS && <Text dimColor>+{rows.length - TEAM_ROWS} earlier</Text>}
        </Box>

        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => refresh($)} />
          <Button
            key="tasks" label={isAll ? 'fold tasks' : 'all tasks'} hotkey="a"
            onPress={async () => { await update($, isAllTasksShown, v => !v); await openPane($) }}
          />
          <Button key="band" label="toggle band" hotkey="t" onPress={() => update($, isBandHidden, h => !h)} />
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
