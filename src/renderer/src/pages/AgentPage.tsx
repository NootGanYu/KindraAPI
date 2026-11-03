import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Empty, Form, Input, Modal, Select, Space, Tag, Typography } from 'antd'
import { MessageOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons'
import type { AgentConnection, AgentConnectionInput, AgentConversation } from '@shared/agent'
import type { Result } from '@shared/types'
import { useApp } from '../store'
import './agent.css'

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}
export default function AgentPage(): JSX.Element {
  const project = useApp(state => state.project)
  // Changing projects creates a fresh view; tasks and records remain in the main process.
  return project ? <ProjectAgent key={project.project_id} projectId={project.project_id} projectName={project.name} /> : <Empty description="请先选择项目" />
}
function ProjectAgent({ projectId, projectName }: { projectId: string; projectName: string }): JSX.Element {
  const { message, modal } = App.useApp()
  const [connection, setConnection] = useState<AgentConnection | null>(null)
  const [connections, setConnections] = useState<AgentConnection[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const [error, setError] = useState('')
  const [form] = Form.useForm<AgentConnectionInput>()
  const end = useRef<HTMLDivElement>(null)
  const conversation = conversations.find(item => item.conversation_id === selected)
  const running = conversation?.status === 'running'

  useEffect(() => {
    let mounted = true
    const off = window.api.agent.onChanged(event => {
      if (event.project_id !== projectId) return
      setConversations(previous => {
        const other = previous.filter(item => item.conversation_id !== event.conversation_id)
        return event.conversation ? [event.conversation, ...other] : other
      })
    })
    Promise.all([window.api.agent.getProjectConnection(projectId), window.api.agent.listConversations(projectId), window.api.agent.listConnections()]).then(([config, list, all]) => {
      if (!mounted) return
      const preferred = unwrap(config)
      setConnection(preferred); setDefaultId(preferred?.connection_id ?? null); setConnections(unwrap(all))
      const items = unwrap(list); setConversations(items); setSelected(items[0]?.conversation_id ?? null)
    }).catch(error => mounted && setError(error.message))
    return () => { mounted = false; off() }
  }, [projectId])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [conversation?.messages])
  function openConfig(config: AgentConnection | null = connection): void {
    setEditingId(config?.connection_id ?? null)
    form.resetFields()
    form.setFieldsValue({ name: config?.name ?? '模型连接', base_url: config?.base_url ?? '', model: config?.model ?? '', protocol: config?.protocol ?? 'chat-completions', api_key: undefined })
    setConfigOpen(true)
  }
  async function saveConfig(): Promise<void> {
    try {
      const values = await form.validateFields()
      setBusy(true)
      // A blank field preserves an existing secret.
      if (!values.api_key) delete values.api_key
      const saved = unwrap(await (editingId ? window.api.agent.saveConnection(values, editingId) : window.api.agent.createConnection(values)))
      if (!defaultId) { unwrap(await window.api.agent.setProjectConnection(projectId, saved.connection_id)); setDefaultId(saved.connection_id) }
      setConnections(unwrap(await window.api.agent.listConnections()))
      setConnection(saved); setConfigOpen(false); form.resetFields(); setTestMessage(''); setError('')
      message.success('连接已保存')
    } catch (error) { if (error instanceof Error) setError(error.message) }
    finally { setBusy(false) }
  }
  async function test(): Promise<void> {
    setTesting(true); setTestMessage(''); setError('')
    try {
      const result = unwrap(await window.api.agent.testConnection(connection!.connection_id))
      setTestMessage(result.message)
      setConnection(unwrap(await window.api.agent.getConnection(connection!.connection_id)))
      setConnections(unwrap(await window.api.agent.listConnections()))
    } catch (error) { setError((error as Error).message) }
    finally { setTesting(false) }
  }
  async function create(): Promise<AgentConversation> {
    const created = unwrap(await window.api.agent.createConversation(projectId))
    setSelected(created.conversation_id)
    setConversations(previous => [created, ...previous.filter(item => item.conversation_id !== created.conversation_id)])
    return created
  }
  async function send(): Promise<void> {
    if (!text.trim() || busy || running) return
    setBusy(true); setError('')
    try {
      const current = conversation ?? await create()
      unwrap(await window.api.agent.sendMessage(projectId, current.conversation_id, text, connection?.connection_id))
      setText('')
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  async function setDefault(): Promise<void> {
    if (!connection) return
    try { unwrap(await window.api.agent.setProjectConnection(projectId, connection.connection_id)); setDefaultId(connection.connection_id); message.success('项目默认连接已更新') }
    catch (error) { setError((error as Error).message) }
  }
  function removeConnection(): void {
    if (!editingId) return
    modal.confirm({ title: '删除这个模型连接？', content: '已开始的任务继续使用原配置；引用此连接的项目需要重新选择。', okText: '确认删除', cancelText: '取消', onOk: async () => {
      unwrap(await window.api.agent.deleteConnection(editingId))
      setConnections(unwrap(await window.api.agent.listConnections()))
      if (connection?.connection_id === editingId) setConnection(null)
      if (defaultId === editingId) setDefaultId(null)
      setConfigOpen(false); form.resetFields()
    } })
  }
  function remove(): void {
    if (!conversation) return
    modal.confirm({ title: '删除这段本机会话？', content: '对话记录将从本机删除。', okText: '确认删除', cancelText: '取消', onOk: async () => {
      unwrap(await window.api.agent.deleteConversation(projectId, conversation.conversation_id))
      setSelected(null)
    } })
  }
  return <div className="agent-page">
    <aside className="agent-sidebar">
      <Typography.Title level={4}>项目 Agent</Typography.Title>
      <Typography.Text type="secondary">{projectName}</Typography.Text>
      <Button icon={<PlusOutlined />} onClick={() => void create().catch(error => setError(error.message))}>新建会话</Button>
      <div className="agent-session-list">{conversations.map(item => <button key={item.conversation_id} className={`agent-session${selected === item.conversation_id ? ' selected' : ''}`} onClick={() => setSelected(item.conversation_id)}>
        <MessageOutlined /> <span>{item.title}</span>{item.status === 'running' && <Tag color="processing">回复中</Tag>}
      </button>)}</div>
      <Typography.Text type="secondary">会话只保存在本机，按项目区分。</Typography.Text>
    </aside>
    <section className="agent-chat">
      <header className="agent-toolbar"><div><Typography.Title level={4}>Agent 对话</Typography.Title>
        <Typography.Text type="secondary">{connection ? `${connection.name} · ${connection.model}` : '配置模型后开始对话'}</Typography.Text></div>
        <Space><Button icon={<SettingOutlined />} onClick={() => openConfig()}>配置模型</Button><Button onClick={() => void test()} loading={testing} disabled={!connection}>测试连接</Button><Button onClick={remove} disabled={!conversation || running}>删除会话</Button></Space>
      </header>
      <Space wrap style={{ padding: '0 20px' }}>
        <Select aria-label="本轮模型连接" placeholder="请选择本轮模型连接" style={{ minWidth: 240 }} value={connection?.connection_id} options={connections.map(item => ({ value: item.connection_id, label: `${item.name} · ${item.model}` }))} onChange={id => { setConnection(connections.find(item => item.connection_id === id) ?? null); setTestMessage('') }} />
        <Button disabled={!connection || defaultId === connection.connection_id} onClick={() => void setDefault()}>设为项目默认</Button>
        {connection && defaultId === connection.connection_id && <Tag>项目默认</Tag>}
      </Space>
      {running && conversation.connection && <Alert type="info" message={`本轮固定连接：${conversation.connection.name} · ${conversation.connection.model}；修改配置不影响本轮。`} />}
      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />}
      {testMessage && <Alert type="success" showIcon message={testMessage} />}
      {connection?.capability === 'text-only' && <Alert type="info" message="仅文本对话；连续工具操作不可用" />}
      {connection?.capability === 'unchecked' && <Alert type="info" message="尚未检测工具能力。可进行文本对话。" />}
      <div className="agent-messages" role="log" aria-label="Agent 会话消息">
        {!conversation?.messages.length && <Empty description="开始项目对话"><Typography.Text type="secondary">描述你的问题。当前对话仅发送你输入的消息。</Typography.Text></Empty>}
        {conversation?.messages.map(item => <article key={item.message_id} className={`agent-message ${item.role}`}>
          <Typography.Text strong>{item.role === 'user' ? '你' : 'Agent'}</Typography.Text>
          <div className="agent-message-text">{item.content || (item.status === 'streaming' ? '正在回复…' : '未收到回复')}</div>
          {item.status === 'interrupted' && <Tag>已中断</Tag>}
          {item.status === 'error' && <Tag color="error">回复失败</Tag>}
        </article>)}
        {conversation?.error && <Alert type="warning" message={conversation.error} />}
        {conversation?.status === 'interrupted' && <Alert type="info" message="上次回复已中断。你可以继续发消息，不会自动重发。" />}
        <div ref={end} />
      </div>
      <div className="agent-compose"><Input.TextArea aria-label="发送给 Agent 的消息" value={text} onChange={event => setText(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="输入消息…" maxLength={100000} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send() } }} />
        <Space><Typography.Text type="secondary">⌘ / Ctrl + Enter 发送</Typography.Text>{running ? <Button onClick={() => void window.api.agent.cancelMessage(projectId, conversation!.conversation_id).then(unwrap).catch(error => setError(error.message))}>停止回复</Button> : <Button type="primary" disabled={!connection || !text.trim()} loading={busy} onClick={() => void send()}>发送</Button>}</Space>
      </div>
    </section>
    <Modal title="配置模型连接" open={configOpen} onCancel={() => { setConfigOpen(false); form.resetFields() }} footer={<Space>{editingId && <Button danger onClick={removeConnection}>删除连接</Button>}<Button type="primary" loading={busy} onClick={() => void saveConfig()}>保存连接</Button></Space>}>
      <Space style={{ marginBottom: 16 }}>
        <Select aria-label="管理模型连接" style={{ minWidth: 200 }} placeholder="新连接" value={editingId ?? undefined} options={connections.map(item => ({ value: item.connection_id, label: item.name }))} onChange={id => openConfig(connections.find(item => item.connection_id === id) ?? null)} />
        <Button onClick={() => openConfig(null)}>新增连接</Button>
      </Space>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="连接名称"><Input /></Form.Item>
        <Form.Item name="base_url" label="API 地址" rules={[{ required: true, message: '请输入 API 地址' }]} extra="填写兼容服务的基础地址，例如 https://example.com/v1"><Input placeholder="https://example.com/v1" /></Form.Item>
        <Form.Item name="model" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]}><Input /></Form.Item>
        <Form.Item name="protocol" label="协议"><Select options={[{ label: 'Chat Completions', value: 'chat-completions' }]} /></Form.Item>
        <Form.Item name="api_key" label="API Key" extra={connections.find(item => item.connection_id === editingId)?.has_key ? 'Key 已安全保存；留空保留。' : 'Key 由系统凭据存储保护，本机无明文配置。'}><Input.Password autoComplete="new-password" /></Form.Item>
      </Form>
    </Modal>
  </div>
}
