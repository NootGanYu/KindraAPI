/** Real Electron renderer -> preload -> IPC -> model + storage journey. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, closeAgentPanel } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-ui-'))
let app
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  if (body.tools) { res.writeHead(400); res.end('text-only'); return }
  res.setHeader('Content-Type', 'application/json')
  const text = body.stream ? '这是可恢复的 Agent 回复。' : 'OK'
  res.end(JSON.stringify(protocol === 'responses'
    ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }
    : { choices: [{ message: { content: text } }] }))
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  const page = await app.firstWindow()
  await openAgentPanel(page)
  return page
}
async function stop() { await app.evaluate(({ app }) => app.exit(0)); app = null }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let page = await launch()
  await closeAgentPanel(page)
  await page.getByRole('link', { name: '设置' }).click()
  await page.locator('#agent-connections').scrollIntoViewIfNeeded()
  await page.getByLabel('API 地址').fill(`http://127.0.0.1:${server.address().port}/v1`)
  await page.getByLabel('模型名称').fill('ui-model')
  await page.getByLabel('API Key', { exact: true }).fill('ui-test-secret')
  if (protocol === 'responses') {
    await page.locator('#agent-connections .ant-form-item').filter({ has: page.getByLabel('协议', { exact: true }) }).locator('.ant-select-selector').click()
    await page.getByText('Responses', { exact: true }).last().click({ timeout: 2000 })
  }
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await page.getByRole('button', { name: /测试连接/ }).click()
  await page.getByText('连接成功，仅文本对话；连续工具操作不可用', { exact: true }).waitFor()
  const panel = await openAgentPanel(page)
  await panel.getByText('仅文本对话；自然语言计划与工具操作不可用。', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '告诉 Agent 要做什么' }).fill('你好')
  await panel.locator('.agent-compose').getByRole('button', { name: /发送/ }).click()
  await page.getByText('这是可恢复的 Agent 回复。', { exact: true }).waitFor()
  const config = await page.evaluate(async () => { const projects = await window.api.projects.list(); return window.api.agent.getProjectConnection(projects.data[0].project_id) })
  assert(config.ok && config.data.has_key)
  assert.equal(config.data.protocol, protocol)
  assert(!JSON.stringify(config).includes('ui-test-secret'))
  const paths = await page.evaluate(() => window.api.paths())
  function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]) }
  assert(!files(paths.data.projectRoot).some(file => fs.readFileSync(file, 'utf8').includes('这是可恢复的 Agent 回复。')))
  assert(!files(paths.data.localRoot).some(file => fs.readFileSync(file, 'utf8').includes('ui-test-secret')))
  await stop()
  page = await launch()
  await page.getByText('这是可恢复的 Agent 回复。', { exact: true }).waitFor()
  await closeAgentPanel(page)
  await page.getByRole('link', { name: '设置' }).click()
  await page.locator('#agent-connections').scrollIntoViewIfNeeded()
  const protocolItem = page.locator('#agent-connections .ant-form-item').filter({ has: page.getByLabel('协议', { exact: true }) }).locator('.ant-select-selection-item')
  await protocolItem.waitFor()
  assert.equal(await protocolItem.textContent(), protocol === 'responses' ? 'Responses' : 'Chat Completions')
  await openAgentPanel(page)
  await page.getByRole('button', { name: '删除会话' }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByText('用一句话告诉 Agent 要做什么', { exact: true }).waitFor()
  console.log('PASS Electron model configuration, text-only capability, chat, restart, deletion, credential and Git boundaries')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error(await page.getByRole('button').allTextContents()); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/ui-01-failure.png' }) }; console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await stop().catch(() => {})
  server.closeAllConnections(); server.close()
})
