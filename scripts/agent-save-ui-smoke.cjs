const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, closeAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-save-ui-'))
let app, pid, targetId, missingDocs = false
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), tools = (body.tools ?? []).map(tool => tool.function?.name)
  const patch = missingDocs ? { request: { query: { parameter: [{ param_id: 'category', key: 'category', value: 'A', is_checked: 1, field_type: 'string' }] } } } : { description: '通过一次批准正式保存' }
  let message
  if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (tools.includes('propose_task_plan')) message = { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({
    selected_objects: [{ kind: 'api', id: targetId }],
    proposed_effects: { save_definitions: true },
    steps: [
      { step_id: 'edit', operation: 'propose_api_change', binding: 'deferred', target_id: targetId, depends_on: [], intent: '修改定义', allowed_changes: ['description', 'request.query.parameter*'] },
      { step_id: 'save', operation: 'save_api', binding: 'static', target_id: targetId, depends_on: ['edit'] }
    ]
  }) } }] }
  else if (tools.includes('propose_api_change')) message = { tool_calls: [{ id: 'edit', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: targetId, step_id: 'edit', depends_on: [], patch }) } }] }
  else message = { content: missingDocs ? '缺少业务依据，请澄清字段规则。正式定义没有保存。' : '正式保存完成，候选已关联版本。' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  const page = await app.firstWindow(); await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  ;({ pid, targetId } = await page.evaluate(async base => {
    const p = (await window.api.projects.ensureDefault()).data
    const target = (await window.api.targets.create(p.project_id, '0', 'api')).data
    target.name = '获批保存验收接口'; target.description = '原说明'; target.url = 'https://example.invalid/ui'; await window.api.targets.save(p.project_id, target)
    await window.api.agent.saveConnection({ name: '获批保存', base_url: base, model: 'save-ui', protocol: 'chat-completions' }); await window.api.agent.testConnection()
    return { pid: p.project_id, targetId: target.target_id }
  }, `http://127.0.0.1:${server.address().port}/v1`))
  await openAgentPanel(page); await page.getByRole('link', { name: /APIs$/ }).click()
  await page.getByText('获批保存验收接口', { exact: true }).first().click()
  await submitAgentGoal(page, '把说明改为通过一次批准正式保存，并保存定义')
  await page.getByText('save · 保存正式定义 获批保存验收接口', { exact: true }).waitFor()
  const before = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  assert.equal(before.description, '原说明')
  await page.getByRole('button', { name: '批准修改与保存计划', exact: true }).click()
  await page.getByText('正式保存完成，候选已关联版本。', { exact: true }).waitFor()
  const result = await page.evaluate(async ({ pid, targetId }) => ({ saved: (await window.api.targets.get(pid, targetId)).data, candidates: (await window.api.agent.listCandidates(pid, targetId)).data, draft: (await window.api.agent.getDraft(pid, targetId)).data }), { pid, targetId })
  assert.equal(result.saved.description, '通过一次批准正式保存'); assert.equal(result.candidates[0].saved_version.version, result.saved.version); assert.equal(result.draft.agent_owned, false)
  assert.equal(await page.getByRole('button', { name: '应用到草稿', exact: true }).count(), 0)
  await closeAgentPanel(page)
  await page.getByRole('link', { name: /APIs$/ }).click()
  assert.equal(await page.locator(`[data-tab-id="${targetId}"] .red-dot`).count(), 0, 'saved projection clears dirty state of the open editor')
  await page.getByRole('button', { name: '审阅 Agent 版本', exact: true }).click()
  await page.getByText(`已关联正式版本 v${result.saved.version}`, { exact: true }).waitFor()
  await page.locator('.ant-drawer-close').click()
  missingDocs = true
  await submitAgentGoal(page, '新增 category 字段，业务规则尚未明确')
  await page.getByRole('button', { name: '批准修改与保存计划', exact: true }).click()
  await page.getByText('缺少业务依据，请澄清字段规则。正式定义没有保存。', { exact: true }).waitFor()
  await page.getByText('需要重新确认', { exact: true }).waitFor()
  const blocked = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  assert.equal(blocked.version, result.saved.version); assert.equal(blocked.request.query.parameter.length, 0)
  console.log('PASS Electron explicit save step, single approval, automatic adoption, clean editor/version link and visible documentation clarification')
})().catch(async error => { if (app) { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/save-ui-09.png' }); console.error((await page.locator('body').innerText()).slice(-6000)) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close() })
