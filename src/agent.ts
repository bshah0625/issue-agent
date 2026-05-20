import Anthropic from '@anthropic-ai/sdk'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { getIssue, createPR, addLabel, postComment } from './github.js'
import { createAndCheckoutBranch, stageAll, commit, push } from './git.js'
import { runCI, runAllChecks } from './ci.js'
import { planFromIssue } from './planner.js'
import { TESTS_PROMPT } from './prompts/tests.js'
import { IMPLEMENT_PROMPT } from './prompts/implement.js'
import { PR_BODY_PROMPT } from './prompts/pr-body.js'
import type { AgentPlan, AgentResult, CIResult, FileChange, Issue, ProjectConfig } from './types.js'

function buildFileTree(localPath: string, base = ''): string {
  const lines: string[] = []
  try {
    const entries = readdirSync(join(localPath, base))
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
      const rel = base ? `${base}/${entry}` : entry
      const stat = statSync(join(localPath, rel))
      lines.push(rel)
      if (stat.isDirectory()) {
        lines.push(...buildFileTree(localPath, rel).split('\n').filter(Boolean))
      }
    }
  } catch {
    // directory may not exist yet
  }
  return lines.join('\n')
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })
  for (const block of response.content) {
    if (block.type === 'text') return block.text
  }
  return ''
}

async function writeFileWithDirs(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

async function generateFileContent(
  fileChange: FileChange,
  systemPrompt: string,
  extraContext: string,
  localPath: string
): Promise<string> {
  let existingContent = ''
  if (fileChange.action === 'modify') {
    try {
      existingContent = await readFile(join(localPath, fileChange.path), 'utf-8')
    } catch {
      // file may not exist yet
    }
  }

  const userMessage = [
    `File: ${fileChange.path}`,
    `Action: ${fileChange.action}`,
    `Description: ${fileChange.description}`,
    extraContext,
    existingContent ? `\nExisting file content:\n${existingContent}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return callClaude(systemPrompt, userMessage)
}

async function generatePRBody(issue: Issue, plan: AgentPlan): Promise<string> {
  const userMessage = [
    `Issue #${issue.number}: ${issue.title}`,
    `Labels: ${issue.labels.join(', ')}`,
    `Body:\n${issue.body}`,
    `\nSummary: ${plan.summary}`,
    '\nFiles changed:',
    ...plan.testFiles.map((f) => `  - ${f.path} (${f.action}): ${f.description}`),
    ...plan.implementationFiles.map((f) => `  - ${f.path} (${f.action}): ${f.description}`),
  ].join('\n')

  return callClaude(PR_BODY_PROMPT, userMessage)
}

function allCIPassed(results: CIResult[]): boolean {
  return results.length > 0 && results.every((r) => r.passed)
}

export async function runAgent(
  issueNumber: number,
  config: ProjectConfig
): Promise<AgentResult> {
  // Step 1: Get issue
  const issue = await getIssue(config.repoOwner, config.repoName, issueNumber)

  // Step 2: Build file tree
  const fileTree = buildFileTree(config.localPath)

  // Step 3: Plan
  const plan = await planFromIssue(issue, fileTree, config)

  // Step 4: Create branch
  await createAndCheckoutBranch(config.localPath, plan.branchName)

  // Step 5: TDD Red Phase — write failing tests
  for (const testFile of plan.testFiles) {
    const context = `\nProject file tree:\n${fileTree}\n\nIssue context:\n${issue.title}\n${issue.body}`
    const content = await generateFileContent(testFile, TESTS_PROMPT, context, config.localPath)
    await writeFileWithDirs(join(config.localPath, testFile.path), content)
  }

  await stageAll(config.localPath)
  await commit(config.localPath, `test(#${issueNumber}): add failing tests for ${plan.summary}`)

  // Verify tests are actually failing (TDD red phase check)
  const redPhaseResult = runCI(
    config.localPath,
    `npx vitest run ${plan.testFiles.map((f) => f.path).join(' ')}`,
    'test'
  )
  if (redPhaseResult.passed) {
    await postComment(
      config.repoOwner,
      config.repoName,
      issueNumber,
      `⚠️ Warning: New tests passed immediately in the red phase — they may not be testing new behavior. Proceeding anyway.`
    )
  }

  // Step 6: TDD Green Phase — implement code
  const testContents = await Promise.all(
    plan.testFiles.map(async (f) => {
      try {
        return `\n--- ${f.path} ---\n${await readFile(join(config.localPath, f.path), 'utf-8')}`
      } catch {
        return ''
      }
    })
  )
  const testContext = `Test files to make pass:\n${testContents.join('\n')}\n\nProject file tree:\n${fileTree}`

  for (const implFile of plan.implementationFiles) {
    const content = await generateFileContent(implFile, IMPLEMENT_PROMPT, testContext, config.localPath)
    await writeFileWithDirs(join(config.localPath, implFile.path), content)
  }

  await stageAll(config.localPath)
  const commitPrefix = issue.type === 'bug' ? 'fix' : 'feat'
  await commit(config.localPath, `${commitPrefix}(#${issueNumber}): ${plan.summary}`)

  // Step 7: CI Loop
  let ciAttempts = 0
  let ciResults = runAllChecks(config.localPath, config)

  while (!allCIPassed(ciResults) && ciAttempts < config.maxCIAttempts) {
    const failedResult = ciResults.find((r) => !r.passed)
    const failureOutput = failedResult?.output ?? 'Unknown CI failure'

    const fixContext = [
      `CI failed at stage: ${failedResult?.stage}`,
      `Failure output:\n${failureOutput}`,
      `\nTest files:\n${testContents.join('\n')}`,
      `\nProject file tree:\n${fileTree}`,
    ].join('\n')

    for (const implFile of plan.implementationFiles) {
      const content = await generateFileContent(implFile, IMPLEMENT_PROMPT, fixContext, config.localPath)
      await writeFileWithDirs(join(config.localPath, implFile.path), content)
    }

    await stageAll(config.localPath)
    await commit(
      config.localPath,
      `fix: address CI failure (attempt ${ciAttempts + 1})`
    )

    ciAttempts++
    ciResults = runAllChecks(config.localPath, config)
  }

  if (!allCIPassed(ciResults)) {
    const failedResult = ciResults.find((r) => !r.passed)
    const failureMessage = [
      `🤖 Agent blocked after ${ciAttempts} CI attempt(s).`,
      `\nFailing stage: ${failedResult?.stage}`,
      `\nOutput:\n\`\`\`\n${failedResult?.failureReason ?? 'Unknown'}\n\`\`\``,
    ].join('\n')

    await postComment(config.repoOwner, config.repoName, issueNumber, failureMessage)
    await addLabel(config.repoOwner, config.repoName, issueNumber, 'agent-blocked')

    return {
      success: false,
      ciAttempts,
      errorMessage: failedResult?.failureReason ?? 'CI failed',
    }
  }

  // Step 8: Push
  await push(config.localPath, plan.branchName)

  // Step 9: Generate PR body
  const prBody = await generatePRBody(issue, plan)

  // Step 10: Create PR
  const prTitle = `${commitPrefix}(#${issueNumber}): ${plan.summary}`
  const prUrl = await createPR(
    config.repoOwner,
    config.repoName,
    prTitle,
    prBody,
    plan.branchName,
    config.baseBranch
  )

  // Step 11: Label success
  await addLabel(config.repoOwner, config.repoName, issueNumber, 'agent-complete')

  // Step 12: Return result
  return {
    success: true,
    prUrl,
    branchName: plan.branchName,
    ciAttempts,
  }
}
