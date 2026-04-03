import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

import { logger } from './logger'
import { parseCommaSeparatedList } from './utils'

export type RouteGenerationResult = {
  route: string
  success: boolean
  cacheTags?: string[]
  discoveredRoutes?: string[]
  error?: string
}

// Cache for created directories to avoid redundant mkdir calls
const createdDirs = new Set<string>()

/**
 * Clear the directory cache
 */
export function clearDirCache() {
  createdDirs.clear()
}

/**
 * Ensure a directory exists (cached to avoid redundant mkdir calls)
 * @param dirPath - The directory path to ensure
 */
async function ensureDir(dirPath: string): Promise<void> {
  if (createdDirs.has(dirPath)) return
  await mkdir(dirPath, { recursive: true })
  createdDirs.add(dirPath)
}

/**
 * Read the body from a Response object into a string
 * @param response - The Response object to read the body from
 * @returns Promise<string> - The body of the response as a string
 */
async function readResponseBody(response: Response): Promise<string> {
  if (response.body instanceof ReadableStream) {
    const reader = response.body.getReader()
    const chunks: Buffer[] = []

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(Buffer.from(value))
    }

    return Buffer.concat(chunks).toString('utf-8')
  }

  // Handle string or other types
  return String(response.body ?? '')
}

/**
 * Determine the file path for a given route pathname.
 * - Paths with extensions (e.g. `/_payload.json`) are saved as-is
 * - Paths without extensions (e.g. `/about`) become `about/index.html`
 * - Root `/` becomes `index.html`
 * @param outputDir - The output directory
 * @param pathname - The route pathname
 * @returns { filePath: string; dirPath: string } - The file path and directory path
 */
export function resolveFilePath(outputDir: string, pathname: string): { filePath: string; dirPath: string } {
  const hasExtension = /\.[^/]+$/.test(pathname)

  if (hasExtension) {
    const filePath = join(outputDir, pathname.replace(/^\//, ''))
    return { filePath, dirPath: dirname(filePath) }
  }

  const subDir = pathname === '/' ? '' : pathname.replace(/^\//, '')
  const dirPath = join(outputDir, subDir)

  return { filePath: join(dirPath, 'index.html'), dirPath }
}

/**
 * Write a rendered route's content to the static output directory.
 * @param outputDir - The output directory
 * @param pathname - The route pathname
 * @param content - The content to write
 * @returns Promise<string> - The path of the written file
 */
export async function writeStaticFile(outputDir: string, pathname: string, content: string): Promise<string> {
  const { filePath, dirPath } = resolveFilePath(outputDir, pathname)
  await ensureDir(dirPath)
  await writeFile(filePath, content, 'utf-8')
  return filePath
}

/**
 * Check if a pathname is an HTML page route (not an asset/payload path)
 */
export function isPageRoute(pathname: string): boolean {
  return !/\.[^/]+$/.test(pathname)
}

/**
 * Render a single route using Nitro's localFetch and save the result.
 * For page routes (no file extension), also fetches and saves _payload.json
 * to support client-side SPA navigation after hydration.
 */
export async function renderAndSave(
  localFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  outputDir: string,
  pathname: string
): Promise<RouteGenerationResult> {
  try {
    const response = await localFetch(pathname, {
      headers: {
        'x-nitro-prerender': pathname
      }
    })

    if (!response.ok) {
      return {
        route: pathname,
        success: false,
        error: `Render failed with status ${response.status}`
      }
    }

    const body = await readResponseBody(response)
    await writeStaticFile(outputDir, pathname, body)

    // Check for discovered prerender routes (Nuxt sets this header for payloads, etc.)
    const discoveredRoutes: string[] = []
    const prerenderHeader = response.headers.get('x-nitro-prerender')
    if (prerenderHeader) {
      // The header can contain comma-separated paths
      const routes = parseCommaSeparatedList(prerenderHeader)
      discoveredRoutes.push(...routes)
    }

    // For page routes, also fetch and save _payload.json for SPA navigation
    if (isPageRoute(pathname)) {
      try {
        const payloadPath = pathname === '/' ? '/_payload.json' : `${pathname}/_payload.json`
        const payloadResponse = await localFetch(payloadPath, {
          headers: {
            'x-nitro-prerender': payloadPath
          }
        })

        if (payloadResponse.status === 200) {
          const payloadBody = await readResponseBody(payloadResponse)
          await writeStaticFile(outputDir, payloadPath, payloadBody)
        }
      } catch {
        // Payload generation is best-effort — log but don't fail the route
        logger.warn('Could not generate _payload.json for %s', pathname)
      }
    }

    // Read cache tags declared by the page
    const cacheTags = parseCommaSeparatedList(response.headers.get('x-jit-prerender-cache-tags'))

    return {
      route: pathname,
      success: true,
      cacheTags,
      discoveredRoutes
    }
  } catch (error) {
    return {
      route: pathname,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Generate multiple routes with automatic discovery of linked resources
 * (e.g., payload JSON files referenced by the HTML pages).
 * @param localFetch - The local fetch function
 * @param outputDir - The output directory
 * @param routes - The routes to generate
 * @param concurrency - The number of routes to generate concurrently
 * @returns Promise<{ results: RouteGenerationResult[]; totalGenerated: number; totalDiscovered: number }> - The results of the route generation
 */
export async function generateRoutes(
  localFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  routes: string[],
  outputDir: string,
  concurrency: number
): Promise<{
  results: RouteGenerationResult[]
  totalGenerated: number
  totalDiscovered: number
}> {
  const results: RouteGenerationResult[] = []
  const processedRoutes = new Set<string>()
  const pendingQueue = [...routes]
  let totalDiscovered = 0

  // Process queue with concurrency limit
  while (pendingQueue.length > 0) {
    // Take a batch from the queue
    const batch = pendingQueue.splice(0, concurrency).filter((route) => {
      if (processedRoutes.has(route)) return false
      processedRoutes.add(route)
      return true
    })

    if (batch.length === 0) continue

    // Process batch concurrently
    const batchResults = await Promise.all(batch.map((route) => renderAndSave(localFetch, outputDir, route)))

    for (const result of batchResults) {
      results.push(result)

      if (result.success) {
        logger.success('Generated route %s', result.route)
      } else {
        logger.error('Failed to generate route %s: %s', result.route, result.error)
      }

      // Queue newly discovered routes
      if (result.discoveredRoutes) {
        for (const discovered of result.discoveredRoutes) {
          if (!processedRoutes.has(discovered)) {
            pendingQueue.push(discovered)
            totalDiscovered++
          }
        }
      }
    }
  }

  return {
    results,
    totalGenerated: results.filter((r) => r.success).length,
    totalDiscovered
  }
}
