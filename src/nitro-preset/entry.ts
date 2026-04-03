import '#nitro-internal-pollyfills'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { useNitroApp } from 'nitropack/runtime'

import { CacheRegistry } from './cache-registry'
import { logger, requestContext } from './logger'
import { generateRoutes } from './static-writer'

const nitroApp = useNitroApp()

const PORT = Number(process.env.NITRO_PORT || process.env.PORT || 3000)
const HOST = process.env.NITRO_HOST || process.env.HOST || '0.0.0.0'
const CONCURRENCY = Number(process.env.NITRO_JIT_PRERENDER_CONCURRENCY || 10)
const PUBLIC_OUTPUT_DIR = join(process.env.NITRO_JIT_PRERENDER_OUTPUT_DIR || '.output', 'public')

const registry = new CacheRegistry(
  join(process.env.NITRO_JIT_PRERENDER_OUTPUT_DIR || '.output', '.cache-manifest.json')
)

// Load existing cache manifest on startup
registry.load().catch(() => {})

/**
 * Parse JSON body from an IncomingMessage
 * @param req - The incoming request
 * @returns Promise<any> - The parsed JSON body
 */
function parseBody(req: import('node:http').IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(new Error('Invalid JSON body: ' + (e instanceof Error ? e.message : String(e))))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Send a JSON response
 * @param res - The response object
 * @param status - The status code
 * @param data - The data to send
 */
function sendJson(res: import('node:http').ServerResponse, status: number, data: Record<string, unknown>) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Generate routes and register cache tags
 * @param routes - Array of routes to generate
 * @returns Promise<GenerateRoutesResult> - Result of route generation
 */
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
 * Create server and handle requests
 */
const server = createServer((req, res) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID()
  const correlationId = req.headers['x-correlation-id'] as string | undefined

  requestContext.run({ requestId, correlationId }, async () => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    try {
      // Health check
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, {
          status: 'ok',
          timestamp: new Date().toISOString()
        })
      }

      // Generate routes
      if (url.pathname === '/api/generate' && req.method === 'POST') {
        const body = await parseBody(req)
        const routes: string[] = body.routes

        if (!Array.isArray(routes) || routes.length === 0) {
          return sendJson(res, 400, {
            success: false,
            error: 'Request body must include a non-empty "routes" array'
          })
        }

        logger.start(`Generating ${routes.length} routes`)

        const result = await generateAndRegister(routes)

        logger.success(
          `Generated ${result.totalGenerated}/${result.results.length} routes (${result.totalDiscovered} discovered)`
        )

        return sendJson(res, 200, {
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

      // All other requests should return 404
      sendJson(res, 404, {
        success: false,
        error: 'Not Found.'
      })
    } catch (err: any) {
      logger.error('Server error:', err)
      sendJson(res, 500, {
        success: false,
        error: err.message || 'Internal Server Error'
      })
    }
  })
})

server.listen(PORT, HOST, () => {
  logger.success(`nuxt-jit-prerender ready at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  logger.info(`Static files will be written to: ${PUBLIC_OUTPUT_DIR}`)
})

export default {}
