import type { EventHandler } from 'h3'
import { eventHandler, readBody, createError } from 'h3'

import type { BeforeGenerateContext, AfterGenerateContext } from '../hooks'
import type { HandlerContext, GenerateResponse } from './types'

/**
 * Creates an event handler that pre-renders routes to static HTML files.
 *
 * Expects a JSON body with `{ routes: string[] }`. For each route it renders
 * the page via Nitro's `localFetch`, writes the HTML and `/_payload.json` to
 * disk, and registers any cache tags in the registry.
 *
 * Requested routes are deduplicated against in-flight generate/invalidate
 * operations, and a `beforeGenerate` hook may filter or modify the final set.
 * `afterGenerate` fires once rendering completes.
 * Both concurrency and deduplication are handled by the shared operation queue.
 */
export function createGenerateHandler(ctx: HandlerContext): EventHandler {
  return eventHandler(async (event) => {
    const body = await readBody(event)
    const routes: string[] = body?.routes

    if (!Array.isArray(routes) || routes.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Request body must include a non-empty "routes" array.'
      })
    }

    const freshRoutes = ctx.queue.dedup(routes, 'generate')

    if (freshRoutes.length === 0) {
      return {
        success: true,
        summary: {
          requested: routes.length,
          generated: 0,
          discovered: 0,
          total: 0,
          deduped: routes.length
        },
        results: []
      } satisfies GenerateResponse
    }

    try {
      const generateCtx: BeforeGenerateContext = { routes: [...freshRoutes] }
      await ctx.callHook('jit-prerender:beforeGenerate', generateCtx)
      const routesToGenerate = generateCtx.routes

      if (routesToGenerate.length === 0) {
        return {
          success: true,
          summary: {
            requested: routes.length,
            generated: 0,
            discovered: 0,
            total: 0,
            deduped: routes.length - freshRoutes.length
          },
          results: []
        } satisfies GenerateResponse
      }

      const result = await ctx.queue.enqueue('generate', async () => {
        return ctx.generateAndRegister(routesToGenerate)
      })

      await ctx.callHook('jit-prerender:afterGenerate', {
        routes: routesToGenerate,
        results: result.results,
        totalGenerated: result.totalGenerated,
        totalDiscovered: result.totalDiscovered
      } satisfies AfterGenerateContext)

      return {
        success: true,
        summary: {
          requested: routes.length,
          generated: result.totalGenerated,
          discovered: result.totalDiscovered,
          total: result.results.length,
          deduped: routes.length - freshRoutes.length
        },
        results: result.results
      } satisfies GenerateResponse
    } finally {
      ctx.queue.release(freshRoutes)
    }
  })
}
