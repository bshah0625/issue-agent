import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('log', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    writeSpy.mockRestore()
  })

  it('writes a timestamped message to stdout', async () => {
    const { log } = await import('../src/logger')
    log('server started')

    expect(writeSpy).toHaveBeenCalledOnce()
    const output = writeSpy.mock.calls[0]?.[0] as string
    expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(output).toContain('server started')
  })

  it('ends the output with a newline', async () => {
    const { log } = await import('../src/logger')
    log('any message')

    const output = writeSpy.mock.calls[0]?.[0] as string
    expect(output).toMatch(/\n$/)
  })

  it('includes the message verbatim in the output', async () => {
    const { log } = await import('../src/logger')
    log('Agent error for issue #42: timeout')

    const output = writeSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('Agent error for issue #42: timeout')
  })
})

describe('logError', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    writeSpy.mockRestore()
  })

  it('writes a timestamped ERROR message to stderr', async () => {
    const { logError } = await import('../src/logger')
    logError('HMAC validation failed')

    expect(writeSpy).toHaveBeenCalledOnce()
    const output = writeSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('[ERROR]')
    expect(output).toContain('HMAC validation failed')
  })

  it('ends the error output with a newline', async () => {
    const { logError } = await import('../src/logger')
    logError('boom')

    const output = writeSpy.mock.calls[0]?.[0] as string
    expect(output).toMatch(/\n$/)
  })
})
