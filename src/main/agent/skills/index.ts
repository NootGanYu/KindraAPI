import { AgentToolRegistry } from '../core/registry'
import { apiTools } from './api'
import { caseTools } from './case'
import { configTools } from './config'
import { flowTools } from './flow'

/** Stage 1 registers read-only tools only. Mutating skills land in later stages. */
export const readOnlyToolRegistry = new AgentToolRegistry()
  .registerAll(apiTools)
  .registerAll(caseTools)
  .registerAll(flowTools)
  .registerAll(configTools)
