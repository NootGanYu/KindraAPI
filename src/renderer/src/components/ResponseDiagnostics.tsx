import { useState } from 'react'
import { methodColor } from '@shared/httpMethods'
import type { SendRecord } from '@shared/types'

function Pairs({ rows }: { rows: Array<[string, string]> }): JSX.Element {
  return rows.length ? <table className="simple-table"><thead><tr><th>参数名</th><th>参数值</th></tr></thead><tbody>{rows.map(([key, value], i) => <tr key={i}><td>{key}</td><td className="mono">{value}</td></tr>)}</tbody></table> : <div className="debug-diagnostic-empty">（无）</div>
}
export function ActualRequest({ record }: { record: SendRecord }): JSX.Element {
  const [tab, setTab] = useState('Header')
  let query: Array<[string, string]> = []
  try { query = [...new URL(record.request.url).searchParams] } catch { query = Object.entries(record.request.querys ?? {}) }
  const request = record.request
  return <div className="resp-filled debug-actual-request">
    <div className="debug-actual-url"><strong style={{ color: methodColor(request.method) }}>{request.method}</strong><span className="mono">{request.url}</span></div>
    <div className="debug-diagnostic-tabs" role="tablist" aria-label="实际请求详情">{['Header', 'Query', 'Path', 'Body'].map(name => <button role="tab" key={name} aria-selected={name === tab} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div>
    {tab === 'Header' ? <Pairs rows={Object.entries(request.headers ?? {})} /> : tab === 'Query' ? <Pairs rows={query} /> : tab === 'Path' ? <Pairs rows={Object.entries(request.paths ?? {})} /> :
      <pre className="resp-code">{request.body ? typeof request.body === 'string' ? request.body : JSON.stringify(request.body, null, 2) : '（无请求体）'}</pre>}
  </div>
}
export function ResponseCookies({ cookies }: { cookies: Array<Record<string, unknown>> }): JSX.Element {
  const fields = [['Name', 'name'], ['Value', 'value'], ['Domain', 'domain'], ['Path', 'path'], ['Expires', 'expires'], ['HttpOnly', 'httpOnly'], ['Secure', 'secure']]
  return cookies.length ? <div className="resp-filled debug-cookies"><table className="simple-table"><thead><tr>{fields.map(([label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{cookies.map((cookie, index) => <tr key={index}>{fields.map(([, key]) => <td key={key}>{String(cookie[key] ?? (key === 'expires' ? 'Session' : key === 'httpOnly' || key === 'secure' ? false : ''))}</td>)}</tr>)}</tbody></table></div> : <div className="debug-diagnostic-empty">（无 Cookie）</div>
}
export function ResponseAssertions({ record }: { record: SendRecord }): JSX.Element {
  const assertions = record.assertions ?? []
  const passed = assertions.filter(item => item.passed && !item.skipped).length
  const failed = assertions.filter(item => !item.passed && !item.skipped).length
  return <details className="debug-response-assertions"><summary>断言与校验 <span className={failed ? 'failed' : 'muted'}>{assertions.length ? `${passed} 通过 · ${failed} 失败` : '暂无断言'}</span></summary>
    {assertions.length ? <table className="simple-table"><tbody>{assertions.map((item, i) => <tr key={i}><td className={item.skipped ? 'muted' : item.passed ? 'passed' : 'failed'}>{item.skipped ? '跳过' : item.passed ? '通过' : '失败'}</td><td>{item.name}</td><td className="failed">{item.error}</td></tr>)}</tbody></table> : <div className="debug-diagnostic-empty">可在后执行操作中添加断言脚本。</div>}
  </details>
}
