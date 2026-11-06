import { useEffect, useState } from 'react'
import { Alert, App as AntApp, Button, Empty, Form, Input, Select, Space, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { AgentConnection, AgentConnectionInput } from '@shared/agent'
import type { Result } from '@shared/types'
import { useApp } from '../store'

function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data }

/** Connection management lives inside the Agent panel; the conversation header only shows the active connection. */
export default function AgentConnectionSettings({ onClose }: { onClose?: () => void }): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const project = useApp(state => state.project)
  const [connections, setConnections] = useState<AgentConnection[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const [error, setError] = useState('')
  const [form] = Form.useForm<AgentConnectionInput>()
  const editing = connections.find(item => item.connection_id === editingId) ?? null

  function edit(config: AgentConnection | null): void {
    setEditingId(config?.connection_id ?? null)
    form.resetFields()
    form.setFieldsValue({ name: config?.name ?? '模型连接', base_url: config?.base_url ?? '', model: config?.model ?? '', protocol: config?.protocol ?? 'chat-completions', api_key: undefined })
  }
  useEffect(() => {
    let mounted = true
    Promise.all([window.api.agent.listConnections(), project ? window.api.agent.getProjectConnection(project.project_id) : Promise.resolve({ ok: true, data: null } as const)]).then(([all, preferred]) => {
      if (!mounted) return
      const list = unwrap(all)
      const current = unwrap(preferred as Result<AgentConnection | null>)
      setConnections(list)
      setDefaultId(current?.connection_id ?? null)
      edit(current ?? list[0] ?? null)
    }).catch(e => mounted && setError((e as Error).message))
    return () => { mounted = false }
  }, [project?.project_id])
  async function reload(preferredId?: string | null): Promise<void> {
    const list = unwrap(await window.api.agent.listConnections())
    setConnections(list)
    const target = preferredId === undefined ? editingId : preferredId
    const next = list.find(item => item.connection_id === target) ?? list[0] ?? null
    edit(next)
  }
  async function save(): Promise<void> {
    setError('')
    try {
      const values = await form.validateFields()
      setBusy(true)
      // A blank field preserves an existing secret.
      if (!values.api_key) delete values.api_key
      const saved = unwrap(await (editingId ? window.api.agent.saveConnection(values, editingId) : window.api.agent.createConnection(values)))
      if (project && !defaultId) { unwrap(await window.api.agent.setProjectConnection(project.project_id, saved.connection_id)); setDefaultId(saved.connection_id) }
      await reload(saved.connection_id)
      setTestMessage('')
      message.success('连接已保存')
    } catch (e) { if (e instanceof Error) setError(e.message) }
    finally { setBusy(false) }
  }
  async function test(): Promise<void> {
    if (!editingId) return
    setTesting(true); setTestMessage(''); setError('')
    try {
      const result = unwrap(await window.api.agent.testConnection(editingId))
      setTestMessage(result.message)
      await reload(editingId)
    } catch (e) { setError((e as Error).message) }
    finally { setTesting(false) }
  }
  async function setDefault(): Promise<void> {
    if (!project || !editingId) return
    try {
      unwrap(await window.api.agent.setProjectConnection(project.project_id, editingId))
      setDefaultId(editingId)
      message.success('项目默认连接已更新')
    } catch (e) { setError((e as Error).message) }
  }
  function remove(): void {
    if (!editingId) return
    modal.confirm({ title: '删除这个模型连接？', content: '已开始的任务继续使用原配置；引用此连接的项目需要重新选择。', okText: '确认删除', cancelText: '取消', onOk: async () => {
      unwrap(await window.api.agent.deleteConnection(editingId))
      if (defaultId === editingId) setDefaultId(null)
      await reload(null)
    } })
  }
  return <div className="agent-dock-subview-content agent-connection-settings" id="agent-connections">
    <div className="agent-dock-subview-title">
      <Typography.Title level={5}>Agent 模型连接</Typography.Title>
      {onClose && <Button size="small" aria-label="返回对话" icon={<ArrowLeftOutlined />} onClick={onClose}>返回对话</Button>}
    </div>
    <div className="agent-connection-scroll">
      <Typography.Paragraph type="secondary">
        模型连接仅保存在本机凭据存储；新增、编辑、测试和删除在此管理。
      </Typography.Paragraph>
      {!project && <Alert type="info" message="请先选择项目，才能设置项目默认连接。" />}
      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} style={{ marginBottom: 12 }} />}
      {testMessage && <Alert type="success" showIcon message={testMessage} style={{ marginBottom: 12 }} />}
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label="管理模型连接" style={{ minWidth: 220 }} placeholder="选择或新增连接" value={editingId ?? undefined} options={connections.map(item => ({ value: item.connection_id, label: item.name }))} onChange={id => { setTestMessage(''); edit(connections.find(item => item.connection_id === id) ?? null) }} />
        <Button icon={<PlusOutlined />} onClick={() => { setTestMessage(''); edit(null) }}>新增连接</Button>
        <Button icon={<ThunderboltOutlined />} onClick={() => void test()} loading={testing} disabled={!editingId}>测试连接</Button>
        <Button onClick={() => void setDefault()} disabled={!project || !editingId || defaultId === editingId}>设为项目默认</Button>
        {editing && defaultId === editing.connection_id && <Tag color="success">项目默认</Tag>}
      </Space>
      {!connections.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置模型连接" style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" style={{ width: '100%' }}>
        <Form.Item name="name" label="连接名称"><Input /></Form.Item>
        <Form.Item name="base_url" label="API 地址" rules={[{ required: true, message: '请输入 API 地址' }]} extra="填写兼容服务的基础地址，例如 https://example.com/v1"><Input placeholder="https://example.com/v1" /></Form.Item>
        <Form.Item name="model" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]}><Input /></Form.Item>
        <Form.Item name="protocol" label="协议"><Select options={[{ label: 'Chat Completions', value: 'chat-completions' }, { label: 'Responses', value: 'responses' }]} /></Form.Item>
        <Form.Item name="api_key" label="API Key" extra={editing?.has_key ? 'Key 已安全保存；留空保留。' : 'Key 由系统凭据存储保护，本机无明文配置。'}><Input.Password autoComplete="new-password" /></Form.Item>
      </Form>
    </div>
    <div className="agent-connection-footer">
      {editingId && <Button danger aria-label="删除连接" icon={<DeleteOutlined />} onClick={remove}>删除连接</Button>}
      <Button type="primary" aria-label="保存连接" loading={busy} onClick={() => void save()}>保存连接</Button>
    </div>
  </div>
}
