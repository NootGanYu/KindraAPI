import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Input } from 'antd'
import type { DesignError, Target } from '@shared/types'
import { createDesignError } from '@shared/factories'
import RequestEditor from './RequestEditor'
import ResponsePanel from './ResponsePanel'

interface Props {
  draft: Target
  projectId?: string
  onChange: (patch: Partial<Target>) => void
}

export default function DesignEditor({ draft, projectId, onChange }: Props): JSX.Element {
  const errors = draft.design?.errors ?? []

  const setErrors = (next: DesignError[]): void => {
    onChange({ design: { ...(draft.design ?? {}), errors: next } })
  }
  const patchError = (index: number, patch: Partial<DesignError>): void => {
    setErrors(errors.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '0 16px 32px' }}>
      <div className="section-title">请求契约</div>
      <RequestEditor draft={draft} onChange={onChange} />

      <div className="section-title" style={{ marginTop: 8 }}>
        响应契约
      </div>
      <div style={{ height: 380, border: '1px solid var(--line, #e8e2d7)', borderRadius: 8, overflow: 'hidden' }}>
        <ResponsePanel
          targetId={draft.target_id}
          record={null}
          examples={draft.response?.example}
          projectId={projectId}
          onChangeExamples={(examples) =>
            onChange({ response: { ...(draft.response ?? {}), example: examples } })
          }
        />
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>
        错误码
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
  )
}
