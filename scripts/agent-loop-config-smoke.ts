/**
 * Stage 4 seam: direct environment/variable configuration with approval,
 * encrypted audits, masked values and config undo.
 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createEnvironment } from '../src/shared/factories'
import * as storage from '../src/main/storage/store'
import { agentCommands } from '../src/main/agent/service'
import { agentRoot } from '../src/main/agent/store'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
import type { AgentProtocol } from '../src/shared/agent'

const protocol: AgentProtocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
const secrets = ['NEW-CONFIG-SECRET-1', 'NEW-CONFIG-DENY-SECRET', 'NEW-GLOBAL-SECRET', 'old-allow-secret', 'delete-me-secret', 'env-a-secret', 'bypass-original']
let pid = ''
let envAllow = '', envDeny = '', envDelVar = '', envDelEnv = '', envBypass = '', envServer = ''
const received: string[] = []

function lastUser(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') return String(messages[index].content ?? '')
  return ''
}
function resultsSince(messages: any[]): any[] {
  let start = -1
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') { start = index; break }
  return messages.slice(start + 1).filter(message => message.role === 'tool')
}
function parsed(message: any): any { try { return JSON.parse(String(message.content ?? '')).result ?? {} } catch { return {} } }
function call(id: string, name: string, args: Record<string, unknown>): any {
  return { tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
function next(goal: string, results: any[]): any {
  if (goal.includes('配置创建环境')) {
    if (!results.length) return call('create-env', 'create_environment', { name: 'Agent 环境' })
    if (results.length === 1) return call('update-env', 'update_environment', { env_id: parsed(results[0]).environment_id, name: 'Agent 环境改名' })
    return { content: '环境创建与更新完成' }
  }
  if (goal.includes('配置允许')) {
    if (!results.length) return call('allow-config', 'upsert_environment_variable', { environment_id: envAllow, key: 'token', value: 'NEW-CONFIG-SECRET-1', description: '允许配置' })
    return { content: '配置允许完成' }
  }
  if (goal.includes('配置拒绝')) {
    if (!results.length) return call('deny-config', 'upsert_environment_variable', { environment_id: envDeny, key: 'token', value: 'NEW-CONFIG-DENY-SECRET' })
    return { content: '配置拒绝完成' }
  }
  if (goal.includes('配置自动')) {
    if (!results.length) return call('auto-config', 'upsert_global_variable', { key: 'g', value: 'NEW-GLOBAL-SECRET', description: '自动全局' })
    return { content: '配置自动完成' }
  }
  if (goal.includes('配置跳过')) {
    if (!results.length) return call('bypass-delete', 'delete_environment_variable', { environment_id: envBypass, key: 'token' })
    return { content: '配置跳过完成' }
  }
  if (goal.includes('删除变量')) {
    if (!results.length) return call('delete-var', 'delete_environment_variable', { environment_id: envDelVar, key: 'token' })
    return { content: '变量删除完成' }
  }
  if (goal.includes('删除环境')) {
    if (!results.length) return call('delete-env', 'delete_environment', { env_id: envDelEnv, confirm: true })
    return { content: '环境删除完成' }
  }
  if (goal.includes('服务器配置')) {
    if (!results.length) return call('upsert-server', 'upsert_environment_server', { environment_id: envServer, name: 'Agent Server', uri: 'https://user:pass@example.com/server' })
    return { content: '服务器配置完成' }
  }
  if (goal.includes('错误变量')) {
    if (!results.length) return call('bad-var', 'delete_environment_variable', { environment_id: envAllow, key: 'missing-key' })
    return { content: '错误变量已安全失败' }
  }
  if (goal.includes('错误环境')) {
    if (!results.length) return call('bad-env', 'update_environment', { env_id: 'missing-env', name: '不存在' })
    return { content: '错误环境已安全失败' }
  }
  return { content: '完成' }
}

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-config-')))
  await app.whenReady()
  pid = storage.ensureDefaultProject().project_id
  const createEnv = (name: string, vars: Record<string, string>): string => {
    const env = createEnvironment(pid, name)
    env.env_var_list = Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, { current_value: value, initial_value: value, description: key, is_checked: 1 }]))
    storage.saveEnvironment(pid, env)
    return env.env_id
  }
  envAllow = createEnv('允许环境', { token: 'old-allow-secret' })
  envDeny = createEnv('拒绝环境', { token: 'old-deny' })
  envDelVar = createEnv('删除变量环境', { token: 'delete-me-secret' })
  envDelEnv = createEnv('删除环境', { token: 'env-a-secret' })
  envBypass = createEnv('跳过环境', { token: 'bypass-original' })
  envServer = createEnv('服务器环境', {})
  storage.saveGlobalVars(pid, { project_id: pid, vars: { g: { current_value: 'global-old', initial_value: 'global-old', description: '全局' } }, updated_at: new Date().toISOString() })

  const modelServer = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const decoded = decodeModelRequest(req, body, protocol)
    received.push(JSON.stringify(decoded))
    const tools: string[] = (decoded.tools ?? []).map((tool: any) => tool.function.name)
    if (!tools.length) { respondModel(res, protocol, !!body.stream, { content: 'OK' }); return }
    if (tools.includes('kindra_capability_probe')) {
      respondModel(res, protocol, !!body.stream, { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] })
      return
    }
    respondModel(res, protocol, !!body.stream, next(lastUser(decoded.messages), resultsSince(decoded.messages)))
  })
  await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
  try {
    await agentCommands.saveConnection({ name: '配置模型', base_url: `http://127.0.0.1:${(modelServer.address() as any).port}/v1`, model: 'config-model', protocol })
    assert.equal((await agentCommands.testConnection()).capability, 'tools')

    // ask allow: masked approval, write, audit, undo restores before.
    const allow = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, allow.conversation_id, '配置允许', undefined, { permissionMode: 'ask' })
    const pending = await waitPending(allow.conversation_id)
    assert.match(pending.display ?? '', /\*\*\*/)
    assert(!(pending.display ?? '').includes('NEW-CONFIG-SECRET-1'))
    agentCommands.respondToolApproval(pid, allow.conversation_id, pending.activity_id, 'approved')
    const allowState = await waitIdle(allow.conversation_id)
    assert.equal(environmentValue(envAllow, 'token'), 'NEW-CONFIG-SECRET-1')
    const allowAudit = agentCommands.listConfigAudits(pid).find(item => item.key === 'token' && item.entity_id === envAllow)!
    assert(allowAudit)
    assert(!allowAudit.masked.includes('NEW-CONFIG-SECRET-1'))
    assert(!JSON.stringify(allowState).includes('NEW-CONFIG-SECRET-1'))
    assert(!JSON.stringify(received).includes('NEW-CONFIG-SECRET-1'))
    assert(!auditFiles().some(file => { const text = fs.readFileSync(file, 'utf8'); return secrets.some(secret => text.includes(secret)) }), 'audit payloads must be encrypted at rest')
    await agentCommands.undoConfigChange(pid, allowAudit.audit_id)
    assert.equal(environmentValue(envAllow, 'token'), 'old-allow-secret')
    assert.equal(agentCommands.listConfigAudits(pid).find(item => item.audit_id === allowAudit.audit_id)?.undo_status, 'undone')
    await assert.rejects(() => agentCommands.undoConfigChange(pid, allowAudit.audit_id), /已撤销|重复/)
    console.log('PASS ask config approval, masked display, encrypted audit and undo')

    // ask deny: no write, no audit, no second prompt.
    const beforeDenyAudits = agentCommands.listConfigAudits(pid).length
    const deny = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, deny.conversation_id, '配置拒绝', undefined, { permissionMode: 'ask' })
    const denyPending = await waitPending(deny.conversation_id)
    agentCommands.respondToolApproval(pid, deny.conversation_id, denyPending.activity_id, 'denied')
    const denyState = await waitIdle(deny.conversation_id)
    assert.equal(environmentValue(envDeny, 'token'), 'old-deny')
    assert.equal(agentCommands.listConfigAudits(pid).length, beforeDenyAudits)
    assert(!JSON.stringify(denyState).includes('NEW-CONFIG-DENY-SECRET'))
    assert(!JSON.stringify(received).includes('NEW-CONFIG-DENY-SECRET'))
    console.log('PASS denied config write leaves no value or audit')

    // auto: local-write runs without a prompt; audit undo restores the global variable.
    const auto = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, auto.conversation_id, '配置自动', undefined, { permissionMode: 'auto' })
    const autoState = await waitIdle(auto.conversation_id)
    assert.equal(storage.getGlobalVars(pid).vars.g.current_value, 'NEW-GLOBAL-SECRET')
    assert((autoState.activities ?? []).every(item => item.approval !== 'pending'))
    const globalAudit = agentCommands.listConfigAudits(pid).find(item => item.kind === 'global_vars' && item.key === 'g')!
    assert(globalAudit)
    assert(!JSON.stringify(autoState).includes('NEW-GLOBAL-SECRET'))
    assert(!JSON.stringify(received).includes('NEW-GLOBAL-SECRET'))
    await agentCommands.undoConfigChange(pid, globalAudit.audit_id)
    assert.equal(storage.getGlobalVars(pid).vars.g.current_value, 'global-old')
    console.log('PASS auto config write and audit undo restore the global value')

    // bypass: irreversible delete runs automatically and still shows a risk line.
    const bypass = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, bypass.conversation_id, '配置跳过', undefined, { permissionMode: 'bypass' })
    const bypassState = await waitIdle(bypass.conversation_id)
    assert.equal(environmentValue(envBypass, 'token'), undefined)
    assert.match(JSON.stringify(bypassState.activities ?? []), /不可逆/)
    const bypassAudit = agentCommands.listConfigAudits(pid).find(item => item.action === 'delete_variable' && item.entity_id === envBypass)!
    assert(bypassAudit)
    await agentCommands.undoConfigChange(pid, bypassAudit.audit_id)
    assert.equal(environmentValue(envBypass, 'token'), 'bypass-original')
    console.log('PASS bypass config delete runs with risk text and can be undone')

    // irreversible variable delete: ask pauses; undo restores the variable.
    const deleteVar = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, deleteVar.conversation_id, '删除变量', undefined, { permissionMode: 'auto' })
    await waitPending(deleteVar.conversation_id)
    const deleteVarPending = await pendingActivity(deleteVar.conversation_id)
    assert.match(deleteVarPending.display ?? '', /不可逆/)
    agentCommands.respondToolApproval(pid, deleteVar.conversation_id, deleteVarPending.activity_id, 'approved')
    await waitIdle(deleteVar.conversation_id)
    assert.equal(environmentValue(envDelVar, 'token'), undefined)
    const deleteVarAudit = agentCommands.listConfigAudits(pid).find(item => item.action === 'delete_variable' && item.entity_id === envDelVar)!
    await agentCommands.undoConfigChange(pid, deleteVarAudit.audit_id)
    assert.equal(environmentValue(envDelVar, 'token'), 'delete-me-secret')
    console.log('PASS irreversible variable deletion requires approval and can be undone')

    // environment delete: undo restores the environment and its variables.
    const deleteEnv = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, deleteEnv.conversation_id, '删除环境', undefined, { permissionMode: 'auto' })
    await waitPending(deleteEnv.conversation_id)
    const deleteEnvPending = await pendingActivity(deleteEnv.conversation_id)
    agentCommands.respondToolApproval(pid, deleteEnv.conversation_id, deleteEnvPending.activity_id, 'approved')
    await waitIdle(deleteEnv.conversation_id)
    assert.equal(storage.listEnvironments(pid).some(item => item.env_id === envDelEnv), false)
    const deleteEnvAudit = agentCommands.listConfigAudits(pid).find(item => item.action === 'delete' && item.entity_id === envDelEnv)!
    await agentCommands.undoConfigChange(pid, deleteEnvAudit.audit_id)
    assert.equal(environmentValue(envDelEnv, 'token'), 'env-a-secret')
    console.log('PASS deleted environment is restored with its variables by config undo')

    // create + update environment: both create local audits, undo in reverse order.
    const createEnvConversation = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, createEnvConversation.conversation_id, '配置创建环境', undefined, { permissionMode: 'auto' })
    await waitIdle(createEnvConversation.conversation_id)
    const created = storage.listEnvironments(pid).find(item => item.name === 'Agent 环境改名')!
    assert(created)
    const envAudits = agentCommands.listConfigAudits(pid).filter(item => item.entity_id === created.env_id)
    const updateAudit = envAudits.find(item => item.action === 'update')!
    const createAudit = envAudits.find(item => item.action === 'create')!
    await agentCommands.undoConfigChange(pid, updateAudit.audit_id)
    assert.equal(storage.listEnvironments(pid).find(item => item.env_id === created.env_id)?.name, 'Agent 环境')
    await agentCommands.undoConfigChange(pid, createAudit.audit_id)
    assert.equal(storage.listEnvironments(pid).some(item => item.env_id === created.env_id), false)
    console.log('PASS created and updated environments are independently undoable')

    // server config: URI never appears in the ledger/conversation, and undo restores it.
    const serverConversation = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, serverConversation.conversation_id, '服务器配置', undefined, { permissionMode: 'auto' })
    const serverState = await waitIdle(serverConversation.conversation_id)
    const configured = storage.listEnvironments(pid).find(item => item.env_id === envServer)!
    const added = configured.server_list.find(item => item.name === 'Agent Server')!
    assert(added)
    assert(!JSON.stringify(serverState).includes('user:pass@example.com/server'), 'server URI must not enter the conversation')
    assert(!JSON.stringify(received).includes('user:pass@example.com/server'), 'server URI must not enter later model requests')
    const serverAudit = agentCommands.listConfigAudits(pid).find(item => item.action === 'upsert_server' && item.entity_id === envServer)!
    await agentCommands.undoConfigChange(pid, serverAudit.audit_id)
    assert.equal(storage.listEnvironments(pid).find(item => item.env_id === envServer)?.server_list.some(item => item.server_id === added.server_id), false)
    console.log('PASS environment server write masks its URI and can be undone')

    // Safe failures for missing objects/keys, without approvals or writes.
    const beforeErrorAudits = agentCommands.listConfigAudits(pid).length
    const badVar = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, badVar.conversation_id, '错误变量', undefined, { permissionMode: 'auto' })
    const badVarState = await waitIdle(badVar.conversation_id)
    assert.match(JSON.stringify(badVarState.activities ?? []), /不存在/)
    const badEnv = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, badEnv.conversation_id, '错误环境', undefined, { permissionMode: 'auto' })
    const badEnvState = await waitIdle(badEnv.conversation_id)
    assert.match(JSON.stringify(badEnvState.activities ?? []), /不存在/)
    assert.equal(agentCommands.listConfigAudits(pid).length, beforeErrorAudits)
    console.log('PASS missing config objects fail safely without audits')

    assert(secrets.every(secret => !JSON.stringify(received).includes(secret)), 'no config value may enter later model context')
    console.log(`PASS stage-4 config loop (${protocol})`)
  } finally { await agentCommands.prepareQuit(); modelServer.closeAllConnections(); await new Promise<void>(resolve => modelServer.close(() => resolve())) }
}

function environmentValue(envId: string, key: string): string | undefined {
  return storage.listEnvironments(pid).find(item => item.env_id === envId)?.env_var_list[key]?.current_value
}
function auditFiles(): string[] {
  const folder = path.join(agentRoot(), 'projects', pid, 'config-audits')
  return fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => name.endsWith('.json')).map(name => path.join(folder, name)) : []
}
async function pendingActivity(conversationId: string): Promise<any> {
  return agentCommands.getConversation(pid, conversationId).activities?.find(activity => activity.approval === 'pending')
}
async function waitPending(conversationId: string): Promise<any> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const pending = await pendingActivity(conversationId)
    if (pending) return pending
    if (agentCommands.getConversation(pid, conversationId).status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for config approval: ${agentCommands.getConversation(pid, conversationId).error ?? ''}`)
}
async function waitIdle(conversationId: string): Promise<any> {
  const deadline = Date.now() + 20_000
  let conversation = agentCommands.getConversation(pid, conversationId)
  while (conversation.status === 'running' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
    conversation = agentCommands.getConversation(pid, conversationId)
  }
  assert.equal(conversation.status, 'idle', conversation.error ?? conversation.status)
  return conversation
}

main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
