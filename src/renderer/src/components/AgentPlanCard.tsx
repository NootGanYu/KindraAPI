import { useState } from 'react'
import { Alert, Button, Card, Checkbox, Space, Tag, Typography } from 'antd'
import type { AgentPlan, AgentPlanStep } from '@shared/agentPlan'
import type { CaseRunResult, FlowEventResult, Result } from '@shared/types'
import { flushAgentDrafts } from '../agentDraftSync'

const labels: Record<AgentPlan['status'], string> = { generating: '生成中', pending: '等待批准', running: '执行中', completed: '已完成', rejected: '已拒绝', paused: '需要重新确认', interrupted: '已中断' }
const stepLabels: Record<AgentPlanStep['status'], string> = { pending: '等待批准', running: '执行中', succeeded: '已完成', failed: '步骤失败', paused: '已暂停', unknown: '远端结果未知', cancelled: '发送前已取消', awaiting_approval: '等待新增授权' }
const permissionLabels: Record<string, string> = { ask: '询问权限', auto: '自动模式', bypass: '跳过权限' }
const operationLabels: Record<string, string> = {
  read_api: '读取', read_flow: '读取 Flow', propose_api_change: '提议修改', propose_flow_change: '提议修改',
  apply_candidate: '采纳候选到草稿', execute_api: '执行', execute_api_case: '执行用例', execute_flow: '执行 Flow',
  save_api: '保存正式定义', save_flow: '保存正式定义', save_api_response: '保存响应示例', create_api: '新建接口草稿'
}
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data }

export default function AgentPlanCard({ plan, projectId }: { plan: AgentPlan; projectId: string }): JSX.Element {
  const [error, setError] = useState('')
  const [resumeSelections, setResumeSelections] = useState<string[]>([])
  const steps = plan.steps
  const effects = plan.proposed_effects
  const changes = [
    steps.some(step => ['read_api', 'read_flow'].includes(step.operation)) ? '读取脱敏内容' : null,
    steps.some(step => ['propose_api_change', 'create_api', 'propose_flow_change'].includes(step.operation)) ? '创建本机候选' : null,
    steps.some(step => step.operation === 'apply_candidate') ? '显式采纳到草稿' : null,
    steps.some(step => ['execute_api', 'execute_api_case', 'execute_flow'].includes(step.operation)) ? '真实发送获批请求，结果未知不重发' : null,
    steps.some(step => ['save_api', 'save_flow', 'save_api_response'].includes(step.operation)) ? '写入正式定义或响应示例' : null,
    effects?.extra_requests?.length ? `额外请求 ${effects.extra_requests.map(item => `${item.method} ${item.url}`).join('、')}` : null,
    effects?.write_variables ? '变量差量写回' : null,
    effects?.save_response ? '保存响应示例' : null,
    effects?.save_definitions ? '正式保存' : null
  ].filter(Boolean).join('；') || '无业务副作用'

  async function act(action: 'approvePlan' | 'rejectPlan' | 'deletePlan' | 'cancelPlan'): Promise<void> {
    setError('')
    try {
      if (action === 'approvePlan') await flushAgentDrafts()
      unwrap(await (action === 'approvePlan' ? window.api.agent.approvePlan(projectId, plan.plan_id, plan.approval_revision ?? 1) : window.api.agent[action](projectId, plan.plan_id)) as Result<unknown>)
    } catch (e) { setError((e as Error).message) }
  }
  async function resume(): Promise<void> {
    setError('')
    try {
      unwrap(await window.api.agent.resumePlan(projectId, plan.plan_id, resumeSelections))
      setResumeSelections([])
    } catch (e) { setError((e as Error).message) }
  }

  return <Card className="agent-plan-card" size="small" title={plan.goal} extra={<Tag color={plan.status === 'pending' ? 'warning' : undefined}>{labels[plan.status]}</Tag>}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text>项目：{plan.project_name} · 对象：{[...(plan.targets?.map(target => `${target.name}${target.new_object ? '（新对象）' : ''}`) ?? []), ...(plan.flows?.map(flow => flow.name) ?? [])].join('、') || plan.target_name}</Typography.Text>
      <Typography.Text>环境：{plan.environment_name} · 模型：{plan.model} · 权限：{permissionLabels[plan.permission_mode ?? 'ask']} · 选择：{plan.selection_source === 'auto' ? '自动选择' : '明确指定'}</Typography.Text>
      <Typography.Text>影响：{changes} · 授权版本 v{plan.approval_revision ?? 1}</Typography.Text>
      {steps.map(step => <div key={step.step_id} className="agent-plan-step">
        <Space><Typography.Text strong>{step.step_id} · {operationLabels[step.operation] ?? step.operation}{step.case_id ? ` ${step.case_name ?? step.case_id}` : ''} {step.target_name ?? plan.target_name}</Typography.Text><Tag color={step.status === 'failed' ? 'error' : step.status === 'succeeded' ? 'success' : undefined}>{stepLabels[step.status]}</Tag></Space>
        <div><Typography.Text type="secondary">依赖：{step.dependencies_explicit ? (step.depends_on.length ? step.depends_on.join('、') : '无（独立步骤）') : `未声明，保守依赖${step.depends_on.length ? ` ${step.depends_on.join('、')}` : '此前步骤'}`} · 来源：{(step.source ?? plan.source) === 'draft' ? '未保存草稿' : '已保存定义'}</Typography.Text></div>
        {step.execution && <div><Typography.Text strong>{step.execution.method} {step.execution.url}</Typography.Text><ul>{step.execution.effects.map(effect => <li key={effect}>{effect}</li>)}</ul></div>}
        {step.binding && <div><Typography.Text type="secondary">绑定：{step.binding === 'deferred' ? '读取后生成' : '批准时固定'}{step.intent ? ` · ${step.intent}` : ''}{step.allowed_changes?.length ? ` · 允许字段：${step.allowed_changes.join('、')}` : ''}</Typography.Text></div>}
        {step.source_steps?.length ? <div><Typography.Text type="secondary">来源步骤：{step.source_steps.join('、')}</Typography.Text></div> : null}
        {step.changes !== undefined && <pre className="agent-plan-changes">{JSON.stringify(step.changes, null, 2)}</pre>}
        <CaseResult step={step} />
        <FlowResults step={step} />
        {plan.can_resume && step.retryable && <Checkbox checked={resumeSelections.includes(step.step_id)} onChange={event => setResumeSelections(previous => event.target.checked ? [...previous, step.step_id] : previous.filter(id => id !== step.step_id))}>选择恢复此未完成步骤</Checkbox>}
        {step.error && <Typography.Text type="danger">{step.error}</Typography.Text>}
      </div>)}
      {plan.error && <Alert type="warning" message={plan.error} />}
      {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
      {plan.explanation && <div className="agent-plan-explanation">{plan.explanation}</div>}
      {steps.some(step => step.result) && <details><summary>查看脱敏工具结果</summary><pre className="agent-plan-result">{JSON.stringify(steps.map(({ step_id, status, result, error }) => ({ step_id, status, result, error })), null, 2)}</pre></details>}
      {plan.can_resume && <><Typography.Text>已成功的步骤和循环迭代会保留；结果未知或已发送的失败请求不会自动重发。选择未完成步骤后生成新一轮待审批计划。</Typography.Text><Button disabled={!resumeSelections.length} onClick={() => void resume()}>生成恢复计划（需重新批准）</Button></>}
      <Space wrap>
        {(plan.status === 'pending' || (plan.status === 'paused' && steps.some(step => step.status === 'awaiting_approval'))) && <><Button type="primary" onClick={() => void act('approvePlan')}>{steps.some(step => step.status === 'awaiting_approval') ? '批准新增范围' : steps.some(step => ['save_api', 'save_flow'].includes(step.operation)) ? '批准修改与保存计划' : steps.some(step => step.operation === 'create_api') ? '批准新建计划' : steps.some(step => ['execute_api', 'execute_api_case', 'execute_flow'].includes(step.operation)) ? '批准执行计划' : steps.some(step => ['propose_api_change', 'propose_flow_change'].includes(step.operation)) ? '批准修改计划' : '批准只读计划'}</Button><Button onClick={() => void act('rejectPlan')}>拒绝计划</Button></>}
        {['running', 'generating'].includes(plan.status) && <Button onClick={() => void act('cancelPlan')}>取消任务</Button>}
        {!['running', 'generating'].includes(plan.status) && <Button onClick={() => void act('deletePlan')}>删除计划记录</Button>}
      </Space>
    </Space>
  </Card>
}

function CaseResult({ step }: { step: AgentPlanStep }): JSX.Element | null {
  const result = (step.result as { case_result?: CaseRunResult } | undefined)?.case_result
  if (!result) return null
  return <div>
    <Typography.Text strong>用例结果：{result.status === 'passed' ? '通过' : result.status === 'failed' ? '失败' : '错误'}</Typography.Text>
    {result.http_status !== undefined && <div>HTTP {result.http_status} · {result.duration_ms} ms</div>}
    {result.assertions?.map(assertion => <div key={assertion.assertion_id}><Tag color={assertion.passed ? 'success' : 'error'}>{assertion.assertion_id} · {assertion.passed ? '通过' : '失败'}</Tag>{assertion.actual !== undefined && <span>实际：{assertion.actual}</span>} {assertion.message}</div>)}
    {result.error && <div>{result.error}</div>}
  </div>
}

function FlowResults({ step }: { step: AgentPlanStep }): JSX.Element | null {
  const events = (step.result as { events?: FlowEventResult[] } | undefined)?.events
  if (!events?.length) return null
  const renderEvents = (items: FlowEventResult[]): JSX.Element => <ul>{items.map((event, index) => <li key={`${event.event_id}-${event.iteration ?? ''}-${index}`}>
    {event.name}（{event.type}）{event.iteration !== undefined ? ` · 第 ${event.iteration + 1} 次迭代` : ''} · {({ passed: '已完成', failed: '失败', skipped: '已跳过', paused: '依赖暂停', unknown: '远端结果未知', cancelled: '已取消' } as const)[event.status]}{event.error ? `：${event.error}` : event.detail ? `：${event.detail}` : ''}
    {event.children?.length ? renderEvents(event.children) : null}
  </li>)}</ul>
  return <div><Typography.Text strong>Flow 节点结果</Typography.Text>{renderEvents(events)}</div>
}
