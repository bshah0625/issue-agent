import { execSync } from 'child_process'
import type { CIResult, ProjectConfig } from './types.js'

export function runCI(localPath: string, command: string, stage: CIResult['stage']): CIResult {
  try {
    const output = execSync(command, { cwd: localPath, stdio: 'pipe' }).toString()
    return { passed: true, output, stage }
  } catch (err) {
    const error = err as { stdout?: Buffer; stderr?: Buffer; message?: string }
    const stdout = error.stdout?.toString() ?? ''
    const stderr = error.stderr?.toString() ?? ''
    const output = [stdout, stderr].filter(Boolean).join('\n')
    return {
      passed: false,
      output,
      stage,
      failureReason: output.slice(0, 500),
    }
  }
}

export function runAllChecks(localPath: string, config: ProjectConfig): CIResult[] {
  const allStages: Array<{ command: string; stage: CIResult['stage'] }> = [
    { command: config.ciCommands.typecheck, stage: 'typecheck' as const },
    { command: config.ciCommands.lint, stage: 'lint' as const },
    { command: config.ciCommands.test, stage: 'test' as const },
  ]
  const stages = allStages.filter(({ command }) => command.trim().length > 0)

  const results: CIResult[] = []

  for (const { command, stage } of stages) {
    const result = runCI(localPath, command, stage)
    results.push(result)
    if (!result.passed) break
  }

  return results
}
