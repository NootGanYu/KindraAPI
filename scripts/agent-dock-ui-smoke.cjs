/** Right-bottom dock, single natural-language input, inline plan approval and settings-hosted connections. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel } = require('./agent-ui-helper.cjs')
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
    if (JSON.stringify(body).includes('你好')) {
      return respond({ tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({ answer: '你好！我是项目 Agent，可以帮你读取、修改和测试接口与 Flow。', steps: [] }) } }] })
    }
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
  assert.equal(await panel.getByText('项目 Agent', { exact: true }).count(), 0, 'the redundant panel title must be removed')
  const viewport = await page.evaluate(() => window.innerWidth)
  const height = await page.evaluate(() => window.innerHeight)
  const box = await page.locator('.ant-drawer-content-wrapper').boundingBox()
  assert(Math.abs(box.width / viewport - 0.4) < 0.03, `panel must be about 40vw (${box.width}/${viewport})`)
  assert(box.y > 20 && height - (box.y + box.height) > 8, `panel must leave space above and below (${box.y}, ${height - (box.y + box.height)})`)
  assert.equal(await page.locator('.ant-drawer-mask').count(), 0, 'dock must not mask the main interface')
  await page.waitForTimeout(400)
  const wrapper = page.locator('.ant-drawer-content-wrapper')
  const handle = page.getByRole('separator', { name: '调整 Agent 面板宽度' })
  const startHandle = await handle.boundingBox()
  const startWidth = (await wrapper.boundingBox()).width
  await page.mouse.move(startHandle.x + 4, startHandle.y + startHandle.height / 2)
  await page.mouse.down()
  await page.mouse.move(startHandle.x - 120, startHandle.y + startHandle.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const widened = (await wrapper.boundingBox()).width
  assert(widened > startWidth + 80, `dragging left must widen the panel (${startWidth} -> ${widened})`)
  const handleAfter = await handle.boundingBox()
  await page.mouse.move(handleAfter.x + 4, handleAfter.y + handleAfter.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleAfter.x + 500, handleAfter.y + handleAfter.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const minWidth = await page.evaluate(() => Math.round(window.innerWidth * 0.4))
  const restored = (await wrapper.boundingBox()).width
  assert(Math.abs(restored - minWidth) <= 2, `panel must stop at the 40vw minimum (${restored} vs ${minWidth})`)
  await page.getByRole('button', { name: '整轮撤销与记录', exact: true }).click()
  await page.locator('.agent-dock-subview').waitFor()
  assert.equal(await page.locator('.ant-drawer-content-wrapper').count(), 1, 'undo view must stay inside the dock panel')
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await page.getByRole('button', { name: '项目候选汇总', exact: true }).click()
  await page.locator('.agent-dock-subview').waitFor()
  assert.equal(await page.locator('.ant-drawer-content-wrapper').count(), 1, 'candidates view must stay inside the dock panel')
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  for (const name of ['只读计划', '修改草稿', '执行草稿', '执行接口用例', '修改并保存', '新建接口草稿', '连续任务']) {
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `legacy mode button ${name} must be removed`)
  }
  assert(await page.locator('.agent-compose-bar').getByRole('combobox', { name: '权限模式' }).isVisible())
  await page.locator('.agent-compose-bar .ant-select').filter({ hasText: '询问权限' }).locator('.ant-select-selector').hover()
  await page.waitForTimeout(250)
  assert.equal(await page.locator('.ant-tooltip').filter({ hasText: '仅全只读计划自动执行' }).count(), 0, 'permission hover must not cover the dropdown')
  assert(await page.locator('.agent-compose-bar').getByRole('combobox', { name: '模型连接' }).isVisible())
  assert.equal(await page.locator('.agent-dock-controls').getByRole('combobox', { name: '权限模式' }).count(), 0, 'permission selector must sit in the bottom bar')
  assert(await page.getByRole('textbox', { name: '告诉 Agent 要做什么' }).isVisible())
  await panel.getByText('界面连接', { exact: false }).waitFor()
  const projectBox = await panel.locator('.agent-dock-project').boundingBox()
  const sessionBox = await panel.locator('.agent-session-title').boundingBox()
  assert(projectBox && sessionBox && Math.abs((projectBox.y + projectBox.height / 2) - (sessionBox.y + sessionBox.height / 2)) < 12, 'project and session titles must share a row')
  await panel.getByRole('button', { name: '新建会话' }).click()
  await panel.locator('.agent-session-title').click()
  const renameInput = panel.locator('.agent-session-title-input')
  await renameInput.waitFor()
  const inputBox = await renameInput.boundingBox()
  const deleteBox = await panel.getByRole('button', { name: '删除会话' }).boundingBox()
  assert(inputBox && deleteBox && Math.abs((inputBox.y + inputBox.height / 2) - (deleteBox.y + deleteBox.height / 2)) < 20, 'editing the title must keep the controls row intact')
  const originalWidth = await page.evaluate(() => window.innerWidth)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760))
  await page.waitForTimeout(250)
  const narrowInput = await renameInput.boundingBox()
  const narrowDelete = await panel.getByRole('button', { name: '删除会话' }).boundingBox()
  assert(narrowInput && narrowInput.width <= 150, 'rename input width must stay constrained')
  assert(narrowInput && narrowDelete && Math.abs((narrowInput.y + narrowInput.height / 2) - (narrowDelete.y + narrowDelete.height / 2)) < 20, 'controls must not wrap internally at 1000px')
  const iconYs = await Promise.all(['整轮撤销与记录', '项目候选汇总', 'Agent 设置', '收起面板'].map(async name => (await panel.getByRole('button', { name }).boundingBox()).y))
  assert(Math.max(...iconYs) - Math.min(...iconYs) < 10, 'header icons must stay aligned when the header wraps')
  await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), originalWidth)
  await page.waitForTimeout(200)
  await renameInput.fill('界面会话')
  await renameInput.press('Enter')
  await panel.getByText('界面会话', { exact: true }).waitFor()
  assert.equal(await page.evaluate(async pid => (await window.api.agent.listConversations(pid)).data[0].title, pid), '界面会话')

  // Main interface stays operable while the unmasked panel is open.
  await page.getByRole('link', { name: '最近' }).click()
  await page.waitForURL(/#\/history/)
  await panel.waitFor()

  const goalBox = page.getByRole('textbox', { name: '告诉 Agent 要做什么' })
  assert.equal(await page.getByRole('button', { name: '旧计划模式' }).count(), 0, 'legacy plan toggle must not be visible')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('kindra:legacy-plan-mode', { detail: true })))
  await page.locator('.agent-dock-panel[data-legacy-plan-mode="true"]').waitFor()
  await goalBox.fill('你好')
  await goalBox.press('Enter')
  await panel.getByText('你好！我是项目 Agent，可以帮你读取、修改和测试接口与 Flow。', { exact: true }).waitFor()
  assert.equal(await panel.getByText('槽位对象缺失', { exact: true }).count(), 0, 'a greeting must not become a broken plan')
  const cardsBefore = await page.locator('.agent-plan-card').count()
  await goalBox.fill('第一行')
  await goalBox.press('Shift+Enter')
  await goalBox.type('第二行')
  assert((await goalBox.inputValue()).includes('\n'), 'Shift+Enter must insert a newline')
  assert.equal(await page.locator('.agent-plan-card').count(), cardsBefore, 'Shift+Enter must not send')
  await goalBox.fill('把界面接口的说明改为界面已验证')
  await goalBox.press('Enter')
  const card = page.locator('.agent-plan-card').filter({ hasText: '把界面接口的说明改为界面已验证' }).first()
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
  const modeSelect = page.locator('.agent-compose-bar .ant-select').filter({ hasText: '自动模式' })
  await modeSelect.locator('.ant-select-selector').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '跳过权限' }).click()
  await page.getByText('高风险', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: /取\s*消/ }).click()

  // Settings open inside the same panel from the top-right gear.
  await page.getByRole('button', { name: 'Agent 设置' }).click()
  await page.locator('#agent-connections').waitFor()
  await page.getByText('Agent 模型连接', { exact: true }).waitFor()
  assert(await panel.isVisible(), 'settings must render inside the dock panel')

  // Connection CRUD stays inside the panel.
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
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await page.getByRole('textbox', { name: '告诉 Agent 要做什么' }).waitFor()
  await page.getByRole('link', { name: '设置' }).click()
  await page.getByText('项目', { exact: true }).waitFor()
  assert.equal(await page.locator('#agent-connections').count(), 0, 'settings page must not host Agent settings')
  console.log('PASS dock entry, 40vw unmasked panel, inline plan approval, permission confirmations and settings-hosted connection CRUD')
})().catch(async error => { if (app) { try { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/dock-ui-failure.png' }) } catch {} } console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve())) })
