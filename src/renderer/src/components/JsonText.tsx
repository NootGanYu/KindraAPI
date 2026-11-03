import JsonCode, { isJsonText } from './JsonCode'

interface Props {
  text: string
  className?: string
  emptyText?: string
}

/** JSON 文本统一着色；非 JSON 保持纯文本。 */
export default function JsonText({ text, className, emptyText }: Props): JSX.Element {
  if (!text) return <pre className={className}>{emptyText ?? ''}</pre>
  return isJsonText(text) ? (
    <JsonCode text={text} className={className} />
  ) : (
    <pre className={className}>{text}</pre>
  )
}
