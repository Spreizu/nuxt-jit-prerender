import '#nitro-internal-pollyfills'
import { randomUUID } from 'node:crypto'
import { rm, rmdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'

import { useNitroApp } from 'nitropack/runtime'

import { CacheRegistry } from './cache-registry'
import { logger, requestContext } from './logger'
import { generateRoutes, resolveFilePath, isPageRoute } from './static-writer'

const nitroApp = useNitroApp()

const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'
const CONCURRENCY = Number(process.env.NUXT_JIT_PRERENDER_CONCURRENCY || 10)
const PUBLIC_OUTPUT_DIR = join(process.env.NUXT_JIT_PRERENDER_OUTPUT_DIR || '.output', 'public')

const registry = new CacheRegistry(join(process.env.NUXT_JIT_PRERENDER_OUTPUT_DIR || '.output', '.cache-manifest.json'))

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
    timestamp: new Date().toISOString()
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

  logger.start('Generating %d routes.', routes.length)

  const result = await generateAndRegister(routes)

  logger.success(
    'Generated %d/%d routes (%d discovered).',
    result.totalGenerated,
    result.results.length,
    result.totalDiscovered
  )

  sendJson(res, 200, {
    success: true,
    summary: {
      requested: routes.length,
      generated: result.totalGenerated,
      discovered: result.totalDiscovered,
      total: result.results.length
    },
    results: result.results
  })
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

  const affectedRoutes = all ? registry.getAllRoutes() : registry.getRoutesForTags(tags)

  if (affectedRoutes.length === 0) {
    return sendJson(res, 200, {
      success: true,
      message: all ? 'Registry is empty — nothing to revalidate.' : 'No routes found for the given tags.',
      tags: all ? [] : tags,
      regenerated: [],
      failed: [],
      summary: { total: 0, success: 0, failed: 0 }
    })
  }

  if (all) {
    logger.info('Invalidating all routes - %d routes affected.', affectedRoutes.length)
  } else {
    logger.info('Invalidating tags: [%s] - %d routes affected.', tags.join(', '), affectedRoutes.length)
  }

  logger.start('Generating %d routes.', affectedRoutes.length)
  const result = await generateAndRegister(affectedRoutes)

  // Warn and evict any routes that failed to re-render.
  // Keeping a broken route in the registry would cause it to be re-attempted
  // on every future invalidation, never successfully regenerating.
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

  sendJson(res, 200, {
    success: true,
    all,
    tags: all ? [] : tags,
    regenerated: affectedRoutes,
    failed: failedRoutes.map((r) => ({ route: r.route, error: r.error })),
    summary: {
      total: result.results.length,
      success: result.totalGenerated,
      failed: failedRoutes.length
    },
    results: result.results
  })
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

  for (const route of routes) {
    // Disallow deleting _nuxt files
    if (route.startsWith('/_nuxt') || route.includes('_nuxt')) {
      return sendJson(res, 400, {
        success: false,
        error: `Cannot delete protected route: ${route}`
      })
    }

    const { filePath, dirPath } = resolveFilePath(PUBLIC_OUTPUT_DIR, route)
    const resolvedPath = resolve(filePath)

    // Disallow path traversal
    if (!resolvedPath.startsWith(resolvedBase)) {
      return sendJson(res, 400, {
        success: false,
        error: `Invalid route (traversal attempt): ${route}`
      })
    }

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

  registry.removeRoutes(routes)

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
