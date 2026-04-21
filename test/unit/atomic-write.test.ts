import { readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let _mockOpen: ((...args: unknown[]) => Promise<FileHandle>) | null = null
let _mockRename: ((oldPath: string, newPath: string) => Promise<void>) | null = null

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    get open() {
      return _mockOpen ?? actual.open
    },
    get rename() {
      return _mockRename ?? actual.rename
    }
  }
})

import { atomicWriteFile } from '../../src/runtime/nitro-preset/atomic-write'

describe('atomicWriteFile', () => {
  const tmpDir = join(__dirname, '.tmp-atomic')

  beforeEach(async () => {
    _mockOpen = null
    _mockRename = null
    try {
      await rm(tmpDir, { recursive: true, force: true })
    } catch {}
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    _mockOpen = null
    _mockRename = null
    try {
      await rm(tmpDir, { recursive: true, force: true })
    } catch {}
    vi.restoreAllMocks()
  })

  it('writes content to the target file', async () => {
    const filePath = join(tmpDir, 'test.html')
    await atomicWriteFile(filePath, '<h1>hello</h1>')

    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('<h1>hello</h1>')
  })

  it('reader sees old content during write, new content after completion', async () => {
    const filePath = join(tmpDir, 'page.html')

    // Pre-populate with old content
    await writeFile(filePath, 'version-1', 'utf-8')

    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    let resolveDelay: () => void
    const delayPromise = new Promise<void>((resolve) => {
      resolveDelay = resolve
    })

    _mockRename = async (oldPath: string, newPath: string) => {
      await delayPromise
      return actual.rename(oldPath, newPath)
    }

    // Start atomic write in the background
    const writePromise = atomicWriteFile(filePath, 'version-2', 'utf-8')

    // While the write is in progress (rename delayed), the target must still show old content
    const contentDuringWrite = await readFile(filePath, 'utf-8')
    expect(contentDuringWrite).toBe('version-1')

    // Complete the rename
    resolveDelay!()
    await writePromise

    // After completion, the target must show new content
    const contentAfterWrite = await readFile(filePath, 'utf-8')
    expect(contentAfterWrite).toBe('version-2')
  })

  it('target file intact when write fails', async () => {
    const filePath = join(tmpDir, 'page.html')

    // Pre-populate with original content
    await writeFile(filePath, 'original', 'utf-8')

    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    _mockOpen = async (...args: unknown[]) => {
      const handle = await (actual.open as (...a: unknown[]) => Promise<FileHandle>)(...args)
      vi.spyOn(handle, 'writeFile').mockRejectedValue(new Error('disk full'))
      return handle
    }

    await expect(atomicWriteFile(filePath, 'new-content', 'utf-8')).rejects.toThrow('disk full')

    // Target must still have original content
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('original')
  })

  it('target file intact when rename fails', async () => {
    const filePath = join(tmpDir, 'page.html')

    // Pre-populate with original content
    await writeFile(filePath, 'original', 'utf-8')

    _mockRename = async () => {
      throw new Error('rename failed')
    }

    await expect(atomicWriteFile(filePath, 'new-content', 'utf-8')).rejects.toThrow('rename failed')

    // Target must still have original content
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('original')
  })

  it('cleans up temp file on failure', async () => {
    const filePath = join(tmpDir, 'page.html')

    _mockRename = async () => {
      throw new Error('rename failed')
    }

    await expect(atomicWriteFile(filePath, 'content', 'utf-8')).rejects.toThrow('rename failed')

    // No .tmp-* files should remain in the directory
    const files = await readdir(tmpDir)
    const tmpFiles = files.filter((f) => f.includes('.tmp-'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('calls datasync before rename', async () => {
    const filePath = join(tmpDir, 'page.html')
    const callOrder: string[] = []

    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    _mockOpen = async (...args: unknown[]) => {
      const handle = await (actual.open as (...a: unknown[]) => Promise<FileHandle>)(...args)

      const origWriteFile = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile').mockImplementation(async (...a) => {
        callOrder.push('writeFile')
        return origWriteFile(...(a as [string, BufferEncoding]))
      })

      const origDatasync = handle.datasync.bind(handle)
      vi.spyOn(handle, 'datasync').mockImplementation(async () => {
        callOrder.push('datasync')
        return origDatasync()
      })

      const origClose = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        callOrder.push('close')
        return origClose()
      })

      return handle
    }

    _mockRename = async (oldPath: string, newPath: string) => {
      callOrder.push('rename')
      return actual.rename(oldPath, newPath)
    }

    await atomicWriteFile(filePath, 'content', 'utf-8')

    expect(callOrder).toEqual(['writeFile', 'datasync', 'close', 'rename'])
  })
})
