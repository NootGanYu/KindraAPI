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
  const events = visit(value)
  validateFlowDependencies(events)
  return events
}

export function hasStructuredEvents(events: FlowEvent[]): boolean {
  return events.some(event => containerTypes.has(event.type) || (event.children?.length ?? 0) > 0)
}

/** Includes implicit sequence/group edges so explicit declarations cannot hide a cycle. */
function validateFlowDependencies(events: FlowEvent[]): void {
  const nodes = new Map<string, FlowEvent>()
  const groups = new Map<string, string[]>()
  const edges = new Map<string, Set<string>>()
  function collect(list: FlowEvent[]): void {
    const previous: string[] = []
    for (const event of list) {
      nodes.set(event.event_id, event)
      if (event.depends_on !== undefined && (!Array.isArray(event.depends_on) || event.depends_on.some(id => typeof id !== 'string' || !id))) {
        throw new Error('depends_on 必须是非空 event_id 的数组；空数组表示明确独立')
      }
      const deps = new Set(event.depends_on ?? previous)
      if (event.logical_step_id) {
        const members = groups.get(event.logical_step_id) ?? []
        members.forEach(id => deps.add(id))
        members.push(event.event_id)
        groups.set(event.logical_step_id, members)
      }
      for (const child of event.children ?? []) deps.add(child.event_id)
      edges.set(event.event_id, deps)
      collect(event.children ?? [])
      previous.push(event.event_id)
    }
  }
  collect(events)
  for (const [id, dependencies] of edges) {
    for (const dependency of [...dependencies]) {
      const target = nodes.get(dependency)
      if (!target) throw new Error(`依赖事件不存在：${dependency}`)
      if (target.logical_step_id && target.logical_step_id !== nodes.get(id)?.logical_step_id) {
        for (const member of groups.get(target.logical_step_id) ?? []) dependencies.add(member)
      }
    }
  }
  const visited = new Set<string>(), visiting = new Set<string>()
  function check(id: string): void {
    if (visiting.has(id)) throw new Error(`流程存在依赖环：${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of edges.get(id) ?? []) check(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of nodes.keys()) check(id)
}
