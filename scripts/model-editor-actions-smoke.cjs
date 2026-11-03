const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { _electron: electron } = require('playwright-core')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-model-actions-'))
let app, page
async function run() {
  app = await electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, KINDRAAPI_USER_DATA: profile, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  page = await app.firstWindow(); page.setDefaultTimeout(8000)
  await page.waitForSelector('.app-shell')
  const folderId = await page.evaluate(async () => {
    const projectId = (await window.api.projects.list()).data[0].project_id
    const folder = (await window.api.models.create(projectId, '0', 'folder')).data
    folder.name = '保存目录'
    const result = await window.api.models.save(projectId, folder)
    if (!result.ok) throw Error(result.error)
    return folder.model_id
  })
  await page.locator('.rail-btn').filter({ hasText: '字典' }).click()
  await page.locator('.schemas-card').filter({ hasText: '新建数据模型' }).click()
  const model = page.locator('.model-editor:visible')
  await model.getByPlaceholder('输入模型名称，建议使用代码模型名称或其同义词').fill('Raw 保存验证')
  await model.locator('.model-toolbar button').filter({ hasText: 'Raw 编辑' }).click()
  await model.locator('.model-raw textarea').fill('{"type":"object","properties":{"current":{"type":"integer","default":42}}}')
  await model.getByRole('button', { name: /保\s*存/, exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.filetab.active .red-dot'))
  let stored = await page.evaluate(async () => {
    const id = (await window.api.projects.list()).data[0].project_id
    return (await window.api.models.listAll(id)).data.find(model => model.name === 'Raw 保存验证')
  })
  assert.equal(stored.data.schema.properties.current.default, 42)
  console.log('PASS Raw 未点应用直接保存使用当前文本，保存后清除脏状态')
  await model.locator('.model-raw textarea').fill('{"type":"object","properties":{"latest":{"type":"string","default":"最新值"}}}')
  await model.locator('.model-toolbar button').filter({ hasText: '预览' }).click()
  await model.locator('.model-preview .resp-code').getByText(/最新值/).waitFor()
  assert.ok(!(await model.locator('.model-preview .resp-code').innerText()).includes('current'))
  console.log('PASS Raw 直接切预览读取当前文本，不使用上次草稿')
  await model.locator('.model-toolbar button').filter({ hasText: 'Raw 编辑' }).click()
  await model.locator('.model-raw textarea').fill('{"type":')
  await model.getByRole('button', { name: /保\s*存/, exact: true }).click()
  await model.getByText(/JSON 解析失败/).waitFor()
  await page.locator('.filetab.active .tab-x').click()
  const guard = page.locator('.ant-modal-confirm:visible')
  await guard.locator('.ant-modal-confirm-title').getByText('放弃未保存的修改？').waitFor()
  await guard.getByRole('button', { name: /取\s*消/, exact: true }).click()
  assert.equal(await model.locator('.model-raw textarea').inputValue(), '{"type":')
  console.log('PASS 无效 Raw 阻止保存，关闭确认取消保留输入')
  await model.locator('.model-raw textarea').fill('{"type":"object","properties":{"final":{"type":"boolean"}}}')
  await model.getByRole('button', { name: /保\s*存/, exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.filetab.active .red-dot'))
  await model.locator('.model-editor-head .ant-dropdown-trigger').click()
  await page.locator('.ant-dropdown:visible').getByText('保存目录', { exact: true }).click()
  await model.getByRole('button', { name: /保\s*存/, exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.filetab.active .red-dot'))
  const parentId = await page.evaluate(async () => {
    const id = (await window.api.projects.list()).data[0].project_id
    return (await window.api.models.listAll(id)).data.find(model => model.name === 'Raw 保存验证').parent_id
  })
  assert.equal(parentId, folderId)
  console.log('PASS 保存目录下拉选择写入目录，模型内容保持')
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
