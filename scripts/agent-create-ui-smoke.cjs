const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, closeAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-create-ui-'))
let app, pid, targetId
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), tools = (body.tools ?? []).map(t => t.function.name)
  const slots = body.messages.map(m => { try { return JSON.parse(m.content) } catch { return null } }).filter(Boolean).find(v => Array.isArray(v.approved_slots))?.approved_slots ?? []
  let message
  if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (tools.includes('propose_task_plan')) {
    const planned = targetId
      ? { selected_objects: [{ kind: 'api', id: targetId }], proposed_effects: { save_definitions: true }, steps: [{ step_id: 'save', operation: 'save_api', binding: 'static', target_id: targetId, depends_on: [] }] }
      : { selected_objects: [], new_objects: [{ temp_id: 'new-api', name: '尚未创建的健康接口', parent_id: '0', intent: '创建健康检查接口草稿' }], steps: [{ step_id: 'create', operation: 'create_api', binding: 'deferred', target_id: 'new-api', depends_on: [] }] }
    message = { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify(planned) } }] }
  } else if (tools.includes('create_api')) {
    const slot = slots.find(item => item.operation === 'create_api')
    message = { tool_calls: [{ id: 'create', type: 'function', function: { name: 'create_api', arguments: JSON.stringify({ project_id: pid, target_id: slot.target_id, step_id: slot.step_id, depends_on: [], patch: { name: '尚未创建的健康接口', description: '用户确认健康检查', url: 'https://example.invalid/health' } }) } }] }
  } else message = { content: '草稿与正式定义分别处理。' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
const launch = () => _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await launch(); let page = await app.firstWindow(); await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  pid = await page.evaluate(async base => {
    const p = (await window.api.projects.ensureDefault()).data
    await window.api.agent.saveConnection({ name: '新建', base_url: base, model: 'create-ui', protocol: 'chat-completions' }); await window.api.agent.testConnection()
    return p.project_id
  }, `http://127.0.0.1:${server.address().port}/v1`)
  await submitAgentGoal(page, '新建健康检查接口，只保留草稿')
  await page.getByRole('button', { name: '批准新建计划', exact: true }).click()
  await page.getByText('草稿与正式定义分别处理。', { exact: true }).waitFor()
  await openAgentPanel(page)
  await page.getByRole('button', { name: '项目候选汇总' }).click()
  await page.getByText('尚未正式创建', { exact: true }).waitFor()
  await page.getByRole('button', { name: '审阅候选', exact: true }).click()
  await page.getByRole('button', { name: '不采纳', exact: true }).click()
  await page.getByText('未采纳', { exact: true }).waitFor()
  targetId = await page.evaluate(async pid => (await window.api.agent.listProjectCandidates(pid)).data[0].entity_id, pid)
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId }), null)
  await app.evaluate(({ app }) => app.exit(0)); app = await launch(); page = await app.firstWindow()
  await openAgentPanel(page)
  await page.getByRole('button', { name: '项目候选汇总', exact: true }).click()
  await page.getByRole('button', { name: '审阅候选', exact: true }).click()
  await page.getByText('未采纳', { exact: true }).waitFor()
  await page.getByRole('button', { name: '恢复到草稿', exact: true }).click()
  await page.getByText('已应用草稿', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await submitAgentGoal(page, '正式保存健康检查草稿')
  await page.getByRole('button', { name: '批准修改与保存计划', exact: true }).click()
  await page.getByText('草稿与正式定义分别处理。', { exact: true }).first().waitFor()
  await page.waitForFunction(async ({ pid, targetId }) => !!(await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  await page.getByRole('button', { name: '项目候选汇总' }).click()
  await page.getByText('已正式保存', { exact: true }).waitFor()
  console.log('PASS Electron new API creation, project summary, rejection/restart/restore and later independent save')
})().catch(async error => { if (app) { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/create-ui-12.png' }); console.error((await page.locator('body').innerText()).slice(-5000)) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close() })
