import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { H3Event, EventHandler } from 'h3'
import { serveStatic, sendWebResponse, createError, eventHandler } from 'h3'
import { lookup } from 'mrmime'

import { clearPayloadCache } from '../utils'

function hasExtension(pathname: string): boolean {
  return /\.[^/]+$/.test(pathname)
}

function isPayload(pathname: string): boolean {
  return pathname === '/_payload.json' || pathname.endsWith('/_payload.json')
}

const staticOptions = (publicDir: string) => ({
  fallthrough: true,
  indexNames: ['/index.html'],
  getMeta: async (id: string) => {
    const filePath = join(publicDir, id)
    const stats = await stat(filePath).catch(() => null)
    if (!stats?.isFile()) return undefined
    return {
      type: lookup(id) || 'application/octet-stream',
      size: stats.size,
      mtime: stats.mtime
    }
  },
  getContents: async (id: string) => {
    return readFile(join(publicDir, id))
  }
})

import type { HandlerContext } from './types'

export async function handlePreview(
  event: H3Event,
  localFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  publicDir: string
): Promise<void> {
  const pathname = event.path

  if (pathname.startsWith('/api/')) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found.' })
  }

  // SSR output — always render fresh:
  //   - Page routes (no extension): /about
  //   - Payload files: /_payload.json, /about/_payload.json
  if (!hasExtension(pathname) || isPayload(pathname)) {
    if (isPayload(pathname)) {
      const pageUrl = pathname.slice(0, pathname.lastIndexOf('/')) || '/'
      await clearPayloadCache(pageUrl)
    }
    const response = await localFetch(pathname, { headers: { 'x-nitro-prerender': pathname } })
    return sendWebResponse(event, response)
  }

  // Static assets: serve from disk (_nuxt/ bundles, images, fonts, etc.)
  // h3's serveStatic handles MIME types, etag, caching, encoding negotiation.
  const served = await serveStatic(event, staticOptions(publicDir))
  if (served !== false) return

  throw createError({ statusCode: 404, statusMessage: 'Not Found.' })
}

/**
 * Creates a catch-all event handler that serves a local preview of the Nuxt app.
 *
 * Page routes (no file extension) and `/_payload.json` files are rendered fresh
 * via Nitro's `localFetch` in SSR mode. All other requests (framework assets,
 * images, fonts, etc.) are served as static files from disk. Requests under
 * `/api/` are rejected with 404 to avoid invoking API handlers during preview.
 */
export function createPreviewHandler(ctx: HandlerContext): EventHandler {
  return eventHandler((event) => handlePreview(event, ctx.localFetch, ctx.publicDir))
}
