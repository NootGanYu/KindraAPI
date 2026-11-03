/** Apipost 常用脚本 API 通过同一沙箱执行，pm API 保持兼容。 */
export function requestScript(source: string | undefined, enabled?: boolean): string[] {
  if (enabled === false || !source?.trim()) return []
  return [
    'var apt = Object.assign(Object.create(pm), { setRequestHeader: function(key, value) { pm.request.headers.upsert({key: key, value: String(value)}); }, setRequestQuery: function(key, value) { pm.request.url.query.upsert({key: key, value: String(value)}); } });',
    ...source.split('\n')
  ]
}

/** 只写回脚本实际修改的变量；保留运行期间用户修改的值及变量说明。 */
export function mergeScriptVariables<T extends { current_value: string; initial_value: string }>(
  original: Record<string, T>, current: Record<string, T>, before: Record<string, unknown>, after: Record<string, unknown>,
  create: (value: string) => T
): Record<string, T> | null {
  const next = { ...current }
  let changed = false
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (Object.hasOwn(before, key) === Object.hasOwn(after, key) && before[key] === after[key]) continue
    if (JSON.stringify(original[key]) !== JSON.stringify(current[key])) continue
    changed = true
    if (!Object.hasOwn(after, key)) delete next[key]
    else {
      const value = typeof after[key] === 'string' ? after[key] : JSON.stringify(after[key]) ?? ''
      next[key] = current[key] ? { ...current[key], current_value: value } : create(value)
    }
  }
  return changed ? next : null
}
