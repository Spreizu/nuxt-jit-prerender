import { describe, it, expect } from 'vitest'

import { parseCommaSeparatedList } from '../../src/runtime/nitro-preset/utils'

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
})
