const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-steps-ui-'))
let app, pid, ids, returned = 0
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), probe = body.tools?.[0]?.function.name === 'kindra_capability_probe'
  const output = body.messages.filter(message => message.role === 'tool'); returned += output.length
  const message = probe ? { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
    : body.tools ? { tool_calls: ids.map((id, index) => ({ id: `call-${index}`, type: 'function', function: { name: 'read_api', arguments: JSON.stringify({ project_id: pid, target_id: id, step_id: `s${index}`, depends_on: index === 1 ? ['s0'] : [] }) } })) }
      : { content: output.length ? '读取结果：失败对象和依赖暂停，独立接口成功。' : 'OK' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
async function launch() {
  app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } })
  return app.firstWindow()
}
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)); app = null } }
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let page = await launch()
  await page.getByRole('link', { name: 'Agent' }).waitFor()
  const info = await page.evaluate(async base => {
    const project = (await window.api.projects.ensureDefault()).data
    const ids = []
    for (const name of ['资料接口', '订单接口', '独立统计']) {
      const target = (await window.api.targets.create(project.project_id, '0', 'api')).data
      target.name = name; await window.api.targets.save(project.project_id, target); ids.push(target.target_id)
    }
    const connection = (await window.api.agent.createConnection({ name: '多步骤验证', base_url: base, model: 'plan-ui', protocol: 'chat-completions' })).data
    await window.api.agent.setProjectConnection(project.project_id, connection.connection_id)
    await window.api.agent.testConnection(connection.connection_id)
    return { pid: project.project_id, ids }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  pid = info.pid; ids = info.ids
  await page.getByRole('link', { name: 'Agent' }).click()
  await page.getByRole('button', { name: '只读计划', exact: true }).click()
  await page.getByRole('combobox', { name: '计划接口' }).click()
  for (const name of ['资料接口', '订单接口', '独立统计']) await page.locator('.ant-select-item-option').filter({ hasText: name }).click()
  await page.getByRole('combobox', { name: '计划接口' }).press('Escape')
  await page.getByRole('button', { name: '生成只读计划', exact: true }).click()
  await page.getByRole('button', { name: '批准只读计划', exact: true }).waitFor()
  await page.getByText('s2 · 读取 独立统计', { exact: true }).waitFor()
  assert.equal(returned, 0)
  await page.evaluate(async ({pid,id}) => window.api.targets.delete(pid,id), {pid,id:ids[0]})
  await page.getByRole('button', { name: '批准只读计划', exact: true }).click()
  await page.getByText('读取结果：失败对象和依赖暂停，独立接口成功。', { exact: true }).waitFor()
  await page.getByText('读取失败', { exact: true }).waitFor()
  await page.getByText('已完成', { exact: true }).waitFor()
  assert.equal(returned, 3)
  await stop(); page = await launch()
  await page.getByRole('link', { name: 'Agent' }).click()
  await page.getByRole('button', { name: '只读计划', exact: true }).click()
  await page.getByText('读取结果：失败对象和依赖暂停，独立接口成功。', { exact: true }).waitFor()
  assert.equal(returned, 3)
  await page.getByRole('button', { name: '删除计划记录', exact: true }).click()
  await page.getByText('读取结果：失败对象和依赖暂停，独立接口成功。', { exact: true }).waitFor({ state: 'hidden' })
  console.log('PASS Electron multi-selection, dependency/status display, partial success, restart without replay and deletion')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error(await page.locator('.ant-drawer-body').innerText().catch(()=>'')) }; console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); server.closeAllConnections(); server.close() })
