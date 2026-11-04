const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(),'kindra-flow-save-ui-18-'))
let app, pid, flowId, save = true, nextName = '已保存 Flow'
const server = http.createServer(async(req,res)=>{
 let raw=''; for await(const chunk of req) raw+=chunk
 const body=JSON.parse(raw), probe=body.tools?.[0]?.function.name==='kindra_capability_probe'
 const calls=probe?[{name:'kindra_capability_probe',args:{token:'kindra-probe'}}]:[{name:'propose_flow_change',args:{project_id:pid,flow_id:flowId,patch:{name:nextName,description:'完整版本说明'},step_id:'edit',depends_on:[]}},...(save?[{name:'save_flow',args:{project_id:pid,flow_id:flowId,step_id:'save',depends_on:[]}}]:[])]
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:body.tools?{tool_calls:calls.map((c,i)=>({id:`c${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:'保存结果已确认'}}]}))
})
async function launch(){app=await _electron.launch({args:[path.resolve(__dirname,'../out/main/index.js')],env:{...process.env,KINDRAAPI_USER_DATA:userData,KINDRAAPI_DISABLE_SINGLE_INSTANCE:'1'}});const page=await app.firstWindow();await page.getByRole('link',{name:'Agent'}).waitFor();return page}
;(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let page=await launch()
 ;({pid,flowId}=await page.evaluate(async base=>{
  const p=(await window.api.projects.ensureDefault()).data,f=(await window.api.flows.create(p.project_id,'原始 Flow')).data
  await window.api.agent.saveConnection({name:'Flow',base_url:base,model:'flow-save',protocol:'chat-completions'});await window.api.agent.testConnection()
  return {pid:p.project_id,flowId:f.flow_id}
 },`http://127.0.0.1:${server.address().port}/v1`))
 await page.getByRole('link',{name:'Agent'}).click();await page.getByRole('button',{name:'修改并保存',exact:true}).click()
 await page.getByLabel('计划目标',{exact:true}).fill('修改并保存 Flow')
 await page.getByRole('combobox',{name:'计划 Flow',exact:true}).click();await page.getByText('原始 Flow',{exact:true}).last().click()
 await page.getByRole('button',{name:'生成修改与保存计划',exact:true}).click()
 await page.getByText(/保存正式定义/).waitFor();await page.getByRole('button',{name:'批准修改与保存计划',exact:true}).click()
 await page.getByText('保存结果已确认',{exact:true}).waitFor();await page.locator('.ant-drawer-close').click()
 assert.equal((await page.evaluate(async({pid,flowId})=>(await window.api.flows.get(pid,flowId)).data,{pid,flowId})).name,'已保存 Flow')
 await page.getByText('AI 执行计划',{exact:true}).click();await page.getByRole('button',{name:/Flow 版本/}).click()
 await page.getByText('已关联 v2',{exact:true}).waitFor();await page.getByRole('button',{name:'查看 v1',exact:true}).click();await page.getByLabel('候选双栏差异',{exact:true}).waitFor()
 await page.getByRole('button',{name:'恢复 v1 到草稿',exact:true}).click();await page.getByText('版本已恢复到草稿，尚未正式保存。',{exact:true}).waitFor();await page.locator('.ant-drawer-close').click()
 assert.equal(await page.getByPlaceholder('流程名称',{exact:true}).inputValue(),'原始 Flow')
 assert.equal((await page.evaluate(async({pid,flowId})=>(await window.api.flows.get(pid,flowId)).data,{pid,flowId})).name,'已保存 Flow')
 await page.evaluate(async()=>window.api.agent.prepareQuit());await app.evaluate(({app})=>app.exit(0));app=null
 page=await launch();await page.getByText('AI 执行计划',{exact:true}).click();await page.getByText('已恢复 Agent Flow 草稿 · 退出仅暂存 · 运行前需主动保存',{exact:true}).waitFor()
 assert.equal(await page.getByPlaceholder('流程名称',{exact:true}).inputValue(),'原始 Flow')
 await page.getByRole('button',{name:'保存 Flow',exact:true}).click();await page.getByText('流程已保存',{exact:true}).waitFor()
 save=false;nextName='恢复候选 Flow'
 await page.evaluate(async({pid,flowId})=>{const p=(await window.api.agent.proposeEditPlan(pid,{targetId:'',flowIds:[flowId],goal:'只生成候选'})).data;await window.api.agent.approvePlan(pid,p.plan_id)},{pid,flowId})
 await page.getByRole('button',{name:/Flow 版本/}).click();await page.getByRole('button',{name:'不采纳',exact:true}).first().click()
 await page.getByRole('button',{name:'恢复候选到草稿',exact:true}).first().click();await page.locator('.ant-drawer-close').click()
 assert.equal(await page.getByPlaceholder('流程名称',{exact:true}).inputValue(),'恢复候选 Flow')
 const saved=await page.evaluate(async({pid,flowId})=>(await window.api.flows.get(pid,flowId)).data,{pid,flowId});assert.equal(saved.name,'原始 Flow')
 save=true;nextName='后台保存 Flow'
 await page.evaluate(async({pid,flowId})=>{const p=(await window.api.agent.proposeSavePlan(pid,{targetId:'',flowIds:[flowId],goal:'当前Flow页接受后台保存事件'})).data;const result=await window.api.agent.approvePlan(pid,p.plan_id);if(!result.ok||result.data.status!=='completed')throw new Error(JSON.stringify(result))},{pid,flowId})
 assert.equal(await page.getByPlaceholder('流程名称',{exact:true}).inputValue(),'后台保存 Flow')
 assert.equal(await page.getByText('已恢复 Agent Flow 草稿 · 退出仅暂存 · 运行前需主动保存',{exact:true}).count(),0)
 console.log('PASS Electron save_flow approval, v/P distinction/link, history diff, restore draft/restart/manual Save and rejected candidate recovery')
})().catch(async e=>{console.error(e);if(app){const page=await app.firstWindow();console.error((await page.locator('body').innerText()).slice(-4000));await page.screenshot({path:'/tmp/kindra-builtin-agent-context/flow-save-ui-18.png'})}process.exitCode=1}).finally(async()=>{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});server.closeAllConnections();server.close()})
