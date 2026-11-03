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
    draft.agent_owned = false; draft.base_revision = saved.revision
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
  const review = readLocal<{ status: AgentCandidate['status']; error?: string; merge?: AgentCandidateMerge }>(file(pid, 'candidate-reviews', id), { status: 'pending' })
  return { ...candidate, ...review }
}
function review(candidate: AgentCandidate, status: AgentCandidate['status'], error?: string, merge?: AgentCandidateMerge): AgentCandidate {
  writeLocal(file(candidate.project_id, 'candidate-reviews', candidate.candidate_id), { target_id: candidate.target_id, status, error, merge })
  emit({ project_id: candidate.project_id, target_id: candidate.target_id })
  return { ...candidate, status, error, merge }
}
export function validatePatch(patch: unknown): asserts patch is Partial<Target> {
  const allowed = ['name', 'description', 'method', 'url', 'request', 'response', 'custom_attributes', 'mark_id']
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('提案包含不允许修改的字段')
  for (const key of ['request', 'response', 'custom_attributes']) if (key in patch && (!(patch as any)[key] || typeof (patch as any)[key] !== 'object' || Array.isArray((patch as any)[key]))) throw new Error('提案对象字段类型无效')
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
  const candidate: AgentCandidate = { candidate_id: randomUUID(), number: `P${sequence}`, project_id: pid, target_id: base.target_id, plan_id: planId, step_id: stepId, base_revision: revision, base: structuredClone(base), proposal: mergePatch(base, patch), created_at: new Date().toISOString(), status: 'pending' }
  writeLocal(sequenceFile, sequence)
  writeLocal(file(pid, 'candidates', candidate.candidate_id), candidate)
  emit({ project_id: pid, target_id: base.target_id })
  return candidate
}
function applyMergedCandidate(candidate: AgentCandidate, current: Target, merge: AgentCandidateMerge): AgentCandidate {
  const draft = getDraft(candidate.project_id, candidate.target_id)
  draft.target = merge.result; draft.agent_owned = true; draft.base_revision = candidate.base_revision
  persistDraft(draft)
  const result = review(candidate, merge.conflicts.length ? 'conflict' : 'applied', merge.conflicts.length ? '仅冲突字段需要确认，其他字段已合并到草稿。解决前不能正式保存。' : undefined, merge)
  emit({ project_id: candidate.project_id, target_id: candidate.target_id, draft, previous: current })
  return result
}
function buildMerge(candidate: AgentCandidate, current: Target, revision: string | null, choices: Record<string, AgentConflictChoice> = {}): AgentCandidateMerge {
  const merged = mergeDefinitions(targetDefinition(candidate.base), targetDefinition(current), targetDefinition(candidate.proposal), choices)
  const result = preserveCaseRuns({ ...current, ...merged.result } as Target, current)
  return { review_id: randomUUID(), current, result, draft_signature: draftSignature(result), saved_revision: revision, conflicts: merged.conflicts, choices }
}
export function applyCandidate(pid: string, id: string): AgentCandidate {
  const candidate = readCandidate(pid, id)
  if (!['pending', 'conflict'].includes(candidate.status)) throw new Error('候选不是待确认状态')
  const draft = getDraft(pid, candidate.target_id)
  const saved = store.readTargetSnapshot(pid, candidate.target_id)
  if (saved.revision !== candidate.base_revision) return review(candidate, 'conflict', '正式定义已变化，已暂停此对象；请先核对已保存版本。')
  return applyMergedCandidate(candidate, draft.target, buildMerge(candidate, draft.target, saved.revision))
}
export function resolveCandidate(pid: string, id: string, reviewId: string, choices: Record<string, AgentConflictChoice>): AgentCandidate {
  const candidate = readCandidate(pid, id), merge = candidate.merge
  if (candidate.status !== 'conflict' || !merge || merge.review_id !== reviewId) throw new Error('冲突审阅已变化，请重新打开候选')
  const draft = getDraft(pid, candidate.target_id), saved = store.readTargetSnapshot(pid, candidate.target_id)
  if (draftSignature(draft.target) !== merge.draft_signature || saved.revision !== merge.saved_revision) return applyCandidate(pid, id)
  if (!choices || Object.keys(choices).some(key => !merge.conflicts.some(conflict => conflict.id === key)) || merge.conflicts.some(conflict => !['base', 'current', 'agent'].includes(choices[conflict.id]))) throw new Error('请为每个冲突字段明确选择结果')
  const resolved = buildMerge(candidate, merge.current, saved.revision, choices)
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

export const draftCommands = { saveManualDraftOnQuit, getDraft, syncEditorDraft, releaseEditorDraft, listAgentDrafts, listCandidates, applyCandidate, resolveCandidate, stashAgentDrafts }
