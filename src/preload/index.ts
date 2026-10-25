import { contextBridge, ipcRenderer } from 'electron'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api = {
  paths: () => invoke('app:paths'),
  app: {
    openPath: (targetPath: string) => invoke('app:openPath', targetPath),
    copyText: (text: string) => invoke('app:copyText', text),
    openExternal: (url: string) => invoke('app:openExternal', url),
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

  dictionary: {
    list: (projectId: string) => invoke('dictionary:list', projectId),
    suggestions: (projectId: string) => invoke('dictionary:suggestions', projectId),
    save: (projectId: string, entry: unknown) => invoke('dictionary:save', projectId, entry),
    delete: (projectId: string, id: string) => invoke('dictionary:delete', projectId, id),
    getSettings: (projectId: string) => invoke('dictionary:getSettings', projectId),
    saveSettings: (projectId: string, settings: unknown) =>
      invoke('dictionary:saveSettings', projectId, settings)
  },

  models: {
    list: (projectId: string) => invoke('model:list', projectId),
    listAll: (projectId: string) => invoke('model:listAll', projectId),
    get: (projectId: string, modelId: string) => invoke('model:get', projectId, modelId),
    save: (projectId: string, model: unknown) => invoke('model:save', projectId, model),
    delete: (projectId: string, modelId: string) => invoke('model:delete', projectId, modelId),
    create: (projectId: string, parentId: string, kind: 'model' | 'folder') =>
      invoke('model:create', projectId, parentId, kind),
    copy: (projectId: string, modelId: string, destParentId: string) =>
      invoke('model:copy', projectId, modelId, destParentId),
    move: (projectId: string, modelId: string, destParentId: string, orderedIds?: string[]) =>
      invoke('model:move', projectId, modelId, destParentId, orderedIds),
    reorder: (projectId: string, parentId: string, orderedIds: string[]) =>
      invoke('model:reorder', projectId, parentId, orderedIds),
    references: (projectId: string, modelId: string) =>
      invoke('model:references', projectId, modelId),
    generateExample: (projectId: string, modelId: string) =>
      invoke('model:generateExample', projectId, modelId),
    generateFromSchema: (projectId: string, schema: unknown) =>
      invoke('model:generateFromSchema', projectId, schema),
    resolveRefs: (projectId: string, schema: unknown) =>
      invoke('model:resolveRefs', projectId, schema)
  },

  db: {
    list: (projectId: string) => invoke('db:list', projectId),
    save: (projectId: string, connection: unknown) => invoke('db:save', projectId, connection),
    delete: (projectId: string, dbId: string) => invoke('db:delete', projectId, dbId),
    test: (config: unknown, ssh?: unknown) => invoke('db:test', config, ssh),
    tables: (config: unknown, ssh?: unknown) => invoke('db:tables', config, ssh),
    importTables: (projectId: string, dbId: string, options: unknown) =>
      invoke('db:import', projectId, dbId, options)
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
  },

  docs: {
    list: (projectId: string) => invoke('doc:list', projectId),
    get: (projectId: string, shareId: string) => invoke('doc:get', projectId, shareId),
    create: (projectId: string, input: unknown) => invoke('doc:create', projectId, input),
    update: (projectId: string, shareId: string, input: unknown) =>
      invoke('doc:update', projectId, shareId, input),
    remove: (projectId: string, shareIds: string[]) =>
      invoke('doc:delete', projectId, shareIds),
    serviceStatus: () => invoke('doc:service:get'),
    saveService: (config: unknown) => invoke('doc:service:save', config)
  }
}

contextBridge.exposeInMainWorld('api', api)
