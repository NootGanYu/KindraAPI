/**
 * 把 JSON 文本渲染为带 key/string/number/literal 颜色标记的 HTML。
 * 函数保持自包含（无模块依赖），以便分享页把同一实现注入浏览器脚本。
 */
export function highlightJsonHtml(text: string): string {
  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  const tokenPattern =
    /"(?:\\[\s\S]|[^"\\])*"?|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b/g
  let out = ''
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(text))) {
    out += escapeHtml(text.slice(cursor, match.index))
    const token = match[0]
    let cls = 'l'
    if (token.startsWith('"')) {
      let next = match.index + token.length
      while (next < text.length && /\s/.test(text[next])) next += 1
      cls = text[next] === ':' ? 'k' : 's'
    } else if (/^-?\d/.test(token)) {
      cls = 'n'
    }
    out += `<span class="json-${cls}">${escapeHtml(token)}</span>`
    cursor = match.index + token.length
  }
  out += escapeHtml(text.slice(cursor))
  return out
}
