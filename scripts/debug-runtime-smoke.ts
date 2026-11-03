/** 调试请求执行闭环：只使用隔离数据与回环服务器。 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { createEnvironment, createParam, createTarget } from '../src/shared/factories'
import { sendRequest } from '../src/main/request/executor'

async function main(): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-debug-runtime-'))
  app.setPath('userData', userData)
  await app.whenReady()
  let hits = 0
  let cancelledSocket = false
  const server = http.createServer(async (req, res) => {
    hits++
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    if (req.url === '/encoding') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=gbk' })
      res.end(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))
      return
    }
    if (req.url === '/delay') {
      const timer = setTimeout(() => res.end('late'), 8000)
      res.on('close', () => { cancelledSocket = true; clearTimeout(timer) })
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'fixture=yes; Path=/' })
    res.end(JSON.stringify({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const project = store.ensureDefaultProject()
  const target = createTarget(project.project_id, '0', 'api', '调试闭环')
  target.url = `${base}/echo`
  const req = target.request!
  try {
    req.pre_script = 'pm.request.headers.add({key:"X-Script",value:"before"}); console.log("before-script");'
    req.test = 'console.log("after-script"); pm.test("响应与预执行变量",()=>{pm.expect(pm.response.json().headers["x-script"]).to.eql("before");});'
    const scripted = await sendRequest(project.project_id, target)
    assert.equal(scripted.status, 'passed', JSON.stringify(scripted.error))
    assert.equal(scripted.assertions.length, 1)
    assert(scripted.assertions[0].passed)
    assert(scripted.console.some(entry => entry.args.includes('before-script')))
    assert(scripted.console.some(entry => entry.args.includes('after-script')))
    assert.equal(Object.entries(scripted.request.headers).find(([key]) => key.toLowerCase() === 'x-script')?.[1], 'before')
    req.test = 'pm.test("失败断言",()=>pm.expect(1).to.eql(2));'
    const failed = await sendRequest(project.project_id, target)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.assertions[0].passed, false)
    assert.equal(failed.response?.code, 200, '断言失败仍保留真实响应')
    req.pre_script = 'throw new Error("before-broken")'
    const count = hits
    const broken = await sendRequest(project.project_id, target)
    assert.equal(broken.status, 'failed')
    assert.match(broken.error?.message ?? '', /before-broken/)
    assert.equal(hits, count, '预执行出错不应继续发送')
    console.log('PASS 前后脚本、console、断言和预执行异常')

    req.pre_script = ''; req.test = ''
    req.header.parameter = [createParam({ key: 'Content-Type', value: 'application/json', is_checked: -1, is_system: -1 })]
    req.body = { ...req.body, mode: 'json', raw: '{"ok":true}' }
    target.method = 'POST'
    const unchecked = await sendRequest(project.project_id, target)
    assert.equal(JSON.parse(unchecked.response!.body).headers['content-type'], undefined)
    assert.equal(JSON.parse(unchecked.response!.body).body, '{"ok":true}')
    console.log('PASS 取消 Content-Type 后不会由运行器重新添加')

    const env = createEnvironment(project.project_id)
    env.env_var_list = { user_id: { initial_value: 'user42', current_value: 'user42', is_checked: 1 } }
    store.saveEnvironment(project.project_id, env)
    target.url = `${base}/users/{id}?tag=old&disabled=old`
    req.restful.parameter = [createParam({ key: 'id', value: '{{user_id}}' })]
    req.query.parameter = [createParam({ key: 'tag', value: 'a' }), createParam({ key: 'tag', value: 'b' }), createParam({ key: 'disabled', value: 'old', is_checked: -1 })]
    const query = await sendRequest(project.project_id, target, env.env_id)
    assert.equal(JSON.parse(query.response!.body).url, '/users/user42?tag=a&tag=b')
    console.log('PASS Path 环境变量、重复 Query、取消 Query')

    target.url = `${base}/delay`; req.query.parameter = []
    const controller = new AbortController()
    const pending = sendRequest(project.project_id, target, undefined, { signal: controller.signal })
    await new Promise(resolve => setTimeout(resolve, 150))
    const start = Date.now()
    controller.abort()
    const cancelled = await pending
    assert.equal(cancelled.error?.type, 'cancelled')
    assert(Date.now() - start < 1000, '取消不能等待网络超时')
    await new Promise(resolve => setTimeout(resolve, 100))
    assert(cancelledSocket, '取消必须关闭实际连接')
    req.pre_script = 'setTimeout(()=>console.log("late"),5000)'
    const beforeScript = hits
    const scriptAbort = new AbortController()
    const pendingScript = sendRequest(project.project_id, target, undefined, { signal: scriptAbort.signal })
    await new Promise(resolve => setTimeout(resolve, 100))
    scriptAbort.abort()
    assert.equal((await pendingScript).error?.type, 'cancelled')
    assert.equal(hits, beforeScript, '取消预执行时不能发送请求')
    req.pre_script = ''; target.url = `${base}/echo`
    assert.equal((await sendRequest(project.project_id, target)).status, 'passed', '取消不影响下一次运行')
    console.log('PASS 取消网络和预执行脚本、再次发送')

    req.pre_script = 'apt.setRequestHeader("X-Apt", "ready"); apt.environment.set("script_token", "local"); apt.globals.set("script_global", "shared");'
    req.test = 'apt.test("Apipost助手",()=>{apt.response.to.have.status(200);apt.expect(apt.response.json().headers["x-apt"]).to.eql("ready")});'
    const apt = await sendRequest(project.project_id, target, env.env_id)
    assert.equal(apt.status, 'passed', JSON.stringify(apt.error))
    assert.equal(store.listEnvironments(project.project_id).find(item => item.env_id === env.env_id)?.env_var_list.script_token.current_value, 'local')
    assert.equal(store.getGlobalVars(project.project_id).vars.script_global.current_value, 'shared')
    req.pre_script_enabled = false; req.test_enabled = false
    const disabled = await sendRequest(project.project_id, target, env.env_id)
    assert.equal(JSON.parse(disabled.response!.body).headers['x-apt'], undefined)
    assert.equal(disabled.assertions.length, 0)
    console.log('PASS apt 常用 API、变量持久化、脚本启停')
    target.url = `${base}/encoding`
    const encoded = await sendRequest(project.project_id, target)
    assert.equal(encoded.response?.body, '你好')
    assert.equal(encoded.response?.charset, 'gbk')
    assert.deepEqual(Buffer.from(encoded.response?.body_base64 ?? '', 'base64'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))
    console.log('PASS 响应编码与原始下载字节')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(userData, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
