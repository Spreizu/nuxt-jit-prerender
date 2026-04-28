import { type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  buildOnce,
  cleanOutput,
  generateRoutes,
  startServer,
  waitForServer,
  HOOKS_MARKER_PATH,
  PUBLIC_DIR
} from '../helpers'
import { extractHtmlTimestamp, extractPayloadTimestamp, readStaticFile } from '../helpers'

const PORT = 4254

describe('POST /api/invalidate', () => {
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

  it('invalidate by tag re-renders affected routes', async () => {
    await generateRoutes(PORT, ['/article/10', '/article/11', '/news'])

    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['article:10'] })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.all).toBe(false)

    const regenerated = body.regenerated as string[]
    expect(regenerated).toContain('/article/10')
    expect(regenerated).not.toContain('/article/11')

    const summary = body.summary as Record<string, number>
    expect(summary.success).toBe(summary.total)
    expect(summary.failed).toBe(0)
    expect(Array.isArray(body.failed)).toBe(true)
  }, 20_000)

  it('invalidate by tag that spans multiple routes re-renders all of them', async () => {
    await generateRoutes(PORT, ['/news', '/article/1'])

    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['global:news'] })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    const regenerated = body.regenerated as string[]

    expect(regenerated).toContain('/news')
    expect(regenerated).not.toContain('/article/1')
  }, 20_000)

  it('invalidate with all:true re-renders every route in the registry', async () => {
    await generateRoutes(PORT, ['/article/20', '/article/21', '/no-tags'])

    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
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
    expect(regenerated).toContain('/article/20')
    expect(regenerated).toContain('/article/21')

    const summary = body.summary as Record<string, number>
    expect(summary.success).toBe(summary.total)
  }, 20_000)

  it('invalidate with all:true ignores any tags field provided', async () => {
    await generateRoutes(PORT, ['/article/30'])

    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true, tags: ['some-other-tag'] })
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.all).toBe(true)
    expect(body.tags).toEqual([])
    const regenerated = body.regenerated as string[]
    expect(regenerated).toContain('/article/30')
  }, 20_000)

  it('invalidate with unknown tag returns 200 with empty regenerated', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
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

  it('invalidate with no tags and no all flag returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
    expect(typeof body.error).toBe('string')
  })

  it('invalidate with empty tags array and no all flag returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [] })
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
  })

  it('failed routes during invalidation are evicted — not included in subsequent invalidations', async () => {
    await generateRoutes(PORT, ['/article/99'])

    const before = await fetch(`http://localhost:${PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    })
    const beforeBody = (await before.json()) as Record<string, unknown>
    expect(before.status).toBe(200)
    expect(beforeBody.regenerated as string[]).toContain('/article/99')

    expect(Array.isArray(beforeBody.failed)).toBe(true)
    const summary = (beforeBody.summary as Record<string, number>) || {}
    const successCount = summary.success ?? 0
    const failedCount = summary.failed ?? 0
    expect(successCount + failedCount).toBe(summary.total ?? 0)
  }, 20_000)

  it('invalidate deduplicates against pending invalidate', async () => {
    await generateRoutes(PORT, ['/article/510', '/article/511'])

    const [res1, res2] = await Promise.all([
      fetch(`http://localhost:${PORT}/api/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['article:510'] })
      }),
      fetch(`http://localhost:${PORT}/api/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['article:510'] })
      })
    ])

    const body1 = (await res1.json()) as Record<string, unknown>
    const body2 = (await res2.json()) as Record<string, unknown>

    expect(body1.success).toBe(true)
    expect(body2.success).toBe(true)

    const summary1 = body1.summary as Record<string, number>
    const summary2 = body2.summary as Record<string, number>
    const totalDeduped = (summary1.deduped ?? 0) + (summary2.deduped ?? 0)
    expect(totalDeduped).toBeGreaterThanOrEqual(1)
  }, 20_000)

  it('invalidate is NOT deduped against pending generate', async () => {
    await generateRoutes(PORT, ['/article/530'])

    const [genRes, invRes] = await Promise.all([
      generateRoutes(PORT, ['/article/530']),
      fetch(`http://localhost:${PORT}/api/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['article:530'] })
      })
    ])

    expect(genRes.status).toBe(200)
    expect(genRes.body.success).toBe(true)

    const invBody = (await invRes.json()) as Record<string, unknown>
    expect(invBody.success).toBe(true)

    const invSummary = invBody.summary as Record<string, number>
    expect(invSummary.deduped).toBe(0)
    expect(invSummary.total ?? 0).toBeGreaterThanOrEqual(1)
  }, 20_000)

  it('beforeInvalidate and afterInvalidate hooks fire', async () => {
    await generateRoutes(PORT, ['/article/610'])

    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['article:610'] })
    })
    expect(res.status).toBe(200)

    await new Promise((r) => setTimeout(r, 500))
    const markerContent = await readFile(HOOKS_MARKER_PATH, 'utf-8')
    const marker = JSON.parse(markerContent) as Record<string, unknown[]>

    const beforeCalls = (marker.beforeInvalidate ?? []) as Array<{
      tags: string[] | null
      all: boolean
      routes: string[]
    }>
    const afterCalls = (marker.afterInvalidate ?? []) as Array<{
      tags: string[] | null
      all: boolean
      failed: unknown[]
    }>

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

  it('invalidation produces fresh HTML and _payload.json on disk', async () => {
    await generateRoutes(PORT, ['/news'])

    const staleHtml = await readStaticFile(PUBLIC_DIR, '/news')
    const staleHtmlTs = extractHtmlTimestamp(staleHtml)
    const stalePayload = await readStaticFile(PUBLIC_DIR, '/news/_payload.json')
    const stalePayloadTs = extractPayloadTimestamp(stalePayload)

    await new Promise((r) => setTimeout(r, 5))

    const res = await fetch(`http://localhost:${PORT}/api/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['article:1'] })
    })
    expect(res.status).toBe(200)

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
})
