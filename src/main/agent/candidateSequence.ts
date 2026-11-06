import path from 'node:path'
import { agentRoot, readLocal, writeLocal } from './store'
/** One local sequence per project across API, API Case and Execution Flow proposals. */
export function nextCandidateNumber(projectId: string): string {
  if (!/^[\w-]{1,100}$/.test(projectId)) throw new Error('项目编号无效')
  const file = path.join(agentRoot(), 'projects', projectId, 'candidate-sequence.json')
  const next = readLocal<number>(file, 0) + 1
  writeLocal(file, next)
  return `P${next}`
}

export function nextApplicationOrder(projectId: string): number {
  if (!/^[\w-]{1,100}$/.test(projectId)) throw new Error('项目编号无效')
  const file = path.join(agentRoot(), 'projects', projectId, 'application-sequence.json')
  const next = Math.max(readLocal<number>(file, 0), readLocal<number>(path.join(agentRoot(), 'projects', projectId, 'candidate-sequence.json'), 0)) + 1
  writeLocal(file, next)
  return next
}
