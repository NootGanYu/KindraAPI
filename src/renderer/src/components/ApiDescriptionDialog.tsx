import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { Checkbox, Dropdown, Modal, Tooltip } from 'antd'
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  FontSizeOutlined,
  FullscreenOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PictureOutlined,
  PlusOutlined,
  StrikethroughOutlined,
  TableOutlined,
  UnderlineOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { countRichText, sanitizeRichHtml } from '@shared/richText'

interface Props {
  open: boolean
  value: string
  onClose: () => void
  onCommit: (html: string) => void
}

const TABLE_HTML =
  '<table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>'

export default function ApiDescriptionDialog({
  open,
  value,
  onClose,
  onCommit
}: Props): JSX.Element {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [html, setHtml] = useState('')
  const [initialHtml, setInitialHtml] = useState('')
  const [syncScroll, setSyncScroll] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!open) return
    const initial = sanitizeRichHtml(value ?? '')
    setHtml(initial)
    setInitialHtml(initial)
    setFullscreen(false)
  }, [open, value])

  const previewHtml = useMemo(() => sanitizeRichHtml(html), [html])
  const count = useMemo(() => countRichText(html), [html])

  const syncFromEditor = (): void => {
    setHtml(editorRef.current?.innerHTML ?? '')
  }

  const exec = (command: string, argument?: string): void => {
    document.execCommand(command, false, argument)
    syncFromEditor()
  }

  const insertHtml = (fragment: string): void => {
    document.execCommand('insertHTML', false, fragment)
    syncFromEditor()
  }

  const insertLink = (): void => {
    const url = window.prompt('输入链接地址', 'https://')
    if (!url) return
    exec('createLink', url)
  }

  const insertImage = (): void => {
    const url = window.prompt('输入图片地址（http/https 或 data:image）', 'https://')
    if (!url) return
    exec('insertImage', url)
  }

  const insertTable = (): void => insertHtml(TABLE_HTML)

  const insertDate = (): void => {
    const text = new Date().toLocaleDateString('zh-CN')
    insertHtml(`<span>${text}</span>`)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    syncFromEditor()
  }

  const handleEditorScroll = (): void => {
    if (!syncScroll) return
    const editor = editorRef.current
    const preview = previewRef.current
    if (!editor || !preview) return
    const range = editor.scrollHeight - editor.clientHeight
    const ratio = range > 0 ? editor.scrollTop / range : 0
    preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight)
  }

  const backToTop = (): void => {
    if (editorRef.current) editorRef.current.scrollTop = 0
    if (previewRef.current) previewRef.current.scrollTop = 0
  }

  const handleClose = (): void => {
    onCommit(sanitizeRichHtml(html))
    onClose()
  }

  const tool = (
    title: string,
    icon: JSX.Element,
    onClick: () => void,
    disabled = false
  ): JSX.Element => (
    <Tooltip title={title} key={title}>
      <button
        type="button"
        className="api-desc-tool"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  )

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
      <div className={`api-desc-shell${fullscreen ? ' fullscreen' : ''}`}>
        <div className="api-desc-toolbar">
          {tool('标题', <FontSizeOutlined />, () => exec('formatBlock', '<h3>'))}
          {tool('加粗', <BoldOutlined />, () => exec('bold'))}
          {tool('斜体', <ItalicOutlined />, () => exec('italic'))}
          {tool('下划线', <UnderlineOutlined />, () => exec('underline'))}
          {tool('删除线', <StrikethroughOutlined />, () => exec('strikeThrough'))}
          {tool('引用', <span className="api-desc-quote">“</span>, () =>
            exec('formatBlock', '<blockquote>')
          )}
          {tool('链接', <LinkOutlined />, insertLink)}
          {tool('图片', <PictureOutlined />, insertImage)}
          {tool('行内代码', <CodeOutlined />, () =>
            insertHtml('<code>code</code>')
          )}
          {tool('代码块', <span className="api-desc-code">{'{ }'}</span>, () =>
            insertHtml('<pre><code>code</code></pre><p><br></p>')
          )}
          {tool('无序列表', <UnorderedListOutlined />, () => exec('insertUnorderedList'))}
          {tool('有序列表', <OrderedListOutlined />, () => exec('insertOrderedList'))}
          {tool('复选框', <CheckSquareOutlined />, () => insertHtml('<div>☐ 待办项</div>'))}
          {tool('表格', <TableOutlined />, insertTable)}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'date', label: '日期' },
                { key: 'divider', label: '分割线' },
                { key: 'table', label: '表格' },
                { key: 'image', label: '图片' }
              ],
              onClick: ({ key }) => {
                if (key === 'date') insertDate()
                if (key === 'divider') exec('insertHorizontalRule')
                if (key === 'table') insertTable()
                if (key === 'image') insertImage()
              }
            }}
          >
            <button
              type="button"
              className="api-desc-tool wide"
              onMouseDown={(event) => event.preventDefault()}
            >
              <PlusOutlined /> 插入
            </button>
          </Dropdown>
          <span className="api-desc-tool-sep" />
          {tool('左对齐', <AlignLeftOutlined />, () => exec('justifyLeft'))}
          {tool('居中', <AlignCenterOutlined />, () => exec('justifyCenter'))}
          {tool('右对齐', <AlignRightOutlined />, () => exec('justifyRight'))}
          <span style={{ flex: 1 }} />
          {tool('全屏', <FullscreenOutlined />, () => setFullscreen((value) => !value))}
        </div>

        <div className="api-desc-body">
          <div
            ref={editorRef}
            className="api-desc-editor"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="请输入接口说明…"
            dangerouslySetInnerHTML={{ __html: initialHtml }}
            onInput={syncFromEditor}
            onBlur={syncFromEditor}
            onPaste={handlePaste}
            onScroll={handleEditorScroll}
          />
          <div
            ref={previewRef}
            className="api-desc-preview"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>

        <div className="api-desc-footer">
          <span>
            字数: {count.chars} 行数: {count.lines}
          </span>
          <span style={{ flex: 1 }} />
          <Checkbox checked={syncScroll} onChange={(event) => setSyncScroll(event.target.checked)}>
            同步滚动
          </Checkbox>
          <button type="button" className="api-desc-link" onClick={backToTop}>
            回到顶部
          </button>
        </div>
      </div>
    </Modal>
  )
}
