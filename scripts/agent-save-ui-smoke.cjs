const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-save-ui-'))
let app, pid, targetId, missingDocs = false
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), probe = body.tools?.[0]?.function.name === 'kindra_capability_probe'
  const calls = probe ? [{ name: 'kindra_capability_probe', args: { token: 'kindra-probe' } }] : [
    { name: 'propose_api_change', args: { project_id: pid, target_id: targetId, step_id: 'edit', patch: missingDocs ? { request: { query: { parameter: [{ param_id: 'category', key: 'category', value: 'A', is_checked: 1, field_type: 'string' }] } } } : { description: '通过一次批准正式保存' }, depends_on: [] } },
    { name: 'save_api', args: { project_id: pid, target_id: targetId, step_id: 'save', depends_on: ['edit'] } }
  ]
  const message = body.tools ? { tool_calls: calls.map((call, index) => ({ id: `save-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { content: missingDocs ? '缺少业务依据，请澄清字段规则。正式定义没有保存。' : '正式保存完成，候选已关联版本。' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  const page = await app.firstWindow(); await page.getByRole('link', { name: 'Agent' }).waitFor()
  ;({ pid, targetId } = await page.evaluate(async base => {
    const p = (await window.api.projects.ensureDefault()).data
    const target = (await window.api.targets.create(p.project_id, '0', 'api')).data
    target.name = '获批保存验收接口'; target.description = '原说明'; target.url = 'https://example.invalid/ui'; await window.api.targets.save(p.project_id, target)
    await window.api.agent.saveConnection({ name: '获批保存', base_url: base, model: 'save-ui', protocol: 'chat-completions' }); await window.api.agent.testConnection()
    return { pid: p.project_id, targetId: target.target_id }
  }, `http://127.0.0.1:${server.address().port}/v1`))
  await page.getByRole('link', { name: 'Agent' }).click(); await page.getByRole('link', { name: /APIs$/ }).click()
  await page.getByText('获批保存验收接口', { exact: true }).first().click()
  await page.getByRole('link', { name: 'Agent' }).click()
  await page.getByRole('button', { name: '修改并保存', exact: true }).click()
  await page.getByLabel('计划目标').fill('把说明改为通过一次批准正式保存，并保存定义')
  await page.getByRole('button', { name: '生成修改与保存计划', exact: true }).click()
  await page.getByText('save · 保存正式定义 获批保存验收接口', { exact: true }).waitFor()
  const before = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  assert.equal(before.description, '原说明')
  await page.getByRole('button', { name: '批准修改与保存计划', exact: true }).click()
  await page.getByText('正式保存完成，候选已关联版本。', { exact: true }).waitFor()
  const result = await page.evaluate(async ({ pid, targetId }) => ({ saved: (await window.api.targets.get(pid, targetId)).data, candidates: (await window.api.agent.listCandidates(pid, targetId)).data, draft: (await window.api.agent.getDraft(pid, targetId)).data }), { pid, targetId })
  assert.equal(result.saved.description, '通过一次批准正式保存'); assert.equal(result.candidates[0].saved_version.version, result.saved.version); assert.equal(result.draft.agent_owned, false)
  assert.equal(await page.getByRole('button', { name: '应用到草稿', exact: true }).count(), 0)
  await page.locator('.ant-drawer-close').click()
  await page.getByRole('link', { name: /APIs$/ }).click()
  assert.equal(await page.locator(`[data-tab-id="${targetId}"] .red-dot`).count(), 0, 'saved projection clears dirty state of the open editor')
  await page.getByRole('button', { name: '审阅 Agent 版本', exact: true }).click()
  await page.getByText(`已关联正式版本 v${result.saved.version}`, { exact: true }).waitFor()
  await page.locator('.ant-drawer-close').click()
  missingDocs = true
  await page.getByRole('link', { name: 'Agent' }).click()
  await page.getByRole('button', { name: '修改并保存', exact: true }).click()
  await page.getByLabel('计划目标').fill('新增 category 字段，业务规则尚未明确')
  await page.getByRole('button', { name: '生成修改与保存计划', exact: true }).click()
  await page.getByRole('button', { name: '批准修改与保存计划', exact: true }).click()
  await page.getByText('缺少业务依据，请澄清字段规则。正式定义没有保存。', { exact: true }).waitFor()
  await page.getByText('需要重新确认', { exact: true }).waitFor()
  const blocked = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  assert.equal(blocked.version, result.saved.version); assert.equal(blocked.request.query.parameter.length, 0)
  console.log('PASS Electron explicit save step, single approval, automatic adoption, clean editor/version link and visible documentation clarification')
})().catch(async error => { if (app) { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/save-ui-09.png' }); console.error((await page.locator('body').innerText()).slice(-6000)) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close() })
