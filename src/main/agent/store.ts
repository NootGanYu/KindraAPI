import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getPaths, getProject } from '../storage/store'
import type { AgentConnection, AgentConnectionInput } from '@shared/agent'

type StoredConnection = Omit<AgentConnection, 'has_key'> & { encrypted_key: string }
export function agentRoot(): string { return path.join(getPaths().localRoot, 'agent') }
export function readLocal<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('Agent 本机记录无法读取') }
}
export function writeLocal(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
}
interface ConnectionSettings {
  connections: StoredConnection[]
  project_defaults: Record<string, string | null>
  /** Compatibility for the original single-connection configuration. */
  legacy_default?: string
}
const connectionFile = (): string => path.join(agentRoot(), 'connections.json')
function readSettings(): ConnectionSettings {
  const settings = readLocal<ConnectionSettings | null>(connectionFile(), null)
  if (settings) return settings
  const legacyFile = path.join(agentRoot(), 'connection.json')
  const legacy = readLocal<StoredConnection | null>(legacyFile, null)
  const migrated: ConnectionSettings = { connections: legacy ? [{ ...legacy, revision: legacy.revision || randomUUID() }] : [], project_defaults: {}, ...(legacy ? { legacy_default: legacy.connection_id } : {}) }
  if (legacy) { writeLocal(connectionFile(), migrated); fs.unlinkSync(legacyFile) }
  return migrated
}
function publicConnection(value: StoredConnection): AgentConnection {
  const { encrypted_key, ...config } = value
  return { ...config, has_key: !!encrypted_key }
}
function requireProject(projectId: string): void {
  if (!/^[\w-]{1,80}$/.test(projectId) || !getProject(projectId)) throw new Error('项目不存在')
}
function selectedId(settings: ConnectionSettings, connectionId?: string, projectId?: string): string | null | undefined {
  if (projectId !== undefined) requireProject(projectId)
  if (connectionId !== undefined) return connectionId
  if (projectId !== undefined && Object.hasOwn(settings.project_defaults, projectId)) return settings.project_defaults[projectId]
  return settings.legacy_default
}
export function listConnections(): AgentConnection[] { return readSettings().connections.map(publicConnection) }
export function getConnection(connectionId?: string): AgentConnection | null {
  const settings = readSettings()
  const value = settings.connections.find(item => item.connection_id === selectedId(settings, connectionId))
  return value ? publicConnection(value) : null
}
export function getProjectConnection(projectId: string): AgentConnection | null {
  const settings = readSettings()
  const id = selectedId(settings, undefined, projectId)
  const value = settings.connections.find(item => item.connection_id === id)
  return value ? publicConnection(value) : null
}
export function setProjectConnection(projectId: string, connectionId: string | null): AgentConnection | null {
  requireProject(projectId)
  const settings = readSettings()
  if (connectionId !== null && !settings.connections.some(item => item.connection_id === connectionId)) throw new Error('连接不存在')
  settings.project_defaults[projectId] = connectionId
  writeLocal(connectionFile(), settings)
  return getProjectConnection(projectId)
}
async function writeConnection(input: AgentConnectionInput, connectionId: string | undefined, legacy: boolean): Promise<AgentConnection> {
  let url: URL
  try { url = new URL(input.base_url) } catch { throw new Error('模型地址必须是 http 或 https 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('模型地址不允许凭据、查询参数或非 HTTP 协议')
  if (!input.model?.trim()) throw new Error('请填写模型名称')
  if (input.protocol !== 'chat-completions') throw new Error('不支持的模型协议')
  const previous = connectionId ? readSettings().connections.find(item => item.connection_id === connectionId) : undefined
  if (connectionId && !previous) throw new Error('连接不存在')
  let encrypted_key = previous?.encrypted_key ?? ''
  if (input.api_key !== undefined) {
    if (typeof input.api_key !== 'string') throw new Error('API Key 格式错误')
    if (input.api_key) {
      if (!(await safeStorage.isAsyncEncryptionAvailable()) || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('系统安全凭据存储不可用，未保存 Key')
      encrypted_key = (await safeStorage.encryptStringAsync(input.api_key)).toString('base64')
    } else encrypted_key = ''
  }
  // Encryption yields to other commands. Preserve unrelated writes and reject stale edits/deletions.
  const settings = readSettings()
  if (previous && settings.connections.find(item => item.connection_id === previous.connection_id)?.revision !== previous.revision) throw new Error('连接已被修改或删除，请重新读取后保存')
  const value: StoredConnection = { connection_id: previous?.connection_id ?? randomUUID(), revision: randomUUID(), name: input.name?.trim() || '模型连接', base_url: url.toString().replace(/\/$/, ''), model: input.model.trim(), protocol: input.protocol, encrypted_key, capability: 'unchecked' }
  settings.connections = [...settings.connections.filter(item => item.connection_id !== value.connection_id), value]
  if (legacy) settings.legacy_default = value.connection_id
  writeLocal(connectionFile(), settings)
  return publicConnection(value)
}
export function createConnection(input: AgentConnectionInput): Promise<AgentConnection> { return writeConnection(input, undefined, false) }
/** Optional ID keeps the original single-connection command compatible. New callers select an ID explicitly. */
export function saveConnection(input: AgentConnectionInput, connectionId?: string): Promise<AgentConnection> {
  return writeConnection(input, connectionId ?? readSettings().legacy_default, connectionId === undefined)
}
export function deleteConnection(connectionId: string): boolean {
  const settings = readSettings()
  if (!settings.connections.some(item => item.connection_id === connectionId)) throw new Error('连接不存在')
  settings.connections = settings.connections.filter(item => item.connection_id !== connectionId)
  // Retain missing defaults so deletion cannot silently redirect future messages.
  writeLocal(connectionFile(), settings)
  return true
}
/** Main-process-only snapshot. Never expose this return value over IPC. */
export async function connectionSnapshot(connectionId?: string, projectId?: string): Promise<AgentConnection & { api_key: string }> {
  const settings = readSettings()
  const id = selectedId(settings, connectionId, projectId)
  const value = settings.connections.find(item => item.connection_id === id)
  if (!value) throw new Error('请先配置并选择有效模型连接；原连接可能已删除')
  try {
    const api_key = value.encrypted_key ? (await safeStorage.decryptStringAsync(Buffer.from(value.encrypted_key, 'base64'))).result : ''
    return { ...publicConnection(value), api_key }
  } catch { throw new Error('无法解密模型 Key，请重新配置') }
}
export function recordCapability(snapshot: AgentConnection, capability: AgentConnection['capability']): void {
  const settings = readSettings()
  const current = settings.connections.find(item => item.connection_id === snapshot.connection_id)
  if (current?.revision === snapshot.revision) {
    current.capability = capability
    writeLocal(connectionFile(), settings)
  }
}
