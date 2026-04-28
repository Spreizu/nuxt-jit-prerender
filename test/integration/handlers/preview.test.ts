import { type ChildProcess } from 'node:child_process'
import { writeFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  buildOnce,
  cleanOutput,
  generateRoutes,
  startServer,
  waitForServer,
  PUBLIC_DIR,
  createSentinelFiles,
  cleanupSentinelFiles,
  SENTINEL_PATH,
  SENTINEL_CONTENT
} from '../helpers'
import { readStaticFile } from '../helpers'

const PORT = 4256

describe('GET preview mode', () => {
  let serverProcess: ChildProcess

  beforeAll(async () => {
    await buildOnce()
    await cleanOutput()

    // Generate some pages so we have static content to preview
    const generatorProcess = startServer(PORT + 1)
    await waitForServer(PORT + 1)
    await generateRoutes(PORT + 1, ['/', '/news'])
    generatorProcess.kill()

    // Start the server in preview mode
    serverProcess = startServer(PORT, { NUXT_JIT_PRERENDER_PREVIEW: 'true' })
    await waitForServer(PORT)
  }, 120_000)

  afterAll(() => {
    serverProcess?.kill()
  })

  it('renders the root page on-demand', async () => {
    const res = await fetch(`http://localhost:${PORT}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const html = await res.text()
    expect(html).toContain('<html')

    const match = html.match(/data-testid="rendered-at">(\d+)/)
    expect(match).not.toBeNull()
    const renderedAt = Number(match![1])
    expect(renderedAt).toBeGreaterThan(Date.now() - 10_000)
  })

  it('serves _nuxt/ static assets', async () => {
    const nuxtDir = join(PUBLIC_DIR, '_nuxt')
    let entries: string[]
    try {
      entries = await readdir(nuxtDir)
    } catch {
      return
    }

    const jsFile = entries.find((e) => e.endsWith('.js'))
    if (!jsFile) return

    const res = await fetch(`http://localhost:${PORT}/_nuxt/${jsFile}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
  })

  it('renders a page on-demand even when a stale static file exists', async () => {
    // /news was generated in beforeAll, so a stale file exists on disk.
    const staleHtml = await readStaticFile(PUBLIC_DIR, '/news')
    const staleMatch = staleHtml.match(/data-testid="rendered-at">(\d+)/)
    const staleTimestamp = staleMatch ? Number(staleMatch[1]) : 0

    const res = await fetch(`http://localhost:${PORT}/news`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const html = await res.text()
    const match = html.match(/data-testid="rendered-at">(\d+)/)
    expect(match).not.toBeNull()
    expect(Number(match![1])).toBeGreaterThan(staleTimestamp)
  })

  it('API endpoints return 404 in preview mode', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/health`)
    expect(res.status).toBe(404)
  })

  it('serves 404 for non-existent assets', async () => {
    const res = await fetch(`http://localhost:${PORT}/nonexistent-asset.png`)
    expect(res.status).toBe(404)
  })

  it('serves CSS files with correct content-type', async () => {
    await writeFile(join(PUBLIC_DIR, 'style.css'), 'body{}')
    const res = await fetch(`http://localhost:${PORT}/style.css`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/css')
  })

  it('serves JSON files with correct content-type', async () => {
    await writeFile(join(PUBLIC_DIR, 'data.json'), '{"a":1}')
    const res = await fetch(`http://localhost:${PORT}/data.json`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('serves SVG files with correct content-type', async () => {
    await writeFile(join(PUBLIC_DIR, 'icon.svg'), '<svg/>')
    const res = await fetch(`http://localhost:${PORT}/icon.svg`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/svg+xml')
  })

  it('renders _payload.json fresh via SSR, not from stale disk file', async () => {
    // /news was generated in beforeAll on the non-preview server, so a stale _payload.json exists
    const stalePayload = await readStaticFile(PUBLIC_DIR, '/news/_payload.json')
    const staleData: unknown[] = JSON.parse(stalePayload)
    const staleTimestamp = staleData.findLast((v): v is number => typeof v === 'number') ?? 0

    // Wait to ensure the new SSR render gets a distinct timestamp
    await new Promise((r) => setTimeout(r, 5))

    const res = await fetch(`http://localhost:${PORT}/news/_payload.json`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = await res.text()
    const freshData: unknown[] = JSON.parse(body)
    const freshTimestamp = freshData.findLast((v): v is number => typeof v === 'number')
    expect(freshTimestamp).toBeDefined()
    expect(freshTimestamp!).toBeGreaterThan(staleTimestamp)
  })

  it('URL-normalized traversal resolves inside publicDir', async () => {
    await mkdir(join(PUBLIC_DIR, 'traversal-test'), { recursive: true })
    await writeFile(join(PUBLIC_DIR, 'traversal-test', 'sentinel.txt'), 'inside-public')

    // Node.js fetch normalizes /../traversal-test/sentinel.txt to /traversal-test/sentinel.txt
    const res = await fetch(`http://localhost:${PORT}/../traversal-test/sentinel.txt`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('inside-public')

    await rm(join(PUBLIC_DIR, 'traversal-test'), { recursive: true, force: true })
  })

  it('traversal does not serve files outside publicDir', async () => {
    await createSentinelFiles()

    const res = await fetch(`http://localhost:${PORT}/../.traversal-sentinel.json`)
    expect(res.status).toBe(404)

    expect(await readFile(SENTINEL_PATH, 'utf-8')).toBe(SENTINEL_CONTENT)
    await cleanupSentinelFiles()
  })
})
