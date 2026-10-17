/**
 * Stage a JSON envelope beside its target and rename it into place, retrying a
 * rename that a held handle refused.
 *
 * Copied in spirit from the shipped dsh-diff-approval plugin: on Windows,
 * replacing a file another process has open answers EPERM, and the readers
 * here are many (the host itself, a backup agent, an editor) while the write
 * is the only copy of the update. A handful of short retries turns that
 * transient refusal into a normal write; anything that is not about a held
 * handle is rethrown at once so a real failure is reported immediately.
 *
 * @module dsh-shortcut/atomic-write
 */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** How hard a refused rename is tried, and how long to wait between attempts. */
const RETRY = { attempts: 5, delayMs: 25 } as const

/** Whether one rename error is the transient "somebody else has this file open" refusal. */
function isHeldOpen(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

/**
 * Write one JSON envelope atomically.
 * @param file - the file to replace.
 * @param value - the value to serialise into it.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const staged = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(staged, JSON.stringify(value), 'utf8')
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(staged, file)
      return
    } catch (error: unknown) {
      if (attempt >= RETRY.attempts || !isHeldOpen(error)) {
        await rm(staged, { force: true }).catch(() => {})
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, RETRY.delayMs * 2 ** (attempt - 1)))
    }
  }
}
