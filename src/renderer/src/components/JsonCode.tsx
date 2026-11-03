import type { ReactNode } from 'react'

const TOKEN_PATTERN =
  /"(?:\\[\s\S]|[^"\\])*"?|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b/g

/** JSON 着色：键、字符串、数字、字面量使用统一色板，供编辑层与只读预览共用。 */
export function highlightJson(text: string): ReactNode[] {
  const result: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const start = match.index!
    const token = match[0]
    result.push(text.slice(cursor, start))
    cursor = start + token.length
    let kind: string
    if (token.startsWith('"')) {
      let next = cursor
      while (next < text.length && /\s/.test(text[next])) next++
      kind = text[next] === ':' ? 'key' : 'string'
    } else {
      kind = /^-?\d/.test(token) ? 'number' : 'literal'
    }
    result.push(
      <span key={start} className={`json-code-${kind}`}>
        {token}
      </span>
    )
  }
  result.push(text.slice(cursor))
  return result
}

export function isJsonText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || !/^[[{]/.test(trimmed)) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

interface Props {
  text: string
  className?: string
}

export default function JsonCode({ text, className = '' }: Props): JSX.Element {
  return (
    <pre className={`json-code-block${className ? ` ${className}` : ''}`}>
      {highlightJson(text)}
    </pre>
  )
}
