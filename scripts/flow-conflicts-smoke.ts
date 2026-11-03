import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import * as service from '../src/main/flow/service'
import { createFlow, createFlowEvent, createTarget, createParam } from '../src/shared/factories'
import type { FlowRefreshPreview, FlowRun, Target } from '../src/shared/types'
const api = service as typeof service & { resolveFlowRunConflict: (project: string, run: string, preview: string, event: string, field: string, choice: 'api'|'override') => FlowRefreshPreview }
async function until(project: string, run: string, status: string): Promise<FlowRun> {
  for (let i=0;i<1000;i++) { const r=service.getFlowRun(project,run)!; if(r.status===status)return r;await new Promise(r=>setTimeout(r,5)) }
  throw Error(`timeout ${status}`)
}
async function main() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kindra-conflicts-'));app.setPath('userData',dir);await app.whenReady()
  let release!:()=>void, arrived!:()=>void, arrival:Promise<void>
  const hits:Array<{url:string,header:unknown,body:string}>=[]
  const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{hits.push({url:req.url!,header:req.headers['x-choice'],body});if(req.url==='/hold'){release=()=>res.end('{}');arrived()}else res.end('{}')})})
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`
  const project=store.ensureDefaultProject().project_id
  async function paused(header = 'X-Choice') {
    const target=createTarget(project,'api');target.method='POST';target.url=origin+'/api';target.request!.header.parameter=[createParam({key:header,value:'old'})];target.request!.query.parameter=[createParam({key:'stable',value:'old-stable'})];target.request!.body={...target.request!.body,mode:'raw',raw:'old-body'};store.saveTarget(project,target)
    const flow=createFlow(project,'冲突选择');flow.events=[createFlowEvent('request',{url:origin+'/hold'}),createFlowEvent('api',{target_id:target.target_id,input:{headers:{[header.toLowerCase()]:'step-header'},query:{stable:'step-stable'},body:'step-body'}})];store.saveFlow(project,flow)
    arrival=new Promise(r=>arrived=r);const run=service.startFlowRun(project,flow.flow_id,'',flow.flow_id);await arrival;service.pauseFlowRun(project,run.run_id);release();await until(project,run.run_id,'paused');return{target,flow,run}
  }
  try {
    const {target,flow,run}=await paused();target.request!.header.parameter[0].value='new-header';target.request!.body.raw='new-body';store.saveTarget(project,target)
    let preview=service.previewFlowRunRefresh(project,run.run_id),event=flow.events[1].event_id
    assert.deepEqual(preview.references[0].conflicts.map(c=>c.field),['headers.x-choice','body'])
    assert.throws(()=>service.applyFlowRunRefresh(project,run.run_id,preview.preview_id),/冲突/)
    preview=api.resolveFlowRunConflict(project,run.run_id,preview.preview_id,event,'headers.x-choice','api')
    assert(preview.blockers.some(b=>b.includes('冲突')),'body still unresolved')
    assert.equal(preview.references[0].effective_request.headers.find(h=>h.key.toLowerCase()==='x-choice')!.value,'new-header')
    preview=api.resolveFlowRunConflict(project,run.run_id,preview.preview_id,event,'body','override')
    assert.equal(preview.blockers.length,0);service.applyFlowRunRefresh(project,run.run_id,preview.preview_id)
    assert.throws(()=>api.resolveFlowRunConflict(project,run.run_id,preview.preview_id,event,'body','api'),/采用/)
    assert.equal(service.getFlowRun(project,run.run_id)!.status,'paused');assert.equal(hits.length,1)
    service.resumeFlowRun(project,run.run_id);const done=await until(project,run.run_id,'passed')
    assert.deepEqual(hits[1],{url:'/api?stable=step-stable',header:'new-header',body:'step-body'})
    assert.equal(done.version_switches![0].references[0].conflicts[0].resolution,'api')
    assert.deepEqual(store.getFlow(project,flow.flow_id)!.events[1].input,flow.events[1].input)
    arrival=new Promise(r=>arrived=r);const next=service.startFlowRun(project,flow.flow_id,'','next-run');await arrival;release();await until(project,next.run_id,'passed');assert.equal(hits.at(-1)!.header,'step-header')
    console.log('PASS per-field/body choices, effective request, explicit apply/resume, evidence and persistent Flow unchanged')
    const removed=await paused();removed.target.request!.header.parameter=[];removed.target.request!.body={...removed.target.request!.body,mode:'json',raw:'{"new":true}'};store.saveTarget(project,removed.target)
    let removal=service.previewFlowRunRefresh(project,removed.run.run_id);const removalEvent=removed.flow.events[1].event_id
    assert.equal(removal.references[0].conflicts[0].reason,'deleted');assert.equal(removal.references[0].conflicts[1].reason,'type_changed')
    assert.throws(()=>service.resumeFlowRun(project,removed.run.run_id),/冲突/)
    removal=api.resolveFlowRunConflict(project,removed.run.run_id,removal.preview_id,removalEvent,'headers.x-choice','api')
    removal=api.resolveFlowRunConflict(project,removed.run.run_id,removal.preview_id,removalEvent,'body','api')
    service.applyFlowRunRefresh(project,removed.run.run_id,removal.preview_id);service.resumeFlowRun(project,removed.run.run_id);await until(project,removed.run.run_id,'passed')
    assert.equal(hits.at(-1)!.header,undefined);assert.equal(hits.at(-1)!.body,'{"new":true}')
    const typed=await paused();typed.target.request!.header.parameter[0].field_type='integer';typed.target.request!.header.parameter[0].value='42';store.saveTarget(project,typed.target)
    let typedPreview=service.previewFlowRunRefresh(project,typed.run.run_id);assert.equal(typedPreview.references[0].conflicts[0].reason,'type_changed')
    assert.throws(()=>api.resolveFlowRunConflict(project,typed.run.run_id,'stale',typed.flow.events[1].event_id,'headers.x-choice','api'),/失效/)
    assert.throws(()=>api.resolveFlowRunConflict(project,typed.run.run_id,typedPreview.preview_id,typed.flow.events[1].event_id,'headers.x-choice','fake' as any),/无效/)
    typedPreview=api.resolveFlowRunConflict(project,typed.run.run_id,typedPreview.preview_id,typed.flow.events[1].event_id,'headers.x-choice','api')
    typed.target.url=origin+'/raced';store.saveTarget(project,typed.target)
    assert.throws(()=>service.applyFlowRunRefresh(project,typed.run.run_id,typedPreview.preview_id),/revision/)
    assert.throws(()=>service.resumeFlowRun(project,typed.run.run_id),/采用/);assert.equal(service.getFlowRun(project,typed.run.run_id)!.status,'paused')
    const expanded=await paused();expanded.target.request!.header.parameter[0].value='new';expanded.target.method='PUT';store.saveTarget(project,expanded.target)
    let expansion=service.previewFlowRunRefresh(project,expanded.run.run_id)
    expansion=api.resolveFlowRunConflict(project,expanded.run.run_id,expansion.preview_id,expanded.flow.events[1].event_id,'headers.x-choice','override')
    assert(expansion.blockers.every(b=>!b.includes('冲突')));assert(expansion.blockers.some(b=>b.includes('范围')))
    assert.throws(()=>service.applyFlowRunRefresh(project,expanded.run.run_id,expansion.preview_id),/范围/)
    assert.throws(()=>service.resumeFlowRun(project,expanded.run.run_id),/范围/)
    const deletion=await paused();deletion.target.request!.header.parameter[0].value='new';store.saveTarget(project,deletion.target)
    const deletionPreview=service.previewFlowRunRefresh(project,deletion.run.run_id);store.deleteTarget(project,deletion.target.target_id)
    assert.throws(()=>api.resolveFlowRunConflict(project,deletion.run.run_id,deletionPreview.preview_id,deletion.flow.events[1].event_id,'headers.x-choice','api'),/删除/)
    assert.equal(service.getFlowRun(project,deletion.run.run_id)!.status,'paused')
    console.log('PASS deletion/type changes require review; stale/invalid choices, concurrent updates, deleted APIs and scope blockers stay paused')
    const secret=await paused('Authorization');secret.target.request!.header.parameter[0].value='new-private-auth';store.saveTarget(project,secret.target)
    const secretPreview=service.previewFlowRunRefresh(project,secret.run.run_id)
    assert.equal(secretPreview.references[0].conflicts[0].old_value,'[REDACTED]')
    assert.equal(secretPreview.references[0].conflicts[0].new_value,'[REDACTED]')
    assert.equal(secretPreview.references[0].conflicts[0].override_value,'[REDACTED]')
    const secretChoice=api.resolveFlowRunConflict(project,secret.run.run_id,secretPreview.preview_id,secret.flow.events[1].event_id,'headers.authorization','api')
    assert(!JSON.stringify(secretChoice).includes('new-private-auth'))
    assert(!JSON.stringify(store.getFlowRun(project,secret.run.run_id)).includes('new-private-auth'))
    console.log('PASS conflict old/new/override credentials are redacted in UI/MCP/persistent evidence')


  } finally { for(const run of service.getActiveFlowRuns())await service.cancelFlowRun(project,run.run_id);release?.();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(dir,{recursive:true,force:true}) }
}
main().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)})
