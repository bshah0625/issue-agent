export type IssueType = 'feature' | 'bug' | 'chore' | 'test' | 'refactor'

export interface Issue {
  number: number
  title: string
  body: string
  labels: string[]
  type: IssueType
}

export interface FileChange {
  path: string
  action: 'create' | 'modify' | 'delete'
  description: string
}

export interface AgentPlan {
  issue: Issue
  branchName: string
  summary: string
  testFiles: FileChange[]
  implementationFiles: FileChange[]
}

export interface CIResult {
  passed: boolean
  output: string
  failureReason?: string
  stage: 'typecheck' | 'lint' | 'test'
}

export interface AgentResult {
  success: boolean
  prUrl?: string
  branchName?: string
  errorMessage?: string
  ciAttempts: number
}

export interface ProjectConfig {
  repoOwner: string
  repoName: string
  baseBranch: string
  localPath: string
  ciCommands: {
    typecheck: string
    lint: string
    test: string
  }
  testPathPattern: string
  agentReadyLabel: string
  maxCIAttempts: number
}
