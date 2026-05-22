# issue-agent — File & Function Reference

Quick reference for all source files and their exported functions.

---

## src/types.ts

No logic. Exports all shared TypeScript interfaces:

- `IssueType` — union: `'feature' | 'bug' | 'chore' | 'test' | 'refactor'`
- `Issue` — GitHub issue mapped to agent shape
- `FileChange` — single file to create/modify/delete
- `AgentPlan` — full plan returned by planner
- `CIResult` — result of running one CI stage
- `AgentResult` — final result returned by runAgent
- `ProjectConfig` — per-project configuration

---

## src/github.ts

Thin Octokit wrapper. All functions throw descriptive errors on failure.

| Function                                                        | Returns                   | Notes                   |
| --------------------------------------------------------------- | ------------------------- | ----------------------- |
| `getIssue(owner, repo, number)`                                 | `Promise<Issue>`          | Maps labels to string[] |
| `createBranch(owner, repo, branchName, baseSha)`                | `Promise<void>`           |                         |
| `getFileSha(owner, repo, path, branch)`                         | `Promise<string \| null>` | null on 404             |
| `upsertFile(owner, repo, path, content, message, branch, sha?)` | `Promise<void>`           | Create or update        |
| `createPR(owner, repo, title, body, head, base)`                | `Promise<string>`         | Returns html_url        |
| `addLabel(owner, repo, issueNumber, label)`                     | `Promise<void>`           |                         |
| `postComment(owner, repo, issueNumber, body)`                   | `Promise<void>`           |                         |

---

## src/logger.ts

Shared structured logger. All `src/` files use these instead of `console.log`.

| Function            | Output                | Notes                |
| ------------------- | --------------------- | -------------------- |
| `log(message)`      | stdout with timestamp | ISO timestamp prefix |
| `logError(message)` | stderr with timestamp | Prefixes `[ERROR]`   |

---

## src/git.ts

simple-git wrapper. All functions take `localPath` as first argument.

| Function                                         | Returns           | Notes                           |
| ------------------------------------------------ | ----------------- | ------------------------------- |
| `cloneOrPull(repoUrl, localPath)`                | `Promise<void>`   | Pull if exists, clone if not    |
| `checkoutAndPull(localPath, branch)`             | `Promise<void>`   | Checkout branch and pull latest |
| `createAndCheckoutBranch(localPath, branchName)` | `Promise<void>`   | From current HEAD               |
| `stageAll(localPath)`                            | `Promise<void>`   | git add -A                      |
| `commit(localPath, message)`                     | `Promise<void>`   | Throws if nothing staged        |
| `push(localPath, branchName)`                    | `Promise<void>`   | Sets upstream                   |
| `getHeadSha(localPath)`                          | `Promise<string>` | Returns HEAD SHA                |

---

## src/ci.ts

Shell command runner using child_process.execSync.

| Function                           | Returns      | Notes                  |
| ---------------------------------- | ------------ | ---------------------- |
| `runCI(localPath, command, stage)` | `CIResult`   | Synchronous            |
| `runAllChecks(localPath, config)`  | `CIResult[]` | Stops on first failure |

---

## src/planner.ts

Claude-powered plan generator.

| Function                                 | Returns              | Notes                       |
| ---------------------------------------- | -------------------- | --------------------------- |
| `planFromIssue(issue, fileTree, config)` | `Promise<AgentPlan>` | Parses Claude JSON response |

Branch name rules:

- `feat/issue-{n}-{slug}` for features
- `fix/issue-{n}-{slug}` for bugs
- Slug: lowercase, hyphens, max 40 chars

---

## src/agent.ts

Full pipeline orchestrator.

| Function                        | Returns                | Notes             |
| ------------------------------- | ---------------------- | ----------------- |
| `runAgent(issueNumber, config)` | `Promise<AgentResult>` | Full TDD pipeline |

Execution order: getIssue → planFromIssue → checkoutAndPull → createAndCheckoutBranch → TDD red → TDD green → CI loop → push → createPR

---

## src/webhook.ts

HTTP server using Node's built-in `http` module.

| Export                    | Type            | Notes                                          |
| ------------------------- | --------------- | ---------------------------------------------- |
| `handleWebhook(req, res)` | `Promise<void>` | Validates HMAC, routes `issues.labeled` events |
| `startServer(port)`       | `void`          | Binds HTTP server; validates required env vars |
| `server`                  | `http.Server`   | Underlying server instance                     |
| `inFlight`                | `Set<number>`   | Issue numbers currently being processed        |

- Returns 202 before firing `runAgent()` (non-blocking, fire-and-forget)
- Uses `crypto.timingSafeEqual` for timing-safe HMAC comparison
- Deduplicates concurrent events for the same issue number via `inFlight` Set

---

## src/cli.ts

Manual trigger CLI — runs the agent directly without a webhook.

| Export         | Signature       | Notes                              |
| -------------- | --------------- | ---------------------------------- |
| `runCLI(args)` | `Promise<void>` | Args: `[projectName, issueNumber]` |

Usage: `npx tsx src/cli.ts <project-name> <issue-number>`

---

## config/projects.ts

`projects: Record<string, ProjectConfig>` — keyed by repo name.
Add one entry per target repository. Key must match `repository.name` in webhook payload.

---

## src/prompts/

System prompts for Claude calls:

- `plan.ts` — issue → structured file change plan (JSON)
- `tests.ts` — plan → failing test code (TDD red phase)
- `implement.ts` — plan + tests → implementation code (TDD green phase)
- `pr-body.ts` — completed changes → PR description markdown
