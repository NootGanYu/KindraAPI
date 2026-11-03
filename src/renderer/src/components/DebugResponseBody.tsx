import { useMemo, useRef, useState } from 'react'
import { App, Input, Select, Tooltip } from 'antd'
import { CopyOutlined, DownloadOutlined, SearchOutlined, CloseOutlined, EnterOutlined, UpOutlined, DownOutlined } from '@ant-design/icons'
import { JsonView, PreviewView } from './ResponseViews'
import { highlightJson, isJsonText } from './JsonCode'

interface Props { body: string; mime: string; base64?: string; charset?: string; filename?: string; truncated?: boolean; actions?: React.ReactNode }
type View = 'pretty' | 'raw' | 'preview' | 'visual' | 'table'
const formats = ['Auto', 'JSON', 'XML', 'HTML', 'Text']
const encodings = ['utf-8', 'gb2312', 'gbk', 'gb18030', 'iso-8859-1']

function formatted(text: string, format: string, mime: string): string {
  const type = format === 'Auto' ? mime : format.toLowerCase()
  if (type.includes('json') || (format === 'Auto' && /^[\s]*[\[{]/.test(text))) {
    try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
  }
  if (type.includes('xml')) {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (!doc.querySelector('parsererror')) {
      const serialize = (node: Node, depth = 0): string => {
        const prefix = '  '.repeat(depth)
        if (!node.childNodes.length || [...node.childNodes].some(child => child.nodeType === 3 && child.textContent?.trim())) return prefix + new XMLSerializer().serializeToString(node)
        const children = [...node.childNodes].filter(child => child.nodeType !== 3 || child.textContent?.trim())
        const shell = new XMLSerializer().serializeToString(node.cloneNode(false)).replace(/\s*\/>$/, '>')
        return `${prefix}${shell}\n${children.map(child => serialize(child, depth + 1)).join('\n')}\n${prefix}</${node.nodeName}>`
      }
      return serialize(doc.documentElement)
    }
  }
  return text
}

export default function DebugResponseBody({ body, mime, base64, charset, filename = 'response', truncated, actions }: Props): JSX.Element {
  const { message } = App.useApp()
  const [view, setView] = useState<View>('pretty')
  const [format, setFormat] = useState('Auto')
  const [encoding, setEncoding] = useState(charset || 'utf-8')
  const [wrap, setWrap] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [match, setMatch] = useState(0)
  const code = useRef<HTMLPreElement>(null)
  const bytes = useMemo(() => base64 ? Uint8Array.from(atob(base64), c => c.charCodeAt(0)) : undefined, [base64])
  const decoded = useMemo(() => {
    try { return bytes ? new TextDecoder(encoding).decode(bytes) : body } catch { return body }
  }, [bytes, body, encoding])
  const text = view === 'pretty' ? formatted(decoded, format, mime) : decoded
  const positions = useMemo(() => {
    const list: number[] = []
    if (query && searching) {
      const source = text.toLowerCase(), needle = query.toLowerCase()
      let start = 0, found: number
      while ((found = source.indexOf(needle, start)) >= 0 && list.length < 5000) { list.push(found); start = found + needle.length }
    }
    return list
  }, [text, query, searching])
  const selected = positions.length ? match % positions.length : 0
  const move = (delta: number): void => {
    if (!positions.length) return
    const next = (selected + delta + positions.length) % positions.length
    setMatch(next)
    requestAnimationFrame(() => code.current?.querySelectorAll('mark')[next]?.scrollIntoView({ block: 'nearest' }))
  }
  const highlighted = (): React.ReactNode => {
    if (!positions.length) {
      return isJsonText(text) ? highlightJson(text) : text || '(空响应体)'
    }
    const chunks: React.ReactNode[] = []; let cursor = 0
    positions.forEach((position, index) => {
      chunks.push(text.slice(cursor, position), <mark key={position} className={index === selected ? 'current' : ''}>{text.slice(position, position + query.length)}</mark>)
      cursor = position + query.length
    })
    chunks.push(text.slice(cursor))
    return chunks
  }
  const previewMime = format === 'HTML' ? 'text/html' : format === 'XML' ? 'application/xml' : mime
  return <div className="debug-response-body">
    <div className="resp-toolbar debug-response-toolbar">
      {([['pretty', '美化'], ['raw', '原生'], ['preview', '预览'], ['visual', '可视化'], ['table', '表格']] as const).map(([key, label]) =>
        <button key={key} className={view === key ? 'on' : ''} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
      <Select aria-label="响应显示格式" size="small" value={format} onChange={setFormat} options={formats.map(value => ({ value, label: value }))} />
      <Select aria-label="响应编码" size="small" value={encoding} disabled={!bytes} onChange={setEncoding} options={[...new Set([charset || 'utf-8', ...encodings])].map(value => ({ value, label: value.toUpperCase() }))} />
      <span className="debug-response-spacer" />
      {actions}
      <Tooltip title="搜索响应"><button aria-label="搜索响应" aria-pressed={searching} onClick={() => { setSearching(!searching); setView('pretty') }}><SearchOutlined /></button></Tooltip>
      <Tooltip title="复制响应体"><button aria-label="复制响应体" onClick={async () => { const result = await window.api.app.copyText(decoded); result.ok ? message.success('响应体已复制') : message.error(result.error) }}><CopyOutlined /></button></Tooltip>
      <Tooltip title="换行展示"><button aria-label="换行展示" aria-pressed={wrap} className={wrap ? 'on' : ''} onClick={() => setWrap(!wrap)}><EnterOutlined /></button></Tooltip>
      <Tooltip title="下载响应"><button aria-label="下载响应" onClick={() => {
        const extension = mime.includes('json') ? 'json' : mime.includes('xml') ? 'xml' : mime.includes('html') ? 'html' : mime.startsWith('image/') ? mime.split('/')[1].split('+')[0] : 'txt'
        const url = URL.createObjectURL(new Blob([bytes ?? decoded], { type: mime || 'text/plain' }))
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename.replace(/[^\p{L}\p{N}_.-]/gu, '_')}${truncated ? '.partial' : ''}.${extension}`; anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}><DownloadOutlined /></button></Tooltip>
    </div>
    {searching && <div className="debug-response-search">
      <Input size="small" autoFocus placeholder="搜索响应内容" aria-label="搜索响应内容" value={query} onChange={event => { setQuery(event.target.value); setMatch(0) }} onPressEnter={event => move(event.shiftKey ? -1 : 1)} />
      <span aria-live="polite">{positions.length ? selected + 1 : 0}/{positions.length}{positions.length === 5000 ? '+' : ''}</span>
      <button aria-label="上一个匹配" disabled={!positions.length} onClick={() => move(-1)}><UpOutlined /></button>
      <button aria-label="下一个匹配" disabled={!positions.length} onClick={() => move(1)}><DownOutlined /></button>
      <button aria-label="关闭搜索" onClick={() => setSearching(false)}><CloseOutlined /></button>
    </div>}
    {view === 'preview' ? <PreviewView mime={previewMime} body={decoded} base64={truncated ? undefined : base64} /> : view === 'visual' || view === 'table' ? <JsonView mode={view} body={decoded} /> :
      <pre ref={code} className={`resp-code debug-response-code${wrap ? ' wrap' : ''}`}>{highlighted()}</pre>}
  </div>
}
