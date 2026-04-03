/**
 * Smoke test — verifies the module loads and the custom Nitro server starts correctly.
 * We build the fixture and hit the /api/health endpoint.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const FIXTURE_DIR = fileURLToPath(new URL('../playground', import.meta.url))
const SERVER_ENTRY = join(FIXTURE_DIR, '.output/server/index.mjs')
const SERVER_PORT = 4243

async function waitForServer(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`)
}

describe('ssr — smoke test', () => {
  let serverProcess: ChildProcess

  beforeAll(async () => {
    const needsBuild = await access(SERVER_ENTRY)
      .then(() => false)
      .catch(() => true)
    if (needsBuild) {
      execFileSync('pnpm', ['dev:build'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'production' }
      })
    }

    serverProcess = spawn('node', [SERVER_ENTRY], {
      env: {
        ...process.env,
        NITRO_PORT: String(SERVER_PORT),
        NODE_ENV: 'production'
      },
      cwd: FIXTURE_DIR,
      stdio: 'pipe'
    })

    await waitForServer(SERVER_PORT)
  }, 120_000)

  afterAll(() => {
    serverProcess?.kill()
  })

  it('server starts and /api/health returns ok', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('ok')
  })

  it('unknown endpoints return 404', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/not-real`)
    expect(res.status).toBe(404)
  })
})
