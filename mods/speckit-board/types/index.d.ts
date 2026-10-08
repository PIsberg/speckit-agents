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
  // SubagentHandback is the internal tool a backgrounded agent reports through. The tool list Claude
  // Code lays beside the mod (claude-code-tools) leaves it out, so a matcher naming it did not
  // type-check (#33). Only `message`, the report, is read; hooks/speckit-team.mjs reads the same field.
  interface BuiltinToolInputs {
    SubagentHandback: { message: string }
  }

  interface PluginState {
    'speckit-board': {
      board: SpeckitBoard | null
      agents: SpeckitAgent[]
      isBandHidden: boolean
    }
  }
}
