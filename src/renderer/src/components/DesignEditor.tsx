import { useState } from 'react'
import { Button, Input } from 'antd'
import { DeleteOutlined, ImportOutlined, PlusOutlined } from '@ant-design/icons'
import type { DesignError, Target } from '@shared/types'
import { createDesignError } from '@shared/factories'
import { useApp } from '../store'
import RequestEditor from './RequestEditor'
import ResponsePanel from './ResponsePanel'
import DesignMetaBar from './DesignMetaBar'
import ApiDocPreviewModal from './ApiDocPreviewModal'
import ErrorCodeImportModal from './ErrorCodeImportModal'
import CodeGenDialog from './CodeGenDialog'

interface Props {
  draft: Target
  projectId?: string
  onChange: (patch: Partial<Target>) => void
  onOpenDescription: () => void
}

export default function DesignEditor({
  draft,
  projectId,
  onChange,
  onOpenDescription
}: Props): JSX.Element {
  const currentEnvId = useApp((state) => state.currentEnvId)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [errorImportOpen, setErrorImportOpen] = useState(false)
  const errors = draft.design?.errors ?? []

  const setErrors = (next: DesignError[]): void => {
    onChange({ design: { ...(draft.design ?? {}), errors: next } })
  }
  const patchError = (index: number, patch: Partial<DesignError>): void => {
    setErrors(errors.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <div className="design-page">
      <div className="design-scroll">
        <RequestEditor
          mode="design"
          draft={draft}
          onChange={onChange}
          headerSlot={
            <DesignMetaBar
              draft={draft}
              onChange={onChange}
              onOpenDescription={onOpenDescription}
            />
          }
          onPreview={() => setPreviewOpen(true)}
          onGenerateCode={() => setCodeOpen(true)}
        />

        <div className="section-title" style={{ marginTop: 8 }}>
          响应契约
        </div>
        <div className="design-response-box">
          <ResponsePanel
            targetId={draft.target_id}
            record={null}
            examples={draft.response?.example}
            projectId={projectId}
            mode="design"
            onChangeExamples={(examples) =>
              onChange({ response: { ...(draft.response ?? {}), example: examples } })
            }
          />
        </div>

        <div className="design-error-head">
          <span className="section-title" style={{ margin: 0 }}>
            错误码
          </span>
          <Button
            size="small"
            icon={<ImportOutlined />}
            onClick={() => setErrorImportOpen(true)}
          >
            批量导入
          </Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {errors.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              还没有错误码，可逐条添加或批量导入。
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
      </div>

      <ApiDocPreviewModal
        open={previewOpen}
        target={draft}
        onClose={() => setPreviewOpen(false)}
      />
      <CodeGenDialog
        open={codeOpen}
        projectId={projectId ?? ''}
        target={draft}
        environmentId={currentEnvId}
        onClose={() => setCodeOpen(false)}
      />
      <ErrorCodeImportModal
        open={errorImportOpen}
        existing={errors}
        onClose={() => setErrorImportOpen(false)}
        onApply={setErrors}
      />
    </div>
  )
}
