/** Minimum supported 960x640: the panel-hosted connection form stays reachable and fully visible. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright-core')
const { openAgentPanel } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-config-modal-ui-'))
const shots = '/tmp/kindra-builtin-agent-context'
let app
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  return app.firstWindow()
}
async function resize(width, height) {
  await app.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows()[0].setSize(size.width, size.height) }, { width, height })
  await new Promise(resolve => setTimeout(resolve, 250))
}
async function assertConnectionActionsVisible(page, label) {
  const save = page.getByRole('button', { name: '保存连接', exact: true })
  const remove = page.locator('button').filter({ hasText: '删除连接' })
  await page.locator('.agent-dock-subview').evaluate(el => el.scrollTo(0, el.scrollHeight))
  await save.waitFor(); await remove.waitFor()
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  for (const [name, locator] of [['保存', save], ['删除', remove]]) {
    const box = await locator.boundingBox()
    assert(box, `${label}: ${name} must render`)
    assert(box.y >= 0 && box.y + box.height <= viewport.height + 1, `${label}: ${name} must stay inside ${viewport.height}px viewport (bottom ${box.y + box.height})`)
    assert(box.x >= 0 && box.x + box.width <= viewport.width, `${label}: ${name} must stay horizontally visible`)
  }
  await page.screenshot({ path: path.join(shots, `config-settings-${label}.png`) })
}
;(async () => {
  const page = await launch()
  await openAgentPanel(page)
  await page.getByRole('button', { name: 'Agent 设置' }).click()
  await page.locator('#agent-connections').waitFor()
  await page.getByLabel('API 地址').fill('http://127.0.0.1:9/v1')
  await page.getByLabel('模型名称').fill('modal-model')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await page.getByText('连接已保存', { exact: true }).waitFor()
  await resize(960, 640)
  await assertConnectionActionsVisible(page, '960x640')
  await resize(1180, 760)
  await assertConnectionActionsVisible(page, '1180x760')
  console.log('PASS settings-hosted connection actions stay visible at 960x640 and normal size')
})().catch(async error => { if (app) { try { const page = await app.firstWindow(); await page.screenshot({ path: path.join(shots, 'config-modal-failure.png') }) } catch {} } console.error(error); process.exitCode = 1 }).finally(async () => { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); app = null } })
