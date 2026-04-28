import type { EventHandler } from 'h3'
import { eventHandler } from 'h3'

import type { HandlerContext, HealthResponse } from './types'

/**
 * Creates an event handler that returns service health and queue state.
 *
 * Unconditionally returns `{ status: 'ok', timestamp, queue }` where `queue`
 * exposes the current active operation, queue depth, and pending routes.
 * This endpoint is never blocked by in-flight operations and is suitable
 * for load-balancer readiness probes.
 */
export function createHealthHandler(ctx: HandlerContext): EventHandler {
  return eventHandler(
    () =>
      ({
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
        queue: ctx.queue.status
      }) satisfies HealthResponse
  )
}
