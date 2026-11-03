import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Input } from 'antd'
import type { TextAreaProps, TextAreaRef } from 'antd/es/input/TextArea'

type Props = Omit<TextAreaProps, 'value' | 'autoSize'> & { value: string; highlight: boolean }

function colorJson(text: string): ReactNode[] {
  // Tokenize the draft itself, including unfinished strings; parsing would hide colors while typing.
  const tokens = /"(?:\\[\s\S]|[^"\\])*"?|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b/g
  const result: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(tokens)) {
    const start = match.index!
    const token = match[0]
    result.push(text.slice(cursor, start))
    cursor = start + token.length
    let kind: string
    if (token.startsWith('"')) {
      let next = cursor
      while (next < text.length && /\s/.test(text[next])) next++
      kind = text[next] === ':' ? 'key' : 'string'
    } else {
      kind = /^-?\d/.test(token) ? 'number' : 'literal'
    }
    result.push(<span key={start} className={`json-code-${kind}`}>{token}</span>)
  }
  result.push(text.slice(cursor))
  return result
}

export default function JsonBodyInput({ value, highlight, className = '', onScroll, ...props }: Props): JSX.Element {
  const input = useRef<TextAreaRef>(null)
  const backdrop = useRef<HTMLPreElement>(null)
  const content = useMemo(() => highlight ? colorJson(value) : null, [value, highlight])

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
