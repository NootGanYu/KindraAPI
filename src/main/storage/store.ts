import { redactEvidence } from '../flow/evidence'
import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeFlowEvents } from '../flow/definition'
import { apiStatuses, defaultApiStatus } from '@shared/apiStatuses'
import type {
  AppPaths,
  ApiStatus,
  AppSettings,
  DataModel,
  DbConnection,
  DebugConfig,
  DebugState,
  DictionaryEntry,
  DictionaryEntryView,
  DictionarySettings,
  DocScope,
  DocServiceConfig,
  DocSettings,
  CaseRunResult,
  CustomAttribute,
  DocShare,
  DocShareInput,
  DocShareSummary,
  DocSnapshot,
  DocTargetSnapshot,
  Environment,
  Flow,
  FlowEventResult,
  FlowRun,
  FlowRunSummary,
  GlobalVars,
  McpConfig,
  ModelReference,
  ModelSchema,
  ModelSummary,
  ModelType,
  Project,
  RequestModel,
  SendRecord,
  SendRecordSummary,
  CookieJar,
  Target,
  TargetSummary,
  TargetVersion,
  TargetVersionSummary
} from '@shared/types'
import {
  createDataModel,
  createDictionaryEntry,
  createDocSettings,
  createEnvironment,
  createId,
  createProject,
  createRequest,
  createTarget
} from '@shared/factories'
import { CUSTOM_ATTRIBUTE_TYPES } from '@shared/customAttributes'
import { BUILTIN_DICTIONARY } from '@shared/dictionary'
import { DICT_FIELD_TYPES } from '@shared/types'
import {
  preserveCaseRuns,
  stableJson,
  targetDefinition,
  type TargetSaveOutcome,
  type TargetSnapshot
} from '@shared/targetSync'
import { recordModelChange, recordTargetChange } from './changes'

const DEFAULT_SETTINGS: AppSettings = {
  send_timeout: 60000,
  auto_redirect: 1,
  max_redirect_time: 10,
  follow_original_method: 1,
  ignore_tls: 1
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/

function assertId(id: string, label: string): string {
  if (!ID_RE.test(id)) throw new Error(`${label} 非法: ${id}`)
  return id
}

export function getPaths(): AppPaths {
  const userData = app.getPath('userData')
  return {
    userData,
    projectRoot: path.join(userData, 'offline-data'),
    localRoot: path.join(userData, 'offline-data-local')
  }
}

function projectDir(projectId: string): string {
  return path.join(getPaths().projectRoot, assertId(projectId, 'project_id'))
}

/** 对外暴露项目目录（Git 模块需要，仍经过 project_id 合法性校验）。 */
export function resolveProjectDir(projectId: string): string {
  return projectDir(projectId)
}

function localProjectDir(projectId: string): string {
  return path.join(getPaths().localRoot, 'projects', assertId(projectId, 'project_id'))
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

function ensureDirs(): void {
  const p = getPaths()
  fs.mkdirSync(p.projectRoot, { recursive: true })
  fs.mkdirSync(path.join(p.localRoot, 'settings'), { recursive: true })
  fs.mkdirSync(path.join(p.localRoot, 'projects'), { recursive: true })
}

interface RegistryEntry {
  project_id: string
  path: string
  created_at: string
}

function registryPath(): string {
  return path.join(getPaths().userData, 'offline-projects.json')
}

function readRegistry(): RegistryEntry[] {
  return readJson<RegistryEntry[]>(registryPath(), [])
}

function writeRegistry(entries: RegistryEntry[]): void {
  writeJson(registryPath(), entries)
}

export function listProjects(): Project[] {
  return readRegistry()
    .map((e) => readJson<Project | null>(path.join(e.path, 'project.json'), null))
    .filter((p): p is Project => Boolean(p))
}

export function createProjectWithDefaults(name: string): Project {
  const project = createProject(name.trim() || '未命名项目')
  const dir = projectDir(project.project_id)
  fs.mkdirSync(path.join(dir, 'apis'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'envs'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'settings'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'schemas'), { recursive: true })
  writeJson(path.join(dir, 'project.json'), project)
  writeJson(path.join(dir, 'apis', 'index.json'), { project_id: project.project_id, items: [] })
  writeJson(path.join(dir, 'envs', 'index.json'), { project_id: project.project_id, items: [] })
  writeJson(path.join(dir, 'schemas', 'index.json'), { project_id: project.project_id, items: [] })
  writeJson(path.join(dir, 'settings', 'desc_list.json'), [])
  writeJson(path.join(dir, 'settings', 'db_links.json'), [])
  saveGlobalParams(project.project_id, createRequest())
  saveGlobalVars(project.project_id, {
    project_id: project.project_id,
    vars: {},
    updated_at: new Date().toISOString()
  })
  const env = createEnvironment(project.project_id)
  saveEnvironment(project.project_id, env)
  const registry = readRegistry()
  registry.push({ project_id: project.project_id, path: dir, created_at: project.created_at })
  writeRegistry(registry)
  return project
}

export function ensureDefaultProject(): Project {
  ensureDirs()
  const projects = listProjects()
  if (projects.length > 0) return projects[0]
  return createProjectWithDefaults('默认项目')
}

export function getProject(projectId: string): Project | null {
  return readJson<Project | null>(path.join(projectDir(projectId), 'project.json'), null)
}

export function saveProject(project: Project): Project {
  project.updated_at = new Date().toISOString()
  writeJson(path.join(projectDir(project.project_id), 'project.json'), project)
  return project
}

export function listCustomAttributes(projectId: string): CustomAttribute[] {
  return (getProject(projectId)?.custom_attributes ?? [])
    .slice()
    .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at))
}

export function saveCustomAttribute(
  projectId: string,
  attribute: CustomAttribute
): CustomAttribute {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  const fieldName = String(attribute.field_name ?? '').trim().slice(0, 30)
  if (!fieldName) throw new Error('属性名称不能为空')
  const fieldType = CUSTOM_ATTRIBUTE_TYPES.includes(attribute.field_type)
    ? attribute.field_type
    : 'text'
  const extra = Array.isArray(attribute.extra)
    ? attribute.extra.slice(0, 50).map((option) => ({
        key: typeof option.key === 'string' && option.key ? option.key : createId('opt'),
        label: String(option.label ?? '').slice(0, 60),
        value: String(option.value ?? '').slice(0, 200)
      }))
    : []
  if ((fieldType === 'radio' || fieldType === 'checkbox') && extra.length === 0) {
    throw new Error('单选和多选属性至少需要一个选项')
  }
  const normalized: CustomAttribute = {
    ...attribute,
    attribute_id: attribute.attribute_id || createId('attr'),
    project_id: projectId,
    field_name: fieldName,
    field_type: fieldType,
    enable: attribute.enable !== false,
    extra,
    sort: Number.isFinite(attribute.sort) ? attribute.sort : 1000,
    updated_at: new Date().toISOString()
  }
  const attributes = project.custom_attributes ?? []
  const index = attributes.findIndex((item) => item.attribute_id === normalized.attribute_id)
  const next =
    index < 0
      ? [...attributes, normalized]
      : attributes.map((item, i) => (i === index ? normalized : item))
  saveProject({ ...project, custom_attributes: next })
  return normalized
}

export function deleteCustomAttribute(projectId: string, attributeId: string): boolean {
  const project = getProject(projectId)
  if (!project) return false
  const attributes = project.custom_attributes ?? []
  const next = attributes.filter((item) => item.attribute_id !== attributeId)
  if (next.length === attributes.length) return false
  saveProject({ ...project, custom_attributes: next })
  return true
}

/** 项目状态定义与使用已删除状态的接口一起更新；不覆盖接口的其他字段。 */
export function saveApiStatuses(projectId: string, statuses: ApiStatus[], defaultId: string): Project {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  if (!Array.isArray(statuses) || !statuses.length) throw new Error('至少保留一个接口状态')
  const ids = new Set<string>(), names = new Set<string>()
  const normalized = statuses.map(status => {
    const name = status.name?.trim()
    if (!status.id || ids.has(status.id) || !name || names.has(name) || !/^#[0-9a-f]{6}$/i.test(status.color)) throw new Error('状态名称不能为空或重复，颜色必须有效')
    ids.add(status.id); names.add(name)
    return { id: status.id, name, color: status.color }
  })
  if (!ids.has(defaultId)) throw new Error('请选择有效的默认状态')
  const removed = new Set(apiStatuses(project).filter(status => !ids.has(status.id)).map(status => status.id))
  const affected = listTargets(projectId).filter(item => item.target_type === 'api').map(item => getTarget(projectId, item.target_id)!).filter(target => removed.has(target.mark_id || defaultApiStatus(project)))
  const saved: Target[] = []
  try {
    for (const target of affected) {
      saveTarget(projectId, { ...target, mark_id: defaultId })
      saved.push(target)
    }
    return saveProject({ ...project, api_statuses: normalized, default_api_status_id: defaultId })
  } catch (error) {
    for (const target of saved) saveTarget(projectId, target)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

interface TargetIndex {
  project_id: string
  items: TargetSummary[]
}

function targetIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), 'apis', 'index.json')
}

function readTargetIndex(projectId: string): TargetIndex {
  return readJson<TargetIndex>(targetIndexPath(projectId), { project_id: projectId, items: [] })
}

function writeTargetIndex(projectId: string, index: TargetIndex): void {
  writeJson(targetIndexPath(projectId), index)
}

function toSummary(t: Target): TargetSummary {
  return {
    target_id: t.target_id,
    target_type: t.target_type,
    parent_id: t.parent_id,
    name: t.name,
    description: t.description,
    method: t.method,
    url: t.url,
    sort: t.sort,
    status: t.status,
    updated_at: t.updated_at
  }
}

export function listTargets(projectId: string): TargetSummary[] {
  return readTargetIndex(projectId).items.slice().sort((a, b) => a.sort - b.sort)
}

export function getTarget(projectId: string, targetId: string): Target | null {
  const file = path.join(projectDir(projectId), 'apis', `${assertId(targetId, 'target_id')}.json`)
  return readJson<Target | null>(file, null)
}

export function createTargetInProject(
  projectId: string,
  parentId: string,
  type: 'folder' | 'api'
): Target {
  const index = readTargetIndex(projectId)
  if (parentId !== '0') {
    const parent = index.items.find((i) => i.target_id === parentId)
    if (!parent || parent.target_type !== 'folder') throw new Error('父目录不存在')
  }
  const siblings = index.items.filter((i) => i.parent_id === parentId)
  const maxSort = siblings.reduce((m, i) => Math.max(m, i.sort), 0)
  const target = createTarget(projectId, parentId, type)
  target.mark_id = defaultApiStatus(getProject(projectId))
  target.sort = maxSort + 100
  saveTarget(projectId, target)
  return target
}

// ---------------------------------------------------------------------------
// API 版本历史（本地作用域，不进入 Git）
// ---------------------------------------------------------------------------

const MAX_TARGET_VERSIONS = 100

interface TargetVersionFile {
  target_id: string
  versions: TargetVersion[]
}

function targetVersionsPath(projectId: string, targetId: string): string {
  return path.join(
    localProjectDir(projectId),
    'api_versions',
    `${assertId(targetId, 'target_id')}.json`
  )
}

function readTargetVersions(projectId: string, targetId: string): TargetVersionFile {
  const file = readJson<TargetVersionFile>(targetVersionsPath(projectId, targetId), {
    target_id: targetId,
    versions: []
  })
  return {
    target_id: targetId,
    versions: Array.isArray(file?.versions) ? file.versions : []
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

/** 只对可编辑内容做签名，忽略时间、排序与版本元数据。 */
function targetSignature(target: Target): string {
  const { updated_at, created_at, version, sort, parent_id, ...content } = target as Target
  void updated_at
  void created_at
  void version
  void sort
  void parent_id
  return crypto.createHash('sha1').update(stableStringify(content)).digest('hex')
}

function toVersionSummary(version: TargetVersion): TargetVersionSummary {
  return {
    version_id: version.version_id,
    version: version.version,
    created_at: version.created_at,
    label: version.label,
    tagged_at: version.tagged_at,
    method: version.snapshot?.method,
    url: version.snapshot?.url,
    name: version.snapshot?.name
  }
}

/** 保存时记录版本；内容未变化则不重复记录。 */
function recordTargetVersion(projectId: string, target: Target): void {
  if (target.target_type === 'folder') return
  const file = readTargetVersions(projectId, target.target_id)
  const signature = targetSignature(target)
  const newest = file.versions[0]
  if (newest && newest.signature === signature) {
    target.version = newest.version
    return
  }
  const version = file.versions.reduce((max, item) => Math.max(max, item.version), 0) + 1
  target.version = version
  const snapshot = JSON.parse(JSON.stringify(target)) as Target
  file.versions.unshift({
    version_id: createId('v'),
    version,
    created_at: new Date().toISOString(),
    signature,
    snapshot
  })
  let untagged = 0
  file.versions = file.versions.filter((item) => {
    if (item.label) return true
    untagged += 1
    return untagged <= MAX_TARGET_VERSIONS
  })
  writeJson(targetVersionsPath(projectId, target.target_id), file)
}

export function listTargetVersions(
  projectId: string,
  targetId: string
): TargetVersionSummary[] {
  return readTargetVersions(projectId, targetId).versions.map(toVersionSummary)
}

export function getTargetVersion(
  projectId: string,
  targetId: string,
  versionId: string
): TargetVersion | null {
  return (
    readTargetVersions(projectId, targetId).versions.find(
      (item) => item.version_id === versionId
    ) ?? null
  )
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function restoreTargetVersion(
  projectId: string,
  targetId: string,
  versionId: string
): Target {
  const live = getTarget(projectId, targetId)
  if (!live) throw new Error('接口不存在')
  const found = getTargetVersion(projectId, targetId, versionId)
  if (!found) throw new Error('版本不存在')
  const snapshot = found.snapshot
  const restored: Target = {
    ...live,
    name: snapshot.name,
    description: snapshot.description,
    method: snapshot.method,
    url: snapshot.url,
    protocol: snapshot.protocol,
    server_id: snapshot.server_id,
    status: snapshot.status,
    tags: snapshot.tags ? [...snapshot.tags] : [],
    is_exampled: snapshot.is_exampled,
    request: snapshot.request ? cloneJson(snapshot.request) : live.request,
    response: snapshot.response ? cloneJson(snapshot.response) : live.response,
    updated_at: new Date().toISOString()
  }
  return saveTarget(projectId, restored)
}

export function tagTargetVersion(
  projectId: string,
  targetId: string,
  versionId: string,
  label: string
): TargetVersionSummary {
  const file = readTargetVersions(projectId, targetId)
  const found = file.versions.find((item) => item.version_id === versionId)
  if (!found) throw new Error('版本不存在')
  const clean = String(label ?? '').trim().slice(0, 60)
  if (clean) {
    found.label = clean
    found.tagged_at = new Date().toISOString()
  } else {
    delete found.label
    delete found.tagged_at
  }
  writeJson(targetVersionsPath(projectId, targetId), file)
  return toVersionSummary(found)
}

function uniqueTargetName(projectId: string, parentId: string, base: string): string {
  const names = new Set(
    readTargetIndex(projectId)
      .items.filter((item) => item.parent_id === parentId)
      .map((item) => item.name)
  )
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

export function cloneTarget(projectId: string, targetId: string): Target {
  const source = getTarget(projectId, targetId)
  if (!source) throw new Error('接口不存在')
  if (source.target_type === 'folder') throw new Error('目录暂不支持克隆')
  const index = readTargetIndex(projectId)
  const siblings = index.items.filter((item) => item.parent_id === source.parent_id)
  const maxSort = siblings.reduce((max, item) => Math.max(max, item.sort), 0)
  const now = new Date().toISOString()
  const cloned: Target = {
    ...cloneJson(source),
    source_key: undefined,
    target_id: createId('t'),
    parent_id: source.parent_id,
    name: uniqueTargetName(projectId, source.parent_id, `${source.name} 副本`),
    sort: maxSort + 100,
    version: 1,
    created_at: now,
    updated_at: now
  }
  return saveTarget(projectId, cloned)
}

/** 把客户端草稿另存为新接口；失效的父目录回退到根目录。 */
export function saveTargetCopy(projectId: string, input: Target): Target {
  const index = readTargetIndex(projectId)
  const parentId =
    input.parent_id !== '0' &&
    index.items.find((item) => item.target_id === input.parent_id)?.target_type === 'folder'
      ? input.parent_id
      : '0'
  const siblings = index.items.filter((item) => item.parent_id === parentId)
  const maxSort = siblings.reduce((max, item) => Math.max(max, item.sort), 0)
  const now = new Date().toISOString()
  const copied: Target = {
    ...cloneJson(input),
    target_id: createId('t'),
    project_id: projectId,
    source_key: undefined,
    parent_id: parentId,
    sort: maxSort + 100,
    name: uniqueTargetName(projectId, parentId, `${input.name} 副本`),
    version: 1,
    created_at: now,
    updated_at: now
  }
  return saveTarget(projectId, copied)
}

// ---------------------------------------------------------------------------
// Cookie 管理器（本地作用域，可能包含凭据）
// ---------------------------------------------------------------------------

function cookieJarPath(projectId: string): string {
  return path.join(localProjectDir(projectId), 'cookie_jar.json')
}

function normalizeCookieDomain(input: string): string {
  let domain = String(input ?? '').trim().toLowerCase()
  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  domain = domain.replace(/[/?#].*$/, '')
  domain = domain.replace(/^[^@]*@/, '')
  domain = domain.replace(/:\d+$/, '')
  domain = domain.replace(/^\.+/, '').replace(/\.+$/, '')
  return domain
}

export function getCookieJar(projectId: string): CookieJar {
  return readJson<CookieJar>(cookieJarPath(projectId), {
    project_id: projectId,
    enabled: false,
    domains: [],
    updated_at: new Date().toISOString()
  })
}

export function saveCookieJar(projectId: string, jar: CookieJar): CookieJar {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  const domains = (Array.isArray(jar?.domains) ? jar.domains : [])
    .map((item) => ({
      domain: normalizeCookieDomain(item.domain),
      cookies: String(item.cookies ?? ''),
      updated_at: item.updated_at || now
    }))
    .filter((item) => {
      if (!item.domain || seen.has(item.domain)) return false
      seen.add(item.domain)
      return true
    })
  const clean: CookieJar = {
    project_id: projectId,
    enabled: jar?.enabled === true,
    domains,
    updated_at: now
  }
  const file = cookieJarPath(projectId)
  writeJson(file, clean)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best effort
  }
  return clean
}

function parseCookiePairs(value: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const part of String(value ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const name = part.slice(0, index).trim().replace(/[\r\n]/g, '')
    const cookieValue = part.slice(index + 1).trim().replace(/[\r\n]/g, '')
    if (name) pairs.push([name, cookieValue])
  }
  return pairs
}

/** 返回与 URL 主机匹配的 Cookie；更长的域名优先。 */
export function getCookieJarForUrl(projectId: string, rawUrl: string): Record<string, string> {
  const jar = getCookieJar(projectId)
  if (!jar.enabled || jar.domains.length === 0) return {}
  let host = ''
  try {
    host = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return {}
  }
  const matched = jar.domains
    .filter((item) => host === item.domain || host.endsWith(`.${item.domain}`))
    .sort((a, b) => b.domain.length - a.domain.length)
  const result: Record<string, string> = {}
  for (const item of matched) {
    for (const [name, value] of parseCookiePairs(item.cookies)) {
      if (!(name in result)) result[name] = value
    }
  }
  return result
}

export function saveTarget(projectId: string, target: Target): Target {
  if (target.project_id !== projectId) throw new Error('项目不匹配')
  target.updated_at = new Date().toISOString()
  recordTargetVersion(projectId, target)
  writeJson(
    path.join(projectDir(projectId), 'apis', `${assertId(target.target_id, 'target_id')}.json`),
    target
  )
  const index = readTargetIndex(projectId)
  const idx = index.items.findIndex((i) => i.target_id === target.target_id)
  const summary = toSummary(target)
  if (idx >= 0) index.items[idx] = summary
  else index.items.push(summary)
  writeTargetIndex(projectId, index)
  recordTargetChange(projectId, target.target_id, 'definition')
  return target
}

export function readTargetSnapshot(projectId: string, targetId: string): TargetSnapshot {
  const target = getTarget(projectId, targetId)
  return { target, revision: target ? targetRevision(target) : null }
}

function targetRevision(target: Target): string {
  return crypto.createHash('sha256').update(stableJson(targetDefinition(target))).digest('hex')
}

/** 比较和写入均同步执行，主进程中的其他写入不能插入两者之间。 */
export function saveTargetChecked(projectId: string, target: Target, expectedRevision: string): TargetSaveOutcome {
  const current = readTargetSnapshot(projectId, target.target_id)
  if (!current.target) return { status: 'deleted', ...current }
  if (!expectedRevision || current.revision !== expectedRevision) return { status: 'conflict', ...current }
  const saved = saveTarget(projectId, preserveCaseRuns(target, current.target))
  return { status: 'saved', target: saved, revision: targetRevision(saved) }
}

/**
 * 只更新用例的 last_run，不修改 updated_at、不记录版本、不刷新索引。
 * 用例运行结果不应让标签变脏，也不应产生版本噪声。
 */
export function saveCaseRun(
  projectId: string,
  targetId: string,
  caseId: string,
  result: CaseRunResult
): Target | null {
  const target = getTarget(projectId, targetId)
  if (!target) return null
  const apiCase = (target.cases ?? []).find((item) => item.case_id === caseId)
  if (!apiCase) return null
  apiCase.last_run = result
  writeJson(
    path.join(projectDir(projectId), 'apis', `${assertId(targetId, 'target_id')}.json`),
    target
  )
  recordTargetChange(projectId, targetId, 'runtime')
  return target
}

export function deleteTarget(projectId: string, targetId: string): void {
  const index = readTargetIndex(projectId)
  const toDelete = new Set<string>([targetId])
  let changed = true
  while (changed) {
    changed = false
    for (const item of index.items) {
      if (toDelete.has(item.parent_id) && !toDelete.has(item.target_id)) {
        toDelete.add(item.target_id)
        changed = true
      }
    }
  }
  for (const id of toDelete) {
    const file = path.join(projectDir(projectId), 'apis', `${assertId(id, 'target_id')}.json`)
    fs.rmSync(file, { force: true })
    fs.rmSync(targetVersionsPath(projectId, id), { force: true })
  }
  index.items = index.items.filter((i) => !toDelete.has(i.target_id))
  writeTargetIndex(projectId, index)
  for (const id of toDelete) recordTargetChange(projectId, id, 'deleted')
}

export function reorderTargets(
  projectId: string,
  parentId: string,
  orderedIds: string[]
): TargetSummary[] {
  const index = readTargetIndex(projectId)
  if (parentId !== '0') {
    const parent = index.items.find((i) => i.target_id === parentId)
    if (!parent || parent.target_type !== 'folder') throw new Error('父目录不存在')
  }
  const known = new Set(index.items.map((i) => i.target_id))
  const ids = orderedIds.filter((id) => known.has(id))
  ids.forEach((id, position) => {
    const summary = index.items.find((i) => i.target_id === id)
    if (!summary) return
    summary.parent_id = parentId
    summary.sort = (position + 1) * 100
    const file = path.join(projectDir(projectId), 'apis', `${assertId(id, 'target_id')}.json`)
    const target = readJson<Target | null>(file, null)
    if (!target) return
    target.parent_id = parentId
    target.sort = summary.sort
    target.updated_at = new Date().toISOString()
    writeJson(file, target)
    summary.updated_at = target.updated_at
  })
  writeTargetIndex(projectId, index)
  for (const id of ids) recordTargetChange(projectId, id, 'definition')
  return listTargets(projectId)
}

// ---------------------------------------------------------------------------
// Environments / globals / settings
// ---------------------------------------------------------------------------

interface EnvIndex {
  project_id: string
  items: Array<{ env_id: string; name: string; sort: number; updated_at: string }>
}

function envIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), 'envs', 'index.json')
}

function readEnvIndex(projectId: string): EnvIndex {
  return readJson<EnvIndex>(envIndexPath(projectId), { project_id: projectId, items: [] })
}

export function listEnvironments(projectId: string): Environment[] {
  const index = readEnvIndex(projectId)
  return index.items
    .map((item) =>
      readJson<Environment | null>(
        path.join(projectDir(projectId), 'envs', `${assertId(item.env_id, 'env_id')}.json`),
        null
      )
    )
    .filter((e): e is Environment => Boolean(e))
}

export function saveEnvironment(projectId: string, env: Environment): Environment {
  env.project_id = projectId
  env.updated_at = new Date().toISOString()
  writeJson(
    path.join(projectDir(projectId), 'envs', `${assertId(env.env_id, 'env_id')}.json`),
    env
  )
  const index = readEnvIndex(projectId)
  const idx = index.items.findIndex((i) => i.env_id === env.env_id)
  const summary = { env_id: env.env_id, name: env.name, sort: env.sort ?? 1000, updated_at: env.updated_at }
  if (idx >= 0) index.items[idx] = summary
  else index.items.push(summary)
  writeEnvIndex(projectId, index)
  return env
}

function writeEnvIndex(projectId: string, index: EnvIndex): void {
  writeJson(envIndexPath(projectId), index)
}

export function getGlobalParams(projectId: string): RequestModel | null {
  return readJson<RequestModel | null>(path.join(projectDir(projectId), 'global_params.json'), null)
}

export function saveGlobalParams(projectId: string, request: RequestModel): RequestModel {
  writeJson(path.join(projectDir(projectId), 'global_params.json'), request)
  return request
}

export function getGlobalVars(projectId: string): GlobalVars {
  return readJson<GlobalVars>(path.join(projectDir(projectId), 'global_vars.json'), {
    project_id: projectId,
    vars: {},
    updated_at: new Date().toISOString()
  })
}

export function saveGlobalVars(projectId: string, vars: GlobalVars): GlobalVars {
  vars.project_id = projectId
  vars.updated_at = new Date().toISOString()
  writeJson(path.join(projectDir(projectId), 'global_vars.json'), vars)
  return vars
}

function settingsPath(): string {
  return path.join(getPaths().localRoot, 'settings', 'app_settings.json')
}

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<AppSettings>>(settingsPath(), {}) }
}

export function saveSettings(settings: AppSettings): AppSettings {
  writeJson(settingsPath(), settings)
  return settings
}

// ---------------------------------------------------------------------------
// Developer debugging (CDP)
// ---------------------------------------------------------------------------

const DEFAULT_DEBUG_PORT = 9222

function debugConfigPath(): string {
  return path.join(getPaths().localRoot, 'settings', 'debug_config.json')
}

function normalizePort(value: unknown): number {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_DEBUG_PORT
}

export function getDebugConfig(): DebugConfig {
  const raw = readJson<Partial<DebugConfig>>(debugConfigPath(), {})
  return { enabled: raw.enabled === true, port: normalizePort(raw.port) }
}

export function saveDebugConfig(config: DebugConfig): DebugConfig {
  const port = Number(config.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('端口需在 1024-65535 之间')
  }
  const clean: DebugConfig = { enabled: config.enabled === true, port }
  writeJson(debugConfigPath(), clean)
  return clean
}

export function getDebugState(): DebugState {
  const config = getDebugConfig()
  const raw = app.commandLine.getSwitchValue('remote-debugging-port')
  const port = Number(raw)
  return {
    ...config,
    active_port: raw && Number.isInteger(port) && port > 0 ? port : null
  }
}

/** 必须在 app ready 之前调用。 */
export function applyDebugSwitch(): void {
  const config = getDebugConfig()
  if (config.enabled) {
    app.commandLine.appendSwitch('remote-debugging-port', String(config.port))
  }
}

// ---------------------------------------------------------------------------
// Send history (local scope)
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 100
const LATELY_LIMIT = 30

function historyPath(projectId: string): string {
  return path.join(localProjectDir(projectId), 'send_history.json')
}

function historyResultPath(projectId: string, recordId: string): string {
  return path.join(
    localProjectDir(projectId),
    'send_history_results',
    `${assertId(recordId, 'record_id')}.json`
  )
}

export function addSendRecord(projectId: string, record: SendRecord): void {
  const summary: SendRecordSummary = {
    record_id: record.record_id,
    project_id: record.project_id,
    target_id: record.target_id,
    target_name: record.target_name,
    method: record.method,
    url: record.url,
    created_at: record.created_at,
    status: record.status,
    status_code: record.response?.code ?? null,
    response_time: record.response?.response_time ?? null
  }
  writeJson(historyResultPath(projectId, record.record_id), record)
  const list = readJson<SendRecordSummary[]>(historyPath(projectId), [])
  list.unshift(summary)
  writeJson(historyPath(projectId), list.slice(0, HISTORY_LIMIT))

  const latelyFile = path.join(localProjectDir(projectId), 'lately.json')
  const lately = readJson<Array<Record<string, unknown>>>(latelyFile, [])
  const next = lately.filter((i) => i.target_id !== record.target_id)
  next.unshift({
    target_id: record.target_id,
    target_type: 'api',
    name: record.target_name,
    updated_time: record.created_at
  })
  writeJson(latelyFile, next.slice(0, LATELY_LIMIT))
}

export function listSendRecords(projectId: string): SendRecordSummary[] {
  return readJson<SendRecordSummary[]>(historyPath(projectId), [])
}

export function getSendRecord(projectId: string, recordId: string): SendRecord | null {
  return readJson<SendRecord | null>(historyResultPath(projectId, recordId), null)
}

export function clearSendRecords(projectId: string): void {
  writeJson(historyPath(projectId), [])
  fs.rmSync(path.join(localProjectDir(projectId), 'send_history_results'), {
    recursive: true,
    force: true
  })
  writeJson(path.join(localProjectDir(projectId), 'lately.json'), [])
}

export function deleteSendRecord(projectId: string, recordId: string): void {
  const list = listSendRecords(projectId).filter((i) => i.record_id !== recordId)
  writeJson(historyPath(projectId), list)
  fs.rmSync(historyResultPath(projectId, recordId), { force: true })
}

export function readProjectRequestDefaults(projectId: string): RequestModel {
  return getGlobalParams(projectId) || createRequest()
}

// ---------------------------------------------------------------------------
// M2 · Flows and flow runs
// ---------------------------------------------------------------------------

function flowsDir(projectId: string): string {
  return path.join(projectDir(projectId), 'executions', 'flows')
}

function runsDir(projectId: string): string {
  return path.join(localProjectDir(projectId), 'executions', 'runs')
}

function legacyRunsDir(projectId: string): string {
  return path.join(projectDir(projectId), 'executions', 'runs')
}

function flowPath(projectId: string, flowId: string): string {
  return path.join(flowsDir(projectId), `${assertId(flowId, 'flow_id')}.json`)
}

function runPath(projectId: string, runId: string): string {
  return path.join(runsDir(projectId), `${assertId(runId, 'run_id')}.json`)
}

export function listFlows(projectId: string): Flow[] {
  const dir = flowsDir(projectId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson<Flow | null>(path.join(dir, file), null))
    .filter((flow): flow is Flow => Boolean(flow))
    .map(withFlowRevision)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function getFlow(projectId: string, flowId: string): Flow | null {
  const flow = readJson<Flow | null>(flowPath(projectId, flowId), null)
  return flow ? withFlowRevision(flow) : null
}

function withFlowRevision(flow: Flow): Flow {
  const { revision: _revision, updated_at: _updated, ...definition } = flow
  return { ...flow, revision: crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex') }
}

/** Read, validate and write without yielding, including legacy updates without a revision. */
export function updateFlowChecked(
  projectId: string, flowId: string, expectedRevision: string | undefined, update: (flow: Flow) => Flow
): Flow {
  const current = getFlow(projectId, flowId)
  if (!current) throw new Error('流程不存在')
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    throw new Error('流程保存冲突：revision 已过期，请重新读取流程')
  }
  return saveFlow(projectId, update(current))
}

export function saveFlowChecked(projectId: string, flow: Flow, expectedRevision: string): Flow {
  if (!expectedRevision) throw new Error('流程保存需要 expected revision，请重新读取流程')
  return updateFlowChecked(projectId, flow.flow_id, expectedRevision, () => flow)
}

export function saveFlow(projectId: string, flow: Flow): Flow {
  if (flow.project_id !== projectId) throw new Error('项目不匹配')
  const saved = withFlowRevision({ ...flow, events: normalizeFlowEvents(flow.events), updated_at: new Date().toISOString() })
  writeJson(flowPath(projectId, flow.flow_id), saved)
  return saved
}

export function deleteFlow(projectId: string, flowId: string): void {
  if (readFlowRuns(projectId).some(run => run.flow_id === flowId && run.status === 'running')) {
    throw new Error('活动运行绑定的流程不可删除')
  }
  fs.rmSync(flowPath(projectId, flowId), { force: true })
}

function countResults(
  events: FlowEventResult[],
  acc: { passed: number; failed: number; skipped: number }
): void {
  for (const event of events) {
    if (event.status === 'passed') acc.passed += 1
    else if (event.status === 'failed') acc.failed += 1
    else acc.skipped += 1
    if (event.children?.length) countResults(event.children, acc)
  }
}

/** Local evidence first; existing project reports remain readable without migration. */
export function readFlowRuns(projectId: string): FlowRun[] {
  const runs = new Map<string, FlowRun>()
  for (const dir of [legacyRunsDir(projectId), runsDir(projectId)]) {
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
      const run = readJson<FlowRun | null>(path.join(dir, file), null)
      if (run?.project_id === projectId) runs.set(run.run_id, redactEvidence(run))
    }
  }
  return [...runs.values()]
}

export function listFlowRuns(projectId: string, limit = 30): FlowRunSummary[] {
  return readFlowRuns(projectId)
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, Math.max(1, limit))
    .map((run) => {
      const counts = { passed: 0, failed: 0, skipped: 0 }
      countResults(run.events, counts)
      return {
        run_id: run.run_id,
        project_id: run.project_id,
        flow_id: run.flow_id,
        flow_name: run.flow_name,
        started_at: run.started_at,
        status: run.status,
        elapsed_ms: run.elapsed_ms,
        ...counts
      }
    })
}

export function getFlowRun(projectId: string, runId: string): FlowRun | null {
  return redactEvidence(readJson<FlowRun | null>(runPath(projectId, runId), null)
    ?? readJson<FlowRun | null>(path.join(legacyRunsDir(projectId), `${assertId(runId, 'run_id')}.json`), null))
}

export function saveFlowRun(projectId: string, run: FlowRun): FlowRun {
  if (run.project_id !== projectId) throw new Error('项目不匹配')
  const evidence = redactEvidence(run)
  writeJson(runPath(projectId, run.run_id), evidence)
  return evidence
}

export function clearFlowRuns(projectId: string): void {
  fs.rmSync(runsDir(projectId), { recursive: true, force: true })
  fs.rmSync(legacyRunsDir(projectId), { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// M3 · MCP configuration
// ---------------------------------------------------------------------------

export const MCP_DEFAULT_PORT = 39121

function mcpConfigPath(): string {
  return path.join(getPaths().localRoot, 'settings', 'mcp_config.json')
}

function defaultMcpConfig(): McpConfig {
  return {
    enabled: false,
    allow_write: false,
    allow_execute: false,
    allowed_project_ids: [],
    host: '127.0.0.1',
    port: MCP_DEFAULT_PORT,
    token: crypto.randomBytes(24).toString('hex')
  }
}

export function getMcpConfig(): McpConfig {
  const file = mcpConfigPath()
  const existing = readJson<McpConfig | null>(file, null)
  if (existing && existing.token) return existing
  const config = defaultMcpConfig()
  writeJson(file, config)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best effort on non-POSIX filesystems
  }
  writeMcpInfo(config)
  return config
}

export function saveMcpConfig(input: McpConfig): McpConfig {
  const base = readJson<McpConfig | null>(mcpConfigPath(), null) ?? defaultMcpConfig()
  const config: McpConfig = {
    ...base,
    ...input,
    host: '127.0.0.1',
    port: Math.min(Math.max(Number(input.port) || MCP_DEFAULT_PORT, 1024), 65535),
    token: (input.token || base.token || crypto.randomBytes(24).toString('hex')).trim(),
    allowed_project_ids: Array.from(new Set(input.allowed_project_ids ?? []))
  }
  const file = mcpConfigPath()
  writeJson(file, config)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best effort on non-POSIX filesystems
  }
  writeMcpInfo(config)
  return config
}

export function regenerateMcpToken(): McpConfig {
  const config = getMcpConfig()
  return saveMcpConfig({ ...config, token: crypto.randomBytes(24).toString('hex') })
}

export function mcpInfoPath(): string {
  return path.join(getPaths().userData, 'mcp_info.json')
}

export function writeMcpInfo(config: McpConfig): void {
  const file = mcpInfoPath()
  writeJson(file, {
    host: config.host,
    port: config.port,
    token: config.token,
    enabled: config.enabled,
    updated_at: new Date().toISOString()
  })
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best effort
  }
}

export function deleteEnvironment(projectId: string, envId: string): void {
  fs.rmSync(
    path.join(projectDir(projectId), 'envs', `${assertId(envId, 'env_id')}.json`),
    { force: true }
  )
  const index = readEnvIndex(projectId)
  index.items = index.items.filter((item) => item.env_id !== envId)
  writeEnvIndex(projectId, index)
}

// ---------------------------------------------------------------------------
// Data dictionary
// ---------------------------------------------------------------------------

function descListPath(projectId: string): string {
  return path.join(projectDir(projectId), 'settings', 'desc_list.json')
}

export function listCustomDictionaryEntries(projectId: string): DictionaryEntry[] {
  return readJson<DictionaryEntry[]>(descListPath(projectId), [])
    .filter((entry) => entry && entry.project_id === projectId)
    .sort((a, b) => a.key.localeCompare(b.key, 'zh-CN'))
}

export function listDictionaryEntries(projectId: string): DictionaryEntryView[] {
  const custom: DictionaryEntryView[] = [...listTemporaryDictionaryEntries(projectId), ...listCustomDictionaryEntries(projectId)].map((entry) => ({
    ...entry,
    source: 'custom'
  }))
  const builtin: DictionaryEntryView[] = BUILTIN_DICTIONARY.map((entry) => ({
    ...entry,
    source: 'builtin'
  }))
  return [...custom, ...builtin]
}

function normalizeDictionaryEntry(projectId: string, input: DictionaryEntry, existing?: DictionaryEntry): DictionaryEntry {
  const valueText = (value: unknown): string => value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  const key = String(input.key ?? '').trim()
  const description = String(input.description ?? '').trim()
  if (!key) throw new Error('参数名称不能为空')
  if (!DICT_FIELD_TYPES.includes(input.field_type)) {
    throw new Error(`不支持的字段类型：${String(input.field_type)}`)
  }
  const now = new Date().toISOString()
  if (input.id?.startsWith('builtin_')) {
    throw new Error('系统内置描述不能修改')
  }
  return {
    id: input.id && !input.id.startsWith('builtin_') ? input.id : createDictionaryEntry(projectId).id,
    project_id: projectId,
    key,
    field_type: input.field_type ?? 'string',
    description,
    remarks: String(input.remarks ?? ''),
    default_value: input.default_value === undefined ? valueText(input.schema?.default) : String(input.default_value),
    example_value: input.example_value === undefined ? valueText(input.schema?.example) : String(input.example_value),
    mock: input.mock === undefined ? valueText(input.schema?.['x-mock']) : String(input.mock),
    schema: input.schema,
    created_at: existing?.created_at ?? now,
    updated_at: now
  }
}

/** Normalize the complete batch before writing so validation failures cannot partly import. */
export function saveDictionaryEntries(projectId: string, input: DictionaryEntry[]): DictionaryEntry[] {
  if (!input.length) return []
  const entries = listCustomDictionaryEntries(projectId)
  const pending = listTemporaryDictionaryEntries(projectId)
  const saved = input.map(entry => normalizeDictionaryEntry(projectId, entry, [...entries, ...pending].find(item => item.id === entry.id)))
  for (const entry of saved) {
    const index = entries.findIndex(item => item.id === entry.id)
    if (index >= 0) entries[index] = entry
    else entries.push(entry)
  }
  writeJson(descListPath(projectId), entries)
  const ids = new Set(saved.map(entry => entry.id))
  writeJson(temporaryDictionaryPath(projectId), pending.filter(entry => !ids.has(entry.id)))
  return saved
}

export function saveDictionaryEntry(projectId: string, input: DictionaryEntry): DictionaryEntry {
  return saveDictionaryEntries(projectId, [input])[0]
}

function temporaryDictionaryPath(projectId: string): string {
  return path.join(projectDir(projectId), 'settings', 'desc_temporary.json')
}

function listTemporaryDictionaryEntries(projectId: string): DictionaryEntry[] {
  return readJson<DictionaryEntry[]>(temporaryDictionaryPath(projectId), []).filter(entry => entry?.project_id === projectId).map(entry => ({ ...entry, temporary: true }))
}

export function stageDictionaryEntry(projectId: string, input: DictionaryEntry): boolean {
  if (!input.key?.trim() || !input.description?.trim()) return false
  const all = listDictionaryEntries(projectId)
  if (all.some(entry => entry.key === input.key.trim() && entry.description === input.description.trim() && entry.field_type === input.field_type)) return false
  const entry = normalizeDictionaryEntry(projectId, { ...input, id: '' })
  const pending = listTemporaryDictionaryEntries(projectId)
  writeJson(temporaryDictionaryPath(projectId), [...pending, { ...entry, temporary: true }])
  return true
}

export function saveTemporaryDictionaryEntries(projectId: string, ids?: string[]): DictionaryEntry[] {
  return saveDictionaryEntries(projectId, listTemporaryDictionaryEntries(projectId).filter(entry => !ids || ids.includes(entry.id)))
}

export function deleteDictionaryEntry(projectId: string, id: string): void {
  deleteDictionaryEntries(projectId, [id])
}

export function deleteDictionaryEntries(projectId: string, ids: string[]): void {
  if (!ids.length) return
  if (ids.some(id => !id || id.startsWith('builtin_'))) throw new Error('系统内置描述不能删除')
  const entries = listCustomDictionaryEntries(projectId)
  const pending = listTemporaryDictionaryEntries(projectId)
  if (ids.some(id => ![...entries, ...pending].some(entry => entry.id === id))) throw new Error('字典条目不存在')
  const next = entries.filter((entry) => !ids.includes(entry.id))
  writeJson(descListPath(projectId), next)
  writeJson(temporaryDictionaryPath(projectId), pending.filter(entry => !ids.includes(entry.id)))
}

export function getDictionarySettings(projectId: string): DictionarySettings {
  const project = getProject(projectId)
  return { builtin_enabled: project?.is_describe_library !== -1 }
}

export function saveDictionarySettings(
  projectId: string,
  settings: DictionarySettings
): Project {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  project.is_describe_library = settings.builtin_enabled ? 1 : -1
  return saveProject(project)
}

/** 联想数据源：自定义 + （开关开启时）系统内置。 */
export function listDictionarySuggestions(projectId: string): DictionaryEntryView[] {
  const settings = getDictionarySettings(projectId)
  return listDictionaryEntries(projectId).filter(
    (entry) => entry.source === 'custom' || settings.builtin_enabled
  )
}

// ---------------------------------------------------------------------------
// Data models
// ---------------------------------------------------------------------------

interface ModelIndex {
  project_id: string
  items: ModelSummary[]
}

function schemasDir(projectId: string): string {
  return path.join(projectDir(projectId), 'schemas')
}

function modelIndexPath(projectId: string): string {
  return path.join(schemasDir(projectId), 'index.json')
}

function modelPath(projectId: string, modelId: string): string {
  return path.join(schemasDir(projectId), `${assertId(modelId, 'model_id')}.json`)
}

function readModelIndex(projectId: string): ModelIndex {
  return readJson<ModelIndex>(modelIndexPath(projectId), { project_id: projectId, items: [] })
}

function writeModelIndex(projectId: string, index: ModelIndex): void {
  writeJson(modelIndexPath(projectId), index)
}

function toModelSummary(model: DataModel): ModelSummary {
  return {
    model_id: model.model_id,
    parent_id: model.parent_id,
    model_type: model.model_type,
    name: model.name,
    alias: model.alias ?? '',
    sort: model.sort,
    created_by: model.created_by,
    created_time: model.created_time,
    updated_by: model.updated_by,
    updated_time: model.updated_time
  }
}

export function listModels(projectId: string): ModelSummary[] {
  return readModelIndex(projectId)
    .items.slice()
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'))
}

export function listModelsAll(projectId: string): DataModel[] {
  return listModels(projectId)
    .map((summary) => getModel(projectId, summary.model_id))
    .filter((model): model is DataModel => Boolean(model))
}

export function getModel(projectId: string, modelId: string): DataModel | null {
  return readJson<DataModel | null>(modelPath(projectId, modelId), null)
}

export function saveModel(projectId: string, input: DataModel): DataModel {
  if (input.project_id !== projectId) throw new Error('项目不匹配')
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('模型名称不能为空')
  if (input.model_type !== 'folder' && input.model_type !== 'model') {
    throw new Error('模型类型非法')
  }
  const index = readModelIndex(projectId)
  if (input.parent_id !== '0') {
    const parent = index.items.find((item) => item.model_id === input.parent_id)
    if (!parent || parent.model_type !== 'folder') throw new Error('父目录不存在')
  }
  const now = new Date().toISOString()
  const existing = index.items.find((item) => item.model_id === input.model_id)
  if (!existing && getModel(projectId, input.model_id)) {
    throw new Error('模型已存在')
  }
  const model: DataModel = {
    ...input,
    name,
    alias: String(input.alias ?? '').trim(),
    project_id: projectId,
    data: {
      description: String(input.data?.description ?? ''),
      schema: (input.data?.schema ?? ({} as ModelSchema)) as ModelSchema
    },
    version: (existing ? input.version : 1) || 1,
    status: input.status ?? 1,
    created_by: existing ? input.created_by : input.created_by ?? '本地',
    created_time: existing ? input.created_time : input.created_time ?? now,
    updated_by: input.updated_by ?? '本地',
    updated_time: now
  }
  writeJson(modelPath(projectId, model.model_id), model)
  const summary = toModelSummary(model)
  const position = index.items.findIndex((item) => item.model_id === model.model_id)
  if (position >= 0) index.items[position] = summary
  else index.items.push(summary)
  writeModelIndex(projectId, index)
  recordModelChange(projectId)
  return model
}

export function createModelInProject(
  projectId: string,
  parentId: string,
  kind: ModelType
): DataModel {
  const index = readModelIndex(projectId)
  if (parentId !== '0') {
    const parent = index.items.find((item) => item.model_id === parentId)
    if (!parent || parent.model_type !== 'folder') throw new Error('父目录不存在')
  }
  const siblings = index.items.filter((item) => item.parent_id === parentId)
  const maxSort = siblings.reduce((max, item) => Math.max(max, item.sort), 0)
  const model = createDataModel(projectId, parentId, kind)
  model.sort = maxSort + 100
  return saveModel(projectId, model)
}

export function deleteModel(projectId: string, modelId: string): void {
  const index = readModelIndex(projectId)
  if (!index.items.some((item) => item.model_id === modelId)) throw new Error('模型不存在')
  const toDelete = new Set<string>([modelId])
  let changed = true
  while (changed) {
    changed = false
    for (const item of index.items) {
      if (toDelete.has(item.parent_id) && !toDelete.has(item.model_id)) {
        toDelete.add(item.model_id)
        changed = true
      }
    }
  }
  for (const id of toDelete) fs.rmSync(modelPath(projectId, id), { force: true })
  index.items = index.items.filter((item) => !toDelete.has(item.model_id))
  writeModelIndex(projectId, index)
  recordModelChange(projectId)
}

export function deleteModelWithReferences(
  projectId: string,
  modelId: string
): { references: ModelReference[]; deleted: boolean } {
  const references = findModelReferences(projectId, modelId)
  deleteModel(projectId, modelId)
  return { references, deleted: true }
}

function uniqueModelName(projectId: string, parentId: string, base: string): string {
  const names = new Set(
    readModelIndex(projectId)
      .items.filter((item) => item.parent_id === parentId && item.model_type === 'model')
      .map((item) => item.name)
  )
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

export function copyModel(
  projectId: string,
  modelId: string,
  destParentId = '0'
): DataModel {
  const source = getModel(projectId, modelId)
  if (!source) throw new Error('模型不存在')
  const index = readModelIndex(projectId)
  if (destParentId !== '0') {
    const parent = index.items.find((item) => item.model_id === destParentId)
    if (!parent || parent.model_type !== 'folder') throw new Error('目标目录不存在')
  }
  const siblings = index.items.filter((item) => item.parent_id === destParentId)
  const maxSort = siblings.reduce((max, item) => Math.max(max, item.sort), 0)
  const now = new Date().toISOString()
  const cloned: DataModel = {
    ...JSON.parse(JSON.stringify(source)),
    model_id: createDataModel(projectId, destParentId).model_id,
    parent_id: destParentId,
    name:
      source.model_type === 'folder'
        ? uniqueModelName(projectId, destParentId, `${source.name} 副本`)
        : uniqueModelName(projectId, destParentId, `${source.name} 副本`),
    sort: maxSort + 100,
    created_by: '本地',
    updated_by: '本地',
    created_time: now,
    updated_time: now
  }
  return saveModel(projectId, cloned)
}

function isDescendant(index: ModelIndex, candidateId: string, ancestorId: string): boolean {
  let current = index.items.find((item) => item.model_id === candidateId)
  const seen = new Set<string>()
  while (current && current.parent_id !== '0' && !seen.has(current.parent_id)) {
    if (current.parent_id === ancestorId) return true
    seen.add(current.parent_id)
    current = index.items.find((item) => item.model_id === current!.parent_id)
  }
  return false
}

export function moveModel(
  projectId: string,
  modelId: string,
  destParentId: string,
  orderedIds?: string[]
): ModelSummary[] {
  const index = readModelIndex(projectId)
  const model = index.items.find((item) => item.model_id === modelId)
  if (!model) throw new Error('模型不存在')
  if (destParentId !== '0') {
    const parent = index.items.find((item) => item.model_id === destParentId)
    if (!parent || parent.model_type !== 'folder') throw new Error('目标目录不存在')
    if (destParentId === modelId || isDescendant(index, destParentId, modelId)) {
      throw new Error('不能移动到自身或其子目录')
    }
  }
  const siblings = index.items.filter(
    (item) => item.parent_id === destParentId && item.model_id !== modelId
  )
  const maxSort = siblings.reduce((max, item) => Math.max(max, item.sort), 0)
  model.parent_id = destParentId
  model.sort = maxSort + 100
  const file = getModel(projectId, modelId)
  if (file) {
    file.parent_id = destParentId
    file.sort = model.sort
    file.updated_by = '本地'
    saveModel(projectId, file)
  }
  writeModelIndex(projectId, index)
  if (orderedIds && orderedIds.length > 0) {
    return reorderModels(projectId, destParentId, orderedIds)
  }
  return listModels(projectId)
}

export function reorderModels(
  projectId: string,
  parentId: string,
  orderedIds: string[]
): ModelSummary[] {
  const index = readModelIndex(projectId)
  if (parentId !== '0') {
    const parent = index.items.find((item) => item.model_id === parentId)
    if (!parent || parent.model_type !== 'folder') throw new Error('父目录不存在')
  }
  const known = new Set(index.items.map((item) => item.model_id))
  const ids = orderedIds.filter((id) => known.has(id))
  ids.forEach((id, position) => {
    const summary = index.items.find((item) => item.model_id === id)
    if (!summary) return
    summary.parent_id = parentId
    summary.sort = (position + 1) * 100
    const model = getModel(projectId, id)
    if (!model) return
    model.parent_id = parentId
    model.sort = summary.sort
    model.updated_by = '本地'
    model.updated_time = new Date().toISOString()
    writeJson(modelPath(projectId, id), model)
  })
  writeModelIndex(projectId, index)
  if (ids.length > 0) recordModelChange(projectId)
  return listModels(projectId)
}

export function findModelReferences(projectId: string, modelId: string): ModelReference[] {
  const references: ModelReference[] = []
  for (const summary of listTargets(projectId)) {
    if (summary.target_type !== 'api') continue
    const target = getTarget(projectId, summary.target_id)
    if (!target) continue
    if (target.request?.body?.model_id === modelId) {
      references.push({
        target_id: target.target_id,
        target_name: target.name,
        method: target.method,
        kind: 'request-body'
      })
    }
    for (const example of target.response?.example ?? []) {
      if (example.expect?.model_id === modelId) {
        references.push({
          target_id: target.target_id,
          target_name: target.name,
          method: target.method,
          kind: 'response-example',
          example_id: example.example_id
        })
      }
    }
  }
  return references
}

// ---------------------------------------------------------------------------
// Database connections
// ---------------------------------------------------------------------------

function dbLinksPath(projectId: string): string {
  return path.join(projectDir(projectId), 'settings', 'db_links.json')
}

export function listDbConnections(projectId: string): DbConnection[] {
  return readJson<DbConnection[]>(dbLinksPath(projectId), []).filter(
    (connection) => connection && connection.project_id === projectId
  )
}

export function getDbConnection(projectId: string, dbId: string): DbConnection | null {
  return listDbConnections(projectId).find((connection) => connection.db_id === dbId) ?? null
}

export function saveDbConnection(projectId: string, input: DbConnection): DbConnection {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('连接名称不能为空')
  const connections = listDbConnections(projectId)
  const index = input.db_id
    ? connections.findIndex((connection) => connection.db_id === input.db_id)
    : -1
  const existing = index >= 0 ? connections[index] : null
  const now = new Date().toISOString()
  const incomingDefault = input.config?.default
  const incomingSsh = input.ssh
  const connection: DbConnection = {
    db_id: existing ? existing.db_id : input.db_id || createId('db'),
    project_id: projectId,
    name,
    type: 'mysql',
    remarks: String(input.remarks ?? ''),
    config: {
      default: {
        host: String(incomingDefault?.host ?? ''),
        port: Number(incomingDefault?.port) || 3306,
        user: String(incomingDefault?.user ?? ''),
        password:
          incomingDefault?.password !== undefined
            ? String(incomingDefault.password)
            : existing?.config.default.password ?? '',
        database: String(incomingDefault?.database ?? ''),
        charset: incomingDefault?.charset || 'utf8mb4'
      }
    },
    ssh: {
      enable: incomingSsh?.enable === 1 ? 1 : -1,
      host: String(incomingSsh?.host ?? ''),
      port: Number(incomingSsh?.port) || 22,
      username: String(incomingSsh?.username ?? ''),
      password:
        incomingSsh?.password !== undefined
          ? String(incomingSsh.password)
          : existing?.ssh.password ?? '',
      auth_type: incomingSsh?.auth_type === 2 || incomingSsh?.auth_type === 3 ? incomingSsh.auth_type : 1,
      private_key:
        incomingSsh?.private_key !== undefined
          ? String(incomingSsh.private_key)
          : existing?.ssh.private_key ?? '',
      passphrase:
        incomingSsh?.passphrase !== undefined
          ? String(incomingSsh.passphrase)
          : existing?.ssh.passphrase ?? ''
    },
    created_at: existing ? existing.created_at : input.created_at ?? now,
    updated_at: now
  }
  if (index >= 0) connections[index] = connection
  else connections.push(connection)
  writeJson(dbLinksPath(projectId), connections)
  return connection
}

export function deleteDbConnection(projectId: string, dbId: string): void {
  const connections = listDbConnections(projectId)
  const next = connections.filter((connection) => connection.db_id !== dbId)
  if (next.length === connections.length) throw new Error('数据库连接不存在')
  writeJson(dbLinksPath(projectId), next)
}

export function redactDbConnection(connection: DbConnection): import('@shared/types').DbConnectionView {
  const { password, ...restDefault } = connection.config.default
  const { password: sshPassword, private_key, passphrase, ...restSsh } = connection.ssh
  return {
    ...connection,
    config: { default: { ...restDefault, has_password: Boolean(password) } },
    ssh: {
      ...restSsh,
      has_password: Boolean(sshPassword),
      has_private_key: Boolean(private_key),
      has_passphrase: Boolean(passphrase)
    }
  }
}

// ---------------------------------------------------------------------------
// Docs · local share
// ---------------------------------------------------------------------------

export const DOC_DEFAULT_PORT = 30999

const DOC_SCOPES: DocScope[] = ['project', 'folder', 'api', 'custom']
const DAY_MS = 24 * 60 * 60 * 1000

function docsDir(projectId: string): string {
  return path.join(projectDir(projectId), 'docs')
}

function docSharesPath(projectId: string): string {
  return path.join(docsDir(projectId), 'shares.json')
}

function readDocShares(projectId: string): DocShare[] {
  return readJson<DocShare[]>(docSharesPath(projectId), [])
}

function writeDocShares(projectId: string, shares: DocShare[]): void {
  writeJson(docSharesPath(projectId), shares)
}

function docServiceConfigPath(): string {
  return path.join(getPaths().localRoot, 'settings', 'docs_config.json')
}

function normalizeDocPort(value: unknown, fallback = DOC_DEFAULT_PORT): number {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : fallback
}

export function getDocServiceConfig(): DocServiceConfig {
  const raw = readJson<Partial<DocServiceConfig>>(docServiceConfigPath(), {})
  return {
    enabled: raw.enabled !== false,
    port: normalizeDocPort(raw.port)
  }
}

export function saveDocServiceConfig(input: DocServiceConfig): DocServiceConfig {
  const config: DocServiceConfig = {
    enabled: input.enabled !== false,
    port: normalizeDocPort(input.port)
  }
  writeJson(docServiceConfigPath(), config)
  return config
}

function normalizeDocScope(value: unknown): DocScope {
  const scope = String(value) as DocScope
  if (!DOC_SCOPES.includes(scope)) throw new Error('分享范围无效')
  return scope
}

function normalizeDocSettings(input?: Partial<DocSettings>): DocSettings {
  const base = createDocSettings()
  const rawDays = Number(input?.expire_days)
  const days =
    rawDays === -1 || (Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 3650)
      ? Math.trunc(rawDays)
      : base.expire_days
  return {
    password: typeof input?.password === 'string' ? input.password.slice(0, 128) : '',
    expire_days: days,
    show_request: input?.show_request !== false,
    show_body: input?.show_body !== false,
    show_response: input?.show_response !== false,
    show_headers: input?.show_headers !== false,
    show_scripts: input?.show_scripts === true,
    show_design: input?.show_design !== false,
    show_cases: input?.show_cases !== false,
    openapi: input?.openapi === true,
    openapi_version:
      input?.openapi_version === '3.1' || input?.openapi_version === '2.0'
        ? input.openapi_version
        : '3.0',
    logo: normalizeDocLogo(input?.logo),
    env_id: typeof input?.env_id === 'string' ? input.env_id.slice(0, 80) : '',
    attribute_list: Array.isArray(input?.attribute_list)
      ? [...new Set(input.attribute_list.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 50)
      : []
  }
}

const DOC_LOGO_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/
const DOC_LOGO_MAX_LENGTH = 200 * 1024

function normalizeDocLogo(value: unknown): string {
  if (typeof value !== 'string') return ''
  const logo = value.trim()
  if (!logo || logo.length > DOC_LOGO_MAX_LENGTH || !DOC_LOGO_PATTERN.test(logo)) return ''
  return logo
}

function normalizeDocTargetIds(scope: DocScope, ids: unknown): string[] {
  if (scope === 'project') return []
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(scope === 'folder' ? '请选择要分享的目录' : '请选择要分享的接口')
  }
  return Array.from(new Set(ids.map((id) => assertId(String(id), 'target_id'))))
}

function docProtocolLabel(target: Pick<DocTargetSnapshot, 'protocol' | 'method'>): string {
  const raw = `${target.protocol ?? ''} ${target.method ?? ''}`.toLowerCase()
  if (raw.includes('socket.io') || raw.includes('socketio')) return 'Socket.IO'
  if (raw.includes('graphql')) return 'GraphQL'
  if (raw.includes('grpc')) return 'gRPC'
  if (raw.includes('websocket') || raw.includes('ws://') || raw.includes('wss://')) {
    return 'Websocket'
  }
  if (raw.includes('tcp')) return 'TCP'
  if (raw.includes('sse') || raw.includes('event-stream')) return 'SSE'
  if (raw.includes('markdown') || raw.startsWith('md ')) return 'MD'
  return 'HTTP'
}

function docOwner(): string {
  try {
    return os.userInfo().username || 'local'
  } catch {
    return 'local'
  }
}

function docExpireAt(share: Pick<DocShare, 'created_at' | 'settings'>): string | null {
  if (share.settings.expire_days === -1) return null
  const created = new Date(share.created_at).getTime()
  if (!Number.isFinite(created)) return null
  return new Date(created + share.settings.expire_days * DAY_MS).toISOString()
}

function docExpireInfo(share: DocShare): {
  expire_at: string | null
  expire_label: string
  expired: boolean
} {
  const expireAt = docExpireAt(share)
  if (!expireAt) return { expire_at: null, expire_label: '永久有效', expired: false }
  const remain = new Date(expireAt).getTime() - Date.now()
  if (remain <= 0) return { expire_at: expireAt, expire_label: '已过期', expired: true }
  const days = Math.max(1, Math.ceil(remain / DAY_MS))
  return { expire_at: expireAt, expire_label: `${days} 天后过期`, expired: false }
}

function toDocTargetSnapshot(target: Target): DocTargetSnapshot {
  return {
    target_id: target.target_id,
    target_type: target.target_type,
    parent_id: target.parent_id,
    name: target.name,
    description: target.description,
    method: target.method,
    url: target.url,
    protocol: target.protocol,
    sort: target.sort,
    request: target.request,
    response: target.response
  }
}

function collectDocTargets(projectId: string, scope: DocScope, targetIds: string[]): Target[] {
  const index = readTargetIndex(projectId)
  const byId = new Map(index.items.map((item) => [item.target_id, item]))
  const ids = new Set<string>()

  const addWithDescendants = (id: string, seen = new Set<string>()): void => {
    if (seen.has(id)) return
    seen.add(id)
    if (!byId.has(id)) return
    ids.add(id)
    for (const child of index.items) {
      if (child.parent_id === id) addWithDescendants(child.target_id, seen)
    }
  }

  if (scope === 'project') {
    for (const item of index.items) ids.add(item.target_id)
  } else {
    for (const id of targetIds) {
      const item = byId.get(id)
      if (!item) throw new Error('分享目标不存在或已被删除')
      if (scope === 'folder' && item.target_type !== 'folder') throw new Error('请选择目录')
      if (scope === 'api' && item.target_type !== 'api') throw new Error('请选择接口')
      addWithDescendants(id)
    }
    // 保留祖先目录，分享页才能呈现完整树。
    for (const id of [...ids]) {
      let current = byId.get(id)
      let guard = 0
      while (current && current.parent_id !== '0' && guard < 200) {
        ids.add(current.parent_id)
        current = byId.get(current.parent_id)
        guard += 1
      }
    }
  }

  const targets = [...ids]
    .map((id) => getTarget(projectId, id))
    .filter((target): target is Target => Boolean(target))

  const apiCount = targets.filter((target) => target.target_type === 'api').length
  if (scope !== 'project' && apiCount === 0) {
    throw new Error(scope === 'folder' ? '所选目录下没有接口' : '请选择要分享的接口')
  }

  return targets.sort(
    (a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hans-CN')
  )
}

function buildDocSnapshot(
  project: Project,
  projectId: string,
  scope: DocScope,
  targetIds: string[]
): DocSnapshot {
  const targets = collectDocTargets(projectId, scope, targetIds)
  return {
    project_name: project.name,
    project_intro: project.intro,
    generated_at: new Date().toISOString(),
    targets: targets.map(toDocTargetSnapshot)
  }
}

export interface ResolvedDocShare {
  project: Project | null
  targets: Target[]
  /** 分享页的根节点：folder / api 范围分别指向该目录或接口 */
  rootId: string | null
  /** 根目标或项目已不存在 */
  notFound: boolean
}

/**
 * 实时解析分享范围。与 collectDocTargets 不同，这里不抛错：
 * 缺失的目标会被剔除，根目标缺失时标记 notFound，由渲染层返回 404。
 */
export function resolveDocShareTargets(projectId: string, share: DocShare): ResolvedDocShare {
  const project = getProject(projectId)
  if (!project) return { project: null, targets: [], rootId: null, notFound: true }

  const index = readTargetIndex(projectId)
  const byId = new Map(index.items.map((item) => [item.target_id, item]))
  const ids = new Set<string>()
  const rootId = share.scope === 'project' ? null : share.target_ids[0] ?? null

  const addWithDescendants = (id: string, seen = new Set<string>()): void => {
    if (seen.has(id) || !byId.has(id)) return
    seen.add(id)
    ids.add(id)
    for (const child of index.items) {
      if (child.parent_id === id) addWithDescendants(child.target_id, seen)
    }
  }

  if (share.scope === 'project') {
    for (const item of index.items) ids.add(item.target_id)
  } else if (share.scope === 'folder') {
    const root = rootId ? byId.get(rootId) : undefined
    if (!root || root.target_type !== 'folder') {
      return { project, targets: [], rootId: null, notFound: true }
    }
    addWithDescendants(root.target_id)
  } else if (share.scope === 'api') {
    const root = rootId ? byId.get(rootId) : undefined
    if (!root || root.target_type !== 'api') {
      return { project, targets: [], rootId: null, notFound: true }
    }
    ids.add(root.target_id)
  } else {
    // custom：只保留固定成员；未选父节点由渲染层挂到根，避免泄露祖先正文。
    for (const id of share.target_ids) {
      if (byId.has(id)) ids.add(id)
    }
  }

  const targets = [...ids]
    .map((id) => getTarget(projectId, id))
    .filter((target): target is Target => Boolean(target))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hans-CN'))

  return { project, targets, rootId, notFound: false }
}

export function docShareTypeLabel(share: DocShare): string {
  if (share.scope === 'project') return '项目'
  if (share.scope === 'folder') return '目录'
  if (share.scope === 'custom') return '自定义'
  const resolved = resolveDocShareTargets(share.project_id, share)
  const api = resolved.targets.find((item) => item.target_id === resolved.rootId)
  return api ? docProtocolLabel(api) : 'HTTP'
}

function toDocShareSummary(share: DocShare): DocShareSummary {
  const expire = docExpireInfo(share)
  const typeLabel = docShareTypeLabel(share)
  const resolved = resolveDocShareTargets(share.project_id, share)
  return {
    share_id: share.share_id,
    project_id: share.project_id,
    name: share.name,
    scope: share.scope,
    type_label: typeLabel,
    visibility: share.settings.password ? 'password' : 'public',
    target_count: resolved.targets.filter((item) => item.target_type === 'api').length,
    expire_at: expire.expire_at,
    expire_label: expire.expire_label,
    expired: expire.expired,
    owner: docOwner(),
    created_at: share.created_at,
    updated_at: share.updated_at
  }
}

export function listDocShares(projectId: string): DocShare[] {
  return readDocShares(projectId).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function listDocShareSummaries(projectId: string): DocShareSummary[] {
  return listDocShares(projectId).map(toDocShareSummary)
}

export function getDocShare(projectId: string, shareId: string): DocShare | null {
  return readDocShares(projectId).find((item) => item.share_id === shareId) ?? null
}

export function createDocShare(projectId: string, input: DocShareInput): DocShare {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  const scope = normalizeDocScope(input.scope)
  const targetIds = normalizeDocTargetIds(scope, input.target_ids)
  const now = new Date().toISOString()
  const share: DocShare = {
    share_id: createId('s'),
    project_id: projectId,
    name: (input.name ?? '').trim().slice(0, 120) || '未命名分享',
    scope,
    target_ids: targetIds,
    settings: normalizeDocSettings(input.settings),
    snapshot: buildDocSnapshot(project, projectId, scope, targetIds),
    created_at: now,
    updated_at: now
  }
  const shares = readDocShares(projectId)
  shares.unshift(share)
  writeDocShares(projectId, shares)
  return share
}

export function updateDocShare(
  projectId: string,
  shareId: string,
  input: DocShareInput
): DocShare {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  const shares = readDocShares(projectId)
  const index = shares.findIndex((item) => item.share_id === shareId)
  if (index < 0) throw new Error('分享不存在')
  const existing = shares[index]
  const scope = normalizeDocScope(input.scope)
  const targetIds = normalizeDocTargetIds(scope, input.target_ids)
  const next: DocShare = {
    ...existing,
    name: (input.name ?? '').trim().slice(0, 120) || '未命名分享',
    scope,
    target_ids: targetIds,
    settings: normalizeDocSettings(input.settings),
    snapshot: buildDocSnapshot(project, projectId, scope, targetIds),
    updated_at: new Date().toISOString()
  }
  shares[index] = next
  writeDocShares(projectId, shares)
  return next
}

export function deleteDocShares(projectId: string, shareIds: string[]): void {
  const remove = new Set(shareIds.map((id) => assertId(id, 'share_id')))
  writeDocShares(
    projectId,
    readDocShares(projectId).filter((item) => !remove.has(item.share_id))
  )
}

/**
 * 分享服务面向所有项目，按 share_id 全局查找。
 * 说明：注册表里的 path 可能是旧版本迁移前的路径，这里统一按 project_id
 * 从当前 projectRoot 推导，确保与 createDocShare 的落盘位置一致。
 */
function allDocShareFiles(): string[] {
  return readRegistry().map((entry) =>
    path.join(
      getPaths().projectRoot,
      assertId(entry.project_id, 'project_id'),
      'docs',
      'shares.json'
    )
  )
}

export function findDocShare(shareId: string): DocShare | null {
  const id = assertId(shareId, 'share_id')
  for (const file of allDocShareFiles()) {
    const shares = readJson<DocShare[]>(file, [])
    const hit = shares.find((item) => item.share_id === id)
    if (hit) return hit
  }
  return null
}

export function listAllDocShares(): DocShare[] {
  const result: DocShare[] = []
  for (const file of allDocShareFiles()) {
    result.push(...readJson<DocShare[]>(file, []))
  }
  return result.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function docShareExpireInfo(share: DocShare): {
  expire_at: string | null
  expire_label: string
  expired: boolean
} {
  return docExpireInfo(share)
}
