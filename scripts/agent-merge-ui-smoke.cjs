const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-merge-ui-'))
let app, pid, targetId
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), name = body.tools?.[0]?.function.name
  const message = name ? { tool_calls: [{ id: 'merge', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, target_id: targetId, patch: { url: 'https://example.invalid/agent', description: 'Agent 独立说明' } }) } }] } : { content: '已准备候选' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  let page = await app.firstWindow(); await page.getByRole('link', { name: 'Agent' }).waitFor()
  const info = await page.evaluate(async base => {
    const p = (await window.api.projects.ensureDefault()).data
    const target = (await window.api.targets.create(p.project_id, '0', 'api')).data
    target.name = '合并验收接口'; target.url = 'https://example.invalid/base'; await window.api.targets.save(p.project_id, target)
    await window.api.agent.saveConnection({ name: '合并', base_url: base, model: 'merge-ui', protocol: 'chat-completions' }); await window.api.agent.testConnection()
    return { pid: p.project_id, targetId: target.target_id }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  ;({ pid, targetId } = info)
  await page.getByRole('link', { name: 'Agent' }).click(); await page.getByRole('link', { name: /APIs$/ }).click()
  await page.getByText('合并验收接口', { exact: true }).first().click()
  await page.getByLabel('请求 URL', { exact: true }).fill('https://example.invalid/discarded')
  await page.getByLabel('请求 URL', { exact: true }).press('Tab')
  await page.locator(`[data-tab-id="${targetId}"] .red-dot`).waitFor()
  await page.locator(`[data-tab-id="${targetId}"] .tab-x`).click()
  await page.getByRole('button', { name: '放弃并关闭', exact: true }).click()
  const discarded = await page.evaluate(async ({ pid, targetId }) => (await window.api.agent.getDraft(pid, targetId)).data, { pid, targetId })
  assert.equal(discarded.target.url, 'https://example.invalid/base', 'real UI discard-close releases its manual mirror')
  const candidateBase = await page.evaluate(async ({ pid, targetId }) => {
    const target = (await window.api.targets.get(pid, targetId)).data
    target.description = '关闭后的外部更新'; await window.api.targets.save(pid, target)
    const plan = (await window.api.agent.proposeEditPlan(pid, { goal: '修改地址和说明', targetId })).data
    await window.api.agent.approvePlan(pid, plan.plan_id)
    return (await window.api.agent.listCandidates(pid, targetId)).data[0].base
  }, { pid, targetId })
  assert.equal(candidateBase.url, 'https://example.invalid/base'); assert.equal(candidateBase.description, '关闭后的外部更新')
  await page.getByText('合并验收接口', { exact: true }).first().click()

  await page.getByLabel('请求 URL', { exact: true }).fill('https://example.invalid/human')
  await page.getByRole('button', { name: '审阅 Agent 版本', exact: true }).click()
  await page.getByRole('button', { name: '应用到草稿', exact: true }).click()
  await page.getByLabel('Agent 冲突审阅', { exact: true }).waitFor()
  const review = page.getByLabel('冲突 /url', { exact: true })
  for (const text of ['基线', '当前内容', 'Agent 内容', '合并结果']) await review.getByText(text, { exact: true }).waitFor()
  assert.equal(await review.getByRole('radio').count(), 3)
  await page.locator('.ant-drawer-close').click()
  await page.locator('.save-btn').click()
  await page.getByText('该接口存在未解决的 Agent 候选冲突，请先在版本入口处理后保存', { exact: true }).waitFor()
  const saved = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  assert.equal(saved.url, 'https://example.invalid/base')
  // Conflicts and the save barrier survive process restart; no in-memory lock is required.
  await app.evaluate(({ app }) => app.exit(0)); app = null
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  page = await app.firstWindow(); await page.getByText('合并验收接口', { exact: true }).first().click()
  await page.locator('.save-btn').click()
  await page.getByText('该接口存在未解决的 Agent 候选冲突，请先在版本入口处理后保存', { exact: true }).waitFor()

  await page.getByRole('button', { name: '审阅 Agent 版本', exact: true }).click()
  await page.getByRole('button', { name: '查看差异', exact: true }).click()
  await page.getByRole('radio', { name: '采用 Agent', exact: true }).check()
  assert.equal(await page.getByLabel('结果 /url', { exact: true }).innerText(), 'https://example.invalid/agent')
  await page.getByRole('button', { name: '确认冲突选择并应用草稿', exact: true }).click()
  await page.getByText('已应用草稿', { exact: true }).waitFor()
  await page.locator('.ant-drawer-close').click()
  assert.equal(await page.getByLabel('请求 URL', { exact: true }).inputValue(), 'https://example.invalid/agent')
  await page.locator('.save-btn').click()
  await page.getByText('已保存', { exact: true }).waitFor()
  const result = await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data, { pid, targetId })
  assert.equal(result.url, 'https://example.invalid/agent'); assert.equal(result.description, 'Agent 独立说明')
  console.log('PASS Electron four-way conflict choices, automatic independent merge and legacy manual save barrier')
})().catch(async error => { if (app) { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/merge-ui-08.png' }); console.error((await page.locator('body').innerText()).slice(-5000)) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close() })
