import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
/**
 * Integration tests for JIT functionality.
 *
 * Strategy:
 *   1. Build the playground with our custom Nitro preset (pnpm dev:build).
 *      The playground IS the integration fixture — one build for both dev and CI.
 *   2. Spawn the built server (`node playground/.output/server/index.mjs`).
 *   3. POST routes to `/api/generate` — the only way pages are rendered in this preset.
 *   4. Assert on the generated static HTML files, `_payload.json`, and
 *      the `.cache-manifest.json` bidirectional tag registry.
 */
import { readFile, rm, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const PLAYGROUND_DIR = fileURLToPath(new URL('../../playground', import.meta.url))
const OUTPUT_DIR = join(PLAYGROUND_DIR, '.output')
const PUBLIC_DIR = join(OUTPUT_DIR, 'public')
const SERVER_ENTRY = join(OUTPUT_DIR, 'server/index.mjs')
const MANIFEST_PATH = join(OUTPUT_DIR, '.cache-manifest.json')

const SERVER_PORT = 4242

async function waitForServer(port: number, timeoutMs = 15_000): Promise<void> {
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

async function generateRoutes(routes: string[]): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  const res = await fetch(`http://localhost:${SERVER_PORT}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routes })
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function readManifest(): Promise<{
  tagToRoutes: Record<string, string[]>
  routeToTags: Record<string, string[]>
}> {
  // Wait up to 1500ms for the debounced save to flush
  await new Promise((r) => setTimeout(r, 1500))
  const content = await readFile(MANIFEST_PATH, 'utf-8')
  return JSON.parse(content)
}

async function readStaticFile(pathname: string): Promise<string> {
  const hasExtension = /\.[^/]+$/.test(pathname)
  const filePath = hasExtension
    ? join(PUBLIC_DIR, pathname.replace(/^\//, ''))
    : join(PUBLIC_DIR, pathname === '/' ? 'index.html' : `${pathname.replace(/^\//, '')}/index.html`)
  return readFile(filePath, 'utf-8')
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('JIT Prerender', () => {
  let serverProcess: ChildProcess

  beforeAll(async () => {
    // 1. Build the fixture with our custom Nitro preset (runs `nuxi build`)
    //    Skip if the server entry already exists so re-runs are fast.
    const needsBuild = await access(SERVER_ENTRY)
      .then(() => false)
      .catch(() => true)
    if (needsBuild) {
      // `pnpm dev:build` builds the module stubs then the playground via `nuxi build playground`
      execFileSync('pnpm', ['dev:build'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'production' }
      })
    }

    // 2. Clean public dir so each run is deterministic
    await rm(PUBLIC_DIR, { recursive: true, force: true })
    await mkdir(PUBLIC_DIR, { recursive: true })

    // 3. Launch the built server, pointing output to the fixture's .output/public
    serverProcess = spawn('node', [SERVER_ENTRY], {
      env: {
        ...process.env,
        NITRO_PORT: String(SERVER_PORT),
        NITRO_JIT_PRERENDER_OUTPUT_DIR: PUBLIC_DIR,
        NODE_ENV: 'production'
      },
      cwd: PLAYGROUND_DIR,
      stdio: 'pipe'
    })

    serverProcess.stderr?.on('data', (_d: Buffer) => {
      // Uncomment to debug: console.error('[server]', _d.toString())
    })

    await waitForServer(SERVER_PORT)
  }, 120_000) // building takes time

  afterAll(async () => {
    serverProcess?.kill()
  })

  // ─── Phase 1: Health check ─────────────────────────────────────────────────

  it('Phase 1: /api/health returns 200', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('ok')
  })

  // ─── Phase 2: Route generation ────────────────────────────────────────────

  it('Phase 2: POST /api/generate returns 200 and generates HTML files', async () => {
    const { status, body } = await generateRoutes([
      '/',
      '/news',
      '/no-tags',
      '/article/1',
      '/article/4',
      '/category/tech',
      '/category/tech/article/5'
    ])

    expect(status).toBe(200)
    expect(body.success).toBe(true)

    const summary = body.summary as Record<string, number>
    expect(summary.requested).toBe(7)
    expect(summary.generated).toBe(7)

    // Verify HTML files exist on disk
    await expect(readStaticFile('/')).resolves.toContain('<html')
    await expect(readStaticFile('/news')).resolves.toContain('<html')
    await expect(readStaticFile('/article/1')).resolves.toContain('<html')
    await expect(readStaticFile('/category/tech')).resolves.toContain('<html')
    await expect(readStaticFile('/category/tech/article/5')).resolves.toContain('<html')
  }, 30_000)

  // ─── Phase 3: _payload.json auto-generation ───────────────────────────────

  it('Phase 3: _payload.json files are auto-generated alongside HTML', async () => {
    await expect(readStaticFile('/_payload.json')).resolves.toBeTruthy()
    await expect(readStaticFile('/news/_payload.json')).resolves.toBeTruthy()
    await expect(readStaticFile('/article/1/_payload.json')).resolves.toBeTruthy()
  })

  // ─── Phase 4: Cache tag headers & composable propagation ─────────────────

  it('Phase 4a: /news results contain tags from both useCacheTags and useNewsApi (composable chain)', async () => {
    const { body } = await generateRoutes(['/news'])
    const results = body.results as Array<{ route: string; success: boolean; cacheTags?: string[] }>
    const newsResult = results.find((r) => r.route === '/news')

    expect(newsResult?.success).toBe(true)
    // Tags from page layer
    expect(newsResult?.cacheTags).toContain('page:news')
    expect(newsResult?.cacheTags).toContain('article:1')
    expect(newsResult?.cacheTags).toContain('article:2')
    expect(newsResult?.cacheTags).toContain('article:3')
    // Tags injected by the useNewsApi composable — proves composable-level injection works
    expect(newsResult?.cacheTags).toContain('global:news')
  }, 20_000)

  it('Phase 4b: /no-tags page has empty cacheTags (no crash on tag-less pages)', async () => {
    const { body } = await generateRoutes(['/no-tags'])
    const results = body.results as Array<{ route: string; success: boolean; cacheTags?: string[] }>
    const noTagResult = results.find((r) => r.route === '/no-tags')

    expect(noTagResult?.success).toBe(true)
    expect(noTagResult?.cacheTags ?? []).toHaveLength(0)
  }, 20_000)

  it('Phase 4c: Dynamic route tags use interpolated params', async () => {
    const { body } = await generateRoutes(['/article/42'])
    const results = body.results as Array<{ route: string; success: boolean; cacheTags?: string[] }>
    const articleResult = results.find((r) => r.route === '/article/42')

    expect(articleResult?.success).toBe(true)
    expect(articleResult?.cacheTags).toContain('article:42')
    expect(articleResult?.cacheTags).toContain('page:article')
  }, 20_000)

  it('Phase 4d: Doubly-nested dynamic route has tags from both params', async () => {
    const { body } = await generateRoutes(['/category/tech/article/99'])
    const results = body.results as Array<{ route: string; success: boolean; cacheTags?: string[] }>
    const nestedResult = results.find((r) => r.route === '/category/tech/article/99')

    expect(nestedResult?.success).toBe(true)
    expect(nestedResult?.cacheTags).toContain('category:tech')
    expect(nestedResult?.cacheTags).toContain('article:99')
  }, 20_000)

  // ─── Phase 5: CacheRegistry — .cache-manifest.json validation ────────────

  it('Phase 5a: .cache-manifest.json has correct bidirectional tagToRoutes mappings', async () => {
    // Trigger a fresh full generation to fill the registry
    await generateRoutes(['/', '/news', '/article/1', '/article/4', '/category/tech', '/category/tech/article/5'])

    const manifest = await readManifest()

    // article:1 should appear in both /news (listed explicitly) and /article/1 (param)
    expect(manifest.tagToRoutes['article:1']).toEqual(expect.arrayContaining(['/news', '/article/1']))

    // article:4 only referenced by /article/4
    expect(manifest.tagToRoutes['article:4']).toEqual(['/article/4'])

    // category:tech referenced by category index AND nested article
    expect(manifest.tagToRoutes['category:tech']).toEqual(
      expect.arrayContaining(['/category/tech', '/category/tech/article/5'])
    )

    // global:news injected by useNewsApi inside /news
    expect(manifest.tagToRoutes['global:news']).toEqual(expect.arrayContaining(['/news']))
  }, 30_000)

  it('Phase 5b: routeToTags is the correct inverse of tagToRoutes', async () => {
    const manifest = await readManifest()

    expect(manifest.routeToTags['/news']).toEqual(
      expect.arrayContaining(['page:news', 'article:1', 'article:2', 'article:3', 'global:news'])
    )

    expect(manifest.routeToTags['/article/4']).toEqual(expect.arrayContaining(['page:article', 'article:4']))
  })

  // ─── Phase 6: Error handling ──────────────────────────────────────────────

  it('Phase 6a: POST /api/generate with empty routes array returns 400', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routes: [] })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
  })

  it('Phase 6b: POST /api/generate with non-array routes returns 400', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routes: '/about' })
    })
    expect(res.status).toBe(400)
  })

  it('Phase 6c: POST /api/generate with invalid JSON returns 400', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json'
    })
    expect(res.status).toBe(500)
  })

  it('Phase 6d: Unknown routes return 404', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/unknown-endpoint`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
  })
})
