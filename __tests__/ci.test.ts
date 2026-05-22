import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectConfig } from '../src/types'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

const mockConfig: ProjectConfig = {
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

describe('runCI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns passed: true when the command exits with code 0', async () => {
    const { execSync } = await import('child_process')
    vi.mocked(execSync).mockReturnValue(Buffer.from('All checks passed'))

    const { runCI } = await import('../src/ci')
    const result = runCI('/tmp/test-repo', 'npx tsc --noEmit', 'typecheck')

    expect(result.passed).toBe(true)
    expect(result.stage).toBe('typecheck')
  })

  it('returns passed: false when the command exits with a non-zero code', async () => {
    const { execSync } = await import('child_process')
    vi.mocked(execSync).mockImplementation(() => {
      const err = new Error('Command failed') as Error & { stdout: Buffer; stderr: Buffer }
      err.stdout = Buffer.from('error output')
      err.stderr = Buffer.from('type error here')
      throw err
    })

    const { runCI } = await import('../src/ci')
    const result = runCI('/tmp/test-repo', 'npx tsc --noEmit', 'typecheck')

    expect(result.passed).toBe(false)
  })

  it('captures combined stdout and stderr in the output field', async () => {
    const { execSync } = await import('child_process')
    vi.mocked(execSync).mockImplementation(() => {
      const err = new Error('Command failed') as Error & { stdout: Buffer; stderr: Buffer }
      err.stdout = Buffer.from('stdout content')
      err.stderr = Buffer.from('stderr content')
      throw err
    })

    const { runCI } = await import('../src/ci')
    const result = runCI('/tmp/test-repo', 'npx tsc --noEmit', 'typecheck')

    expect(result.output).toContain('stdout content')
    expect(result.output).toContain('stderr content')
  })

  it('sets the correct stage value on the returned CIResult', async () => {
    const { execSync } = await import('child_process')
    vi.mocked(execSync).mockReturnValue(Buffer.from('ok'))

    const { runCI } = await import('../src/ci')
    const lintResult = runCI('/tmp/test-repo', 'npx eslint .', 'lint')
    expect(lintResult.stage).toBe('lint')

    const testResult = runCI('/tmp/test-repo', 'npx vitest run', 'test')
    expect(testResult.stage).toBe('test')
  })

  it('treats missing stdout and stderr as empty strings', async () => {
    const { execSync } = await import('child_process')
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('spawn ENOENT')
    })

    const { runCI } = await import('../src/ci')
    const result = runCI('/tmp/test-repo', 'missing-cmd', 'typecheck')

    expect(result.passed).toBe(false)
    expect(result.output).toBe('')
  })

  it('includes the first 500 chars of output in failureReason on failure', async () => {
    const { execSync } = await import('child_process')
    const longOutput = 'x'.repeat(1000)
    vi.mocked(execSync).mockImplementation(() => {
      const err = new Error('Command failed') as Error & { stdout: Buffer; stderr: Buffer }
      err.stdout = Buffer.from(longOutput)
      err.stderr = Buffer.from('')
      throw err
    })

    const { runCI } = await import('../src/ci')
    const result = runCI('/tmp/test-repo', 'npx tsc --noEmit', 'typecheck')

    expect(result.failureReason).toBeDefined()
    expect(result.failureReason!.length).toBeLessThanOrEqual(500)
  })
})

describe('runAllChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs all three stages when all pass and returns three results', async () => {
    const { execSync } = await import('child_process')
    vi.mocked(execSync).mockReturnValue(Buffer.from('ok'))

    const { runAllChecks } = await import('../src/ci')
    const results = runAllChecks('/tmp/test-repo', mockConfig)

    expect(results).toHaveLength(3)
    expect(results.every((r) => r.passed)).toBe(true)
  })

  it('stops after the first failing stage and returns results up to that point', async () => {
    const { execSync } = await import('child_process')
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from('ok'))
      .mockImplementationOnce(() => {
        const err = new Error('lint failed') as Error & { stdout: Buffer; stderr: Buffer }
        err.stdout = Buffer.from('lint error')
        err.stderr = Buffer.from('')
        throw err
      })

    const { runAllChecks } = await import('../src/ci')
    const results = runAllChecks('/tmp/test-repo', mockConfig)

    expect(results).toHaveLength(2)
    expect(results[0]!.passed).toBe(true)
    expect(results[1]!.passed).toBe(false)
  })

  it('returns an empty array if no CI commands are configured', async () => {
    const emptyConfig: ProjectConfig = {
      ...mockConfig,
      ciCommands: { typecheck: '', lint: '', test: '' },
    }

    const { runAllChecks } = await import('../src/ci')
    const results = runAllChecks('/tmp/test-repo', emptyConfig)

    expect(results).toHaveLength(0)
  })

  it('runs stages in order: typecheck → lint → test', async () => {
    const { execSync } = await import('child_process')
    const callOrder: string[] = []
    vi.mocked(execSync).mockImplementation((cmd) => {
      callOrder.push(cmd as string)
      return Buffer.from('ok')
    })

    const { runAllChecks } = await import('../src/ci')
    runAllChecks('/tmp/test-repo', mockConfig)

    expect(callOrder[0]).toBe(mockConfig.ciCommands.typecheck)
    expect(callOrder[1]).toBe(mockConfig.ciCommands.lint)
    expect(callOrder[2]).toBe(mockConfig.ciCommands.test)
  })
})
