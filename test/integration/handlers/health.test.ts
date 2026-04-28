import { type ChildProcess } from 'node:child_process'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { buildOnce, cleanOutput, generateRoutes, startServer, waitForServer } from '../helpers'

const PORT = 4252

describe('GET /api/health', () => {
  let serverProcess: ChildProcess

  beforeAll(async () => {
    await buildOnce()
    await cleanOutput()
    serverProcess = startServer(PORT)
    await waitForServer(PORT)
  }, 120_000)

  afterAll(() => {
    serverProcess?.kill()
  })

  it('returns 200', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('ok')
  })

  it('includes queue status with pendingRoutes', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.queue).toBeDefined()
    const queue = body.queue as Record<string, unknown>
    expect(queue).toHaveProperty('activeOperation')
    expect(queue).toHaveProperty('queued')
    expect(queue).toHaveProperty('pendingRoutes')
    expect(Array.isArray(queue.pendingRoutes)).toBe(true)
  })

  it('is not blocked by a running operation', async () => {
    const generatePromise = generateRoutes(PORT, ['/article/300'])

    const healthRes = await fetch(`http://localhost:${PORT}/api/health`)
    expect(healthRes.status).toBe(200)

    await generatePromise
  }, 20_000)
})
