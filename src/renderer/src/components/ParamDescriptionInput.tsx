import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { App, Button, Dropdown, Input, Tooltip } from 'antd'
import type { InputRef } from 'antd'
import { ArrowLeftOutlined, CloseOutlined, LinkOutlined, MenuOutlined } from '@ant-design/icons'
import type { DictionaryEntryView } from '@shared/types'
import { loadSuggestions } from './schemas/dictionarySuggestions'
import DictionaryManager from './schemas/DictionaryManager'
import { useTargetEditLock } from './TargetEditScope'

interface Props {
  projectId: string
  parameterName: string
  value: string
  onChange: (value: string) => void
  children?: ReactNode
}

/** 描述始终为普通输入；字典由助手按钮显式打开，只改描述。 */
export default function ParamDescriptionInput({ projectId, parameterName, value, onChange, children }: Props): JSX.Element {
  const { message } = App.useApp()
  const input = useRef<InputRef>(null)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<DictionaryEntryView[]>([])
  const [selected, setSelected] = useState<DictionaryEntryView | null>(null)
  const [hint, setHint] = useState<{ x: number; y: number } | null>(null)
  const hintPoint = useRef({ x: 0, y: 0 })
  const hintTimer = useRef<number | null>(null)
  useTargetEditLock(open || menuOpen)

  const clearHint = (): void => {
    if (hintTimer.current !== null) {
      window.clearTimeout(hintTimer.current)
      hintTimer.current = null
    }
    setHint(null)
  }

  useEffect(() => () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
  }, [])

  useEffect(() => {
    clearHint()
  }, [value, open, menuOpen])

  const showHint = (event: MouseEvent<HTMLDivElement>): void => {
    hintPoint.current = { x: event.clientX, y: event.clientY }
    if (hintTimer.current !== null || !value.trim() || open || menuOpen) return
    // 单元格在悬停后会让出操作按钮的宽度；延后测量才能判断文本是否真的被截断。
    hintTimer.current = window.setTimeout(() => {
      hintTimer.current = null
      const field = input.current?.input
      if (!field || !value.trim() || open || menuOpen) return
      if (field.scrollWidth <= field.clientWidth + 1) return
      setHint({ ...hintPoint.current })
    }, 260)
  }

  const moveHint = (event: MouseEvent<HTMLDivElement>): void => {
    hintPoint.current = { x: event.clientX, y: event.clientY }
    if (hint) setHint({ x: event.clientX, y: event.clientY })
  }

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    input.current?.focus()
    input.current?.input?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [value, open])

  useEffect(() => {
    if (!open) return
    let active = true
    setSelected(null)
    void loadSuggestions(projectId).then(list => { if (active) setEntries(list.filter(entry => entry.description.trim())) }).catch(error => { if (active) message.error((error as Error).message) })
    const dismiss = (event: PointerEvent): void => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); input.current?.focus() } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape, true)
    return () => { active = false; document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape, true) }
  }, [open, projectId, message])

  const apply = (replace: boolean): void => {
    if (!selected) return
    const next = replace ? selected.description : value + selected.description
    pendingCaret.current = next.length
    onChange(next)
    setOpen(false)
  }
  const hintWidth = Math.min(360, Math.max(160, window.innerWidth - 24))
  const hintStyle: CSSProperties | undefined = hint
    ? {
        left: Math.max(8, Math.min(hint.x + 12, window.innerWidth - hintWidth - 12)),
        top: hint.y + 18,
        maxWidth: hintWidth
      }
    : undefined

  return <div className="design-param-description" onMouseEnter={showHint} onMouseMove={moveHint}
    onMouseLeave={clearHint} onMouseDown={clearHint}>
    <Input ref={input} variant="borderless" aria-label={`参数描述 ${parameterName || '新参数'}`} value={value} placeholder="描述" onChange={event => onChange(event.target.value)} />
    <div className="design-param-actions">
      <Dropdown open={menuOpen} onOpenChange={setMenuOpen} trigger={['click']} overlayClassName="param-description-menu"
        menu={{ items: [{ key: 'dictionary', label: <span><strong>字典库</strong><small>从字典库中选取描述</small></span> }], onClick: () => { setMenuOpen(false); setOpen(true) } }}>
        <Tooltip title={open || menuOpen ? null : '描述助手'}><button ref={trigger} aria-label={`描述助手 ${parameterName || '新参数'}`} onMouseDown={event => event.preventDefault()}><LinkOutlined /></button></Tooltip>
      </Dropdown>
      {children}
    </div>
    {open && createPortal(<div ref={panel} className="param-description-library" role="dialog" aria-label="描述字典库" aria-modal="false">
      <header><button aria-label="返回描述助手" onClick={() => { setOpen(false); setMenuOpen(true) }}><ArrowLeftOutlined /></button><span>字典库</span><button aria-label="关闭描述字典库" onClick={() => setOpen(false)}><CloseOutlined /></button></header>
      <div className="param-description-entries" role="listbox" aria-label="字典描述">{entries.length ? entries.map(entry => <button role="option" aria-selected={selected?.id === entry.id && selected?.source === entry.source} key={`${entry.source}:${entry.id}`} onClick={() => setSelected(entry)}>{entry.description}</button>) : <div className="muted">暂无可用描述</div>}</div>
      <footer><button onClick={() => { setOpen(false); setManagerOpen(true) }}><MenuOutlined /> 字典库管理</button><Button size="small" disabled={!selected} onClick={() => apply(true)}>替换</Button><Button size="small" disabled={!selected} onClick={() => apply(false)}>插入</Button></footer>
    </div>, document.body)}
    <DictionaryManager projectId={projectId} open={managerOpen} onClose={() => setManagerOpen(false)} />
    {hint && hintStyle ? createPortal(
      <div className="param-description-tooltip" style={hintStyle} role="tooltip">{value}</div>,
      document.body
    ) : null}
  </div>
}
