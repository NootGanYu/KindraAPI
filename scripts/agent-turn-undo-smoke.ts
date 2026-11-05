import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { runFlow } from '../src/main/flow/engine'
import * as store from '../src/main/storage/store'
import { createFlow } from '../src/shared/factories'
import { agentCommands as commands } from '../src/main/agent/service'
async function main(): Promise<void> {
 if (process.argv[2]==='--restart') {
  app.setPath('userData',process.argv[3]);await app.whenReady()
  const [pid,id,mode]=process.argv.slice(4)
  if (mode==='conflict') { const r=commands.listTurnUndos(pid).find(r=>r.undo_id===id)!; assert.equal(r.entries.some(e=>e.status==='conflict'),true);assert.equal(r.status,'review') }
  else { assert.deepEqual(commands.listTurnUndos(pid),[]);assert.deepEqual(commands.listCandidates(pid),[]);assert.deepEqual(commands.listFlowCandidates(pid),[]);assert.deepEqual(commands.listConversations(pid),[]) }
  console.log('PASS fresh Electron process restart '+mode);return
 }
 app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-turn-22-'))); await app.whenReady()
 const pid = store.ensureDefaultProject().project_id
 const api = store.createTargetInProject(pid,'0','api'); api.description = '原说明'; api.cases = [{case_id:'case-one',name:'原用例',is_enabled:1, override:{},assertions:[]}]; store.saveTarget(pid,api)
 const flow = createFlow(pid,'原流程'); store.saveFlow(pid,flow)
 const manualFlow=createFlow(pid,'纯人工流程');store.saveFlow(pid,manualFlow);commands.syncFlowEditorDraft(pid,{...manualFlow,description:'人工未保存'});
 const manualApi=store.createTargetInProject(pid,'0','api');commands.syncEditorDraft(pid,{...manualApi,description:'人工未保存'});
 const run=await runFlow(pid,{...flow,events:[]}),originalRun=store.getFlowRun(pid,run.run_id)
 const projectRoot=store.resolveProjectDir(pid);execFileSync('git',['-C',projectRoot,'init'],{stdio:'pipe'});execFileSync('git',['-C',projectRoot,'add','.'],{stdio:'pipe'})
  const runtime=store.getTarget(pid,api.target_id)!;runtime.cases![0].last_run={ran_at:'2026-11-04T00:00:00Z',status:'passed',http_status:200};store.saveTarget(pid,runtime)
 const initialStatus=execFileSync('git',['-C',projectRoot,'status','--porcelain'],{encoding:'utf8'})
 let double=false, creating=false
 const server = http.createServer(async(req,res)=>{
  let raw=''; for await (const c of req) raw+=c
  const body=JSON.parse(raw), probe=body.tools?.[0]?.function.name==='kindra_capability_probe'
  const calls=probe?[{name:'kindra_capability_probe',args:{token:'kindra-probe'}}]:[
   {name:'propose_api_change',args:{project_id:pid,target_id:api.target_id,patch:{description:'Agent 说明',custom_attributes:{owner:'Agent'},cases:[{...api.cases![0],name:'Agent 用例'}]},step_id:'api',depends_on:[]}},
   {name:'propose_flow_change',args:{project_id:pid,flow_id:flow.flow_id,patch:{description:'Agent 流程'},step_id:'flow',depends_on:[]}}]
  if(creating&&!probe) {const request=JSON.parse(body.messages?.find((m:any)=>m.role==='user'&&m.content.startsWith('{'))?.content??'{}');calls.splice(0,calls.length,{name:'create_api',args:{project_id:pid,target_id:request.target_id,patch:{name:'新建的接口',description:'新建说明'},step_id:'new',depends_on:[]}} as any)}
  if(double&&!probe) calls.push({name:'propose_api_change',args:{project_id:pid,target_id:api.target_id,patch:{description:'第二候选说明'},step_id:'second',depends_on:[]}} as any)
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:body.tools?{tool_calls:calls.map((c,i)=>({id:`c${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:'完成'}}]}))
 }); await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 try {
  await commands.saveConnection({name:'整轮',base_url:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'turn',protocol:'chat-completions'});await commands.testConnection()
  const plan=await commands.proposeEditPlan(pid,{goal:'整轮修改',targetId:api.target_id,flowIds:[flow.flow_id]});assert.equal(plan.status,"pending",JSON.stringify(plan));await commands.approvePlan(pid,plan.plan_id)
  commands.applyCandidate(pid,commands.listCandidates(pid)[0].candidate_id);commands.applyFlowCandidate(pid,commands.listFlowCandidates(pid)[0].candidate_id)
  const manual=commands.getDraft(pid,api.target_id).target;manual.name='人工名称';commands.syncEditorDraft(pid,manual)
  const preview=commands.previewTurnUndo(pid,plan.plan_id)
  assert.equal(preview.entries.length,2);assert.equal(commands.getDraft(pid,api.target_id).target.description,'Agent 说明')
  const done=commands.applyTurnUndo(pid,preview.undo_id,preview.review_id,{})
  assert.equal(done.status,'completed'); const restored=commands.getDraft(pid,api.target_id).target
  assert.equal(restored.description,'原说明');assert.equal(restored.cases![0].name,'原用例');assert.equal(restored.name,'人工名称');assert.equal(restored.custom_attributes,undefined);assert.equal(restored.cases![0].last_run?.http_status,200)
  assert.equal(commands.getFlowDraft(pid,flow.flow_id).flow.description,flow.description)
  assert.equal(store.getTarget(pid,api.target_id)!.description,'原说明'); assert.equal(commands.listCandidates(pid)[0].status,'undone')
  console.log('PASS mixed API, Case and Flow undo preserves unrelated manual fields and formal definitions')
  commands.restoreCandidate(pid,commands.listCandidates(pid)[0].candidate_id);commands.restoreFlowCandidate(pid,commands.listFlowCandidates(pid)[0].candidate_id)
  const human=commands.getDraft(pid,api.target_id).target;human.description='人工后续说明';commands.syncEditorDraft(pid,human)
  const conflicting=commands.previewTurnUndo(pid,plan.plan_id)
  assert.throws(()=>store.saveTarget(pid,commands.getDraft(pid,api.target_id).target),/撤销冲突/)
  commands.cancelTurnUndo(pid,conflicting.undo_id);assert.equal(commands.listTurnUndos(pid).find(r=>r.undo_id===conflicting.undo_id)!.status,'cancelled')
  assert.equal(commands.getDraft(pid,api.target_id).target.description,'人工后续说明')
  const refreshed=commands.previewTurnUndo(pid,plan.plan_id);Object.assign(conflicting,refreshed)
  const conflictEntry=conflicting.entries.find(e=>e.kind==='api')!;assert.equal(conflictEntry.conflicts[0].path,'/description')
  assert.equal(commands.getDraft(pid,api.target_id).target.description,'人工后续说明')
  execFileSync(process.execPath,[__filename,'--restart',app.getPath('userData'),pid,conflicting.undo_id,'conflict'],{stdio:'inherit'})
  const again=commands.getDraft(pid,api.target_id).target;again.name='审阅中人工名称';commands.syncEditorDraft(pid,again)
  const stale=commands.applyTurnUndo(pid,conflicting.undo_id,conflicting.review_id,{[conflictEntry.key]:Object.fromEntries(conflictEntry.conflicts.map(c=>[c.id,'agent' as const]))})
  assert.equal(stale.status,'partial');assert.equal(stale.entries.find(e=>e.kind==='flow')!.status,'completed')
  assert.equal(commands.getDraft(pid,api.target_id).target.description,'人工后续说明')
  const currentEntry=stale.entries.find(e=>e.kind==='api')!
  const resolved=commands.applyTurnUndo(pid,stale.undo_id,stale.review_id,{[currentEntry.key]:Object.fromEntries(currentEntry.conflicts.map(c=>[c.id,'current' as const]))})
  assert.equal(resolved.status,'completed');assert.equal(commands.getDraft(pid,api.target_id).target.name,'审阅中人工名称')
  assert.equal(commands.getDraft(pid,api.target_id).target.description,'人工后续说明')
  assert.equal(commands.listTurnUndos(pid).find(r=>r.undo_id===resolved.undo_id)!.status,'completed')
  console.log('PASS stale conflict choices never overwrite manual edits; independent object completes with durable partial audit')
  double=true
  const multi=await commands.proposeEditPlan(pid,{goal:'同一对象多个候选',targetId:api.target_id,flowIds:[flow.flow_id]});await commands.approvePlan(pid,multi.plan_id)
  const multiple=commands.listCandidates(pid).filter(c=>c.plan_id===multi.plan_id)
  const beforeMultiple=commands.getDraft(pid,api.target_id).target.description
  for(const c of multiple) { const applied=commands.applyCandidate(pid,c.candidate_id);if(applied.status==='conflict') commands.resolveCandidate(pid,c.candidate_id,applied.merge!.review_id,Object.fromEntries(applied.merge!.conflicts.map(c=>[c.id,'agent' as const]))) }
  assert.equal(commands.getDraft(pid,api.target_id).target.description,'Agent 说明')
  const multipleReview=commands.previewTurnUndo(pid,multi.plan_id);assert.equal(multipleReview.entries[0].conflicts.length,0)
  assert.equal(commands.applyTurnUndo(pid,multipleReview.undo_id,multipleReview.review_id,{}).status,'completed')
  assert.equal(commands.getDraft(pid,api.target_id).target.description,beforeMultiple)
  assert.equal(commands.listFlowCandidates(pid).find(c=>c.plan_id===multi.plan_id)!.status,'rejected')
  console.log('PASS multiple candidates undo in actual application order, independent of proposal numbering')
  assert.equal(execFileSync('git',['-C',projectRoot,'status','--porcelain'],{encoding:'utf8'}),initialStatus)
  assert.deepEqual(store.getFlowRun(pid,run.run_id),originalRun)
  double=false;creating=true
  const created=await commands.proposeCreateApiPlan(pid,{goal:'新建草稿'});assert.equal(created.status,'pending',created.error);await commands.approvePlan(pid,created.plan_id)
  const newCandidate=commands.listCandidates(pid).find(c=>c.plan_id===created.plan_id)!
  const newReview=commands.previewTurnUndo(pid,created.plan_id);assert.equal(newReview.entries[0].new_object,true)
  assert.equal(commands.applyTurnUndo(pid,newReview.undo_id,newReview.review_id,{}).status,'completed')
  assert.equal(store.getTarget(pid,created.target_id),null);assert.equal(commands.getDraft(pid,created.target_id).target.name,newCandidate.application!.before.name)
  assert.equal(commands.getDraft(pid,created.target_id).target.target_id,created.target_id)
  creating=false
  console.log('PASS new object undo preserves identity and local draft without formal creation')
  commands.restoreCandidate(pid,commands.listCandidates(pid).find(c=>c.plan_id===plan.plan_id)!.candidate_id)
  commands.restoreFlowCandidate(pid,commands.listFlowCandidates(pid).find(c=>c.plan_id===plan.plan_id)!.candidate_id)
  store.deleteTarget(pid,api.target_id);store.deleteFlow(pid,flow.flow_id)
  const deleted=commands.previewTurnUndo(pid,plan.plan_id)
  assert.equal(deleted.entries.filter(e=>e.deletion_id).length,2)
  const deletedDone=commands.applyTurnUndo(pid,deleted.undo_id,deleted.review_id,{})
  assert.equal(deletedDone.status,'completed',JSON.stringify(deletedDone.entries.map(e=>e.error)))
  assert.equal(store.getTarget(pid,api.target_id),null);assert.equal(store.getFlow(pid,flow.flow_id),null)
  assert.equal(commands.getDraft(pid,api.target_id).target.target_id,api.target_id);assert.equal(commands.getFlowDraft(pid,flow.flow_id).flow.flow_id,flow.flow_id)
  assert.deepEqual(store.getFlowRun(pid,run.run_id),originalRun)
  console.log('PASS deleted mixed objects undo into recovery drafts while retaining identities, tombstones and manual reports')
  // Explicitly recreate formal definitions to verify cleanup preserves them.
  store.saveTarget(pid,api);store.saveFlow(pid,flow)
  const conversation=commands.createConversation(pid)
  const retained=store.getTarget(pid,api.target_id)!,retainedFlow=store.getFlow(pid,flow.flow_id)!
  const generating=commands.proposeEditPlan(pid,{goal:'活动任务保护',targetId:api.target_id,flowIds:[flow.flow_id]})
  assert.throws(()=>commands.deleteProjectAgentRecords(pid),/活动会话/)
  const pendingPlan=await generating;assert.throws(()=>commands.deleteProjectAgentRecords(pid),/活动会话/);commands.rejectPlan(pid,pendingPlan.plan_id)
  commands.deleteProjectAgentRecords(pid)
  assert.deepEqual(commands.listCandidates(pid),[]);assert.deepEqual(commands.listFlowCandidates(pid),[])
  assert.deepEqual(commands.listTurnUndos(pid),[]);assert.deepEqual(commands.listConversations(pid),[])
  assert.deepEqual(commands.getDraft(pid,api.target_id).target,retained)
  assert.equal(commands.getDraft(pid,manualApi.target_id).target.description,'人工未保存');assert.equal(commands.getFlowDraft(pid,manualFlow.flow_id).flow.description,'人工未保存');
  assert.deepEqual(store.getFlowRun(pid,run.run_id),originalRun);assert.equal(commands.getDeletedObject(pid,'api',api.target_id),null);assert.equal(commands.getDeletedObject(pid,'flow',flow.flow_id),null);
  execFileSync(process.execPath,[__filename,'--restart',app.getPath('userData'),pid,'none','deleted'],{stdio:'inherit'});
  assert.equal(commands.getConnection()!.name,'整轮');assert.deepEqual(store.getFlow(pid,flow.flow_id),retainedFlow)
  assert.throws(()=>commands.getConversation(pid,conversation.conversation_id),/不存在/)
  commands.stashAgentDrafts();commands.stashAgentFlowDrafts();assert.deepEqual(commands.listCandidates(pid),[])
  console.log('PASS deleting project Agent records removes mirrors and stash history while preserving definitions and connections')
 } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
}
main().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)})
