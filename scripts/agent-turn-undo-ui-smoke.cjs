const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-turn-undo-ui-'))
let app, pid, targetId, flowId
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), probe = body.tools?.[0]?.function.name === 'kindra_capability_probe'
  const calls = probe ? [{ name: 'kindra_capability_probe', args: { token: 'kindra-probe' } }] : [
    { name: 'propose_api_change', args: { project_id: pid, target_id: targetId, patch: { description: 'Agent 说明', cases: [{ case_id: 'case-one', name: 'Agent 用例', is_enabled: 1, override: {}, assertions: [] }] }, step_id: 'api', depends_on: [] } },
    { name: 'propose_flow_change', args: { project_id: pid, flow_id: flowId, patch: { description: 'Agent 流程' }, step_id: 'flow', depends_on: [] } }
  ]
  if (!probe && body.messages?.some(m => JSON.stringify(m).includes('第二轮修改'))) calls.splice(1)
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: body.tools ? { tool_calls: calls.map((c, i) => ({ id: `call${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : { content: '完成' } }] }))
})
const launch = () => _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await launch(); let page = await app.firstWindow(); await page.getByRole('link', { name: 'Agent' }).waitFor()
  const info = await page.evaluate(async base => {
    const unwrap = r => { if (!r.ok) throw new Error(r.error); return r.data }
    const pid = unwrap(await window.api.projects.ensureDefault()).project_id
    const target = unwrap(await window.api.targets.create(pid, '0', 'api')); target.name = '整轮接口'; target.description = '原说明'; target.cases = [{ case_id: 'case-one', name: '原用例', is_enabled: 1, override: {}, assertions: [] }]; unwrap(await window.api.targets.save(pid, target))
    const flow = unwrap(await window.api.flows.create(pid, '整轮流程'))
    unwrap(await window.api.agent.saveConnection({ name: '整轮连接', base_url: base, model: 'turn-ui', protocol: 'chat-completions' })); unwrap(await window.api.agent.testConnection())
    return { pid, targetId: target.target_id, flowId: flow.flow_id, target: unwrap(await window.api.targets.get(pid, target.target_id)), flow: unwrap(await window.api.flows.get(pid, flow.flow_id)) }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  ;({ pid, targetId, flowId } = info)
  await page.evaluate(async ({ pid, targetId, flowId }) => {
    const u = r => { if (!r.ok) throw new Error(r.error); return r.data }
    const plan = u(await window.api.agent.proposeEditPlan(pid, { goal: '整轮修改', targetId, flowIds: [flowId] })); u(await window.api.agent.approvePlan(pid, plan.plan_id))
    const api = u(await window.api.agent.listCandidates(pid))[0], flow = u(await window.api.agent.listFlowCandidates(pid))[0]
    if (u(await window.api.agent.applyCandidate(pid, api.candidate_id)).status !== 'applied') throw new Error('API candidate not applied')
    if (u(await window.api.agent.applyFlowCandidate(pid, flow.candidate_id)).status !== 'applied') throw new Error('Flow candidate not applied')
    u(await window.api.agent.createConversation(pid))
  }, info)
  await page.getByRole('link', { name: 'Agent' }).click()
  await page.getByRole('button', { name: '整轮撤销与记录', exact: true }).click()
  await page.getByRole('button', { name: '预览整轮撤销', exact: true }).first().click()
  let review = page.getByLabel('整轮撤销审阅')
  await review.getByText('接口 / 用例 · 整轮接口').waitFor(); await review.getByText('Flow · 整轮流程').waitFor()
  await review.getByText('当前内容', { exact: true }).first().waitFor(); await review.getByText('撤销后草稿', { exact: true }).first().waitFor()
  await review.getByRole('button', { name: '放弃本次撤销' }).click()
  await page.getByLabel('撤销审计').getByText(/已放弃/).first().waitFor()
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.agent.getDraft(pid, targetId)).data.target.description, info), 'Agent 说明')
  await page.locator('.ant-drawer-body').evaluate(el => el.scrollTo(0, 0))
  await page.getByText('预览整轮撤销', { exact: true }).first().click()
  await review.getByText('接口 / 用例 · 整轮接口').waitFor()
  await review.getByRole('button', { name: '确认整轮撤销到草稿' }).click()
  await review.getByText('已撤销', { exact: true }).first().waitFor()
  let state = await page.evaluate(async ({ pid, targetId, flowId }) => ({ draft: (await window.api.agent.getDraft(pid, targetId)).data.target, flow: (await window.api.agent.getFlowDraft(pid, flowId)).data.flow, formal: (await window.api.targets.get(pid, targetId)).data, formalFlow: (await window.api.flows.get(pid, flowId)).data }), info)
  assert.equal(state.draft.description, '原说明'); assert.equal(state.draft.cases[0].name, '原用例'); assert.equal(state.flow.description, info.flow.description); assert.deepEqual(state.formal, info.target); assert.deepEqual(state.formalFlow, info.flow)
  await page.evaluate(async ({ pid, targetId }) => {
    const u = r => { if (!r.ok) throw new Error(r.error); return r.data }
    u(await window.api.agent.restoreCandidate(pid, u(await window.api.agent.listCandidates(pid))[0].candidate_id)); u(await window.api.agent.restoreFlowCandidate(pid, u(await window.api.agent.listFlowCandidates(pid))[0].candidate_id))
    const draft = u(await window.api.agent.getDraft(pid, targetId)).target; draft.description = '人工后续说明'; u(await window.api.agent.syncEditorDraft(pid, draft))
  }, info)
  await page.getByRole('button', { name: '刷新记录' }).click(); await page.getByRole('button', { name: '预览整轮撤销', exact: true }).first().click()
  let conflict = page.getByLabel('撤销冲突 /description')
  for (const label of ['应用后快照', '当前内容', '应用前内容', '合并结果']) await conflict.getByText(label, { exact: true }).waitFor()
  for (const value of ['Agent 说明', '人工后续说明', '原说明', '等待选择']) await conflict.getByText(value, { exact: false }).waitFor()
  assert.equal(await review.getByRole('button', { name: '确认整轮撤销到草稿' }).isDisabled(), true)
  await app.evaluate(({ app }) => app.exit(0)); app = await launch(); page = await app.firstWindow()
  await page.getByRole('link', { name: 'Agent' }).click(); await page.getByRole('button', { name: '整轮撤销与记录' }).click()
  await page.getByLabel('撤销审计').getByRole('button', { name: /待审阅/ }).last().click()
  conflict = page.getByLabel('撤销冲突 /description'); await conflict.getByRole('radio', { name: '保留当前' }).check()
  await conflict.getByText('人工后续说明', { exact: false }).first().waitFor()
  await page.getByLabel('整轮撤销审阅').getByRole('button', { name: '确认整轮撤销到草稿' }).click()
  await page.getByLabel('整轮撤销审阅').getByText('已撤销', { exact: true }).first().waitFor()
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.agent.getDraft(pid, targetId)).data.target.description, info), '人工后续说明')
  await page.evaluate(async ({ pid, targetId }) => {
    const u = r => { if (!r.ok) throw new Error(r.error); return r.data }
    const plan = u(await window.api.agent.proposeEditPlan(pid, { goal: '第二轮修改', targetId })); u(await window.api.agent.approvePlan(pid, plan.plan_id))
    const candidate = u(await window.api.agent.listCandidates(pid)).find(c => c.plan_id === plan.plan_id); u(await window.api.agent.applyCandidate(pid, candidate.candidate_id))
    const draft = u(await window.api.agent.getDraft(pid, targetId)).target; draft.description = '另一次人工说明'; u(await window.api.agent.syncEditorDraft(pid, draft))
  }, info)
  await page.getByRole('button', { name: '刷新记录' }).click(); await page.locator('.ant-card').filter({ hasText: '第二轮修改' }).getByRole('button', { name: '预览整轮撤销' }).click()
  conflict = page.getByLabel('撤销冲突 /description'); await conflict.getByRole('radio', { name: '恢复应用前' }).check()
  await page.getByLabel('整轮撤销审阅').getByRole('button', { name: '确认整轮撤销到草稿' }).click()
  await page.getByLabel('整轮撤销审阅').getByText('已撤销', { exact: true }).first().waitFor()
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.agent.getDraft(pid, targetId)).data.target.description, info), '人工后续说明')
  await page.getByRole('button', { name: '删除本项目 Agent 记录' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除全部 Agent 记录' }).click()
  await page.getByRole('button', { name: '整轮撤销与记录' }).waitFor()
  await app.evaluate(({ app }) => app.exit(0)); app = await launch(); page = await app.firstWindow()
  state = await page.evaluate(async ({ pid, targetId, flowId }) => ({ candidates: (await window.api.agent.listCandidates(pid)).data, flowCandidates: (await window.api.agent.listFlowCandidates(pid)).data, turns: (await window.api.agent.listTurnUndos(pid)).data, conversations: (await window.api.agent.listConversations(pid)).data, formal: (await window.api.targets.get(pid, targetId)).data, flow: (await window.api.flows.get(pid, flowId)).data, connection: (await window.api.agent.getConnection()).data }), info)
  assert.deepEqual(state.candidates, []); assert.deepEqual(state.flowCandidates, []); assert.deepEqual(state.turns, []); assert.deepEqual(state.conversations, []); assert.deepEqual(state.formal, info.target); assert.deepEqual(state.flow, info.flow); assert.equal(state.connection.name, '整轮连接')
  console.log('PASS Electron mixed turn undo, conflict review and restart, project record deletion and retained definitions')
})().catch(async error => { if (app) { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/turn-undo-ui-22.png' }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-5000)) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close(); fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
