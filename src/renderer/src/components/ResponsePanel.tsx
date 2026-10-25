import { useEffect, useMemo, useState } from 'react'
import { App as AntApp, Tag, Tooltip } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import type { ModelSummary, Param, ResponseExample, SendRecord } from '@shared/types'
import { createId } from '@shared/factories'
import ModelPickerModal from './schemas/ModelPickerModal'

type ViewMode = 'pretty' | 'raw' | 'preview' | 'visual' | 'table'

interface Props {
  record: SendRecord | null
  examples?: ResponseExample[]
  loading?: boolean
  projectId?: string
  onChangeExamples?: (examples: ResponseExample[]) => void
}

const TABS = ['实时响应', '响应头', 'Cookie', '响应示例', '实际请求', '控制台']

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function formatSize(size?: number): string {
  if (!size) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function RocketIllustration(): JSX.Element {
  return (
    <svg
      width="76"
      height="76"
      viewBox="0 0 76 76"
      fill="none"
      stroke="#c9bfa9"
      strokeWidth="1.15"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M38 11c8.5 6.2 12.5 15.5 12.5 25L45 44H31l-5.5-8c0-9.5 4-18.8 12.5-25z" />
      <circle cx="38" cy="28" r="4.2" />
      <path d="M31 44l-6.5 10.5L38 51l13.5 3.5L45 44" />
      <path d="M18 25c10-5.5 30-5.5 40 0" opacity=".45" />
      <path
        d="M55 15l1.3 3.2L59.5 19l-3.2 1.3L55 23.5l-1.3-3.2L50.5 19l3.2-.8z"
        opacity=".55"
      />
      <circle cx="20" cy="47" r="1.2" opacity=".6" />
      <circle cx="58" cy="45" r="1.5" opacity=".55" />
    </svg>
  )
}

function HeaderTable({ rows }: { rows: Array<[string, string]> }): JSX.Element {
  if (rows.length === 0) {
    return <div className="muted" style={{ padding: 12, fontSize: 12 }}>（无）</div>
  }
  return (
    <table className="simple-table">
      <thead>
        <tr>
          <th>名称</th>
          <th>值</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, value], index) => (
          <tr key={`${name}-${index}`}>
            <td>{name}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ResponsePanel({
  record,
  examples,
  loading,
  projectId,
  onChangeExamples
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [viewMode, setViewMode] = useState<ViewMode>('pretty')
  const [activeTab, setActiveTab] = useState('实时响应')
  const [models, setModels] = useState<ModelSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelWarning, setModelWarning] = useState('')

  const response = record?.response ?? null
  const ok = response && !record?.error
  const bodyText = response?.body ?? ''

  const copyText = async (text: string): Promise<void> => {
    try {
      const result = await window.api.app.copyText(text)
      if (!result.ok) throw new Error(result.error)
      message.success('响应体已复制')
    } catch {
      try {
        await navigator.clipboard.writeText(text)
        message.success('响应体已复制')
      } catch {
        message.error('复制失败')
      }
    }
  }
  const example =
    (examples ?? []).find((item) => item.expect?.is_default === 1) ?? (examples ?? [])[0] ?? null
  const toRows = (params?: Param[]): Array<[string, string]> =>
    (params ?? []).map((item) => [item.key, item.value])

  useEffect(() => {
    if (!projectId) return
    let active = true
    window.api.models
      .list(projectId)
      .then((result) => {
        if (active && result.ok) setModels(result.data)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [projectId])

  const exampleModelId = example?.expect?.model_id
  const referencedModel = useMemo(
    () => models.find((model) => model.model_id === exampleModelId),
    [models, exampleModelId]
  )
  const modelMissing = Boolean(exampleModelId) && !referencedModel

  useEffect(() => {
    if (!exampleModelId || !projectId || !onChangeExamples || !example) return
    let active = true
    window.api.models
      .generateExample(projectId, exampleModelId)
      .then((result) => {
        if (!active) return
        if (!result.ok) {
          setModelWarning(result.error)
          return
        }
        setModelWarning(result.data.warnings[0]?.message ?? '')
        const raw = JSON.stringify(result.data.value, null, 2)
        if (raw !== (example.raw ?? '')) {
          onChangeExamples(
            (examples ?? []).map((item) =>
              item.example_id === example.example_id ? { ...item, raw } : item
            )
          )
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exampleModelId, example?.raw, projectId])

  const selectExampleModel = async (model: ModelSummary): Promise<void> => {
    if (!projectId) return
    const result = await window.api.models.generateExample(projectId, model.model_id)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    if (result.data.warnings.length > 0) message.warning(result.data.warnings[0].message)
    const nextExample: ResponseExample = {
      ...(example ?? {
        example_id: createId('ex'),
        raw_parameter: [],
        headers: [],
        cookies: []
      }),
      expect: {
        ...(example?.expect ?? {
          name: '模型示例',
          code: 200,
          content_type: 'application/json',
          is_default: 1
        }),
        name: model.name,
        code: example?.expect?.code ?? 200,
        content_type: 'application/json',
        is_default: 1,
        model_id: model.model_id
      },
      raw: JSON.stringify(result.data.value, null, 2)
    }
    const nextList = example
      ? (examples ?? []).map((item) =>
          item.example_id === example.example_id ? nextExample : item
        )
      : [...(examples ?? []), nextExample]
    onChangeExamples?.(nextList)
    setPickerOpen(false)
  }

  const clearExampleModel = (): void => {
    if (!example) return
    const nextExpect = { ...(example.expect ?? {}) }
    delete nextExpect.model_id
    onChangeExamples?.(
      (examples ?? []).map((item) =>
        item.example_id === example.example_id
          ? { ...item, expect: nextExpect }
          : item
      )
    )
  }

  const editExampleModel = (): void => {
    modal.confirm({
      title: '编辑将解除模型引用',
      content: '解除后保留当前生成的示例 JSON，可继续手动维护。',
      okText: '解除并编辑',
      cancelText: '取消',
      onOk: () => clearExampleModel()
    })
  }

  const renderContent = (): JSX.Element => {
    if (activeTab === '响应示例') {
      const referenceBar =
        projectId && onChangeExamples ? (
          <div className="body-model-bar" style={{ marginBottom: 8 }}>
            {exampleModelId ? (
              <>
                {modelMissing ? (
                  <Tag color="error">模型已删除</Tag>
                ) : (
                  <Tag color="gold">模型 · {referencedModel?.name}</Tag>
                )}
                <span className="muted">按模型实时生成，只读</span>
                <span style={{ flex: 1 }} />
                <Tooltip title="解除引用后保留当前 JSON">
                  <button className="mini" onClick={editExampleModel}>
                    编辑
                  </button>
                </Tooltip>
                <button className="mini" onClick={clearExampleModel}>
                  解除引用
                </button>
              </>
            ) : (
              <>
                <button className="mini" onClick={() => setPickerOpen(true)}>
                  引用模型
                </button>
                <span className="muted">关联模型后实时生成示例 JSON</span>
              </>
            )}
          </div>
        ) : null

      if (!example) {
        return (
          <div className="resp-filled">
            {referenceBar}
            <div className="resp-empty" style={{ paddingBottom: 0, minHeight: 180 }}>
              <RocketIllustration />
              <span>暂无响应示例</span>
            </div>
          </div>
        )
      }
      const raw = example.raw ?? ''
      return (
        <div className="resp-filled">
          {referenceBar}
          {modelWarning ? (
            <div className="muted" style={{ color: '#a47400', marginBottom: 8, fontSize: 11 }}>
              {modelWarning}
            </div>
          ) : null}
          <div className="resp-meta">
            <span className="method-text">{example.expect?.code ?? '200'}</span>
            <span>{example.expect?.name ?? '示例'}</span>
            <span className="muted">{example.expect?.content_type}</span>
          </div>
          {viewMode === 'pretty' ? (
            <pre className="resp-code">{pretty(raw) || '(空响应示例)'}</pre>
          ) : viewMode === 'raw' ? (
            <pre className="resp-code">{raw || '(空响应示例)'}</pre>
          ) : viewMode === 'preview' ? (
            <PreviewView mime={String(example.expect?.content_type ?? '')} body={raw} />
          ) : (
            <JsonView mode={viewMode} body={raw} />
          )}
        </div>
      )
    }

    if (!record && !example) {
      return (
        <div className="resp-empty">
          <RocketIllustration />
          <span>{loading ? '请求中…' : '请输入url点击发送按钮获取响应结果'}</span>
        </div>
      )
    }

    if (activeTab === '响应头') {
      const rows = response
        ? Object.entries(response.headers ?? {})
        : toRows(example?.headers)
      return (
        <div className="resp-filled">
          <HeaderTable rows={rows} />
        </div>
      )
    }
    if (activeTab === 'Cookie') {
      const rows: Array<[string, string]> = response
        ? (response.cookies ?? []).map(
            (cookie): [string, string] => [
              String(cookie.name ?? ''),
              String(cookie.value ?? '')
            ]
          )
        : toRows(example?.cookies)
      return (
        <div className="resp-filled">
          <HeaderTable rows={rows} />
        </div>
      )
    }
    if (activeTab === '实际请求') {
      const saved = example?.request
      const method = record ? record.request.method : (saved?.method ?? 'GET')
      const url = record ? record.request.url : (saved?.url ?? '')
      const headers = record
        ? Object.entries(record.request.headers ?? {})
        : toRows(saved?.headers)
      const body = record ? record.request.body : saved?.body
      return (
        <div className="resp-filled">
          <div className="resp-meta">
            <span className="method-text">{(method || 'GET').toUpperCase()}</span>
            <span className="mono">{url}</span>
          </div>
          <div style={{ height: 8 }} />
          <HeaderTable rows={headers} />
          {body ? (
            <>
              <div style={{ height: 10 }} />
              <pre className="resp-code">
                {typeof body === 'string' ? body : JSON.stringify(body, null, 2)}
              </pre>
            </>
          ) : null}
        </div>
      )
    }
    if (activeTab === '控制台') {
      if (!record) {
        return (
          <div className="resp-filled">
            <div className="muted" style={{ fontSize: 12 }}>无控制台输出</div>
          </div>
        )
      }
      return (
        <div className="resp-filled">
          {record.console.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>无控制台输出</div>
          ) : (
            <div className="mono" style={{ fontSize: 11.5 }}>
              {record.console.map((entry, index) => (
                <div key={index} style={{ padding: '3px 0' }}>
                  <span className="muted">[{new Date(entry.time).toLocaleTimeString()}]</span>{' '}
                  <span className="muted">{entry.level}</span> {entry.args.join(' ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    if (!record) {
      return (
        <div className="resp-empty">
          <RocketIllustration />
          <span>请输入url点击发送按钮获取响应结果</span>
        </div>
      )
    }

    return (
      <div className="resp-filled">
        <div className="resp-meta">
          {response ? (
            <>
              <span className={ok ? 'status-code' : 'status-code'} style={{ color: ok ? '#2f7d4f' : '#d94a34' }}>
                {response.code} {response.status}
              </span>
              <span>{response.response_time} ms</span>
              <span>{formatSize(response.size)}</span>
              <span>{response.mime.mime}</span>
            </>
          ) : (
            <span style={{ color: '#d94a34' }}>请求失败</span>
          )}
          {record.error ? <span style={{ color: '#d94a34' }}>{record.error.message}</span> : null}
        </div>
        {response?.body_truncated ? (
          <div className="muted" style={{ marginBottom: 6, fontSize: 11 }}>
            响应体超过 2MB，已截断显示
          </div>
        ) : null}
        {viewMode === 'pretty' ? (
          <pre className="resp-code">{pretty(bodyText) || '(空响应体)'}</pre>
        ) : viewMode === 'raw' ? (
          <pre className="resp-code">{bodyText || '(空响应体)'}</pre>
        ) : viewMode === 'preview' ? (
          <PreviewView mime={response?.mime?.mime ?? ''} body={bodyText} />
        ) : (
          <JsonView mode={viewMode} body={bodyText} />
        )}
      </div>
    )
  }

  return (
    <section className="resp">
      <div className="resp-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      {(record && activeTab === '实时响应') || (activeTab === '响应示例' && example) ? (
        <div className="resp-toolbar">
          <button
            className={viewMode === 'pretty' ? 'on' : ''}
            onClick={() => setViewMode('pretty')}
          >
            美化
          </button>
          <button className={viewMode === 'raw' ? 'on' : ''} onClick={() => setViewMode('raw')}>
            原生
          </button>
          <button
            className={viewMode === 'preview' ? 'on' : ''}
            onClick={() => setViewMode('preview')}
          >
            预览
          </button>
          <button
            className={viewMode === 'visual' ? 'on' : ''}
            onClick={() => setViewMode('visual')}
          >
            可视化
          </button>
          <button
            className={viewMode === 'table' ? 'on' : ''}
            onClick={() => setViewMode('table')}
          >
            表格
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="resp-copy"
            title="复制响应体"
            onClick={() =>
              void copyText(activeTab === '响应示例' ? example?.raw ?? '' : bodyText)
            }
          >
            <CopyOutlined /> 复制
          </button>
        </div>
      ) : null}
      {renderContent()}

      {projectId ? (
        <ModelPickerModal
          open={pickerOpen}
          projectId={projectId}
          title="选择响应示例模型"
          onCancel={() => setPickerOpen(false)}
          onSelect={(model) => void selectExampleModel(model)}
        />
      ) : null}
    </section>
  )
}

function PreviewView({ mime, body }: { mime: string; body: string }): JSX.Element {
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

function JsonView({ mode, body }: { mode: 'visual' | 'table'; body: string }): JSX.Element {
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
