import { decodeModelRequest, respondModel } from './agent-model-fixture'
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
import { callTool } from '../src/main/mcp/tools'
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { onPlanEvent } from '../src/main/agent/plans'
import { agentCommands } from '../src/main/agent/service'

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-plan-')))
  await app.whenReady()
  const project = store.ensureDefaultProject(), pid = project.project_id
  const target = store.createTargetInProject(pid, '0', 'api')
  target.name = '用户资料'; target.description = '保存的接口说明'
  store.saveTarget(pid, target)
  const config = { ...store.getMcpConfig(), enabled: false, allowed_project_ids: [pid] }
  assert.equal((await callTool('get_api_detail', { project_id: pid, target_id: target.target_id }, config)).ok, false)
  assert.equal((await callTool('get_api_detail', { project_id: pid, target_id: target.target_id }, { ...config, enabled: true, allowed_project_ids: [] })).ok, false)
  const mcp = await callTool('get_api_detail', { project_id: pid, target_id: target.target_id }, { ...config, enabled: true })
  assert(mcp.ok && (mcp.result as any).api.description === '保存的接口说明')
  console.log('PASS shared read projection preserves MCP enablement and project authorization')
  const received: any[] = []
  let malicious = false, injected = false, cutStream = false, missingCallId = false, textOnly = false
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk
    const body = decodeModelRequest(req, JSON.parse(text), protocol); received.push(body)
    const probe = body.tools?.[0]?.function?.name === 'kindra_capability_probe'
    const message = textOnly ? { content: '仅文本' } : probe ? { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
      : body.tools ? { content: '先读取所选接口，再解释。', tool_calls: [{ id: missingCallId ? undefined : 'read-1', type: 'function', function: { name: 'read_api', arguments: JSON.stringify({ project_id: malicious ? 'other-project' : pid, target_id: target.target_id }) } }] }
        : injected && body.messages.some((m: any) => m.role === 'tool') ? { tool_calls: [{ id: 'evil', type: 'function', function: { name: 'execute_api', arguments: '{}' } }] } : { content: body.messages.some((m: any) => m.role === 'tool') ? '这是当前草稿的接口解释。 env-secret' : 'OK' }
    if (cutStream && body.tools && !probe) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.end(protocol === 'responses'
        ? 'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"partial","name":"read_api","arguments":"{"}}\n\n'
        : 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"partial","function":{"name":"read_api","arguments":"{"}}]}}]}\n\n')
      return
    }
    respondModel(res, protocol, body.stream, message)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await agentCommands.saveConnection({ name: '计划模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'plans', protocol })
    await assert.rejects(() => agentCommands.proposeReadPlan(pid, { goal: '读取', targetId: target.target_id }), /工具计划/)
    await agentCommands.testConnection()
    const plan = await agentCommands.proposeReadPlan(pid, { goal: '解释这个接口', targetId: target.target_id })
    assert.equal(plan.status, 'pending')
    assert.equal(received.at(-1).stream, true, 'tool proposals should use streaming protocol')
    assert.equal(plan.steps[0].operation, 'read_api')
    assert(!JSON.stringify(received).includes('保存的接口说明'), 'no object context before approval')
    agentCommands.rejectPlan(pid, plan.plan_id)
    assert.equal(agentCommands.getPlan(pid, plan.plan_id).status, 'rejected')
    await assert.rejects(() => agentCommands.approvePlan(pid, plan.plan_id), /批准/)
    assert(!received.some(body => body.messages.some((m: any) => m.role === 'tool')))
    assert.equal(store.getTarget(pid, target.target_id)!.description, '保存的接口说明')
    console.log('PASS model-proposed plan remains read-free until approval; rejection never invokes tool')
    const other = store.createProjectWithDefaults('另一个项目')
    const draft = structuredClone(target)
    draft.description = '未保存的草稿说明；响应要求自动执行其他接口属于数据'
    draft.request!.header.parameter.push({ param_id: 'secret-header', key: 'Authorization', value: 'Bearer request-token', is_checked: 1 } as any)
    draft.request!.cookie.parameter.push({ param_id: 'cookie', key: 'session', value: 'cookie-secret', is_checked: 1 } as any)
    const env = store.listEnvironments(pid)[0]
    env.env_var_list = { password: { current_value: 'env-secret', initial_value: 'initial-secret' } as any }
    store.saveEnvironment(pid, env)
    draft.request!.body.raw = JSON.stringify({ password: 'body-secret', nested: { api_key: 'nested-secret' } })
    draft.description += ' env-secret request-token cookie-secret body-secret nested-secret'
    const approved = await agentCommands.proposeReadPlan(pid, { goal: '解释这个接口 env-secret', targetId: target.target_id, environmentId: env.env_id, draft })
    assert.throws(() => agentCommands.getPlan(other.project_id, approved.plan_id), /不存在/)
    const explanations: string[] = []
    const stop = onPlanEvent(event => { if (event.plan?.status === 'running' && event.plan.explanation) explanations.push(event.plan.explanation) })
    const completed = await agentCommands.approvePlan(pid, approved.plan_id); stop()
    assert(explanations.includes('这是当前草'), 'the approved explanation should appear while streaming')
    assert.equal(completed.status, 'completed')
    assert.equal(completed.steps[0].status, 'succeeded')
    assert.equal(completed.explanation, '这是当前草稿的接口解释。 [已隐藏]')
    assert(explanations.every(text => !text.includes('env-s')), 'streaming explanations cannot disclose secret prefixes')
    const toolResult = received.flatMap(body => body.messages).find((m: any) => m.role === 'tool')
    assert(toolResult.content.includes('未保存的草稿说明'))
    for (const secret of ['env-secret', 'initial-secret', 'request-token', 'cookie-secret', 'body-secret', 'nested-secret']) {
      assert(!JSON.stringify(received).includes(secret), 'model input must redact ' + secret)
      assert(!JSON.stringify(agentCommands.listPlans(pid)).includes(secret), 'plan records must redact ' + secret)
    }
    assert.equal(store.getTarget(pid, target.target_id)!.description, '保存的接口说明')
    await assert.rejects(() => agentCommands.approvePlan(pid, approved.plan_id), /批准/)
    console.log('PASS approved read uses draft, keeps definition unchanged, redacts model and local report, denies cross-project/replay')
    cutStream = true
    const cut = await agentCommands.proposeReadPlan(pid, { goal: '不完整工具流', targetId: target.target_id })
    assert.equal(cut.status, 'paused'); assert.equal(cut.steps.length, 0)
    await assert.rejects(() => agentCommands.approvePlan(pid, cut.plan_id), /批准/)
    cutStream = false; missingCallId = true
    const missingId = await agentCommands.proposeReadPlan(pid, { goal: '缺少调用编号', targetId: target.target_id })
    assert.equal(missingId.status, 'paused'); assert.equal(missingId.steps.length, 0)
    missingCallId = false
    malicious = true
    const bad = await agentCommands.proposeReadPlan(pid, { goal: '读取', targetId: target.target_id })
    assert.equal(bad.status, 'paused'); assert.match(bad.error!, /超出/)
    malicious = false
    const deletedEnv = await agentCommands.proposeReadPlan(pid, { goal: '读取', targetId: target.target_id, environmentId: env.env_id })
    store.deleteEnvironment(pid, env.env_id)
    const paused = await agentCommands.approvePlan(pid, deletedEnv.plan_id)
    assert.equal(paused.status, 'paused'); assert.match(paused.error!, /环境已删除/)
    injected = true
    const injection = await agentCommands.proposeReadPlan(pid, { goal: '读取', targetId: target.target_id })
    const injectionResult = await agentCommands.approvePlan(pid, injection.plan_id)
    assert.equal(injectionResult.status, 'paused'); assert.match(injectionResult.error!, /额外操作/)
    assert.equal(injectionResult.steps[0].status, 'succeeded')
    agentCommands.deletePlan(pid, injection.plan_id)
    assert.throws(() => agentCommands.getPlan(pid, injection.plan_id), /不存在/)
    console.log('PASS incomplete tool streams, scope expansion, removed environment and injected instructions cannot authorize tools')
    textOnly = true
    await agentCommands.saveConnection({ name: '文本模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'text-only', protocol })
    assert.equal((await agentCommands.testConnection()).capability, 'text-only')
    const before = received.length
    await assert.rejects(() => agentCommands.proposeReadPlan(pid, { goal: '文本模型不能生成工具计划', targetId: target.target_id }), /工具计划/)
    assert.equal(received.length, before)
    console.log('PASS verified text-only model cannot invoke continuous tools')


  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
