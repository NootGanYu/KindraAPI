import { useEffect, useState } from 'react'
import { Alert, Button, Card, Drawer, Input, Select, Space, Tag, Typography } from 'antd'
import type { AgentPlan, AgentPlanStep } from '@shared/agentPlan'
import type { AgentConnection } from '@shared/agent'
import type { Environment, Result, TargetSummary } from '@shared/types'
import { useApp } from '../store'

const labels: Record<AgentPlan['status'], string> = { generating: '生成中', pending: '等待批准', running: '执行中', completed: '已完成', rejected: '已拒绝', paused: '需要重新确认', interrupted: '已中断' }
const stepLabels: Record<AgentPlanStep['status'], string> = { pending: '等待批准', running: '执行中', succeeded: '已完成', failed: '读取失败', paused: '已暂停' }
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data }
export default function AgentPlanPanel({ projectId, connection }: { projectId: string; connection: AgentConnection | null }): JSX.Element {
  const [edit, setEdit] = useState(false)
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<AgentPlan[]>([])
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [targetIds, setTargetIds] = useState<string[]>(useApp.getState().activeId ? [useApp.getState().activeId!] : [])
  const [environmentId, setEnvironmentId] = useState<string | undefined>()
  const [goal, setGoal] = useState('解释当前接口')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const capable = connection?.capability === 'tools' && connection.protocol === 'chat-completions'
  useEffect(() => {
    let mounted = true
    const off = window.api.agent.onPlanChanged(event => {
      if (event.project_id !== projectId) return
      setPlans(previous => event.plan ? [event.plan, ...previous.filter(plan => plan.plan_id !== event.plan_id)] : previous.filter(plan => plan.plan_id !== event.plan_id))
    })
    window.api.agent.listPlans(projectId).then(result => mounted && setPlans(unwrap(result))).catch(e => mounted && setError(e.message))
    return () => { mounted = false; off() }
  }, [projectId])
  async function show(): Promise<void> {
    setOpen(true)
    try {
      const [apis, envs] = await Promise.all([window.api.targets.list(projectId), window.api.envs.list(projectId)])
      const list = unwrap(apis).filter(target => target.target_type === 'api')
      setTargets(list); setEnvironments(unwrap(envs))
      setTargetIds(previous => previous.filter(id => list.some(target => target.target_id === id)))
    } catch (e) { setError((e as Error).message) }
  }
  async function generate(): Promise<void> {
    if (!targetIds.length) return
    setBusy(true); setError('')
    try {
      const state = useApp.getState()
      const drafts = state.project?.project_id === projectId ? Object.fromEntries(targetIds.filter(id => state.drafts[id]).map(id => [id, state.drafts[id]])) : {}
      unwrap(await window.api.agent[edit ? 'proposeEditPlan' : 'proposeReadPlan'](projectId, { goal, targetId: targetIds[0], targetIds, environmentId, drafts, connectionId: connection?.connection_id }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function act(action: 'approvePlan' | 'rejectPlan' | 'deletePlan', id: string): Promise<void> {
    setError('')
    try { unwrap(await window.api.agent[action](projectId, id) as Result<unknown>) }
    catch (e) { setError((e as Error).message) }
  }
  return <>
    <Button onClick={() => { setEdit(false); void show() }}>只读计划</Button>
    <Button onClick={() => { setEdit(true); void show() }}>修改草稿</Button>
    <Drawer title={edit ? '项目草稿修改计划' : '项目只读计划'} width={760} open={open} onClose={() => setOpen(false)}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text>选择接口并描述目标。批准前只向模型发送目标和对象编号；批准后发送所选接口的脱敏内容，优先使用当前草稿。</Typography.Text>
        {!capable && <Alert type="info" message="请先选择已检测工具能力的 Chat Completions 连接；当前仍可使用文本对话。" />}
        {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
        <Input aria-label="计划目标" value={goal} onChange={event => setGoal(event.target.value)} maxLength={10000} />
        <Select mode="multiple" aria-label="计划接口" placeholder="选择一个或多个接口" style={{ width: '100%' }} value={targetIds} onChange={setTargetIds} options={targets.map(target => ({ value: target.target_id, label: `${target.method} ${target.name}` }))} />
        <Select aria-label="计划环境" placeholder="不读取环境" allowClear style={{ width: '100%' }} value={environmentId} onChange={setEnvironmentId} options={environments.map(env => ({ value: env.env_id, label: env.name }))} />
        <Button type="primary" disabled={!capable || !targetIds.length || targetIds.length > 32 || !goal.trim()} loading={busy} onClick={() => void generate()}>{edit ? '生成草稿修改计划' : '生成只读计划'}</Button>
        {plans.map(plan => <Card key={plan.plan_id} size="small" title={plan.goal} extra={<Tag color={plan.status === 'pending' ? 'warning' : undefined}>{labels[plan.status]}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>项目：{plan.project_name} · 对象：{plan.targets?.map(target => target.name).join("、") ?? plan.target_name}</Typography.Text>
            <Typography.Text>环境：{plan.environment_name} · 模型：{plan.model}</Typography.Text>
            <Typography.Text>影响：{plan.steps.some(step => step.operation === 'propose_api_change') ? '创建本机修改候选，审阅后应用到草稿；不会正式保存或发送请求。' : '只读取所选接口并发送脱敏内容，不修改、保存或发送接口请求。'}</Typography.Text>
            {plan.steps.map(step => <div key={step.step_id} style={{ borderLeft: '2px solid var(--border-color, #ddd)', paddingLeft: 12 }}>
              <Space><Typography.Text strong>{step.step_id} · {step.operation === 'propose_api_change' ? '提议修改' : '读取'} {step.target_name ?? plan.target_name}</Typography.Text><Tag color={step.status === 'failed' ? 'error' : step.status === 'succeeded' ? 'success' : undefined}>{stepLabels[step.status]}</Tag></Space>
              <div><Typography.Text type="secondary">依赖：{step.dependencies_explicit ? (step.depends_on.length ? step.depends_on.join('、') : '无（独立步骤）') : `未声明，保守依赖${step.depends_on.length ? ` ${step.depends_on.join('、')}` : '此前步骤'}`} · 来源：{(step.source ?? plan.source) === 'draft' ? '未保存草稿' : '已保存定义'}</Typography.Text></div>
              {step.changes !== undefined && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(step.changes, null, 2)}</pre>}
              {step.error && <Typography.Text type="danger">{step.error}</Typography.Text>}
            </div>)}
            {plan.error && <Alert type="warning" message={plan.error} />}
            {plan.explanation && <div style={{ whiteSpace: 'pre-wrap' }}>{plan.explanation}</div>}
            {plan.steps.some(step => step.result) && <details><summary>查看脱敏工具结果</summary><pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(plan.steps.map(({ step_id, status, result, error }) => ({ step_id, status, result, error })), null, 2)}</pre></details>}
            <Space>{plan.status === 'pending' && <><Button type="primary" onClick={() => void act('approvePlan', plan.plan_id)}>{plan.steps.some(step => step.operation === 'propose_api_change') ? '批准修改计划' : '批准只读计划'}</Button><Button onClick={() => void act('rejectPlan', plan.plan_id)}>拒绝计划</Button></>}
              {!['running', 'generating'].includes(plan.status) && <Button onClick={() => void act('deletePlan', plan.plan_id)}>删除计划记录</Button>}</Space>
          </Space>
        </Card>)}
      </Space>
    </Drawer>
  </>
}
