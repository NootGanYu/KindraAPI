import { app, clipboard, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type {
  AppSettings,
  DataModel,
  DbConnection,
  DebugConfig,
  DictionaryEntry,
  DictionarySettings,
  Environment,
  Flow,
  GlobalVars,
  ImportDbOptions,
  McpConfig,
  ModelSchema,
  ModelType,
  Project,
  RequestModel,
  Result,
  SendRecord,
  SendRecordSummary,
  Target
} from '@shared/types'
import * as store from './storage/store'
import { sendRequest } from './request/executor'
import { runFlow } from './flow/engine'
import { createFlow } from '@shared/factories'
import { generateFromSchema, generateModelExample, resolveModelRefs } from './schema/example'
import { importDbTables, listDbTables, testDbConnection } from './db/mysql'
import {
  getMcpStatus,
  restartMcpServer
} from './mcp/server'
import { listToolInfos } from './mcp/tools'

function handle<T>(channel: string, fn: (...args: any[]) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

export function registerIpc(): void {
  handle('app:paths', () => store.getPaths())
  handle('app:openPath', (targetPath: string) => shell.openPath(targetPath))
  handle('app:copyText', (text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  handle('app:relaunch', () => {
    setTimeout(() => {
      // 调试端口由设置项决定，重启时丢弃手动附加的启动参数。
      const args = process.argv
        .slice(1)
        .filter((arg) => !arg.startsWith('--remote-debugging-port'))
      app.relaunch({ args })
      app.exit(0)
    }, 300)
    return true
  })

  handle('debug:get', () => store.getDebugState())
  handle('debug:save', (config: DebugConfig) => store.saveDebugConfig(config))

  handle('project:list', () => store.listProjects())
  handle('project:create', (name: string) => store.createProjectWithDefaults(name))
  handle('project:save', (project: Project) => store.saveProject(project))
  handle('project:ensureDefault', () => store.ensureDefaultProject())

  handle('target:list', (projectId: string) => store.listTargets(projectId))
  handle('target:get', (projectId: string, targetId: string) => store.getTarget(projectId, targetId))
  handle('target:create', (projectId: string, parentId: string, type: 'folder' | 'api') =>
    store.createTargetInProject(projectId, parentId, type)
  )
  handle('target:save', (projectId: string, target: Target) => store.saveTarget(projectId, target))
  handle('target:delete', (projectId: string, targetId: string) => {
    store.deleteTarget(projectId, targetId)
    return true
  })
  handle('target:reorder', (projectId: string, parentId: string, orderedIds: string[]) =>
    store.reorderTargets(projectId, parentId, orderedIds)
  )

  handle('env:list', (projectId: string) => store.listEnvironments(projectId))
  handle('env:save', (projectId: string, env: Environment) => store.saveEnvironment(projectId, env))

  handle('globals:get', (projectId: string) => store.getGlobalVars(projectId))
  handle('globals:save', (projectId: string, vars: GlobalVars) => store.saveGlobalVars(projectId, vars))
  handle('globalParams:get', (projectId: string) => store.getGlobalParams(projectId))
  handle('globalParams:save', (projectId: string, req: RequestModel) =>
    store.saveGlobalParams(projectId, req)
  )

  handle('settings:get', () => store.getSettings())
  handle('settings:save', (settings: AppSettings) => store.saveSettings(settings))

  handle('http:send', async (projectId: string, target: Target, environmentId?: string) => {
    const record: SendRecord = await sendRequest(projectId, target, environmentId)
    store.addSendRecord(projectId, record)
    return record
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

  // M2 · flows
  handle('flow:list', (projectId: string) => store.listFlows(projectId))
  handle('flow:get', (projectId: string, flowId: string) => store.getFlow(projectId, flowId))
  handle('flow:create', (projectId: string, name: string) => {
    const environments = store.listEnvironments(projectId)
    const flow = createFlow(projectId, name, environments[0]?.env_id ?? '')
    return store.saveFlow(projectId, flow)
  })
  handle('flow:save', (projectId: string, flow: Flow) => store.saveFlow(projectId, flow))
  handle('flow:delete', (projectId: string, flowId: string) => {
    store.deleteFlow(projectId, flowId)
    return true
  })
  handle('flow:run', (projectId: string, flowId: string, environmentId?: string) => {
    const flow = store.getFlow(projectId, flowId)
    if (!flow) throw new Error('流程不存在')
    return runFlow(projectId, flow, environmentId)
  })
  handle('flow:runs', (projectId: string, limit?: number) => store.listFlowRuns(projectId, limit))
  handle('flow:run:get', (projectId: string, runId: string) =>
    store.getFlowRun(projectId, runId)
  )

  // Data dictionary
  handle('dictionary:list', (projectId: string) => store.listDictionaryEntries(projectId))
  handle('dictionary:suggestions', (projectId: string) => store.listDictionarySuggestions(projectId))
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
  handle('model:save', (projectId: string, model: DataModel) => store.saveModel(projectId, model))
  handle('model:delete', (projectId: string, modelId: string) =>
    store.deleteModelWithReferences(projectId, modelId)
  )
  handle('model:create', (projectId: string, parentId: string, kind: ModelType) =>
    store.createModelInProject(projectId, parentId, kind)
  )
  handle('model:copy', (projectId: string, modelId: string, destParentId: string) =>
    store.copyModel(projectId, modelId, destParentId)
  )
  handle(
    'model:move',
    (projectId: string, modelId: string, destParentId: string, orderedIds?: string[]) =>
      store.moveModel(projectId, modelId, destParentId, orderedIds)
  )
  handle('model:reorder', (projectId: string, parentId: string, orderedIds: string[]) =>
    store.reorderModels(projectId, parentId, orderedIds)
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
}
