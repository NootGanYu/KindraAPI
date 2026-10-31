/**
 * 接口说明的富文本处理。
 *
 * 渲染与落盘都会经过白名单清洗；渲染进程有 DOMParser 时使用 DOM 遍历，
 * 主进程（Node）没有 DOM，使用保守的标签/属性过滤回退。
 */

const ALLOWED_TAGS = new Set([
  'p',
  'div',
  'span',
  'br',
  'hr',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'blockquote',
  'a',
  'img',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'h1',
  'h2',
  'h3',
  'h4'
])

const BLOCKED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'svg',
  'math',
  'template',
  'form',
  'input',
  'button'
])

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title'])
const MAX_IMAGE_DATA_URL = 200_000

function isSafeUrl(value: string, allowDataImage = false): boolean {
  const url = value.trim()
  if (!url) return false
  if (/^(https?:|mailto:|\/|#|\.{0,2}\/)/i.test(url)) return true
  if (allowDataImage && /^data:image\//i.test(url)) {
    return url.length <= MAX_IMAGE_DATA_URL
  }
  return false
}

function sanitizeAttributes(element: any, tag: string): void {
  const attrs = Array.from(element.attributes ?? []) as Array<{
    name: string
    value: string
  }>
  for (const attr of attrs) {
    const name = attr.name.toLowerCase()
    if (!ALLOWED_ATTRS.has(name)) {
      element.removeAttribute(attr.name)
      continue
    }
    if (name === 'src') {
      if (!isSafeUrl(attr.value, tag === 'img')) element.removeAttribute(attr.name)
    } else if (name === 'href') {
      if (!isSafeUrl(attr.value)) element.removeAttribute(attr.name)
    }
  }
}

function sanitizeNode(node: any): void {
  const children = Array.from(node.childNodes ?? []) as any[]
  for (const child of children) {
    if (child.nodeType === 3) continue
    if (child.nodeType === 8) {
      child.remove()
      continue
    }
    if (child.nodeType !== 1) continue
    const tag = String(child.tagName ?? '').toLowerCase()
    if (BLOCKED_TAGS.has(tag)) {
      child.remove()
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // 未知标签：保留内容，去掉标签本身。
      const parent = child.parentNode
      if (!parent) continue
      while (child.firstChild) parent.insertBefore(child.firstChild, child)
      child.remove()
      continue
    }
    sanitizeAttributes(child, tag)
    sanitizeNode(child)
  }
}

function sanitizeWithDom(html: string): string {
  const Parser = (globalThis as any).DOMParser
  const parser = new Parser()
  const doc = parser.parseFromString(`<div id="kindraapi-rich-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('kindraapi-rich-root')
  if (!root) return ''
  sanitizeNode(root)
  return String(root.innerHTML ?? '')
}

function sanitizeFallback(html: string): string {
  let output = String(html ?? '')
  // 先移除带内容的危险标签。
  for (const tag of BLOCKED_TAGS) {
    output = output.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '')
    output = output.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '')
  }
  output = output.replace(/<!--[\s\S]*?-->/g, '')
  // 逐个标签过滤：白名单外的标签去掉，保留内容。
  output = output.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*)?)\/?>/g,
    (match, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) return ''
      const attrs: string[] = []
      const attrPattern = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g
      let item: RegExpExecArray | null
      while ((item = attrPattern.exec(rawAttrs ?? ''))) {
        const name = item[1].toLowerCase()
        if (!ALLOWED_ATTRS.has(name)) continue
        const value = item[3] ?? item[4] ?? item[5] ?? ''
        if (name === 'src' && !isSafeUrl(value, tag === 'img')) continue
        if (name === 'href' && !isSafeUrl(value)) continue
        attrs.push(`${name}="${value.replace(/"/g, '&quot;')}"`)
      }
      const closing = match.startsWith('</')
      const selfClosing = /\/>$/.test(match) || tag === 'br' || tag === 'hr'
      if (closing) return `</${tag}>`
      return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}${selfClosing ? ' />' : '>'}`
    }
  )
  return output
}

/** 白名单清洗富文本 HTML。 */
export function sanitizeRichHtml(html: string): string {
  const value = String(html ?? '')
  if (!value) return ''
  if (typeof (globalThis as any).DOMParser === 'function') {
    return sanitizeWithDom(value)
  }
  return sanitizeFallback(value)
}

const HTML_TAG_PATTERN =
  /<\/?(?:p|div|span|br|hr|b|strong|i|em|u|s|del|blockquote|a|img|pre|code|ul|ol|li|table|thead|tbody|tr|th|td|h[1-4])\b[^>]*>/i

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 将纯文本转为富文本段落：空行分段，单换行转为 `<br>`。
 * 同时兼容字面量 `\n`（MCP / 外部导入常见），以及 Windows 换行。
 */
export function plainTextToHtml(text: string): string {
  const normalized = String(text ?? '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n?/g, '\n')
  const trimmed = normalized.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n').map((line) => escapeHtmlText(line))
      return `<p>${lines.join('<br>')}</p>`
    })
    .join('')
}

/**
 * 把接口 / 目录说明统一转成可渲染的富文本 HTML。
 * 已是 HTML 的内容只做白名单清洗；纯文本（如 MCP 写入或含字面 `\n`）转成段落。
 */
export function descriptionToHtml(value: string): string {
  const raw = String(value ?? '')
  if (!raw.trim()) return ''
  if (HTML_TAG_PATTERN.test(raw)) return sanitizeRichHtml(raw)
  return sanitizeRichHtml(plainTextToHtml(raw))
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/** 将富文本 HTML 转为纯文本（保留换行）。 */
export function htmlToText(html: string): string {
  let text = String(html ?? '')
  text = text.replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|li|tr|h[1-4]|blockquote|pre)>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  text = text.replace(/\r\n?/g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.replace(/[ \t]+\n/g, '\n').trim()
}

export interface RichTextCount {
  chars: number
  lines: number
}

/** 字数（忽略空白）与行数。 */
export function countRichText(html: string): RichTextCount {
  const text = htmlToText(html)
  const chars = Array.from(text.replace(/\s/g, '')).length
  const lines = text.length === 0 ? 1 : text.split('\n').length
  return { chars, lines }
}
