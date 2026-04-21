import '#nitro-internal-pollyfills'
import { randomUUID } from 'node:crypto'
import { rm, rmdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'

import { useNitroApp } from 'nitropack/runtime'

import { CacheRegistry } from './cache-registry'
import type {
  AfterDeleteContext,
  AfterGenerateContext,
  AfterInvalidateContext,
  BeforeDeleteContext,
  BeforeGenerateContext,
  BeforeInvalidateContext
} from './hooks'
import { logger, requestContext } from './logger'
import { OperationQueue } from './operation-queue'
import { generateRoutes, resolveFilePath, isPageRoute } from './static-writer'

const nitroApp = useNitroApp()

async function safeCallHook(name: string, ctx: unknown) {
  try {
    await nitroApp.hooks.callHook(name as any, ctx as any)
  } catch (err) {
    logger.error('Error in hook %s: %s', name, err instanceof Error ? err.message : String(err))
  }
}

const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'
const CONCURRENCY = Number(process.env.NUXT_JIT_PRERENDER_CONCURRENCY || 10)
const PUBLIC_OUTPUT_DIR = join(process.env.NUXT_JIT_PRERENDER_OUTPUT_DIR || '.output', 'public')

const registry = new CacheRegistry(join(process.env.NUXT_JIT_PRERENDER_OUTPUT_DIR || '.output', '.cache-manifest.json'))
const queue = new OperationQueue()

// Load existing cache manifest on startup
registry.load().catch(() => {})

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        // We throw an object that we can catch and recognize as a user error
        reject({
          statusCode: 400,
          message: 'Invalid JSON body: ' + (e instanceof Error ? e.message : String(e))
        })
      }
    })
    req.on('error', (err: Error) => {
      reject({ statusCode: 500, message: err.message })
    })
  })
}

function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function generateAndRegister(routes: string[]) {
  const result = await generateRoutes(nitroApp.localFetch, routes, PUBLIC_OUTPUT_DIR, CONCURRENCY)

  for (const r of result.results) {
    if (r.success && r.cacheTags && r.cacheTags.length > 0) {
      registry.register(r.route, r.cacheTags)
    }
  }

  return result
}

/**
 * Handles GET /api/health
 */
function handleHealth(res: ServerResponse) {
  sendJson(res, 200, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    queue: queue.status
  })
}

/**
 * Handles POST /api/generate
 */
async function handleGenerate(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req)
  const routes: string[] = body.routes

  if (!Array.isArray(routes) || routes.length === 0) {
    return sendJson(res, 400, {
      success: false,
      error: 'Request body must include a non-empty "routes" array.'
    })
  }

  const freshRoutes = queue.dedup(routes, 'generate')

  if (freshRoutes.length === 0) {
    return sendJson(res, 200, {
      success: true,
      summary: {
        requested: routes.length,
        generated: 0,
        discovered: 0,
        total: 0,
        deduped: routes.length
      },
      results: []
    })
  }

  try {
    const generateCtx: BeforeGenerateContext = { routes: [...freshRoutes] }
    await safeCallHook('jit-prerender:beforeGenerate', generateCtx)
    const routesToGenerate = generateCtx.routes

    if (routesToGenerate.length === 0) {
      return sendJson(res, 200, {
        success: true,
        summary: {
          requested: routes.length,
          generated: 0,
          discovered: 0,
          total: 0,
          deduped: routes.length - freshRoutes.length,
          filteredByHook: freshRoutes.length
        },
        results: []
      })
    }

    const result = await queue.enqueue('generate', async () => {
      logger.start('Generating %d routes.', routesToGenerate.length)
      const r = await generateAndRegister(routesToGenerate)
      logger.success('Generated %d/%d routes (%d discovered).', r.totalGenerated, r.results.length, r.totalDiscovered)
      return r
    })

    await safeCallHook('jit-prerender:afterGenerate', {
      routes: routesToGenerate,
      results: result.results,
      totalGenerated: result.totalGenerated,
      totalDiscovered: result.totalDiscovered
    } satisfies AfterGenerateContext)

    sendJson(res, 200, {
      success: true,
      summary: {
        requested: routes.length,
        generated: result.totalGenerated,
        discovered: result.totalDiscovered,
        total: result.results.length,
        deduped: routes.length - freshRoutes.length
      },
      results: result.results
    })
  } finally {
    queue.release(freshRoutes)
  }
}

/**
 * Handles POST /api/invalidate
 */
async function handleInvalidate(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req)
  const all: boolean = body.all === true
  const tags: string[] = body.tags

  // When `all` is true every known route is a target regardless of tags.
  // Otherwise tags must be provided as a non-empty array.
  if (!all && (!Array.isArray(tags) || tags.length === 0)) {
    return sendJson(res, 400, {
      success: false,
      error: 'Request body must include a non-empty "tags" array, or set "all": true to revalidate everything.'
    })
  }

  // Resolve routes upfront for dedup (trade-off: slightly stale by execution time,
  // but enables route-level dedup against concurrent generate/invalidate operations)
  const affectedRoutes = all ? registry.getAllRoutes() : registry.getRoutesForTags(tags)

  if (affectedRoutes.length === 0) {
    return sendJson(res, 200, {
      success: true,
      message: all ? 'Registry is empty — nothing to revalidate.' : 'No routes found for the given tags.',
      tags: all ? [] : tags,
      regenerated: [],
      failed: [],
      summary: { total: 0, success: 0, failed: 0, deduped: 0 }
    })
  }

  const freshRoutes = queue.dedup(affectedRoutes, 'invalidate')

  if (freshRoutes.length === 0) {
    return sendJson(res, 200, {
      success: true,
      all,
      tags: all ? [] : tags,
      regenerated: [],
      failed: [],
      summary: { total: 0, success: 0, failed: 0, deduped: affectedRoutes.length }
    })
  }

  try {
    const invalidateCtx: BeforeInvalidateContext = {
      tags: all ? null : tags,
      all,
      routes: [...freshRoutes]
    }
    await safeCallHook('jit-prerender:beforeInvalidate', invalidateCtx)
    const routesToInvalidate = invalidateCtx.routes

    const { regenerated, failed, result } = await queue.enqueue('invalidate', async () => {
      if (all) {
        logger.info('Invalidating routes - %d routes affected.', routesToInvalidate.length)
      } else {
        logger.info('Invalidating tags: [%s] - %d routes affected.', tags.join(', '), routesToInvalidate.length)
      }

      logger.start('Generating %d routes.', routesToInvalidate.length)
      const result = await generateAndRegister(routesToInvalidate)

      const failedRoutes = result.results.filter((r) => !r.success)
      for (const failed of failedRoutes) {
        logger.warn(
          'Route %s failed to regenerate during invalidation (%s) — removing from registry.',
          failed.route,
          failed.error ?? 'unknown error'
        )
        registry.removeRoute(failed.route)
      }

      logger.success(
        'Generated %d/%d routes (%d discovered).',
        result.totalGenerated,
        result.results.length,
        result.totalDiscovered
      )

      await safeCallHook('jit-prerender:afterInvalidate', {
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

    sendJson(res, 200, {
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
    })
  } finally {
    queue.release(freshRoutes)
  }
}

/**
 * Handles DELETE /api/route
 */
async function handleDelete(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req)
  const routes: string[] = body.routes

  if (!Array.isArray(routes) || routes.length === 0) {
    return sendJson(res, 400, {
      success: false,
      error: 'Request body must include a non-empty "routes" array'
    })
  }

  const resolvedBase = resolve(PUBLIC_OUTPUT_DIR)

  // Input validation: reject protected routes and traversal attempts before queueing
  for (const route of routes) {
    if (route.startsWith('/_nuxt') || route.includes('_nuxt')) {
      return sendJson(res, 400, {
        success: false,
        error: `Cannot delete protected route: ${route}`
      })
    }

    const { filePath } = resolveFilePath(PUBLIC_OUTPUT_DIR, route)
    const resolvedPath = resolve(filePath)

    if (!resolvedPath.startsWith(resolvedBase)) {
      return sendJson(res, 400, {
        success: false,
        error: `Invalid route (traversal attempt): ${route}`
      })
    }
  }

  await queue.enqueue('delete', async () => {
    const deleteCtx: BeforeDeleteContext = { routes: [...routes] }
    await safeCallHook('jit-prerender:beforeDelete', deleteCtx)
    const routesToDelete = deleteCtx.routes

    for (const route of routesToDelete) {
      const { filePath, dirPath } = resolveFilePath(PUBLIC_OUTPUT_DIR, route)
      const resolvedPath = resolve(filePath)

      // Delete the file
      await rm(resolvedPath, { force: true })
      logger.info('Deleted file from disk: %s', resolvedPath)

      // For page routes, also delete their _payload.json
      if (isPageRoute(route)) {
        const payloadPath = route === '/' ? '/_payload.json' : `${route}/_payload.json`
        const { filePath: payloadFilePath } = resolveFilePath(PUBLIC_OUTPUT_DIR, payloadPath)
        const resolvedPayloadPath = resolve(payloadFilePath)

        // Payload must also be within the base
        if (resolvedPayloadPath.startsWith(resolvedBase)) {
          await rm(resolvedPayloadPath, { force: true })
          logger.info('Deleted payload from disk: %s', resolvedPayloadPath)
        }

        // Try to remove the directory if it's now empty (and not the base)
        const resolvedDirPath = resolve(dirPath)
        if (resolvedDirPath !== resolvedBase && resolvedDirPath.startsWith(resolvedBase)) {
          try {
            await rmdir(resolvedDirPath)
            logger.info('Removed empty directory: %s', resolvedDirPath)
          } catch {
            // Directory not empty or doesn't exist, ignore
          }
        }
      }
    }

    registry.removeRoutes(routesToDelete)

    await safeCallHook('jit-prerender:afterDelete', { routes: routesToDelete } satisfies AfterDeleteContext)
  })

  return sendJson(res, 200, {
    success: true,
    removed: routes
  })
}

const server = createServer((req, res) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID()
  const correlationId = req.headers['x-correlation-id'] as string | undefined

  requestContext.run({ requestId, correlationId }, async () => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    try {
      if (url.pathname === '/api/health' && req.method === 'GET') {
        handleHealth(res)
        return
      }
      if (url.pathname === '/api/generate' && req.method === 'POST') {
        await handleGenerate(req, res)
        return
      }
      if (url.pathname === '/api/invalidate' && req.method === 'POST') {
        await handleInvalidate(req, res)
        return
      }
      if (url.pathname === '/api/route' && req.method === 'DELETE') {
        await handleDelete(req, res)
        return
      }

      sendJson(res, 404, { success: false, error: 'Not Found.' })
    } catch (err: any) {
      // Handle known errors (like parseBody rejection)
      if (err?.statusCode) {
        return sendJson(res, err.statusCode, {
          success: false,
          error: err.message
        })
      }

      logger.error('Server error:', err)
      sendJson(res, 500, { success: false, error: err.message || 'Internal Server Error' })
    }
  })
})

server.listen(PORT, HOST, () => {
  logger.success(`nuxt-jit-prerender ready at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  logger.info(`Static files will be written to: ${PUBLIC_OUTPUT_DIR}`)
})

export default {}
