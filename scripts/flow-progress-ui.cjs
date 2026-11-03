const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron } = require('playwright-core')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-progress-ui-'))
  let release
  const server = http.createServer((_req,res) => { release = () => res.end('{}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let electron
  try {
    electron = await _electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, KINDRAAPI_USER_DATA: dir } })
    const page = await electron.firstWindow()
    await page.waitForFunction(() => Boolean(window.api))
    const result = await page.evaluate(async (port) => {
      const project = (await window.api.projects.list()).data[0]
      const flow = (await window.api.flows.create(project.project_id, '进度界面验收')).data
      flow.events = [
        { event_id: 'progress-script', type: 'script', name: '已完成脚本', enabled: true, script: 'console.log({token:"ui-secret"})' },
        { event_id: 'progress-http', type: 'request', name: '在途请求', enabled: true, method: 'GET', url: `http://127.0.0.1:${port}/hold` }
      ]
      const saved = await window.api.flows.save(project.project_id, flow, flow.revision)
      if (!saved.ok) throw new Error(saved.error)
      return window.api.flows.startRun(project.project_id, flow.flow_id, '', 'ui-progress')
    }, server.address().port)
    assert(result.ok)
    console.log('started UI fixture')
    await page.evaluate(() => { window.location.hash = '#/automation' })
    console.log('navigated automation')
    await page.getByText('正在运行，已完成结果持续保存').waitFor()
    await page.locator('.run-event-name').filter({hasText: '已完成脚本'}).waitFor()
    assert(!(await page.locator('.automation-panel').last().innerText()).includes('ui-secret'))
    console.log('verified progress')
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app:request-close'))
    await page.getByText('退出将终止活动运行', {exact:true}).last().waitFor()
    await page.getByRole('button', {name:'留在应用'}).click()
    assert.equal((await page.evaluate(() => window.api.flows.activeRuns())).data.length, 1)
    console.log('quit cancelled, releasing HTTP')
    release()
    await page.waitForFunction(async (run) => (await window.api.flows.getRun(run.project_id, run.run_id)).data.status === 'passed', result.data, { timeout: 10000 })
    console.log('PASS real Electron UI shows partial results, redacts console and allows retaining active Run at quit')
  } catch (error) { console.error(error); throw error } finally {
    release?.()
    if (electron) { await electron.evaluate(({ app }) => app.exit(0)).catch(() => {}); await electron.close().catch(() => {}) }
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir,{recursive:true,force:true})
  }
}
main().catch(error => { console.error(error); process.exitCode=1 })
