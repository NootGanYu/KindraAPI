import { AgentToolRegistry } from '../core/registry'
import { apiTools } from './api'
import { caseTools } from './case'
import { configTools } from './config'
import { flowTools } from './flow'

/** Read tools plus stage-2 local draft/candidate tools. Execution/save tools land later. */
export const agentToolRegistry = new AgentToolRegistry()
  .registerAll(apiTools)
  .registerAll(caseTools)
  .registerAll(flowTools)
  .registerAll(configTools)
