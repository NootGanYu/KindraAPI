const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-effects-ui-'))
const upload = path.join(userData, 'approved-upload.txt'); fs.writeFileSync(upload, 'uploaded-ui-bytes')
let app, pid, targetId, hits = []
const api = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; hits.push({ method: req.method, url: req.url, body }); res.setHeader('Content-Type', 'text/plain'); res.end('execution-ui-result') })
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), name = body.tools?.[0]?.function?.name
  const message = name ? { tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, target_id: targetId, depends_on: [] }) } }] } : { content: '执行报告已生成' }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
})
async function launch() { app = await _electron.launch({ args: [path.resolve(__dirname, '../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData } }); return app.firstWindow() }
async function stop() { if (app) { await app.evaluate(({ app }) => app.exit(0)); app = null } }
;(async () => {
  await Promise.all([new Promise(resolve => api.listen(0, '127.0.0.1', resolve)), new Promise(resolve => model.listen(0, '127.0.0.1', resolve))])
  let page = await launch(); await page.getByRole('link', { name: 'Agent' }).waitFor()
  const info = await page.evaluate(async ({ apiBase, modelBase, upload }) => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.data }
    const project = unwrap(await window.api.projects.ensureDefault())
    const target = unwrap(await window.api.targets.create(project.project_id, '0', 'api'))
    target.name = '执行测试接口'; target.url = `${apiBase}/saved`; unwrap(await window.api.targets.save(project.project_id, target))
    const draft = structuredClone(target); draft.url = `${apiBase}/draft`; draft.method = 'POST'; draft.request.pre_script = `pm.sendRequest('${apiBase}/login', () => pm.globals.set('effectsResult', 'updated'));`; draft.request.body = { mode: 'binary', binary: { file_path: upload } }; unwrap(await window.api.agent.syncEditorDraft(project.project_id, draft))
    const connection = unwrap(await window.api.agent.createConnection({ name: '执行验证', base_url: modelBase, model: 'execution-ui', protocol: 'chat-completions' }))
    unwrap(await window.api.agent.setProjectConnection(project.project_id, connection.connection_id)); unwrap(await window.api.agent.testConnection(connection.connection_id))
    return { pid: project.project_id, targetId: target.target_id, paths: unwrap(await window.api.paths()) }
  }, { apiBase: `http://127.0.0.1:${api.address().port}`, modelBase: `http://127.0.0.1:${model.address().port}/v1`, upload })
  pid = info.pid; targetId = info.targetId
  await page.getByRole('link', { name: 'Agent' }).click(); await page.getByRole('button', { name: '执行草稿', exact: true }).click()
  await page.getByRole('combobox', { name: '计划接口' }).click(); await page.locator('.ant-select-item-option').filter({ hasText: '执行测试接口' }).click(); await page.getByRole('combobox', { name: '计划接口' }).press('Escape')
  await page.getByLabel('额外请求授权').fill(`GET http://127.0.0.1:${api.address().port}/login 1`)
  await page.getByLabel('允许环境与全局变量差量写回（冲突暂停）').check()
  await page.getByLabel('添加独立保存响应示例步骤（不保存其他草稿）').check()
  await page.getByRole('button', { name: '生成执行计划', exact: true }).click(); await page.getByRole('button', { name: '批准执行计划', exact: true }).waitFor()
  const drawer = page.locator('.ant-drawer-body'); assert.match(await drawer.innerText(), /POST.*\/draft/); assert.match(await drawer.innerText(), /远端业务副作用/); assert.match(await drawer.innerText(), /环境：/); assert.match(await drawer.innerText(), /来源：未保存草稿/); assert.equal(hits.length, 0); assert.match(await drawer.innerText(), /前置脚本 SHA256/); assert.match(await drawer.innerText(), /上传文件/); assert.match(await drawer.innerText(), /保存响应示例/)
  await page.getByRole('button', { name: '拒绝计划', exact: true }).click(); await page.getByText('已拒绝', { exact: true }).waitFor(); assert.equal(hits.length, 0)
  await page.getByRole('button', { name: '生成执行计划', exact: true }).click(); await page.getByRole('button', { name: '批准执行计划', exact: true }).click(); await page.getByText('执行报告已生成', { exact: true }).waitFor()
  assert.deepEqual(hits, [{ method: 'GET', url: '/login', body: '' }, { method: 'POST', url: '/draft', body: 'uploaded-ui-bytes' }])
  const saved = await page.evaluate(async ({pid, targetId}) => (await window.api.targets.read(pid, targetId)).data.target, {pid, targetId})
  assert.equal(saved.url, `http://127.0.0.1:${api.address().port}/saved`); assert.equal(saved.response.example[0].raw, 'execution-ui-result')
  function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]) }
  assert(!files(info.paths.projectRoot).some(file => fs.readFileSync(file, 'utf8').includes('执行报告已生成')))
  await stop(); page = await launch(); await page.getByRole('link', { name: 'Agent' }).click(); await page.getByRole('button', { name: '执行草稿', exact: true }).click(); await page.getByText('执行报告已生成', { exact: true }).waitFor(); assert.equal(hits.length, 2)
  console.log('PASS Electron explicit extra-request/file/script/variable/save scopes, rejection, approved execution, narrow response save and restart without replay')
})().catch(async error => { if (app) { const page = await app.firstWindow(); console.error(await page.locator('.ant-drawer-body').innerText().catch(() => '')) }; console.error(error); process.exitCode = 1 }).finally(async () => { await stop(); api.closeAllConnections(); model.closeAllConnections(); api.close(); model.close() })
