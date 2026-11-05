const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, closeAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-case-execution-ui-'))
let app, pid, targetId, hits = [], original
const api = http.createServer(async (req, res) => { hits.push({ method: req.method, url: req.url }); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}') })
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), tools = (body.tools ?? []).map(tool => tool.function?.name)
  let message
  if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (tools.includes('propose_task_plan')) message = { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({ selected_objects: [{ kind: 'case', id: targetId, case_id: 'ui-case' }], steps: [{ step_id: 'run-case', operation: 'execute_api_case', binding: 'static', target_id: targetId, case_id: 'ui-case', depends_on: [] }] }) } }] }
  else if (tools.includes('execute_api_case')) message = { tool_calls: [{ id: 'case', type: 'function', function: { name: 'execute_api_case', arguments: JSON.stringify({ project_id: pid, target_id: targetId, case_id: 'ui-case', depends_on: [] }) } }] }
  else message = { content: '状态断言通过，接口用例运行完成。' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
async function launch() { app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } }); return app.firstWindow() }
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)); app = null } }
;(async () => {
  await Promise.all([new Promise(resolve => api.listen(0, '127.0.0.1', resolve)), new Promise(resolve => model.listen(0, '127.0.0.1', resolve))])
  let page = await launch(); await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  ;({ pid, targetId, original } = await page.evaluate(async ({ origin, base }) => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.data }
    const project = unwrap(await window.api.projects.ensureDefault()), target = unwrap(await window.api.targets.create(project.project_id, '0', 'api'))
    target.name = 'Case执行接口'; target.url = `${origin}/base`; target.cases = [{ case_id: 'ui-case', name: '订单成功用例', is_enabled: 1, override: { url: `${origin}/saved`, method: 'POST' }, assertions: [{ assertion_id: 'status', kind: 'status', op: 'equals', expected: '200', is_enabled: 1 }] }]
    unwrap(await window.api.targets.save(project.project_id, target))
    await window.api.agent.saveConnection({ name: '用例执行模型', base_url: base, model: 'case-ui', protocol: 'chat-completions' }); unwrap(await window.api.agent.testConnection())
    return { pid: project.project_id, targetId: target.target_id, original: unwrap(await window.api.targets.get(project.project_id, target.target_id)) }
  }, { origin: `http://127.0.0.1:${api.address().port}`, base: `http://127.0.0.1:${model.address().port}/v1` }))
  await openAgentPanel(page); await page.getByRole('link', { name: /APIs$/ }).click()
  await page.getByText('Case执行接口', { exact: true }).first().click(); await page.getByText('接口用例', { exact: true }).click()
  await page.getByPlaceholder('URL（留空继承）').fill(`http://127.0.0.1:${api.address().port}/draft-case`); await page.getByPlaceholder('URL（留空继承）').press('Tab')
  await submitAgentGoal(page, '执行 Case执行接口 的订单成功用例')
  await page.getByRole('button', { name: '批准执行计划', exact: true }).waitFor()
  const panel = page.locator('.agent-dock-panel'); assert.match(await panel.innerText(), /POST.*\/draft-case/); assert.match(await panel.innerText(), /订单成功用例/); assert.equal(hits.length, 0)
  await page.getByRole('button', { name: '拒绝计划', exact: true }).click(); assert.equal(hits.length, 0)
  await submitAgentGoal(page, '再次执行 Case执行接口 的订单成功用例')
  await page.getByRole('button', { name: '批准执行计划', exact: true }).click()
  await page.getByText('状态断言通过，接口用例运行完成。', { exact: true }).waitFor(); await page.getByText('用例结果：通过', { exact: true }).first().waitFor()
  assert.match(await panel.innerText(), /status.*通过/); assert.deepEqual(hits, [{ method: 'POST', url: '/draft-case' }])
  const saved = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId }); assert.deepEqual(saved, original)
  await closeAgentPanel(page); await page.getByRole('link', { name: /APIs$/ }).click()
  await page.getByText('接口用例', { exact: true }).click()
  assert.equal(await page.getByPlaceholder('URL（留空继承）').inputValue(), `http://127.0.0.1:${api.address().port}/draft-case`)
  await stop(); page = await launch(); await openAgentPanel(page)
  await page.getByText('用例结果：通过', { exact: true }).first().waitFor(); assert.equal(hits.length, 1)
  console.log('PASS Case selection, overridden draft approval, rejection, visible assertions, unchanged definition/editor and restart without replay')
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); for (const server of [api, model]) { server.closeAllConnections(); server.close() } })
