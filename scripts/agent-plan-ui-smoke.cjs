const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-plan-ui-'))
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
let app, pid, targetId, toolReads = 0
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  assert.equal(req.url, protocol === 'responses' ? '/v1/responses' : '/v1/chat/completions')
  if (protocol === 'responses') body.messages = body.input.map(item => item.type === 'function_call_output' ? { role: 'tool', content: item.output } : item)
  const probe = (body.tools?.[0]?.name ?? body.tools?.[0]?.function?.name) === 'kindra_capability_probe'
  if (body.messages.some(m => m.role === 'tool')) toolReads++
  const message = probe ? { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
    : body.tools ? { tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_api', arguments: JSON.stringify({ project_id: pid, target_id: targetId }) } }] }
      : { content: body.messages.some(m => m.role === 'tool') ? '只读计划已解释接口，正式定义保持原状。' : 'OK' }
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
  await page.getByRole('link', { name: 'Agent' }).waitFor()
  const info = await page.evaluate(async ({ base, protocol }) => {
    const p = (await window.api.projects.ensureDefault()).data
    const target = (await window.api.targets.create(p.project_id, '0', 'api')).data
    await window.api.agent.saveConnection({ name: '计划测试', base_url: base, model: 'plan-ui', protocol })
    await window.api.agent.testConnection()
    return { pid: p.project_id, targetId: target.target_id }
  }, { base: `http://127.0.0.1:${server.address().port}/v1`, protocol })
  pid = info.pid; targetId = info.targetId
  await page.getByRole('link', { name: 'Agent' }).click()
  await page.getByRole('button', { name: '只读计划', exact: true }).click()
  await page.getByLabel('计划目标').fill('解释当前接口')
  await page.getByRole('combobox', { name: '计划接口' }).click()
  await page.locator('.ant-select-item-option').first().click()
  await page.getByRole('combobox', { name: '计划接口' }).press('Escape')
  assert(await page.getByRole('button', { name: '生成只读计划', exact: true }).isEnabled(), 'both detected protocols must enable plans')
  await page.getByRole('button', { name: '生成只读计划', exact: true }).click()
  await page.getByRole('button', { name: '批准只读计划', exact: true }).waitFor()
  assert.equal(toolReads, 0)
  await page.getByRole('button', { name: '拒绝计划', exact: true }).click()
  await page.getByText('已拒绝', { exact: true }).waitFor()
  assert.equal(toolReads, 0)
  await page.getByRole('button', { name: '生成只读计划', exact: true }).click()
  await page.getByRole('button', { name: '批准只读计划', exact: true }).click()
  await page.getByText('只读计划已解释接口，正式定义保持原状。', { exact: true }).waitFor()
  assert.equal(toolReads, 1)
  const paths = (await page.evaluate(() => window.api.paths())).data
  function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]) }
  assert(!files(paths.projectRoot).some(file => fs.readFileSync(file, 'utf8').includes('只读计划已解释接口')))
  await stop()
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  const restarted = await app.firstWindow()
  await restarted.getByRole('link', { name: 'Agent' }).click()
  await restarted.getByRole('button', { name: '只读计划', exact: true }).click()
  await restarted.getByText('只读计划已解释接口，正式定义保持原状。', { exact: true }).waitFor()
  assert.equal(toolReads, 1)
  console.log('PASS Electron plan scope display, rejection, approval, explanation, local restart and Git boundary')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error(await page.locator('.ant-drawer-body').innerText()); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/plan-ui-04.png' }) }; console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); server.closeAllConnections(); server.close() })
