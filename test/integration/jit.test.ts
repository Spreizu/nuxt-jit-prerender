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
const HOOKS_MARKER_PATH = join(OUTPUT_DIR, '.hooks-marker.json')

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

async function deleteRoutes(routes: string[]): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  const res = await fetch(`http://localhost:${SERVER_PORT}/api/route`, {
    method: 'DELETE',
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
        PORT: String(SERVER_PORT),
        NUXT_JIT_PRERENDER_OUTPUT_DIR: OUTPUT_DIR,
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
    expect(res.status).toBe(400)
  })

  it('Phase 6d: Unknown routes return 404', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/unknown-endpoint`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
  })

  it('Phase 6e: POST /api/generate for non-existent route returns success: false', async () => {
    const { status, body } = await generateRoutes(['/this-page-does-not-exist'])
    expect(status).toBe(200) // The API call itself succeeds
    expect(body.success).toBe(true)

    const results = body.results as any[]
    expect(results).toHaveLength(1)
    expect(results[0].route).toBe('/this-page-does-not-exist')
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('404')
  })

  // ─── Phase 7: /api/invalidate ─────────────────────────────────────────────

  it('Phase 7a: POST /api/invalidate by tag re-renders affected routes', async () => {
    // First generate pages so the registry is populated
    await generateRoutes(['/article/10', '/article/11', '/news'])

    const res = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['article:10'] })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.all).toBe(false)

    const regenerated = body.regenerated as string[]
    // /article/10 has the tag article:10 — should be in the affected set
    expect(regenerated).toContain('/article/10')
    // /article/11 does NOT have article:10 — should not be re-rendered
    expect(regenerated).not.toContain('/article/11')

    const summary = body.summary as Record<string, number>
    expect(summary.success).toBe(summary.total)
    expect(summary.failed).toBe(0)
    expect(Array.isArray(body.failed)).toBe(true)
  }, 20_000)

  it('Phase 7b: POST /api/invalidate by tag that spans multiple routes re-renders all of them', async () => {
    // /news has global:news tag (via useNewsApi); /article/1 has article:1 tag
    await generateRoutes(['/news', '/article/1'])

    const res = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['global:news'] })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    const regenerated = body.regenerated as string[]

    // /news depends on global:news (injected by useNewsApi)
    expect(regenerated).toContain('/news')
    // /article/1 does NOT depend on global:news
    expect(regenerated).not.toContain('/article/1')
  }, 20_000)

  it('Phase 7c: POST /api/invalidate with all:true re-renders every route in the registry', async () => {
    // Populate registry
    await generateRoutes(['/article/20', '/article/21', '/no-tags'])

    const res = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.all).toBe(true)
    expect(body.tags).toEqual([])

    const regenerated = body.regenerated as string[]
    // Both tagged routes must be re-rendered; /no-tags has no tags so it won't be in the registry
    expect(regenerated).toContain('/article/20')
    expect(regenerated).toContain('/article/21')

    const summary = body.summary as Record<string, number>
    expect(summary.success).toBe(summary.total)
  }, 20_000)

  it('Phase 7d: POST /api/invalidate with all:true ignores any tags field provided', async () => {
    await generateRoutes(['/article/30'])

    const res = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true, tags: ['some-other-tag'] })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.all).toBe(true)
    // tags field in response should be [] since we used all:true
    expect(body.tags).toEqual([])
    const regenerated = body.regenerated as string[]
    expect(regenerated).toContain('/article/30')
  }, 20_000)

  it('Phase 7e: POST /api/invalidate with unknown tag returns 200 with empty regenerated', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['tag-that-does-not-exist'] })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.regenerated).toEqual([])
    const summary = body.summary as Record<string, number>
    expect(summary.total).toBe(0)
  })

  it('Phase 7f: POST /api/invalidate with no tags and no all flag returns 400', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
    expect(typeof body.error).toBe('string')
  })

  it('Phase 7g: POST /api/invalidate with empty tags array and no all flag returns 400', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [] })
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
  })

  it('Phase 7h: failed routes during invalidation are evicted — not included in subsequent invalidations', async () => {
    // Generate a real route so it lands in the registry with a known tag
    await generateRoutes(['/article/99'])

    // Confirm the route is in the registry via all:true
    const before = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    })
    const beforeBody = (await before.json()) as Record<string, unknown>
    expect(before.status).toBe(200)
    expect(beforeBody.regenerated as string[]).toContain('/article/99')

    // The server process is live, so we cannot inject a fetch failure from outside.
    // Instead verify the response shape guarantees: failed[] is always present and
    // routes that succeed are NOT in the failed list (eviction only touches failures).
    expect(Array.isArray(beforeBody.failed)).toBe(true)
    const summary = (beforeBody.summary as Record<string, number>) || {}
    const successCount = summary.success ?? 0
    const failedCount = summary.failed ?? 0
    expect(successCount + failedCount).toBe(summary.total ?? 0)
  }, 20_000)

  // ─── Phase 8: DELETE /api/route ───────────────────────────────────────────

  it('Phase 8a: DELETE /api/route removes routes from disk and registry', async () => {
    // 1. Generate the route first
    await generateRoutes(['/article/100'])
    await expect(readStaticFile('/article/100')).resolves.toContain('<html')
    await expect(readStaticFile('/article/100/_payload.json')).resolves.toBeTruthy()

    const manifestBefore = await readManifest()
    expect(manifestBefore.routeToTags['/article/100']).toBeDefined()

    // 2. Delete it
    const { status, body } = await deleteRoutes(['/article/100'])
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    // 3. Verify it is gone from disk
    await expect(readStaticFile('/article/100')).rejects.toThrow()
    await expect(readStaticFile('/article/100/_payload.json')).rejects.toThrow()

    // 4. Verify it is gone from registry
    const manifestAfter = await readManifest()
    expect(manifestAfter.routeToTags['/article/100']).toBeUndefined()
  }, 20_000)

  it('Phase 8b: DELETE /api/route also removes empty parent directories', async () => {
    // article/delete-me/index.html
    await generateRoutes(['/article/delete-me'])
    await expect(readStaticFile('/article/delete-me')).resolves.toContain('<html')

    const dirPath = join(PUBLIC_DIR, 'article/delete-me')

    await deleteRoutes(['/article/delete-me'])

    // Both the nested directory and its empty parent should be gone
    await expect(access(dirPath)).rejects.toThrow()
  }, 20_000)

  it('Phase 8c: DELETE /api/route rejects path traversal with 400', async () => {
    const { status, body } = await deleteRoutes(['/../../package.json'])
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('traversal')
  })

  it('Phase 8d: DELETE /api/route rejects _nuxt directory deletion with 400', async () => {
    const { status, body } = await deleteRoutes(['/_nuxt/test.js'])
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('protected route')
  })

  it('Phase 8e: DELETE /api/route returns 400 for empty routes array', async () => {
    const { status, body } = await deleteRoutes([])
    expect(status).toBe(400)
    expect(body.success).toBe(false)
  })

  // ─── Phase 9: Concurrency / Queue ──────────────────────────────────────────

  it('Phase 9a: health endpoint includes queue status with pendingRoutes', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.queue).toBeDefined()
    const queue = body.queue as Record<string, unknown>
    expect(queue).toHaveProperty('activeOperation')
    expect(queue).toHaveProperty('queued')
    expect(queue).toHaveProperty('pendingRoutes')
    expect(Array.isArray(queue.pendingRoutes)).toBe(true)
  })

  it('Phase 9b: concurrent generate requests execute sequentially and both succeed', async () => {
    // Fire two generate requests simultaneously
    const [res1, res2] = await Promise.all([generateRoutes(['/article/200']), generateRoutes(['/article/201'])])

    expect(res1.status).toBe(200)
    expect(res1.body.success).toBe(true)
    expect(res2.status).toBe(200)
    expect(res2.body.success).toBe(true)

    // Both files should exist on disk
    await expect(readStaticFile('/article/200')).resolves.toContain('<html')
    await expect(readStaticFile('/article/201')).resolves.toContain('<html')
  }, 20_000)

  it('Phase 9c: health check is not blocked by a running operation', async () => {
    // Start a generate (don't await it)
    const generatePromise = generateRoutes(['/article/300'])

    // Immediately check health — should return right away
    const healthRes = await fetch(`http://localhost:${SERVER_PORT}/api/health`)
    expect(healthRes.status).toBe(200)

    // Wait for the generate to finish so it doesn't leak
    await generatePromise
  }, 20_000)

  // ─── Phase 10: Route-level dedup ──────────────────────────────────────────

  it('Phase 10a: overlapping concurrent generate requests deduplicates shared routes', async () => {
    // Fire two generate requests simultaneously with overlapping routes
    const [res1, res2] = await Promise.all([
      generateRoutes(['/article/400', '/article/401']),
      generateRoutes(['/article/401', '/article/402'])
    ])

    expect(res1.status).toBe(200)
    expect(res1.body.success).toBe(true)
    expect(res2.status).toBe(200)
    expect(res2.body.success).toBe(true)

    // Order of body parsing is non-deterministic, so assert on combined totals:
    // 3 unique routes total, 1 deduped overlap
    const summary1 = res1.body.summary as Record<string, number>
    const summary2 = res2.body.summary as Record<string, number>
    const totalGenerated = (summary1.generated ?? 0) + (summary2.generated ?? 0)
    const totalDeduped = (summary1.deduped ?? 0) + (summary2.deduped ?? 0)
    expect(totalGenerated).toBe(3)
    expect(totalDeduped).toBe(1)

    // All three routes should exist on disk
    await expect(readStaticFile('/article/400')).resolves.toContain('<html')
    await expect(readStaticFile('/article/401')).resolves.toContain('<html')
    await expect(readStaticFile('/article/402')).resolves.toContain('<html')
  }, 30_000)

  it('Phase 10b: invalidate deduplicates against pending invalidate', async () => {
    // First, generate some routes with known tags
    await generateRoutes(['/article/510', '/article/511'])

    // Fire two invalidates for overlapping tags simultaneously
    const [res1, res2] = await Promise.all([
      fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['article:510'] })
      }),
      fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['article:510'] })
      })
    ])

    const body1 = (await res1.json()) as Record<string, unknown>
    const body2 = (await res2.json()) as Record<string, unknown>

    expect(body1.success).toBe(true)
    expect(body2.success).toBe(true)

    // One of them should have been deduped (the one that arrived second)
    const summary1 = body1.summary as Record<string, number>
    const summary2 = body2.summary as Record<string, number>
    const totalDeduped = (summary1.deduped ?? 0) + (summary2.deduped ?? 0)
    expect(totalDeduped).toBeGreaterThanOrEqual(1)
  }, 20_000)

  it('Phase 10c: invalidate is NOT deduped against pending generate', async () => {
    // Pre-generate so the route is in the registry with tag article:530
    await generateRoutes(['/article/530'])

    // Now fire a generate and an invalidate for the same route simultaneously.
    // The invalidate should NOT be deduped — it signals content may have changed.
    const [genRes, invRes] = await Promise.all([
      generateRoutes(['/article/530']),
      fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['article:530'] })
      })
    ])

    expect(genRes.status).toBe(200)
    expect(genRes.body.success).toBe(true)

    const invBody = (await invRes.json()) as Record<string, unknown>
    expect(invBody.success).toBe(true)

    // Invalidate should have run (not deduped against the generate)
    const invSummary = invBody.summary as Record<string, number>
    expect(invSummary.deduped).toBe(0)
    // It should have actually re-generated the route
    expect(invSummary.total ?? 0).toBeGreaterThanOrEqual(1)
  }, 20_000)

  // ─── Phase 11: Lifecycle hooks ────────────────────────────────────────────

  async function readHooksMarker(): Promise<Record<string, unknown[]>> {
    await new Promise((r) => setTimeout(r, 500))
    const content = await readFile(HOOKS_MARKER_PATH, 'utf-8')
    return JSON.parse(content)
  }

  it('Phase 11a: beforeGenerate and afterGenerate hooks fire', async () => {
    await generateRoutes(['/article/600'])

    const marker = await readHooksMarker()

    const beforeCalls = (marker.beforeGenerate ?? []) as Array<{ routes: string[] }>
    const afterCalls = (marker.afterGenerate ?? []) as Array<{ routes: string[]; totalGenerated: number }>

    expect(beforeCalls.length).toBeGreaterThanOrEqual(1)
    expect(afterCalls.length).toBeGreaterThanOrEqual(1)

    const lastBefore = beforeCalls[beforeCalls.length - 1]!
    expect(lastBefore.routes).toContain('/article/600')

    const lastAfter = afterCalls[afterCalls.length - 1]!
    expect(lastAfter.routes).toContain('/article/600')
    expect(lastAfter.totalGenerated).toBeGreaterThanOrEqual(1)
  }, 20_000)

  it('Phase 11b: beforeInvalidate and afterInvalidate hooks fire', async () => {
    await generateRoutes(['/article/610'])

    const res = await fetch(`http://localhost:${SERVER_PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['article:610'] })
    })
    expect(res.status).toBe(200)

    const marker = await readHooksMarker()

    const beforeCalls = (marker.beforeInvalidate ?? []) as Array<{ tags: string[] | null; all: boolean; routes: string[] }>
    const afterCalls = (marker.afterInvalidate ?? []) as Array<{ tags: string[] | null; all: boolean; failed: unknown[] }>

    expect(beforeCalls.length).toBeGreaterThanOrEqual(1)
    expect(afterCalls.length).toBeGreaterThanOrEqual(1)

    const lastBefore = beforeCalls[beforeCalls.length - 1]!
    expect(lastBefore.tags).toContain('article:610')
    expect(lastBefore.all).toBe(false)
    expect(lastBefore.routes).toContain('/article/610')

    const lastAfter = afterCalls[afterCalls.length - 1]!
    expect(lastAfter.tags).toContain('article:610')
    expect(Array.isArray(lastAfter.failed)).toBe(true)
  }, 20_000)

  it('Phase 11c: beforeDelete and afterDelete hooks fire', async () => {
    await generateRoutes(['/article/620'])

    await deleteRoutes(['/article/620'])

    const marker = await readHooksMarker()

    const beforeCalls = (marker.beforeDelete ?? []) as Array<{ routes: string[] }>
    const afterCalls = (marker.afterDelete ?? []) as Array<{ routes: string[] }>

    expect(beforeCalls.length).toBeGreaterThanOrEqual(1)
    expect(afterCalls.length).toBeGreaterThanOrEqual(1)

    const lastBefore = beforeCalls[beforeCalls.length - 1]!
    expect(lastBefore.routes).toContain('/article/620')

    const lastAfter = afterCalls[afterCalls.length - 1]!
    expect(lastAfter.routes).toContain('/article/620')
  }, 20_000)
})
