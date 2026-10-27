import { useEffect, useState } from 'react'
import {
  App as AntApp,
  Button,
  Drawer,
  Empty,
  List,
  Modal,
  Spin,
  Tag
} from 'antd'
import { HistoryOutlined, UndoOutlined } from '@ant-design/icons'
import type {
  MqttConnectionProfile,
  MqttProfileVersion,
  MqttProfileVersionSummary
} from '@shared/mqtt'
import {
  errorMessage,
  formatDateTime,
  protocolLabel,
  unwrap
} from './mqttUtils'

interface Props {
  open: boolean
  projectId: string
  connectionId: string
  onClose: () => void
  onRestored: (profile: MqttConnectionProfile) => void
}

export default function VersionDrawer({
  open,
  projectId,
  connectionId,
  onClose,
  onRestored
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [versions, setVersions] = useState<MqttProfileVersionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<MqttProfileVersion | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    if (!projectId || !connectionId) return
    setLoading(true)
    try {
      setVersions(unwrap(await window.api.mqtt.profiles.versions.list(projectId, connectionId)))
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, connectionId])

  const showDetail = async (versionId: string): Promise<void> => {
    setDetailLoading(true)
    try {
      const version = unwrap(
        await window.api.mqtt.profiles.versions.get(projectId, connectionId, versionId)
      )
      if (!version) {
        message.warning('版本不存在')
        return
      }
      setDetail(version)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setDetailLoading(false)
    }
  }

  const restore = (version: MqttProfileVersionSummary): void => {
    modal.confirm({
      title: '恢复该版本？',
      content: `将使用「${version.name || '未命名'}」${
        version.created_at ? `（${formatDateTime(version.created_at)}）` : ''
      } 的内容覆盖当前配置，恢复后会生成一个新的版本快照。`,
      okText: '恢复',
      cancelText: '取消',
      onOk: async () => {
        setRestoring(version.version_id)
        try {
          const restored = unwrap(
            await window.api.mqtt.profiles.versions.restore(
              projectId,
              connectionId,
              version.version_id
            )
          )
          onRestored(restored)
          await load()
          message.success('已恢复版本')
        } catch (error) {
          message.error(errorMessage(error))
        } finally {
          setRestoring(null)
        }
      }
    })
  }

  const snapshot = detail?.snapshot

  return (
    <>
      <Drawer
        title={
          <span>
            <HistoryOutlined /> 版本历史
          </span>
        }
        width={560}
        open={open}
        onClose={onClose}
        extra={
          <Button size="small" onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        }
      >
        {loading ? (
          <div className="mqtt-drawer-loading">
            <Spin />
          </div>
        ) : versions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="每次保存连接配置后会自动生成版本快照"
          />
        ) : (
          <List
            size="small"
            dataSource={versions}
            renderItem={(version) => (
              <List.Item
                className="mqtt-version-item"
                actions={[
                  <Button
                    key="detail"
                    size="small"
                    type="link"
                    onClick={() => void showDetail(version.version_id)}
                  >
                    查看
                  </Button>,
                  <Button
                    key="restore"
                    size="small"
                    type="link"
                    icon={<UndoOutlined />}
                    loading={restoring === version.version_id}
                    onClick={() => restore(version)}
                  >
                    恢复
                  </Button>
                ]}
              >
                <List.Item.Meta
                  title={
                    <span className="mqtt-version-title">
                      {version.name || '未命名'}
                      <Tag color="default">v</Tag>
                    </span>
                  }
                  description={
                    <span className="mqtt-version-desc">
                      {formatDateTime(version.created_at)} · {version.host}:{version.port} ·{' '}
                      {protocolLabel(version.protocol_version)} · 订阅 {version.subscription_count}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      <Modal
        open={Boolean(detail)}
        title="版本详情"
        onCancel={() => setDetail(null)}
        footer={
          <Button onClick={() => setDetail(null)}>关闭</Button>
        }
        width={620}
      >
        {detailLoading ? (
          <Spin />
        ) : snapshot ? (
          <div className="mqtt-version-detail">
            <div className="mqtt-kv">
              <span>名称</span>
              <strong>{snapshot.name}</strong>
            </div>
            <div className="mqtt-kv">
              <span>地址</span>
              <strong>
                {snapshot.host}:{snapshot.port}
              </strong>
            </div>
            <div className="mqtt-kv">
              <span>协议</span>
              <strong>{protocolLabel(snapshot.protocol_version)}</strong>
            </div>
            <div className="mqtt-kv">
              <span>clientId</span>
              <strong className="mono">{snapshot.client_id}</strong>
            </div>
            <div className="mqtt-kv">
              <span>订阅数</span>
              <strong>{snapshot.subscriptions?.length ?? 0}</strong>
            </div>
            {snapshot.subscriptions?.length ? (
              <ul className="mqtt-version-subs">
                {snapshot.subscriptions.map((sub, index) => (
                  <li key={`${sub.filter}-${index}`}>
                    <span className="mono">{sub.filter}</span>
                    <Tag color="default">QoS {sub.qos}</Tag>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
