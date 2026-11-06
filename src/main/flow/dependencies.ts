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
        const group = event.logical_step_id || event.step_id
        if (group) {
          this.membership.set(event.event_id, group)
          this.groups.set(group, [...(this.groups.get(group) ?? []), event.event_id])
        }
        visit(event.children ?? [])
      }
    }
    visit(events)
  }

  blockedReason(event: FlowEvent, previous: FlowEventResult[], iterationPath: FlowEventResult['iteration_path']): string | undefined {
    if (!event.enabled) return
    const group = this.membership.get(event.event_id)
    if (group && this.failedGroups.has(group)) return '同一逻辑步骤已有失败或依赖阻塞，不能继续执行'
    if (event.depends_on === undefined) {
      // Only adjacent members of this execution instance inherit group admission.
      if (group) {
        for (let index = previous.length - 1; index >= 0; index--) {
          const preceding = previous[index]
          if (this.membership.get(preceding.event_id) !== group ||
            JSON.stringify(preceding.iteration_path) !== JSON.stringify(iterationPath)) break
          if (preceding.status === 'passed') return
        }
      }
      if (previous.some(item => item.status === 'failed' || item.status === 'blocked')) return '前序步骤失败或被阻塞；未声明独立依赖，按保守顺序阻塞'
      return
    }
    for (const dependency of event.depends_on) {
      const dependencyGroup = this.membership.get(dependency)
      const members = dependencyGroup && dependencyGroup !== group ? this.groups.get(dependencyGroup)! : [dependency]
      if (this.outcomes.get(dependency) !== 'passed' || members.some(id => !['passed', 'skipped'].includes(this.outcomes.get(id) ?? ''))) return `依赖步骤尚未成功完成：${dependency}`
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
