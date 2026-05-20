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
