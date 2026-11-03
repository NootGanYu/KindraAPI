import { useEffect, useRef, useState } from 'react'
import { App, Button, Dropdown, Input, Modal, Segmented, Select } from 'antd'
import { CodeOutlined, CopyOutlined, DownloadOutlined, EyeOutlined, ImportOutlined, MoreOutlined } from '@ant-design/icons'
import { buildFieldSchema, fieldDocsFromSchema, mergeFieldDocs } from '@shared/jsonFields'
import type { ModelSchema, ResponseExample } from '@shared/types'
import { useTargetEditLock } from './TargetEditScope'
import { validateSchema } from './schemas/modelUtils'
import JsonFieldTable from './JsonFieldTable'
import JsonCode from './JsonCode'

type Tool = 'raw' | 'preview' | 'import' | 'code' | 'search' | 'fields' | null
const pretty = (value: unknown): string => JSON.stringify(value, null, 2)
const RESERVED_TYPE_NAMES = new Set('any as assert asserts async await bigint boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get global if implements import in infer instanceof interface intrinsic is keyof let module namespace never new null number object of package private protected public readonly require return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield'.split(' '))

function mergeObjects(before: unknown, incoming: unknown): unknown {
  if (!before || !incoming || typeof before !== 'object' || typeof incoming !== 'object' || Array.isArray(before) || Array.isArray(incoming)) return incoming
  const result = { ...before } as Record<string, unknown>
  for (const [key, value] of Object.entries(incoming)) Object.defineProperty(result, key, {
    value: Object.hasOwn(result, key) ? mergeObjects(result[key], value) : value, enumerable: true, configurable: true, writable: true
  })
  return result
}

function typescript(schema: ModelSchema, name: string): string {
  const walk = (node: ModelSchema, depth = 0): string => {
    if (depth > 30) return 'unknown'
    let type: string
    if (node.$ref) type = 'unknown'
    else if (Array.isArray(node.enum) && node.enum.every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value))) type = node.enum.map(value => JSON.stringify(value)).join(' | ') || 'never'
    else if (Array.isArray(node.anyOf)) type = (node.anyOf as ModelSchema[]).map(item => walk(item, depth + 1)).join(' | ') || 'unknown'
    else if (node.type === 'object' || node.properties) {
      const indent = '  '.repeat(depth + 1)
      type = '{\n' + Object.entries(node.properties ?? {}).map(([key, child]) => {
        const description = child.description ? `${indent}/** ${child.description.replace(/\*\//g, '* /').replace(/[\r\n]/g, ' ')} */\n` : ''
        return `${description}${indent}${JSON.stringify(key)}${node.required?.includes(key) ? '' : '?'}: ${walk(child, depth + 1)};`
      }).join('\n') + `\n${'  '.repeat(depth)}}`
    } else if (node.type === 'array') type = `Array<${walk(node.items ?? {}, depth + 1)}>`
    else if (node.type === 'integer' || node.type === 'number') type = 'number'
    else if (node.type === 'string' || node.type === 'boolean' || node.type === 'null') type = node.type
    else type = 'unknown'
    const rules = node['x-kindra-rules'] as { nullable?: boolean } | undefined
    if (type !== 'null' && type !== 'unknown' && (node.nullable === true || node['x-nullable'] === true || (rules && rules.nullable === undefined))) type = `(${type}) | null`
    return type
  }
  return `export type ${name} = ${walk(schema)};\n`
}

export default function ResponseBodyTools({ example, projectId, structure, onChange, onShowExample }: {
  example: ResponseExample
  projectId?: string
  structure: boolean
  onChange: (patch: Partial<ResponseExample>) => void
  onShowExample: () => void
}): JSX.Element {
  const { message } = App.useApp()
  const [tool, setTool] = useState<Tool>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [importFormat, setImportFormat] = useState('JSON')
  const [mergeMode, setMergeMode] = useState('merge')
  const [previewView, setPreviewView] = useState('示例预览')
  const [preview, setPreview] = useState('')
  const [schemaText, setSchemaText] = useState('')
  const [modelName, setModelName] = useState('Response')
  const [search, setSearch] = useState('')
  const [replacement, setReplacement] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useTargetEditLock(Boolean(tool) || busy)
  const linked = Boolean(example.expect?.model_id)
  const isJson = /json/i.test(example.expect?.content_type ?? 'application/json')
  const docs = mergeFieldDocs(fieldDocsFromSchema(example.expect?.schema), example.field_docs)
  const getSchema = (): ModelSchema => {
    if (example.expect?.schema) return example.expect.schema as ModelSchema
    const result = buildFieldSchema(example.raw ?? '', docs)
    if (!result.ok) throw Error('请先在示例中修正 JSON，再操作数据结构')
    return result.schema
  }
  const generate = async (schema: ModelSchema): Promise<unknown> => {
    if (!projectId) throw Error('请先打开项目')
    const result = await window.api.models.generateFromSchema(projectId, schema)
    if (!result.ok) throw Error(result.error)
    if (result.data.warnings.length) throw Error(result.data.warnings.map(warning => warning.message).join('；'))
    return result.data.value
  }
  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await work() } catch (error) { if (mounted.current) { setError((error as Error).message); message.error((error as Error).message) } }
    finally { if (mounted.current) setBusy(false) }
  }
  const open = (next: Tool): void => {
    setError(''); setTool(next)
    setSchemaText(''); setPreview('')
    if (next === 'raw') setText('')
    if (next === 'import') { setText(''); setPreview(''); setImportFormat('JSON'); setMergeMode('merge') }
    if (next === 'raw' || next === 'preview' || next === 'code') void run(async () => {
      const schema = getSchema()
      const formatted = pretty(schema)
      if (next === 'raw') setText(formatted)
      setSchemaText(formatted)
      if (next === 'preview') {
        const value = await generate(schema)
        if (mounted.current) setPreview(pretty(value))
      }
    })
  }
  const parseSchema = (source: string): ModelSchema => {
    const schema = JSON.parse(source)
    const problem = validateSchema(schema)
    if (problem) throw Error(problem)
    if (schema.$ref || (!['object', 'array'].includes(schema.type) && !schema.properties && !schema.items)) throw Error('响应数据结构根节点应为 object 或 array')
    return schema
  }
  const imported = async (): Promise<{ schema: ModelSchema; value: unknown }> => {
    if (importFormat === 'JSON Schema') {
      const schema = parseSchema(text)
      return { schema, value: await generate(schema) }
    }
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object') throw Error('请输入 JSON 对象或数组')
    return { schema: buildFieldSchema(pretty(value), []).schema, value }
  }
  const apply = (): void => { void run(async () => {
    if (tool === 'raw') {
      const schema = parseSchema(text)
      const value = await generate(schema)
      if (mounted.current) onChange({ raw: pretty(value), field_docs: fieldDocsFromSchema(schema), expect: { schema } })
    } else if (tool === 'import') {
      const incoming = await imported()
      let value = incoming.value
      let nextDocs = fieldDocsFromSchema(incoming.schema)
      if (mergeMode === 'merge') {
        let existing: unknown
        try { existing = JSON.parse(example.raw || '{}') } catch { throw Error('当前示例 JSON 无效，请先修正或选择完全覆盖') }
        value = mergeObjects(existing, incoming.value)
        nextDocs = mergeFieldDocs(nextDocs, docs)
      }
      if (mounted.current) onChange({ raw: pretty(value), field_docs: nextDocs,
        ...(mergeMode === 'replace' && importFormat === 'JSON Schema' ? { expect: { schema: incoming.schema } } : {}) })
    }
    if (mounted.current) setTool(null)
  }) }
  const format = (compact = false): void => {
    try { onChange({ raw: JSON.stringify(JSON.parse(example.raw ?? ''), null, compact ? undefined : 2) }) }
    catch { message.error('当前示例不是有效 JSON，无法美化或简化') }
  }
  const copy = async (content: string): Promise<void> => {
    const result = await window.api.app.copyText(content)
    result.ok ? message.success('已复制') : message.error(result.error)
  }
  const codeNameValid = /^[A-Za-z_$][\w$]*$/.test(modelName) && !RESERVED_TYPE_NAMES.has(modelName)
  const code = schemaText && codeNameValid ? typescript(JSON.parse(schemaText), modelName) : ''
  return <>
    <div className="response-body-tools">
      {structure ? <>
        <button disabled={linked || busy} onClick={() => open('raw')}>Raw编辑</button>
        <button disabled={busy} onClick={() => open('preview')}><EyeOutlined /> 预览</button>
        <button disabled={busy} onClick={() => open('code')}><CodeOutlined /> 生成代码</button>
        <button disabled={linked || busy} onClick={() => open('import')}><ImportOutlined /> 智能导入</button>
      </> : <>
        {isJson && <button onClick={() => open('fields')}>字段描述</button>}
        <button disabled={linked || !isJson} onClick={() => format()}>美化</button>
        <Dropdown trigger={['click']} menu={{ items: [{ key: 'search', label: '查找替换' }, { key: 'minify', label: '简化', disabled: linked || !isJson }],
          onClick: ({ key }) => key === 'search' ? open('search') : format(true) }}><button aria-label="示例更多"><MoreOutlined /></button></Dropdown>
        {isJson && <button disabled={linked || busy} onClick={() => { void run(async () => {
          const value = await generate(getSchema())
          if (mounted.current) { onChange({ raw: pretty(value) }); onShowExample() }
        }) }}>从数据结构生成示例</button>}
        <button onClick={() => void copy(example.raw ?? '')}><CopyOutlined /> 复制</button>
      </>}
    </div>
    <Modal title={tool === 'raw' ? 'Raw编辑' : tool === 'import' ? '智能导入' : tool === 'preview' ? '响应结构预览' : tool === 'code' ? '生成模型代码' : tool === 'fields' ? '提取字段描述' : '查找替换'}
      open={Boolean(tool)} width={tool === 'search' ? 520 : 860} onCancel={() => setTool(null)}
      footer={tool === 'raw' || tool === 'import' ? undefined : null} onOk={apply} confirmLoading={busy} okText="确定" cancelText="取消" okButtonProps={{ disabled: linked }}>
      {tool === 'raw' && <>
        <p className="muted">编辑 JSON Schema。确定后应用结构并重新生成示例。</p>
        <Input.TextArea aria-label="响应 JSON Schema" className="mono" rows={16} value={text} onChange={event => setText(event.target.value)} spellCheck={false} />
      </>}
      {tool === 'preview' && <>
        <Segmented options={['数据结构', '示例预览']} value={previewView} onChange={setPreviewView} />
        <JsonCode className="response-tool-preview" text={previewView === '数据结构' ? schemaText : preview} />
        <Button onClick={() => void copy(previewView === '数据结构' ? schemaText : preview)}>复制</Button>
      </>}
      {tool === 'import' && <>
        <div className="response-import-options">
          <Segmented options={['JSON', 'JSON Schema']} value={importFormat} onChange={value => { setImportFormat(value); setPreview(''); setError('') }} />
          <span>覆盖模式</span><Select aria-label="导入覆盖模式" value={mergeMode} onChange={setMergeMode} options={[{ value: 'merge', label: '智能合并' }, { value: 'replace', label: '完全覆盖' }]} />
          <Button size="small" onClick={() => { try { setText(pretty(JSON.parse(text))) } catch { setError('请输入有效 JSON') } }}>格式化</Button>
          <Button size="small" loading={busy} onClick={() => { void run(async () => { const result = await imported(); if (mounted.current) setPreview(pretty(result.schema)) }) }}>预览</Button>
        </div>
        <div className="response-import-editors"><Input.TextArea aria-label="导入响应结构" className="mono" rows={14} value={text} onChange={event => setText(event.target.value)} spellCheck={false} />
          {preview ? <JsonCode className="response-tool-preview" text={preview} /> : <pre className="response-tool-preview">导入结构预览</pre>}</div>
        <p className="muted">智能合并保留已有字段规则；完全覆盖替换结构和示例。</p>
      </>}
      {tool === 'code' && <>
        <div className="response-import-options"><span>语言</span><Select value="TypeScript" options={[{ value: 'TypeScript', label: 'TypeScript' }]} />
          <label htmlFor="response-model-name">数据模型名</label><Input id="response-model-name" value={modelName} status={codeNameValid ? undefined : 'error'} onChange={event => setModelName(event.target.value)} />
          <Button disabled={!code} icon={<CopyOutlined />} onClick={() => void copy(code)}>复制</Button>
          <Button disabled={!code} icon={<DownloadOutlined />} onClick={() => {
            const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }))
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${modelName}.ts`; anchor.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }}>下载</Button></div>
        {!codeNameValid && <div role="alert" className="expectation-error">请输入有效的 TypeScript 类型名称</div>}
        <pre className="response-tool-preview">{code}</pre>
      </>}
      {tool === 'search' && <>
        <div className="response-expect-fields"><label htmlFor="response-find">查找</label><Input id="response-find" value={search} onChange={event => setSearch(event.target.value)} />
          <label htmlFor="response-replace">替换为</label><Input id="response-replace" value={replacement} onChange={event => setReplacement(event.target.value)} /></div>
        <p>{search ? `找到 ${(example.raw ?? '').split(search).length - 1} 处匹配` : '输入要查找的文本'}</p>
        <Button disabled={!search || linked} onClick={() => { onChange({ raw: (example.raw ?? '').split(search).join(replacement) }); message.success('已替换全部匹配') }}>全部替换</Button>
      </>}
      {tool === 'fields' && <>
        <div className="response-field-description-table"><JsonFieldTable raw={example.raw ?? ''} docs={docs} context="response" mode="design" valuesReadOnly={linked}
          onChangeRaw={raw => onChange({ raw })} onChangeDocs={field_docs => onChange({ field_docs })} /></div>
        <div className="response-import-options"><Button disabled={linked} onClick={() => {
          const result = buildFieldSchema(example.raw ?? '', docs)
          if (!result.ok) { message.error('请先修正示例 JSON'); return }
          onChange({ field_docs: mergeFieldDocs(fieldDocsFromSchema(result.schema), docs) })
          message.success('已重新提取，保留已有字段规则')
        }}>重新提取</Button><Button onClick={() => setTool(null)}>关闭</Button></div>
      </>}
      {error && <div role="alert" className="expectation-error">{error}</div>}
    </Modal>
  </>
}
