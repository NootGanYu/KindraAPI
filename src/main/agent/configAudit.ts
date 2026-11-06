import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Environment, GlobalVars } from '@shared/types'
import type { AgentConfigAudit, AgentConfigAuditAction, AgentConfigAuditKind } from '@shared/agentConfigAudit'
import { stableJson } from '@shared/targetSync'
import * as store from '../storage/store'
import { agentRoot, readLocal, writeLocal } from './store'

interface StoredConfigAudit extends AgentConfigAudit {
  /** safeStorage-encrypted JSON { before, after }; never plaintext. */
  encrypted_payload: string
}
export interface ConfigAuditInput {
  projectId: string
  turnId: string
  kind: AgentConfigAuditKind
  action: AgentConfigAuditAction
  entity_id: string
  key?: string
  masked: string
  before: Environment | GlobalVars | null
  after: Environment | GlobalVars | null
}
function dir(projectId: string): string {
  if (!/^[\w-]{1,80}$/.test(projectId) || !store.getProject(projectId)) throw new Error('项目不存在')
  return path.join(agentRoot(), 'projects', projectId, 'config-audits')
}
function file(projectId: string, auditId: string): string {
  if (!/^[\w-]{1,100}$/.test(auditId)) throw new Error('审计编号无效')
  return path.join(dir(projectId), `${auditId}.json`)
}
function publicAudit(value: StoredConfigAudit): AgentConfigAudit {
  const { encrypted_payload: _payload, ...audit } = value
  return audit
}
function signature(value: unknown): string {
  // updated_at is bookkeeping, not configuration content; excluding it lets
  // sequential audits of the same object be undone independently.
  if (value && typeof value === 'object') {
    const { updated_at: _updated, ...rest } = value as Record<string, unknown>
    return createHash('sha256').update(stableJson(rest)).digest('hex')
  }
  return createHash('sha256').update(stableJson(value ?? null)).digest('hex')
}
function current(kind: AgentConfigAuditKind, projectId: string, entityId: string): Environment | GlobalVars | null {
  return kind === 'environment'
    ? store.listEnvironments(projectId).find(item => item.env_id === entityId) ?? null
    : store.getGlobalVars(projectId)
}
async function encryptionAvailable(): Promise<boolean> {
  const available = await safeStorage.isAsyncEncryptionAvailable()
  if (!available) return false
  return !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
}
/** Fail closed before the config write so no unaudited change can land. */
export async function assertConfigAuditAvailable(): Promise<void> {
  if (!(await encryptionAvailable())) throw new Error('系统安全存储不可用，无法加密保存配置审计；配置未写入')
}
async function encrypt(value: unknown): Promise<string> {
  await assertConfigAuditAvailable()
  return (await safeStorage.encryptStringAsync(JSON.stringify(value))).toString('base64')
}
async function decrypt(payload: string): Promise<{ before: Environment | GlobalVars | null; after: Environment | GlobalVars | null }> {
  const result = await safeStorage.decryptStringAsync(Buffer.from(payload, 'base64'))
  return JSON.parse(result.result)
}
/** Metadata is readable locally; before/after snapshots are encrypted at rest. */
export async function recordConfigChange(input: ConfigAuditInput): Promise<AgentConfigAudit> {
  dir(input.projectId)
  const encrypted_payload = await encrypt({ before: input.before, after: input.after })
  const audit: StoredConfigAudit = {
    audit_id: randomUUID(),
    project_id: input.projectId,
    turn_id: input.turnId,
    kind: input.kind,
    action: input.action,
    entity_id: input.entity_id,
    ...(input.key ? { key: input.key } : {}),
    masked: input.masked,
    created_at: new Date().toISOString(),
    before_signature: input.before ? signature(input.before) : null,
    after_signature: input.after ? signature(input.after) : null,
    encrypted: true,
    encrypted_payload
  }
  writeLocal(file(input.projectId, audit.audit_id), audit)
  return publicAudit(audit)
}
export function listConfigAudits(projectId: string): AgentConfigAudit[] {
  const folder = dir(projectId)
  return fs.existsSync(folder)
    ? fs.readdirSync(folder).filter(name => name.endsWith('.json')).map(name => publicAudit(readLocal<StoredConfigAudit>(path.join(folder, name), null!))).sort((a, b) => b.created_at.localeCompare(a.created_at))
    : []
}
export async function undoConfigChange(projectId: string, auditId: string): Promise<AgentConfigAudit> {
  dir(projectId)
  const stored = readLocal<StoredConfigAudit | null>(file(projectId, auditId), null)
  if (!stored) throw new Error('配置审计不存在')
  if (stored.undo_status === 'undone' || stored.undone_at) throw new Error('该配置变更已撤销，不能重复撤销')
  await assertConfigAuditAvailable()
  const payload = await decrypt(stored.encrypted_payload)
  const now = current(stored.kind, projectId, stored.entity_id)
  const nowSignature = now ? signature(now) : null
  if (nowSignature !== stored.after_signature) throw new Error('配置在审计后已变化，撤销已暂停，请先审阅最新配置')
  if (stored.kind === 'global_vars') {
    if (!payload.before) throw new Error('配置审计缺少可恢复的全局变量快照')
    store.saveGlobalVars(projectId, structuredClone(payload.before as GlobalVars))
  } else if (payload.before) {
    store.saveEnvironment(projectId, structuredClone(payload.before as Environment))
  } else {
    store.deleteEnvironment(projectId, stored.entity_id)
  }
  const undone: StoredConfigAudit = { ...stored, undone_at: new Date().toISOString(), undo_status: 'undone' }
  writeLocal(file(projectId, auditId), undone)
  return publicAudit(undone)
}
export const configAuditCommands = { listConfigAudits, undoConfigChange }
