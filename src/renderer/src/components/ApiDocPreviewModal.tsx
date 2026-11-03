import { Modal, Tag } from 'antd'
import type { AuthModel, Param, Target } from '@shared/types'
import { descriptionToHtml } from '@shared/richText'
import { apiStatuses } from '@shared/apiStatuses'
import { methodColor } from '@shared/httpMethods'
import { tryPrettyJson } from '@shared/pretty'
import JsonCode, { isJsonText } from './JsonCode'
import { useApp } from '../store'

const AUTH_LABELS: Record<string, string> = {
  inherit: '继承父级',
  noauth: '无需认证',
  bearer: 'Bearer Token',
  basic: 'Basic Auth',
  kv: 'API Key',
  digest: 'Digest',
  oauth1: 'OAuth 1.0',
  oauth2: 'OAuth 2.0',
  hawk: 'Hawk',
  awsv4: 'AWS Signature',
  ntlm: 'NTLM',
  jwt: 'JWT',
  asap: 'ASAP',
  edgegrid: 'EdgeGrid'
}

function authSummary(auth?: AuthModel): string {
  if (!auth) return '继承父级'
  const label = AUTH_LABELS[auth.type] ?? auth.type
  if (auth.type === 'kv' && auth.kv?.key) {
    return `${label} · ${auth.kv.key}（${auth.kv.in === 'query' ? 'Query' : 'Header'}）`
  }
  if (auth.type === 'basic' && auth.basic?.username) {
    return `${label} · ${auth.basic.username}`
  }
  return label
}

interface Props {
  open: boolean
  target: Target
  onClose: () => void
}

function ParamList({ title, params }: { title: string; params?: Param[] }): JSX.Element | null {
  if (!params || params.length === 0) return null
  return (
    <section className="api-doc-preview-section">
      <h4>{title}</h4>
      <div className="doc-param-table">
        <div className="doc-param-row head">
          <span>参数名</span>
          <span>参数值 / 示例</span>
          <span>说明</span>
        </div>
        {params.map((param) => (
          <div className="doc-param-row" key={param.param_id}>
            <span className="mono">
              {param.key || '—'}
              {param.required ? <i className="doc-required">*</i> : null}
            </span>
            <span className="mono muted">{param.value || '—'}</span>
            <span>{param.description || '—'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function codeText(raw?: string): string {
  return tryPrettyJson(raw).text
}

export default function ApiDocPreviewModal({ open, target, onClose }: Props): JSX.Element {
  const project = useApp(state => state.project)
  const statuses = apiStatuses(project)
  const status = statuses.find(item => item.id === (target.mark_id || String(target.status ?? 1))) ?? statuses[0]
  const request = target.request
  const body = request?.body
  const errors = target.design?.errors ?? []
  const examples = target.response?.example ?? []

  const bodyContent = (): JSX.Element | null => {
    if (!body || body.mode === 'none') return null
    if (body.mode === 'raw' || body.mode === 'json') {
      return (
        <section className="api-doc-preview-section">
          <h4>Body（{body.raw_language || 'json'}）</h4>
          {isJsonText(codeText(body.raw)) ? (
            <JsonCode text={codeText(body.raw)} className="api-doc-preview-code" />
          ) : (
            <pre className="api-doc-preview-code">{codeText(body.raw) || '（空）'}</pre>
          )}
        </section>
      )
    }
    if (body.mode === 'urlencoded') {
      return <ParamList title="Body（urlencoded）" params={body.urlencoded} />
    }
    if (body.mode === 'formdata') {
      return <ParamList title="Body（form-data）" params={body.formdata} />
    }
    return (
      <section className="api-doc-preview-section">
        <h4>Body（binary）</h4>
        <div className="muted">{body.binary?.file_path || '（未选择文件）'}</div>
      </section>
    )
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={920}
      title="接口预览"
      destroyOnClose
      className="api-doc-preview"
    >
      <div className="api-doc-preview-head">
        <span className="api-doc-method" style={{ color: methodColor(target.method) }}>{(target.method || 'GET').toUpperCase()}</span>
        <span className="api-doc-url mono">{target.url || '—'}</span>
        <span className="api-doc-proto">{target.protocol || 'http/1.1'}</span>
        <span className="api-doc-status" style={{ color: status.color }}>
          <i style={{ background: status.color }} />
          {status.name}
        </span>
        <span style={{ flex: 1 }} />
        <strong>{target.name}</strong>
        {target.tags?.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </div>

      <section className="api-doc-preview-section">
        <h4>详细说明</h4>
        <div
          className="api-doc-preview-desc"
          dangerouslySetInnerHTML={{
            __html: descriptionToHtml(target.description ?? '') || '<p class="muted">暂无说明</p>'
          }}
        />
      </section>

      <section className="api-doc-preview-section">
        <h4>请求契约</h4>
        <ParamList title="Header" params={request?.header?.parameter} />
        <ParamList title="Query" params={request?.query?.parameter} />
        <ParamList title="Path" params={request?.restful?.parameter} />
        <section className="api-doc-preview-section">
          <h4>认证</h4>
          <div className="muted">{authSummary(request?.auth)}</div>
        </section>
        {bodyContent()}
      </section>

      <section className="api-doc-preview-section">
        <h4>响应契约</h4>
        {examples.length === 0 ? (
          <div className="muted">暂无响应示例</div>
        ) : (
          examples.map((example) => (
            <div className="api-doc-example" key={example.example_id}>
              <div className="api-doc-example-head">
                {example.expect?.name ? <Tag>{example.expect.name}</Tag> : null}
                {example.expect?.code ? <Tag color="blue">{example.expect.code}</Tag> : null}
                {example.expect?.content_type ? <Tag>{example.expect.content_type}</Tag> : null}
              </div>
              {isJsonText(codeText(example.raw)) ? (
                <JsonCode text={codeText(example.raw)} className="api-doc-preview-code" />
              ) : (
                <pre className="api-doc-preview-code">{codeText(example.raw) || '（空）'}</pre>
              )}
            </div>
          ))
        )}
      </section>

      {errors.length > 0 ? (
        <section className="api-doc-preview-section">
          <h4>错误码</h4>
          <div className="doc-param-table error-codes">
            <div className="doc-param-row head">
              <span>Code</span>
              <span>含义</span>
              <span>备注</span>
            </div>
            {errors.map((error) => (
              <div className="doc-param-row" key={error.code}>
                <span className="mono">{error.code}</span>
                <span>{error.message}</span>
                <span className="muted">{error.description ?? '—'}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Modal>
  )
}
