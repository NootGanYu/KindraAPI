/** Review regressions: actual editors and persistence in a disposable profile; no HTTP requests. */
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { _electron: electron } = require('playwright-core')
const esbuild = require('esbuild')
const repo = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-review-regressions-'))
const failures = []
let app, page
function bundle(contents) {
  return esbuild.buildSync({ stdin: { contents, resolveDir: repo, loader: 'ts' }, bundle: true,
    platform: 'node', format: 'cjs', packages: 'external', alias: { '@shared': path.join(repo, 'src/shared') }, write: false }).outputFiles[0].text
}
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`) }
}
async function saveAndRead(projectId, targetId) {
  await page.locator('.save-btn').click()
  await page.getByText('已保存', { exact: true }).last().waitFor()
  return page.evaluate(async ({ projectId, targetId }) => (await window.api.targets.get(projectId, targetId)).data, { projectId, targetId })
}
async function main() {
  await check('根节点规则单独存在时往返保留', () => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', bundle("export {buildFieldSchema, fieldDocsFromSchema} from './src/shared/jsonFields'"))(require, module, module.exports)
    for (const rules of [{ nullable: true }, { nullable: false }, { required: false }, { enum: null }, { default: { id: 1 } }, { example: { id: 2 } }]) {
      const schema = module.exports.buildFieldSchema('{"id":1}', [{ pointer: '', ...rules }]).schema
      const root = module.exports.fieldDocsFromSchema(schema).find(doc => doc.pointer === '')
      assert(root, `根规则丢失: ${JSON.stringify(rules)}`)
      for (const [key, value] of Object.entries(rules)) assert.deepEqual(root[key], value)
    }
  })
  app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: repo,
    env: { ...process.env, KINDRAAPI_USER_DATA: profile, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  page = await app.firstWindow(); page.setDefaultTimeout(8000)
  await page.waitForSelector('.app-shell')
  const projectId = await page.evaluate(async () => (await window.api.projects.list()).data[0].project_id)
  await check('仅编辑字典描述保留对象/数组默认值和示例', async () => {
    const fixtures = [
      { key: 'review_object', field_type: 'object', default_value: '{"x":1}', example_value: '{"x":2}', schema: { type: 'object', default: { x: 1 }, example: { x: 2 }, enum: [{ x: 1 }], nullable: false } },
      { key: 'review_array', field_type: 'array', default_value: '[1,2]', example_value: '[3]', schema: { type: 'array', default: [1, 2], example: [3], minItems: 1, nullable: false } },
      { key: 'review_legacy', field_type: 'object', default_value: '{"legacy":true}', example_value: 'legacy example' }
    ]
    await page.evaluate(async ({ projectId, fixtures }) => {
      for (const fixture of fixtures) {
        const result = await window.api.dictionary.save(projectId, { ...fixture, id: fixture.key, project_id: projectId, description: '原描述', created_at: '', updated_at: '' })
        if (!result.ok) throw Error(result.error)
      }
    }, { projectId, fixtures })
    await page.locator('.rail-btn').filter({ hasText: '字典' }).click()
    await page.locator('.schema-nav-row').filter({ hasText: '数据字典' }).click()
    for (const fixture of fixtures) {
      await page.getByRole('button', { name: `编辑 ${fixture.key}`, exact: true }).click()
      const dialog = page.locator('.dictionary-entry-modal:visible')
      await dialog.getByLabel('字段描述', { exact: true }).fill('仅改描述')
      await dialog.getByRole('button', { name: /确\s*定/ }).click(); await dialog.waitFor({ state: 'hidden' })
    }
    const entries = await page.evaluate(async id => (await window.api.dictionary.list(id)).data, projectId)
    for (const fixture of fixtures) {
      const entry = entries.find(item => item.key === fixture.key)
      assert.equal(entry.description, '仅改描述')
      assert.equal(entry.default_value, fixture.default_value)
      assert.equal(entry.example_value, fixture.example_value)
      for (const [key, value] of Object.entries(fixture.schema ?? {})) assert.deepEqual(entry.schema[key], value)
    }
  })
  await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
  await check('批量格式切换保留同名参数各自的规则和启用状态', async () => {
    await page.locator('.tab-add').click(); await page.getByRole('textbox', { name: '请求 URL', exact: true }).waitFor()
    const targetId = await page.evaluate(async id => (await window.api.targets.list(id)).data.find(target => target.target_type === 'api').target_id, projectId)
    await page.locator('.req-tabs').getByRole('tab', { name: 'Query', exact: true }).click()
    const open = async () => {
      await page.locator('.design-param-table').hover(); await page.getByRole('button', { name: '批量编辑', exact: true }).click()
      const dialog = page.locator('.ant-modal:visible'); await dialog.getByText('带描述', { exact: true }).click(); return dialog
    }
    let dialog = await open()
    await dialog.getByRole('textbox', { name: '批量参数', exact: true }).fill(JSON.stringify([
      { key: 'tag', value: 'A', description: '说明A', required: true, is_checked: 1, field_type: 'string' },
      { key: 'tag', value: 'B', description: '说明B', required: false, is_checked: -1, field_type: 'integer' }
    ]))
    await dialog.getByRole('button', { name: /确\s*定/ }).click(); await dialog.waitFor({ state: 'hidden' })
    const before = (await saveAndRead(projectId, targetId)).request.query.parameter
    dialog = await open()
    await dialog.getByRole('button', { name: /确\s*定/ }).click(); await dialog.waitFor({ state: 'hidden' })
    assert.deepEqual((await saveAndRead(projectId, targetId)).request.query.parameter, before)
  })
  await check('未提交URL在MCP删除后保留且可另存', async () => {
    await page.locator('.tab-add').click()
    const input = page.getByRole('textbox', { name: '请求 URL', exact: true })
    await input.fill('http://example.invalid/saved')
    const idsBefore = await page.evaluate(async id => (await window.api.targets.list(id)).data, projectId)
    await page.locator('.save-btn').click(); await page.getByText('已保存', { exact: true }).last().waitFor()
    const targetId = await page.evaluate(async id => (await window.api.targets.list(id)).data.find(target => target.url === 'http://example.invalid/saved').target_id, projectId)
    const tabs = await page.locator('.tab-name').count()
    const pending = 'http://example.invalid/UNSAVED-DRAFT'
    await input.fill(pending)
    assert(await input.evaluate(el => el === document.activeElement))
    const code = bundle("export {deleteTarget} from './src/main/storage/store'; export {withTargetChanges} from './src/main/storage/changes'")
    await app.evaluate(async (_electron, { code, repo, projectId, targetId }) => {
      const module = { exports: {} }, requireRepo = process.mainModule.require('node:module').createRequire(repo + '/package.json')
      new Function('require', 'module', 'exports', code)(requireRepo, module, module.exports)
      await module.exports.withTargetChanges('mcp', undefined, () => module.exports.deleteTarget(projectId, targetId))
    }, { code, repo, projectId, targetId })
    await page.waitForFunction(count => document.querySelectorAll('.tab-name').length !== count || [...document.querySelectorAll('.tab-sync')].some(el => el.textContent === '已删除'), tabs)
    assert.equal(await page.locator('.tab-name').count(), tabs, '外部删除不能关闭有未提交输入的标签')
    assert.equal(await input.inputValue(), pending)
    await page.getByRole('button', { name: '另存为新接口', exact: true }).click()
    await page.waitForFunction(async ({ projectId, pending }) => (await window.api.targets.list(projectId)).data.some(target => target.url === pending), { projectId, pending })
    const copy = await page.evaluate(async ({ projectId, pending }) => (await window.api.targets.list(projectId)).data.find(target => target.url === pending), { projectId, pending })
    assert(copy && !idsBefore.some(target => target.target_id === copy.target_id))
  })
  if (failures.length) throw Error(`${failures.length} regression checks failed`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}) }
  fs.rmSync(profile, { recursive: true, force: true })
})
