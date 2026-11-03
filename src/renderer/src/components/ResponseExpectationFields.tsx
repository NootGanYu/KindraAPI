import { AutoComplete, Input, Select } from 'antd'
import type { ResponseExample } from '@shared/types'

export const RESPONSE_FORMATS = [
  { value: 'application/json', label: 'JSON' },
  { value: 'application/xml', label: 'XML' },
  { value: 'text/html', label: 'HTML' },
  { value: 'application/octet-stream', label: 'Binary' },
  { value: 'text/plain', label: 'Text' }
]
const STATUS_CODES = [200, 201, 202, 204, 301, 302, 304, 400, 401, 403, 404, 405, 408, 409, 410, 415, 422, 429, 500, 501, 502, 503, 504]

export interface ExpectationDraft {
  name: string
  code: string
  contentType: string
  sleep: string
}
export function expectationDraft(expect?: ResponseExample['expect']): ExpectationDraft {
  return { name: expect?.name ?? '成功', code: String(expect?.code ?? 200),
    contentType: expect?.content_type ?? 'application/json', sleep: String(expect?.sleep ?? 0) }
}
export function expectationError(draft: ExpectationDraft): string {
  if (!draft.name.trim()) return '请输入期望名称'
  if (!/^\d{3}$/.test(draft.code) || Number(draft.code) < 100 || Number(draft.code) > 599) return 'HTTP 状态码应为 100–599 的整数'
  if (!/^\d+$/.test(draft.sleep) || !Number.isSafeInteger(Number(draft.sleep))) return '返回延迟应为非负整数（ms）'
  return ''
}
export function expectationValue(draft: ExpectationDraft): NonNullable<ResponseExample['expect']> {
  return { name: draft.name.trim(), code: Number(draft.code), content_type: draft.contentType, sleep: Number(draft.sleep) }
}

export default function ResponseExpectationFields({ value, onChange, settings = false }: {
  value: ExpectationDraft
  onChange: (next: ExpectationDraft) => void
  settings?: boolean
}): JSX.Element {
  const prefix = settings ? 'expect' : 'new-expect'
  return <div className={`response-expect-fields${settings ? ' expectation-settings' : ''}`}>
    <label htmlFor={`${prefix}-name`}><i>*</i>期望名称</label>
    <Input id={`${prefix}-name`} value={value.name} placeholder="例如：成功" status={!value.name.trim() ? 'error' : undefined}
      onChange={event => onChange({ ...value, name: event.target.value })} />
    <label htmlFor={`${prefix}-code`}><i>*</i>{settings ? '返回 HTTP 状态码' : '状态码'}</label>
    <AutoComplete id={`${prefix}-code`} value={value.code} options={STATUS_CODES.map(code => ({ value: String(code) }))}
      status={!/^\d{3}$/.test(value.code) || Number(value.code) < 100 || Number(value.code) > 599 ? 'error' : undefined}
      filterOption={(input, option) => Boolean(option?.value?.startsWith(input))}
      onChange={code => onChange({ ...value, code })} />
    <label htmlFor={`${prefix}-content-type`}><i>*</i>{settings ? '返回内容格式' : '内容格式'}</label>
    <Select id={`${prefix}-content-type`} value={value.contentType}
      options={RESPONSE_FORMATS.some(format => format.value === value.contentType) ? RESPONSE_FORMATS : [...RESPONSE_FORMATS, { value: value.contentType, label: value.contentType }]}
      onChange={contentType => onChange({ ...value, contentType })} />
    {settings && <>
      <label htmlFor="expect-sleep"><i>*</i>返回延迟</label>
      <Input id="expect-sleep" value={value.sleep} suffix="ms" inputMode="numeric"
        status={!/^\d+$/.test(value.sleep) || !Number.isSafeInteger(Number(value.sleep)) ? 'error' : undefined}
        onChange={event => onChange({ ...value, sleep: event.target.value })} />
    </>}
  </div>
}
