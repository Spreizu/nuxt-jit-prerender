import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { H3Event, EventHandler } from 'h3'
import { sendWebResponse, createError, eventHandler } from 'h3'
import { lookup } from 'mrmime'

function hasExtension(pathname: string): boolean {
  return /\.[^/]+$/.test(pathname)
}

function isPayload(pathname: string): boolean {
  return pathname === '/_payload.json' || pathname.endsWith('/_payload.json')
}

import type { HandlerContext } from './types'

export async function handlePreview(
  event: H3Event,
  localFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  publicDir: string
): Promise<void> {
  // event.path includes the query string — strip it so isPayload/hasExtension
  // and file-path resolution work correctly.
  const pathname = new URL(event.path, 'http://localhost').pathname

  if (!hasExtension(pathname) || isPayload(pathname)) {
    const response = await localFetch(pathname, { headers: { 'x-nitro-prerender': pathname } })
    return sendWebResponse(event, response)
  }

  // Static assets: serve from disk (_nuxt/ bundles, images, fonts, etc.)
  const filePath = join(publicDir, pathname)
  const stats = await stat(filePath).catch(() => null)
  if (stats?.isFile()) {
    return sendWebResponse(event, new Response(new Uint8Array(await readFile(filePath)), {
      status: 200,
      headers: {
        'Content-Type': lookup(pathname) || 'application/octet-stream',
        'Content-Length': String(stats.size),
        'Last-Modified': new Date(stats.mtime).toUTCString()
      }
    }))
  }

  throw createError({ statusCode: 404, statusMessage: 'Not Found.' })
}

/**
 * Creates a catch-all event handler that serves a local preview of the Nuxt app.
 *
 * Page routes (no file extension) and `/_payload.json` files are rendered fresh
 * via Nitro's `localFetch` in SSR mode. All other requests (framework assets,
 * images, fonts, etc.) are served as static files from disk.
 */
export function createPreviewHandler(ctx: HandlerContext): EventHandler {
  return eventHandler((event) => handlePreview(event, ctx.localFetch, ctx.publicDir))
}
