import { stableJson } from '@shared/targetSync'
import type { ProjectRedactor } from '../redaction'

export interface ChangeEntry {
  field: string
  before: unknown
  after: unknown
}
function show(value: unknown): string {
  if (value === undefined) return '（无）'
  let text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) text = String(value)
  return text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text
}
/** Field-level before/after for a proposal; only changed fields are included. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): ChangeEntry[] {
  return [...new Set(fields)].filter(field => stableJson(before[field]) !== stableJson(after[field])).map(field => ({ field, before: before[field], after: after[field] }))
}
export function renderDiff(entries: ChangeEntry[], message: string, redact?: ProjectRedactor): string {
  const safe = redact ? redact(entries) : entries
  const lines = safe.map(entry => `字段：${entry.field}\n- ${show(entry.before)}\n+ ${show(entry.after)}`)
  return [message, ...lines].join('\n\n')
}
export function candidateMessage(status: 'pending' | 'applied', kind: string): string {
  return status === 'applied'
    ? `${kind}已应用到本机草稿，正式定义未保存。`
    : `${kind}已创建本机候选，尚未保存正式定义。`
}
