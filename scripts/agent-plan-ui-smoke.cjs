const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const { openAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-plan-ui-'))
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
let app, pid, targetId, toolReads = 0
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  assert.equal(req.url, protocol === 'responses' ? '/v1/responses' : '/v1/chat/completions')
  if (protocol === 'responses') body.messages = body.input.map(item => item.type === 'function_call_output' ? { role: 'tool', content: item.output } : item)
  const tools = (body.tools ?? []).map(tool => tool.name ?? tool.function?.name)
  const probe = tools.includes('kindra_capability_probe')
  if (body.messages.some(m => m.role === 'tool')) toolReads++
  const goal = body.messages.filter(m => m.role === 'user').map(m => String(m.content ?? '')).join(' ')
  let message
  if (probe) message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
  else if (tools.includes('propose_task_plan')) {
    const write = goal.includes('拒绝')
    const planned = write
      ? { selected_objects: [{ kind: 'api', id: targetId }], steps: [{ step_id: 'edit', operation: 'propose_api_change', binding: 'deferred', target_id: targetId, depends_on: [], intent: '修改说明', allowed_changes: ['description'] }] }
      : { selected_objects: [{ kind: 'api', id: targetId }], steps: [{ step_id: 'read', operation: 'read_api', binding: 'static', target_id: targetId, depends_on: [] }] }
    message = { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify(planned) } }] }
  } else if (tools.includes('propose_api_change')) {
    message = { tool_calls: [{ id: 'edit', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: targetId, step_id: 'edit', depends_on: [], patch: { description: '不应执行' } }) } }] }
  } else message = { content: toolReads ? '只读计划已解释接口，正式定义保持原状。' : 'OK' }
  if (protocol === 'responses') {
    const output = message.tool_calls?.map(call => ({ type: 'function_call', id: `item-${call.id}`, call_id: call.id, name: call.function.name, arguments: call.function.arguments })) ?? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message.content }] }]
    const response = { status: 'completed', output }
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      if (message.content) res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: message.content })}\n\n`)
      res.end(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`)
    } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(response)) }
  } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] })) }
})
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)); app = null } }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  const info = await page.evaluate(async ({ base, protocol }) => {
    const p = (await window.api.projects.ensureDefault()).data
    const target = (await window.api.targets.create(p.project_id, '0', 'api')).data
    target.name = '只读验收接口'; await window.api.targets.save(p.project_id, target)
    const connection = (await window.api.agent.createConnection({ name: '计划测试', base_url: base, model: 'plan-ui', protocol })).data
    await window.api.agent.setProjectConnection(p.project_id, connection.connection_id)
    await window.api.agent.testConnection(connection.connection_id)
    return { pid: p.project_id, targetId: target.target_id }
  }, { base: `http://127.0.0.1:${server.address().port}/v1`, protocol })
  pid = info.pid; targetId = info.targetId
  await submitAgentGoal(page, '解释当前接口')
  await page.getByText('只读计划已解释接口，正式定义保持原状。', { exact: true }).waitFor()
  await page.getByText('自动选择', { exact: false }).first().waitFor()
  await page.getByText('只读验收接口', { exact: false }).first().waitFor()
  assert.equal(toolReads, 1, 'read-only ask plans run automatically')
  await submitAgentGoal(page, '拒绝这次修改')
  await page.getByRole('button', { name: '批准修改计划', exact: true }).waitFor()
  await page.getByRole('button', { name: '拒绝计划', exact: true }).click()
  await page.getByText('已拒绝', { exact: true }).waitFor()
  assert.equal(await page.evaluate(async ({ pid, targetId }) => (await window.api.agent.listCandidates(pid, targetId)).data.length, { pid, targetId }), 0)
  const paths = (await page.evaluate(() => window.api.paths())).data
  function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]) }
  assert(!files(paths.projectRoot).some(file => fs.readFileSync(file, 'utf8').includes('只读计划已解释接口')))
  await stop()
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  const restarted = await app.firstWindow()
  await openAgentPanel(restarted)
  await restarted.getByText('只读计划已解释接口，正式定义保持原状。', { exact: true }).waitFor()
  assert.equal(toolReads, 1, 'restart must not replay the read')
  console.log('PASS Electron natural-language read plan, rejection, explanation, local restart and Git boundary')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error(await page.locator('.agent-dock-panel').innerText().catch(() => '')); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/plan-ui-04.png' }) }; console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); server.closeAllConnections(); server.close() })
