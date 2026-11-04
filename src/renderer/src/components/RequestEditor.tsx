import { modelDocumentation } from './schemas/modelDocumentation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  App as AntApp,
  Button,
  Dropdown,
  Input,
  Radio,
  Segmented,
  Select,
  Tag,
  Tooltip
} from 'antd'
import { DeleteOutlined, DownOutlined, EyeOutlined, MoreOutlined, PaperClipOutlined, UploadOutlined } from '@ant-design/icons'
import type {
  AuthType,
  BodyMode,
  ModelSummary,
  RawBodyLanguage,
  RequestModel,
  SendRecord,
  Target
} from '@shared/types'
import { createBody, createParam } from '@shared/factories'
import { withQueryParams, withoutQueryKeys } from '@shared/requestUrl'
import {
  editableEnvironmentPath,
  joinEnvironmentUrl,
  splitEnvironmentUrl
} from '@shared/environmentUrl'
import { methodColor } from '@shared/httpMethods'
import { buildExampleFromDocs } from '@shared/jsonFields'
import { buildBodyExample } from '@shared/bodyImport'
import { exampleFromRecord, hasLocalEdits, useApp, useModelEpoch } from '../store'
import ParameterTable from './DesignParamTable'
import InheritedRequestParams from './InheritedRequestParams'
import RequestScriptEditor from './RequestScriptEditor'
import JsonFieldTable from './JsonFieldTable'
import JsonBodyInput from './JsonBodyInput'
import { useTargetEditLock } from './TargetEditScope'
import ModelPickerModal from './schemas/ModelPickerModal'
import BodyPreviewModal from './BodyPreviewModal'
import SmartImportModal from './SmartImportModal'

interface Props {
  draft: Target
  onChange: (patch: Partial<Target>) => void
  /** design 维护接口定义；debug 编辑调试参数并发送 */
  mode?: 'design' | 'debug'
  intro?: ReactNode
  children?: ReactNode
  /** 调试模式让 URL 与发送按钮横跨请求、响应分屏。 */
  toolbarContainer?: HTMLElement | null
  onPreview?: () => void
  onGenerateCode?: () => void
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const RAW_FORMATS = [
  { value: 'application/json', label: 'JSON' },
  { value: 'application/xml', label: 'XML' },
  { value: 'application/javascript', label: 'JavaScript' },
  { value: 'text/plain', label: 'Text' },
  { value: 'text/html', label: 'HTML' }
]
const BODY_LANGUAGES: Record<RawBodyLanguage, string> = {
  json: 'application/json', xml: 'application/xml', javascript: 'application/javascript',
  text: 'text/plain', html: 'text/html'
}
const TABS = ['Header', 'Query', 'Path', 'Body', '认证', 'Cookie', '预执行操作', '后执行操作']

/** 打开接口时定位到最可能承载参数的标签：读请求看 Query，写请求看 Body。 */
function defaultRequestTab(method?: string): string {
  const verb = (method || 'GET').toUpperCase()
  return verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS' || verb === 'DELETE'
    ? 'Query'
    : 'Body'
}

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

interface ServerNode {
  target_id: string
  parent_id?: string
  server_id?: string
}

/** 与发送端保持一致：最近一层显式指定的 server_id 优先。 */
function nearestServerId(
  target: ServerNode,
  drafts: Record<string, ServerNode>,
  targets: ServerNode[]
): string {
  const seen = new Set<string>()
  let node: ServerNode | undefined = target
  while (node) {
    if (seen.has(node.target_id)) break
    seen.add(node.target_id)
    if (node.server_id && node.server_id !== '0') return node.server_id
    const parentId: string | undefined = node.parent_id
    if (!parentId || parentId === '0') break
    node = drafts[parentId] ?? targets.find((item) => item.target_id === parentId)
  }
  return '0'
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

export default function RequestEditor({ draft, onChange, mode = 'design', intro, children, toolbarContainer, onPreview, onGenerateCode }: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const debug = mode === 'debug'
  const [bodyPreviewOpen, setBodyPreviewOpen] = useState(false)
  const [smartImportOpen, setSmartImportOpen] = useState(false)
  const projectId = useApp((s) => s.project?.project_id ?? '')
  const saveTarget = useApp((s) => s.saveTarget)
  const sendActive = useApp((s) => s.sendActive)
  const cancelSend = useApp((s) => s.cancelSend)
  const sending = useApp((s) => s.sendingId === draft.target_id)
  const requestInFlight = useApp((s) => s.sendingId !== null)
  const actionLock = useRef(false)
  const [acting, setActing] = useState(false)
  const busy = acting || requestInFlight
  const folders = useApp(s => s.targets).filter(target => target.target_type === 'folder')
  const environments = useApp(s => s.environments)
  const currentEnvId = useApp(s => s.currentEnvId)
  const targets = useApp(s => s.targets)
  const drafts = useApp(s => s.drafts)
  const modelEpoch = useModelEpoch(draft.target_id)
  const [urlEditing, setUrlEditing] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [activeTab, setActiveTab] = useState(() => defaultRequestTab(draft.method))
  const [saving, setSaving] = useState(false)
  const [jsonError, setJsonError] = useState<JsonError | null>(null)
  const [bodyView, setBodyView] = useState<'raw' | 'fields'>(debug ? 'raw' : 'fields')
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

  const latestRequest = useRef(request)
  latestRequest.current = request
  const setRequest = (patch: Partial<RequestModel>): void => {
    latestRequest.current = { ...latestRequest.current, ...patch }
    onChange({ request: latestRequest.current })
  }

  const setBody = (patch: Partial<RequestModel['body']>): void => {
    setRequest({ body: { ...(latestRequest.current.body ?? createBody()), ...patch } })
  }

  const setBodyFormat = (contentType: string, patch: Partial<RequestModel['body']> = {}): void => {
    const current = latestRequest.current
    const parameters = current.header?.parameter ?? []
    const header = parameters.find(param => param.key.toLowerCase() === 'content-type')
    const parameter = header ? parameters.map(param => param === header ? { ...param, value: contentType, is_checked: 1 } : param)
      : [...parameters, createParam({ key: 'Content-Type', value: contentType, is_checked: 1 })]
    const raw_language = (Object.keys(BODY_LANGUAGES) as RawBodyLanguage[]).find(key => BODY_LANGUAGES[key] === contentType)
    setRequest({ header: { ...current.header, parameter }, body: { ...(current.body ?? createBody()), raw_language,
      mode: contentType === 'application/json' ? 'json' : 'raw', ...patch } })
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
  }, [projectId, modelEpoch])

  const bodyModel = (request.body ?? createBody()).model_id
  const referencedModel = useMemo(
    () => models.find((model) => model.model_id === bodyModel),
    [models, bodyModel]
  )
  const modelMissing = Boolean(bodyModel) && !referencedModel

  useEffect(() => {
    if (!bodyModel || !projectId) return
    let active = true
    modelDocumentation(projectId, bodyModel).then(documentation => {
      if (active && !hasLocalEdits(draft.target_id)) {
        const current = latestRequest.current
        useApp.getState().applyDerivedPatch(draft.target_id, { request: { ...current, body: { ...current.body, ...documentation } } })
      }
    }).catch(error => { if (active) message.error(error.message) })
    return () => { active = false }
  }, [bodyModel, projectId, modelEpoch])

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
    const documentation = await modelDocumentation(projectId, model.model_id).catch(error => { message.error(error.message); return null })
    if (!documentation) return
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
      ...documentation,
      model_id: model.model_id
    })
    setPickerOpen(false)
  }

  const formatJsonBody = (): void => {
    const current = latestRequest.current.body ?? createBody()
    if (current.mode !== 'json' || current.model_id) return
    const raw = current.raw ?? ''
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw)
      const pretty = JSON.stringify(parsed, null, 2)
      if (pretty !== raw) setBody({ raw: pretty })
    } catch {
      // 不是合法 JSON，保持原样
    }
  }

  const handleSend = async (): Promise<SendRecord | null> => {
    formatJsonBody()
    ensureEnvironmentUrl()
    const problem = latestRequest.current.body?.mode === 'json'
      ? validateJson(latestRequest.current.body.raw ?? '') : null
    setJsonError(problem)
    if (problem) {
      focusJsonError(problem)
      message.error(`JSON 结构错误：第 ${problem.line} 行第 ${problem.column} 列`)
    }
    try {
      const record = await sendActive(draft.target_id)
      if (useApp.getState().project?.project_id !== projectId) return record
      if (record.error?.type === 'cancelled') message.info('请求已取消')
      else if (record.status === 'passed') message.success(`请求完成 ${record.response?.code ?? ''}`)
      else if (record.error) message.error(record.error.message)
      else message.warning('请求完成，断言未通过')
      return record
    } catch (error) {
      message.error((error as Error).message)
      return null
    }
  }

  const handleSave = async (notify = true): Promise<boolean> => {
    formatJsonBody()
    ensureEnvironmentUrl()
    const problem = latestRequest.current.body?.mode === 'json'
      ? validateJson(latestRequest.current.body.raw ?? '') : null
    setJsonError(problem)
    if (problem) {
      focusJsonError(problem)
      message.error(`JSON 结构错误：第 ${problem.line} 行第 ${problem.column} 列`)
    }
    setSaving(true)
    try {
      await saveTarget(draft.target_id)
      if (notify) message.success('已保存')
      return true
    } catch (error) {
      message.error((error as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const body = request.body ?? createBody()
  const bodyValue = body.mode === 'json' ? 'raw' : body.mode
  const bodyContentType = body.mode === 'json' ? 'application/json' :
    (request.header?.parameter.find(param => param.key.toLowerCase() === 'content-type' && param.is_checked > 0)?.value.split(';')[0]
      ?? (body.raw_language ? BODY_LANGUAGES[body.raw_language] : 'text/plain'))
  const bodyLanguage = (Object.keys(BODY_LANGUAGES) as RawBodyLanguage[]).find(key => BODY_LANGUAGES[key] === bodyContentType) ?? 'text'

  const focusJsonError = (error: JsonError): void => {
    const input = document.querySelector<HTMLTextAreaElement>('.editor-shell textarea')
    if (!input) return
    input.focus()
    const start = Math.max(0, Math.min(error.index, Math.max(0, input.value.length - 1)))
    input.setSelectionRange(start, Math.min(input.value.length, start + 1))
  }

  useEffect(() => {
    if (body.mode !== 'json') {
      setJsonError(null)
      return
    }
    const timer = setTimeout(() => setJsonError(validateJson(body.raw ?? '')), 500)
    return () => clearTimeout(timer)
  }, [body.mode, body.raw])

  useEffect(() => {
    if (jsonError && bodyView === 'fields') setBodyView('raw')
  }, [jsonError, bodyView])

  const runAction = async (action: 'send' | 'save' | 'sendSave'): Promise<void> => {
    if (actionLock.current || useApp.getState().sendingId) return
    actionLock.current = true
    setActing(true)
    try {
      if (action === 'save') await handleSave()
      if (action === 'send') await handleSend()
      if (action === 'sendSave') {
        const record = await handleSend()
        const current = useApp.getState().drafts[draft.target_id]
        if (!record?.response || !current || useApp.getState().project?.project_id !== projectId) return
        const examples = current.response?.example ?? []
        const captured = exampleFromRecord(record)
        captured.expect = { ...captured.expect, is_default: examples.length === 0 ? 1 : 0 }
        useApp.getState().patchDraft(draft.target_id, { response: { ...current.response, example: [...examples, captured] } })
        if (await handleSave(false)) message.success('响应已保存为示例')
      }
    } finally {
      actionLock.current = false
      setActing(false)
    }
  }

  const sendMenu = {
    items: [
      { key: 'sendSave', label: '发送并保存响应', disabled: busy }
    ],
    onClick: ({ key }: { key: string }) => void runAction(key as 'send' | 'sendSave')
  }

  const saveMenu = {
    selectedKeys: [draft.parent_id || '0'],
    items: [{ key: '0', label: '根目录' }, ...folders.map(folder => ({ key: folder.target_id, label: folder.name }))],
    onClick: ({ key }: { key: string }) => {
      if (busy) return
      onChange({ parent_id: key })
      void runAction('save')
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
        </div>
      )
    }
    if (body.mode === 'raw' || body.mode === 'json') {
      const fieldView = !debug && body.mode === 'json' && bodyView === 'fields'
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
                {debug ? null : (
                  <>
                    <Tooltip title="解除引用后保留当前 JSON 可编辑">
                      <button className="mini" onClick={confirmEdit}>
                        编辑
                      </button>
                    </Tooltip>
                    <button className="mini" onClick={clearModelRef}>
                      解除引用
                    </button>
                  </>
                )}
              </>
            ) : debug && body.mode === 'json' ? (
              <>
                <button
                  className="mini"
                  disabled={body.mode !== 'json' && body.mode !== 'raw'}
                  onClick={() =>
                    setBody({
                      mode: 'json',
                      raw: buildExampleFromDocs(body.field_docs ?? [], body.raw ?? '')
                    })
                  }
                >
                  从设计请求参数生成
                </button>
              </>
            ) : !debug && body.mode === 'json' ? (
              <>
                <button className="mini" onClick={() => setPickerOpen(true)} disabled={!projectId}>
                  引用模型
                </button>
                <span className="muted">也可直接手写 JSON</span>
              </>
            ) : null}
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
                {!debug && body.mode === 'json' ? (
                  <Segmented
                    className="body-view-segmented"
                    size="small"
                    value={bodyView}
                    onChange={(value) => setBodyView(value as 'raw' | 'fields')}
                    options={[
                      { label: '数据结构', value: 'fields' },
                      { label: '示例', value: 'raw' }
                    ]}
                  />
                ) : null}
              </>
            )}
            {debug && (
              <div className="debug-body-toolbar">
                {body.mode === 'json' && (
                  <button disabled={Boolean(bodyModel)} onClick={formatJsonBody}>美化</button>
                )}
                <button onClick={async () => {
                  const result = await window.api.app.copyText(body.raw ?? '')
                  result.ok ? message.success('请求体已复制') : message.error(result.error)
                }}>复制</button>
              </div>
            )}
            {!debug && <div className="debug-body-toolbar">
              <button disabled={Boolean(bodyModel)} onClick={() => setBodyView('raw')}>Raw编辑</button>
              <button onClick={() => setBodyPreviewOpen(true)}>预览</button>
              <button disabled={!onGenerateCode} onClick={onGenerateCode}>生成代码</button>
              <button disabled={Boolean(bodyModel)} onClick={() => setSmartImportOpen(true)}>智能导入</button>
            </div>}
          </div>
          {fieldView ? (
            <JsonFieldTable
              compact={!debug}
              raw={body.raw ?? ''}
              docs={body.field_docs ?? []}
              valuesReadOnly={Boolean(bodyModel)}
              mode={mode}
              title="数据结构"
              onChangeRaw={(raw) => setBody({ raw })}
              onChangeDocs={(field_docs) => setBody({ field_docs })}
            />
          ) : (
            <div className="editor-shell fill">
              <JsonBodyInput
                highlight={body.mode === 'json'}
                aria-label="请求 Body"
                value={body.raw ?? ''}
                readOnly={Boolean(bodyModel)}
                onChange={(event) => setBody({ raw: event.target.value })}
                onBlur={() => {
                  if (bodyModel) return
                  formatJsonBody()
                  const problem = latestRequest.current.body?.mode === 'json'
      ? validateJson(latestRequest.current.body.raw ?? '') : null
                  setJsonError(problem)
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
        <ParameterTable
          title="表单参数（urlencoded）"
          params={body.urlencoded ?? []}
          mode={mode}
          onChange={(urlencoded) => setBody({ urlencoded })}
        />
      )
    }
    if (body.mode === 'formdata') {
      return (
        <ParameterTable
          title="表单参数（form-data）"
          params={body.formdata ?? []}
          mode={mode}
          onChange={(formdata) => setBody({ formdata })}
          valuePlaceholder="值或文件路径"
          allowFile
        />
      )
    }
    return <div className="binary-upload" onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault()
      const file = event.dataTransfer.files[0]
      if (!file) return
      const file_path = window.api.files.getPathForFile(file)
      if (file_path) setBody({ binary: { file_path, file_name: file.name } })
    }}>
      <button aria-label="上传文件" className={`binary-upload-trigger${body.binary?.file_path ? ' has-file' : ''}`} onClick={async () => {
        try {
          const result = await window.api.dialog.openFiles(false)
          if (!result.ok) { message.error(result.error); return }
          const file = result.data[0]
          if (file) setBody({ binary: { file_path: file.path, file_name: file.name } })
        } catch (error) { message.error((error as Error).message) }
      }}><UploadOutlined />上传文件</button>
      {body.binary?.file_path && <div className="binary-file-row"><PaperClipOutlined /><span title={body.binary.file_path}>{body.binary.file_name || body.binary.file_path.split(/[\\/]/).pop()}</span>
        <Tooltip title="删除文件"><button aria-label="移除文件" onClick={() => setBody({ binary: {} })}><DeleteOutlined /></button></Tooltip></div>}
    </div>
  }

  const environment = environments.find((env) => env.env_id === currentEnvId) ?? null
  const serverId = useMemo(
    () => nearestServerId(draft, drafts, targets),
    [draft, drafts, targets]
  )
  const environmentParts = useMemo(
    () => splitEnvironmentUrl(draft.url ?? '', environment, serverId),
    [draft.url, environment, serverId]
  )
  const editableUrl = environmentParts.bound ? environmentParts.path : draft.url ?? ''
  const displayedUrl = withQueryParams(editableUrl, request.query?.parameter ?? [], request.query?.omit_empty_equals)
  // 发送/保存前把写死域名的 URL 改绑为 {{baseUrl}} + 路径，保证实际请求使用当前环境。
  // 从 store 读取最新草稿，避免回车提交后仍用旧 URL 覆盖刚编辑的路径。
  const ensureEnvironmentUrl = (): void => {
    const state = useApp.getState()
    const current = state.drafts[draft.target_id] ?? draft
    const env = state.environments.find((item) => item.env_id === state.currentEnvId) ?? null
    const parts = splitEnvironmentUrl(
      current.url ?? '',
      env,
      nearestServerId(current, state.drafts, state.targets)
    )
    if (!parts.bound) return
    const url = joinEnvironmentUrl(parts, parts.path)
    if (url !== (current.url ?? '')) onChange({ url })
  }
  useTargetEditLock(urlEditing && urlText !== displayedUrl)
  const boundUrl = (path: string): string => joinEnvironmentUrl(environmentParts, path)
  const updateQuery = (parameter: RequestModel['query']['parameter'], omit = request.query?.omit_empty_equals): void => {
    parameter = [...(request.query?.parameter ?? []).filter(param => param.inherited_override && !parameter.some(item => item.param_id === param.param_id)), ...parameter]
    const nextPath = withQueryParams(withoutQueryKeys(editableUrl, (request.query?.parameter ?? []).map(param => param.key)), parameter, omit)
    const url = boundUrl(nextPath)
    latestRequest.current = { ...latestRequest.current, query: { ...request.query, parameter, omit_empty_equals: omit } }
    onChange({ url, request: latestRequest.current })
  }
  const commitUrl = (value: string): void => {
    const urlPath = environmentParts.bound
      ? editableEnvironmentPath(environmentParts, value, environment, serverId)
      : value
    const names = [...urlPath.split('?')[0].matchAll(/(?<!\{)\{([^{}]+)\}(?!\})/g)].map(match => match[1])
    const existing = latestRequest.current.restful?.parameter ?? []
    const parameter = [...existing, ...[...new Set(names)].filter(key => !existing.some(param => param.key === key)).map(key => createParam({ key }))]
    const queryText = urlPath.split('#')[0].split('?').slice(1).join('?')
    const previous = latestRequest.current.query?.parameter ?? []
    const remaining = previous.slice()
    const parsed = [...new URLSearchParams(queryText)].filter(([key]) => key).map(([key, value]) => {
      const index = remaining.findIndex(param => param.key === key && (param.is_checked > 0 || (param.is_system ?? 0) > 0))
      const param = index < 0 ? createParam({ key }) : remaining.splice(index, 1)[0]
      return { ...param, value, is_checked: 1, is_system: -1 }
    })
    const unchanged = urlPath === displayedUrl
    const query = unchanged ? previous : [...parsed, ...remaining.filter(param => param.is_checked < 0 && (param.is_system ?? 0) <= 0)]
    latestRequest.current = { ...latestRequest.current, restful: { parameter }, query: { ...latestRequest.current.query, parameter: query } }
    onChange({ url: boundUrl(urlPath), request: latestRequest.current })
    setUrlEditing(false)
  }

  const tabCount = (tab: string): number => {
    const fields = tab === 'Header' ? request.header?.parameter : tab === 'Query' ? request.query?.parameter : tab === 'Path' ? request.restful?.parameter : undefined
    if (fields) return fields.filter(param => param.key.trim() && !param.inherited_override).length
    if (tab === 'Body') return body.mode === 'none' ? 0 : body.mode === 'formdata' ? (body.formdata ?? []).filter(param => param.key.trim()).length : body.mode === 'urlencoded' ? (body.urlencoded ?? []).filter(param => param.key.trim()).length : 1
    return 0
  }

  const renderContent = (): JSX.Element | null => {
    if (activeTab === 'Body') {
      const changeMode = (value: string): void => {
        if (value === 'msgpack') return
        const nextMode = (value === 'raw' ? (body.mode === 'raw' ? 'raw' : 'json') : value) as BodyMode
        const next = { ...(latestRequest.current.body ?? createBody()), mode: nextMode }
        if (nextMode !== 'raw' && nextMode !== 'json') delete next.model_id
        setRequest({ body: next })
      }
      return (
        <div className={`req-body req-body--${body.mode}${jsonError ? ' has-json-error' : ''}`}>
          <div className="bodytypes">
            <Radio.Group
              value={bodyValue}
              onChange={event => changeMode(String(event.target.value))}
              options={BODY_OPTIONS}
            />
            {debug && <Select className="debug-body-mode-select" aria-label="Body 类型" variant="borderless" value={bodyValue} options={BODY_OPTIONS} onChange={changeMode} />}
            {(body.mode === 'json' || body.mode === 'raw') && <Select
              className="raw-format" aria-label="请求体格式" size="small" disabled={Boolean(bodyModel)}
              value={bodyContentType}
              options={RAW_FORMATS}
              onChange={contentType => setBodyFormat(contentType)} />}
          </div>
          {!debug && body.mode === 'none' && <Button size="small" onClick={() => setSmartImportOpen(true)}>智能导入</Button>}
          {renderBody()}
        </div>
      )
    }
    if (activeTab === 'Header') {
      return (
        <div className="req-body">
          <InheritedRequestParams draft={draft} location="header" onChange={parameter => setRequest({ header: { ...request.header, parameter } })} />
          <ParameterTable
            title="公共参数（Header）"
            params={(request.header?.parameter ?? []).filter(param => !param.inherited_override)}
            mode={mode}
            onChange={parameter => setRequest({ header: { parameter: [...(request.header?.parameter ?? []).filter(param => param.inherited_override), ...parameter] } })}
            keyPlaceholder="Header 名"
          />
        </div>
      )
    }
    if (activeTab === 'Query') {
      return (
        <div className="req-body">
          <InheritedRequestParams draft={draft} location="query" onChange={parameter => setRequest({ query: { ...request.query, parameter } })} />
          <ParameterTable
            title="查询参数（Query）"
            params={(request.query?.parameter ?? []).filter(param => !param.inherited_override)}
            mode={mode}
            onChange={updateQuery}
            omitEmptyEquals={request.query?.omit_empty_equals} onChangeEmptyEquals={(value: boolean) => updateQuery(request.query?.parameter ?? [], value)}
            keyPlaceholder="参数名"
          />
        </div>
      )
    }
    if (activeTab === 'Path') {
      return (
        <div className="req-body">
          <InheritedRequestParams draft={draft} location="restful" onChange={parameter => setRequest({ restful: { ...request.restful, parameter } })} />
          <ParameterTable
            path
            title="路径参数（Path）"
            params={(request.restful?.parameter ?? []).filter(param => !param.inherited_override)}
            mode={mode}
            onChange={(parameter) => setRequest({ restful: { parameter: [...(request.restful?.parameter ?? []).filter(param => param.inherited_override), ...parameter] } })}
            keyPlaceholder="路径变量（不含 {}）"
          />
        </div>
      )
    }
    if (activeTab === 'Cookie') {
      return (
        <div className="req-body">
          <ParameterTable
            title="Cookie 参数"
            params={request.cookie?.parameter ?? []}
            mode={mode}
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
    const pre = activeTab === '预执行操作'
    return <div className="req-body"><RequestScriptEditor key={pre ? 'pre' : 'post'} stage={pre ? 'pre' : 'post'}
      value={pre ? request.pre_script ?? '' : request.test ?? ''}
      enabled={pre ? request.pre_script_enabled : request.test_enabled}
      onChange={(value, enabled) => setRequest(pre ? { pre_script: value, pre_script_enabled: enabled } : { test: value, test_enabled: enabled })} />
    </div>
  }

  const urlBar = <div className="url-row">
        <div className="url-capsule">
          <div className="method-select">
            <Dropdown
              trigger={['click']}
              menu={{
                items: METHODS.map((method) => ({ key: method, label: method })),
                onClick: ({ key }) => onChange({ method: key })
              }}
            >
              <button className="method-btn" style={{ color: methodColor(draft.method) }} aria-label="请求方式">
                <span>{(draft.method || 'GET').toUpperCase()}</span>
                <DownOutlined style={{ fontSize: 9 }} />
              </button>
            </Dropdown>
          </div>
          <div className="url-input">
            {environmentParts.bound && environmentParts.prefix ? (
              <Tooltip title={`${environmentParts.prefix} · 来自环境「${environment?.name || '当前环境'}」，可在环境管理中修改`}>
                <span className="url-prefix" aria-label="环境前置地址">{environmentParts.prefix}</span>
              </Tooltip>
            ) : null}
            <Input
              variant="borderless"
              value={urlEditing ? urlText : displayedUrl}
              onFocus={() => { setUrlText(displayedUrl); setUrlEditing(true) }}
              onChange={event => { setUrlEditing(true); setUrlText(event.target.value) }}
              onBlur={event => commitUrl(event.target.value)}
              placeholder={environmentParts.bound ? '输入请求路径' : '请输入请求 URL'}
              aria-label="请求 URL"
              onPressEnter={event => {
                commitUrl(event.currentTarget.value)
                if (debug) void runAction('send')
              }}
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

        {debug ? (
          <div className="send-group">
            <button className="send-btn" onClick={() => void runAction('send')} disabled={busy}>
              {sending ? '发送中…' : '发送'}
            </button>
            {sending && <button className="cancel-send-btn" onClick={() => void cancelSend().catch(error => message.error(error.message))}>取消发送</button>}
            <Dropdown menu={sendMenu} trigger={['click']} disabled={busy}>
              <button className="send-caret" aria-label="发送选项" disabled={busy}>
                <DownOutlined style={{ fontSize: 9 }} />
              </button>
            </Dropdown>
          </div>
        ) : null}

        {!debug && onPreview && <Button size="small" icon={<EyeOutlined />} onClick={onPreview}>预览</Button>}
        <div className="save-group">
          <button className="save-btn" onClick={() => void runAction('save')} disabled={busy}>
            {saving ? '保存中…' : '保存'}
          </button>
          {debug && <Dropdown menu={saveMenu} trigger={['click']} disabled={busy}>
            <button className="save-caret" aria-label="保存到目录" disabled={busy}>
              <DownOutlined style={{ fontSize: 9 }} />
            </button>
          </Dropdown>}
        </div>
      </div>

  return (
    <div className={`request-pane request-pane--${mode}`}>
      {toolbarContainer ? createPortal(urlBar, toolbarContainer) : urlBar}

      {intro}
      <div className={`request-tab-bar${debug ? ' is-debug' : ''}`}>
      <div className="req-tabs" role="tablist" aria-label="请求参数">
        {(debug ? TABS : TABS.slice(0, 5)).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-label={tab}
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab}{tabCount(tab) > 0 && <span className="request-tab-count">({tabCount(tab)})</span>}
          </button>
        ))}
      </div>
      {debug && <Dropdown trigger={['click']} menu={{ selectedKeys: [activeTab], items: TABS.map(tab => ({ key: tab, label: tab })), onClick: ({ key }) => setActiveTab(key) }}>
        <button className="editor-tab-overflow" aria-label="更多请求标签"><MoreOutlined /></button>
      </Dropdown>}
      </div>

      {renderContent()}
      {children}
      <BodyPreviewModal open={bodyPreviewOpen}
        raw={bodyLanguage === 'json' ? buildBodyExample(body.raw ?? '', body.field_docs ?? []).text : body.raw ?? ''}
        language={bodyLanguage} onClose={() => setBodyPreviewOpen(false)} />
      <SmartImportModal open={smartImportOpen} existingDocs={body.field_docs ?? []}
        onClose={() => setSmartImportOpen(false)} onApply={({ raw, fieldDocs }) => {
          setBodyFormat('application/json', { raw, field_docs: fieldDocs })
          setBodyView('fields')
          setJsonError(validateJson(raw))
        }} />

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

  const field = (label: string, input: JSX.Element): JSX.Element => <div className="request-auth-row"><label>{label}</label>{input}</div>
  return <div className="request-auth-form">
    {field('类型', <Select aria-label="认证类型" value={auth.type} onChange={type => updateAuth({ type })}
      options={[{ value: 'inherit', label: '继承父级' }, { value: 'noauth', label: '无需认证' },
        { value: 'bearer', label: 'Bearer Token' }, { value: 'basic', label: 'Basic auth' }, { value: 'kv', label: '私密键值对' }]} />)}
    {auth.type === 'bearer' && field('Token', <Input aria-label="Token" placeholder="Bearer token" value={auth.bearer?.key ?? ''} onChange={event => updateAuth({ bearer: { key: event.target.value } })} />)}
    {auth.type === 'basic' && <>
      {field('Username', <Input placeholder="用户名" value={auth.basic?.username ?? ''} onChange={event => updateAuth({ basic: { ...auth.basic, username: event.target.value } })} />)}
      {field('Password', <Input.Password placeholder="密码" value={auth.basic?.password ?? ''} onChange={event => updateAuth({ basic: { ...auth.basic, password: event.target.value } })} />)}
    </>}
    {auth.type === 'kv' && <>
      {field('Key', <Input placeholder="Key" value={auth.kv?.key ?? ''} onChange={event => updateAuth({ kv: { ...auth.kv, key: event.target.value } })} />)}
      {field('Value', <Input placeholder="Value" value={auth.kv?.value ?? ''} onChange={event => updateAuth({ kv: { ...auth.kv, value: event.target.value } })} />)}
      {field('添加位置', <Select aria-label="认证添加位置" value={auth.kv?.in ?? 'header'} options={[{ value: 'header', label: 'Header' }, { value: 'query', label: 'Query' }]}
        onChange={value => updateAuth({ kv: { ...auth.kv, in: value } })} />)}
    </>}
  </div>
}
