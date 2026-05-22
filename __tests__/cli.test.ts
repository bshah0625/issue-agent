import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRunAgent = vi.fn()

vi.mock('../src/agent.js', () => ({
  runAgent: mockRunAgent,
}))

vi.mock('../config/projects.js', () => ({
  projects: {
    'my-repo': {
      repoOwner: 'owner',
      repoName: 'my-repo',
      localPath: '/tmp/my-repo',
      baseBranch: 'main',
      agentReadyLabel: 'agent-ready',
      maxCIAttempts: 3,
      ciCommands: [],
    },
  },
}))

describe('runCLI', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error(`process.exit(${_code})`)
    })
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('exits with error when called with no arguments', async () => {
    const { runCLI } = await import('../src/cli')
    await expect(runCLI([])).rejects.toThrow(/process\.exit\(1\)/)
    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('')
    expect(output).toMatch(/usage|project|issue/i)
  })

  it('exits with error when only one argument is provided', async () => {
    const { runCLI } = await import('../src/cli')
    await expect(runCLI(['my-repo'])).rejects.toThrow(/process\.exit\(1\)/)
  })

  it('exits with error when issue number is not a valid integer', async () => {
    const { runCLI } = await import('../src/cli')
    await expect(runCLI(['my-repo', 'abc'])).rejects.toThrow(/process\.exit\(1\)/)
    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('')
    expect(output).toMatch(/issue number|integer/i)
  })

  it('exits with error when project is not found in config', async () => {
    const { runCLI } = await import('../src/cli')
    await expect(runCLI(['unknown-repo', '42'])).rejects.toThrow(/process\.exit\(1\)/)
    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('')
    expect(output).toMatch(/project|not found|unknown-repo/i)
  })

  it('calls runAgent with correct project config and issue number', async () => {
    mockRunAgent.mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/owner/my-repo/pull/5',
      branchName: 'feat/issue-42',
      ciAttempts: 1,
    })

    const { runCLI } = await import('../src/cli')
    await runCLI(['my-repo', '42'])

    expect(mockRunAgent).toHaveBeenCalledWith(42, expect.objectContaining({ repoName: 'my-repo' }))
  })

  it('prints the PR URL on success', async () => {
    mockRunAgent.mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/owner/my-repo/pull/7',
      branchName: 'feat/issue-42',
      ciAttempts: 0,
    })

    const { runCLI } = await import('../src/cli')
    await runCLI(['my-repo', '42'])

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join('')
    expect(output).toContain('https://github.com/owner/my-repo/pull/7')
  })

  it('exits with code 1 and logs a message when the agent reports failure', async () => {
    mockRunAgent.mockResolvedValue({
      success: false,
      ciAttempts: 3,
      errorMessage: 'TypeScript errors remain after 3 attempts',
    })

    const { runCLI } = await import('../src/cli')
    await expect(runCLI(['my-repo', '42'])).rejects.toThrow(/process\.exit\(1\)/)
    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('')
    expect(output).toMatch(/failed|blocked/i)
  })
})
