/** Electron journey: continuous A→B plan, explicit approval, read-derived apply/test and scope reapproval. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { _electron } = require('playwright-core')
const { openAgentPanel, submitAgentGoal } = require('./agent-ui-helper.cjs')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-continuation-ui-'))
let app
let pid = '', aId = '', bId = '', cId = '', tagB = '', aValue = '', aParam = ''
const hits = []
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  const tools = (body.tools ?? []).map(tool => tool.function.name)
  if (tools.includes('kindra_capability_probe')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] } }] })); return }
  if (tools.includes('propose_task_plan')) {
    const steps = [
      { step_id: 'read-a', operation: 'read_api', binding: 'static', target_id: aId, depends_on: [] },
      { step_id: 'read-b', operation: 'read_api', binding: 'static', target_id: bId, depends_on: [] },
      { step_id: 'derive-b', operation: 'propose_api_change', binding: 'deferred', target_id: bId, depends_on: ['read-a', 'read-b'], source_steps: ['read-a', 'read-b'], intent: 'A tag 加 -checked 写入 B', allowed_changes: [`request.query.parameter[param_id=${tagB}].value`] },
      { step_id: 'apply-b', operation: 'apply_candidate', kind: 'api', binding: 'static', target_id: bId, depends_on: ['derive-b'], source_steps: ['derive-b'] },
      { step_id: 'test-b', operation: 'execute_api', binding: 'static', target_id: bId, depends_on: ['apply-b'], source_steps: ['apply-b'] }
    ]
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({ selected_objects: [{ kind: 'api', id: aId }, { kind: 'api', id: bId }], steps }) } }] } }] })); return
  }
  if (tools.includes('propose_api_change')) {
    const toolMessage = body.messages.filter(message => message.role === 'tool').map(message => { try { return JSON.parse(message.content) } catch { return null } }).filter(Boolean).find(value => Array.isArray(value.tool_results))
    const results = toolMessage?.tool_results ?? []
    const readA = results.find(item => item.step_id === 'read-a')?.result?.api
    const readB = results.find(item => item.step_id === 'read-b')?.result?.api
    assert(readA && readB, 'UI model can derive only from approved reads')
    const aTag = readA.request.query.parameter.find(param => param.key === 'tag')
    const bTag = readB.request.query.parameter.find(param => param.key === 'tag')
    const calls = [
      { id: 'derive', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: bId, step_id: 'derive-b', depends_on: ['read-a', 'read-b'], patch: { request: { query: { parameter: [{ param_id: bTag.param_id, value: `${aTag.value}-checked` }] } } } }) } },
      { id: 'extra', type: 'function', function: { name: 'execute_api', arguments: JSON.stringify({ project_id: pid, target_id: cId, step_id: 'extra-exec-c', depends_on: [] }) } }
    ]
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { tool_calls: calls } }] })); return
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '已完成 A→B 派生、采纳到草稿并测试；新增 C 在重新批准后执行一次。' } }] }))
})
const api = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://127.0.0.1')
  hits.push({ path: parsed.pathname, tag: parsed.searchParams.get('tag') })
  res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}')
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '打开 Agent' }).waitFor()
  await openAgentPanel(page)
  return page
}
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); app = null } }
;(async () => {
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${api.address().port}`
  const page = await launch()
  const info = await page.evaluate(async ({ base, origin }) => {
    const project = (await window.api.projects.ensureDefault()).data
    const make = async (name, path, param) => {
      const target = (await window.api.targets.create(project.project_id, '0', 'api')).data
      target.name = name; target.url = `${origin}${path}`
      if (param) target.request.query.parameter.push({ param_id: param.id, key: 'tag', value: param.value, is_checked: 1 })
      await window.api.targets.save(project.project_id, target)
      return target
    }
    const value = 'ui-' + Math.random().toString(36).slice(2, 10)
    const a = await make('来源 UI', '/uia', { id: 'tagA-' + Date.now(), value })
    const bTag = 'tagB-' + Date.now()
    const b = await make('目标 UI', '/uib', { id: bTag, value: 'base-ui' })
    const c = await make('新增 UI', '/uic')
    const connection = (await window.api.agent.createConnection({ name: '连续 UI', base_url: base, model: 'continuation', protocol: 'chat-completions' })).data
    await window.api.agent.setProjectConnection(project.project_id, connection.connection_id)
    await window.api.agent.testConnection(connection.connection_id)
    return { pid: project.project_id, a: a.target_id, b: b.target_id, c: c.target_id, bTag, value, aParam: a.request.query.parameter[0].param_id }
  }, { base: `http://127.0.0.1:${model.address().port}/v1`, origin })
  pid = info.pid; aId = info.a; bId = info.b; cId = info.c; tagB = info.bTag; aValue = info.value; aParam = info.aParam
  const revisionB = await page.evaluate(async ({ pid, b }) => (await window.api.targets.read(pid, b)).data.revision, { pid, b: bId })
  // Reload the Agent view so the tested project connection/capability is reflected.
  await page.reload()
  await openAgentPanel(page)
  // The UI journey keeps the expansion call in the same batch as the approved derived patch.
  await submitAgentGoal(page, '读取 A/B，把 A 的 tag 值加 -checked 复制给 B 并测试，不保存')
  await page.getByRole('button', { name: /批准/ }).first().waitFor()
  assert.equal(hits.length, 0, 'approval gate must precede any target HTTP')
  assert.equal(await page.getByText('读取后生成', { exact: false }).count() > 0, true)
  await page.getByRole('button', { name: /批准/ }).first().click()
  await page.getByRole('button', { name: '批准新增范围', exact: true }).waitFor()
  await page.getByText('等待新增授权', { exact: true }).first().waitFor()
  assert.equal(hits.length, 0, 'scope expansion must pause before sending')
  await page.getByRole('button', { name: '批准新增范围', exact: true }).click()
  await page.getByText('已完成 A→B 派生、采纳到草稿并测试；新增 C 在重新批准后执行一次。', { exact: true }).waitFor()
  assert.deepEqual(hits.map(hit => hit.path).sort(), ['/uib', '/uic'])
  assert.equal(hits.find(hit => hit.path === '/uib').tag, `${aValue}-checked`)
  const state = await page.evaluate(async ({ pid, b }) => ({
    draft: (await window.api.agent.getDraft(pid, b)).data,
    saved: (await window.api.targets.read(pid, b)).data,
    plans: (await window.api.agent.listPlans(pid)).data
  }), { pid, b: bId })
  assert.equal(state.draft.target.request.query.parameter.find(param => param.param_id === tagB).value, `${aValue}-checked`)
  assert.equal(state.saved.target.request.query.parameter.find(param => param.param_id === tagB).value, 'base-ui')
  assert.equal(state.saved.revision, revisionB, 'no save step means formal revision stays unchanged')
  assert.equal(state.plans[0].status, 'completed')
  assert.equal(state.plans[0].steps.filter(step => step.step_id === 'read-a').length, 1)
  console.log('PASS Electron continuous A→B read/derive/apply/test with explicit scope reapproval and no formal save')
})().catch(async error => { if (app) { try { const page = await app.firstWindow(); await page.screenshot({ path: '/tmp/kindra-builtin-agent-context/continuation-ui-failure.png' }); console.error(await page.locator('.ant-drawer-body').innerText().catch(() => '')) } catch {} } console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); model.closeAllConnections(); api.closeAllConnections(); await new Promise(resolve => model.close(() => resolve())); await new Promise(resolve => api.close(() => resolve())) })
