import type { Flow } from './types'
import { stableJson } from './targetSync'
export function flowDefinition(flow: Flow): Omit<Flow, 'created_at' | 'updated_at'> {
  const { created_at: _created, updated_at: _updated, ...definition } = flow
  return definition
}
export const flowSignature = (flow: Flow): string => stableJson(flowDefinition(flow))

export interface FlowVersion {
  version_id: string
  version: number
  revision: string
  flow: Flow
  created_at: string
}
export interface FlowSnapshot { flow: Flow | null; revision: string | null }
export type FlowSaveResult = { status: 'saved'; flow: Flow; revision: string; version: FlowVersion } | ({ status: 'conflict' | 'deleted' } & FlowSnapshot)
