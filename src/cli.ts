import { fileURLToPath } from 'node:url'
import { projects } from '../config/projects.js'
import { runAgent } from './agent.js'
import { log, logError } from './logger.js'

export async function runCLI(args: string[]): Promise<void> {
  if (args.length < 2) {
    logError('Usage: npx tsx src/cli.ts <project-name> <issue-number>')
    process.exit(1)
  }

  const [projectName, issueArg] = args
  const issueNumber = parseInt(issueArg ?? '', 10)

  if (isNaN(issueNumber) || issueNumber <= 0) {
    logError(`Invalid issue number '${issueArg}' — must be a positive integer`)
    process.exit(1)
  }

  const config = projects[projectName ?? '']
  if (!config) {
    logError(`Project '${projectName}' not found in config/projects.ts`)
    process.exit(1)
  }

  log(`Starting agent for ${projectName} issue #${issueNumber}`)

  const result = await runAgent(issueNumber, config)

  if (!result.success) {
    logError(`Agent failed for issue #${issueNumber}: ${result.errorMessage ?? 'unknown error'}`)
    process.exit(1)
  }

  log(`Agent completed — PR: ${result.prUrl ?? 'no URL'}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCLI(process.argv.slice(2)).catch((err: unknown) => {
    logError(String(err))
    process.exit(1)
  })
}
