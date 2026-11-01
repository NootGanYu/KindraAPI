import type { Target } from './types'

export type TargetChangeKind = 'definition' | 'runtime' | 'deleted'
export interface TargetChangeEvent {
  projectId: string
  changes: Array<{ targetId: string; kind: TargetChangeKind }>
  modelsChanged: boolean
  source: 'mcp' | 'ui' | 'system'
  operationId: string
}

export interface TargetSnapshot {
  target: Target | null
  revision: string | null
}

export type TargetSaveOutcome =
  | { status: 'saved'; target: Target; revision: string }
  | { status: 'conflict' | 'deleted'; target: Target | null; revision: string | null }

// 运行结果和历史元数据不属于用户编辑的定义；移动、排序属于定义。
export function targetDefinition(target: Target): Omit<Target, 'updated_at' | 'created_at' | 'version'> {
  const { updated_at, created_at, version, cases, ...definition } = target
  return {
    ...definition,
    ...(cases ? { cases: cases.map(({ last_run, ...item }) => item) } : {})
  }
}

/** 把已保存内容中的用例运行结果并回待保存的草稿；运行结果不属于用户编辑的定义。 */
export function preserveCaseRuns(next: Target, saved: Target | null): Target {
  if (!next.cases?.length || !saved) return next
  return {
    ...next,
    cases: next.cases.map((item) => ({
      ...item,
      last_run: saved.cases?.find((savedItem) => savedItem.case_id === item.case_id)?.last_run
    }))
  }
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
