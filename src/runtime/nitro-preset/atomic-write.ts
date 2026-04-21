import { randomBytes } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'

export async function atomicWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8'
): Promise<void> {
  const dir = dirname(filePath)
  const base = basename(filePath)
  const tmpPath = join(dir, `.tmp-${randomBytes(4).toString('hex')}-${base}`)

  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(tmpPath, 'w')
    await handle.writeFile(content, encoding)
    await handle.datasync()
    await handle.close()
    handle = null
    await rename(tmpPath, filePath)
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {})
    }
    await unlink(tmpPath).catch(() => {})
    throw error
  }
}
