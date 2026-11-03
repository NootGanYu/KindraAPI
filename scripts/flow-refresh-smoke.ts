import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import * as service from '../src/main/flow/service'
import { createFlow, createFlowEvent, createTarget, createParam } from '../src/shared/factories'
const api = service as typeof service & { previewFlowRunRefresh: Function; applyFlowRunRefresh: Function }
async function until(read: () => any, expected: string) { for(let i=0;i<1000;i++){const r=read();if(r?.status===expected)return r;await new Promise(r=>setTimeout(r,5))}throw Error(`timeout ${expected}`) }
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kindra-refresh-'));app.setPath('userData',dir);await app.whenReady()
 let release!:()=>void;let arrived!:()=>void;let arrival=new Promise<void>(r=>arrived=r);const hits:string[]=[]
 const server=http.createServer((req,res)=>{hits.push(req.url!);if(req.url==='/hold'){release=()=>res.end('{}');arrived()}else res.end('{}')})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`
 try{
 const project=store.ensureDefaultProject().project_id;const target=createTarget(project,'api');target.url=origin+'/old';store.saveTarget(project,target)
 const flow=createFlow(project,'刷新重复引用');flow.events=[createFlowEvent('api',{target_id:target.target_id}),createFlowEvent('request',{url:origin+'/hold'}),createFlowEvent('api',{target_id:target.target_id}),createFlowEvent('api',{target_id:target.target_id})];store.saveFlow(project,flow)
 const run=service.startFlowRun(project,flow.flow_id,'','refresh');await arrival;service.pauseFlowRun(project,run.run_id);release();await until(()=>service.getFlowRun(project,run.run_id),'paused')
 target.url=origin+'/new';store.saveTarget(project,target);assert.equal(service.getFlowRun(project,run.run_id)?.status,'paused')
 const preview=api.previewFlowRunRefresh(project,run.run_id);assert.equal(preview.references.length,2);assert(preview.references.every((r:any)=>r.effective_request.url===origin+'/new'));assert.equal(preview.blockers.length,0)
 api.applyFlowRunRefresh(project,run.run_id,preview.preview_id);assert.equal(service.getFlowRun(project,run.run_id)?.status,'paused');service.resumeFlowRun(project,run.run_id)
 const done=await until(()=>service.getFlowRun(project,run.run_id),'passed');assert.deepEqual(hits,['/old','/hold','/new','/new']);assert.equal(done.version_switches.length,1);assert.notEqual(done.events[0].definition_revision,done.events[2].definition_revision);assert.equal(store.getFlowRun(project,run.run_id)?.version_switches?.length,1)
 console.log('PASS all remaining references refreshed, completed evidence retained, manual resume only')
 async function paused(input?:any){
   const t=createTarget(project,'api');t.url=origin+'/before';store.saveTarget(project,t)
   const f=createFlow(project,'review guard');f.events=[createFlowEvent('request',{url:origin+'/hold'}),createFlowEvent('api',{target_id:t.target_id,input})];store.saveFlow(project,f)
   arrival=new Promise<void>(r=>arrived=r);const r=service.startFlowRun(project,f.flow_id,'',f.flow_id);await arrival;service.pauseFlowRun(project,r.run_id);release();await until(()=>service.getFlowRun(project,r.run_id),'paused');return {t,f,r}
 }
 const concurrent=await paused();concurrent.t.url=origin+'/reviewed';store.saveTarget(project,concurrent.t);const reviewed=api.previewFlowRunRefresh(project,concurrent.r.run_id);api.applyFlowRunRefresh(project,concurrent.r.run_id,reviewed.preview_id);concurrent.t.url=origin+'/raced';store.saveTarget(project,concurrent.t)
 assert.throws(()=>service.resumeFlowRun(project,concurrent.r.run_id),/revision/);assert.equal(service.getFlowRun(project,concurrent.r.run_id)?.status,'paused');assert(!hits.includes('/reviewed')&&!hits.includes('/raced'))
 const refreshed=api.previewFlowRunRefresh(project,concurrent.r.run_id);api.applyFlowRunRefresh(project,concurrent.r.run_id,refreshed.preview_id);service.resumeFlowRun(project,concurrent.r.run_id);await until(()=>service.getFlowRun(project,concurrent.r.run_id),'passed')
 const deleted=await paused();store.deleteTarget(project,deleted.t.target_id);assert(api.previewFlowRunRefresh(project,deleted.r.run_id).blockers.length);assert.throws(()=>service.resumeFlowRun(project,deleted.r.run_id),/删除/)
 const conflict=await paused({headers:{'X-Choice':'override'},body:'override body'});conflict.t.request!.header.parameter=[createParam({key:'X-Choice',value:'new api'})];conflict.t.request!.body.raw='new body';store.saveTarget(project,conflict.t)
 const conflicts=api.previewFlowRunRefresh(project,conflict.r.run_id);assert.equal(conflicts.references[0].conflicts.length,2);assert.throws(()=>api.applyFlowRunRefresh(project,conflict.r.run_id,conflicts.preview_id),/覆盖冲突/);assert.throws(()=>service.resumeFlowRun(project,conflict.r.run_id),/覆盖冲突/);assert.equal(store.getFlow(project,conflict.f.flow_id)!.events[1].input!.body,'override body')
 const scope=await paused();scope.t.method='POST';store.saveTarget(project,scope.t);const scoped=api.previewFlowRunRefresh(project,scope.r.run_id);assert(scoped.references[0].scope_changes.some((c:string)=>c.includes('method')));assert.throws(()=>api.applyFlowRunRefresh(project,scope.r.run_id,scoped.preview_id),/范围/);assert.throws(()=>service.resumeFlowRun(project,scope.r.run_id),/范围/)
 const missing=await paused();missing.t.url=origin+'/new?object={{missing_id}}';store.saveTarget(project,missing.t);const missingPreview=api.previewFlowRunRefresh(project,missing.r.run_id);assert.throws(()=>api.applyFlowRunRefresh(project,missing.r.run_id,missingPreview.preview_id),/缺少运行变量/)
 console.log('PASS revision race, deletion, override/body conflict, scope expansion and missing output keep paused')

 }finally{release?.();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(dir,{recursive:true,force:true})}
}
main().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)})
