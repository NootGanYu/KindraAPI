import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip
} from 'antd'
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type {
  DbConnection,
  DbTable,
  ImportConflictStrategy,
  ImportDbResult,
  ModelSummary
} from '@shared/types'
import { createDbConnection } from '@shared/factories'

interface Props {
  projectId: string
  actionToken?: number
  onModelsChanged?: () => void
}

type TestResult = { ok: boolean; server_version?: string; message: string } | null

export default function DatabasePanel({
  projectId,
  actionToken = 0,
  onModelsChanged
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [connections, setConnections] = useState<DbConnection[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<DbConnection | null>(null)
  const [draft, setDraft] = useState<DbConnection>(() => createDbConnection(projectId))
  const [activeTab, setActiveTab] = useState('regular')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult>(null)
  const keyFile = useRef<HTMLInputElement>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importConnection, setImportConnection] = useState<DbConnection | null>(null)
  const [tables, setTables] = useState<DbTable[]>([])
  const [tablesLoading, setTablesLoading] = useState(false)
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [folders, setFolders] = useState<ModelSummary[]>([])
  const [targetFolder, setTargetFolder] = useState('0')
  const [conflict, setConflict] = useState<ImportConflictStrategy>('update')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportDbResult | null>(null)

  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.api.db.list(projectId)
      if (!result.ok) throw new Error(result.error)
      setConnections(result.data)
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (actionToken > 0) openCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionToken])

  const loadFolders = async (): Promise<void> => {
    const result = await window.api.models.list(projectId)
    if (result.ok) setFolders(result.data.filter((item) => item.model_type === 'folder'))
  }

  const openCreate = (): void => {
    setEditing(null)
    setDraft(createDbConnection(projectId, { name: '' }))
    setActiveTab('regular')
    setTestResult(null)
    setOpen(true)
  }

  const openEdit = (connection: DbConnection): void => {
    setEditing(connection)
    setDraft(JSON.parse(JSON.stringify(connection)) as DbConnection)
    setActiveTab('regular')
    setTestResult(null)
    setOpen(true)
  }

  const patchDefault = (patch: Partial<DbConnection['config']['default']>): void => {
    setDraft((current) => ({
      ...current,
      config: { default: { ...current.config.default, ...patch } }
    }))
  }

  const patchSsh = (patch: Partial<DbConnection['ssh']>): void => {
    setDraft((current) => ({ ...current, ssh: { ...current.ssh, ...patch } }))
  }

  const validateDraft = (): string | null => {
    if (!draft.name.trim()) return '请输入连接名称'
    if (!draft.config.default.host.trim()) return '请输入数据库地址'
    if (!draft.config.default.user.trim()) return '请输入用户名'
    if (!draft.config.default.database.trim()) return '请输入数据库名'
    return null
  }

  const save = async (): Promise<void> => {
    const problem = validateDraft()
    if (problem) {
      message.error(problem)
      return
    }
    const result = await window.api.db.save(projectId, draft)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    setOpen(false)
    await reload()
    message.success(editing ? '已更新连接' : '已新建连接')
  }

  const test = async (): Promise<void> => {
    const problem = validateDraft()
    if (problem) {
      setTestResult({ ok: false, message: problem })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.db.test(draft.config.default, draft.ssh)
      if (!result.ok) throw new Error(result.error)
      setTestResult(result.data)
    } catch (error) {
      setTestResult({ ok: false, message: (error as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const remove = (connection: DbConnection): void => {
    modal.confirm({
      title: `删除数据库连接「${connection.name}」？`,
      content: '已导入的数据模型会保留，此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.api.db.delete(projectId, connection.db_id)
        if (!result.ok) {
          message.error(result.error)
          return
        }
        await reload()
        message.success('已删除连接')
      }
    })
  }

  const openImport = async (connection: DbConnection): Promise<void> => {
    setImportConnection(connection)
    setImportOpen(true)
    setImportResult(null)
    setSelectedTables([])
    setTargetFolder('0')
    setConflict('update')
    await Promise.all([loadFolders(), loadTables(connection)])
  }

  const loadTables = async (connection: DbConnection): Promise<void> => {
    setTablesLoading(true)
    try {
      const result = await window.api.db.tables(connection.config.default, connection.ssh)
      if (!result.ok) throw new Error(result.error)
      setTables(result.data)
    } catch (error) {
      message.error((error as Error).message)
      setTables([])
    } finally {
      setTablesLoading(false)
    }
  }

  const runImport = async (): Promise<void> => {
    if (!importConnection) return
    if (selectedTables.length === 0) {
      message.error('请至少勾选一张表')
      return
    }
    setImporting(true)
    try {
      const result = await window.api.db.importTables(projectId, importConnection.db_id, {
        tables: selectedTables,
        target_parent_id: targetFolder,
        conflict
      })
      if (!result.ok) throw new Error(result.error)
      setImportResult(result.data)
      onModelsChanged?.()
      message.success(
        `导入完成：新建 ${result.data.created}，更新 ${result.data.updated}，跳过 ${result.data.skipped}，副本 ${result.data.copied}`
      )
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: '数据库类型',
      dataIndex: 'type',
      key: 'type',
      width: 140,
      render: (value: string) => <Tag bordered={false} color="blue">{value.toUpperCase()}</Tag>
    },
    { title: '说明', dataIndex: 'remarks', key: 'remarks', ellipsis: true },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, connection: DbConnection) => (
        <Space size={2}>
          <Tooltip title="编辑">
            <button className="icon-btn" onClick={() => openEdit(connection)}>
              <EditOutlined />
            </button>
          </Tooltip>
          <Tooltip title="导入表结构">
            <button className="icon-btn" onClick={() => void openImport(connection)}>
              <CloudDownloadOutlined />
            </button>
          </Tooltip>
          <Tooltip title="删除">
            <button className="icon-btn" onClick={() => remove(connection)}>
              <DeleteOutlined />
            </button>
          </Tooltip>
        </Space>
      )
    }
  ]

  const tableItems = useMemo(
    () =>
      tables.map((table) => ({
        key: table.name,
        name: table.name,
        comment: table.comment,
        columns: table.columns.length
      })),
    [tables]
  )

  return (
    <div className="dict-panel">
      <div className="dict-head">
        <span className="section-title" style={{ margin: 0 }}>
          数据库管理
        </span>
        <span className="dict-note" style={{ margin: 0 }}>
          MySQL 连接仅保存在本地项目；凭据明文存储，不会同步给团队。
        </span>
        <span style={{ flex: 1 }} />
        <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
          刷新
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建
        </Button>
      </div>

      <Table<DbConnection>
        rowKey="db_id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={connections}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无数据库连接，点击右上角「新建」开始"
            />
          )
        }}
      />

      <Modal
        title={editing ? '编辑数据库连接' : '新建数据库连接'}
        open={open}
        onCancel={() => setOpen(false)}
        width={620}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              icon={<LinkOutlined />}
              loading={testing}
              onClick={() => void test()}
            >
              测试连接
            </Button>
            <span style={{ flex: 1 }} />
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" onClick={() => void save()}>
              确定
            </Button>
          </div>
        }
      >
        <Form
          layout="horizontal"
          size="small"
          labelCol={{ flex: '92px' }}
          wrapperCol={{ flex: 'auto' }}
          className="db-compact-form"
        >
          <Form.Item label="名称" required>
            <Input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="连接名称"
            />
          </Form.Item>
          <Form.Item label="说明">
            <Input
              value={draft.remarks}
              onChange={(event) => setDraft({ ...draft, remarks: event.target.value })}
              placeholder="可选"
            />
          </Form.Item>
          <Form.Item label="数据库类型">
            <Select
              value={draft.type}
              options={[{ value: 'mysql', label: 'MySQL' }]}
              disabled
            />
          </Form.Item>
          <Form.Item label="默认配置" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 11 }}>
              本轮仅支持默认配置，不按环境覆盖。
            </span>
          </Form.Item>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'regular',
                label: '常规',
                children: (
                  <div>
                    <Form.Item label="IP/Host" required>
                      <Input
                        aria-label="IP/Host"
                        value={draft.config.default.host}
                        onChange={(event) => patchDefault({ host: event.target.value })}
                        placeholder="127.0.0.1"
                      />
                    </Form.Item>
                    <Form.Item label="端口">
                      <InputNumber
                        min={1}
                        max={65535}
                        style={{ width: '100%' }}
                        placeholder="3306"
                        value={draft.config.default.port}
                        onChange={(value) => patchDefault({ port: Number(value) || 3306 })}
                      />
                    </Form.Item>
                    <Form.Item label="用户名" required>
                      <Input
                        value={draft.config.default.user}
                        onChange={(event) => patchDefault({ user: event.target.value })}
                        placeholder="root"
                      />
                    </Form.Item>
                    <Form.Item label="密码">
                      <Input.Password
                        value={draft.config.default.password}
                        onChange={(event) => patchDefault({ password: event.target.value })}
                        placeholder="密码"
                      />
                    </Form.Item>
                    <Form.Item label="数据库名" required>
                      <Input
                        value={draft.config.default.database}
                        onChange={(event) => patchDefault({ database: event.target.value })}
                        placeholder="database"
                      />
                    </Form.Item>
                  </div>
                )
              },
              {
                key: 'ssh',
                label: 'SSH',
                children: (
                  <div>
                    {draft.ssh.enable === 1 && <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 10 }}
                      message="SSH 隧道后续支持"
                      description="可以保存 SSH 配置；当前版本尚不能建立隧道，请关闭 SSH 后测试连接或读取表结构。"
                    />}
                    <Form.Item label="使用SSH隧道">
                      <Switch
                        aria-label="使用SSH隧道"
                        checked={draft.ssh.enable === 1}
                        onChange={(checked) => patchSsh({ enable: checked ? 1 : -1 })}
                      />
                    </Form.Item>
                    <Form.Item label="Host">
                      <Input
                        aria-label="SSH Host"
                        disabled={draft.ssh.enable !== 1}
                        value={draft.ssh.host}
                        onChange={(event) => patchSsh({ host: event.target.value })}
                      />
                    </Form.Item>
                    <Form.Item label="Port">
                      <InputNumber
                        aria-label="SSH 端口"
                        disabled={draft.ssh.enable !== 1}
                        min={1}
                        max={65535}
                        style={{ width: '100%' }}
                        placeholder="22"
                        value={draft.ssh.port}
                        onChange={(value) => patchSsh({ port: Number(value) || 22 })}
                      />
                    </Form.Item>
                    <Form.Item label="用户名">
                      <Input
                        aria-label="SSH 用户名"
                        disabled={draft.ssh.enable !== 1}
                        value={draft.ssh.username}
                        onChange={(event) => patchSsh({ username: event.target.value })}
                      />
                    </Form.Item>
                    <Form.Item label="验证方法">
                      <Select
                        aria-label="SSH 验证方法"
                        disabled={draft.ssh.enable !== 1}
                        value={draft.ssh.auth_type}
                        onChange={(value: 1 | 2 | 3) => patchSsh({ auth_type: value })}
                        options={[
                          { value: 1, label: '密码' },
                          { value: 2, label: '公钥' },
                          { value: 3, label: '密码与公钥' }
                        ]}
                      />
                    </Form.Item>
                    {draft.ssh.auth_type !== 2 && <Form.Item label="SSH密码"><Input.Password aria-label="SSH密码" disabled={draft.ssh.enable !== 1} value={draft.ssh.password} onChange={event => patchSsh({ password: event.target.value })} /></Form.Item>}
                    {draft.ssh.auth_type !== 1 && <><Form.Item label="私钥">
                      <input ref={keyFile} type="file" aria-label="私钥文件" style={{ display: 'none' }} onChange={async event => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (!file) return
                        if (file.size > 1024 * 1024) { message.error('私钥文件不能超过 1 MB'); return }
                        try { patchSsh({ private_key: await file.text() }) } catch { message.error('读取私钥文件失败') }
                      }} />
                      <Button disabled={draft.ssh.enable !== 1} onClick={() => keyFile.current?.click()}>{draft.ssh.private_key ? '重新选择私钥' : '选择私钥文件'}</Button>
                      {draft.ssh.private_key && <Button type="text" aria-label="清除私钥" disabled={draft.ssh.enable !== 1} onClick={() => patchSsh({ private_key: '' })}>清除</Button>}
                    </Form.Item>
                    <Form.Item label="Passphrase">
                      <Input.Password
                        aria-label="私钥口令"
                        disabled={draft.ssh.enable !== 1}
                        value={draft.ssh.passphrase}
                        onChange={(event) => patchSsh({ passphrase: event.target.value })}
                      />
                    </Form.Item></>}
                  </div>
                )
              }
            ]}
          />

          {testResult ? (
            <Alert
              style={{ marginTop: 12 }}
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              message={testResult.message}
              description={testResult.server_version ? `MySQL ${testResult.server_version}` : undefined}
            />
          ) : null}
        </Form>
      </Modal>

      <Modal
        title={`导入表结构${importConnection ? ` · ${importConnection.name}` : ''}`}
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        width={720}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button icon={<ReloadOutlined />} onClick={() => importConnection && void loadTables(importConnection)}>
              重新读取表
            </Button>
            <span style={{ flex: 1 }} />
            <Button onClick={() => setImportOpen(false)}>关闭</Button>
            <Button type="primary" loading={importing} onClick={() => void runImport()}>
              开始导入
            </Button>
          </div>
        }
      >
        {importConnection?.ssh.enable === 1 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="SSH 隧道后续支持，无法读取表结构"
            description="请先在「常规」中关闭 SSH，或等待后续版本支持隧道。"
          />
        ) : null}

        <div className="dict-head" style={{ padding: 0, marginBottom: 10 }}>
          <Checkbox
            indeterminate={
              selectedTables.length > 0 && selectedTables.length < tableItems.length
            }
            checked={tableItems.length > 0 && selectedTables.length === tableItems.length}
            onChange={(event) =>
              setSelectedTables(event.target.checked ? tableItems.map((item) => item.key) : [])
            }
          >
            全选
          </Checkbox>
          <span className="muted">已选 {selectedTables.length} / {tableItems.length} 张表</span>
          <span style={{ flex: 1 }} />
          <span className="muted">目标目录</span>
          <Select
            value={targetFolder}
            style={{ width: 180 }}
            onChange={setTargetFolder}
            options={[
              { value: '0', label: '根目录' },
              ...folders.map((folder) => ({ value: folder.model_id, label: folder.name }))
            ]}
          />
        </div>

        <div className="db-table-list">
          {tablesLoading ? (
            <div className="muted" style={{ padding: 16 }}>正在读取表结构…</div>
          ) : tableItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无表" />
          ) : (
            tableItems.map((table) => (
              <label key={table.key} className="db-table-row">
                <Checkbox
                  checked={selectedTables.includes(table.key)}
                  onChange={(event) =>
                    setSelectedTables((current) =>
                      event.target.checked
                        ? [...new Set([...current, table.key])]
                        : current.filter((item) => item !== table.key)
                    )
                  }
                />
                <span className="mono">{table.name}</span>
                <span className="muted">{table.comment || '—'}</span>
                <span style={{ flex: 1 }} />
                <span className="muted">{table.columns} 列</span>
              </label>
            ))
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 6 }}>同名模型策略</div>
          <Radio.Group
            value={conflict}
            onChange={(event) => setConflict(event.target.value as ImportConflictStrategy)}
            options={[
              { value: 'update', label: '更新同名模型' },
              { value: 'skip', label: '跳过同名模型' },
              { value: 'copy', label: '创建副本' }
            ]}
          />
        </div>

        {importResult ? (
          <div style={{ marginTop: 14 }}>
            <Alert
              type={importResult.failed > 0 ? 'warning' : 'success'}
              showIcon
              message={`导入结果：新建 ${importResult.created}，更新 ${importResult.updated}，跳过 ${importResult.skipped}，副本 ${importResult.copied}，失败 ${importResult.failed}`}
            />
            <div className="db-import-items">
              {importResult.items.map((item) => (
                <div key={`${item.table}-${item.status}`} className="db-import-item">
                  <span className="mono">{item.table}</span>
                  <Tag bordered={false}>{item.status}</Tag>
                  <span className="muted">{item.model_name ?? item.message ?? ''}</span>
                </div>
              ))}
            </div>
            {importResult.warnings.length > 0 ? (
              <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>
                {importResult.warnings.map((warning) => (
                  <div key={warning}>· {warning}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
