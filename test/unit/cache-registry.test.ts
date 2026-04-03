import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { CacheRegistry } from '../../src/nitro-preset/cache-registry'

describe('CacheRegistry', () => {
  const persistPath = join(process.env.NITRO_JIT_PRERENDER_OUTPUT_DIR || '.output', 'test-cache-manifest.json')
  let registry: CacheRegistry

  beforeEach(() => {
    registry = new CacheRegistry(persistPath)
  })

  afterEach(async () => {
    try {
      await rm(persistPath, { force: true })
    } catch {}
    vi.restoreAllMocks()
  })

  it('register() creates bidirectional mappings', () => {
    registry.register('/route1', ['tag1'])
    expect(registry.getTagsForRoute('/route1')).toEqual(['tag1'])
    expect(registry.getRoutesForTags(['tag1'])).toEqual(['/route1'])
  })

  it('register() with empty tags is a no-op', () => {
    registry.register('/route1', [])
    expect(registry.getTagsForRoute('/route1')).toEqual([])
    expect(registry.getRoutesForTags(['tag1'])).toEqual([])
  })

  it('register() replaces existing tags on re-register', () => {
    registry.register('/route1', ['tag1'])
    registry.register('/route1', ['tag2', 'tag3'])
    expect(registry.getTagsForRoute('/route1')).toEqual(['tag2', 'tag3'])
    expect(registry.getRoutesForTags(['tag1'])).toEqual([])
    expect(registry.getRoutesForTags(['tag2', 'tag3']).sort()).toEqual(['/route1'])
  })

  it('register() handles duplicate tags in input', () => {
    registry.register('/route1', ['tag1', 'tag1'])
    expect(registry.getTagsForRoute('/route1')).toEqual(['tag1'])
    expect(registry.getRoutesForTags(['tag1'])).toEqual(['/route1'])
  })

  it('getRoutesForTags() returns union across multiple tags', () => {
    registry.register('/route1', ['tag1'])
    registry.register('/route2', ['tag2'])
    registry.register('/route3', ['tag1', 'tag2'])
    expect(registry.getRoutesForTags(['tag1', 'tag2']).sort()).toEqual(['/route1', '/route2', '/route3'].sort())
  })

  it('getRoutesForTags() with unknown tags returns []', () => {
    expect(registry.getRoutesForTags(['unknown'])).toEqual([])
  })

  it('getTagsForRoute() with unknown route returns []', () => {
    expect(registry.getTagsForRoute('/unknown')).toEqual([])
  })

  it('removeRoute() cleans up orphaned tag entries', () => {
    registry.register('/route1', ['tag1'])
    registry.removeRoute('/route1')
    expect(registry.getRoutesForTags(['tag1'])).toEqual([])
    expect(registry.getTagsForRoute('/route1')).toEqual([])
    const json = registry.toJson()
    expect(json.tagToRoutes).toEqual({})
  })

  it('removeRoute() on non-existent route is a no-op', () => {
    expect(() => registry.removeRoute('/unknown')).not.toThrow()
  })

  it('removeRoutes() removes multiple routes', () => {
    registry.register('/route1', ['tag1'])
    registry.register('/route2', ['tag2'])
    registry.removeRoutes(['/route1', '/route2'])
    expect(registry.getTagsForRoute('/route1')).toEqual([])
    expect(registry.getTagsForRoute('/route2')).toEqual([])
  })

  it('toJson() produces correct stats', () => {
    registry.register('/route1', ['tag1'])
    const json = registry.toJson()
    expect(json.stats).toEqual({ totalRoutes: 1, totalTags: 1 })
    expect(json.tagToRoutes).toEqual({ tag1: ['/route1'] })
    expect(json.routeToTags).toEqual({ '/route1': ['tag1'] })
  })

  it('getAllRoutes() returns every tracked route', () => {
    registry.register('/route1', ['tag1'])
    registry.register('/route2', ['tag2'])
    registry.register('/route3', ['tag1', 'tag2'])
    expect(registry.getAllRoutes().sort()).toEqual(['/route1', '/route2', '/route3'])
  })

  it('getAllRoutes() returns [] when registry is empty', () => {
    expect(registry.getAllRoutes()).toEqual([])
  })

  it('getAllRoutes() excludes routes registered with empty tags', () => {
    registry.register('/route1', ['tag1'])
    registry.register('/no-tags', []) // empty tags → not stored
    expect(registry.getAllRoutes()).toEqual(['/route1'])
  })

  it('save() + load() round-trip preserves data', async () => {
    registry.register('/route1', ['tag1', 'tag2'])
    await registry.save()

    const registry2 = new CacheRegistry(persistPath)
    await registry2.load()

    expect(registry2.toJson()).toEqual(registry.toJson())
  })

  it('load() with missing file starts fresh', async () => {
    await registry.load()
    expect(registry.toJson().stats).toEqual({ totalRoutes: 0, totalTags: 0 })
  })

  // Testing scheduleSave debounce
  it('scheduleSave() debounces multiple rapid mutations', async () => {
    vi.useFakeTimers()
    const saveSpy = vi.spyOn(registry, 'save').mockImplementation(async () => {})

    registry.register('/route1', ['tag1'])
    registry.register('/route2', ['tag2'])
    registry.register('/route3', ['tag3'])

    expect(saveSpy).not.toHaveBeenCalled()

    // Fast-forward time
    vi.advanceTimersByTime(600)

    expect(saveSpy).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
