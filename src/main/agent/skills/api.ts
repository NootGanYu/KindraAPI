import * as store from '../../storage/store'
import { readApiDetail, withDisplayFieldDocs } from '../../business/apiRead'
import { createTarget } from '@shared/factories'
import type { Target } from '@shared/types'
import { getDraft, createApiDraft, createCandidate, applyCandidate, listCandidates, previewCandidatePatch } from '../drafts'
import { validateAgentApiDocumentation } from '../apiDocumentation'
import type { AgentToolDefinition } from '../core/registry'
import { cursorNumber, limitNumber, optionalString, pageItems, requiredString } from '../core/registry'
import { candidateMessage, diffFields, renderDiff } from './diff'

const API_SECTIONS = ['summary', 'request', 'response', 'cases'] as const
type ApiSection = (typeof API_SECTIONS)[number]
const API_CHANGE_FIELDS = ['name', 'description', 'method', 'url', 'request', 'response', 'custom_attributes', 'mark_id', 'cases']

function catalogEntry(target: ReturnType<typeof store.listTargets>[number]): Record<string, unknown> {
  return {
    target_id: target.target_id,
    name: target.name,
    target_type: target.target_type,
    parent_id: target.parent_id,
    ...(target.method ? { method: target.method } : {})
  }
}
/** Read the local draft when one exists, otherwise the saved definition. */
function apiForAgent(projectId: string, targetId: string): { api: Target; draft: ReturnType<typeof getDraft> } {
  const draft = getDraft(projectId, targetId)
  const saved = store.getTarget(projectId, targetId)
  return { api: saved ? readApiDetail(projectId, targetId, draft.target).api : withDisplayFieldDocs(structuredClone(draft.target)), draft }
}
function chunkSection(targetId: string, section: ApiSection, value: unknown, args: Record<string, unknown>, redact?: (value: unknown) => unknown): { output: unknown; cursor?: string } {
  const text = JSON.stringify(redact ? redact(value) : value)
  const start = cursorNumber(args.cursor)
  const size = limitNumber(args.limit, 8_000, 16_000)
  if (start === 0 && text.length <= size) return { output: { target_id: targetId, section, data: value } }
  const chunk = text.slice(start, start + size)
  const next = start + chunk.length < text.length ? String(start + chunk.length) : undefined
  return {
    output: { target_id: targetId, section, chunk, total_chars: text.length, next_cursor: next ?? null },
    ...(next ? { cursor: next } : {})
  }
}
function requireBaseRevision(args: Record<string, unknown>, actual: string | null): void {
  if (!('base_revision' in args)) throw new Error('缺少参数 base_revision')
  if (args.base_revision !== actual) throw new Error('基线已变化，请重新读取接口后再修改')
}
function requireAllowedChanges(args: Record<string, unknown>, patch: Record<string, unknown>): string[] {
  const allowed = args.allowed_changes
  if (!Array.isArray(allowed) || !allowed.length || allowed.some(value => typeof value !== 'string')) throw new Error('allowed_changes 必须是非空字符串数组')
  const fields = Object.keys(patch)
  if (!fields.length) throw new Error('patch 不能为空')
  const unknown = fields.filter(field => !allowed.includes(field))
  if (unknown.length) throw new Error(`patch 包含未获允许的字段：${unknown.join('、')}`)
  return fields
}
function topLevelEntries(before: unknown, after: unknown, fields: string[]) {
  return diffFields(before as Record<string, unknown>, after as Record<string, unknown>, fields)
}

export const apiTools: AgentToolDefinition[] = [
  {
    name: 'list_apis',
    description: '列出项目接口目录。只返回编号、名称、类型、父目录和 HTTP 方法；不含 URL、描述或定义。可按父目录或名称关键词过滤并分页。',
    parameters: {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: '只列出该父目录的直接子项' },
        keyword: { type: 'string', description: '按名称模糊匹配' },
        cursor: { type: 'string', description: '上一页返回的 next_cursor' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页条数，默认 20' }
      },
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const parentId = optionalString(args.parent_id)
      const keyword = optionalString(args.keyword)?.toLowerCase()
      const targets = store.listTargets(projectId).filter(target =>
        (!parentId || target.parent_id === parentId) && (!keyword || target.name.toLowerCase().includes(keyword)))
      const page = pageItems(targets, args.cursor, args.limit)
      return { output: { ...page, items: page.items.map(catalogEntry) }, summary: `接口目录 ${page.items.length}/${page.total} 项`, ...(page.next_cursor ? { cursor: page.next_cursor } : {}) }
    }
  },
  {
    name: 'get_api',
    description: '按需读取一个接口的指定部分：summary（名称、URL、描述、草稿基线与来源）、request（请求定义）、response（响应定义）或 cases（用例目录）。优先读取本机草稿。request/response 过长时返回 chunk 与 next_cursor。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        section: { type: 'string', enum: [...API_SECTIONS], description: '默认 summary' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['target_id'],
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId, redact }) => {
      const targetId = requiredString(args, 'target_id')
      const section = (optionalString(args.section) ?? 'summary') as ApiSection
      if (!API_SECTIONS.includes(section)) throw new Error('未知接口分段')
      const { api, draft } = apiForAgent(projectId, targetId)
      if (section === 'summary') {
        return {
          output: {
            target_id: api.target_id, target_type: api.target_type, parent_id: api.parent_id,
            name: api.name, method: api.method, url: api.url, description: api.description,
            protocol: api.protocol, tags: api.tags, status: api.status,
            source: draft.new_object ? 'new_draft' : draft.agent_owned ? 'draft' : 'saved',
            base_revision: draft.base_revision, draft_owned: draft.agent_owned === true,
            case_count: api.cases?.length ?? 0,
            has_request: !!api.request, has_response: !!api.response
          },
          summary: `读取接口摘要：${api.name}`
        }
      }
      if (section === 'cases') {
        const page = pageItems(api.cases ?? [], args.cursor, args.limit)
        return {
          output: {
            target_id: api.target_id, section, total: page.total, next_cursor: page.next_cursor,
            base_revision: draft.base_revision,
            items: page.items.map(item => ({ case_id: item.case_id, name: item.name, is_enabled: item.is_enabled }))
          },
          summary: `读取用例目录 ${page.items.length}/${page.total} 项`,
          ...(page.next_cursor ? { cursor: page.next_cursor } : {})
        }
      }
      const value = section === 'request' ? api.request : api.response
      return { ...chunkSection(api.target_id, section, value ?? null, args, redact as ((value: unknown) => unknown) | undefined), summary: `读取接口 ${section}：${api.name}` }
    }
  },
  {
    name: 'create_api_draft',
    description: '在本机创建接口草稿（不保存正式定义）。必须提供名称、完整 http(s) URL 与接口说明 description；文档门禁不通过时不会创建。',
    parameters: {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: '目标目录编号，根目录为 0' },
        name: { type: 'string' },
        method: { type: 'string' },
        url: { type: 'string' },
        description: { type: 'string', description: '接口用途、调用方式、参数含义、状态口径与错误码' },
        request: { type: 'object', description: '可选，完整 RequestModel；省略时使用空请求模板' },
        response: { type: 'object', description: '可选，完整 ResponseModel' }
      },
      required: ['name', 'url', 'description'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    handler: (args, context) => {
      const parentId = optionalString(args.parent_id) ?? '0'
      const name = requiredString(args, 'name')
      const url = requiredString(args, 'url')
      const description = requiredString(args, 'description')
      const base = createTarget(context.projectId, parentId, 'api', name)
      const patch: Partial<Target> = { name, method: optionalString(args.method)?.toUpperCase() ?? 'GET', url, description }
      if (args.request && typeof args.request === 'object') patch.request = args.request as Target['request']
      if (args.response && typeof args.response === 'object') patch.response = args.response as Target['response']
      const proposal = previewCandidatePatch(base, patch)
      validateAgentApiDocumentation(proposal, null, [patch])
      const candidate = createApiDraft(context.projectId, context.turnId, context.stepId, base, patch)
      const entries = topLevelEntries(base, candidate.proposal, ['name', 'method', 'url', 'description'])
      return {
        output: { candidate_id: candidate.candidate_id, target_id: base.target_id, status: 'applied', message: candidateMessage('applied', '接口草稿'), diff: entries, base_revision: null },
        summary: `已创建接口草稿：${name}`,
        display: renderDiff(entries, candidateMessage('applied', '接口草稿'), context.redact)
      }
    }
  },
  {
    name: 'update_api_draft',
    description: '为已有接口创建本机更新候选，不直接修改草稿或正式定义。base_revision 使用 get_api summary 返回的值；allowed_changes 必须列出 patch 的全部字段。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        patch: { type: 'object', description: `字段级修改，允许字段：${API_CHANGE_FIELDS.join('、')}` },
        base_revision: { type: ['string', 'null'], description: 'get_api summary 返回的 base_revision' },
        allowed_changes: { type: 'array', items: { type: 'string', enum: API_CHANGE_FIELDS }, minItems: 1 }
      },
      required: ['target_id', 'patch', 'base_revision', 'allowed_changes'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    handler: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const patch = args.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch 必须是对象')
      const draft = getDraft(context.projectId, targetId)
      requireBaseRevision(args, draft.base_revision)
      const fields = requireAllowedChanges(args, patch as Record<string, unknown>)
      const previous = store.getTarget(context.projectId, targetId)
      const proposal = previewCandidatePatch(draft.target, patch as Partial<Target>)
      validateAgentApiDocumentation(proposal, previous, [patch as Partial<Target>])
      const candidate = createCandidate(context.projectId, context.turnId, context.stepId, draft.target, draft.base_revision, patch as Partial<Target>)
      const entries = topLevelEntries(draft.target, proposal, fields)
      return {
        output: { candidate_id: candidate.candidate_id, target_id: targetId, status: 'pending', message: candidateMessage('pending', '接口更新候选'), diff: entries, base_revision: draft.base_revision },
        summary: `已创建接口更新候选：${candidate.number}`,
        display: renderDiff(entries, candidateMessage('pending', '接口更新候选'), context.redact)
      }
    }
  },
  {
    name: 'apply_api_candidate',
    description: '把本轮创建的接口/用例候选应用到本机草稿，不保存正式定义。候选与正式定义或草稿冲突时返回错误且不覆盖。',
    parameters: { type: 'object', properties: { candidate_id: { type: 'string' } }, required: ['candidate_id'], additionalProperties: false },
    risk: 'local-write',
    readOnly: false,
    handler: (args, context) => {
      const candidateId = requiredString(args, 'candidate_id')
      const candidate = listCandidates(context.projectId).find(item => item.candidate_id === candidateId)
      if (!candidate) throw new Error('候选不存在')
      if (candidate.plan_id !== context.turnId) throw new Error('只能应用本轮创建的候选')
      const result = applyCandidate(context.projectId, candidateId)
      if (result.status === 'conflict') throw new Error(result.error ?? '候选与当前定义冲突，未覆盖')
      if (result.status !== 'applied') throw new Error('候选未应用')
      const before = result.application?.before as unknown as Record<string, unknown> | undefined
      const after = result.application?.after as unknown as Record<string, unknown> | undefined
      const fields = Object.keys(result.patch ?? {})
      const entries = before && after ? topLevelEntries(before, after, fields) : []
      return {
        output: { candidate_id: candidateId, target_id: candidate.target_id, status: 'applied', message: candidateMessage('applied', '接口候选'), diff: entries },
        summary: `已应用接口候选：${candidate.number}`,
        display: renderDiff(entries, candidateMessage('applied', '接口候选'), context.redact)
      }
    }
  },
  {
    name: 'list_runs',
    description: '列出接口发送历史摘要（编号、接口、方法、状态、耗时），可按接口过滤并分页。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const targetId = optionalString(args.target_id)
      const records = store.listSendRecords(projectId).filter(record => !targetId || record.target_id === targetId)
      const page = pageItems(records, args.cursor, args.limit)
      return { output: page, summary: `发送记录 ${page.items.length}/${page.total} 条`, ...(page.next_cursor ? { cursor: page.next_cursor } : {}) }
    }
  },
  {
    name: 'get_run',
    description: '按编号读取一次发送记录的完整请求、响应与断言结果。',
    parameters: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'], additionalProperties: false },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const runId = requiredString(args, 'run_id')
      const record = store.getSendRecord(projectId, runId)
      if (!record) throw new Error('发送记录不存在')
      return { output: record, summary: `读取发送记录 ${record.target_name}` }
    }
  }
]
