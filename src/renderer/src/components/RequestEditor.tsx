import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  Dropdown,
  Input,
  Radio,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip
} from 'antd'
import { DownOutlined } from '@ant-design/icons'
import type {
  AuthType,
  BodyMode,
  ModelSummary,
  RequestModel,
  Target
} from '@shared/types'
import { createBody } from '@shared/factories'
import { useApp } from '../store'
import ParamTable from './ParamTable'
import JsonFieldTable from './JsonFieldTable'
import ModelPickerModal from './schemas/ModelPickerModal'

interface Props {
  draft: Target
  onChange: (patch: Partial<Target>) => void
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const TABS = ['Header', 'Query', 'Path', 'Body', '认证', 'Cookie', '预执行操作', '后执行操作']

interface JsonError {
  message: string
  line: number
  column: number
  index: number
}

function validateJson(raw: string): JsonError | null {
  const text = raw.trimStart()
  if (!text.startsWith('{') && !text.startsWith('[')) return null
  try {
    JSON.parse(raw)
    return null
  } catch (error) {
    const message = (error as Error).message
    const match = /position\s+(\d+)/i.exec(message)
    const index = Math.min(match ? Number(match[1]) : raw.length, raw.length)
    const before = raw.slice(0, index)
    const line = before.split('\n').length
    const column = index - before.lastIndexOf('\n')
    return { message, line, column, index }
  }
}

const BODY_OPTIONS = [
  { value: 'none', label: 'none' },
  { value: 'formdata', label: 'form-data' },
  { value: 'urlencoded', label: 'urlencoded' },
  { value: 'binary', label: 'binary' },
  { value: 'msgpack', label: 'msgpack', disabled: true },
  { value: 'raw', label: 'raw' }
]

function DocIllustration(): JSX.Element {
  return (
    <svg
      width="62"
      height="62"
      viewBox="0 0 64 64"
      fill="none"
      stroke="#c9bfa9"
      strokeWidth="1.15"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 10h19l9 9v30a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" />
      <path d="M37 10v10h10" />
      <path d="M24 31h15M24 37h11" />
      <path
        d="M48 16l1.7 4.3L54 22l-4.3 1.7L48 28l-1.7-4.3L42 22l4.3-1.7z"
        opacity=".65"
      />
      <circle cx="21" cy="45" r="1.2" opacity=".7" />
      <circle cx="47" cy="42" r="1" opacity=".6" />
    </svg>
  )
}

export default function RequestEditor({ draft, onChange }: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const projectId = useApp((s) => s.project?.project_id ?? '')
  const saveTarget = useApp((s) => s.saveTarget)
  const sendActive = useApp((s) => s.sendActive)
  const sending = useApp((s) => s.sendingId === draft.target_id)
  const [activeTab, setActiveTab] = useState('Body')
  const [saving, setSaving] = useState(false)
  const [jsonError, setJsonError] = useState<JsonError | null>(null)
  const [bodyView, setBodyView] = useState<'raw' | 'fields'>('raw')
  const [models, setModels] = useState<ModelSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const request = draft.request ?? ({
    auth: { type: 'inherit' },
    header: { parameter: [] },
    query: { parameter: [] },
    restful: { parameter: [] },
    cookie: { parameter: [] },
    body: createBody(),
    pre_tasks: [],
    post_tasks: [],
    pre_script: '',
    test: ''
  } as RequestModel)

  const setRequest = (patch: Partial<RequestModel>): void => {
    onChange({ request: { ...request, ...patch } })
  }

  const setBody = (patch: Partial<RequestModel['body']>): void => {
    setRequest({ body: { ...(request.body ?? createBody()), ...patch } })
  }

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

  const bodyModel = (request.body ?? createBody()).model_id
  const referencedModel = useMemo(
    () => models.find((model) => model.model_id === bodyModel),
    [models, bodyModel]
  )
  const modelMissing = Boolean(bodyModel) && !referencedModel

  const clearModelRef = (): void => {
    const current = request.body ?? createBody()
    const next = { ...current }
    delete next.model_id
    setRequest({ body: next })
  }

  const confirmEdit = (): void => {
    modal.confirm({
      title: '编辑将解除模型引用',
      content: '解除后保留当前生成的 JSON，可继续手动修改。',
      okText: '解除并编辑',
      cancelText: '取消',
      onOk: () => clearModelRef()
    })
  }

  const selectModel = async (model: ModelSummary): Promise<void> => {
    const result = await window.api.models.generateExample(projectId, model.model_id)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    if (result.data.warnings.length > 0) {
      message.warning(result.data.warnings[0].message)
    }
    setBody({
      mode: 'json',
      raw: JSON.stringify(result.data.value, null, 2),
      model_id: model.model_id
    })
    setPickerOpen(false)
  }

  const formatJsonBody = (): void => {
    const current = request.body ?? createBody()
    if (current.mode !== 'raw' && current.mode !== 'json') return
    const raw = current.raw ?? ''
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return
      const pretty = JSON.stringify(parsed, null, 2)
      if (pretty !== raw) setBody({ raw: pretty })
    } catch {
      // 不是合法 JSON，保持原样
    }
  }

  const handleSend = async (): Promise<boolean> => {
    formatJsonBody()
    const problem = validateJson(request.body?.raw ?? '')
    setJsonError(problem)
    if (problem) {
      focusJsonError(problem)
      message.error(`JSON 结构错误：第 ${problem.line} 行第 ${problem.column} 列`)
    }
    try {
      const record = await sendActive()
      if (record.status === 'passed') message.success(`请求完成 ${record.response?.code ?? ''}`)
      else message.error(record.error?.message ?? '请求失败')
      return record.status === 'passed'
    } catch (error) {
      message.error((error as Error).message)
      return false
    }
  }

  const handleSave = async (notify = true): Promise<void> => {
    formatJsonBody()
    const problem = validateJson(request.body?.raw ?? '')
    setJsonError(problem)
    if (problem) {
      focusJsonError(problem)
      message.error(`JSON 结构错误：第 ${problem.line} 行第 ${problem.column} 列`)
    }
    setSaving(true)
    try {
      await saveTarget(draft.target_id)
      if (notify) message.success('已保存')
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const body = request.body ?? createBody()
  const bodyValue = body.mode === 'json' ? 'raw' : body.mode

  const focusJsonError = (error: JsonError): void => {
    const input = document.querySelector<HTMLTextAreaElement>('.editor-shell textarea')
    if (!input) return
    input.focus()
    const start = Math.max(0, Math.min(error.index, Math.max(0, input.value.length - 1)))
    input.setSelectionRange(start, Math.min(input.value.length, start + 1))
  }

  useEffect(() => {
    if (body.mode !== 'raw' && body.mode !== 'json') {
      setJsonError(null)
      return
    }
    const timer = setTimeout(() => setJsonError(validateJson(body.raw ?? '')), 500)
    return () => clearTimeout(timer)
  }, [body.mode, body.raw])

  useEffect(() => {
    if (jsonError && bodyView === 'fields') setBodyView('raw')
  }, [jsonError, bodyView])

  const sendMenu = {
    items: [
      { key: 'send', label: '发送' },
      { key: 'sendSave', label: '发送并保存' }
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'send') void handleSend()
      if (key === 'sendSave') {
        void (async () => {
          const ok = await handleSend()
          if (ok) await handleSave(false)
        })()
      }
    }
  }

  const saveMenu = {
    items: [
      { key: 'save', label: '保存' },
      { key: 'saveSend', label: '保存并发送' }
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'save') void handleSave()
      if (key === 'saveSend') {
        void (async () => {
          const ok = await handleSend()
          if (ok) await handleSave(false)
        })()
      }
    }
  }

  const renderBody = (): JSX.Element => {
    if (body.mode === 'none') {
      return (
        <div className="editor-shell">
          <div className="editor-empty">
            <DocIllustration />
            <span>当前请求未包含 Body</span>
          </div>
          <div className="fake-scroll">
            <span />
          </div>
        </div>
      )
    }
    if (body.mode === 'raw' || body.mode === 'json') {
      const fieldView = body.mode === 'json' && bodyView === 'fields'
      return (
        <div className="body-editor-wrap">
          <div className="body-model-bar">
            {bodyModel ? (
              <>
                {modelMissing ? (
                  <Tag color="error">模型已删除</Tag>
                ) : (
                  <Tag color="gold">模型 · {referencedModel?.name}</Tag>
                )}
                <span className="muted">发送时按模型实时生成，内容只读</span>
                <Tooltip title="解除引用后保留当前 JSON 可编辑">
                  <button className="mini" onClick={confirmEdit}>
                    编辑
                  </button>
                </Tooltip>
                <button className="mini" onClick={clearModelRef}>
                  解除引用
                </button>
              </>
            ) : (
              <>
                <button className="mini" onClick={() => setPickerOpen(true)} disabled={!projectId}>
                  引用模型
                </button>
                <span className="muted">也可直接手写 JSON</span>
              </>
            )}
            {jsonError ? (
              <div
                className="json-error inline"
                role="alert"
                title="点击定位到错误位置"
                onClick={() => focusJsonError(jsonError)}
              >
                <span className="json-error-tag">JSON 结构错误</span>
                第 {jsonError.line} 行第 {jsonError.column} 列：{jsonError.message}
              </div>
            ) : (
              <>
                <span style={{ flex: 1 }} />
                {body.mode === 'json' ? (
                  <Segmented
                    className="body-view-segmented"
                    size="small"
                    value={bodyView}
                    onChange={(value) => setBodyView(value as 'raw' | 'fields')}
                    options={[
                      { label: '原始', value: 'raw' },
                      { label: '字段', value: 'fields' }
                    ]}
                  />
                ) : null}
              </>
            )}
          </div>
          {fieldView ? (
            <JsonFieldTable
              raw={body.raw ?? ''}
              docs={body.field_docs ?? []}
              valuesReadOnly={Boolean(bodyModel)}
              onChangeRaw={(raw) => setBody({ raw })}
              onChangeDocs={(field_docs) => setBody({ field_docs })}
            />
          ) : (
            <div className="editor-shell fill">
              <Input.TextArea
                className="editor-input"
                value={body.raw ?? ''}
                readOnly={Boolean(bodyModel)}
                onChange={(event) => setBody({ raw: event.target.value })}
                onBlur={() => {
                  if (bodyModel) return
                  formatJsonBody()
                  const problem = validateJson(request.body?.raw ?? '')
                  setJsonError(problem)
                  if (problem) setTimeout(() => focusJsonError(problem), 0)
                }}
                placeholder={body.mode === 'json' ? '{ "key": "value" }' : '请求体'}
                spellCheck={false}
              />
            </div>
          )}
        </div>
      )
    }
    if (body.mode === 'urlencoded') {
      return (
        <ParamTable
          title="表单参数（urlencoded）"
          params={body.urlencoded ?? []}
          onChange={(urlencoded) => setBody({ urlencoded })}
        />
      )
    }
    if (body.mode === 'formdata') {
      return (
        <ParamTable
          title="表单参数（form-data）"
          params={body.formdata ?? []}
          onChange={(formdata) => setBody({ formdata })}
          valuePlaceholder="值或文件路径"
          allowFile
        />
      )
    }
    return (
      <div className="editor-shell fill" style={{ padding: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <span className="muted" style={{ fontSize: 11 }}>
            二进制文件绝对路径
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              value={body.binary?.file_path ?? ''}
              onChange={(event) =>
                setBody({ binary: { ...(body.binary ?? {}), file_path: event.target.value } })
              }
              placeholder="/path/to/file"
            />
            <Button
              onClick={() => {
                void window.api.dialog.openFiles().then((result) => {
                  if (!result.ok) {
                    message.error(result.error)
                    return
                  }
                  const file = result.data[0]
                  if (!file) return
                  setBody({
                    binary: {
                      ...(body.binary ?? {}),
                      file_path: file.path,
                      file_name: file.name
                    }
                  })
                })
              }}
            >
              选择文件
            </Button>
          </div>
          {body.binary?.file_name ? (
            <span className="muted" style={{ fontSize: 11 }}>
              {body.binary.file_name}
            </span>
          ) : null}
        </Space>
      </div>
    )
  }

  const renderContent = (): JSX.Element | null => {
    if (activeTab === 'Body') {
      return (
        <div className={`req-body${jsonError ? ' has-json-error' : ''}`}>
          <div className="bodytypes">
            <Radio.Group
              value={bodyValue}
              onChange={(event) => {
                const value = String(event.target.value)
                if (value === 'msgpack') {
                  message.info('msgpack 将在后续里程碑支持')
                  return
                }
                const nextMode = (value === 'raw' ? 'json' : value) as BodyMode
                const current = request.body ?? createBody()
                const next = { ...current, mode: nextMode }
                if (nextMode !== 'raw' && nextMode !== 'json') delete next.model_id
                setRequest({ body: next })
              }}
              options={BODY_OPTIONS}
            />
          </div>
          {renderBody()}
        </div>
      )
    }
    if (activeTab === 'Header') {
      return (
        <div className="req-body">
          <ParamTable
            title="公共参数（Header）"
            params={request.header?.parameter ?? []}
            onChange={(parameter) => setRequest({ header: { parameter } })}
            keyPlaceholder="Header 名"
          />
        </div>
      )
    }
    if (activeTab === 'Query') {
      return (
        <div className="req-body">
          <ParamTable
            title="查询参数（Query）"
            params={request.query?.parameter ?? []}
            onChange={(parameter) => setRequest({ query: { parameter } })}
            keyPlaceholder="参数名"
          />
        </div>
      )
    }
    if (activeTab === 'Path') {
      return (
        <div className="req-body">
          <ParamTable
            title="路径参数（Path）"
            params={request.restful?.parameter ?? []}
            onChange={(parameter) => setRequest({ restful: { parameter } })}
            keyPlaceholder="路径变量（不含 {}）"
          />
        </div>
      )
    }
    if (activeTab === 'Cookie') {
      return (
        <div className="req-body">
          <ParamTable
            title="Cookie 参数"
            params={request.cookie?.parameter ?? []}
            onChange={(parameter) => setRequest({ cookie: { parameter } })}
            keyPlaceholder="Cookie 名"
          />
        </div>
      )
    }
    if (activeTab === '认证') {
      return (
        <div className="req-body">
          <AuthEditor request={request} onChange={setRequest} />
        </div>
      )
    }
    if (activeTab === '预执行操作') {
      return (
        <div className="req-body">
          <div className="editor-shell fill">
            <div className="script-pane">
              <Input.TextArea
                value={request.pre_script ?? ''}
                onChange={(event) => setRequest({ pre_script: event.target.value })}
                autoSize={{ minRows: 12 }}
                className="mono"
                placeholder="// 预执行脚本"
              />
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="req-body">
        <div className="editor-shell fill">
          <div className="script-pane">
            <Input.TextArea
              value={request.test ?? ''}
              onChange={(event) => setRequest({ test: event.target.value })}
              autoSize={{ minRows: 12 }}
              className="mono"
              placeholder="// 后执行脚本"
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="request-pane">
      <div className="url-row">
        <div className="url-capsule">
          <div className="method-select">
            <Dropdown
              trigger={['click']}
              menu={{
                items: METHODS.map((method) => ({ key: method, label: method })),
                onClick: ({ key }) => onChange({ method: key })
              }}
            >
              <button className="method-btn">
                <span>{(draft.method || 'GET').toUpperCase()}</span>
                <DownOutlined style={{ fontSize: 9 }} />
              </button>
            </Dropdown>
          </div>
          <div className="url-input">
            <Input
              variant="borderless"
              value={draft.url ?? ''}
              onChange={(event) => onChange({ url: event.target.value })}
              placeholder="请输入URL或粘贴cURL文本"
              onPressEnter={() => void handleSend()}
            />
          </div>
          <div className="proto-select">
            <Select
              variant="borderless"
              value={draft.protocol || 'http/1.1'}
              onChange={(protocol) => onChange({ protocol })}
              popupMatchSelectWidth={false}
              options={[
                { value: 'http/1.1', label: 'http/1.1' },
                { value: 'auto', label: 'auto' },
                { value: 'http/2', label: 'http/2' }
              ]}
            />
          </div>
        </div>

        <div className="send-group">
          <button className="send-btn" onClick={() => void handleSend()} disabled={sending}>
            {sending ? '发送中…' : '发送'}
          </button>
          <Dropdown menu={sendMenu} trigger={['click']}>
            <button className="send-caret">
              <DownOutlined style={{ fontSize: 9 }} />
            </button>
          </Dropdown>
        </div>

        <div className="save-group">
          <button className="save-btn" onClick={() => void handleSave()} disabled={saving}>
            保存
          </button>
          <Dropdown menu={saveMenu} trigger={['click']}>
            <button className="save-caret">
              <DownOutlined style={{ fontSize: 9 }} />
            </button>
          </Dropdown>
        </div>
      </div>

      <div className="req-tabs">
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

      {renderContent()}

      <ModelPickerModal
        open={pickerOpen}
        projectId={projectId}
        onCancel={() => setPickerOpen(false)}
        onSelect={(model) => void selectModel(model)}
      />
    </div>
  )
}

function AuthEditor({
  request,
  onChange
}: {
  request: RequestModel
  onChange: (patch: Partial<RequestModel>) => void
}): JSX.Element {
  const auth = request.auth ?? { type: 'inherit' as AuthType }
  const updateAuth = (patch: Record<string, unknown>): void => {
    onChange({ auth: { ...auth, ...patch } })
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div>
          <div className="muted" style={{ marginBottom: 4 }}>
            认证类型
          </div>
          <Select
            value={auth.type}
            style={{ width: 240 }}
            onChange={(type) => updateAuth({ type })}
            options={[
              { value: 'inherit', label: '继承父级' },
              { value: 'noauth', label: '无需认证' },
              { value: 'bearer', label: 'Bearer Token' },
              { value: 'basic', label: 'Basic Auth' },
              { value: 'kv', label: 'API Key' }
            ]}
          />
        </div>

        {auth.type === 'bearer' ? (
          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              Token
            </div>
            <Input
              value={auth.bearer?.key ?? ''}
              onChange={(event) => updateAuth({ bearer: { key: event.target.value } })}
              placeholder="Bearer token"
            />
          </div>
        ) : null}

        {auth.type === 'basic' ? (
          <Space>
            <Input
              value={auth.basic?.username ?? ''}
              onChange={(event) =>
                updateAuth({ basic: { ...(auth.basic ?? {}), username: event.target.value } })
              }
              placeholder="用户名"
            />
            <Input.Password
              value={auth.basic?.password ?? ''}
              onChange={(event) =>
                updateAuth({ basic: { ...(auth.basic ?? {}), password: event.target.value } })
              }
              placeholder="密码"
            />
          </Space>
        ) : null}

        {auth.type === 'kv' ? (
          <Space>
            <Input
              value={auth.kv?.key ?? ''}
              onChange={(event) =>
                updateAuth({ kv: { ...(auth.kv ?? { in: 'header' }), key: event.target.value } })
              }
              placeholder="Key"
            />
            <Input
              value={auth.kv?.value ?? ''}
              onChange={(event) =>
                updateAuth({ kv: { ...(auth.kv ?? { in: 'header' }), value: event.target.value } })
              }
              placeholder="Value"
            />
            <Select
              value={auth.kv?.in ?? 'header'}
              style={{ width: 110 }}
              onChange={(value) =>
                updateAuth({ kv: { ...(auth.kv ?? { key: '', value: '' }), in: value } })
              }
              options={[
                { value: 'header', label: 'Header' },
                { value: 'query', label: 'Query' }
              ]}
            />
          </Space>
        ) : null}
      </Space>
    </div>
  )
}
