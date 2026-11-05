import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Target, Flow } from '@shared/types'
import type { AgentCandidate, AgentConflictChoice } from '@shared/agentDraft'
import type { AgentFlowCandidate } from '@shared/agentFlowDraft'
import type { AgentTurnUndo, TurnUndoEntry, AgentTurnSummary } from '@shared/agentTurnUndo'
import { targetDefinition, preserveCaseRuns, stableJson } from '@shared/targetSync'
import { flowDefinition } from '@shared/flowSync'
import * as store from '../storage/store'
import { agentRoot, readLocal, writeLocal } from './store'
import { getDraft, listCandidates, rejectCandidate, commitTurnUndoApi, restoreDeletedApiDraft } from './drafts'
import { getFlowDraft, listFlowCandidates, rejectFlowCandidate, commitTurnUndoFlow, restoreDeletedFlowDraft } from './flowDrafts'
import { mergeDefinitions } from './merge'

type Candidate = AgentCandidate | AgentFlowCandidate
const applicationOrder = (c: Candidate): number => c.application?.order ?? Number(c.number.slice(1))
function dir(pid: string): string {
  if (!/^[\w-]{1,100}$/.test(pid) || !store.getProject(pid)) throw new Error('项目不存在')
  return path.join(agentRoot(), 'projects', pid, 'turn-undo')
}
function file(pid: string, id: string): string {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error('撤销编号无效')
  return path.join(dir(pid), `${id}.json`)
}
function all(pid: string): Candidate[] { return [...listCandidates(pid), ...listFlowCandidates(pid)] }
const kindOf = (c: Candidate): 'api' | 'flow' => 'flow_id' in c ? 'flow' : 'api'
const idOf = (c: Candidate): string => 'flow_id' in c ? c.flow_id : c.target_id
const definition = (kind: 'api' | 'flow', value: Target | Flow): object => kind === 'api' ? targetDefinition(value as Target) : flowDefinition(value as Flow)
const signature = (kind: 'api' | 'flow', value: Target | Flow): string => stableJson(definition(kind, value))
function persist(record: AgentTurnUndo): AgentTurnUndo { record.updated_at = new Date().toISOString(); writeLocal(file(record.project_id,record.undo_id),record); return record }
export function listUndoTurns(pid: string): AgentTurnSummary[] {
  dir(pid)
  const candidates = all(pid).filter(c => c.application && !c.application.undone || !c.application && ['pending', 'conflict'].includes(c.status))
  return [...new Set(candidates.map(c => c.plan_id))].map(plan_id => ({plan_id, name: readLocal<{goal?: string}>(path.join(agentRoot(),'projects',pid,'plans',`${plan_id}.json`),{}).goal ?? plan_id, applied_count: candidates.filter(c=>c.plan_id===plan_id && c.application).length}))
}
export function listTurnUndos(pid: string): AgentTurnUndo[] { const folder = dir(pid); return fs.existsSync(folder) ? fs.readdirSync(folder).filter(n=>n.endsWith('.json')).map(n=>readLocal<AgentTurnUndo>(path.join(folder,n),null!)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)) : [] }
function prepare(pid: string, candidates: Candidate[], choices: Record<string, AgentConflictChoice> = {}): TurnUndoEntry {
  const first = candidates[0], kind = kindOf(first), id = idOf(first)
  const saved = kind === 'api' ? store.readTargetSnapshot(pid,id) : store.readFlowSnapshot(pid,id)
  const tombstone = store.getDeletedObject(pid,kind,id)
  const draft = kind === 'api' ? getDraft(pid,id) : getFlowDraft(pid,id)
  const current = 'target' in draft ? draft.target : draft.flow
  const entry: TurnUndoEntry = {key:`${kind}:${id}`,kind,entity_id:id,name:current.name,candidate_ids:candidates.map(c=>c.candidate_id),current,result:current,conflicts:[],choices,signature:signature(kind,current),revision:saved.revision,deletion_id:!saved.revision?tombstone?.deletion_id:undefined,new_object:'new_object' in draft && draft.new_object || undefined,source_signature:stableJson(candidates.map(c=>({id:c.candidate_id,application:c.application,status:c.status}))),status:'ready'}
  if (saved.revision !== draft.base_revision && !entry.deletion_id) { entry.status='blocked';entry.error='正式定义已变化，请在编辑器载入最新定义后重新审阅';return entry }
  // Reverse each actual application, not a before/after range that would include intervening human edits.
  let result = definition(kind,current)
  for (const candidate of candidates) {
    const application = candidate.application!
    const selected = Object.fromEntries(Object.entries(choices).filter(([key])=>key.startsWith(`${candidate.candidate_id}:`)).map(([key,value])=>[key.slice(candidate.candidate_id.length+1),value]))
    const merged = mergeDefinitions(definition(kind,application.after),result,definition(kind,application.before),selected)
    entry.conflicts.push(...merged.conflicts.map(c=>({...c,id:`${candidate.candidate_id}:${c.id}`})))
    result = merged.result
    if (merged.conflicts.length) break // Later inverse deltas must be reviewed against the chosen result, not guessed choices.
  }
  entry.result = kind === 'api' ? preserveCaseRuns({...result,created_at:(current as Target).created_at,updated_at:(current as Target).updated_at,version:(current as Target).version} as Target,current as Target) : {...result,created_at:current.created_at,updated_at:current.updated_at} as Flow
  if (entry.conflicts.length) entry.status='conflict'
  return entry
}
export function previewTurnUndo(pid: string, planId: string): AgentTurnUndo {
  dir(pid)
  const candidates=all(pid).filter(c=>c.plan_id===planId && c.application && !c.application.undone).sort((a,b)=>applicationOrder(b)-applicationOrder(a))
  const pending = all(pid).filter(c=>c.plan_id===planId && !c.application && ['pending','conflict'].includes(c.status))
  if (!candidates.length && !pending.length) throw new Error('本轮没有可撤销的已应用修改')
  const groups = new Map<string,Candidate[]>()
  for (const c of candidates) { const key=`${kindOf(c)}:${idOf(c)}`;groups.set(key,[...(groups.get(key)??[]),c]) }
  for (const old of listTurnUndos(pid)) if (old.plan_id===planId && ['review','partial'].includes(old.status)) { old.status='cancelled'; persist(old) }
  const now=new Date().toISOString()
  return persist({undo_id:randomUUID(),review_id:randomUUID(),project_id:pid,plan_id:planId,created_at:now,updated_at:now,status:'review',pending_candidate_ids:pending.map(c=>c.candidate_id),entries:[...groups.values()].map(group=>prepare(pid,group))})
}
export function applyTurnUndo(pid: string, id: string, reviewId: string, choices: Record<string, Record<string, AgentConflictChoice>>): AgentTurnUndo {
  const record=readLocal<AgentTurnUndo|null>(file(pid,id),null)
  if (!record || record.review_id!==reviewId || ['completed','cancelled'].includes(record.status)) throw new Error('撤销审阅已变化，请重新打开')
  if (all(pid).some(c=>(record.pending_candidate_ids??[]).includes(c.candidate_id) && c.application)) throw new Error('待采纳候选已被应用，请重新预览整轮撤销')
  if (!choices || typeof choices!=='object') throw new Error('冲突选择无效')
  for (let i=0;i<record.entries.length;i++) {
    const entry=record.entries[i]
    if (entry.status==='completed') continue
    try {
      const candidates=all(pid).filter(c=>entry.candidate_ids.includes(c.candidate_id)).sort((a,b)=>applicationOrder(b)-applicationOrder(a))
      if (candidates.length!==entry.candidate_ids.length || candidates.some(c=>!c.application || c.application.undone)) throw new Error('候选应用记录已变化，请重新审阅本轮')
      let fresh=prepare(pid,candidates,entry.choices)
      if (fresh.signature!==entry.signature || fresh.revision!==entry.revision || fresh.deletion_id!==entry.deletion_id || fresh.source_signature!==entry.source_signature) { record.entries[i]={...prepare(pid,candidates),error:'审阅期间内容发生变化，请检查最新差异后再确认'};continue }
      if (fresh.status==='blocked') { record.entries[i]=fresh;continue }
      const selected=choices[entry.key]??{}
      if (Object.keys(selected).some(key=>!fresh.conflicts.some(c=>c.id===key)) || fresh.conflicts.some(c=>!['base','current','agent'].includes(selected[c.id]))) throw new Error('请为每个冲突字段明确选择结果')
      const combined = { ...entry.choices, ...selected }
      fresh=prepare(pid,candidates,combined)
      if (fresh.conflicts.length) { record.entries[i]={...fresh,error:'同一对象还有较早修改与所选结果冲突，请继续审阅'};continue }
      // Recovery has its own stale-definition checks and may discover additional conflicts.
      if (fresh.deletion_id) {
        if (fresh.kind==='api') restoreDeletedApiDraft(pid,fresh.entity_id,fresh.deletion_id)
        else restoreDeletedFlowDraft(pid,fresh.entity_id,fresh.deletion_id)
        const recovered=prepare(pid,candidates,combined)
        if (recovered.signature!==fresh.signature) { record.entries[i]={...prepare(pid,candidates),error:'已恢复删除前草稿，请审阅恢复后的差异'};continue }
      }
      if (fresh.kind==='api') commitTurnUndoApi(pid,fresh.entity_id,fresh.result as Target,fresh.candidate_ids)
      else commitTurnUndoFlow(pid,fresh.entity_id,fresh.result as Flow,fresh.candidate_ids)
      record.entries[i]={...fresh,status:'completed',error:undefined}
    } catch(error) { record.entries[i]={...entry,status:'blocked',error:(error as Error).message} }
    // Durable object-by-object audit; completed objects are never automatically replayed.
    record.status='partial';persist(record)
  }
  for (const candidate of all(pid).filter(c=>(record.pending_candidate_ids??[]).includes(c.candidate_id) && !c.application)) {
    if (kindOf(candidate)==='api') rejectCandidate(pid,candidate.candidate_id);else rejectFlowCandidate(pid,candidate.candidate_id)
  }
  record.review_id=randomUUID();record.status=record.entries.every(e=>e.status==='completed')?'completed':'partial'
  return persist(record)
}
export function cancelTurnUndo(pid: string, id: string): AgentTurnUndo {
  const record=readLocal<AgentTurnUndo|null>(file(pid,id),null)
  if (!record || !['review','partial'].includes(record.status)) throw new Error('本次撤销审阅已结束')
  record.status='cancelled';return persist(record)
}
export const turnUndoCommands={listUndoTurns,listTurnUndos,previewTurnUndo,applyTurnUndo,cancelTurnUndo}
