import type { Environment, Flow } from '@shared/types'
import * as store from '../storage/store'

/** Run metadata and execution use the same explicit / Flow / settings / first fallback. */
export function selectFlowEnvironment(projectId: string, flow: Flow, environmentId?: string): Environment | null {
  const environments = store.listEnvironments(projectId)
  const preferred = environmentId || flow.env_id || store.getSettings().environment_id
  return environments.find(environment => environment.env_id === preferred) ?? environments[0] ?? null
}
