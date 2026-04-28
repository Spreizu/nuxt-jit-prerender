import type { CacheRegistry } from '../cache-registry'
import type { OperationType } from '../operation-queue'
import type { RouteGenerationResult } from '../static-writer'

export interface QueueStatus {
  activeOperation: OperationType | null
  queued: number
  pendingRoutes: Array<{ route: string; operation: OperationType }>
}

export interface HealthResponse {
  status: 'ok'
  timestamp: string
  queue: QueueStatus
}

export interface GenerateSummary {
  requested: number
  generated: number
  discovered: number
  total: number
  deduped: number
  filteredByHook: number
}

export interface GenerateResponse {
  success: true
  summary: GenerateSummary
  results: RouteGenerationResult[]
}

export interface InvalidateSummary {
  total: number
  success: number
  failed: number
  deduped: number
}

export interface InvalidateResponse {
  success: true
  all: boolean
  tags: string[]
  regenerated: string[]
  failed: Array<{ route: string; error?: string }>
  summary: InvalidateSummary
  results?: RouteGenerationResult[]
  message?: string
}

export interface DeleteResponse {
  success: true
  removed: string[]
}

export interface HandlerContext {
  queue: {
    status: QueueStatus
    dedup: (routes: string[], operation: OperationType) => string[]
    enqueue: <T>(operation: OperationType, fn: () => Promise<T>) => Promise<T>
    release: (routes: string[]) => void
  }
  registry: CacheRegistry
  publicDir: string
  localFetch: (url: string | URL, init?: RequestInit) => Promise<Response>
  callHook: (name: string, ctx: unknown) => Promise<void>
  generateAndRegister: (routes: string[]) => Promise<{
    results: RouteGenerationResult[]
    totalGenerated: number
    totalDiscovered: number
  }>
}
