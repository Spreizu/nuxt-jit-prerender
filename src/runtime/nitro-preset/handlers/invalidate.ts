import type { EventHandler } from 'h3'
import { eventHandler, readBody, createError } from 'h3'

import type { BeforeInvalidateContext, AfterInvalidateContext } from '../hooks'
import { logger } from '../logger'
import type { HandlerContext, InvalidateResponse } from './types'

/**
 * Creates an event handler that re-renders routes associated with given cache tags.
 *
 * Expects a JSON body with either `{ tags: string[] }` to revalidate routes matching
 * those tags, or `{ all: true }` to re-render every registered route. Routes are
 * resolved from the cache registry, deduplicated against in-flight operations, and
 * re-rendered sequentially via `generateAndRegister`.
 *
 * Routes that fail during regeneration are removed from the registry.
 * `jit-prerender:beforeInvalidate` and `jit-prerender:afterInvalidate` hooks are
 * invoked around the regeneration pass.
 */
export function createInvalidateHandler(ctx: HandlerContext): EventHandler {
  return eventHandler(async (event) => {
    const body = await readBody(event)
    const all: boolean = body?.all === true
    const tags: string[] = body?.tags

    if (!all && (!Array.isArray(tags) || tags.length === 0)) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'Request body must include a non-empty "tags" array, or set "all": true to revalidate everything.'
      })
    }

    const affectedRoutes = all ? ctx.registry.getAllRoutes() : ctx.registry.getRoutesForTags(tags)

    if (affectedRoutes.length === 0) {
      return {
        success: true,
        all,
        message: all ? 'Registry is empty — nothing to revalidate.' : 'No routes found for the given tags.',
        tags: all ? [] : tags,
        regenerated: [],
        failed: [],
        summary: { total: 0, success: 0, failed: 0, deduped: 0 }
      } satisfies InvalidateResponse
    }

    const freshRoutes = ctx.queue.dedup(affectedRoutes, 'invalidate')

    if (freshRoutes.length === 0) {
      return {
        success: true,
        all,
        tags: all ? [] : tags,
        regenerated: [],
        failed: [],
        summary: { total: 0, success: 0, failed: 0, deduped: affectedRoutes.length }
      } satisfies InvalidateResponse
    }

    try {
      const invalidateCtx: BeforeInvalidateContext = {
        tags: all ? null : tags,
        all,
        routes: [...freshRoutes]
      }
      await ctx.callHook('jit-prerender:beforeInvalidate', invalidateCtx)
      const routesToInvalidate = invalidateCtx.routes

      const { regenerated, failed, result } = await ctx.queue.enqueue('invalidate', async () => {
        if (all) {
          logger.info('Invalidating routes - %d routes affected.', routesToInvalidate.length)
        } else {
          logger.info('Invalidating tags: [%s] - %d routes affected.', tags.join(', '), routesToInvalidate.length)
        }

        const result = await ctx.generateAndRegister(routesToInvalidate)

        const failedRoutes = result.results.filter((r) => !r.success)
        for (const failed of failedRoutes) {
          logger.warn(
            'Route %s failed to regenerate during invalidation (%s) — removing from registry.',
            failed.route,
            failed.error ?? 'unknown error'
          )
          ctx.registry.removeRoute(failed.route)
        }

        await ctx.callHook('jit-prerender:afterInvalidate', {
          tags: all ? null : tags,
          all,
          routes: routesToInvalidate,
          results: result.results,
          failed: failedRoutes.map((r) => ({ route: r.route, error: r.error }))
        } satisfies AfterInvalidateContext)

        return {
          affectedRoutes: routesToInvalidate,
          result,
          regenerated: routesToInvalidate,
          failed: failedRoutes.map((r) => ({ route: r.route, error: r.error }))
        }
      })

      return {
        success: true,
        all,
        tags: all ? [] : tags,
        regenerated,
        failed,
        summary: {
          total: result.results.length,
          success: result.totalGenerated,
          failed: failed.length,
          deduped: affectedRoutes.length - freshRoutes.length
        },
        results: result.results
      } satisfies InvalidateResponse
    } finally {
      ctx.queue.release(freshRoutes)
    }
  })
}
