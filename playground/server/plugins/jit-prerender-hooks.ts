import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export default defineNitroPlugin((nitroApp) => {
  const markerDir = process.env.NUXT_JIT_PRERENDER_OUTPUT_DIR || '.output'
  const markerPath = join(markerDir, '.hooks-marker.json')

  const calls: Record<string, unknown[]> = {}

  async function record(hook: string, ctx: unknown) {
    ;(calls[hook] ??= []).push(ctx)
    await writeFile(markerPath, JSON.stringify(calls, null, 2), 'utf-8')
  }

  nitroApp.hooks.hook('jit-prerender:beforeGenerate', (ctx) => record('beforeGenerate', ctx))
  nitroApp.hooks.hook('jit-prerender:afterGenerate', (ctx) => record('afterGenerate', ctx))
  nitroApp.hooks.hook('jit-prerender:beforeInvalidate', (ctx) => record('beforeInvalidate', ctx))
  nitroApp.hooks.hook('jit-prerender:afterInvalidate', (ctx) => record('afterInvalidate', ctx))
  nitroApp.hooks.hook('jit-prerender:beforeDelete', (ctx) => record('beforeDelete', ctx))
  nitroApp.hooks.hook('jit-prerender:afterDelete', (ctx) => record('afterDelete', ctx))
})
