// Pure logic of the board: no `$`, so tests import it directly.
// The state files and their rules mirror hooks/speckit-team.mjs; test/board-mod.test.mjs checks
// the fingerprint below matches it byte for byte, or every audit would read stale.
import type { SpeckitPhase, SpeckitPhaseState, SpeckitTask } from '../types'

export const MAX_RED = 3
export const MISSING = '<missing>'

export const TEAM = ['product-owner', 'architect', 'spec-auditor', 'test-writer', 'implementer', 'spec-gatekeeper'] as const

// `speckit-agents:architect` and `architect` are the same team member.
export const teamRole = (agentType: string): string | undefined =>
  TEAM.find(role => agentType === role || agentType.endsWith(`:${role}`))

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

  const v = i.verdict
  const audit = v === undefined
    ? phase('audit', idle('spec-auditor'))
    : v === null || typeof v !== 'object'
      ? phase('audit', 'failed', 'unreadable')
      : v.verdict !== 'PASS'
        ? phase('audit', runs('spec-auditor') ? 'active' : 'failed', String(v.verdict ?? '?'))
        : v.fingerprint !== i.fingerprint
          ? phase('audit', runs('spec-auditor') ? 'active' : 'stale', 'edited since PASS')
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

// The verdict word an agent's report ends on, per the team's report rules.
export function outcomeOf(role: string | undefined, report: string): string {
  const last = (re: RegExp) => [...report.matchAll(re)].pop()?.[1]?.toUpperCase()
  if (role === 'spec-auditor') return last(/^[\s*>#]*VERDICT:?[\s*]*(PASS|FAIL)\b/gim) ?? ''
  if (role === 'implementer') return last(/^[\s*>#]*RESULT:?[\s*]*(GREEN|RED|STUB)\b/gim) ?? ''
  if (role === 'spec-gatekeeper') return last(/\b(APPROVED|REJECTED)\b/gi) ?? ''
  const line = report.trim().split('\n').pop() ?? ''
  return line.replace(/^[\s*>#`]+|[\s*`.]+$/g, '').slice(0, 40)
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
