import type { FlowEvent, FlowEventResult } from '@shared/types'

/** Tracks evidence, never guesses data dependencies by inspecting scripts. */
export class FlowDependencies {
  private outcomes = new Map<string, FlowEventResult['status']>()
  private groups = new Map<string, string[]>()
  private membership = new Map<string, string>()
  private failedGroups = new Set<string>()

  constructor(events: FlowEvent[]) {
    const visit = (list: FlowEvent[]): void => {
      for (const event of list) {
        if (event.logical_step_id) {
          this.membership.set(event.event_id, event.logical_step_id)
          this.groups.set(event.logical_step_id, [...(this.groups.get(event.logical_step_id) ?? []), event.event_id])
        }
        visit(event.children ?? [])
      }
    }
    visit(events)
  }

  blockedReason(event: FlowEvent, previous: FlowEventResult[]): string | undefined {
    if (!event.enabled) return
    const group = this.membership.get(event.event_id)
    if (group && this.failedGroups.has(group)) return '同一逻辑步骤已有失败或依赖阻塞，不能继续执行'
    if (event.depends_on === undefined) {
      if (previous.some(item => item.status === 'failed' || item.status === 'blocked')) return '前序步骤失败或被阻塞；未声明独立依赖，按保守顺序阻塞'
      return
    }
    for (const dependency of event.depends_on) {
      const dependencyGroup = this.membership.get(dependency)
      const members = dependencyGroup && dependencyGroup !== group ? this.groups.get(dependencyGroup)! : [dependency]
      if (members.some(id => this.outcomes.get(id) !== 'passed')) return `依赖步骤尚未成功完成：${dependency}`
    }
  }

  record(result: FlowEventResult): void {
    const previous = this.outcomes.get(result.event_id)
    // A later loop iteration cannot erase a failed prerequisite from an earlier one.
    if (previous !== 'failed' && previous !== 'blocked') this.outcomes.set(result.event_id, result.status)
    if (result.status === 'failed' || result.status === 'blocked') {
      const group = this.membership.get(result.event_id)
      if (group) this.failedGroups.add(group)
    }
    for (const child of result.children ?? []) this.record(child)
  }
}
