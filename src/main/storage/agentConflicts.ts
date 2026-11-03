import fs from 'node:fs'
import path from 'node:path'

/** A storage-level barrier covers every definition-save entry point, including old UI and MCP paths. */
export function assertAgentConflictsResolved(localRoot: string, projectId: string, targetId: string): void {
  if (!/^[\w-]{1,100}$/.test(projectId) || !/^[\w-]{1,100}$/.test(targetId)) throw new Error('对象编号无效')
  const root = path.join(localRoot, 'agent', 'projects', projectId)
  const reviews = path.join(root, 'candidate-reviews')
  if (!fs.existsSync(reviews)) return
  for (const name of fs.readdirSync(reviews).filter(name => name.endsWith('.json'))) {
    let review: { status: string; target_id?: string }
    try { review = JSON.parse(fs.readFileSync(path.join(reviews, name), 'utf8')) }
    catch { throw new Error('Agent 冲突记录无法读取，保存已暂停') }
    if (review.status !== 'conflict') continue
    const id = review.target_id ?? JSON.parse(fs.readFileSync(path.join(root, 'candidates', name), 'utf8')).target_id
    if (id === targetId) throw new Error('该接口存在未解决的 Agent 候选冲突，请先在版本入口处理后保存')
  }
}
