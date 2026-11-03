import type { AgentDraft, AgentCandidate, AgentDraftEvent, AgentConflictChoice } from '@shared/agentDraft'
import type { AgentPlan, AgentPlanEvent, ReadPlanInput } from '../shared/agentPlan'
import type { AgentConnection, AgentConnectionInput, AgentConnectionTest, AgentConversation, AgentEvent } from '@shared/agent'
import type {
  AppPaths,
  AppSettings,
  ApiStatus,
  CaseRunResult,
  CaseRunSummary,
  CustomAttribute,
  DataModel,
  DbConnection,
  DebugConfig,
  DebugState,
  DictionaryEntry,
  DictionaryEntryView,
  DictionarySettings,
  DocServiceConfig,
  DocServiceStatus,
  DocShare,
  DocShareInput,
  DocShareSummary,
  Environment,
  Flow,
  FlowRun,
  FlowRunSummary,
  GeneratedExampleResult,
  GitAvailability,
  GitBranch,
  GitCommit,
  GitDiffRequest,
  GitDiffResult,
  GitDiscardTarget,
  GitOperationResult,
  GitPullOptions,
  GitPushOptions,
  GitRepoInfo,
  GitStatus,
  GlobalVars,
  ImportDbOptions,
  ImportDbResult,
  McpConfig,
  McpStatus,
  McpToolInfo,
  ModelReference,
  ModelSchema,
  ModelSummary,
  Project,
  RequestModel,
  Result,
  SendRecord,
  SendRecordSummary,
  CookieJar,
  CurlResult,
  Target,
  TargetSummary,
  TargetVersion,
  TargetVersionSummary,
  DbTable
} from '@shared/types'
import type {
  MqttAttempt,
  MqttConnectionProfile,
  MqttEvent,
  MqttExportResult,
  MqttLoopOptions,
  MqttLoopState,
  MqttMessageExportOptions,
  MqttMessageRecord,
  MqttMessageSummary,
  MqttProfileExportOptions,
  MqttProfileSummary,
  MqttProfileVersion,
  MqttProfileVersionSummary,
  MqttPublishHistoryEntry,
  MqttPublishInput,
  MqttPublishResult,
  MqttSessionState,
  MqttSessionSubscription,
  MqttSubscribeResult,
  MqttSubscription,
  MqttTestOptions
} from '@shared/mqtt'
import type { TargetChangeEvent, TargetSnapshot, TargetSaveOutcome } from '@shared/targetSync'

export interface SelectedFile {
  path: string
  name: string
  size: number
}

export interface ApiBridge {
  agent: {
    releaseEditorDraft(projectId: string, id: string): Promise<Result<boolean>>
    resolveCandidate(projectId: string, id: string, reviewId: string, choices: Record<string, AgentConflictChoice>): Promise<Result<AgentCandidate>>
    saveManualDraftOnQuit(projectId: string, target: Target, revision: string): Promise<Result<boolean>>
    getDraft(projectId: string, targetId: string): Promise<Result<AgentDraft>>
    syncEditorDraft(projectId: string, target: Target, baseRevision?: string | null): Promise<Result<AgentDraft>>
    listAgentDrafts(projectId: string): Promise<Result<AgentDraft[]>>
    listCandidates(projectId: string, targetId?: string): Promise<Result<AgentCandidate[]>>
    applyCandidate(projectId: string, candidateId: string): Promise<Result<AgentCandidate>>
    onDraftChanged(callback: (event: AgentDraftEvent) => void): () => void
    getActivity(): Promise<Result<{ running: number }>>
    prepareQuit(): Promise<Result<boolean>>
    proposeSavePlan(projectId: string, input: ReadPlanInput): Promise<Result<AgentPlan>>
    proposeExecutePlan(projectId: string, input: ReadPlanInput): Promise<Result<AgentPlan>>
    cancelPlan(projectId: string, id: string): Promise<Result<AgentPlan>>
    proposeEditPlan(projectId: string, input: ReadPlanInput): Promise<Result<AgentPlan>>
    proposeReadPlan: (projectId: string, input: ReadPlanInput) => Promise<Result<AgentPlan>>
    getPlan: (projectId: string, id: string) => Promise<Result<AgentPlan>>
    listPlans: (projectId: string) => Promise<Result<AgentPlan[]>>
    approvePlan: (projectId: string, id: string) => Promise<Result<AgentPlan>>
    rejectPlan: (projectId: string, id: string) => Promise<Result<AgentPlan>>
    deletePlan: (projectId: string, id: string) => Promise<Result<boolean>>
    onPlanChanged: (callback: (event: AgentPlanEvent) => void) => () => void
    getConnection(connectionId?: string): Promise<Result<AgentConnection | null>>
    listConnections(): Promise<Result<AgentConnection[]>>
    createConnection(input: AgentConnectionInput): Promise<Result<AgentConnection>>
    deleteConnection(connectionId: string): Promise<Result<boolean>>
    getProjectConnection(projectId: string): Promise<Result<AgentConnection | null>>
    setProjectConnection(projectId: string, connectionId: string | null): Promise<Result<AgentConnection | null>>
    saveConnection(input: AgentConnectionInput, connectionId?: string): Promise<Result<AgentConnection>>
    testConnection(connectionId?: string): Promise<Result<AgentConnectionTest>>
    createConversation(projectId: string): Promise<Result<AgentConversation>>
    listConversations(projectId: string): Promise<Result<AgentConversation[]>>
    getConversation(projectId: string, id: string): Promise<Result<AgentConversation>>
    deleteConversation(projectId: string, id: string): Promise<Result<boolean>>
    sendMessage(projectId: string, id: string, content: string, connectionId?: string): Promise<Result<AgentConversation>>
    cancelMessage(projectId: string, id: string): Promise<Result<boolean>>
    onChanged(callback: (event: AgentEvent) => void): () => void
  }
  paths(): Promise<Result<AppPaths>>
  app: {
    openPath(targetPath: string): Promise<Result<string>>
    copyText(text: string): Promise<Result<boolean>>
    openExternal(url: string): Promise<Result<boolean>>
    relaunch(): Promise<Result<boolean>>
    onRequestClose(callback: () => void): () => void
    onCloseTabShortcut(callback: () => void): () => void
    confirmClose(): Promise<Result<boolean>>
  }
  dialog: {
    openFiles(multiple?: boolean): Promise<Result<SelectedFile[]>>
  }
  files: {
    getPathForFile(file: File): string
  }
  debug: {
    get(): Promise<Result<DebugState>>
    save(config: DebugConfig): Promise<Result<DebugConfig>>
  }
  projects: {
    list(): Promise<Result<Project[]>>
    create(name: string): Promise<Result<Project>>
    save(project: Project): Promise<Result<Project>>
    saveApiStatuses(projectId: string, statuses: ApiStatus[], defaultId: string): Promise<Result<Project>>
    ensureDefault(): Promise<Result<Project>>
  }
  targets: {
    onChanged(callback: (event: TargetChangeEvent) => void): () => void
    read(projectId: string, targetId: string): Promise<Result<TargetSnapshot>>
    saveChecked(projectId: string, target: Target, revision: string, operationId: string): Promise<Result<TargetSaveOutcome>>
    saveCopy(projectId: string, target: Target): Promise<Result<Target>>
    list(projectId: string): Promise<Result<TargetSummary[]>>
    get(projectId: string, targetId: string): Promise<Result<Target | null>>
    create(
      projectId: string,
      parentId: string,
      type: 'folder' | 'api'
    ): Promise<Result<Target>>
    save(projectId: string, target: Target): Promise<Result<Target>>
    delete(projectId: string, targetId: string): Promise<Result<boolean>>
    reorder(
      projectId: string,
      parentId: string,
      orderedIds: string[]
    ): Promise<Result<TargetSummary[]>>
    clone(projectId: string, targetId: string): Promise<Result<Target>>
    cases: {
      run(
        projectId: string,
        target: Target,
        caseId: string,
        environmentId?: string
      ): Promise<Result<CaseRunResult>>
      runAll(
        projectId: string,
        target: Target,
        environmentId?: string
      ): Promise<Result<CaseRunSummary>>
    }
    versions: {
      list(projectId: string, targetId: string): Promise<Result<TargetVersionSummary[]>>
      get(
        projectId: string,
        targetId: string,
        versionId: string
      ): Promise<Result<TargetVersion | null>>
      restore(projectId: string, targetId: string, versionId: string): Promise<Result<Target>>
      tag(
        projectId: string,
        targetId: string,
        versionId: string,
        label: string
      ): Promise<Result<TargetVersionSummary>>
    }
    codegenCurl(
      projectId: string,
      target: Target,
      environmentId?: string
    ): Promise<Result<CurlResult>>
  }
  envs: {
    list(projectId: string): Promise<Result<Environment[]>>
    save(projectId: string, env: Environment): Promise<Result<Environment>>
    remove(projectId: string, envId: string): Promise<Result<boolean>>
  }
  attributes: {
    list(projectId: string): Promise<Result<CustomAttribute[]>>
    save(projectId: string, attribute: CustomAttribute): Promise<Result<CustomAttribute>>
    remove(projectId: string, attributeId: string): Promise<Result<boolean>>
  }
  globals: {
    get(projectId: string): Promise<Result<GlobalVars>>
    save(projectId: string, vars: GlobalVars): Promise<Result<GlobalVars>>
  }
  globalParams: {
    get(projectId: string): Promise<Result<RequestModel | null>>
    save(projectId: string, request: RequestModel): Promise<Result<RequestModel>>
  }
  cookies: {
    get(projectId: string): Promise<Result<CookieJar>>
    save(projectId: string, jar: CookieJar): Promise<Result<CookieJar>>
  }
  settings: {
    get(): Promise<Result<AppSettings>>
    save(settings: AppSettings): Promise<Result<AppSettings>>
  }
  http: {
    send(projectId: string, target: Target, environmentId?: string, requestId?: string): Promise<Result<SendRecord>>
    cancel(requestId: string): Promise<Result<boolean>>
  }
  history: {
    list(projectId: string): Promise<Result<SendRecordSummary[]>>
    get(projectId: string, recordId: string): Promise<Result<SendRecord | null>>
    delete(projectId: string, recordId: string): Promise<Result<boolean>>
    clear(projectId: string): Promise<Result<boolean>>
  }
  dictionary: {
    list(projectId: string): Promise<Result<DictionaryEntryView[]>>
    suggestions(projectId: string): Promise<Result<DictionaryEntryView[]>>
    save(projectId: string, entry: DictionaryEntry): Promise<Result<DictionaryEntry>>
    saveMany(projectId: string, entries: DictionaryEntry[]): Promise<Result<DictionaryEntry[]>>
    deleteMany(projectId: string, ids: string[]): Promise<Result<boolean>>
    stage(projectId: string, entry: DictionaryEntry): Promise<Result<boolean>>
    saveTemporary(projectId: string, ids?: string[]): Promise<Result<DictionaryEntry[]>>
    apiFields(projectId: string, ids: string[]): Promise<Result<import('../shared/dictionaryImport').DictionaryField[]>>
    delete(projectId: string, id: string): Promise<Result<boolean>>
    getSettings(projectId: string): Promise<Result<DictionarySettings>>
    saveSettings(projectId: string, settings: DictionarySettings): Promise<Result<Project>>
  }
  models: {
    list(projectId: string): Promise<Result<ModelSummary[]>>
    listAll(projectId: string): Promise<Result<DataModel[]>>
    get(projectId: string, modelId: string): Promise<Result<DataModel | null>>
    save(projectId: string, model: DataModel): Promise<Result<DataModel>>
    delete(
      projectId: string,
      modelId: string
    ): Promise<Result<{ references: ModelReference[]; deleted: boolean }>>
    create(projectId: string, parentId: string, kind: 'model' | 'folder'): Promise<Result<DataModel>>
    copy(projectId: string, modelId: string, destParentId: string): Promise<Result<DataModel>>
    move(
      projectId: string,
      modelId: string,
      destParentId: string,
      orderedIds?: string[]
    ): Promise<Result<ModelSummary[]>>
    reorder(projectId: string, parentId: string, orderedIds: string[]): Promise<Result<ModelSummary[]>>
    references(projectId: string, modelId: string): Promise<Result<ModelReference[]>>
    generateExample(projectId: string, modelId: string): Promise<Result<GeneratedExampleResult>>
    generateFromSchema(
      projectId: string,
      schema: ModelSchema
    ): Promise<Result<GeneratedExampleResult>>
    resolveRefs(
      projectId: string,
      schema: ModelSchema
    ): Promise<Result<{ schema: ModelSchema; warnings: GeneratedExampleResult['warnings'] }>>
  }
  db: {
    list(projectId: string): Promise<Result<DbConnection[]>>
    save(projectId: string, connection: DbConnection): Promise<Result<DbConnection>>
    delete(projectId: string, dbId: string): Promise<Result<boolean>>
    test(
      config: DbConnection['config']['default'],
      ssh?: DbConnection['ssh']
    ): Promise<Result<{ ok: boolean; server_version?: string; message: string }>>
    tables(
      config: DbConnection['config']['default'],
      ssh?: DbConnection['ssh']
    ): Promise<Result<DbTable[]>>
    importTables(
      projectId: string,
      dbId: string,
      options: ImportDbOptions
    ): Promise<Result<ImportDbResult>>
  }
  flows: {
    list(projectId: string): Promise<Result<Flow[]>>
    get(projectId: string, flowId: string): Promise<Result<Flow | null>>
    create(projectId: string, name: string): Promise<Result<Flow>>
    save(projectId: string, flow: Flow): Promise<Result<Flow>>
    delete(projectId: string, flowId: string): Promise<Result<boolean>>
    run(projectId: string, flowId: string, environmentId?: string): Promise<Result<FlowRun>>
    runs(projectId: string, limit?: number): Promise<Result<FlowRunSummary[]>>
    getRun(projectId: string, runId: string): Promise<Result<FlowRun | null>>
  }
  mcp: {
    getConfig(): Promise<Result<McpConfig>>
    saveConfig(
      config: McpConfig
    ): Promise<Result<{ config: McpConfig; status: McpStatus }>>
    regenerateToken(): Promise<Result<{ config: McpConfig; status: McpStatus }>>
    status(): Promise<Result<McpStatus>>
    tools(): Promise<Result<McpToolInfo[]>>
    infoPath(): Promise<Result<string>>
    stdioPath(): Promise<Result<string>>
  }
  docs: {
    list(projectId: string): Promise<Result<DocShareSummary[]>>
    get(projectId: string, shareId: string): Promise<Result<DocShare | null>>
    create(projectId: string, input: DocShareInput): Promise<Result<DocShare>>
    update(projectId: string, shareId: string, input: DocShareInput): Promise<Result<DocShare>>
    remove(projectId: string, shareIds: string[]): Promise<Result<boolean>>
    serviceStatus(): Promise<Result<DocServiceStatus>>
    saveService(config: DocServiceConfig): Promise<Result<DocServiceStatus>>
  }

  git: {
    availability(): Promise<Result<GitAvailability>>
    info(projectId: string): Promise<Result<GitRepoInfo>>
    init(projectId: string, branch?: string): Promise<Result<GitOperationResult>>
    status(projectId: string): Promise<Result<GitStatus>>
    diff(projectId: string, request: GitDiffRequest): Promise<Result<GitDiffResult>>
    commitDiff(projectId: string, hash: string): Promise<Result<GitDiffResult>>
    stage(projectId: string, paths: string[]): Promise<Result<GitOperationResult>>
    unstage(projectId: string, paths: string[]): Promise<Result<GitOperationResult>>
    discard(projectId: string, targets: GitDiscardTarget[]): Promise<Result<GitOperationResult>>
    commit(
      projectId: string,
      message: string,
      stageAll: boolean
    ): Promise<Result<GitOperationResult>>
    log(projectId: string, limit?: number): Promise<Result<GitCommit[]>>
    branches(projectId: string): Promise<Result<GitBranch[]>>
    createBranch(
      projectId: string,
      name: string,
      checkout: boolean
    ): Promise<Result<GitOperationResult>>
    checkoutBranch(projectId: string, name: string): Promise<Result<GitOperationResult>>
    deleteBranch(projectId: string, name: string): Promise<Result<GitOperationResult>>
    addRemote(
      projectId: string,
      name: string,
      url: string
    ): Promise<Result<GitOperationResult>>
    setRemoteUrl(
      projectId: string,
      name: string,
      url: string
    ): Promise<Result<GitOperationResult>>
    removeRemote(projectId: string, name: string): Promise<Result<GitOperationResult>>
    fetch(projectId: string, remote?: string): Promise<Result<GitOperationResult>>
    pull(projectId: string, options: GitPullOptions): Promise<Result<GitOperationResult>>
    push(projectId: string, options: GitPushOptions): Promise<Result<GitOperationResult>>
    terminal(projectId: string): Promise<Result<{ opened: boolean; output: string }>>
  }

  mqtt: {
    profiles: {
      list(projectId: string): Promise<Result<MqttProfileSummary[]>>
      get(projectId: string, connectionId: string): Promise<Result<MqttConnectionProfile | null>>
      create(
        projectId: string,
        partial?: Partial<MqttConnectionProfile>
      ): Promise<Result<MqttConnectionProfile>>
      save(projectId: string, profile: MqttConnectionProfile): Promise<Result<MqttConnectionProfile>>
      remove(projectId: string, connectionId: string): Promise<Result<boolean>>
      clone(projectId: string, connectionId: string): Promise<Result<MqttConnectionProfile>>
      versions: {
        list(
          projectId: string,
          connectionId: string
        ): Promise<Result<MqttProfileVersionSummary[]>>
        get(
          projectId: string,
          connectionId: string,
          versionId: string
        ): Promise<Result<MqttProfileVersion | null>>
        restore(
          projectId: string,
          connectionId: string,
          versionId: string
        ): Promise<Result<MqttConnectionProfile>>
      }
      export(
        projectId: string,
        options?: MqttProfileExportOptions
      ): Promise<Result<MqttExportResult>>
    }
    test(
      projectId: string,
      profile: MqttConnectionProfile,
      options?: MqttTestOptions
    ): Promise<Result<MqttAttempt>>
    connect(projectId: string, connectionId: string): Promise<Result<MqttSessionState>>
    disconnect(projectId: string, connectionId: string): Promise<Result<boolean>>
    disconnectAll(projectId: string): Promise<Result<boolean>>
    sessions: {
      list(projectId?: string): Promise<Result<MqttSessionState[]>>
    }
    onEvent(callback: (event: MqttEvent) => void): () => void
    replay(connectionId: string, afterSeq: number): Promise<Result<MqttEvent[]>>
    subscribe(
      projectId: string,
      connectionId: string,
      subscriptions: MqttSubscription[]
    ): Promise<Result<MqttSubscribeResult[]>>
    unsubscribe(
      projectId: string,
      connectionId: string,
      filters: string[]
    ): Promise<Result<boolean>>
    subscriptions: {
      list(projectId: string, connectionId: string): Promise<Result<MqttSessionSubscription[]>>
    }
    messages: {
      list(
        projectId: string,
        connectionId: string,
        options?: { limit?: number; topic?: string; search?: string; afterSeq?: number }
      ): Promise<Result<MqttMessageSummary[]>>
      get(
        projectId: string,
        connectionId: string,
        seq: number
      ): Promise<Result<MqttMessageRecord | null>>
      stats(
        projectId: string,
        connectionId: string
      ): Promise<Result<{ count: number; bytes: number; shards: number }>>
      clear(projectId: string, connectionId?: string): Promise<Result<boolean>>
      export(
        projectId: string,
        options: MqttMessageExportOptions
      ): Promise<Result<MqttExportResult>>
    }
    publish: {
      send(
        projectId: string,
        connectionId: string,
        input: MqttPublishInput
      ): Promise<Result<MqttPublishResult>>
      history(projectId: string): Promise<Result<MqttPublishHistoryEntry[]>>
      startLoop(
        projectId: string,
        connectionId: string,
        input: MqttPublishInput,
        options: MqttLoopOptions
      ): Promise<Result<MqttLoopState>>
      stopLoop(projectId: string, connectionId: string): Promise<Result<MqttLoopState>>
      loopState(projectId: string, connectionId: string): Promise<Result<MqttLoopState>>
    }
    attempts: {
      list(
        projectId: string,
        connectionId?: string,
        limit?: number
      ): Promise<Result<MqttAttempt[]>>
      clear(projectId: string, connectionId?: string): Promise<Result<boolean>>
      export(projectId: string, connectionId?: string): Promise<Result<MqttExportResult>>
    }
  }
}

declare global {
  interface Window {
    api: ApiBridge
  }
}
