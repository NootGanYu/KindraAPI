import { projectPermissionError } from './permissions'
import { readApiDetail, withDisplayFieldDocs } from '../business/apiRead'
import { rulesFromSchema } from '@shared/fieldRules'
import { DICT_FIELD_TYPES } from '@shared/types'
import { defaultApiStatus } from '@shared/apiStatuses'
import { withTargetChanges } from '../storage/changes'
import type {
  ApiCase,
  CaseAssertion,
  DbConnection,
  DbSshConfig,
  DictionaryEntry,
  Environment,
  FlowEvent,
  FlowRequestInput,
  ImportConflictStrategy,
  McpConfig,
  McpToolInfo,
  ModelReference,
  ModelSchema,
  Target
} from '@shared/types'
import {
  createApiCase,
  createCaseAssertion,
  createDbConnection,
  createEnvironment,
  createFlow,
  createFlowEvent,
  createId,
  createParam,
  createTarget,
  createRequest
} from '@shared/factories'
import * as store from '../storage/store'
import { apiDocumentationProperties, HTTP_URL_DESCRIPTION, successSchema, writeApiDocumentation, patchSuccessResponse, patchParams, patchBody, documentationIssues } from './apiDocumentation'
import { responseDocs } from '../docs/definition'
import { sendRequest } from '../request/executor'
import { runApiCase, runApiCases } from '../request/cases'
import { normalizeFlowEvents, hasStructuredEvents } from '../flow/definition'
import { applyRequestInput } from '../flow/engine'
import { startFlowRun, getFlowRun, waitForFlowRun, pauseFlowRun, cancelFlowRun } from '../flow/service'
import { generateSchemaExample } from '../schema/example'
import {
  fieldDocsFromSchema,
  mergeFieldDocs,
  normalizeFieldDocs
} from '@shared/jsonFields'
import { importDbTables, testDbConnection } from '../db/mysql'
import * as mqttStore from '../mqtt/store'
import * as mqttSessions from '../mqtt/sessionManager'
import type {
  MqttConnectionProfile,
  MqttMqtt5Config,
  MqttPayloadView,
  MqttProtocolVersion,
  MqttPublishInput,
  MqttQos,
  MqttRetention,
  MqttSubscription,
  MqttTlsConfig,
  MqttTransport,
  MqttUserProperty,
  MqttWill
} from '@shared/mqtt'
import { createDefaultMqttProfile } from '@shared/mqtt'

type Args = Record<string, unknown>

interface ToolDefinition {
  name: string
  description: string
  requires_write: boolean
  requires_execute: boolean
  input_schema: Record<string, unknown>
  handler: (args: Args, config: McpConfig) => Promise<unknown> | unknown
}

function str(args: Args, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

function requiredStr(args: Args, key: string): string {
  const value = str(args, key)
  if (!value) throw new Error(`缺少参数 ${key}`)
  return value
}

function projectIdOf(args: Args): string {
  return requiredStr(args, 'project_id')
}

function boolArg(args: Args, key: string): boolean {
  return args[key] === true
}

function apiTargetOf(args: Args): Target {
  const target = store.getTarget(projectIdOf(args), requiredStr(args, 'target_id'))
  if (!target || target.target_type !== 'api') throw new Error('接口不存在')
  return target
}


function caseOf(target: Target, caseId: string): ApiCase {
  const apiCase = (target.cases ?? []).find((item) => item.case_id === caseId)
  if (!apiCase) throw new Error('用例不存在')
  return apiCase
}

function normalizeAssertions(raw: unknown): CaseAssertion[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const source = (item ?? {}) as Record<string, unknown>
    const assertion = createCaseAssertion({
      kind: (typeof source.kind === 'string' ? source.kind : 'status') as CaseAssertion['kind'],
      op: (typeof source.op === 'string' ? source.op : 'equals') as CaseAssertion['op'],
      path: typeof source.path === 'string' ? source.path : '',
      expected: typeof source.expected === 'string' ? source.expected : '',
      is_enabled: source.is_enabled === 0 || source.enabled === false ? 0 : 1
    })
    if (typeof source.assertion_id === 'string' && source.assertion_id) {
      assertion.assertion_id = source.assertion_id
    }
    return assertion
  })
}

function casePatchOf(args: Args): Partial<ApiCase> {
  const patch: Partial<ApiCase> = {}
  if (typeof args.name === 'string') patch.name = args.name
  if (typeof args.description === 'string') patch.description = args.description
  if (typeof args.is_enabled === 'boolean') patch.is_enabled = args.is_enabled ? 1 : 0
  if (args.override && typeof args.override === 'object') {
    patch.override = args.override as ApiCase['override']
  }
  if (args.assertions !== undefined) patch.assertions = normalizeAssertions(args.assertions)
  return patch
}

function schema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: true
  }
}

const S = {
  project: { type: 'string', description: '项目 ID。MCP 客户端配置了 KINDRA_DEFAULT_PROJECT_ID 时可省略，由桥自动补全' },
  target: { type: 'string', description: '接口 target_id，用 list_apis 获取，不要凭记忆填写' },
  flow: { type: 'string', description: '流程 flow_id' },
  environment: { type: 'string', description: '环境 env_id；配置了 KINDRA_DEFAULT_ENVIRONMENT_ID 时可省略' },
  confirm: { type: 'boolean', description: '删除类操作必须显式传 true' }
}

function loadEnv(projectId: string, envId: string): Environment {
  const env = store.listEnvironments(projectId).find((item) => item.env_id === envId)
  if (!env) throw new Error('环境不存在')
  return env
}

function currentEnv(projectId: string, envId?: string): Environment {
  if (envId) return loadEnv(projectId, envId)
  const environments = store.listEnvironments(projectId)
  const settings = store.getSettings()
  const env =
    environments.find((item) => item.env_id === settings.environment_id) ??
    environments[0]
  if (!env) throw new Error('项目还没有环境')
  return env
}

function mqttProfilePatch(args: Args): Partial<MqttConnectionProfile> {
  const source =
    args.profile && typeof args.profile === 'object' && !Array.isArray(args.profile)
      ? (args.profile as Record<string, unknown>)
      : args
  const patch: Partial<MqttConnectionProfile> = {}
  if (typeof source.name === 'string') patch.name = source.name
  if (typeof source.group === 'string') patch.group = source.group
  if (typeof source.host === 'string') patch.host = source.host
  if (typeof source.ws_path === 'string') patch.ws_path = source.ws_path
  if (typeof source.client_id === 'string') patch.client_id = source.client_id
  if (typeof source.username === 'string') patch.username = source.username
  if (typeof source.password === 'string') patch.password = source.password
  if (typeof source.transport === 'string') {
    const transport = source.transport
    if (transport === 'tcp' || transport === 'tls' || transport === 'ws' || transport === 'wss') {
      patch.transport = transport as MqttTransport
    }
  }
  for (const key of ['port', 'keepalive', 'connect_timeout_ms'] as const) {
    const value = source[key]
    if (value !== undefined && value !== null && !Number.isNaN(Number(value))) {
      patch[key] = Number(value)
    }
  }
  if (source.protocol_version !== undefined) {
    const version = Number(source.protocol_version)
    if (version === 4 || version === 5) {
      patch.protocol_version = version as MqttProtocolVersion
    }
  }
  if (typeof source.clean_session === 'boolean') patch.clean_session = source.clean_session
  if (Array.isArray(source.subscriptions)) {
    patch.subscriptions = (source.subscriptions as unknown[])
      .map((item) => item as Record<string, unknown>)
      .filter((item) => item && typeof item.filter === 'string')
      .map((item) => ({ filter: String(item.filter), qos: mqttQosArg(item.qos) }))
  }
  if (source.tls && typeof source.tls === 'object' && !Array.isArray(source.tls)) {
    patch.tls = source.tls as MqttTlsConfig
  }
  if (source.will && typeof source.will === 'object' && !Array.isArray(source.will)) {
    patch.will = source.will as MqttWill
  }
  if (source.mqtt5 && typeof source.mqtt5 === 'object' && !Array.isArray(source.mqtt5)) {
    patch.mqtt5 = source.mqtt5 as MqttMqtt5Config
  }
  if (source.retention && typeof source.retention === 'object' && !Array.isArray(source.retention)) {
    patch.retention = source.retention as MqttRetention
  }
  return patch
}

function mqttQosArg(value: unknown): MqttQos {
  const qos = Number(value ?? 0)
  if (qos !== 0 && qos !== 1 && qos !== 2) throw new Error('QoS 必须是 0、1 或 2')
  return qos
}

function mqttSubscriptionsArg(args: Args): MqttSubscription[] {
  const raw = args.filters
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') return { filter: item, qos: 0 }
      const value = item as Record<string, unknown>
      const filter = String(value.filter ?? value.topic ?? '')
      if (!filter) throw new Error('Topic Filter 不能为空')
      return { filter, qos: mqttQosArg(value.qos) }
    })
  }
  const single = str(args, 'filter') || str(args, 'topic')
  if (!single) throw new Error('缺少参数 filters')
  return [{ filter: single, qos: mqttQosArg(args.qos) }]
}

function mqttPayloadArg(args: Args): string {
  if (typeof args.payload === 'string') return args.payload
  if (args.payload === undefined || args.payload === null) return ''
  return String(args.payload)
}

function mqttPayloadViewArg(args: Args): MqttPayloadView {
  const view = str(args, 'payload_view') || 'plain'
  if (view !== 'json' && view !== 'plain' && view !== 'hex' && view !== 'base64') {
    throw new Error('payload_view 必须是 json、plain、hex 或 base64')
  }
  return view
}

function mqttUserPropertiesArg(args: Args): MqttUserProperty[] | undefined {
  if (!Array.isArray(args.user_properties)) return undefined
  return (args.user_properties as unknown[])
    .map((item) => item as Record<string, unknown>)
    .filter((item) => item && typeof item.key === 'string' && item.key)
    .map((item) => ({ key: String(item.key), value: String(item.value ?? '') }))
}

function exampleFromSchema(value: unknown): unknown {
  return generateSchemaExample(value as any).value
}

function stepEvents(projectId: string, steps: unknown): FlowEvent[] {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps 必须是非空数组')
  const events: FlowEvent[] = []
  for (const raw of steps) {
    const step = (raw ?? {}) as Record<string, unknown>
    const targetId = typeof step.target_id === 'string' ? step.target_id : ''
    if (!targetId) throw new Error('每个步骤都需要 target_id')
    const target = store.getTarget(projectId, targetId)
    if (!target || target.target_type !== 'api') throw new Error(`接口不存在: ${targetId}`)
    for (const key of ['event_id', 'step_id', 'logical_step_id', 'pre_event_id', 'post_event_id']) {
      if (step[key] !== undefined && (typeof step[key] !== 'string' || !step[key])) throw new Error(`${key} 必须是非空字符串`)
    }
    const stepId = typeof step.step_id === 'string' ? step.step_id
      : typeof step.event_id === 'string' ? step.event_id : createId('step')
    const eventId = typeof step.event_id === 'string' ? step.event_id : `${stepId}:api`
    const identity = { step_id: stepId, logical_step_id: typeof step.logical_step_id === 'string' ? step.logical_step_id : stepId }
    if (typeof step.pre_script === 'string' && step.pre_script) {
      events.push(createFlowEvent('script', {
        ...identity,
        event_id: typeof step.pre_event_id === 'string' ? step.pre_event_id : `${eventId}:pre`,
        name: `${target.name} · 预执行`, script: step.pre_script
      }))
    }
    events.push(
      createFlowEvent('api', {
        ...identity,
        event_id: eventId,
        name: target.name,
        target_id: targetId,
        input: (step.input ?? {}) as FlowRequestInput
      })
    )
    if (typeof step.post_script === 'string' && step.post_script) {
      events.push(createFlowEvent('script', {
        ...identity,
        event_id: typeof step.post_event_id === 'string' ? step.post_event_id : `${eventId}:post`,
        name: `${target.name} · 后执行`, script: step.post_script
      }))
    }
  }
  return events
}

function executeSummary(record: Awaited<ReturnType<typeof sendRequest>>): Record<string, unknown> {
  const assertions = record.assertions ?? []
  const failed = assertions.filter((item) => !item.passed && !item.skipped)
  return {
    run_id: record.record_id,
    project_id: record.project_id,
    target_id: record.target_id,
    status: record.status,
    scope: 'api',
    elapsed_ms: record.response?.response_time ?? 0,
    status_code: record.response?.code ?? null,
    total: assertions.length,
    passed: assertions.filter((item) => item.passed).length,
    failed: failed.map((item) => item.name)
  }
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'upsert_api',
    description:
      '编码 Agent 首选：一次提交完整接口文档（新建或增量更新）。接口交付统一写入 Kindra，不使用 Apifox 等外部工具。' +
      '硬性文档校验：新建必须填写接口说明 description 与完整 http(s) URL（含主机名和路径），每个已知请求参数、请求体字段和响应字段必须写明 description、type、required、nullable、enum，有枚举时必须提供逐项对应的 enum_descriptions；缺失任一项直接拒绝写入且不保存。更新时仅校验本次显式提交的字段，未提交字段保持原样。' +
      '交付约定：headers 至少包含 Authorization: Bearer <token>；JSON 接口再加 Content-Type: application/json 与 Accept: application/json（上传用 multipart/form-data，下载用 Accept: application/octet-stream）。显式写 Authorization 时把 auth.type 设为 none，不要只配 auth。请求示例每个字段都要真实可执行，禁止留空、{} 或 "xxx" 占位；Long 类型 ID 用字符串。响应示例必须来自 execute_api + save_response=true 的实测结果，不能手写。' +
      'target_id 或稳定 source_key（推荐 Controller.method）定位；省略保留，remove/unset 显式删除。返回 documentation.complete 与逐字段待补充清单，仍有缺项需在最终回复中列出。',
    requires_write: true, requires_execute: false,
    input_schema: schema(apiDocumentationProperties, ['project_id']),
    handler: args => writeApiDocumentation(args)
  },
  {
    name: 'list_projects',
    description: '列出已在 MCP 授权列表中的项目。开始前先用它确认项目；不要操作未授权项目。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({}),
    handler: (_args, config) => ({
      projects: store
        .listProjects()
        .filter((project) => config.allowed_project_ids.includes(project.project_id))
        .map((project) => ({
          project_id: project.project_id,
          name: project.name,
          intro: project.intro
        }))
    })
  },
  {
    name: 'create_project',
    description: '创建项目，并自动加入 MCP 授权列表。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        name: { type: 'string', description: '项目名称（≤64）' },
        description: { type: 'string', description: '项目说明（≤1024）。Agent 应填写项目用途与范围；无法确定时向用户确认' }
      },
      ['name']
    ),
    handler: (args, config) => {
      const name = requiredStr(args, 'name').slice(0, 64)
      const project = store.createProjectWithDefaults(name)
      const description = str(args, 'description')
      if (description) {
        project.intro = description.slice(0, 1024)
        store.saveProject(project)
      }
      const current = store.getMcpConfig()
      store.saveMcpConfig({
        ...current,
        allowed_project_ids: [...current.allowed_project_ids, project.project_id]
      })
      return {
        project_id: project.project_id,
        name: project.name,
        description: project.intro,
        storage_path: `${store.getPaths().projectRoot}/${project.project_id}`,
        authorized: true
      }
    }
  },
  {
    name: 'list_apis',
    description: '列出项目中的接口与目录，可按父目录或关键字过滤。根目录 parent_id=0。新建或导入前必须用它确认 folder_id / target_id，不要凭记忆填写；目录不存在时先用 create_folder 创建。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({
      project_id: S.project,
      parent_id: { type: 'string', description: '父目录 ID，根为 0' },
      keyword: { type: 'string', description: '名称 / URL / 方法关键字' }
    }, ['project_id']),
    handler: (args) => {
      const projectId = projectIdOf(args)
      let list = store.listTargets(projectId)
      const parentId = str(args, 'parent_id')
      if (parentId) list = list.filter((item) => item.parent_id === parentId)
      const keyword = str(args, 'keyword').toLowerCase()
      if (keyword) {
        list = list.filter(
          (item) =>
            item.name.toLowerCase().includes(keyword) ||
            (item.url ?? '').toLowerCase().includes(keyword) ||
            (item.method ?? '').toLowerCase().includes(keyword)
        )
      }
      return {
        apis: list.map((item) => ({
          target_id: item.target_id,
          parent_id: item.parent_id,
          target_type: item.target_type,
          name: item.name,
          description: item.description,
          method: item.method,
          url: item.url,
          sort: item.sort
        }))
      }
    }
  },
  {
    name: 'create_folder',
    description: '在项目中创建目录，可指定父目录（根为 0）。必须填写目录说明 description，说明该目录组织哪些接口或业务模块。创建后立即记录返回的 target_id，供 sync_openapi 的 folder_id、create_api/upsert_api 的 parent_id 使用。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        parent_id: { type: 'string', description: '父目录 ID，根为 0' },
        name: { type: 'string', description: '目录名称' },
        description: { type: 'string', description: '目录说明（必填）。说明目录用途、包含的接口或业务范围' },
        sort: { type: 'number', description: '排序值（可选）' }
      },
      ['project_id', 'name']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const parentId = str(args, 'parent_id') || '0'
      const folder = store.createTargetInProject(projectId, parentId, 'folder')
      folder.name = requiredStr(args, 'name')
      const description = str(args, 'description').trim()
      if (description) folder.description = description
      if (typeof args.sort === 'number' && Number.isFinite(args.sort)) folder.sort = args.sort
      return { folder: store.saveTarget(projectId, folder) }
    }
  },
  {
    name: 'create_api',
    description: '在项目指定目录下创建接口（根为 0）。执行与 upsert_api 相同的硬性文档校验：必须填写接口说明 description 与完整 http(s) URL；传入请求/响应字段时，每个已知字段必须写明 description、type、required、nullable、enum，有枚举时必须提供 enum_descriptions。缺失任一项将拒绝写入且不保存。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        parent_id: { type: 'string', description: '父目录 ID，根为 0' },
        name: { type: 'string', description: '接口名称' },
        method: { type: 'string', description: 'HTTP 方法，默认 GET' },
        url: { type: 'string', description: HTTP_URL_DESCRIPTION },
        description: { type: 'string', description: '接口说明（必填）' }
      },
      ['project_id', 'name', 'url', 'description']
    ),
    handler: args => writeApiDocumentation(args, true)
  },
  {
    name: 'get_api_detail',
    description: '获取单个接口的完整实体（说明、Header、参数、请求示例、响应示例）。交付前用它回读核对三项是否齐全；documentation.complete=false 时 issues 列出缺失字段说明，必须补齐后再交付。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, target_id: S.target }, ['project_id', 'target_id']),
    handler: (args) => {
      return readApiDetail(projectIdOf(args), requiredStr(args, 'target_id'))
    }
  },
  {
    name: 'update_api',
    description:
      '更新已有接口：名称、方法、URL、Header/Query/Cookie/Path 参数、Body，以及响应示例。只修改传入的字段。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: S.target,
        name: { type: 'string' },
        method: { type: 'string', description: 'GET / POST / PUT / PATCH / DELETE 等' },
        url: { type: 'string', description: HTTP_URL_DESCRIPTION },
        headers: {
          type: 'array',
          description: '覆盖 Header 参数列表',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
              description: { type: 'string' },
              checked: { type: 'boolean' }
            },
            required: ['key']
          }
        },
        query: { type: 'array', description: '覆盖 Query 参数列表，结构同 headers' },
        cookies: { type: 'array', description: '覆盖 Cookie 参数列表，结构同 headers' },
        paths: { type: 'array', description: '覆盖 Path 参数列表，结构同 headers' },
        auth: {
          type: 'object',
          description: '认证配置',
          properties: {
            type: {
              type: 'string',
              enum: ['inherit', 'noauth', 'bearer', 'basic', 'kv']
            },
            bearer: { type: 'object', properties: { key: { type: 'string' } } },
            basic: {
              type: 'object',
              properties: {
                username: { type: 'string' },
                password: { type: 'string' }
              }
            },
            kv: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                value: { type: 'string' },
                in: { type: 'string', enum: ['header', 'query'] }
              }
            }
          }
        },
        body: {
          type: 'object',
          description: '请求体',
          properties: {
            mode: {
              type: 'string',
              enum: ['none', 'raw', 'json', 'urlencoded', 'formdata', 'binary']
            },
            raw: { type: 'string', description: 'raw/json 模式下的内容' },
            parameters: { type: 'array', description: 'urlencoded/form-data 参数列表' },
            field_docs: {
              type: 'array',
              description: 'JSON 请求体字段说明；传入即全量替换',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: '可读路径，如 user.name、items[].id；也接受 JSON Pointer'
                  },
                  pointer: { type: 'string', description: '内部 JSON Pointer（与 path 二选一）' },
                  type: {
                    type: 'string',
                    enum: [
                      'string',
                      'number',
                      'integer',
                      'boolean',
                      'null',
                      'object',
                      'array',
                      'unknown'
                    ]
                  },
                  required: { type: 'boolean' },
                  description: { type: 'string' },
                  doc_only: { type: 'boolean', description: 'raw 中不存在的仅文档字段' }
                }
              }
            }
          }
        },
        response_example: {
          type: 'object',
          description: '保存为接口的响应示例',
          properties: {
            name: { type: 'string' },
            code: { type: ['string', 'number'] },
            content_type: { type: 'string' },
            raw: { description: '响应体，字符串或对象' }
          }
        }
      },
      ['project_id', 'target_id']
    ),
    handler: args => writeApiDocumentation(args)
  },
  {
    name: 'move_target',
    description: '移动接口或目录到指定父目录，可同时重命名或补充说明。用于维护目录说明时，必须传入有业务含义的 description。修改接口说明优先使用 update_api_design 或 upsert_api。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: { type: 'string', description: '接口或目录的 target_id' },
        parent_id: {
          type: 'string',
          description: '目标父目录 ID，根为 0；不传则保持原目录（仅重命名或补充说明）'
        },
        name: { type: 'string', description: '新名称（可选）' },
        description: { type: 'string', description: '接口或目录说明（可选）。更新目录说明时填写' }
      },
      ['project_id', 'target_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const target = store.getTarget(projectId, requiredStr(args, 'target_id'))
      if (!target) throw new Error('接口或目录不存在')
      const list = store.listTargets(projectId)
      const parentArg = typeof args.parent_id === 'string' ? args.parent_id.trim() : ''
      if (parentArg) {
        if (parentArg !== '0') {
          const parent = list.find((item) => item.target_id === parentArg)
          if (!parent || parent.target_type !== 'folder') throw new Error('目标目录不存在')
        }
        if (target.target_type === 'folder') {
          let cursor: string | undefined = parentArg
          const seen = new Set<string>()
          while (cursor && cursor !== '0') {
            if (cursor === target.target_id) {
              throw new Error('不能将目录移动到自身或子目录')
            }
            if (seen.has(cursor)) break
            seen.add(cursor)
            cursor = list.find((item) => item.target_id === cursor)?.parent_id
          }
        }
        if (target.parent_id !== parentArg) {
          const siblings = list.filter(
            (item) => item.parent_id === parentArg && item.target_id !== target.target_id
          )
          target.parent_id = parentArg
          target.sort = siblings.reduce((max, item) => Math.max(max, item.sort), 0) + 100
        }
      }
      const name = str(args, 'name').trim()
      if (name) target.name = name
      if (typeof args.description === 'string') target.description = args.description.trim()
      return { target: store.saveTarget(projectId, target) }
    }
  },
  {
    name: 'sync_openapi',
    description:
      '从 OpenAPI 3 / Swagger 2 文档导入接口到项目。' +
      '一次只导入 1 个 path：整份多接口文档过大时 MCP 参数会被截断并报 JSON 解析错误。' +
      '新增接口用 api_cover_mode=skip（默认），更新已有接口用 cover。' +
      '注意：导入（尤其 cover）会重置或覆盖 Header、Query、Body 的值和响应示例，导入后必须用 update_api/upsert_api 重新回填，并用 execute_api(save_response=true) 重新保存真实响应。' +
      'paths 中写相对路径，host_path + base_path 负责前缀；返回的 sync_items 包含 target_id 与 action，务必记录。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        openapi: { type: 'object', description: 'OpenAPI 3 或 Swagger 2 文档对象' },
        folder_id: { type: 'string', description: '导入到指定目录，根为 0' },
        api_cover_mode: { type: 'string', enum: ['skip', 'cover'], description: '同名接口处理方式' },
        base_path: { type: 'string', description: '追加在路径前的 base path' },
        host_path: { type: 'string', description: '可选 host 前缀，如 http://127.0.0.1:8080' },
        api_scripts: { type: 'object', description: '预留：预/后脚本' }
      },
      ['project_id', 'openapi']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const doc = args.openapi as any
      if (!doc || typeof doc !== 'object' || !doc.paths || typeof doc.paths !== 'object') {
        throw new Error('openapi 缺少 paths')
      }
      const folderId = str(args, 'folder_id') || '0'
      if (folderId !== '0') {
        const folder = store.listTargets(projectId).find((item) => item.target_id === folderId)
        if (!folder || folder.target_type !== 'folder') throw new Error('目标目录不存在')
      }
      const cover = str(args, 'api_cover_mode') === 'cover'
      const basePath = str(args, 'base_path') || doc.basePath || ''
      const hostPath = str(args, 'host_path') || doc.servers?.[0]?.url || ''
      const prefix = `${hostPath.replace(/\/+$/, '')}${basePath}`.replace(/\/+$/, '')
      const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
      const existing = store.listTargets(projectId)
      let created = 0
      let updated = 0
      let skipped = 0
      const items: Array<Record<string, unknown>> = []

      for (const [rawPath, pathItem] of Object.entries(doc.paths as Record<string, any>)) {
        if (!pathItem || typeof pathItem !== 'object') continue
        const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
        for (const [rawMethod, operation] of Object.entries(pathItem)) {
          const method = rawMethod.toLowerCase()
          if (!methods.has(method) || !operation || typeof operation !== 'object') continue
          const op = operation as any
          const url = `${prefix}${rawPath}` || rawPath
          const methodUpper = method.toUpperCase()
          const match = existing.find(
            (item) =>
              item.target_type === 'api' &&
              (item.method ?? '').toUpperCase() === methodUpper &&
              (item.url ?? '') === url
          )
          if (match && !cover) {
            skipped += 1
            items.push({ method: methodUpper, url, action: 'skipped' })
            continue
          }
          let target
          if (match) {
            target = store.getTarget(projectId, match.target_id)
            if (!target) {
              skipped += 1
              continue
            }
            updated += 1
          } else {
            target = createTarget(projectId, folderId, 'api')
            target.mark_id = defaultApiStatus(store.getProject(projectId))
            created += 1
          }
          target.name = op.summary || op.operationId || `${methodUpper} ${rawPath}`
          target.description = op.description ?? target.description ?? ''
          target.method = methodUpper
          target.url = url
          const request = structuredClone(target.request ?? createRequest())
          const params = [...pathLevelParams, ...(Array.isArray(op.parameters) ? op.parameters : [])]
          for (const param of params) {
            if (!param?.name) continue
            const slot = ({ query: 'query', header: 'header', path: 'restful', cookie: 'cookie' } as const)[param.in as 'query' | 'header' | 'path' | 'cookie']
            if (!slot) continue
            const old = request[slot].parameter.find(item => item.key === String(param.name))
            const importedRules = rulesFromSchema(param.schema ?? param)
            const entry = createParam({
              ...old,
              key: String(param.name),
              value: String(param.example ?? param.schema?.example ?? old?.value ?? ''),
              ...importedRules,
              description: String(param.description ?? param.schema?.description ?? old?.description ?? ''),
              field_type: param.schema?.type ?? param.type ?? 'string',
              required: param.in === 'path' ? true : param.schema?.['x-kindra-rules'] ? importedRules.required : param.required === true,
              is_checked: 1
            })
            request[slot].parameter = patchParams(request[slot].parameter, [entry], slot)
          }
          const bodySchema =
            op.requestBody?.content?.['application/json']?.schema ??
            params.find((param: any) => param?.in === 'body')?.schema
          if (bodySchema) {
            const jsonMedia = op.requestBody?.content?.['application/json']
            const exampleValue = jsonMedia?.example ?? (Object.values(jsonMedia?.examples ?? {})[0] as any)?.value ?? exampleFromSchema(bodySchema)
            const fieldDocs = mergeFieldDocs(
              target.request?.body?.field_docs,
              fieldDocsFromSchema(bodySchema, exampleValue)
            )
            request.body = {
              ...request.body,
              mode: 'json',
              raw: JSON.stringify(exampleValue, null, 2),
              field_docs: fieldDocs
            }
          }
          target.request = request
          if (bodySchema) patchBody(target, { field_docs: request.body.field_docs })
          for (const [mediaType, mode] of [['application/x-www-form-urlencoded', 'urlencoded'], ['multipart/form-data', 'formdata']] as const) {
            const formSchema = op.requestBody?.content?.[mediaType]?.schema
            if (!formSchema?.properties) continue
            const fields = Object.entries(formSchema.properties).map(([key, value]) => {
              const schema = value as any
              const rules = rulesFromSchema(schema)
              return { key, ...rules, type: schema.format === 'binary' ? 'file' : schema.type ?? 'string',
                required: schema['x-kindra-rules'] ? rules.required : (formSchema.required ?? []).includes(key),
                value: String(schema.example ?? '') }
            })
            patchBody(target, { mode, parameters: fields })
            break
          }
          const firstResponse = Object.entries(op.responses ?? {}).find(([code]) =>
            /^2\d\d$/.test(code)
          ) as [string, any] | undefined
          const contentEntries = Object.entries(firstResponse?.[1]?.content ?? {})
          const media = contentEntries[0] as [string, any] | undefined
          const mediaType = media?.[0] ?? 'application/json'
          const sample =
            media?.[1]?.example ?? (Object.values(media?.[1]?.examples ?? {})[0] as any)?.value ?? firstResponse?.[1]?.examples?.default?.value
          const schema = media?.[1]?.schema ?? firstResponse?.[1]?.schema
          if (firstResponse && (sample !== undefined || schema)) {
            const sampleValue = sample !== undefined ? sample : exampleFromSchema(schema)
            patchSuccessResponse(target, { name: firstResponse[1].description || '成功', code: firstResponse[0], content_type: mediaType, raw: sampleValue, field_docs: fieldDocsFromSchema(schema) })
          }
          store.saveTarget(projectId, target)
          items.push({ target_id: target.target_id, method: methodUpper, url, name: target.name, action: match ? 'updated' : 'created', documentation: { issues: documentationIssues(target) } })
        }
      }

      return {
        project_id: projectId,
        folder_id: folderId,
        api_cover_mode: cover ? 'cover' : 'skip',
        created,
        updated,
        skipped,
        deleted: 0,
        sync_items: items
      }
    }
  },
  {
    name: 'delete_apis',
    description: '删除接口或目录（目录会级联删除子项）。必须传 confirm: true。删除前用 list_apis 确认 target_id 与影响范围；删除重建后 target_id 会变化，需重新记录。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        target_ids: { type: 'array', items: { type: 'string' } },
        confirm: S.confirm
      },
      ['project_id', 'target_ids', 'confirm']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const projectId = projectIdOf(args)
      const ids = Array.isArray(args.target_ids)
        ? args.target_ids.filter((id): id is string => typeof id === 'string')
        : []
      if (ids.length === 0) throw new Error('target_ids 不能为空')
      for (const id of ids) store.deleteTarget(projectId, id)
      return { project_id: projectId, deleted: ids.length, target_ids: ids }
    }
  },
  {
    name: 'execute_api',
    description:
      '通过 Kindra 真实执行单个接口，返回执行摘要（不含响应体）；完整请求与响应用 get_execution_result(run_id) 读取。' +
      '本地联调与交付验收一律通过本工具执行；curl/脚本只用于服务器连通性、日志与线程排查，不能作为交付证据。' +
      'input 只能覆盖接口已定义的 query/path/headers/cookies/body；数值参数也用字符串传入。' +
      'save_response=true 会仅在 HTTP 2xx 时把本次真实响应保存为接口的响应示例；成功场景才用它。' +
      'HTTP 200 不代表业务成功：必须用 get_execution_result 检查响应体 code（成功通常为 0，也可能为 200）、message、data。负向/越权/重复操作测试一律 save_response=false，避免覆盖成功示例。' +
      '切换 token 或账号测试后立即恢复 Header，保证示例与 Header 属于同一账号、同一环境。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: S.target,
        environment_id: S.environment,
        input: { type: 'object', description: 'query/path/headers/cookies/body 覆盖' },
        save_response: {
          type: 'boolean',
          description: '把本次真实响应保存为接口的响应示例'
        }
      },
      ['project_id', 'target_id']
    ),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const target = store.getTarget(projectId, requiredStr(args, 'target_id'))
      if (!target || target.target_type !== 'api') throw new Error('接口不存在')
      const input = (args.input ?? {}) as FlowRequestInput
      const prepared = applyRequestInput(target, input)
      const record = await sendRequest(projectId, prepared, str(args, 'environment_id') || undefined)
      store.addSendRecord(projectId, record)
      let responseSaved = false
      if (boolArg(args, 'save_response') && record.response && !record.error && record.response.code >= 200 && record.response.code < 300) {
        const fresh = store.getTarget(projectId, target.target_id)
        if (fresh) {
          const response = record.response
          const headers = response?.headers ?? {}
          const contentType =
            Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ??
            'application/json'
          const body = response?.body
          const raw = typeof body === 'string' ? body : JSON.stringify(body ?? null, null, 2)
          const toParamRows = (entries: Record<string, string>): ReturnType<typeof createParam>[] =>
            Object.entries(entries).map(([key, value]) =>
              createParam({ key, value: String(value) })
            )
          const responseHeaders = toParamRows(response?.headers ?? {})
          const responseCookies = (response?.cookies ?? []).map((cookie) =>
            createParam({
              key: String(cookie.name ?? ''),
              value: String(cookie.value ?? '')
            })
          )
          if (responseCookies.length === 0) {
            const setCookie = Object.entries(response?.headers ?? {})
              .filter(([key]) => key.toLowerCase() === 'set-cookie')
              .flatMap(([, value]) => String(value).split(/,(?=\s*[^;=\s]+=)/))
            for (const rawCookie of setCookie) {
              const pair = rawCookie.split(';')[0]
              const index = pair.indexOf('=')
              if (index <= 0) continue
              const key = pair.slice(0, index).trim()
              if (!key) continue
              responseCookies.push(
                createParam({ key, value: pair.slice(index + 1).trim() })
              )
            }
          }
          const snapshot = record.request
          const requestBody =
            snapshot?.body === undefined || snapshot?.body === null
              ? ''
              : typeof snapshot.body === 'string'
                ? snapshot.body
                : JSON.stringify(snapshot.body, null, 2)
          const captured = {
            example: [
              {
                example_id: createId('ex'),
                expect: {
                  name: '实时响应',
                  code: response?.code ?? 200,
                  content_type: String(contentType),
                  is_default: 1
                },
                raw,
                raw_parameter: responseHeaders,
                headers: responseHeaders,
                cookies: responseCookies,
                request: {
                  body_mode: snapshot?.mode,
                  method: snapshot?.method,
                  url: snapshot?.url,
                  headers: toParamRows(snapshot?.headers ?? {}),
                  body: requestBody
                }
              }
            ]
          }
          const existing = fresh.response?.example ?? []
          const index = existing.findIndex(item => String(item.expect?.code ?? 200) === String(response?.code ?? 200) && !item.expect?.model_id)
          const sample = captured.example[0]
          if (index >= 0) existing[index] = { ...existing[index], ...sample, field_docs: responseDocs(existing[index]), example_id: existing[index].example_id, expect: { ...existing[index].expect, ...sample.expect } }
          else existing.push(sample)
          fresh.response = { ...fresh.response, example: existing }
          store.saveTarget(projectId, fresh)
          responseSaved = true
        }
      }
      return { ...executeSummary(record), response_saved: responseSaved }
    }
  },
  {
    name: 'list_execution_runs',
    description: '列出接口或流程的执行记录。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({
      project_id: S.project,
      scope: { type: 'string', enum: ['api', 'flow'] },
      flow_id: S.flow,
      status: { type: 'string' },
      limit: { type: 'number', description: '1~50，默认 20' }
    }, ['project_id']),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50)
      const flowId = str(args, 'flow_id')
      if (flowId || str(args, 'scope') === 'flow') {
        let records = store.listFlowRuns(projectId, limit)
        if (flowId) records = records.filter((item) => item.flow_id === flowId)
        return { total: records.length, records }
      }
      let records = store.listSendRecords(projectId)
      const status = str(args, 'status')
      if (status) records = records.filter((item) => item.status === status)
      records = records.slice(0, limit)
      return { total: records.length, records }
    }
  },
  {
    name: 'get_execution_result',
    description: '按 run_id 获取完整执行记录（流程或单接口），包含真实请求、响应体、headers 与耗时。用于核对 status_code 与业务 code/message/data；execute_api 返回的 status 不能替代这一步。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, run_id: { type: 'string' } }, [
      'project_id',
      'run_id'
    ]),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const runId = requiredStr(args, 'run_id')
      const run = store.getFlowRun(projectId, runId) ?? store.getSendRecord(projectId, runId)
      if (!run) throw new Error('执行记录不存在')
      return { run }
    }
  },
  {
    name: 'create_execution_flow',
    description: '创建业务流程。events 支持完整事件树；或传 legacy steps（两者互斥）。',
    requires_write: true,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        name: { type: 'string' },
        description: { type: 'string' },
        environment_id: S.environment,
        events: { type: 'array', items: { type: 'object', description: '完整 FlowEvent，支持 api/request/script/assert/if/wait/begin/loop 和 children；depends_on 为 event_id 数组，省略按保守顺序，空数组明确独立' } },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              target_id: { type: 'string' },
              event_id: { type: 'string' },
              step_id: { type: 'string' },
              logical_step_id: { type: 'string' },
              pre_event_id: { type: 'string' },
              post_event_id: { type: 'string' },
              input: { type: 'object' },
              pre_script: { type: 'string' },
              post_script: { type: 'string' }
            }
          }
        }
      },
      ['project_id', 'name']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const flow = createFlow(projectId, requiredStr(args, 'name'), str(args, 'environment_id'))
      flow.description = str(args, 'description')
      if (args.events !== undefined && args.steps !== undefined) throw new Error('events 与 steps 互斥')
      flow.events = args.events !== undefined ? normalizeFlowEvents(args.events) : stepEvents(projectId, args.steps)
      const saved = store.saveFlow(projectId, flow)
      return { flow_id: saved.flow_id, name: saved.name, revision: saved.revision, message: 'created' }
    }
  },
  {
    name: 'update_execution_flow',
    description: '更新流程的名称、说明、环境或步骤。',
    requires_write: true,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        flow_id: S.flow,
        name: { type: 'string' },
        description: { type: 'string' },
        environment_id: S.environment,
        steps: { type: 'array' },
        events: { type: 'array', items: { type: 'object' } },
        expected_revision: { type: 'string', description: '完整 events 更新必填；从 get_execution_flow 的 revision 获取' }
      },
      ['project_id', 'flow_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      if (args.events !== undefined && args.steps !== undefined) throw new Error('events 与 steps 互斥')
      if (args.events !== undefined && !str(args, 'expected_revision')) throw new Error('完整 events 更新需要 expected_revision')
      if (args.expected_revision !== undefined && !str(args, 'expected_revision')) throw new Error('expected_revision 必须是非空字符串')
      const flow = store.updateFlowChecked(projectId, requiredStr(args, 'flow_id'),
        args.expected_revision === undefined ? undefined : str(args, 'expected_revision'), current => {
          if (args.name !== undefined) current.name = str(args, 'name') || current.name
          if (args.description !== undefined) current.description = str(args, 'description')
          if (args.environment_id !== undefined) current.env_id = str(args, 'environment_id')
          if (args.steps !== undefined) {
            if (hasStructuredEvents(current.events)) throw new Error('含条件、循环或分组的流程请使用完整 events 更新，不能用 legacy steps 覆盖')
            current.events = stepEvents(projectId, args.steps)
          }
          if (args.events !== undefined) current.events = normalizeFlowEvents(args.events)
          return current
        })
      return { flow_id: flow.flow_id, name: flow.name, revision: flow.revision, message: 'updated' }
    }
  },
  {
    name: 'list_execution_flows',
    description: '列出项目中的业务流程。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project }, ['project_id']),
    handler: (args) => {
      const projectId = projectIdOf(args)
      return {
        flows: store.listFlows(projectId).map((flow) => ({
          flow_id: flow.flow_id,
          name: flow.name,
          description: flow.description,
          env_id: flow.env_id,
          event_count: flow.events.length,
          updated_at: flow.updated_at,
          revision: flow.revision
        }))
      }
    }
  },
  {
    name: 'get_execution_flow',
    description: '获取流程的完整定义。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, flow_id: S.flow }, ['project_id', 'flow_id']),
    handler: (args) => {
      const flow = store.getFlow(projectIdOf(args), requiredStr(args, 'flow_id'))
      if (!flow) throw new Error('流程不存在')
      return { flow }
    }
  },
  {
    name: 'delete_execution_flow',
    description: '删除流程。必须传 confirm: true。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, flow_id: S.flow, confirm: S.confirm }, [
      'project_id',
      'flow_id',
      'confirm'
    ]),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const projectId = projectIdOf(args)
      const flowId = requiredStr(args, 'flow_id')
      store.deleteFlow(projectId, flowId)
      return { deleted: true, flow_id: flowId }
    }
  },
  {
    name: 'start_flow_run',
    description: '异步启动已保存流程，使用 request_id 防止重复执行。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema({ project_id: S.project, flow_id: S.flow, environment_id: S.environment, request_id: { type: 'string', description: '项目内唯一的启动请求标识' } }, ['project_id', 'flow_id', 'request_id']),
    handler: args => startFlowRun(projectIdOf(args), requiredStr(args, 'flow_id'), str(args, 'environment_id') || undefined, requiredStr(args, 'request_id'), 'mcp')
  },
  {
    name: 'cancel_flow_run',
    description: '有界取消流程运行；已发送请求的远端结果可能未知，不保证回滚。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema({ project_id: S.project, run_id: { type: 'string' } }, ['project_id', 'run_id']),
    handler: args => cancelFlowRun(projectIdOf(args), requiredStr(args, 'run_id'))
  },
  {
    name: 'pause_flow_run',
    description: '请求在当前完整逻辑步骤结束后暂停；只能由用户在界面手动继续。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema({ project_id: S.project, run_id: { type: 'string' } }, ['project_id', 'run_id']),
    handler: args => pauseFlowRun(projectIdOf(args), requiredStr(args, 'run_id'))
  },
  {
    name: 'get_flow_run',
    description: '查询流程运行的当前状态及已可用结果。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, run_id: { type: 'string' } }, ['project_id', 'run_id']),
    handler: args => {
      const run = getFlowRun(projectIdOf(args), requiredStr(args, 'run_id'))
      if (!run) throw new Error('运行记录不存在')
      return run
    }
  },
  {
    name: 'execute_flow',
    description: '执行一个业务流程并返回执行摘要。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      { project_id: S.project, flow_id: S.flow, environment_id: S.environment },
      ['project_id', 'flow_id']
    ),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const started = startFlowRun(
        projectId, requiredStr(args, 'flow_id'), str(args, 'environment_id') || undefined,
        createId('request'), 'mcp'
      )
      const run = await waitForFlowRun(projectId, started.run_id)
      return {
        run_id: run.run_id,
        project_id: projectId,
        flow_id: run.flow_id,
        status: run.status,
        scope: 'flow',
        elapsed_ms: run.elapsed_ms
      }
    }
  },
  {
    name: 'list_environments',
    description: '列出项目的环境。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project }, ['project_id']),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const settings = store.getSettings()
      const environments = store.listEnvironments(projectId)
      return {
        current_env_id:
          environments.find((env) => env.env_id === settings.environment_id)?.env_id ??
          environments[0]?.env_id ??
          '',
        environments: environments.map((env) => ({
          env_id: env.env_id,
          name: env.name,
          is_current: env.env_id === settings.environment_id,
          base_url: env.server_list?.[0]?.uri ?? ''
        }))
      }
    }
  },
  {
    name: 'switch_environment',
    description: '切换当前环境（写入本机偏好）。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, environment_id: S.environment }, [
      'project_id',
      'environment_id'
    ]),
    handler: (args) => {
      const env = loadEnv(projectIdOf(args), requiredStr(args, 'environment_id'))
      const settings = store.getSettings()
      store.saveSettings({ ...settings, environment_id: env.env_id })
      return { current_env_id: env.env_id, name: env.name }
    }
  },
  {
    name: 'create_environment',
    description: '创建环境。base_url 写入默认服务前缀。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        name: { type: 'string' },
        base_url: { type: 'string' }
      },
      ['project_id', 'name']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const env = createEnvironment(projectId, requiredStr(args, 'name'))
      env.server_list[0].uri = str(args, 'base_url')
      store.saveEnvironment(projectId, env)
      return { environment: env }
    }
  },
  {
    name: 'update_environment',
    description: '更新环境名称或 base_url。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        environment_id: S.environment,
        name: { type: 'string' },
        base_url: { type: 'string' }
      },
      ['project_id', 'environment_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const env = loadEnv(projectId, requiredStr(args, 'environment_id'))
      if (args.name !== undefined) env.name = str(args, 'name') || env.name
      if (args.base_url !== undefined) {
        env.server_list[0] = { ...(env.server_list[0] ?? { server_id: '1', name: 'default' }), uri: str(args, 'base_url') }
      }
      store.saveEnvironment(projectId, env)
      return { environment: env }
    }
  },
  {
    name: 'delete_environment',
    description: '删除环境。必须传 confirm: true。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, environment_id: S.environment, confirm: S.confirm }, [
      'project_id',
      'environment_id',
      'confirm'
    ]),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const projectId = projectIdOf(args)
      const envId = requiredStr(args, 'environment_id')
      store.deleteEnvironment(projectId, envId)
      return { deleted: true, environment_id: envId }
    }
  },
  {
    name: 'list_environment_servers',
    description: '列出环境下的服务前缀（server_list）。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, environment_id: S.environment }, ['project_id']),
    handler: (args) => {
      const env = currentEnv(projectIdOf(args), str(args, 'environment_id') || undefined)
      return {
        environment_id: env.env_id,
        servers: env.server_list.map((server) => ({
          server_id: server.server_id,
          name: server.name,
          base_url: server.uri,
          sort: server.sort ?? 1000
        }))
      }
    }
  },
  {
    name: 'create_environment_server',
    description: '为环境新增一个服务前缀。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        environment_id: S.environment,
        name: { type: 'string' },
        base_url: { type: 'string' }
      },
      ['project_id', 'name']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const env = currentEnv(projectId, str(args, 'environment_id') || undefined)
      const maxSort = env.server_list.reduce((max, item) => Math.max(max, item.sort ?? 0), 0)
      const server = {
        server_id: createId('s'),
        name: requiredStr(args, 'name'),
        uri: str(args, 'base_url'),
        sort: maxSort + 100
      }
      env.server_list.push(server)
      store.saveEnvironment(projectId, env)
      return { environment_id: env.env_id, server }
    }
  },
  {
    name: 'update_environment_server',
    description: '更新环境下的服务前缀。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        environment_id: S.environment,
        server_id: { type: 'string' },
        name: { type: 'string' },
        base_url: { type: 'string' }
      },
      ['project_id', 'server_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const env = currentEnv(projectId, str(args, 'environment_id') || undefined)
      const server = env.server_list.find((item) => item.server_id === requiredStr(args, 'server_id'))
      if (!server) throw new Error('服务不存在')
      if (args.name !== undefined) server.name = str(args, 'name') || server.name
      if (args.base_url !== undefined) server.uri = str(args, 'base_url')
      store.saveEnvironment(projectId, env)
      return { environment_id: env.env_id, server }
    }
  },
  {
    name: 'delete_environment_server',
    description: '删除环境下的服务前缀。必须传 confirm: true。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        environment_id: S.environment,
        server_id: { type: 'string' },
        confirm: S.confirm
      },
      ['project_id', 'server_id', 'confirm']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const projectId = projectIdOf(args)
      const env = currentEnv(projectId, str(args, 'environment_id') || undefined)
      const serverId = requiredStr(args, 'server_id')
      const before = env.server_list.length
      env.server_list = env.server_list.filter((item) => item.server_id !== serverId)
      if (env.server_list.length === before) throw new Error('服务不存在')
      store.saveEnvironment(projectId, env)
      return { deleted: true, server_id: serverId }
    }
  },
  {
    name: 'get_environment_variables',
    description: '获取环境变量（默认值 + 运行时值）。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, environment_id: S.environment }, [
      'project_id',
      'environment_id'
    ]),
    handler: (args) => {
      const env = loadEnv(projectIdOf(args), requiredStr(args, 'environment_id'))
      return {
        environment_id: env.env_id,
        variables: Object.entries(env.env_var_list).map(([key, value]) => ({
          key,
          value: value.initial_value,
          current_value: value.current_value,
          description: value.description ?? ''
        }))
      }
    }
  },
  {
    name: 'upsert_environment_variable',
    description: '新增或更新环境变量。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        environment_id: S.environment,
        key: { type: 'string' },
        value: { type: 'string' },
        current_value: { type: 'string' },
        description: { type: 'string' }
      },
      ['project_id', 'environment_id', 'key']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const env = loadEnv(projectId, requiredStr(args, 'environment_id'))
      const key = requiredStr(args, 'key')
      const existing = env.env_var_list[key]
      const value = args.value !== undefined ? str(args, 'value') : existing?.initial_value ?? ''
      const current =
        args.current_value !== undefined
          ? str(args, 'current_value')
          : args.value !== undefined
            ? value
            : existing?.current_value ?? ''
      env.env_var_list[key] = {
        initial_value: value,
        current_value: current,
        description: args.description !== undefined ? str(args, 'description') : existing?.description ?? '',
        is_checked: existing?.is_checked ?? 1
      }
      store.saveEnvironment(projectId, env)
      return { variable: { key, value, current_value: current } }
    }
  },
  {
    name: 'delete_environment_variable',
    description: '删除环境变量。必须传 confirm: true。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      { project_id: S.project, environment_id: S.environment, key: { type: 'string' }, confirm: S.confirm },
      ['project_id', 'environment_id', 'key', 'confirm']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const projectId = projectIdOf(args)
      const env = loadEnv(projectId, requiredStr(args, 'environment_id'))
      delete env.env_var_list[requiredStr(args, 'key')]
      store.saveEnvironment(projectId, env)
      return { deleted: true }
    }
  },
  {
    name: 'get_global_variables',
    description: '获取项目全局变量。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project }, ['project_id']),
    handler: (args) => {
      const globals = store.getGlobalVars(projectIdOf(args))
      return {
        variables: Object.entries(globals.vars).map(([key, value]) => ({
          key,
          value: value.initial_value,
          current_value: value.current_value,
          description: value.description ?? ''
        }))
      }
    }
  },
  {
    name: 'upsert_global_variable',
    description: '新增或更新全局变量。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        key: { type: 'string' },
        value: { type: 'string' },
        current_value: { type: 'string' },
        description: { type: 'string' }
      },
      ['project_id', 'key']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const globals = store.getGlobalVars(projectId)
      const key = requiredStr(args, 'key')
      const existing = globals.vars[key]
      const value = args.value !== undefined ? str(args, 'value') : existing?.initial_value ?? ''
      const current =
        args.current_value !== undefined
          ? str(args, 'current_value')
          : args.value !== undefined
            ? value
            : existing?.current_value ?? ''
      globals.vars[key] = {
        initial_value: value,
        current_value: current,
        description: args.description !== undefined ? str(args, 'description') : existing?.description ?? ''
      }
      store.saveGlobalVars(projectId, globals)
      return { variable: { key, value, current_value: current } }
    }
  },
  {
    name: 'delete_global_variable',
    description: '删除全局变量。必须传 confirm: true。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      { project_id: S.project, key: { type: 'string' }, confirm: S.confirm },
      ['project_id', 'key', 'confirm']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const projectId = projectIdOf(args)
      const globals = store.getGlobalVars(projectId)
      delete globals.vars[requiredStr(args, 'key')]
      store.saveGlobalVars(projectId, globals)
      return { deleted: true }
    }
  },

  // -------------------------------------------------------------------------
  // Data dictionary
  // -------------------------------------------------------------------------
  {
    name: 'list_dictionary_entries',
    description: '列出数据字典条目，可按内置/自定义过滤并搜索名称或描述。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        source: { type: 'string', enum: ['all', 'builtin', 'custom'], description: '默认 all' },
        keyword: { type: 'string', description: '按名称或描述搜索' }
      },
      ['project_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const source = str(args, 'source') || 'all'
      const keyword = str(args, 'keyword').trim().toLowerCase()
      const entries = store
        .listDictionaryEntries(projectId)
        .filter((entry) => source === 'all' || entry.source === source)
        .filter(
          (entry) =>
            !keyword ||
            entry.key.toLowerCase().includes(keyword) ||
            entry.description.toLowerCase().includes(keyword)
        )
        .map((entry) => ({
          id: entry.id,
          key: entry.key,
          field_type: entry.field_type,
          description: entry.description,
          remarks: entry.remarks ?? '',
          default_value: entry.default_value ?? '',
          example_value: entry.example_value ?? '',
          mock: entry.mock ?? '',
          schema: entry.schema,
          temporary: entry.temporary ?? false,
          source: entry.source
        }))
      return { entries, total: entries.length }
    }
  },
  {
    name: 'create_dictionary_entry',
    description: '创建自定义字段描述。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        key: { type: 'string', description: '参数名称' },
        field_type: {
          type: 'string',
          enum: [...DICT_FIELD_TYPES]
        },
        description: { type: 'string', description: '参数描述' },
        remarks: { type: 'string' },
        default_value: { type: 'string' },
        example_value: { type: 'string' },
        mock: { type: 'string' },
        schema: { type: 'object', description: '字段约束与示例' }
      },
      ['project_id', 'key']
    ),
    handler: (args) => {
      const entry = store.saveDictionaryEntry(projectIdOf(args), {
        id: '',
        project_id: projectIdOf(args),
        key: str(args, 'key'),
        field_type: (str(args, 'field_type') || 'string') as DictionaryEntry['field_type'],
        description: str(args, 'description'),
        remarks: str(args, 'remarks'),
        default_value: str(args, 'default_value'),
        example_value: str(args, 'example_value'),
        mock: str(args, 'mock'),
        schema: args.schema && typeof args.schema === 'object' && !Array.isArray(args.schema) ? args.schema as Record<string, unknown> : undefined,
        created_at: '',
        updated_at: ''
      })
      return { entry }
    }
  },
  {
    name: 'update_dictionary_entry',
    description: '更新自定义字段描述；系统内置条目不可修改。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        id: { type: 'string' },
        key: { type: 'string' },
        field_type: {
          type: 'string',
          enum: [...DICT_FIELD_TYPES]
        },
        description: { type: 'string' },
        remarks: { type: 'string' },
        default_value: { type: 'string' },
        example_value: { type: 'string' },
        mock: { type: 'string' },
        schema: { type: 'object', description: '字段约束与示例' }
      },
      ['project_id', 'id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const id = requiredStr(args, 'id')
      if (id.startsWith('builtin_')) throw new Error('系统内置描述不能修改')
      const existing = store
        .listDictionaryEntries(projectId)
        .find((entry) => entry.id === id)
      if (!existing) throw new Error('字典条目不存在')
      const entry = store.saveDictionaryEntry(projectId, {
        ...existing,
        key: args.key !== undefined ? str(args, 'key') : existing.key,
        field_type:
          args.field_type !== undefined
            ? (str(args, 'field_type') as DictionaryEntry['field_type'])
            : existing.field_type,
        description:
          args.description !== undefined ? str(args, 'description') : existing.description,
        remarks: args.remarks !== undefined ? str(args, 'remarks') : existing.remarks,
        default_value:
          args.default_value !== undefined
            ? str(args, 'default_value')
            : existing.default_value,
        example_value: args.example_value !== undefined ? str(args, 'example_value') : existing.example_value,
        mock: args.mock !== undefined ? str(args, 'mock') : existing.mock,
        schema: args.schema && typeof args.schema === 'object' && !Array.isArray(args.schema) ? args.schema as Record<string, unknown> : existing.schema
      })
      return { entry }
    }
  },
  {
    name: 'delete_dictionary_entry',
    description: '删除自定义字段描述。必须传 confirm: true；系统内置条目不可删除。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      { project_id: S.project, id: { type: 'string' }, confirm: S.confirm },
      ['project_id', 'id', 'confirm']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const id = requiredStr(args, 'id')
      if (id.startsWith('builtin_')) throw new Error('系统内置描述不能删除')
      store.deleteDictionaryEntry(projectIdOf(args), id)
      return { deleted: true }
    }
  },

  // -------------------------------------------------------------------------
  // Data models
  // -------------------------------------------------------------------------
  {
    name: 'list_data_models',
    description: '列出数据模型与目录，返回 schema 摘要与被引用次数。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        keyword: { type: 'string', description: '按名称或别名搜索' },
        parent_id: { type: 'string', description: '仅返回指定目录下的模型' }
      },
      ['project_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const keyword = str(args, 'keyword').trim().toLowerCase()
      const parentId = str(args, 'parent_id')
      const models = store
        .listModelsAll(projectId)
        .filter((model) => !parentId || model.parent_id === parentId)
        .filter(
          (model) =>
            !keyword ||
            model.name.toLowerCase().includes(keyword) ||
            (model.alias ?? '').toLowerCase().includes(keyword)
        )
        .map((model) => ({
          model_id: model.model_id,
          parent_id: model.parent_id,
          model_type: model.model_type,
          name: model.name,
          alias: model.alias ?? '',
          description: model.data?.description ?? '',
          schema: model.data?.schema ?? {},
          reference_count: store.findModelReferences(projectId, model.model_id).length
        }))
      return { models, total: models.length }
    }
  },
  {
    name: 'get_data_model',
    description: '读取数据模型详情、schema 与引用它的接口。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, model_id: { type: 'string' } }, [
      'project_id',
      'model_id'
    ]),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const modelId = requiredStr(args, 'model_id')
      const model = store.getModel(projectId, modelId)
      if (!model) throw new Error('模型不存在')
      return { model, references: store.findModelReferences(projectId, modelId) }
    }
  },
  {
    name: 'create_data_model',
    description: '创建数据模型或模型目录。Agent 必须填写模型/目录说明，并为 schema 中每个已知字段填写 description 业务含义。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        name: { type: 'string' },
        parent_id: { type: 'string', description: '父目录，默认 0' },
        model_type: { type: 'string', enum: ['model', 'folder'] },
        alias: { type: 'string' },
        description: { type: 'string', description: '模型或模型目录说明（必填）。说明业务范围与用途' },
        schema: {
          type: 'object',
          description: 'JSON Schema。每个已知字段应在 properties.*.description 中填写业务含义；无法确定时保留未知'
        }
      },
      ['project_id', 'name']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const kind = str(args, 'model_type') === 'folder' ? 'folder' : 'model'
      const model = store.createModelInProject(
        projectId,
        str(args, 'parent_id') || '0',
        kind
      )
      model.name = requiredStr(args, 'name')
      model.alias = str(args, 'alias')
      if (kind === 'model') {
        model.data = {
          description: str(args, 'description'),
          schema: assertModelSchema(args.schema)
        }
      } else {
        model.data = { description: str(args, 'description'), schema: {} }
      }
      return { model: store.saveModel(projectId, model) }
    }
  },
  {
    name: 'update_data_model',
    description: '更新数据模型名称、别名、目录、说明或 schema。修改 schema 时应同时补齐每个已知字段的 description 业务含义。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        model_id: { type: 'string' },
        name: { type: 'string' },
        alias: { type: 'string' },
        parent_id: { type: 'string' },
        description: { type: 'string', description: '模型或模型目录说明' },
        schema: {
          type: 'object',
          description: 'JSON Schema。每个已知字段应在 properties.*.description 中填写业务含义'
        }
      },
      ['project_id', 'model_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const modelId = requiredStr(args, 'model_id')
      const model = store.getModel(projectId, modelId)
      if (!model) throw new Error('模型不存在')
      if (args.name !== undefined) model.name = str(args, 'name')
      if (args.alias !== undefined) model.alias = str(args, 'alias')
      if (args.parent_id !== undefined) model.parent_id = str(args, 'parent_id') || '0'
      if (args.description !== undefined && model.model_type === 'model') {
        model.data.description = str(args, 'description')
      }
      if (args.schema !== undefined && model.model_type === 'model') {
        model.data.schema = assertModelSchema(args.schema)
      }
      return { model: store.saveModel(projectId, model) }
    }
  },
  {
    name: 'delete_data_model',
    description:
      '删除数据模型或目录（目录级联删除子节点）。必须传 confirm: true；返回仍引用该模型的接口，引用不会被自动改写。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      { project_id: S.project, model_id: { type: 'string' }, confirm: S.confirm },
      ['project_id', 'model_id', 'confirm']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const projectId = projectIdOf(args)
      const modelId = requiredStr(args, 'model_id')
      const references = collectModelReferences(projectId, modelId)
      store.deleteModel(projectId, modelId)
      return { deleted: true, references }
    }
  },

  // -------------------------------------------------------------------------
  // Database connections
  // -------------------------------------------------------------------------
  {
    name: 'list_db_connections',
    description: '列出 MySQL 连接；响应不包含密码、私钥或 passphrase。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project }, ['project_id']),
    handler: (args) => {
      const connections = store
        .listDbConnections(projectIdOf(args))
        .map((connection) => store.redactDbConnection(connection))
      return { connections, total: connections.length }
    }
  },
  {
    name: 'create_db_connection',
    description: '创建 MySQL 连接。SSH 配置会保存，但本轮不建立隧道。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        name: { type: 'string' },
        remarks: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        user: { type: 'string' },
        password: { type: 'string' },
        database: { type: 'string' },
        charset: { type: 'string' },
        ssh: { type: 'object', description: 'SSH 配置（仅保存）' }
      },
      ['project_id', 'name', 'host', 'user']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const connection = createDbConnection(projectId)
      connection.name = requiredStr(args, 'name')
      connection.remarks = str(args, 'remarks')
      connection.config.default = dbConfigFromArgs(args)
      connection.ssh = sshFromArgs(args.ssh)
      const saved = store.saveDbConnection(projectId, connection)
      return { connection: store.redactDbConnection(saved) }
    }
  },
  {
    name: 'update_db_connection',
    description: '更新 MySQL 连接；未提供的密码字段保持不变。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        db_id: { type: 'string' },
        name: { type: 'string' },
        remarks: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        user: { type: 'string' },
        password: { type: 'string' },
        database: { type: 'string' },
        charset: { type: 'string' },
        ssh: { type: 'object' }
      },
      ['project_id', 'db_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const dbId = requiredStr(args, 'db_id')
      const existing = store.getDbConnection(projectId, dbId)
      if (!existing) throw new Error('数据库连接不存在')
      const merged: DbConnection = {
        ...existing,
        name: args.name !== undefined ? str(args, 'name') : existing.name,
        remarks: args.remarks !== undefined ? str(args, 'remarks') : existing.remarks,
        config: {
          default: {
            ...existing.config.default,
            ...dbConfigFromArgs(args, true)
          }
        },
        ssh: args.ssh !== undefined ? sshFromArgs(args.ssh) : existing.ssh
      }
      const saved = store.saveDbConnection(projectId, merged)
      return { connection: store.redactDbConnection(saved) }
    }
  },
  {
    name: 'delete_db_connection',
    description: '删除 MySQL 连接。必须传 confirm: true；已导入模型会保留。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      { project_id: S.project, db_id: { type: 'string' }, confirm: S.confirm },
      ['project_id', 'db_id', 'confirm']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      store.deleteDbConnection(projectIdOf(args), requiredStr(args, 'db_id'))
      return { deleted: true }
    }
  },
  {
    name: 'test_db_connection',
    description: '使用已保存的连接配置执行直连测试（SELECT VERSION()，8 秒超时）。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema({ project_id: S.project, db_id: { type: 'string' } }, [
      'project_id',
      'db_id'
    ]),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const connection = store.getDbConnection(projectId, requiredStr(args, 'db_id'))
      if (!connection) throw new Error('数据库连接不存在')
      const result = await testDbConnection(connection.config.default, connection.ssh)
      if (!result.ok) throw new Error(result.message)
      return result
    }
  },
  {
    name: 'import_db_schema',
    description:
      '读取 MySQL 表结构并导入为数据模型。可勾选表、选择目标目录与同名策略（update/skip/copy）。',
    requires_write: true,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        db_id: { type: 'string' },
        tables: { type: 'array', items: { type: 'string' }, description: '要导入的表名' },
        target_parent_id: { type: 'string', description: '目标模型目录，默认 0' },
        conflict: { type: 'string', enum: ['update', 'skip', 'copy'] }
      },
      ['project_id', 'db_id', 'tables']
    ),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const tables = Array.isArray(args.tables)
        ? (args.tables as unknown[]).map((table) => String(table))
        : []
      const conflict = str(args, 'conflict') as ImportConflictStrategy
      return importDbTables(projectId, requiredStr(args, 'db_id'), {
        tables,
        target_parent_id: str(args, 'target_parent_id') || '0',
        conflict: conflict || 'update'
      })
    }
  },
  {
    name: 'mqtt_list_profiles',
    description:
      '列出项目内的 MQTT Connection Profile 与当前会话。返回值包含明文凭据（ADR-0004），请谨慎处理。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project }, ['project_id']),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const profiles = mqttStore
        .listProfiles(projectId)
        .map((summary) => mqttStore.getProfile(projectId, summary.connection_id))
        .filter((profile) => Boolean(profile))
      return { profiles, sessions: mqttSessions.listSessions(projectId) }
    }
  },
  {
    name: 'mqtt_test_connection',
    description: '使用已保存的 Connection Profile 测试连接，可选往返验证；不会留下持久会话。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        connection_id: { type: 'string', description: 'Connection Profile ID' },
        round_trip: { type: 'boolean', description: '是否执行往返验证' }
      },
      ['project_id', 'connection_id']
    ),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const profile = mqttStore.getProfile(projectId, requiredStr(args, 'connection_id'))
      if (!profile) throw new Error('Connection Profile 不存在')
      return mqttSessions.testConnection(projectId, profile, {
        round_trip: boolArg(args, 'round_trip')
      })
    }
  },
  {
    name: 'mqtt_connect',
    description: '为指定 Connection Profile 建立 MCP 持有的持久会话，成功后自动订阅已保存的 Topic Filter。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        connection_id: { type: 'string', description: 'Connection Profile ID' }
      },
      ['project_id', 'connection_id']
    ),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const connectionId = requiredStr(args, 'connection_id')
      const state = await mqttSessions.connectSession(projectId, connectionId, 'mcp')
      mqttSessions.touchSession(connectionId)
      return state
    }
  },
  {
    name: 'mqtt_subscribe',
    description: '在已连接的 MQTT 会话上订阅一个或多个 Topic Filter，返回 SUBACK 结果。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        connection_id: { type: 'string' },
        filters: {
          type: 'array',
          description: 'Topic Filter 列表；元素可为字符串或 { filter, qos }',
          items: { type: ['string', 'object'] }
        },
        filter: { type: 'string', description: '单个 Topic Filter（与 filters 二选一）' },
        qos: { type: 'number', enum: [0, 1, 2] }
      },
      ['project_id', 'connection_id']
    ),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const connectionId = requiredStr(args, 'connection_id')
      const results = await mqttSessions.subscribe(
        projectId,
        connectionId,
        mqttSubscriptionsArg(args)
      )
      mqttSessions.touchSession(connectionId)
      return { results }
    }
  },
  {
    name: 'mqtt_unsubscribe',
    description: '取消一个或多个 Topic Filter 的订阅。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        connection_id: { type: 'string' },
        filters: { type: 'array', items: { type: 'string' } },
        filter: { type: 'string' }
      },
      ['project_id', 'connection_id']
    ),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const connectionId = requiredStr(args, 'connection_id')
      const filters = Array.isArray(args.filters)
        ? (args.filters as unknown[]).map((item) => String(item)).filter(Boolean)
        : str(args, 'filter')
          ? [str(args, 'filter')]
          : []
      if (!filters.length) throw new Error('缺少参数 filters')
      await mqttSessions.unsubscribe(projectId, connectionId, filters)
      mqttSessions.touchSession(connectionId)
      return { unsubscribed: filters }
    }
  },
  {
    name: 'mqtt_publish',
    description: '向 MQTT 会话发布消息，支持 QoS、retain 与 MQTT 5 User Properties。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        connection_id: { type: 'string' },
        topic: { type: 'string' },
        payload: { type: 'string' },
        payload_view: { type: 'string', enum: ['json', 'plain', 'hex', 'base64'] },
        qos: { type: 'number', enum: [0, 1, 2] },
        retain: { type: 'boolean' },
        user_properties: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, value: { type: 'string' } }
          }
        }
      },
      ['project_id', 'connection_id', 'topic']
    ),
    handler: async (args) => {
      const projectId = projectIdOf(args)
      const connectionId = requiredStr(args, 'connection_id')
      const input: MqttPublishInput = {
        topic: requiredStr(args, 'topic'),
        payload: mqttPayloadArg(args),
        payload_view: mqttPayloadViewArg(args),
        qos: mqttQosArg(args.qos),
        retain: boolArg(args, 'retain'),
        user_properties: mqttUserPropertiesArg(args)
      }
      const result = await mqttSessions.publish(projectId, connectionId, input)
      mqttSessions.touchSession(connectionId)
      if (!result.ok) throw new Error(result.error || '发布失败')
      return result
    }
  },
  {
    name: 'mqtt_drain_messages',
    description:
      '用游标拉取 MQTT 会话收到/发出的消息，不阻塞等待。无新消息时返回空数组与相同 cursor。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        session_id: { type: 'string', description: 'mqtt_connect 返回的 session_id' },
        cursor: { type: 'number', description: '上次返回的 nextCursor，默认 0' },
        limit: { type: 'number', description: '本次最多返回条数，默认 100' }
      },
      ['project_id', 'session_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const cursor = Number.isFinite(Number(args.cursor))
        ? Math.max(0, Math.floor(Number(args.cursor)))
        : 0
      const limit = Number.isFinite(Number(args.limit))
        ? Math.floor(Number(args.limit))
        : 100
      return mqttSessions.drainMessages(
        projectId,
        requiredStr(args, 'session_id'),
        cursor,
        limit
      )
    }
  },
  {
    name: 'mqtt_list_sessions',
    description: '列出项目内当前 MQTT 会话及连接状态。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project }, ['project_id']),
    handler: (args) => ({ sessions: mqttSessions.listSessions(projectIdOf(args)) })
  },
  {
    name: 'mqtt_disconnect',
    description: '断开指定 MQTT 会话。可用 session_id 或 connection_id 指定。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        session_id: { type: 'string' },
        connection_id: { type: 'string' }
      },
      ['project_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      let connectionId = str(args, 'connection_id')
      if (!connectionId) {
        const sessionId = requiredStr(args, 'session_id')
        const found = mqttSessions.findSessionBySessionId(sessionId)
        if (!found) throw new Error('会话不存在或已关闭')
        connectionId = found.session.connectionId
      }
      mqttSessions.disconnect(projectId, connectionId, 'mcp')
      return { disconnected: true }
    }
  },
  {
    name: 'mqtt_create_profile',
    description:
      '创建 MQTT Connection Profile（需要 allow_write）。可传顶层字段或 profile 对象；缺省字段使用默认值。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        profile: { type: 'object', description: '可选：完整或部分 Connection Profile' },
        name: { type: 'string' },
        group: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        transport: { type: 'string', enum: ['tcp', 'tls', 'ws', 'wss'] },
        ws_path: { type: 'string' },
        protocol_version: { type: 'number', enum: [4, 5] },
        client_id: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
        keepalive: { type: 'number' },
        clean_session: { type: 'boolean' },
        connect_timeout_ms: { type: 'number' },
        subscriptions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { filter: { type: 'string' }, qos: { type: 'number', enum: [0, 1, 2] } }
          }
        },
        tls: { type: 'object' },
        will: { type: 'object' },
        mqtt5: { type: 'object' },
        retention: { type: 'object' }
      },
      ['project_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const profile = createDefaultMqttProfile(projectId, mqttProfilePatch(args))
      return { profile: mqttStore.createProfile(projectId, profile) }
    }
  },
  {
    name: 'mqtt_update_profile',
    description:
      '更新 MQTT Connection Profile（需要 allow_write）。只修改传入字段，不可修改 connection_id/project_id。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        connection_id: { type: 'string', description: 'Connection Profile ID' },
        profile: { type: 'object', description: '可选：要合并的部分字段' },
        name: { type: 'string' },
        group: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        transport: { type: 'string', enum: ['tcp', 'tls', 'ws', 'wss'] },
        ws_path: { type: 'string' },
        protocol_version: { type: 'number', enum: [4, 5] },
        client_id: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
        keepalive: { type: 'number' },
        clean_session: { type: 'boolean' },
        connect_timeout_ms: { type: 'number' },
        subscriptions: { type: 'array' },
        tls: { type: 'object' },
        will: { type: 'object' },
        mqtt5: { type: 'object' },
        retention: { type: 'object' }
      },
      ['project_id', 'connection_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const connectionId = requiredStr(args, 'connection_id')
      const existing = mqttStore.getProfile(projectId, connectionId)
      if (!existing) throw new Error('Connection Profile 不存在')
      const next: MqttConnectionProfile = {
        ...existing,
        ...mqttProfilePatch(args),
        connection_id: existing.connection_id,
        project_id: existing.project_id,
        created_at: existing.created_at
      }
      return { profile: mqttStore.saveProfile(projectId, next) }
    }
  },
  {
    name: 'mqtt_delete_profile',
    description: '删除 MQTT Connection Profile 及其版本与本地消息/Attempt（需要 allow_write）。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        connection_id: { type: 'string' },
        confirm: S.confirm
      },
      ['project_id', 'connection_id']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const projectId = projectIdOf(args)
      const connectionId = requiredStr(args, 'connection_id')
      if (!mqttStore.getProfile(projectId, connectionId)) {
        throw new Error('Connection Profile 不存在')
      }
      try {
        mqttSessions.disconnect(projectId, connectionId)
      } catch {
        // 强制结束会话失败不阻塞配置删除。
      }
      mqttStore.deleteProfile(projectId, connectionId)
      return { deleted: true, connection_id: connectionId }
    }
  },
  {
    name: 'get_api_design',
    description: '读取接口设计与契约：说明、错误码表、请求与响应定义。修改后用 upsert_api 或 update_api_design 写回。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, target_id: S.target }, [
      'project_id',
      'target_id'
    ]),
    handler: (args) => {
      const target = withDisplayFieldDocs(apiTargetOf(args))
      return {
        target_id: target.target_id,
        name: target.name,
        description: target.description ?? '',
        design: target.design ?? { errors: [] },
        request: target.request ?? null,
        response: target.response ?? null
      }
    }
  },
  {
    name: 'update_api_design',
    description:
      '更新接口设计：说明、错误码表、请求或响应定义（需要写入权限）。' +
      '修改接口说明优先用本工具或 upsert_api；说明至少包含用途、调用方式、参数含义、状态口径与错误码，不要只写“查询列表”。' +
      'request/response 传入即整组替换；errors 传空数组表示清空。本工具不改 Header 值与响应示例的快照。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: S.target,
        description: { type: 'string' },
        errors: {
          type: 'array',
          description: '错误码表；传入空数组表示清空',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              description: { type: 'string' }
            }
          }
        },
        request: { type: 'object', description: '完整 RequestModel，传入即替换' },
        response: { type: 'object', description: '完整 ResponseModel，传入即替换' }
      },
      ['project_id', 'target_id']
    ),
    handler: (args) => {
      const target = apiTargetOf(args)
      const next: Target = { ...target }
      if (typeof args.description === 'string') next.description = args.description
      if (args.errors !== undefined) {
        const errors = Array.isArray(args.errors) ? args.errors : []
        next.design = {
          ...(next.design ?? {}),
          errors: errors.map((item) => {
            const source = (item ?? {}) as Record<string, unknown>
            return {
              code: typeof source.code === 'string' ? source.code : String(source.code ?? ''),
              message:
                typeof source.message === 'string' ? source.message : String(source.message ?? ''),
              description:
                typeof source.description === 'string' ? source.description : undefined
            }
          })
        }
      }
      if (args.request && typeof args.request === 'object') {
        const request = args.request as any
        next.request ??= createRequest()
        for (const slot of ['header', 'query', 'restful', 'cookie'] as const) {
          if (request[slot]?.parameter !== undefined) next.request[slot].parameter = patchParams(next.request[slot].parameter, request[slot].parameter, slot)
        }
        if (request.body) {
          const body = { ...request.body }
          if (body.formdata) body.parameters = body.formdata
          if (body.urlencoded) body.parameters = body.urlencoded
          patchBody(next, body)
        }
        if (request.auth) next.request.auth = { ...next.request.auth, ...request.auth }
        for (const key of ['pre_script', 'test', 'pre_script_enabled', 'test_enabled', 'pre_tasks', 'post_tasks'] as const) if (request[key] !== undefined) (next.request as any)[key] = request[key]
      }
      if (args.response && typeof args.response === 'object') {
        for (const example of (args.response as any).example ?? []) {
          patchSuccessResponse(next, { ...example.expect, ...(example.example_id ? { example_id: example.example_id } : {}), ...(Object.hasOwn(example, 'raw') ? { raw: example.raw } : {}), ...(example.field_docs || example.expect?.schema ? { field_docs: example.field_docs ?? fieldDocsFromSchema(example.expect.schema) } : {}) })
        }
      }
      store.saveTarget(projectIdOf(args), next)
      return {
        target_id: next.target_id,
        description: next.description ?? '',
        design: next.design ?? { errors: [] },
        request: next.request, response: next.response, documentation: { issues: documentationIssues(next) }
      }
    }
  },
  {
    name: 'list_api_cases',
    description: '列出接口下的全部用例。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, target_id: S.target }, [
      'project_id',
      'target_id'
    ]),
    handler: (args) => ({ cases: apiTargetOf(args).cases ?? [] })
  },
  {
    name: 'get_api_case',
    description: '读取单个接口用例。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema(
      { project_id: S.project, target_id: S.target, case_id: { type: 'string' } },
      ['project_id', 'target_id', 'case_id']
    ),
    handler: (args) => ({
      case: caseOf(apiTargetOf(args), requiredStr(args, 'case_id'))
    })
  },
  {
    name: 'create_api_case',
    description: '为接口创建用例（需要 allow_write）。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: S.target,
        name: { type: 'string' },
        description: { type: 'string' },
        is_enabled: { type: 'boolean' },
        override: { type: 'object', description: '请求覆盖' },
        assertions: { type: 'array', description: '断言列表' }
      },
      ['project_id', 'target_id']
    ),
    handler: (args) => {
      const target = apiTargetOf(args)
      const apiCase = createApiCase({
        name: str(args, 'name') || '新用例',
        ...casePatchOf(args)
      })
      target.cases = [...(target.cases ?? []), apiCase]
      store.saveTarget(projectIdOf(args), target)
      return { case: apiCase }
    }
  },
  {
    name: 'update_api_case',
    description: '更新接口用例；只修改传入字段（需要 allow_write）。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: S.target,
        case_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        is_enabled: { type: 'boolean' },
        override: { type: 'object' },
        assertions: { type: 'array' }
      },
      ['project_id', 'target_id', 'case_id']
    ),
    handler: (args) => {
      const target = apiTargetOf(args)
      const caseId = requiredStr(args, 'case_id')
      const existing = caseOf(target, caseId)
      const next: ApiCase = { ...existing, ...casePatchOf(args), case_id: existing.case_id }
      target.cases = (target.cases ?? []).map((item) =>
        item.case_id === caseId ? next : item
      )
      store.saveTarget(projectIdOf(args), target)
      return { case: next }
    }
  },
  {
    name: 'delete_api_case',
    description: '删除接口用例（需要 allow_write）。',
    requires_write: true,
    requires_execute: false,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: S.target,
        case_id: { type: 'string' },
        confirm: S.confirm
      },
      ['project_id', 'target_id', 'case_id']
    ),
    handler: (args) => {
      if (!boolArg(args, 'confirm')) throw new Error('删除操作需要 confirm: true')
      const target = apiTargetOf(args)
      const caseId = requiredStr(args, 'case_id')
      caseOf(target, caseId)
      target.cases = (target.cases ?? []).filter((item) => item.case_id !== caseId)
      store.saveTarget(projectIdOf(args), target)
      return { deleted: true, case_id: caseId }
    }
  },
  {
    name: 'run_api_case',
    description: '运行单个接口用例并返回断言结果（需要 allow_execute）。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: S.target,
        case_id: { type: 'string' },
        environment_id: { type: 'string' }
      },
      ['project_id', 'target_id', 'case_id']
    ),
    handler: async (args) => {
      const target = apiTargetOf(args)
      const apiCase = caseOf(target, requiredStr(args, 'case_id'))
      const result = await runApiCase(
        projectIdOf(args),
        target,
        apiCase,
        str(args, 'environment_id') || undefined
      )
      return { case_id: apiCase.case_id, result }
    }
  },
  {
    name: 'run_api_cases',
    description: '顺序运行接口下全部启用用例并返回汇总（需要 allow_execute）。',
    requires_write: false,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        target_id: S.target,
        environment_id: { type: 'string' }
      },
      ['project_id', 'target_id']
    ),
    handler: async (args) =>
      runApiCases(
        projectIdOf(args),
        apiTargetOf(args),
        str(args, 'environment_id') || undefined
      )
  }
]

function assertModelSchema(value: unknown): ModelSchema {
  if (value === undefined) {
    return { type: 'object', properties: {}, 'x-schema-orders': [] }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('schema 必须是 JSON 对象')
  }
  const schema = value as ModelSchema
  const allowed = new Set([
    'object',
    'array',
    'string',
    'number',
    'integer',
    'boolean',
    'null'
  ])
  if (schema.type !== undefined && !allowed.has(String(schema.type))) {
    throw new Error(`不支持的 schema 类型：${String(schema.type)}`)
  }
  if (schema.$ref !== undefined && !String(schema.$ref).startsWith('kindraapi://model/')) {
    throw new Error('模型引用必须使用 kindraapi://model/<model_id> 协议')
  }
  return schema
}

function collectModelReferences(projectId: string, modelId: string): Array<ModelReference & { model_id: string }> {
  const models = store.listModels(projectId)
  const ids = new Set<string>([modelId])
  let changed = true
  while (changed) {
    changed = false
    for (const model of models) {
      if (ids.has(model.parent_id) && !ids.has(model.model_id)) {
        ids.add(model.model_id)
        changed = true
      }
    }
  }
  const references: Array<ModelReference & { model_id: string }> = []
  for (const id of ids) {
    for (const reference of store.findModelReferences(projectId, id)) {
      references.push({ ...reference, model_id: id })
    }
  }
  return references
}

function dbConfigFromArgs(
  args: Args,
  partial = false
): DbConnection['config']['default'] {
  const text = (key: string): string | undefined =>
    args[key] !== undefined ? String(args[key]) : undefined
  const portValue = args.port !== undefined ? Number(args.port) : undefined
  if (partial) {
    const config: Partial<DbConnection['config']['default']> = {}
    const host = text('host')
    if (host !== undefined) config.host = host
    if (portValue !== undefined && Number.isFinite(portValue)) config.port = portValue
    const user = text('user')
    if (user !== undefined) config.user = user
    const password = text('password')
    if (password !== undefined) config.password = password
    const database = text('database')
    if (database !== undefined) config.database = database
    const charset = text('charset')
    if (charset !== undefined) config.charset = charset
    return config as DbConnection['config']['default']
  }
  return {
    host: text('host') ?? '',
    port: portValue && Number.isFinite(portValue) ? portValue : 3306,
    user: text('user') ?? '',
    password: text('password') ?? '',
    database: text('database') ?? '',
    charset: text('charset') || 'utf8mb4'
  }
}

function sshFromArgs(value: unknown): DbSshConfig {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    enable: raw.enable === 1 || raw.enable === true ? 1 : -1,
    host: String(raw.host ?? ''),
    port: Number(raw.port) || 22,
    username: String(raw.username ?? ''),
    password: String(raw.password ?? ''),
    auth_type: raw.auth_type === 2 || raw.auth_type === 3 ? raw.auth_type : 1,
    private_key: String(raw.private_key ?? ''),
    passphrase: String(raw.passphrase ?? '')
  }
}

// Legacy entry points expose the same detailed authoring contract and strict gate.
for (const name of ['create_api', 'update_api']) {
  const tool = TOOLS.find(item => item.name === name)!
  const props = tool.input_schema.properties as Record<string, unknown>
  Object.assign(props, apiDocumentationProperties)
  props.response_example = successSchema
  tool.handler = name === 'create_api'
    ? args => writeApiDocumentation(args, true)
    : args => writeApiDocumentation(args)
  tool.description = name === 'create_api'
    ? '创建接口（推荐优先用 upsert_api 一次提交完整文档）。执行硬性文档校验：必须填写接口说明 description 与完整 http(s) URL；每个已知字段必须写明 description、type、required、nullable、enum，有枚举时必须提供 enum_descriptions。缺项拒绝写入且不保存。创建后仍需 execute_api(save_response=true) 保存真实响应示例。'
    : '增量更新已有接口的 Header/Query/Path/Body 与响应示例，只改传入字段。headers/query/paths/cookies 是整组覆盖，要保留的项必须一起传。修改接口说明请用 update_api_design 或 upsert_api，不要依赖本工具。本次显式提交的字段必须补齐 description、type、required、nullable、enum（有枚举需 enum_descriptions），未提交字段保留；缺项拒绝写入。URL 若提交必须是完整 http(s) 地址。'
}

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]))

export function listToolInfos(): McpToolInfo[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    requires_write: tool.requires_write,
    requires_execute: tool.requires_execute,
    input_schema: tool.input_schema
  }))
}

export function checkPermission(
  tool: ToolDefinition,
  config: McpConfig,
  args: Args
): string | null {
  if (!config.enabled) return 'MCP 未开启'
  if (tool.name === 'list_projects') return null
  if (tool.name === 'create_project') {
    return config.allow_write ? null : '未开启写入权限 allow_write'
  }
  const projectId = typeof args.project_id === 'string' ? args.project_id : ''
  if (!projectId) return '缺少 project_id'
  if (!config.allowed_project_ids.includes(projectId)) return '项目不在授权列表'
  if (tool.name === 'execute_api' && boolArg(args, 'save_response') && !config.allow_write) return '保存响应示例需要写入权限 allow_write'
  return projectPermissionError(config, projectId, { write: tool.requires_write, execute: tool.requires_execute })
}

export async function callTool(
  name: string,
  args: Args,
  config: McpConfig
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = TOOL_MAP.get(name)
  if (!tool) return { ok: false, error: `未知工具：${name}` }
  const current = store.getMcpConfig()
  const denied = checkPermission(tool, config, args) ?? checkPermission(tool, current, args)
  if (denied) return { ok: false, error: denied }
  try {
    const effective = { ...current,
      allow_write: current.allow_write && config.allow_write,
      allow_execute: current.allow_execute && config.allow_execute,
      allowed_project_ids: current.allowed_project_ids.filter(id => config.allowed_project_ids.includes(id))
    }
    const result = await withTargetChanges('mcp', undefined, () => tool.handler(args, effective))
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export type { ToolDefinition }
