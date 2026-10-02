export type PrState = 'draft' | 'has feedback' | 'approved' | 'needs review'

export type SortBy = 'repo' | 'status' | 'date'

export type Pr = { repo: string; number: number; title: string; url: string; state: PrState; updatedAt: string }

export type View = {
  login?: string
  prs: Pr[]
  total: number
  updatedAt?: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pr-pane': { view: View; visible: boolean; sort: SortBy; page: number }
  }
}
