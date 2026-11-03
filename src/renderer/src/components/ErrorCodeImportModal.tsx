import { useEffect, useMemo, useState } from 'react'
import { Alert, Input, Modal, Radio, Tag } from 'antd'
import type { DesignError } from '@shared/types'
import { parseErrorCodes } from '@shared/errorCodes'

interface Props {
  open: boolean
  existing: DesignError[]
  onClose: () => void
  onApply: (items: DesignError[]) => void
}

type ImportMode = 'append' | 'replace'

export default function ErrorCodeImportModal({
  open,
  existing,
  onClose,
  onApply
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<ImportMode>('append')

  useEffect(() => {
    if (!open) return
    setText('')
    setMode('append')
  }, [open])

  const result = useMemo(() => (text.trim() ? parseErrorCodes(text) : null), [text])

  const finalItems = useMemo(() => {
    const items = result?.items ?? []
    if (mode === 'replace') return items
    const existingCodes = new Set(existing.map((item) => item.code))
    return items.filter((item) => !existingCodes.has(item.code))
  }, [result, mode, existing])

  const apply = (): void => {
    if (!result || result.items.length === 0 || finalItems.length === 0) return
    onApply(mode === 'replace' ? finalItems : [...existing, ...finalItems])
    onClose()
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={apply}
      okText={mode === 'replace' ? '覆盖导入' : '追加导入'}
      cancelText="取消"
      okButtonProps={{ disabled: finalItems.length === 0 }}
      width={720}
      title="批量导入错误码"
      destroyOnClose
      className="error-batch-modal"
    >
      <div className="error-batch">
        <div className="muted" style={{ marginBottom: 6 }}>
          每行一条，支持 `400 参数错误`、`401|未登录|请先登录`、`500: 服务器错误 # 备注`，也可粘贴 JSON。
        </div>
        <Input.TextArea
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoSize={{ minRows: 8, maxRows: 14 }}
          className="mono"
          spellCheck={false}
          placeholder={'400 参数错误\n401|未登录|请先登录'}
        />

        <div style={{ marginTop: 10 }}>
          <Radio.Group
            value={mode}
            onChange={(event) => setMode(event.target.value as ImportMode)}
            options={[
              { value: 'append', label: '追加（跳过已存在）' },
              { value: 'replace', label: '覆盖现有错误码' }
            ]}
          />
        </div>

        {result ? (
          <div className="error-batch-result">
            <div className="error-batch-summary">
              {result.items.length > 0 ? (
                <>
                  <Tag color="blue">识别 {result.items.length} 条</Tag>
                  <span>本次将写入 {finalItems.length} 条</span>
                </>
              ) : (
                <Tag color="error">未识别到错误码</Tag>
              )}
              {result.error ? <span className="muted">{result.error}</span> : null}
            </div>
            {result.warnings.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="解析提示"
                description={
                  <ul className="error-batch-warnings">
                    {result.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                }
              />
            ) : null}
            {result.items.length > 0 ? (
              <div className="error-batch-preview">
                <div className="error-batch-row head">
                  <span>Code</span>
                  <span>含义</span>
                  <span>备注</span>
                </div>
                {result.items.map((item) => (
                  <div className="error-batch-row" key={item.code}>
                    <span className="mono">{item.code}</span>
                    <span>{item.message}</span>
                    <span className="muted">{item.description ?? ''}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
