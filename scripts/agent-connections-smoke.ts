/** Public application commands with real local storage and loopback models. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as storage from '../src/main/storage/store'
import { agentCommands } from '../src/main/agent/service'

async function main(): Promise<void> {
  app.setPath('userData', process.env.AGENT_CONNECTIONS_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-connections-')))
  await app.whenReady()
  const a = storage.ensureDefaultProject(), b = storage.createProjectWithDefaults('另一个项目')
  const input = { name: '连接甲', base_url: 'http://127.0.0.1:12345/v1', model: '甲模型', protocol: 'chat-completions' as const, api_key: 'connection-test-secret-a' }
  const first = await agentCommands.createConnection(input)
  const second = await agentCommands.createConnection({ ...input, name: '连接乙', model: '乙模型', api_key: 'connection-test-secret-b' })
  assert.notEqual(first.connection_id, second.connection_id)
  assert.equal(agentCommands.listConnections().length, 2)
  agentCommands.setProjectConnection(a.project_id, first.connection_id)
  agentCommands.setProjectConnection(b.project_id, second.connection_id)
  assert.equal(agentCommands.getProjectConnection(a.project_id)!.model, '甲模型')
  assert.equal(agentCommands.getProjectConnection(b.project_id)!.model, '乙模型')
  const changed = await agentCommands.saveConnection({ ...input, model: '更新甲', api_key: undefined }, first.connection_id)
  assert(changed.has_key)
  assert.notEqual(changed.revision, first.revision)
  assert.equal(agentCommands.getProjectConnection(a.project_id)!.model, '更新甲')
  assert.equal(agentCommands.getProjectConnection(b.project_id)!.model, '乙模型')
  assert(!JSON.stringify(agentCommands.listConnections()).includes('connection-test-secret'))
  assert(!JSON.stringify(agentCommands.listConnections()).includes('encrypted_key'))
  agentCommands.deleteConnection(first.connection_id)
  assert.equal(agentCommands.getProjectConnection(a.project_id), null, 'deleted default must not choose another service')
  assert.equal(agentCommands.getProjectConnection(b.project_id)!.connection_id, second.connection_id)
  assert.throws(() => agentCommands.setProjectConnection(a.project_id, first.connection_id), /连接不存在/)
  assert.throws(() => agentCommands.setProjectConnection('../invalid', second.connection_id), /项目不存在/)
  console.log('PASS multiple connections, independent project defaults, protected reads and no deleted-default fallback')
  const requests: Array<{ model: string; authorization: string | undefined; release: () => void }> = []
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const release = (): void => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: body.tools ? { tool_calls: [{ function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] } : { content: body.model } }] }))
    }
    requests.push({ model: body.model, authorization: req.headers.authorization, release })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const until = async (test: () => boolean): Promise<void> => { const deadline = Date.now() + 5000; while (!test() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert(test(), 'timed out') }
  try {
    const base_url = `http://127.0.0.1:${(server.address() as any).port}/v1`
    const config = await agentCommands.saveConnection({ ...input, base_url, model: 'frozen-model', api_key: 'frozen-key' }, second.connection_id)
    const conversation = agentCommands.createConversation(b.project_id)
    const started = await agentCommands.sendMessage(b.project_id, conversation.conversation_id, 'test frozen configuration')
    await until(() => requests.length === 1)
    assert.equal(started.connection!.model, 'frozen-model')
    assert(!JSON.stringify(started).includes('frozen-key'))
    await agentCommands.saveConnection({ ...input, base_url, model: 'replacement-model', api_key: 'new-key' }, config.connection_id)
    agentCommands.deleteConnection(config.connection_id)
    requests[0].release()
    await until(() => agentCommands.getConversation(b.project_id, conversation.conversation_id).status !== 'running')
    assert.equal(requests[0].authorization, 'Bearer frozen-key')
    assert.equal(agentCommands.getConversation(b.project_id, conversation.conversation_id).messages.at(-1)!.content, 'frozen-model')
    await assert.rejects(() => agentCommands.sendMessage(b.project_id, conversation.conversation_id, 'cannot fall back'), /选择有效模型连接/)
    assert.equal(requests.length, 1)
    const next = await agentCommands.createConnection({ ...input, base_url, model: 'probe-model' })
    const probing = agentCommands.testConnection(next.connection_id)
    await until(() => requests.length === 2); requests[1].release()
    await until(() => requests.length === 3)
    await agentCommands.saveConnection({ ...input, base_url, model: 'probe-model', api_key: 'changed-during-probe' }, next.connection_id)
    requests[2].release(); await probing
    assert.equal(agentCommands.getConnection(next.connection_id)!.capability, 'unchecked', 'stale probe must not grant tools to changed credentials')
    const explicit = agentCommands.createConversation(a.project_id)
    await agentCommands.sendMessage(a.project_id, explicit.conversation_id, 'choose explicitly', next.connection_id)
    await until(() => requests.length === 4); requests[3].release()
    await until(() => agentCommands.getConversation(a.project_id, explicit.conversation_id).status !== 'running')
    assert.equal(requests[3].authorization, 'Bearer changed-during-probe')
    assert.equal(agentCommands.getProjectConnection(a.project_id), null, 'one-turn choice does not change project default')
    console.log('PASS frozen running configuration, explicit turn selection, deleted connection and stale capability probe')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }

}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
