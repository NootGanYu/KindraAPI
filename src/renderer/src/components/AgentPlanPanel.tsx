import { useEffect, useState } from 'react'
import { Alert, Button, Card, Drawer, Input, Select, Space, Tag, Typography } from 'antd'
import type { AgentPlan } from '@shared/agentPlan'
import type { AgentConnection } from '@shared/agent'
import type { Environment, Result, TargetSummary } from '@shared/types'
import { useApp } from '../store'

const labels: Record<AgentPlan['status'], string> = { generating: '生成中', pending: '等待批准', running: '执行中', completed: '已完成', rejected: '已拒绝', paused: '需要重新确认', interrupted: '已中断' }
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data }
export default function AgentPlanPanel({ projectId, connection }: { projectId: string; connection: AgentConnection | null }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<AgentPlan[]>([])
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [targetId, setTargetId] = useState<string | undefined>(useApp.getState().activeId ?? undefined)
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
      if (targetId && !list.some(target => target.target_id === targetId)) setTargetId(undefined)
    } catch (e) { setError((e as Error).message) }
  }
  async function generate(): Promise<void> {
    if (!targetId) return
    setBusy(true); setError('')
    try {
      const state = useApp.getState()
      const draft = state.project?.project_id === projectId ? state.drafts[targetId] : undefined
      unwrap(await window.api.agent.proposeReadPlan(projectId, { goal, targetId, environmentId, draft, connectionId: connection?.connection_id }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function act(action: 'approvePlan' | 'rejectPlan' | 'deletePlan', id: string): Promise<void> {
    setError('')
    try { unwrap(await window.api.agent[action](projectId, id) as Result<unknown>) }
    catch (e) { setError((e as Error).message) }
  }
  return <>
    <Button onClick={() => void show()}>只读计划</Button>
    <Drawer title="项目只读计划" width={760} open={open} onClose={() => setOpen(false)}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text>选择接口并描述目标。批准前只向模型发送目标和对象编号；批准后发送所选接口的脱敏内容，优先使用当前草稿。</Typography.Text>
        {!capable && <Alert type="info" message="请先选择已检测工具能力的 Chat Completions 连接；当前仍可使用文本对话。" />}
        {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
        <Input aria-label="计划目标" value={goal} onChange={event => setGoal(event.target.value)} maxLength={10000} />
        <Select aria-label="计划接口" placeholder="选择接口" style={{ width: '100%' }} value={targetId} onChange={setTargetId} options={targets.map(target => ({ value: target.target_id, label: `${target.method} ${target.name}` }))} />
        <Select aria-label="计划环境" placeholder="不读取环境" allowClear style={{ width: '100%' }} value={environmentId} onChange={setEnvironmentId} options={environments.map(env => ({ value: env.env_id, label: env.name }))} />
        <Button type="primary" disabled={!capable || !targetId || !goal.trim()} loading={busy} onClick={() => void generate()}>生成只读计划</Button>
        {plans.map(plan => <Card key={plan.plan_id} size="small" title={plan.goal} extra={<Tag color={plan.status === 'pending' ? 'warning' : undefined}>{labels[plan.status]}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>项目：{plan.project_name} · 对象：{plan.target_name}</Typography.Text>
            <Typography.Text>环境：{plan.environment_name} · 模型：{plan.model} · 来源：{plan.source === 'draft' ? '未保存草稿' : '已保存定义'}</Typography.Text>
            <Typography.Text>影响：只读取所选接口并发送脱敏内容，不修改、保存或发送接口请求。</Typography.Text>
            {plan.steps.map(step => <Typography.Text key={step.step_id}>步骤：读取接口 · {step.status === 'succeeded' ? '已完成' : step.status === 'paused' ? '已暂停' : step.status === 'running' ? '执行中' : '等待批准'}</Typography.Text>)}
            {plan.error && <Alert type="warning" message={plan.error} />}
            {plan.explanation && <div style={{ whiteSpace: 'pre-wrap' }}>{plan.explanation}</div>}
            {plan.steps.some(step => step.result) && <details><summary>查看脱敏工具结果</summary><pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(plan.steps.map(step => step.result), null, 2)}</pre></details>}
            <Space>{plan.status === 'pending' && <><Button type="primary" onClick={() => void act('approvePlan', plan.plan_id)}>批准只读计划</Button><Button onClick={() => void act('rejectPlan', plan.plan_id)}>拒绝计划</Button></>}
              {!['running', 'generating'].includes(plan.status) && <Button onClick={() => void act('deletePlan', plan.plan_id)}>删除计划记录</Button>}</Space>
          </Space>
        </Card>)}
      </Space>
    </Drawer>
  </>
}
