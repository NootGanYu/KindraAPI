/**
 * UI automation for the top-bar「AI 执行计划」page (/automation).
 * Covers the Flow editor, every event type, save, run, run report, history and delete.
 * Requires `npm run build` first.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-automation-ui-'))
const hits = []
let app, page, info

const server = http.createServer((req, res) => {
  const route = (req.url ?? '/').split('?')[0]
  hits.push(`${req.method} ${route}`)
  res.setHeader('Content-Type', 'application/json')
  if (route === '/orders') {
    res.end(JSON.stringify({ code: 0, data: { id: 42, items: [1, 2, 3] } }))
    return
  }
  if (route === '/fail') {
    res.statusCode = 500
    res.end(JSON.stringify({ code: 500, message: 'boom' }))
    return
  }
  res.end(JSON.stringify({ ok: true }))
})

const base = () => `http://127.0.0.1:${server.address().port}`

function flowItem(name) {
  return page.locator('.flow-item').filter({ hasText: name }).first()
}

function flowNameInput() {
  return page.locator('.flow-meta input').first()
}

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = await _electron.launch({
    args: [path.resolve(__dirname, '../out/main/index.js')],
    env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' }
  })
  page = await app.firstWindow()
  page.on('pageerror', error => console.error('[pageerror]', error.message))
  await page.getByRole('navigation').waitFor()

  info = await page.evaluate(async root => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.data }
    const project = unwrap(await window.api.projects.ensureDefault())
    const now = new Date().toISOString()
    const env = {
      env_id: `e_ui_${Date.now()}`,
      project_id: project.project_id,
      name: 'UI 环境',
      env_var_list: { baseUrl: { current_value: root, initial_value: root, description: '', is_checked: 1 } },
      server_list: [{ server_id: '1', name: 'default', uri: root, sort: 1000 }],
      sort: 1000,
      is_private: -1,
      created_at: now,
      updated_at: now
    }
    unwrap(await window.api.envs.save(project.project_id, env))
    const target = unwrap(await window.api.targets.create(project.project_id, '0', 'api'))
    target.name = '订单接口'
    target.method = 'GET'
    target.url = `${root}/orders`
    unwrap(await window.api.targets.save(project.project_id, target))
    const event = (id, type, extra = {}) => ({ event_id: id, type, name: id, enabled: true, ...extra })
    const request = url => event('', 'request', { method: 'GET', url, headers: [], body: '' })

    const created = unwrap(await window.api.flows.create(project.project_id, '订单流程'))
    const good = {
      ...created,
      name: '订单流程',
      description: '订单查询流程',
      env_id: env.env_id,
      events: [
        { ...request('{{baseUrl}}/orders'), event_id: 'ev_req', name: '查询订单' },
        event('ev_api', 'api', { name: '接口事件查询', target_id: target.target_id }),
        event('ev_assert', 'assert', {
          name: '状态与字段断言',
          assertions: [
            { assert_id: 'as_status', type: 'status', op: 'equals', expected: 200 },
            { assert_id: 'as_json', type: 'json', path: 'data.id', op: 'equals', expected: 42 }
          ]
        }),
        event('ev_script', 'script', {
          name: '保存 orderId',
          script: "pm.test('订单 id 为 42', () => pm.expect(pm.response.json().data.id).to.eql(42)); pm.environment.set('orderId', pm.response.json().data.id); console.log('订单读取完成');"
        }),
        event('ev_if', 'if', {
          name: '条件分支',
          condition: '{{orderId}}',
          children: [{ ...request('{{baseUrl}}/orders'), event_id: 'ev_if_req', name: '条件内查询' }]
        }),
        event('ev_wait', 'wait', { name: '等待', wait_ms: 10 }),
        event('ev_begin', 'begin', {
          name: '分组',
          children: [{ ...request('{{baseUrl}}/orders'), event_id: 'ev_begin_req', name: '分组内查询' }]
        }),
        event('ev_loop', 'loop', {
          name: '循环',
          loop_count: 2,
          children: [{ ...request('{{baseUrl}}/orders'), event_id: 'ev_loop_req', name: '循环内查询' }]
        })
      ]
    }
    unwrap(await window.api.flows.save(project.project_id, good, good.revision ?? ''))

    const createdBad = unwrap(await window.api.flows.create(project.project_id, '失败流程'))
    const bad = {
      ...createdBad,
      name: '失败流程',
      description: '用于验证失败报告',
      env_id: env.env_id,
      events: [
        { ...request('{{baseUrl}}/fail'), event_id: 'ev_fail_req', name: '失败请求' },
        event('ev_fail_assert', 'assert', {
          name: '期望 200',
          assertions: [{ assert_id: 'as_fail', type: 'status', op: 'equals', expected: 200 }]
        })
      ]
    }
    unwrap(await window.api.flows.save(project.project_id, bad, bad.revision ?? ''))
    return { project: project.project_id, env: env.env_id, good: good.flow_id, bad: bad.flow_id }
  }, base())

  await page.reload()
  await page.getByRole('navigation').waitFor()

  // 1. Top-bar entry navigates to the automation page.
  await page.getByRole('button', { name: 'AI 执行计划' }).click()
  await page.waitForURL(/#\/automation/)
  await page.getByText('流程', { exact: true }).first().waitFor()
  await flowItem('订单流程').waitFor()
  assert.equal(await flowItem('失败流程').count(), 1, 'second seeded flow must appear')

  // 2. Selecting a flow loads its definition and every event editor.
  await flowItem('订单流程').click()
  await page.locator('.flow-item.active').filter({ hasText: '订单流程' }).waitFor()
  await flowNameInput().waitFor()
  assert.equal(await flowNameInput().inputValue(), '订单流程', 'selected flow name loads into the editor')
  assert.equal(await page.locator('.flow-events > .event-card').count(), 8, 'all eight top-level events render')
  const typeLabels = await page.locator('.flow-events > .event-card .event-type').allTextContents()
  for (const label of ['接口', '请求', '断言', '脚本', '条件', '等待', '分组', '循环']) {
    assert(typeLabels.includes(label), `event editor must render ${label}`)
  }
  const eventNames = await page.locator('.flow-events input').evaluateAll(nodes => nodes.map(node => node.value))
  assert(eventNames.includes('查询订单'), 'top-level event names load')
  assert(eventNames.includes('条件内查询'), 'if child event loads')
  assert(eventNames.includes('循环内查询'), 'loop child event loads')

  // 3. Run the flow: save, execute, report and history.
  const requestsBefore = hits.length
  await page.getByRole('button', { name: '运行 Flow' }).click()
  const resultPanel = page.locator('.automation-panel').last()
  const headTag = resultPanel.locator('.automation-panel-head .ant-tag')
  await headTag.filter({ hasText: '通过' }).waitFor({ timeout: 20000 })
  await resultPanel.locator('.run-summary').waitFor()
  const summary = await resultPanel.locator('.run-summary').innerText()
  assert.match(summary, /通过/, 'run summary must report passed events')
  assert.equal(await resultPanel.locator('.run-summary b').nth(2).innerText(), '0', 'a passing run has no failed events')
  const resultText = await resultPanel.innerText()
  assert.match(resultText, /查询订单/)
  assert.match(resultText, /接口事件查询/)
  assert.match(resultText, /状态与字段断言/)
  assert.match(resultText, /保存 orderId/)
  assert.match(resultText, /条件成立/)
  assert.match(resultText, /循环 2 轮/)
  assert.match(resultText, /运行时变量/)
  assert.match(resultText, /baseUrl/)
  assert.match(resultText, /订单读取完成/)
  await resultPanel.locator('.run-response summary').first().click()
  assert.match(await resultPanel.innerText(), /响应 200/)
  assert(hits.length > requestsBefore, 'running the flow must dispatch real HTTP requests')
  assert(hits.slice(requestsBefore).every(hit => hit === 'GET /orders'), 'only the passing endpoint is called')
  // api 1 + inline 1 + loop 2 + if 1 + begin 1 = 6 orders requests
  assert.equal(hits.slice(requestsBefore).filter(hit => hit === 'GET /orders').length, 6)
  await page.waitForTimeout(300)
  assert.equal(await resultPanel.locator('.run-history-row').count(), 1, 'one history row for the first run')

  // 4. Dirty definitions must be saved explicitly before running.
  const description = page.getByPlaceholder('说明（可选）')
  await description.fill('运行前主动保存')
  const hitsBeforeDirtyRun = hits.length
  await page.getByRole('button', { name: '运行 Flow' }).click()
  await page.getByText('请先主动保存流程，再运行', { exact: true }).waitFor()
  await page.waitForTimeout(300)
  assert.equal(hits.length, hitsBeforeDirtyRun, 'a dirty flow must not run before saving')
  await page.getByRole('button', { name: '保存 Flow' }).click()
  await page.getByText('流程已保存', { exact: true }).last().waitFor()
  const saved = await page.evaluate(async ({ pid, id }) => (await window.api.flows.get(pid, id)).data, { pid: info.project, id: info.good })
  assert.equal(saved.description, '运行前主动保存', 'manual save persists the edit')
  assert.equal(saved.env_id, info.env, 'save must keep the selected environment')
  await page.getByRole('button', { name: '运行 Flow' }).click()
  await resultPanel.locator('.run-history-row').nth(1).waitFor({ timeout: 20000 })
  await headTag.filter({ hasText: '通过' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(300)
  assert.equal(await resultPanel.locator('.run-history-row').count(), 2, 'second run appends history')

  // 5. Failure flow reports failures.
  await flowItem('失败流程').click()
  await page.locator('.flow-item.active').filter({ hasText: '失败流程' }).waitFor()
  await page.getByRole('button', { name: '运行 Flow' }).click()
  await headTag.filter({ hasText: '失败' }).waitFor({ timeout: 20000 })
  await resultPanel.locator('.run-summary').waitFor()
  const failedText = await resultPanel.innerText()
  assert.match(failedText, /失败请求/)
  assert.match(failedText, /响应 500/)
  assert.match(failedText, /期望 200/)
  assert.notEqual(await resultPanel.locator('.run-summary b').nth(2).innerText(), '0', 'failed run counts at least one failed event')

  // 6. Create and delete through the UI.
  await page.getByRole('button', { name: /新建流程/ }).click()
  await page.getByText('流程已创建', { exact: true }).waitFor()
  await page.locator('.flow-item.active').filter({ hasText: '新建流程' }).waitFor()
  assert.equal(await flowNameInput().inputValue(), '新建流程', 'new flow opens in the editor')
  assert.equal(await flowItem('新建流程').count(), 1, 'new flow appears in the list')

  // Adding an event keeps the editor functional.
  await page.getByRole('button', { name: /添加事件/ }).click()
  await page.locator('.ant-dropdown:visible').getByText('等待', { exact: true }).click()
  await page.locator('.flow-events > .event-card').filter({ hasText: '等待' }).waitFor()
  await page.getByRole('button', { name: '保存 Flow' }).click()
  await page.getByText('流程已保存', { exact: true }).last().waitFor()
  assert.equal(await page.locator('.automation-panel-head').filter({ hasText: '未保存' }).count(), 0, 'saved flow is clean')

  const deleteButton = page.locator('.flow-meta button.ant-btn-dangerous').first()
  await deleteButton.click()
  await page.locator('.ant-modal-confirm').getByRole('button', { name: /删\s*除/ }).click()
  await page.getByText('已删除', { exact: true }).waitFor()
  assert.equal(await flowItem('新建流程').count(), 0, 'deleted flow leaves the list')

  // 7. Historical run can be reopened.
  await flowItem('订单流程').click()
  await page.locator('.flow-item.active').filter({ hasText: '订单流程' }).waitFor()
  await resultPanel.locator('.run-history-row').first().waitFor()
  await resultPanel.locator('.run-history-row').first().click()
  await resultPanel.locator('.run-summary').waitFor()
  await headTag.filter({ hasText: '通过' }).waitFor({ timeout: 20000 })
  assert.match(await resultPanel.innerText(), /运行时变量/)

  // 8. An Agent-owned draft must not auto-save on Run.
  await page.waitForTimeout(300)
  const draftPath = path.join(userData, 'offline-data-local', 'agent', 'projects', info.project, 'flow-drafts', `${info.good}.json`)
  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'))
  draft.agent_owned = true
  draft.flow.description = 'Agent 草稿说明'
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2))
  await page.reload()
  await page.getByRole('navigation').waitFor()
  await flowItem('订单流程').waitFor()
  await flowItem('订单流程').click()
  await page.getByRole('status').filter({ hasText: '已恢复 Agent Flow 草稿' }).waitFor()
  const hitsBeforeGuard = hits.length
  await page.getByRole('button', { name: '运行 Flow' }).click()
  await page.getByText('Agent Flow 草稿请先主动保存后运行；运行不会自动保存。', { exact: true }).waitFor()
  await page.waitForTimeout(300)
  assert.equal(hits.length, hitsBeforeGuard, 'an unsaved Agent draft must not dispatch requests on Run')
  await page.getByRole('button', { name: '保存 Flow' }).click()
  await page.getByText('流程已保存', { exact: true }).last().waitFor()
  await page.getByRole('status').filter({ hasText: '已恢复 Agent Flow 草稿' }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '运行 Flow' }).click()
  await resultPanel.locator('.run-history-row').nth(2).waitFor({ timeout: 20000 })
  await headTag.filter({ hasText: '通过' }).waitFor({ timeout: 20000 })
  assert(hits.length > hitsBeforeGuard, 'saving the Agent draft first allows the run')

  console.log('PASS automation page: top-bar entry, 8 event editors, saved API + inline requests, run report, dirty-run guard, history, failure and delete')
})().catch(async error => {
  if (app) {
    try {
      const current = await app.firstWindow()
      console.error((await current.locator('body').innerText()).slice(-4000))
      await current.screenshot({ path: '/tmp/kindra-automation-ui-failure.png' })
    } catch {}
  }
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  server.closeAllConnections()
  await new Promise(resolve => server.close(() => resolve()))
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})
