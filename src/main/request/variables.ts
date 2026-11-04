import { stableJson } from '@shared/targetSync'
import type { Environment, GlobalVars } from '@shared/types'
import * as store from '../storage/store'

/** Mutable only inside an approved run. Persistence uses the original disk baseline, never blind replacement. */
export interface ExecutionVariables {
  values: { environment: Record<string, unknown>; globals: Record<string, unknown> }
  baseline: ExecutionVariables['values']
  environment: Environment | null
  globals: GlobalVars
}
export function createExecutionVariables(environment: Environment | null, globals: GlobalVars, baseUrl = ''): ExecutionVariables {
  const values = {
    environment: Object.fromEntries(Object.entries(environment?.env_var_list ?? {}).filter(([, v]) => v.is_checked > 0).map(([key, v]) => [key, v.current_value ?? v.initial_value])),
    globals: Object.fromEntries(Object.entries(globals.vars).map(([key, v]) => [key, v.current_value ?? v.initial_value]))
  }
  if (baseUrl && values.environment.baseUrl === undefined) values.environment.baseUrl = baseUrl
  return { values, baseline: structuredClone(values), environment: structuredClone(environment), globals: structuredClone(globals) }
}
export function persistExecutionVariables(projectId: string, state: ExecutionVariables): void {
  const env = state.environment ? store.listEnvironments(projectId).find(e => e.env_id === state.environment!.env_id) : null
  if (state.environment && !env) throw new Error('获批环境已删除，变量写回暂停')
  const globals = store.getGlobalVars(projectId)
  const merge = <T extends { current_value: string; initial_value: string }>(before: Record<string, unknown>, after: Record<string, unknown>, original: Record<string, T>, current: Record<string, T>, environment: boolean): Record<string, T> => {
    const result = structuredClone(current)
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (Object.hasOwn(before, key) === Object.hasOwn(after, key) && stableJson(before[key]) === stableJson(after[key])) continue
      if (stableJson(original[key]) !== stableJson(current[key])) throw new Error(`变量 ${key} 已被外部修改，差量写回暂停`)
      if (!Object.hasOwn(after, key)) delete result[key]
      else result[key] = { ...(current[key] ?? { initial_value: '', ...(environment ? { is_checked: 1 } : {}) }), current_value: typeof after[key] === 'string' ? after[key] : JSON.stringify(after[key]) ?? '' } as T
    }
    return result
  }
  if (!env && stableJson(state.baseline.environment) !== stableJson(state.values.environment)) throw new Error('没有获批环境，环境变量写回暂停')
  const envValues = env ? merge(state.baseline.environment, state.values.environment, state.environment!.env_var_list, env.env_var_list, true) : null
  const globalValues = merge(state.baseline.globals, state.values.globals, state.globals.vars, globals.vars, false)
  // Validate all scopes before any write; unrelated external changes remain intact.
  if (env && envValues && stableJson(envValues) !== stableJson(env.env_var_list)) store.saveEnvironment(projectId, { ...env, env_var_list: envValues })
  if (stableJson(globalValues) !== stableJson(globals.vars)) store.saveGlobalVars(projectId, { ...globals, vars: globalValues })
  state.environment = env && envValues ? { ...env, env_var_list: envValues } : null
  state.globals = { ...globals, vars: globalValues }; state.baseline = structuredClone(state.values)
}
