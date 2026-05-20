import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Issue, AgentPlan, CIResult, ProjectConfig } from '../src/types'

// Mock all external modules
vi.mock('../src/github', () => ({
  getIssue: vi.fn(),
  createBranch: vi.fn(),
  getFileSha: vi.fn(),
  upsertFile: vi.fn(),
  createPR: vi.fn(),
  addLabel: vi.fn(),
  postComment: vi.fn(),
}))

vi.mock('../src/git', () => ({
  cloneOrPull: vi.fn(),
  createAndCheckoutBranch: vi.fn(),
  stageAll: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  getHeadSha: vi.fn(),
}))

vi.mock('../src/ci', () => ({
  runCI: vi.fn(),
  runAllChecks: vi.fn(),
}))

vi.mock('../src/planner', () => ({
  planFromIssue: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ isDirectory: () => false }),
}))

const mockConfig: ProjectConfig = {
  repoOwner: 'owner',
  repoName: 'repo',
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

const mockIssue: Issue = {
  number: 42,
  title: 'Add MPG chart',
  body: 'Users need to see fuel efficiency',
  labels: ['enhancement'],
  type: 'feature',
}

const mockPlan: AgentPlan = {
  issue: mockIssue,
  branchName: 'feat/issue-42-add-mpg-chart',
  summary: 'Add MPG chart to dashboard',
  testFiles: [{ path: '__tests__/chart.test.ts', action: 'create', description: 'Chart tests' }],
  implementationFiles: [
    { path: 'src/chart.ts', action: 'create', description: 'Chart implementation' },
  ],
}

const passingCIResults: CIResult[] = [
  { passed: true, output: 'ok', stage: 'typecheck' },
  { passed: true, output: 'ok', stage: 'lint' },
  { passed: true, output: 'ok', stage: 'test' },
]

const failingCIResults: CIResult[] = [
  { passed: true, output: 'ok', stage: 'typecheck' },
  { passed: false, output: 'test failed', stage: 'test', failureReason: 'test failed' },
]

async function setupMocks(overrides: {
  ciResults?: CIResult[][]
  planOverride?: AgentPlan
} = {}): Promise<void> {
  const github = await import('../src/github')
  const git = await import('../src/git')
  const ci = await import('../src/ci')
  const planner = await import('../src/planner')
  const fs = await import('node:fs/promises')

  vi.mocked(github.getIssue).mockResolvedValue(mockIssue)
  vi.mocked(github.createPR).mockResolvedValue('https://github.com/owner/repo/pull/1')
  vi.mocked(github.addLabel).mockResolvedValue(undefined)
  vi.mocked(github.postComment).mockResolvedValue(undefined)
  vi.mocked(git.createAndCheckoutBranch).mockResolvedValue(undefined)
  vi.mocked(git.stageAll).mockResolvedValue(undefined)
  vi.mocked(git.commit).mockResolvedValue(undefined)
  vi.mocked(git.push).mockResolvedValue(undefined)
  vi.mocked(git.getHeadSha).mockResolvedValue('abc123')
  vi.mocked(fs.writeFile).mockResolvedValue(undefined)
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(planner.planFromIssue).mockResolvedValue(overrides.planOverride ?? mockPlan)

  // Mock vitest run for red phase check — returns non-zero (tests failing, as expected)
  vi.mocked(ci.runCI).mockReturnValue({
    passed: false,
    output: 'tests are failing',
    stage: 'test',
  })

  const ciResults = overrides.ciResults ?? [passingCIResults]
  let callCount = 0
  vi.mocked(ci.runAllChecks).mockImplementation(() => {
    const result = ciResults[callCount] ?? ciResults[ciResults.length - 1]!
    callCount++
    return result
  })
}

describe('runAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('commits test files in a separate commit BEFORE any implementation files', async () => {
    await setupMocks()
    const git = await import('../src/git')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    const commitCalls = vi.mocked(git.commit).mock.calls
    const testCommitIndex = commitCalls.findIndex(([, msg]) => msg?.includes('test('))
    const implCommitIndex = commitCalls.findIndex(([, msg]) => msg?.includes('feat(') || msg?.includes('fix('))

    expect(testCommitIndex).toBeGreaterThanOrEqual(0)
    expect(implCommitIndex).toBeGreaterThan(testCommitIndex)
  })

  it('verifies new tests are failing after the red phase commit', async () => {
    await setupMocks()
    const ci = await import('../src/ci')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    expect(vi.mocked(ci.runCI)).toHaveBeenCalled()
  })

  it('logs a warning but does not abort if a new test passes in the red phase', async () => {
    await setupMocks()
    const ci = await import('../src/ci')
    vi.mocked(ci.runCI).mockReturnValue({
      passed: true,
      output: 'tests passed unexpectedly',
      stage: 'test',
    })

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    // Should not abort — should still complete
    expect(result.ciAttempts).toBeGreaterThanOrEqual(0)
  })

  it('retries CI up to maxCIAttempts times on failure', async () => {
    await setupMocks({
      ciResults: [
        failingCIResults,
        failingCIResults,
        failingCIResults,
      ],
    })

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.ciAttempts).toBe(3)
  })

  it('does not push the branch if CI never passes', async () => {
    await setupMocks({
      ciResults: [failingCIResults, failingCIResults, failingCIResults],
    })

    const git = await import('../src/git')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    expect(vi.mocked(git.push)).not.toHaveBeenCalled()
  })

  it('does not open a PR if CI never passes', async () => {
    await setupMocks({
      ciResults: [failingCIResults, failingCIResults, failingCIResults],
    })

    const github = await import('../src/github')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    expect(vi.mocked(github.createPR)).not.toHaveBeenCalled()
  })

  it('posts a comment on the issue when CI retries are exhausted', async () => {
    await setupMocks({
      ciResults: [failingCIResults, failingCIResults, failingCIResults],
    })

    const github = await import('../src/github')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    expect(vi.mocked(github.postComment)).toHaveBeenCalledWith(
      mockConfig.repoOwner,
      mockConfig.repoName,
      42,
      expect.stringContaining('CI')
    )
  })

  it('adds the agent-blocked label when retries are exhausted', async () => {
    await setupMocks({
      ciResults: [failingCIResults, failingCIResults, failingCIResults],
    })

    const github = await import('../src/github')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    expect(vi.mocked(github.addLabel)).toHaveBeenCalledWith(
      mockConfig.repoOwner,
      mockConfig.repoName,
      42,
      'agent-blocked'
    )
  })

  it('returns success: false when CI retries are exhausted', async () => {
    await setupMocks({
      ciResults: [failingCIResults, failingCIResults, failingCIResults],
    })

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.success).toBe(false)
  })

  it('pushes the branch after all CI checks pass', async () => {
    await setupMocks()

    const git = await import('../src/git')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    expect(vi.mocked(git.push)).toHaveBeenCalledWith(
      mockConfig.localPath,
      mockPlan.branchName
    )
  })

  it('returns success: true with a prUrl on a fully passing run', async () => {
    await setupMocks()

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.success).toBe(true)
    expect(result.prUrl).toBe('https://github.com/owner/repo/pull/1')
  })

  it('adds the agent-complete label to the issue on success', async () => {
    await setupMocks()

    const github = await import('../src/github')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    expect(vi.mocked(github.addLabel)).toHaveBeenCalledWith(
      mockConfig.repoOwner,
      mockConfig.repoName,
      42,
      'agent-complete'
    )
  })

  it('ciAttempts in the result reflects how many retry loops ran', async () => {
    await setupMocks({
      ciResults: [failingCIResults, passingCIResults],
    })

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.ciAttempts).toBe(1)
  })
})
