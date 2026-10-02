export type PrState = 'draft' | 'changes requested' | 'approved' | 'ready for review'

export type Pr = { repo: string; number: number; title: string; url: string; state: PrState }

export type View = {
  login?: string
  prs: Pr[]
  total: number
  updatedAt?: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pr-pane': { view: View; visible: boolean }
  }
}
