const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-timeline-ui-'))
let app, pid, targetId, loopRequests = 0
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  const tools = (body.tools ?? []).map(tool => tool.function?.name ?? tool.name)
  const messages = body.messages ?? []
  const toolResults = messages.filter(message => message.role === 'tool')
  let message
  if (!tools.length) message = { content: 'OK' }
  else if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (tools.includes('list_apis')) {
    loopRequests++
    if (!toolResults.length) message = { tool_calls: [{ id: 'call-list', type: 'function', function: { name: 'list_apis', arguments: '{"limit":20}' } }] }
    else if (toolResults.length === 1) message = { tool_calls: [{ id: 'call-summary', type: 'function', function: { name: 'get_api', arguments: JSON.stringify({ target_id: targetId, section: 'summary' }) } }] }
    else message = { content: '时间线回答：订单接口已读取。' }
  } else message = { content: 'OK' }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message }] }))
})
const launch = () => _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await launch()
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  const info = await page.evaluate(async base => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.data }
    const project = unwrap(await window.api.projects.ensureDefault())
    const target = unwrap(await window.api.targets.create(project.project_id, '0', 'api'))
    target.name = '订单时间线接口'
    target.description = '时间线验收说明'
    target.url = 'http://user:pass@example.com/orders'
    target.request.header.parameter = [{ param_id: 'h1', key: 'X-Trace', value: 'trace', is_checked: 1 }]
    unwrap(await window.api.targets.save(project.project_id, target))
    const connection = unwrap(await window.api.agent.createConnection({ name: '时间线模型', base_url: base, model: 'timeline-model', protocol: 'chat-completions' }))
    unwrap(await window.api.agent.setProjectConnection(project.project_id, connection.connection_id))
    unwrap(await window.api.agent.testConnection(connection.connection_id))
    return { pid: project.project_id, targetId: target.target_id }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  pid = info.pid; targetId = info.targetId
  await submitAgentGoal(page, '读取订单接口并总结', { native: true })
  await page.getByText('时间线回答：订单接口已读取。', { exact: true }).waitFor()
  const cards = page.locator('.agent-tool-card')
  assert.equal(await cards.count(), 2, 'each continuous tool call gets a card')
  await page.getByText('list_apis', { exact: true }).waitFor()
  await page.getByText('get_api', { exact: true }).waitFor()
  assert.equal(await cards.nth(0).locator('.anticon-check-circle').count(), 1, 'successful tools are marked complete')
  assert.equal(await page.locator('.agent-plan-card').count(), 0, 'the legacy plan card is not the main view')
  const more = cards.nth(1).getByRole('button', { name: '查看更多' })
  if (await more.count()) { await more.click(); await cards.nth(1).getByRole('button', { name: '收起' }).waitFor() }
  assert.equal(loopRequests, 3, 'the loop made three model round-trips')
  assert.equal(await page.evaluate(async pid => (await window.api.agent.listPlans(pid)).data.length, pid), 0, 'no legacy plan was created')
  await app.evaluate(({ app }) => app.exit(0)); app = null
  app = await launch()
  const restarted = await app.firstWindow()
  await openAgentPanel(restarted)
  await restarted.getByText('时间线回答：订单接口已读取。', { exact: true }).waitFor()
  assert.equal(loopRequests, 3, 'restart must not replay the turn')
  console.log('PASS Electron timeline: ordered tool cards, paged output, final answer, no legacy plan, no replay')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error((await page.locator('body').innerText()).slice(-4000)); await page.screenshot({ path: '/tmp/kindra-agent-timeline-failure.png' }).catch(() => {}) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close(); fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
