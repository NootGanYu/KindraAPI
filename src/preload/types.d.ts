import type {
  AppPaths,
  AppSettings,
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

export interface ApiBridge {
  paths(): Promise<Result<AppPaths>>
  app: {
    openPath(targetPath: string): Promise<Result<string>>
    copyText(text: string): Promise<Result<boolean>>
    openExternal(url: string): Promise<Result<boolean>>
    relaunch(): Promise<Result<boolean>>
  }
  debug: {
    get(): Promise<Result<DebugState>>
    save(config: DebugConfig): Promise<Result<DebugConfig>>
  }
  projects: {
    list(): Promise<Result<Project[]>>
    create(name: string): Promise<Result<Project>>
    save(project: Project): Promise<Result<Project>>
    ensureDefault(): Promise<Result<Project>>
  }
  targets: {
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
    send(projectId: string, target: Target, environmentId?: string): Promise<Result<SendRecord>>
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
}

declare global {
  interface Window {
    api: ApiBridge
  }
}
