import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  Select,
  Table,
  Tag,
  Tooltip
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ClearOutlined,
  DownloadOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type { MqttAttempt, MqttProfileSummary } from '@shared/mqtt'
import { mqttReasonText } from '@shared/mqtt'
import {
  errorMessage,
  formatDateTime,
  unwrap,
  useMqttEvent
} from './mqttUtils'

interface Props {
  projectId: string
  profiles: MqttProfileSummary[]
}

export default function AttemptsPanel({ projectId, profiles }: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [filterId, setFilterId] = useState('all')
  const [attempts, setAttempts] = useState<MqttAttempt[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setAttempts([])
      return
    }
    setLoading(true)
    try {
      const list = unwrap(
        await window.api.mqtt.attempts.list(
          projectId,
          filterId === 'all' ? undefined : filterId,
          200
        )
      )
      setAttempts(list)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [projectId, filterId, message])

  useEffect(() => {
    void load()
  }, [load])

  useMqttEvent(projectId ? `mqtt-attempts-${projectId}-${filterId}` : null, (event) => {
    if (event.type !== 'attempt') return
    const attempt = event.payload as MqttAttempt
    if (!attempt?.attempt_id) return
    if (filterId !== 'all' && attempt.connection_id !== filterId) return
    setAttempts((current) =>
      [attempt, ...current.filter((item) => item.attempt_id !== attempt.attempt_id)].slice(0, 200)
    )
  })

  const names = useMemo(
    () => new Map(profiles.map((profile) => [profile.connection_id, profile.name])),
    [profiles]
  )

  const clear = (): void => {
    modal.confirm({
      title: '清空运行记录？',
      content:
        filterId === 'all'
          ? '将清空当前项目全部连接测试与连接记录，此操作不可撤销。'
          : `将清空「${names.get(filterId) ?? filterId}」的运行记录，此操作不可撤销。`,
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          unwrap(
            await window.api.mqtt.attempts.clear(
              projectId,
              filterId === 'all' ? undefined : filterId
            )
          )
          setAttempts([])
          message.success('已清空')
        } catch (error) {
          message.error(errorMessage(error))
        }
      }
    })
  }

  const exportRecords = async (): Promise<void> => {
    try {
      const result = unwrap(
        await window.api.mqtt.attempts.export(
          projectId,
          filterId === 'all' ? undefined : filterId
        )
      )
      if (result.canceled) {
        message.info('已取消导出')
        return
      }
      message.success(
        `已导出 ${result.count ?? 0} 条记录${result.path ? ` → ${result.path}` : ''}`
      )
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const columns: ColumnsType<MqttAttempt> = [
    {
      title: '开始时间',
      dataIndex: 'started_at',
      width: 160,
      render: (value: string) => formatDateTime(value)
    },
    {
      title: '配置',
      dataIndex: 'connection_id',
      width: 180,
      ellipsis: true,
      render: (value: string) => names.get(value) ?? value
    },
    {
      title: '类型',
      dataIndex: 'kind',
      width: 80,
      render: (value: MqttAttempt['kind']) => (
        <Tag color={value === 'test' ? 'blue' : 'purple'}>
          {value === 'test' ? '测试' : '连接'}
        </Tag>
      )
    },
    {
      title: '结果',
      dataIndex: 'success',
      width: 80,
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'red'}>{value ? '成功' : '失败'}</Tag>
      )
    },
    {
      title: '耗时',
      dataIndex: 'duration_ms',
      width: 90,
      render: (value: number) => `${value} ms`
    },
    {
      title: '详情',
      key: 'detail',
      render: (_: unknown, attempt) => {
        if (attempt.error) {
          return (
            <Tooltip title={attempt.error.hint}>
              <span className="mqtt-attempt-error">
                <Tag color="red">{attempt.error.category}</Tag>
                {attempt.error.message}
              </span>
            </Tooltip>
          )
        }
        const code = attempt.connack?.reason_code ?? attempt.connack?.return_code
        return code !== undefined
          ? mqttReasonText(
              code,
              'connack',
              attempt.connack?.protocol_version === 4 ? 4 : 5
            )
          : attempt.connack?.client_id ?? '—'
      }
    }
  ]

  return (
    <div className="mqtt-attempts-panel">
      <div className="mqtt-panel-toolbar">
        <Select
          size="small"
          value={filterId}
          style={{ width: 220 }}
          onChange={setFilterId}
          options={[
            { value: 'all', label: '全部配置' },
            ...profiles.map((profile) => ({
              value: profile.connection_id,
              label: profile.name
            }))
          ]}
        />
        <span style={{ flex: 1 }} />
        <span className="muted">共 {attempts.length} 条</span>
        <Tooltip title="刷新">
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
        </Tooltip>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() => void exportRecords()}
          disabled={attempts.length === 0}
        >
          导出
        </Button>
        <Button
          size="small"
          danger
          icon={<ClearOutlined />}
          onClick={clear}
          disabled={attempts.length === 0}
        >
          清空
        </Button>
      </div>
      <Table<MqttAttempt>
        rowKey="attempt_id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={attempts}
        pagination={{ pageSize: 12, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
        scroll={{ x: 760 }}
      />
    </div>
  )
}
