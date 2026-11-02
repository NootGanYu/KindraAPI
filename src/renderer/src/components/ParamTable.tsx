import FieldRulesEditor from './FieldRulesEditor'
import { useState } from 'react'
import type { DragEvent } from 'react'
import { App as AntApp, Button, Checkbox, Input, Select, Tooltip } from 'antd'
import {
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  RightOutlined
} from '@ant-design/icons'
import type { Param } from '@shared/types'
import { createParam } from '@shared/factories'
import { useApp } from '../store'
import DictionarySuggest from './schemas/DictionarySuggest'

interface Props {
  params: Param[]
  onChange: (next: Param[]) => void
  title?: string
  keyPlaceholder?: string
  valuePlaceholder?: string
  showDescription?: boolean
  /** 设计模式维护契约；调试模式只允许改值和勾选 */
  mode?: 'design' | 'debug' | 'edit'
  /** form-data 模式：允许把某行切换为本地文件 */
  allowFile?: boolean
}

function fileNameOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

function formatSize(size?: number): string {
  if (!size || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

export default function ParamTable({
  params,
  onChange,
  title = '公共参数',
  keyPlaceholder = '参数名',
  valuePlaceholder = '参数值',
  showDescription = true,
  mode = 'edit',
  allowFile = false
}: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const [collapsed, setCollapsed] = useState(false)
  const projectId = useApp((state) => state.project?.project_id ?? '')
  const debug = mode === 'debug'
  const showDesc = showDescription && !debug

  const update = (index: number, patch: Partial<Param>): void => {
    onChange(params.map((param, i) => (i === index ? { ...param, ...patch } : param)))
  }

  const add = (): void => {
    onChange([...params, createParam()])
  }

  const applyFiles = (
    index: number,
    files: Array<{ path: string; name?: string; size: number }>
  ): void => {
    if (files.length === 0) return
    const next = params.slice()
    const first = files[0]
    next[index] = {
      ...next[index],
      value: first.path,
      field_type: 'file',
      file_size: first.size
    }
    for (const file of files.slice(1)) {
      next.push(
        createParam({
          key: params[index].key,
          value: file.path,
          field_type: 'file',
          file_size: file.size,
          is_checked: 1
        })
      )
    }
    onChange(next)
  }

  const pickFiles = async (index: number): Promise<void> => {
    const result = await window.api.dialog.openFiles()
    if (!result.ok) {
      message.error(result.error)
      return
    }
    applyFiles(index, result.data)
  }

  const dropFiles = (event: DragEvent, index: number): void => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files).map((file) => ({
      path: window.api.files.getPathForFile(file),
      size: file.size
    }))
    applyFiles(
      index,
      files.filter((file) => Boolean(file.path))
    )
  }

  const allChecked = params.length > 0 && params.every((param) => param.is_checked > 0)
  const someChecked = params.some((param) => param.is_checked > 0)
  const toggleAll = (): void => {
    const value = allChecked ? -1 : 1
    onChange(params.map((param) => ({ ...param, is_checked: value })))
  }

  return (
    <div className="param-section">
      <div className="param-section-head">
        <button
          className="param-section-toggle"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? (
            <RightOutlined style={{ fontSize: 9 }} />
          ) : (
            <DownOutlined style={{ fontSize: 9 }} />
          )}
        </button>
        <span className="param-section-title">{title}</span>
        <Tooltip title="添加参数">
          <button className="param-add-mini" onClick={add}>
            <PlusOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
      </div>

      {collapsed ? null : (
        <div className={`param-table${showDesc ? '' : ' no-desc'}`}>
          <div className="param-tr param-thead">
            <div className="param-td param-check">
              <Checkbox
                checked={allChecked}
                indeterminate={!allChecked && someChecked}
                onChange={toggleAll}
              />
            </div>
            <div className="param-td param-name">参数名</div>
            <div className="param-td param-value">参数值</div>
            {showDesc ? <div className="param-td param-desc">描述</div> : null}
          </div>

          {params.map((param, index) => (
            <div className="param-tr" key={param.param_id}>
              <div className="param-td param-check">
                <Checkbox
                  checked={param.is_checked > 0}
                  onChange={(event) =>
                    update(index, { is_checked: event.target.checked ? 1 : -1 })
                  }
                />
              </div>
              <div className="param-td param-name" style={{ display: 'flex', gap: 4 }}>
                {showDesc && <FieldRulesEditor value={{ ...param, type: param.field_type }} onChange={({ type, ...rules }) => update(index, { ...rules, field_type: type })} />}
                {allowFile ? (
                  <Select
                    size="small"
                    variant="borderless"
                    style={{ width: 62, flex: 'none' }}
                    value={param.field_type === 'file' ? 'file' : 'text'}
                    options={[
                      { value: 'text', label: '文本' },
                      { value: 'file', label: '文件' }
                    ]}
                    onChange={(value) =>
                      update(index, {
                        field_type: value === 'file' ? 'file' : 'string',
                        file_size: value === 'file' ? param.file_size : undefined
                      })
                    }
                  />
                ) : null}
                <Input
                  variant="borderless"
                  value={param.key}
                  placeholder={keyPlaceholder}
                  onChange={(event) => update(index, { key: event.target.value })}
                  onPressEnter={() => {
                    if (index === params.length - 1) add()
                  }}
                />
              </div>
              <div
                className="param-td param-value"
                onDragOver={(event) => {
                  if (allowFile) event.preventDefault()
                }}
                onDrop={(event) => {
                  if (allowFile) dropFiles(event, index)
                }}
              >
                {allowFile && param.field_type === 'file' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 12
                      }}
                      title={param.value}
                    >
                      {param.value ? fileNameOf(param.value) : '未选择文件'}
                    </span>
                    <span className="muted" style={{ fontSize: 11, flex: 'none' }}>
                      {formatSize(param.file_size)}
                    </span>
                    <Button size="small" type="link" onClick={() => void pickFiles(index)}>
                      选择
                    </Button>
                    {param.value ? (
                      <Button
                        size="small"
                        type="text"
                        onClick={() => update(index, { value: '', file_size: undefined })}
                      >
                        清除
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <Input
                    variant="borderless"
                    value={param.value}
                    placeholder={valuePlaceholder}
                    onChange={(event) => update(index, { value: event.target.value })}
                    onPressEnter={() => {
                      if (index === params.length - 1) add()
                    }}
                  />
                )}
              </div>
              {showDesc ? (
                <div className="param-td param-desc">
                  {projectId ? (
                    <DictionarySuggest
                      projectId={projectId}
                      value={param.description ?? ''}
                      placeholder="描述"
                      size="small"
                      onChange={(value) => update(index, { description: value })}
                    />
                  ) : (
                    <Input
                      variant="borderless"
                      value={param.description ?? ''}
                      placeholder="描述"
                      onChange={(event) => update(index, { description: event.target.value })}
                    />
                  )}
                </div>
              ) : null}
              <div className="param-actions">
                <Tooltip title="删除">
                  <button
                    className="param-delete"
                    onClick={() => onChange(params.filter((_, i) => i !== index))}
                  >
                    <DeleteOutlined style={{ fontSize: 12 }} />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}

          {params.length === 0 ? (
            <button className="param-add-row" onClick={add}>
              <PlusOutlined style={{ fontSize: 12 }} /> 添加参数
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
