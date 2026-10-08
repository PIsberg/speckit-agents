// Pure logic of the board: no `$`, so tests import it directly.
// The state files and their rules mirror hooks/speckit-team.mjs; test/board-mod.test.mjs checks
// the fingerprint below matches it byte for byte, or every audit would read stale.
import type { SpeckitBoard, SpeckitPhase, SpeckitPhaseId, SpeckitPhaseState, SpeckitTask } from '../types'

export const MAX_RED = 3
export const MISSING = '<missing>'

export const TEAM = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'] as const

// `speckit-agents:architect` and `architect` are the same team member.
export const teamRole = (agentType: string): string | undefined =>
  TEAM.find(role => agentType === role || agentType.endsWith(`:${role}`))

// The `color:` line of each agents/<role>.md, which Claude Code draws that agent's name in, through
// the theme key below. test/board-mod.test.mjs holds the two together.
export const ROLE_COLOR: Record<string, string> = {
  'product-owner': 'blue', architect: 'purple', 'spec-auditor': 'yellow',
  'test-writer': 'orange', implementer: 'green', 'spec-gatekeeper': 'red',
}

export const roleColor = (role: string): string | undefined =>
  ROLE_COLOR[role] === undefined ? undefined : `${ROLE_COLOR[role]}_FOR_SUBAGENTS_ONLY`

// Who works each phase: a running agent of the phase's role is its work under way.
export const PHASE_ROLES: Record<SpeckitPhaseId, readonly string[]> = {
  spec: ['product-owner'], plan: ['architect'], tasks: ['architect'], audit: ['spec-auditor'],
  build: ['test-writer', 'implementer'], verify: ['spec-gatekeeper'],
}

// The words each role's report ends on, per its agent file, by whether its work came out as it should.
// A test-writer's RED is its job done; an implementer's is a failed attempt.
const WORDS: Record<string, { good: readonly string[]; bad: readonly string[] }> = {
  'product-owner': { good: ['READY FOR PLAN'], bad: [] },
  'spec-auditor': { good: ['PASS'], bad: ['FAIL'] },
  'test-writer': { good: ['RED'], bad: ['BLOCKED'] },
  implementer: { good: ['GREEN'], bad: ['RED'] },
  'spec-gatekeeper': { good: ['APPROVED'], bad: ['REJECTED'] },
}

// Claude Code's own word for an agent that ended without a report: stopped, or an API error.
export const ENDED_UNREPORTED: readonly string[] = ['killed', 'failed']

export type Tone = 'good' | 'bad' | 'neutral'

export function toneOf(role: string, outcome: string): Tone {
  if (ENDED_UNREPORTED.includes(outcome)) return 'bad'
  const words = WORDS[role]
  return words?.good.includes(outcome) ? 'good' : words?.bad.includes(outcome) ? 'bad' : 'neutral'
}

export const TONE_GLYPH: Record<Tone, string> = { good: '✓', bad: '✗', neutral: '•' }
export const TONE_COLOR: Record<Tone, string> = { good: 'success', bad: 'error', neutral: 'subtle' }

// The active feature as feature() in speckit-team.mjs reads it: repo-relative with forward slashes, or
// '' when it is not a path inside the repo. The fingerprint hashes the path with the text, so an
// absolute feature_directory left as given would disagree with the gate. Unlike the hook, this does
// not resolve symlinks.
export function featureDir(raw: unknown, root: string): string {
  if (typeof raw !== 'string' || !raw) return ''
  const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const top = slash(root)
  let rel = slash(raw)
  if (rel.startsWith('/') || /^[A-Za-z]:\//.test(rel)) {
    const fold = /^[A-Za-z]:\//.test(top) ? (p: string) => p.toLowerCase() : (p: string) => p
    if (!fold(rel).startsWith(`${fold(top)}/`)) return ''
    rel = rel.slice(top.length + 1)
  }
  const segs: string[] = []
  for (const s of rel.split('/')) {
    if (s === '' || s === '.') continue
    if (s !== '..') segs.push(s)
    else if (!segs.pop()) return ''
  }
  return segs.join('/')
}

export const fingerprintFiles = (feature: string): string[] => [
  '.specify/memory/constitution.md', `${feature}/spec.md`, `${feature}/plan.md`, `${feature}/tasks.md`,
]

// Ticking a checkbox must not invalidate the audit, so checkbox state is normalised away.
const normalise = (text: string): string =>
  text.replace(/\r\n/g, '\n').replace(/^(\s*[-*]\s+\[)[xX ](\])/gm, '$1 $2')

export async function fingerprint(files: readonly { path: string; text: string }[]): Promise<string> {
  const joined = files.map(f => `${f.path}\0${normalise(f.text)}\0`).join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

export function parseTasks(markdown: string): SpeckitTask[] {
  const tasks: SpeckitTask[] = []
  let section = ''
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) { section = heading[1] ?? ''; continue }
    const task = /^\s*[-*]\s+\[([ xX])\]\s+(T\d+)\s*(.*)$/.exec(line)
    if (!task) continue
    const rest = task[3] ?? ''
    tasks.push({
      id: task[2] ?? '',
      text: rest.replace(/\[P\]\s*/g, '').trim(),
      section,
      isDone: task[1] !== ' ',
      isParallel: /\[P\]/.test(rest),
    })
  }
  return tasks
}

// What the team hook recorded, as read back: `undefined` missing, `null` unreadable.
export type Verdict = { verdict?: unknown; fingerprint?: unknown; at?: unknown } | null | undefined
export type Retries = { fingerprint?: unknown; red?: unknown } | null | undefined

export const redCount = (r: Retries, fp: string): number =>
  r && r.fingerprint === fp && Array.isArray(r.red) ? r.red.length : 0

export type BoardInputs = {
  spec: string | undefined
  plan: string | undefined
  tasks: SpeckitTask[] | undefined
  verdict: Verdict
  fingerprint: string
  red: number
  // The retry record exists but is not JSON: the gate then denies implementer until it is deleted.
  isRetryUnreadable?: boolean
  gate: string | undefined
  // When the hook recorded the gate word (ISO time); absent for a word from the plugin store.
  gateAt?: string
  running: readonly string[]
}

const phase = (id: SpeckitPhase['id'], state: SpeckitPhaseState, note = ''): SpeckitPhase => ({ id, state, note })

export function derivePhases(i: BoardInputs): SpeckitPhase[] {
  const runs = (role: string) => i.running.includes(role)
  const idle = (role: string): SpeckitPhaseState => (runs(role) ? 'active' : 'todo')

  // /speckit-team approves the spec in conversation and never edits its Status line, so a plan
  // (which the architect writes only after that approval) also counts as the spec being approved.
  const spec = i.spec === undefined
    ? phase('spec', idle('product-owner'))
    : /\*\*Status\*\*:\s*Approved/i.test(i.spec)
      ? phase('spec', 'done', 'approved')
      : i.plan !== undefined
        ? phase('spec', 'done')
        : phase('spec', 'active', 'draft')
  const plan = i.plan === undefined ? phase('plan', idle('architect')) : phase('plan', 'done')
  const tasks = i.tasks === undefined
    ? phase('tasks', idle('architect'))
    : phase('tasks', 'done', `${i.tasks.length} tasks`)

  // A verdict on files since changed is about files nobody has audited, a FAIL as much as a PASS:
  // they want a new audit, not the FAIL's findings fixed again.
  const v = i.verdict
  const said = v && typeof v === 'object' ? String(v.verdict ?? '?') : ''
  const audit = v === undefined
    ? phase('audit', idle('spec-auditor'))
    : v === null || typeof v !== 'object'
      ? phase('audit', 'failed', 'unreadable')
      : v.fingerprint !== i.fingerprint
        ? phase('audit', runs('spec-auditor') ? 'active' : 'stale', `edited since ${said}`)
        : v.verdict !== 'PASS'
          ? phase('audit', runs('spec-auditor') ? 'active' : 'failed', said)
          : phase('audit', 'done', 'PASS')

  const list = i.tasks ?? []
  const done = list.filter(t => t.isDone).length
  const progress = `${done}/${list.length}`
  const build = list.length > 0 && done === list.length
    ? phase('build', 'done', progress)
    : audit.state !== 'done'
      ? phase('build', list.length ? 'blocked' : 'todo', list.length ? 'gate closed' : '')
      : i.red >= MAX_RED
        ? phase('build', 'failed', 'retry limit')
        : i.isRetryUnreadable
          ? phase('build', 'failed', 'retry record unreadable')
            : runs('test-writer') || runs('implementer') || done > 0
            ? phase('build', 'active', progress)
            : phase('build', 'todo', progress)

  // The gatekeeper judged the files the audit passed. Once those change, or a later audit passes
  // new ones, its word is about old files. ISO times compare as strings.
  const auditAt = v && typeof v === 'object' && typeof v.at === 'string' ? v.at : undefined
  const verify = runs('spec-gatekeeper')
    ? phase('verify', 'active')
    : i.gate !== 'APPROVED' && i.gate !== 'REJECTED'
      ? phase('verify', 'todo')
      : audit.state !== 'done' || (i.gateAt !== undefined && auditAt !== undefined && i.gateAt < auditAt)
        ? phase('verify', 'stale', 'audit changed')
        : i.gate === 'APPROVED'
          ? phase('verify', 'done', 'approved')
          : phase('verify', 'failed', 'rejected')

  return [spec, plan, tasks, audit, build, verify]
}

// The word an agent's report ends on, per the team's report rules; '' for a report without one, and
// for architect, whose report has no word.
export function outcomeOf(role: string | undefined, report: string): string {
  const last = (re: RegExp) => [...report.matchAll(re)].pop()?.[1]?.toUpperCase()
  if (role === 'spec-auditor') return last(/^[\s*>#]*VERDICT:?[\s*]*(PASS|FAIL)\b/gim) ?? ''
  if (role === 'implementer') return last(/^[\s*>#]*RESULT:?[\s*]*(GREEN|RED|STUB)\b/gim) ?? ''
  const line = (report.trim().split('\n').pop() ?? '').replace(/^[\s*>#`]+|[\s*`.]+$/g, '').toUpperCase()
  // Only a last line that is the word itself, as the hook's `ends` check accepts it: anywhere in the
  // text, "not approved" read as an approval. Any other last line (a question, a decision to confirm)
  // was shown as the word, cut at 40 characters.
  const words = WORDS[role ?? '']
  return words && [...words.good, ...words.bad].includes(line) ? line : ''
}

export const GLYPH: Record<SpeckitPhaseState, string> = {
  done: '✓', active: '◐', todo: '○', blocked: '⊘', failed: '✗', stale: '↻',
}

export const COLOR: Record<SpeckitPhaseState, string> = {
  done: 'success', active: 'claude', todo: 'subtle', blocked: 'warning', failed: 'error', stale: 'warning',
}

export const SPINNER = ['◐', '◓', '◑', '◒'] as const

export function bar(done: number, total: number, width: number): string {
  const cells = Math.max(1, width)
  const filled = total === 0 ? 0 : Math.round((done / total) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export function since(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// The phase the team is on: the first one not done.
export const current = (phases: readonly SpeckitPhase[]): SpeckitPhase | undefined =>
  phases.find(p => p.state !== 'done')

export const spinnerAt = (now: number): string => SPINNER[Math.floor(now / 250) % SPINNER.length] ?? SPINNER[0]

export const nextTask = (tasks: readonly SpeckitTask[]): SpeckitTask | undefined => tasks.find(t => !t.isDone)

// Claude Code names the plugin before a status, so the text starts at the feature; the build count
// shows once, in build's note while it is the current phase.
export function statusLine(b: SpeckitBoard | null): string | undefined {
  if (!b) return undefined
  const now = current(b.phases)
  const progress = `${b.tasks.filter(t => t.isDone).length}/${b.tasks.length}`
  const where = now ? `${GLYPH[now.state]} ${now.id}${now.note ? ` (${now.note})` : ''}` : '✓ verified'
  const count = b.tasks.length && now?.note !== progress ? ` · ${progress} tasks` : ''
  return `${b.feature} · ${where}${count}${b.red ? ` · RED ${b.red}/${b.maxRed}` : ''}`
}

// What the pipeline needs next, as skills/speckit-team/SKILL.md runs it: while building, the next
// open task in tasks.md order, whoever runs; otherwise who is at work, or what to start.
export function nextStep(b: SpeckitBoard, running: readonly string[]): { text: string; task?: SpeckitTask } {
  const head = current(b.phases)
  if (!head) return { text: 'ready for the PR' }
  if (head.id === 'build' && head.state === 'failed') {
    return {
      text: b.isRetryUnreadable
        ? `delete .git/speckit-team/retries/${b.feature}.json`
        : 'retry limit: architect rethinks the task, then re-audit',
    }
  }
  const task = head.id === 'build' ? nextTask(b.tasks) : undefined
  if (task) return { text: `${task.id} ${task.text}`, task }
  const busy = PHASE_ROLES[head.id].find(role => running.includes(role))
  return { text: busy ? `waiting for ${busy}` : idleStep(head) }
}

function idleStep(head: SpeckitPhase): string {
  switch (head.id) {
    case 'spec': return head.state === 'todo' ? 'start with /speckit-team <idea>' : 'review spec.md, then plan'
    case 'plan':
    case 'tasks': return 'architect: write plan.md and tasks.md'
    case 'audit':
      return head.state === 'stale' ? 're-audit: spec, plan or tasks changed'
        : head.note === 'unreadable' ? 'verdict unreadable: run spec-auditor again'
          : head.state === 'failed' ? 'route CRITICAL/HIGH findings, then re-audit'
            : 'spec-auditor: audit spec, plan and tasks'
    case 'build': return 'tasks.md lists no tasks'
    case 'verify':
      return head.state === 'stale' ? 're-run spec-gatekeeper: the audit changed'
        : head.state === 'failed' ? 'route the REJECTED reasons, then re-run spec-gatekeeper'
          : 'spec-gatekeeper: check every requirement has a test'
  }
}

// `/speckit-board status`: the board as text, for a session without the pane (a headless run) and for
// the model, which reads a command's answer as well.
export function boardText(b: SpeckitBoard, running: readonly { type: string; startedAt: number }[], now: number): string {
  const lines = [
    statusLine(b) ?? '',
    b.phases.map(p => `${GLYPH[p.state]} ${p.id}`).join(' '),
    `next: ${nextStep(b, running.map(a => a.type)).text}`,
  ]
  if (running.length) lines.push(`running: ${running.map(a => `${a.type} ${since(now - a.startedAt)}`).join(', ')}`)
  return lines.join('\n')
}

export type TaskSection = { title: string; done: number; total: number; isOpen: boolean; tasks: SpeckitTask[] }

// A finished section, and one not started past the next task, fold to their title and count.
export function taskSections(tasks: readonly SpeckitTask[], isAllShown: boolean): TaskSection[] {
  const next = nextTask(tasks)
  return [...new Set(tasks.map(t => t.section))].map(title => {
    const list = tasks.filter(t => t.section === title)
    const done = list.filter(t => t.isDone).length
    const isStarted = done > 0 || (next !== undefined && list.includes(next))
    return { title, done, total: list.length, isOpen: isAllShown || (done < list.length && isStarted), tasks: list }
  })
}

export type BandItem =
  | { kind: 'feature' | 'sep' | 'bar' | 'count'; text: string }
  | { kind: 'phase'; text: string; state: SpeckitPhaseState; isHead: boolean }
  | { kind: 'red'; text: string; isLimit: boolean }
  // `room`: the columns it is laid out in, its running time counted as wide as `59m 59s`.
  | { kind: 'agent'; text: string; spin: string; role: string; rest: string; room: number }
  | { kind: 'button'; text: string; key: 'board' | 'hide'; label: string }

type BandVariant = { names: 'all' | 'head' | 'only-head'; bar: number; isHideShown: boolean; isBoardShown: boolean }

// Richest first; the band draws the first that fits its columns, so it never wraps. The current
// phase stays named in every one: bare glyphs said nothing below 100 columns. The buttons go before
// the other phases' glyphs: /speckit-board does what `board` does, and beside a docked pane, the band
// at its narrowest there, the pane is open already.
const VARIANTS: readonly BandVariant[] = [
  { names: 'all', bar: 10, isHideShown: true, isBoardShown: true },
  { names: 'head', bar: 10, isHideShown: true, isBoardShown: true },
  { names: 'head', bar: 5, isHideShown: true, isBoardShown: true },
  { names: 'head', bar: 0, isHideShown: true, isBoardShown: true },
  { names: 'head', bar: 0, isHideShown: false, isBoardShown: true },
  { names: 'head', bar: 0, isHideShown: false, isBoardShown: false },
  { names: 'only-head', bar: 0, isHideShown: false, isBoardShown: false },
]

const TIME_ROOM = '59m 59s'.length

// One gap between items, as the band's Box lays them out; a Button is drawn `[ label ]`. A running
// time counts at its widest, so the band keeps its shape as the seconds grow.
const widthOf = (items: readonly BandItem[]): number =>
  items.reduce((n, item) => n + (item.kind === 'agent' ? item.room : item.text.length), 0) + items.length - 1

export function bandLayout(
  b: SpeckitBoard, running: readonly { type: string; startedAt: number }[], now: number, cols: number,
): BandItem[] {
  const head = current(b.phases)
  const named = head ?? b.phases.at(-1)
  const done = b.tasks.filter(t => t.isDone).length
  const layout = (v: BandVariant): BandItem[] => {
    const items: BandItem[] = [{ kind: 'feature', text: `◆ ${b.feature}` }]
    for (const p of b.phases) {
      if (v.names === 'only-head' && p !== named) continue
      const text = v.names === 'all' || p === named ? `${GLYPH[p.state]} ${p.id}` : GLYPH[p.state]
      items.push({ kind: 'phase', text, state: p.state, isHead: p === head })
    }
    if (b.tasks.length) {
      if (v.names !== 'only-head') items.push({ kind: 'sep', text: '│' })
      if (v.bar) items.push({ kind: 'bar', text: bar(done, b.tasks.length, v.bar) })
      items.push({ kind: 'count', text: `${done}/${b.tasks.length}` })
    }
    if (b.red > 0) items.push({ kind: 'red', text: `RED ${b.red}/${b.maxRed}`, isLimit: b.red >= b.maxRed })
    const [first, ...others] = running
    if (first) {
      const spin = spinnerAt(now)
      const more = others.length ? ` +${others.length}` : ''
      const rest = `${more} ${since(now - first.startedAt)}`
      const room = `${spin} ${first.type}${more} `.length + TIME_ROOM
      items.push({ kind: 'agent', text: `${spin} ${first.type}${rest}`, spin, role: first.type, rest, room })
    }
    if (v.isBoardShown) items.push({ kind: 'button', text: '[ board ]', key: 'board', label: 'board' })
    if (v.isHideShown) items.push({ kind: 'button', text: '[ hide ]', key: 'hide', label: 'hide' })
    return items
  }
  const layouts = VARIANTS.map(layout)
  return layouts.find(items => widthOf(items) <= cols) ?? layouts.at(-1) ?? []
}
