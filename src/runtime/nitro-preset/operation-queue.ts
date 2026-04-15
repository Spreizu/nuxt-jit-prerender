import { logger } from './logger'

export type OperationType = 'generate' | 'invalidate' | 'delete'

export class OperationQueue {
  private _running: Promise<void> = Promise.resolve()
  private _queueDepth = 0
  private _activeOperation: OperationType | null = null
  private _pending = new Map<string, OperationType>()

  /**
   * Deduplicate routes against the set of routes currently being processed
   * or queued for processing. Returns the subset of `routes` that are not
   * already pending and registers them.
   *
   * Dedup rules are operation-type-aware:
   * - generate dedup against pending generate AND invalidate (both produce HTML)
   * - invalidate dedup against pending invalidate only (content may have changed)
   * - delete never dedupes
   *
   * MUST be called synchronously before enqueue(). JS single-threading
   * guarantees no race between dedup() and the next synchronous call.
   */
  dedup(routes: string[], operation: OperationType): string[] {
    if (operation === 'delete') return [...routes]

    const fresh: string[] = []
    for (const route of routes) {
      const existing = this._pending.get(route)
      if (!existing) {
        this._pending.set(route, operation)
        fresh.push(route)
      } else if (operation === 'generate') {
        // generate dedup against both generate and invalidate
      } else if (operation === 'invalidate' && existing !== 'invalidate') {
        // invalidate only dedup against invalidate, not generate
        this._pending.set(route, operation)
        fresh.push(route)
      }
      // else: deduped — skip
    }
    return fresh
  }

  /**
   * Remove routes from the pending set. Call in a finally block after the
   * operation completes (success or failure).
   */
  release(routes: string[]): void {
    for (const r of routes) this._pending.delete(r)
  }

  /**
   * Enqueue an async operation for sequential execution.
   * Input validation should happen BEFORE calling enqueue so 400s return immediately.
   */
  enqueue<T>(operation: OperationType, fn: () => Promise<T>): Promise<T> {
    this._queueDepth++

    const result = this._running.then(async () => {
      this._queueDepth--
      this._activeOperation = operation

      if (this._queueDepth > 0) {
        logger.info('Queue: starting %s (%d waiting)', operation, this._queueDepth)
      }

      try {
        return await fn()
      } finally {
        this._activeOperation = null
      }
    })

    // Keep the chain alive even if the operation rejects.
    // The caller sees the rejection via `result`; the chain sees a settled promise.
    this._running = result.catch(() => {}) as Promise<void>

    return result
  }

  /**
   * Current queue state for health/observability.
   */
  get status() {
    return {
      activeOperation: this._activeOperation,
      queued: this._queueDepth,
      pendingRoutes: [...this._pending.entries()].map(([route, operation]) => ({ route, operation }))
    }
  }
}
