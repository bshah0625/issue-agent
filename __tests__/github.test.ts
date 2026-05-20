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
