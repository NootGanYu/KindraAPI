/** Right-bottom dock, single natural-language input, inline plan approval and settings-hosted connections. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-dock-ui-'))
let app, pid = '', targetId = ''
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  const tools = (body.tools ?? []).map(tool => tool.function.name)
  res.setHeader('Content-Type', 'application/json')
  const respond = message => res.end(JSON.stringify({ choices: [{ message }] }))
  if (tools.includes('kindra_capability_probe')) return respond({ tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] })
  if (tools.includes('propose_task_plan')) {
    const planned = {
      selected_objects: [{ kind: 'api', id: targetId }],
      steps: [{ step_id: 'derive', operation: 'propose_api_change', binding: 'deferred', target_id: targetId, depends_on: [], intent: '把说明改为界面已验证', allowed_changes: ['description'] }]
    }
    return respond({ tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify(planned) } }] })
  }
  if (tools.includes('propose_api_change')) {
    return respond({ tool_calls: [{ id: 'derive', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: targetId, step_id: 'derive', depends_on: [], patch: { description: '界面已验证' } }) } }] })
  }
  return respond({ content: '界面计划已完成。' })
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  const page = await app.firstWindow()
  await page.getByRole('navigation').waitFor()
  return page
}
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); app = null } }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let page = await launch()
  assert.equal(await page.getByRole('link', { name: 'Agent' }).count(), 0, 'left navigation must not expose an Agent page')
  const created = await page.evaluate(async base => {
    const project = (await window.api.projects.ensureDefault()).data
    const target = (await window.api.targets.create(project.project_id, '0', 'api')).data
    target.name = '界面接口'; target.url = 'https://example.invalid/dock'; target.description = '旧说明'
    await window.api.targets.save(project.project_id, target)
    const connection = (await window.api.agent.createConnection({ name: '界面连接', base_url: base, model: 'dock', protocol: 'chat-completions' })).data
    await window.api.agent.setProjectConnection(project.project_id, connection.connection_id)
    await window.api.agent.testConnection(connection.connection_id)
    return { project: project.project_id, target: target.target_id }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  pid = created.project; targetId = created.target
  await page.reload()
  await page.getByRole('navigation').waitFor()

  const fab = page.getByRole('button', { name: '打开 Agent' })
  await fab.waitFor()
  await fab.click()
  const panel = page.locator('.agent-dock-panel')
  await panel.waitFor()
  const viewport = await page.evaluate(() => window.innerWidth)
  const width = (await page.locator('.ant-drawer-content-wrapper').boundingBox()).width
  assert(Math.abs(width / viewport - 0.4) < 0.03, `panel must be about 40vw (${width}/${viewport})`)
  assert.equal(await page.locator('.ant-drawer-mask').count(), 0, 'dock must not mask the main interface')
  for (const name of ['只读计划', '修改草稿', '执行草稿', '执行接口用例', '修改并保存', '新建接口草稿', '连续任务']) {
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `legacy mode button ${name} must be removed`)
  }
  assert(await page.getByRole('combobox', { name: '权限模式' }).isVisible())
  assert(await page.getByRole('textbox', { name: '告诉 Agent 要做什么' }).isVisible())
  await panel.getByText('界面连接', { exact: false }).waitFor()

  // Main interface stays operable while the unmasked panel is open.
  await page.getByRole('link', { name: '最近' }).click()
  await page.waitForURL(/#\/history/)
  await panel.waitFor()

  await page.getByRole('textbox', { name: '告诉 Agent 要做什么' }).fill('把界面接口的说明改为界面已验证')
  await page.getByRole('button', { name: /发送/ }).click()
  const card = page.locator('.agent-plan-card').first()
  await card.waitFor()
  assert.equal(await card.locator('.ant-drawer').count(), 0, 'plans must render inline, not in a nested drawer')
  await card.getByText('自动选择', { exact: false }).waitFor()
  await page.getByRole('button', { name: '批准修改计划', exact: true }).click()
  await card.getByText('已完成', { exact: true }).first().waitFor()
  await page.getByText('界面计划已完成。', { exact: true }).waitFor()

  // Permission mode confirmations are one-time and explain the risk.
  const permissionInput = page.getByRole('combobox', { name: '权限模式' })
  await permissionInput.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByText('自动模式不能保证绝对安全', { exact: false }).waitFor()
  await page.getByRole('button', { name: '启用自动模式', exact: true }).click()
  await page.getByRole('button', { name: '启用自动模式', exact: true }).waitFor({ state: 'hidden' })
  const modeSelect = page.locator('.agent-dock-controls .ant-select').filter({ hasText: '自动模式' })
  await modeSelect.locator('.ant-select-selector').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '跳过权限' }).click()
  await page.getByText('高风险', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: /取\s*消/ }).click()

  // Connection status jumps to the settings section and closes the panel.
  await page.getByRole('button', { name: 'Agent 模型连接设置' }).click()
  await page.waitForURL(/#\/settings#agent-connections/)
  await assert.doesNotReject(() => panel.waitFor({ state: 'hidden', timeout: 3000 }))
  await page.locator('#agent-connections').waitFor()
  await page.getByText('Agent 模型连接', { exact: true }).waitFor()

  // Connection CRUD is available on the settings page.
  await page.getByRole('button', { name: /新增连接/ }).click()
  await page.getByLabel('连接名称', { exact: true }).fill('设置页连接')
  await page.getByLabel('API 地址').fill(`http://127.0.0.1:${server.address().port}/v1`)
  await page.getByLabel('模型名称').fill('settings-model')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await page.getByText('连接已保存', { exact: true }).waitFor()
  await page.getByRole('button', { name: /测试连接/ }).click()
  await page.getByText('连接成功，支持文本和工具调用', { exact: true }).waitFor()
  await page.getByRole('button', { name: /删除连接/ }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  const remaining = await page.evaluate(() => window.api.agent.listConnections().then(result => result.data.map(item => item.name)))
  assert.deepEqual(remaining, ['界面连接'])
  assert(await page.locator('#agent-connections').isVisible())
  console.log('PASS dock entry, 40vw unmasked panel, inline plan approval, permission confirmations and settings-hosted connection CRUD')
})().catch(async error => { if (app) { try { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/dock-ui-failure.png' }) } catch {} } console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve())) })
