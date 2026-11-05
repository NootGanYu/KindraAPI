import { createHash, randomUUID } from 'node:crypto'
import * as store from '../../storage/store'
import { createFlow } from '@shared/factories'
import { flowSignature } from '@shared/flowSync'
import type { Flow, FlowEvent } from '@shared/types'
import { createFlowCandidate, applyFlowCandidate, createFlowDraft, listFlowCandidates, readFlowDraftIfPresent } from '../flowDrafts'
import { fillStablePatchRows } from '../patchValidation'
import type { AgentToolDefinition } from '../core/registry'
import { optionalString, pageItems, requiredString } from '../core/registry'
import { candidateMessage, diffFields, renderDiff } from './diff'

const FLOW_CHANGE_FIELDS = ['name', 'description', 'env_id', 'events']

/** Flow signatures can contain secrets; expose an opaque hash to the model instead. */
function revisionToken(revision: string | null): string | null {
  return revision ? createHash('sha256').update(revision).digest('hex') : null
}
function requireBaseRevision(args: Record<string, unknown>, actual: string | null): void {
  if (!('base_revision' in args)) throw new Error('缺少参数 base_revision')
  if (args.base_revision !== revisionToken(actual)) throw new Error('基线已变化，请重新读取 Flow 后再修改')
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
/** New events receive stable ids once; update patches must keep the original ids. */
function normalizeNewEvents(input: unknown): FlowEvent[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) throw new Error('events 必须是数组')
  const walk = (events: unknown[]): FlowEvent[] => events.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Flow 事件结构无效')
    const event = structuredClone(value) as FlowEvent
    event.event_id = typeof event.event_id === 'string' && /^[\w-]{1,100}$/.test(event.event_id) ? event.event_id : randomUUID()
    if (event.children !== undefined) event.children = walk(event.children)
    return event
  })
  return walk(input)
}
function flowForAgent(projectId: string, flowId: string): { flow: Flow; revision: string | null; newObject: boolean; source: 'draft' | 'saved' } {
  const draft = readFlowDraftIfPresent(projectId, flowId)
  if (draft) return { flow: draft.flow, revision: draft.base_revision, newObject: draft.new_object === true, source: 'draft' }
  const saved = store.getFlow(projectId, flowId)
  if (!saved) throw new Error('Flow 不存在')
  return { flow: saved, revision: flowSignature(saved), newObject: false, source: 'saved' }
}
function flowEntries(before: Flow, after: Flow, fields: string[]) {
  return diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, fields)
}

export const flowTools: AgentToolDefinition[] = [
  {
    name: 'list_flows',
    description: '列出项目 Flow 目录，只返回编号与名称，分页返回；不包含事件定义。',
    parameters: {
      type: 'object',
      properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const flows = store.listFlows(projectId).map(flow => ({ flow_id: flow.flow_id, name: flow.name }))
      const page = pageItems(flows, args.cursor, args.limit)
      return { output: page, summary: `Flow 目录 ${page.items.length}/${page.total} 项`, ...(page.next_cursor ? { cursor: page.next_cursor } : {}) }
    }
  },
  {
    name: 'get_flow',
    description: '按需读取 Flow 的元信息、base_revision 与事件定义。优先读取本机草稿；事件按 cursor/limit 分页。',
    parameters: {
      type: 'object',
      properties: {
        flow_id: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['flow_id'],
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const flowId = requiredString(args, 'flow_id')
      const current = flowForAgent(projectId, flowId)
      const page = pageItems(current.flow.events ?? [], args.cursor, args.limit)
      return {
        output: {
          flow_id: current.flow.flow_id, name: current.flow.name, description: current.flow.description, env_id: current.flow.env_id,
          source: current.source, base_revision: revisionToken(current.revision), new_object: current.newObject,
          total_events: page.total, events: page.items, next_cursor: page.next_cursor
        },
        summary: `读取 Flow：${current.flow.name}（事件 ${page.items.length}/${page.total}）`,
        ...(page.next_cursor ? { cursor: page.next_cursor } : {})
      }
    }
  },
  {
    name: 'create_flow_draft',
    description: '创建一个新的本机 Flow 草稿候选，不写入正式定义。事件会自动补稳定 event_id；之后用 apply_flow_candidate 应用。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        env_id: { type: 'string' },
        events: { type: 'array', items: { type: 'object' } }
      },
      required: ['name'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    handler: (args, context) => {
      const name = requiredString(args, 'name')
      const flow = createFlow(context.projectId, name, optionalString(args.env_id) ?? store.listEnvironments(context.projectId)[0]?.env_id ?? '')
      flow.description = optionalString(args.description) ?? ''
      const events = normalizeNewEvents(args.events)
      const patch: Partial<Flow> = { name, description: flow.description, env_id: flow.env_id, events }
      const candidate = createFlowDraft(context.projectId, context.turnId, context.stepId, flow, patch)
      const entries = flowEntries(flow, { ...flow, ...patch }, ['name', 'description', 'env_id', 'events'])
      return {
        output: { candidate_id: candidate.candidate_id, flow_id: flow.flow_id, status: 'pending', message: candidateMessage('pending', 'Flow 创建候选'), diff: entries, base_revision: null },
        summary: `已创建 Flow 候选：${name}`,
        display: renderDiff(entries, candidateMessage('pending', 'Flow 创建候选'), context.redact)
      }
    }
  },
  {
    name: 'update_flow_draft',
    description: '为已有 Flow 创建本机更新候选，不直接写草稿或正式定义。更新 events 时必须保留原 event_id；base_revision 使用 get_flow 返回值。',
    parameters: {
      type: 'object',
      properties: {
        flow_id: { type: 'string' },
        patch: { type: 'object', description: `允许字段：${FLOW_CHANGE_FIELDS.join('、')}` },
        base_revision: { type: ['string', 'null'] },
        allowed_changes: { type: 'array', items: { type: 'string', enum: FLOW_CHANGE_FIELDS }, minItems: 1 }
      },
      required: ['flow_id', 'patch', 'base_revision', 'allowed_changes'],
      additionalProperties: false
    },
    risk: 'local-write',
    readOnly: false,
    handler: (args, context) => {
      const flowId = requiredString(args, 'flow_id')
      const patch = args.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch 必须是对象')
      const fields = requireAllowedChanges(args, patch as Record<string, unknown>)
      const current = flowForAgent(context.projectId, flowId)
      requireBaseRevision(args, current.revision)
      // Fill partial stable-id rows so the stored proposal keeps every required event field.
      const prepared = fillStablePatchRows(current.flow, patch) as Partial<Flow>
      const candidate = createFlowCandidate(context.projectId, context.turnId, context.stepId, current.flow, current.revision, prepared)
      const entries = flowEntries(current.flow, candidate.proposal, fields)
      return {
        output: { candidate_id: candidate.candidate_id, flow_id: flowId, status: 'pending', message: candidateMessage('pending', 'Flow 更新候选'), diff: entries, base_revision: revisionToken(current.revision) },
        summary: `已创建 Flow 更新候选：${candidate.number}`,
        display: renderDiff(entries, candidateMessage('pending', 'Flow 更新候选'), context.redact)
      }
    }
  },
  {
    name: 'apply_flow_candidate',
    description: '把本轮创建的 Flow 候选应用到本机草稿，不保存正式定义。冲突时返回错误且不覆盖。',
    parameters: { type: 'object', properties: { candidate_id: { type: 'string' } }, required: ['candidate_id'], additionalProperties: false },
    risk: 'local-write',
    readOnly: false,
    handler: (args, context) => {
      const candidateId = requiredString(args, 'candidate_id')
      const candidate = listFlowCandidates(context.projectId).find(item => item.candidate_id === candidateId)
      if (!candidate) throw new Error('Flow 候选不存在')
      if (candidate.plan_id !== context.turnId) throw new Error('只能应用本轮创建的候选')
      const result = applyFlowCandidate(context.projectId, candidateId)
      if (result.status === 'conflict') throw new Error(result.error ?? 'Flow 正式定义已变化，候选未覆盖')
      if (result.status !== 'applied') throw new Error('Flow 候选未应用')
      const before = result.application?.before
      const after = result.application?.after
      const entries = before && after ? flowEntries(before, after, ['name', 'description', 'env_id']) : []
      return {
        output: { candidate_id: candidateId, flow_id: candidate.flow_id, status: 'applied', message: candidateMessage('applied', 'Flow 候选'), diff: entries },
        summary: `已应用 Flow 候选：${candidate.number}`,
        display: renderDiff(entries, candidateMessage('applied', 'Flow 候选'), context.redact)
      }
    }
  }
]
