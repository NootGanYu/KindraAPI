import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App as AntApp, Button, Dropdown, Input, Tag, Tooltip } from 'antd'
import {
  CodeOutlined,
  DeleteOutlined,
  DownOutlined,
  EyeOutlined,
  ImportOutlined,
  SaveOutlined,
  TableOutlined
} from '@ant-design/icons'
import type { DataModel, GeneratedExampleResult, ModelSummary } from '@shared/types'
import JsonCode from '../JsonCode'
import SchemaFieldEditor from './SchemaFieldEditor'
import { cloneSchema, prettyJson, validateSchema } from './modelUtils'

type Mode = 'visual' | 'raw' | 'preview'

interface Props {
  projectId: string
  model: DataModel
  models: ModelSummary[]
  onSaved: (model: DataModel) => void
  onDeleted: (modelId: string) => void
  onDirtyChange: (dirty: boolean) => void
}

export default function ModelEditor({
  projectId,
  model,
  models,
  onSaved,
  onDeleted,
  onDirtyChange
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [draft, setDraft] = useState<DataModel>(() => cloneSchema(model))
  const [mode, setMode] = useState<Mode>('visual')
  const [rawText, setRawText] = useState(() => prettyJson(model.data.schema))
  const [rawError, setRawError] = useState('')
  const [preview, setPreview] = useState<GeneratedExampleResult | null>(null)
  const [saving, setSaving] = useState(false)
  const initialRef = useRef(JSON.stringify(model))

  useEffect(() => {
    const next = cloneSchema(model)
    setDraft(next)
    setMode('visual')
    setRawText(prettyJson(next.data.schema))
    setRawError('')
    setPreview(null)
    initialRef.current = JSON.stringify(model)
    onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.model_id])

  useEffect(() => {
    const dirty = JSON.stringify(draft) !== initialRef.current || (mode === 'raw' && rawText !== prettyJson(draft.data.schema))
    onDirtyChange(dirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, mode, rawText])

  const isFolder = draft.model_type === 'folder'
  const modelOptions = useMemo(
    () => models.filter((item) => item.model_type === 'model'),
    [models]
  )

  const patch = (value: Partial<DataModel>): void => {
    setDraft((current) => ({ ...current, ...value }))
  }

  const patchData = (value: Partial<DataModel['data']>): void => {
    setDraft((current) => ({ ...current, data: { ...current.data, ...value } }))
  }

  const refreshPreview = async (schema = draft.data.schema): Promise<void> => {
    const result = await window.api.models.generateFromSchema(projectId, schema)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    setPreview(result.data)
  }

  const parseRaw = (): DataModel['data']['schema'] | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch (error) {
      setRawError(`JSON 解析失败：${(error as Error).message}`)
      return null
    }
    const problem = validateSchema(parsed)
    if (problem) {
      setRawError(problem)
      return null
    }
    setRawError('')
    return parsed as DataModel['data']['schema']
  }

  const applyRaw = (): boolean => {
    const schema = parseRaw()
    if (!schema) return false
    patchData({ schema })
    return true
  }

  const switchMode = (next: Mode): void => {
    if (next === mode) return
    const currentSchema = mode === 'raw' ? parseRaw() : draft.data.schema
    if (!currentSchema) return
    if (mode === 'raw') patchData({ schema: currentSchema })
    if (next === 'raw') setRawText(prettyJson(draft.data.schema))
    if (next === 'preview') void refreshPreview(currentSchema)
    setMode(next)
  }

  const save = async (): Promise<void> => {
    if (saving) return
    const schema = mode === 'raw' ? parseRaw() : draft.data.schema
    if (!schema) return
    const name = draft.name.trim()
    if (!name) {
      message.error('请输入模型名称')
      return
    }
    if (!isFolder) {
      const problem = validateSchema(schema)
      if (problem) {
        message.error(problem)
        setMode('raw')
        return
      }
      const duplicate = models.find(
        (item) =>
          item.model_id !== draft.model_id &&
          item.model_type === draft.model_type &&
          item.name === name
      )
      if (duplicate) message.warning('已存在同名模型，请确认是否符合预期')
      const generated = await window.api.models.generateFromSchema(projectId, schema)
      if (generated.ok && generated.data.warnings.length > 0) {
        message.warning(generated.data.warnings[0].message)
      }
    }
    setSaving(true)
    try {
      const result = await window.api.models.save(projectId, {
        ...draft,
        data: { ...draft.data, schema },
        name,
        updated_by: '本地'
      })
      if (!result.ok) throw new Error(result.error)
      initialRef.current = JSON.stringify(result.data)
      setDraft(cloneSchema(result.data))
      setRawText(prettyJson(result.data.data.schema))
      onDirtyChange(false)
      onSaved(result.data)
      message.success('已保存')
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    const references = await window.api.models.references(projectId, draft.model_id)
    if (!references.ok) {
      message.error(references.error)
      return
    }
    const list = references.data
    modal.confirm({
      title: `删除${isFolder ? '目录' : '模型'}「${draft.name}」？`,
      width: 520,
      content: (
        <div>
          {isFolder ? (
            <p>目录下的模型会一并删除，且不可撤销。</p>
          ) : null}
          {list.length > 0 ? (
            <>
              <p>以下接口仍引用该模型，删除后引用会保留为失效引用：</p>
              <ul style={{ paddingLeft: 18, maxHeight: 180, overflow: 'auto' }}>
                {list.map((reference) => (
                  <li key={`${reference.target_id}-${reference.kind}`}>
                    {reference.target_name}
                    <span className="muted">
                      {' '}
                      · {reference.kind === 'request-body' ? '请求 Body' : '响应示例'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">没有接口引用该模型。</p>
          )}
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.api.models.delete(projectId, draft.model_id)
        if (!result.ok) {
          message.error(result.error)
          return
        }
        onDeleted(draft.model_id)
        message.success('已删除')
      }
    })
  }

  if (isFolder) {
    return (
      <div className="model-editor">
        <div className="model-editor-head">
          <Input
            size="large"
            variant="borderless"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="目录名称"
            style={{ maxWidth: 420, fontSize: 18, fontWeight: 600 }}
          />
          <span style={{ flex: 1 }} />
          <Button danger icon={<DeleteOutlined />} onClick={() => void remove()}>
            删除
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
            保存
          </Button>
        </div>
        <div className="model-editor-body">
          <Alert
            type="info"
            showIcon
            message="模型目录"
            description="目录用于组织数据模型；保存名称后可在左侧树中拖拽调整顺序或移动。"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="model-editor">
      <div className="model-editor-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            size="large"
            variant="borderless"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="输入模型名称，建议使用代码模型名称或其同义词"
            style={{ fontSize: 18, fontWeight: 600, paddingLeft: 0 }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Input
              size="small"
              variant="borderless"
              value={draft.alias ?? ''}
              onChange={(event) => patch({ alias: event.target.value })}
              placeholder="别名（可选）"
              style={{ maxWidth: 200, paddingLeft: 0 }}
            />
            <Input
              size="small"
              variant="borderless"
              value={draft.data.description}
              onChange={(event) => patchData({ description: event.target.value })}
              placeholder="模型描述（可选）"
              style={{ flex: 1, paddingLeft: 0 }}
            />
          </div>
        </div>
        <Button danger icon={<DeleteOutlined />} onClick={() => void remove()}>
          删除
        </Button>
        <Dropdown.Button type="primary" icon={<DownOutlined />} loading={saving} onClick={() => void save()} menu={{ selectable: true, selectedKeys: [draft.parent_id], items: [{ key: '0', label: '根目录' }, ...models.filter(item => item.model_type === 'folder').map(item => ({ key: item.model_id, label: item.name }))], onClick: ({ key }) => patch({ parent_id: key }) }}>保存</Dropdown.Button>
      </div>

      <div className="model-toolbar">
        <div className="segmented">
          <button className={mode === 'visual' ? 'active' : ''} onClick={() => switchMode('visual')}>
            <TableOutlined /> 可视化
          </button>
          <button className={mode === 'raw' ? 'active' : ''} onClick={() => switchMode('raw')}>
            <CodeOutlined /> Raw 编辑
          </button>
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => switchMode('preview')}>
            <EyeOutlined /> 预览
          </button>
        </div>
        <Tooltip title="后续支持">
          <button className="model-disabled-btn" disabled>
            <CodeOutlined /> 生成代码
          </button>
        </Tooltip>
        <Tooltip title="后续支持">
          <button className="model-disabled-btn" disabled>
            <ImportOutlined /> 智能导入
          </button>
        </Tooltip>
        <span style={{ flex: 1 }} />
        <Tag bordered={false} color="gold">
          {draft.model_id}
        </Tag>
      </div>

      <div className="model-editor-body">
        {mode === 'visual' ? (
          <SchemaFieldEditor
            projectId={projectId}
            schema={draft.data.schema}
            models={modelOptions}
            onChange={(schema) => patchData({ schema })}
          />
        ) : mode === 'raw' ? (
          <div className="model-raw">
            <div className="model-raw-actions">
              <span className="muted">
                Raw JSON Schema 是唯一事实来源；切换回可视化前会校验结构。
              </span>
              <span style={{ flex: 1 }} />
              <Button size="small" onClick={() => setRawText(prettyJson(draft.data.schema))}>
                重置
              </Button>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  if (applyRaw()) message.success('已应用，可切回可视化')
                }}
              >
                应用
              </Button>
            </div>
            <Input.TextArea
              className="mono"
              value={rawText}
              onChange={(event) => {
                setRawText(event.target.value)
                setRawError('')
              }}
              autoSize={{ minRows: 18 }}
              spellCheck={false}
            />
            {rawError ? <Alert style={{ marginTop: 10 }} type="error" showIcon message={rawError} /> : null}
          </div>
        ) : (
          <div className="model-preview">
            <div className="model-preview-actions">
              <Button size="small" onClick={() => void refreshPreview()}>
                重新生成
              </Button>
              <span className="muted">按 example → default → enum → 类型占位生成</span>
            </div>
            {preview && preview.warnings.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 10 }}
                message="生成警告"
                description={preview.warnings.map((warning) => (
                  <div key={`${warning.code}-${warning.path ?? ''}-${warning.ref ?? ''}`}>
                    · {warning.message}
                  </div>
                ))}
              />
            ) : null}
            <JsonCode className="resp-code" text={prettyJson(preview?.value ?? {})} />
          </div>
        )}
      </div>
    </div>
  )
}
