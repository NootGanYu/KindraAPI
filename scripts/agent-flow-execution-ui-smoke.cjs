const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-execution-ui-19-'))
let app, pid, flowId
const hits = []
const api = http.createServer((req, res) => { hits.push({ url: req.url, auth: req.headers.authorization }); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}') })
const model = http.createServer(async (req, res) => {
 let raw = ''; for await (const chunk of req) raw += chunk
 const body = JSON.parse(raw), tools = (body.tools ?? []).map(t => t.function.name)
 let message
 if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
 else if (tools.includes('propose_task_plan')) message = { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({ selected_objects: [{ kind: 'flow', id: flowId }], steps: [{ step_id: 'run-flow', operation: 'execute_flow', binding: 'static', flow_id: flowId, depends_on: [] }] }) } }] }
 else if (tools.includes('execute_flow')) message = { tool_calls: [{ id: 'flow', type: 'function', function: { name: 'execute_flow', arguments: JSON.stringify({ project_id: pid, flow_id: flowId, depends_on: [] }) } }] }
 else message = { content: 'Flow 执行报告已生成' }
 res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
async function launch() { app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } }); const page = await app.firstWindow(); await page.getByRole('button', { name: '打开 Agent' }).waitFor(); return page }
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)); app = null } }
;(async () => {
 await Promise.all([new Promise(r => api.listen(0, '127.0.0.1', r)), new Promise(r => model.listen(0, '127.0.0.1', r))]); let page = await launch()
 ;({ pid, flowId } = await page.evaluate(async ({ base, modelBase }) => {
  const unwrap = r => { if (!r.ok) throw new Error(r.error); return r.data }
  const p = unwrap(await window.api.projects.ensureDefault()), env = unwrap(await window.api.envs.list(p.project_id))[0]
  const a = unwrap(await window.api.targets.create(p.project_id, '0', 'api')), b = unwrap(await window.api.targets.create(p.project_id, '0', 'api'))
  a.url = `${base}/first`; a.request.test = "pm.globals.set('flowToken', 'ui-runtime-secret')"; unwrap(await window.api.targets.save(p.project_id, a))
  b.url = `${base}/second`; b.request.auth = { type: 'bearer', bearer: { key: '{{flowToken}}' } }; unwrap(await window.api.targets.save(p.project_id, b))
  const flow = unwrap(await window.api.flows.create(p.project_id, '跨接口执行验证')); flow.events = [a, b].map((t, i) => ({ event_id: `flow-${i}`, name: `节点${i+1}`, type: 'api', enabled: true, target_id: t.target_id })); unwrap(await window.api.flows.save(p.project_id, flow))
  const draft = structuredClone(flow); draft.events[1].input = { query: { mode: 'draft' } }; unwrap(await window.api.agent.syncFlowEditorDraft(p.project_id, draft))
  const c = unwrap(await window.api.agent.createConnection({ name: 'Flow UI', base_url: modelBase, model: 'flow', protocol: 'chat-completions' })); unwrap(await window.api.agent.setProjectConnection(p.project_id, c.connection_id)); unwrap(await window.api.agent.testConnection(c.connection_id))
  return { pid: p.project_id, flowId: flow.flow_id }
 }, { base: `http://127.0.0.1:${api.address().port}`, modelBase: `http://127.0.0.1:${model.address().port}/v1` }))
 await submitAgentGoal(page, '执行跨接口执行验证 Flow 的当前草稿')
 await page.getByRole('button', { name: '批准执行计划', exact: true }).waitFor()
 const text = await page.locator('.agent-dock-panel').innerText(); assert.match(text, /后置脚本 SHA256/); assert.match(text, /\/second\?mode=draft/); assert.match(text, /远端业务副作用/); assert.equal(hits.length, 0)
 await page.getByRole('button', { name: '拒绝计划', exact: true }).click(); await page.getByText('已拒绝', { exact: true }).waitFor(); assert.equal(hits.length, 0)
 await submitAgentGoal(page, '再次执行跨接口执行验证 Flow 的当前草稿'); await page.getByRole('button', { name: '批准执行计划', exact: true }).click(); await page.getByText('Flow 执行报告已生成', { exact: true }).waitFor()
 assert.deepEqual(hits.map(h => h.url), ['/first', '/second?mode=draft']); assert.equal(hits[1].auth, 'Bearer ui-runtime-secret')
 await page.getByText('查看脱敏工具结果', { exact: true }).click(); assert(!(await page.locator('.agent-dock-panel').innerText()).includes('ui-runtime-secret'))
 const state = await page.evaluate(async ({ pid, flowId }) => ({ flow: (await window.api.flows.get(pid, flowId)).data, runs: (await window.api.flows.runs(pid)).data }), { pid, flowId }); assert.equal(state.flow.events[1].input, undefined); assert.equal(state.runs.length, 0)
 await stop(); page = await launch(); await openAgentPanel(page); await page.getByText('Flow 执行报告已生成', { exact: true }).first().waitFor(); assert.equal(hits.length, 2)
 console.log('PASS Electron Flow selection, scope review, reject/approve, draft execution, redacted local report and restart without replay')
})().catch(async e => { console.error(e); if (app) { const page = await app.firstWindow(); console.error((await page.locator('body').innerText()).slice(-5000)); console.error(await page.locator('button').evaluateAll(buttons => buttons.map(b => ({ text: b.innerText, disabled: b.disabled, aria: b.getAttribute('aria-hidden') })))) } process.exitCode = 1 }).finally(async () => { await stop(); api.closeAllConnections(); model.closeAllConnections(); api.close(); model.close() })
