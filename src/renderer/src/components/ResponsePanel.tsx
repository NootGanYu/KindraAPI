import JsonFieldTable from './JsonFieldTable'
import { JsonView, PreviewView } from './ResponseViews'
import JsonCode, { isJsonText } from './JsonCode'
import DebugResponseBody from './DebugResponseBody'
import { ActualRequest, ResponseCookies, ResponseAssertions } from './ResponseDiagnostics'
import { fieldDocsFromSchema, mergeFieldDocs } from '@shared/jsonFields'
import { exampleFromRecord, hasLocalEdits, useApp, useModelEpoch } from '../store'
import { modelDocumentation } from './schemas/modelDocumentation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntApp, Button, Dropdown, Input, Popover, Segmented, Tag, Tooltip } from 'antd'
import { CopyOutlined, DeleteOutlined, DownOutlined, MoreOutlined, PlusCircleOutlined } from '@ant-design/icons'
import type { ModelSummary, Param, ResponseExample, SendRecord } from '@shared/types'
import { methodColor } from '@shared/httpMethods'
import { createId } from '@shared/factories'
import ModelPickerModal from './schemas/ModelPickerModal'
import DesignParamTable from './DesignParamTable'
import ResponseExpectationFields, { expectationDraft, expectationError, expectationValue } from './ResponseExpectationFields'
import { useTargetEditLock } from './TargetEditScope'
import ResponseBodyTools from './ResponseBodyTools'

type ViewMode = 'pretty' | 'raw' | 'preview' | 'visual' | 'table'

interface Props {
  targetId?: string
  record: SendRecord | null
  examples?: ResponseExample[]
  loading?: boolean
  projectId?: string
  /** design 维护期望契约；debug 只读示例并允许显式保存；view 保持旧行为 */
  mode?: 'design' | 'debug' | 'view'
  defaultTab?: string
  onChangeExamples?: (examples: ResponseExample[]) => void
}

const TABS = ['实时响应', '响应头', 'Cookie', '响应示例', '字段说明', '实际请求', '控制台']

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
    <table className="response-header-table">
      <colgroup><col style={{ width: '25%' }} /><col /></colgroup>
      <thead>
        <tr>
          <th>参数名</th>
          <th>参数值</th>
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
  targetId,
  record,
  examples,
  loading,
  projectId,
  mode = 'view',
  defaultTab,
  onChangeExamples
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const design = mode === 'design'
  const debug = mode === 'debug'
  const visibleTabs = design
    ? ['Body', 'Header', '期望设置']
    : debug
      ? TABS.filter(tab => tab !== '字段说明')
      : TABS
  const modelEpoch = useModelEpoch(targetId)
  const [viewMode, setViewMode] = useState<ViewMode>(design ? 'raw' : 'pretty')
  const [activeTab, setActiveTab] = useState(design ? 'Body' : defaultTab ?? '实时响应')
  const [designBodyView, setDesignBodyView] = useState('字段说明')
  const [models, setModels] = useState<ModelSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelWarning, setModelWarning] = useState('')
  const [selectedExample, setSelectedExample] = useState<string>()
  const [expectOpen, setExpectOpen] = useState(false)
  const [expectDraft, setExpectDraft] = useState(() => expectationDraft())
  const [newExpectDraft, setNewExpectDraft] = useState(() => expectationDraft())
  useTargetEditLock(expectOpen || pickerOpen || (design && activeTab === '期望设置' && Boolean(expectationError(expectDraft))))

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
    (examples ?? []).find(item => item.example_id === selectedExample) ?? (examples ?? []).find((item) => item.expect?.is_default === 1) ?? (examples ?? [])[0] ?? null
  const isJsonExample = /json/i.test(example?.expect?.content_type ?? 'application/json')
  const contentTab = design && activeTab === 'Body' ? (isJsonExample ? designBodyView : '响应示例') : activeTab
  const latestExamples = useRef(examples)
  latestExamples.current = examples
  const selectedExampleRef = useRef(selectedExample)
  selectedExampleRef.current = selectedExample
  const commitExamples = (next: ResponseExample[]): void => {
    latestExamples.current = next
    onChangeExamples?.(next)
  }
  const selectExample = (id: string | undefined): void => {
    selectedExampleRef.current = id
    setSelectedExample(id)
  }
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
  }, [projectId, modelEpoch])

  const exampleModelId = example?.expect?.model_id
  const referencedModel = useMemo(
    () => models.find((model) => model.model_id === exampleModelId),
    [models, exampleModelId]
  )
  const modelMissing = Boolean(exampleModelId) && !referencedModel

  useEffect(() => {
    if (!exampleModelId || !projectId || !onChangeExamples || !example || debug) return
    let active = true
    modelDocumentation(projectId, exampleModelId)
      .then((result) => {
        if (!active || (targetId && hasLocalEdits(targetId))) return
        setModelWarning('')
        if (result.raw !== (example.raw ?? '') || JSON.stringify(result.field_docs) !== JSON.stringify(example.field_docs)) {
          const next = (latestExamples.current ?? []).map(item => item.example_id === example.example_id ? { ...item, ...result } : item)
          if (targetId) {
            const target = useApp.getState().drafts[targetId]
            if (target) useApp.getState().applyDerivedPatch(targetId, { response: { ...target.response, example: next } })
          } else onChangeExamples(next)
        }
      })
      .catch(error => setModelWarning(error.message))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exampleModelId, example?.raw, projectId, modelEpoch])

  const selectExampleModel = async (model: ModelSummary): Promise<void> => {
    if (!projectId) return
    const exampleId = example?.example_id
    const documentation = await modelDocumentation(projectId, model.model_id).catch(error => { message.error(error.message); return null })
    if (!documentation) return
    const result = await window.api.models.generateExample(projectId, model.model_id)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    if (result.data.warnings.length > 0) message.warning(result.data.warnings[0].message)
    const current = (latestExamples.current ?? []).find(item => item.example_id === exampleId)
    if (exampleId && !current) return
    const nextExample: ResponseExample = {
      ...(current ?? {
        example_id: createId('ex'),
        raw_parameter: [],
        headers: [],
        cookies: []
      }),
      expect: {
        ...(current?.expect ?? {
          name: '模型示例',
          code: 200,
          content_type: 'application/json',
          is_default: 1
        }),
        name: current?.expect?.name ?? model.name,
        code: current?.expect?.code ?? 200,
        content_type: 'application/json',
        is_default: current?.expect?.is_default ?? ((latestExamples.current?.length ?? 0) === 0 ? 1 : 0),
        model_id: model.model_id
      },
      ...documentation
    }
    const nextList = current
      ? (latestExamples.current ?? []).map((item) =>
          item.example_id === current.example_id ? nextExample : item
        )
      : [...(latestExamples.current ?? []), nextExample]
    commitExamples(nextList)
    setPickerOpen(false)
  }

  const clearExampleModel = (): void => {
    if (!example) return
    commitExamples(
      (latestExamples.current ?? []).map((item) =>
        item.example_id === example.example_id
          ? { ...item, expect: { ...item.expect, model_id: undefined } }
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

  const changeExample = (patch: Partial<ResponseExample>, id = selectedExampleRef.current ?? example?.example_id): void => {
    if (debug) return
    const current = (latestExamples.current ?? []).find(item => item.example_id === id)
    if (id && !current) return
    const next: ResponseExample = { ...(current ?? { example_id: createId('ex'), expect: { name: '成功', code: 200, content_type: 'application/json', is_default: 1 } }), ...patch }
    if (patch.expect) next.expect = { ...current?.expect, ...patch.expect }
    if (patch.field_docs && next.expect && !Object.hasOwn(patch.expect ?? {}, 'schema')) {
      next.expect = { ...next.expect }
      delete next.expect.schema
    }
    commitExamples(current ? (latestExamples.current ?? []).map(item => item.example_id === current.example_id ? next : item) : [...(latestExamples.current ?? []), next])
    if (!id) selectExample(next.example_id)
  }
  const openNewExpectation = (): void => {
    setNewExpectDraft(expectationDraft())
    setExpectOpen(true)
  }

  useEffect(() => {
    setExpectDraft(expectationDraft(example?.expect))
  }, [example?.example_id, example?.expect?.name, example?.expect?.code, example?.expect?.content_type, example?.expect?.sleep])

  const submitExpectation = (): void => {
    if (!onChangeExamples) return
    const error = expectationError(newExpectDraft)
    if (error) { message.error(error); return }
    const next: ResponseExample = {
      example_id: createId('ex'), raw: /json/i.test(newExpectDraft.contentType) ? '{}' : '', field_docs: [], headers: [],
      expect: {
        ...expectationValue(newExpectDraft),
        is_default: (latestExamples.current?.length ?? 0) === 0 ? 1 : 0
      }
    }
    commitExamples([...(latestExamples.current ?? []), next])
    selectExample(next.example_id)
    setActiveTab('Body')
    setExpectOpen(false)
  }

  const setDefaultExample = (): void => {
    if (!example) return
    commitExamples((latestExamples.current ?? []).map(item => ({ ...item,
      expect: { ...item.expect, is_default: item.example_id === example.example_id ? 1 : 0 } })))
  }

  const deleteExample = (id = example?.example_id): void => {
    if ((latestExamples.current?.length ?? 0) <= 1) return
    const removed = (latestExamples.current ?? []).find(item => item.example_id === id)
    if (!removed) return
    modal.confirm({ title: `删除期望「${removed.expect?.name ?? '未命名'}」？`,
      content: '该期望的响应示例与字段说明将一起删除。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: () => {
        if ((latestExamples.current?.length ?? 0) <= 1) return
        const remaining = (latestExamples.current ?? []).filter(item => item.example_id !== id)
        if (removed.expect?.is_default === 1 && remaining[0]) {
          remaining[0] = { ...remaining[0], expect: { ...remaining[0].expect, is_default: 1 } }
        }
        commitExamples(remaining)
        if (example?.example_id === id) selectExample(remaining.find(item => item.expect?.is_default === 1)?.example_id ?? remaining[0]?.example_id)
      }
    })
  }

  const saveRecordedExample = (replace: boolean): void => {
    if (!record?.response || !onChangeExamples) return
    if (replace && exampleModelId) { message.warning('请先解除模型引用，再更新示例'); return }
    const captured = exampleFromRecord(record)
    captured.expect = { ...captured.expect, is_default: replace ? (example?.expect?.is_default ?? 0) : ((examples?.length ?? 0) === 0 ? 1 : 0) }
    captured.field_docs = mergeFieldDocs(fieldDocsFromSchema(example?.expect?.schema), example?.field_docs).map(doc => ({ ...doc, doc_only: true }))
    if (replace && example) {
      const next = { ...example, ...captured, example_id: example.example_id, expect: { ...example.expect, ...captured.expect } }
      commitExamples((latestExamples.current ?? []).map(item => item.example_id === example.example_id ? next : item))
      selectExample(example.example_id)
    } else { commitExamples([...(latestExamples.current ?? []), captured]); selectExample(captured.example_id) }
    setActiveTab('响应示例')
  }

  const renderContent = (): JSX.Element => {
    if (design && !example) return <div className="resp-empty"><RocketIllustration /><span>暂无预定义响应期望，请点击右上角新建期望</span></div>
    if (design && activeTab === 'Header') return <div className="resp-filled"><DesignParamTable
      params={example?.headers ?? []} keyPlaceholder="Header 名" requiredLabel="必有"
      onChange={headers => changeExample({ headers })} /></div>
    if (design && activeTab === '期望设置') return <div className="resp-filled">
      <div onBlur={event => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        const error = expectationError(expectDraft)
        if (error) { message.error(error); setExpectDraft(expectationDraft(example?.expect)) }
      }}>
        <ResponseExpectationFields settings value={expectDraft} onChange={next => {
          setExpectDraft(next)
          if (!expectationError(next)) changeExample({ expect: expectationValue(next) })
        }} />
        {expectationError(expectDraft) && <div className="expectation-error" role="alert">{expectationError(expectDraft)}</div>}
      </div>
      <div className="expectation-actions">
        <Button size="small" disabled={example?.expect?.is_default === 1} onClick={setDefaultExample}>{example?.expect?.is_default === 1 ? '默认期望' : '设为默认'}</Button>
      </div>
    </div>
    if (contentTab === '字段说明') {
      if (!example) {
        return <div className="resp-empty" style={{ paddingBottom: 0, minHeight: 180 }}>
          <RocketIllustration />
          <span>暂无预定义响应期望</span>
          {design && onChangeExamples ? <button className="mini" onClick={openNewExpectation}>新建期望</button> : null}
        </div>
      }
      return <div className="resp-filled">
        {modelWarning && <div role="alert">{modelWarning}</div>}
        {exampleModelId && !debug && <div>字段规则继承数据模型。<button className="mini" onClick={editExampleModel}>解除并编辑</button></div>}
        <JsonFieldTable
          key={example.example_id}
          compact={design}
          context="response"
          raw={example?.raw ?? ''}
          docs={mergeFieldDocs(fieldDocsFromSchema(example?.expect?.schema), example?.field_docs)}
          valuesReadOnly={Boolean(exampleModelId) || !onChangeExamples || debug}
          mode={design ? 'design' : debug ? 'debug' : 'edit'}
          title={design ? '数据结构' : debug ? '字段值' : '字段说明'}
          onChangeRaw={raw => changeExample({ raw })}
          onChangeDocs={field_docs => changeExample({ field_docs })}
        />
      </div>
    }
    if (contentTab === '响应示例') {
      const referenceBar =
        projectId && onChangeExamples && !debug && isJsonExample ? (
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
              <span>暂无预定义响应期望</span>
              {design && onChangeExamples ? <button className="mini" onClick={openNewExpectation}>新建期望</button> : null}
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
          {design ? null : (
            <div className="resp-meta">
              <span className="method-text">{example.expect?.code ?? '200'}</span>
              <span>{example.expect?.name ?? '示例'}</span>
              <span className="muted">{example.expect?.content_type}</span>
            </div>
          )}
          {debug ? <DebugResponseBody key={example.example_id} body={raw} mime={example.expect?.content_type ?? 'application/json'} filename={example.expect?.name ?? 'response'} /> : viewMode === 'pretty' ? (
            isJsonText(raw) ? <JsonCode className="resp-code" text={pretty(raw)} /> : <pre className="resp-code">{pretty(raw) || '(空响应示例)'}</pre>
          ) : viewMode === 'raw' ? (
            <Input.TextArea aria-label="响应示例 JSON" autoSize={{ minRows: 8, maxRows: 24 }} value={raw} readOnly={Boolean(exampleModelId) || !onChangeExamples || debug} onChange={event => changeExample({ raw: event.target.value })} />
          ) : viewMode === 'preview' ? (
            <PreviewView mime={String(example.expect?.content_type ?? '')} body={raw} />
          ) : (
            <JsonView mode={viewMode} body={raw} />
          )}
        </div>
      )
    }

    if (!record && (debug || !example)) {
      return (
        <div className="resp-empty">
          <RocketIllustration />
          <span>{loading ? '请求中…' : '请输入url点击发送按钮获取响应结果'}</span>
        </div>
      )
    }

    if (contentTab === '响应头') {
      if (debug && !response) return <div className="resp-empty">本次请求没有响应</div>
      const rows = response
        ? Object.entries(response.headers ?? {})
        : toRows(example?.headers)
      return (
        <div className="resp-filled" key="response-headers">
          <HeaderTable rows={rows} />
        </div>
      )
    }
    if (contentTab === 'Cookie') {
      if (debug && !response) return <div className="resp-empty">本次请求没有响应</div>
      if (debug) return <ResponseCookies cookies={response?.cookies ?? []} />
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
    if (contentTab === '实际请求') {
      if (debug && record) return <ActualRequest record={record} />
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
            <span className="method-text" style={{ color: methodColor(method) }}>{(method || 'GET').toUpperCase()}</span>
            <span className="mono">{url}</span>
          </div>
          <div style={{ height: 8 }} />
          <HeaderTable rows={headers} />
          {body ? (
            <>
              <div style={{ height: 10 }} />
              {isJsonText(typeof body === 'string' ? body : JSON.stringify(body, null, 2)) ? (
                <JsonCode className="resp-code" text={typeof body === 'string' ? body : JSON.stringify(body, null, 2)} />
              ) : (
                <pre className="resp-code">
                  {typeof body === 'string' ? body : JSON.stringify(body, null, 2)}
                </pre>
              )}
            </>
          ) : null}
        </div>
      )
    }
    if (contentTab === '控制台') {
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
          <span>{loading ? '请求中…' : '请输入url点击发送按钮获取响应结果'}</span>
        </div>
      )
    }

    return (
      <div className={`resp-filled${debug ? ' debug-response-content' : ''}`}>
        {!debug && <div className="resp-meta">
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
        </div>}
        {debug && record.error && <div role="status" className="debug-response-error">{record.error.message}</div>}
        {response?.body_truncated ? (
          <div className="muted" style={{ marginBottom: 6, fontSize: 11 }}>
            响应体超过 2MB，仅保留前 2MB；预览和下载均使用截断内容
          </div>
        ) : null}
        {debug && record ? <>
          {response && <DebugResponseBody key={record.record_id} body={bodyText} mime={response.mime.mime} base64={response.body_base64} charset={response.charset} filename={record.target_name} truncated={response.body_truncated}
            actions={onChangeExamples && <Dropdown trigger={['click']} menu={{ items: [{ key: 'new', label: '新增响应示例' }, { key: 'update', label: '更新当前示例（保留字段规则）', disabled: !example }], onClick: ({ key }) => saveRecordedExample(key === 'update') }}><button aria-label="保存为响应示例">保存为响应示例 <DownOutlined /></button></Dropdown>} />}
        </> : viewMode === 'pretty' ? (
          isJsonText(bodyText) ? <JsonCode className="resp-code" text={pretty(bodyText)} /> : <pre className="resp-code">{pretty(bodyText) || '(空响应体)'}</pre>
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

  const responseTabs = <div className="resp-tabs" role="tablist" aria-label="响应参数">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            role="tab" aria-label={tab} aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {debug && tab === '响应头' && response && <span className="request-tab-count">({Object.keys(response.headers ?? {}).length})</span>}
          </button>
        ))}
      </div>

  return (
    <section className={`resp${design ? ' resp--design' : ''}`}>
      {(design || ((activeTab === '响应示例' || activeTab === '字段说明') && (examples?.length ?? 0) > 0)) ? (
        <div className="resp-expect-tabs">
          {(examples ?? []).map(item => (
            <div key={item.example_id} className={`resp-expect-item${item.example_id === example?.example_id ? ' active' : ''}`}>
            <button
              aria-pressed={item.example_id === example?.example_id}
              className={item.example_id === example?.example_id ? 'active' : ''}
              onClick={() => selectExample(item.example_id)}
            >
              {item.expect?.name ?? '成功'}
              <span className="muted">（{item.expect?.code ?? 200}）</span>
            </button>
            {design && onChangeExamples && (examples?.length ?? 0) > 1 && <button className="resp-expect-delete" aria-label={`删除期望 ${item.expect?.name ?? '成功'}`} title="删除期望"
              onClick={() => deleteExample(item.example_id)}><DeleteOutlined /></button>}
            </div>
          ))}
          {design && onChangeExamples ? (
            <Popover open={expectOpen} onOpenChange={open => { if (open) openNewExpectation(); else setExpectOpen(false) }} trigger="click" placement="topRight"
              content={<form className="response-new-expect" onSubmit={event => { event.preventDefault(); submitExpectation() }}>
                <ResponseExpectationFields value={newExpectDraft} onChange={setNewExpectDraft} />
                <Button size="small" type="primary" htmlType="submit">确定</Button>
              </form>}>
              <button className="resp-expect-add" aria-label="新建期望"><PlusCircleOutlined /> 新建期望</button>
            </Popover>
          ) : null}
        </div>
      ) : null}
      {debug ? <div className="resp-debug-head">{responseTabs}
        <Dropdown trigger={['click']} menu={{ selectedKeys: [activeTab], items: visibleTabs.map(tab => ({ key: tab, label: tab })), onClick: ({ key }) => setActiveTab(key) }}>
          <button className="editor-tab-overflow" aria-label="更多响应标签"><MoreOutlined /></button>
        </Dropdown>
        <div className="debug-response-status" aria-live="polite">
          {loading ? <span>请求中…</span> : response ? <>
            <Tooltip title={response.status}><span className={`debug-http-code${response.code >= 400 ? ' error' : ''}`}>{response.code}</span></Tooltip>
            <Popover content={<HeaderTable rows={Object.entries(response.timings).map(([key, value]) => [key, `${value} ms`])} />} title="请求计时（自开始的偏移）"><span className="debug-response-time">{response.response_time >= 1000 ? `${(response.response_time / 1000).toFixed(3)}s` : `${response.response_time}ms`}</span></Popover>
            <Tooltip title={response.mime.mime}><span>{formatSize(response.size)}</span></Tooltip>
          </> : record ? <span>{record.error?.type === 'cancelled' ? '已取消' : '请求失败'}</span> : null}
        </div>
      </div> : responseTabs}
      {design && activeTab === 'Body' && example && <div className="resp-toolbar design-body-toolbar">
        <Segmented size="small" value={contentTab} onChange={value => { setDesignBodyView(String(value)); setViewMode('raw') }}
          options={[{ value: '字段说明', label: '数据结构', disabled: !isJsonExample }, { value: '响应示例', label: '示例' }]} />
        <ResponseBodyTools key={example.example_id} example={example} projectId={projectId} structure={contentTab === '字段说明'}
          onChange={patch => changeExample(patch, example.example_id)} onShowExample={() => setDesignBodyView('响应示例')} />
      </div>}
      {!debug && ((record && activeTab === '实时响应') || (activeTab === '响应示例' && example)) ? (
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
      {!debug && record?.response && onChangeExamples && activeTab === '实时响应' && <div className="resp-toolbar"><span>保存为响应示例：</span><button onClick={() => saveRecordedExample(false)}>新增</button><button disabled={!example} onClick={() => saveRecordedExample(true)}>更新当前示例（保留字段规则）</button></div>}
      {renderContent()}
      {debug && record && activeTab === '实时响应' && <ResponseAssertions record={record} />}

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
