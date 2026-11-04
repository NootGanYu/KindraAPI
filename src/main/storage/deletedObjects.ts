import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DeletedObject } from '@shared/agentDeletion'

const listeners = new Set<(pid: string, kind: 'api' | 'flow', id: string) => void>()
export function onDeletedObject(listener: (pid: string, kind: 'api' | 'flow', id: string) => void): void { listeners.add(listener) }
export function publishDeletedObject(pid: string, kind: 'api' | 'flow', id: string): void {
  for (const listener of listeners) { try { listener(pid, kind, id) } catch { /* Committed deletion must not be reported as failed due to a closed view. */ } }
}
type Capture = (pid: string, kind: 'api' | 'flow', id: string) => DeletedObject['draft']
const captures = new Set<Capture>()
const activeCheckpoints = new Set<string>()
export function onCaptureDeletedDraft(capture: Capture): void { captures.add(capture) }
function root(localRoot: string, pid: string): string {
  if (!/^[\w-]{1,80}$/.test(pid)) throw new Error('项目编号无效')
  return path.join(localRoot, 'agent', 'projects', pid)
}
function read<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error('删除证据无法读取，操作已暂停')
  }
}
export function deletedObjects(localRoot: string, pid: string): DeletedObject[] {
  const dir = path.join(root(localRoot, pid), 'deleted-objects')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => read<DeletedObject>(path.join(dir, n), null!)).sort((a,b) => (b.sequence ?? 0) - (a.sequence ?? 0) || b.deleted_at.localeCompare(a.deleted_at)) : []
}
/** Fail closed before removing any definition. Immutable records remain outside the project Git tree. */
export function retainDeletedObject(localRoot: string, input: Omit<DeletedObject, 'deletion_id' | 'deleted_at' | 'draft' | 'sequence'>, checkpoint = false): string | undefined {
  const dir = root(localRoot, input.project_id)
  const prefix = input.kind === 'flow' ? 'flow-' : ''
  const candidatesDir = path.join(dir, `${prefix}candidates`)
  const hasCandidate = fs.existsSync(candidatesDir) && fs.readdirSync(candidatesDir).filter(n => n.endsWith('.json')).some(n => {
    const candidate = read<{ target_id?: string; flow_id?: string }>(path.join(candidatesDir, n), {})
    return (input.kind === 'flow' ? candidate.flow_id : candidate.target_id) === input.entity_id
  })
  let draft = read<DeletedObject['draft']>(path.join(dir, `${prefix}drafts`, `${input.entity_id}.json`), undefined)
  for (const capture of captures) draft = capture(input.project_id, input.kind, input.entity_id) ?? draft
  if (!hasCandidate && !draft?.agent_owned) return
  const record = { ...input, draft, sequence: Math.max(0, ...deletedObjects(localRoot, input.project_id).map(item => item.sequence ?? 0)) + 1, deletion_id: randomUUID(), deleted_at: new Date().toISOString() }
  const folder = path.join(dir, 'deleted-objects'); fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
  const destination = path.join(folder, `${record.deletion_id}.${checkpoint ? 'pending' : 'json'}`), temporary = `${destination}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 }); fs.renameSync(temporary, destination)
  if (checkpoint) activeCheckpoints.add(destination)
  return destination
}

/** Interrupted Git operations are reconciled on the next read; live operations keep their backup. */
export function settleDeletionCheckpoints(localRoot: string, pid: string, exists: (item: DeletedObject) => boolean, release: string[] = []): DeletedObject[] {
  for (const file of release) activeCheckpoints.delete(file)
  const dir = path.join(root(localRoot, pid), 'deleted-objects'), deleted: DeletedObject[] = []
  if (!fs.existsSync(dir)) return deleted
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.pending'))) {
    const file = path.join(dir, name)
    if (activeCheckpoints.has(file)) continue
    const record = read<DeletedObject>(file, null!)
    if (exists(record)) fs.rmSync(file, { force: true })
    else { fs.renameSync(file, file.replace(/\.pending$/, '.json')); deleted.push(record) }
  }
  return deleted
}
