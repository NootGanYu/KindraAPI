const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, submitAgentGoal, selectPermissionMode } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-timeline-ui-'))
let app, pid, targetId, execTargetId, unknownTargetId, loopRequests = 0, execHits = 0, unknownHits = 0
function toolResultsAfterLastUser(messages) {
  let start = -1
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') { start = index; break }
  return messages.slice(start + 1).filter(message => message.role === 'tool')
}
function parsed(message) {
  try { return JSON.parse(String(message.content ?? '')).result ?? {} } catch { return {} }
}
function lastUser(messages) {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') return String(messages[index].content ?? '')
  return ''
}
const targetServer = http.createServer((req, res) => {
  const route = (req.url ?? '/').split('?')[0]
  if (route === '/disconnect') { unknownHits++; req.socket.destroy(); return }
  execHits++
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ secret: 'ui-response-secret', ok: true }))
})
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  const tools = (body.tools ?? []).map(tool => tool.function?.name ?? tool.name)
  const messages = body.messages ?? []
  const toolResults = toolResultsAfterLastUser(messages)
  const goal = lastUser(messages)
  const baseRevision = toolResults[0] ? parsed(toolResults[0]).base_revision : null
  let message
  if (!tools.length) message = { content: 'OK' }
  else if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else {
    loopRequests++
    if (goal.includes('执行未知')) {
      if (!toolResults.length) message = { tool_calls: [{ id: 'unknown-exec', type: 'function', function: { name: 'execute_api', arguments: JSON.stringify({ target_id: unknownTargetId }) } }] }
      else message = { content: '未知结果已记录。' }
    } else if (goal.includes('执行时间线')) {
      if (!toolResults.length) message = { tool_calls: [{ id: 'exec', type: 'function', function: { name: 'execute_api', arguments: JSON.stringify({ target_id: execTargetId }) } }] }
      else message = { content: '执行摘要完成。' }
    } else if (goal.includes('保存时间线')) {
      if (!toolResults.length) message = { tool_calls: [{ id: 'save', type: 'function', function: { name: 'save_api', arguments: JSON.stringify({ target_id: targetId }) } }] }
      else message = { content: '时间线保存完成。' }
    } else if (goal.includes('拒绝')) {
      if (!toolResults.length) message = { tool_calls: [{ id: 'deny-read', type: 'function', function: { name: 'get_api', arguments: JSON.stringify({ target_id: targetId, section: 'summary' }) } }] }
      else if (toolResults.length === 1) message = { tool_calls: [{ id: 'deny-update', type: 'function', function: { name: 'update_api_draft', arguments: JSON.stringify({ target_id: targetId, patch: { description: '不应写入' }, base_revision: baseRevision, allowed_changes: ['description'] }) } }] }
      else message = { content: '时间线已拒绝更新。' }
    } else if (goal.includes('更新')) {
      if (!toolResults.length) message = { tool_calls: [{ id: 'write-read', type: 'function', function: { name: 'get_api', arguments: JSON.stringify({ target_id: targetId, section: 'summary' }) } }] }
      else if (toolResults.length === 1) message = { tool_calls: [{ id: 'write-update', type: 'function', function: { name: 'update_api_draft', arguments: JSON.stringify({ target_id: targetId, patch: { description: '时间线新说明' }, base_revision: baseRevision, allowed_changes: ['description'] }) } }] }
      else if (toolResults.length === 2) message = { tool_calls: [{ id: 'write-apply', type: 'function', function: { name: 'apply_api_candidate', arguments: JSON.stringify({ candidate_id: parsed(toolResults[1]).candidate_id }) } }] }
      else message = { content: '时间线审批完成。' }
    } else if (!toolResults.length) message = { tool_calls: [{ id: 'call-list', type: 'function', function: { name: 'list_apis', arguments: '{"limit":20}' } }] }
    else if (toolResults.length === 1) message = { tool_calls: [{ id: 'call-summary', type: 'function', function: { name: 'get_api', arguments: JSON.stringify({ target_id: targetId, section: 'summary' }) } }] }
    else message = { content: '时间线回答：订单接口已读取。' }
  }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message }] }))
})
const launch = () => _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await new Promise(resolve => targetServer.listen(0, '127.0.0.1', resolve))
  app = await launch()
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  const info = await page.evaluate(async ({ modelBase, targetBase }) => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.data }
    const project = unwrap(await window.api.projects.ensureDefault())
    const target = unwrap(await window.api.targets.create(project.project_id, '0', 'api'))
    target.name = '订单时间线接口'
    target.description = '原始时间线说明'
    target.url = 'http://user:pass@example.com/orders'
    target.request.header.parameter = [{ param_id: 'h1', key: 'X-Trace', value: 'trace', is_checked: 1 }]
    unwrap(await window.api.targets.save(project.project_id, target))
    const exec = unwrap(await window.api.targets.create(project.project_id, '0', 'api'))
    exec.name = '执行时间线接口'; exec.description = '执行摘要'; exec.url = `${targetBase}/exec`; exec.method = 'GET'
    unwrap(await window.api.targets.save(project.project_id, exec))
    const unknown = unwrap(await window.api.targets.create(project.project_id, '0', 'api'))
    unknown.name = '未知时间线接口'; unknown.description = '未知结果'; unknown.url = `${targetBase}/disconnect`; unknown.method = 'GET'
    unwrap(await window.api.targets.save(project.project_id, unknown))
    const connection = unwrap(await window.api.agent.createConnection({ name: '时间线模型', base_url: modelBase, model: 'timeline-model', protocol: 'chat-completions' }))
    unwrap(await window.api.agent.setProjectConnection(project.project_id, connection.connection_id))
    unwrap(await window.api.agent.testConnection(connection.connection_id))
    return { pid: project.project_id, targetId: target.target_id, execTargetId: exec.target_id, unknownTargetId: unknown.target_id }
  }, { modelBase: `http://127.0.0.1:${server.address().port}/v1`, targetBase: `http://127.0.0.1:${targetServer.address().port}` })
  pid = info.pid; targetId = info.targetId; execTargetId = info.execTargetId; unknownTargetId = info.unknownTargetId

  // Read-only timeline.
  await submitAgentGoal(page, '读取订单接口并总结', { native: true })
  await page.getByText('时间线回答：订单接口已读取。', { exact: true }).waitFor()
  const cards = page.locator('.agent-tool-card')
  assert.equal(await cards.count(), 2, 'each continuous tool call gets a card')
  await page.getByText('list_apis', { exact: true }).waitFor()
  await page.getByText('get_api', { exact: true }).waitFor()
  assert.equal(await cards.nth(0).locator('.anticon-check-circle').count(), 1, 'successful tools are marked complete')
  assert.equal(await page.locator('.agent-plan-card').count(), 0, 'the legacy plan card is not the main view')

  // Local write: pending approval, diff, apply.
  await submitAgentGoal(page, '更新时间线说明', { native: true })
  let pending = page.locator('.agent-tool-card.awaiting-approval')
  await pending.getByRole('button', { name: '允许工具调用' }).waitFor()
  await pending.getByRole('button', { name: '允许工具调用' }).click()
  pending = page.locator('.agent-tool-card.awaiting-approval')
  await pending.getByRole('button', { name: '允许工具调用' }).waitFor()
  await pending.getByRole('button', { name: '允许工具调用' }).click()
  await page.getByText('时间线审批完成。', { exact: true }).waitFor()
  const diff = await page.locator('.agent-tool-diff').first().innerText()
  assert.match(diff, /原始时间线说明/)
  assert.match(diff, /时间线新说明/)
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.agent.getDraft(pid, targetId)).data.target.description, { pid, targetId }), '时间线新说明')
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data.description, { pid, targetId }), '原始时间线说明')

  // Formal save: irreversible approval, saved card and formal revision.
  await submitAgentGoal(page, '保存时间线说明', { native: true })
  pending = page.locator('.agent-tool-card.awaiting-approval')
  await pending.getByRole('button', { name: '允许工具调用' }).waitFor()
  await pending.getByRole('button', { name: '允许工具调用' }).click()
  await page.getByText('时间线保存完成。', { exact: true }).waitFor()
  await page.getByText('正式保存', { exact: false }).first().waitFor()
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data.description, { pid, targetId }), '时间线新说明')

  // Deny: no side effect and the card shows the denial.
  await submitAgentGoal(page, '拒绝时间线更新', { native: true })
  pending = page.locator('.agent-tool-card.awaiting-approval')
  await pending.getByRole('button', { name: '拒绝工具调用' }).waitFor()
  await pending.getByRole('button', { name: '拒绝工具调用' }).click()
  await page.getByText('时间线已拒绝更新。', { exact: true }).waitFor()
  await page.getByText('已拒绝', { exact: true }).last().waitFor()
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.targets.get(pid, targetId)).data.description, { pid, targetId }), '时间线新说明')

  // Network execution: approval card, summary only, no response body.
  await submitAgentGoal(page, '执行时间线接口', { native: true })
  pending = page.locator('.agent-tool-card.awaiting-approval')
  await pending.getByRole('button', { name: '允许工具调用' }).waitFor()
  assert.match(await pending.innerText(), /方法：GET/)
  assert.match(await pending.innerText(), /变量写回：不允许/)
  await pending.getByRole('button', { name: '允许工具调用' }).click()
  await page.getByText('执行摘要完成。', { exact: true }).waitFor()
  await page.getByText('HTTP 200', { exact: false }).first().waitFor()
  assert.equal(execHits, 1)
  assert.equal((await page.locator('.agent-dock-panel').innerText()).includes('ui-response-secret'), false)

  // Unknown: bypass mode executes, card warns and no replay happens.
  await selectPermissionMode(page, 'bypass')
  await submitAgentGoal(page, '执行未知结果', { native: true })
  await page.getByText('未知结果已记录。', { exact: true }).waitFor()
  await page.getByText('结果未知', { exact: false }).last().waitFor()
  await page.getByText('禁止自动重发', { exact: false }).last().waitFor()
  assert.equal(unknownHits, 1)

  // Local restart keeps the final answers and never replays any turn.
  const beforeRestart = loopRequests
  await app.evaluate(({ app }) => app.exit(0)); app = null
  app = await launch()
  const restarted = await app.firstWindow()
  await openAgentPanel(restarted)
  await restarted.getByText('未知结果已记录。', { exact: true }).waitFor()
  assert.equal(loopRequests, beforeRestart, 'restart must not replay any turn')
  console.log('PASS Electron timeline: tool cards, diff, approvals, execution summary, unknown warning, save success, no replay')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error((await page.locator('body').innerText()).slice(-5000)); await page.screenshot({ path: '/tmp/kindra-agent-timeline-failure.png' }).catch(() => {}) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close(); targetServer.closeAllConnections(); targetServer.close(); fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
