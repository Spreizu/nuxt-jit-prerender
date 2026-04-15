import { describe, it, expect } from 'vitest'

import { OperationQueue } from '../../src/runtime/nitro-preset/operation-queue'

describe('OperationQueue', () => {
  it('has correct initial state', () => {
    const queue = new OperationQueue()
    expect(queue.status).toEqual({ activeOperation: null, queued: 0, pendingRoutes: [] })
  })

  it('returns the callback result via enqueue', async () => {
    const queue = new OperationQueue()
    const result = await queue.enqueue('generate', async () => 42)
    expect(result).toBe(42)
  })

  it('executes operations sequentially (never overlaps)', async () => {
    const queue = new OperationQueue()
    const log: string[] = []

    const op1 = queue.enqueue('generate', async () => {
      log.push('start-1')
      await new Promise((r) => setTimeout(r, 50))
      log.push('end-1')
    })

    const op2 = queue.enqueue('generate', async () => {
      log.push('start-2')
      await new Promise((r) => setTimeout(r, 10))
      log.push('end-2')
    })

    await Promise.all([op1, op2])

    // op1 must finish before op2 starts
    expect(log).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })

  it('executes operations in FIFO order', async () => {
    const queue = new OperationQueue()
    const order: number[] = []

    const ops = [1, 2, 3].map((n) =>
      queue.enqueue('generate', async () => {
        order.push(n)
        return n
      })
    )

    const results = await Promise.all(ops)
    expect(order).toEqual([1, 2, 3])
    expect(results).toEqual([1, 2, 3])
  })

  it('isolates errors — a failing operation does not break subsequent ones', async () => {
    const queue = new OperationQueue()

    const op1 = queue.enqueue('generate', async () => {
      throw new Error('boom')
    })

    const op2 = queue.enqueue('invalidate', async () => 'ok')

    await expect(op1).rejects.toThrow('boom')
    const result = await op2
    expect(result).toBe('ok')
  })

  it('tracks queue depth correctly', async () => {
    const queue = new OperationQueue()
    let resolve1: () => void
    const p1 = new Promise<void>((r) => {
      resolve1 = r
    })

    // Start op1 — it blocks
    queue.enqueue('generate', async () => {
      await p1
    })

    // Give the event loop a tick so op1 starts
    await new Promise((r) => setTimeout(r, 0))

    // Enqueue two more — they should be queued
    queue.enqueue('generate', async () => {})
    queue.enqueue('invalidate', async () => {})

    expect(queue.status.queued).toBe(2)

    // Resolve op1
    resolve1!()

    // Give time for the queue to drain
    await new Promise((r) => setTimeout(r, 10))
    expect(queue.status.queued).toBe(0)
  })

  it('tracks active operation during execution', async () => {
    const queue = new OperationQueue()
    let resolveOp: () => void
    const p = new Promise<void>((r) => {
      resolveOp = r
    })

    let capturedActive: string | null = null

    queue.enqueue('generate', async () => {
      capturedActive = queue.status.activeOperation
      await p
    })

    // Give the event loop a tick so the op starts
    await new Promise((r) => setTimeout(r, 0))

    expect(queue.status.activeOperation).toBe('generate')
    expect(capturedActive).toBe('generate')

    resolveOp!()

    await new Promise((r) => setTimeout(r, 0))
    expect(queue.status.activeOperation).toBeNull()
  })

  it('resets activeOperation to null after an error', async () => {
    const queue = new OperationQueue()

    await queue
      .enqueue('delete', async () => {
        throw new Error('fail')
      })
      .catch(() => {})

    expect(queue.status.activeOperation).toBeNull()
  })
})

describe('OperationQueue dedup', () => {
  it('dedup returns all routes when nothing is pending', () => {
    const queue = new OperationQueue()
    const fresh = queue.dedup(['/a', '/b'], 'generate')
    expect(fresh).toEqual(['/a', '/b'])
  })

  it('dedup(generate) filters against pending generate', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'generate')
    const fresh = queue.dedup(['/b', '/c'], 'generate')
    expect(fresh).toEqual(['/c'])
  })

  it('dedup(generate) filters against pending invalidate', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'invalidate')
    const fresh = queue.dedup(['/b', '/c'], 'generate')
    expect(fresh).toEqual(['/c'])
  })

  it('dedup(generate) does NOT filter against pending delete', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'delete')
    const fresh = queue.dedup(['/a', '/b'], 'generate')
    expect(fresh).toEqual(['/a', '/b'])
  })

  it('dedup(invalidate) filters against pending invalidate', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'invalidate')
    const fresh = queue.dedup(['/b', '/c'], 'invalidate')
    expect(fresh).toEqual(['/c'])
  })

  it('dedup(invalidate) does NOT filter against pending generate', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'generate')
    const fresh = queue.dedup(['/b', '/c'], 'invalidate')
    // /b is pending via generate, but invalidate should still proceed
    expect(fresh).toEqual(['/b', '/c'])
  })

  it('dedup(delete) never filters — always returns all routes', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'generate')
    queue.dedup(['/b', '/c'], 'invalidate')
    const fresh = queue.dedup(['/a', '/b', '/c'], 'delete')
    expect(fresh).toEqual(['/a', '/b', '/c'])
  })

  it('dedup returns empty when all routes are pending', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a'], 'generate')
    const fresh = queue.dedup(['/a'], 'generate')
    expect(fresh).toEqual([])
  })

  it('release allows routes to be re-deduped', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'generate')
    queue.release(['/a'])
    const fresh = queue.dedup(['/a', '/b'], 'generate')
    expect(fresh).toEqual(['/a'])
  })

  it('release clears routes from pending state', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'generate')
    queue.release(['/a', '/b'])
    expect(queue.status.pendingRoutes).toEqual([])
  })

  it('release in finally prevents stale state after rejection', async () => {
    const queue = new OperationQueue()
    const fresh = queue.dedup(['/x'], 'generate')
    try {
      await queue.enqueue('generate', async () => {
        throw new Error('fail')
      })
    } catch {
      // expected
    } finally {
      queue.release(fresh)
    }
    // Route should be available again
    const freshAgain = queue.dedup(['/x'], 'generate')
    expect(freshAgain).toEqual(['/x'])
  })

  it('status.pendingRoutes reflects current state with operation types', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a'], 'generate')
    queue.dedup(['/b'], 'invalidate')
    expect(queue.status.pendingRoutes).toEqual([
      { route: '/a', operation: 'generate' },
      { route: '/b', operation: 'invalidate' }
    ])
  })

  it('dedup does not affect queue depth or active operation', () => {
    const queue = new OperationQueue()
    queue.dedup(['/x'], 'generate')
    expect(queue.status.queued).toBe(0)
    expect(queue.status.activeOperation).toBeNull()
  })

  it('full lifecycle: dedup → enqueue → release → dedup again', async () => {
    const queue = new OperationQueue()

    // First operation
    const fresh1 = queue.dedup(['/a', '/b'], 'generate')
    expect(fresh1).toEqual(['/a', '/b'])

    const p = queue.enqueue('generate', async () => {
      await new Promise((r) => setTimeout(r, 10))
      return 'done-1'
    })

    // While first is running, second generate for overlapping route
    const fresh2 = queue.dedup(['/b', '/c'], 'generate')
    expect(fresh2).toEqual(['/c'])

    const p2 = queue.enqueue('generate', async () => 'done-2')

    await Promise.all([p, p2])

    queue.release(fresh1)
    queue.release(fresh2)

    // After release, /b should be available again
    const fresh3 = queue.dedup(['/a', '/b', '/c'], 'generate')
    expect(fresh3).toEqual(['/a', '/b', '/c'])
  })

  it('invalidate dedup against invalidate with partial overlap', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'invalidate')
    // Second invalidate for overlapping + new routes
    const fresh = queue.dedup(['/b', '/c'], 'invalidate')
    // /b is already pending via invalidate → deduped
    // /c is new → included
    expect(fresh).toEqual(['/c'])
  })

  it('generate dedup with mixed pending types', () => {
    const queue = new OperationQueue()
    // /a pending via generate, /b pending via invalidate, /c not pending
    queue.dedup(['/a'], 'generate')
    queue.dedup(['/b'], 'invalidate')
    const fresh = queue.dedup(['/a', '/b', '/c'], 'generate')
    // generate dedup against both generate and invalidate → /a and /b deduped
    expect(fresh).toEqual(['/c'])
  })

  it('invalidate does not dedup against generate with mixed routes', () => {
    const queue = new OperationQueue()
    // /a pending via generate, /b not pending
    queue.dedup(['/a'], 'generate')
    const fresh = queue.dedup(['/a', '/b'], 'invalidate')
    // invalidate does NOT dedup against generate → /a included
    // /b is new → included
    expect(fresh).toEqual(['/a', '/b'])
  })

  it('delete never dedupes even with all types pending', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a'], 'generate')
    queue.dedup(['/b'], 'invalidate')
    const fresh = queue.dedup(['/a', '/b'], 'delete')
    expect(fresh).toEqual(['/a', '/b'])
  })

  it('dedup does not register deduped routes in pending set', () => {
    const queue = new OperationQueue()
    queue.dedup(['/a', '/b'], 'generate')
    // /b is already pending, only /c should be added
    queue.dedup(['/b', '/c'], 'generate')
    const pending = queue.status.pendingRoutes.map((p) => p.route)
    expect(pending).toEqual(expect.arrayContaining(['/a', '/b', '/c']))
    expect(pending).toHaveLength(3)
  })

  it('concurrent generate and invalidate for the same route: invalidate is not deduped', () => {
    const queue = new OperationQueue()
    const freshGen = queue.dedup(['/foo'], 'generate')
    expect(freshGen).toEqual(['/foo'])

    // Invalidate for same route should NOT be deduped (content may have changed)
    const freshInv = queue.dedup(['/foo'], 'invalidate')
    expect(freshInv).toEqual(['/foo'])
  })
})
