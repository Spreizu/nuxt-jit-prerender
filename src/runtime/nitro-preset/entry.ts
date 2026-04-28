import '#nitro-internal-pollyfills'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { createApp, createRouter, eventHandler, getRequestHeader, toNodeListener } from 'h3'
import { useNitroApp } from 'nitropack/runtime'

import { CacheRegistry } from './cache-registry'
import { createDeleteHandler } from './handlers/delete'
import { createGenerateHandler } from './handlers/generate'
import { createHealthHandler } from './handlers/health'
import { createInvalidateHandler } from './handlers/invalidate'
import { createPreviewHandler } from './handlers/preview'
import { logger, requestContext } from './logger'
import { OperationQueue } from './operation-queue'
import { generateRoutes } from './static-writer'

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
const PREVIEW_MODE = process.env.NUXT_JIT_PRERENDER_PREVIEW === 'true'
const PUBLIC_OUTPUT_DIR = join(process.env.NUXT_JIT_PRERENDER_OUTPUT_DIR || '.output', 'public')

const registry = new CacheRegistry(join(process.env.NUXT_JIT_PRERENDER_OUTPUT_DIR || '.output', '.cache-manifest.json'))
const queue = new OperationQueue()

registry.load().catch(() => {})

async function generateAndRegister(routes: string[]) {
  const result = await generateRoutes(nitroApp.localFetch, routes, PUBLIC_OUTPUT_DIR, CONCURRENCY)

  for (const r of result.results) {
    if (r.success && r.cacheTags && r.cacheTags.length > 0) {
      registry.register(r.route, r.cacheTags)
    }
  }

  return result
}

const handlerCtx = {
  queue,
  registry,
  publicDir: PUBLIC_OUTPUT_DIR,
  localFetch: nitroApp.localFetch,
  callHook: safeCallHook,
  generateAndRegister
}

const app = createApp()
const router = createRouter()

// Request context middleware — sets AsyncLocalStorage for the logger
app.use(
  eventHandler((event) => {
    requestContext.enterWith({
      requestId: (getRequestHeader(event, 'x-request-id') as string) || randomUUID(),
      correlationId: getRequestHeader(event, 'x-correlation-id') as string | undefined
    })
  })
)

if (!PREVIEW_MODE) {
  router.get('/api/health', createHealthHandler(handlerCtx))
  router.post('/api/generate', createGenerateHandler(handlerCtx))
  router.post('/api/invalidate', createInvalidateHandler(handlerCtx))
  router.delete('/api/route', createDeleteHandler(handlerCtx))
}

app.use(router)

// Preview mode: catch-all handler for non-API requests
if (PREVIEW_MODE) {
  app.use(createPreviewHandler(handlerCtx))
}

// Error handler — writes directly to the Node.js response to avoid h3's
// deferred send() which would conflict with the handled-check lifecycle.
app.options.onError = (error: any, event) => {
  const status = error.statusCode || 500
  const message = error.statusMessage || error.message || 'Internal Server Error'
  if (status >= 500) logger.error('Server error: %s', message)
  const res = event.node.res
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ success: false, error: message }))
  event._handled = true
}

const server = createServer(toNodeListener(app))

server.listen(PORT, HOST, () => {
  logger.success(`nuxt-jit-prerender ready at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  if (PREVIEW_MODE) {
    logger.info('Preview mode enabled — serving static files and on-demand renders from: %s', PUBLIC_OUTPUT_DIR)
  } else {
    logger.info('Static files will be written to: %s', PUBLIC_OUTPUT_DIR)
  }
})

export default {}
