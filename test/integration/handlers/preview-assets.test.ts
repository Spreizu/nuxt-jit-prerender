import { type ChildProcess } from 'node:child_process'
import { rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  buildOnce,
  generateRoutes,
  startServer,
  waitForServer,
  PUBLIC_DIR,
  MANIFEST_PATH,
  HOOKS_MARKER_PATH,
  extractHtmlTimestamp,
  extractPayloadTimestamp
} from '../helpers'

const PORT = 4260

describe('GET preview mode — asset serving', () => {
  let serverProcess: ChildProcess

  beforeAll(async () => {
    // Force a fresh build so _nuxt/ client bundles are on disk
    await rm(join(PUBLIC_DIR, '_nuxt'), { recursive: true, force: true }).catch(() => {})
    // Remove server entry so buildOnce() actually rebuilds
    const { unlink } = await import('node:fs/promises')
    await unlink(join(PUBLIC_DIR, '..', 'server', 'index.mjs')).catch(() => {})
    await buildOnce()

    // Clean generated HTML/payload but keep _nuxt/
    for (const child of await readdir(PUBLIC_DIR)) {
      if (child === '_nuxt') continue
      await rm(join(PUBLIC_DIR, child), { recursive: true, force: true })
    }
    await rm(MANIFEST_PATH, { force: true }).catch(() => {})
    await rm(HOOKS_MARKER_PATH, { force: true }).catch(() => {})

    // Generate pages so there is content to preview
    const generatorProcess = startServer(PORT + 1)
    await waitForServer(PORT + 1)
    await generateRoutes(PORT + 1, ['/', '/news'])
    generatorProcess.kill()

    serverProcess = startServer(PORT, { NUXT_JIT_PRERENDER_PREVIEW: 'true' })
    await waitForServer(PORT)
  }, 180_000)

  afterAll(() => {
    serverProcess?.kill()
  })

  it('serves _nuxt/ static assets from disk', async () => {
    const nuxtDir = join(PUBLIC_DIR, '_nuxt')
    const entries = await readdir(nuxtDir)
    const jsFile = entries.find((e) => e.endsWith('.js'))
    expect(jsFile).toBeDefined()

    const res = await fetch(`http://localhost:${PORT}/_nuxt/${jsFile}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
  })

  it('serves _payload.json with cache-busting query string', async () => {
    const res = await fetch(`http://localhost:${PORT}/news/_payload.json?0ef67baf-703a-4a27-ad87-369ed092afb3`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('HTML and _payload.json contain the same render timestamp', async () => {
    // Fetch the HTML page first — this triggers a fresh SSR render
    const htmlRes = await fetch(`http://localhost:${PORT}/news`)
    expect(htmlRes.status).toBe(200)
    const html = await htmlRes.text()
    const htmlTs = extractHtmlTimestamp(html)
    expect(htmlTs).not.toBeNull()

    // Then fetch the payload — it should reflect the same render
    const payloadRes = await fetch(`http://localhost:${PORT}/news/_payload.json?c`)
    expect(payloadRes.status).toBe(200)
    const payload = await payloadRes.text()
    const payloadTs = extractPayloadTimestamp(payload)
    expect(payloadTs).not.toBeNull()

    expect(payloadTs).toBe(htmlTs)
  })

  it('payload is not updated without a preceding HTML fetch', async () => {
    // Capture the current payload timestamp
    const beforeRes = await fetch(`http://localhost:${PORT}/news/_payload.json?before`)
    const beforeTs = extractPayloadTimestamp(await beforeRes.text())

    // Fetch the payload again without fetching HTML in between
    const afterRes = await fetch(`http://localhost:${PORT}/news/_payload.json?after`)
    const afterTs = extractPayloadTimestamp(await afterRes.text())

    // Timestamps should be identical — no fresh render occurred
    expect(afterTs).toBe(beforeTs)
  })
})
