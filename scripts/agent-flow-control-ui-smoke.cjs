const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-control-ui-20-'))
let app, pid, flowId
const hits = []
const api = http.createServer((req, res) => { hits.push({ url: req.url, auth: req.headers.authorization }); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}') })
const model = http.createServer(async (req, res) => {
 let raw = ''; for await (const chunk of req) raw += chunk
 const body = JSON.parse(raw), name = body.tools?.find(t => t.function.name === 'execute_flow')?.function.name ?? body.tools?.[0]?.function.name
 res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: name ? { tool_calls: [{ id: 'flow', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, flow_id: flowId, depends_on: [] }) } }] } : { content: 'Flow 执行报告已生成' } }] }))
})
async function launch() { app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } }); const page = await app.firstWindow(); await page.getByRole('link', { name: 'Agent' }).waitFor(); return page }
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)); app = null } }
;(async () => {
 await Promise.all([new Promise(r => api.listen(0, '127.0.0.1', r)), new Promise(r => model.listen(0, '127.0.0.1', r))]); let page = await launch()
 ;({ pid, flowId } = await page.evaluate(async ({ base, modelBase }) => {
  const unwrap = r => { if (!r.ok) throw new Error(r.error); return r.data }
  const p = unwrap(await window.api.projects.ensureDefault()), env = unwrap(await window.api.envs.list(p.project_id))[0]
  const flow = unwrap(await window.api.flows.create(p.project_id, '条件循环恢复'))
  const event = (type, extra = {}) => ({ event_id: crypto.randomUUID(), name: type, type, enabled: true, ...extra })
  flow.events = [event('if', { condition: 'true', children: [event('script', { script: "pm.variables.set('marker', 'ready')" }), event('loop', { loop_count: 3, children: [event('request', { url: `${base}/loop`, input: { query: { index: '{{loop_index}}' } } }), event('wait', { wait_ms: 1000 })] })] })]
  unwrap(await window.api.flows.save(p.project_id, flow))
  const c = unwrap(await window.api.agent.createConnection({ name: 'Flow UI', base_url: modelBase, model: 'flow', protocol: 'chat-completions' })); unwrap(await window.api.agent.setProjectConnection(p.project_id, c.connection_id)); unwrap(await window.api.agent.testConnection(c.connection_id))
  return { pid: p.project_id, flowId: flow.flow_id }
 }, { base: `http://127.0.0.1:${api.address().port}`, modelBase: `http://127.0.0.1:${model.address().port}/v1` }))
 await page.getByRole('link', { name: 'Agent' }).click(); await page.getByRole('button', { name: '执行草稿', exact: true }).click()
 await page.getByRole('combobox', { name: '计划 Flow', exact: true }).click(); await page.getByText('条件循环恢复', { exact: true }).last().click(); await page.getByRole('combobox', { name: '计划 Flow', exact: true }).press('Escape')
 await page.getByRole('button', { name: '生成执行计划', exact: true }).click(); await page.getByRole('button', { name: '批准执行计划', exact: true }).waitFor()
 assert.match(await page.locator('.ant-drawer-body').innerText(), /最多 3 次/); assert.equal(hits.length, 0)
 await page.getByRole('button', { name: '批准执行计划', exact: true }).click()
 await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('first iteration timeout')), 10000); const poll = setInterval(() => { if (hits.length) { clearInterval(poll); clearTimeout(timeout); resolve() } }, 20) })
 await page.getByRole('button', { name: '取消任务', exact: true }).click()
 await page.getByRole('checkbox', { name: '选择恢复此未完成步骤' }).waitFor()
 assert.match(await page.locator('.ant-drawer-body').innerText(), /第 1 次迭代/)
 await page.getByRole('checkbox', { name: '选择恢复此未完成步骤' }).check()
 await page.getByRole('button', { name: '生成恢复计划（需重新批准）' }).click()
 await page.getByRole('button', { name: '批准执行计划', exact: true }).waitFor(); assert.equal(hits.length, 1)
 await page.getByRole('button', { name: '批准执行计划', exact: true }).click(); await page.getByText('Flow 执行报告已生成', { exact: true }).waitFor({ timeout: 15000 })
 assert.deepEqual(hits.map(h => h.url), ['/loop?index=0', '/loop?index=1', '/loop?index=2'])
 await stop(); page = await launch(); await page.getByRole('link', { name: 'Agent' }).click(); await page.getByRole('button', { name: '执行草稿', exact: true }).click(); await page.getByText('Flow 执行报告已生成', { exact: true }).waitFor(); assert.equal(hits.length, 3)
 console.log('PASS Electron Flow control cancellation, recovery approval, iteration preservation and restart')
})().catch(async e => { console.error(e); if (app) { const page = await app.firstWindow(); console.error((await page.locator('body').innerText()).slice(-5000)) } process.exitCode = 1 }).finally(async () => { await stop(); api.closeAllConnections(); model.closeAllConnections(); api.close(); model.close() })
