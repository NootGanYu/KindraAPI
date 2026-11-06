import { cancelRelaunch, requestRelaunch } from './appLifecycle'
import { registerAgentIpc } from './agent/ipc'
import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type {
  AppSettings,
  ApiStatus,
  CookieJar,
  CustomAttribute,
  DataModel,
  DbConnection,
  DebugConfig,
  DictionaryEntry,
  DictionarySettings,
  DocServiceConfig,
  DocShareInput,
  Environment,
  Flow,
  GitDiffRequest,
  GitDiscardTarget,
  GitPullOptions,
  GitPushOptions,
  GlobalVars,
  ImportDbOptions,
  McpConfig,
  ModelSchema,
  ModelType,
  Project,
  ProjectImportRequest,
  RequestModel,
  Result,
  SendRecord,
  SendRecordSummary,
  Target
} from '@shared/types'
import * as store from './storage/store'
import { inspectProjectImport, importProjectFile } from './project/importer'
import { withTargetChanges } from './storage/changes'
import * as git from './git/git'
import { resolveEffectiveRequest, sendRequest } from './request/executor'
import { runApiCase, runApiCases } from './request/cases'
import { generateCurl } from './codegen/curl'
import { getActiveFlowRuns, listFlowRuns, runSavedFlow, startFlowRun, getFlowRun, pauseFlowRun, resumeFlowRun, previewFlowRunRefresh, approveFlowRunScope, applyFlowRunRefresh, resolveFlowRunConflict, cancelFlowRun } from './flow/service'
import { createFlow } from '@shared/factories'
import { generateFromSchema, generateModelExample, resolveModelRefs } from './schema/example'
import { importDbTables, listDbTables, testDbConnection } from './db/mysql'
import { dictionaryFieldsFromTarget } from './schema/dictionary'
import {
  getMcpStatus,
  restartMcpServer
} from './mcp/server'
import { listToolInfos } from './mcp/tools'
import {
  getDocServiceStatus,
  restartDocServer
} from './docs/server'
import * as mqttStore from './mqtt/store'
import * as mqtt from './mqtt/sessionManager'
import {
  buildAttemptExport,
  buildMessageExport,
  buildProfileExport,
  resultForWrite,
  type ExportPayload
} from './mqtt/export'
import type {
  MqttConnectionProfile,
  MqttLoopOptions,
  MqttMessageExportOptions,
  MqttProfileExportOptions,
  MqttPublishInput,
  MqttSessionOwner,
  MqttSubscription,
  MqttTestOptions
} from '@shared/mqtt'
import { createDefaultMqttProfile } from '@shared/mqtt'

async function saveExport(
  defaultName: string,
  payload: ExportPayload,
  filters: Electron.FileFilter[]
): Promise<import('@shared/mqtt').MqttExportResult> {
  const picked = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    return resultForWrite(picked.filePath, payload)
  } catch (error) {
    throw new Error(
      `写入文件失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** trackTargetChanges 只用于可能写入接口或模型的通道，避免无关 IPC 也进入变更上下文。 */
function handle<T>(
  channel: string,
  fn: (...args: any[]) => T | Promise<T>,
  trackTargetChanges = false
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      const run = (): T | Promise<T> => fn(...args)
      const data = trackTargetChanges ? await withTargetChanges('ui', undefined, run) : await run()
      return { ok: true, data }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

export function registerIpc(): void {
  registerAgentIpc()
  handle('app:paths', () => store.getPaths())
  handle('app:openPath', (targetPath: string) => shell.openPath(targetPath))
  handle('app:copyText', (text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  handle('app:openExternal', async (url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅支持 http/https 链接')
    }
    await shell.openExternal(parsed.toString())
    return true
  })
  // 重启同样经过退出确认与 prepareQuit；只有确认后才安排 relaunch。
  handle('app:relaunch', () => { requestRelaunch(); return true })
  handle('app:cancel-close', () => { cancelRelaunch(); return true })

  handle('debug:get', () => store.getDebugState())
  handle('debug:save', (config: DebugConfig) => store.saveDebugConfig(config))

  handle('project:list', () => store.listProjects())
  handle('project:create', (name: string) => store.createProjectWithDefaults(name))
  handle('project:save', (project: Project) => store.saveProject(project))
  handle('project:api-statuses', (projectId: string, statuses: ApiStatus[], defaultId: string) => store.saveApiStatuses(projectId, statuses, defaultId), true)
  handle('project:ensureDefault', () => store.ensureDefaultProject())
  handle('project:import:pick', async () => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'API 导入文件', extensions: ['json'] }]
    })
    const filePath = picked.canceled ? undefined : picked.filePaths[0]
    if (!filePath) return null
    let size = 0
    try {
      size = fs.statSync(filePath).size
    } catch {
      size = 0
    }
    return { path: filePath, name: path.basename(filePath), size }
  })
  handle('project:import:inspect', (filePath: string) => inspectProjectImport(filePath))
  handle('project:import', (input: ProjectImportRequest) => importProjectFile(input), true)

  handle('target:list', (projectId: string) => store.listTargets(projectId))
  handle('target:get', (projectId: string, targetId: string) => store.getTarget(projectId, targetId))
  handle('target:read', (projectId: string, targetId: string) => store.readTargetSnapshot(projectId, targetId))
  handle('target:save-checked', (projectId: string, target: Target, revision: string, operationId: string) =>
    withTargetChanges('ui', operationId, () => store.saveTargetChecked(projectId, target, revision))
  )
  handle(
    'target:save-copy',
    (projectId: string, input: Target) => store.saveTargetCopy(projectId, input),
    true
  )
  handle(
    'target:create',
    (projectId: string, parentId: string, type: 'folder' | 'api') =>
      store.createTargetInProject(projectId, parentId, type),
    true
  )
  handle(
    'target:save',
    (projectId: string, target: Target) => store.saveTarget(projectId, target),
    true
  )

  handle('dialog:open-files', async (multiple = true) => {
    const picked = await dialog.showOpenDialog({
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile']
    })
    if (picked.canceled) return []
    return picked.filePaths.map((filePath) => {
      let size = 0
      try {
        size = fs.statSync(filePath).size
      } catch {
        size = 0
      }
      return { path: filePath, name: path.basename(filePath), size }
    })
  })

  handle(
    'target:case:run',
    (
      projectId: string,
      target: Target,
      caseId: string,
      environmentId?: string
    ) => {
      const apiCase = (target.cases ?? []).find((item) => item.case_id === caseId)
      if (!apiCase) throw new Error('用例不存在')
      return runApiCase(projectId, target, apiCase, environmentId)
    },
    true
  )

  handle(
    'target:case:runAll',
    (projectId: string, target: Target, environmentId?: string) =>
      runApiCases(projectId, target, environmentId),
    true
  )

  handle(
    'target:delete',
    (projectId: string, targetId: string) => {
      store.deleteTarget(projectId, targetId)
      return true
    },
    true
  )
  handle(
    'target:reorder',
    (projectId: string, parentId: string, orderedIds: string[]) =>
      store.reorderTargets(projectId, parentId, orderedIds),
    true
  )
  handle(
    'target:clone',
    (projectId: string, targetId: string) => store.cloneTarget(projectId, targetId),
    true
  )
  handle(
    'target:transfer-preview',
    (
      sourceProjectId: string,
      targetId: string,
      destinationProjectId: string,
      mode: 'move' | 'copy'
    ) => store.previewTargetTransfer(sourceProjectId, targetId, destinationProjectId, mode)
  )
  handle(
    'target:transfer',
    (
      sourceProjectId: string,
      targetId: string,
      destinationProjectId: string,
      mode: 'move' | 'copy'
    ) => store.transferTargetToProject(sourceProjectId, targetId, destinationProjectId, mode),
    true
  )
  handle('target:versions:list', (projectId: string, targetId: string) =>
    store.listTargetVersions(projectId, targetId)
  )
  handle('target:versions:get', (projectId: string, targetId: string, versionId: string) =>
    store.getTargetVersion(projectId, targetId, versionId)
  )
  handle(
    'target:versions:restore',
    (projectId: string, targetId: string, versionId: string) =>
      store.restoreTargetVersion(projectId, targetId, versionId),
    true
  )
  handle(
    'target:versions:tag',
    (projectId: string, targetId: string, versionId: string, label: string) =>
      store.tagTargetVersion(projectId, targetId, versionId, label)
  )
  handle(
    'target:codegen:curl',
    (projectId: string, target: Target, environmentId?: string) =>
      generateCurl(resolveEffectiveRequest(projectId, target, environmentId))
  )

  handle('env:list', (projectId: string) => store.listEnvironments(projectId))
  handle('env:save', (projectId: string, env: Environment) => store.saveEnvironment(projectId, env))
  handle('env:delete', (projectId: string, envId: string) => {
    store.deleteEnvironment(projectId, envId)
    return true
  })

  handle('attribute:list', (projectId: string) => store.listCustomAttributes(projectId))
  handle('attribute:save', (projectId: string, attribute: CustomAttribute) =>
    store.saveCustomAttribute(projectId, attribute)
  )
  handle('attribute:remove', (projectId: string, attributeId: string) =>
    store.deleteCustomAttribute(projectId, attributeId)
  )

  handle('globals:get', (projectId: string) => store.getGlobalVars(projectId))
  handle('globals:save', (projectId: string, vars: GlobalVars) => store.saveGlobalVars(projectId, vars))
  handle('globalParams:get', (projectId: string) => store.getGlobalParams(projectId))
  handle('globalParams:save', (projectId: string, req: RequestModel) =>
    store.saveGlobalParams(projectId, req)
  )

  handle('cookieJar:get', (projectId: string) => store.getCookieJar(projectId))
  handle('cookieJar:save', (projectId: string, jar: CookieJar) =>
    store.saveCookieJar(projectId, jar)
  )

  handle('settings:get', () => store.getSettings())
  handle('settings:save', (settings: AppSettings) => store.saveSettings(settings))

  const httpRuns = new Map<string, AbortController>()
  handle('http:send', async (projectId: string, target: Target, environmentId?: string, requestId?: string) => {
    if (requestId && httpRuns.has(requestId)) throw new Error('请求已在发送')
    const controller = new AbortController()
    if (requestId) httpRuns.set(requestId, controller)
    try {
      const record: SendRecord = await sendRequest(projectId, target, environmentId, { signal: controller.signal })
      store.addSendRecord(projectId, record)
      return record
    } finally {
      if (requestId) httpRuns.delete(requestId)
    }
  })
  handle('http:cancel', (requestId: string) => {
    const controller = httpRuns.get(requestId)
    controller?.abort()
    return Boolean(controller)
  })

  handle('history:list', (projectId: string): SendRecordSummary[] => store.listSendRecords(projectId))
  handle('history:get', (projectId: string, recordId: string) => store.getSendRecord(projectId, recordId))
  handle('history:delete', (projectId: string, recordId: string) => {
    store.deleteSendRecord(projectId, recordId)
    return true
  })
  handle('history:clear', (projectId: string) => {
    store.clearSendRecords(projectId)
    return true
  })

  handle('flow:runs:active', () => getActiveFlowRuns())

  // M2 · flows
  handle('flow:list', (projectId: string) => store.listFlows(projectId))
  handle('flow:get', (projectId: string, flowId: string) => store.getFlow(projectId, flowId))
  handle('flow:create', (projectId: string, name: string) => {
    const environments = store.listEnvironments(projectId)
    const flow = createFlow(projectId, name, environments[0]?.env_id ?? '')
    return store.saveFlow(projectId, flow)
  })
  handle('flow:save', (projectId: string, flow: Flow, expectedRevision: string) => {
    const outcome = store.saveFlowChecked(projectId, flow, expectedRevision)
    if (outcome.status !== 'saved') {
      throw new Error(outcome.status === 'conflict' ? '流程保存冲突：定义已变化，请重新读取流程' : '流程不存在或已删除')
    }
    return outcome.flow
  })
  handle('flow:delete', (projectId: string, flowId: string) => {
    store.deleteFlow(projectId, flowId)
    return true
  })
  handle('flow:run', (projectId: string, flowId: string, environmentId?: string) =>
    runSavedFlow(projectId, flowId, environmentId)
  )
  handle('flow:run:start', (projectId: string, flowId: string, environmentId: string | undefined, requestId: string) =>
    startFlowRun(projectId, flowId, environmentId, requestId, 'ui')
  )
  handle('flow:run:cancel', (projectId: string, runId: string) => cancelFlowRun(projectId, runId))
  handle('flow:run:pause', (projectId: string, runId: string) => pauseFlowRun(projectId, runId))
  handle('flow:run:refresh:preview', (projectId: string, runId: string) => previewFlowRunRefresh(projectId, runId))
  handle('flow:run:refresh:resolve-conflict', (projectId: string, runId: string, previewId: string, eventId: string, field: string, choice: 'api' | 'override') => resolveFlowRunConflict(projectId, runId, previewId, eventId, field, choice))
  handle('flow:run:scope:approve', (projectId: string, runId: string, previewId: string) => approveFlowRunScope(projectId, runId, previewId))
  handle('flow:run:refresh:apply', (projectId: string, runId: string, previewId: string) => applyFlowRunRefresh(projectId, runId, previewId))
  handle('flow:run:resume', (projectId: string, runId: string) => resumeFlowRun(projectId, runId))
  handle('flow:runs', (projectId: string, limit?: number) => listFlowRuns(projectId, limit))
  handle('flow:run:get', (projectId: string, runId: string) =>
    getFlowRun(projectId, runId)
  )

  // Data dictionary
  handle('dictionary:list', (projectId: string) => store.listDictionaryEntries(projectId))
  handle('dictionary:suggestions', (projectId: string) => store.listDictionarySuggestions(projectId))
  handle('dictionary:saveMany', (projectId: string, entries: DictionaryEntry[]) => store.saveDictionaryEntries(projectId, entries))
  handle('dictionary:deleteMany', (projectId: string, ids: string[]) => { store.deleteDictionaryEntries(projectId, ids); return true })
  handle('dictionary:stage', (projectId: string, entry: DictionaryEntry) => store.stageDictionaryEntry(projectId, entry))
  handle('dictionary:saveTemporary', (projectId: string, ids?: string[]) => store.saveTemporaryDictionaryEntries(projectId, ids))
  handle('dictionary:apiFields', (projectId: string, ids: string[]) => ids.flatMap(id => {
    const target = store.getTarget(projectId, id)
    if (!target || target.target_type !== 'api') return []
    return dictionaryFieldsFromTarget(target)
  }))
  handle('dictionary:save', (projectId: string, entry: DictionaryEntry) =>
    store.saveDictionaryEntry(projectId, entry)
  )
  handle('dictionary:delete', (projectId: string, id: string) => {
    store.deleteDictionaryEntry(projectId, id)
    return true
  })
  handle('dictionary:getSettings', (projectId: string) => store.getDictionarySettings(projectId))
  handle('dictionary:saveSettings', (projectId: string, settings: DictionarySettings) =>
    store.saveDictionarySettings(projectId, settings)
  )

  // Data models
  handle('model:list', (projectId: string) => store.listModels(projectId))
  handle('model:listAll', (projectId: string) => store.listModelsAll(projectId))
  handle('model:get', (projectId: string, modelId: string) => store.getModel(projectId, modelId))
  handle(
    'model:save',
    (projectId: string, model: DataModel) => store.saveModel(projectId, model),
    true
  )
  handle(
    'model:delete',
    (projectId: string, modelId: string) => store.deleteModelWithReferences(projectId, modelId),
    true
  )
  handle(
    'model:create',
    (projectId: string, parentId: string, kind: ModelType) =>
      store.createModelInProject(projectId, parentId, kind),
    true
  )
  handle(
    'model:copy',
    (projectId: string, modelId: string, destParentId: string) =>
      store.copyModel(projectId, modelId, destParentId),
    true
  )
  handle(
    'model:move',
    (projectId: string, modelId: string, destParentId: string, orderedIds?: string[]) =>
      store.moveModel(projectId, modelId, destParentId, orderedIds),
    true
  )
  handle(
    'model:reorder',
    (projectId: string, parentId: string, orderedIds: string[]) =>
      store.reorderModels(projectId, parentId, orderedIds),
    true
  )
  handle('model:references', (projectId: string, modelId: string) =>
    store.findModelReferences(projectId, modelId)
  )
  handle('model:generateExample', (projectId: string, modelId: string) =>
    generateModelExample(projectId, modelId)
  )
  handle('model:generateFromSchema', (projectId: string, schema: ModelSchema) =>
    generateFromSchema(projectId, schema)
  )
  handle('model:resolveRefs', (projectId: string, schema: ModelSchema) =>
    resolveModelRefs(projectId, schema)
  )

  // Database connections
  handle('db:list', (projectId: string) => store.listDbConnections(projectId))
  handle('db:save', (projectId: string, connection: DbConnection) =>
    store.saveDbConnection(projectId, connection)
  )
  handle('db:delete', (projectId: string, dbId: string) => {
    store.deleteDbConnection(projectId, dbId)
    return true
  })
  handle('db:test', (config: DbConnection['config']['default'], ssh?: DbConnection['ssh']) =>
    testDbConnection(config, ssh)
  )
  handle('db:tables', (config: DbConnection['config']['default'], ssh?: DbConnection['ssh']) =>
    listDbTables(config, ssh)
  )
  handle('db:import', (projectId: string, dbId: string, options: ImportDbOptions) =>
    importDbTables(projectId, dbId, options)
  )

  // M3 · MCP
  handle('mcp:config:get', () => store.getMcpConfig())
  handle('mcp:config:save', async (config: McpConfig) => {
    const saved = store.saveMcpConfig(config)
    const nextStatus = await restartMcpServer()
    return { config: saved, status: nextStatus }
  })
  handle('mcp:token:regen', async () => {
    const config = store.regenerateMcpToken()
    const nextStatus = await restartMcpServer()
    return { config, status: nextStatus }
  })
  handle('mcp:status', () => getMcpStatus())
  handle('mcp:tools', () => listToolInfos())
  handle('mcp:info:path', () => store.mcpInfoPath())
  handle('mcp:stdio:path', () => {
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, 'mcp-stdio.cjs'), path.join(app.getAppPath(), 'mcp-stdio.cjs')]
      : [path.join(app.getAppPath(), 'mcp-stdio.cjs')]
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  })

  // Docs · local share
  handle('doc:list', (projectId: string) => store.listDocShareSummaries(projectId))
  handle('doc:get', (projectId: string, shareId: string) =>
    store.getDocShare(projectId, shareId)
  )
  handle('doc:create', (projectId: string, input: DocShareInput) =>
    store.createDocShare(projectId, input)
  )
  handle('doc:update', (projectId: string, shareId: string, input: DocShareInput) =>
    store.updateDocShare(projectId, shareId, input)
  )
  handle('doc:delete', (projectId: string, shareIds: string[]) => {
    store.deleteDocShares(projectId, shareIds)
    return true
  })
  handle('doc:service:get', () => getDocServiceStatus())
  handle('doc:service:save', async (config: DocServiceConfig) => {
    store.saveDocServiceConfig(config)
    return restartDocServer()
  })

  // Git · 项目目录的版本管理
  const projectDirOf = (projectId: string): string => store.resolveProjectDir(projectId)
  handle('git:availability', () => git.getGitAvailability())
  handle('git:info', (projectId: string) => git.getGitInfo(projectDirOf(projectId)))
  handle('git:init', (projectId: string, branch?: string) =>
    git.initRepo(projectDirOf(projectId), branch)
  )
  handle('git:status', (projectId: string) => git.getGitStatus(projectDirOf(projectId)))
  handle('git:diff', (projectId: string, request: GitDiffRequest) =>
    git.getGitDiff(projectDirOf(projectId), request)
  )
  handle('git:commitDiff', (projectId: string, hash: string) =>
    git.getCommitDiff(projectDirOf(projectId), hash)
  )
  handle('git:stage', (projectId: string, paths: string[]) =>
    git.stagePaths(projectDirOf(projectId), paths)
  )
  handle('git:unstage', (projectId: string, paths: string[]) =>
    git.unstagePaths(projectDirOf(projectId), paths)
  )
  handle('git:discard', (projectId: string, targets: GitDiscardTarget[]) =>
    store.withExternalDefinitionChanges(projectId, () => git.discardPaths(projectDirOf(projectId), targets))
  )
  handle('git:commit', (projectId: string, message: string, stageAll: boolean) =>
    git.commitChanges(projectDirOf(projectId), message, stageAll)
  )
  handle('git:log', (projectId: string, limit?: number) =>
    git.getGitLog(projectDirOf(projectId), limit)
  )
  handle('git:branches', (projectId: string) => git.listBranches(projectDirOf(projectId)))
  handle('git:branch:create', (projectId: string, name: string, checkout: boolean) =>
    store.withExternalDefinitionChanges(projectId, () => git.createBranch(projectDirOf(projectId), name, checkout))
  )
  handle('git:branch:checkout', (projectId: string, name: string) =>
    store.withExternalDefinitionChanges(projectId, () => git.checkoutBranch(projectDirOf(projectId), name))
  )
  handle('git:branch:delete', (projectId: string, name: string) =>
    git.deleteBranch(projectDirOf(projectId), name)
  )
  handle('git:remote:add', (projectId: string, name: string, url: string) =>
    git.addRemote(projectDirOf(projectId), name, url)
  )
  handle('git:remote:setUrl', (projectId: string, name: string, url: string) =>
    git.setRemoteUrl(projectDirOf(projectId), name, url)
  )
  handle('git:remote:remove', (projectId: string, name: string) =>
    git.removeRemote(projectDirOf(projectId), name)
  )
  handle('git:fetch', (projectId: string, remote?: string) =>
    git.fetchRepo(projectDirOf(projectId), remote)
  )
  handle('git:pull', (projectId: string, options: GitPullOptions) =>
    store.withExternalDefinitionChanges(projectId, () => git.pullRepo(projectDirOf(projectId), options))
  )
  handle('git:push', (projectId: string, options: GitPushOptions) =>
    git.pushRepo(projectDirOf(projectId), options)
  )
  handle('git:terminal', (projectId: string) => git.openInTerminal(projectDirOf(projectId)))

  // MQTT · 独立模块（ADR-0003）
  handle('mqtt:profiles:list', (projectId: string) => mqttStore.listProfiles(projectId))
  handle('mqtt:profiles:get', (projectId: string, connectionId: string) =>
    mqttStore.getProfile(projectId, connectionId)
  )
  handle(
    'mqtt:profiles:create',
    (projectId: string, partial?: Partial<MqttConnectionProfile>) =>
      mqttStore.createProfile(
        projectId,
        createDefaultMqttProfile(projectId, partial ?? {})
      )
  )
  handle('mqtt:profiles:save', (projectId: string, profile: MqttConnectionProfile) =>
    mqttStore.saveProfile(projectId, profile)
  )
  handle('mqtt:profiles:delete', (projectId: string, connectionId: string) => {
    // 删除配置时强制结束该 Profile 的会话（包括 MCP 会话），避免留下幽灵连接。
    try {
      mqtt.disconnect(projectId, connectionId)
    } catch {
      // 会话不存在或项目不匹配时继续删除配置。
    }
    mqttStore.deleteProfile(projectId, connectionId)
    return true
  })
  handle('mqtt:profiles:clone', (projectId: string, connectionId: string) =>
    mqttStore.cloneProfile(projectId, connectionId)
  )
  handle('mqtt:profiles:versions:list', (projectId: string, connectionId: string) =>
    mqttStore.listProfileVersions(projectId, connectionId)
  )
  handle(
    'mqtt:profiles:versions:get',
    (projectId: string, connectionId: string, versionId: string) =>
      mqttStore.getProfileVersion(projectId, connectionId, versionId)
  )
  handle(
    'mqtt:profiles:versions:restore',
    (projectId: string, connectionId: string, versionId: string) =>
      mqttStore.restoreProfileVersion(projectId, connectionId, versionId)
  )
  handle(
    'mqtt:profiles:export',
    (projectId: string, options?: MqttProfileExportOptions) => {
      const payload = buildProfileExport(projectId, options ?? {})
      return saveExport(payload.defaultName, payload, [
        { name: 'JSON', extensions: ['json'] }
      ])
    }
  )

  handle(
    'mqtt:test',
    (projectId: string, profile: MqttConnectionProfile, options?: MqttTestOptions) =>
      mqtt.testConnection(projectId, profile, options ?? {})
  )

  handle(
    'mqtt:connect',
    (projectId: string, connectionId: string, owner?: MqttSessionOwner) =>
      mqtt.startSession(projectId, connectionId, owner ?? 'ui').state
  )
  handle(
    'mqtt:disconnect',
    (projectId: string, connectionId: string, owner?: MqttSessionOwner) => {
      mqtt.disconnect(projectId, connectionId, owner)
      return true
    }
  )
  handle('mqtt:disconnectAll', (projectId: string) => {
    mqtt.disconnectAll(projectId)
    return true
  })
  handle('mqtt:sessions:list', (projectId?: string) => mqtt.listSessions(projectId))
  handle('mqtt:replay', (connectionId: string, afterSeq: number) =>
    mqtt.replay(connectionId, afterSeq)
  )

  handle(
    'mqtt:subscribe',
    (projectId: string, connectionId: string, subscriptions: MqttSubscription[]) =>
      mqtt.subscribe(projectId, connectionId, subscriptions)
  )
  handle(
    'mqtt:unsubscribe',
    (projectId: string, connectionId: string, filters: string[]) =>
      mqtt.unsubscribe(projectId, connectionId, filters)
  )
  handle('mqtt:subscriptions:list', (projectId: string, connectionId: string) => {
    const live = mqtt
      .listSessions(projectId)
      .find((session) => session.connection_id === connectionId)
    if (live) return live.subscriptions
    const profile = mqttStore.getProfile(projectId, connectionId)
    return (profile?.subscriptions ?? []).map((sub) => ({
      ...sub,
      state: 'pending' as const
    }))
  })

  handle(
    'mqtt:messages:list',
    (
      projectId: string,
      connectionId: string,
      options?: import('./mqtt/store').ListMessagesOptions
    ) => mqttStore.listMessages(projectId, connectionId, options ?? {})
  )
  handle('mqtt:messages:get', (projectId: string, connectionId: string, seq: number) =>
    mqttStore.getMessage(projectId, connectionId, seq)
  )
  handle('mqtt:messages:stats', (projectId: string, connectionId: string) =>
    mqttStore.messageStats(projectId, connectionId)
  )
  handle('mqtt:messages:clear', (projectId: string, connectionId?: string) => {
    mqttStore.clearMessages(projectId, connectionId)
    return true
  })
  handle(
    'mqtt:messages:export',
    (projectId: string, options: MqttMessageExportOptions) => {
      const payload = buildMessageExport(projectId, options)
      return saveExport(payload.defaultName, payload, [
        options.format === 'csv'
          ? { name: 'CSV', extensions: ['csv'] }
          : { name: 'JSONL', extensions: ['jsonl'] }
      ])
    }
  )

  handle(
    'mqtt:publish',
    (projectId: string, connectionId: string, input: MqttPublishInput) =>
      mqtt.publish(projectId, connectionId, input)
  )
  handle('mqtt:publish:history', (projectId: string) =>
    mqttStore.listPublishHistory(projectId)
  )
  handle(
    'mqtt:publish:startLoop',
    (
      projectId: string,
      connectionId: string,
      input: MqttPublishInput,
      options: MqttLoopOptions
    ) => mqtt.startLoop(projectId, connectionId, input, options)
  )
  handle('mqtt:publish:stopLoop', (projectId: string, connectionId: string) =>
    mqtt.stopLoop(projectId, connectionId)
  )
  handle('mqtt:publish:loopState', (projectId: string, connectionId: string) =>
    mqtt.getLoopState(projectId, connectionId)
  )

  handle(
    'mqtt:attempts:list',
    (projectId: string, connectionId?: string, limit?: number) =>
      mqttStore.listAttempts(projectId, connectionId, limit)
  )
  handle('mqtt:attempts:clear', (projectId: string, connectionId?: string) => {
    mqttStore.clearAttempts(projectId, connectionId)
    return true
  })
  handle('mqtt:attempts:export', (projectId: string, connectionId?: string) => {
    const payload = buildAttemptExport(projectId, connectionId)
    return saveExport(payload.defaultName, payload, [
      { name: 'JSONL', extensions: ['jsonl'] }
    ])
  })
}
