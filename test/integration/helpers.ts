import { spawn, execFileSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { rm, mkdir, access, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLAYGROUND_DIR = fileURLToPath(new URL('../../playground', import.meta.url))
export const OUTPUT_DIR = join(PLAYGROUND_DIR, '.output')
export const PUBLIC_DIR = join(OUTPUT_DIR, 'public')

export const SENTINEL_CONTENT = 'traversal-sentinel:aef1b2c3d4'
export const SENTINEL_PATH = join(OUTPUT_DIR, '.traversal-sentinel.json')
export const SENTINEL_TXT_PATH = join(OUTPUT_DIR, '.traversal-sentinel.txt')

export async function createSentinelFiles(): Promise<void> {
  await writeFile(SENTINEL_PATH, SENTINEL_CONTENT)
  await writeFile(SENTINEL_TXT_PATH, SENTINEL_CONTENT)
}

export async function cleanupSentinelFiles(): Promise<void> {
  await rm(SENTINEL_PATH, { force: true })
  await rm(SENTINEL_TXT_PATH, { force: true })
}
export const SERVER_ENTRY = join(OUTPUT_DIR, 'server/index.mjs')
export const MANIFEST_PATH = join(OUTPUT_DIR, '.cache-manifest.json')
export const HOOKS_MARKER_PATH = join(OUTPUT_DIR, '.hooks-marker.json')

export async function waitForServer(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/api/health`)
      // Any response (even 404 in preview mode) means the server is listening
      return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`)
}

export async function buildOnce(): Promise<void> {
  const needsBuild = await access(SERVER_ENTRY)
    .then(() => false)
    .catch(() => true)
  if (needsBuild) {
    execFileSync('pnpm', ['dev:build'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' }
    })
  }
}

export async function cleanOutput(): Promise<void> {
  await rm(PUBLIC_DIR, { recursive: true, force: true })
  await mkdir(PUBLIC_DIR, { recursive: true })
  await rm(MANIFEST_PATH, { force: true })
  await rm(HOOKS_MARKER_PATH, { force: true })
}

export function startServer(port: number, env?: Record<string, string>): ChildProcess {
  return spawn('node', [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      NUXT_JIT_PRERENDER_OUTPUT_DIR: OUTPUT_DIR,
      NODE_ENV: 'production',
      ...env
    },
    cwd: PLAYGROUND_DIR,
    stdio: 'pipe'
  })
}

export async function generateRoutes(
  port: number,
  routes: string[]
): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  const res = await fetch(`http://localhost:${port}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routes })
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

export async function deleteRoutes(
  port: number,
  routes: string[]
): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  const res = await fetch(`http://localhost:${port}/api/route`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routes })
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

export async function readManifest(outputDir: string = OUTPUT_DIR): Promise<{
  tagToRoutes: Record<string, string[]>
  routeToTags: Record<string, string[]>
}> {
  await new Promise((r) => setTimeout(r, 1500))
  const content = await readFile(join(outputDir, '.cache-manifest.json'), 'utf-8')
  return JSON.parse(content)
}

export async function readStaticFile(publicDir: string, pathname: string): Promise<string> {
  const hasExtension = /\.[^/]+$/.test(pathname)
  const filePath = hasExtension
    ? join(publicDir, pathname.replace(/^\//, ''))
    : join(publicDir, pathname === '/' ? 'index.html' : `${pathname.replace(/^\//, '')}/index.html`)
  return readFile(filePath, 'utf-8')
}

export function extractPayloadTimestamp(payloadJson: string): number | null {
  const data: unknown[] = JSON.parse(payloadJson)
  const ts = data.findLast((v): v is number => typeof v === 'number')
  return ts ?? null
}

export function extractHtmlTimestamp(html: string): number | null {
  const match = html.match(/data-testid="rendered-at">(\d+)/)
  return match ? Number(match[1]) : null
}
