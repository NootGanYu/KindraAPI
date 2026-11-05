/** app:relaunch must use the confirmed true-exit path and must not arm after cancellation. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-relaunch-ui-'))
const marker = path.join(userData, 'relaunch.json')
let app
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  if (body.messages?.some(message => message.content === '保持运行')) return // hold the turn open
  if (body.tools) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] } }] })); return }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_RELAUNCH_MARKER: marker } })
  return app.firstWindow()
}
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); app = null } }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let page = await launch()
  await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  await page.evaluate(async base => {
    const project = (await window.api.projects.ensureDefault()).data
    const connection = (await window.api.agent.createConnection({ name: '回环', base_url: base, model: 'loop', protocol: 'chat-completions' })).data
    await window.api.agent.setProjectConnection(project.project_id, connection.connection_id)
    await window.api.agent.testConnection(connection.connection_id)
    const conversation = (await window.api.agent.createConversation(project.project_id)).data
    window.__relaunchTest = { pid: project.project_id, conversationId: conversation.conversation_id }
    // Do not await: the turn deliberately stays active while relaunch is requested.
    void window.api.agent.sendMessage(project.project_id, conversation.conversation_id, '保持运行', connection.connection_id)
  }, `http://127.0.0.1:${server.address().port}/v1`)
  await page.waitForFunction(async () => (await window.api.agent.getActivity()).data.running > 0)
  // Record scheduling without performing a real restart; the app still quits through app.quit.
  await app.evaluate(({ app }) => {
    const fs = process.getBuiltinModule('node:fs')
    app.relaunch = options => fs.writeFileSync(process.env.KINDRAAPI_RELAUNCH_MARKER, JSON.stringify(options ?? {}))
  })
  await page.evaluate(() => window.api.app.relaunch())
  await page.locator('.ant-modal-confirm-title').filter({ hasText: '退出将停止 Agent 任务' }).last().waitFor()
  assert.equal(fs.existsSync(marker), false, 'relaunch must not be scheduled before confirmation')
  await page.getByRole('button', { name: '继续工作', exact: true }).last().click()
  await page.waitForTimeout(150)
  assert.equal(fs.existsSync(marker), false, 'cancelled relaunch must not stay armed')
  const activity = await page.evaluate(async () => (await window.api.agent.getActivity()).data)
  assert(activity.running > 0, 'cancel must leave the running task untouched')
  await page.evaluate(() => window.api.app.relaunch())
  await page.locator('.ant-modal-confirm-title').filter({ hasText: '退出将停止 Agent 任务' }).last().waitFor()
  await page.getByRole('button', { name: '停止并退出', exact: true }).last().click()
  await app.waitForEvent('close')
  app = null
  assert.equal(fs.existsSync(marker), true, 'confirmed relaunch must schedule exactly once')
  console.log('PASS app:relaunch is gated by confirmation, cancellation keeps the task and disarms relaunch')
})().catch(async error => { console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); server.closeAllConnections(); server.close() })
