import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, unknown>()

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({
    removeItem: vi.fn((key: string) => {
      store.delete(key)
      return Promise.resolve()
    }),
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    })
  })
}))

import { parseCommaSeparatedList, clearPayloadCache } from '../../src/runtime/nitro-preset/utils'

describe('utils', () => {
  describe('parseCommaSeparatedList', () => {
    it('parses basic comma-separated values', () => {
      expect(parseCommaSeparatedList('a,b,c')).toEqual(['a', 'b', 'c'])
    })

    it('trims whitespace', () => {
      expect(parseCommaSeparatedList(' a , b ')).toEqual(['a', 'b'])
    })

    it('decodes URI components', () => {
      expect(parseCommaSeparatedList('hello%20world')).toEqual(['hello world'])
    })

    it('filters empty entries', () => {
      expect(parseCommaSeparatedList('a,,b,,')).toEqual(['a', 'b'])
    })

    it('returns [] for null', () => {
      expect(parseCommaSeparatedList(null)).toEqual([])
    })

    it('returns [] for undefined', () => {
      expect(parseCommaSeparatedList(undefined)).toEqual([])
    })

    it('returns [] for empty string ""', () => {
      expect(parseCommaSeparatedList('')).toEqual([])
    })

    it('handles single value (no commas)', () => {
      expect(parseCommaSeparatedList('solo')).toEqual(['solo'])
    })
  })

  describe('clearPayloadCache', () => {
    beforeEach(() => {
      store.clear()
    })

    it('removes a cached payload entry', async () => {
      store.set('/news', { body: 'stale' })
      await clearPayloadCache('/news')
      expect(store.has('/news')).toBe(false)
    })

    it('does not throw when the key does not exist', async () => {
      await expect(clearPayloadCache('/nonexistent')).resolves.toBeUndefined()
    })
  })
})
