import type { ProjectConfig } from '../src/types.js'

export const projects: Record<string, ProjectConfig> = {
  carma: {
    repoOwner: 'bshah0625',
    repoName: 'carma',
    baseBranch: 'main',
    localPath: 'C:\\Users\\BMW Coder\\Documents\\projects\\carma',
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
