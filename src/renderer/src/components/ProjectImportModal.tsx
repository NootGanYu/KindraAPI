import { useEffect, useState } from 'react'
import type { DragEvent } from 'react'
import { App as AntApp, Alert, Input, Modal, Radio, Select, Space, Tag } from 'antd'
import { FileAddOutlined, UploadOutlined } from '@ant-design/icons'
import type { ProjectImportInspection, ProjectImportResult, Result } from '@shared/types'
import { useApp } from '../store'

interface Props {
  open: boolean
  onClose: () => void
  onImported?: (result: ProjectImportResult) => void
}

interface PickedFile {
  path: string
  name: string
  size: number
}

type ImportMode = 'new' | 'existing'

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function formatSize(size: number): string {
  if (!size) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export default function ProjectImportModal({ open, onClose, onImported }: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const projects = useApp((s) => s.projects)
  const project = useApp((s) => s.project)
  const importProject = useApp((s) => s.importProject)

  const [mode, setMode] = useState<ImportMode>('new')
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [inspection, setInspection] = useState<ProjectImportInspection | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const current = useApp.getState()
    setMode('new')
    setName('')
    setProjectId(current.project?.project_id ?? current.projects[0]?.project_id ?? '')
    setFile(null)
    setInspection(null)
    setBusy(false)
    setDragging(false)
    setError('')
  }, [open])

  const inspect = async (next: PickedFile): Promise<void> => {
    setFile(next)
    setInspection(null)
    setError('')
    setBusy(true)
    try {
      const info = unwrap(await window.api.projects.inspectImport(next.path))
      setInspection(info)
      setName((value) => value.trim() || info.suggested_name)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pickFile = async (): Promise<void> => {
    try {
      const picked = unwrap(await window.api.projects.pickImportFile())
      if (picked) await inspect(picked)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const dropFile = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]
    if (!dropped) return
    const filePath = window.api.files.getPathForFile(dropped)
    if (!filePath) {
      setError('无法读取拖入文件的路径，请改用“选择文件”')
      return
    }
    await inspect({ path: filePath, name: dropped.name, size: dropped.size })
  }

  const submit = async (): Promise<void> => {
    if (!file || !inspection) {
      message.warning('请先选择要导入的 JSON 文件')
      return
    }
    if (inspection.api_count === 0) {
      message.warning('文件中没有可导入的接口')
      return
    }
    if (mode === 'new' && !name.trim()) {
      message.warning('请输入新项目名称')
      return
    }
    if (mode === 'existing' && !projectId) {
      message.warning('请选择目标项目')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await importProject({
        mode,
        file_path: file.path,
        name: mode === 'new' ? name.trim() : undefined,
        project_id: mode === 'existing' ? projectId : undefined
      })
      message.success(
        `已导入 ${result.api_count} 个接口${result.folder_count ? `、${result.folder_count} 个目录` : ''}`
      )
      onImported?.(result)
      onClose()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="导入项目"
      okText="导入"
      cancelText="取消"
      width={620}
      confirmLoading={busy}
      okButtonProps={{ disabled: busy || !inspection || inspection.api_count === 0 }}
      cancelButtonProps={{ disabled: busy }}
      maskClosable={!busy}
      onOk={() => void submit()}
      onCancel={() => {
        if (!busy) onClose()
      }}
      destroyOnClose
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div>
          <div className="muted" style={{ marginBottom: 6 }}>
            导入到
          </div>
          <Radio.Group value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}>
            <Radio value="new">新建项目</Radio>
            <Radio value="existing">已有项目</Radio>
          </Radio.Group>
        </div>

        {mode === 'new' ? (
          <Input
            placeholder="项目名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
          />
        ) : (
          <Select
            style={{ width: '100%' }}
            placeholder="选择目标项目"
            value={projectId || undefined}
            onChange={setProjectId}
            showSearch
            optionFilterProp="label"
            options={projects.map((item) => ({
              value: item.project_id,
              label: item.project_id === project?.project_id ? `${item.name}（当前）` : item.name
            }))}
          />
        )}

        <div>
          <div className="muted" style={{ marginBottom: 6 }}>
            导入文件
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => void pickFile()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void pickFile()
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => void dropFile(event)}
            style={{
              border: `1px dashed ${dragging ? 'var(--blue-2)' : '#d9c9a5'}`,
              borderRadius: 8,
              padding: '18px 14px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragging ? 'rgba(95, 128, 233, 0.08)' : '#fbf8f1'
            }}
          >
            {file ? (
              <div>
                <FileAddOutlined style={{ marginRight: 6 }} />
                <span>{file.name}</span>
                <span className="muted" style={{ marginLeft: 8 }}>
                  {formatSize(file.size)}
                </span>
              </div>
            ) : (
              <div>
                <UploadOutlined style={{ marginRight: 6 }} />
                点击选择 JSON 文件，或把文件拖到这里
              </div>
            )}
          </div>
        </div>

        {inspection ? (
          <div>
            <Tag color="blue">{inspection.format_label}</Tag>
            <span>
              {inspection.api_count} 个接口
              {inspection.folder_count ? ` · ${inspection.folder_count} 个目录` : ''}
            </span>
            {mode === 'existing' ? (
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                导入内容会追加到目标项目的根目录，不会清空已有接口。
              </div>
            ) : null}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            支持 OpenAPI 3 / Swagger 2 与 Postman Collection v2.1 的 JSON 文件；YAML 请先转换为
            JSON。
          </div>
        )}

        {inspection && inspection.warnings.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            message="导入提示"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {inspection.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            }
          />
        ) : null}

        {error ? <Alert type="error" showIcon message={error} /> : null}
      </Space>
    </Modal>
  )
}
