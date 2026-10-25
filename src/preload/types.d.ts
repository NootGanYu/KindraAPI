import type {
  AppPaths,
  AppSettings,
  DebugConfig,
  DebugState,
  Environment,
  Flow,
  FlowRun,
  FlowRunSummary,
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
  McpConfig,
  McpStatus,
  McpToolInfo,
  Project,
  RequestModel,
  Result,
  SendRecord,
  SendRecordSummary,
  Target,
  TargetSummary
} from '@shared/types'

export interface ApiBridge {
  paths(): Promise<Result<AppPaths>>
  app: {
    openPath(targetPath: string): Promise<Result<string>>
    copyText(text: string): Promise<Result<boolean>>
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
  }
  envs: {
    list(projectId: string): Promise<Result<Environment[]>>
    save(projectId: string, env: Environment): Promise<Result<Environment>>
  }
  globals: {
    get(projectId: string): Promise<Result<GlobalVars>>
    save(projectId: string, vars: GlobalVars): Promise<Result<GlobalVars>>
  }
  globalParams: {
    get(projectId: string): Promise<Result<RequestModel | null>>
    save(projectId: string, request: RequestModel): Promise<Result<RequestModel>>
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
