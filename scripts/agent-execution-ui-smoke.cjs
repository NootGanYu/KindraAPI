const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-execution-ui-'))
let app, pid, targetId, hits = [], hold = false
const api = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; hits.push({ method: req.method, url: req.url, body }); if (!hold) res.end('execution-ui-result') })
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), tools = (body.tools ?? []).map(tool => tool.function?.name)
  let message
  if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (tools.includes('propose_task_plan')) message = { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({ selected_objects: [{ kind: 'api', id: targetId }], steps: [{ step_id: 'run', operation: 'execute_api', binding: 'static', target_id: targetId, depends_on: [] }] }) } }] }
  else if (tools.includes('execute_api')) message = { tool_calls: [{ id: 'call', type: 'function', function: { name: 'execute_api', arguments: JSON.stringify({ project_id: pid, target_id: targetId, depends_on: [] }) } }] }
  else message = { content: '执行报告已生成' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
async function launch() { app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } }); return app.firstWindow() }
async function expectHits(n) { const deadline = Date.now() + 5000; while (hits.length < n && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(hits.length, n) }
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)); app = null } }
;(async () => {
  await Promise.all([new Promise(resolve => api.listen(0, '127.0.0.1', resolve)), new Promise(resolve => model.listen(0, '127.0.0.1', resolve))])
  let page = await launch(); await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  const info = await page.evaluate(async ({ apiBase, modelBase }) => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.data }
    const project = unwrap(await window.api.projects.ensureDefault())
    const target = unwrap(await window.api.targets.create(project.project_id, '0', 'api'))
    target.name = '执行测试接口'; target.url = `${apiBase}/saved`; unwrap(await window.api.targets.save(project.project_id, target))
    const draft = structuredClone(target); draft.url = `${apiBase}/draft`; draft.method = 'POST'; unwrap(await window.api.agent.syncEditorDraft(project.project_id, draft))
    const connection = unwrap(await window.api.agent.createConnection({ name: '执行验证', base_url: modelBase, model: 'execution-ui', protocol: 'chat-completions' }))
    unwrap(await window.api.agent.setProjectConnection(project.project_id, connection.connection_id)); unwrap(await window.api.agent.testConnection(connection.connection_id))
    return { pid: project.project_id, targetId: target.target_id, paths: unwrap(await window.api.paths()) }
  }, { apiBase: `http://127.0.0.1:${api.address().port}`, modelBase: `http://127.0.0.1:${model.address().port}/v1` })
  pid = info.pid; targetId = info.targetId
  await submitAgentGoal(page, '执行执行测试接口的当前草稿')
  await page.getByRole('button', { name: '批准执行计划', exact: true }).waitFor()
  const panel = page.locator('.agent-dock-panel'); assert.match(await panel.innerText(), /POST.*\/draft/); assert.match(await panel.innerText(), /远端业务副作用/); assert.match(await panel.innerText(), /环境：/); assert.match(await panel.innerText(), /来源：未保存草稿/); assert.equal(hits.length, 0)
  await page.getByRole('button', { name: '拒绝计划', exact: true }).click(); await page.getByText('已拒绝', { exact: true }).waitFor(); assert.equal(hits.length, 0)
  await submitAgentGoal(page, '再次执行执行测试接口的当前草稿'); await page.getByRole('button', { name: '批准执行计划', exact: true }).click(); await page.getByText('执行报告已生成', { exact: true }).waitFor()
  assert.deepEqual(hits, [{ method: 'POST', url: '/draft', body: '' }])
  function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]) }
  assert(!files(info.paths.projectRoot).some(file => fs.readFileSync(file, 'utf8').includes('执行报告已生成')))
  await stop(); page = await launch(); await openAgentPanel(page); await page.getByText('执行报告已生成', { exact: true }).first().waitFor(); assert.equal(hits.length, 1)
  hold = true
  await submitAgentGoal(page, '执行执行测试接口并等待结果')
  await page.getByRole('button', { name: '批准执行计划', exact: true }).click()
  await expectHits(2)
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await page.getByRole('button', { name: '停止并退出', exact: true }).click()
  await closed; app = null; hold = false
  page = await launch()
  const plans = await page.evaluate(async pid => (await window.api.agent.listPlans(pid)).data, pid)
  assert(plans.some(plan => plan.status === 'interrupted' && plan.steps.some(step => step.status === 'unknown')))
  assert.equal(hits.length, 2, 'restart must not replay an interrupted request')
  console.log('PASS Electron execution scope, rejection, one approved draft request, local report and restart without replay')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error(await page.locator('.ant-drawer-body').innerText().catch(() => '')) }; console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); api.closeAllConnections(); model.closeAllConnections(); api.close(); model.close() })
