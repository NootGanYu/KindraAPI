import { contextBridge, ipcRenderer, webUtils } from 'electron'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const subscribe = (
  channel: string,
  callback: (payload: unknown) => void
): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  agent: {
    cancelTurnUndo: (pid: string, id: string) => invoke('agent:cancelTurnUndo', pid, id),
    listUndoTurns: (pid: string) => invoke('agent:listUndoTurns', pid),
    listTurnUndos: (pid: string) => invoke('agent:listTurnUndos', pid),
    previewTurnUndo: (pid: string, planId: string) => invoke('agent:previewTurnUndo', pid, planId),
    applyTurnUndo: (pid: string, id: string, reviewId: string, choices: unknown) => invoke('agent:applyTurnUndo', pid, id, reviewId, choices),
    deleteProjectAgentRecords: (pid: string) => invoke('agent:deleteProjectAgentRecords', pid),
    getDeletedObject: (pid: string, kind: 'api' | 'flow', id: string) => invoke('agent:getDeletedObject', pid, kind, id),
    restoreDeletedApiDraft: (pid: string, id: string, deletionId: string) => invoke('agent:restoreDeletedApiDraft', pid, id, deletionId),
    saveDeletedApiDraft: (pid: string, id: string, deletionId: string, signature: string) => invoke('agent:saveDeletedApiDraft', pid, id, deletionId, signature),
    restoreDeletedFlowDraft: (pid: string, id: string, deletionId: string) => invoke('agent:restoreDeletedFlowDraft', pid, id, deletionId),
    saveDeletedFlowDraft: (pid: string, id: string, deletionId: string, signature: string) => invoke('agent:saveDeletedFlowDraft', pid, id, deletionId, signature),
    listFlowVersions: (pid: string, id: string) => invoke('agent:listFlowVersions', pid, id),
    getFlowVersion: (pid: string, id: string, versionId: string) => invoke('agent:getFlowVersion', pid, id, versionId),
    restoreFlowVersionDraft: (pid: string, id: string, versionId: string) => invoke('agent:restoreFlowVersionDraft', pid, id, versionId),
    restoreFlowCandidate: (pid: string, id: string) => invoke('agent:restoreFlowCandidate', pid, id),
    reloadFlowDraft: (pid: string, id: string, signature: string) => invoke('agent:reloadFlowDraft', pid, id, signature),
    getFlowDraft: (pid: string, id: string) => invoke('agent:getFlowDraft', pid, id),
    syncFlowEditorDraft: (pid: string, flow: unknown) => invoke('agent:syncFlowEditorDraft', pid, flow),
    saveManualFlowForRun: (pid: string, flow: unknown) => invoke('agent:saveManualFlowForRun', pid, flow),
    listAgentFlowDrafts: (pid: string) => invoke('agent:listAgentFlowDrafts', pid),
    listFlowCandidates: (pid: string, id?: string) => invoke('agent:listFlowCandidates', pid, id),
    applyFlowCandidate: (pid: string, id: string) => invoke('agent:applyFlowCandidate', pid, id),
    rejectFlowCandidate: (pid: string, id: string) => invoke('agent:rejectFlowCandidate', pid, id),
    resolveFlowCandidate: (pid: string, id: string, reviewId: string, choices: unknown) => invoke('agent:resolveFlowCandidate', pid, id, reviewId, choices),
    onFlowDraftChanged: (callback: (event: unknown) => void) => subscribe('agent:flow-draft-changed', callback),
    releaseEditorDraft: (projectId: string, id: string) => invoke('agent:releaseEditorDraft', projectId, id),
    resolveCandidate: (projectId: string, id: string, reviewId: string, choices: unknown) => invoke('agent:resolveCandidate', projectId, id, reviewId, choices),
    saveManualDraftOnQuit: (projectId: string, target: unknown, revision: string) => invoke('agent:saveManualDraftOnQuit', projectId, target, revision),
    getDraft: (projectId: string, targetId: string) => invoke('agent:getDraft', projectId, targetId),
    syncEditorDraft: (projectId: string, target: unknown, baseRevision?: string | null) => invoke('agent:syncEditorDraft', projectId, target, baseRevision),
    listAgentDrafts: (projectId: string) => invoke('agent:listAgentDrafts', projectId),
    listCandidates: (projectId: string, targetId?: string) => invoke('agent:listCandidates', projectId, targetId),
    restoreCandidate: (projectId: string, id: string) => invoke('agent:restoreCandidate', projectId, id),
    rejectCandidate: (projectId: string, id: string) => invoke('agent:rejectCandidate', projectId, id),
    undoCandidate: (projectId: string, id: string) => invoke('agent:undoCandidate', projectId, id),
    resolveCandidateUndo: (projectId: string, id: string, reviewId: string, choices: unknown) => invoke('agent:resolveCandidateUndo', projectId, id, reviewId, choices),
    applyCandidate: (projectId: string, candidateId: string) => invoke('agent:applyCandidate', projectId, candidateId),
    onDraftChanged: (callback: (event: unknown) => void) => subscribe('agent:draft-changed', callback),
    getActivity: () => invoke('agent:getActivity'),
    prepareQuit: () => invoke('agent:prepareQuit'),
    proposeCreateApiPlan: (projectId: string, input: unknown) => invoke('agent:proposeCreateApiPlan', projectId, input),
    listProjectCandidates: (projectId: string) => invoke('agent:listProjectCandidates', projectId),
    proposeSavePlan: (projectId: string, input: unknown) => invoke('agent:proposeSavePlan', projectId, input),
    proposeExecuteCasePlan: (projectId: string, input: unknown) => invoke('agent:proposeExecuteCasePlan', projectId, input),
    proposeExecutePlan: (projectId: string, input: unknown) => invoke('agent:proposeExecutePlan', projectId, input),
    cancelPlan: (projectId: string, id: string) => invoke('agent:cancelPlan', projectId, id),
    proposeEditPlan: (projectId: string, input: unknown) => invoke('agent:proposeEditPlan', projectId, input),
    proposeReadPlan: (projectId: string, input: unknown) => invoke('agent:proposeReadPlan', projectId, input),
    proposeTaskPlan: (projectId: string, input: unknown) => invoke('agent:proposeTaskPlan', projectId, input),
    getPlan: (projectId: string, id: string) => invoke('agent:getPlan', projectId, id),
    listPlans: (projectId: string) => invoke('agent:listPlans', projectId),
    resumePlan: (projectId: string, id: string, stepIds: string[]) => invoke('agent:resumePlan', projectId, id, stepIds),
    approvePlan: (projectId: string, id: string, expectedRevision?: number) => invoke('agent:approvePlan', projectId, id, expectedRevision),
    rejectPlan: (projectId: string, id: string) => invoke('agent:rejectPlan', projectId, id),
    deletePlan: (projectId: string, id: string) => invoke('agent:deletePlan', projectId, id),
    onPlanChanged: (callback: (event: unknown) => void) => subscribe('agent:plan-changed', callback),
    getConnection: (connectionId?: string) => invoke('agent:getConnection', connectionId),
    listConnections: () => invoke('agent:listConnections'),
    createConnection: (input: unknown) => invoke('agent:createConnection', input),
    deleteConnection: (connectionId: string) => invoke('agent:deleteConnection', connectionId),
    getProjectConnection: (projectId: string) => invoke('agent:getProjectConnection', projectId),
    setProjectConnection: (projectId: string, connectionId: string | null) => invoke('agent:setProjectConnection', projectId, connectionId),
    saveConnection: (input: unknown, connectionId?: string) => invoke('agent:saveConnection', input, connectionId),
    testConnection: (connectionId?: string) => invoke('agent:testConnection', connectionId),
    createConversation: (projectId: string) => invoke('agent:createConversation', projectId),
    renameConversation: (projectId: string, id: string, title: string) => invoke('agent:renameConversation', projectId, id, title),
    listConversations: (projectId: string) => invoke('agent:listConversations', projectId),
    getConversation: (projectId: string, id: string) => invoke('agent:getConversation', projectId, id),
    deleteConversation: (projectId: string, id: string) => invoke('agent:deleteConversation', projectId, id),
    sendMessage: (projectId: string, id: string, content: string, connectionId?: string, options?: { activeTargetId?: string; activeFlowId?: string; activeEnvId?: string; permissionMode?: string }) => invoke('agent:sendMessage', projectId, id, content, connectionId, options),
    cancelMessage: (projectId: string, id: string) => invoke('agent:cancelMessage', projectId, id),
    respondToolApproval: (projectId: string, conversationId: string, activityId: string, decision: 'approved' | 'denied') => invoke('agent:respondToolApproval', projectId, conversationId, activityId, decision),
    onChanged: (callback: (event: unknown) => void) => subscribe('agent:changed', callback)
  },
  paths: () => invoke('app:paths'),
  app: {
    openPath: (targetPath: string) => invoke('app:openPath', targetPath),
    copyText: (text: string) => invoke('app:copyText', text),
    openExternal: (url: string) => invoke('app:openExternal', url),
    relaunch: () => invoke('app:relaunch'),
    onRequestClose: (callback: () => void) => subscribe('app:request-close', callback),
    onCloseTabShortcut: (callback: () => void) => subscribe('app:close-tab', callback),
    confirmClose: () => invoke('app:confirm-close'),
    cancelClose: () => invoke('app:cancel-close')
  },

  dialog: {
    openFiles: (multiple = true) => invoke('dialog:open-files', multiple)
  },

  files: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  },

  debug: {
    get: () => invoke('debug:get'),
    save: (config: unknown) => invoke('debug:save', config)
  },

  projects: {
    list: () => invoke('project:list'),
    create: (name: string) => invoke('project:create', name),
    save: (project: unknown) => invoke('project:save', project),
    saveApiStatuses: (projectId: string, statuses: unknown, defaultId: string) => invoke('project:api-statuses', projectId, statuses, defaultId),
    ensureDefault: () => invoke('project:ensureDefault')
  },

  targets: {
    onChanged: (callback: (event: unknown) => void) => subscribe('target:changed', callback),
    read: (projectId: string, targetId: string) => invoke('target:read', projectId, targetId),
    saveChecked: (projectId: string, target: unknown, revision: string, operationId: string) =>
      invoke('target:save-checked', projectId, target, revision, operationId),
    saveCopy: (projectId: string, target: unknown) => invoke('target:save-copy', projectId, target),
    list: (projectId: string) => invoke('target:list', projectId),
    get: (projectId: string, targetId: string) => invoke('target:get', projectId, targetId),
    create: (projectId: string, parentId: string, type: 'folder' | 'api') =>
      invoke('target:create', projectId, parentId, type),
    save: (projectId: string, target: unknown) => invoke('target:save', projectId, target),
    delete: (projectId: string, targetId: string) => invoke('target:delete', projectId, targetId),
    reorder: (projectId: string, parentId: string, orderedIds: string[]) =>
      invoke('target:reorder', projectId, parentId, orderedIds),
    clone: (projectId: string, targetId: string) =>
      invoke('target:clone', projectId, targetId),
    cases: {
      run: (projectId: string, target: unknown, caseId: string, environmentId?: string) =>
        invoke('target:case:run', projectId, target, caseId, environmentId),
      runAll: (projectId: string, target: unknown, environmentId?: string) =>
        invoke('target:case:runAll', projectId, target, environmentId)
    },
    versions: {
      list: (projectId: string, targetId: string) =>
        invoke('target:versions:list', projectId, targetId),
      get: (projectId: string, targetId: string, versionId: string) =>
        invoke('target:versions:get', projectId, targetId, versionId),
      restore: (projectId: string, targetId: string, versionId: string) =>
        invoke('target:versions:restore', projectId, targetId, versionId),
      tag: (projectId: string, targetId: string, versionId: string, label: string) =>
        invoke('target:versions:tag', projectId, targetId, versionId, label)
    },
    codegenCurl: (projectId: string, target: unknown, environmentId?: string) =>
      invoke('target:codegen:curl', projectId, target, environmentId)
  },

  envs: {
    list: (projectId: string) => invoke('env:list', projectId),
    save: (projectId: string, env: unknown) => invoke('env:save', projectId, env),
    remove: (projectId: string, envId: string) => invoke('env:delete', projectId, envId)
  },

  attributes: {
    list: (projectId: string) => invoke('attribute:list', projectId),
    save: (projectId: string, attribute: unknown) => invoke('attribute:save', projectId, attribute),
    remove: (projectId: string, attributeId: string) => invoke('attribute:remove', projectId, attributeId)
  },

  globals: {
    get: (projectId: string) => invoke('globals:get', projectId),
    save: (projectId: string, vars: unknown) => invoke('globals:save', projectId, vars)
  },

  globalParams: {
    get: (projectId: string) => invoke('globalParams:get', projectId),
    save: (projectId: string, request: unknown) => invoke('globalParams:save', projectId, request)
  },

  cookies: {
    get: (projectId: string) => invoke('cookieJar:get', projectId),
    save: (projectId: string, jar: unknown) => invoke('cookieJar:save', projectId, jar)
  },

  settings: {
    get: () => invoke('settings:get'),
    save: (settings: unknown) => invoke('settings:save', settings)
  },

  http: {
    send: (projectId: string, target: unknown, environmentId?: string, requestId?: string) =>
      invoke('http:send', projectId, target, environmentId, requestId),
    cancel: (requestId: string) => invoke('http:cancel', requestId)
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
    saveMany: (projectId: string, entries: unknown[]) => invoke('dictionary:saveMany', projectId, entries),
    deleteMany: (projectId: string, ids: string[]) => invoke('dictionary:deleteMany', projectId, ids),
    stage: (projectId: string, entry: unknown) => invoke('dictionary:stage', projectId, entry),
    saveTemporary: (projectId: string, ids?: string[]) => invoke('dictionary:saveTemporary', projectId, ids),
    apiFields: (projectId: string, ids: string[]) => invoke('dictionary:apiFields', projectId, ids),
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
  },

  git: {
    availability: () => invoke('git:availability'),
    info: (projectId: string) => invoke('git:info', projectId),
    init: (projectId: string, branch?: string) => invoke('git:init', projectId, branch),
    status: (projectId: string) => invoke('git:status', projectId),
    diff: (projectId: string, request: unknown) => invoke('git:diff', projectId, request),
    commitDiff: (projectId: string, hash: string) =>
      invoke('git:commitDiff', projectId, hash),
    stage: (projectId: string, paths: string[]) => invoke('git:stage', projectId, paths),
    unstage: (projectId: string, paths: string[]) => invoke('git:unstage', projectId, paths),
    discard: (projectId: string, targets: unknown) => invoke('git:discard', projectId, targets),
    commit: (projectId: string, message: string, stageAll: boolean) =>
      invoke('git:commit', projectId, message, stageAll),
    log: (projectId: string, limit?: number) => invoke('git:log', projectId, limit),
    branches: (projectId: string) => invoke('git:branches', projectId),
    createBranch: (projectId: string, name: string, checkout: boolean) =>
      invoke('git:branch:create', projectId, name, checkout),
    checkoutBranch: (projectId: string, name: string) =>
      invoke('git:branch:checkout', projectId, name),
    deleteBranch: (projectId: string, name: string) =>
      invoke('git:branch:delete', projectId, name),
    addRemote: (projectId: string, name: string, url: string) =>
      invoke('git:remote:add', projectId, name, url),
    setRemoteUrl: (projectId: string, name: string, url: string) =>
      invoke('git:remote:setUrl', projectId, name, url),
    removeRemote: (projectId: string, name: string) =>
      invoke('git:remote:remove', projectId, name),
    fetch: (projectId: string, remote?: string) => invoke('git:fetch', projectId, remote),
    pull: (projectId: string, options: unknown) => invoke('git:pull', projectId, options),
    push: (projectId: string, options: unknown) => invoke('git:push', projectId, options),
    terminal: (projectId: string) => invoke('git:terminal', projectId)
  },

  mqtt: {
    profiles: {
      list: (projectId: string) => invoke('mqtt:profiles:list', projectId),
      get: (projectId: string, connectionId: string) =>
        invoke('mqtt:profiles:get', projectId, connectionId),
      create: (projectId: string, partial?: unknown) =>
        invoke('mqtt:profiles:create', projectId, partial),
      save: (projectId: string, profile: unknown) =>
        invoke('mqtt:profiles:save', projectId, profile),
      remove: (projectId: string, connectionId: string) =>
        invoke('mqtt:profiles:delete', projectId, connectionId),
      clone: (projectId: string, connectionId: string) =>
        invoke('mqtt:profiles:clone', projectId, connectionId),
      versions: {
        list: (projectId: string, connectionId: string) =>
          invoke('mqtt:profiles:versions:list', projectId, connectionId),
        get: (projectId: string, connectionId: string, versionId: string) =>
          invoke('mqtt:profiles:versions:get', projectId, connectionId, versionId),
        restore: (projectId: string, connectionId: string, versionId: string) =>
          invoke('mqtt:profiles:versions:restore', projectId, connectionId, versionId)
      },
      export: (projectId: string, options?: unknown) =>
        invoke('mqtt:profiles:export', projectId, options)
    },
    test: (projectId: string, profile: unknown, options?: unknown) =>
      invoke('mqtt:test', projectId, profile, options),
    connect: (projectId: string, connectionId: string) =>
      invoke('mqtt:connect', projectId, connectionId, 'ui'),
    disconnect: (projectId: string, connectionId: string) =>
      invoke('mqtt:disconnect', projectId, connectionId, 'ui'),
    disconnectAll: (projectId: string) => invoke('mqtt:disconnectAll', projectId),
    sessions: {
      list: (projectId?: string) => invoke('mqtt:sessions:list', projectId)
    },
    onEvent: (callback: (event: unknown) => void) => subscribe('mqtt:event', callback),
    replay: (connectionId: string, afterSeq: number) =>
      invoke('mqtt:replay', connectionId, afterSeq),
    subscribe: (projectId: string, connectionId: string, subscriptions: unknown) =>
      invoke('mqtt:subscribe', projectId, connectionId, subscriptions),
    unsubscribe: (projectId: string, connectionId: string, filters: string[]) =>
      invoke('mqtt:unsubscribe', projectId, connectionId, filters),
    subscriptions: {
      list: (projectId: string, connectionId: string) =>
        invoke('mqtt:subscriptions:list', projectId, connectionId)
    },
    messages: {
      list: (projectId: string, connectionId: string, options?: unknown) =>
        invoke('mqtt:messages:list', projectId, connectionId, options),
      get: (projectId: string, connectionId: string, seq: number) =>
        invoke('mqtt:messages:get', projectId, connectionId, seq),
      stats: (projectId: string, connectionId: string) =>
        invoke('mqtt:messages:stats', projectId, connectionId),
      clear: (projectId: string, connectionId?: string) =>
        invoke('mqtt:messages:clear', projectId, connectionId),
      export: (projectId: string, options: unknown) =>
        invoke('mqtt:messages:export', projectId, options)
    },
    publish: {
      send: (projectId: string, connectionId: string, input: unknown) =>
        invoke('mqtt:publish', projectId, connectionId, input),
      history: (projectId: string) => invoke('mqtt:publish:history', projectId),
      startLoop: (
        projectId: string,
        connectionId: string,
        input: unknown,
        options: unknown
      ) => invoke('mqtt:publish:startLoop', projectId, connectionId, input, options),
      stopLoop: (projectId: string, connectionId: string) =>
        invoke('mqtt:publish:stopLoop', projectId, connectionId),
      loopState: (projectId: string, connectionId: string) =>
        invoke('mqtt:publish:loopState', projectId, connectionId)
    },
    attempts: {
      list: (projectId: string, connectionId?: string, limit?: number) =>
        invoke('mqtt:attempts:list', projectId, connectionId, limit),
      clear: (projectId: string, connectionId?: string) =>
        invoke('mqtt:attempts:clear', projectId, connectionId),
      export: (projectId: string, connectionId?: string) =>
        invoke('mqtt:attempts:export', projectId, connectionId)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
