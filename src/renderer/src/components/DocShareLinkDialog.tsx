import { useEffect, useState } from 'react'
import { Alert, App as AntApp, Button, Input, Modal } from 'antd'
import { CopyOutlined, DownloadOutlined, LinkOutlined } from '@ant-design/icons'
import type { DocServiceStatus } from '@shared/types'

export interface DocShareLinkInfo {
  shareId: string
  name: string
  openapi: boolean
}

interface Props {
  share: DocShareLinkInfo | null
  onClose: () => void
}

export default function DocShareLinkDialog({ share, onClose }: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const [status, setStatus] = useState<DocServiceStatus | null>(null)

  useEffect(() => {
    if (!share) return
    let alive = true
    void window.api.docs.serviceStatus().then((result) => {
      if (alive && result.ok) setStatus(result.data)
    })
    return () => {
      alive = false
    }
  }, [share?.shareId])

  const url = share && status ? `${status.base_url}/share/${share.shareId}` : ''

  const copy = async (): Promise<void> => {
    if (!url) return
    const result = await window.api.app.copyText(url)
    if (result.ok) message.success('链接已复制')
    else message.error(result.error)
  }

  const open = async (target: string): Promise<void> => {
    if (!target) return
    if (!status?.running) {
      message.warning('分享服务未启动，请先在「分享服务」中启用')
      return
    }
    const result = await window.api.app.openExternal(target)
    if (!result.ok) message.error(result.error)
  }

  return (
    <Modal
      title="分享链接"
      open={Boolean(share)}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      destroyOnClose
    >
      {share ? (
        <div className="docs-link-box">
          <div className="docs-link-name">{share.name}</div>
          {status && !status.running ? (
            <Alert
              type="warning"
              showIcon
              message={status.error || '分享服务未启动，链接暂时无法访问'}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          <Input
            readOnly
            value={url}
            addonAfter={
              <button className="docs-link-copy" onClick={() => void copy()}>
                <CopyOutlined /> 复制
              </button>
            }
          />
          <div className="docs-link-actions">
            <Button
              type="primary"
              icon={<LinkOutlined />}
              disabled={!url}
              onClick={() => void open(url)}
            >
              打开链接
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!url}
              onClick={() => void open(`${url}/download?format=md`)}
            >
              Markdown
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!url}
              onClick={() => void open(`${url}/download?format=html`)}
            >
              HTML
            </Button>
            {share.openapi ? (
              <Button
                icon={<DownloadOutlined />}
                disabled={!url}
                onClick={() => void open(`${url}/download?format=openapi`)}
              >
                OpenAPI
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
