import type { Pr, PrState } from '../types'

export const LIMIT = 100  // GraphQL search page maximum

// `gh search prs --json` has no review decision; GraphQL search does.
export const QUERY = `query{search(query:"is:pr is:open author:@me archived:false",type:ISSUE,first:${LIMIT}){issueCount nodes{... on PullRequest{number title url isDraft reviewDecision repository{nameWithOwner}}}}}`

export const stateOf = (isDraft: boolean, decision: string | null): PrState =>
  isDraft
    ? 'draft'
    : decision === 'CHANGES_REQUESTED'
      ? 'changes requested'
      : decision === 'APPROVED'
        ? 'approved'
        : 'ready for review'

type Node = {
  number: number
  title: string
  url: string
  isDraft: boolean
  reviewDecision: string | null
  repository: { nameWithOwner: string }
} | null

export const total = (stdout: string): number => JSON.parse(stdout).data.search.issueCount

// Rows are grouped in this order: what needs the author first, drafts last.
export const ORDER: readonly PrState[] = ['changes requested', 'approved', 'ready for review', 'draft']

export const parse = (stdout: string): Pr[] =>
  (JSON.parse(stdout).data.search.nodes as Node[])
    .filter((n): n is NonNullable<Node> => n !== null && !!n.url)
    .map(n => ({
      repo: n.repository.nameWithOwner,
      number: n.number,
      title: n.title,
      url: n.url,
      state: stateOf(n.isDraft, n.reviewDecision),
    }))
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state))

export const GLYPH: Record<PrState, string> = {
  draft: '○',
  'changes requested': '✗',
  approved: '✓',
  'ready for review': '●',
}

export const SHORT: Record<PrState, string> = {
  draft: 'draft',
  'changes requested': 'changes',
  approved: 'approved',
  'ready for review': 'ready',
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
