import { app, clipboard, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type {
  AppSettings,
  DebugConfig,
  DocServiceConfig,
  DocShareInput,
  Environment,
  Flow,
  GlobalVars,
  McpConfig,
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
import {
  getMcpStatus,
  restartMcpServer
} from './mcp/server'
import { listToolInfos } from './mcp/tools'
import {
  getDocServiceStatus,
  restartDocServer
} from './docs/server'

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
  handle('app:openExternal', async (url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅支持 http/https 链接')
    }
    await shell.openExternal(parsed.toString())
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
}
