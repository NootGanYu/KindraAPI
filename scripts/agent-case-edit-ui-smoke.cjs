const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, closeAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-case-ui-'))
let app, pid, targetId, originalVersion, saveOnly = false
const apiCase = { case_id: 'ui-case', name: '订单成功用例', is_enabled: 1, override: { url: 'https://example.invalid/agent' }, assertions: [{ assertion_id: 'status', kind: 'status', op: 'equals', expected: '201', is_enabled: 1 }] }
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), tools = (body.tools ?? []).map(tool => tool.function?.name)
  let message
  if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (tools.includes('propose_task_plan')) {
    const planned = saveOnly
      ? { selected_objects: [{ kind: 'api', id: targetId }], proposed_effects: { save_definitions: true }, steps: [{ step_id: 'save', operation: 'save_api', binding: 'static', target_id: targetId, depends_on: [] }] }
      : { selected_objects: [{ kind: 'api', id: targetId }], steps: [{ step_id: 'case-edit', operation: 'propose_api_change', binding: 'deferred', target_id: targetId, depends_on: [], intent: '修改用例覆盖与断言', allowed_changes: ['cases'] }] }
    message = { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify(planned) } }] }
  } else if (!saveOnly && tools.includes('propose_api_change')) message = { tool_calls: [{ id: 'case', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: targetId, step_id: 'case-edit', depends_on: [], patch: { cases: [apiCase] } }) } }] }
  else message = { content: saveOnly ? '用例正式保存完成。' : '用例候选已创建，正式定义未保存。' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  const page = await app.firstWindow(); await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  ;({ pid, targetId, originalVersion } = await page.evaluate(async ({ base, apiCase }) => {
    const p = (await window.api.projects.ensureDefault()).data
    const target = (await window.api.targets.create(p.project_id, '0', 'api')).data
    target.name = '用例审阅接口'; target.description = '订单业务说明'; target.url = 'https://example.invalid/api'
    target.cases = [{ ...apiCase, override: { url: 'https://example.invalid/base' }, assertions: [{ ...apiCase.assertions[0], expected: '200' }] }]
    target.custom_attributes = { owner: '历史负责人' }; await window.api.targets.save(p.project_id, target)
    const originalVersion = (await window.api.targets.versions.list(p.project_id, target.target_id)).data[0]
    await window.api.agent.saveConnection({ name: '用例审阅', base_url: base, model: 'case-ui', protocol: 'chat-completions' }); await window.api.agent.testConnection()
    return { pid: p.project_id, targetId: target.target_id, originalVersion }
  }, { base: `http://127.0.0.1:${server.address().port}/v1`, apiCase }))
  await openAgentPanel(page); await page.getByRole('link', { name: /APIs$/ }).click()
  await page.getByText('用例审阅接口', { exact: true }).first().click()
  await submitAgentGoal(page, '把订单用例覆盖地址改为 agent，状态断言改为201')
  await page.getByRole('button', { name: '批准修改计划', exact: true }).click()
  await page.getByText('用例候选已创建，正式定义未保存。', { exact: true }).waitFor()
  const before = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  assert.equal(before.cases[0].assertions[0].expected, '200')
  await closeAgentPanel(page); await page.getByRole('link', { name: /APIs$/ }).click()
  await page.getByText('接口用例', { exact: true }).click()
  await page.getByPlaceholder('URL（留空继承）').fill('https://example.invalid/human')
  await page.getByPlaceholder('URL（留空继承）').press('Tab')
  await page.getByRole('button', { name: '审阅 Agent 版本', exact: true }).click()
  await page.getByRole('button', { name: '查看差异', exact: true }).click()
  const diff = await page.getByLabel('候选双栏差异').innerText()
  assert(diff.includes('"override"') && diff.includes('"assertions"') && diff.includes('201'))
  await page.getByRole('button', { name: '应用到草稿', exact: true }).click()
  await page.getByLabel('冲突 /cases/case_id=ui-case/override/url', { exact: true }).waitFor()
  await page.getByRole('radio', { name: '采用 Agent', exact: true }).check()
  await page.getByRole('button', { name: '确认冲突选择并应用草稿', exact: true }).click()
  await page.getByText('已应用草稿', { exact: true }).waitFor(); await page.locator('.ant-drawer-close').click()
  assert.equal(await page.getByPlaceholder('URL（留空继承）').inputValue(), 'https://example.invalid/agent')
  assert.equal(await page.getByPlaceholder('期望值').inputValue(), '201')
  saveOnly = true
  await submitAgentGoal(page, '保存已解决冲突的用例')
  await page.getByRole('button', { name: '批准修改与保存计划', exact: true }).click()
  await page.getByText('用例正式保存完成。', { exact: true }).waitFor()
  await closeAgentPanel(page); await page.getByRole('link', { name: /APIs$/ }).click()
  await page.evaluate(async ({ pid, targetId }) => {
    const target = (await window.api.targets.get(pid, targetId)).data
    target.custom_attributes = { owner: '新负责人', later: '恢复后移除' }
    target.cases[0].last_run = { ran_at: '2026-11-03T01:00:00.000Z', status: 'passed', http_status: 201 }
    await window.api.targets.save(pid, target)
  }, { pid, targetId })
  await page.getByRole('button', { name: '审阅 Agent 版本', exact: true }).click()
  await page.locator('.version-row').filter({ has: page.locator('.version-no', { hasText: `v${originalVersion.version}` }) }).getByRole('button', { name: /^恢\s*复$/ }).click()
  await page.getByText(/将恢复该版本的全部可编辑定义/).waitFor()
  await page.locator('.ant-modal-confirm').getByRole('button', { name: /^恢\s*复$/ }).click()
  await page.getByText(`已恢复到 v${originalVersion.version}`, { exact: true }).waitFor()
  const restored = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  assert.equal(restored.cases[0].assertions[0].expected, '200'); assert.equal(restored.cases[0].override.url, 'https://example.invalid/base')
  assert.deepEqual(restored.custom_attributes, { owner: '历史负责人' }); assert.equal(restored.cases[0].last_run.http_status, 201)
  assert.equal(restored.target_id, targetId)
  console.log('PASS Electron case candidate diff, stable-case conflict, explicit save, case editor and complete formal version restore')
})().catch(async error => { if (app) { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/case-ui-15.png' }); console.error((await page.locator('body').innerText()).slice(-6000)) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close() })
