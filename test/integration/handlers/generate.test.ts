import { type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'

import {
  buildOnce,
  cleanOutput,
  generateRoutes,
  startServer,
  waitForServer,
  PUBLIC_DIR,
  HOOKS_MARKER_PATH,
  OUTPUT_DIR,
  createSentinelFiles,
  cleanupSentinelFiles,
  SENTINEL_PATH,
  SENTINEL_TXT_PATH,
  SENTINEL_CONTENT
} from '../helpers'
import { extractHtmlTimestamp, extractPayloadTimestamp, readManifest, readStaticFile } from '../helpers'

const PORT = 4253

describe('POST /api/generate', () => {
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

  it('returns 200 and generates HTML files', async () => {
    const { status, body } = await generateRoutes(PORT, [
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

    await expect(readStaticFile(PUBLIC_DIR, '/')).resolves.toContain('<html')
    await expect(readStaticFile(PUBLIC_DIR, '/news')).resolves.toContain('<html')
    await expect(readStaticFile(PUBLIC_DIR, '/article/1')).resolves.toContain('<html')
    await expect(readStaticFile(PUBLIC_DIR, '/category/tech')).resolves.toContain('<html')
    await expect(readStaticFile(PUBLIC_DIR, '/category/tech/article/5')).resolves.toContain('<html')
  }, 30_000)

  it('_payload.json files are auto-generated alongside HTML', async () => {
    await expect(readStaticFile(PUBLIC_DIR, '/_payload.json')).resolves.toBeTruthy()
    await expect(readStaticFile(PUBLIC_DIR, '/news/_payload.json')).resolves.toBeTruthy()
    await expect(readStaticFile(PUBLIC_DIR, '/article/1/_payload.json')).resolves.toBeTruthy()
  })

  it('/news results contain tags from both useCacheTags and useNewsApi (composable chain)', async () => {
    const { body } = await generateRoutes(PORT, ['/news'])
    const results = body.results as Array<{ route: string; success: boolean; cacheTags?: string[] }>
    const newsResult = results.find((r) => r.route === '/news')

    expect(newsResult?.success).toBe(true)
    expect(newsResult?.cacheTags).toContain('page:news')
    expect(newsResult?.cacheTags).toContain('article:1')
    expect(newsResult?.cacheTags).toContain('article:2')
    expect(newsResult?.cacheTags).toContain('article:3')
    expect(newsResult?.cacheTags).toContain('global:news')
  }, 20_000)

  it('/no-tags page has empty cacheTags', async () => {
    const { body } = await generateRoutes(PORT, ['/no-tags'])
    const results = body.results as Array<{ route: string; success: boolean; cacheTags?: string[] }>
    const noTagResult = results.find((r) => r.route === '/no-tags')

    expect(noTagResult?.success).toBe(true)
    expect(noTagResult?.cacheTags ?? []).toHaveLength(0)
  }, 20_000)

  it('dynamic route tags use interpolated params', async () => {
    const { body } = await generateRoutes(PORT, ['/article/42'])
    const results = body.results as Array<{ route: string; success: boolean; cacheTags?: string[] }>
    const articleResult = results.find((r) => r.route === '/article/42')

    expect(articleResult?.success).toBe(true)
    expect(articleResult?.cacheTags).toContain('article:42')
    expect(articleResult?.cacheTags).toContain('page:article')
  }, 20_000)

  it('doubly-nested dynamic route has tags from both params', async () => {
    const { body } = await generateRoutes(PORT, ['/category/tech/article/99'])
    const results = body.results as Array<{ route: string; success: boolean; cacheTags?: string[] }>
    const nestedResult = results.find((r) => r.route === '/category/tech/article/99')

    expect(nestedResult?.success).toBe(true)
    expect(nestedResult?.cacheTags).toContain('category:tech')
    expect(nestedResult?.cacheTags).toContain('article:99')
  }, 20_000)

  it('.cache-manifest.json has correct bidirectional tagToRoutes mappings', async () => {
    await generateRoutes(PORT, ['/', '/news', '/article/1', '/article/4', '/category/tech', '/category/tech/article/5'])

    const manifest = await readManifest()

    expect(manifest.tagToRoutes['article:1']).toEqual(expect.arrayContaining(['/news', '/article/1']))
    expect(manifest.tagToRoutes['article:4']).toEqual(['/article/4'])
    expect(manifest.tagToRoutes['category:tech']).toEqual(
      expect.arrayContaining(['/category/tech', '/category/tech/article/5'])
    )
    expect(manifest.tagToRoutes['global:news']).toEqual(expect.arrayContaining(['/news']))
  }, 30_000)

  it('routeToTags is the correct inverse of tagToRoutes', async () => {
    const manifest = await readManifest()

    expect(manifest.routeToTags['/news']).toEqual(
      expect.arrayContaining(['page:news', 'article:1', 'article:2', 'article:3', 'global:news'])
    )

    expect(manifest.routeToTags['/article/4']).toEqual(expect.arrayContaining(['page:article', 'article:4']))
  })

  it('empty routes array returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routes: [] })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
  })

  it('non-array routes returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routes: '/about' })
    })
    expect(res.status).toBe(400)
  })

  it('invalid JSON returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json'
    })
    expect(res.status).toBe(400)
  })

  it('unknown routes return 404', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/unknown-endpoint`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
  })

  it('non-existent route returns success: false', async () => {
    const { status, body } = await generateRoutes(PORT, ['/this-page-does-not-exist'])
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    const results = body.results as any[]
    expect(results).toHaveLength(1)
    expect(results[0].route).toBe('/this-page-does-not-exist')
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('404')
  })

  it('concurrent generate requests execute sequentially and both succeed', async () => {
    const [res1, res2] = await Promise.all([
      generateRoutes(PORT, ['/article/200']),
      generateRoutes(PORT, ['/article/201'])
    ])

    expect(res1.status).toBe(200)
    expect(res1.body.success).toBe(true)
    expect(res2.status).toBe(200)
    expect(res2.body.success).toBe(true)

    await expect(readStaticFile(PUBLIC_DIR, '/article/200')).resolves.toContain('<html')
    await expect(readStaticFile(PUBLIC_DIR, '/article/201')).resolves.toContain('<html')
  }, 20_000)

  it('overlapping concurrent generate requests deduplicates shared routes', async () => {
    const [res1, res2] = await Promise.all([
      generateRoutes(PORT, ['/article/400', '/article/401']),
      generateRoutes(PORT, ['/article/401', '/article/402'])
    ])

    expect(res1.status).toBe(200)
    expect(res1.body.success).toBe(true)
    expect(res2.status).toBe(200)
    expect(res2.body.success).toBe(true)

    const summary1 = res1.body.summary as Record<string, number>
    const summary2 = res2.body.summary as Record<string, number>
    const totalGenerated = (summary1.generated ?? 0) + (summary2.generated ?? 0)
    const totalDeduped = (summary1.deduped ?? 0) + (summary2.deduped ?? 0)
    expect(totalGenerated).toBe(3)
    expect(totalDeduped).toBe(1)

    await expect(readStaticFile(PUBLIC_DIR, '/article/400')).resolves.toContain('<html')
    await expect(readStaticFile(PUBLIC_DIR, '/article/401')).resolves.toContain('<html')
    await expect(readStaticFile(PUBLIC_DIR, '/article/402')).resolves.toContain('<html')
  }, 30_000)

  it('beforeGenerate and afterGenerate hooks fire', async () => {
    await generateRoutes(PORT, ['/article/600'])

    await new Promise((r) => setTimeout(r, 500))
    const { readFile } = await import('node:fs/promises')
    const marker = JSON.parse(await readFile(HOOKS_MARKER_PATH, 'utf-8')) as Record<string, unknown[]>

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

  it('re-generating a route produces fresh HTML and _payload.json on disk', async () => {
    await generateRoutes(PORT, ['/news'])

    const staleHtml = await readStaticFile(PUBLIC_DIR, '/news')
    const staleHtmlTs = extractHtmlTimestamp(staleHtml)
    const stalePayload = await readStaticFile(PUBLIC_DIR, '/news/_payload.json')
    const stalePayloadTs = extractPayloadTimestamp(stalePayload)

    await new Promise((r) => setTimeout(r, 5))

    await generateRoutes(PORT, ['/news'])

    const freshHtml = await readStaticFile(PUBLIC_DIR, '/news')
    const freshHtmlTs = extractHtmlTimestamp(freshHtml)
    const freshPayload = await readStaticFile(PUBLIC_DIR, '/news/_payload.json')
    const freshPayloadTs = extractPayloadTimestamp(freshPayload)

    expect(staleHtmlTs).not.toBeNull()
    expect(freshHtmlTs).not.toBeNull()
    expect(freshHtmlTs!).toBeGreaterThan(staleHtmlTs!)

    expect(stalePayloadTs).not.toBeNull()
    expect(freshPayloadTs).not.toBeNull()
    expect(freshPayloadTs!).toBeGreaterThan(stalePayloadTs!)
  }, 20_000)

  describe('path traversal safety', () => {
    afterEach(async () => {
      await cleanupSentinelFiles()
    })

    it('traversal one level up does not overwrite sentinel', async () => {
      await createSentinelFiles()

      const { status, body } = await generateRoutes(PORT, ['/../.traversal-sentinel.json'])
      expect(status).toBe(200)

      const results = body.results as Array<{ route: string; success: boolean }>
      expect(results[0]?.success).toBe(false)

      expect(await readFile(SENTINEL_PATH, 'utf-8')).toBe(SENTINEL_CONTENT)
    })

    it('traversal targeting txt file does not overwrite sentinel', async () => {
      await createSentinelFiles()

      const { status, body } = await generateRoutes(PORT, ['/../.traversal-sentinel.txt'])
      expect(status).toBe(200)

      const results = body.results as Array<{ route: string; success: boolean }>
      expect(results[0]?.success).toBe(false)

      expect(await readFile(SENTINEL_TXT_PATH, 'utf-8')).toBe(SENTINEL_CONTENT)
    })

    it('disguised traversal does not overwrite sentinel', async () => {
      await createSentinelFiles()

      const { status, body } = await generateRoutes(PORT, ['/legit/../.traversal-sentinel.json'])
      expect(status).toBe(200)

      const results = body.results as Array<{ route: string; success: boolean }>
      expect(results[0]?.success).toBe(false)

      expect(await readFile(SENTINEL_PATH, 'utf-8')).toBe(SENTINEL_CONTENT)
    })

    it('traversal targeting server entry does not overwrite it', async () => {
      const serverEntry = join(OUTPUT_DIR, 'server/index.mjs')
      const original = await readFile(serverEntry, 'utf-8')

      const { status, body } = await generateRoutes(PORT, ['/../server/index.mjs'])
      expect(status).toBe(200)

      const results = body.results as Array<{ route: string; success: boolean }>
      expect(results[0]?.success).toBe(false)

      expect(await readFile(serverEntry, 'utf-8')).toBe(original)
    })
  })
})
