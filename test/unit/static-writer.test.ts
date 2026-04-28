import { rm, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let _mockRename: ((oldPath: string, newPath: string) => Promise<void>) | null = null

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({
    removeItem: vi.fn(() => Promise.resolve()),
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve())
  })
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    get rename() {
      return _mockRename ?? actual.rename
    }
  }
})

import {
  resolveFilePath,
  isPageRoute,
  writeStaticFile,
  renderAndSave,
  generateRoutes,
  clearDirCache
} from '../../src/runtime/nitro-preset/static-writer'

describe('static-writer', () => {
  const outputDir = join(__dirname, '.tmp-output')

  beforeEach(async () => {
    _mockRename = null
    clearDirCache()
    // Clear out temp directory
    try {
      await rm(outputDir, { recursive: true, force: true })
    } catch {}
  })

  afterEach(async () => {
    _mockRename = null
    try {
      await rm(outputDir, { recursive: true, force: true })
    } catch {}
    vi.restoreAllMocks()
  })

  describe('resolveFilePath', () => {
    it('resolveFilePath("/", ...) -> index.html', () => {
      const result = resolveFilePath(outputDir, '/')
      expect(result.filePath).toBe(join(outputDir, 'index.html'))
      expect(result.dirPath).toBe(join(outputDir, ''))
    })

    it('resolveFilePath("/about", ...) -> about/index.html', () => {
      const result = resolveFilePath(outputDir, '/about')
      expect(result.filePath).toBe(join(outputDir, 'about/index.html'))
      expect(result.dirPath).toBe(join(outputDir, 'about'))
    })

    it('resolveFilePath("/a/b/c", ...) -> a/b/c/index.html', () => {
      const result = resolveFilePath(outputDir, '/a/b/c')
      expect(result.filePath).toBe(join(outputDir, 'a/b/c/index.html'))
      expect(result.dirPath).toBe(join(outputDir, 'a/b/c'))
    })

    it('resolveFilePath("/_payload.json", ...) -> _payload.json', () => {
      const result = resolveFilePath(outputDir, '/_payload.json')
      expect(result.filePath).toBe(join(outputDir, '_payload.json'))
      expect(result.dirPath).toBe(join(outputDir, ''))
    })

    it('resolveFilePath("/img/logo.svg", ...) -> img/logo.svg', () => {
      const result = resolveFilePath(outputDir, '/img/logo.svg')
      expect(result.filePath).toBe(join(outputDir, 'img/logo.svg'))
      expect(result.dirPath).toBe(join(outputDir, 'img'))
    })

    describe('path traversal vectors', () => {
      // outputDir = __dirname/.tmp-output, so ../traversal-sentinel.json resolves
      // to __dirname/traversal-sentinel.json (the sentinel location)
      const sentinelPath = join(__dirname, 'traversal-sentinel.json')
      const sentinelContent = 'sentinel-unit-test'

      beforeEach(async () => {
        await writeFile(sentinelPath, sentinelContent)
      })

      afterEach(async () => {
        await rm(sentinelPath, { force: true })
      })

      it('resolves ../ outside outputDir', () => {
        const result = resolveFilePath(outputDir, '/../traversal-sentinel.json')
        expect(resolve(result.filePath).startsWith(resolve(outputDir))).toBe(false)
      })

      it('resolves disguised ../ outside outputDir', () => {
        const result = resolveFilePath(outputDir, '/a/../../traversal-sentinel.json')
        expect(resolve(result.filePath).startsWith(resolve(outputDir))).toBe(false)
      })

      it('legitimate path stays inside outputDir', () => {
        const result = resolveFilePath(outputDir, '/about')
        expect(resolve(result.filePath).startsWith(resolve(outputDir))).toBe(true)
      })

      it('writeStaticFile with traversal path writes outside outputDir', async () => {
        const writtenPath = await writeStaticFile(outputDir, '/../traversal-sentinel.json', 'overwritten')
        expect(resolve(writtenPath).startsWith(resolve(outputDir))).toBe(false)
        expect(await readFile(sentinelPath, 'utf-8')).toBe('overwritten')
      })
    })
  })

  describe('isPageRoute', () => {
    it('returns true for /about', () => {
      expect(isPageRoute('/about')).toBe(true)
    })
    it('returns false for /_payload.json', () => {
      expect(isPageRoute('/_payload.json')).toBe(false)
    })
  })

  describe('writeStaticFile', () => {
    it('creates nested dirs and writes content', async () => {
      const fp = await writeStaticFile(outputDir, '/test/nested', '<h1>hello</h1>')
      expect(fp).toBe(join(outputDir, 'test/nested/index.html'))

      const content = await readFile(fp, 'utf-8')
      expect(content).toBe('<h1>hello</h1>')
    })

    it('never exposes partial content to concurrent readers', async () => {
      const filePath = join(outputDir, 'about', 'index.html')

      // Pre-populate with old content
      await writeStaticFile(outputDir, '/about', 'old-content')

      let resolveDelay: () => void
      const delayPromise = new Promise<void>((resolve) => {
        resolveDelay = resolve
      })

      _mockRename = async (oldPath: string, newPath: string) => {
        await delayPromise
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        return actual.rename(oldPath, newPath)
      }

      // Start writing new content in the background
      const writePromise = writeStaticFile(outputDir, '/about', 'new-content')

      // During the write (rename delayed), the file must still show old content
      const contentDuringWrite = await readFile(filePath, 'utf-8')
      expect(contentDuringWrite).toBe('old-content')

      // Complete the write
      resolveDelay!()
      await writePromise

      // After completion, the file must show new content
      const contentAfterWrite = await readFile(filePath, 'utf-8')
      expect(contentAfterWrite).toBe('new-content')
    })
  })

  describe('renderAndSave', () => {
    it('writes HTML + payload for page routes', async () => {
      const localFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === '/about') {
          return new Response('html content', { status: 200, headers: new Headers() })
        }
        if (url === '/about/_payload.json') {
          return new Response('{"data":"payload"}', { status: 200, headers: new Headers() })
        }
        return new Response('Not Found', { status: 404, headers: new Headers() })
      })

      const res = await renderAndSave(localFetch, outputDir, '/about')

      expect(res.success).toBe(true)
      expect(res.route).toBe('/about')
      expect(localFetch).toHaveBeenCalledTimes(2)

      const htmlContent = await readFile(join(outputDir, 'about/index.html'), 'utf-8')
      expect(htmlContent).toBe('html content')

      const payloadContent = await readFile(join(outputDir, 'about/_payload.json'), 'utf-8')
      expect(payloadContent).toBe('{"data":"payload"}')
    })

    it('skips payload for asset routes', async () => {
      const localFetch = vi.fn().mockImplementation(async (_url: string) => {
        return new Response('asset content', { status: 200, headers: new Headers() })
      })

      const res = await renderAndSave(localFetch, outputDir, '/img/logo.svg')

      expect(res.success).toBe(true)
      expect(localFetch).toHaveBeenCalledTimes(1)
      expect(localFetch).toHaveBeenCalledWith('/img/logo.svg', expect.anything())

      const assetContent = await readFile(join(outputDir, 'img/logo.svg'), 'utf-8')
      expect(assetContent).toBe('asset content')

      // Check payload was not fetched
      await expect(stat(join(outputDir, 'img/logo.svg/_payload.json'))).rejects.toThrow()
    })

    it('collects x-nitro-prerender discovered routes', async () => {
      const localFetch = vi.fn().mockImplementation(async (_url: string) => {
        const headers = new Headers()
        headers.set('x-nitro-prerender', '/about,/contact')
        return new Response('html', { status: 200, headers })
      })

      const res = await renderAndSave(localFetch, outputDir, '/')

      expect(res.success).toBe(true)
      expect(res.discoveredRoutes).toEqual(['/about', '/contact'])
    })

    it('collects x-jit-prerender-cache-tags', async () => {
      const localFetch = vi.fn().mockImplementation(async (_url: string) => {
        const headers = new Headers()
        headers.set('x-jit-prerender-cache-tags', 'tag1, tag2')
        return new Response('html', { status: 200, headers })
      })

      const res = await renderAndSave(localFetch, outputDir, '/')

      expect(res.success).toBe(true)
      expect(res.cacheTags).toEqual(['tag1', 'tag2'])
    })

    it('returns { success: false } when fetch throws', async () => {
      const localFetch = vi.fn().mockImplementation(async () => {
        throw new Error('fetch failed')
      })

      const res = await renderAndSave(localFetch, outputDir, '/')

      expect(res.success).toBe(false)
      expect(res.error).toBe('fetch failed')
    })

    it('returns { success: false } for 404 response', async () => {
      const localFetch = vi.fn().mockImplementation(async () => {
        return new Response('not found', { status: 404, statusText: 'Not Found' })
      })

      const res = await renderAndSave(localFetch, outputDir, '/not-found')

      expect(res.success).toBe(false)
      expect(res.error).toContain('404')

      // Check file was not written
      await expect(stat(join(outputDir, 'not-found/index.html'))).rejects.toThrow()
    })

    it('handles payload fetch failure gracefully', async () => {
      const localFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === '/about') {
          return new Response('html content', { status: 200, headers: new Headers() })
        }
        if (url === '/about/_payload.json') {
          throw new Error('payload fetch failed')
        }
        return new Response('Not Found', { status: 404, headers: new Headers() })
      })

      const res = await renderAndSave(localFetch, outputDir, '/about')

      expect(res.success).toBe(true) // Should still succeed for the HTML part

      const htmlContent = await readFile(join(outputDir, 'about/index.html'), 'utf-8')
      expect(htmlContent).toBe('html content')

      await expect(stat(join(outputDir, 'about/_payload.json'))).rejects.toThrow()
    })
  })

  describe('generateRoutes', () => {
    it('deduplicates input routes', async () => {
      const localFetch = vi.fn().mockImplementation(async (_url: string) => {
        return new Response('html', { status: 200, headers: new Headers() })
      })

      const res = await generateRoutes(localFetch, ['/a', '/a', '/b'], outputDir, 2)

      expect(res.results.length).toBe(2)
      expect(res.totalGenerated).toBe(2)
      expect(localFetch).toHaveBeenCalledTimes(4) // 2 routes * 2 (HTML + payload)
    })

    it('recursively processes discovered routes', async () => {
      const localFetch = vi.fn().mockImplementation(async (url) => {
        const headers = new Headers()
        if (url === '/start') {
          headers.set('x-nitro-prerender', '/discovered1')
        }
        return new Response('html', { status: 200, headers })
      })

      const res = await generateRoutes(localFetch, ['/start'], outputDir, 1)

      expect(res.results.length).toBe(2) // /start and /discovered1
      expect(res.results.map((r) => r.route).sort()).toEqual(['/discovered1', '/start'])
      expect(res.totalDiscovered).toBe(1)
    })

    it('respects concurrency limit', async () => {
      let activeFetches = 0
      let maxActiveFetches = 0

      const localFetch = vi.fn().mockImplementation(async () => {
        activeFetches++
        maxActiveFetches = Math.max(maxActiveFetches, activeFetches)
        await new Promise((resolve) => setTimeout(resolve, 10))
        activeFetches--
        return new Response('html', { status: 200, headers: new Headers() })
      })

      await generateRoutes(localFetch, ['/a', '/b', '/c', '/d', '/e'], outputDir, 2)

      // We expect at most 2 concurrent runs * 2 (because of payload fetches) = 4,
      // but payload fetch happens sequentially after HTML fetch in `renderAndSave`,
      // so actually 2 concurrent `renderAndSave` runs -> max 2 active localFetches at a time.
      expect(maxActiveFetches).toBeLessThanOrEqual(2)
    })

    it('partial failure: failed routes have success:false and error, successful routes still generate', async () => {
      const localFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === '/broken') throw new Error('fetch exploded')
        return new Response('html', { status: 200, headers: new Headers() })
      })

      const res = await generateRoutes(localFetch, ['/ok', '/broken'], outputDir, 2)

      expect(res.results).toHaveLength(2)

      const okResult = res.results.find((r) => r.route === '/ok')
      expect(okResult?.success).toBe(true)

      const brokenResult = res.results.find((r) => r.route === '/broken')
      expect(brokenResult?.success).toBe(false)
      expect(brokenResult?.error).toBe('fetch exploded')

      // Only the successful route is counted
      expect(res.totalGenerated).toBe(1)
    })
  })
})
