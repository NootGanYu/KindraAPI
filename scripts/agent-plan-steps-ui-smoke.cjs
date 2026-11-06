const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-steps-ui-'))
let app, pid, ids, returned = 0
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), tools = (body.tools ?? []).map(tool => tool.function?.name)
  const output = body.messages.filter(message => message.role === 'tool'); returned += output.length
  let message
  if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (tools.includes('propose_task_plan')) {
    const steps = ids.map((id, index) => ({ step_id: `s${index}`, operation: 'read_api', binding: 'static', target_id: id, depends_on: index === 1 ? ['s0'] : [] }))
    message = { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({ selected_objects: ids.map(id => ({ kind: 'api', id })), steps }) } }] }
  } else message = { content: output.length ? '读取结果：三个接口已读取，独立结果已保留。' : 'OK' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  return app.firstWindow()
}
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)); app = null } }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let page = await launch()
  await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  const info = await page.evaluate(async base => {
    const project = (await window.api.projects.ensureDefault()).data
    const ids = []
    for (const name of ['资料接口', '订单接口', '独立统计']) {
      const target = (await window.api.targets.create(project.project_id, '0', 'api')).data
      target.name = name; await window.api.targets.save(project.project_id, target); ids.push(target.target_id)
    }
    const connection = (await window.api.agent.createConnection({ name: '多步骤验证', base_url: base, model: 'plan-ui', protocol: 'chat-completions' })).data
    await window.api.agent.setProjectConnection(project.project_id, connection.connection_id)
    await window.api.agent.testConnection(connection.connection_id)
    return { pid: project.project_id, ids }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  pid = info.pid; ids = info.ids
  await submitAgentGoal(page, '读取资料接口、订单接口和独立统计')
  await page.getByText('读取结果：三个接口已读取，独立结果已保留。', { exact: true }).waitFor()
  await page.getByText('s2 · 读取 独立统计', { exact: true }).waitFor()
  await page.getByText('s1 · 读取 订单接口', { exact: true }).waitFor()
  assert.equal(returned, 1, 'one consolidated approved-plan tool result returns to the model')
  await stop(); page = await launch()
  await openAgentPanel(page)
  await page.getByText('读取结果：三个接口已读取，独立结果已保留。', { exact: true }).waitFor()
  assert.equal(returned, 1, 'restart must not replay reads')
  await page.getByRole('button', { name: '删除计划记录', exact: true }).first().click()
  await page.getByText('读取结果：三个接口已读取，独立结果已保留。', { exact: true }).waitFor({ state: 'hidden' })
  console.log('PASS Electron multi-selection, dependency display, restart without replay and plan deletion')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error(await page.locator('.agent-dock-panel').innerText().catch(()=>'')) }; console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); server.closeAllConnections(); server.close() })
