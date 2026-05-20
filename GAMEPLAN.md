# issue-agent — Full Project Game Plan

> This is the authoritative blueprint for the `issue-agent` project.
> Claude Code must read this file completely before writing any code.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [File & Folder Structure](#4-file--folder-structure)
5. [Module Specifications](#5-module-specifications)
6. [System Prompts](#6-system-prompts)
7. [Project Config](#7-project-config)
8. [Testing Strategy](#8-testing-strategy)
9. [CI / CD Pipeline](#9-ci--cd-pipeline)
10. [Environment Variables](#10-environment-variables)
11. [Pre-commit Hook](#11-pre-commit-hook)
12. [Webhook Registration](#12-webhook-registration)
13. [How to Run Locally](#13-how-to-run-locally)
14. [Phase Roadmap](#14-phase-roadmap)
15. [CLAUDE.md Instructions](#15-claudemd-instructions)
16. [Critical Rules](#16-critical-rules)

---

## 1. Project Overview

**Repo name:** `issue-agent`
**Purpose:** A reusable, fully automated GitHub agent that reads issues and produces pull requests — end to end, with no human involvement.

### What It Does

When a GitHub issue is labeled `agent-ready`, the agent:

1. Reads the issue title, body, and labels
2. Calls Claude to produce a concrete file change plan
3. Creates a Git branch (`feat/issue-{n}-{slug}` or `fix/issue-{n}-{slug}`)
4. Writes **failing tests first** (TDD red phase) and commits them
5. Implements the code to make the tests pass (TDD green phase)
6. Runs the full CI suite locally (typecheck → lint → test → coverage)
7. Self-corrects up to 3 times if CI fails, then posts a human-review comment
8. Pushes the branch and opens a pull request linked to the original issue

### Design Goals

- **Project-agnostic** — one config entry per repo, zero code changes needed
- **TDD-first** — tests are committed before implementation, always, no exceptions
- **Self-healing** — CI failures trigger an automatic fix loop before escalating
- **Auditable** — every action is logged; failures post comments on the GitHub issue
- **Reusable** — the Carma app is the first target; any future repo is one config entry away

---

## 2. Tech Stack

| Layer          | Choice                                  | Reason                                             |
| -------------- | --------------------------------------- | -------------------------------------------------- |
| Language       | TypeScript (strict mode)                | Type safety across all agent logic                 |
| Runtime        | Node.js 20                              | LTS, native `fetch`, `execSync`                    |
| AI             | `@anthropic-ai/sdk` — claude-sonnet-4-5 | Planning, code generation, CI fixing               |
| GitHub API     | `@octokit/rest`                         | Typed GitHub REST client                           |
| Git operations | `simple-git`                            | Programmatic branch/commit/push                    |
| HTTP server    | `node:http` (no framework)              | Minimal footprint for webhook receiver             |
| Test runner    | Vitest                                  | Fast, ESM-native, compatible with Expo/Carma setup |
| Dev execution  | `tsx`                                   | Run TypeScript directly, no build step             |
| Linting        | ESLint + Prettier                       | Consistent with Carma project conventions          |

---

## 3. Architecture Overview

```
GitHub Issue (labeled agent-ready)
        │
        ▼
 Webhook Receiver (src/webhook.ts)
 - Validates HMAC signature
 - Looks up project config by repo name
 - Fires runAgent() async, returns 202 immediately
        │
        ▼
 Orchestrator (src/agent.ts)
 - Coordinates all steps in order
 - Owns TDD phase separation
 - Owns CI retry loop
 - Posts comments/labels on failure or success
        │
   ┌────┴────────────────────────────┐
   │                                 │
   ▼                                 ▼
Planner (src/planner.ts)        Git (src/git.ts)
- Calls Claude with issue        - Branch creation
- Returns structured file        - Stage / commit / push
  change plan (JSON)
   │
   ▼
GitHub client (src/github.ts)
- getIssue, createBranch
- upsertFile, createPR
- addLabel, postComment
   │
   ▼
CI Runner (src/ci.ts)
- Runs typecheck / lint / test
- Returns pass/fail + output
- Used in retry loop
```

**Key constraint:** The webhook handler must fire `runAgent()` without awaiting it. The HTTP 202 response must be sent before the agent begins any work.

---

## 4. File & Folder Structure

```
issue-agent/
│
├── src/
│   ├── agent.ts              # Main orchestrator — the full pipeline
│   ├── webhook.ts            # HTTP server — receives GitHub webhook events
│   ├── github.ts             # GitHub REST client (Octokit wrapper)
│   ├── git.ts                # Git operations via simple-git
│   ├── ci.ts                 # CI runner — executes and parses shell commands
│   ├── planner.ts            # Calls Claude to produce a file change plan
│   └── prompts/
│       ├── plan.ts           # System prompt: issue → structured file plan
│       ├── tests.ts          # System prompt: plan → failing test code
│       ├── implement.ts      # System prompt: plan + tests → implementation code
│       └── pr-body.ts        # System prompt: completed changes → PR description
│
├── config/
│   └── projects.ts           # Per-project config (one entry per target repo)
│
├── __tests__/
│   ├── setup.ts              # Global mock setup — Anthropic SDK, env vars
│   ├── agent.test.ts         # Orchestrator integration tests
│   ├── github.test.ts        # GitHub client unit tests
│   ├── git.test.ts           # Git operations unit tests
│   ├── ci.test.ts            # CI runner unit tests
│   └── planner.test.ts       # Planner unit tests
│
├── .claude/
│   └── docs/
│       └── README.md         # File-by-file reference (functions, methods, purpose)
│
├── .github/
│   └── workflows/
│       └── ci.yml            # GitHub Actions: typecheck, lint, test (sharded), coverage
│
├── .env.example              # Required env vars with descriptions
├── .husky/
│   └── pre-commit            # Runs tsc + vitest related + lint-staged on commit
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── GAMEPLAN.md               # This file
└── CLAUDE.md                 # Claude Code operating instructions
```

---

## 5. Module Specifications

### `src/types.ts`

Define and export all shared interfaces. No logic in this file.

```typescript
export type IssueType = 'feature' | 'bug' | 'chore' | 'test' | 'refactor'

export interface Issue {
  number: number
  title: string
  body: string
  labels: string[]
  type: IssueType
}

export interface FileChange {
  path: string // relative to repo root
  action: 'create' | 'modify' | 'delete'
  description: string // what needs to change and why
}

export interface AgentPlan {
  issue: Issue
  branchName: string // e.g. feat/issue-42-add-mpg-chart
  summary: string // one sentence
  testFiles: FileChange[]
  implementationFiles: FileChange[]
}

export interface CIResult {
  passed: boolean
  output: string // combined stdout + stderr
  failureReason?: string
  stage: 'typecheck' | 'lint' | 'test' | 'coverage'
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
  localPath: string // absolute path to local clone on this machine
  ciCommands: {
    typecheck: string
    lint: string
    test: string
  }
  testPathPattern: string // e.g. '__tests__/**/*.test.ts'
  agentReadyLabel: string // default: 'agent-ready'
  maxCIAttempts: number // default: 3
}
```

---

### `src/github.ts`

Thin, typed wrapper around `@octokit/rest`. Initialize the client once with `GITHUB_TOKEN` from env. Export these named functions — no class, no default export:

| Function       | Signature                                                             | Notes                        |
| -------------- | --------------------------------------------------------------------- | ---------------------------- |
| `getIssue`     | `(owner, repo, number) → Promise<Issue>`                              | Map labels array to string[] |
| `createBranch` | `(owner, repo, branchName, baseSha) → Promise<void>`                  |                              |
| `getFileSha`   | `(owner, repo, path, branch) → Promise<string \| null>`               | null if 404                  |
| `upsertFile`   | `(owner, repo, path, content, message, branch, sha?) → Promise<void>` | Create or update             |
| `createPR`     | `(owner, repo, title, body, head, base) → Promise<string>`            | Returns html_url             |
| `addLabel`     | `(owner, repo, issueNumber, label) → Promise<void>`                   |                              |
| `postComment`  | `(owner, repo, issueNumber, body) → Promise<void>`                    |                              |

---

### `src/git.ts`

Wrapper around `simple-git`. All functions accept `localPath` as first argument — the absolute path to the repo on disk. Export named functions only:

| Function                  | Signature                                 | Notes                        |
| ------------------------- | ----------------------------------------- | ---------------------------- |
| `cloneOrPull`             | `(repoUrl, localPath) → Promise<void>`    | Pull if exists, clone if not |
| `createAndCheckoutBranch` | `(localPath, branchName) → Promise<void>` | From current HEAD            |
| `stageAll`                | `(localPath) → Promise<void>`             | `git add -A`                 |
| `commit`                  | `(localPath, message) → Promise<void>`    | Throws if nothing staged     |
| `push`                    | `(localPath, branchName) → Promise<void>` | Sets upstream on first push  |
| `getHeadSha`              | `(localPath) → Promise<string>`           | Returns current HEAD SHA     |

---

### `src/ci.ts`

Uses `child_process.execSync` to run shell commands. Captures combined stdout + stderr. Export named functions only:

**`runCI(localPath: string, command: string, stage: CIResult['stage']): CIResult`**

- `cwd` is set to `localPath`
- On exit code 0: `{ passed: true, output, stage }`
- On non-zero: `{ passed: false, output, stage, failureReason: first 500 chars of output }`

**`runAllChecks(localPath: string, config: ProjectConfig): CIResult[]`**

- Runs typecheck → lint → test in sequence
- Stops and returns accumulated results on first failure
- Returns all three results if all pass

---

### `src/planner.ts`

Calls Claude with the `plan` system prompt. Parses the JSON response. Derives the branch name from the issue number and title slug.

**`planFromIssue(issue: Issue, fileTree: string, config: ProjectConfig): Promise<AgentPlan>`**

Branch name rules:

- `feat/issue-{number}-{slug}` for features
- `fix/issue-{number}-{slug}` for bugs
- Slug: lowercase, spaces → hyphens, strip all special chars, max 40 chars

---

### `src/agent.ts`

The full pipeline. One exported function:

**`runAgent(issueNumber: number, config: ProjectConfig): Promise<AgentResult>`**

Exact execution order — do not deviate:

1. `getIssue(config.repoOwner, config.repoName, issueNumber)`
2. Walk the local file tree and build a `fileTree` string (relative paths only)
3. `planFromIssue(issue, fileTree, config)` → `AgentPlan`
4. `createAndCheckoutBranch(config.localPath, plan.branchName)`
5. **TDD Red Phase:**
   - For each file in `plan.testFiles`: call Claude with `tests` prompt → write file to disk
   - `stageAll` + `commit` with message: `test(#N): add failing tests for {summary}`
   - Run `npx vitest run` on the test files only
   - If any new test passes at this stage: `postComment` warning on the issue, log it, continue (do not abort)
6. **TDD Green Phase:**
   - For each file in `plan.implementationFiles`: call Claude with `implement` prompt (pass test file contents as context) → write file to disk
   - `stageAll` + `commit` with message: `feat(#N): {summary}` or `fix(#N): {summary}`
7. **CI Loop:**
   - `ciAttempts = 0`
   - Run `runAllChecks(config.localPath, config)`
   - If all pass: proceed to step 8
   - If any fail and `ciAttempts < config.maxCIAttempts`:
     - Call Claude with `implement` prompt + failing CI output as context
     - Apply the fix to the relevant files
     - `stageAll` + `commit`: `fix: address CI failure (attempt {ciAttempts + 1})`
     - Increment `ciAttempts`, loop back
   - If all retries exhausted:
     - `postComment` on issue with the failure output
     - `addLabel(config.repoOwner, config.repoName, issueNumber, 'agent-blocked')`
     - Return `{ success: false, ciAttempts, errorMessage: failureReason }`
8. `push(config.localPath, plan.branchName)`
9. Generate PR body via `pr-body` prompt
10. `createPR(...)` → `prUrl`
11. `addLabel(..., 'agent-complete')`
12. Return `{ success: true, prUrl, branchName: plan.branchName, ciAttempts }`

---

### `src/webhook.ts`

Minimal HTTP server. Node's built-in `http` module only — no Express, no Fastify.

**Behavior:**

- `POST /webhook`: validate HMAC-SHA256 signature using `GITHUB_WEBHOOK_SECRET`. Reject with `403` if invalid.
- On `issues` event, action `labeled`, label name === `config.agentReadyLabel`:
  - Look up project in `config/projects.ts` by `repository.name`
  - If not found: log warning, return `200 { status: 'project not configured' }`
  - Fire `runAgent(issueNumber, projectConfig)` — **do not await**
  - Return `202 { status: 'accepted' }` immediately
- All other events: return `200 { status: 'ignored' }`
- Log every request: ISO timestamp, HTTP method, path, event type, repo name

**HMAC validation must use `crypto.timingSafeEqual`** to prevent timing attacks.

---

## 6. System Prompts

### `src/prompts/plan.ts`

```
You are a senior software engineer analyzing a GitHub issue to produce a concrete file change plan.

Given an issue title, body, labels, and the project's file structure, output a JSON object matching this schema exactly:

{
  "summary": "one sentence summary of the change",
  "issueType": "feature | bug | chore | refactor | test",
  "testFiles": [
    { "path": "relative/path/to/file.test.ts", "action": "create | modify", "description": "what tests to write and why" }
  ],
  "implementationFiles": [
    { "path": "relative/path/to/file.ts", "action": "create | modify | delete", "description": "what to implement and why" }
  ]
}

Rules:
- ALWAYS include at least one test file. Tests are written before implementation (TDD).
- Paths must be relative to the repo root.
- Bug fixes must include regression tests covering the exact broken behavior.
- New features must include unit tests for: happy path, edge cases, and error/failure cases.
- Keep the plan minimal — only files that must change to close the issue.
- Return ONLY the JSON object. No preamble, no markdown fences, no explanation.
```

### `src/prompts/tests.ts`

```
You are a senior software engineer writing failing tests in the TDD red phase.

You will receive:
- A description of what the tests should cover
- The project's existing file tree
- The content of any existing test files being modified

Write complete, runnable test code using Vitest. The tests must:
- Fail when run against the current codebase (before any implementation)
- Cover the happy path, relevant edge cases, and error cases described
- Mock all external dependencies (network, filesystem, APIs)
- Follow the existing test patterns in the project
- Use describe/it blocks with clear, specific test names

Return ONLY the complete file content. No explanation, no markdown fences.
```

### `src/prompts/implement.ts`

```
You are a senior software engineer implementing code to make failing tests pass.

You will receive:
- The test file(s) that are currently failing
- A description of what needs to be implemented
- The project's existing file tree
- Any existing file content being modified
- (When in a CI fix loop) The failing CI output from the previous attempt

Write production-quality TypeScript that:
- Makes all failing tests pass
- Does not break any existing tests
- Follows strict TypeScript (no `any` types, no `@ts-ignore`)
- Follows the existing code patterns and conventions in the file tree
- Handles errors explicitly — no swallowed exceptions

Return ONLY the complete file content. No explanation, no markdown fences.
```

### `src/prompts/pr-body.ts`

```
You are a senior software engineer writing a pull request description.

You will receive:
- The original GitHub issue (number, title, body, labels)
- A summary of what was changed and why
- The list of files modified

Write a clear PR description in this exact format:

## What

[One paragraph describing what was built or fixed]

## Why

[One paragraph explaining the motivation — reference the issue]

## Changes

[Bullet list of files changed and what changed in each]

## Testing

[Brief description of what tests were added and what they cover]

Closes #{issue_number}

Return ONLY the PR body text. No explanation, no additional commentary.
```

---

## 7. Project Config

### `config/projects.ts`

```typescript
import { ProjectConfig } from '../src/types'

export const projects: Record<string, ProjectConfig> = {
  carma: {
    repoOwner: 'YOUR_GITHUB_USERNAME',
    repoName: 'carma',
    baseBranch: 'main',
    localPath: '/absolute/path/to/local/carma',
    ciCommands: {
      typecheck: 'npx tsc --noEmit',
      lint: 'npx eslint . --ext .ts,.tsx',
      test: 'npx vitest run --coverage',
    },
    testPathPattern: '__tests__/**/*.test.ts',
    agentReadyLabel: 'agent-ready',
    maxCIAttempts: 3,
  },
  // Add future projects here — no other code changes required
}
```

**To add a new project:** add one entry to this object. The key must match the GitHub repo name exactly (it's matched against `repository.name` in the webhook payload).

---

## 8. Testing Strategy

This project follows strict Test-Driven Development. All tests live in `__tests__/`. Use Vitest exclusively — do not install Jest.

### Setup file: `__tests__/setup.ts`

Mock the Anthropic SDK globally and set required env vars before any test runs:

```typescript
import { vi } from 'vitest'

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
      }),
    },
  })),
}))

process.env.GITHUB_TOKEN = 'test-token'
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret'
```

### `__tests__/planner.test.ts`

```typescript
describe('planFromIssue', () => {
  it('always includes at least one test file in the plan')
  it('sets issueType to "bug" for issues labeled "bug"')
  it('sets issueType to "feature" for issues labeled "enhancement"')
  it('generates a valid branch name from issue number and title')
  it('branch name is lowercase with hyphens only — no special characters')
  it('branch name prefix is "feat/" for features and "fix/" for bugs')
  it('branch name slug is truncated to 40 characters max')
  it('throws a descriptive error if Claude returns malformed JSON')
  it('returns non-empty testFiles and implementationFiles arrays')
})
```

### `__tests__/ci.test.ts`

```typescript
describe('runCI', () => {
  it('returns passed: true when the command exits with code 0')
  it('returns passed: false when the command exits with a non-zero code')
  it('captures combined stdout and stderr in the output field')
  it('sets the correct stage value on the returned CIResult')
  it('includes the first 500 chars of output in failureReason on failure')
})

describe('runAllChecks', () => {
  it('runs all three stages when all pass and returns three results')
  it('stops after the first failing stage and returns results up to that point')
  it('returns an empty array if no CI commands are configured')
  it('runs stages in order: typecheck → lint → test')
})
```

### `__tests__/git.test.ts`

```typescript
describe('createAndCheckoutBranch', () => {
  it('calls checkout with the -b flag to create and switch to the branch')
  it('throws a descriptive error if the branch already exists')
})

describe('stageAll', () => {
  it('calls git add -A on the correct localPath')
})

describe('commit', () => {
  it('creates a commit with the exact provided message')
  it('throws if nothing is staged')
})

describe('push', () => {
  it('pushes the branch with upstream tracking set')
})
```

### `__tests__/github.test.ts`

```typescript
describe('getIssue', () => {
  it('maps the GitHub API response to the Issue interface shape correctly')
  it('extracts label names as plain strings from the nested labels array')
  it('throws a descriptive error on a 404 response')
})

describe('createPR', () => {
  it('returns the html_url string from the API response')
  it('throws on a GitHub API error response')
})

describe('postComment', () => {
  it('calls the issues comments endpoint with the correct body')
})

describe('addLabel', () => {
  it('calls the labels endpoint with the correct label name and repo info')
})
```

### `__tests__/agent.test.ts`

```typescript
describe('runAgent', () => {
  it('commits test files in a separate commit BEFORE any implementation files')
  it('verifies new tests are failing after the red phase commit')
  it('logs a warning but does not abort if a new test passes in the red phase')
  it('retries CI up to maxCIAttempts times on failure')
  it('does not push the branch if CI never passes')
  it('does not open a PR if CI never passes')
  it('posts a comment on the issue when CI retries are exhausted')
  it('adds the agent-blocked label when retries are exhausted')
  it('returns success: false when CI retries are exhausted')
  it('pushes the branch after all CI checks pass')
  it('returns success: true with a prUrl on a fully passing run')
  it('adds the agent-complete label to the issue on success')
  it('ciAttempts in the result reflects how many retry loops ran')
})
```

### Coverage thresholds

| Metric    | Threshold |
| --------- | --------- |
| Lines     | 80%       |
| Functions | 80%       |
| Branches  | 75%       |

---

## 9. CI / CD Pipeline

### `.github/workflows/ci.yml`

Four jobs. Trigger: `push` to `main`, all `pull_request` events targeting `main`.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typecheck:
    name: TypeScript
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit

  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx eslint . --ext .ts

  test:
    name: Unit Tests (shard ${{ matrix.shard }}/${{ strategy.job-total }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx vitest run --shard=${{ matrix.shard }}/2 --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-shard-${{ matrix.shard }}
          path: coverage/

  coverage:
    name: Coverage Gate
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          pattern: coverage-shard-*
          merge-multiple: true
          path: coverage/
      - run: npx vitest run --coverage --coverage.thresholds.lines=80
```

---

## 10. Environment Variables

### `.env.example`

```
# Anthropic — get from console.anthropic.com
ANTHROPIC_API_KEY=

# GitHub personal access token
# Required scopes: repo, issues, pull_requests, workflows
GITHUB_TOKEN=

# Webhook secret — set this same string in GitHub repo Settings → Webhooks
GITHUB_WEBHOOK_SECRET=

# Port for the webhook HTTP server
PORT=3000
```

Never commit a `.env` file. Always use `.env.example` as the template.

---

## 11. Pre-commit Hook

### `.husky/pre-commit`

```sh
#!/usr/bin/env sh
set -e

npx tsc --noEmit

STAGED=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|js|mjs|cjs)$' || true)

if [ -n "$STAGED" ]; then
  npx vitest related --run $STAGED
else
  echo "pre-commit: no TS files staged, skipping vitest"
fi

npx lint-staged
```

Make executable: `chmod +x .husky/pre-commit`

### `package.json` — `lint-staged` config

```json
"lint-staged": {
  "*.ts": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

### `package.json` — scripts

```json
"scripts": {
  "dev": "tsx src/webhook.ts",
  "agent": "tsx src/agent.ts",
  "build": "tsc",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "typecheck": "tsc --noEmit",
  "lint": "eslint . --ext .ts"
}
```

---

## 12. Webhook Registration

For each repo you want the agent to handle:

1. Go to the repo on GitHub → **Settings → Webhooks → Add webhook**
2. **Payload URL:** your server's public URL + `/webhook` (e.g. `https://your-server.com/webhook`)
3. **Content type:** `application/json`
4. **Secret:** the exact same value as `GITHUB_WEBHOOK_SECRET` in your `.env`
5. **Which events:** select "Let me select individual events" → check **Issues** only
6. Click **Add webhook**

To test locally, use [ngrok](https://ngrok.com): `ngrok http 3000` and use the HTTPS URL as the payload URL.

---

## 13. How to Run Locally

### Start the webhook server

```bash
cp .env.example .env   # fill in your values
npm install
npx tsx src/webhook.ts
```

### Trigger the agent manually (no webhook needed)

```bash
# Format: npx tsx src/agent.ts <project-key> <issue-number>
npx tsx src/agent.ts carma 42
```

### Run tests

```bash
npm test                   # single run
npm run test:watch         # watch mode
npm run test:coverage      # with coverage report
```

---

## 14. Phase Roadmap

### Phase 1 — Foundation (Days 1–3)

- [ ] Repo scaffolding: `npm init`, tsconfig, vitest config, husky, lint-staged
- [ ] `src/types.ts` — all shared interfaces
- [ ] `__tests__/setup.ts` — global mocks
- [ ] All five test files written with `it()` skeletons
- [ ] `.github/workflows/ci.yml`
- [ ] `.env.example`
- [ ] `CLAUDE.md` and `.claude/docs/README.md`

### Phase 2 — Core Modules (Days 4–7)

- [ ] `src/github.ts` — all functions implemented and tested
- [ ] `src/git.ts` — all functions implemented and tested
- [ ] `src/ci.ts` — `runCI` and `runAllChecks` implemented and tested
- [ ] `src/planner.ts` — `planFromIssue` implemented and tested
- [ ] All four system prompts in `src/prompts/`

### Phase 3 — Orchestrator (Days 8–10)

- [ ] `src/agent.ts` — full pipeline implemented
- [ ] `__tests__/agent.test.ts` — all test cases passing
- [ ] Manual end-to-end test against a real GitHub issue

### Phase 4 — Webhook & Polish (Days 11–12)

- [ ] `src/webhook.ts` — HMAC validation + event routing
- [ ] `config/projects.ts` — Carma config entry filled in
- [ ] Full CI suite green on GitHub Actions
- [ ] Coverage thresholds met

### Phase 5 — Hardening (Days 13–14)

- [ ] Edge cases: issue with no body, very long title, duplicate label event
- [ ] Error handling audit — every external call has a typed catch
- [ ] `.claude/docs/README.md` fully populated with function reference
- [ ] ngrok test with real GitHub webhook

---

## 15. CLAUDE.md Instructions

> Place the contents below into `CLAUDE.md` at the project root.

---

```markdown
# issue-agent — Claude Code Instructions

Read this file completely before making any changes. Then read GAMEPLAN.md for full architecture detail.

---

## Project Purpose

This is a reusable GitHub issue-to-PR automation agent. It reads GitHub issues, writes
failing tests first (TDD), implements the code, runs CI locally, and opens a PR.
It is designed to work across multiple projects via a single config file.

---

## Before You Write Any Code

1. Read `GAMEPLAN.md` — it is the authoritative spec for every module
2. Read `.claude/docs/README.md` — it is the quick-reference for all files and functions
3. Check the relevant `__tests__/*.test.ts` file before touching any `src/` file
4. Run `npm test` to confirm the current state before making changes

---

## TDD Contract — Non-Negotiable

Tests are ALWAYS written before implementation. This applies to all code in this
repo, including the agent's own source files.

When implementing a function:

1. Write the test cases in `__tests__/` first
2. Confirm they fail: `npx vitest run`
3. Implement the function in `src/`
4. Confirm they pass: `npx vitest run`
5. Commit in two separate commits: `test(scope): ...` then `feat(scope): ...`

Never skip the failing test confirmation step.

---

## Code Conventions

- TypeScript strict mode — no `any`, no `@ts-ignore`, no implicit returns
- Named exports only — no default exports except in `config/projects.ts`
- All async functions must have explicit return types
- All external calls (GitHub API, git, shell) must be wrapped in try/catch
- No `console.log` in `src/` — use a consistent logger pattern
- All env vars accessed via `process.env` — validated at startup in `webhook.ts`

---

## File Reference

See `.claude/docs/README.md` for a function-by-function breakdown of every file.

---

## CI Requirements

Every PR must pass all four GitHub Actions jobs before merging:

- TypeScript — `npx tsc --noEmit`
- Lint — `npx eslint . --ext .ts`
- Tests — `npx vitest run` (sharded)
- Coverage gate — 80% lines, 80% functions, 75% branches

The pre-commit hook runs typecheck + related tests + lint-staged on every commit.

---

## Adding a New Target Project

1. Add one entry to `config/projects.ts` matching the `ProjectConfig` interface
2. The key must exactly match the GitHub repo name (matched against webhook payload)
3. Set `localPath` to the absolute path of the repo on the machine running the agent
4. Register the webhook in that repo's GitHub settings (see GAMEPLAN.md §12)
5. No other code changes are required

---

## Changelog

| Date       | Change                |
| ---------- | --------------------- |
| 2026-05-20 | Initial project setup |
```

---

## 16. Critical Rules

These rules apply at all times. They are not suggestions.

1. **Never make real network calls in tests.** Mock `@octokit/rest`, `simple-git`, `child_process`, and `@anthropic-ai/sdk` completely in every test file.

2. **TDD order is enforced in all code paths.** The agent commits test files before implementation files. This must be true even in error recovery paths.

3. **The webhook returns 202 before the agent starts.** `runAgent()` is fired without `await`. The HTTP response is sent first.

4. **HMAC signature validation is always on.** Do not add a dev-mode bypass. Use `crypto.timingSafeEqual`.

5. **The CI retry loop has a hard ceiling.** `maxCIAttempts` from the project config is the absolute maximum. The agent never loops indefinitely.

6. **No Carma-specific logic in `src/`.** The `src/` directory is project-agnostic. All per-project configuration belongs in `config/projects.ts`.

7. **No default exports in `src/`.** Named exports only. This keeps imports explicit and mockable.

8. **Use `tsx` for local development.** Do not build to JS for running locally. `npm run dev` and `npm run agent` use `tsx` directly.

9. **All shell commands run with `cwd` set to `localPath`.** Never assume the working directory in `ci.ts` or `git.ts`.

10. **Every PR opened by the agent includes `Closes #{issueNumber}`.** This auto-closes the issue on merge. It is written into the `pr-body` prompt and verified before calling `createPR`.

```

```
