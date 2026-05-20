import type { ProjectConfig } from '../src/types.js'

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
}
