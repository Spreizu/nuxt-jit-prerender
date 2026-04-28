import { rm, rmdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { EventHandler } from 'h3'
import { eventHandler, readBody, createError } from 'h3'

import type { BeforeDeleteContext, AfterDeleteContext } from '../hooks'
import { logger } from '../logger'
import { resolveFilePath, isPageRoute } from '../static-writer'
import type { HandlerContext, DeleteResponse } from './types'

/**
 * Creates an event handler that removes pre-rendered static files for the given routes.
 *
 * Expects a JSON body with `{ routes: string[] }`. For each route it deletes the
 * corresponding HTML file, its `/_payload.json` sibling (if the route is a page),
 * and any now-empty parent directory. The cache registry is updated and
 * `jit-prerender:beforeDelete` / `jit-prerender:afterDelete` hooks are invoked.
 *
 * Routes containing `/_nuxt` are rejected to prevent deletion of framework assets,
 * and all paths are resolved and checked against `publicDir` to block traversal attacks.
 */
export function createDeleteHandler(ctx: HandlerContext): EventHandler {
  return eventHandler(async (event) => {
    const body = await readBody(event)
    const routes: string[] = body?.routes

    if (!Array.isArray(routes) || routes.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Request body must include a non-empty "routes" array'
      })
    }

    const resolvedBase = resolve(ctx.publicDir)

    for (const route of routes) {
      if (route.startsWith('/_nuxt') || route.includes('_nuxt')) {
        throw createError({
          statusCode: 400,
          statusMessage: `Cannot delete protected route: ${route}`
        })
      }

      const { filePath } = resolveFilePath(ctx.publicDir, route)
      const resolvedPath = resolve(filePath)

      if (!resolvedPath.startsWith(resolvedBase)) {
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid route (traversal attempt): ${route}`
        })
      }
    }

    await ctx.queue.enqueue('delete', async () => {
      const deleteCtx: BeforeDeleteContext = { routes: [...routes] }
      await ctx.callHook('jit-prerender:beforeDelete', deleteCtx)
      const routesToDelete = deleteCtx.routes

      for (const route of routesToDelete) {
        const { filePath, dirPath } = resolveFilePath(ctx.publicDir, route)
        const resolvedPath = resolve(filePath)

        await rm(resolvedPath, { force: true })
        logger.info('Deleted file from disk: %s', resolvedPath)

        if (isPageRoute(route)) {
          const payloadPath = route === '/' ? '/_payload.json' : `${route}/_payload.json`
          const { filePath: payloadFilePath } = resolveFilePath(ctx.publicDir, payloadPath)
          const resolvedPayloadPath = resolve(payloadFilePath)

          if (resolvedPayloadPath.startsWith(resolvedBase)) {
            await rm(resolvedPayloadPath, { force: true })
            logger.info('Deleted payload from disk: %s', resolvedPayloadPath)
          }

          const resolvedDirPath = resolve(dirPath)
          if (resolvedDirPath !== resolvedBase && resolvedDirPath.startsWith(resolvedBase)) {
            try {
              await rmdir(resolvedDirPath)
              logger.info('Removed empty directory: %s', resolvedDirPath)
            } catch {
              // Directory not empty or doesn't exist
            }
          }
        }
      }

      ctx.registry.removeRoutes(routesToDelete)

      await ctx.callHook('jit-prerender:afterDelete', { routes: routesToDelete } satisfies AfterDeleteContext)
    })

    return { success: true, removed: routes } satisfies DeleteResponse
  })
}
