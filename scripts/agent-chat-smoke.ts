/** Public application-command seam; isolated real storage, no internal mocks. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as storage from '../src/main/storage/store'
import { agentCommands, onAgentEvent } from '../src/main/agent/service'

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-chat-')))
  await app.whenReady()
  const key = 'secret-agent-configuration-test'
  const saved = await agentCommands.saveConnection({ name: '本地模型', base_url: 'http://127.0.0.1:12345/v1', model: 'text-model', protocol: 'chat-completions', api_key: key })
  assert.equal(saved.has_key, true)
  assert.equal(saved.model, 'text-model')
  assert(!JSON.stringify(agentCommands.getConnection()).includes(key))
  assert(!JSON.stringify(saved).includes('api_key'))
  await assert.rejects(() => agentCommands.saveConnection({ name: '', base_url: 'file:///tmp', model: 'x', protocol: 'chat-completions' }), /地址/)
  console.log('PASS secure connection configuration through application commands')
  const received: any[] = []
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); received.push(body)
    assert.equal(req.headers.authorization, `Bearer ${key}`)
    assert.equal(req.url, '/v1/chat/completions')
    if (body.messages?.some((message: any) => message.content === '等待退出')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': waiting\n\n'); return }
    if (body.model === 'broken') { res.writeHead(401); res.end(key); return }
    if (body.tools) { res.writeHead(400); res.end('tools unsupported'); return }
    if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '你好' } }] })); return }
    res.setHeader('Content-Type', 'text/event-stream')
    for (const content of ['可恢复', '的项目对话', key.slice(0, 12), key.slice(12)]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base_url = `http://127.0.0.1:${(server.address() as any).port}/v1`
    await agentCommands.saveConnection({ name: '模型', base_url, model: 'text-model', protocol: 'chat-completions' })
    const check = await agentCommands.testConnection()
    assert.equal(check.capability, 'text-only')
    assert.equal(agentCommands.getConnection()!.capability, 'text-only')
    const project = storage.ensureDefaultProject()
    const other = storage.createProjectWithDefaults('另一个项目')
    const naming = storage.createProjectWithDefaults('命名项目')
    const namingTitles = [1, 2, 3].map(() => agentCommands.createConversation(naming.project_id).title)
    assert.deepEqual(namingTitles, ['新会话', '新会话 2', '新会话 3'])
    const conversation = agentCommands.createConversation(project.project_id)
    const events: string[] = []
    const off = onAgentEvent(event => events.push(JSON.stringify(event)))
    await agentCommands.sendMessage(project.project_id, conversation.conversation_id, '你好')
    const deadline = Date.now() + 5000
    while (agentCommands.getConversation(project.project_id, conversation.conversation_id).status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    const done = agentCommands.getConversation(project.project_id, conversation.conversation_id)
    assert.equal(done.status, 'idle')
    assert.equal(done.messages[1].content, '可恢复的项目对话[已隐藏]')
    assert.equal(agentCommands.listConversations(other.project_id).length, 0)
    assert.throws(() => agentCommands.getConversation(other.project_id, conversation.conversation_id), /不存在/)
    assert(!JSON.stringify(done).includes(key))
    assert(events.every(event => !event.includes(key.slice(0, 12))), 'stream events must not expose a partial credential')
    off()
    assert(received.find(body => body.stream).messages.some((message: any) => message.content === '你好'))
    const pending = agentCommands.createConversation(project.project_id)
    await agentCommands.sendMessage(project.project_id, pending.conversation_id, '等待退出')
    await agentCommands.prepareQuit()
    assert.equal(agentCommands.getConversation(project.project_id, pending.conversation_id).status, 'interrupted')
    agentCommands.deleteConversation(project.project_id, conversation.conversation_id)
    assert.equal(agentCommands.listConversations(project.project_id).length, 1)
    await agentCommands.saveConnection({ name: '模型', base_url, model: 'broken', protocol: 'chat-completions' })
    await assert.rejects(() => agentCommands.testConnection(), (error: Error) => /401/.test(error.message) && !error.message.includes(key))
    console.log('PASS text-only detection, streaming chat, project isolation, deletion and sanitized errors')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }

}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
