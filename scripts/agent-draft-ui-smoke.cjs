const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-draft-ui-'))
let app, pid, targetId, manualId, hold = false
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), name = body.tools?.[0]?.function.name
  if (hold && !name) { res.setHeader('Content-Type', 'text/event-stream'); res.write('data: {"choices":[{"delta":{"content":"进行中"}}]}\n\n'); return }
  const message = name ? { tool_calls: [{ id: 'one', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, target_id: targetId, patch: { description: 'Agent 候选说明', request: { query: { parameter: [{ param_id: 'second', key: 'duplicate', value: '', is_checked: 1 }] } } } }) } }] } : { content: '修改提案已创建，等待审阅。' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  const page = await app.firstWindow(); await page.getByRole('link', { name: 'Agent' }).waitFor(); return page
}
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); app = null } }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let page = await launch()
  const info = await page.evaluate(async base => {
    const p = (await window.api.projects.ensureDefault()).data
    const target = (await window.api.targets.create(p.project_id, '0', 'api')).data
    target.request.query.parameter = [{ param_id: 'first', key: 'duplicate', value: '', is_checked: 1 }, { param_id: 'second', key: 'duplicate', value: '', is_checked: 1 }];
    target.name = 'Agent 验收接口'; target.description = '原说明'; await window.api.targets.save(p.project_id, target)
    const manual = (await window.api.targets.create(p.project_id, '0', 'api')).data
    manual.name = '人工验收接口'; await window.api.targets.save(p.project_id, manual)
    await window.api.agent.saveConnection({ name: '草稿测试', base_url: base, model: 'draft-ui', protocol: 'chat-completions' }); await window.api.agent.testConnection()
    return { pid: p.project_id, originalName: p.name, targetId: target.target_id, manualId: manual.target_id }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  ;({ pid, targetId, manualId } = info)
  // Switch projects while a stream is active through the real project selector.
  await page.getByRole('button', { name: '新建/导入项目' }).click()
  await page.getByPlaceholder('项目名称').fill('后台任务另一个项目')
  await page.locator('.ant-modal').getByRole('button', { name: '创 建' }).click()
  await page.locator('.project-switch').filter({ hasText: '后台任务另一个项目' }).waitFor()
  await page.locator('.project-switch').click()
  await page.getByRole('menuitem', { name: info.originalName }).click()
  await page.locator('.project-switch').filter({ hasText: info.originalName }).waitFor()
  hold = true
  const backgroundId = await page.evaluate(async pid => { const c = (await window.api.agent.createConversation(pid)).data; await window.api.agent.sendMessage(pid, c.conversation_id, '跨项目任务'); return c.conversation_id }, pid)
  await page.locator('.project-switch').click()
  await page.getByRole('menuitem', { name: '后台任务另一个项目' }).click()
  await page.locator('.project-switch').filter({ hasText: '后台任务另一个项目' }).waitFor()
  assert.equal((await page.evaluate(async ({ pid, backgroundId }) => (await window.api.agent.getConversation(pid, backgroundId)).data, { pid, backgroundId })).status, 'running')
  await page.locator('.project-switch').click()
  await page.getByRole('menuitem', { name: info.originalName }).click()
  await page.locator('.project-switch').filter({ hasText: info.originalName }).waitFor()
  await page.evaluate(async ({ pid, backgroundId }) => window.api.agent.cancelMessage(pid, backgroundId), { pid, backgroundId })
  hold = false
  await page.getByRole('link', { name: 'Agent' }).click()
  await page.getByRole('button', { name: '修改草稿', exact: true }).click()
  await page.getByLabel('计划目标').fill('把接口说明改为 Agent 候选说明')
  await page.getByRole('combobox', { name: '计划接口' }).click()
  await page.locator('.ant-select-item-option').filter({ hasText: 'Agent 验收接口' }).click()
  await page.getByRole('combobox', { name: '计划接口' }).press('Escape')
  await page.getByRole('button', { name: '生成草稿修改计划', exact: true }).click()
  await page.getByRole('button', { name: '批准修改计划', exact: true }).click()
  await page.getByText('修改提案已创建，等待审阅。', { exact: true }).waitFor()
  await page.locator('.ant-drawer-close').click()
  await page.getByRole('link', { name: /APIs$/ }).click()
  await page.getByText('Agent 验收接口', { exact: true }).first().click()
  await page.getByRole('button', { name: '审阅 Agent 版本', exact: true }).click()
  await page.getByRole('button', { name: '查看差异', exact: true }).click()
  await page.getByLabel('候选双栏差异').waitFor()
  assert((await page.locator('[data-diff=removed]').allTextContents()).some(line => line.includes('"value": ""')), 'deleting a duplicate JSON value must remain visibly removed')
  await page.getByRole('button', { name: '应用到草稿', exact: true }).click()
  await page.getByText('已应用草稿', { exact: true }).waitFor()
  await page.locator('.ant-drawer-close').click()
  await page.getByLabel('请求 URL', { exact: true }).fill('https://example.invalid/agent-unsaved')
  await page.getByText('人工验收接口', { exact: true }).first().click()
  await page.getByLabel('请求 URL', { exact: true }).fill('https://example.invalid/manual-saved-on-exit')
  // Trigger a real unfinished model stream, then use the actual native quit guard.
  hold = true
  await page.evaluate(async pid => { const c = (await window.api.agent.createConversation(pid)).data; await window.api.agent.sendMessage(pid, c.conversation_id, '持续任务') }, pid)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
  assert.equal((await page.evaluate(async pid => (await window.api.agent.listConversations(pid)).data, pid))[0].status, 'running')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
  await app.evaluate(({ app }) => { app.quit() })
  await page.locator('.ant-modal-confirm-title').filter({ hasText: '退出将停止 Agent 任务' }).waitFor()
  await page.getByRole('button', { name: '继续工作', exact: true }).click()
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => { app.quit() })
  await page.getByRole('button', { name: '停止并退出', exact: true }).click()
  await closed; app = null; hold = false
  page = await launch()
  const state = await page.evaluate(async ({ pid, targetId, manualId }) => ({ saved: (await window.api.targets.get(pid, targetId)).data, draft: (await window.api.agent.getDraft(pid, targetId)).data, manual: (await window.api.targets.get(pid, manualId)).data, candidates: (await window.api.agent.listCandidates(pid, targetId)).data, conversations: (await window.api.agent.listConversations(pid)).data }), { pid, targetId, manualId })
  assert.equal(state.saved.description, '原说明'); assert.notEqual(state.saved.url, 'https://example.invalid/agent-unsaved')
  assert.equal(state.draft.target.description, 'Agent 候选说明'); assert.equal(state.draft.target.url, 'https://example.invalid/agent-unsaved')
  assert.equal(state.manual.url, 'https://example.invalid/manual-saved-on-exit')
  assert(state.conversations.some(c => c.status === 'interrupted'))
  assert(state.conversations.every(c => c.status !== 'running'))
  assert.equal(state.candidates.length, 2)
  await page.getByText('Agent 验收接口', { exact: true }).first().click()
  await page.getByText('已恢复 Agent 未保存草稿；退出仅暂存，不会自动保存定义。', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('请求 URL', { exact: true }).inputValue(), 'https://example.invalid/agent-unsaved')
  console.log('PASS Electron proposal approval, candidate diff/application, manual edits, native quit prompt, draft-only recovery and manual auto-save')
})().catch(async error => { if (app) { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/draft-ui-07.png' }); console.error((await page.locator('body').innerText()).slice(-6000)) }; console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); server.closeAllConnections(); server.close() })
