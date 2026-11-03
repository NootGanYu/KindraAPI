const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')
async function main() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kindra-cancel-ui-'))
  let arrival
  const arrived=new Promise(resolve=>{arrival=resolve})
  const hits=[]
  const server=http.createServer((req,res)=>{hits.push(req.url);if(req.url==='/hold')arrival();else res.end('{}')})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  let electron
  try {
    electron=await _electron.launch({args:[path.resolve('out/main/index.js')],env:{...process.env,KINDRAAPI_USER_DATA:dir}})
    const page=await electron.firstWindow()
    await page.waitForFunction(()=>Boolean(window.api))
    const run=await page.evaluate(async port=>{
      const project=(await window.api.projects.list()).data[0]
      const flow=(await window.api.flows.create(project.project_id,'取消界面验收')).data
      flow.events=[{event_id:'hold',type:'request',name:'在途请求',enabled:true,method:'GET',url:`http://127.0.0.1:${port}/hold`},{event_id:'after',type:'request',name:'后续请求',enabled:true,method:'GET',url:`http://127.0.0.1:${port}/never`}]
      const saved=await window.api.flows.save(project.project_id,flow,flow.revision)
      if(!saved.ok)throw new Error(saved.error)
      return (await window.api.flows.startRun(project.project_id,flow.flow_id,'','ui-cancel')).data
    },server.address().port)
    await arrived
    await page.evaluate(()=>{window.location.hash='#/automation'})
    await page.getByRole('button',{name:'取消运行',exact:true}).click({timeout:3000})
    await page.getByText('已取消',{exact:true}).first().waitFor()
    await page.getByText('运行已取消；已发送请求的远端结果未知，不保证回滚，不会自动重试',{exact:true}).waitFor()
    const result=await page.evaluate(run=>window.api.flows.getRun(run.project_id,run.run_id),run)
    assert.equal(result.data.status,'cancelled')
    assert.equal(result.data.remote_outcome,'unknown')
    assert.deepEqual(hits,['/hold'])
    console.log('PASS real Electron cancel button stops run and displays unknown remote outcome')
  } finally {
    if(electron){await electron.evaluate(({app})=>app.exit(0)).catch(()=>{});await electron.close().catch(()=>{})}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
