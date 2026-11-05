import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import { callTool } from '../src/main/mcp/tools'
import { agentCommands as commands } from '../src/main/agent/service'
async function main(): Promise<void> {
 app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-17-'))); await app.whenReady()
 const pid = store.ensureDefaultProject().project_id
 const flow = createFlow(pid, '流程'); flow.events = [createFlowEvent('wait'), createFlowEvent('wait')]; flow.events[0].name = '原节点'; store.saveFlow(pid, flow)
 const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
 let forcedCalls: Array<{ name: string; args: unknown }> | undefined
 const received: unknown[] = []
 const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw); received.push(body)
  const name = body.tools?.find((t: any) => (t.function?.name ?? t.name) === 'propose_flow_change')?.function?.name ?? body.tools?.find((t: any) => t.name === 'propose_flow_change')?.name ?? body.tools?.[0]?.function?.name ?? body.tools?.[0]?.name
  const args = name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, flow_id: flow.flow_id, patch: { events: flow.events.map((e, i) => i ? e : { ...e, name: 'Agent 节点', wait_ms: 7 }) }, depends_on: [] }
  const calls = name ? (name === 'kindra_capability_probe' ? [{ name, args }] : forcedCalls ?? [{ name, args }]).map((c, i) => ({ id: `c${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) : []
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(protocol === 'responses' ? { id: 'resp-flow', status: 'completed', output: calls.length ? calls.map(c => ({ type: 'function_call', call_id: c.id, ...c.function })) : [{ type: 'message', content: [{ type: 'output_text', text: '候选待审阅' }] }] } : { choices: [{ message: calls.length ? { tool_calls: calls } : { content: '候选待审阅' } }] }))
 }); await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
 try {
  await commands.saveConnection({ name: 'Flow', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'flow', protocol }); await commands.testConnection()
  const plan = await commands.proposeEditPlan(pid, { targetId: '', targetIds: [], flowIds: [flow.flow_id], goal: '修改节点' })
  assert.equal(plan.status, 'pending'); assert.equal(commands.listFlowCandidates(pid).length, 0)
  assert.equal((await commands.approvePlan(pid, plan.plan_id)).status, 'completed')
  const candidate = commands.listFlowCandidates(pid)[0]; assert.equal(candidate.number, 'P1')
  assert.equal(commands.getFlowDraft(pid, flow.flow_id).flow.events[0].name, '原节点')
  const human = structuredClone(flow); human.events[0].name = '人工节点'; human.events[1].wait_ms = 42
  commands.syncFlowEditorDraft(pid, human)
  const applied = commands.applyFlowCandidate(pid, candidate.candidate_id)
  assert.equal(applied.status, 'conflict'); assert.equal(applied.merge!.conflicts[0].path, `/events/event_id=${flow.events[0].event_id}/name`)
  const draft = commands.getFlowDraft(pid, flow.flow_id); assert.equal(draft.flow.events[0].wait_ms, 7); assert.equal(draft.flow.events[1].wait_ms, 42)
  assert.throws(() => store.saveFlow(pid, draft.flow), /冲突/)
  assert.equal(store.getFlow(pid, flow.flow_id)!.events[0].name, '原节点')
  const done = commands.resolveFlowCandidate(pid, candidate.candidate_id, applied.merge!.review_id, { [applied.merge!.conflicts[0].id]: 'agent' })
  assert.equal(done.status, 'applied'); assert.equal(commands.getFlowDraft(pid, flow.flow_id).flow.events[0].name, 'Agent 节点')
  assert.throws(() => commands.saveManualFlowForRun(pid, commands.getFlowDraft(pid, flow.flow_id).flow), /主动保存/)
  const stashDraft = commands.getFlowDraft(pid, flow.flow_id).flow; stashDraft.description = '退出前未保存 Flow'; commands.syncFlowEditorDraft(pid, stashDraft)
  commands.stashAgentFlowDrafts(); const count = commands.listFlowCandidates(pid).length; commands.stashAgentFlowDrafts(); assert.equal(commands.listFlowCandidates(pid).length, count)
  const stashFlow = commands.listFlowCandidates(pid).find(c => c.plan_id === 'exit-stash')!
  assert.equal(stashFlow.status, 'pending', 'Flow exit stash must stay awaiting confirmation')
  assert.equal(stashFlow.application, undefined, 'Flow exit stash must not record an applied change')
  assert.equal(store.getFlow(pid, flow.flow_id)!.events[0].name, '原节点')
  const target = store.createTargetInProject(pid, '0', 'api')
  forcedCalls = [{ name: 'propose_api_change', args: { project_id: pid, target_id: target.target_id, patch: { name: 'API 名称' }, step_id: 'api', depends_on: [] } }, { name: 'propose_flow_change', args: { project_id: pid, flow_id: flow.flow_id, patch: { description: 'Flow 说明' }, step_id: 'flow', depends_on: ['api'] } }]
  const mixed = await commands.proposeEditPlan(pid, { targetId: target.target_id, flowIds: [flow.flow_id], goal: '同轮改API与Flow' })
  assert.equal(mixed.status, 'pending'); assert.equal((await commands.approvePlan(pid, mixed.plan_id)).status, 'completed')
  const apiCandidate = commands.listCandidates(pid, target.target_id)[0], flowCandidate = commands.listFlowCandidates(pid)[0]
  assert.equal(Number(flowCandidate.number.slice(1)), Number(apiCandidate.number.slice(1)) + 1)
  assert.equal(mixed.steps[1].flow_id, flow.flow_id); assert.equal(mixed.steps[1].target_id, '')
  commands.rejectFlowCandidate(pid, flowCandidate.candidate_id)
  assert.deepEqual(commands.listFlowCandidates(pid)[0].proposal, flowCandidate.proposal)
  forcedCalls = [{ name: 'save_api', args: { project_id: pid, flow_id: flow.flow_id } }]
  assert.equal((await commands.proposeEditPlan(pid, { targetId: '', flowIds: [flow.flow_id], goal: '拒绝扩权' })).status, 'paused')
  forcedCalls = [{ name: 'propose_flow_change', args: { project_id: pid, flow_id: flow.flow_id, patch: { events: [flow.events[0], flow.events[0]] } } }]
  assert.equal((await commands.proposeEditPlan(pid, { targetId: '', flowIds: [flow.flow_id], goal: '拒绝重复ID' })).status, 'paused')
  forcedCalls = [{ name: 'propose_flow_change', args: { project_id: pid, flow_id: flow.flow_id, patch: { events: [{ ...flow.events[0], input: 'invalid' }] } } }]
  assert.equal((await commands.proposeEditPlan(pid, { targetId: '', flowIds: [flow.flow_id], goal: '拒绝错误输入类型' })).status, 'paused')
  assert(!JSON.stringify(received).includes('target_type'), 'Flow is never represented as an API Target')
  const config = { ...store.getMcpConfig(), enabled: true, allow_write: true, allow_execute: true, allowed_project_ids: [pid] }
  const args = { project_id: pid, flow_id: flow.flow_id, description: 'MCP 人工保存' }
  for (const denied of [{ enabled: false }, { allow_write: false }, { allow_execute: false }, { allowed_project_ids: [] }]) assert.equal((await callTool('update_execution_flow', args, { ...config, ...denied })).ok, false)
  assert.equal((await callTool('update_execution_flow', args, config)).ok, true)
  assert.equal(store.getFlow(pid, flow.flow_id)!.description, 'MCP 人工保存')
  const projectFiles = fs.readdirSync(path.join(store.getPaths().projectRoot, pid), { recursive: true }) as string[]
  for (const name of projectFiles) { const file = path.join(store.getPaths().projectRoot, pid, name); if (fs.statSync(file).isFile()) assert(!fs.readFileSync(file, 'utf8').includes(candidate.candidate_id)) }
  console.log(protocol, 'PASS Flow approved proposal, stable event merge, conflict save barrier, draft-only application and stash dedup')
 } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
}
main().then(() => app.exit(0)).catch(e => { console.error(e); app.exit(1) })
