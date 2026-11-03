import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntApp,
  Button,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip
} from 'antd'
import {
  DeleteOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined
} from '@ant-design/icons'
import type {
  Flow,
  FlowAssertion,
  FlowEvent,
  FlowEventResult,
  FlowEventType,
  FlowRun,
  FlowRunSummary,
  TargetSummary
} from '@shared/types'
import { createFlowAssertion, createFlowEvent } from '@shared/factories'
import { useApp } from '../store'

const TYPE_LABEL: Record<FlowEventType, string> = {
  api: '接口',
  request: '请求',
  script: '脚本',
  assert: '断言',
  if: '条件',
  wait: '等待',
  begin: '分组',
  loop: '循环'
}

const ADD_TYPES: FlowEventType[] = ['api', 'request', 'script', 'assert', 'wait', 'if', 'begin', 'loop']

function updateEventInTree(events: FlowEvent[], id: string, patch: Partial<FlowEvent>): FlowEvent[] {
  return events.map((event) => {
    if (event.event_id === id) return { ...event, ...patch }
    if (event.children?.length) {
      return { ...event, children: updateEventInTree(event.children, id, patch) }
    }
    return event
  })
}

function removeEventFromTree(events: FlowEvent[], id: string): FlowEvent[] {
  return events
    .filter((event) => event.event_id !== id)
    .map((event) =>
      event.children?.length
        ? { ...event, children: removeEventFromTree(event.children, id) }
        : event
    )
}

function addChildToTree(events: FlowEvent[], parentId: string, child: FlowEvent): FlowEvent[] {
  return events.map((event) => {
    if (event.event_id === parentId) {
      return { ...event, children: [...(event.children ?? []), child] }
    }
    if (event.children?.length) {
      return { ...event, children: addChildToTree(event.children, parentId, child) }
    }
    return event
  })
}

function makeEvent(type: FlowEventType, targets: TargetSummary[]): FlowEvent {
  const event = createFlowEvent(type)
  if (type === 'api') event.target_id = targets[0]?.target_id
  return event
}

function countRun(events: FlowEventResult[]): { passed: number; failed: number; skipped: number } {
  const acc = { passed: 0, failed: 0, skipped: 0 }
  const walk = (list: FlowEventResult[]): void => {
    for (const item of list) {
      if (item.status === 'passed') acc.passed += 1
      else if (item.status === 'failed') acc.failed += 1
      else acc.skipped += 1
      if (item.children?.length) walk(item.children)
    }
  }
  walk(events)
  return acc
}

export default function AutomationPage(): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const project = useApp((s) => s.project)
  const targets = useApp((s) => s.targets)
  const environments = useApp((s) => s.environments)
  const currentEnvId = useApp((s) => s.currentEnvId)

  const [flows, setFlows] = useState<Flow[]>([])
  const [flow, setFlow] = useState<Flow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [runs, setRuns] = useState<FlowRunSummary[]>([])
  const [run, setRun] = useState<FlowRun | null>(null)
  const [envId, setEnvId] = useState('')
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const running = starting || run?.status === 'running'
  const selection = useRef('')
  selection.current = `${project?.project_id ?? ''}/${flow?.flow_id ?? ''}`

  const apiTargets = useMemo(
    () => targets.filter((target) => target.target_type === 'api'),
    [targets]
  )

  const reloadRuns = async (flowId: string): Promise<void> => {
    if (!project) return
    const result = await window.api.flows.runs(project.project_id, 50)
    if (result.ok) setRuns(result.data.filter((item) => item.flow_id === flowId))
  }

  const loadFlow = async (flowId: string): Promise<void> => {
    if (!project) return
    const result = await window.api.flows.get(project.project_id, flowId)
    if (!result.ok || !result.data) {
      message.error(result.ok ? '流程不存在' : result.error)
      return
    }
    setFlow(result.data)
    setDirty(false)
    setRun(null)
    setEnvId(result.data.env_id || currentEnvId || environments[0]?.env_id || '')
    await reloadRuns(flowId)
  }

  const reloadFlows = async (preferredId?: string): Promise<void> => {
    if (!project) return
    const result = await window.api.flows.list(project.project_id)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    setFlows(result.data)
    const nextId =
      preferredId ??
      result.data.find((item) => item.flow_id === flow?.flow_id)?.flow_id ??
      result.data[0]?.flow_id
    if (nextId) await loadFlow(nextId)
    else {
      setFlow(null)
      setRun(null)
      setRuns([])
    }
  }

  useEffect(() => {
    if (!project) return
    void reloadFlows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.project_id])

  useEffect(() => {
    if (!project || !run || run.status !== 'running') return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const projectId = project.project_id
    const runId = run.run_id
    const poll = async (): Promise<void> => {
      const result = await window.api.flows.getRun(projectId, runId)
      if (stopped) return
      if (result.ok && result.data) {
        setRun(result.data)
        if (result.data.status !== 'running') {
          await reloadRuns(result.data.flow_id)
          return
        }
      }
      timer = setTimeout(() => void poll(), 300)
    }
    void poll()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [project?.project_id, run?.run_id, run?.status])

  const patchFlow = (patch: Partial<Flow>): void => {
    setFlow((current) => (current ? { ...current, ...patch } : current))
    setDirty(true)
  }

  const createFlow = async (): Promise<void> => {
    if (!project) return
    const result = await window.api.flows.create(project.project_id, '新建流程')
    if (!result.ok) {
      message.error(result.error)
      return
    }
    await reloadFlows(result.data.flow_id)
    message.success('流程已创建')
  }

  const saveFlow = async (notify = true): Promise<boolean> => {
    if (!project || !flow) return false
    setSaving(true)
    try {
      const result = await window.api.flows.save(project.project_id, { ...flow, env_id: envId }, flow.revision ?? '')
      if (!result.ok) {
        message.error(result.error)
        return false
      }
      setFlow(result.data)
      setDirty(false)
      setFlows((current) =>
        current.map((item) =>
          item.flow_id === result.data.flow_id ? result.data : item
        )
      )
      await reloadRuns(result.data.flow_id)
      if (notify) message.success('流程已保存')
      return true
    } finally {
      setSaving(false)
    }
  }

  const executeFlow = async (): Promise<void> => {
    if (!project || !flow) return
    if (dirty) {
      message.warning('请先主动保存流程，再运行')
      return
    }
    const selected = selection.current
    setStarting(true)
    try {
      const result = await window.api.flows.startRun(project.project_id, flow.flow_id, envId, crypto.randomUUID())
      if (selection.current !== selected) return
      if (!result.ok) {
        message.error(result.error)
        return
      }
      setRun(result.data)
      await reloadRuns(flow.flow_id)
    } finally {
      setStarting(false)
    }
  }

  const deleteFlow = (): void => {
    if (!project || !flow) return
    modal.confirm({
      title: `删除流程「${flow.name}」？`,
      content: '运行记录会保留，流程定义将被删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.api.flows.delete(project.project_id, flow.flow_id)
        if (!result.ok) {
          message.error(result.error)
          return
        }
        await reloadFlows()
        message.success('已删除')
      }
    })
  }

  const openRun = async (runId: string): Promise<void> => {
    if (!project) return
    const result = await window.api.flows.getRun(project.project_id, runId)
    if (result.ok && result.data) setRun(result.data)
    else if (!result.ok) message.error(result.error)
  }

  const addEvent = (type: FlowEventType): void => {
    if (!flow) return
    patchFlow({ events: [...flow.events, makeEvent(type, apiTargets)] })
  }

  const addChild = (parentId: string, type: FlowEventType): void => {
    if (!flow) return
    patchFlow({
      events: addChildToTree(flow.events, parentId, makeEvent(type, apiTargets))
    })
  }

  const counts = run ? countRun(run.events) : null

  return (
    <div className="automation-page">
      <aside className="automation-panel">
        <div className="automation-panel-head">
          <span>流程</span>
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => void createFlow()} />
        </div>
        <div className="automation-scroll">
          {flows.length === 0 ? (
            <Empty
              description="还没有流程"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 30 }}
            />
          ) : (
            flows.map((item) => (
              <button
                key={item.flow_id}
                className={`flow-item${flow?.flow_id === item.flow_id ? ' active' : ''}`}
                onClick={() => void loadFlow(item.flow_id)}
              >
                <span className="flow-item-name">{item.name}</span>
                <span className="flow-item-meta">{item.events.length} 个事件</span>
              </button>
            ))
          )}
        </div>
        <div className="automation-panel-foot">
          <Button size="small" block type="dashed" icon={<PlusOutlined />} onClick={() => void createFlow()}>
            新建流程
          </Button>
        </div>
      </aside>

      <main className="automation-panel">
        <div className="automation-panel-head">
          <span>{flow ? flow.name : '流程编辑器'}</span>
          {dirty ? <Tag color="warning">未保存</Tag> : null}
          {flow ? <span className="muted">编辑版本：{flow.revision?.slice(0, 8) ?? '未保存'}</span> : null}
          <span style={{ flex: 1 }} />
          <Button
            size="small"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!flow}
            onClick={() => void saveFlow()}
          >
            保存
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={running}
            disabled={!flow}
            onClick={() => void executeFlow()}
          >
            运行
          </Button>
        </div>

        {flow ? (
          <div className="automation-scroll">
            <div className="flow-meta">
              <Input
                value={flow.name}
                onChange={(event) => patchFlow({ name: event.target.value })}
                placeholder="流程名称"
              />
              <Input
                value={flow.description}
                onChange={(event) => patchFlow({ description: event.target.value })}
                placeholder="说明（可选）"
              />
              <Select
                value={envId || undefined}
                onChange={(value) => {
                  setEnvId(value)
                  patchFlow({ env_id: value })
                }}
                options={environments.map((env) => ({ value: env.env_id, label: env.name }))}
                placeholder="运行环境"
                style={{ width: 150 }}
              />
              <Tooltip title="删除流程">
                <Button danger type="text" icon={<DeleteOutlined />} onClick={deleteFlow} />
              </Tooltip>
            </div>

            <div className="flow-toolbar">
              <span className="muted">事件按顺序执行</span>
              <span style={{ flex: 1 }} />
              <Dropdown
                menu={{
                  items: ADD_TYPES.map((type) => ({
                    key: type,
                    label: TYPE_LABEL[type]
                  })),
                  onClick: ({ key }) => addEvent(key as FlowEventType)
                }}
              >
                <Button size="small" icon={<PlusOutlined />}>
                  添加事件
                </Button>
              </Dropdown>
            </div>

            <div className="flow-events">
              {flow.events.length === 0 ? (
                <div className="flow-empty">
                  还没有事件。建议顺序：接口登录 → 脚本保存 token → 断言 → 条件 → 接口查询订单 → 断言。
                </div>
              ) : (
                flow.events.map((event) => (
                  <EventEditor
                    key={event.event_id}
                    event={event}
                    depth={0}
                    targets={apiTargets}
                    onChange={(patch) =>
                      patchFlow({ events: updateEventInTree(flow.events, event.event_id, patch) })
                    }
                    onDelete={() =>
                      patchFlow({ events: removeEventFromTree(flow.events, event.event_id) })
                    }
                    onAddChild={addChild}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="automation-scroll">
            <Empty description="选择或新建一个流程" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 60 }} />
          </div>
        )}
      </main>

      <aside className="automation-panel">
        <div className="automation-panel-head">
          <span>运行结果</span>
          {run ? (
            <Tag color={run.status === 'running' ? 'processing' : run.status === 'passed' ? 'success' : 'error'}>
              {run.status === 'running' ? '运行中' : run.status === 'passed' ? '通过' : '失败'}
            </Tag>
          ) : null}
        </div>
        <div className="automation-scroll">
          {running ? (
            <div style={{ padding: 30, textAlign: 'center' }}>
              <Spin tip="运行中…" />
            </div>
          ) : run ? (
            <>
              <div className="run-summary">
                <div>
                  <b>{run.elapsed_ms}</b>
                  <span>ms</span>
                </div>
                <div>
                  <b>{counts?.passed ?? 0}</b>
                  <span>通过</span>
                </div>
                <div>
                  <b>{counts?.failed ?? 0}</b>
                  <span>失败</span>
                </div>
                <div>
                  <b>{counts?.skipped ?? 0}</b>
                  <span>跳过</span>
                </div>
              </div>

              <div className="run-section-title">事件</div>
              <ResultRows events={run.events} depth={0} />

              <div className="run-section-title">运行时变量</div>
              {Object.keys(run.variables).length === 0 ? (
                <div className="muted">（无）</div>
              ) : (
                <table className="var-table">
                  <tbody>
                    {Object.entries(run.variables).map(([key, value]) => (
                      <tr key={key}>
                        <td className="mono">{key}</td>
                        <td className="mono">{value || <span className="muted">（空）</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {run.console.length > 0 ? (
                <>
                  <div className="run-section-title">控制台</div>
                  <div className="run-console">
                    {run.console.map((entry, index) => (
                      <div key={index}>
                        <span className="muted">[{new Date(entry.time).toLocaleTimeString()}]</span>{' '}
                        <Tag color={entry.level === 'error' ? 'error' : 'default'}>{entry.level}</Tag>
                        {entry.args.join(' ')}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <Empty description="运行后在这里查看事件结果" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />
          )}

          <div className="run-section-title">
            历史运行
            {flow ? <span className="muted"> · {runs.length} 条</span> : null}
          </div>
          {runs.length === 0 ? (
            <div className="muted">还没有运行记录。</div>
          ) : (
            <div className="run-history">
              {runs.map((item) => (
                <button
                  key={item.run_id}
                  className={`run-history-row${run?.run_id === item.run_id ? ' active' : ''}`}
                  onClick={() => void openRun(item.run_id)}
                >
                  <span className={item.status === 'running' ? 'run-status' : item.status === 'passed' ? 'run-status passed' : 'run-status failed'}>
                    {item.status === 'running' ? '运行中' : item.status === 'passed' ? '通过' : '失败'}
                  </span>
                  <span className="run-history-time">
                    {new Date(item.started_at).toLocaleString()}
                  </span>
                  <span className="muted">
                    {item.passed}/{item.failed}/{item.skipped}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function EventEditor({
  event,
  depth,
  targets,
  onChange,
  onDelete,
  onAddChild
}: {
  event: FlowEvent
  depth: number
  targets: TargetSummary[]
  onChange: (patch: Partial<FlowEvent>) => void
  onDelete: () => void
  onAddChild: (parentId: string, type: FlowEventType) => void
}): JSX.Element {
  const canNest = event.type === 'if' || event.type === 'begin' || event.type === 'loop'
  return (
    <div className="event-card" style={{ marginLeft: depth * 14 }}>
      <div className="event-head">
        <span className={`event-type ${event.type}`}>{TYPE_LABEL[event.type]}</span>
        <Input
          size="small"
          value={event.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={{ flex: 1 }}
        />
        <Tooltip title="启用 / 禁用">
          <Switch size="small" checked={event.enabled} onChange={(value) => onChange({ enabled: value })} />
        </Tooltip>
        {canNest ? (
          <Dropdown
            menu={{
              items: ADD_TYPES.map((type) => ({ key: type, label: TYPE_LABEL[type] })),
              onClick: ({ key }) => onAddChild(event.event_id, key as FlowEventType)
            }}
          >
            <Tooltip title="添加子事件">
              <Button size="small" type="text" icon={<PlusOutlined />} />
            </Tooltip>
          </Dropdown>
        ) : null}
        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onDelete} />
      </div>

      <div className="event-body">
        {event.type === 'api' ? (
          <Select
            size="small"
            value={event.target_id}
            onChange={(value) => onChange({ target_id: value })}
            placeholder="选择接口"
            options={targets.map((target) => ({
              value: target.target_id,
              label: `${target.method || 'GET'} ${target.name}`
            }))}
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
          />
        ) : null}

        {event.type === 'request' ? (
          <>
            <Space.Compact style={{ width: '100%' }}>
              <Select
                size="small"
                value={event.method || 'GET'}
                onChange={(method) => onChange({ method })}
                style={{ width: 92 }}
                options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({
                  value: method,
                  label: method
                }))}
              />
              <Input
                size="small"
                value={event.url ?? ''}
                onChange={(e) => onChange({ url: e.target.value })}
                placeholder="URL，如 {{baseUrl}}/login"
              />
            </Space.Compact>
            <Input.TextArea
              value={event.body ?? ''}
              onChange={(e) => onChange({ body: e.target.value })}
              autoSize={{ minRows: 2, maxRows: 6 }}
              className="mono"
              placeholder="请求体"
            />
          </>
        ) : null}

        {event.type === 'script' ? (
          <Input.TextArea
            value={event.script ?? ''}
            onChange={(e) => onChange({ script: e.target.value })}
            autoSize={{ minRows: 4, maxRows: 10 }}
            className="mono"
            placeholder={'pm.environment.set("token", pm.response.json().token);\npm.test("状态码 200", () => pm.expect(pm.response.code).to.eql(200));'}
          />
        ) : null}

        {event.type === 'assert' ? (
          <AssertionEditor event={event} onChange={onChange} />
        ) : null}

        {event.type === 'if' ? (
          <Input
            size="small"
            value={event.condition ?? ''}
            onChange={(e) => onChange({ condition: e.target.value })}
            prefix={<span className="muted">if</span>}
            placeholder="env.token !== undefined"
          />
        ) : null}

        {event.type === 'wait' ? (
          <Space>
            <span className="muted">等待</span>
            <InputNumber
              size="small"
              min={0}
              max={60000}
              value={event.wait_ms ?? 500}
              onChange={(value) => onChange({ wait_ms: Number(value ?? 0) })}
            />
            <span className="muted">ms</span>
          </Space>
        ) : null}

        {event.type === 'loop' ? (
          <Space>
            <span className="muted">循环</span>
            <InputNumber
              size="small"
              min={1}
              max={50}
              value={event.loop_count ?? 1}
              onChange={(value) => onChange({ loop_count: Number(value ?? 1) })}
            />
            <span className="muted">轮</span>
          </Space>
        ) : null}
      </div>

      {canNest && (event.children?.length ?? 0) > 0 ? (
        <div className="event-children">
          {event.children?.map((child) => (
            <EventEditor
              key={child.event_id}
              event={child}
              depth={0}
              targets={targets}
              onChange={(patch) => {
                const children = updateEventInTree(event.children ?? [], child.event_id, patch)
                onChange({ children })
              }}
              onDelete={() => {
                const children = removeEventFromTree(event.children ?? [], child.event_id)
                onChange({ children })
              }}
              onAddChild={(parentId, type) => {
                const children = addChildToTree(
                  event.children ?? [],
                  parentId,
                  makeEvent(type, targets)
                )
                onChange({ children })
              }}
            />
          ))}
        </div>
      ) : null}
      {canNest && (event.children?.length ?? 0) === 0 ? (
        <div className="event-empty-child">可以添加子事件</div>
      ) : null}
    </div>
  )
}

function AssertionEditor({
  event,
  onChange
}: {
  event: FlowEvent
  onChange: (patch: Partial<FlowEvent>) => void
}): JSX.Element {
  const assertions = event.assertions ?? []
  const update = (index: number, patch: Partial<FlowAssertion>): void => {
    onChange({
      assertions: assertions.map((item, i) => (i === index ? { ...item, ...patch } : item))
    })
  }
  return (
    <div>
      {assertions.map((assertion, index) => (
        <div className="assert-row" key={assertion.assert_id}>
          <Select
            size="small"
            value={assertion.type}
            onChange={(type) => update(index, { type })}
            options={[
              { value: 'status', label: '状态码' },
              { value: 'json', label: 'JSON' },
              { value: 'time', label: '耗时' },
              { value: 'bodyContains', label: 'Body 包含' }
            ]}
          />
          <Input
            size="small"
            value={assertion.path ?? ''}
            onChange={(e) => update(index, { path: e.target.value })}
            placeholder={assertion.type === 'json' ? 'data.id' : '（路径）'}
            disabled={assertion.type !== 'json'}
          />
          <Select
            size="small"
            value={assertion.op ?? 'equals'}
            onChange={(op) => update(index, { op })}
            disabled={assertion.type !== 'json'}
            options={[
              { value: 'equals', label: '=' },
              { value: 'exists', label: '存在' },
              { value: 'length_gt', label: '长度 >' },
              { value: 'contains', label: '包含' }
            ]}
          />
          <Input
            size="small"
            value={assertion.expected === undefined ? '' : String(assertion.expected)}
            onChange={(e) => update(index, { expected: e.target.value })}
            placeholder="期望值"
          />
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onChange({ assertions: assertions.filter((_, i) => i !== index) })}
          />
        </div>
      ))}
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() => onChange({ assertions: [...assertions, createFlowAssertion()] })}
      >
        添加断言
      </Button>
    </div>
  )
}

function ResultRows({
  events,
  depth
}: {
  events: FlowEventResult[]
  depth: number
}): JSX.Element {
  return (
    <>
      {events.map((event) => (
        <div
          className="run-event"
          key={`${event.event_id}-${event.iteration ?? 0}-${depth}`}
          style={{ marginLeft: depth * 12 }}
        >
          <div className="run-event-head">
            <span className={`run-dot ${event.status}`} />
            <span className={`event-type ${event.type}`}>{TYPE_LABEL[event.type]}</span>
            <span className="run-event-name">{event.name}</span>
            {event.iteration !== undefined ? (
              <span className="muted">#{event.iteration + 1}</span>
            ) : null}
            <span className="muted">{event.elapsed_ms}ms</span>
            <span className={`run-status ${event.status}`}>
              {event.status === 'passed' ? '通过' : event.status === 'failed' ? '失败' : '跳过'}
            </span>
          </div>
          {event.detail ? <div className="run-detail">{event.detail}</div> : null}
          {event.error ? <div className="run-error">{event.error}</div> : null}
          {event.assertions?.length ? (
            <div className="run-asserts">
              {event.assertions.map((assertion, index) => (
                <Tag key={index} color={assertion.passed ? 'success' : 'error'}>
                  {assertion.name}
                </Tag>
              ))}
            </div>
          ) : null}
          {event.response ? (
            <details className="run-response">
              <summary>
                响应 {event.response.code} · {event.response.response_time} ms
              </summary>
              <pre>{event.response.body}</pre>
            </details>
          ) : null}
          {event.children?.length ? (
            <ResultRows events={event.children} depth={depth + 1} />
          ) : null}
        </div>
      ))}
    </>
  )
}
