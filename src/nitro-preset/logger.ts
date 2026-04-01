import { AsyncLocalStorage } from 'node:async_hooks'
import { format } from 'node:util'

import { createConsola } from 'consola'

export const requestContext = new AsyncLocalStorage<{
  requestId: string
  correlationId?: string
}>()

/**
 * Create consola logger with request context support
 */
export const logger = createConsola({
  ...(process.env.NITRO_JIT_PRERENDER_CI === 'true' && {
    reporters: [
      {
        log: (logObj) => {
          const { args, ...rest } = logObj
          const ctx = requestContext.getStore()
          console.log(
            JSON.stringify({
              ...rest,
              requestId: ctx?.requestId,
              ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
              message: format(...(args || []))
            })
          )
        }
      }
    ]
  })
}).withTag('nuxt-jit-prerender')
