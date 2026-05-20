import Anthropic from '@anthropic-ai/sdk'
import { PLAN_PROMPT } from './prompts/plan.js'
import type { Issue, AgentPlan, FileChange, ProjectConfig } from './types.js'

interface ClaudePlanResponse {
  summary: string
  issueType: Issue['type']
  testFiles: FileChange[]
  implementationFiles: FileChange[]
}

function buildSlug(title: string, issueNumber: number): string {
  const raw = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  const prefix = `issue-${issueNumber}-`
  const maxSlugLen = 40 - prefix.length
  const truncated = raw.slice(0, maxSlugLen)
  return `${prefix}${truncated}`
}

function branchPrefix(type: Issue['type']): string {
  return type === 'bug' ? 'fix' : 'feat'
}

export async function planFromIssue(
  issue: Issue,
  fileTree: string,
  _config: ProjectConfig
): Promise<AgentPlan> {
  const client = new Anthropic()

  const userMessage = [
    `Issue #${issue.number}: ${issue.title}`,
    `Labels: ${issue.labels.join(', ')}`,
    `Body:\n${issue.body}`,
    `\nProject file tree:\n${fileTree}`,
  ].join('\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    system: PLAN_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  let rawText = ''
  for (const block of response.content) {
    if (block.type === 'text') {
      rawText = block.text
      break
    }
  }

  let parsed: ClaudePlanResponse
  try {
    parsed = JSON.parse(rawText) as ClaudePlanResponse
  } catch {
    throw new Error(
      `Claude returned malformed JSON that could not be parsed as a valid plan. Raw response: ${rawText.slice(0, 200)}`
    )
  }

  if (!parsed.testFiles || !Array.isArray(parsed.testFiles) || parsed.testFiles.length === 0) {
    throw new Error('Invalid plan: testFiles must be a non-empty array')
  }

  if (!parsed.implementationFiles || !Array.isArray(parsed.implementationFiles)) {
    throw new Error('Invalid plan: implementationFiles must be an array')
  }

  const slug = buildSlug(issue.title, issue.number)
  const branchName = `${branchPrefix(issue.type)}/${slug}`

  return {
    issue,
    branchName,
    summary: parsed.summary,
    testFiles: parsed.testFiles,
    implementationFiles: parsed.implementationFiles,
  }
}
