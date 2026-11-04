import { onDeletedObject } from '../storage/deletedObjects'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Flow, FlowEvent } from '@shared/types'
import type { AgentFlowCandidate, AgentFlowDraft, AgentFlowDraftEvent } from '@shared/agentFlowDraft'
import type { AgentConflictChoice } from '@shared/agentDraft'
import { flowDefinition, flowSignature } from '@shared/flowSync'
import * as store from '../storage/store'
import { agentRoot, readLocal, writeLocal } from './store'
import { nextCandidateNumber } from './candidateSequence'
import { mergeDefinitions } from './merge'
const listeners = new Set<(event: AgentFlowDraftEvent) => void>()
export function onFlowDraftEvent(listener: (event: AgentFlowDraftEvent) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
onDeletedObject((pid, kind, id) => { if (kind === 'flow') emit({ project_id: pid, flow_id: id }) })
function emit(event: AgentFlowDraftEvent): void { for (const listener of listeners) listener(structuredClone(event)) }
function directory(pid: string, folder: string): string {
  if (!/^[\w-]{1,100}$/.test(pid) || !store.getProject(pid)) throw new Error('项目不存在')
  return path.join(agentRoot(), 'projects', pid, folder)
}
function file(pid: string, folder: string, id: string): string {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error('Flow 编号无效')
  return path.join(directory(pid, folder), `${id}.json`)
}
export function getFlowDraft(pid: string, id: string): AgentFlowDraft {
  const draft = readLocal<AgentFlowDraft | null>(file(pid, 'flow-drafts', id), null)
  if (draft) return structuredClone(draft)
  const flow = store.getFlow(pid, id)
  if (!flow) throw new Error('Flow 不存在')
  const opened: AgentFlowDraft = { project_id: pid, flow_id: id, flow, base_revision: flowSignature(flow), agent_owned: false, updated_at: new Date().toISOString() }
  // The editor baseline belongs to the first read, not a later first keystroke.
  persist(opened)
  return opened
}
export function listAgentFlowDrafts(pid: string): AgentFlowDraft[] {
  const dir = directory(pid, 'flow-drafts')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => getFlowDraft(pid, n.slice(0, -5))).filter(d => d.agent_owned) : []
}
function persist(draft: AgentFlowDraft): void {
  draft.updated_at = new Date().toISOString()
  writeLocal(file(draft.project_id, 'flow-drafts', draft.flow_id), draft)
}
export function syncFlowEditorDraft(pid: string, flow: Flow): AgentFlowDraft {
  if (flow.project_id !== pid) throw new Error('草稿不属于所选项目')
  validateFlowPatch({ name: flow.name, description: flow.description, env_id: flow.env_id, events: flow.events })
  const draft = getFlowDraft(pid, flow.flow_id)
  draft.flow = structuredClone(flow)
  const saved = store.getFlow(pid, flow.flow_id)
  if (saved && flowSignature(saved) === flowSignature(flow) && !listFlowCandidates(pid, flow.flow_id).some(c => c.status === 'conflict')) {
    draft.agent_owned = false; draft.base_revision = flowSignature(saved)
  }
  persist(draft)
  return draft
}
export function listFlowCandidates(pid: string, flowId?: string): AgentFlowCandidate[] {
  const dir = directory(pid, 'flow-candidates')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => readCandidate(pid, n.slice(0, -5))).filter(c => !flowId || c.flow_id === flowId).sort((a,b) => Number(b.number.slice(1)) - Number(a.number.slice(1))) : []
}
function readCandidate(pid: string, id: string): AgentFlowCandidate {
  const candidate = readLocal<AgentFlowCandidate | null>(file(pid, 'flow-candidates', id), null)
  if (!candidate) throw new Error('Flow 候选不存在')
  return { ...candidate, ...readLocal(file(pid, 'flow-candidate-reviews', id), {}) }
}
function review(candidate: AgentFlowCandidate, status: AgentFlowCandidate['status'], error?: string, merge = candidate.merge, application = candidate.application): AgentFlowCandidate {
  writeLocal(file(candidate.project_id, 'flow-candidate-reviews', candidate.candidate_id), { ...readLocal(file(candidate.project_id, 'flow-candidate-reviews', candidate.candidate_id), {}), flow_id: candidate.flow_id, status, error, merge, application })
  emit({ project_id: candidate.project_id, flow_id: candidate.flow_id })
  return { ...candidate, status, error, merge, application }
}
export function validateFlowPatch(patch: unknown): asserts patch is Partial<Flow> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(k => !['name','description','env_id','events'].includes(k))) throw new Error('Flow 提案字段无效')
  const p = patch as Record<string, unknown>
  for (const key of ['name','description','env_id']) if (key in p && typeof p[key] !== 'string') throw new Error('Flow 文本字段无效')
  if (/\[已隐藏\]|\[REDACTED\]/i.test(JSON.stringify(patch))) throw new Error('提案包含脱敏占位符')
  const ids = new Set<string>()
  const walk = (events: unknown, depth = 0): void => {
    if (!Array.isArray(events) || depth > 32) throw new Error('Flow 事件列表无效')
    for (const event of events as FlowEvent[]) {
      if (!event || typeof event !== 'object' || typeof event.event_id !== 'string' || !/^[\w-]{1,100}$/.test(event.event_id) || ids.has(event.event_id)) throw new Error('Flow 事件稳定 ID 缺失或重复')
      ids.add(event.event_id)
      if (!['api','request','script','assert','if','wait','begin','loop'].includes(event.type) || typeof event.name !== 'string' || typeof event.enabled !== 'boolean') throw new Error('Flow 事件字段无效')
      for (const key of Object.keys(event)) if (!['event_id','type','name','enabled','target_id','input','method','url','headers','body','script','assertions','condition','wait_ms','loop_count','children'].includes(key)) throw new Error('Flow 事件包含未知字段')
      for (const key of ['target_id','method','url','body','script','condition'] as const) if (event[key] !== undefined && typeof event[key] !== 'string') throw new Error('Flow 事件文本字段无效')
      for (const key of ['wait_ms','loop_count'] as const) if (event[key] !== undefined && (!Number.isFinite(event[key]) || event[key]! < 0)) throw new Error('Flow 事件数值字段无效')
      if (event.headers !== undefined && (!Array.isArray(event.headers) || event.headers.some(h => !h || typeof h.key !== 'string' || typeof h.value !== 'string'))) throw new Error('Flow 请求头无效')
      if (event.input !== undefined) {
        if (!event.input || typeof event.input !== 'object' || Array.isArray(event.input)) throw new Error('Flow 请求输入无效')
        for (const [key, value] of Object.entries(event.input)) {
          if (key === 'body') { if (typeof value !== 'string') throw new Error('Flow 请求体无效'); continue }
          if (!['query','path','headers','cookies'].includes(key) || !value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([name, entry]) => ['__proto__','constructor','prototype'].includes(name) || typeof entry !== 'string')) throw new Error('Flow 请求参数无效')
        }
      }
      if (event.assertions !== undefined) {
        const assertionIds = new Set<string>()
        if (!Array.isArray(event.assertions)) throw new Error('Flow 断言列表无效')
        for (const assertion of event.assertions) {
          if (!assertion || typeof assertion.assert_id !== 'string' || !assertion.assert_id || assertionIds.has(assertion.assert_id) || !['status','json','time','bodyContains'].includes(assertion.type)) throw new Error('Flow 断言无效')
          assertionIds.add(assertion.assert_id)
          if (Object.keys(assertion).some(k => !['assert_id','type','path','op','expected'].includes(k)) || (assertion.path !== undefined && typeof assertion.path !== 'string') || (assertion.op !== undefined && !['equals','exists','length_gt','contains'].includes(assertion.op)) || (assertion.expected !== undefined && !['string','number','boolean'].includes(typeof assertion.expected))) throw new Error('Flow 断言字段无效')
        }
      }
      if (event.children !== undefined) walk(event.children, depth + 1)
    }
  }
  if ('events' in p) walk(p.events)
}
export function createFlowCandidate(pid: string, planId: string, stepId: string, base: Flow, revision: string | null, patch: Partial<Flow>): AgentFlowCandidate {
  validateFlowPatch(patch)
  const existing = listFlowCandidates(pid).find(c => c.plan_id === planId && c.step_id === stepId)
  if (existing) return existing
  const candidate: AgentFlowCandidate = { kind: 'flow', candidate_id: randomUUID(), number: nextCandidateNumber(pid), project_id: pid, flow_id: base.flow_id, plan_id: planId, step_id: stepId, base_revision: revision, base: structuredClone(base), proposal: { ...structuredClone(base), ...structuredClone(patch) }, created_at: new Date().toISOString(), status: 'pending' }
  writeLocal(file(pid, 'flow-candidates', candidate.candidate_id), candidate)
  emit({ project_id: pid, flow_id: base.flow_id })
  return candidate
}
function apply(candidate: AgentFlowCandidate, choices: Record<string, AgentConflictChoice> = {}, current = getFlowDraft(candidate.project_id, candidate.flow_id).flow, operation: 'apply' | 'restore' = 'apply', source = { base: candidate.base, proposal: candidate.proposal }): AgentFlowCandidate {
  const saved = store.getFlow(candidate.project_id, candidate.flow_id)
  const active = getFlowDraft(candidate.project_id, candidate.flow_id)
  if ((!saved && !(operation === 'restore' && active.deleted_object)) || (saved ? flowSignature(saved) : null) !== (operation === 'restore' ? active.base_revision : candidate.base_revision)) return review(candidate, 'conflict', '正式 Flow 已变化，需核对最新定义后重新生成提案。')
  const merged = mergeDefinitions(flowDefinition(source.base), flowDefinition(current), flowDefinition(source.proposal), choices)
  const result: Flow = { ...current, ...merged.result }
  const draft = getFlowDraft(candidate.project_id, candidate.flow_id)
  const previous = draft.flow
  draft.flow = result; draft.agent_owned = true
  draft.candidate_ids = [...new Set([...(draft.candidate_ids ?? []), candidate.candidate_id])]
  const merge = { operation, base: source.base, proposal: source.proposal, review_id: randomUUID(), current, result, draft_signature: flowSignature(result), saved_revision: saved ? flowSignature(saved) : null, conflicts: merged.conflicts, choices }
  persist(draft)
  const reviewed = review(candidate, merged.conflicts.length ? 'conflict' : 'applied', merged.conflicts.length ? '无冲突字段已合并；冲突解决前不能保存 Flow。' : undefined, merge, { before: candidate.application?.before ?? current, after: result })
  emit({ project_id: candidate.project_id, flow_id: candidate.flow_id, draft, previous })
  return reviewed
}
export function applyFlowCandidate(pid: string, id: string): AgentFlowCandidate {
  const candidate = readCandidate(pid, id)
  if (!['pending','conflict'].includes(candidate.status)) throw new Error('候选不是待确认状态')
  return candidate.merge?.operation === 'restore' ? restoreFlowCandidate(pid, id) : apply(candidate)
}
export function rejectFlowCandidate(pid: string, id: string): AgentFlowCandidate { return review(readCandidate(pid, id), 'rejected') }
export function resolveFlowCandidate(pid: string, id: string, reviewId: string, choices: Record<string, AgentConflictChoice>): AgentFlowCandidate {
  const candidate = readCandidate(pid, id), merge = candidate.merge
  if (candidate.status !== 'conflict' || !merge || merge.review_id !== reviewId) throw new Error('冲突审阅已变化，请重新打开')
  const draft = getFlowDraft(pid, candidate.flow_id), saved = store.getFlow(pid, candidate.flow_id)
  if (flowSignature(draft.flow) !== merge.draft_signature || (saved ? flowSignature(saved) : null) !== merge.saved_revision) return applyFlowCandidate(pid, id)
  if (!choices || Object.keys(choices).some(key => !merge.conflicts.some(c => c.id === key)) || merge.conflicts.some(c => !['base','current','agent'].includes(choices[c.id]))) throw new Error('请为每个冲突字段明确选择结果')
  return apply(candidate, choices, merge.current, merge.operation === 'restore' ? 'restore' : 'apply', { base: merge.base ?? candidate.base, proposal: merge.proposal ?? candidate.proposal })
}
export function restoreDeletedFlowDraft(pid: string, id: string, deletionId: string): AgentFlowDraft {
  const tombstone = store.getDeletedObject(pid, 'flow', id)
  if (!tombstone || tombstone.kind !== 'flow' || tombstone.deletion_id !== deletionId) throw new Error('删除记录已变化，请重新审阅')
  if (store.getFlow(pid, id)) throw new Error('该编号已存在正式 Flow，请先载入最新定义并检查冲突')
  const existing = readLocal<AgentFlowDraft | null>(file(pid, 'flow-drafts', id), null)
  if (existing?.deleted_object === deletionId) return structuredClone(existing)
  const local = existing ?? tombstone.draft
  const baseline = local?.base_revision
    ? tombstone.versions.find(version => version.revision === local.base_revision)?.flow ?? listFlowCandidates(pid, id).find(candidate => candidate.base_revision === local.base_revision)?.base
    : local?.deleted_object ? store.listDeletedObjects(pid).find(item => item.deletion_id === local.deleted_object && item.kind === 'flow')?.snapshot as Flow | undefined : tombstone.snapshot
  if (local && !baseline) throw new Error('删除前 Flow 草稿的保存基线无法核实，已保留墓碑和候选，请先审阅历史')
  const draft: AgentFlowDraft = { ...(existing ?? tombstone.draft), project_id: pid, flow_id: id, flow: structuredClone(existing?.flow ?? tombstone.draft?.flow ?? tombstone.snapshot), base_revision: null, agent_owned: true, deleted_object: deletionId, updated_at: new Date().toISOString() }
  if (local && local.base_revision !== tombstone.revision && flowSignature(local.flow) !== flowSignature(tombstone.snapshot)) {
    const candidate: AgentFlowCandidate = { kind: 'flow', candidate_id: randomUUID(), number: nextCandidateNumber(pid), project_id: pid, flow_id: id, plan_id: 'deletion-recovery', step_id: deletionId, base_revision: null, base: structuredClone(baseline!), proposal: structuredClone(local.flow), created_at: new Date().toISOString(), status: 'pending' }
    writeLocal(file(pid, 'flow-candidates', candidate.candidate_id), candidate)
    draft.flow = structuredClone(tombstone.snapshot); persist(draft)
    apply(candidate, {}, draft.flow, 'restore')
    return getFlowDraft(pid, id)
  }
  persist(draft); emit({ project_id: pid, flow_id: id, draft }); return draft
}
/** Human recovery save is separate from restoring or reviewing a candidate. */
export function saveDeletedFlowDraft(pid: string, id: string, deletionId: string, signature: string): AgentFlowDraft {
  const draft = getFlowDraft(pid, id), tombstone = store.getDeletedObject(pid, 'flow', id)
  if (draft.deleted_object !== deletionId || tombstone?.deletion_id !== deletionId || flowSignature(draft.flow) !== signature) throw new Error('恢复草稿或删除记录已变化，请重新审阅')
  if (store.getFlow(pid, id)) throw new Error('该编号已存在正式 Flow，恢复保存已暂停')
  validateFlowPatch({ name: draft.flow.name, description: draft.flow.description, env_id: draft.flow.env_id, events: draft.flow.events })
  const saved = store.saveFlow(pid, draft.flow), version = store.listFlowVersions(pid, id)[0]
  for (const candidateId of draft.candidate_ids ?? []) {
    const candidate = readCandidate(pid, candidateId)
    if (candidate.status === 'applied') writeLocal(file(pid, 'flow-candidate-reviews', candidateId), { ...readLocal(file(pid, 'flow-candidate-reviews', candidateId), {}), saved_version: { version_id: version.version_id, version: version.version, revision: version.revision, plan_id: 'manual-recovery' } })
  }
  const previous = draft.flow
  draft.flow = saved; draft.base_revision = flowSignature(saved); draft.agent_owned = false; draft.candidate_ids = []; delete draft.deleted_object
  persist(draft); emit({ project_id: pid, flow_id: id, draft, previous, saved_revision: draft.base_revision }); return draft
}
export function restoreFlowCandidate(pid: string, id: string): AgentFlowCandidate {
  const candidate = readCandidate(pid, id)
  const tombstone = store.getDeletedObject(pid, 'flow', candidate.flow_id)
  if (tombstone && !store.getFlow(pid, candidate.flow_id)) restoreDeletedFlowDraft(pid, candidate.flow_id, tombstone.deletion_id)
  const draft = getFlowDraft(pid, candidate.flow_id)
  const saved = store.readFlowSnapshot(pid, candidate.flow_id)
  if ((!saved.flow && !draft.deleted_object) || draft.base_revision !== saved.revision) throw new Error('正式 Flow 已变化，请先载入最新定义后恢复候选')
  const source = candidate.status === 'conflict' && candidate.merge?.operation === 'restore'
    ? { base: candidate.merge.base!, proposal: candidate.merge.proposal! }
    : candidate.application ? { base: candidate.application.before, proposal: candidate.application.after } : { base: candidate.base, proposal: candidate.proposal }
  return apply(candidate, {}, draft.flow, 'restore', source)
}
export function restoreFlowVersionDraft(pid: string, id: string, versionId: string): AgentFlowCandidate {
  const version = store.getFlowVersion(pid, id, versionId), saved = store.readFlowSnapshot(pid, id), draft = getFlowDraft(pid, id)
  if (!version || !saved.flow) throw new Error('Flow 或版本不存在')
  if (draft.base_revision !== saved.revision) throw new Error('正式 Flow 已变化，请先载入最新定义后恢复版本')
  const { name, description, env_id, events } = version.flow
  const candidate = createFlowCandidate(pid, 'version-restore', randomUUID(), saved.flow, saved.revision, { name, description, env_id, events })
  return apply(candidate, {}, draft.flow, 'restore')
}
/** Explicit user action; never used by background refresh or shutdown. */
export function reloadFlowDraft(pid: string, id: string, expectedDraftSignature: string): AgentFlowDraft {
  const draft = getFlowDraft(pid, id), saved = store.readFlowSnapshot(pid, id)
  if (flowSignature(draft.flow) !== expectedDraftSignature) throw new Error('草稿已变化，请重新检查再载入')
  if (!saved.flow) throw new Error('Flow 已删除')
  const previous = draft.flow
  draft.flow = saved.flow; draft.base_revision = saved.revision; draft.agent_owned = false; draft.candidate_ids = []
  persist(draft)
  emit({ project_id: pid, flow_id: id, draft, previous, saved_revision: saved.revision! })
  return draft
}
/** Human Save and Run both check the editor's original baseline. */
export function saveFlowEditor(pid: string, flow: Flow): Flow {
  const draft = getFlowDraft(pid, flow.flow_id)
  const outcome = store.saveFlowChecked(pid, flow, draft.base_revision ?? '')
  if (outcome.status !== 'saved') throw new Error('正式 Flow 已变化，请先在版本入口载入最新定义并审阅候选')
  const previous = draft.flow
  for (const id of draft.candidate_ids ?? []) {
    const candidate = readCandidate(pid, id)
    if (candidate.status !== 'applied') continue
    const reviewFile = file(pid, 'flow-candidate-reviews', id)
    writeLocal(reviewFile, { ...readLocal(reviewFile, {}), saved_version: { version_id: outcome.version.version_id, version: outcome.version.version, revision: outcome.revision, plan_id: 'manual-save' } })
  }
  draft.flow = outcome.flow; draft.base_revision = outcome.revision; draft.agent_owned = false; draft.candidate_ids = []
  persist(draft)
  emit({ project_id: pid, flow_id: flow.flow_id, draft, previous, saved_revision: outcome.revision })
  return outcome.flow
}
export function stashAgentFlowDrafts(): number {
  let added = 0
  for (const project of store.listProjects()) for (const draft of listAgentFlowDrafts(project.project_id)) {
    if (listFlowCandidates(project.project_id, draft.flow_id).some(c => flowSignature(c.merge?.result ?? c.proposal) === flowSignature(draft.flow))) continue
    const candidate = createFlowCandidate(project.project_id, 'exit-stash', randomUUID(), draft.flow, draft.base_revision, { description: draft.flow.description })
    review(candidate, 'applied'); added++
  }
  return added
}
/** Called only by the approved plan dispatcher; not exposed over IPC. */
export function saveApprovedFlow(pid: string, planId: string, id: string, revision: string | null, candidateIds: string[]): { saved_version: NonNullable<AgentFlowCandidate['saved_version']>; candidate_ids: string[] } {
  const saved = store.readFlowSnapshot(pid, id), current = getFlowDraft(pid, id)
  if (!revision || saved.revision !== revision || current.base_revision !== revision) throw new Error('正式 Flow revision 或草稿基线已变化，保存已暂停，请重新核对计划')
  for (const candidateId of candidateIds) {
    const candidate = readCandidate(pid, candidateId)
    if (candidate.plan_id !== planId || candidate.flow_id !== id) throw new Error('Flow 保存候选超出获批计划')
    const applied = candidate.status === 'pending' ? applyFlowCandidate(pid, candidateId) : candidate
    if (applied.status !== 'applied') throw new Error(applied.error ?? '候选尚有冲突，不能保存 Flow')
  }
  const draft = getFlowDraft(pid, id), before = structuredClone(draft.flow)
  validateFlowPatch({ name: draft.flow.name, description: draft.flow.description, env_id: draft.flow.env_id, events: draft.flow.events })
  const outcome = store.saveFlowChecked(pid, draft.flow, revision)
  if (outcome.status !== 'saved') throw new Error('正式 Flow 已变化，保存已暂停')
  const savedVersion = { version_id: outcome.version.version_id, version: outcome.version.version, revision: outcome.revision, plan_id: planId }
  const linked = [...new Set([...candidateIds, ...(draft.candidate_ids ?? [])])].filter(candidateId => readCandidate(pid, candidateId).status === 'applied')
  for (const candidateId of linked) {
    const reviewFile = file(pid, 'flow-candidate-reviews', candidateId)
    writeLocal(reviewFile, { ...readLocal(reviewFile, {}), saved_version: savedVersion })
  }
  draft.flow = outcome.flow; draft.base_revision = outcome.revision; draft.agent_owned = false; draft.candidate_ids = []
  persist(draft)
  emit({ project_id: pid, flow_id: id, draft, previous: before, saved_revision: outcome.revision })
  return { saved_version: savedVersion, candidate_ids: linked }
}
/** Synchronous check and write prevents a late Agent transition from becoming a Run auto-save. */
export function saveManualFlowForRun(pid: string, flow: Flow): Flow {
  if (getFlowDraft(pid, flow.flow_id).agent_owned) throw new Error('Agent Flow 草稿请先主动保存后运行；运行不会自动保存。')
  return saveFlowEditor(pid, flow)
}
export const flowDraftCommands = { restoreDeletedFlowDraft, saveDeletedFlowDraft, saveFlowEditor, reloadFlowDraft, restoreFlowCandidate, restoreFlowVersionDraft, listFlowVersions: store.listFlowVersions, getFlowVersion: store.getFlowVersion, saveManualFlowForRun, getFlowDraft, syncFlowEditorDraft, listAgentFlowDrafts, listFlowCandidates, applyFlowCandidate, rejectFlowCandidate, resolveFlowCandidate, stashAgentFlowDrafts }
