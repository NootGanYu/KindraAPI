import { useMemo } from 'react'
import { Modal } from 'antd'
import type { RawBodyLanguage } from '@shared/types'
import { tryPrettyJson } from '@shared/pretty'

interface Props {
  open: boolean
  raw: string
  language?: RawBodyLanguage
  onClose: () => void
}

export default function BodyPreviewModal({
  open,
  raw,
  language = 'json',
  onClose
}: Props): JSX.Element {
  const preview = useMemo(() => {
    const text = raw ?? ''
    if (!text.trim()) return { text: '', error: '' }
    if (language !== 'json') return { text, error: '' }
    const pretty = tryPrettyJson(text)
    return { text: pretty.text, error: pretty.error ?? '' }
  }, [raw, language])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      title="Body 预览"
      destroyOnClose
      className="body-preview-modal"
    >
      <div className="body-preview">
        {preview.error ? (
          <div className="field-banner error">JSON 结构错误：{preview.error}</div>
        ) : null}
        {preview.text ? (
          <pre className="body-preview-code">{preview.text}</pre>
        ) : (
          <div className="body-preview-empty">当前请求体为空</div>
        )}
      </div>
    </Modal>
  )
}
