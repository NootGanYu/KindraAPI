import { useLayoutEffect, useMemo, useRef } from 'react'
import { Input } from 'antd'
import type { TextAreaProps, TextAreaRef } from 'antd/es/input/TextArea'
import { highlightJson } from './JsonCode'

type Props = Omit<TextAreaProps, 'value' | 'autoSize'> & { value: string; highlight: boolean }

export default function JsonBodyInput({ value, highlight, className = '', onScroll, ...props }: Props): JSX.Element {
  const input = useRef<TextAreaRef>(null)
  const backdrop = useRef<HTMLPreElement>(null)
  const content = useMemo(() => highlight ? highlightJson(value) : null, [value, highlight])

  const sync = (): void => {
    const textarea = input.current?.resizableTextArea?.textArea
    const layer = backdrop.current
    if (!textarea || !layer) return
    // Match the editable viewport, including the space taken by its scrollbar.
    layer.style.width = `${textarea.clientWidth}px`
    layer.style.height = `${textarea.clientHeight}px`
    layer.scrollTop = textarea.scrollTop
    layer.scrollLeft = textarea.scrollLeft
  }

  useLayoutEffect(() => {
    sync()
  }, [value, highlight])

  useLayoutEffect(() => {
    const textarea = input.current?.resizableTextArea?.textArea
    if (!textarea) return
    const observer = new ResizeObserver(sync)
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={`json-body-input${highlight ? ' is-highlighted' : ''}${props.readOnly ? ' is-readonly' : ''}`}>
      {highlight && <pre ref={backdrop} className="json-code-layer" aria-hidden="true">{content}<span>{'\u200b'}</span></pre>}
      <Input.TextArea
        {...props}
        ref={input}
        value={value}
        className={`editor-input ${className}`}
        onScroll={event => { sync(); onScroll?.(event) }}
      />
    </div>
  )
}
