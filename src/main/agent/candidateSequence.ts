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
