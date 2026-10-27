import fs from 'node:fs'
import path from 'node:path'
import type {
  MqttAttempt,
  MqttConnectionProfile,
  MqttMessageRecord,
  MqttMessageSummary,
  MqttProfileSummary,
  MqttProfileVersion,
  MqttProfileVersionSummary,
  MqttPublishHistoryEntry,
  MqttRetention
} from '@shared/mqtt'
import {
  MQTT_ATTEMPT_INDEX_LIMIT,
  MQTT_ATTEMPT_SHARD_BYTES,
  MQTT_ATTEMPT_SHARD_LINES,
  MQTT_DEFAULT_RETENTION,
  MQTT_DEFAULT_SHARD_BYTES,
  MQTT_DEFAULT_SHARD_MESSAGES,
  MQTT_PREVIEW_BYTES,
  MQTT_PUBLISH_HISTORY_LIMIT,
  MQTT_VERSION_LIMIT,
  assertValidMqttProfile,
  toProfileSummary
} from '@shared/mqtt'
import { createId } from '@shared/factories'
import { getPaths } from '../storage/store'

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/

function assertId(id: string, label: string): string {
  if (!ID_RE.test(id)) throw new Error(`${label} 非法: ${id}`)
  return id
}

function profileRoot(projectId: string): string {
  return path.join(getPaths().projectRoot, assertId(projectId, 'project_id'), 'mqtt')
}

function localRoot(projectId: string): string {
  return path.join(getPaths().localRoot, 'projects', assertId(projectId, 'project_id'), 'mqtt')
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function dirExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function listJsonFiles(dir: string): string[] {
  if (!dirExists(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name))
}

// ---------------------------------------------------------------------------
// Connection Profile（项目数据，随项目 Git 管理）
// ---------------------------------------------------------------------------

function connectionsDir(projectId: string): string {
  return path.join(profileRoot(projectId), 'connections')
}

function profileFile(projectId: string, connectionId: string): string {
  return path.join(connectionsDir(projectId), `${assertId(connectionId, 'connection_id')}.json`)
}

function profileIndexPath(projectId: string): string {
  return path.join(profileRoot(projectId), 'index.json')
}

interface ProfileIndex {
  project_id: string
  items: MqttProfileSummary[]
}

function writeProfileIndex(projectId: string, items: MqttProfileSummary[]): void {
  const index: ProfileIndex = { project_id: projectId, items }
  writeJson(profileIndexPath(projectId), index)
}

export function listProfiles(projectId: string): MqttProfileSummary[] {
  // 以 connections 目录为准，避免索引缺失后读不到已有配置。
  const dir = connectionsDir(projectId)
  if (!dirExists(dir)) return []
  const items = listJsonFiles(dir)
    .map((file) => readJson<MqttConnectionProfile | null>(file, null))
    .filter((profile): profile is MqttConnectionProfile => Boolean(profile))
    .map(toProfileSummary)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
  const index = readJson<ProfileIndex | null>(profileIndexPath(projectId), null)
  if (!index || index.items.length !== items.length) writeProfileIndex(projectId, items)
  return items
}

export function getProfile(projectId: string, connectionId: string): MqttConnectionProfile | null {
  return readJson<MqttConnectionProfile | null>(profileFile(projectId, connectionId), null)
}

function requireProfile(projectId: string, connectionId: string): MqttConnectionProfile {
  const profile = getProfile(projectId, connectionId)
  if (!profile) throw new Error('Connection Profile 不存在')
  return profile
}

function createVersionSnapshot(projectId: string, profile: MqttConnectionProfile): void {
  const dir = path.join(profileRoot(projectId), 'versions', profile.connection_id)
  const indexPath = path.join(dir, 'index.json')
  const index = readJson<{ items: MqttProfileVersionSummary[] }>(indexPath, { items: [] })
  const versionId = createId('mv')
  const version: MqttProfileVersion = {
    version_id: versionId,
    connection_id: profile.connection_id,
    created_at: new Date().toISOString(),
    name: profile.name,
    snapshot: profile
  }
  writeJson(path.join(dir, `${versionId}.json`), version)
  index.items.unshift({
    version_id: versionId,
    connection_id: profile.connection_id,
    created_at: version.created_at,
    name: profile.name,
    host: profile.host,
    port: profile.port,
    protocol_version: profile.protocol_version,
    subscription_count: profile.subscriptions?.length ?? 0
  })
  const removed = index.items.splice(MQTT_VERSION_LIMIT)
  writeJson(indexPath, index)
  for (const item of removed) {
    fs.rmSync(path.join(dir, `${item.version_id}.json`), { force: true })
  }
}

export function createProfile(
  projectId: string,
  profile: MqttConnectionProfile
): MqttConnectionProfile {
  if (profile.project_id !== projectId) throw new Error('项目不匹配')
  if (getProfile(projectId, profile.connection_id)) throw new Error('Connection Profile 已存在')
  return saveProfile(projectId, profile)
}

export function saveProfile(
  projectId: string,
  profile: MqttConnectionProfile,
  snapshot = true
): MqttConnectionProfile {
  if (profile.project_id !== projectId) throw new Error('项目不匹配')
  assertValidMqttProfile(profile)
  const next: MqttConnectionProfile = {
    ...profile,
    connection_id: assertId(profile.connection_id, 'connection_id'),
    updated_at: new Date().toISOString()
  }
  writeJson(profileFile(projectId, next.connection_id), next)
  writeProfileIndex(projectId, listProfiles(projectId))
  if (snapshot) createVersionSnapshot(projectId, next)
  return next
}

export function deleteProfile(projectId: string, connectionId: string): void {
  const profile = requireProfile(projectId, connectionId)
  fs.rmSync(profileFile(projectId, connectionId), { force: true })
  fs.rmSync(path.join(profileRoot(projectId), 'versions', connectionId), {
    recursive: true,
    force: true
  })
  fs.rmSync(path.join(localRoot(projectId), 'messages', connectionId), {
    recursive: true,
    force: true
  })
  removeAttemptLogs(projectId, connectionId)
  writeProfileIndex(
    projectId,
    listProfiles(projectId).filter((item) => item.connection_id !== profile.connection_id)
  )
}

export function cloneProfile(
  projectId: string,
  connectionId: string
): MqttConnectionProfile {
  const source = requireProfile(projectId, connectionId)
  const now = new Date().toISOString()
  const clone: MqttConnectionProfile = JSON.parse(JSON.stringify(source))
  clone.connection_id = createId('mc')
  clone.name = `${source.name} 副本`
  clone.created_at = now
  clone.updated_at = now
  return saveProfile(projectId, clone)
}

// ---------------------------------------------------------------------------
// Profile Version
// ---------------------------------------------------------------------------

export function listProfileVersions(
  projectId: string,
  connectionId: string
): MqttProfileVersionSummary[] {
  const dir = path.join(profileRoot(projectId), 'versions', assertId(connectionId, 'connection_id'))
  const index = readJson<{ items: MqttProfileVersionSummary[] }>(
    path.join(dir, 'index.json'),
    { items: [] }
  )
  return index.items
}

export function getProfileVersion(
  projectId: string,
  connectionId: string,
  versionId: string
): MqttProfileVersion | null {
  const dir = path.join(profileRoot(projectId), 'versions', assertId(connectionId, 'connection_id'))
  return readJson<MqttProfileVersion | null>(
    path.join(dir, `${assertId(versionId, 'version_id')}.json`),
    null
  )
}

export function restoreProfileVersion(
  projectId: string,
  connectionId: string,
  versionId: string
): MqttConnectionProfile {
  const version = getProfileVersion(projectId, connectionId, versionId)
  if (!version) throw new Error('版本不存在')
  const snapshot: MqttConnectionProfile = {
    ...JSON.parse(JSON.stringify(version.snapshot)),
    connection_id: connectionId,
    project_id: projectId
  }
  // saveProfile 会为恢复后的内容生成一个新版本，不覆盖历史。
  return saveProfile(projectId, snapshot)
}

// ---------------------------------------------------------------------------
// Connection Attempt（本地数据，不进入项目 Git）
// ---------------------------------------------------------------------------

function attemptsDir(projectId: string): string {
  return path.join(localRoot(projectId), 'attempts')
}

function attemptIndexPath(projectId: string): string {
  return path.join(attemptsDir(projectId), 'index.json')
}

function attemptLogPath(projectId: string, connectionId: string): string {
  return path.join(attemptsDir(projectId), `${assertId(connectionId, 'connection_id')}.jsonl`)
}

interface AttemptIndex {
  items: MqttAttempt[]
}

function readAttemptIndex(projectId: string): AttemptIndex {
  return readJson<AttemptIndex>(attemptIndexPath(projectId), { items: [] })
}

function writeAttemptIndex(projectId: string, index: AttemptIndex): void {
  writeJson(attemptIndexPath(projectId), index)
}

function countLines(file: string): number {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

function rotateAttemptLog(projectId: string, connectionId: string): void {
  const active = attemptLogPath(projectId, connectionId)
  if (!fileExists(active)) return
  const rotated = path.join(
    attemptsDir(projectId),
    `${connectionId}.${Date.now()}.jsonl`
  )
  fs.renameSync(active, rotated)
  // 最多保留 5 个历史分片。
  const shards = fs
    .readdirSync(attemptsDir(projectId))
    .filter((name) => name.startsWith(`${connectionId}.`) && name.endsWith('.jsonl'))
    .sort()
  for (const name of shards.slice(0, Math.max(0, shards.length - 5))) {
    fs.rmSync(path.join(attemptsDir(projectId), name), { force: true })
  }
}

export function appendAttempt(projectId: string, attempt: MqttAttempt): MqttAttempt {
  const dir = attemptsDir(projectId)
  fs.mkdirSync(dir, { recursive: true })
  const active = attemptLogPath(projectId, attempt.connection_id)
  if (fileExists(active)) {
    const size = fs.statSync(active).size
    if (size >= MQTT_ATTEMPT_SHARD_BYTES || countLines(active) >= MQTT_ATTEMPT_SHARD_LINES) {
      rotateAttemptLog(projectId, attempt.connection_id)
    }
  }
  fs.appendFileSync(active, `${JSON.stringify(attempt)}\n`, 'utf8')
  const index = readAttemptIndex(projectId)
  index.items = [attempt, ...index.items].slice(0, MQTT_ATTEMPT_INDEX_LIMIT)
  writeAttemptIndex(projectId, index)
  return attempt
}

export function listAttempts(
  projectId: string,
  connectionId?: string,
  limit = MQTT_ATTEMPT_INDEX_LIMIT
): MqttAttempt[] {
  const items = readAttemptIndex(projectId).items
  const filtered = connectionId
    ? items.filter((item) => item.connection_id === connectionId)
    : items
  return filtered.slice(0, Math.max(1, limit))
}

function removeAttemptLogs(projectId: string, connectionId: string): void {
  const dir = attemptsDir(projectId)
  if (!dirExists(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (name === `${connectionId}.jsonl` || name.startsWith(`${connectionId}.`)) {
      fs.rmSync(path.join(dir, name), { force: true })
    }
  }
  const index = readAttemptIndex(projectId)
  index.items = index.items.filter((item) => item.connection_id !== connectionId)
  writeAttemptIndex(projectId, index)
}

export function clearAttempts(projectId: string, connectionId?: string): void {
  if (connectionId) {
    removeAttemptLogs(projectId, connectionId)
    return
  }
  fs.rmSync(attemptsDir(projectId), { recursive: true, force: true })
}

export function readAttemptLogs(projectId: string, connectionId?: string): MqttAttempt[] {
  const dir = attemptsDir(projectId)
  if (!dirExists(dir)) return []
  const prefix = connectionId ? `${connectionId}.` : ''
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl') && name.startsWith(prefix))
    .sort()
  const items: MqttAttempt[] = []
  for (const name of files) {
    const text = readJsonlText(path.join(dir, name))
    for (const record of text) items.push(record as MqttAttempt)
  }
  return items
}

function readJsonlText(file: string): unknown[] {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n')
  const out: unknown[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      // 崩溃可能留下最后一行半截记录，跳过即可。
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Message（本地数据）
// ---------------------------------------------------------------------------

interface MessageShard {
  shard_id: string
  file: string
  from_seq: number
  to_seq: number
  count: number
  bytes: number
  from_at: string
  to_at: string
}

interface MessageIndex {
  connection_id: string
  next_seq: number
  total_count: number
  total_bytes: number
  shards: MessageShard[]
}

function messagesDir(projectId: string, connectionId: string): string {
  return path.join(
    localRoot(projectId),
    'messages',
    assertId(connectionId, 'connection_id')
  )
}

function messageIndexPath(projectId: string, connectionId: string): string {
  return path.join(messagesDir(projectId, connectionId), 'index.json')
}

function readMessageIndex(projectId: string, connectionId: string): MessageIndex {
  return readJson<MessageIndex>(messageIndexPath(projectId, connectionId), {
    connection_id: connectionId,
    next_seq: 1,
    total_count: 0,
    total_bytes: 0,
    shards: []
  })
}

function writeMessageIndex(projectId: string, connectionId: string, index: MessageIndex): void {
  writeJson(messageIndexPath(projectId, connectionId), index)
}

export function nextMessageSeq(projectId: string, connectionId: string): number {
  return readMessageIndex(projectId, connectionId).next_seq
}

export function appendMessage(
  projectId: string,
  record: MqttMessageRecord,
  retention?: MqttRetention
): MqttMessageRecord {
  const dir = messagesDir(projectId, record.connection_id)
  fs.mkdirSync(dir, { recursive: true })
  const index = readMessageIndex(projectId, record.connection_id)
  index.next_seq = Math.max(index.next_seq, record.seq + 1)

  const line = `${JSON.stringify(record)}\n`
  const lineBytes = Buffer.byteLength(line, 'utf8')
  let shard = index.shards[index.shards.length - 1]
  const shardFull =
    shard &&
    (shard.count >= MQTT_DEFAULT_SHARD_MESSAGES || shard.bytes >= MQTT_DEFAULT_SHARD_BYTES)
  if (!shard || shardFull) {
    const shardId = `shard-${index.shards.length + 1}`
    shard = {
      shard_id: shardId,
      file: `${shardId}.jsonl`,
      from_seq: record.seq,
      to_seq: record.seq,
      count: 0,
      bytes: 0,
      from_at: record.received_at,
      to_at: record.received_at
    }
    index.shards.push(shard)
  }
  fs.appendFileSync(path.join(dir, shard.file), line, 'utf8')
  shard.count += 1
  shard.bytes += lineBytes
  shard.to_seq = record.seq
  shard.to_at = record.received_at
  index.total_count += 1
  index.total_bytes += lineBytes

  applyRetention(projectId, record.connection_id, index, retention)
  writeMessageIndex(projectId, record.connection_id, index)
  return record
}

function applyRetention(
  projectId: string,
  connectionId: string,
  index: MessageIndex,
  retention?: MqttRetention
): void {
  const maxMessages = retention?.max_messages ?? MQTT_DEFAULT_RETENTION.max_messages
  const maxBytes = retention?.max_bytes ?? MQTT_DEFAULT_RETENTION.max_bytes
  const maxAgeDays = retention?.max_age_days ?? MQTT_DEFAULT_RETENTION.max_age_days
  const dir = messagesDir(projectId, connectionId)
  const cutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 : null

  while (index.shards.length > 1) {
    const oldest = index.shards[0]
    const tooMany = index.total_count > maxMessages
    const tooLarge = index.total_bytes > maxBytes
    const tooOld = cutoff !== null && new Date(oldest.to_at).getTime() < cutoff
    if (!tooMany && !tooLarge && !tooOld) break
    index.shards.shift()
    index.total_count -= oldest.count
    index.total_bytes -= oldest.bytes
    fs.rmSync(path.join(dir, oldest.file), { force: true })
  }
}

export interface ListMessagesOptions {
  limit?: number
  topic?: string
  search?: string
  afterSeq?: number
}

export function listMessages(
  projectId: string,
  connectionId: string,
  options: ListMessagesOptions = {}
): MqttMessageSummary[] {
  const index = readMessageIndex(projectId, connectionId)
  if (index.shards.length === 0) return []
  const limit = Math.max(1, Math.min(options.limit ?? 200, 5000))
  const topic = options.topic?.trim() ?? ''
  const search = options.search?.trim() ?? ''
  const out: MqttMessageRecord[] = []
  const dir = messagesDir(projectId, connectionId)
  for (let i = index.shards.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const shard = index.shards[i]
    if (options.afterSeq !== undefined && shard.to_seq <= options.afterSeq) continue
    const records = readJsonlText(path.join(dir, shard.file)) as MqttMessageRecord[]
    for (let j = records.length - 1; j >= 0 && out.length < limit; j -= 1) {
      const record = records[j]
      if (options.afterSeq !== undefined && record.seq <= options.afterSeq) continue
      if (topic && !record.topic.includes(topic)) continue
      if (search) {
        const haystack = `${record.topic}\n${record.payload}`
        if (!haystack.includes(search)) continue
      }
      out.push(record)
    }
  }
  return out.reverse().map(toMessageSummary)
}

/** 按 seq 升序返回 cursor 之后的最早 limit 条消息（MCP 游标拉取）。 */
export function listMessagesAfter(
  projectId: string,
  connectionId: string,
  afterSeq: number,
  limit: number
): MqttMessageSummary[] {
  const index = readMessageIndex(projectId, connectionId)
  const dir = messagesDir(projectId, connectionId)
  const out: MqttMessageRecord[] = []
  for (const shard of index.shards) {
    if (out.length >= limit) break
    if (shard.to_seq <= afterSeq) continue
    const records = readJsonlText(path.join(dir, shard.file)) as MqttMessageRecord[]
    for (const record of records) {
      if (record.seq <= afterSeq) continue
      out.push(record)
      if (out.length >= limit) break
    }
  }
  return out.map(toMessageSummary)
}

export function getMessage(
  projectId: string,
  connectionId: string,
  seq: number
): MqttMessageRecord | null {
  const index = readMessageIndex(projectId, connectionId)
  const shard = index.shards.find((item) => item.from_seq <= seq && item.to_seq >= seq)
  if (!shard) return null
  const records = readJsonlText(
    path.join(messagesDir(projectId, connectionId), shard.file)
  ) as MqttMessageRecord[]
  return records.find((record) => record.seq === seq) ?? null
}

export function clearMessages(projectId: string, connectionId?: string): void {
  if (connectionId) {
    fs.rmSync(messagesDir(projectId, connectionId), { recursive: true, force: true })
    return
  }
  fs.rmSync(path.join(localRoot(projectId), 'messages'), { recursive: true, force: true })
}

export function readAllMessages(
  projectId: string,
  connectionIds?: string[]
): MqttMessageRecord[] {
  const root = path.join(localRoot(projectId), 'messages')
  if (!dirExists(root)) return []
  const ids = connectionIds?.length
    ? connectionIds
    : fs.readdirSync(root).filter((name) => dirExists(path.join(root, name)))
  const out: MqttMessageRecord[] = []
  for (const connectionId of ids) {
    const index = readMessageIndex(projectId, connectionId)
    for (const shard of index.shards) {
      const records = readJsonlText(
        path.join(messagesDir(projectId, connectionId), shard.file)
      ) as MqttMessageRecord[]
      out.push(...records)
    }
  }
  return out.sort((a, b) => a.seq - b.seq)
}

export function messageStats(
  projectId: string,
  connectionId: string
): { count: number; bytes: number; shards: number } {
  const index = readMessageIndex(projectId, connectionId)
  return {
    count: index.total_count,
    bytes: index.total_bytes,
    shards: index.shards.length
  }
}

export function toMessageSummary(record: MqttMessageRecord): MqttMessageSummary {
  return {
    seq: record.seq,
    connection_id: record.connection_id,
    session_id: record.session_id,
    direction: record.direction,
    topic: record.topic,
    payload_encoding: record.payload_encoding,
    preview: record.payload.slice(0, MQTT_PREVIEW_BYTES),
    payload_bytes: record.payload_bytes,
    qos: record.qos,
    retain: record.retain,
    received_at: record.received_at,
    truncated: record.truncated
  }
}

// ---------------------------------------------------------------------------
// Publish history
// ---------------------------------------------------------------------------

function publishHistoryPath(projectId: string): string {
  return path.join(localRoot(projectId), 'publish-history.json')
}

export function listPublishHistory(projectId: string): MqttPublishHistoryEntry[] {
  return readJson<MqttPublishHistoryEntry[]>(publishHistoryPath(projectId), [])
}

export function addPublishHistory(
  projectId: string,
  entry: MqttPublishHistoryEntry
): MqttPublishHistoryEntry[] {
  const items = [entry, ...listPublishHistory(projectId)].slice(
    0,
    MQTT_PUBLISH_HISTORY_LIMIT
  )
  writeJson(publishHistoryPath(projectId), items)
  return items
}

export function clearPublishHistory(projectId: string): void {
  fs.rmSync(publishHistoryPath(projectId), { force: true })
}
