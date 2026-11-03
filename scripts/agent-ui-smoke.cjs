/** Real Electron renderer -> preload -> IPC -> model + storage journey. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-ui-'))
let app
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  if (body.tools) { res.writeHead(400); res.end('text-only'); return }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message: { content: body.stream ? '这是可恢复的 Agent 回复。' : 'OK' } }] }))
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  const page = await app.firstWindow()
  await page.getByRole('link', { name: 'Agent' }).click()
  return page
}
async function stop() { await app.evaluate(({ app }) => app.exit(0)); app = null }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let page = await launch()
  await page.getByRole('button', { name: /配置模型$/ }).click()
  await page.getByLabel('API 地址').fill(`http://127.0.0.1:${server.address().port}/v1`)
  await page.getByLabel('模型名称').fill('ui-model')
  await page.getByLabel('API Key', { exact: true }).fill('ui-test-secret')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByText('仅文本对话；连续工具操作不可用', { exact: false }).first().waitFor()
  await page.getByLabel('发送给 Agent 的消息').fill('你好')
  await page.getByRole('button', { name: /发\s*送/ }).click()
  await page.getByText('这是可恢复的 Agent 回复。', { exact: true }).waitFor()
  const config = await page.evaluate(async () => { const projects = await window.api.projects.list(); return window.api.agent.getProjectConnection(projects.data[0].project_id) })
  assert(config.ok && config.data.has_key)
  assert(!JSON.stringify(config).includes('ui-test-secret'))
  const paths = await page.evaluate(() => window.api.paths())
  function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]) }
  assert(!files(paths.data.projectRoot).some(file => fs.readFileSync(file, 'utf8').includes('这是可恢复的 Agent 回复。')))
  assert(!files(paths.data.localRoot).some(file => fs.readFileSync(file, 'utf8').includes('ui-test-secret')))
  await stop()
  page = await launch()
  await page.getByText('这是可恢复的 Agent 回复。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '删除会话', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByText('开始项目对话', { exact: true }).waitFor()
  console.log('PASS Electron model configuration, text-only capability, chat, restart, deletion, credential and Git boundaries')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error(await page.getByRole('button').allTextContents()); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/ui-01-failure.png' }) }; console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await stop().catch(() => {})
  server.closeAllConnections(); server.close()
})
