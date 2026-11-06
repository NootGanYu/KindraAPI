import { useEffect, useRef, useState } from 'react'
import { Alert, App as AntApp, Button, Dropdown, Empty, Input, Select, Space, Tooltip, Typography } from 'antd'
import { AppstoreOutlined, CloseOutlined, DeleteOutlined, DownOutlined, HistoryOutlined, PlusOutlined, SendOutlined, SettingOutlined, UndoOutlined } from '@ant-design/icons'
import type { AgentConnection, AgentConversation } from '@shared/agent'
import type { AgentPermissionMode } from '@shared/agentPlan'
import type { Result } from '@shared/types'
import { flushAgentDrafts } from '../agentDraftSync'
import { useApp } from '../store'
import AgentConnectionSettings from './AgentConnectionSettings'
import AgentPlanPanel from './AgentPlanPanel'
import AgentProjectCandidates from './AgentProjectCandidates'
import AgentTimeline from './AgentTimeline'
import AgentTurnUndoPanel from './AgentTurnUndoPanel'

function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data }

const permissionOptions: Array<{ value: AgentPermissionMode; label: string; description: string }> = [
  { value: 'ask', label: '询问权限', description: '仅全只读计划自动执行；任何修改、执行、保存、新建或额外副作用都需要批准。' },
  { value: 'auto', label: '自动模式', description: '只读、草稿提议与本地候选采纳自动执行；执行、保存、新建和额外副作用仍需批准。不能保证绝对安全。' },
  { value: 'bypass', label: '跳过权限', description: '所有计划步骤自动批准，包括真实网络执行、正式保存与新建对象。高风险。' }
]

export default function AgentConversationPanel({ projectId, projectName, open, onClose }: {
  projectId: string
  projectName: string
  open: boolean
  onClose: () => void
}): JSX.Element {
  const { modal } = AntApp.useApp()
  const [connection, setConnection] = useState<AgentConnection | null>(null)
  const [connections, setConnections] = useState<AgentConnection[]>([])
  const [connectionError, setConnectionError] = useState('')
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>('ask')
  const [legacyPlanMode, setLegacyPlanMode] = useState(() => localStorage.getItem('kindra.agent.legacyPlanMode') === '1')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const canceledRename = useRef(false)
  const [view, setView] = useState<'chat' | 'undo' | 'candidates' | 'settings' | 'plans'>('chat')
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const conversation = conversations.find(item => item.conversation_id === selected)
  const running = conversation?.status === 'running'

  useEffect(() => {
    let mounted = true
    const off = window.api.agent.onChanged(event => {
      if (event.project_id !== projectId) return
      if (event.records_deleted) { setSelected(null); setConversations([]); return }
      setConversations(previous => {
        const other = previous.filter(item => item.conversation_id !== event.conversation_id)
        return event.conversation ? [event.conversation, ...other] : other
      })
    })
    window.api.agent.listConversations(projectId).then(result => {
      if (!mounted) return
      const items = unwrap(result)
      setConversations(items)
      setSelected(current => current && items.some(item => item.conversation_id === current) ? current : items[0]?.conversation_id ?? null)
    }).catch(e => mounted && setError(e.message))
    return () => { mounted = false; off() }
  }, [projectId])
  useEffect(() => {
    if (!open) return
    let mounted = true
    setConnectionError('')
    Promise.all([window.api.agent.listConnections(), window.api.agent.getProjectConnection(projectId)]).then(([all, preferred]) => {
      if (!mounted) return
      try {
        const list = unwrap(all)
        const fallback = unwrap(preferred)
        setConnections(list)
        setConnection(current => list.find(item => item.connection_id === current?.connection_id) ?? fallback ?? null)
      } catch (e) { setConnection(null); setConnectionError((e as Error).message) }
    }).catch(e => mounted && setConnectionError(e.message))
    return () => { mounted = false }
  }, [open, projectId])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [conversation?.messages, open])

  function requestPermissionMode(next: AgentPermissionMode): void {
    if (next === 'ask') { setPermissionMode('ask'); return }
    const bypass = next === 'bypass'
    modal.confirm({
      title: bypass ? '启用跳过权限？' : '启用自动模式？',
      content: bypass
        ? '所有计划步骤将自动批准，包括真实网络执行、正式保存、新建对象与额外副作用。跳过权限仍受项目与对象范围、脱敏和无任意文件系统限制，但属于高风险操作。'
        : '自动模式会自动执行只读读取、草稿提议与本地候选采纳；真实网络执行、保存、新建与额外副作用仍需批准。自动模式不能保证绝对安全。',
      okText: bypass ? '仍要启用' : '启用自动模式',
      okButtonProps: bypass ? { danger: true } : undefined,
      cancelText: '取消',
      onOk: () => setPermissionMode(next)
    })
  }
  async function create(): Promise<AgentConversation> {
    const created = unwrap(await window.api.agent.createConversation(projectId))
    setSelected(created.conversation_id)
    setConversations(previous => [created, ...previous.filter(item => item.conversation_id !== created.conversation_id)])
    return created
  }
  async function respondApproval(activityId: string, decision: 'approved' | 'denied'): Promise<void> {
    if (!conversation) return
    setError('')
    try {
      unwrap(await window.api.agent.respondToolApproval(projectId, conversation.conversation_id, activityId, decision))
    } catch (e) { setError((e as Error).message) }
  }
  async function send(): Promise<void> {
    if (!text.trim() || busy || running) return
    setBusy(true); setError('')
    try {
      await flushAgentDrafts()
      if (connection?.capability === 'tools' && legacyPlanMode) {
        unwrap(await window.api.agent.proposeTaskPlan(projectId, {
          goal: text,
          selection: 'auto',
          permission_mode: permissionMode,
          activeTargetId: useApp.getState().activeId ?? undefined,
          connectionId: connection.connection_id
        }))
      } else {
        const current = conversation ?? await create()
        unwrap(await window.api.agent.sendMessage(projectId, current.conversation_id, text, connection?.connection_id, {
          activeTargetId: useApp.getState().activeId ?? undefined,
          permissionMode
        }))
      }
      setText('')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  function remove(): void {
    if (!conversation) return
    modal.confirm({ title: '删除这段本机会话？', content: '对话记录将从本机删除。', okText: '确认删除', cancelText: '取消', onOk: async () => {
      unwrap(await window.api.agent.deleteConversation(projectId, conversation.conversation_id))
      setSelected(null)
    } })
  }
  async function newConversation(): Promise<void> {
    try { await create() } catch (e) { setError((e as Error).message) }
  }
  function selectConnection(id: string): void { setConnection(connections.find(item => item.connection_id === id) ?? null) }
  async function refreshConnections(): Promise<void> {
    try {
      const [all, preferred] = await Promise.all([window.api.agent.listConnections(), window.api.agent.getProjectConnection(projectId)])
      const list = unwrap(all)
      const fallback = unwrap(preferred)
      setConnections(list)
      setConnection(current => list.find(item => item.connection_id === current?.connection_id) ?? fallback ?? null)
    } catch (e) { setConnectionError((e as Error).message) }
  }
  function closeSettings(): void { setView('chat'); void refreshConnections() }
  function startRename(): void {
    if (!conversation) return
    canceledRename.current = false
    setTitleDraft(conversation.title)
    setRenaming(true)
  }
  async function commitRename(): Promise<void> {
    setRenaming(false)
    if (canceledRename.current) { canceledRename.current = false; return }
    if (!conversation) return
    const next = titleDraft.trim()
    if (!next) { setError('会话名称不能为空'); return }
    if (next === conversation.title) return
    try {
      unwrap(await window.api.agent.renameConversation(projectId, conversation.conversation_id, next))
    } catch (e) { setError((e as Error).message) }
  }

  return <div className="agent-dock-panel">
    <header className="agent-dock-header">
      <div className="agent-dock-controls">
        <Typography.Text type="secondary" className="agent-dock-project">{projectName}</Typography.Text>
        {conversation
          ? renaming
            ? <Input
                className="agent-session-title-input"
                size="small"
                autoFocus
                value={titleDraft}
                maxLength={100}
                onChange={event => setTitleDraft(event.target.value)}
                onPressEnter={event => event.currentTarget.blur()}
                onBlur={() => void commitRename()}
                onKeyDown={event => { if (event.key === 'Escape') { canceledRename.current = true; event.currentTarget.blur() } }}
              />
            : <button type="button" className="agent-session-title" onClick={startRename} title="点击修改会话名称">{conversation.title}</button>
          : <Typography.Text type="secondary" className="agent-session-title">暂无会话</Typography.Text>}
        <Dropdown trigger={['click']} menu={{ items: conversations.length ? conversations.map(item => ({ key: item.conversation_id, label: item.title })) : [{ key: 'none', label: '暂无会话', disabled: true }], onClick: ({ key }) => { if (key !== 'none') setSelected(key) } }}>
          <Button type="text" size="small" aria-label="切换会话" icon={<DownOutlined />} />
        </Dropdown>
        <Tooltip title="新建会话"><Button size="small" aria-label="新建会话" icon={<PlusOutlined />} onClick={() => void newConversation()} /></Tooltip>
        <Tooltip title="删除会话"><Button size="small" aria-label="删除会话" icon={<DeleteOutlined />} disabled={!conversation || running} onClick={remove} /></Tooltip>
      </div>
      <Space wrap size={8}>
        <Tooltip title="整轮撤销与记录"><Button size="small" type={view === 'undo' ? 'primary' : 'default'} aria-label="整轮撤销与记录" icon={<UndoOutlined />} onClick={() => setView(view === 'undo' ? 'chat' : 'undo')} /></Tooltip>
        <Tooltip title="项目候选汇总"><Button size="small" type={view === 'candidates' ? 'primary' : 'default'} aria-label="项目候选汇总" icon={<AppstoreOutlined />} onClick={() => setView(view === 'candidates' ? 'chat' : 'candidates')} /></Tooltip>
        <Tooltip title="旧计划记录（legacy）"><Button size="small" type={view === 'plans' ? 'primary' : 'default'} aria-label="旧计划记录" icon={<HistoryOutlined />} onClick={() => setView(view === 'plans' ? 'chat' : 'plans')} /></Tooltip>
        <Tooltip title="Agent 设置"><Button size="small" type={view === 'settings' ? 'primary' : 'default'} aria-label="Agent 设置" icon={<SettingOutlined />} onClick={() => setView(view === 'settings' ? 'chat' : 'settings')} /></Tooltip>
        <Tooltip title="收起面板"><Button size="small" aria-label="收起面板" icon={<CloseOutlined />} onClick={onClose} /></Tooltip>
      </Space>
    </header>
    {connectionError && <Alert type="error" showIcon message={connectionError} />}
    {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />}
    {connection?.capability === 'text-only' && <Alert type="info" message="仅文本对话；自然语言计划与工具操作不可用。" />}
    {connection?.capability === 'unchecked' && <Alert type="info" message="尚未检测工具能力。可在设置页测试连接；当前仅进行文本对话。" />}
    {!connection && <Alert type="warning" showIcon message="请先配置 Agent 模型连接。" action={<Button size="small" onClick={() => setView('settings')}>去设置</Button>} />}
    {running && conversation?.connection && <Typography.Text type="secondary" className="agent-fixed-connection">本轮固定连接：{conversation.connection.name} · {conversation.connection.model}</Typography.Text>}
    {view === 'chat' ? <>
      <div className="agent-messages" role="log" aria-label="Agent 会话消息">
        {!conversation?.messages.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="用一句话告诉 Agent 要做什么"><Typography.Text type="secondary">Agent 会连续读取项目对象，把每次工具调用展示在时间线上；只读工具自动执行，本机草稿修改按权限模式等待允许。</Typography.Text></Empty>}
        {conversation && <AgentTimeline conversation={conversation} onApproval={(activityId, decision) => void respondApproval(activityId, decision)} />}
        {legacyPlanMode && <AgentPlanPanel projectId={projectId} />}
        {conversation?.error && <Alert type="warning" message={conversation.error} />}
        {conversation?.status === 'interrupted' && <Alert type="info" message="上次回复已中断。你可以继续发消息，不会自动重发。" />}
        <div ref={end} />
      </div>
      <div className="agent-compose">
        <Input.TextArea aria-label="告诉 Agent 要做什么" value={text} onChange={event => setText(event.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} placeholder={connection?.capability === 'tools' ? '例如：读取订单接口与相关 Flow，汇总请求参数和最近运行结果' : '输入消息…'} maxLength={100000} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
        <div className="agent-compose-bar">
          <Space size={4} wrap={false}>
            <Select aria-label="权限模式" size="small" variant="borderless" value={permissionMode} onChange={requestPermissionMode} options={permissionOptions.map(option => ({ value: option.value, label: option.label }))} style={{ minWidth: 88 }} />
            <Select aria-label="模型连接" size="small" variant="borderless" value={connection?.connection_id} onChange={selectConnection} options={connections.map(item => ({ value: item.connection_id, label: `${item.name} · ${item.model}` }))} placeholder={connections.length ? '选择模型连接' : '未配置模型连接'} style={{ maxWidth: 190, minWidth: 0 }} />
            <Tooltip title="旧计划模式：先用待批准计划再执行（legacy）"><Button size="small" type={legacyPlanMode ? 'primary' : 'text'} aria-label="旧计划模式" aria-pressed={legacyPlanMode} onClick={() => setLegacyPlanMode(value => { localStorage.setItem('kindra.agent.legacyPlanMode', value ? '0' : '1'); return !value })}>旧计划</Button></Tooltip>
          </Space>
          <Space size={8}>
            {running ? <Button onClick={() => void window.api.agent.cancelMessage(projectId, conversation!.conversation_id).then(unwrap).catch(e => setError(e.message))}>停止回复</Button> : <Button type="primary" icon={<SendOutlined />} disabled={!connection || !text.trim()} loading={busy} onClick={() => void send()}>发送</Button>}
          </Space>
        </div>
      </div>
    </> : view === 'settings' ? <div className="agent-dock-subview">
      <AgentConnectionSettings onClose={closeSettings} />
    </div> : <div className="agent-dock-subview">
      {view === 'undo'
        ? <AgentTurnUndoPanel projectId={projectId} inline onClose={() => setView('chat')} />
        : view === 'plans'
          ? <AgentPlanPanel projectId={projectId} />
          : <AgentProjectCandidates projectId={projectId} inline onClose={() => setView('chat')} />}
    </div>}
  </div>
}
