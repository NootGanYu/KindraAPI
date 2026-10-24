import { contextBridge, ipcRenderer } from 'electron'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api = {
  paths: () => invoke('app:paths'),
  app: {
    openPath: (targetPath: string) => invoke('app:openPath', targetPath),
    copyText: (text: string) => invoke('app:copyText', text),
    relaunch: () => invoke('app:relaunch')
  },

  debug: {
    get: () => invoke('debug:get'),
    save: (config: unknown) => invoke('debug:save', config)
  },

  projects: {
    list: () => invoke('project:list'),
    create: (name: string) => invoke('project:create', name),
    save: (project: unknown) => invoke('project:save', project),
    ensureDefault: () => invoke('project:ensureDefault')
  },

  targets: {
    list: (projectId: string) => invoke('target:list', projectId),
    get: (projectId: string, targetId: string) => invoke('target:get', projectId, targetId),
    create: (projectId: string, parentId: string, type: 'folder' | 'api') =>
      invoke('target:create', projectId, parentId, type),
    save: (projectId: string, target: unknown) => invoke('target:save', projectId, target),
    delete: (projectId: string, targetId: string) => invoke('target:delete', projectId, targetId),
    reorder: (projectId: string, parentId: string, orderedIds: string[]) =>
      invoke('target:reorder', projectId, parentId, orderedIds)
  },

  envs: {
    list: (projectId: string) => invoke('env:list', projectId),
    save: (projectId: string, env: unknown) => invoke('env:save', projectId, env)
  },

  globals: {
    get: (projectId: string) => invoke('globals:get', projectId),
    save: (projectId: string, vars: unknown) => invoke('globals:save', projectId, vars)
  },

  globalParams: {
    get: (projectId: string) => invoke('globalParams:get', projectId),
    save: (projectId: string, request: unknown) => invoke('globalParams:save', projectId, request)
  },

  settings: {
    get: () => invoke('settings:get'),
    save: (settings: unknown) => invoke('settings:save', settings)
  },

  http: {
    send: (projectId: string, target: unknown, environmentId?: string) =>
      invoke('http:send', projectId, target, environmentId)
  },

  history: {
    list: (projectId: string) => invoke('history:list', projectId),
    get: (projectId: string, recordId: string) => invoke('history:get', projectId, recordId),
    delete: (projectId: string, recordId: string) => invoke('history:delete', projectId, recordId),
    clear: (projectId: string) => invoke('history:clear', projectId)
  },

  flows: {
    list: (projectId: string) => invoke('flow:list', projectId),
    get: (projectId: string, flowId: string) => invoke('flow:get', projectId, flowId),
    create: (projectId: string, name: string) => invoke('flow:create', projectId, name),
    save: (projectId: string, flow: unknown) => invoke('flow:save', projectId, flow),
    delete: (projectId: string, flowId: string) => invoke('flow:delete', projectId, flowId),
    run: (projectId: string, flowId: string, environmentId?: string) =>
      invoke('flow:run', projectId, flowId, environmentId),
    runs: (projectId: string, limit?: number) => invoke('flow:runs', projectId, limit),
    getRun: (projectId: string, runId: string) => invoke('flow:run:get', projectId, runId)
  },

  mcp: {
    getConfig: () => invoke('mcp:config:get'),
    saveConfig: (config: unknown) => invoke('mcp:config:save', config),
    regenerateToken: () => invoke('mcp:token:regen'),
    status: () => invoke('mcp:status'),
    tools: () => invoke('mcp:tools'),
    infoPath: () => invoke('mcp:info:path'),
    stdioPath: () => invoke('mcp:stdio:path')
  }
}

contextBridge.exposeInMainWorld('api', api)
