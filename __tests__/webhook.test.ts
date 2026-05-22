import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('../src/agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue({
    success: true,
    prUrl: 'https://github.com/pr/1',
    branchName: 'feat/1',
    ciAttempts: 0,
  }),
}))

vi.mock('../config/projects.js', () => ({
  projects: {
    'test-repo': {
      repoOwner: 'owner',
      repoName: 'test-repo',
      localPath: '/tmp/test-repo',
      baseBranch: 'main',
      agentReadyLabel: 'agent-ready',
      maxCIAttempts: 3,
      ciCommands: [],
    },
  },
}))

function makeSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`
}

function makeReq(overrides: {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
}) {
  const body = overrides.body ?? ''
  const chunks = [Buffer.from(body)]
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}

  return {
    method: overrides.method ?? 'POST',
    url: overrides.url ?? '/webhook',
    headers: overrides.headers ?? {},
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? []
      listeners[event].push(fn)
      if (event === 'data') chunks.forEach((c) => fn(c))
      if (event === 'end') fn()
    }),
  }
}

function makeRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  }
}

describe('handleWebhook', () => {
  beforeEach(() => {
    process.env['GITHUB_WEBHOOK_SECRET'] = 'test-secret'
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 404 for non-POST requests', async () => {
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({ method: 'GET' })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
  })

  it('returns 404 for POST to wrong path', async () => {
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({ url: '/other' })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
  })

  it('returns 403 when signature is missing', async () => {
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({ headers: {} })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object))
  })

  it('returns 403 when signature is wrong', async () => {
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({
      headers: { 'x-hub-signature-256': 'sha256=badhash', 'x-github-event': 'issues' },
      body: '{}',
    })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object))
  })

  it('returns 400 for invalid JSON body', async () => {
    const body = 'not-json'
    const sig = makeSignature('test-secret', body)
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({
      headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
      body,
    })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
  })

  it('returns 200 ignored for non-issue events', async () => {
    const body = JSON.stringify({ action: 'opened' })
    const sig = makeSignature('test-secret', body)
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({
      headers: { 'x-hub-signature-256': sig, 'x-github-event': 'push' },
      body,
    })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('ignored'))
  })

  it('returns 200 for project not configured', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      repository: { name: 'unknown-repo' },
      label: { name: 'agent-ready' },
      issue: { number: 1 },
    })
    const sig = makeSignature('test-secret', body)
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({
      headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
      body,
    })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('not configured'))
  })

  it('returns 202 accepted and fires runAgent for a valid labeled event', async () => {
    const { runAgent } = await import('../src/agent.js')
    const body = JSON.stringify({
      action: 'labeled',
      repository: { name: 'test-repo' },
      label: { name: 'agent-ready' },
      issue: { number: 42 },
    })
    const sig = makeSignature('test-secret', body)
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({
      headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
      body,
    })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object))
    expect(runAgent).toHaveBeenCalledWith(42, expect.objectContaining({ repoName: 'test-repo' }))
  })

  it('returns 200 ignored when label does not match agentReadyLabel', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      repository: { name: 'test-repo' },
      label: { name: 'some-other-label' },
      issue: { number: 5 },
    })
    const sig = makeSignature('test-secret', body)
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({
      headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
      body,
    })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('ignored'))
  })

  it('logs an error but keeps running when runAgent rejects after 202 is sent', async () => {
    const { runAgent } = await import('../src/agent.js')
    vi.mocked(runAgent).mockRejectedValue(new Error('out of memory'))

    const body = JSON.stringify({
      action: 'labeled',
      repository: { name: 'test-repo' },
      label: { name: 'agent-ready' },
      issue: { number: 77 },
    })
    const sig = makeSignature('test-secret', body)
    const { handleWebhook } = await import('../src/webhook')
    const req = makeReq({
      headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
      body,
    })
    const res = makeRes()

    await handleWebhook(req as never, res as never)

    // 202 must still be returned synchronously before the agent runs
    expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object))

    // Let the microtask queue drain so the rejected promise catch handler fires
    await new Promise((r) => setTimeout(r, 0))
  })

  it('returns 202 and does not call runAgent again for a duplicate in-flight event', async () => {
    const { runAgent } = await import('../src/agent.js')
    let resolveAgent!: () => void
    vi.mocked(runAgent).mockReturnValue(
      new Promise<never>((resolve) => {
        resolveAgent = resolve as () => void
      })
    )

    const body = JSON.stringify({
      action: 'labeled',
      repository: { name: 'test-repo' },
      label: { name: 'agent-ready' },
      issue: { number: 99 },
    })
    const sig = makeSignature('test-secret', body)
    const { handleWebhook } = await import('../src/webhook')

    const req1 = makeReq({
      headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
      body,
    })
    const req2 = makeReq({
      headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
      body,
    })
    const res1 = makeRes()
    const res2 = makeRes()

    // Fire first request — agent is now in-flight
    await handleWebhook(req1 as never, res1 as never)
    // Fire duplicate before agent completes
    await handleWebhook(req2 as never, res2 as never)

    expect(res1.writeHead).toHaveBeenCalledWith(202, expect.any(Object))
    expect(res2.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res2.end).toHaveBeenCalledWith(expect.stringContaining('in progress'))
    expect(runAgent).toHaveBeenCalledTimes(1)

    resolveAgent()
  })
})
