/** 各处请求方式共用 Apipost 的语义色；紧凑列表缩写不改变实际 HTTP 方法。 */
export function methodColor(method = 'GET'): string {
  return ({ GET: '#22cea4', POST: '#ffb401', PUT: '#057bed', DELETE: '#ff583e', PATCH: '#30c5a6', HEAD: '#00b8d9', OPTIONS: '#7266ba', SSE: '#00cfff' } as Record<string, string>)[method.toUpperCase()] ?? '#8e8069'
}
export function methodLabel(method = 'GET', compact = false): string {
  const value = method.toUpperCase()
  return compact ? ({ DELETE: 'DEL', PATCH: 'PAT' } as Record<string, string>)[value] ?? value : value
}
