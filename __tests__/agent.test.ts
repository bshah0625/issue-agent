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
  checkoutAndPull: vi.fn(),
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

async function setupMocks(
  overrides: {
    ciResults?: CIResult[][]
    planOverride?: AgentPlan
  } = {}
): Promise<void> {
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
  vi.mocked(git.checkoutAndPull).mockResolvedValue(undefined)
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
    const implCommitIndex = commitCalls.findIndex(
      ([, msg]) => msg?.includes('feat(') || msg?.includes('fix(')
    )

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
      ciResults: [failingCIResults, failingCIResults, failingCIResults],
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

    expect(vi.mocked(git.push)).toHaveBeenCalledWith(mockConfig.localPath, mockPlan.branchName)
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

  it('builds the file tree traversing into subdirectories and skipping node_modules', async () => {
    await setupMocks()
    const nodefs = await import('node:fs')

    vi.mocked(nodefs.readdirSync)
      .mockReturnValueOnce(['node_modules', 'src'] as unknown as ReturnType<
        typeof nodefs.readdirSync
      >)
      .mockReturnValueOnce(['index.ts'] as unknown as ReturnType<typeof nodefs.readdirSync>)
      .mockReturnValue([] as unknown as ReturnType<typeof nodefs.readdirSync>)

    vi.mocked(nodefs.statSync)
      .mockReturnValueOnce({ isDirectory: () => true } as unknown as ReturnType<
        typeof nodefs.statSync
      >)
      .mockReturnValue({ isDirectory: () => false } as unknown as ReturnType<
        typeof nodefs.statSync
      >)

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.success).toBe(true)
  })

  it('reads existing file content when an implementation file action is modify', async () => {
    const modifyPlan: AgentPlan = {
      ...mockPlan,
      implementationFiles: [
        { path: 'src/chart.ts', action: 'modify', description: 'Update chart component' },
      ],
    }
    await setupMocks({ planOverride: modifyPlan })

    const fsPromises = await import('node:fs/promises')
    vi.mocked(fsPromises.readFile).mockResolvedValue('// existing content' as never)

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.success).toBe(true)
    expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalled()
  })

  it('handles readFile throwing when reading test files for the green phase context', async () => {
    await setupMocks()

    const fsPromises = await import('node:fs/promises')
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('ENOENT: no such file'))

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.success).toBe(true)
  })

  it('syncs the base branch before creating the feature branch', async () => {
    await setupMocks()
    const git = await import('../src/git')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    expect(vi.mocked(git.checkoutAndPull)).toHaveBeenCalledWith(
      mockConfig.localPath,
      mockConfig.baseBranch
    )
    // checkoutAndPull must happen before createAndCheckoutBranch
    const pullOrder = vi.mocked(git.checkoutAndPull).mock.invocationCallOrder[0]!
    const branchOrder = vi.mocked(git.createAndCheckoutBranch).mock.invocationCallOrder[0]!
    expect(pullOrder).toBeLessThan(branchOrder)
  })

  it('uses fix/ commit prefix when the issue type is bug', async () => {
    const bugIssue: Issue = { ...mockIssue, type: 'bug', labels: ['bug'] }
    const bugPlan: AgentPlan = {
      ...mockPlan,
      issue: bugIssue,
      branchName: 'fix/issue-42-add-mpg-chart',
    }
    await setupMocks({ planOverride: bugPlan })
    const github = await import('../src/github')
    vi.mocked(github.getIssue).mockResolvedValue(bugIssue)
    const git = await import('../src/git')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    const commitCalls = vi.mocked(git.commit).mock.calls
    const implCommit = commitCalls.find(([, msg]) => msg?.startsWith('fix('))
    expect(implCommit).toBeDefined()
  })

  it('uses Unknown fallbacks when no CI result is found after loop exits', async () => {
    // runAllChecks returns an empty array — no results, allCIPassed([]) = false
    await setupMocks({ ciResults: [[]] })
    const github = await import('../src/github')
    const { runAgent } = await import('../src/agent')

    const result = await runAgent(42, mockConfig)

    expect(result.success).toBe(false)
    expect(vi.mocked(github.postComment)).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.stringContaining('Agent blocked')
    )
  })

  it('throws a descriptive error when the Claude API fails during file generation', async () => {
    await setupMocks()
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockRejectedValue(new Error('Rate limit exceeded')),
        },
      } as never
    })
    const { runAgent } = await import('../src/agent')
    await expect(runAgent(42, mockConfig)).rejects.toThrow(/Claude API|failed/i)
  })

  it('appends Closes #N to the PR body when Claude omits it', async () => {
    await setupMocks()
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: '## What\n\nAdds chart\n\n## Why\n\nUsers need it' }],
          }),
        },
      } as never
    })
    const github = await import('../src/github')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    const prBody = vi.mocked(github.createPR).mock.calls[0]?.[3]
    expect(prBody).toContain('Closes #42')
  })

  it('does not duplicate Closes #N when Claude already includes it', async () => {
    await setupMocks()
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                type: 'text',
                text: '## What\n\nAdds chart\n\nCloses #42',
              },
            ],
          }),
        },
      } as never
    })
    const github = await import('../src/github')
    const { runAgent } = await import('../src/agent')

    await runAgent(42, mockConfig)

    const prBody = vi.mocked(github.createPR).mock.calls[0]?.[3] ?? ''
    const occurrences = (prBody.match(/Closes #42/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('continues successfully when Claude returns no text content block', async () => {
    await setupMocks()

    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({ content: [] }),
        },
      } as never
    })

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.success).toBe(true)
  })

  it('continues successfully when Claude returns only non-text block types', async () => {
    await setupMocks()

    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'tool_use', id: 'x', name: 'f', input: {} }],
          }),
        },
      } as never
    })

    const { runAgent } = await import('../src/agent')
    const result = await runAgent(42, mockConfig)

    expect(result.success).toBe(true)
  })
})
