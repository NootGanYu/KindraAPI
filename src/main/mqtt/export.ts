import fs from 'node:fs'
import path from 'node:path'
import type {
  MqttAttempt,
  MqttConnectionProfile,
  MqttExportResult,
  MqttMessageExportOptions,
  MqttMessageRecord,
  MqttProfileExportOptions
} from '@shared/mqtt'
import * as mqttStore from './store'

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'mqtt'
}

function readText(file: string, label: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    throw new Error(`${label}不可读：${file}`)
  }
}

function withEmbeddedPem(profile: MqttConnectionProfile): MqttConnectionProfile {
  const tls = profile.tls
  if (!tls) return profile
  const inline = { ...(tls.inline ?? {}) }
  if (!inline.ca && tls.ca_path) inline.ca = readText(tls.ca_path, 'CA 证书')
  if (!inline.cert && tls.cert_path) inline.cert = readText(tls.cert_path, '客户端证书')
  if (!inline.key && tls.key_path) inline.key = readText(tls.key_path, '客户端私钥')
  return { ...profile, tls: { ...tls, inline } }
}

export interface ExportPayload {
  content: string
  defaultName: string
  count: number
}

export function buildProfileExport(
  projectId: string,
  options: MqttProfileExportOptions = {}
): ExportPayload {
  const ids = options.connection_ids?.length
    ? options.connection_ids
    : mqttStore.listProfiles(projectId).map((item) => item.connection_id)
  const profiles = ids
    .map((id) => mqttStore.getProfile(projectId, id))
    .filter((profile): profile is MqttConnectionProfile => Boolean(profile))
    .map((profile) => (options.embed_pem ? withEmbeddedPem(profile) : profile))
  const payload = {
    app: 'KindraAPI',
    kind: 'mqtt-connection-profile',
    exported_at: new Date().toISOString(),
    /** 该文件包含明文凭据（ADR-0004）。 */
    contains_plaintext_credentials: true,
    profiles
  }
  const name = profiles[0]?.name ? `${safeName(profiles[0].name)}-` : ''
  return {
    content: JSON.stringify(payload, null, 2),
    defaultName: `kindraapi-mqtt-${name}${stamp()}.json`,
    count: profiles.length
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildMessageExport(
  projectId: string,
  options: MqttMessageExportOptions
): ExportPayload {
  const ids = options.connection_ids?.length ? options.connection_ids : undefined
  const records: MqttMessageRecord[] = mqttStore.readAllMessages(projectId, ids)
  let content: string
  if (options.format === 'csv') {
    const header = [
      'seq',
      'connection_id',
      'session_id',
      'direction',
      'topic',
      'payload',
      'payload_encoding',
      'payload_bytes',
      'qos',
      'retain',
      'received_at'
    ]
    const lines = [header.join(',')]
    for (const record of records) {
      lines.push(
        [
          record.seq,
          record.connection_id,
          record.session_id,
          record.direction,
          record.topic,
          record.payload,
          record.payload_encoding,
          record.payload_bytes,
          record.qos,
          record.retain,
          record.received_at
        ]
          .map(csvCell)
          .join(',')
      )
    }
    content = `${lines.join('\n')}\n`
  } else {
    content = records.map((record) => JSON.stringify(record)).join('\n')
    if (content) content += '\n'
  }
  const ext = options.format === 'csv' ? 'csv' : 'jsonl'
  const firstName = ids?.[0] ? mqttStore.getProfile(projectId, ids[0])?.name : undefined
  const prefix = firstName ? `${safeName(firstName)}-` : ''
  return {
    content,
    defaultName: `kindraapi-mqtt-messages-${prefix}${stamp()}.${ext}`,
    count: records.length
  }
}

export function buildAttemptExport(
  projectId: string,
  connectionId?: string
): ExportPayload {
  const attempts: MqttAttempt[] = mqttStore.readAttemptLogs(projectId, connectionId)
  const content = attempts.map((attempt) => JSON.stringify(attempt)).join('\n')
  const name = connectionId
    ? mqttStore.getProfile(projectId, connectionId)?.name
    : undefined
  const prefix = name ? `${safeName(name)}-` : ''
  return {
    content: content ? `${content}\n` : '',
    defaultName: `kindraapi-mqtt-attempts-${prefix}${stamp()}.jsonl`,
    count: attempts.length
  }
}

export function writeTextAtomic(file: string, content: string): number {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, file)
    return Buffer.byteLength(content, 'utf8')
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

export function resultForWrite(
  filePath: string,
  payload: ExportPayload
): MqttExportResult {
  const bytes = writeTextAtomic(filePath, payload.content)
  return { canceled: false, path: filePath, bytes, count: payload.count }
}
