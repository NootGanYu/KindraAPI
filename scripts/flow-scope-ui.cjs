const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http')
const {_electron}=require('playwright-core')
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kindra-scope-ui-'));let release,arrive;const arrival=new Promise(r=>arrive=r);const hits=[]
 const server=http.createServer((req,res)=>{hits.push(`${req.method} ${req.url}`);if(req.url==='/hold'){release=()=>res.end('{}');arrive()}else res.end('{}')});await new Promise(r=>server.listen(0,'127.0.0.1',r));let electron
 try{
 electron=await _electron.launch({args:[path.resolve('out/main/index.js')],env:{...process.env,KINDRAAPI_USER_DATA:dir}});const page=await electron.firstWindow();await page.waitForFunction(()=>Boolean(window.api))
 const fixture=await page.evaluate(async port=>{
   const pid=(await window.api.projects.list()).data[0].project_id;const target=(await window.api.targets.create(pid,'0','api')).data;target.url=`http://127.0.0.1:${port}/old`;await window.api.targets.save(pid,target)
   const flow=(await window.api.flows.create(pid,'范围界面验收')).data;flow.events=[{event_id:'hold',type:'request',name:'等待响应',enabled:true,url:`http://127.0.0.1:${port}/hold`},{event_id:'remaining-1',type:'api',name:'剩余接口一',enabled:true,target_id:target.target_id},{event_id:'remaining-2',type:'api',name:'剩余接口二',enabled:true,target_id:target.target_id}];await window.api.flows.save(pid,flow,flow.revision);const run=(await window.api.flows.startRun(pid,flow.flow_id,'','refresh-ui')).data;return {pid,target,run,port}
 },server.address().port)
 await arrival;await page.evaluate(()=>{location.hash='#/automation'});await page.getByRole('button',{name:/暂\s*停/,exact:true}).click();release();await page.getByText('已暂停',{exact:true}).waitFor()
 const saved=await page.evaluate(async ({pid,target,port})=>{const snapshot=(await window.api.targets.read(pid,target.target_id)).data;target.url=`http://127.0.0.1:${port}/new`;target.method='POST';return window.api.targets.saveChecked(pid,target,snapshot.revision,'save-refresh')},fixture);assert(saved.ok&&saved.data.status==='saved');assert.deepEqual(hits,['GET /hold'])
 await page.getByRole('button',{name:'预览已保存变更',exact:true}).click();const preview=page.getByLabel('剩余引用变更预览');await preview.getByText('剩余接口一',{exact:true}).waitFor();await preview.getByText('剩余接口二',{exact:true}).waitFor();assert((await preview.innerText()).includes('/new'))
 assert(await page.getByRole('button',{name:'采用剩余引用更新',exact:true}).isDisabled())
 await page.getByRole('button',{name:'审阅执行范围',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByText('确认扩大本轮执行范围',{exact:true}).last().waitFor();assert((await dialog.innerText()).includes('GET → POST'));await dialog.getByRole('button',{name:'保持暂停',exact:true}).click();assert.deepEqual(hits,['GET /hold']);assert(await page.getByRole('button',{name:'采用剩余引用更新',exact:true}).isDisabled())
 await page.getByRole('button',{name:'审阅执行范围',exact:true}).click();await dialog.getByRole('button',{name:'确认本轮范围',exact:true}).click();await page.getByText('范围已确认；采用后仍需手动继续。',{exact:true}).waitFor();assert.deepEqual(hits,['GET /hold'])
 await page.getByRole('button',{name:'采用剩余引用更新',exact:true}).click();await page.getByLabel('快照版本切换').waitFor();assert.deepEqual(hits,['GET /hold']);await page.locator('button').filter({hasText:'继续已审阅快照'}).click()
 const deadline=Date.now()+10000;while(true){const result=await page.evaluate(async f=>window.api.flows.getRun(f.pid,f.run.run_id),fixture);if(result.data.status==='passed')break;assert(Date.now()<deadline,JSON.stringify(result));await new Promise(resolve=>setTimeout(resolve,10))};assert.deepEqual(hits,['GET /hold','POST /new','POST /new']);assert((await page.getByLabel('快照版本切换').innerText()).includes('剩余接口二'))
 console.log('PASS Electron UI scope rejection stays paused; explicit approval/adoption separate from manual resume')
 }finally{release?.();if(electron){await electron.evaluate(({app})=>app.exit(0)).catch(()=>{});await electron.close().catch(()=>{})}server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1})
