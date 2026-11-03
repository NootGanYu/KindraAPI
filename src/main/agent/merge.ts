import type { AgentConflictChoice, AgentFieldConflict } from '@shared/agentDraft'
import { stableJson } from '@shared/targetSync'

const missing = Symbol('missing')
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const equal = (a: unknown, b: unknown): boolean => a === missing || b === missing ? a === b : stableJson(a) === stableJson(b)
const clone = (value: unknown): any => value === missing ? missing : structuredClone(value)
const escape = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1')

/** Definitions merge by field; strings (including raw body and scripts) stay atomic. */
export function mergeDefinitions<T>(base: T, current: T, agent: T, choices: Record<string, AgentConflictChoice> = {}): { result: T; conflicts: AgentFieldConflict[] } {
  const conflicts: AgentFieldConflict[] = []
  function conflict(b: unknown, c: unknown, a: unknown, path: string, reason: AgentFieldConflict['reason'] = 'value'): any {
    const id = path || '/'
    const choice = choices[id]
    if (choice) return clone(choice === 'base' ? b : choice === 'agent' ? a : c)
    conflicts.push({ id, path: id, base: b === missing ? undefined : clone(b), current: c === missing ? undefined : clone(c), agent: a === missing ? undefined : clone(a), base_present: b !== missing, current_present: c !== missing, agent_present: a !== missing, reason })
    return clone(c)
  }
  function walk(b: any, c: any, a: any, path: string): any {
    if (equal(c, a)) return clone(c)
    if (equal(b, a)) return clone(c)
    if (equal(b, c)) return clone(a)
    if (isObject(b) && isObject(c) && isObject(a)) {
      const result: Record<string, unknown> = Object.create(null)
      for (const key of new Set([...Object.keys(b), ...Object.keys(c), ...Object.keys(a)])) {
        const value = walk(Object.hasOwn(b, key) ? b[key] : missing, Object.hasOwn(c, key) ? c[key] : missing, Object.hasOwn(a, key) ? a[key] : missing, `${path}/${escape(key)}`)
        if (value !== missing) result[key] = value
      }
      return result
    }
    if (Array.isArray(b) && Array.isArray(c) && Array.isArray(a)) {
      const arrays = [b, c, a]
      const identity = ['param_id', 'case_id', 'event_id'].find(key => arrays.every(items => items.every(item => isObject(item) && typeof item[key] === 'string' && item[key]) && new Set(items.map(item => item[key])).size === items.length))
      if (identity && arrays.some(items => items.length)) {
        const [bi, ci, ai] = arrays.map(items => items.map(item => item[identity] as string))
        const maps = arrays.map(items => new Map(items.map(item => [item[identity] as string, item])))
        const items = new Map<string, unknown>()
        for (const id of new Set([...bi, ...ci, ...ai])) {
          const values = maps.map(map => map.has(id) ? map.get(id) : missing)
          const value = walk(values[0], values[1], values[2], `${path}/${identity}=${escape(id)}`)
          if (value !== missing) items.set(id, value)
        }
        const reordered = (ids: string[]): boolean => !equal(bi.filter(id => ids.includes(id)), ids.filter(id => bi.includes(id)))
        let order: string[]
        if ((!equal(ci, bi) && !equal(ai, bi) && !equal(ci, ai)) || reordered(ci) || reordered(ai)) order = equal(ci, ai) ? ci : conflict(bi, ci, ai, `${path}/$order`, 'order')
        else order = equal(ci, bi) ? ai : ci
        return [...new Set([...order, ...ci, ...ai, ...bi])].filter(id => items.has(id)).map(id => items.get(id))
      }
    }
    return conflict(b, c, a, path)
  }
  return { result: walk(base, current, agent, '') as T, conflicts }
}
