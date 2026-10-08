export type SpeckitPhaseId = 'spec' | 'plan' | 'tasks' | 'audit' | 'build' | 'verify'

export type SpeckitPhaseState = 'done' | 'active' | 'todo' | 'blocked' | 'failed' | 'stale'

export type SpeckitPhase = { id: SpeckitPhaseId; state: SpeckitPhaseState; note: string }

export type SpeckitTask = {
  id: string
  text: string
  section: string
  isDone: boolean
  isParallel: boolean
}

export type SpeckitBoard = {
  feature: string
  phases: SpeckitPhase[]
  tasks: SpeckitTask[]
  red: number
  maxRed: number
  // The retry record cannot be read, so the gate blocks implementer whatever `red` says.
  isRetryUnreadable: boolean
  fingerprint: string
}

export type SpeckitAgent = {
  id: string
  type: string
  isRunning: boolean
  outcome: string
  startedAt: number
  endedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'speckit-board': {
      board: SpeckitBoard | null
      agents: SpeckitAgent[]
      isBandHidden: boolean
    }
  }
}
