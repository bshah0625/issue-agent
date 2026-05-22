import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Issue, ProjectConfig } from '../src/types'

const mockProjectConfig: ProjectConfig = {
  repoOwner: 'test-owner',
  repoName: 'test-repo',
  baseBranch: 'main',
  localPath: '/tmp/test-repo',
  ciCommands: {
    typecheck: 'npx tsc --noEmit',
    lint: 'npx eslint . --ext .ts',
    test: 'npx vitest run',
  },
  testPathPattern: '__tests__/**/*.test.ts',
  agentReadyLabel: 'agent-ready',
  maxCIAttempts: 3,
}

const makeIssue = (overrides: Partial<Issue> = {}): Issue => ({
  number: 42,
  title: 'Add MPG chart to dashboard',
  body: 'Users need to see fuel efficiency over time',
  labels: ['enhancement'],
  type: 'feature',
  ...overrides,
})

describe('planFromIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('always includes at least one test file in the plan', async () => {
    const { planFromIssue } = await import('../src/planner')
    const plan = await planFromIssue(makeIssue(), 'src/\n  app.ts', mockProjectConfig)
    expect(plan.testFiles.length).toBeGreaterThanOrEqual(1)
  })

  it('sets issueType to "bug" for issues labeled "bug"', async () => {
    const { planFromIssue } = await import('../src/planner')
    const issue = makeIssue({ labels: ['bug'], type: 'bug' })
    const plan = await planFromIssue(issue, 'src/\n  app.ts', mockProjectConfig)
    expect(plan.issue.type).toBe('bug')
  })

  it('sets issueType to "feature" for issues labeled "enhancement"', async () => {
    const { planFromIssue } = await import('../src/planner')
    const issue = makeIssue({ labels: ['enhancement'], type: 'feature' })
    const plan = await planFromIssue(issue, 'src/\n  app.ts', mockProjectConfig)
    expect(plan.issue.type).toBe('feature')
  })

  it('generates a valid branch name from issue number and title', async () => {
    const { planFromIssue } = await import('../src/planner')
    const plan = await planFromIssue(makeIssue(), 'src/\n  app.ts', mockProjectConfig)
    expect(plan.branchName).toMatch(/^(feat|fix)\/issue-42-/)
  })

  it('branch name is lowercase with hyphens only — no special characters', async () => {
    const { planFromIssue } = await import('../src/planner')
    const issue = makeIssue({ title: 'Fix: the bug!! @#$ with spaces & symbols' })
    const plan = await planFromIssue(issue, '', mockProjectConfig)
    const slug = plan.branchName.split('/').at(-1) ?? ''
    expect(slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('branch name prefix is "feat/" for features and "fix/" for bugs', async () => {
    const { planFromIssue } = await import('../src/planner')
    const featurePlan = await planFromIssue(makeIssue({ type: 'feature' }), '', mockProjectConfig)
    expect(featurePlan.branchName).toMatch(/^feat\//)

    const bugPlan = await planFromIssue(makeIssue({ type: 'bug' }), '', mockProjectConfig)
    expect(bugPlan.branchName).toMatch(/^fix\//)
  })

  it('branch name slug is truncated to 40 characters max', async () => {
    const { planFromIssue } = await import('../src/planner')
    const issue = makeIssue({
      title:
        'This is an extremely long title that should definitely be truncated because it exceeds forty characters',
    })
    const plan = await planFromIssue(issue, '', mockProjectConfig)
    const slug = plan.branchName.split('/').slice(1).join('/')
    expect(slug.length).toBeLessThanOrEqual(40)
  })

  it('throws a descriptive error if Claude returns malformed JSON', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'this is not json at all' }],
          }),
        },
      } as never
    })
    const { planFromIssue } = await import('../src/planner')
    await expect(planFromIssue(makeIssue(), '', mockProjectConfig)).rejects.toThrow(
      /malformed|invalid|JSON/i
    )
  })

  it('falls back to String() when the API rejects with a non-Error value', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockRejectedValue('quota exceeded'),
        },
      } as never
    })
    const { planFromIssue } = await import('../src/planner')
    await expect(planFromIssue(makeIssue(), '', mockProjectConfig)).rejects.toThrow(
      /Claude API|failed to generate plan/i
    )
  })

  it('throws a descriptive error when the Claude API call itself fails', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockRejectedValue(new Error('Rate limit exceeded')),
        },
      } as never
    })
    const { planFromIssue } = await import('../src/planner')
    await expect(planFromIssue(makeIssue(), '', mockProjectConfig)).rejects.toThrow(
      /Claude API|failed to generate plan/i
    )
  })

  it('throws when Claude returns valid JSON but testFiles is empty', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  summary: 'test',
                  issueType: 'feature',
                  testFiles: [],
                  implementationFiles: [{ path: 'src/x.ts', action: 'create', description: 'x' }],
                }),
              },
            ],
          }),
        },
      } as never
    })
    const { planFromIssue } = await import('../src/planner')
    await expect(planFromIssue(makeIssue(), '', mockProjectConfig)).rejects.toThrow(
      /testFiles must be a non-empty array/i
    )
  })

  it('throws when Claude returns valid JSON but implementationFiles is missing', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  summary: 'test',
                  issueType: 'feature',
                  testFiles: [{ path: 'x.test.ts', action: 'create', description: 'x' }],
                }),
              },
            ],
          }),
        },
      } as never
    })
    const { planFromIssue } = await import('../src/planner')
    await expect(planFromIssue(makeIssue(), '', mockProjectConfig)).rejects.toThrow(
      /implementationFiles must be an array/i
    )
  })

  it('returns non-empty testFiles and implementationFiles arrays', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const validPlanJson = JSON.stringify({
      summary: 'Add MPG chart',
      issueType: 'feature',
      testFiles: [{ path: '__tests__/chart.test.ts', action: 'create', description: 'Test chart' }],
      implementationFiles: [
        { path: 'src/chart.ts', action: 'create', description: 'Implement chart' },
      ],
    })
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: validPlanJson }],
          }),
        },
      } as never
    })
    const { planFromIssue } = await import('../src/planner')
    const plan = await planFromIssue(makeIssue(), '', mockProjectConfig)
    expect(plan.testFiles.length).toBeGreaterThan(0)
    expect(plan.implementationFiles.length).toBeGreaterThan(0)
  })
})
