const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { _electron } = require('playwright-core')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-file-review-ui-'))
  const file = path.join(dir, 'upload.txt')
  fs.writeFileSync(file, 'original bytes')
  let release, arrived, electron
  const arrival = new Promise(resolve => { arrived = resolve })
  const hits = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      hits.push({ url: req.url, body })
      if (req.url === '/hold') { release = () => res.end('{}'); arrived() }
      else res.end('{}')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    electron = await _electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: dir } })
    const page = await electron.firstWindow()
    await page.waitForFunction(() => Boolean(window.api))
    await page.setViewportSize({ width: 1180, height: 820 })
    const fixture = await page.evaluate(async ({ port, file }) => {
      const pid = (await window.api.projects.list()).data[0].project_id
      const target = (await window.api.targets.create(pid, '0', 'api')).data
      target.url = `http://127.0.0.1:${port}/upload`
      target.method = 'POST'
      target.request.body = { mode: 'binary', binary: { file_path: file } }
      await window.api.targets.save(pid, target)
      const flow = (await window.api.flows.create(pid, '文件变化暂停审查')).data
      flow.events = [
        { event_id: 'hold', type: 'request', enabled: true, name: '已完成操作', url: `http://127.0.0.1:${port}/hold` },
        { event_id: 'upload', type: 'api', enabled: true, name: '上传文件', target_id: target.target_id }
      ]
      await window.api.flows.save(pid, flow, flow.revision)
      const run = (await window.api.flows.startRun(pid, flow.flow_id, '', 'file-review-ui')).data
      return { pid, run }
    }, { port: server.address().port, file })
    await arrival
    fs.writeFileSync(file, 'reviewed bytes')
    release()
    await page.evaluate(() => { location.hash = '#/automation' })
    await page.locator('.automation-results-head').getByText('已暂停', { exact: true }).waitFor()
    await page.getByText(/外部文件已变更或不可读取/).waitFor()
    assert.deepEqual(hits, [{ url: '/hold', body: '' }])
    await page.getByRole('button', { name: '预览已保存变更', exact: true }).click()
    await page.getByRole('button', { name: '审阅执行范围', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认本轮范围', exact: true }).click()
    await page.getByRole('button', { name: '采用剩余引用更新', exact: true }).click()
    await page.getByLabel('快照版本切换').waitFor()
    assert.equal(hits.length, 1)
    await page.getByRole('button', { name: '继续已审阅快照', exact: true }).click()
    const deadline = Date.now() + 10000
    while (true) {
      const result = await page.evaluate(async f => window.api.flows.getRun(f.pid, f.run.run_id), fixture)
      if (result.data.status === 'passed') break
      assert(Date.now() < deadline, JSON.stringify(result))
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.deepEqual(hits, [{ url: '/hold', body: '' }, { url: '/upload', body: 'reviewed bytes' }])
    console.log('PASS Electron file-change pause, scope review, adoption and manual continuation without replay')
  } finally {
    release?.()
    if (electron) { await electron.evaluate(({ app }) => app.exit(0)).catch(() => {}); await electron.close().catch(() => {}) }
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
