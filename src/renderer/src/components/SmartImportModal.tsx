import { useEffect, useMemo, useState } from 'react'
import { Alert, Input, Modal, Radio, Space, Tag } from 'antd'
import type { FieldDoc } from '@shared/types'
import { smartImportBody, type BodyImportFormat } from '@shared/bodyImport'

interface Props {
  open: boolean
  existingDocs: FieldDoc[]
  onClose: () => void
  onApply: (result: { raw: string; fieldDocs: FieldDoc[] }) => void
}

type FormatChoice = 'auto' | BodyImportFormat

const FORMAT_LABELS: Record<BodyImportFormat, string> = {
  json: 'JSON 样例',
  schema: 'JSON Schema',
  lines: '键值行'
}

const PREVIEW_LIMIT = 8000

export default function SmartImportModal({
  open,
  existingDocs,
  onClose,
  onApply
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const [format, setFormat] = useState<FormatChoice>('auto')

  useEffect(() => {
    if (!open) return
    setText('')
    setFormat('auto')
  }, [open])

  const result = useMemo(() => {
    if (!text.trim()) return null
    return smartImportBody(text, { format, existingDocs })
  }, [text, format, existingDocs])

  const preview = useMemo(() => {
    const raw = result?.raw ?? ''
    if (raw.length <= PREVIEW_LIMIT) return raw
    return `${raw.slice(0, PREVIEW_LIMIT)}\n…（已截断，共 ${raw.length} 字符）`
  }, [result?.raw])

  const apply = (): void => {
    if (!result?.ok) return
    onApply({ raw: result.raw, fieldDocs: result.fieldDocs })
    onClose()
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={apply}
      okText="应用"
      cancelText="取消"
      okButtonProps={{ disabled: !result?.ok }}
      width={780}
      title="智能导入"
      destroyOnClose
      className="smart-import-modal"
    >
      <div className="smart-import">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              导入格式
            </div>
            <Radio.Group
              value={format}
              onChange={(event) => setFormat(event.target.value as FormatChoice)}
              options={[
                { value: 'auto', label: '自动识别' },
                { value: 'json', label: FORMAT_LABELS.json },
                { value: 'schema', label: FORMAT_LABELS.schema },
                { value: 'lines', label: FORMAT_LABELS.lines }
              ]}
            />
          </div>

          <Input.TextArea
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoSize={{ minRows: 10, maxRows: 16 }}
            className="mono"
            spellCheck={false}
            placeholder={'粘贴 JSON 样例、JSON Schema，或每行一条 key: value'}
          />

          {result ? (
            <>
              <div className="smart-import-summary">
                {result.ok ? (
                  <>
                    <Tag color="blue">{FORMAT_LABELS[result.format ?? 'json']}</Tag>
                    <span>识别 {result.fieldCount} 个字段</span>
                  </>
                ) : (
                  <Tag color="error">无法解析</Tag>
                )}
                {result.error ? <span className="muted">{result.error}</span> : null}
              </div>
              {result.warnings.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="导入提示"
                  description={
                    <ul className="smart-import-warnings">
                      {result.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  }
                />
              ) : null}
              {result.ok ? (
                <div className="smart-import-preview">
                  <div className="smart-import-preview-head">生成的请求体</div>
                  <pre>{preview}</pre>
                </div>
              ) : null}
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              支持：JSON 样例、JSON Schema（含本地 $ref）、key: value 键值行。
            </div>
          )}
        </Space>
      </div>
    </Modal>
  )
}
