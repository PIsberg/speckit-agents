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
  // Spec Kit alone: four phases (spec, plan, tasks, build), no gate, no agents drawn.
  isStandalone?: boolean
}

export type SpeckitAgent = {
  id: string
  type: string
  // What the Agent call said the task was, from Claude Code's agent list; absent on an agent recorded
  // before a reload of an older version of the mod.
  description?: string
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
      // Why there is no board: one of noticeText's lines; '' while there is one.
      notice: string
      agents: SpeckitAgent[]
      isBandHidden: boolean
      // The band is held off until the next team agent starts; session state, not stored.
      isCleared: boolean
      // The pane lists every task, not only the sections under way.
      isAllTasksShown: boolean
      // Features a team agent started on in this session, each as `teamKey` of its repository and
      // folder (#97); they get the team view (D1-A).
      teamFeatures: string[]
    }
  }
}
