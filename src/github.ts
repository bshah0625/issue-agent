import { Octokit } from '@octokit/rest'
import type { Issue } from './types.js'

function getClient(): Octokit {
  return new Octokit({ auth: process.env['GITHUB_TOKEN'] })
}

function inferIssueType(labels: string[]): Issue['type'] {
  if (labels.includes('bug')) return 'bug'
  if (labels.includes('enhancement') || labels.includes('feature')) return 'feature'
  if (labels.includes('chore')) return 'chore'
  if (labels.includes('refactor')) return 'refactor'
  if (labels.includes('test')) return 'test'
  return 'feature'
}

export async function getIssue(owner: string, repo: string, number: number): Promise<Issue> {
  try {
    const { data } = await getClient().rest.issues.get({ owner, repo, issue_number: number })
    const labels = (data.labels as Array<{ name?: string } | string>)
      .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
      .filter(Boolean)
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      labels,
      type: inferIssueType(labels),
    }
  } catch (err) {
    const error = err as { status?: number; message?: string }
    throw new Error(
      `Failed to get issue #${number}: ${error.status === 404 ? '404 Not Found' : error.message}`
    )
  }
}

export async function createBranch(
  owner: string,
  repo: string,
  branchName: string,
  baseSha: string
): Promise<void> {
  try {
    await getClient().rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    })
  } catch (err) {
    const error = err as { message?: string }
    throw new Error(`Failed to create branch '${branchName}': ${error.message}`)
  }
}

export async function getFileSha(
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string | null> {
  try {
    const { data } = await getClient().rest.repos.getContent({ owner, repo, path, ref: branch })
    if (Array.isArray(data)) return null
    return (data as { sha: string }).sha
  } catch (err) {
    const error = err as { status?: number }
    if (error.status === 404) return null
    throw err
  }
}

export async function upsertFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<void> {
  const encoded = Buffer.from(content).toString('base64')
  await getClient().rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: encoded,
    branch,
    ...(sha ? { sha } : {}),
  })
}

export async function createPR(
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<string> {
  try {
    const { data } = await getClient().rest.pulls.create({ owner, repo, title, body, head, base })
    return data.html_url
  } catch (err) {
    const error = err as { status?: number; message?: string }
    throw new Error(
      `Failed to create pull request: ${error.status ?? ''} ${error.message ?? ''}`
    )
  }
}

export async function addLabel(
  owner: string,
  repo: string,
  issueNumber: number,
  label: string
): Promise<void> {
  await getClient().rest.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: [label],
  })
}

export async function postComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  await getClient().rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  })
}
