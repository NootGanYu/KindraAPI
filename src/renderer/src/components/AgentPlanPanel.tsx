import { useEffect, useState } from 'react'
import { Alert, Button, Card, Checkbox, Drawer, Input, Select, Space, Tag, Typography } from 'antd'
import type { AgentPlan, AgentPlanStep } from '@shared/agentPlan'
import type { AgentConnection } from '@shared/agent'
import type { Environment, Flow, Result, TargetSummary } from '@shared/types'
import { flushAgentDrafts } from '../agentDraftSync'
import { useApp } from '../store'

const labels: Record<AgentPlan['status'], string> = { generating: '生成中', pending: '等待批准', running: '执行中', completed: '已完成', rejected: '已拒绝', paused: '需要重新确认', interrupted: '已中断' }
const stepLabels: Record<AgentPlanStep['status'], string> = { pending: '等待批准', running: '执行中', succeeded: '已完成', failed: '步骤失败', paused: '已暂停', unknown: '远端结果未知', cancelled: '发送前已取消' }
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data }
export default function AgentPlanPanel({ projectId, connection }: { projectId: string; connection: AgentConnection | null }): JSX.Element {
  const [mode, setMode] = useState<'read' | 'edit' | 'execute' | 'save' | 'create'>('read')
  const create = mode === 'create', edit = mode === 'edit', execute = mode === 'execute', save = mode === 'save'
  const [createSave, setCreateSave] = useState(false)
  const [parentId, setParentId] = useState('0')
  const [folders, setFolders] = useState<TargetSummary[]>([])
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<AgentPlan[]>([])
  const [flows, setFlows] = useState<Flow[]>([]), [flowIds, setFlowIds] = useState<string[]>([])
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [targetIds, setTargetIds] = useState<string[]>(useApp.getState().activeId ? [useApp.getState().activeId!] : [])
  const [environmentId, setEnvironmentId] = useState<string | undefined>()
  const [extraRequests, setExtraRequests] = useState('')
  const [writeVariables, setWriteVariables] = useState(false)
  const [saveResponse, setSaveResponse] = useState(false)
  const [goal, setGoal] = useState('解释当前接口')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const capable = connection?.capability === 'tools'
  useEffect(() => {
    let mounted = true
    const off = window.api.agent.onPlanChanged(event => {
      if (event.project_id !== projectId) return
      setPlans(previous => event.plan ? [event.plan, ...previous.filter(plan => plan.plan_id !== event.plan_id)] : previous.filter(plan => plan.plan_id !== event.plan_id))
    })
    window.api.agent.listPlans(projectId).then(result => mounted && setPlans(unwrap(result))).catch(e => mounted && setError(e.message))
    return () => { mounted = false; off() }
  }, [projectId])
  async function show(selectedMode: typeof mode): Promise<void> {
    setOpen(true)
    try {
      const [apis, envs, drafts, flowList] = await Promise.all([window.api.targets.list(projectId), window.api.envs.list(projectId), window.api.agent.listAgentDrafts(projectId), window.api.flows.list(projectId)])
      setFlows(unwrap(flowList)); setFlowIds(previous => previous.filter(id => unwrap(flowList).some(flow => flow.flow_id === id)))
      const list = unwrap(apis).filter(target => target.target_type === 'api')
      setFolders(unwrap(apis).filter(target => target.target_type === 'folder'))
      if (['save', 'edit'].includes(selectedMode)) for (const draft of unwrap(drafts).filter(draft => draft.new_object)) list.push({ ...draft.target, name: `${draft.target.name}（尚未正式创建）` })
      setTargets(list); setEnvironments(unwrap(envs))
      setTargetIds(previous => previous.filter(id => list.some(target => target.target_id === id)))
    } catch (e) { setError((e as Error).message) }
  }
  async function generate(): Promise<void> {
    if (!create && !targetIds.length && !((edit || save) && flowIds.length)) return
    setBusy(true); setError('')
    try {
      await flushAgentDrafts()
      if (create) {
        unwrap(await window.api.agent.proposeCreateApiPlan(projectId, { goal, parentId, save: createSave, connectionId: connection?.connection_id }))
        return
      }
      const state = useApp.getState()
      const drafts = state.project?.project_id === projectId ? Object.fromEntries(targetIds.filter(id => state.drafts[id]).map(id => [id, state.drafts[id]])) : {}
      const requests = extraRequests.split('\n').filter(line => line.trim()).map(line => {
        const match = /^\s*([A-Za-z]+)\s+(\S+)(?:\s+(\d+))?\s*$/.exec(line)
        if (!match) throw new Error('额外请求每行填写 METHOD URL，可选最大次数')
        return { method: match[1].toUpperCase(), url: match[2], maxCalls: Number(match[3] ?? 1) }
      })
      const draftRevisions = Object.fromEntries(Object.keys(drafts).map(id => [id, state.baselines[id]?.revision ?? null]))
      unwrap(await window.api.agent[save ? 'proposeSavePlan' : execute ? 'proposeExecutePlan' : edit ? 'proposeEditPlan' : 'proposeReadPlan'](projectId, { goal, targetId: targetIds[0] ?? '', targetIds, flowIds: (edit || save) ? flowIds : undefined, environmentId, drafts, draftRevisions, ...(execute ? { execution: { requests, writeVariables, saveResponse } } : {}), connectionId: connection?.connection_id }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function act(action: 'approvePlan' | 'rejectPlan' | 'deletePlan' | 'cancelPlan', id: string): Promise<void> {
    setError('')
    try {
      if (action === 'approvePlan') await flushAgentDrafts()
      unwrap(await window.api.agent[action](projectId, id) as Result<unknown>)
    }
    catch (e) { setError((e as Error).message) }
  }
  return <>
    <Button onClick={() => { setMode('read'); void show('read') }}>只读计划</Button>
    <Button onClick={() => { setMode('edit'); void show('edit') }}>修改草稿</Button>
    <Button onClick={() => { setMode('execute'); void show('execute') }}>执行草稿</Button>
    <Button onClick={() => { setMode('save'); void show('save') }}>修改并保存</Button>
    <Button onClick={() => { setMode('create'); void show('create') }}>新建接口草稿</Button>
    <Drawer title={create ? '新建接口草稿计划' : save ? '项目修改与正式保存计划' : execute ? '项目草稿执行计划' : edit ? '项目草稿修改计划' : '项目只读计划'} width={760} open={open} onClose={() => setOpen(false)}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text>{create ? '描述新接口及已确认的业务规则。批准新建只产生本机草稿和候选；缺少规则时保留草稿并暂停澄清。' : '选择接口并描述目标。批准前只向模型发送目标和对象编号；批准后发送所选接口的脱敏内容，优先使用当前草稿。'}</Typography.Text>
        {save && <Alert type="warning" message="保存必须作为独立步骤展示。批准后自动采纳本计划候选并校验保存，不会再次确认；缺少业务规则或存在冲突会暂停。" />}
        {!capable && <Alert type="info" message="请先选择已检测工具能力的连接；Chat Completions 和 Responses 均可使用只读计划。" />}
        {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
        <Input aria-label="计划目标" value={goal} onChange={event => setGoal(event.target.value)} maxLength={10000} />
        {!create && <Select mode="multiple" aria-label="计划接口" placeholder="选择一个或多个接口" style={{ width: '100%' }} value={targetIds} onChange={setTargetIds} options={targets.map(target => ({ value: target.target_id, label: `${target.method} ${target.name}` }))} />}
        {(edit || save) && <Select mode="multiple" aria-label="计划 Flow" placeholder="选择 Execution Flow" style={{ width: '100%' }} value={flowIds} onChange={setFlowIds} options={flows.map(flow => ({ value: flow.flow_id, label: flow.name }))} />}
        {create && <><Select aria-label="新接口父目录" value={parentId} onChange={setParentId} style={{ width: '100%' }} options={[{ value: '0', label: '项目根目录' }, ...folders.map(folder => ({ value: folder.target_id, label: folder.name }))]} /><Checkbox checked={createSave} onChange={event => setCreateSave(event.target.checked)}>允许提出独立正式保存步骤</Checkbox></>}
        {!create && <Select aria-label="计划环境" placeholder={execute ? '无环境（不使用默认环境）' : '不读取环境'} allowClear style={{ width: '100%' }} value={environmentId} onChange={setEnvironmentId} options={environments.map(env => ({ value: env.env_id, label: env.name }))} />}
        {execute && <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>现有脚本和配置的上传文件会在计划中列出；额外请求须明确列出方法、完整地址和最多次数。</Typography.Text>
          <Input.TextArea aria-label="额外请求授权" placeholder="GET https://example.com/login 1" value={extraRequests} onChange={event => setExtraRequests(event.target.value)} />
          <Checkbox checked={writeVariables} onChange={event => setWriteVariables(event.target.checked)}>允许环境与全局变量差量写回（冲突暂停）</Checkbox>
          <Checkbox checked={saveResponse} onChange={event => setSaveResponse(event.target.checked)}>添加独立保存响应示例步骤（不保存其他草稿）</Checkbox>
        </Space>}
        <Button type="primary" disabled={!capable || (!create && ((!targetIds.length && !((edit || save) && flowIds.length)) || targetIds.length + ((edit || save) ? flowIds.length : 0) > 32)) || !goal.trim()} loading={busy} onClick={() => void generate()}>{create ? '生成新建计划' : save ? '生成修改与保存计划' : execute ? '生成执行计划' : edit ? '生成草稿修改计划' : '生成只读计划'}</Button>
        {plans.map(plan => <Card key={plan.plan_id} size="small" title={plan.goal} extra={<Tag color={plan.status === 'pending' ? 'warning' : undefined}>{labels[plan.status]}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>项目：{plan.project_name} · 对象：{[...(plan.targets?.map(target => target.name) ?? []), ...(plan.flows?.map(flow => flow.name) ?? [])].join("、") || plan.target_name}</Typography.Text>
            <Typography.Text>环境：{plan.environment_name} · 模型：{plan.model}</Typography.Text>
            <Typography.Text>影响：{plan.steps.some(step => ['save_api','save_flow'].includes(step.operation)) ? '含正式保存：批准后自动采纳本计划候选，校验通过即写入所选对象的定义及正式版本。' : plan.steps.some(step => step.operation === 'execute_api') ? '真实发送获批请求，可能产生远端业务副作用；结果未知时不会自动重发。' : plan.steps.some(step => ['propose_api_change', 'create_api', 'propose_flow_change'].includes(step.operation)) ? '创建本机修改候选，审阅后应用到草稿；不会正式保存或发送请求。' : '只读取所选接口并发送脱敏内容，不修改、保存或发送接口请求。'}</Typography.Text>
            {plan.steps.map(step => <div key={step.step_id} style={{ borderLeft: '2px solid var(--border-color, #ddd)', paddingLeft: 12 }}>
              <Space><Typography.Text strong>{step.step_id} · {step.operation === 'save_api_response' ? '保存响应示例' : step.operation === 'create_api' ? '新建接口草稿' : ['save_api','save_flow'].includes(step.operation) ? '保存正式定义' : step.operation === 'execute_api' ? '执行' : ['propose_api_change', 'propose_flow_change'].includes(step.operation) ? '提议修改' : '读取'} {step.target_name ?? plan.target_name}</Typography.Text><Tag color={step.status === 'failed' ? 'error' : step.status === 'succeeded' ? 'success' : undefined}>{stepLabels[step.status]}</Tag></Space>
              <div><Typography.Text type="secondary">依赖：{step.dependencies_explicit ? (step.depends_on.length ? step.depends_on.join('、') : '无（独立步骤）') : `未声明，保守依赖${step.depends_on.length ? ` ${step.depends_on.join('、')}` : '此前步骤'}`} · 来源：{(step.source ?? plan.source) === 'draft' ? '未保存草稿' : '已保存定义'}</Typography.Text></div>
              {step.execution && <div><Typography.Text strong>{step.execution.method} {step.execution.url}</Typography.Text><ul>{step.execution.effects.map(effect => <li key={effect}>{effect}</li>)}</ul></div>}
              {step.changes !== undefined && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(step.changes, null, 2)}</pre>}
              {step.error && <Typography.Text type="danger">{step.error}</Typography.Text>}
            </div>)}
            {plan.error && <Alert type="warning" message={plan.error} />}
            {plan.explanation && <div style={{ whiteSpace: 'pre-wrap' }}>{plan.explanation}</div>}
            {plan.steps.some(step => step.result) && <details><summary>查看脱敏工具结果</summary><pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(plan.steps.map(({ step_id, status, result, error }) => ({ step_id, status, result, error })), null, 2)}</pre></details>}
            <Space>{plan.status === 'pending' && <><Button type="primary" onClick={() => void act('approvePlan', plan.plan_id)}>{plan.steps.some(step => ['save_api','save_flow'].includes(step.operation)) ? '批准修改与保存计划' : plan.steps.some(step => step.operation === 'create_api') ? '批准新建计划' : plan.steps.some(step => step.operation === 'execute_api') ? '批准执行计划' : plan.steps.some(step => ['propose_api_change', 'propose_flow_change'].includes(step.operation)) ? '批准修改计划' : '批准只读计划'}</Button><Button onClick={() => void act('rejectPlan', plan.plan_id)}>拒绝计划</Button></>}
              {['running', 'generating'].includes(plan.status) && <Button onClick={() => void act('cancelPlan', plan.plan_id)}>取消任务</Button>}
              {!['running', 'generating'].includes(plan.status) && <Button onClick={() => void act('deletePlan', plan.plan_id)}>删除计划记录</Button>}</Space>
          </Space>
        </Card>)}
      </Space>
    </Drawer>
  </>
}
