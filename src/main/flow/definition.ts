import type { FlowEvent, FlowEventType } from '@shared/types'
import { createFlowEvent } from '@shared/factories'

const eventTypes = new Set<FlowEventType>(['api', 'request', 'script', 'assert', 'if', 'wait', 'begin', 'loop'])
const containerTypes = new Set<FlowEventType>(['if', 'begin', 'loop'])

/** Validate the entire tree before saving. Never filter unknown nodes or rebuild existing IDs. */
export function normalizeFlowEvents(value: unknown): FlowEvent[] {
  if (!Array.isArray(value)) throw new Error('events 必须是数组')
  const ids = new Set<string>()
  function visit(nodes: unknown[]): FlowEvent[] {
    return nodes.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('事件必须是对象')
      const node = raw as Record<string, unknown>
      if (!eventTypes.has(node.type as FlowEventType)) throw new Error(`未知事件类型: ${String(node.type)}`)
      for (const key of ['event_id', 'step_id', 'logical_step_id']) {
        if (node[key] !== undefined && (typeof node[key] !== 'string' || !node[key])) throw new Error(`${key} 必须是非空字符串`)
      }
      if (node.enabled !== undefined && typeof node.enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
      const event = createFlowEvent(node.type as FlowEventType, node as Partial<FlowEvent>)
      if (ids.has(event.event_id)) throw new Error(`重复 event_id: ${event.event_id}`)
      ids.add(event.event_id)
      if (node.children !== undefined) {
        if (!containerTypes.has(event.type)) throw new Error(`${event.type} 不支持 children`)
        if (!Array.isArray(node.children)) throw new Error('children 必须是数组')
        event.children = visit(node.children)
      }
      return event
    })
  }
  return visit(value)
}

export function hasStructuredEvents(events: FlowEvent[]): boolean {
  return events.some(event => containerTypes.has(event.type) || (event.children?.length ?? 0) > 0)
}
