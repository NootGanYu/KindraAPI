import * as store from '../storage/store'
import type { ProjectRedactor } from './redaction'

export interface ActiveObjectInput {
  targetId?: string
  flowId?: string
  envId?: string
}

export interface ProjectContextInput {
  projectId: string
  active?: ActiveObjectInput
  /** Redacts names/descriptions before they reach the model. */
  redact?: ProjectRedactor
}

const MAX_APIS = 200
const MAX_FLOWS = 100
const MAX_ENVIRONMENTS = 50

/**
 * A catalog, not a definition dump: ids, names and routing
 * (method/type) only. Definitions and URLs are fetched with get_* tools.
 */
export function buildProjectContext(input: ProjectContextInput): string {
  const targets = store.listTargets(input.projectId)
  const folders = targets.filter(target => target.target_type === 'folder')
  const apis = targets.filter(target => target.target_type === 'api')
  const flows = store.listFlows(input.projectId)
  const environments = store.listEnvironments(input.projectId)
  const active = input.active ?? {}
  const activeTarget = active.targetId ? store.getTarget(input.projectId, active.targetId) : null
  const activeFlow = active.flowId ? store.getFlow(input.projectId, active.flowId) : null
  const activeEnv = active.envId ? environments.find(item => item.env_id === active.envId) : null
  const catalog = {
    note: '这里只有项目目录。接口/Flow/环境的具体定义、URL 与变量值必须通过只读工具按需读取；环境与全局变量值不会提供。',
    folders: folders.slice(0, MAX_APIS).map(item => ({ id: item.target_id, name: item.name })),
    apis: apis.slice(0, MAX_APIS).map(item => ({ id: item.target_id, name: item.name, method: item.method ?? '', parent_id: item.parent_id })),
    flows: flows.slice(0, MAX_FLOWS).map(item => ({ id: item.flow_id, name: item.name })),
    environments: environments.slice(0, MAX_ENVIRONMENTS).map(item => ({ id: item.env_id, name: item.name })),
    ...(targets.length > MAX_APIS ? { truncated_targets: targets.length - MAX_APIS } : {}),
    ...(flows.length > MAX_FLOWS ? { truncated_flows: flows.length - MAX_FLOWS } : {}),
    ...(environments.length > MAX_ENVIRONMENTS ? { truncated_environments: environments.length - MAX_ENVIRONMENTS } : {}),
    active: {
      ...(activeTarget ? { target: { id: activeTarget.target_id, name: activeTarget.name, type: activeTarget.target_type, method: activeTarget.method ?? '' } } : {}),
      ...(activeFlow ? { flow: { id: activeFlow.flow_id, name: activeFlow.name } } : {}),
      ...(activeEnv ? { environment: { id: activeEnv.env_id, name: activeEnv.name } } : {})
    }
  }
  const text = JSON.stringify(catalog, null, 2)
  return input.redact ? input.redact.stream(text) : text
}
