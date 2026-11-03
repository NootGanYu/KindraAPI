import { validateNestedPatch, validateSystemParameterOrigins } from './patchValidation'
import { validateAgentApiDocumentation } from './apiDocumentation'
import { mergeDefinitions } from './merge'
import { withTargetChanges } from '../storage/changes'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Target } from '@shared/types'
import type { AgentCandidate, AgentDraft, AgentDraftEvent, AgentCandidateMerge, AgentConflictChoice } from '@shared/agentDraft'
import { stableJson, targetDefinition, preserveCaseRuns } from '@shared/targetSync'
import * as store from '../storage/store'
import { agentRoot, readLocal, writeLocal } from './store'

const mirrors = new Map<string, AgentDraft>()
const listeners = new Set<(event: AgentDraftEvent) => void>()
export function onDraftEvent(listener: (event: AgentDraftEvent) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
function emit(event: AgentDraftEvent): void { for (const listener of listeners) listener(structuredClone(event)) }
function projectDir(pid: string): string {
  if (!/^[\w-]{1,100}$/.test(pid) || !store.getProject(pid)) throw new Error('项目不存在')
  return path.join(agentRoot(), 'projects', pid)
}
function file(pid: string, folder: string, id: string): string {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error('对象编号无效')
  return path.join(projectDir(pid), folder, `${id}.json`)
}
export const draftSignature = (target: Target): string => stableJson(targetDefinition(target))
export function getDraft(pid: string, id: string): AgentDraft {
  const stored = readLocal<AgentDraft | null>(file(pid, 'drafts', id), null)
  const mirror = mirrors.get(`${pid}:${id}`)
  if (stored || mirror) return structuredClone(stored ?? mirror!)
  const snapshot = store.readTargetSnapshot(pid, id)
  if (!snapshot.target || snapshot.target.target_type !== 'api') throw new Error('接口不存在')
  return { project_id: pid, target_id: id, target: snapshot.target, base_revision: snapshot.revision, agent_owned: false, updated_at: new Date().toISOString() }
}
function persistDraft(draft: AgentDraft): void {
  draft.updated_at = new Date().toISOString()
  mirrors.set(`${draft.project_id}:${draft.target_id}`, structuredClone(draft))
  if (draft.agent_owned) writeLocal(file(draft.project_id, 'drafts', draft.target_id), draft)
}
export function syncEditorDraft(pid: string, target: Target, baseRevision?: string | null): AgentDraft {
  if (target.project_id !== pid || target.target_type !== 'api') throw new Error('草稿项目或类型不符')
  const draft = getDraft(pid, target.target_id)
  draft.target = structuredClone(target)
  if (!draft.agent_owned && baseRevision !== undefined) {
    if (baseRevision !== null && typeof baseRevision !== 'string') throw new Error('草稿基线无效')
    draft.base_revision = baseRevision
  }
  const saved = store.readTargetSnapshot(pid, target.target_id)
  if (draft.agent_owned && !listCandidates(pid, target.target_id).some(candidate => candidate.status === 'conflict') && saved.target && draftSignature(saved.target) === draftSignature(target)) {
    draft.agent_owned = false; draft.base_revision = saved.revision; draft.candidate_ids = []
    fs.rmSync(file(pid, 'drafts', target.target_id), { force: true })
  }
  persistDraft(draft)
  return draft
}
/** Release a closed manual editing session; Agent-owned drafts remain recoverable. */
export function releaseEditorDraft(pid: string, id: string): boolean {
  const stored = readLocal<AgentDraft | null>(file(pid, 'drafts', id), null)
  const mirror = mirrors.get(`${pid}:${id}`)
  if (stored?.agent_owned || mirror?.agent_owned) return false
  mirrors.delete(`${pid}:${id}`)
  return true
}
export function listAgentDrafts(pid: string): AgentDraft[] {
  const dir = path.join(projectDir(pid), 'drafts')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => getDraft(pid, n.slice(0, -5))) : []
}
export function listCandidates(pid: string, targetId?: string): AgentCandidate[] {
  const dir = path.join(projectDir(pid), 'candidates')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => readCandidate(pid, n.slice(0, -5))).filter(c => !targetId || c.target_id === targetId).sort((a, b) => Number(b.number.slice(1)) - Number(a.number.slice(1))) : []
}
function readCandidate(pid: string, id: string): AgentCandidate {
  const candidate = readLocal<AgentCandidate | null>(file(pid, 'candidates', id), null)
  if (!candidate) throw new Error('候选不存在')
  const review = readLocal<Pick<AgentCandidate, 'status' | 'error' | 'merge' | 'application'>>(file(pid, 'candidate-reviews', id), { status: 'pending' })
  return { ...candidate, ...review }
}
function review(candidate: AgentCandidate, status: AgentCandidate['status'], error?: string, merge?: AgentCandidateMerge, application = candidate.application): AgentCandidate {
  const previous = readLocal<Record<string, unknown>>(file(candidate.project_id, 'candidate-reviews', candidate.candidate_id), {})
  writeLocal(file(candidate.project_id, 'candidate-reviews', candidate.candidate_id), { ...previous, target_id: candidate.target_id, status, error, merge, application })
  emit({ project_id: candidate.project_id, target_id: candidate.target_id })
  return { ...candidate, status, error, merge, application }
}
export function validatePatch(patch: unknown): asserts patch is Partial<Target> {
  const allowed = ['name', 'description', 'method', 'url', 'request', 'response', 'custom_attributes', 'mark_id']
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('提案包含不允许修改的字段')
  for (const key of ['request', 'response', 'custom_attributes']) if (key in patch && (!(patch as any)[key] || typeof (patch as any)[key] !== 'object' || Array.isArray((patch as any)[key]))) throw new Error('提案对象字段类型无效')
  validateNestedPatch(patch)
  // Model-visible placeholders never become real credentials or definitions.
  if (/\[已隐藏\]|\[REDACTED\]/i.test(JSON.stringify(patch))) throw new Error('提案包含脱敏占位符，请只修改明确的业务字段')
  for (const key of ['name', 'description', 'method', 'url', 'mark_id']) if (key in patch && typeof (patch as any)[key] !== 'string') throw new Error('提案文本字段类型无效')
}
function mergePatch(base: unknown, patch: unknown): any {
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    const result = { ...(base && typeof base === 'object' ? base : {}) } as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('提案字段无效')
      result[key] = mergePatch(result[key], value)
    }
    return result
  }
  return structuredClone(patch)
}
/** Internal business action, called only after the plan dispatcher checks approval. */
export function createCandidate(pid: string, planId: string, stepId: string, base: Target, revision: string | null, patch: Partial<Target>): AgentCandidate {
  validatePatch(patch)
  const previous = listCandidates(pid).find(c => c.plan_id === planId && c.step_id === stepId)
  if (previous) return previous
  const sequenceFile = path.join(projectDir(pid), 'candidate-sequence.json')
  const sequence = readLocal<number>(sequenceFile, 0) + 1
  const candidate: AgentCandidate = { candidate_id: randomUUID(), number: `P${sequence}`, project_id: pid, target_id: base.target_id, plan_id: planId, step_id: stepId, base_revision: revision, base: structuredClone(base), patch: structuredClone(patch), proposal: mergePatch(base, patch), created_at: new Date().toISOString(), status: 'pending' }
  validateSystemParameterOrigins(base, candidate.proposal)
  writeLocal(sequenceFile, sequence)
  writeLocal(file(pid, 'candidates', candidate.candidate_id), candidate)
  emit({ project_id: pid, target_id: base.target_id })
  return candidate
}
function applyMergedCandidate(candidate: AgentCandidate, current: Target, merge: AgentCandidateMerge): AgentCandidate {
  const draft = getDraft(candidate.project_id, candidate.target_id)
  draft.candidate_ids = [...new Set([...(draft.candidate_ids ?? []), candidate.candidate_id])]
  draft.target = merge.result; draft.agent_owned = true; draft.base_revision = merge.saved_revision
  persistDraft(draft)
  let before = current
  if (candidate.application && !candidate.application.undone) {
    // Remove only this candidate's previous delta from the current draft to recover
    // the true before-image, carrying forward later unrelated human edits.
    const inverse = { ...candidate, base: candidate.application.after, proposal: candidate.application.before }
    const preview = buildMerge(inverse, current, merge.saved_revision)
    before = buildMerge(inverse, current, merge.saved_revision, Object.fromEntries(preview.conflicts.map(conflict => [conflict.id, 'current' as const]))).result
  }
  const application = { before, after: merge.result }
  const result = review(candidate, merge.conflicts.length ? 'conflict' : 'applied', merge.conflicts.length ? '仅冲突字段需要确认，其他字段已合并到草稿。解决前不能正式保存。' : undefined, merge, application)
  emit({ project_id: candidate.project_id, target_id: candidate.target_id, draft, previous: current })
  return result
}
function buildMerge(candidate: AgentCandidate, current: Target, revision: string | null, choices: Record<string, AgentConflictChoice> = {}): AgentCandidateMerge {
  const merged = mergeDefinitions(targetDefinition(candidate.base), targetDefinition(current), targetDefinition(candidate.proposal), choices)
  const result = preserveCaseRuns({ ...merged.result, created_at: current.created_at, updated_at: current.updated_at, version: current.version } as Target, current)
  return { base: candidate.base, proposal: candidate.proposal, review_id: randomUUID(), current, result, draft_signature: draftSignature(result), saved_revision: revision, conflicts: merged.conflicts, choices }
}
export function applyCandidate(pid: string, id: string): AgentCandidate {
  const candidate = readCandidate(pid, id)
  if (candidate.merge?.operation === 'undo') throw new Error('请使用撤销冲突审阅')
  if (!['pending', 'conflict'].includes(candidate.status)) throw new Error('候选不是待确认状态')
  const draft = getDraft(pid, candidate.target_id)
  const saved = store.readTargetSnapshot(pid, candidate.target_id)
  if (saved.revision !== candidate.base_revision) return review(candidate, 'conflict', '正式定义已变化，已暂停此对象；请先核对已保存版本。')
  return applyMergedCandidate(candidate, draft.target, buildMerge(candidate, draft.target, saved.revision))
}
/** Review decisions never rewrite immutable candidate snapshots or formal definitions. */
export function rejectCandidate(pid: string, id: string): AgentCandidate {
  return review(readCandidate(pid, id), 'rejected')
}
export function restoreCandidate(pid: string, id: string): AgentCandidate {
  const candidate = readCandidate(pid, id)
  const draft = getDraft(pid, candidate.target_id)
  const saved = store.readTargetSnapshot(pid, candidate.target_id)
  if (!saved.target) throw new Error('接口已删除，无法恢复到草稿')
  if (saved.revision !== draft.base_revision) throw new Error('正式定义已变化，请先在编辑器载入最新定义后恢复候选')
  // A restored snapshot is still a proposal against today's draft, never a formal save.
  const source = candidate.status === 'conflict' && candidate.merge?.operation === 'restore'
    ? { ...candidate, base: candidate.merge.base!, proposal: candidate.merge.proposal! }
    : candidate.application ? { ...candidate, base: candidate.application.before, proposal: candidate.application.after } : candidate
  const merge = buildMerge(source, draft.target, saved.revision)
  merge.operation = 'restore'
  return applyMergedCandidate(candidate, draft.target, merge)
}
export function undoCandidate(pid: string, id: string): AgentCandidate {
  const candidate = readCandidate(pid, id), application = candidate.application
  if (!application || application.undone) throw new Error('候选没有已应用修改或已撤销')
  const draft = getDraft(pid, candidate.target_id), saved = store.readTargetSnapshot(pid, candidate.target_id)
  if (!saved.target) throw new Error('接口已删除，无法撤销草稿')
  if (saved.revision !== draft.base_revision) throw new Error('正式定义已变化，请先在编辑器载入最新定义后撤销')
  const merge = buildMerge({ ...candidate, base: application.after, proposal: application.before }, draft.target, saved.revision)
  merge.operation = 'undo'
  // Undo is preview-only while conflicted, so unrelated fields cannot be reverted prematurely.
  if (merge.conflicts.length) {
    merge.draft_signature = draftSignature(draft.target)
    return review(candidate, 'conflict', '撤销与后续编辑冲突。草稿未改变，请明确选择后再撤销。', merge)
  }
  return finishUndo(candidate, draft, merge)
}
function finishUndo(candidate: AgentCandidate, draft: AgentDraft, merge: AgentCandidateMerge): AgentCandidate {
  const previous = draft.target
  draft.target = merge.result; draft.agent_owned = true; draft.base_revision = merge.saved_revision
  persistDraft(draft)
  const result = review(candidate, 'undone', undefined, merge, { ...candidate.application!, undone: true })
  emit({ project_id: candidate.project_id, target_id: candidate.target_id, draft, previous })
  return result
}
export function resolveCandidateUndo(pid: string, id: string, reviewId: string, choices: Record<string, AgentConflictChoice>): AgentCandidate {
  const candidate = readCandidate(pid, id), merge = candidate.merge, application = candidate.application
  if (candidate.status !== 'conflict' || merge?.operation !== 'undo' || merge.review_id !== reviewId || !application || application.undone) throw new Error('撤销审阅已变化，请重新打开候选')
  const draft = getDraft(pid, candidate.target_id), saved = store.readTargetSnapshot(pid, candidate.target_id)
  if (draftSignature(draft.target) !== merge.draft_signature || saved.revision !== merge.saved_revision) return undoCandidate(pid, id)
  if (!choices || Object.keys(choices).some(key => !merge.conflicts.some(conflict => conflict.id === key)) || merge.conflicts.some(conflict => !['base', 'current', 'agent'].includes(choices[conflict.id]))) throw new Error('请为每个冲突字段明确选择结果')
  const resolved = buildMerge({ ...candidate, base: application.after, proposal: application.before }, draft.target, saved.revision, choices)
  resolved.operation = 'undo'
  if (resolved.conflicts.length) throw new Error('仍有未解决的冲突')
  return finishUndo(candidate, draft, resolved)
}
export function resolveCandidate(pid: string, id: string, reviewId: string, choices: Record<string, AgentConflictChoice>): AgentCandidate {
  const candidate = readCandidate(pid, id), merge = candidate.merge
  if (merge?.operation === 'undo') throw new Error('请使用撤销冲突审阅')
  if (candidate.status !== 'conflict' || !merge || merge.review_id !== reviewId) throw new Error('冲突审阅已变化，请重新打开候选')
  const draft = getDraft(pid, candidate.target_id), saved = store.readTargetSnapshot(pid, candidate.target_id)
  if (draftSignature(draft.target) !== merge.draft_signature || saved.revision !== merge.saved_revision) return merge.operation === 'restore' ? restoreCandidate(pid, id) : applyCandidate(pid, id)
  if (!choices || Object.keys(choices).some(key => !merge.conflicts.some(conflict => conflict.id === key)) || merge.conflicts.some(conflict => !['base', 'current', 'agent'].includes(choices[conflict.id]))) throw new Error('请为每个冲突字段明确选择结果')
  const source = { ...candidate, base: merge.base ?? candidate.base, proposal: merge.proposal ?? candidate.proposal }
  const resolved = buildMerge(source, merge.current, saved.revision, choices)
  resolved.operation = merge.operation
  if (resolved.conflicts.length) throw new Error('仍有未解决的冲突')
  return applyMergedCandidate(candidate, draft.target, resolved)
}
export function stashAgentDrafts(): number {
  let added = 0
  for (const project of store.listProjects()) for (const draft of listAgentDrafts(project.project_id)) {
    const candidates = listCandidates(project.project_id, draft.target_id)
    if (candidates.some(c => draftSignature(c.merge?.result ?? c.proposal) === draftSignature(draft.target))) continue
    const candidate = createCandidate(project.project_id, 'exit-stash', randomUUID(), draft.target, draft.base_revision, { description: draft.target.description })
    review(candidate, 'applied'); added++
  }
  return added
}
/** Internal approved-save action; never registered as a standalone IPC command. */
export async function saveApprovedApi(pid: string, planId: string, targetId: string, revision: string | null, candidateIds: string[]): Promise<{ saved_version: NonNullable<AgentCandidate['saved_version']>; candidate_ids: string[] }> {
  return withTargetChanges('system', planId, () => {
    const saved = store.readTargetSnapshot(pid, targetId)
    const current = getDraft(pid, targetId)
    if (!revision || saved.revision !== revision) throw new Error('正式定义 revision 已变化，保存已暂停，请重新核对计划')
    if (current.base_revision !== revision) throw new Error('草稿保存基线已变化，保存已暂停，请重新核对计划')
    for (const id of candidateIds) {
      const candidate = readCandidate(pid, id)
      if (candidate.plan_id !== planId || candidate.target_id !== targetId) throw new Error('保存候选超出获批计划')
      const applied = candidate.status === 'pending' ? applyCandidate(pid, id) : candidate
      if (applied.status !== 'applied') throw new Error(applied.error ?? '候选尚有未解决冲突，不能保存')
    }
    const draft = getDraft(pid, targetId)
    if (draft.base_revision !== revision) throw new Error('草稿保存基线已变化，保存已暂停')
    const linkedIds = [...new Set([...candidateIds, ...(draft.candidate_ids ?? [])])].filter(id => readCandidate(pid, id).status === 'applied')
    validateSystemParameterOrigins(saved.target!, draft.target)
    validateAgentApiDocumentation(draft.target, saved.target, linkedIds.flatMap(id => { const patch = readCandidate(pid, id).patch; return patch ? [patch] : [] }))
    const beforeSave = structuredClone(draft.target)
    const outcome = store.saveTargetChecked(pid, draft.target, revision)
    if (outcome.status !== 'saved') throw new Error('正式定义已变化，保存已暂停')
    const version = store.listTargetVersions(pid, targetId).find(item => item.version === outcome.target.version)!
    const savedVersion = { version_id: version.version_id, version: version.version, revision: outcome.revision, plan_id: planId }
    for (const id of linkedIds) {
      const reviewFile = file(pid, 'candidate-reviews', id)
      writeLocal(reviewFile, { ...readLocal<Record<string, unknown>>(reviewFile, {}), saved_version: savedVersion })
    }
    draft.target = outcome.target; draft.base_revision = outcome.revision; draft.agent_owned = false; draft.candidate_ids = []
    fs.rmSync(file(pid, 'drafts', targetId), { force: true }); persistDraft(draft)
    emit({ project_id: pid, target_id: targetId, draft, previous: beforeSave, saved_revision: outcome.revision })
    return { saved_version: savedVersion, candidate_ids: linkedIds }
  })
}
/** Atomic quit-only boundary: an Agent transition cannot interleave with this check and save. */
export function saveManualDraftOnQuit(pid: string, target: Target, revision: string): Promise<boolean> {
  return withTargetChanges('ui', undefined, () => {
    if (getDraft(pid, target.target_id).agent_owned) return false
    if (target.project_id !== pid || !revision) throw new Error('退出保存缺少有效的项目或基线')
    const result = store.saveTargetChecked(pid, target, revision)
    if (result.status !== 'saved') throw new Error('退出保存遇到并发变化，请先处理冲突')
    return true
  })
}

export const draftCommands = { saveManualDraftOnQuit, getDraft, syncEditorDraft, releaseEditorDraft, listAgentDrafts, listCandidates, applyCandidate, restoreCandidate, rejectCandidate, undoCandidate, resolveCandidateUndo, resolveCandidate, stashAgentDrafts }
