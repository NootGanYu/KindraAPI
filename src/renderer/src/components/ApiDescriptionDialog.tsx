import { useEffect, useRef, useState } from 'react'
import { Modal } from 'antd'
import { descriptionToHtml, sanitizeRichHtml } from '@shared/richText'
import RichTextEditor from './RichTextEditor'
import { useTargetEditLock } from './TargetEditScope'

interface Props {
  open: boolean
  value: string
  onClose: () => void
  onCommit: (html: string) => void
}

export default function ApiDescriptionDialog({
  open,
  value,
  onClose,
  onCommit
}: Props): JSX.Element {
  const [html, setHtml] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const htmlRef = useRef('')
  const initialRef = useRef('')
  useTargetEditLock(open)

  useEffect(() => {
    if (!open) return
    const initial = descriptionToHtml(value ?? '')
    initialRef.current = initial
    htmlRef.current = initial
    setHtml(initial)
    setFullscreen(false)
  }, [open, value])

  const handleClose = (): void => {
    const next = sanitizeRichHtml(htmlRef.current)
    if (next !== sanitizeRichHtml(initialRef.current)) onCommit(next)
    onClose()
  }

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      width={fullscreen ? '96vw' : 920}
      style={fullscreen ? { top: 8, maxWidth: '96vw' } : undefined}
      title="接口说明"
      destroyOnClose
      className="api-desc-modal"
    >
      <RichTextEditor
        value={html}
        onChange={(next) => {
          htmlRef.current = next
          setHtml(next)
        }}
        onFullscreen={() => setFullscreen((current) => !current)}
        fullscreen={fullscreen}
        lockWhileEditing={false}
        commitDelay={0}
        minHeight={430}
        maxHeight={fullscreen ? 720 : 430}
        className={fullscreen ? 'fullscreen' : ''}
      />
    </Modal>
  )
}
