import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as store from '../src/main/storage/store'
import { createFlow, createFlowEvent, createTarget } from '../src/shared/factories'
import { callTool } from '../src/main/mcp/tools'
import { startFlowRun } from '../src/main/flow/service'
import { registerIpc } from '../src/main/ipc'
import type { FlowRun, Result } from '../src/shared/types'

async function until(read: () => Promise<FlowRun>, status: string): Promise<FlowRun> {
  const deadline = Date.now() + 5000
  for (;;) {
    const run = await read()
    if (run.status === status) return run
    assert(Date.now() < deadline, `expected ${status}, got ${run.status}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
async function main(): Promise<void> {
  const dir = process.env.CANCEL_RESTART_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-cancel-'))
  app.setPath('userData', dir)
  await app.whenReady()
  if (process.env.CANCEL_RESTART_DIR) {
    const result = await callTool('get_flow_run', { project_id: process.env.CANCEL_PROJECT!, run_id: process.env.CANCEL_RUN! }, { ...store.getMcpConfig(), enabled: true, allowed_project_ids: [process.env.CANCEL_PROJECT!] })
    assert(result.ok)
    const run = result.result as FlowRun
    assert.equal(run.status, 'cancelled')
    assert.equal(run.remote_outcome, 'unknown')
    assert.equal(run.events[0].status, 'cancelled')
    return
  }
  const hits: string[] = []
  let arrived!: () => void
  let arrival = new Promise<void>(resolve => { arrived = resolve })
  let release: (() => void) | undefined
  let closed!: () => void
  let close = new Promise<void>(resolve => { closed = resolve })
  const server = http.createServer((req, res) => {
    hits.push(req.url!)
    if (req.url === '/hold') { release = () => res.end('{}'); res.on('close', () => closed()); arrived() }
    else res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  let window: BrowserWindow | undefined
  try {
    const projectId = store.ensureDefaultProject().project_id
    const config = { ...store.getMcpConfig(), enabled: true, allow_execute: true, allowed_project_ids: [projectId] }
    registerIpc()
    window = new BrowserWindow({ show:false, webPreferences:{nodeIntegration:true,contextIsolation:false} })
    await window.loadURL('about:blank')
    const invoke = <T>(channel:string,...args:unknown[]):Promise<Result<T>> => window!.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`)
    const flow = createFlow(projectId, '取消等待')
    flow.events = [createFlowEvent('script',{script:'console.log("completed")'}),createFlowEvent('wait',{wait_ms:60000}),createFlowEvent('request',{url:`${origin}/never`})]
    store.saveFlow(projectId,flow)
    const started = await invoke<FlowRun>('flow:run:start',projectId,flow.flow_id,'','cancel-wait')
    assert(started.ok)
    const runId = started.data.run_id
    const read = async () => { const r=await invoke<FlowRun>('flow:run:get',projectId,runId);assert(r.ok);return r.data }
    const before=Date.now()
    const cancelled=await callTool('cancel_flow_run',{project_id:projectId,run_id:runId},config)
    assert(cancelled.ok,cancelled.ok ? '' : cancelled.error)
    const final=await until(read,'cancelled')
    assert(Date.now()-before<1500,'cancel must not wait for 60s wait event')
    assert.equal(final.remote_outcome,undefined)
    assert.equal(final.events[0].status,'passed')
    assert.equal(final.events[1].status,'cancelled')
    assert.deepEqual(hits,[])
    assert.equal((await callTool('cancel_flow_run',{project_id:projectId,run_id:runId},config)).ok,true)
    assert.equal(store.getFlowRun(projectId,runId)?.status,'cancelled')
    console.log('PASS bounded wait cancellation preserves completed work and is idempotent')

    const network = createFlow(projectId, '取消在途请求')
    network.events = [createFlowEvent('request',{url:`${origin}/hold`}),createFlowEvent('request',{url:`${origin}/after-cancel`})]
    store.saveFlow(projectId,network)
    const netStart=await callTool('start_flow_run',{project_id:projectId,flow_id:network.flow_id,request_id:'network'},config)
    assert(netStart.ok)
    const networkId=(netStart.result as FlowRun).run_id
    await arrival
    assert(!(await callTool('cancel_flow_run',{project_id:projectId,run_id:networkId},{...config,allow_execute:false})).ok)
    const cancelling=callTool('cancel_flow_run',{project_id:projectId,run_id:networkId},config)
    assert.throws(()=>startFlowRun(projectId,network.flow_id,'','overlap'),/活动运行/,'lock remains while old engine drains')
    const cancelResult=await cancelling
    assert(cancelResult.ok)
    const networkRead=async()=>{const r=await invoke<FlowRun>('flow:run:get',projectId,networkId);assert(r.ok);return r.data}
    const networkFinal=await until(networkRead,'cancelled')
    assert.equal(networkFinal.remote_outcome,'unknown')
    assert.match(networkFinal.error!,/远端结果未知/)
    assert.equal(networkFinal.request_in_flight,false)
    await Promise.race([close,new Promise((_,reject)=>setTimeout(()=>reject(new Error('HTTP connection still active')),1000))])
    const stable=JSON.stringify(await networkRead())
    release!()
    assert.deepEqual(hits,['/hold'])
    const saved=store.getFlow(projectId,network.flow_id)!
    saved.events=[createFlowEvent('request',{url:`${origin}/replacement`})]
    store.saveFlow(projectId,saved,saved.revision)
    const next=await invoke<FlowRun>('flow:run:start',projectId,network.flow_id,'','replacement')
    assert(next.ok,'lock releases after cancellation isolates in-flight work')
    await until(async()=>{const r=await invoke<FlowRun>('flow:run:get',projectId,next.data.run_id);assert(r.ok);return r.data},'passed')
    assert.deepEqual(hits,['/hold','/replacement'])
    assert.equal(JSON.stringify(await networkRead()),stable,'late response cannot rewrite cancelled evidence')
    const original=await callTool('start_flow_run',{project_id:projectId,flow_id:network.flow_id,request_id:'network'},config)
    assert(original.ok && (original.result as FlowRun).run_id === networkId)
    assert.equal(store.getFlowRun(projectId,networkId)?.remote_outcome,'unknown')
    console.log('PASS in-flight cancellation isolates HTTP, retains lock until stopped and records unknown without replay')

    const paused = createFlow(projectId,'取消暂停')
    paused.events=[createFlowEvent('request',{url:`${origin}/hold`}),createFlowEvent('request',{url:`${origin}/after-paused`})]
    store.saveFlow(projectId,paused)
    arrival=new Promise<void>(resolve=>{arrived=resolve})
    const pauseStart=await invoke<FlowRun>('flow:run:start',projectId,paused.flow_id,'','paused-cancel')
    assert(pauseStart.ok)
    const pauseId=pauseStart.data.run_id
    await arrival
    assert((await invoke<FlowRun>('flow:run:pause',projectId,pauseId)).ok)
    release!()
    const pausedRead=async()=>{const r=await invoke<FlowRun>('flow:run:get',projectId,pauseId);assert(r.ok);return r.data}
    await until(pausedRead,'paused')
    store.saveMcpConfig({...config,enabled:false,allow_execute:false})
    assert(!(await callTool('cancel_flow_run',{project_id:projectId,run_id:pauseId},store.getMcpConfig())).ok)
    const uiCancel=await invoke<FlowRun>('flow:run:cancel',projectId,pauseId)
    assert(uiCancel.ok && uiCancel.data.status==='cancelled')
    assert.equal(uiCancel.data.remote_outcome,undefined,'completed request is known despite cancellation while paused')
    assert.equal(uiCancel.data.events[0].status,'passed')
    assert((await invoke<FlowRun>('flow:run:resume',projectId,pauseId)).ok)
    assert(!hits.includes('/after-paused'))
    assert(!(await invoke<FlowRun>('flow:run:cancel','other-project',pauseId)).ok)
    console.log('PASS paused cancellation is independent of MCP policy and cannot resume completed work')

    const api=createTarget(projectId,'api')
    api.url=`${origin}/never-prescript`
    api.request.pre_script='setTimeout(() => console.log("late-pre-script"), 10000)'
    store.saveTarget(projectId,api)
    const preFlow=createFlow(projectId,'取消未发送请求')
    preFlow.events=[createFlowEvent('api',{target_id:api.target_id})]
    store.saveFlow(projectId,preFlow)
    const pre=await invoke<FlowRun>('flow:run:start',projectId,preFlow.flow_id,'','cancel-pre')
    assert(pre.ok)
    const preCancel=await invoke<FlowRun>('flow:run:cancel',projectId,pre.data.run_id)
    assert(preCancel.ok && preCancel.data.status==='cancelled')
    assert.equal(preCancel.data.remote_outcome,undefined)
    assert(!hits.includes('/never-prescript'))
    console.log('PASS cancellation before dispatch is known and prevents async pre-script from sending later')
    const nested=createFlow(projectId,'取消嵌套循环')
    nested.events=[createFlowEvent('loop',{loop_count:3,children:[createFlowEvent('loop',{loop_count:2,children:[createFlowEvent('wait',{wait_ms:60000}),createFlowEvent('request',{url:`${origin}/nested-never`})]})]})]
    store.saveFlow(projectId,nested)
    const nestedStart=await invoke<FlowRun>('flow:run:start',projectId,nested.flow_id,'','nested-cancel')
    assert(nestedStart.ok)
    const nestedCancel=await invoke<FlowRun>('flow:run:cancel',projectId,nestedStart.data.run_id)
    assert(nestedCancel.ok && nestedCancel.data.status==='cancelled')
    assert.equal(nestedCancel.data.events[0].status,'cancelled')
    assert.equal(nestedCancel.data.events[0].children?.[0].children?.[0].status,'cancelled')
    assert(!hits.includes('/nested-never'))
    console.log('PASS nested loop cancellation unwinds stack without dispatching future iterations')
    const beforeRestart=hits.length
    execFileSync(process.execPath,[process.argv[1]],{env:{...process.env,CANCEL_RESTART_DIR:dir,CANCEL_PROJECT:projectId,CANCEL_RUN:networkId},timeout:10000,stdio:'pipe'})
    assert.equal(hits.length,beforeRestart)
    console.log('PASS fresh process preserves cancelled unknown result without replay')


  } finally {
    window?.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true})
  }
}
main().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
