/** Renderer application-command seam with a real loopback Responses endpoint. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as storage from '../src/main/storage/store'
import { agentCommands, onAgentEvent } from '../src/main/agent/service'

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-responses-')))
  await app.whenReady()
  const key = 'responses-fixture-secret'
  const received: any[] = []
  const output = (text: string) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] })
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); received.push(body)
    assert.equal(req.url, '/v1/responses')
    assert.equal(req.headers.authorization, `Bearer ${key}`)
    assert.equal(body.store, false)
    assert(Array.isArray(body.input))
    assert.equal(body.messages, undefined)
    if (body.model === 'http-error') { res.writeHead(401); res.end(key); return }
    if (body.tools) { res.writeHead(400); res.end('text only'); return }
    if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(output('OK'))); return }
    res.setHeader('Content-Type', 'text/event-stream')
    if (['failed', 'incomplete', 'broken-json', 'closed', 'cancel'].includes(body.model)) {
      res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '部分回复' })}\n\n`)
      if (body.model === 'failed') res.end(`data: ${JSON.stringify({ type: 'response.failed', response: { status: 'failed', error: { message: key } } })}\n\n`)
      else if (body.model === 'incomplete') res.end('data: {"type":"response.incomplete"}\n\n')
      else if (body.model === 'broken-json') res.end('data: {invalid}\n\n')
      else if (body.model === 'closed') res.end()
      // Cancellation must close a live socket, with no replay or protocol fallback.
      return
    }
    for (const delta of ['Responses', ' 流式回复', key.slice(0, 10), key.slice(10)]) {
      res.write(`event: response.output_text.delta\r\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\r\n\r\n`)
    }
    res.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: output('Responses 流式回复' + key) })}\n\n`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const settle = async (projectId: string, conversationId: string) => {
      const deadline = Date.now() + 5000
      while (agentCommands.getConversation(projectId, conversationId).status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      const result = agentCommands.getConversation(projectId, conversationId)
      assert.notEqual(result.status, 'running')
      return result
    }
    const base_url = `http://127.0.0.1:${(server.address() as any).port}/v1`
    await agentCommands.saveConnection({ name: 'Responses', base_url, model: 'text', protocol: 'responses', api_key: key })
    const checked = await agentCommands.testConnection()
    assert.equal(checked.capability, 'text-only')
    assert.equal(agentCommands.getConnection()!.protocol, 'responses')
    const project = storage.ensureDefaultProject()
    const conversation = agentCommands.createConversation(project.project_id)
    const events: string[] = []
    const off = onAgentEvent(event => events.push(JSON.stringify(event)))
    await agentCommands.sendMessage(project.project_id, conversation.conversation_id, '解释响应')
    const deadline = Date.now() + 5000
    while (agentCommands.getConversation(project.project_id, conversation.conversation_id).status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    const done = agentCommands.getConversation(project.project_id, conversation.conversation_id)
    assert.equal(done.status, 'idle')
    assert.equal(done.messages[1].content, 'Responses 流式回复[已隐藏]')
    assert(received.some(body => body.stream && body.input.some((item: any) => item.role === 'user' && item.content === '解释响应')))
    assert(events.every(event => !event.includes(key.slice(0, 10))))
    assert(!JSON.stringify(agentCommands.getConnection()).includes(key))
    off()
    agentCommands.deleteConversation(project.project_id, conversation.conversation_id)
    assert.equal(agentCommands.listConversations(project.project_id).length, 0)
    console.log('PASS Responses connection, text-only capability, event stream, credentials and conversation deletion')
    for (const model of ['failed', 'incomplete', 'broken-json', 'closed', 'cancel']) {
      await agentCommands.saveConnection({ name: 'Responses', base_url, model, protocol: 'responses' })
      const attempt = agentCommands.createConversation(project.project_id)
      const before = received.length
      await agentCommands.sendMessage(project.project_id, attempt.conversation_id, '只发送一次')
      if (model === 'cancel') {
        const deadline = Date.now() + 5000
        while (received.length === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
        agentCommands.cancelMessage(project.project_id, attempt.conversation_id)
      }
      const ended = await settle(project.project_id, attempt.conversation_id)
      assert.equal(ended.status, model === 'cancel' ? 'interrupted' : 'error')
      assert.equal(ended.messages[1].status, model === 'cancel' ? 'interrupted' : 'error')
      assert(!JSON.stringify(ended).includes(key))
      assert.equal(received.length - before, 1, 'failed or cancelled requests must not be automatically replayed')
      agentCommands.deleteConversation(project.project_id, attempt.conversation_id)
    }
    await agentCommands.saveConnection({ name: 'Responses', base_url, model: 'http-error', protocol: 'responses' })
    await assert.rejects(agentCommands.testConnection(), (error: Error) => /401/.test(error.message) && !error.message.includes(key))
    const other = storage.createProjectWithDefaults('其他项目')
    assert.equal(agentCommands.listConversations(other.project_id).length, 0)
    console.log('PASS Responses failed/incomplete/malformed/closed streams, cancellation, HTTP errors and no replay')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
