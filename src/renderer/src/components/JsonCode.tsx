import { highlightJsonHtml } from '@shared/jsonHighlight'

export function isJsonText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || !/^[[{]/.test(trimmed)) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

interface Props {
  text: string
  className?: string
}

export default function JsonCode({ text, className = '' }: Props): JSX.Element {
  return (
    <pre
      className={`json-code-block${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: highlightJsonHtml(text) }}
    />
  )
}
