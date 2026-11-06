import fs from 'node:fs'
import path from 'node:path'

/** A storage-level barrier covers every definition-save entry point, including old UI and MCP paths. */
export function assertAgentConflictsResolved(localRoot: string, projectId: string, targetId: string, kind: 'api' | 'flow' = 'api'): void {
  if (!/^[\w-]{1,100}$/.test(projectId) || !/^[\w-]{1,100}$/.test(targetId)) throw new Error('对象编号无效')
  const root = path.join(localRoot, 'agent', 'projects', projectId)
  const reviews = path.join(root, kind === 'flow' ? 'flow-candidate-reviews' : 'candidate-reviews')
  for (const name of fs.existsSync(reviews) ? fs.readdirSync(reviews).filter(name => name.endsWith('.json')) : []) {
    let review: { status: string; target_id?: string; flow_id?: string }
    try { review = JSON.parse(fs.readFileSync(path.join(reviews, name), 'utf8')) }
    catch { throw new Error('Agent 冲突记录无法读取，保存已暂停') }
    if (review.status !== 'conflict') continue
    const id = (kind === 'flow' ? review.flow_id : review.target_id) ?? JSON.parse(fs.readFileSync(path.join(root, kind === 'flow' ? 'flow-candidates' : 'candidates', name), 'utf8')).target_id
    if (id === targetId) throw new Error(`该${kind === 'flow' ? 'Flow' : '接口'}存在未解决的 Agent 候选冲突，请先在版本入口处理后保存`)
  }
  const undos = path.join(root, 'turn-undo')
  for (const name of fs.existsSync(undos) ? fs.readdirSync(undos).filter(n=>n.endsWith('.json')) : []) {
    let record: import('@shared/agentTurnUndo').AgentTurnUndo
    try { record=JSON.parse(fs.readFileSync(path.join(undos,name),'utf8')) }
    catch { throw new Error('Agent 撤销记录无法读取，保存已暂停') }
    if (!['review','partial'].includes(record.status)) continue
    if (record.entries.some(entry=>entry.kind===kind && entry.entity_id===targetId && entry.status!=='completed' && entry.conflicts.length)) throw new Error('该对象存在未解决的整轮撤销冲突，请解决或放弃本次撤销审阅后再保存')
  }

}
