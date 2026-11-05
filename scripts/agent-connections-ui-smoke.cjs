/** Renderer commands and visible multi-connection controls, including a real process restart. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, closeAgentPanel } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-connections-ui-'))
let app, count = 0
const server = http.createServer(async (req, res) => {
  for await (const chunk of req) {}
  count++
  res.setHeader('Content-Type', 'text/event-stream')
  res.write('data: {"choices":[{"delta":{"content":"等待中的回复"}}]}\n\n')
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  const page = await app.firstWindow()
  await openAgentPanel(page)
  return page
}
async function stop() { await app.evaluate(({ app }) => app.exit(0)); app = null }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let page = await launch()
  const base = `http://127.0.0.1:${server.address().port}/v1`
  const panel = await openAgentPanel(page)
  await page.getByRole('button', { name: 'Agent 设置' }).click()
  await page.locator('#agent-connections').waitFor()
  await page.getByLabel('连接名称', { exact: true }).fill('连接甲')
  await page.getByLabel('API 地址').fill(base)
  await page.getByLabel('模型名称').fill('model-a')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await page.getByRole('button', { name: /新增连接/ }).click()
  await page.getByLabel('连接名称', { exact: true }).fill('连接乙')
  await page.getByLabel('API 地址').fill(base)
  await page.getByLabel('模型名称').fill('model-b')
  await page.locator('button').filter({ hasText: '保存连接' }).click()
  await page.getByRole('button', { name: '设为项目默认', exact: true }).click()
  const state = await page.evaluate(async () => {
    const projects = (await window.api.projects.list()).data
    const first = projects[0]
    const config = (await window.api.agent.getProjectConnection(first.project_id)).data
    const other = (await window.api.projects.create('另一项目')).data
    const connections = (await window.api.agent.listConnections()).data
    await window.api.agent.setProjectConnection(other.project_id, connections.find(item => item.name === '连接甲').connection_id)
    return { projectId: first.project_id, otherId: other.project_id, connectionId: config.connection_id }
  })
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await panel.getByText('连接乙', { exact: false }).waitFor()
  await page.getByRole('textbox', { name: '告诉 Agent 要做什么' }).fill('在原连接继续')
  await panel.locator('.agent-compose').getByRole('button', { name: /发送/ }).click()
  await page.getByText('等待中的回复', { exact: true }).waitFor()
  assert.equal(count, 1)
  await stop()
  page = await launch()
  await page.getByText('上次回复已中断。你可以继续发消息，不会自动重发。', { exact: true }).waitFor()
  assert.equal(count, 1, 'restart must not replay a running task')
  const result = await page.evaluate(async state => ({
    chosen: await window.api.agent.getProjectConnection(state.projectId),
    other: await window.api.agent.getProjectConnection(state.otherId),
    sessions: await window.api.agent.listConversations(state.projectId)
  }), state)
  assert.equal(result.chosen.data.name, '连接乙')
  assert.equal(result.other.data.name, '连接甲')
  assert.equal(result.sessions.data[0].status, 'interrupted')
  assert.equal(result.sessions.data[0].connection.connection_id, state.connectionId)
  await page.getByRole('button', { name: 'Agent 设置' }).click()
  await page.locator('#agent-connections').waitFor()
  await page.getByRole('button', { name: /删除连接/ }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  const deleted = await page.evaluate(async state => (await window.api.agent.getProjectConnection(state.projectId)).data, state)
  assert.equal(deleted, null)
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await page.getByRole('textbox', { name: '告诉 Agent 要做什么' }).waitFor()
  await page.getByText('选择模型连接', { exact: true }).waitFor()
  const official = path.join(userData, 'offline-data')
  const files = fs.readdirSync(official, { recursive: true }).map(String)
  assert(!files.some(name => /agent|connection|conversation/.test(name)), 'Agent records must not be placed under project Git data')
  console.log('PASS UI create/select/default/delete connections, independent persisted defaults and interrupted restart without replay')
})().catch(async error => { if (app) { try { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/connections-ui-failure.png' }); console.error((await page.locator('body').innerText()).slice(-3000)) } catch {} }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await stop().catch(() => {}); server.closeAllConnections(); server.close() })
