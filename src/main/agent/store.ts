import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getPaths } from '../storage/store'
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
const connectionFile = (): string => path.join(agentRoot(), 'connection.json')
function readConnection(): StoredConnection | null { return readLocal(connectionFile(), null) }
function publicConnection(value: StoredConnection): AgentConnection {
  const { encrypted_key, ...config } = value
  return { ...config, has_key: !!encrypted_key }
}
export function getConnection(): AgentConnection | null {
  const value = readConnection()
  return value ? publicConnection(value) : null
}
export async function saveConnection(input: AgentConnectionInput): Promise<AgentConnection> {
  let url: URL
  try { url = new URL(input.base_url) } catch { throw new Error('模型地址必须是 http 或 https 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('模型地址不允许凭据、查询参数或非 HTTP 协议')
  if (!input.model?.trim()) throw new Error('请填写模型名称')
  if (input.protocol !== 'chat-completions' && input.protocol !== 'responses') throw new Error('不支持的模型协议')
  const previous = readConnection()
  let encrypted_key = previous?.encrypted_key ?? ''
  if (input.api_key !== undefined) {
    if (typeof input.api_key !== 'string') throw new Error('API Key 格式错误')
    if (input.api_key) {
      if (!(await safeStorage.isAsyncEncryptionAvailable()) || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('系统安全凭据存储不可用，未保存 Key')
      encrypted_key = (await safeStorage.encryptStringAsync(input.api_key)).toString('base64')
    } else encrypted_key = ''
  }
  const value: StoredConnection = { connection_id: previous?.connection_id ?? randomUUID(), name: input.name?.trim() || '模型连接', base_url: url.toString().replace(/\/$/, ''), model: input.model.trim(), protocol: input.protocol, encrypted_key, capability: 'unchecked' }
  writeLocal(connectionFile(), value)
  return publicConnection(value)
}
/** Main-process-only snapshot. Never expose this return value over IPC. */
export async function connectionSnapshot(): Promise<AgentConnection & { api_key: string }> {
  const value = readConnection()
  if (!value) throw new Error('请先配置模型连接')
  try {
    const api_key = value.encrypted_key ? (await safeStorage.decryptStringAsync(Buffer.from(value.encrypted_key, 'base64'))).result : ''
    return { ...publicConnection(value), api_key }
  } catch { throw new Error('无法解密模型 Key，请重新配置') }
}
export function recordCapability(snapshot: AgentConnection, capability: AgentConnection['capability']): void {
  const current = readConnection()
  if (current && current.connection_id === snapshot.connection_id && current.base_url === snapshot.base_url && current.model === snapshot.model && current.protocol === snapshot.protocol) {
    writeLocal(connectionFile(), { ...current, capability })
  }
}
