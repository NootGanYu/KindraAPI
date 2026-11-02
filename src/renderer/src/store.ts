import { create } from 'zustand'
import {
  preserveCaseRuns,
  stableJson,
  targetDefinition,
  type TargetChangeEvent,
  type TargetSnapshot
} from '@shared/targetSync'
import { createEnvironment, createId, createParam } from '@shared/factories'
import type {
  AppPaths,
  AppSettings,
  Environment,
  McpConfig,
  McpStatus,
  McpToolInfo,
  Project,
  ResponseExample,
  Result,
  SendRecord,
  Target,
  TargetSummary
} from '@shared/types'

export interface Tab {
  id: string
  name: string
  dirty: boolean
  /** 打开会话标识；异步读取返回时用于丢弃过期结果。 */
  openKey?: string
  /** 最近一次自动同步的来源，用于轻量反馈。 */
  syncedBy?: string
  /** 存在待处理更新时的外部来源。 */
  externalSource?: string
  syncError?: string
  /** 模型内容变化计数；编辑器据此重新解析引用。 */
  modelEpoch?: number
  /** 强制重建编辑器的次数；加载最新版时递增。 */
  resetKey?: number
}

interface AppState {
  ready: boolean
  project: Project | null
  projects: Project[]
  environments: Environment[]
  currentEnvId: string
  settings: AppSettings | null
  paths: AppPaths | null
  targets: TargetSummary[]
  tabs: Tab[]
  activeId: string | null
  drafts: Record<string, Target>
  /** 每个标签最近一次已保存的快照与并发校验标识。 */
  baselines: Record<string, TargetSnapshot>
  /** 外部更新时因本地编辑而暂缓应用的已保存快照。 */
  pendingUpdates: Record<string, TargetSnapshot>
  /** 弹窗等尚未提交的本地输入持有的锁计数。 */
  editLocks: Record<string, number>
  saveConflict: { id: string; snapshot: TargetSnapshot } | null
  syncNotice: string
  records: Record<string, SendRecord | null>
  sendingId: string | null
  mcpConfig: McpConfig | null
  mcpStatus: McpStatus | null
  mcpTools: McpToolInfo[]
  init: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  createProject: (name: string) => Promise<void>
  reloadTargets: () => Promise<void>
  reloadEnvironments: () => Promise<void>
  openTarget: (id: string) => Promise<void>
  createTarget: (parentId: string, type: 'folder' | 'api') => Promise<Target>
  cloneTarget: (id: string) => Promise<Target>
  replaceDraft: (target: Target) => void
  addEnvironment: (name?: string) => Promise<Environment>
  saveTarget: (id: string, confirmedRevision?: string) => Promise<void>
  syncTargets: (event?: TargetChangeEvent) => Promise<void>
  loadLatest: (id: string) => Promise<void>
  saveCopy: (id: string) => Promise<void>
  lockEditing: (id: string, delta: number) => void
  applyDerivedPatch: (id: string, patch: Partial<Target>) => void
  renameTarget: (id: string, name: string) => Promise<void>
  describeTarget: (id: string, description: string) => Promise<void>
  reorderTargets: (parentId: string, orderedIds: string[]) => Promise<void>
  deleteTarget: (id: string) => Promise<void>
  deleteTargets: (ids: string[]) => Promise<void>
  closeTab: (id: string) => void
  setActive: (id: string) => void
  patchDraft: (id: string, patch: Partial<Target>) => void
  setEnv: (envId: string) => Promise<void>
  sendActive: () => Promise<SendRecord>
  saveSettings: (next: AppSettings) => Promise<void>
  reloadMcp: () => Promise<void>
  saveMcp: (next: McpConfig) => Promise<void>
  regenerateMcpToken: () => Promise<void>
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

let treeReadSequence = 0
const ownSaves = new Set<string>()
const targetReads = new Map<string, number>()

export function hasLocalEdits(id: string): boolean {
  const state = useApp.getState()
  return !!state.tabs.find(tab => tab.id === id)?.dirty || (state.editLocks[id] ?? 0) > 0
}

/** 标签上展示的外部更新来源；MCP 之外的协同写入统一记为“外部”。 */
function externalLabel(id: string): string {
  return useApp.getState().tabs.find(tab => tab.id === id)?.externalSource ?? '外部'
}

interface RefreshOptions {
  /** 外部更新的展示来源；local 时忽略。 */
  source?: string
  force?: boolean
  runtimeOnly?: boolean
  modelsChanged?: boolean
  /** 同一次界面操作已由本地应用：只校准并发基线，不显示为外部更新。 */
  local?: boolean
}

async function refreshOpenTarget(id: string, options: RefreshOptions = {}): Promise<void> {
  const { source = '外部', force = false, runtimeOnly = false, modelsChanged = false, local = false } = options
  const before = useApp.getState()
  const projectId = before.project?.project_id, tab = before.tabs.find(tab => tab.id === id)
  if (!projectId || !tab) return
  const key = `${projectId}:${id}`, sequence = (targetReads.get(key) ?? 0) + 1
  targetReads.set(key, sequence)
  try {
    const snapshot = unwrap(await window.api.targets.read(projectId, id))
    const state = useApp.getState()
    if (state.project?.project_id !== projectId || state.tabs.find(item => item.id === id)?.openKey !== tab.openKey || targetReads.get(key) !== sequence) return
    if (runtimeOnly && snapshot.target) {
      useApp.setState(current => {
        const draft = current.drafts[id]
        if (!draft) return current
        return { drafts: { ...current.drafts, [id]: preserveCaseRuns(draft, snapshot.target) } }
      })
      return
    }
    const changed = snapshot.revision !== state.baselines[id]?.revision
    if (!force && !changed && !modelsChanged) {
      useApp.setState(current => ({ tabs: current.tabs.map(item => item.id === id ? { ...item, syncError: undefined } : item) }))
      return
    }
    if (!snapshot.target) {
      // 删除永远不丢弃本地内容：没有本地编辑才关闭标签，否则保留草稿并提供复制/另存。
      if (local || !hasLocalEdits(id)) {
        if (!local) {
          useApp.setState(current => ({
            syncNotice: `${source} 已删除「${tab.name}」，标签已关闭`,
            saveConflict: current.saveConflict?.id === id ? null : current.saveConflict
          }))
        }
        useApp.getState().closeTab(id)
        return
      }
      useApp.setState(current => ({
        pendingUpdates: { ...current.pendingUpdates, [id]: snapshot },
        saveConflict: current.saveConflict?.id === id ? { id, snapshot } : current.saveConflict,
        tabs: current.tabs.map(item => item.id === id ? { ...item, externalSource: source, syncError: undefined } : item)
      }))
      return
    }
    if (local) {
      const edited = hasLocalEdits(id)
      useApp.setState(current => {
        const pendingUpdates = { ...current.pendingUpdates }
        if (!edited) delete pendingUpdates[id]
        const tabs = edited ? current.tabs : current.tabs.map(item => item.id === id ? {
          ...item, name: snapshot.target!.name, dirty: false, syncError: undefined,
          // 普通保存不需要重建编辑器；只有模型内容变化时才让编辑器重新解析引用。
          modelEpoch: (item.modelEpoch ?? 0) + (modelsChanged ? 1 : 0),
          resetKey: (item.resetKey ?? 0) + (force ? 1 : 0)
        } : item)
        return {
          baselines: { ...current.baselines, [id]: snapshot },
          pendingUpdates,
          ...(edited ? {} : { drafts: { ...current.drafts, [id]: snapshot.target! } }),
          tabs
        }
      })
      return
    }
    if (!force && hasLocalEdits(id)) {
      useApp.setState(current => ({ pendingUpdates: { ...current.pendingUpdates, [id]: snapshot },
        tabs: current.tabs.map(item => item.id === id ? { ...item, externalSource: source, syncError: undefined } : item) }))
      return
    }
    useApp.setState(current => {
      const pendingUpdates = { ...current.pendingUpdates }; delete pendingUpdates[id]
      return {
        drafts: { ...current.drafts, [id]: snapshot.target! },
        baselines: { ...current.baselines, [id]: snapshot }, pendingUpdates,
        saveConflict: current.saveConflict?.id === id ? null : current.saveConflict,
        tabs: current.tabs.map(item => item.id === id ? { ...item, name: snapshot.target!.name, dirty: false,
          externalSource: undefined, syncError: undefined, syncedBy: source,
          modelEpoch: (item.modelEpoch ?? 0) + (modelsChanged ? 1 : 0), resetKey: (item.resetKey ?? 0) + (force ? 1 : 0) } : item)
      }
    })
  } catch (error) {
    if (useApp.getState().project?.project_id === projectId && targetReads.get(key) === sequence) {
      useApp.setState(current => ({ tabs: current.tabs.map(item => item.id === id ? { ...item, syncError: (error as Error).message } : item) }))
    }
    throw error
  }
}

/** 在初始化读取之前订阅；路由切换不影响监听。 */
export function connectTargetSync(): () => void {
  const sync = (event?: TargetChangeEvent): void => { void useApp.getState().syncTargets(event).catch(() => undefined) }
  const off = window.api.targets.onChanged(sync)
  const onFocus = (): void => sync()
  window.addEventListener('focus', onFocus)
  return () => { off(); window.removeEventListener('focus', onFocus) }
}

export function exampleFromRecord(record: SendRecord): ResponseExample {
  const response = record.response
  const headers = Object.entries(response?.headers ?? {}).map(([key, value]) =>
    createParam({ key, value: String(value) })
  )
  const cookies = (response?.cookies ?? []).map((cookie) =>
    createParam({ key: String(cookie.name ?? ''), value: String(cookie.value ?? '') })
  )
  const contentType =
    Object.entries(response?.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'content-type'
    )?.[1] ?? 'application/json'
  const requestBody =
    record.request.body === undefined || record.request.body === null
      ? ''
      : typeof record.request.body === 'string'
        ? record.request.body
        : JSON.stringify(record.request.body, null, 2)
  return {
    example_id: createId('ex'),
    expect: {
      name: '实时响应',
      code: response?.code ?? 0,
      content_type: String(contentType),
      is_default: 1
    },
    raw: response?.body ?? '',
    raw_parameter: headers,
    headers,
    cookies,
    request: {
      body_mode: record.request.mode,
      method: record.request.method,
      url: record.request.url,
      headers: Object.entries(record.request.headers ?? {}).map(([key, value]) =>
        createParam({ key, value: String(value) })
      ),
      body: requestBody
    }
  }
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  project: null,
  projects: [],
  environments: [],
  currentEnvId: '',
  settings: null,
  paths: null,
  targets: [],
  tabs: [],
  activeId: null,
  drafts: {},
  baselines: {},
  pendingUpdates: {},
  editLocks: {},
  saveConflict: null,
  syncNotice: '',
  records: {},
  sendingId: null,
  mcpConfig: null,
  mcpStatus: null,
  mcpTools: [],

  init: async () => {
    const project = unwrap(await window.api.projects.ensureDefault())
    const projects = unwrap(await window.api.projects.list())
    let environments = unwrap(await window.api.envs.list(project.project_id))
    if (environments.length === 0) {
      const created = unwrap(
        await window.api.envs.save(project.project_id, {
          env_id: `e${Date.now().toString(16)}`,
          project_id: project.project_id,
          name: '默认环境',
          env_var_list: {},
          server_list: [{ server_id: '1', name: 'default', uri: '', sort: 1000 }],
          sort: 1000,
          is_private: -1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as Environment)
      )
      environments = [created]
    }
    const settings = unwrap(await window.api.settings.get())
    const paths = unwrap(await window.api.paths())
    const currentEnvId =
      environments.find((e) => e.env_id === settings.environment_id)?.env_id ??
      environments[0]?.env_id ??
      ''
    const targets = unwrap(await window.api.targets.list(project.project_id))
    const mcpConfig = unwrap(await window.api.mcp.getConfig())
    const mcpStatus = unwrap(await window.api.mcp.status())
    const mcpTools = unwrap(await window.api.mcp.tools())
    set({
      ready: true,
      project,
      projects,
      environments,
      settings,
      paths,
      currentEnvId,
      targets,
      mcpConfig,
      mcpStatus,
      mcpTools
    })
    await get().syncTargets()
  },

  selectProject: async (projectId) => {
    const previous = get().project
    if (previous && previous.project_id !== projectId) {
      try {
        await window.api.mqtt.disconnectAll(previous.project_id)
      } catch {
        // 会话清理失败不应阻止项目切换。
      }
    }
    const projects = get().projects.length
      ? get().projects
      : unwrap(await window.api.projects.list())
    const project = projects.find((item) => item.project_id === projectId)
    if (!project) throw new Error('项目不存在')
    let environments = unwrap(await window.api.envs.list(projectId))
    if (environments.length === 0) {
      const created = unwrap(await window.api.envs.save(projectId, createEnvironment(projectId)))
      environments = [created]
    }
    const settings = unwrap(await window.api.settings.get())
    const paths = unwrap(await window.api.paths())
    const currentEnvId =
      environments.find((e) => e.env_id === settings.environment_id)?.env_id ??
      environments[0]?.env_id ??
      ''
    const targets = unwrap(await window.api.targets.list(projectId))
    set({
      project,
      environments,
      settings,
      paths,
      currentEnvId,
      targets,
      tabs: [],
      activeId: null,
      drafts: {},
      baselines: {},
      pendingUpdates: {},
      editLocks: {},
      saveConflict: null,
      syncNotice: '',
      records: {},
      sendingId: null
    })
    await get().syncTargets()
  },

  createProject: async (name) => {
    const project = unwrap(await window.api.projects.create(name))
    const projects = unwrap(await window.api.projects.list())
    set({ projects })
    await get().selectProject(project.project_id)
  },

  reloadTargets: async () => {
    const project = get().project
    if (!project) return
    const sequence = ++treeReadSequence
    const targets = unwrap(await window.api.targets.list(project.project_id))
    if (get().project?.project_id === project.project_id && sequence === treeReadSequence) set({ targets })
  },

  reloadEnvironments: async () => {
    const project = get().project
    if (!project) return
    const environments = unwrap(await window.api.envs.list(project.project_id))
    set({
      environments,
      currentEnvId: environments.some((e) => e.env_id === get().currentEnvId)
        ? get().currentEnvId
        : environments[0]?.env_id ?? ''
    })
  },

  openTarget: async (id) => {
    const project = get().project
    if (!project) return
    const existing = get().tabs.find((t) => t.id === id)
    if (existing) {
      set({ activeId: id })
      return
    }
    const snapshot = unwrap(await window.api.targets.read(project.project_id, id))
    const target = snapshot.target
    if (!target) return
    if (get().project?.project_id !== project.project_id || get().tabs.some(tab => tab.id === id)) return
    set((state) => ({
      drafts: { ...state.drafts, [id]: target },
      baselines: { ...state.baselines, [id]: snapshot },
      tabs: [...state.tabs, { id, name: target.name, dirty: false, openKey: createId('tab') }],
      activeId: id
    }))
  },

  createTarget: async (parentId, type) => {
    const project = get().project
    if (!project) throw new Error('项目未就绪')
    const target = unwrap(await window.api.targets.create(project.project_id, parentId, type))
    await get().reloadTargets()
    if (type === 'api') {
      await get().openTarget(target.target_id)
    }
    return target
  },

  cloneTarget: async (id) => {
    const project = get().project
    if (!project) throw new Error('项目未就绪')
    const target = unwrap(await window.api.targets.clone(project.project_id, id))
    await get().reloadTargets()
    await get().openTarget(target.target_id)
    return target
  },

  replaceDraft: (target) => {
    set((state) => ({
      drafts: { ...state.drafts, [target.target_id]: target },
      baselines: { ...state.baselines, [target.target_id]: { target, revision: null } },
      tabs: state.tabs.map((tab) =>
        tab.id === target.target_id
          ? { ...tab, name: target.name, dirty: false }
          : tab
      )
    }))
    void refreshOpenTarget(target.target_id, { local: true }).catch(() => undefined)
  },

  addEnvironment: async (name = '新环境') => {
    const project = get().project
    if (!project) throw new Error('项目未就绪')
    const env = unwrap(
      await window.api.envs.save(project.project_id, createEnvironment(project.project_id, name))
    )
    await get().reloadEnvironments()
    await get().setEnv(env.env_id)
    return env
  },

  saveTarget: async (id, confirmedRevision) => {
    const project = get().project
    const draft = get().drafts[id]
    if (!project || !draft) return
    const tabKey = get().tabs.find(tab => tab.id === id)?.openKey
    const revision = confirmedRevision ?? get().baselines[id]?.revision
    if (!revision) throw new Error('正在读取接口最新状态，请稍后保存')
    const payload = draft
    const operationId = createId('save')
    ownSaves.add(operationId)
    try {
      const outcome = unwrap(await window.api.targets.saveChecked(project.project_id, payload, revision, operationId))
      if (get().project?.project_id !== project.project_id || get().tabs.find(tab => tab.id === id)?.openKey !== tabKey) return
      if (outcome.status !== 'saved') {
        const snapshot = { target: outcome.target, revision: outcome.revision }
        set(state => ({ pendingUpdates: { ...state.pendingUpdates, [id]: snapshot },
          saveConflict: { id, snapshot }, tabs: state.tabs.map(tab => tab.id === id ? { ...tab, externalSource: tab.externalSource ?? '外部' } : tab) }))
        throw new Error(outcome.status === 'deleted' ? '接口已被删除，请复制内容或另存为新接口' : '接口已更新，请先处理保存冲突')
      }
      set(state => {
        const current = state.drafts[id]
        // 保存期间可能只更新了用例运行结果（不属于定义），不能据此把标签标脏。
        const unchanged = !!current && stableJson(targetDefinition(current)) === stableJson(targetDefinition(payload))
        const pendingUpdates = { ...state.pendingUpdates }; delete pendingUpdates[id]
        return {
          baselines: { ...state.baselines, [id]: { target: outcome.target, revision: outcome.revision } },
          drafts: unchanged ? { ...state.drafts, [id]: outcome.target } : state.drafts,
          tabs: state.tabs.map(tab => tab.id === id ? { ...tab, name: (unchanged ? outcome.target : state.drafts[id]).name,
            dirty: !unchanged, externalSource: undefined, syncedBy: undefined, syncError: undefined } : tab),
          pendingUpdates, saveConflict: null
        }
      })
      await get().reloadTargets()
      await refreshOpenTarget(id, { local: true })
    } finally {
      // 主进程的变更事件可能晚于 IPC 结果到达；保留一小段时间，避免把本次保存误判为外部更新。
      setTimeout(() => ownSaves.delete(operationId), 2000)
    }
  },

  syncTargets: async (event) => {
    const projectId = get().project?.project_id
    if (!projectId || (event && event.projectId !== projectId)) return
    // 界面自己发起的写入已经本地应用；只校准基线并刷新运行结果，不再提示“外部更新”。
    const local = !!event && (event.source === 'ui' || ownSaves.has(event.operationId))
    const source = event?.source === 'mcp' ? 'MCP' : '外部'
    const runtimeIds = new Set(event ? event.changes.filter(change => change.kind === 'runtime').map(change => change.targetId) : [])
    const ids = new Set(event ? event.changes.map(change => change.targetId) : get().tabs.map(tab => tab.id))
    if (event?.modelsChanged) {
      for (const tab of get().tabs) {
        const target = get().drafts[tab.id]
        if (target?.request?.body.model_id || target?.response?.example?.some(example => example.expect?.model_id)) ids.add(tab.id)
      }
    }
    await Promise.all([
      get().reloadTargets(),
      ...[...ids].filter(id => get().tabs.some(tab => tab.id === id)).map(id =>
        refreshOpenTarget(id, { source, runtimeOnly: runtimeIds.has(id), modelsChanged: !!event?.modelsChanged, local }))
    ])
  },

  loadLatest: async (id) => { await refreshOpenTarget(id, { source: externalLabel(id), force: true }) },

  saveCopy: async (id) => {
    const projectId = get().project?.project_id, draft = get().drafts[id]
    if (!projectId || !draft) return
    const saved = unwrap(await window.api.targets.saveCopy(projectId, draft))
    if (get().project?.project_id !== projectId) return
    await get().reloadTargets()
    await get().openTarget(saved.target_id)
  },

  lockEditing: (id, delta) => {
    set(state => ({ editLocks: { ...state.editLocks, [id]: Math.max(0, (state.editLocks[id] ?? 0) + delta) } }))
    if (delta < 0 && !hasLocalEdits(id) && get().pendingUpdates[id]) {
      void refreshOpenTarget(id, { source: externalLabel(id) }).catch(() => undefined)
    }
  },

  applyDerivedPatch: (id, patch) => {
    if (hasLocalEdits(id)) return
    set(state => state.drafts[id] ? { drafts: { ...state.drafts, [id]: { ...state.drafts[id], ...patch } } } : state)
  },

  renameTarget: async (id, name) => {
    const project = get().project
    const trimmed = name.trim()
    if (!project || !trimmed) return
    if (get().tabs.some(tab => tab.id === id)) {
      get().patchDraft(id, { name: trimmed })
      await get().saveTarget(id)
      return
    }
    const snapshot = unwrap(await window.api.targets.read(project.project_id, id))
    const target = snapshot.target
    if (!target) return
    const saved = unwrap(await window.api.targets.saveChecked(project.project_id, { ...target, name: trimmed }, snapshot.revision!, createId('rename')))
    if (saved.status !== 'saved') throw new Error('接口已更新，请重新编辑名称')
    await get().reloadTargets()
  },

  describeTarget: async (id, description) => {
    const project = get().project
    if (!project) return
    if (get().tabs.some(tab => tab.id === id)) {
      get().patchDraft(id, { description })
      await get().saveTarget(id)
      return
    }
    const snapshot = unwrap(await window.api.targets.read(project.project_id, id))
    const target = snapshot.target
    if (!target) return
    const saved = unwrap(await window.api.targets.saveChecked(project.project_id, { ...target, description }, snapshot.revision!, createId('describe')))
    if (saved.status !== 'saved') throw new Error('接口已更新，请重新编辑说明')
    await get().reloadTargets()
  },

  reorderTargets: async (parentId, orderedIds) => {
    const project = get().project
    if (!project) return
    const targets = unwrap(
      await window.api.targets.reorder(project.project_id, parentId, orderedIds)
    )
    set((state) => {
      const drafts = { ...state.drafts }
      for (const summary of targets) {
        const draft = drafts[summary.target_id]
        if (draft) {
          drafts[summary.target_id] = {
            ...draft,
            parent_id: summary.parent_id,
            sort: summary.sort
          }
        }
      }
      return { targets, drafts }
    })
  },

  deleteTarget: async (id) => {
    const project = get().project
    if (!project) return
    unwrap(await window.api.targets.delete(project.project_id, id))
    await get().reloadTargets()
    get().closeTab(id)
    set((state) => {
      const drafts = { ...state.drafts }
      delete drafts[id]
      return { drafts }
    })
  },

  deleteTargets: async (ids) => {
    const project = get().project
    if (!project || ids.length === 0) return
    for (const id of ids) {
      unwrap(await window.api.targets.delete(project.project_id, id))
    }
    const removed = new Set(ids)
    await get().reloadTargets()
    for (const id of ids) get().closeTab(id)
    set((state) => {
      const drafts = { ...state.drafts }
      for (const id of removed) delete drafts[id]
      return { drafts }
    })
  },

  closeTab: (id) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id)
      const tabs = state.tabs.filter((t) => t.id !== id)
      let activeId = state.activeId
      if (state.activeId === id) {
        activeId = tabs[Math.max(0, index - 1)]?.id ?? tabs[0]?.id ?? null
      }
      const drafts = { ...state.drafts }, baselines = { ...state.baselines }, pendingUpdates = { ...state.pendingUpdates }, editLocks = { ...state.editLocks }
      delete drafts[id]; delete baselines[id]; delete pendingUpdates[id]; delete editLocks[id]
      return { tabs, activeId, drafts, baselines, pendingUpdates, editLocks,
        saveConflict: state.saveConflict?.id === id ? null : state.saveConflict }
    })
  },

  setActive: (id) => set({ activeId: id }),

  patchDraft: (id, patch) => {
    set((state) => {
      const draft = state.drafts[id]
      if (!draft) return state
      const next = { ...draft, ...patch }
      if (stableJson(targetDefinition(draft)) === stableJson(targetDefinition(next))) return state
      return {
        drafts: { ...state.drafts, [id]: next },
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, dirty: true, name: patch.name ?? t.name, syncedBy: undefined } : t
        )
      }
    })
  },

  setEnv: async (envId) => {
    set({ currentEnvId: envId })
    const settings = get().settings
    if (settings) {
      const next = { ...settings, environment_id: envId }
      set({ settings: next })
      try {
        unwrap(await window.api.settings.save(next))
      } catch {
        // non-fatal
      }
    }
  },

  sendActive: async () => {
    const { project, activeId, drafts, currentEnvId } = get()
    if (!project || !activeId) throw new Error('没有打开接口')
    const draft = drafts[activeId]
    if (!draft) throw new Error('接口草稿不存在')
    set({ sendingId: activeId })
    try {
      const record = unwrap(await window.api.http.send(project.project_id, draft, currentEnvId))
      set((state) => ({ records: { ...state.records, [activeId]: record } }))
      return record
    } finally {
      set({ sendingId: null })
    }
  },

  saveSettings: async (next) => {
    const saved = unwrap(await window.api.settings.save(next))
    set({ settings: saved })
  },

  reloadMcp: async () => {
    const mcpConfig = unwrap(await window.api.mcp.getConfig())
    const mcpStatus = unwrap(await window.api.mcp.status())
    const mcpTools = unwrap(await window.api.mcp.tools())
    set({ mcpConfig, mcpStatus, mcpTools })
  },

  saveMcp: async (next) => {
    const result = unwrap(await window.api.mcp.saveConfig(next))
    set({ mcpConfig: result.config, mcpStatus: result.status })
  },

  regenerateMcpToken: async () => {
    const result = unwrap(await window.api.mcp.regenerateToken())
    set({ mcpConfig: result.config, mcpStatus: result.status })
  }
}))

/** 模型内容变化后递增，编辑器以此重新解析引用。 */
export function useModelEpoch(targetId: string | null | undefined): number {
  return useApp((state) => state.tabs.find((tab) => tab.id === targetId)?.modelEpoch ?? 0)
}
