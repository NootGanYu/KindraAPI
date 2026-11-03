const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-ui-17-'))
let app, pid, flowId
const server = http.createServer(async (req, res) => {
 let raw = ''; for await (const chunk of req) raw += chunk
 const body = JSON.parse(raw), name = body.tools?.find(t => t.function.name === 'propose_flow_change')?.function.name ?? body.tools?.[0]?.function.name
 res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ choices: [{ message: name ? { tool_calls: [{ id: 'flow', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, flow_id: flowId, patch: { name: 'Agent Flow', description: 'Agent 说明' } }) } }] } : { content: '已创建 Flow 候选' } }] }))
})
async function launch() { app = await _electron.launch({ args: [path.resolve(__dirname,'../out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE:'1' } }); const page = await app.firstWindow(); await page.getByRole('link',{name:'Agent'}).waitFor(); return page }
;(async () => {
 await new Promise(r => server.listen(0,'127.0.0.1',r)); let page = await launch()
 ;({ pid, flowId } = await page.evaluate(async base => {
  const p = (await window.api.projects.ensureDefault()).data, flow = (await window.api.flows.create(p.project_id,'原 Flow')).data
  await window.api.agent.saveConnection({ name:'Flow', base_url:base, model:'flow', protocol:'chat-completions' }); await window.api.agent.testConnection()
  return { pid:p.project_id, flowId:flow.flow_id }
 },`http://127.0.0.1:${server.address().port}/v1`))
 await page.getByRole('link',{name:'Agent'}).click(); await page.getByRole('button',{name:'修改草稿',exact:true}).click()
 await page.getByLabel('计划目标',{exact:true}).fill('修改 Flow 名称及说明')
 await page.getByRole('combobox',{name:'计划 Flow',exact:true}).click(); await page.getByText('原 Flow',{exact:true}).last().click()
 await page.getByRole('button',{name:'生成草稿修改计划',exact:true}).click(); await page.getByRole('button',{name:'批准修改计划',exact:true}).click()
 await page.getByText('已创建 Flow 候选',{exact:true}).waitFor(); await page.locator('.ant-drawer-close').click()
 await page.getByText('AI 执行计划',{exact:true}).click()
 await page.getByPlaceholder('流程名称',{exact:true}).fill('人工 Flow')
 await page.getByRole('button',{name:/Flow 版本 · 1 个待确认/}).click()
 await page.getByRole('button',{name:'查看差异',exact:true}).click(); await page.getByLabel('候选双栏差异',{exact:true}).waitFor()
 await page.getByRole('button',{name:'应用到草稿',exact:true}).click()
 await page.getByLabel('冲突 /name',{exact:true}).waitFor()
 for (const text of ['基线','当前内容','Agent 内容','合并结果']) await page.getByLabel('冲突 /name',{exact:true}).getByText(text,{exact:true}).waitFor()
 await page.locator('.ant-drawer-close').click(); await page.getByRole('button',{name:'保存 Flow',exact:true}).click(); await page.getByText(/该Flow存在未解决/).waitFor()
 assert.equal((await page.evaluate(async ({pid,flowId}) => (await window.api.flows.get(pid,flowId)).data,{pid,flowId})).name,'原 Flow')
 await page.getByRole('link',{name:'Agent'}).click(); await page.getByText('AI 执行计划',{exact:true}).click()
 assert.equal(await page.getByPlaceholder('流程名称',{exact:true}).inputValue(),'人工 Flow')
 await page.getByRole('button',{name:/新建.导入项目/}).click(); await page.getByPlaceholder('项目名称',{exact:true}).fill('隔离项目')
 await page.locator('.ant-modal').getByRole('button',{name:/创.*建/}).click()
 await page.locator('.project-switch').getByText('隔离项目',{exact:true}).waitFor()
 assert.equal((await page.evaluate(async ({pid,flowId}) => (await window.api.agent.getFlowDraft(pid,flowId)).data,{pid,flowId})).flow.name,'人工 Flow')
 await page.locator('.project-switch').click(); await page.getByRole('menuitem',{name:'默认项目',exact:true}).click()
 await page.getByPlaceholder('流程名称',{exact:true}).waitFor()
 assert.equal(await page.getByPlaceholder('流程名称',{exact:true}).inputValue(),'人工 Flow')
 await page.evaluate(async () => window.api.agent.prepareQuit()); await app.evaluate(({app}) => app.exit(0)); app = null
 page = await launch(); await page.getByText('AI 执行计划',{exact:true}).click(); await page.getByText('已恢复 Agent Flow 草稿 · 退出仅暂存 · 运行前需主动保存',{exact:true}).waitFor()
 assert.equal(await page.getByPlaceholder('流程名称',{exact:true}).inputValue(),'人工 Flow')
 await page.getByRole('button',{name:/Flow 版本/}).click(); await page.getByRole('button',{name:'查看差异',exact:true}).first().click()
 await page.getByRole('radio',{name:'采用 Agent',exact:true}).check(); await page.getByRole('button',{name:'确认冲突选择并应用草稿',exact:true}).click()
 await page.getByText('已应用草稿',{exact:true}).waitFor(); await page.locator('.ant-drawer-close').click()
 assert.equal(await page.getByPlaceholder('流程名称',{exact:true}).inputValue(),'Agent Flow')
 await page.getByRole('button',{name:'运行 Flow',exact:true}).click(); await page.getByText('Agent Flow 草稿请先主动保存后运行；运行不会自动保存。',{exact:true}).waitFor()
 const saved = await page.evaluate(async ({pid,flowId}) => (await window.api.flows.get(pid,flowId)).data,{pid,flowId}); assert.equal(saved.name,'原 Flow'); assert.equal(saved.description,'')
 await page.getByRole('button',{name:'保存 Flow',exact:true}).click(); await page.getByText('流程已保存',{exact:true}).waitFor()
 assert.equal((await page.evaluate(async ({pid,flowId}) => (await window.api.flows.get(pid,flowId)).data,{pid,flowId})).name,'Agent Flow')
 console.log('PASS Electron Flow plan authorization, version notice, diff, conflict, page switch, restart recovery, Run barrier and explicit Save')
})().catch(async e => { console.error(e); if(app) {const page=await app.firstWindow(); console.error((await page.locator('body').innerText()).slice(-4000)); await page.screenshot({path:'/tmp/kindra-builtin-agent-context/flow-ui-17.png'})} process.exitCode=1 }).finally(async () => {if(app) await app.evaluate(({app}) => app.exit(0)).catch(()=>{}); server.closeAllConnections(); server.close()})
