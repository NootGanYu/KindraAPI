import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import * as store from '../src/main/storage/store'
import { runFlow } from '../src/main/flow/engine'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import { flowSignature } from '../src/shared/flowSync'
import { agentCommands as commands } from '../src/main/agent/service'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
async function main(): Promise<void> {
 app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-save-18-'))); await app.whenReady()
 const pid = store.ensureDefaultProject().project_id, flow = createFlow(pid, '原流程')
 flow.events = [createFlowEvent('begin')]; flow.events[0].children = [{ ...createFlowEvent('wait'), wait_ms: 0 }]; store.saveFlow(pid, flow)
 const run = await runFlow(pid, flow)
 const originalRun = store.getFlowRun(pid, run.run_id)
 const openedFlow = store.saveFlow(pid,createFlow(pid,'并发编辑器'))
 const opened = commands.getFlowDraft(pid,openedFlow.flow_id)
 store.saveFlow(pid,{...openedFlow,description:'外部新内容'})
 commands.syncFlowEditorDraft(pid,{...opened.flow,name:'旧页面人工修改'})
 assert.throws(()=>commands.saveFlowEditor(pid,commands.getFlowDraft(pid,openedFlow.flow_id).flow),/变化/,'the first editor read must retain its baseline before any keystroke')
 const projectRoot = path.join(store.getPaths().projectRoot, pid)
 const originalFiles = new Map((fs.readdirSync(projectRoot, { recursive: true }) as string[]).filter(name=>fs.statSync(path.join(projectRoot,name)).isFile()).map(name=>[name,fs.readFileSync(path.join(projectRoot,name),'utf8')]))
 execFileSync('git',['-C',projectRoot,'init'],{stdio:'pipe'}); execFileSync('git',['-C',projectRoot,'add','.'],{stdio:'pipe'})
 let save = false, saveOnly = false, patch: unknown = { name: '修改流程', description: '第一版说明', env_id: store.listEnvironments(pid)[0].env_id, events: [...flow.events, { ...createFlowEvent('script'), script: 'console.log(\"saved script\")' }] }
 const modelInputs: any[] = []
 const server = http.createServer(async (req,res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = decodeModelRequest(req, JSON.parse(raw), protocol); modelInputs.push(body)
  const calls = body.tools?.[0]?.function.name === 'kindra_capability_probe' ? [{ name:'kindra_capability_probe', args:{token:'kindra-probe'} }] : [
   ...(!saveOnly ? [{ name:'propose_flow_change', args:{ project_id:pid, flow_id:flow.flow_id, step_id:'edit', patch, depends_on:[] } }] : []),
   ...(save ? [{name:'save_flow',args:{project_id:pid,flow_id:flow.flow_id,step_id:'save',depends_on:[]}}] : [])
  ]
  respondModel(res,protocol,body.stream,body.tools ? {tool_calls:calls.map((c,i)=>({id:`c${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))} : {content:'按步骤结果处理完成'})
 }); await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 try {
  await commands.saveConnection({name:'Flow保存',base_url:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'save-flow',protocol}); await commands.testConnection()
  const input = {targetId:'',flowIds:[flow.flow_id],goal:'修改Flow'}
  const edit = await commands.proposeEditPlan(pid,input); await commands.approvePlan(pid,edit.plan_id)
  const untouched = commands.listFlowCandidates(pid)[0]
  assert.equal(store.getFlow(pid,flow.flow_id)!.name,'原流程')
  save=true
  const plan = await commands.proposeSavePlan(pid,input)
  assert.equal(plan.status,'pending'); assert.deepEqual(plan.steps[1].depends_on,['edit'])
  assert.equal((await commands.approvePlan(pid,plan.plan_id)).status,'completed')
  assert.equal(store.getFlow(pid,flow.flow_id)!.name,'修改流程')
  assert.equal(store.getFlow(pid,flow.flow_id)!.events.length,2)
  const candidate=commands.listFlowCandidates(pid).find(c=>c.plan_id===plan.plan_id)!
  assert.equal(candidate.saved_version!.version,2)
  assert.equal(commands.listFlowCandidates(pid).find(c=>c.candidate_id===untouched.candidate_id)!.status,'pending')
  assert.equal(commands.getFlowDraft(pid,flow.flow_id).agent_owned,false)
  assert.equal(commands.listFlowVersions(pid,flow.flow_id).length,2)
  assert.equal(commands.listFlowVersions(pid,flow.flow_id)[0].revision,flowSignature(store.getFlow(pid,flow.flow_id)!))
  const versions = commands.listFlowVersions(pid,flow.flow_id)
  const restored = commands.restoreFlowVersionDraft(pid,flow.flow_id,versions[1].version_id)
  assert.equal(restored.status,'applied'); assert.equal(commands.getFlowDraft(pid,flow.flow_id).flow.name,'原流程')
  assert.equal(store.getFlow(pid,flow.flow_id)!.name,'修改流程','history restore remains a draft until explicit save')
  assert.equal(commands.getFlowDraft(pid,flow.flow_id).flow.created_at,flow.created_at)
  assert.deepEqual(commands.getFlowDraft(pid,flow.flow_id).flow.events,flow.events)
  assert.equal(commands.getFlowDraft(pid,flow.flow_id).flow.env_id,'')
  commands.rejectFlowCandidate(pid,untouched.candidate_id)
  const resumed = commands.restoreFlowCandidate(pid,untouched.candidate_id)
  assert.equal(resumed.status,'applied'); assert.equal(commands.getFlowDraft(pid,flow.flow_id).flow.name,'修改流程')
  assert.deepEqual(store.getFlowRun(pid,run.run_id),originalRun,'restoring definition must preserve run history')
  assert.equal(store.saveFlowChecked(pid,commands.getFlowDraft(pid,flow.flow_id).flow,'stale').status,'conflict')
  const currentBefore = commands.getFlowDraft(pid,flow.flow_id)
  const stalePlan = await commands.proposeSavePlan(pid,input)
  store.saveFlow(pid,{...store.getFlow(pid,flow.flow_id)!,description:'外部并发说明'})
  assert.equal((await commands.approvePlan(pid,stalePlan.plan_id)).status,'paused')
  assert.equal(store.getFlow(pid,flow.flow_id)!.description,'外部并发说明')
  assert.throws(()=>commands.saveFlowEditor(pid,currentBefore.flow),/变化/)
  commands.reloadFlowDraft(pid,flow.flow_id,flowSignature(commands.getFlowDraft(pid,flow.flow_id).flow))
  const manual = structuredClone(commands.getFlowDraft(pid,flow.flow_id).flow); manual.name='新人工名称'; commands.syncFlowEditorDraft(pid,manual)
  const conflict = commands.restoreFlowVersionDraft(pid,flow.flow_id,versions[1].version_id)
  assert.equal(conflict.status,'conflict'); assert(conflict.merge!.conflicts.some(c=>c.path==='/name'))
  assert.throws(()=>commands.saveFlowEditor(pid,commands.getFlowDraft(pid,flow.flow_id).flow),/冲突/)
  saveOnly = true
  const blockedSave = await commands.proposeSavePlan(pid,input)
  assert.equal((await commands.approvePlan(pid,blockedSave.plan_id)).status,'paused','a separate approved save cannot bypass another unresolved conflict')
  saveOnly = false
  const resolved = commands.resolveFlowCandidate(pid,conflict.candidate_id,conflict.merge!.review_id,Object.fromEntries(conflict.merge!.conflicts.map(c=>[c.id,'agent' as const])))
  assert.equal(resolved.status,'applied')
  const savedAgain = commands.saveFlowEditor(pid,commands.getFlowDraft(pid,flow.flow_id).flow)
  assert(commands.listFlowCandidates(pid).find(c=>c.candidate_id===conflict.candidate_id)!.saved_version, 'manual Save also links the applied candidate')
  assert.equal(savedAgain.name,'原流程'); assert.equal(savedAgain.description,''); assert.deepEqual(savedAgain.events,flow.events)
  const unchangedVersionCount = commands.listFlowVersions(pid,flow.flow_id).length
  commands.saveFlowEditor(pid,savedAgain); assert.equal(commands.listFlowVersions(pid,flow.flow_id).length,unchangedVersionCount,'timestamp-only save must not create a version')
  assert.deepEqual(store.getFlowRun(pid,run.run_id),originalRun)
  for (const name of fs.readdirSync(projectRoot,{recursive:true}) as string[]) if (!name.startsWith('.git/') && fs.statSync(path.join(projectRoot,name)).isFile()) {
    assert(originalFiles.has(name),`history must stay local: ${name}`)
    if (name !== `executions/flows/${flow.flow_id}.json`) assert.equal(fs.readFileSync(path.join(projectRoot,name),'utf8'),originalFiles.get(name))
  }
  save = false; patch = { description:'先采纳再单独保存' }
  const stagePlan = await commands.proposeEditPlan(pid,input); await commands.approvePlan(pid,stagePlan.plan_id)
  const staged = commands.listFlowCandidates(pid).find(c=>c.plan_id===stagePlan.plan_id)!; commands.applyFlowCandidate(pid,staged.candidate_id)
  save = true; saveOnly = true
  const saveOnlyPlan = await commands.proposeSavePlan(pid,input); assert.equal((await commands.approvePlan(pid,saveOnlyPlan.plan_id)).status,'completed')
  assert(commands.listFlowCandidates(pid).find(c=>c.candidate_id===staged.candidate_id)!.saved_version)
  assert.deepEqual(execFileSync('git',['-C',projectRoot,'diff','--name-only'],{encoding:'utf8'}).trim().split('\n'),[`executions/flows/${flow.flow_id}.json`])
  assert.equal(execFileSync('git',['-C',projectRoot,'ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim(),'','versions/candidates/review links must never enter project Git')
  const saveOutputs = modelInputs.flatMap(body => body.messages ?? []).filter(message => message.role === 'tool').map(message => JSON.parse(message.content)).filter(value=>value.saved_version)
  assert(saveOutputs.length)
  assert(saveOutputs.every(value=>value.saved_version.revision === undefined),'Flow content signatures must not leak full definitions through model save results')
  console.log(protocol,'PASS standalone save_flow adopts only its candidate and links v2 without second approval')
 } finally {server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r()))}
}
main().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)})
