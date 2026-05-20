import { vi } from 'vitest'

const defaultPlanResponse = JSON.stringify({
  summary: 'Default test plan',
  issueType: 'feature',
  testFiles: [{ path: '__tests__/feature.test.ts', action: 'create', description: 'Feature test' }],
  implementationFiles: [
    { path: 'src/feature.ts', action: 'create', description: 'Feature implementation' },
  ],
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function () {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: defaultPlanResponse }],
        }),
      },
    }
  }),
}))

process.env['GITHUB_TOKEN'] = 'test-token'
process.env['ANTHROPIC_API_KEY'] = 'test-key'
process.env['GITHUB_WEBHOOK_SECRET'] = 'test-secret'
