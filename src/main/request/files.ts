import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { BodyModel, FlowFileDependency } from '@shared/types'

export class FlowFileChangedError extends Error {
  constructor(file: string) {
    super(`外部文件已变更或不可读取，需审查并采用文件快照后继续：${file}`)
  }
}

const digest = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex')

export function captureFileDependencies(body: BodyModel | undefined): FlowFileDependency[] {
  const paths = body?.mode === 'binary' ? [body.binary?.file_path ?? '']
    : body?.mode === 'formdata' ? (body.formdata ?? body.parameter ?? [])
      .filter(item => item.field_type === 'file' && item.key && (item.is_checked > 0 || (item.is_system ?? -1) > 0))
      .map(item => item.value) : []
  return [...new Set(paths)].map(file => {
    const filePath = path.resolve(file)
    try { return { path: filePath, sha256: digest(fs.readFileSync(filePath)) } }
    catch { return { path: filePath, sha256: null } }
  })
}

/** Validate and retain the exact bytes used by this request, avoiding a hash/read race. */
export function verifiedFileResolver(files: FlowFileDependency[]) {
  const contents = new Map<string, Buffer>()
  for (const file of files) {
    let bytes: Buffer
    try { bytes = fs.readFileSync(file.path) } catch { throw new FlowFileChangedError(file.path) }
    if (digest(bytes) !== file.sha256) throw new FlowFileChangedError(file.path)
    contents.set(file.path, bytes)
  }
  let failure: FlowFileChangedError | undefined
  const read = (file: string): Buffer => {
    const bytes = contents.get(path.resolve(file))
    if (!bytes) {
      failure = new FlowFileChangedError(file)
      throw failure
    }
    return bytes
  }
  return {
    check: (): void => { if (failure) throw failure },
    stat: (file: string, callback: (error: Error | null, stats?: unknown) => void): void => {
      try { const bytes = read(file); callback(null, { size: bytes.length, mode: 0o400, isFile: () => true }) }
      catch (error) { callback(error as Error) }
    },
    createReadStream: (file: string): Readable => Object.assign(Readable.from(read(file)), { path: file }),
    readFile: (file: string, callback: (error: Error | null, bytes?: Buffer) => void): void => {
      try { callback(null, read(file)) } catch (error) { callback(error as Error) }
    }
  }
}
