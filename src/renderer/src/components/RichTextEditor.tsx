import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { Dropdown, Tooltip } from 'antd'
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  EditOutlined,
  EyeOutlined,
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
import { countRichText, descriptionToHtml, sanitizeRichHtml } from '@shared/richText'
import { useTargetEditLock } from './TargetEditScope'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  maxHeight?: number
  onFullscreen?: () => void
  fullscreen?: boolean
  /** 内联编辑时，聚焦或存在未提交内容会持有目标编辑锁 */
  lockWhileEditing?: boolean
  /** 提交防抖毫秒数；0 表示每次输入立即提交 */
  commitDelay?: number
  className?: string
}

type ViewMode = 'edit' | 'preview'

const TABLE_HTML =
  '<table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>'

const EMIT_DELAY = 800

export default function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入详细说明…',
  minHeight = 180,
  maxHeight = 420,
  onFullscreen,
  fullscreen = false,
  lockWhileEditing = true,
  commitDelay = EMIT_DELAY,
  className = ''
}: Props): JSX.Element {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef(false)
  const focusedRef = useRef(false)
  const lastEmittedRef = useRef('')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const [mode, setMode] = useState<ViewMode>('edit')
  const [focused, setFocused] = useState(false)
  const [pending, setPending] = useState(false)
  const [html, setHtml] = useState('')
  const [count, setCount] = useState({ chars: 0, lines: 0 })

  useTargetEditLock(lockWhileEditing && (focused || pending))

  const previewHtml = useMemo(() => sanitizeRichHtml(html), [html])

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const emit = (): void => {
    clearTimer()
    const current = editorRef.current
    if (!current) {
      pendingRef.current = false
      setPending(false)
      return
    }
    const sanitized = sanitizeRichHtml(current.innerHTML)
    pendingRef.current = false
    setPending(false)
    if (sanitized === lastEmittedRef.current) return
    lastEmittedRef.current = sanitized
    onChangeRef.current(sanitized)
  }

  const scheduleEmit = (): void => {
    pendingRef.current = true
    setPending(true)
    clearTimer()
    if (commitDelay <= 0) {
      emit()
      return
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      emit()
    }, commitDelay)
  }

  const syncDom = (nextHtml: string): void => {
    const editor = editorRef.current
    if (!editor) return
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml
    setHtml(nextHtml)
    setCount(countRichText(nextHtml))
  }

  // 外部值变化时同步；用户正在编辑或刚提交相同内容时不覆盖光标。
  useEffect(() => {
    const nextHtml = descriptionToHtml(value ?? '')
    const sanitized = sanitizeRichHtml(nextHtml)
    if (sanitized === lastEmittedRef.current) {
      if (!focusedRef.current) {
        setHtml(nextHtml)
        setCount(countRichText(nextHtml))
      }
      return
    }
    if (focusedRef.current) return
    lastEmittedRef.current = sanitized
    syncDom(nextHtml)
  }, [value])

  // 卸载前把未提交内容交回父组件，避免切换 Tab 丢字。
  useEffect(() => {
    return () => {
      clearTimer()
      if (!pendingRef.current) return
      const current = editorRef.current
      if (!current) return
      const sanitized = sanitizeRichHtml(current.innerHTML)
      if (sanitized !== lastEmittedRef.current) onChangeRef.current(sanitized)
    }
  }, [])

  const syncFromEditor = (): void => {
    const current = editorRef.current
    if (!current) return
    const next = current.innerHTML
    setHtml(next)
    setCount(countRichText(next))
    scheduleEmit()
  }

  const exec = (command: string, argument?: string): void => {
    if (mode !== 'edit') return
    document.execCommand(command, false, argument)
    syncFromEditor()
  }

  const insertHtml = (fragment: string): void => {
    if (mode !== 'edit') return
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

  const backToTop = (): void => {
    if (editorRef.current) editorRef.current.scrollTop = 0
  }

  const switchMode = (next: ViewMode): void => {
    if (next === mode) return
    if (mode === 'edit') emit()
    setMode(next)
  }

  const handleFullscreen = (): void => {
    if (mode === 'edit') emit()
    onFullscreen?.()
  }

  const tool = (
    title: string,
    icon: JSX.Element,
    onClick: () => void,
    disabled = false,
    active = false
  ): JSX.Element => (
    <Tooltip title={title} key={title}>
      <button
        type="button"
        className={`api-desc-tool${active ? ' active' : ''}`}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  )

  return (
    <div className={`api-desc-shell${className ? ` ${className}` : ''}`}>
      <div className="api-desc-toolbar">
        {tool('标题', <FontSizeOutlined />, () => exec('formatBlock', '<h3>'), mode !== 'edit')}
        {tool('加粗', <BoldOutlined />, () => exec('bold'), mode !== 'edit')}
        {tool('斜体', <ItalicOutlined />, () => exec('italic'), mode !== 'edit')}
        {tool('下划线', <UnderlineOutlined />, () => exec('underline'), mode !== 'edit')}
        {tool('删除线', <StrikethroughOutlined />, () => exec('strikeThrough'), mode !== 'edit')}
        {tool(
          '引用',
          <span className="api-desc-quote">“</span>,
          () => exec('formatBlock', '<blockquote>'),
          mode !== 'edit'
        )}
        {tool('链接', <LinkOutlined />, insertLink, mode !== 'edit')}
        {tool('图片', <PictureOutlined />, insertImage, mode !== 'edit')}
        {tool('行内代码', <CodeOutlined />, () => insertHtml('<code>code</code>'), mode !== 'edit')}
        {tool(
          '代码块',
          <span className="api-desc-code">{'{ }'}</span>,
          () => insertHtml('<pre><code>code</code></pre><p><br></p>'),
          mode !== 'edit'
        )}
        {tool('无序列表', <UnorderedListOutlined />, () => exec('insertUnorderedList'), mode !== 'edit')}
        {tool('有序列表', <OrderedListOutlined />, () => exec('insertOrderedList'), mode !== 'edit')}
        {tool('复选框', <CheckSquareOutlined />, () => insertHtml('<div>☐ 待办项</div>'), mode !== 'edit')}
        {tool('表格', <TableOutlined />, insertTable, mode !== 'edit')}
        <Dropdown
          trigger={['click']}
          disabled={mode !== 'edit'}
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
            disabled={mode !== 'edit'}
            onMouseDown={(event) => event.preventDefault()}
          >
            <PlusOutlined /> 插入
          </button>
        </Dropdown>
        <span className="api-desc-tool-sep" />
        {tool('左对齐', <AlignLeftOutlined />, () => exec('justifyLeft'), mode !== 'edit')}
        {tool('居中', <AlignCenterOutlined />, () => exec('justifyCenter'), mode !== 'edit')}
        {tool('右对齐', <AlignRightOutlined />, () => exec('justifyRight'), mode !== 'edit')}
        <span style={{ flex: 1 }} />
        {tool(
          '编辑',
          <EditOutlined />,
          () => switchMode('edit'),
          false,
          mode === 'edit'
        )}
        {tool(
          '预览',
          <EyeOutlined />,
          () => switchMode('preview'),
          false,
          mode === 'preview'
        )}
        {onFullscreen ? tool(
          fullscreen ? '退出全屏' : '全屏',
          <FullscreenOutlined />,
          handleFullscreen
        ) : null}
      </div>

      <div className="api-desc-body" style={{ minHeight }}>
        <div
          ref={editorRef}
          className="api-desc-editor"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={syncFromEditor}
          onFocus={() => {
            focusedRef.current = true
            setFocused(true)
          }}
          onBlur={() => {
            focusedRef.current = false
            setFocused(false)
            emit()
          }}
          onPaste={handlePaste}
          style={{ display: mode === 'edit' ? 'block' : 'none', maxHeight }}
        />
        <div
          className="api-desc-editor api-desc-preview"
          style={{ display: mode === 'preview' ? 'block' : 'none', maxHeight }}
          dangerouslySetInnerHTML={{
            __html: previewHtml || `<p class="muted">${placeholder}</p>`
          }}
        />
      </div>

      <div className="api-desc-footer">
        <span>
          字数: {count.chars} 行数: {count.lines}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="api-desc-link" onClick={backToTop}>
          回到顶部
        </button>
      </div>
    </div>
  )
}
