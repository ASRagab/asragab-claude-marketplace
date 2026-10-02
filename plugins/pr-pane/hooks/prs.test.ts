import { test, expect } from 'claude-code/testing'

import type { Pr } from '../types'
import { parse, sorted, stateOf } from './prs'

const node = (number: number, decision: string | null, resolved: (boolean | null)[], isDraft = false) => ({
  id: `pr-${number}`,
  number,
  title: `pr ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  isDraft,
  reviewDecision: decision,
  updatedAt: '2026-10-02T12:00:00Z',
  repository: { nameWithOwner: 'o/r' },
  reviewThreads: {
    nodes: resolved.map(isResolved => isResolved === null ? null : ({ isResolved })),
    pageInfo: { hasNextPage: false, endCursor: null },
  },
})

const pr = (number: number, repo: string, state: Pr['state'], updatedAt: string): Pr => ({
  repo,
  number,
  state,
  updatedAt,
  title: `pr ${number}`,
  url: `https://github.com/${repo}/pull/${number}`,
})

test('drafts stay draft; feedback wins over approval; other decisions need review', () => {
  expect(stateOf(true, 'CHANGES_REQUESTED', true)).toBe('draft')
  expect(stateOf(true, 'APPROVED', true)).toBe('draft')
  expect(stateOf(false, 'CHANGES_REQUESTED')).toBe('has feedback')
  expect(stateOf(false, 'APPROVED', true)).toBe('has feedback')
  expect(stateOf(false, null, true)).toBe('has feedback')
  expect(stateOf(false, 'APPROVED')).toBe('approved')
  expect(stateOf(false, 'REVIEW_REQUIRED')).toBe('needs review')
  expect(stateOf(false, null)).toBe('needs review')
})

test('parse detects unresolved feedback, ignores resolved threads, and keeps API order and date', () => {
  const prs = parse(JSON.stringify({ data: { search: { nodes: [
    node(1, 'APPROVED', [true, null]),
    node(2, 'APPROVED', [true, false]),
    null,
    node(3, 'CHANGES_REQUESTED', [true]),
    node(4, 'APPROVED', [false], true),
    node(5, null, []),
  ] } } }))
  expect(prs.map(p => [p.number, p.state])).toEqual([
    [1, 'approved'], [2, 'has feedback'], [3, 'has feedback'], [4, 'draft'], [5, 'needs review'],
  ])
  expect(prs[0]?.updatedAt).toBe('2026-10-02T12:00:00Z')
})

test('date sort compares instants across timezones and breaks equal dates by repo then number', () => {
  const prs = [
    pr(4, 'z/r', 'approved', '2026-10-02T05:00:00-07:00'),
    pr(3, 'a/r', 'draft', '2026-10-02T10:30:00Z'),
    pr(2, 'a/r', 'needs review', '2026-10-02T12:00:00Z'),
    pr(1, 'a/r', 'has feedback', '2026-10-02T14:00:00+02:00'),
  ]
  expect(sorted(prs, 'date').map(p => p.number)).toEqual([1, 2, 4, 3])
  expect(sorted([...prs].reverse(), 'date').map(p => p.number)).toEqual([1, 2, 4, 3])
})

test('repo and status sorts use newest date within their groups without mutating the input', () => {
  const prs = [
    pr(1, 'z/r', 'draft', '2026-10-02T12:00:00Z'),
    pr(2, 'a/r', 'needs review', '2026-10-02T11:00:00Z'),
    pr(3, 'a/r', 'approved', '2026-10-02T09:00:00Z'),
    pr(4, 'z/r', 'has feedback', '2026-10-02T08:00:00Z'),
    pr(5, 'a/r', 'approved', '2026-10-02T10:00:00Z'),
  ]
  const before = JSON.stringify(prs)
  expect(sorted(prs, 'repo').map(p => p.number)).toEqual([2, 5, 3, 1, 4])
  expect(sorted(prs, 'status').map(p => p.number)).toEqual([4, 5, 3, 2, 1])
  expect(JSON.stringify(prs)).toBe(before)
  expect(sorted(prs, 'status') === prs).toBe(false)
})
