import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOctokit = {
  rest: {
    issues: {
      get: vi.fn(),
      createComment: vi.fn(),
      addLabels: vi.fn(),
    },
    git: {
      getRef: vi.fn(),
      createRef: vi.fn(),
    },
    repos: {
      getContent: vi.fn(),
      createOrUpdateFileContents: vi.fn(),
    },
    pulls: {
      create: vi.fn(),
    },
  },
}

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(function () {
    return mockOctokit
  }),
}))

describe('getIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps the GitHub API response to the Issue interface shape correctly', async () => {
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 42,
        title: 'Add MPG chart',
        body: 'Users need to see fuel efficiency',
        labels: [{ name: 'enhancement' }, { name: 'good first issue' }],
      },
    })

    const { getIssue } = await import('../src/github')
    const issue = await getIssue('owner', 'repo', 42)

    expect(issue.number).toBe(42)
    expect(issue.title).toBe('Add MPG chart')
    expect(issue.body).toBe('Users need to see fuel efficiency')
    expect(issue.labels).toEqual(['enhancement', 'good first issue'])
  })

  it('extracts label names as plain strings from the nested labels array', async () => {
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 1,
        title: 'Test',
        body: null,
        labels: [{ name: 'bug' }, { name: 'priority-high' }],
      },
    })

    const { getIssue } = await import('../src/github')
    const issue = await getIssue('owner', 'repo', 1)

    expect(issue.labels).toEqual(['bug', 'priority-high'])
    expect(typeof issue.labels[0]).toBe('string')
  })

  it('throws a descriptive error on a 404 response', async () => {
    mockOctokit.rest.issues.get.mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 })
    )

    const { getIssue } = await import('../src/github')
    await expect(getIssue('owner', 'repo', 999)).rejects.toThrow(/404|not found|issue/i)
  })

  it('infers chore type from the chore label', async () => {
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: { number: 10, title: 'Update deps', body: '', labels: [{ name: 'chore' }] },
    })
    const { getIssue } = await import('../src/github')
    const issue = await getIssue('owner', 'repo', 10)
    expect(issue.type).toBe('chore')
  })

  it('infers refactor type from the refactor label', async () => {
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: { number: 11, title: 'Refactor auth', body: '', labels: [{ name: 'refactor' }] },
    })
    const { getIssue } = await import('../src/github')
    const issue = await getIssue('owner', 'repo', 11)
    expect(issue.type).toBe('refactor')
  })

  it('infers test type from the test label', async () => {
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: { number: 12, title: 'Add coverage', body: '', labels: [{ name: 'test' }] },
    })
    const { getIssue } = await import('../src/github')
    const issue = await getIssue('owner', 'repo', 12)
    expect(issue.type).toBe('test')
  })

  it('defaults to feature type when no known label matches', async () => {
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: { number: 13, title: 'Misc work', body: '', labels: [{ name: 'wontfix' }] },
    })
    const { getIssue } = await import('../src/github')
    const issue = await getIssue('owner', 'repo', 13)
    expect(issue.type).toBe('feature')
  })
})

describe('createBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a git ref with the full refs/heads/ path', async () => {
    mockOctokit.rest.git.createRef.mockResolvedValue({ data: {} })

    const { createBranch } = await import('../src/github')
    await createBranch('owner', 'repo', 'feat/issue-42', 'deadbeef')

    expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      ref: 'refs/heads/feat/issue-42',
      sha: 'deadbeef',
    })
  })

  it('throws a descriptive error when branch creation fails', async () => {
    mockOctokit.rest.git.createRef.mockRejectedValue(new Error('Reference already exists'))

    const { createBranch } = await import('../src/github')
    await expect(createBranch('owner', 'repo', 'feat/issue-42', 'abc')).rejects.toThrow(
      /failed to create branch/i
    )
  })
})

describe('getFileSha', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the sha when the file exists on the given branch', async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { sha: 'file-sha-123', type: 'file', name: 'file.ts', path: 'src/file.ts' },
    })

    const { getFileSha } = await import('../src/github')
    const sha = await getFileSha('owner', 'repo', 'src/file.ts', 'main')

    expect(sha).toBe('file-sha-123')
  })

  it('returns null when the file does not exist (404)', async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 })
    )

    const { getFileSha } = await import('../src/github')
    const sha = await getFileSha('owner', 'repo', 'src/missing.ts', 'main')

    expect(sha).toBeNull()
  })

  it('returns null when the path resolves to a directory', async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({ data: [] })

    const { getFileSha } = await import('../src/github')
    const sha = await getFileSha('owner', 'repo', 'src/', 'main')

    expect(sha).toBeNull()
  })

  it('re-throws non-404 errors unchanged', async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error('Internal Server Error'), { status: 500 })
    )

    const { getFileSha } = await import('../src/github')
    await expect(getFileSha('owner', 'repo', 'src/file.ts', 'main')).rejects.toThrow(
      'Internal Server Error'
    )
  })
})

describe('upsertFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('base64-encodes content and sends to createOrUpdateFileContents', async () => {
    mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({ data: {} })

    const { upsertFile } = await import('../src/github')
    await upsertFile('owner', 'repo', 'src/chart.ts', 'export const x = 1', 'add chart', 'main')

    expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        path: 'src/chart.ts',
        message: 'add chart',
        branch: 'main',
        content: Buffer.from('export const x = 1').toString('base64'),
      })
    )
  })

  it('includes the sha field when updating an existing file', async () => {
    mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({ data: {} })

    const { upsertFile } = await import('../src/github')
    await upsertFile('owner', 'repo', 'src/chart.ts', 'content', 'update', 'main', 'existing-sha')

    expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: 'existing-sha' })
    )
  })

  it('omits the sha field when creating a new file', async () => {
    mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({ data: {} })

    const { upsertFile } = await import('../src/github')
    await upsertFile('owner', 'repo', 'src/new.ts', 'content', 'create', 'main')

    const call = mockOctokit.rest.repos.createOrUpdateFileContents.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(call).not.toHaveProperty('sha')
  })
})

describe('createPR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the html_url string from the API response', async () => {
    mockOctokit.rest.pulls.create.mockResolvedValue({
      data: {
        html_url: 'https://github.com/owner/repo/pull/1',
        number: 1,
      },
    })

    const { createPR } = await import('../src/github')
    const url = await createPR('owner', 'repo', 'Add MPG chart', 'body', 'feat/issue-42', 'main')

    expect(url).toBe('https://github.com/owner/repo/pull/1')
  })

  it('throws on a GitHub API error response', async () => {
    mockOctokit.rest.pulls.create.mockRejectedValue(
      Object.assign(new Error('Unprocessable Entity'), { status: 422 })
    )

    const { createPR } = await import('../src/github')
    await expect(
      createPR('owner', 'repo', 'title', 'body', 'head', 'base')
    ).rejects.toThrow(/422|unprocessable|pull request/i)
  })
})

describe('postComment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the issues comments endpoint with the correct body', async () => {
    mockOctokit.rest.issues.createComment.mockResolvedValue({ data: { id: 1 } })

    const { postComment } = await import('../src/github')
    await postComment('owner', 'repo', 42, 'CI failed after 3 attempts')

    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      body: 'CI failed after 3 attempts',
    })
  })
})

describe('addLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the labels endpoint with the correct label name and repo info', async () => {
    mockOctokit.rest.issues.addLabels.mockResolvedValue({ data: [] })

    const { addLabel } = await import('../src/github')
    await addLabel('owner', 'repo', 42, 'agent-complete')

    expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      labels: ['agent-complete'],
    })
  })
})
