import type { DesignError } from './types'

export interface ErrorCodeParseResult {
  items: DesignError[]
  warnings: string[]
  error?: string
}

const MAX_INPUT = 200_000
const HEADER_CODES = new Set(['code', 'status', '状态码', '错误码', '状态'])
const HEADER_MESSAGES = new Set(['message', 'msg', '含义', '说明', '描述'])

function normalizeCode(value: unknown): string {
  const code = String(value ?? '').trim().replace(/[:：,，。;；]+$/, '')
  return code
}

function isHeaderRow(code: string, message: string): boolean {
  return HEADER_CODES.has(code.toLowerCase()) || HEADER_MESSAGES.has(message.trim().toLowerCase())
}

function pushItem(
  items: DesignError[],
  warnings: string[],
  seen: Set<string>,
  codeValue: unknown,
  messageValue: unknown,
  descriptionValue?: unknown
): void {
  const code = normalizeCode(codeValue)
  if (!code) return
  if (seen.has(code)) {
    warnings.push(`重复错误码已跳过：${code}`)
    return
  }
  seen.add(code)
  const message = String(messageValue ?? '').trim()
  const description = String(descriptionValue ?? '').trim()
  if (!message) warnings.push(`错误码 ${code} 缺少含义`)
  items.push({ code, message, description: description || undefined })
}

function parseJsonInput(value: unknown): ErrorCodeParseResult | null {
  if (Array.isArray(value)) {
    const items: DesignError[] = []
    const warnings: string[] = []
    const seen = new Set<string>()
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const source = entry as Record<string, unknown>
      pushItem(items, warnings, seen, source.code ?? source.status, source.message ?? source.msg, source.description)
    }
    if (items.length === 0) return null
    return { items, warnings }
  }
  if (value && typeof value === 'object') {
    const items: DesignError[] = []
    const warnings: string[] = []
    const seen = new Set<string>()
    for (const [code, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const source = entry as Record<string, unknown>
        pushItem(items, warnings, seen, code, source.message ?? source.msg, source.description)
      } else {
        pushItem(items, warnings, seen, code, entry)
      }
    }
    if (items.length === 0) return null
    return { items, warnings }
  }
  return null
}

function splitLine(line: string): string[] | null {
  let body = line.trim().replace(/^[-*+]\s+/, '')
  if (!body || body.startsWith('#') || body.startsWith('//')) return null

  let description = ''
  const slash = body.indexOf(' #')
  if (slash >= 0) {
    description = body.slice(slash + 1).trim()
    body = body.slice(0, slash).trim()
  }

  let parts: string[]
  if (body.includes('\t')) {
    parts = body.split('\t')
  } else if (body.includes('|')) {
    parts = body.split('|')
  } else {
    const match = /^(\S+?)\s*[,:：]\s*(.*)$/.exec(body)
    if (match) {
      parts = [match[1], match[2]]
    } else {
      const space = /^(\S+)\s+(.+)$/.exec(body)
      if (space) parts = [space[1], space[2]]
      else parts = [body]
    }
  }
  parts = parts.map((part) => part.trim())
  if (description) {
    if (parts.length >= 3) parts[2] = [parts[2], description].filter(Boolean).join('；')
    else {
      while (parts.length < 2) parts.push('')
      parts[2] = description
    }
  }
  return parts
}

/**
 * 批量解析错误码。支持空格/冒号/竖线/逗号/Tab 分隔的文本行，
 * 以及 `[{ code, message, description }]` 或 `{ "400": "参数错误" }` 形式的 JSON。
 */
export function parseErrorCodes(text: string): ErrorCodeParseResult {
  const input = (text ?? '').replace(/^\uFEFF/, '').trim()
  if (!input) return { items: [], warnings: [], error: '请输入错误码内容' }
  if (input.length > MAX_INPUT) {
    return { items: [], warnings: [], error: `内容过长，最多 ${MAX_INPUT} 个字符` }
  }

  try {
    const parsed = JSON.parse(input)
    if (parsed !== null && typeof parsed === 'object') {
      return (
        parseJsonInput(parsed) ?? {
          items: [],
          warnings: [],
          error: 'JSON 中没有可识别的错误码'
        }
      )
    }
  } catch {
    // 非 JSON，按文本行解析
  }

  const items: DesignError[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  let skipped = 0

  for (const line of input.split(/\r?\n/)) {
    const parts = splitLine(line)
    if (!parts) continue
    const code = normalizeCode(parts[0])
    const message = (parts[1] ?? '').trim()
    const description = (parts[2] ?? '').trim()
    if (!code) {
      skipped += 1
      continue
    }
    if (isHeaderRow(code, message)) continue
    if (code.length > 40 || /\s/.test(code)) {
      skipped += 1
      continue
    }
    pushItem(items, warnings, seen, code, message, description)
  }

  if (skipped > 0) warnings.push(`跳过 ${skipped} 行无法解析的内容`)
  if (items.length === 0) {
    return { items, warnings, error: '没有识别到有效的错误码' }
  }
  return { items, warnings }
}
