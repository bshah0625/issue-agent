import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { projects } from '../config/projects.js'
import { runAgent } from './agent.js'
import { log, logError } from './logger.js'

function jsonResponse(res: ServerResponse, status: number, body: Record<string, string>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function validateHmac(secret: string, payload: Buffer, signature: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const event = req.headers['x-github-event'] as string | undefined

  log(`${req.method} ${req.url} event=${event ?? 'none'}`)

  if (req.method !== 'POST' || req.url !== '/webhook') {
    return jsonResponse(res, 404, { status: 'not found' })
  }

  const body = await readBody(req)
  const signature = req.headers['x-hub-signature-256'] as string | undefined
  const secret = process.env['GITHUB_WEBHOOK_SECRET'] ?? ''

  if (!signature || !validateHmac(secret, body, signature)) {
    logError('HMAC validation failed')
    return jsonResponse(res, 403, { status: 'forbidden' })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body.toString()) as Record<string, unknown>
  } catch {
    return jsonResponse(res, 400, { status: 'invalid json' })
  }

  const repo = (payload['repository'] as Record<string, string> | undefined)?.['name'] ?? 'unknown'
  const action = payload['action'] as string | undefined
  const labelName = (payload['label'] as Record<string, string> | undefined)?.['name']
  const issueNumber = (payload['issue'] as Record<string, number> | undefined)?.['number']

  log(`${req.method} ${req.url} event=${event ?? 'none'} repo=${repo}`)

  if (event !== 'issues' || action !== 'labeled') {
    return jsonResponse(res, 200, { status: 'ignored' })
  }

  const projectConfig = projects[repo]

  if (!projectConfig) {
    log(`Warning: no config found for repo '${repo}'`)
    return jsonResponse(res, 200, { status: 'project not configured' })
  }

  if (labelName !== projectConfig.agentReadyLabel || issueNumber === undefined) {
    return jsonResponse(res, 200, { status: 'ignored' })
  }

  // Fire and forget — 202 must be sent before agent begins work
  void runAgent(issueNumber, projectConfig).catch((err: unknown) => {
    logError(`Agent error for issue #${issueNumber}: ${String(err)}`)
  })

  return jsonResponse(res, 202, { status: 'accepted' })
}

export const server = createServer(handleWebhook)

export function startServer(port: number): void {
  server.listen(port, () => {
    log(`Webhook server listening on port ${port}`)

    const requiredEnv = ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'GITHUB_WEBHOOK_SECRET']
    for (const key of requiredEnv) {
      if (!process.env[key]) {
        logError(`Missing required environment variable: ${key}`)
        process.exit(1)
      }
    }
  })
}

// Only start server when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer(parseInt(process.env['PORT'] ?? '3000', 10))
}
