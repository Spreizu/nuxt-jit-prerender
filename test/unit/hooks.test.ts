import { createHooks } from 'hookable'
import { describe, it, expect, vi } from 'vitest'

import type {
  BeforeGenerateContext,
  AfterGenerateContext,
  BeforeInvalidateContext,
  AfterInvalidateContext,
  BeforeDeleteContext,
  AfterDeleteContext
} from '../../src/runtime/nitro-preset/hooks'

// Replicate safeCallHook logic for isolated testing
async function safeCallHook(
  hooks: ReturnType<typeof createHooks>,
  name: string,
  ctx: unknown,
  onError: (name: string, err: unknown) => void
) {
  try {
    await hooks.callHook(name, ctx)
  } catch (err) {
    onError(name, err)
  }
}

describe('Hooks context types', () => {
  it('BeforeGenerateContext routes are mutable', async () => {
    const hooks = createHooks()
    const ctx: BeforeGenerateContext = { routes: ['/a', '/b'] }

    hooks.hook('test:beforeGenerate', (c: BeforeGenerateContext) => {
      c.routes.push('/c')
    })

    await hooks.callHook('test:beforeGenerate', ctx)
    expect(ctx.routes).toEqual(['/a', '/b', '/c'])
  })

  it('BeforeGenerateContext routes can be filtered', async () => {
    const hooks = createHooks()
    const ctx: BeforeGenerateContext = { routes: ['/a', '/b', '/c'] }

    hooks.hook('test:beforeGenerate', (c: BeforeGenerateContext) => {
      c.routes = c.routes.filter((r) => r !== '/b')
    })

    await hooks.callHook('test:beforeGenerate', ctx)
    expect(ctx.routes).toEqual(['/a', '/c'])
  })

  it('AfterGenerateContext carries results', async () => {
    const hooks = createHooks()
    const ctx: AfterGenerateContext = {
      routes: ['/a'],
      results: [{ route: '/a', success: true, cacheTags: ['tag:a'], discoveredRoutes: [] }],
      totalGenerated: 1,
      totalDiscovered: 0
    }

    const handler = vi.fn()
    hooks.hook('test:afterGenerate', handler)

    await hooks.callHook('test:afterGenerate', ctx)
    expect(handler).toHaveBeenCalledWith(ctx)
  })

  it('BeforeInvalidateContext carries tags and all flag', async () => {
    const hooks = createHooks()
    const tagCtx: BeforeInvalidateContext = { tags: ['product:1'], all: false, routes: ['/p1'] }
    const allCtx: BeforeInvalidateContext = { tags: null, all: true, routes: ['/p1', '/p2'] }

    const handler = vi.fn()
    hooks.hook('test:beforeInvalidate', handler)

    await hooks.callHook('test:beforeInvalidate', tagCtx)
    await hooks.callHook('test:beforeInvalidate', allCtx)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ tags: ['product:1'], all: false }))
    expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ tags: null, all: true }))
  })

  it('BeforeInvalidateContext routes are mutable', async () => {
    const hooks = createHooks()
    const ctx: BeforeInvalidateContext = { tags: ['t1'], all: false, routes: ['/a', '/b'] }

    hooks.hook('test:beforeInvalidate', (c: BeforeInvalidateContext) => {
      c.routes.splice(0, 1)
    })

    await hooks.callHook('test:beforeInvalidate', ctx)
    expect(ctx.routes).toEqual(['/b'])
  })

  it('AfterInvalidateContext carries failed routes', async () => {
    const hooks = createHooks()
    const ctx: AfterInvalidateContext = {
      tags: ['t1'],
      all: false,
      routes: ['/a', '/b'],
      results: [
        { route: '/a', success: true, cacheTags: [], discoveredRoutes: [] },
        { route: '/b', success: false, error: 'timeout' }
      ],
      failed: [{ route: '/b', error: 'timeout' }]
    }

    const handler = vi.fn()
    hooks.hook('test:afterInvalidate', handler)

    await hooks.callHook('test:afterInvalidate', ctx)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        failed: [{ route: '/b', error: 'timeout' }]
      })
    )
  })

  it('BeforeDeleteContext routes are mutable', async () => {
    const hooks = createHooks()
    const ctx: BeforeDeleteContext = { routes: ['/a', '/protected'] }

    hooks.hook('test:beforeDelete', (c: BeforeDeleteContext) => {
      c.routes = c.routes.filter((r) => r !== '/protected')
    })

    await hooks.callHook('test:beforeDelete', ctx)
    expect(ctx.routes).toEqual(['/a'])
  })

  it('AfterDeleteContext carries deleted routes', async () => {
    const hooks = createHooks()
    const ctx: AfterDeleteContext = { routes: ['/a', '/b'] }

    const handler = vi.fn()
    hooks.hook('test:afterDelete', handler)

    await hooks.callHook('test:afterDelete', ctx)
    expect(handler).toHaveBeenCalledWith({ routes: ['/a', '/b'] })
  })
})

describe('Multiple hooks run in registration order', () => {
  it('beforeGenerate hooks chain mutations', async () => {
    const hooks = createHooks()
    const ctx: BeforeGenerateContext = { routes: ['/a'] }

    hooks.hook('test:beforeGenerate', (c: BeforeGenerateContext) => {
      c.routes.push('/b')
    })
    hooks.hook('test:beforeGenerate', (c: BeforeGenerateContext) => {
      c.routes = c.routes.filter((r) => r !== '/a')
    })

    await hooks.callHook('test:beforeGenerate', ctx)
    expect(ctx.routes).toEqual(['/b'])
  })
})

describe('safeCallHook error isolation', () => {
  it('catches hook errors and reports them without aborting', async () => {
    const hooks = createHooks()
    const errors: Array<{ name: string; err: unknown }> = []

    hooks.hook('test:hook', () => {
      throw new Error('hook exploded')
    })

    const ctx: BeforeGenerateContext = { routes: ['/a'] }

    // Should not throw
    await safeCallHook(hooks, 'test:hook', ctx, (name, err) => {
      errors.push({ name, err })
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]!.name).toBe('test:hook')
    expect((errors[0]!.err as Error).message).toBe('hook exploded')
  })

  it('stops at first failing hook (hookable serial behavior)', async () => {
    const hooks = createHooks()
    const log: string[] = []
    const errors: Array<{ name: string; err: unknown }> = []

    hooks.hook('test:hook', () => {
      log.push('first')
    })
    hooks.hook('test:hook', () => {
      throw new Error('boom')
    })
    hooks.hook('test:hook', () => {
      log.push('third')
    })

    await safeCallHook(hooks, 'test:hook', {}, (name, err) => {
      errors.push({ name, err })
    })

    // hookable calls hooks serially and stops on first error
    expect(log).toEqual(['first'])
    expect(log).not.toContain('third')
    expect(errors).toHaveLength(1)
  })

  it('safeCallHook with async hook error', async () => {
    const hooks = createHooks()
    const errors: Array<{ name: string; err: unknown }> = []

    hooks.hook('test:hook', async () => {
      await Promise.resolve()
      throw new Error('async boom')
    })

    await safeCallHook(hooks, 'test:hook', {}, (name, err) => {
      errors.push({ name, err })
    })

    expect(errors).toHaveLength(1)
    expect((errors[0]!.err as Error).message).toBe('async boom')
  })

  it('safeCallHook with no registered hooks does not error', async () => {
    const hooks = createHooks()
    const errors: Array<{ name: string; err: unknown }> = []

    await safeCallHook(hooks, 'test:unregistered', {}, (name, err) => {
      errors.push({ name, err })
    })

    expect(errors).toHaveLength(0)
  })
})
