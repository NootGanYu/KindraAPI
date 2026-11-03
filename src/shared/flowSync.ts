import type { Flow } from './types'
import { stableJson } from './targetSync'
export function flowDefinition(flow: Flow): Omit<Flow, 'created_at' | 'updated_at'> {
  const { created_at: _created, updated_at: _updated, ...definition } = flow
  return definition
}
export const flowSignature = (flow: Flow): string => stableJson(flowDefinition(flow))
