/** 四项 Apipost UI 对照：真实控件尺寸、列宽、颜色、状态持久化。 */
const assert=require('node:assert/strict'), fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http')
const {_electron:electron}=require('playwright-core')
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'kindra-parity-'))
const artifacts=path.join(__dirname,'.ui-artifacts','debug-parity')
let app,page,server,projectId,targetId
const errors=[]
async function wait(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out')}
async function saved(){return page.evaluate(async({projectId,targetId})=>(await window.api.targets.get(projectId,targetId)).data,{projectId,targetId})}
async function tab(name){await page.locator('.req-tabs').getByRole('tab',{name,exact:true}).click()}
async function state(name){await page.getByRole('button',{name:'接口状态',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click()}
async function manager(){await state('接口状态管理');return page.locator('.api-status-modal')}
async function shot(name){await page.locator('.ant-message-notice').last().waitFor({state:'hidden'});await page.mouse.move(15,15);await page.screenshot({path:path.join(artifacts,name+'.png')})}
async function main(){
 fs.mkdirSync(artifacts,{recursive:true})
 const upload=path.join(userData,'binary-fixture.txt');fs.writeFileSync(upload,'local binary fixture')
 server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','X-Request-Id':'47eb1b2f-d2cd-4bb6-a7d7-72e039fbcf24','X-XSS-Protection':'1; mode=block','X-Long-Value':'a'.repeat(400)});res.end(JSON.stringify({ok:true,items:Array.from({length:80},(_,i)=>({id:i}))}))})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 app=await electron.launch({executablePath:require('electron'),args:['.'],env:{...process.env,KINDRAAPI_USER_DATA:userData,KINDRAAPI_DISABLE_SINGLE_INSTANCE:'1'}})
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
 await app.evaluate(({BrowserWindow,dialog},upload)=>{for(const w of BrowserWindow.getAllWindows()){w.setSize(1270,782);w.on('show',()=>w.hide());w.hide()};dialog.showOpenDialog=async options=>{globalThis.__filePickerProperties=options.properties;return {canceled:false,filePaths:[upload]}}},upload)
 await page.waitForSelector('.app-shell');await page.locator('.rail-btn').filter({hasText:'APIs'}).click();await page.locator('.tab-add').click();await page.locator('.url-input input').waitFor()
 await page.locator('.api-name input').fill('四项对照验证');await page.locator('.api-name input').press('Tab')
 const ids=await page.evaluate(async()=>{const projectId=(await window.api.projects.list()).data[0].project_id;return {projectId,targetId:(await window.api.targets.list(projectId)).data.find(t=>t.target_type==='api').target_id}});projectId=ids.projectId;targetId=ids.targetId
 await page.locator('.mode-row .segmented').getByText('调试',{exact:true}).click()
 await page.locator('.url-input input').fill(`http://127.0.0.1:${server.address().port}/echo`);await tab('Body');await page.locator('.send-btn').click();await page.locator('.send-btn:enabled').waitFor()
 await page.locator('.bodytypes .ant-radio-wrapper').filter({hasText:'binary'}).click()
 const radio=await page.locator('.bodytypes .ant-radio-wrapper-checked').evaluate(el=>{const dot=getComputedStyle(el.querySelector('.ant-radio-inner'),'::after');return {border:getComputedStyle(el).borderTopWidth,marginTop:dot.marginTop,marginLeft:dot.marginLeft}})
 assert.deepEqual(radio,{border:'0px',marginTop:'0px',marginLeft:'0px'},'Body 使用普通单选项，选中圆点保持居中')
 let sizes=await page.locator('.binary-upload').evaluate(el=>({outer:el.getBoundingClientRect().width,button:el.querySelector('button').getBoundingClientRect().width,height:el.querySelector('button').getBoundingClientRect().height}))
 assert(sizes.button/sizes.outer>.98 && sizes.height>=64 && sizes.height<=68,JSON.stringify(sizes))
 await page.getByRole('button',{name:'上传文件',exact:true}).click();await page.locator('.binary-file-row').waitFor();assert((await page.locator('.binary-file-row').innerText()).includes('binary-fixture.txt'))
 assert(!(await app.evaluate(()=>globalThis.__filePickerProperties)).includes('multiSelections'))
 sizes=await page.locator('.binary-upload').evaluate(el=>({outer:el.getBoundingClientRect().width,button:el.querySelector('button').getBoundingClientRect().width}))
 assert(sizes.button/sizes.outer>.98,'选中文件后上传区仍为全宽')
 await page.getByRole('button',{name:'移除文件',exact:true}).click();assert.equal(await page.locator('.binary-file-row').count(),0)
 console.log('PASS binary 全宽/高度/居中、单文件选择、文件行及无确认删除')
 await page.locator('.response-pane .resp-filled').evaluate(el=>{el.scrollTop=el.scrollHeight})
 await page.locator('.resp-tabs').getByRole('tab',{name:'响应头',exact:true}).click()
 const table=page.locator('.response-header-table');assert.equal(await table.locator('th').allTextContents().then(v=>v.join(',')),'参数名,参数值')
 const widths=await table.evaluate(el=>({table:el.getBoundingClientRect().width,name:el.querySelector('td').getBoundingClientRect().width,scroll:el.parentElement.scrollTop}))
 assert(widths.name/widths.table>.24&&widths.name/widths.table<.26,JSON.stringify(widths));assert.equal(widths.scroll,0)
 assert.equal(await table.locator('td').filter({hasText:'x-content-type-options'}).count(),1)
 await shot('binary-headers')
 console.log('PASS 响应头25/75列宽、长值不挤压名称、表头/计数和切换后回到顶部')
 const methodColors={GET:'rgb(34, 206, 164)',POST:'rgb(255, 180, 1)',PUT:'rgb(5, 123, 237)',DELETE:'rgb(255, 88, 62)',PATCH:'rgb(48, 197, 166)'}
 for(const [method,color] of Object.entries(methodColors)){
  await page.locator('.method-btn').click();await page.getByRole('menuitem',{name:method,exact:true}).click()
  assert.equal(await page.locator('.method-btn').evaluate(el=>getComputedStyle(el).color),color)
  const label=method==='DELETE'?'DEL':method==='PATCH'?'PAT':method
  assert.equal(await page.locator('.filetab.active .method-text').innerText(),label)
  await page.locator('.save-btn').click();await wait(async()=>(await saved()).method===method)
  assert.equal(await page.locator('.tree-node').filter({hasText:'四项对照验证'}).locator('.method-text').evaluate(el=>getComputedStyle(el).color),color)
 }
 console.log('PASS GET/POST/PUT/DELETE/PATCH 的 URL/标签/树统一颜色，DEL/PAT缩写与保存')
 await page.getByRole('button',{name:'接口状态',exact:true}).click();assert.deepEqual((await page.locator('.api-status-dropdown .ant-dropdown-menu-item').allTextContents()).map(s=>s.trim()),['开发中','已完成','需修改','已废弃','接口状态管理'])
 assert.equal(await page.locator('.api-status-dropdown .ant-dropdown-menu-item-selected').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(241, 237, 228)')
 await shot('status-menu')
 await page.getByRole('menuitem',{name:'已完成',exact:true}).click();await page.locator('.save-btn').click();await wait(async()=>(await saved()).mark_id==='2')
 let modal=await manager();assert(await modal.getByRole('button',{name:'删除状态 开发中',exact:true}).isDisabled());await shot('status-manager')
 await modal.getByRole('button',{name:/新.*建/}).click();await modal.getByPlaceholder('状态名称').fill('联调中');await modal.getByRole('button',{name:/保.*存/}).click()
 await modal.getByRole('button',{name:'设为默认 联调中',exact:true}).waitFor();await modal.getByRole('button',{name:'设为默认 联调中',exact:true}).click()
 await wait(()=>modal.getByRole('button',{name:'删除状态 联调中',exact:true}).isDisabled())
 const newTarget=await page.evaluate(async projectId=>(await window.api.targets.create(projectId,'0','api')).data,projectId)
 const proj=await page.evaluate(async()=> (await window.api.projects.list()).data[0]);assert.equal(newTarget.mark_id,proj.default_api_status_id)
 await modal.getByRole('button',{name:/关.*闭/}).click()
 await tab('Header');await page.locator('.design-param-row.is-tail').getByLabel('参数名',{exact:true}).fill('X-Unsaved')
 modal=await manager();await modal.getByRole('button',{name:'删除状态 已完成',exact:true}).click();await wait(async()=>(await saved()).mark_id===proj.default_api_status_id)
 await modal.getByRole('button',{name:/关.*闭/}).click();assert((await page.getByRole('button',{name:'接口状态',exact:true}).innerText()).includes('联调中'))
 assert.equal(await page.getByRole('textbox',{name:'参数值 X-Unsaved',exact:true}).count(),1,'删除状态迁移保留未保存编辑')
 await page.locator('.save-btn').click();await wait(async()=>(await saved()).request.header.parameter.some(p=>p.key==='X-Unsaved'))
 await page.reload();await page.waitForSelector('.app-shell');await page.locator('.rail-btn').filter({hasText:'APIs'}).click();await page.locator('.tree-node-name').getByText('四项对照验证',{exact:true}).click()
 await page.getByRole('button',{name:'接口状态',exact:true}).waitFor();assert((await page.getByRole('button',{name:'接口状态',exact:true}).innerText()).includes('联调中'))
 assert.deepEqual(errors,[])
 console.log('PASS 状态选项、显式保存与重开、新建/默认/删除迁移、保留草稿，无渲染错误')
}
main().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});process.exitCode=1}).finally(async()=>{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close()};if(server){server.closeAllConnections();await new Promise(r=>server.close(r))};fs.rmSync(userData,{recursive:true,force:true})})
