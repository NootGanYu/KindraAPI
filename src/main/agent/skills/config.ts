import { randomUUID } from 'node:crypto'
import { createEnvironment } from '@shared/factories'
import type { EnvVar, Environment, GlobalVars, ServerEntry } from '@shared/types'
import * as store from '../../storage/store'
import type { AgentToolApprovalDetails, AgentToolContext, AgentToolDefinition } from '../core/registry'
import { optionalString, requiredString } from '../core/registry'
import { assertConfigAuditAvailable, recordConfigChange } from '../configAudit'

const MASK = '***'
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const ENVIRONMENT_NAME_MAX = 100
const KEY_MAX = 200
const NAME_MAX = 200

function requireConfirm(args: Record<string, unknown>): void {
  if (args.confirm !== true) throw new Error('高风险删除需要 confirm: true 明确确认')
}
function environmentName(value: unknown): string {
  const name = requiredString({ name: value }, 'name')
  if (name.length > ENVIRONMENT_NAME_MAX) throw new Error(`环境名称不能超过 ${ENVIRONMENT_NAME_MAX} 个字符`)
  return name
}
function configKey(value: unknown): string {
  const key = requiredString({ key: value }, 'key').trim()
  if (!key || key.length > KEY_MAX || RESERVED_KEYS.has(key) || /[\u0000-\u001f]/.test(key)) throw new Error('变量 key 无效')
  return key
}
function configValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('变量 value 必须是字符串')
  return value
}
function optionalDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('description 必须是字符串')
  return value
}
function findEnvironment(projectId: string, envId: string): Environment {
  const environment = store.listEnvironments(projectId).find(item => item.env_id === envId)
  if (!environment) throw new Error('环境不存在或已删除')
  return environment
}
function line(context: AgentToolContext, lines: string[]): string {
  const safe = context.redact ? context.redact(lines) : lines
  return safe.join('\n')
}
function localWriteDetails(context: AgentToolContext, lines: string[]): AgentToolApprovalDetails {
  return { summary: lines[0], display: line(context, lines) }
}
async function audit(context: AgentToolContext, input: {
  kind: 'environment' | 'global_vars'
  action: Parameters<typeof recordConfigChange>[0]['action']
  entity_id: string
  key?: string
  masked: string
  before: Environment | GlobalVars | null
  after: Environment | GlobalVars | null
}): Promise<void> {
  await recordConfigChange({ projectId: context.projectId, turnId: context.turnId, ...input })
}

export const configTools: AgentToolDefinition[] = [
  {
    name: 'list_environments',
    description: '列出项目环境编号与名称。不返回变量值。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    readOnly: true,
    handler: (_args, { projectId }) => {
      const items = store.listEnvironments(projectId).map(environment => ({ env_id: environment.env_id, name: environment.name }))
      return { output: { items, total: items.length }, summary: `环境目录 ${items.length} 项` }
    }
  },
  {
    name: 'get_environment',
    description: '读取一个环境的名称与变量清单（仅变量名、说明、是否启用）。变量值被明确排除。',
    parameters: { type: 'object', properties: { env_id: { type: 'string' } }, required: ['env_id'], additionalProperties: false },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const envId = requiredString(args, 'env_id')
      const environment = findEnvironment(projectId, envId)
      const variables = Object.entries(environment.env_var_list).map(([key, variable]) => ({
        name: key,
        description: variable.description ?? '',
        enabled: variable.is_checked === 1
      }))
      return {
        output: { env_id: environment.env_id, name: environment.name, variables, server_count: environment.server_list.length },
        summary: `读取环境：${environment.name}（变量 ${variables.length} 项，未包含变量值）`
      }
    }
  },
  {
    name: 'list_global_vars',
    description: '列出项目全局变量的名称与说明。变量值被明确排除。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    readOnly: true,
    handler: (_args, { projectId }) => {
      const vars = store.getGlobalVars(projectId).vars
      const items = Object.entries(vars).map(([name, variable]) => ({ name, description: variable.description ?? '' }))
      return { output: { items, total: items.length }, summary: `全局变量 ${items.length} 项（未包含变量值）` }
    }
  },
  {
    name: 'create_environment',
    description: '创建一个新的本机环境。变量值不会回显。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    describeForApproval: (args, context) => {
      const name = environmentName(args.name)
      return localWriteDetails(context, ['新增环境', `名称：${name}`, '创建后可在变量审计中撤销。'])
    },
    handler: async (args, context) => {
      const name = environmentName(args.name)
      await assertConfigAuditAvailable()
      const environment = createEnvironment(context.projectId, name)
      const saved = store.saveEnvironment(context.projectId, environment)
      await audit(context, { kind: 'environment', action: 'create', entity_id: saved.env_id, masked: `新增环境「${name}」`, before: null, after: structuredClone(saved) })
      return { output: { environment_id: saved.env_id, name: saved.name, created: true }, summary: `已新增环境：${name}`, display: line(context, ['环境已新增。', `名称：${name}`, `编号：${saved.env_id}`]) }
    }
  },
  {
    name: 'update_environment',
    description: '更新环境名称或排序。变量值不会被读取或回显。',
    parameters: {
      type: 'object',
      properties: { env_id: { type: 'string' }, name: { type: 'string' }, sort: { type: 'integer' } },
      required: ['env_id'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    describeForApproval: (args, context) => {
      const envId = requiredString(args, 'env_id')
      const environment = findEnvironment(context.projectId, envId)
      return localWriteDetails(context, ['更新环境', `原名称：${environment.name}`, ...(optionalString(args.name) ? [`新名称：${optionalString(args.name)}`] : []), ...(args.sort !== undefined ? [`排序：${String(args.sort)}`] : []), '修改可在配置审计中撤销。'])
    },
    handler: async (args, context) => {
      const envId = requiredString(args, 'env_id')
      const environment = findEnvironment(context.projectId, envId)
      if (args.name === undefined && args.sort === undefined) throw new Error('没有需要更新的环境字段')
      const before = structuredClone(environment)
      if (args.name !== undefined) environment.name = environmentName(args.name)
      if (args.sort !== undefined) {
        if (!Number.isInteger(args.sort) || (args.sort as number) < 0) throw new Error('环境排序无效')
        environment.sort = args.sort as number
      }
      await assertConfigAuditAvailable()
      const saved = store.saveEnvironment(context.projectId, environment)
      await audit(context, { kind: 'environment', action: 'update', entity_id: saved.env_id, masked: `更新环境「${saved.name}」`, before, after: structuredClone(saved) })
      return { output: { environment_id: saved.env_id, name: saved.name, updated: true }, summary: `已更新环境：${saved.name}`, display: line(context, ['环境已更新。', `名称：${saved.name}`]) }
    }
  },
  {
    name: 'delete_environment',
    description: '不可逆删除一个环境及其变量；本机配置审计可在内容未变化时撤销恢复。必须 confirm: true 且审批。',
    parameters: {
      type: 'object',
      properties: { env_id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['env_id', 'confirm'],
      additionalProperties: false
    },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      requireConfirm(args)
      const environment = findEnvironment(context.projectId, requiredString(args, 'env_id'))
      return { summary: `不可逆删除环境：${environment.name}`, display: line(context, ['不可逆操作：删除环境及其变量清单。', `环境：${environment.name}`, '本机配置审计可在内容未变化时撤销恢复。']) }
    },
    handler: async (args, context) => {
      requireConfirm(args)
      const envId = requiredString(args, 'env_id')
      const environment = findEnvironment(context.projectId, envId)
      const before = structuredClone(environment)
      await assertConfigAuditAvailable()
      store.deleteEnvironment(context.projectId, envId)
      await audit(context, { kind: 'environment', action: 'delete', entity_id: envId, masked: `删除环境「${environment.name}」`, before, after: null })
      return { output: { environment_id: envId, deleted: true }, summary: `环境已删除：${environment.name}`, display: line(context, ['风险：不可逆删除环境。', `环境：${environment.name}`, '可通过配置审计撤销恢复。']) }
    }
  },
  {
    name: 'upsert_environment_variable',
    description: '新增或覆盖环境变量。value 只在主进程使用；结果显示为掩码，不进入会话或模型上下文。',
    parameters: {
      type: 'object',
      properties: {
        environment_id: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        description: { type: 'string' },
        is_checked: { type: 'boolean' }
      },
      required: ['environment_id', 'key', 'value'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    maskArgumentFields: ['value'],
    describeForApproval: (args, context) => {
      const environment = findEnvironment(context.projectId, requiredString(args, 'environment_id'))
      const key = configKey(args.key)
      configValue(args.value)
      return localWriteDetails(context, ['设置环境变量', `环境：${environment.name}`, `变量：${key}`, `覆盖：${Object.hasOwn(environment.env_var_list, key) ? '是' : '否'}`, `值：${MASK}`, '变量值不会回显。'])
    },
    handler: async (args, context) => {
      const environment = findEnvironment(context.projectId, requiredString(args, 'environment_id'))
      const key = configKey(args.key)
      const value = configValue(args.value)
      const description = optionalDescription(args.description)
      if (args.is_checked !== undefined && typeof args.is_checked !== 'boolean') throw new Error('is_checked 必须是布尔值')
      const before = structuredClone(environment)
      const existing: EnvVar | undefined = environment.env_var_list[key]
      const variable: EnvVar = {
        current_value: value,
        initial_value: existing?.initial_value ?? value,
        description: description ?? existing?.description ?? '',
        is_checked: args.is_checked === false ? 0 : args.is_checked === true ? 1 : existing?.is_checked ?? 1
      }
      environment.env_var_list = { ...environment.env_var_list, [key]: variable }
      await assertConfigAuditAvailable()
      const saved = store.saveEnvironment(context.projectId, environment)
      await audit(context, { kind: 'environment', action: 'upsert_variable', entity_id: saved.env_id, key, masked: `设置环境「${saved.name}」变量 ${key}（${existing ? '覆盖' : '新增'}），值 ${MASK}`, before, after: structuredClone(saved) })
      return { output: { environment_id: saved.env_id, key, created: !existing, updated: true, masked: MASK }, summary: `已设置环境变量：${key}`, display: line(context, ['环境变量已写入。', `环境：${saved.name}`, `变量：${key}`, `覆盖：${existing ? '是' : '否'}`, `值：${MASK}`, '可通过配置审计撤销。']) }
    }
  },
  {
    name: 'delete_environment_variable',
    description: '不可逆删除一个环境变量；本机配置审计可撤销恢复。必须审批。',
    parameters: {
      type: 'object',
      properties: { environment_id: { type: 'string' }, key: { type: 'string' } },
      required: ['environment_id', 'key'],
      additionalProperties: false
    },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      const environment = findEnvironment(context.projectId, requiredString(args, 'environment_id'))
      const key = configKey(args.key)
      if (!Object.hasOwn(environment.env_var_list, key)) throw new Error('变量不存在')
      return { summary: `不可逆删除环境变量：${key}`, display: line(context, ['不可逆操作：删除环境变量。', `环境：${environment.name}`, `变量：${key}`, '可通过配置审计撤销恢复。']) }
    },
    handler: async (args, context) => {
      const environment = findEnvironment(context.projectId, requiredString(args, 'environment_id'))
      const key = configKey(args.key)
      if (!Object.hasOwn(environment.env_var_list, key)) throw new Error('变量不存在')
      const before = structuredClone(environment)
      const variables = { ...environment.env_var_list }
      delete variables[key]
      environment.env_var_list = variables
      await assertConfigAuditAvailable()
      const saved = store.saveEnvironment(context.projectId, environment)
      await audit(context, { kind: 'environment', action: 'delete_variable', entity_id: saved.env_id, key, masked: `删除环境「${saved.name}」变量 ${key}`, before, after: structuredClone(saved) })
      return { output: { environment_id: saved.env_id, key, deleted: true }, summary: `已删除环境变量：${key}`, display: line(context, ['风险：不可逆删除环境变量。', `环境：${saved.name}`, `变量：${key}`, '可通过配置审计撤销恢复。']) }
    }
  },
  {
    name: 'upsert_global_variable',
    description: '新增或覆盖全局变量。value 只在主进程使用；结果显示为掩码，不进入会话或模型上下文。',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, value: { type: 'string' }, description: { type: 'string' } },
      required: ['key', 'value'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    maskArgumentFields: ['value'],
    describeForApproval: (args, context) => {
      const key = configKey(args.key)
      configValue(args.value)
      const current = store.getGlobalVars(context.projectId)
      return localWriteDetails(context, ['设置全局变量', `变量：${key}`, `覆盖：${Object.hasOwn(current.vars, key) ? '是' : '否'}`, `值：${MASK}`, '变量值不会回显。'])
    },
    handler: async (args, context) => {
      const key = configKey(args.key)
      const value = configValue(args.value)
      const description = optionalDescription(args.description)
      const current = store.getGlobalVars(context.projectId)
      const before = structuredClone(current)
      const existing = current.vars[key]
      current.vars = { ...current.vars, [key]: { current_value: value, initial_value: existing?.initial_value ?? value, description: description ?? existing?.description ?? '' } }
      await assertConfigAuditAvailable()
      const saved = store.saveGlobalVars(context.projectId, current)
      await audit(context, { kind: 'global_vars', action: 'upsert_variable', entity_id: 'global', key, masked: `设置全局变量 ${key}（${existing ? '覆盖' : '新增'}），值 ${MASK}`, before, after: structuredClone(saved) })
      return { output: { key, created: !existing, updated: true, masked: MASK }, summary: `已设置全局变量：${key}`, display: line(context, ['全局变量已写入。', `变量：${key}`, `覆盖：${existing ? '是' : '否'}`, `值：${MASK}`, '可通过配置审计撤销。']) }
    }
  },
  {
    name: 'delete_global_variable',
    description: '不可逆删除一个全局变量；本机配置审计可撤销恢复。必须审批。',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
      additionalProperties: false
    },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      const key = configKey(args.key)
      if (!Object.hasOwn(store.getGlobalVars(context.projectId).vars, key)) throw new Error('全局变量不存在')
      return { summary: `不可逆删除全局变量：${key}`, display: line(context, ['不可逆操作：删除全局变量。', `变量：${key}`, '可通过配置审计撤销恢复。']) }
    },
    handler: async (args, context) => {
      const key = configKey(args.key)
      const current = store.getGlobalVars(context.projectId)
      if (!Object.hasOwn(current.vars, key)) throw new Error('全局变量不存在')
      const before = structuredClone(current)
      const vars = { ...current.vars }
      delete vars[key]
      current.vars = vars
      await assertConfigAuditAvailable()
      const saved = store.saveGlobalVars(context.projectId, current)
      await audit(context, { kind: 'global_vars', action: 'delete_variable', entity_id: 'global', key, masked: `删除全局变量 ${key}`, before, after: structuredClone(saved) })
      return { output: { key, deleted: true }, summary: `已删除全局变量：${key}`, display: line(context, ['风险：不可逆删除全局变量。', `变量：${key}`, '可通过配置审计撤销恢复。']) }
    }
  },
  {
    name: 'upsert_environment_server',
    description: '新增或更新环境服务器。URI 在会话与结果中隐藏。',
    parameters: {
      type: 'object',
      properties: { environment_id: { type: 'string' }, server_id: { type: 'string' }, name: { type: 'string' }, uri: { type: 'string' } },
      required: ['environment_id', 'name', 'uri'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    maskArgumentFields: ['uri'],
    describeForApproval: (args, context) => {
      const environment = findEnvironment(context.projectId, requiredString(args, 'environment_id'))
      const name = serverName(args.name)
      const serverId = optionalString(args.server_id)
      const existing = serverId ? environment.server_list.find(item => item.server_id === serverId) : undefined
      if (serverId && !existing) throw new Error('服务器不存在')
      return localWriteDetails(context, ['设置环境服务器', `环境：${environment.name}`, `服务器：${name}`, `覆盖：${existing ? '是' : '否'}`, 'URI：已隐藏', '修改可通过配置审计撤销。'])
    },
    handler: async (args, context) => {
      const environment = findEnvironment(context.projectId, requiredString(args, 'environment_id'))
      const name = serverName(args.name)
      const uri = serverUri(args.uri)
      const serverId = optionalString(args.server_id)
      const before = structuredClone(environment)
      const index = serverId ? environment.server_list.findIndex(item => item.server_id === serverId) : -1
      if (serverId && index < 0) throw new Error('服务器不存在')
      const server: ServerEntry = index >= 0
        ? { ...environment.server_list[index], name, uri }
        : { server_id: randomUUID(), name, uri, sort: Math.max(0, ...environment.server_list.map(item => item.sort ?? 0)) + 100 }
      const servers = [...environment.server_list]
      if (index >= 0) servers[index] = server
      else servers.push(server)
      environment.server_list = servers
      await assertConfigAuditAvailable()
      const saved = store.saveEnvironment(context.projectId, environment)
      await audit(context, { kind: 'environment', action: 'upsert_server', entity_id: saved.env_id, key: `server:${server.server_id}`, masked: `设置环境「${saved.name}」服务器 ${name}（${index >= 0 ? '覆盖' : '新增'}）`, before, after: structuredClone(saved) })
      return { output: { environment_id: saved.env_id, server_id: server.server_id, name, created: index < 0 }, summary: `已设置环境服务器：${name}`, display: line(context, ['环境服务器已写入。', `环境：${saved.name}`, `服务器：${name}`, 'URI：已隐藏']) }
    }
  },
  {
    name: 'delete_environment_server',
    description: '不可逆删除环境服务器；本机配置审计可撤销恢复。必须审批。',
    parameters: {
      type: 'object',
      properties: { environment_id: { type: 'string' }, server_id: { type: 'string' } },
      required: ['environment_id', 'server_id'],
      additionalProperties: false
    },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      const environment = findEnvironment(context.projectId, requiredString(args, 'environment_id'))
      const serverId = requiredString(args, 'server_id')
      const server = environment.server_list.find(item => item.server_id === serverId)
      if (!server) throw new Error('服务器不存在')
      return { summary: `不可逆删除环境服务器：${server.name}`, display: line(context, ['不可逆操作：删除环境服务器。', `环境：${environment.name}`, `服务器：${server.name}`, '可通过配置审计撤销恢复。']) }
    },
    handler: async (args, context) => {
      const environment = findEnvironment(context.projectId, requiredString(args, 'environment_id'))
      const serverId = requiredString(args, 'server_id')
      const server = environment.server_list.find(item => item.server_id === serverId)
      if (!server) throw new Error('服务器不存在')
      const before = structuredClone(environment)
      environment.server_list = environment.server_list.filter(item => item.server_id !== serverId)
      await assertConfigAuditAvailable()
      const saved = store.saveEnvironment(context.projectId, environment)
      await audit(context, { kind: 'environment', action: 'delete_server', entity_id: saved.env_id, key: `server:${serverId}`, masked: `删除环境「${saved.name}」服务器 ${server.name}`, before, after: structuredClone(saved) })
      return { output: { environment_id: saved.env_id, server_id: serverId, deleted: true }, summary: `已删除环境服务器：${server.name}`, display: line(context, ['风险：不可逆删除环境服务器。', `环境：${saved.name}`, `服务器：${server.name}`, '可通过配置审计撤销恢复。']) }
    }
  }
]

function serverName(value: unknown): string {
  const name = requiredString({ name: value }, 'name')
  if (name.length > NAME_MAX) throw new Error(`服务器名称不能超过 ${NAME_MAX} 个字符`)
  return name
}
function serverUri(value: unknown): string {
  if (typeof value !== 'string') throw new Error('服务器 URI 必须是字符串')
  return value
}
