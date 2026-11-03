import type { FlowRun } from '@shared/types'
import * as store from '../storage/store'
import { runFlow } from './engine'

/** UI 和 MCP 共用已保存流程入口；调用方仍各自负责身份与权限检查。 */
export async function runSavedFlow(
  projectId: string,
  flowId: string,
  environmentId?: string
): Promise<FlowRun> {
  const flow = store.getFlow(projectId, flowId)
  if (!flow) throw new Error('流程不存在')
  return runFlow(projectId, flow, environmentId)
}
