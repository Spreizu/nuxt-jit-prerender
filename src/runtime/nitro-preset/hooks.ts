import type { RouteGenerationResult } from './static-writer'

export interface BeforeGenerateContext {
  /** Routes about to be generated. Hook callbacks may mutate this array. */
  routes: string[]
}

export interface AfterGenerateContext {
  /** Routes that were generated. */
  routes: string[]
  /** Per-route generation results. */
  results: RouteGenerationResult[]
  /** Count of successfully generated routes. */
  totalGenerated: number
  /** Count of routes discovered via x-nitro-prerender header. */
  totalDiscovered: number
}

export interface BeforeInvalidateContext {
  /** Tags that triggered invalidation. Null when `all` is true. */
  tags: string[] | null
  /** Whether all routes are being invalidated. */
  all: boolean
  /** Routes about to be regenerated. Hook callbacks may mutate this array. */
  routes: string[]
}

export interface AfterInvalidateContext {
  /** Tags that triggered invalidation. Null when `all` is true. */
  tags: string[] | null
  /** Whether all routes were invalidated. */
  all: boolean
  /** Routes that were regenerated. */
  routes: string[]
  /** Per-route generation results. */
  results: RouteGenerationResult[]
  /** Routes that failed during regeneration. */
  failed: Array<{ route: string; error?: string }>
}

export interface BeforeDeleteContext {
  /** Routes about to be deleted. Hook callbacks may mutate this array. */
  routes: string[]
}

export interface AfterDeleteContext {
  /** Routes that were deleted. */
  routes: string[]
}

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    'jit-prerender:beforeGenerate': (ctx: BeforeGenerateContext) => void | Promise<void>
    'jit-prerender:afterGenerate': (ctx: AfterGenerateContext) => void | Promise<void>
    'jit-prerender:beforeInvalidate': (ctx: BeforeInvalidateContext) => void | Promise<void>
    'jit-prerender:afterInvalidate': (ctx: AfterInvalidateContext) => void | Promise<void>
    'jit-prerender:beforeDelete': (ctx: BeforeDeleteContext) => void | Promise<void>
    'jit-prerender:afterDelete': (ctx: AfterDeleteContext) => void | Promise<void>
  }
}
