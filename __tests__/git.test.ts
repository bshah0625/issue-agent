import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGitInstance = {
  checkoutLocalBranch: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  revparse: vi.fn(),
  clone: vi.fn(),
  pull: vi.fn(),
  status: vi.fn(),
}

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGitInstance),
  simpleGit: vi.fn(() => mockGitInstance),
}))

const mockExistsSync = vi.fn()

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}))

describe('cloneOrPull', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pulls when the local repo directory already exists', async () => {
    mockExistsSync.mockReturnValue(true)
    mockGitInstance.pull.mockResolvedValue(undefined)

    const { cloneOrPull } = await import('../src/git')
    await cloneOrPull('https://github.com/owner/repo.git', '/tmp/test-repo')

    expect(mockGitInstance.pull).toHaveBeenCalled()
    expect(mockGitInstance.clone).not.toHaveBeenCalled()
  })

  it('clones when the local path does not exist yet', async () => {
    mockExistsSync.mockReturnValue(false)
    mockGitInstance.clone.mockResolvedValue(undefined)

    const { cloneOrPull } = await import('../src/git')
    await cloneOrPull('https://github.com/owner/repo.git', '/tmp/new-repo')

    expect(mockGitInstance.clone).toHaveBeenCalledWith(
      'https://github.com/owner/repo.git',
      '/tmp/new-repo'
    )
    expect(mockGitInstance.pull).not.toHaveBeenCalled()
  })
})

describe('createAndCheckoutBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls checkout with the -b flag to create and switch to the branch', async () => {
    mockGitInstance.checkoutLocalBranch.mockResolvedValue(undefined)

    const { createAndCheckoutBranch } = await import('../src/git')
    await createAndCheckoutBranch('/tmp/test-repo', 'feat/issue-42-add-chart')

    expect(mockGitInstance.checkoutLocalBranch).toHaveBeenCalledWith('feat/issue-42-add-chart')
  })

  it('throws a descriptive error if the branch already exists', async () => {
    mockGitInstance.checkoutLocalBranch.mockRejectedValue(
      new Error("A branch named 'feat/issue-42-add-chart' already exists")
    )

    const { createAndCheckoutBranch } = await import('../src/git')
    await expect(
      createAndCheckoutBranch('/tmp/test-repo', 'feat/issue-42-add-chart')
    ).rejects.toThrow(/branch|already exists/i)
  })
})

describe('stageAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls git add -A on the correct localPath', async () => {
    mockGitInstance.add.mockResolvedValue(undefined)

    const { stageAll } = await import('../src/git')
    await stageAll('/tmp/test-repo')

    expect(mockGitInstance.add).toHaveBeenCalledWith('-A')
  })
})

describe('commit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a commit with the exact provided message', async () => {
    mockGitInstance.commit.mockResolvedValue({ commit: 'abc123' })

    const { commit } = await import('../src/git')
    await commit('/tmp/test-repo', 'test(#42): add failing tests')

    expect(mockGitInstance.commit).toHaveBeenCalledWith('test(#42): add failing tests')
  })

  it('throws if nothing is staged', async () => {
    mockGitInstance.commit.mockRejectedValue(new Error('nothing to commit, working tree clean'))

    const { commit } = await import('../src/git')
    await expect(commit('/tmp/test-repo', 'empty commit')).rejects.toThrow(
      /nothing to commit|staged/i
    )
  })
})

describe('push', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pushes the branch with upstream tracking set', async () => {
    mockGitInstance.push.mockResolvedValue(undefined)

    const { push } = await import('../src/git')
    await push('/tmp/test-repo', 'feat/issue-42-add-chart')

    expect(mockGitInstance.push).toHaveBeenCalledWith(
      'origin',
      'feat/issue-42-add-chart',
      expect.arrayContaining(['--set-upstream'])
    )
  })
})

describe('getHeadSha', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the current HEAD commit SHA', async () => {
    mockGitInstance.revparse.mockResolvedValue('deadbeef1234567890abcdef')

    const { getHeadSha } = await import('../src/git')
    const sha = await getHeadSha('/tmp/test-repo')

    expect(sha).toBe('deadbeef1234567890abcdef')
    expect(mockGitInstance.revparse).toHaveBeenCalledWith(['HEAD'])
  })
})

describe('checkoutAndPull', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('checks out the branch then pulls latest changes', async () => {
    mockGitInstance.status.mockResolvedValue({ current: 'main' })
    mockGitInstance.pull.mockResolvedValue(undefined)

    const { checkoutAndPull } = await import('../src/git')
    await checkoutAndPull('/tmp/test-repo', 'main')

    expect(mockGitInstance.pull).toHaveBeenCalled()
  })

  it('throws a descriptive error when the branch does not exist', async () => {
    mockGitInstance.status.mockRejectedValue(new Error("pathspec 'nonexistent' did not match"))

    const { checkoutAndPull } = await import('../src/git')
    await expect(checkoutAndPull('/tmp/test-repo', 'nonexistent')).rejects.toThrow(
      /branch|checkout|pull/i
    )
  })
})
