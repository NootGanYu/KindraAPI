import type {
  Environment,
  FlowEvent,
  FlowRequestInput,
  McpConfig,
  McpToolInfo
} from '@shared/types'
import {
  createEnvironment,
  createFlow,
  createFlowEvent,
  createId,
  createParam,
  createRequest
} from '@shared/factories'
import * as store from '../storage/store'
import { sendRequest } from '../request/executor'
import { applyRequestInput, runFlow } from '../flow/engine'

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
  project: { type: 'string', description: '项目 ID' },
  target: { type: 'string', description: '接口 target_id' },
  flow: { type: 'string', description: '流程 flow_id' },
  environment: { type: 'string', description: '环境 env_id' },
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

function exampleFromSchema(schema: any, depth = 0): unknown {
  if (!schema || depth > 6) return null
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  const type = schema.type
  if (type === 'object' || schema.properties) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      result[key] = exampleFromSchema(value, depth + 1)
    }
    return result
  }
  if (type === 'array') return [exampleFromSchema(schema.items, depth + 1)]
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'string') return ''
  return null
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
    if (typeof step.pre_script === 'string' && step.pre_script) {
      events.push(createFlowEvent('script', { name: `${target.name} · 预执行`, script: step.pre_script }))
    }
    events.push(
      createFlowEvent('api', {
        name: target.name,
        target_id: targetId,
        input: (step.input ?? {}) as FlowRequestInput
      })
    )
    if (typeof step.post_script === 'string' && step.post_script) {
      events.push(createFlowEvent('script', { name: `${target.name} · 后执行`, script: step.post_script }))
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
    name: 'list_projects',
    description: '列出已在 MCP 授权列表中的项目。',
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
        description: { type: 'string', description: '项目说明（≤1024）' }
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
      store.saveMcpConfig({
        ...config,
        allowed_project_ids: [...config.allowed_project_ids, project.project_id]
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
    description: '列出项目中的接口与目录，可按父目录或关键字过滤。',
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
          method: item.method,
          url: item.url,
          sort: item.sort
        }))
      }
    }
  },
  {
    name: 'get_api_detail',
    description: '获取单个接口的完整实体。',
    requires_write: false,
    requires_execute: false,
    input_schema: schema({ project_id: S.project, target_id: S.target }, ['project_id', 'target_id']),
    handler: (args) => {
      const target = store.getTarget(projectIdOf(args), requiredStr(args, 'target_id'))
      if (!target) throw new Error('接口不存在')
      return { api: target }
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
        url: { type: 'string', description: '完整地址，或含 {{baseUrl}} 的地址' },
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
            parameters: { type: 'array', description: 'urlencoded/form-data 参数列表' }
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
    handler: (args) => {
      const projectId = projectIdOf(args)
      const target = store.getTarget(projectId, requiredStr(args, 'target_id'))
      if (!target || target.target_type !== 'api') throw new Error('接口不存在')
      const name = str(args, 'name')
      if (name) target.name = name
      const method = str(args, 'method').toUpperCase()
      if (method) target.method = method
      const url = str(args, 'url')
      if (url) target.url = url
      target.request = target.request ?? createRequest()

      const toParams = (value: unknown): ReturnType<typeof createParam>[] | null => {
        if (!Array.isArray(value)) return null
        return value
          .filter((item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object'
          )
          .map((item) =>
            createParam({
              key: String(item.key ?? item.name ?? ''),
              value: String(item.value ?? ''),
              description: String(item.description ?? ''),
              is_checked: item.checked === false ? -1 : 1
            })
          )
          .filter((item) => item.key)
      }
      const slots: Array<[string, 'header' | 'query' | 'cookie' | 'restful']> = [
        ['headers', 'header'],
        ['query', 'query'],
        ['cookies', 'cookie'],
        ['paths', 'restful']
      ]
      for (const [argKey, slot] of slots) {
        const params = toParams(args[argKey])
        if (params) target.request[slot].parameter = params
      }

      const body = args.body as Record<string, unknown> | undefined
      if (body && typeof body === 'object') {
        if (typeof body.mode === 'string') {
          target.request.body.mode = body.mode as typeof target.request.body.mode
        }
        if (typeof body.raw === 'string') {
          let raw = body.raw
          try {
            const parsed = JSON.parse(raw)
            if (parsed !== null && typeof parsed === 'object') {
              raw = JSON.stringify(parsed, null, 2)
            }
          } catch {
            // 保留非 JSON 原文
          }
          target.request.body.raw = raw
        }
        const params = toParams(body.parameters)
        if (params) target.request.body.parameter = params
      }

      const auth = args.auth as Record<string, unknown> | undefined
      if (auth && typeof auth === 'object' && typeof auth.type === 'string') {
        const next: Record<string, unknown> = { type: auth.type }
        if (auth.bearer && typeof auth.bearer === 'object') {
          const bearer = auth.bearer as Record<string, unknown>
          next.bearer = { key: String(bearer.key ?? '') }
        }
        if (auth.basic && typeof auth.basic === 'object') {
          const basic = auth.basic as Record<string, unknown>
          next.basic = {
            username: String(basic.username ?? ''),
            password: String(basic.password ?? '')
          }
        }
        if (auth.kv && typeof auth.kv === 'object') {
          const kv = auth.kv as Record<string, unknown>
          next.kv = {
            key: String(kv.key ?? ''),
            value: String(kv.value ?? ''),
            in: kv.in === 'query' ? 'query' : 'header'
          }
        }
        target.request.auth = next as typeof target.request.auth
      }

      const example = args.response_example as Record<string, unknown> | undefined
      if (example && typeof example === 'object') {
        const raw =
          typeof example.raw === 'string'
            ? example.raw
            : JSON.stringify(example.raw ?? {}, null, 2)
        target.response = {
          example: [
            {
              example_id: createId('ex'),
              expect: {
                name: String(example.name ?? '示例'),
                code: (example.code as string | number | undefined) ?? 200,
                content_type: String(example.content_type ?? 'application/json'),
                is_default: 1
              },
              raw
            }
          ]
        }
      }

      return { api: store.saveTarget(projectId, target) }
    }
  },
  {
    name: 'sync_openapi',
    description: '从 OpenAPI 3 / Swagger 2 文档导入接口到项目。',
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
            target = store.createTargetInProject(projectId, folderId, 'api')
            created += 1
          }
          target.name = op.summary || op.operationId || `${methodUpper} ${rawPath}`
          target.description = op.description || ''
          target.method = methodUpper
          target.url = url
          const request = createRequest()
          const params = [...pathLevelParams, ...(Array.isArray(op.parameters) ? op.parameters : [])]
          for (const param of params) {
            if (!param?.name) continue
            const entry = createParam({
              key: String(param.name),
              value: '',
              description: String(param.description ?? ''),
              is_checked: param.required ? 1 : -1
            })
            if (param.in === 'query') request.query.parameter.push(entry)
            else if (param.in === 'header') request.header.parameter.push(entry)
            else if (param.in === 'path') request.restful.parameter.push(entry)
            else if (param.in === 'cookie') request.cookie.parameter.push(entry)
          }
          const bodySchema =
            op.requestBody?.content?.['application/json']?.schema ??
            params.find((param: any) => param?.in === 'body')?.schema
          if (bodySchema) {
            request.body = {
              ...request.body,
              mode: 'json',
              raw: JSON.stringify(exampleFromSchema(bodySchema), null, 2)
            }
          }
          target.request = request
          const firstResponse = Object.entries(op.responses ?? {}).find(([code]) =>
            /^2\d\d$/.test(code)
          ) as [string, any] | undefined
          const contentEntries = Object.entries(firstResponse?.[1]?.content ?? {})
          const media = contentEntries[0] as [string, any] | undefined
          const mediaType = media?.[0] ?? 'application/json'
          const sample =
            media?.[1]?.example ?? firstResponse?.[1]?.examples?.default?.value
          const schema = media?.[1]?.schema
          if (firstResponse && (sample !== undefined || schema)) {
            const sampleValue = sample !== undefined ? sample : exampleFromSchema(schema)
            target.response = {
              example: [
                {
                  example_id: createId('ex'),
                  expect: {
                    name: '成功',
                    code: firstResponse[0],
                    content_type: mediaType,
                    is_default: 1
                  },
                  raw:
                    typeof sampleValue === 'string'
                      ? sampleValue
                      : JSON.stringify(sampleValue, null, 2)
                }
              ]
            }
          }
          store.saveTarget(projectId, target)
          items.push({ method: methodUpper, url, name: target.name, action: match ? 'updated' : 'created' })
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
    description: '删除接口或目录（目录会级联删除子项）。必须传 confirm: true。',
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
    description: '执行单个接口并返回执行摘要。input 只能覆盖接口已定义的参数。',
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
      if (boolArg(args, 'save_response')) {
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
          fresh.response = {
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
                  method: snapshot?.method,
                  url: snapshot?.url,
                  headers: toParamRows(snapshot?.headers ?? {}),
                  body: requestBody
                }
              }
            ]
          }
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
    description: '按 run_id 获取完整执行记录（流程或单接口）。',
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
    description: '创建业务流程。steps 为接口步骤数组，可带 pre_script / post_script。',
    requires_write: true,
    requires_execute: true,
    input_schema: schema(
      {
        project_id: S.project,
        name: { type: 'string' },
        description: { type: 'string' },
        environment_id: S.environment,
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              target_id: { type: 'string' },
              input: { type: 'object' },
              pre_script: { type: 'string' },
              post_script: { type: 'string' }
            }
          }
        }
      },
      ['project_id', 'name', 'steps']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const flow = createFlow(projectId, requiredStr(args, 'name'), str(args, 'environment_id'))
      flow.description = str(args, 'description')
      flow.events = stepEvents(projectId, args.steps)
      store.saveFlow(projectId, flow)
      return { flow_id: flow.flow_id, name: flow.name, message: 'created' }
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
        steps: { type: 'array' }
      },
      ['project_id', 'flow_id']
    ),
    handler: (args) => {
      const projectId = projectIdOf(args)
      const flow = store.getFlow(projectId, requiredStr(args, 'flow_id'))
      if (!flow) throw new Error('流程不存在')
      if (args.name !== undefined) flow.name = str(args, 'name') || flow.name
      if (args.description !== undefined) flow.description = str(args, 'description')
      if (args.environment_id !== undefined) flow.env_id = str(args, 'environment_id')
      if (args.steps !== undefined) flow.events = stepEvents(projectId, args.steps)
      store.saveFlow(projectId, flow)
      return { flow_id: flow.flow_id, name: flow.name, message: 'updated' }
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
          updated_at: flow.updated_at
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
      const flow = store.getFlow(projectId, requiredStr(args, 'flow_id'))
      if (!flow) throw new Error('流程不存在')
      const run = await runFlow(projectId, flow, str(args, 'environment_id') || undefined)
      return {
        run_id: run.run_id,
        project_id: projectId,
        flow_id: flow.flow_id,
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
  }
]

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
  if (tool.requires_write && !config.allow_write) return '未开启写入权限 allow_write'
  if (tool.requires_execute && !config.allow_execute) return '未开启接口执行权限 allow_execute'
  return null
}

export async function callTool(
  name: string,
  args: Args,
  config: McpConfig
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = TOOL_MAP.get(name)
  if (!tool) return { ok: false, error: `未知工具：${name}` }
  const denied = checkPermission(tool, config, args)
  if (denied) return { ok: false, error: denied }
  try {
    const result = await tool.handler(args, config)
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export type { ToolDefinition }
