import { create } from 'zustand'
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
  saveTarget: (id: string) => Promise<void>
  renameTarget: (id: string, name: string) => Promise<void>
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

function exampleFromRecord(record: SendRecord): ResponseExample {
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
  },

  selectProject: async (projectId) => {
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
      records: {},
      sendingId: null
    })
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
    const targets = unwrap(await window.api.targets.list(project.project_id))
    set({ targets })
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
    const target = unwrap(await window.api.targets.get(project.project_id, id))
    if (!target) return
    set((state) => ({
      drafts: { ...state.drafts, [id]: target },
      tabs: [...state.tabs, { id, name: target.name, dirty: false }],
      activeId: id
    }))
  },

  createTarget: async (parentId, type) => {
    const project = get().project
    if (!project) throw new Error('项目未就绪')
    const target = unwrap(await window.api.targets.create(project.project_id, parentId, type))
    await get().reloadTargets()
    if (type === 'api') {
      set((state) => ({
        drafts: { ...state.drafts, [target.target_id]: target },
        tabs: [...state.tabs, { id: target.target_id, name: target.name, dirty: false }],
        activeId: target.target_id
      }))
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
      tabs: state.tabs.map((tab) =>
        tab.id === target.target_id
          ? { ...tab, name: target.name, dirty: false }
          : tab
      )
    }))
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

  saveTarget: async (id) => {
    const project = get().project
    const draft = get().drafts[id]
    if (!project || !draft) return
    const record = get().records[id]
    const hasModelExample = (draft.response?.example ?? []).some(
      (example) => Boolean(example.expect?.model_id)
    )
    const payload =
      record?.response != null && !hasModelExample
        ? { ...draft, response: { example: [exampleFromRecord(record)] } }
        : draft
    const saved = unwrap(await window.api.targets.save(project.project_id, payload))
    set((state) => ({
      drafts: { ...state.drafts, [id]: saved },
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, name: saved.name, dirty: false } : t))
    }))
    await get().reloadTargets()
  },

  renameTarget: async (id, name) => {
    const project = get().project
    const trimmed = name.trim()
    if (!project || !trimmed) return
    const draft = get().drafts[id]
    const target = draft ?? unwrap(await window.api.targets.get(project.project_id, id))
    if (!target) return
    const saved = unwrap(
      await window.api.targets.save(project.project_id, { ...target, name: trimmed })
    )
    set((state) => ({
      drafts: state.drafts[id] ? { ...state.drafts, [id]: saved } : state.drafts,
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, name: saved.name, dirty: false } : t))
    }))
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
      return { tabs, activeId }
    })
  },

  setActive: (id) => set({ activeId: id }),

  patchDraft: (id, patch) => {
    set((state) => {
      const draft = state.drafts[id]
      if (!draft) return state
      return {
        drafts: { ...state.drafts, [id]: { ...draft, ...patch } },
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, dirty: true, name: patch.name ?? t.name } : t
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
