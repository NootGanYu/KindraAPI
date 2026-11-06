/** Short environment values must not corrupt stable identifiers used for later patches. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands } from '../src/main/agent/service'
import { respondModel } from './agent-model-fixture'

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-redaction-id-')))
  await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const target = store.createTargetInProject(pid, '0', 'api')
  target.description = '报告 1 号'
  target.request!.query.parameter.push(
    { param_id: 'tag-1', key: 'tag', value: 'public-value', is_checked: 1 } as any,
    { param_id: 'token-1', key: 'token', value: 'super-secret-value', is_checked: 1 } as any
  )
  store.saveTarget(pid, target)
  const env = store.listEnvironments(pid)[0]
  env.env_var_list = { counter: { current_value: '1', initial_value: '1', is_checked: 1 } as any }
  store.saveEnvironment(pid, env)
  let projected: any
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const probe = body.tools?.[0]?.function?.name === 'kindra_capability_probe'
    const message = probe
      ? { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
      : body.tools
        ? { tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_api', arguments: JSON.stringify({ project_id: pid, target_id: target.target_id }) } }] }
        : { content: 'done' }
    const tool = body.messages.find((item: any) => item.role === 'tool')
    if (tool) projected = JSON.parse(tool.content)
    respondModel(res, 'chat-completions', body.stream, message)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await agentCommands.saveConnection({ name: 'probe', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'probe', protocol: 'chat-completions' })
    await agentCommands.testConnection()
    const plan = await agentCommands.proposeReadPlan(pid, { goal: '读取', targetId: target.target_id })
    assert.equal(plan.status, 'pending')
    await agentCommands.approvePlan(pid, plan.plan_id)
    const params = projected.api.request.query.parameter as Array<Record<string, unknown>>
    assert.equal(params[0].param_id, 'tag-1', 'short environment value must not corrupt a stable parameter ID')
    assert.equal(params[0].value, 'public-value')
    assert.equal(params[1].param_id, 'token-1')
    assert.equal(params[1].value, '[已隐藏]', 'sensitive sibling values remain redacted')
    assert(!JSON.stringify(projected).includes('super-secret-value'))
    console.log('PASS stable IDs survive short environment redaction while sensitive sibling values stay hidden')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
