import * as store from '../../storage/store'
import { readApiDetail, withDisplayFieldDocs } from '../../business/apiRead'
import type { ApiCase, Target } from '@shared/types'
import { getDraft, createCandidate } from '../drafts'
import type { AgentToolDefinition } from '../core/registry'
import { pageItems, requiredString } from '../core/registry'
import { candidateMessage, diffFields, renderDiff } from './diff'

const CASE_CHANGE_FIELDS = ['name', 'description', 'is_enabled', 'override', 'assertions'] as const

function apiForAgent(projectId: string, targetId: string): { api: Target; draft: ReturnType<typeof getDraft> } {
  const draft = getDraft(projectId, targetId)
  const saved = store.getTarget(projectId, targetId)
  return { api: saved ? readApiDetail(projectId, targetId, draft.target).api : withDisplayFieldDocs(structuredClone(draft.target)), draft }
}
function requireBaseRevision(args: Record<string, unknown>, actual: string | null): void {
  if (!('base_revision' in args)) throw new Error('缺少参数 base_revision')
  if (args.base_revision !== actual) throw new Error('基线已变化，请重新读取接口后再修改')
}
function requireAllowedChanges(args: Record<string, unknown>, patch: Record<string, unknown>): void {
  const allowed = args.allowed_changes
  if (allowed === undefined) return
  if (!Array.isArray(allowed) || allowed.some(value => typeof value !== 'string')) throw new Error('allowed_changes 必须是字符串数组')
  const unknown = Object.keys(patch).filter(field => !allowed.includes(field))
  if (unknown.length) throw new Error(`patch 包含未获允许的字段：${unknown.join('、')}`)
}
function caseEntries(before: ApiCase, after: ApiCase) {
  return diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [...CASE_CHANGE_FIELDS])
}

export const caseTools: AgentToolDefinition[] = [
  {
    name: 'list_cases',
    description: '列出一个接口的用例目录（编号、名称、是否启用），优先读取本机草稿并返回 base_revision；不包含断言与覆盖值。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['target_id'],
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const targetId = requiredString(args, 'target_id')
      const { api, draft } = apiForAgent(projectId, targetId)
      const cases = api.cases ?? []
      const page = pageItems(cases, args.cursor, args.limit)
      return {
        output: {
          target_id: targetId, total: page.total, next_cursor: page.next_cursor, base_revision: draft.base_revision,
          items: page.items.map(item => ({ case_id: item.case_id, name: item.name, is_enabled: item.is_enabled }))
        },
        summary: `用例目录 ${page.items.length}/${page.total} 项`,
        ...(page.next_cursor ? { cursor: page.next_cursor } : {})
      }
    }
  },
  {
    name: 'get_case',
    description: '按接口与用例编号读取一个用例的完整定义（覆盖参数与断言），优先读取本机草稿。',
    parameters: {
      type: 'object',
      properties: { target_id: { type: 'string' }, case_id: { type: 'string' } },
      required: ['target_id', 'case_id'],
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const targetId = requiredString(args, 'target_id')
      const caseId = requiredString(args, 'case_id')
      const { api, draft } = apiForAgent(projectId, targetId)
      const found = (api.cases ?? []).find(item => item.case_id === caseId)
      if (!found) throw new Error('用例不存在')
      return { output: { target_id: api.target_id, case: found, base_revision: draft.base_revision }, summary: `读取用例：${found.name}` }
    }
  },
  {
    name: 'update_case_draft',
    description: '按稳定 case_id 修改一个用例并创建本机候选，不直接写草稿或正式定义。base_revision 使用 get_case/list_cases 返回值。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        case_id: { type: 'string' },
        patch: { type: 'object', description: `允许字段：${CASE_CHANGE_FIELDS.join('、')}` },
        base_revision: { type: ['string', 'null'] },
        allowed_changes: { type: 'array', items: { type: 'string', enum: [...CASE_CHANGE_FIELDS] } }
      },
      required: ['target_id', 'case_id', 'patch', 'base_revision'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    handler: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const caseId = requiredString(args, 'case_id')
      const patch = args.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch 必须是对象')
      const patchFields = Object.keys(patch)
      if (!patchFields.length || patchFields.some(field => !CASE_CHANGE_FIELDS.includes(field as typeof CASE_CHANGE_FIELDS[number]))) throw new Error('用例 patch 包含不允许的字段')
      requireAllowedChanges(args, patch as Record<string, unknown>)
      const { api, draft } = apiForAgent(context.projectId, targetId)
      requireBaseRevision(args, draft.base_revision)
      const cases = api.cases ?? []
      const index = cases.findIndex(item => item.case_id === caseId)
      if (index < 0) throw new Error('用例不存在')
      const before = structuredClone(cases[index])
      const after = { ...structuredClone(before), ...structuredClone(patch as Partial<ApiCase>) }
      const nextCases = cases.map((item, itemIndex) => itemIndex === index ? after : item)
      const candidate = createCandidate(context.projectId, context.turnId, context.stepId, draft.target, draft.base_revision, { cases: nextCases })
      const entries = caseEntries(before, after)
      return {
        output: { candidate_id: candidate.candidate_id, target_id: targetId, case_id: caseId, status: 'pending', message: candidateMessage('pending', '用例更新候选'), diff: entries, base_revision: draft.base_revision },
        summary: `已创建用例更新候选：${candidate.number}`,
        display: renderDiff(entries, candidateMessage('pending', '用例更新候选'), context.redact)
      }
    }
  },
  {
    name: 'delete_case_draft',
    description: '按稳定 case_id 删除一个用例并创建本机候选，不直接写草稿或正式定义。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        case_id: { type: 'string' },
        base_revision: { type: ['string', 'null'] }
      },
      required: ['target_id', 'case_id', 'base_revision'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    handler: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const caseId = requiredString(args, 'case_id')
      const { api, draft } = apiForAgent(context.projectId, targetId)
      requireBaseRevision(args, draft.base_revision)
      const cases = api.cases ?? []
      const found = cases.find(item => item.case_id === caseId)
      if (!found) throw new Error('用例不存在')
      const nextCases = cases.filter(item => item.case_id !== caseId)
      const candidate = createCandidate(context.projectId, context.turnId, context.stepId, draft.target, draft.base_revision, { cases: nextCases })
      const entries = [{ field: 'cases', before: { case_id: found.case_id, name: found.name }, after: '（已删除）' }]
      return {
        output: { candidate_id: candidate.candidate_id, target_id: targetId, case_id: caseId, status: 'pending', message: candidateMessage('pending', '用例删除候选'), diff: entries, base_revision: draft.base_revision },
        summary: `已创建用例删除候选：${candidate.number}`,
        display: renderDiff(entries, candidateMessage('pending', '用例删除候选'), context.redact)
      }
    }
  }
]
