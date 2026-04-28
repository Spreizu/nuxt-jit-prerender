import { type ChildProcess } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  buildOnce,
  cleanOutput,
  deleteRoutes,
  generateRoutes,
  startServer,
  waitForServer,
  PUBLIC_DIR,
  HOOKS_MARKER_PATH,
  createSentinelFiles,
  cleanupSentinelFiles,
  SENTINEL_PATH,
  SENTINEL_TXT_PATH,
  SENTINEL_CONTENT
} from '../helpers'
import { readManifest, readStaticFile } from '../helpers'

const PORT = 4255

describe('DELETE /api/route', () => {
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

  it('removes routes from disk and registry', async () => {
    await generateRoutes(PORT, ['/article/100'])
    await expect(readStaticFile(PUBLIC_DIR, '/article/100')).resolves.toContain('<html')
    await expect(readStaticFile(PUBLIC_DIR, '/article/100/_payload.json')).resolves.toBeTruthy()

    const manifestBefore = await readManifest()
    expect(manifestBefore.routeToTags['/article/100']).toBeDefined()

    const { status, body } = await deleteRoutes(PORT, ['/article/100'])
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    await expect(readStaticFile(PUBLIC_DIR, '/article/100')).rejects.toThrow()
    await expect(readStaticFile(PUBLIC_DIR, '/article/100/_payload.json')).rejects.toThrow()

    const manifestAfter = await readManifest()
    expect(manifestAfter.routeToTags['/article/100']).toBeUndefined()
  }, 20_000)

  it('removes empty parent directories', async () => {
    await generateRoutes(PORT, ['/article/delete-me'])
    await expect(readStaticFile(PUBLIC_DIR, '/article/delete-me')).resolves.toContain('<html')

    const dirPath = join(PUBLIC_DIR, 'article/delete-me')

    await deleteRoutes(PORT, ['/article/delete-me'])

    await expect(access(dirPath)).rejects.toThrow()
  }, 20_000)

  it('rejects path traversal with 400', async () => {
    await createSentinelFiles()

    const { status, body } = await deleteRoutes(PORT, ['/../.traversal-sentinel.json'])
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('traversal')

    expect(await readFile(SENTINEL_PATH, 'utf-8')).toBe(SENTINEL_CONTENT)
    await cleanupSentinelFiles()
  })

  it('rejects path traversal via txt extension with 400', async () => {
    await createSentinelFiles()

    const { status, body } = await deleteRoutes(PORT, ['/../.traversal-sentinel.txt'])
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('traversal')

    expect(await readFile(SENTINEL_TXT_PATH, 'utf-8')).toBe(SENTINEL_CONTENT)
    await cleanupSentinelFiles()
  })

  it('rejects disguised path traversal with 400', async () => {
    await createSentinelFiles()

    const { status, body } = await deleteRoutes(PORT, ['/a/../../.traversal-sentinel.json'])
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('traversal')

    expect(await readFile(SENTINEL_PATH, 'utf-8')).toBe(SENTINEL_CONTENT)
    await cleanupSentinelFiles()
  })

  it('rejects _nuxt directory deletion with 400', async () => {
    const { status, body } = await deleteRoutes(PORT, ['/_nuxt/test.js'])
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('protected route')
  })

  it('returns 400 for empty routes array', async () => {
    const { status, body } = await deleteRoutes(PORT, [])
    expect(status).toBe(400)
    expect(body.success).toBe(false)
  })

  it('beforeDelete and afterDelete hooks fire', async () => {
    await generateRoutes(PORT, ['/article/620'])

    await deleteRoutes(PORT, ['/article/620'])

    await new Promise((r) => setTimeout(r, 500))
    const markerContent = await readFile(HOOKS_MARKER_PATH, 'utf-8')
    const marker = JSON.parse(markerContent) as Record<string, unknown[]>

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
