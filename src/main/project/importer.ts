import fs from 'node:fs'
import path from 'node:path'
import type {
  BodyModel,
  FieldRules,
  Param,
  Project,
  ProjectImportFormat,
  ProjectImportInspection,
  ProjectImportRequest,
  ProjectImportResult,
  RequestModel,
  ResponseExample,
  ResponseModel
} from '@shared/types'
import { createParam, createRequest, createTarget } from '@shared/factories'
import { defaultApiStatus } from '@shared/apiStatuses'
import { rulesFromSchema } from '@shared/fieldRules'
import { fieldDocsFromSchema } from '@shared/jsonFields'
import { generateSchemaExample } from '../schema/example'
import * as store from '../storage/store'

const MAX_FILE_SIZE = 50 * 1024 * 1024
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const

interface ImportApiNode {
  kind: 'api'
  name: string
  description: string
  method: string
  url: string
  request: RequestModel
  response: ResponseModel
}

interface ImportFolderNode {
  kind: 'folder'
  name: string
  description: string
  children: ImportNode[]
}

type ImportNode = ImportApiNode | ImportFolderNode

interface ParsedImport {
  format: ProjectImportFormat
  formatLabel: string
  title: string
  intro: string
  nodes: ImportNode[]
  warnings: string[]
}

type JsonObject = Record<string, unknown>

const FORMAT_LABELS: Record<ProjectImportFormat, string> = {
  openapi: 'OpenAPI / Swagger',
  postman: 'Postman Collection'
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {}
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (isObject(value) && typeof value.content === 'string') return value.content
  return ''
}

function scalarText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function cleanName(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim()
  return (text || fallback).slice(0, 200)
}

function fileBaseName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

function findRef(doc: JsonObject, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  let current: unknown = doc
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isObject(current) && !Array.isArray(current)) return undefined
    current = Array.isArray(current)
      ? current[Number(key)]
      : (current as JsonObject)[key]
  }
  return current
}

/** 展开 OpenAPI 内部 $ref；循环引用时返回空对象，避免无限递归。 */
function resolveSchema(value: unknown, doc: JsonObject, seen: Set<string> = new Set(), depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 24) return value
  if (Array.isArray(value)) {
    return value.map((item) => resolveSchema(item, doc, new Set(seen), depth + 1))
  }
  const node = value as JsonObject
  if (typeof node.$ref === 'string') {
    if (seen.has(node.$ref)) return {}
    const target = findRef(doc, node.$ref)
    if (target === undefined) return node
    const nextSeen = new Set(seen).add(node.$ref)
    const resolved = resolveSchema(target, doc, nextSeen, depth + 1)
    if (!isObject(resolved)) return resolved
    const merged = { ...resolved, ...Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$ref')) }
    return resolveSchema(merged, doc, nextSeen, depth + 1)
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [key, resolveSchema(child, doc, new Set(seen), depth + 1)])
  )
}

function schemaRules(schema: unknown): FieldRules {
  return isObject(schema) ? rulesFromSchema(schema) : {}
}

function paramFromSchema(
  key: string,
  schema: unknown,
  options: { value?: unknown; description?: string; required?: boolean; checked?: boolean } = {}
): Param {
  const source = asObject(schema)
  const rules = schemaRules(source)
  const type =
    typeof source.type === 'string'
      ? source.type
      : Array.isArray(source.items)
        ? 'array'
        : source.items
          ? 'array'
          : 'string'
  return createParam({
    ...rules,
    key,
    value: scalarText(
      options.value !== undefined
        ? options.value
        : source.example ?? source.default ?? (Array.isArray(source.enum) ? source.enum[0] : '')
    ),
    description: options.description ?? String(source.description ?? ''),
    field_type: type,
    required: options.required ?? rules.required ?? false,
    is_checked: options.checked === false ? -1 : 1
  })
}

function upsertParam(params: Param[], next: Param, caseInsensitive = false): Param[] {
  const key = caseInsensitive ? next.key.toLowerCase() : next.key
  const index = params.findIndex((item) => (caseInsensitive ? item.key.toLowerCase() : item.key) === key)
  if (index < 0) return [...params, next]
  return params.map((item, position) => (position === index ? { ...item, ...next, param_id: item.param_id } : item))
}

function setContentType(request: RequestModel, value: string): void {
  request.header.parameter = upsertParam(
    request.header.parameter,
    createParam({ key: 'Content-Type', value, is_system: 1 }),
    true
  )
}

function firstExample(examples: unknown): unknown {
  if (!isObject(examples)) return undefined
  const first = Object.values(examples)[0]
  return isObject(first) && first.value !== undefined ? first.value : undefined
}

function joinUrl(prefix: string, rawPath: string): string {
  if (!prefix) return rawPath
  if (!rawPath) return prefix
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) return rawPath
  return `${prefix.replace(/\/+$/, '')}/${rawPath.replace(/^\/+/, '')}`
}

function resolveServerUrl(server: unknown): string {
  if (!isObject(server) || typeof server.url !== 'string') return ''
  let url = server.url
  const variables = asObject(server.variables)
  for (const [key, value] of Object.entries(variables)) {
    const defaultValue = isObject(value) ? scalarText(value.default) : ''
    if (defaultValue) url = url.split(`{${key}}`).join(defaultValue)
  }
  return url
}

function buildResponseExample(
  name: string,
  code: string | number,
  contentType: string,
  sample: unknown,
  schema: unknown
): ResponseExample {
  const raw =
    sample === undefined
      ? ''
      : typeof sample === 'string'
        ? sample
        : JSON.stringify(sample, null, 2)
  const docs = schema === undefined ? [] : fieldDocsFromSchema(schema, sample)
  return {
    example_id: `ex_${String(code)}_${Math.random().toString(16).slice(2, 10)}`,
    expect: { name, code, content_type: contentType, is_default: 1 },
    raw,
    field_docs: docs,
    raw_parameter: [createParam({ key: 'Content-Type', value: contentType })],
    headers: [createParam({ key: 'Content-Type', value: contentType })],
    cookies: []
  }
}

// ---------------------------------------------------------------------------
// OpenAPI / Swagger 2
// ---------------------------------------------------------------------------

function pickMedia(content: unknown, predicate: (mediaType: string) => boolean): [string, JsonObject] | null {
  if (!isObject(content)) return null
  for (const [mediaType, media] of Object.entries(content)) {
    if (predicate(mediaType.toLowerCase())) return [mediaType, asObject(media)]
  }
  return null
}

function applyBodiesFromContent(request: RequestModel, content: unknown, doc: JsonObject): void {
  const jsonMedia = pickMedia(content, (type) => type.includes('json'))
  if (jsonMedia) {
    const [mediaType, media] = jsonMedia
    const schema = resolveSchema(media.schema, doc)
    const sample = media.example ?? firstExample(media.examples)
    const value = sample !== undefined ? sample : schema === undefined ? undefined : generateExample(schema)
    if (value !== undefined || schema !== undefined) {
      const bodyValue = value === undefined ? null : value
      request.body = {
        ...request.body,
        mode: 'json',
        raw: typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue, null, 2),
        field_docs: schema === undefined ? [] : fieldDocsFromSchema(schema, bodyValue)
      } satisfies BodyModel
      setContentType(request, mediaType)
    }
  }

  const formMedia = pickMedia(
    content,
    (type) => type === 'multipart/form-data' || type === 'application/x-www-form-urlencoded'
  )
  if (formMedia) {
    const [mediaType, media] = formMedia
    const mode: 'formdata' | 'urlencoded' =
      mediaType.toLowerCase() === 'multipart/form-data' ? 'formdata' : 'urlencoded'
    const schema = asObject(resolveSchema(media.schema, doc))
    const properties = asObject(schema.properties)
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : [])
    const fields = Object.entries(properties).map(([key, rawProperty]) => {
      const property = asObject(resolveSchema(rawProperty, doc))
      const rules = schemaRules(property)
      const isFile = property.format === 'binary' || property.format === 'byte'
      return createParam({
        ...rules,
        key,
        description: String(property.description ?? ''),
        field_type: isFile ? 'file' : String(property.type ?? 'string'),
        required: rules.required ?? required.has(key),
        value: scalarText(property.example ?? property.default ?? (Array.isArray(property.enum) ? property.enum[0] : ''))
      })
    })
    request.body =
      mode === 'formdata'
        ? { ...request.body, mode: 'formdata', formdata: fields }
        : { ...request.body, mode: 'urlencoded', urlencoded: fields }
    setContentType(request, mediaType)
  }

  if (!jsonMedia && !formMedia) {
    const textMedia = pickMedia(content, (type) => type.startsWith('text/') || type === 'application/xml')
    if (textMedia) {
      const [mediaType, media] = textMedia
      const sample = media.example ?? firstExample(media.examples)
      if (sample !== undefined) {
        request.body = { ...request.body, mode: 'raw', raw: scalarText(sample), raw_language: 'text' }
        setContentType(request, mediaType)
      }
    }
  }
}

function generateExample(schema: unknown): unknown {
  return generateSchemaExample(schema as import('@shared/types').ModelSchema | null | undefined).value
}

function operationToApi(
  doc: JsonObject,
  rawPath: string,
  method: string,
  operation: JsonObject,
  pathParameters: unknown[],
  prefix: string,
  isSwagger2: boolean
): ImportApiNode {
  const request = createRequest()
  const params = new Map<string, JsonObject>()
  for (const raw of [...pathParameters, ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
    const param = asObject(resolveSchema(raw, doc))
    if (typeof param.name !== 'string' || typeof param.in !== 'string') continue
    params.set(`${param.in}:${param.name}`, param)
  }

  for (const param of params.values()) {
    const location = param.in
    if (location !== 'query' && location !== 'header' && location !== 'path' && location !== 'cookie') continue
    const schema = resolveSchema(param.schema ?? param, doc)
    const source = asObject(schema)
    const next = paramFromSchema(String(param.name), source, {
      value: param.example ?? source.example,
      description: String(param.description ?? source.description ?? ''),
      required: location === 'path' ? true : param.required === true
    })
    const slot = location === 'header' ? 'header' : location === 'path' ? 'restful' : location
    request[slot].parameter = upsertParam(
      request[slot].parameter,
      next,
      location === 'header'
    )
  }

  if (isSwagger2) {
    const bodyParam = [...params.values()].find((param) => param.in === 'body')
    if (bodyParam) {
      const schema = resolveSchema(bodyParam.schema, doc)
      const value = isObject(schema) && schema.example !== undefined ? schema.example : generateExample(schema)
      request.body = {
        ...request.body,
        mode: 'json',
        raw: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        field_docs: schema === undefined ? [] : fieldDocsFromSchema(schema, value)
      }
      const consumes = Array.isArray(doc.consumes) && typeof doc.consumes[0] === 'string' ? doc.consumes[0] : 'application/json'
      setContentType(request, consumes)
    }
    const formParams = [...params.values()].filter((param) => param.in === 'formData')
    if (formParams.length > 0) {
      const consumes = Array.isArray(doc.consumes) && typeof doc.consumes[0] === 'string' ? doc.consumes[0] : 'application/x-www-form-urlencoded'
      const mode = consumes.toLowerCase() === 'multipart/form-data' ? 'formdata' : 'urlencoded'
      const fields = formParams.map((param) => {
        const schema = resolveSchema(param.schema ?? param, doc)
        return paramFromSchema(String(param.name), schema, {
          description: String(param.description ?? ''),
          required: param.required === true
        })
      })
      request.body =
        mode === 'formdata'
          ? { ...request.body, mode: 'formdata', formdata: fields }
          : { ...request.body, mode: 'urlencoded', urlencoded: fields }
      setContentType(request, consumes)
    }
  } else {
    const body = asObject(resolveSchema(operation.requestBody, doc))
    applyBodiesFromContent(request, body.content, doc)
  }

  const response = convertResponses(doc, operation.responses, isSwagger2)
  const summary = textOf(operation.summary)
  const description = textOf(operation.description) || summary
  return {
    kind: 'api',
    name: cleanName(summary || operation.operationId, `${method.toUpperCase()} ${rawPath}`),
    description,
    method: method.toUpperCase(),
    url: joinUrl(prefix, rawPath),
    request,
    response
  }
}

function convertResponses(doc: JsonObject, responses: unknown, isSwagger2: boolean): ResponseModel {
  if (!isObject(responses)) return { example: [] }
  const produces = Array.isArray(doc.produces) && typeof doc.produces[0] === 'string' ? doc.produces[0] : 'application/json'
  for (const [code, rawResponse] of Object.entries(responses)) {
    if (!/^2\d\d$/.test(code)) continue
    const response = asObject(resolveSchema(rawResponse, doc))
    const entries: Array<[string, JsonObject]> = []
    if (isSwagger2) {
      entries.push([
        produces,
        { schema: response.schema, example: isObject(response.examples) ? response.examples[produces] : undefined }
      ])
    } else {
      const content = asObject(response.content)
      for (const [mediaType, media] of Object.entries(content)) entries.push([mediaType, asObject(media)])
    }
    const [mediaType, media] = entries[0] ?? ['application/json', {}]
    const schema = resolveSchema(media.schema, doc)
    const sample = media.example ?? firstExample(media.examples)
    const name = textOf(response.description) || '成功'
    return {
      example: [buildResponseExample(name, code, mediaType, sample === undefined && schema !== undefined ? generateExample(schema) : sample, schema)]
    }
  }
  return { example: [] }
}

function openapiNodes(doc: JsonObject, isSwagger2: boolean): { nodes: ImportNode[]; warnings: string[] } {
  const warnings: string[] = []
  const paths = asObject(doc.paths)
  const servers = Array.isArray(doc.servers) ? doc.servers : []
  let prefix = resolveServerUrl(servers[0])
  if (isSwagger2) {
    const host = typeof doc.host === 'string' ? doc.host : ''
    const basePath = typeof doc.basePath === 'string' ? doc.basePath : ''
    if (host) {
      const scheme = Array.isArray(doc.schemes) && typeof doc.schemes[0] === 'string' ? doc.schemes[0] : 'http'
      prefix = `${scheme}://${host}${basePath}`
    } else {
      prefix = basePath
    }
  }

  const tagDescriptions = new Map<string, string>()
  for (const tag of Array.isArray(doc.tags) ? doc.tags : []) {
    const item = asObject(tag)
    if (typeof item.name === 'string') tagDescriptions.set(item.name, textOf(item.description))
  }

  const grouped = new Map<string, ImportNode[]>()
  const rootApis: ImportNode[] = []
  let operationCount = 0

  for (const [rawPath, rawPathItem] of Object.entries(paths)) {
    if (!rawPathItem || typeof rawPathItem !== 'object') continue
    const pathItem = asObject(resolveSchema(rawPathItem, doc))
    const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (!isObject(operation)) continue
      operationCount += 1
      const api = operationToApi(doc, rawPath, method, operation, pathParameters, prefix, isSwagger2)
      const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string' ? operation.tags[0] : ''
      if (!tag) {
        rootApis.push(api)
        continue
      }
      if (!grouped.has(tag)) grouped.set(tag, [])
      grouped.get(tag)!.push(api)
    }
  }

  if (operationCount === 0) warnings.push('文档中没有可导入的 HTTP 操作。')
  const nodes: ImportNode[] = [
    ...[...grouped.entries()].map(([tag, children]): ImportFolderNode => ({
      kind: 'folder',
      name: cleanName(tag, '未命名分组'),
      description: tagDescriptions.get(tag) ?? '',
      children
    })),
    ...rootApis
  ]
  return { nodes, warnings }
}

// ---------------------------------------------------------------------------
// Postman Collection v2.1
// ---------------------------------------------------------------------------

function parseQueryString(query: string): Param[] {
  if (!query) return []
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf('=')
      const key = index < 0 ? pair : pair.slice(0, index)
      const value = index < 0 ? '' : pair.slice(index + 1)
      try {
        return createParam({ key: decodeURIComponent(key), value: decodeURIComponent(value) })
      } catch {
        return createParam({ key, value })
      }
    })
}

function postmanPathVariables(url: string): Param[] {
  const names = new Set<string>()
  for (const match of url.matchAll(/:([A-Za-z_][\w-]*)/g)) names.add(match[1])
  return [...names].map((name) => createParam({ key: name, value: '', required: true }))
}

function postmanUrl(raw: unknown): { url: string; query: Param[]; restful: Param[] } {
  if (typeof raw === 'string') {
    const withoutHash = raw.split('#')[0]
    const queryIndex = withoutHash.indexOf('?')
    const base = queryIndex < 0 ? withoutHash : withoutHash.slice(0, queryIndex)
    const query = queryIndex < 0 ? '' : withoutHash.slice(queryIndex + 1)
    return { url: base, query: parseQueryString(query), restful: postmanPathVariables(base) }
  }
  const source = asObject(raw)
  const rawUrl = typeof source.raw === 'string' ? source.raw : ''
  const queryIndex = rawUrl.indexOf('?')
  let url = typeof source.raw === 'string' ? rawUrl.split('#')[0].slice(0, queryIndex < 0 ? undefined : queryIndex) : ''
  if (!url) {
    const host = Array.isArray(source.host) ? source.host.join('.') : String(source.host ?? '')
    const pathParts = Array.isArray(source.path) ? source.path.join('/') : String(source.path ?? '')
    if (host) {
      const protocol = typeof source.protocol === 'string' ? `${source.protocol}://` : ''
      url = `${protocol}${host}${pathParts ? `/${pathParts.replace(/^\/+/, '')}` : ''}`
    }
  }
  const query = Array.isArray(source.query)
    ? source.query
        .map((item) => asObject(item))
        .filter((item) => typeof item.key === 'string' && item.key)
        .map((item) =>
          createParam({
            key: String(item.key),
            value: scalarText(item.value),
            description: textOf(item.description),
            is_checked: item.disabled === true ? -1 : 1
          })
        )
    : parseQueryString(rawUrl.includes('?') ? rawUrl.split('?')[1].split('#')[0] : '')
  const restful = Array.isArray(source.variable)
    ? source.variable
        .map((item) => asObject(item))
        .filter((item) => typeof item.key === 'string' && item.key)
        .map((item) =>
          createParam({
            key: String(item.key),
            value: scalarText(item.value),
            description: textOf(item.description),
            required: true
          })
        )
    : postmanPathVariables(url)
  return { url, query, restful }
}

function postmanAuthValue(auth: JsonObject, name: string): string {
  for (const group of Object.values(auth)) {
    if (!Array.isArray(group)) continue
    const found = group.find((entry) => isObject(entry) && entry.key === name)
    if (isObject(found)) return scalarText(found.value)
  }
  return ''
}

function applyPostmanAuth(request: RequestModel, raw: unknown): void {
  const auth = asObject(raw)
  const type = String(auth.type ?? '')
  if (type === 'noauth') {
    request.auth = { ...request.auth, type: 'noauth' }
  } else if (type === 'bearer') {
    request.auth = { ...request.auth, type: 'bearer', bearer: { key: postmanAuthValue(auth, 'token') } }
  } else if (type === 'basic') {
    request.auth = {
      ...request.auth,
      type: 'basic',
      basic: {
        username: postmanAuthValue(auth, 'username'),
        password: postmanAuthValue(auth, 'password')
      }
    }
  } else if (type === 'apikey') {
    const location = postmanAuthValue(auth, 'in') === 'query' ? 'query' : 'header'
    request.auth = {
      ...request.auth,
      type: 'kv',
      kv: { key: postmanAuthValue(auth, 'key'), value: postmanAuthValue(auth, 'value'), in: location }
    }
  }
}

function applyPostmanBody(request: RequestModel, raw: unknown): void {
  const body = asObject(raw)
  const mode = String(body.mode ?? '')
  if (mode === 'raw') {
    const text = scalarText(body.raw)
    const language = String(asObject(asObject(body.options).raw).language ?? '')
    let json = false
    try {
      JSON.parse(text)
      json = true
    } catch {
      json = false
    }
    request.body = json
      ? { ...request.body, mode: 'json', raw: text, field_docs: [] }
      : {
          ...request.body,
          mode: 'raw',
          raw: text,
          raw_language:
            language === 'xml' || language === 'html' || language === 'javascript'
              ? language
              : 'text'
        }
    return
  }
  if (mode === 'urlencoded' || mode === 'formdata') {
    const formMode: 'urlencoded' | 'formdata' = mode === 'formdata' ? 'formdata' : 'urlencoded'
    const items = Array.isArray(body[formMode]) ? body[formMode] : []
    const fields = items
      .map((item) => asObject(item))
      .filter((item) => typeof item.key === 'string' && item.key)
      .map((item) =>
        createParam({
          key: String(item.key),
          value: item.type === 'file' ? scalarText(item.src) : scalarText(item.value),
          description: textOf(item.description),
          field_type: item.type === 'file' ? 'file' : 'string',
          is_checked: item.disabled === true ? -1 : 1
        })
      )
    request.body = { ...request.body, mode: formMode, [formMode]: fields }
    setContentType(
      request,
      formMode === 'formdata' ? 'multipart/form-data' : 'application/x-www-form-urlencoded'
    )
    return
  }
  if (mode === 'graphql') {
    const graphql = asObject(body.graphql)
    const value = { query: scalarText(graphql.query), variables: graphql.variables ?? {} }
    request.body = { ...request.body, mode: 'json', raw: JSON.stringify(value, null, 2), field_docs: [] }
    setContentType(request, 'application/json')
    return
  }
  if (mode === 'file') {
    const file = asObject(body.file)
    request.body = {
      ...request.body,
      mode: 'binary',
      binary: { file_path: scalarText(file.src), file_name: fileBaseName(scalarText(file.src)) }
    }
  }
}

function postmanResponse(raw: unknown): ResponseModel {
  const items = Array.isArray(raw) ? raw : []
  const examples: ResponseExample[] = []
  for (const item of items) {
    const response = asObject(item)
    const code = Number.isFinite(Number(response.code)) ? Number(response.code) : 200
    if (code < 200 || code >= 300) continue
    const headers = Array.isArray(response.header)
      ? response.header
          .map((header) => asObject(header))
          .filter((header) => typeof header.key === 'string' && header.key)
      : []
    const contentType =
      headers.find((header) => String(header.key).toLowerCase() === 'content-type')?.value ??
      'application/json'
    const body = scalarText(response.body)
    const sample = body
      ? (() => {
          try {
            return JSON.parse(body)
          } catch {
            return body
          }
        })()
      : undefined
    examples.push(
      buildResponseExample(
        textOf(response.name) || String(response.status ?? '成功'),
        code,
        scalarText(contentType),
        sample,
        undefined
      )
    )
  }
  return { example: examples }
}

function postmanRequestToApi(item: JsonObject): ImportApiNode {
  const requestRaw = asObject(item.request)
  const request = createRequest()
  const parsedUrl = postmanUrl(requestRaw.url)
  request.query.parameter = parsedUrl.query
  request.restful.parameter = parsedUrl.restful

  for (const rawHeader of Array.isArray(requestRaw.header) ? requestRaw.header : []) {
    const header = asObject(rawHeader)
    if (typeof header.key !== 'string' || !header.key) continue
    request.header.parameter = upsertParam(
      request.header.parameter,
      createParam({
        key: header.key,
        value: scalarText(header.value),
        description: textOf(header.description),
        is_checked: header.disabled === true ? -1 : 1
      }),
      true
    )
  }

  applyPostmanAuth(request, requestRaw.auth)
  applyPostmanBody(request, requestRaw.body)

  return {
    kind: 'api',
    name: cleanName(item.name, '未命名接口'),
    description: textOf(item.description) || textOf(requestRaw.description),
    method: String(requestRaw.method ?? 'GET').toUpperCase(),
    url: parsedUrl.url,
    request,
    response: postmanResponse(item.response)
  }
}

function postmanNodes(items: unknown, warnings: string[]): ImportNode[] {
  const result: ImportNode[] = []
  for (const raw of Array.isArray(items) ? items : []) {
    const item = asObject(raw)
    if (Array.isArray(item.item)) {
      result.push({
        kind: 'folder',
        name: cleanName(item.name, '未命名目录'),
        description: textOf(item.description),
        children: postmanNodes(item.item, warnings)
      })
    } else if (isObject(item.request)) {
      result.push(postmanRequestToApi(item))
    } else {
      warnings.push(`跳过无法识别的条目：${cleanName(item.name, '未命名')}`)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// 文件识别与落地
// ---------------------------------------------------------------------------

function parseProjectFile(filePath: string): ParsedImport {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('导入文件不存在')
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error('请选择 JSON 文件')
  if (stat.size > MAX_FILE_SIZE) throw new Error('文件超过 50MB，无法导入')
  if (path.extname(filePath).toLowerCase() !== '.json') {
    throw new Error('仅支持 JSON 文件；YAML 请先转换为 JSON')
  }

  let doc: unknown
  try {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
    doc = JSON.parse(text)
  } catch (error) {
    throw new Error(`无法解析 JSON 文件：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isObject(doc)) throw new Error('文件内容不是对象，无法识别为 OpenAPI 或 Postman Collection')

  const info = asObject(doc.info)
  const isPostman =
    Array.isArray(doc.item) &&
    (typeof info.schema === 'string'
      ? /postman/i.test(info.schema)
      : Boolean(info.name) || Boolean(info._postman_id))
  const isOpenapi = isObject(doc.paths) && (typeof doc.openapi === 'string' || typeof doc.swagger === 'string')

  if (isPostman) {
    const warnings: string[] = []
    const nodes = postmanNodes(doc.item, warnings)
    if (!nodes.some((node) => node.kind === 'api')) warnings.push('Collection 中没有可导入的请求。')
    const title = textOf(info.name)
    return {
      format: 'postman',
      formatLabel: FORMAT_LABELS.postman,
      title,
      intro: textOf(info.description),
      nodes,
      warnings
    }
  }

  if (isOpenapi) {
    const isSwagger2 = typeof doc.swagger === 'string'
    const { nodes, warnings } = openapiNodes(doc, isSwagger2)
    return {
      format: 'openapi',
      formatLabel: isSwagger2 ? 'Swagger 2' : 'OpenAPI 3',
      title: textOf(info.title),
      intro: textOf(info.description),
      nodes,
      warnings
    }
  }

  throw new Error('无法识别文件格式，请选择 OpenAPI 3 / Swagger 2 或 Postman Collection v2.1 的 JSON 文件')
}

function countNodes(nodes: ImportNode[]): { api: number; folder: number } {
  let api = 0
  let folder = 0
  for (const node of nodes) {
    if (node.kind === 'api') api += 1
    else {
      folder += 1
      const child = countNodes(node.children)
      api += child.api
      folder += child.folder
    }
  }
  return { api, folder }
}

function writeNodes(projectId: string, parentId: string, nodes: ImportNode[], startSort: number): void {
  const project = store.getProject(projectId)
  if (!project) throw new Error('目标项目不存在')
  let sort = startSort

  for (const node of nodes) {
    sort += 100
    if (node.kind === 'folder') {
      const target = createTarget(projectId, parentId, 'folder', node.name)
      target.description = node.description
      target.sort = sort
      target.mark_id = defaultApiStatus(project)
      store.saveTarget(projectId, target)
      writeNodes(projectId, target.target_id, node.children, 0)
      continue
    }
    const target = createTarget(projectId, parentId, 'api', node.name)
    target.description = node.description
    target.method = node.method
    target.url = node.url
    target.sort = sort
    target.mark_id = defaultApiStatus(project)
    target.request = structuredClone(node.request)
    target.response = structuredClone(node.response)
    target.is_exampled = (node.response.example?.length ?? 0) > 0 ? 1 : 0
    store.saveTarget(projectId, target)
  }
}

export function inspectProjectImport(filePath: string): ProjectImportInspection {
  const parsed = parseProjectFile(filePath)
  const counts = countNodes(parsed.nodes)
  const fallback = fileBaseName(filePath)
  const suggested = cleanName(parsed.title || fallback, '导入项目')
  return {
    format: parsed.format,
    format_label: parsed.formatLabel,
    title: parsed.title,
    suggested_name: suggested,
    api_count: counts.api,
    folder_count: counts.folder,
    warnings: parsed.warnings
  }
}

export function importProjectFile(input: ProjectImportRequest): ProjectImportResult {
  if (input.mode !== 'new' && input.mode !== 'existing') throw new Error('导入方式无效')
  const parsed = parseProjectFile(input.file_path)
  const counts = countNodes(parsed.nodes)

  let project: Project
  let created = false
  if (input.mode === 'existing') {
    const projectId = String(input.project_id ?? '').trim()
    const existing = projectId ? store.getProject(projectId) : null
    if (!existing) throw new Error('请选择要导入的目标项目')
    project = existing
  } else {
    const name = cleanName(input.name || parsed.title || fileBaseName(input.file_path), '导入项目')
    project = store.createProjectWithDefaults(name)
    created = true
    if (parsed.intro) project = store.saveProject({ ...project, intro: parsed.intro })
  }

  const rootSort = store
    .listTargets(project.project_id)
    .filter((item) => item.parent_id === '0')
    .reduce((max, item) => Math.max(max, item.sort), 0)
  writeNodes(project.project_id, '0', parsed.nodes, rootSort)

  return {
    project,
    format: parsed.format,
    format_label: parsed.formatLabel,
    created_project: created,
    api_count: counts.api,
    folder_count: counts.folder,
    warnings: parsed.warnings
  }
}
