import { AgentToolRegistry } from '../core/registry'
import { apiTools } from './api'
import { caseTools } from './case'
import { configTools } from './config'
import { executionTools } from './execution'
import { flowTools } from './flow'
import { saveTools } from './save'

/** Read, local draft, execution and formal save/delete tools. */
export const agentToolRegistry = new AgentToolRegistry()
  .registerAll(apiTools)
  .registerAll(caseTools)
  .registerAll(flowTools)
  .registerAll(configTools)
  .registerAll(executionTools)
  .registerAll(saveTools)
