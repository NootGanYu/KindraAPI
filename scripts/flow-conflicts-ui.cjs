const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-conflict-ui-'))
  let release, arrive, electron, page, fixture
  const arrival = new Promise(resolve => arrive = resolve), hits = []
  const server = http.createServer((req, res) => {
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      hits.push({url:req.url,header:req.headers['x-choice'],body})
      if(req.url==='/hold'){release=()=>res.end('{}');arrive()}else res.end('{}')
    })
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    electron=await _electron.launch({args:[path.resolve('out/main/index.js')],env:{...process.env,KINDRAAPI_USER_DATA:dir}})
    page=await electron.firstWindow();await page.waitForFunction(()=>Boolean(window.api));page.setDefaultTimeout(10000)
    fixture=await page.evaluate(async port=>{
      const pid=(await window.api.projects.list()).data[0].project_id
      const target=(await window.api.targets.create(pid,'0','api')).data
      target.url=`http://127.0.0.1:${port}/api`;target.method='POST'
      target.request.header.parameter.push({param_id:'choice',key:'X-Choice',value:'old-header',is_checked:1})
      target.request.body={...target.request.body,mode:'raw',raw:'old-body'};await window.api.targets.save(pid,target)
      const flow=(await window.api.flows.create(pid,'覆盖冲突界面')).data
      flow.events=[{event_id:'hold',type:'request',name:'等待',enabled:true,url:`http://127.0.0.1:${port}/hold`},{event_id:'choice',type:'api',name:'需选择的接口',enabled:true,target_id:target.target_id,input:{headers:{'X-Choice':'step-header'},body:'step-body'}}]
      await window.api.flows.save(pid,flow,flow.revision)
      const run=(await window.api.flows.startRun(pid,flow.flow_id,'','conflict-ui')).data
      return {pid,target,run,flow}
    },server.address().port)
    await arrival;await page.evaluate(()=>{location.hash='#/automation'})
    await page.getByRole('button',{name:/暂\s*停/,exact:true}).click();release();await page.getByText('已暂停',{exact:true}).waitFor()
    const save=await page.evaluate(async ({pid,target})=>{
      const original=(await window.api.targets.read(pid,target.target_id)).data
      target.request.header.parameter.find(p=>p.key==='X-Choice').value='new-header';target.request.body.raw='new-body'
      return window.api.targets.saveChecked(pid,target,original.revision,'conflict-ui-save')
    },fixture);assert(save.ok&&save.data.status==='saved')
    await page.getByRole('button',{name:'预览已保存变更',exact:true}).click()
    const header=page.getByLabel('步骤覆盖冲突 choice headers.X-Choice'), body=page.getByLabel('步骤覆盖冲突 choice body')
    await header.waitFor();assert((await header.innerText()).includes('new-header'));assert((await body.innerText()).includes('new-body'))
    const adopt=page.getByRole('button',{name:/采用剩余引用更新$/});assert(await adopt.isDisabled())
    await header.getByRole('button',{name:'采用新 API 值',exact:true}).click()
    await header.getByText('已选择：新 API 值',{exact:true}).waitFor();assert(await adopt.isDisabled())
    await body.getByRole('button',{name:'保留步骤覆盖',exact:true}).click();await body.getByText('已选择：步骤覆盖',{exact:true}).waitFor()
    const effective=page.getByLabel('实际生效请求 choice');assert((await effective.innerText()).includes('new-header'));assert((await effective.innerText()).includes('step-body'))
    await adopt.click();await page.getByLabel('快照版本切换').waitFor();assert.equal(hits.length,1)
    await page.locator('button').filter({hasText:'继续已审阅快照'}).click()
    const deadline=Date.now()+10000
    while(true){const result=await page.evaluate(async f=>window.api.flows.getRun(f.pid,f.run.run_id),fixture);if(result.data.status==='passed')break;assert(Date.now()<deadline,JSON.stringify(result));await new Promise(r=>setTimeout(r,10))}
    assert.deepEqual(hits[1],{url:'/api',header:'new-header',body:'step-body'})
    const saved=await page.evaluate(async f=>window.api.flows.get(f.pid,f.flow.flow_id),fixture)
    assert.deepEqual(saved.data.events[1].input,{headers:{'X-Choice':'step-header'},body:'step-body'})
    console.log('PASS actual Electron conflict values, choices, effective preview, separate apply/resume and saved Flow unchanged')
  } catch(error) {
    if (page && fixture) console.error('UI failure state', await page.evaluate(async f=>({run:await window.api.flows.getRun(f.pid,f.run.run_id),text:document.body.innerText}),fixture))
    throw error
  } finally {
    release?.();if(electron){await electron.evaluate(({app})=>app.exit(0)).catch(()=>{});await electron.close().catch(()=>{})}
    server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})
  }
}
main().catch(e=>{console.error(e);process.exitCode=1})
