# issue-agent

An automated GitHub issue-to-PR agent powered by Claude AI. When you label an issue, this agent reads it, writes failing tests first (TDD), implements the code, runs your CI checks, and opens a pull request — all without human intervention.

## How it works

```
GitHub issue labeled
        │
        ▼
  Webhook received
        │
        ▼
  Claude plans changes
  (files to create/modify)
        │
        ▼
  TDD Red Phase
  (write failing tests, commit)
        │
        ▼
  TDD Green Phase
  (implement code, commit)
        │
        ▼
  CI Loop (up to maxCIAttempts)
  typecheck → lint → tests
        │
        ▼ (all pass)
  Push branch → Open PR
```

If CI never passes, the agent posts a comment explaining the failure and adds an `agent-blocked` label.

## Setup

### Prerequisites

- Node.js 18+
- A GitHub personal access token with `repo` scope
- An Anthropic API key
- A server to run the webhook listener

### Install

```bash
npm install
```

### Environment variables

Create a `.env` file (see `.env.example`):

```env
GITHUB_TOKEN=ghp_...
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_WEBHOOK_SECRET=your-webhook-secret
PORT=3000
```

### Add a target project

Edit `config/projects.ts` and add an entry for each repository you want the agent to manage:

```typescript
export const projects: Record<string, ProjectConfig> = {
  'your-repo-name': {
    repoOwner: 'your-github-org',
    repoName: 'your-repo-name',
    baseBranch: 'main',
    localPath: '/absolute/path/to/cloned/repo',
    ciCommands: {
      typecheck: 'npx tsc --noEmit',
      lint: 'npx eslint . --ext .ts',
      test: 'npx vitest run',
    },
    testPathPattern: '__tests__/**/*.test.ts',
    agentReadyLabel: 'agent-ready',
    maxCIAttempts: 3,
  },
}
```

The key must exactly match the repository name from the GitHub webhook payload.

### Register the webhook

In your target repository's GitHub settings:

- **Payload URL**: `https://your-server.example.com/webhook`
- **Content type**: `application/json`
- **Secret**: same value as `GITHUB_WEBHOOK_SECRET`
- **Events**: Issues

### Run the server

```bash
npm run dev          # development (tsx watch)
npm start            # production (compiled JS)
```

## Triggering the agent

Add the label defined in `agentReadyLabel` (default: `agent-ready`) to any issue. The agent runs asynchronously — the webhook returns `202 Accepted` immediately and the agent works in the background.

## Development

```bash
npm test                # run tests once
npm run test:watch      # watch mode
npm run test:coverage   # coverage report (thresholds: 80% lines/functions, 75% branches)
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run build           # compile to dist/
```

### Architecture

| File | Role |
|------|------|
| `src/webhook.ts` | HTTP server — validates HMAC-SHA256, routes `issues.labeled` events |
| `src/agent.ts` | Full pipeline orchestrator (plan → TDD red → TDD green → CI loop → PR) |
| `src/planner.ts` | Claude-powered plan generator — returns files to create/modify |
| `src/github.ts` | Thin Octokit wrapper for all GitHub API calls |
| `src/git.ts` | simple-git wrapper for local repository operations |
| `src/ci.ts` | Synchronous CI runner using `child_process.execSync` |
| `src/prompts/` | System prompts for each Claude call (plan, tests, implement, PR body) |
| `config/projects.ts` | Per-project configuration — one entry per target repository |

### Adding a new target repository

1. Add an entry to `config/projects.ts`
2. Clone the target repo to the path set in `localPath`
3. Register the webhook in that repo's GitHub settings
4. No other code changes required

### Tests

Tests live in `__tests__/` and follow strict TDD — every function has tests that were written before the implementation. All external calls (GitHub API, git, Claude) are mocked; no real network calls are made in tests.

```bash
npm test
```

## License

MIT
