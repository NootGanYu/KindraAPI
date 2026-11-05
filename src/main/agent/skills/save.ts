import { randomUUID } from 'node:crypto'
import type { ResponseExample } from '@shared/types'
import * as store from '../../storage/store'
import { getDraft, saveApprovedApi, createCandidate, listCandidates, stageApiDeletionRecovery } from '../drafts'
import { getFlowDraft, saveApprovedFlow, listFlowCandidates, stageFlowDeletionRecovery } from '../flowDrafts'
import type { AgentToolContext, AgentToolDefinition, AgentToolResult } from '../core/registry'
import { optionalString, requiredString } from '../core/registry'

function requireConfirm(args: Record<string, unknown>): void {
  if (args.confirm !== true) throw new Error('高风险删除需要 confirm: true 明确确认')
}
function describeLines(context: AgentToolContext, lines: string[]): string {
  const safe = context.redact ? context.redact(lines) : lines
  return safe.join('\n')
}
function currentTurnCandidates(projectId: string, targetId: string, turnId: string): string[] {
  return listCandidates(projectId, targetId).filter(item => item.plan_id === turnId && item.status === 'applied').map(item => item.candidate_id)
}
function currentTurnFlowCandidates(projectId: string, flowId: string, turnId: string): string[] {
  return listFlowCandidates(projectId, flowId).filter(item => item.plan_id === turnId && item.status === 'applied').map(item => item.candidate_id)
}
function savedDisplay(context: AgentToolContext, kind: string, name: string, version: number, revision: string): string {
  return describeLines(context, [`${kind}正式保存成功：${name}`, '风险：不可逆正式写入。', `版本：v${version}`, `revision：${revision.slice(0, 16)}…`, '正式定义已更新；其他未采纳草稿保持不变。'])
}

export const saveTools: AgentToolDefinition[] = [
  {
    name: 'save_api',
    description: '正式保存当前接口草稿（含本轮已采纳候选），会执行文档门禁与 revision 校验。不可逆地写入正式定义；必须审批。',
    parameters: { type: 'object', properties: { target_id: { type: 'string' } }, required: ['target_id'], additionalProperties: false },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const draft = getDraft(context.projectId, targetId)
      const candidates = currentTurnCandidates(context.projectId, targetId, context.turnId)
      return {
        summary: `正式保存接口：${draft.target.name}`,
        display: describeLines(context, [
          '不可逆操作：将当前草稿写入正式定义并生成版本。',
          `接口：${draft.target.name}`,
          `来源：${draft.new_object ? '新建草稿（尚未正式存在）' : '已有正式定义'}`,
          `本轮已采纳候选：${candidates.length} 个`,
          '保存前会重新检查文档完整性、候选冲突与 revision。'
        ])
      }
    },
    handler: (args, context) => saveApiHandler(requiredString(args, 'target_id'), context)
  },
  {
    name: 'save_flow',
    description: '正式保存当前 Flow 草稿（含本轮已采纳候选），会校验 revision 与冲突。不可逆地写入正式 Flow；必须审批。',
    parameters: { type: 'object', properties: { flow_id: { type: 'string' } }, required: ['flow_id'], additionalProperties: false },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      const flowId = requiredString(args, 'flow_id')
      const draft = getFlowDraft(context.projectId, flowId)
      const candidates = currentTurnFlowCandidates(context.projectId, flowId, context.turnId)
      return {
        summary: `正式保存 Flow：${draft.flow.name}`,
        display: describeLines(context, [
          '不可逆操作：将当前 Flow 草稿写入正式定义并生成版本。',
          `Flow：${draft.flow.name}`,
          `来源：${draft.new_object ? '新建草稿（尚未正式存在）' : '已有正式 Flow'}`,
          `本轮已采纳候选：${candidates.length} 个`,
          '保存前会重新检查候选冲突与 revision。'
        ])
      }
    },
    handler: (args, context) => saveFlowHandler(requiredString(args, 'flow_id'), context)
  },
  {
    name: 'save_api_response',
    description: '把本轮 execute_api 捕获的成功 2xx 响应保存为正式响应示例。只保存该响应；不保存其他脏草稿。必须审批。',
    parameters: {
      type: 'object',
      properties: { target_id: { type: 'string' }, run_id: { type: 'string' } },
      required: ['target_id'],
      additionalProperties: false
    },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const captured = capturedResponse(args, context, targetId)
      return {
        summary: `保存接口响应示例：${captured.target_id}`,
        display: describeLines(context, [
          '不可逆操作：保存本轮成功执行捕获的响应示例。',
          `HTTP：${captured.response.code}`,
          `run_id：${captured.run_id}`,
          '只写入该响应示例；其他未采纳草稿不会保存。'
        ])
      }
    },
    handler: (args, context) => saveApiResponseHandler(requiredString(args, 'target_id'), optionalString(args.run_id), context)
  },
  {
    name: 'delete_api',
    description: '不可逆删除一个正式接口（含子目录），并保留本机墓碑供恢复。必须 confirm: true 且审批。',
    parameters: {
      type: 'object',
      properties: { target_id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['target_id', 'confirm'],
      additionalProperties: false
    },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      requireConfirm(args)
      const targetId = requiredString(args, 'target_id')
      const target = store.getTarget(context.projectId, targetId)
      if (!target) throw new Error('接口不存在或已删除')
      if (target.target_type !== 'api') throw new Error('delete_api 只能删除接口，不能直接删除目录')
      return {
        summary: `不可逆删除接口：${target.name}`,
        display: describeLines(context, [
          '不可逆操作：删除正式接口定义。',
          `接口：${target.name}（${target.method ?? ''}）`,
          '本机墓碑会保留，可在恢复入口审阅。'
        ])
      }
    },
    handler: (args, context) => deleteApiHandler(args, context)
  },
  {
    name: 'delete_flow',
    description: '不可逆删除一个正式 Flow，并保留本机墓碑供恢复。必须 confirm: true 且审批。',
    parameters: {
      type: 'object',
      properties: { flow_id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['flow_id', 'confirm'],
      additionalProperties: false
    },
    risk: 'irreversible',
    readOnly: false,
    describeForApproval: (args, context) => {
      requireConfirm(args)
      const flowId = requiredString(args, 'flow_id')
      const flow = store.getFlow(context.projectId, flowId)
      if (!flow) throw new Error('Flow 不存在或已删除')
      return {
        summary: `不可逆删除 Flow：${flow.name}`,
        display: describeLines(context, [
          '不可逆操作：删除正式 Flow。',
          `Flow：${flow.name}`,
          '本机墓碑会保留，可在恢复入口审阅。'
        ])
      }
    },
    handler: (args, context) => deleteFlowHandler(args, context)
  }
]

async function saveApiHandler(targetId: string, context: AgentToolContext): Promise<AgentToolResult> {
  const draft = getDraft(context.projectId, targetId)
  const candidateIds = currentTurnCandidates(context.projectId, targetId, context.turnId)
  const result = await saveApprovedApi(context.projectId, context.turnId, targetId, draft.base_revision, candidateIds)
  return {
    output: { status: 'saved', target_id: targetId, version: result.saved_version.version, revision: result.saved_version.revision, candidate_ids: result.candidate_ids },
    summary: `接口已正式保存 v${result.saved_version.version}`,
    display: savedDisplay(context, '接口', draft.target.name, result.saved_version.version, result.saved_version.revision)
  }
}
function saveFlowHandler(flowId: string, context: AgentToolContext): AgentToolResult {
  const draft = getFlowDraft(context.projectId, flowId)
  const candidateIds = currentTurnFlowCandidates(context.projectId, flowId, context.turnId)
  const result = saveApprovedFlow(context.projectId, context.turnId, flowId, draft.base_revision, candidateIds)
  return {
    output: { status: 'saved', flow_id: flowId, version: result.saved_version.version, revision: result.saved_version.revision, candidate_ids: result.candidate_ids },
    summary: `Flow 已正式保存 v${result.saved_version.version}`,
    display: savedDisplay(context, 'Flow', draft.flow.name, result.saved_version.version, result.saved_version.revision)
  }
}
function capturedResponse(args: Record<string, unknown>, context: AgentToolContext, targetId: string) {
  const captured = context.state.responses.get(targetId)
  if (!captured) throw new Error('本轮没有可保存的成功 2xx 响应；请先执行接口并显式启用 save_response')
  const runId = optionalString(args.run_id)
  if (runId && runId !== captured.run_id) throw new Error('指定的执行记录不是本轮捕获的成功响应')
  return captured
}
async function saveApiResponseHandler(targetId: string, runId: string | undefined, context: AgentToolContext): Promise<AgentToolResult> {
  const captured = capturedResponse(runId ? { run_id: runId } : {}, context, targetId)
  const saved = store.readTargetSnapshot(context.projectId, targetId)
  if (!saved.target) throw new Error('接口尚未正式存在，不能只保存响应示例')
  if (captured.response.code < 200 || captured.response.code >= 300) throw new Error('只有成功 2xx 响应可以保存')
  const examples: ResponseExample[] = structuredClone(saved.target.response?.example ?? [])
  const existing = examples.find(item => String(item.expect?.code ?? 200) === String(captured.response.code) && !item.expect?.model_id)
  const sample: ResponseExample = {
    ...(existing ?? { example_id: randomUUID() }),
    expect: { ...existing?.expect, name: existing?.expect?.name ?? '实时响应', code: captured.response.code, content_type: captured.response.mime?.mime },
    raw: captured.response.body
  }
  if (existing) examples[examples.indexOf(existing)] = sample
  else examples.push(sample)
  const patch = { response: { ...saved.target.response, example: examples } }
  const candidate = createCandidate(context.projectId, context.turnId, context.stepId, saved.target, saved.revision, patch, true)
  const result = await saveApprovedApi(context.projectId, context.turnId, targetId, saved.revision, [candidate.candidate_id], sample.example_id)
  context.state.responses.delete(targetId)
  return {
    output: { status: 'saved', target_id: targetId, example_id: sample.example_id, status_code: captured.response.code, run_id: captured.run_id, version: result.saved_version.version, revision: result.saved_version.revision },
    summary: `接口响应已保存 · HTTP ${captured.response.code}`,
    display: describeLines(context, ['响应示例已正式保存。', `HTTP：${captured.response.code}`, `版本：v${result.saved_version.version}`, '仅保存该响应示例，其他草稿未写入。'])
  }
}
function deleteApiHandler(args: Record<string, unknown>, context: AgentToolContext): AgentToolResult {
  requireConfirm(args)
  const targetId = requiredString(args, 'target_id')
  const target = store.getTarget(context.projectId, targetId)
  if (!target) throw new Error('接口不存在或已删除')
  if (target.target_type !== 'api') throw new Error('delete_api 只能删除接口，不能直接删除目录')
  stageApiDeletionRecovery(context.projectId, targetId)
  store.deleteTarget(context.projectId, targetId)
  const tombstone = store.getDeletedObject(context.projectId, 'api', targetId)
  return {
    output: { status: 'deleted', target_id: targetId, deletion_id: tombstone?.deletion_id },
    summary: `接口已删除：${target.name}`,
    display: describeLines(context, ['接口已删除。', `接口：${target.name}`, `墓碑：${tombstone?.deletion_id ?? '无'}`, '可在本机恢复入口审阅恢复。'])
  }
}
function deleteFlowHandler(args: Record<string, unknown>, context: AgentToolContext): AgentToolResult {
  requireConfirm(args)
  const flowId = requiredString(args, 'flow_id')
  const flow = store.getFlow(context.projectId, flowId)
  if (!flow) throw new Error('Flow 不存在或已删除')
  stageFlowDeletionRecovery(context.projectId, flowId)
  store.deleteFlow(context.projectId, flowId)
  const tombstone = store.getDeletedObject(context.projectId, 'flow', flowId)
  return {
    output: { status: 'deleted', flow_id: flowId, deletion_id: tombstone?.deletion_id },
    summary: `Flow 已删除：${flow.name}`,
    display: describeLines(context, ['Flow 已删除。', `Flow：${flow.name}`, `墓碑：${tombstone?.deletion_id ?? '无'}`, '可在本机恢复入口审阅恢复。'])
  }
}
