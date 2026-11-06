import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
async function main(): Promise<void> {
 app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-20-'))); await app.whenReady()
 const pid = store.ensureDefaultProject().project_id, env = store.listEnvironments(pid)[0]
 env.env_var_list.origin = { current_value: 'http://127.0.0.1:1', initial_value: '', is_checked: 1 }; env.env_var_list.phase = { current_value: 'before', initial_value: '', is_checked: 1 }; store.saveEnvironment(pid, env)
 const hits: string[] = [], localHeaders: unknown[] = []
 let afterHit: (() => void) | undefined
 const api = http.createServer((req, res) => { hits.push(req.url!); localHeaders.push(req.headers['x-local']); afterHit?.(); if (req.url === '/drop') { req.socket.destroy(); return }; res.end('{"ok":true}') })
 await new Promise<void>(r => api.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${(api.address() as any).port}`
 const a = store.createTargetInProject(pid, '0', 'api'); a.url = `${base}/first`; a.request!.test = "pm.environment.set('phase', 'ready'); pm.variables.set('fromRequest', 'available')"; store.saveTarget(pid, a)
 const flow = createFlow(pid, '条件循环'); store.saveFlow(pid, flow)
 const model = http.createServer(async (req, res) => { let raw = ''; for await (const c of req) raw += c; const b = decodeModelRequest(req, JSON.parse(raw), protocol), name = b.tools?.find((t: any) => t.function.name === 'execute_flow')?.function.name ?? b.tools?.[0]?.function.name; respondModel(res, protocol, b.stream, name ? { tool_calls: [{ id: 'flow', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, flow_id: flow.flow_id, depends_on: [] }) } }] } : { content: '已按实际节点结果解释，不回滚远端操作' }) })
 await new Promise<void>(r => model.listen(0, '127.0.0.1', r))
 const event = (type: Parameters<typeof createFlowEvent>[0], extra = {}) => ({ ...createFlowEvent(type), ...extra })
 const run = async (events: typeof flow.events, execution = {}) => { commands.syncFlowEditorDraft(pid, { ...flow, events }); const plan = await commands.proposeExecutePlan(pid, { goal: '条件循环', targetId: '', flowIds: [flow.flow_id], environmentId: env.env_id, execution }); assert.equal(plan.status, 'pending', JSON.stringify(plan)); return { plan, done: await commands.approvePlan(pid, plan.plan_id) } }
 try {
  await commands.saveConnection({ name: 'control', base_url: `http://127.0.0.1:${(model.address() as any).port}/v1`, model: 'control', protocol }); await commands.testConnection()
  const execution = await run([
   event('api', { target_id: a.target_id }),
   event('if', { condition: 'env.phase === "ready" && vars.fromRequest === "available"', children: [event('script', { script: "pm.variables.set('marker', 'local'); pm.environment.set('phase', 'scripted'); pm.test('no host', () => { if (typeof process !== 'undefined' || typeof require !== 'undefined') throw Error('host exposed') });" }), event('loop', { loop_count: 3, children: [event('request', { url: `${base}/loop`, input: { query: { phase: '{{phase}}', index: '{{loop_index}}' } }, headers: [{ key: 'X-Local', value: '{{marker}}' }] })] })] }),
   event('if', { condition: 'false', children: [event('request', { url: `${base}/forbidden` })] })
  ])
  assert.equal(execution.done.status, 'completed', JSON.stringify(execution.done)); assert.deepEqual(hits, ['/first', '/loop?phase=scripted&index=0', '/loop?phase=scripted&index=1', '/loop?phase=scripted&index=2'])
  assert.deepEqual(localHeaders.slice(1, 4), ['local', 'local', 'local'])
  assert.match(JSON.stringify(execution.plan), /最多 3 次/); assert.equal(store.listEnvironments(pid)[0].env_var_list.phase.current_value, 'before')
  for (const probe of ["this.constructor.constructor('return typeof process')()", "pm.environment.get.constructor('return typeof process')()", "env.constructor.constructor('return typeof process')()", "({}).constructor.constructor('return typeof process')()"] ) {
   const before = hits.length
   const tested = await run([event('script', { script: probe }), event('request', { url: `${base}/forbidden` })])
   assert.equal(tested.done.steps[0].status, 'failed', probe); assert.equal(hits.length, before)
  }
  for (const condition of ["typeof process === 'undefined' && typeof require === 'undefined'", "JSON.constructor('return typeof process')() === 'undefined'"]) {
   const tested = await run([event('if', { condition, children: [event('request', { url: `${base}/safe` })] })])
   assert.equal(tested.done.steps[0].status, condition.startsWith('typeof') ? 'succeeded' : 'failed')
  }
  const stackProbe = await run([event('script', { script: `
   Error.prepareStackTrace = (_, frames) => frames;
   const frames = new Error().stack;
   for (const frame of frames) { const fn = frame.getFunction(); if (fn) { try { const kind = fn.constructor('return typeof process')(); if (kind !== 'undefined') throw Error('host process exposed'); } catch(e) { if (e.message === 'host process exposed') throw e; } } }
   pm.test('host globals absent', () => { pm.expect(typeof process).to.equal('undefined'); pm.expect(typeof require).to.equal('undefined'); pm.expect(typeof Buffer).to.equal('undefined'); pm.expect(typeof fetch).to.equal('undefined'); });
  ` })])
  assert.equal(stackProbe.done.status, 'completed', JSON.stringify(stackProbe.done))
  const extra = store.createTargetInProject(pid, '0', 'api'); extra.url = `${base}/extra-main`; extra.request!.pre_script = `pm.sendRequest('${base}/extra-call')`; store.saveTarget(pid, extra)
  const extraBefore = hits.length
  const extraRun = await run([event('loop', { loop_count: 2, children: [event('api', { target_id: extra.target_id })] })], { requests: [{ method: 'GET', url: `${base}/extra-call`, maxCalls: 1 }] })
  assert.equal(extraRun.done.status, 'completed'); assert.deepEqual(hits.slice(extraBefore), ['/extra-call', '/extra-main', '/extra-call', '/extra-main']); assert.match(JSON.stringify(extraRun.plan), /所有循环累计最多 2 次/)
  const escapeBefore = hits.length
  const escaped = await run([event('script', { script: `pm.environment.set('origin', '${base}/forbidden')` }), event('request', { url: '{{origin}}/allowed' })])
  assert.equal(escaped.done.steps[0].status, 'paused'); assert.equal(hits.length, escapeBefore)
  const write = await run([event('script', { script: "pm.environment.set('phase', 'writeback'); pm.globals.set('control', 'written')" })], { writeVariables: true })
  assert.equal(write.done.status, 'completed'); assert.equal(store.listEnvironments(pid)[0].env_var_list.phase.current_value, 'writeback'); assert.equal(store.getGlobalVars(pid).vars.control.current_value, 'written')
  store.saveEnvironment(pid, env)
  for (const count of [0, 1.5, 51]) {
   commands.syncFlowEditorDraft(pid, { ...flow, events: [event('loop', { loop_count: count })] })
   await assert.rejects(commands.proposeExecutePlan(pid, { goal: '越界循环', targetId: '', flowIds: [flow.flow_id], environmentId: env.env_id }), /循环/)
  }
  const rotated = await run([event('loop', { loop_count: 2, children: [event('script', { script: "pm.environment.set('opaque', 'rotation-' + pm.variables.get('loop_index'))" }), event('request', { url: `${base}/rotated`, input: { query: { opaque: '{{opaque}}' } } })] }), event('script', { script: "pm.environment.unset('opaque')" })])
  assert.equal(rotated.done.status, 'completed')
  for (const value of ['rotation-0', 'rotation-1']) assert(!JSON.stringify(commands.getPlan(pid, rotated.plan.plan_id)).includes(value), 'earlier runtime variable leaked after rotation')
  const ephemeral = await run([event('script', { script: "pm.variables.set('temporary', ['ephemeral', 'secret'].join('-')); console.log(pm.variables.get('temporary')); pm.variables.unset('temporary')" })])
  assert.equal(ephemeral.done.status, 'completed'); assert(!JSON.stringify(ephemeral.done).includes('ephemeral-secret'))
  const failedCount = hits.length
  const failed = await run([event('loop', { loop_count: 4, children: [event('request', { url: `${base}/failed`, assertions: [{ assert_id: 'status', type: 'status', expected: 201 }] }), event('request', { url: `${base}/forbidden` })] }), event('request', { url: `${base}/forbidden` })])
  assert.equal(failed.done.steps[0].status, 'failed'); assert.equal(hits.length, failedCount + 1)
  const droppedCount = hits.length
  const dropped = await run([event('loop', { loop_count: 4, children: [event('request', { url: `${base}/drop` })] })])
  assert.equal(dropped.done.steps[0].status, 'unknown'); assert.equal(hits.length, droppedCount + 1)
  await assert.rejects(commands.approvePlan(pid, dropped.plan.plan_id)); assert.equal(hits.length, droppedCount + 1)
  commands.syncFlowEditorDraft(pid, { ...flow, events: [event('api', { target_id: a.target_id }), event('loop', { loop_count: 3, children: [event('request', { url: `${base}/resume`, input: { query: { index: '{{loop_index}}' } } }), event('wait', { wait_ms: 100 })] })] })
  const recoveryDraft = commands.getFlowDraft(pid, flow.flow_id).flow
  const interrupted = await commands.proposeExecutePlan(pid, { goal: '恢复未发送节点', targetId: '', flowIds: [flow.flow_id], environmentId: env.env_id })
  let cancelled = false
  afterHit = () => { if (hits.at(-1) === '/resume?index=0' && !cancelled) { cancelled = true; setTimeout(() => commands.cancelPlan(pid, interrupted.plan_id), 30) } }
  const interruptedDone = await commands.approvePlan(pid, interrupted.plan_id); afterHit = undefined
  const beforeResume = hits.length
  assert.equal(interruptedDone.status, 'interrupted')
  commands.syncFlowEditorDraft(pid, { ...recoveryDraft, name: '范围已变' })
  assert.throws(() => commands.resumePlan(pid, interrupted.plan_id, [interrupted.steps[0].step_id]), /范围/)
  assert.equal(hits.length, beforeResume); commands.syncFlowEditorDraft(pid, recoveryDraft)
  const resumed = await commands.resumePlan(pid, interrupted.plan_id, [interrupted.steps[0].step_id])
  assert.equal(resumed.status, 'pending'); assert.equal(hits.length, beforeResume)
  assert.equal((await commands.approvePlan(pid, interrupted.plan_id)).status, 'completed')
  assert.deepEqual(hits.slice(beforeResume), ['/resume?index=1', '/resume?index=2'])
  assert.throws(() => commands.resumePlan(pid, dropped.plan.plan_id, [dropped.plan.steps[0].step_id])); assert.equal(hits.filter(h => h === '/drop').length, 1)
  assert.throws(() => commands.resumePlan(pid, failed.plan.plan_id, [failed.plan.steps[0].step_id]))
  console.log(protocol, 'PASS Flow control')
 } finally { api.closeAllConnections(); model.closeAllConnections(); api.close(); model.close() }
}
main().then(() => app.exit(0)).catch(e => { console.error(e); app.exit(1) })
