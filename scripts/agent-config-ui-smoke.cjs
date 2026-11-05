const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-config-ui-'))
let app, pid
const firstSecret = 'UI-CONFIG-SECRET-1'
const secondSecret = 'UI-CONFIG-SECRET-2'
function lastUser(messages) {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') return String(messages[index].content ?? '')
  return ''
}
function resultsSince(messages) {
  let start = -1
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') { start = index; break }
  return messages.slice(start + 1).filter(message => message.role === 'tool')
}
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  const tools = (body.tools ?? []).map(tool => tool.function?.name ?? tool.name)
  const messages = body.messages ?? []
  const goal = lastUser(messages)
  const results = resultsSince(messages)
  let message
  if (!tools.length) message = { content: 'OK' }
  else if (tools.includes('kindra_capability_probe')) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (!results.length) {
    message = { tool_calls: [{ id: 'list-envs', type: 'function', function: { name: 'list_environments', arguments: '{}' } }] }
  } else if (results.length === 1) {
    const value = goal.includes('拒绝') ? secondSecret : firstSecret
    let environment
    try { environment = JSON.parse(results[0].content).result.items[0].env_id } catch { environment = '' }
    message = { tool_calls: [{ id: `config-${value}`, type: 'function', function: { name: 'upsert_environment_variable', arguments: JSON.stringify({ environment_id: environment, key: 'token', value, description: '界面配置' }) } }] }
  } else message = { content: goal.includes('拒绝') ? '配置界面拒绝完成。' : '配置界面允许完成。' }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message }] }))
})
const launch = () => _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await launch()
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  const info = await page.evaluate(async modelBase => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.data }
    const project = unwrap(await window.api.projects.ensureDefault())
    const connection = unwrap(await window.api.agent.createConnection({ name: '配置界面模型', base_url: modelBase, model: 'config-ui', protocol: 'chat-completions' }))
    unwrap(await window.api.agent.setProjectConnection(project.project_id, connection.connection_id))
    unwrap(await window.api.agent.testConnection(connection.connection_id))
    return { pid: project.project_id }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  pid = info.pid

  // Allow: masked approval, write, audit list and undo.
  await submitAgentGoal(page, '配置界面允许', { native: true })
  let pending = page.locator('.agent-tool-card.awaiting-approval')
  await pending.getByRole('button', { name: '允许工具调用' }).waitFor()
  const pendingText = await pending.innerText()
  assert.match(pendingText, /\*\*\*/)
  assert(!pendingText.includes(firstSecret))
  await pending.getByRole('button', { name: '允许工具调用' }).click()
  await page.getByText('配置界面允许完成。', { exact: true }).waitFor()
  assert.equal((await page.locator('.agent-dock-panel').innerText()).includes(firstSecret), false)

  await page.getByRole('button', { name: '整轮撤销与记录' }).click()
  const auditSection = page.getByRole('region', { name: '配置变更审计' })
  await auditSection.getByText('配置变更审计', { exact: true }).waitFor()
  await auditSection.getByText(/设置环境.*变量 token/).waitFor()
  assert(!(await auditSection.innerText()).includes(firstSecret))
  await auditSection.getByRole('button', { name: '撤销配置变更' }).click()
  await auditSection.getByText('已撤销', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回对话' }).click()

  // Deny: no audit, no write and the card shows the denial.
  const beforeAudits = await page.evaluate(async pid => (await window.api.agent.listConfigAudits(pid)).data.length, pid)
  await submitAgentGoal(page, '配置界面拒绝', { native: true })
  pending = page.locator('.agent-tool-card.awaiting-approval')
  await pending.getByRole('button', { name: '拒绝工具调用' }).waitFor()
  assert(!(await pending.innerText()).includes(secondSecret))
  await pending.getByRole('button', { name: '拒绝工具调用' }).click()
  await page.getByText('配置界面拒绝完成。', { exact: true }).waitFor()
  await page.getByText('已拒绝', { exact: true }).last().waitFor()
  assert.equal(await page.evaluate(async pid => (await window.api.agent.listConfigAudits(pid)).data.length, pid), beforeAudits)
  assert.equal((await page.locator('.agent-dock-panel').innerText()).includes(secondSecret), false)

  await page.getByRole('button', { name: '整轮撤销与记录' }).click()
  const deniedAuditSection = page.getByRole('region', { name: '配置变更审计' })
  await deniedAuditSection.getByText('配置变更审计', { exact: true }).waitFor()
  assert.equal(await deniedAuditSection.getByRole('button', { name: '撤销配置变更' }).count(), 0)
  assert.equal((await deniedAuditSection.innerText()).includes(secondSecret), false)
  console.log('PASS Electron config audit: masked approval, audit undo, deny path and no value exposure')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error((await page.locator('body').innerText()).slice(-5000)); await page.screenshot({ path: '/tmp/kindra-agent-config-ui-failure.png' }).catch(() => {}) }; console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); server.closeAllConnections(); server.close(); fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
