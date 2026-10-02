import type { Pr, PrState, SortBy } from '../types'

export const LIMIT = 100  // GraphQL search page maximum

// `gh search prs --json` has no review decision; GraphQL search does.
export const QUERY = `query{search(query:"is:pr is:open author:@me archived:false sort:updated-desc",type:ISSUE,first:${LIMIT}){issueCount nodes{... on PullRequest{id number title url isDraft reviewDecision updatedAt repository{nameWithOwner} reviewThreads(first:${LIMIT}){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}}`

export const THREADS_QUERY = `query($id:ID!,$after:String!){node(id:$id){... on PullRequest{reviewThreads(first:${LIMIT},after:$after){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}`

export const stateOf = (isDraft: boolean, decision: string | null, hasFeedback = false): PrState =>
  isDraft
    ? 'draft'
    : decision === 'CHANGES_REQUESTED' || hasFeedback
      ? 'has feedback'
      : decision === 'APPROVED'
        ? 'approved'
        : 'needs review'

export type ThreadPage = {
  nodes: ({ isResolved: boolean } | null)[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

export type PullRequestNode = {
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
  reviewDecision: string | null
  updatedAt: string
  repository: { nameWithOwner: string }
  reviewThreads: ThreadPage
}

export const total = (stdout: string): number => JSON.parse(stdout).data.search.issueCount

// Status sorting puts feedback first and drafts last.
export const ORDER: readonly PrState[] = ['has feedback', 'approved', 'needs review', 'draft']

export const parse = (stdout: string): Pr[] =>
  (JSON.parse(stdout).data.search.nodes as (PullRequestNode | null)[])
    .filter((n): n is PullRequestNode => n !== null && !!n.url)
    .map(n => ({
      repo: n.repository.nameWithOwner,
      number: n.number,
      title: n.title,
      url: n.url,
      state: stateOf(n.isDraft, n.reviewDecision, n.reviewThreads?.nodes?.some(t => t?.isResolved === false)),
      updatedAt: n.updatedAt,
    }))

export const sorted = (prs: readonly Pr[], by: SortBy): Pr[] =>
  [...prs].sort((a, b) =>
    (by === 'repo' ? a.repo.localeCompare(b.repo) : by === 'status' ? ORDER.indexOf(a.state) - ORDER.indexOf(b.state) : 0)
    || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    || a.repo.localeCompare(b.repo)
    || a.number - b.number
    || a.url.localeCompare(b.url),
  )

export const COLOR: Record<PrState, string | undefined> = {
  'has feedback': 'red',
  approved: 'blue',
  'needs review': '#ffa500',
  draft: undefined,
}

export const GLYPH: Record<PrState, string> = {
  draft: '○',
  'has feedback': '✗',
  approved: '✓',
  'needs review': '●',
}

export const SHORT: Record<PrState, string> = {
  draft: 'draft',
  'has feedback': 'comments/changes',
  approved: 'approved',
  'needs review': 'needs review',
}

export const counts = (prs: readonly Pr[]): { state: PrState; n: number }[] =>
  ORDER.map(state => ({ state, n: prs.filter(p => p.state === state).length })).filter(c => c.n > 0)

// The glyph carries the state (the header legend names it); the owner is dropped
// unless two listed repos share a name.
export const row = (p: Pr, all: readonly Pr[]): string => {
  const name = p.repo.split('/')[1] ?? p.repo
  const isAmbiguous = all.some(o => o.repo !== p.repo && o.repo.endsWith(`/${name}`))
  return `${GLYPH[p.state]} ${isAmbiguous ? p.repo : name}#${p.number} ${p.title}`
}
