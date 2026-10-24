import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AppPaths,
  AppSettings,
  DebugConfig,
  DebugState,
  Environment,
  Flow,
  FlowEventResult,
  FlowRun,
  FlowRunSummary,
  GlobalVars,
  McpConfig,
  Project,
  RequestModel,
  SendRecord,
  SendRecordSummary,
  Target,
  TargetSummary
} from '@shared/types'
import { createEnvironment, createProject, createTarget, createRequest } from '@shared/factories'

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
  writeJson(path.join(dir, 'project.json'), project)
  writeJson(path.join(dir, 'apis', 'index.json'), { project_id: project.project_id, items: [] })
  writeJson(path.join(dir, 'envs', 'index.json'), { project_id: project.project_id, items: [] })
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
  target.sort = maxSort + 100
  saveTarget(projectId, target)
  return target
}

export function saveTarget(projectId: string, target: Target): Target {
  if (target.project_id !== projectId) throw new Error('项目不匹配')
  target.updated_at = new Date().toISOString()
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
  }
  index.items = index.items.filter((i) => !toDelete.has(i.target_id))
  writeTargetIndex(projectId, index)
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
  })
  writeTargetIndex(projectId, index)
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
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function getFlow(projectId: string, flowId: string): Flow | null {
  return readJson<Flow | null>(flowPath(projectId, flowId), null)
}

export function saveFlow(projectId: string, flow: Flow): Flow {
  if (flow.project_id !== projectId) throw new Error('项目不匹配')
  flow.updated_at = new Date().toISOString()
  writeJson(flowPath(projectId, flow.flow_id), flow)
  return flow
}

export function deleteFlow(projectId: string, flowId: string): void {
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

export function listFlowRuns(projectId: string, limit = 30): FlowRunSummary[] {
  const dir = runsDir(projectId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson<FlowRun | null>(path.join(dir, file), null))
    .filter((run): run is FlowRun => Boolean(run))
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
  return readJson<FlowRun | null>(runPath(projectId, runId), null)
}

export function saveFlowRun(projectId: string, run: FlowRun): FlowRun {
  if (run.project_id !== projectId) throw new Error('项目不匹配')
  writeJson(runPath(projectId, run.run_id), run)
  return run
}

export function clearFlowRuns(projectId: string): void {
  fs.rmSync(runsDir(projectId), { recursive: true, force: true })
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
