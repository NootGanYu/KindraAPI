import { useState } from 'react'

function pretty(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

export function PreviewView({ mime, body, base64 }: { mime: string; body: string; base64?: string }): JSX.Element {
  const type = mime.toLowerCase()
  if (type.includes('html') || type.includes('svg')) {
    return (
      <iframe className="resp-preview-frame" sandbox="" srcDoc={body} title="响应预览" />
    )
  }
  if (type.includes('markdown')) {
    return (
      <iframe
        className="resp-preview-frame"
        sandbox=""
        srcDoc={markdownPage(markdownToHtml(body))}
        title="Markdown 预览"
      />
    )
  }
  if (type.startsWith('image/')) {
    if (base64) return <div className="debug-image-preview"><img src={`data:${type};base64,${base64}`} alt="响应图片" /></div>
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        图片响应暂不支持预览，请切换到「原生」查看。
      </div>
    )
  }
  return <pre className="resp-code">{pretty(body)}</pre>
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    )
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inCode = false
  let code: string[] = []
  let listType: 'ul' | 'ol' | null = null
  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^```/.test(line.trim())) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = []
        inCode = false
      } else {
        closeList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }
    if (!line.trim()) {
      closeList()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    if (/^---+$/.test(line.trim())) {
      closeList()
      out.push('<hr/>')
      continue
    }
    if (/^>\s?/.test(line)) {
      closeList()
      out.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`)
      continue
    }
    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      /^[\s|:-]+$/.test(lines[index + 1]) &&
      lines[index + 1].includes('-')
    ) {
      closeList()
      const cells = (row: string): string[] => {
        const items = row.split('|').map((item) => item.trim())
        if (items[0] === '') items.shift()
        if (items[items.length - 1] === '') items.pop()
        return items
      }
      const header = cells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(cells(lines[index]))
        index += 1
      }
      index -= 1
      out.push(
        `<table><thead><tr>${header
          .map((item) => `<th>${inlineMarkdown(item)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${row.map((item) => `<td>${inlineMarkdown(item)}</td>`).join('')}</tr>`
          )
          .join('')}</tbody></table>`
      )
      continue
    }
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (unordered) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul>')
        listType = 'ul'
      }
      out.push(`<li>${inlineMarkdown(unordered[1])}</li>`)
      continue
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol>')
        listType = 'ol'
      }
      out.push(`<li>${inlineMarkdown(ordered[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inlineMarkdown(line)}</p>`)
  }
  closeList()
  if (inCode && code.length > 0) {
    out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  }
  return out.join('\n')
}

function markdownPage(html: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<style>
  body { margin:0; padding:22px 24px; background:#fffdf8; color:#3e3324;
    font-family:-apple-system,"PingFang SC",sans-serif; font-size:13px; line-height:1.75; }
  h1,h2,h3,h4,h5,h6 { color:#2c2214; margin:18px 0 8px; line-height:1.35; }
  h1 { font-size:22px; } h2 { font-size:17px; } h3 { font-size:15px; }
  p { margin:8px 0; }
  code { background:#f3ead8; color:#7a5c30; padding:1px 5px; border-radius:3px;
    font-family:ui-monospace,Menlo,monospace; font-size:12px; }
  pre { background:#faf5ea; border:1px solid #e6dcc8; border-radius:5px; padding:12px;
    overflow:auto; }
  pre code { background:transparent; padding:0; color:#3d352a; }
  blockquote { margin:10px 0; padding:8px 12px; border-left:3px solid #c8a25e;
    background:#faf5ea; color:#6b5d48; }
  table { border-collapse:collapse; width:100%; margin:12px 0; font-size:12px; }
  th { text-align:left; background:#faf5ea; color:#8e8069; padding:7px 8px;
    border-bottom:1px solid #e6dcc8; }
  td { padding:7px 8px; border-bottom:1px solid #f3ecdd; }
  hr { border:none; border-top:1px solid #e6dcc8; margin:16px 0; }
  a { color:#8a6b3b; }
</style></head><body>${html}</body></html>`
}

export function JsonView({ mode, body }: { mode: 'visual' | 'table'; body: string }): JSX.Element {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        响应体不是合法 JSON，无法{mode === 'visual' ? '可视化' : '转表格'}。
      </div>
    )
  }
  if (mode === 'visual') {
    return (
      <div className="json-tree">
        <JsonNode name="root" value={value} depth={0} />
      </div>
    )
  }
  const rows = extractRows(value)
  if (!rows || rows.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        未找到可表格化的数组数据。
      </div>
    )
  }
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return (
    <div className="resp-data-wrap">
      <table className="resp-data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{cellText(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JsonNode({
  name,
  value,
  depth
}: {
  name: string
  value: unknown
  depth: number
}): JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const indent = { paddingLeft: depth * 14 }

  if (value === null || typeof value !== 'object') {
    const type = value === null ? 'null' : typeof value
    const text =
      value === null
        ? 'null'
        : typeof value === 'string'
          ? `"${value}"`
          : String(value)
    return (
      <div className="json-leaf" style={indent}>
        <span className="json-key">{name}</span>
        <span className="json-colon">: </span>
        <span className={`json-val json-${type}`}>{text}</span>
      </div>
    )
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>)
  const openBracket = Array.isArray(value) ? '[' : '{'
  const closeBracket = Array.isArray(value) ? ']' : '}'

  return (
    <div className="json-node">
      <div
        className="json-branch"
        style={indent}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setOpen((current) => !current)
        }}
      >
        <span className="json-toggle">{open ? '▾' : '▸'}</span>
        <span className="json-key">{name}</span>
        <span className="json-colon">: </span>
        <span className="json-bracket">{openBracket}</span>
        <span className="json-count">
          {entries.length} {Array.isArray(value) ? 'items' : 'keys'}
        </span>
        {open ? null : <span className="json-bracket">{closeBracket}</span>}
      </div>
      {open ? (
        <>
          {entries.map(([key, item]) => (
            <JsonNode key={key} name={key} value={item} depth={depth + 1} />
          ))}
          <div className="json-branch" style={indent}>
            <span className="json-bracket">{closeBracket}</span>
          </div>
        </>
      ) : null}
    </div>
  )
}

function extractRows(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    if (
      value.length > 0 &&
      value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
    ) {
      return value as Record<string, unknown>[]
    }
    return null
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['records', 'list', 'items', 'rows', 'data', 'content']) {
      const found = extractRows(record[key])
      if (found) return found
    }
    for (const item of Object.values(record)) {
      const found = extractRows(item)
      if (found) return found
    }
  }
  return null
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
