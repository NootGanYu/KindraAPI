/** Focused API editor regression checks. Uses isolated data and a loopback server. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron: electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-api-editor-'))
const artifacts = path.join(__dirname, '.ui-artifacts', 'api-editor')
let app, page, server, target, projectId
const requests = []
async function saved() {
  return page.evaluate(async ({ projectId, id }) => {
    const result = await window.api.targets.get(projectId, id)
    if (!result.ok) throw Error(result.error)
    return result.data
  }, { projectId, id: target.target_id })
}
async function waitUntil(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw Error('Timed out waiting for editor operation')
}
async function menu(label, item) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}
async function main() {
  fs.mkdirSync(artifacts, { recursive: true })
  app = await electron.launch({ executablePath: require('electron'), args: ['.'], env: {
    ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1'
  } })
  page = await app.firstWindow()
  await page.waitForSelector('.app-shell')
  await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
  await page.locator('.tab-add').click()
  await page.locator('.url-input input').waitFor()
  const data = await page.evaluate(async () => {
    const projects = await window.api.projects.list()
    const projectId = projects.data[0].project_id
    const targets = await window.api.targets.list(projectId)
    return { projectId, target: targets.data.find(item => item.target_type === 'api') }
  })
  projectId = data.projectId; target = data.target
  server = http.createServer(async (req, res) => {
    requests.push({ url: req.url, savedUrl: (await saved()).url })
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}') }, 150)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const url = page.locator('.url-input input')
  await url.fill(`${base}/design-enter`)
  await url.press('Enter')
  assert.equal(requests.length, 0, 'design Enter must not send')
  await page.locator('.mode-row .segmented').getByText('调试', { exact: true }).click()
  await url.fill(`${base}/saved`)
  await menu('保存到目录', '根目录')
  await waitUntil(async () => (await saved()).url === `${base}/saved`)
  assert.equal(requests.length, 0, 'save-to-folder must not send')
  await url.fill(`${base}/enter`)
  await url.press('Enter')
  await waitUntil(() => requests.length === 1)
  assert.equal(requests[0].savedUrl, `${base}/saved`, 'send must not implicitly save')
  assert.equal(await page.locator('.send-caret').isDisabled(), true)
  assert.equal(await page.locator('.save-caret').isDisabled(), true)
  await page.locator('.send-btn:enabled').waitFor()
  await url.fill(`${base}/capture`)
  await menu('发送选项', '发送并保存响应')
  await waitUntil(async () => (await saved()).response.example.length === 1)
  assert.equal((await saved()).response.example[0].raw, '{"ok":true}')
  await page.locator('.send-btn:enabled').waitFor()
  await url.fill('http://127.0.0.1:1/unreachable')
  await menu('发送选项', '发送并保存响应')
  await page.locator('.send-btn:enabled').waitFor()
  assert.equal((await saved()).response.example.length, 1, 'failed send must not save an empty response')
  console.log('PASS request actions: design Enter, folder save, debug Enter, busy menus, capture response, failed capture')

  await page.locator('.mode-row .segmented').getByText('设计', { exact: true }).click()
  assert.equal(await page.locator('.req-tabs button').count(), 5)
  assert.equal(await page.locator('.save-caret').count(), 0)
  const design = page.locator('.design-editor')
  await design.evaluate(element => { element.scrollTop = element.scrollHeight })
  const toolbar = await page.locator('.url-row').boundingBox()
  const bounds = await design.boundingBox()
  assert.ok(Math.abs(toolbar.y - bounds.y) <= 2, 'design URL must stay at top while scrolling')
  const response = page.locator('.design-response')
  await response.getByRole('tab', { name: 'Header', exact: true }).click()
  await response.locator('.design-param-row.is-tail').getByLabel('参数名', { exact: true }).fill('X-Test')
  await response.getByRole('textbox', { name: '参数值 X-Test', exact: true }).fill('ok')
  await response.getByRole('tab', { name: '期望设置' }).click()
  await page.locator('#expect-code').fill('999')
  await response.getByRole('alert').filter({ hasText: 'HTTP 状态码' }).waitFor()
  await page.locator('#expect-code').fill('404')
  await page.locator('#expect-name').fill('未找到')
  await response.getByRole('button', { name: /新建期望/ }).click()
  const modal = page.locator('.response-new-expect:visible')
  await modal.getByPlaceholder('例如：成功').fill('成功')
  await modal.getByRole('button', { name: /确.*定/ }).click()
  await response.getByRole('tab', { name: '期望设置' }).click()
  await response.getByRole('button', { name: '设为默认', exact: true }).click()
  await page.locator('.save-btn').click()
  await waitUntil(async () => (await saved()).response.example.length === 2)
  let examples = (await saved()).response.example
  assert.equal(examples.filter(example => example.expect.is_default === 1).length, 1)
  assert.equal(examples[0].expect.code, 404)
  assert.ok(examples[0].headers.some(header => header.key === 'X-Test' && header.value === 'ok'))
  await response.locator('.resp-expect-item').filter({ hasText: '成功' }).hover()
  await response.getByRole('button', { name: '删除期望 成功', exact: true }).click()
  await page.locator('.ant-modal-confirm:visible').getByRole('button', { name: /删.*除/ }).click()
  await page.locator('.save-btn').click()
  await waitUntil(async () => (await saved()).response.example.length === 1)
  examples = (await saved()).response.example
  assert.equal(examples[0].expect.is_default, 1)
  await design.evaluate(element => { element.scrollTop = 0 })
  await page.locator('.ant-message-notice').last().waitFor({ state: 'hidden' })
  await page.screenshot({ path: path.join(artifacts, 'design.png') })
  console.log('PASS design: sticky URL, five tabs, response headers/settings/validation/default/delete')
  await page.locator('.mode-row .segmented').getByText('调试', { exact: true }).click()
  await page.locator('.bodytypes .ant-radio-wrapper').filter({ hasText: 'raw' }).click()
  await page.locator('.raw-format').click()
  await page.locator('.ant-select-dropdown:visible').getByText('XML', { exact: true }).click()
  await page.locator('.editor-input').fill('<hello>world</hello>')
  await page.locator('.save-btn').click()
  await waitUntil(async () => (await saved()).request.body.raw === '<hello>world</hello>')
  assert.equal((await saved()).request.body.mode, 'raw')
  assert.equal((await saved()).request.header.parameter.find(item => item.key === 'Content-Type').value, 'application/xml')
  await page.locator('.split-toggle').click()
  await page.locator('.req-tabs').getByRole('tab', { name: '后执行操作', exact: true }).click()
  await page.getByRole('button', { name: '添加操作项', exact: true }).click()
  await page.getByRole('menuitem', { name: '自定义脚本', exact: true }).click()
  await page.getByPlaceholder('// 后执行脚本').waitFor()
  assert.equal(await page.locator('.req-tabs').evaluate(element => getComputedStyle(element).overflowX), 'auto')
  const layout = await page.locator('.api-debug-toolbar').evaluate(pane => {
    const rect = element => { const { x, width, right } = element.getBoundingClientRect(); return { x, width, right } }
    return { pane: rect(pane), send: rect(pane.querySelector('.send-btn')), save: rect(pane.querySelector('.save-btn')), url: rect(pane.querySelector('.url-row')) }
  })
  assert.ok(layout.send.x >= layout.pane.x && layout.save.right <= layout.pane.right, JSON.stringify(layout))
  console.log('PASS debug: raw XML content type, narrow split tabs and action buttons accessible')
  await page.locator('.ant-message-notice').last().waitFor({ state: 'hidden' })
  await page.screenshot({ path: path.join(artifacts, 'debug.png') })
}
main().catch(async error => {
  console.error(error)
  if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  process.exitCode = 1
}).finally(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close() }
  if (server) await new Promise(resolve => server.close(resolve))
  fs.rmSync(userData, { recursive: true, force: true })
})
