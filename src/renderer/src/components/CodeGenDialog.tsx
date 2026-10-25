import { useEffect, useState } from 'react'
import { Alert, App as AntApp, Button, Modal, Spin } from 'antd'
import { CodeOutlined, CopyOutlined } from '@ant-design/icons'
import type { CurlResult, Target } from '@shared/types'

interface Props {
  open: boolean
  projectId: string
  target: Target | null
  environmentId?: string
  onClose: () => void
}

const LANGUAGES: Array<{ id: string; label: string; enabled?: boolean }> = [
  { id: 'curl', label: 'shell(curl)', enabled: true },
  { id: 'httpie', label: 'shell(httpie)' },
  { id: 'wget', label: 'shell(wget)' },
  { id: 'c', label: 'c(libcurl)' },
  { id: 'clojure', label: 'clojure(clj_http)' },
  { id: 'csharp-client', label: 'csharp(httpclient)' },
  { id: 'csharp-rest', label: 'csharp(restsharp)' },
  { id: 'go', label: 'go(native)' },
  { id: 'http', label: 'HTTP(http/1.1)' },
  { id: 'java-async', label: 'java(asynchttp)' },
  { id: 'java-net', label: 'java(nethttp)' },
  { id: 'java-okhttp', label: 'java(okhttp)' },
  { id: 'java-unirest', label: 'java(unirest)' },
  { id: 'js-axios', label: 'javascript(axios)' },
  { id: 'js-fetch', label: 'javascript(fetch)' },
  { id: 'js-jquery', label: 'javascript(jquery)' },
  { id: 'js-xhr', label: 'javascript(xhr)' }
]

export default function CodeGenDialog({
  open,
  projectId,
  target,
  environmentId,
  onClose
}: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const [language, setLanguage] = useState('curl')
  const [result, setResult] = useState<CurlResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !target || !projectId) return
    setLanguage('curl')
    setResult(null)
    setLoading(true)
    void window.api.targets
      .codegenCurl(projectId, target, environmentId)
      .then((response) => {
        if (response.ok) setResult(response.data)
        else message.error(response.error)
      })
      .finally(() => setLoading(false))
  }, [open, projectId, target, environmentId, message])

  const copy = async (): Promise<void> => {
    if (!result?.script) return
    const response = await window.api.app.copyText(result.script)
    if (response.ok) message.success('已复制')
    else message.error(response.error)
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={920}
      title="生成代码"
      destroyOnClose
      className="codegen-modal"
    >
      <div className="codegen-body">
        <div className="codegen-langs">
          {LANGUAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!item.enabled}
              className={`codegen-lang${language === item.id ? ' active' : ''}`}
              title={item.enabled ? item.label : `${item.label} 后续支持`}
              onClick={() => item.enabled && setLanguage(item.id)}
            >
              <CodeOutlined />
              <span>{item.label}</span>
              {!item.enabled ? <span className="codegen-soon">后续</span> : null}
            </button>
          ))}
        </div>
        <div className="codegen-main">
          <div className="codegen-toolbar">
            <span>shell(curl)</span>
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<CopyOutlined />} onClick={() => void copy()}>
              复制代码
            </Button>
          </div>
          <div className="codegen-code">
            {loading ? (
              <div className="codegen-loading">
                <Spin />
              </div>
            ) : (
              <pre>{result?.script || '// 暂无代码'}</pre>
            )}
          </div>
          {result?.warnings?.length ? (
            <Alert
              type="warning"
              showIcon
              className="codegen-warnings"
              message={result.warnings.join('；')}
            />
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
