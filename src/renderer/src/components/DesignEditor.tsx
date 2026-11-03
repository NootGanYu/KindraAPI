import { useState } from 'react'
import { CodeOutlined, DeleteOutlined, ImportOutlined, PlusOutlined, SlidersOutlined } from '@ant-design/icons'
import { Button, Input, Select } from 'antd'
import { useApp } from '../store'
import type { DesignError, Target } from '@shared/types'
import { createDesignError } from '@shared/factories'
import RequestEditor from './RequestEditor'
import ResponsePanel from './ResponsePanel'
import ApiDocPreviewModal from './ApiDocPreviewModal'
import ErrorCodeImportModal from './ErrorCodeImportModal'
import CodeGenDialog from './CodeGenDialog'

interface Props {
  draft: Target
  projectId?: string
  onChange: (patch: Partial<Target>) => void
  onEditDescription?: () => void
}

export default function DesignEditor({
  draft,
  projectId,
  onChange,
  onEditDescription
}: Props): JSX.Element {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [errorImportOpen, setErrorImportOpen] = useState(false)
  const currentEnvId = useApp(state => state.currentEnvId)
  const errors = draft.design?.errors ?? []
  const folders = useApp(state => state.targets).filter(target => target.target_type === 'folder')

  const setErrors = (next: DesignError[]): void => {
    onChange({ design: { ...(draft.design ?? {}), errors: next } })
  }
  const patchError = (index: number, patch: Partial<DesignError>): void => {
    setErrors(errors.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <div className="design-editor">
      <RequestEditor draft={draft} onChange={onChange} mode="design"
        onPreview={() => setPreviewOpen(true)} onGenerateCode={() => setCodeOpen(true)} intro={
        <>
          <div className="section-title">基本信息</div>
          <div className="design-basic-row">
            <label htmlFor="design-folder">目录</label>
            <Select id="design-folder" aria-label="接口目录" value={draft.parent_id || '0'}
              options={[{ value: '0', label: '根目录' }, ...folders.map(folder => ({ value: folder.target_id, label: folder.name }))]}
              onChange={parent_id => onChange({ parent_id })} />
            <label htmlFor="design-tags">标签</label>
            <Select id="design-tags" aria-label="接口标签" mode="tags" value={draft.tags ?? []}
              placeholder="添加标签" onChange={tags => onChange({ tags })} />
          </div>
          <div className="design-basic-row">
            <span>详细说明</span>
            <span className="muted">{draft.description ? '已填写' : '未填写'}</span>
            <span style={{ flex: 1 }} />
            <Button size="small" type="text" onClick={onEditDescription}>编辑</Button>
          </div>
          <div className="section-title design-request-heading"><SlidersOutlined />设计请求参数</div>
        </>
      }>
      <div className="section-title design-request-heading" style={{ marginTop: 8 }}>
        <CodeOutlined />设计响应参数
      </div>
      <div className="design-response">
        <ResponsePanel
          targetId={draft.target_id}
          record={null}
          examples={draft.response?.example}
          projectId={projectId}
          mode="design"
          defaultTab="字段说明"
          onChangeExamples={(examples) =>
            onChange({ response: { ...(draft.response ?? {}), example: examples } })
          }
        />
      </div>

      <div className="design-error-head">
        <div className="section-title" style={{ margin: 0 }}>错误码</div>
        <Button size="small" icon={<ImportOutlined />} onClick={() => setErrorImportOpen(true)}>批量导入</Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {errors.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            还没有错误码，点击下方按钮添加。
          </div>
        ) : null}
        {errors.map((error, index) => (
          <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              style={{ width: 130 }}
              placeholder="Code"
              value={error.code}
              onChange={(event) => patchError(index, { code: event.target.value })}
            />
            <Input
              placeholder="含义"
              value={error.message}
              onChange={(event) => patchError(index, { message: event.target.value })}
            />
            <Input
              placeholder="备注"
              value={error.description ?? ''}
              onChange={(event) => patchError(index, { description: event.target.value })}
            />
            <Button
              size="small"
              type="text"
              danger
              aria-label="删除错误码"
              icon={<DeleteOutlined />}
              onClick={() => setErrors(errors.filter((_, i) => i !== index))}
            />
          </div>
        ))}
        <div>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setErrors([...errors, createDesignError()])}
          >
            添加错误码
          </Button>
        </div>
      </div>
      </RequestEditor>
      <ApiDocPreviewModal open={previewOpen} target={draft} onClose={() => setPreviewOpen(false)} />
      <CodeGenDialog open={codeOpen} projectId={projectId ?? ''} target={draft}
        environmentId={currentEnvId} onClose={() => setCodeOpen(false)} />
      <ErrorCodeImportModal open={errorImportOpen} existing={errors}
        onClose={() => setErrorImportOpen(false)} onApply={setErrors} />
    </div>
  )
}
