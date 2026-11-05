import { useEffect, useState } from 'react'
import { Alert, Button, Card, Checkbox, Drawer, Input, Select, Space, Tag, Typography } from 'antd'
import type { AgentPlan, AgentPlanStep } from '@shared/agentPlan'
import type { AgentConnection } from '@shared/agent'
import type { CaseRunResult, Environment, Flow, FlowEventResult, Result, TargetSummary } from '@shared/types'
import { flushAgentDrafts } from '../agentDraftSync'
import { useApp } from '../store'

const labels: Record<AgentPlan['status'], string> = { generating: '生成中', pending: '等待批准', running: '执行中', completed: '已完成', rejected: '已拒绝', paused: '需要重新确认', interrupted: '已中断' }
const stepLabels: Record<AgentPlanStep['status'], string> = { pending: '等待批准', running: '执行中', succeeded: '已完成', failed: '步骤失败', paused: '已暂停', unknown: '远端结果未知', cancelled: '发送前已取消', awaiting_approval: '等待新增授权' }
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data }
export default function AgentPlanPanel({ projectId, connection }: { projectId: string; connection: AgentConnection | null }): JSX.Element {
  const [mode, setMode] = useState<'read' | 'edit' | 'execute' | 'case-execute' | 'save' | 'create' | 'task'>('read')
  const create = mode === 'create', edit = mode === 'edit', caseExecute = mode === 'case-execute', execute = mode === 'execute' || mode === 'case-execute', save = mode === 'save', task = mode === 'task'
  const acceptsFlows = edit || save || mode === 'execute' || task
  const [createSave, setCreateSave] = useState(false)
  const [parentId, setParentId] = useState('0')
  const [folders, setFolders] = useState<TargetSummary[]>([])
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<AgentPlan[]>([])
  const [flows, setFlows] = useState<Flow[]>([]), [flowIds, setFlowIds] = useState<string[]>([])
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [targetIds, setTargetIds] = useState<string[]>(useApp.getState().activeId ? [useApp.getState().activeId!] : [])
  const [caseOptions, setCaseOptions] = useState<Array<{ targetId: string; caseId: string; value: string; label: string }>>([])
  const [selectedCases, setSelectedCases] = useState<string[]>([])
  const [environmentId, setEnvironmentId] = useState<string | undefined>()
  const [extraRequests, setExtraRequests] = useState('')
  const [writeVariables, setWriteVariables] = useState(false)
  const [saveResponse, setSaveResponse] = useState(false)
  const [goal, setGoal] = useState('解释当前接口')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resumeSelections, setResumeSelections] = useState<Record<string, string[]>>({})
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
  useEffect(() => {
    if (!open || !caseExecute) return
    let active = true
    void flushAgentDrafts().then(() => Promise.all(targetIds.map(async id => {
      const draft = unwrap(await window.api.agent.getDraft(projectId, id))
      return (draft.target.cases ?? []).filter(item => item.is_enabled !== 0).map(item => ({ targetId: id, caseId: item.case_id, value: `${id}:${item.case_id}`, label: `${draft.target.name} · ${item.name}` }))
    }))).then(lists => {
      if (!active) return
      const options = lists.flat(); setCaseOptions(options); setSelectedCases(previous => previous.filter(value => options.some(option => option.value === value)))
    }).catch(e => active && setError(e.message))
    return () => { active = false }
  }, [open, caseExecute, projectId, targetIds])
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
    if (!create && !targetIds.length && !(acceptsFlows && flowIds.length)) return
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
      if (task) { unwrap(await window.api.agent.proposeTaskPlan(projectId, { goal, targetIds, flowIds, environmentId, execution: { requests, writeVariables, saveResponse }, drafts, draftRevisions, connectionId: connection?.connection_id })); return }
      unwrap(await window.api.agent[save ? 'proposeSavePlan' : caseExecute ? 'proposeExecuteCasePlan' : execute ? 'proposeExecutePlan' : edit ? 'proposeEditPlan' : 'proposeReadPlan'](projectId, { goal, targetId: targetIds[0] ?? '', targetIds, flowIds: acceptsFlows ? flowIds : undefined, environmentId, drafts, draftRevisions, ...(caseExecute ? { caseIds: Object.fromEntries(targetIds.map(id => [id, caseOptions.filter(option => option.targetId === id && selectedCases.includes(option.value)).map(option => option.caseId)])) } : {}), ...(execute ? { execution: { requests, writeVariables, saveResponse: caseExecute ? false : saveResponse } } : {}), connectionId: connection?.connection_id }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function act(action: 'approvePlan' | 'rejectPlan' | 'deletePlan' | 'cancelPlan', id: string): Promise<void> {
    setError('')
    try {
      if (action === 'approvePlan') await flushAgentDrafts()
      const plan = plans.find(item => item.plan_id === id)
      unwrap(await (action === 'approvePlan' ? window.api.agent.approvePlan(projectId, id, plan?.approval_revision ?? 1) : window.api.agent[action](projectId, id)) as Result<unknown>)
    }
    catch (e) { setError((e as Error).message) }
  }
  async function resume(plan: AgentPlan): Promise<void> {
    setError('')
    try {
      unwrap(await window.api.agent.resumePlan(projectId, plan.plan_id, resumeSelections[plan.plan_id] ?? []))
      setResumeSelections(previous => ({ ...previous, [plan.plan_id]: [] }))
    } catch (e) { setError((e as Error).message) }
  }
  return <>
    <Button onClick={() => { setMode('read'); void show('read') }}>只读计划</Button>
    <Button onClick={() => { setMode('edit'); void show('edit') }}>修改草稿</Button>
    <Button onClick={() => { setMode('execute'); void show('execute') }}>执行草稿</Button>
    <Button onClick={() => { setMode('case-execute'); void show('case-execute') }}>执行接口用例</Button>
    <Button onClick={() => { setMode('save'); void show('save') }}>修改并保存</Button>
    <Button onClick={() => { setMode('create'); void show('create') }}>新建接口草稿</Button>
    <Button onClick={() => { setMode('task'); void show('task') }}>连续任务</Button>
    <Drawer title={task ? '连续任务计划' : create ? '新建接口草稿计划' : save ? '项目修改与正式保存计划' : caseExecute ? '接口用例执行计划' : execute ? '项目草稿执行计划' : edit ? '项目草稿修改计划' : '项目只读计划'} width={760} open={open} onClose={() => setOpen(false)}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text>{task ? '连续任务先规划有限槽位；批准前模型只看到目标与选择元数据。批准后读取脱敏内容，再由模型绑定修改、采纳、执行或保存。范围扩大或冲突会暂停并生成新的批准版本。' : create ? '描述新接口及已确认的业务规则。批准新建只产生本机草稿和候选；缺少规则时保留草稿并暂停澄清。' : '选择接口并描述目标。批准前只向模型发送目标和对象编号；批准后发送所选接口的脱敏内容，优先使用当前草稿。'}</Typography.Text>
        {save && <Alert type="warning" message="保存必须作为独立步骤展示。批准后自动采纳本计划候选并校验保存，不会再次确认；缺少业务规则或存在冲突会暂停。" />}
        {!capable && <Alert type="info" message="请先选择已检测工具能力的连接；Chat Completions 和 Responses 均可使用只读计划。" />}
        {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
        <Input aria-label="计划目标" value={goal} onChange={event => setGoal(event.target.value)} maxLength={10000} />
        {!create && <Select mode="multiple" aria-label="计划接口" placeholder="选择一个或多个接口" style={{ width: '100%' }} value={targetIds} onChange={setTargetIds} options={targets.map(target => ({ value: target.target_id, label: `${target.method} ${target.name}` }))} />}
        {caseExecute && <Select mode="multiple" aria-label="计划用例" placeholder="选择需要执行的已启用用例" style={{ width: '100%' }} value={selectedCases} onChange={setSelectedCases} options={caseOptions} />}
        {acceptsFlows && <Select mode="multiple" aria-label="计划 Flow" placeholder="选择 Execution Flow" style={{ width: '100%' }} value={flowIds} onChange={setFlowIds} options={flows.map(flow => ({ value: flow.flow_id, label: flow.name }))} />}
        {create && <><Select aria-label="新接口父目录" value={parentId} onChange={setParentId} style={{ width: '100%' }} options={[{ value: '0', label: '项目根目录' }, ...folders.map(folder => ({ value: folder.target_id, label: folder.name }))]} /><Checkbox checked={createSave} onChange={event => setCreateSave(event.target.checked)}>允许提出独立正式保存步骤</Checkbox></>}
        {!create && <Select aria-label="计划环境" placeholder={execute ? '无环境（不使用默认环境）' : '不读取环境'} allowClear style={{ width: '100%' }} value={environmentId} onChange={setEnvironmentId} options={environments.map(env => ({ value: env.env_id, label: env.name }))} />}
        {(execute || task) && <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>现有脚本和配置的上传文件会在计划中列出；额外请求须明确列出方法、完整地址和最多次数。</Typography.Text>
          <Input.TextArea aria-label="额外请求授权" placeholder="GET https://example.com/login 1" value={extraRequests} onChange={event => setExtraRequests(event.target.value)} />
          <Checkbox checked={writeVariables} onChange={event => setWriteVariables(event.target.checked)}>允许环境与全局变量差量写回（冲突暂停）</Checkbox>
          {!caseExecute && <Checkbox checked={saveResponse} onChange={event => setSaveResponse(event.target.checked)}>添加独立保存响应示例步骤（不保存其他草稿）</Checkbox>}
        </Space>}
        <Button type="primary" disabled={!capable || (caseExecute && !selectedCases.length) || (!create && ((!targetIds.length && !(acceptsFlows && flowIds.length)) || targetIds.length + (acceptsFlows ? flowIds.length : 0) > 32)) || !goal.trim()} loading={busy} onClick={() => void generate()}>{task ? '生成连续任务计划' : create ? '生成新建计划' : save ? '生成修改与保存计划' : execute ? '生成执行计划' : edit ? '生成草稿修改计划' : '生成只读计划'}</Button>
        {plans.map(plan => <Card key={plan.plan_id} size="small" title={plan.goal} extra={<Tag color={plan.status === 'pending' ? 'warning' : undefined}>{labels[plan.status]}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>项目：{plan.project_name} · 对象：{[...(plan.targets?.map(target => target.name) ?? []), ...(plan.flows?.map(flow => flow.name) ?? [])].join("、") || plan.target_name}</Typography.Text>
            <Typography.Text>环境：{plan.environment_name} · 模型：{plan.model}</Typography.Text>
            <Typography.Text>影响：{[plan.steps.some(step => ['read_api','read_flow'].includes(step.operation)) ? '读取脱敏内容' : null, plan.steps.some(step => ['propose_api_change','create_api','propose_flow_change'].includes(step.operation)) ? '创建本机候选' : null, plan.steps.some(step => step.operation === 'apply_candidate') ? '显式采纳到草稿' : null, plan.steps.some(step => ['execute_api','execute_api_case','execute_flow'].includes(step.operation)) ? '真实发送获批请求，结果未知不重发' : null, plan.steps.some(step => ['save_api','save_flow','save_api_response'].includes(step.operation)) ? '写入正式定义或响应示例' : null].filter(Boolean).join('；') || '无业务副作用'} · 授权版本 v{plan.approval_revision ?? 1}</Typography.Text>
            {plan.steps.map(step => <div key={step.step_id} style={{ borderLeft: '2px solid var(--border-color, #ddd)', paddingLeft: 12 }}>
              <Space><Typography.Text strong>{step.step_id} · {step.operation === 'save_api_response' ? '保存响应示例' : step.operation === 'create_api' ? '新建接口草稿' : ['save_api','save_flow'].includes(step.operation) ? '保存正式定义' : ['execute_api', 'execute_api_case', 'execute_flow'].includes(step.operation) ? (step.case_id ? `执行用例 ${step.case_name ?? step.case_id} ·` : '执行') : step.operation === 'apply_candidate' ? '采纳候选到草稿' : step.operation === 'read_flow' ? '读取 Flow' : ['propose_api_change', 'propose_flow_change'].includes(step.operation) ? '提议修改' : '读取'} {step.target_name ?? plan.target_name}</Typography.Text><Tag color={step.status === 'failed' ? 'error' : step.status === 'succeeded' ? 'success' : undefined}>{stepLabels[step.status]}</Tag></Space>
              <div><Typography.Text type="secondary">依赖：{step.dependencies_explicit ? (step.depends_on.length ? step.depends_on.join('、') : '无（独立步骤）') : `未声明，保守依赖${step.depends_on.length ? ` ${step.depends_on.join('、')}` : '此前步骤'}`} · 来源：{(step.source ?? plan.source) === 'draft' ? '未保存草稿' : '已保存定义'}</Typography.Text></div>
              {step.execution && <div><Typography.Text strong>{step.execution.method} {step.execution.url}</Typography.Text><ul>{step.execution.effects.map(effect => <li key={effect}>{effect}</li>)}</ul></div>}
              {step.binding && <div><Typography.Text type="secondary">绑定：{step.binding === 'deferred' ? '读取后生成' : '批准时固定'}{step.intent ? ` · ${step.intent}` : ''}{step.allowed_changes?.length ? ` · 允许字段：${step.allowed_changes.join('、')}` : ''}</Typography.Text></div>}
            {step.source_steps?.length ? <div><Typography.Text type="secondary">来源步骤：{step.source_steps.join('、')}</Typography.Text></div> : null}
            {step.changes !== undefined && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(step.changes, null, 2)}</pre>}
              <CaseResult step={step} />
              <FlowResults step={step} />
              {plan.can_resume && step.retryable && <Checkbox checked={(resumeSelections[plan.plan_id] ?? []).includes(step.step_id)} onChange={event => setResumeSelections(previous => ({ ...previous, [plan.plan_id]: event.target.checked ? [...(previous[plan.plan_id] ?? []), step.step_id] : (previous[plan.plan_id] ?? []).filter(id => id !== step.step_id) }))}>选择恢复此未完成步骤</Checkbox>}
              {step.error && <Typography.Text type="danger">{step.error}</Typography.Text>}
            </div>)}
            {plan.error && <Alert type="warning" message={plan.error} />}
            {plan.explanation && <div style={{ whiteSpace: 'pre-wrap' }}>{plan.explanation}</div>}
            {plan.steps.some(step => step.result) && <details><summary>查看脱敏工具结果</summary><pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(plan.steps.map(({ step_id, status, result, error }) => ({ step_id, status, result, error })), null, 2)}</pre></details>}
            {plan.can_resume && <><Typography.Text>已成功的步骤和循环迭代会保留；结果未知或已发送的失败请求不会自动重发。选择未完成步骤后生成新一轮待审批计划。</Typography.Text><Button disabled={!(resumeSelections[plan.plan_id]?.length)} onClick={() => void resume(plan)}>生成恢复计划（需重新批准）</Button></>}
            <Space>{(plan.status === 'pending' || (plan.status === 'paused' && plan.steps.some(step => step.status === 'awaiting_approval'))) && <><Button type="primary" onClick={() => void act('approvePlan', plan.plan_id)}>{plan.steps.some(step => step.status === 'awaiting_approval') ? '批准新增范围' : plan.steps.some(step => ['save_api','save_flow'].includes(step.operation)) ? '批准修改与保存计划' : plan.steps.some(step => step.operation === 'create_api') ? '批准新建计划' : plan.steps.some(step => ['execute_api', 'execute_api_case', 'execute_flow'].includes(step.operation)) ? '批准执行计划' : plan.steps.some(step => ['propose_api_change', 'propose_flow_change'].includes(step.operation)) ? '批准修改计划' : '批准只读计划'}</Button><Button onClick={() => void act('rejectPlan', plan.plan_id)}>拒绝计划</Button></>}
              {['running', 'generating'].includes(plan.status) && <Button onClick={() => void act('cancelPlan', plan.plan_id)}>取消任务</Button>}
              {!['running', 'generating'].includes(plan.status) && <Button onClick={() => void act('deletePlan', plan.plan_id)}>删除计划记录</Button>}</Space>
          </Space>
        </Card>)}
      </Space>
    </Drawer>
  </>
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
