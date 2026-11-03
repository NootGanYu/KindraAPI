/** 通过鼠标/滚轮复现描述框点击弹出和字典列表重复；使用隔离数据，不发送请求。 */
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { _electron: electron } = require('playwright-core')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-description-'))
const artifacts = path.join(__dirname, '.ui-artifacts', 'description')
let app, page
const failures = []
const check = (condition, description) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${description}`); if (!condition) failures.push(description) }
const popup = () => page.locator('.ant-select-dropdown:visible')
async function main() {
  fs.mkdirSync(artifacts, { recursive: true })
  app = await electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' } })
  page = await app.firstWindow(); page.setDefaultTimeout(8000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.on('show', () => window.hide()); window.hide() }))
  await page.waitForSelector('.app-shell')
  const source = await page.evaluate(async () => {
    const project = (await window.api.projects.list()).data[0]
    return (await window.api.dictionary.suggestions(project.project_id)).data
  })
  check(new Set(source.map(entry => entry.id)).size === source.length, '字典源条目标识唯一')
  console.log(`字典源 ${source.length} 条；telephone ${source.filter(entry => entry.key === 'telephone').length} 条；同描述 ${source.filter(entry => entry.description === '电话号码').map(entry => entry.key).join(',')}`)
  await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
  await page.locator('.tab-add').click()
  await page.locator('.mode-row .segmented').getByText('调试', { exact: true }).click()
  await page.locator('.req-tabs').getByRole('tab', { name: 'Query', exact: true }).click()
  const description = page.locator('.design-param-row.is-tail .design-param-description input')
  await description.click()
  await page.waitForTimeout(250)
  check(await popup().count() === 0, '单击空描述只聚焦，不展开字典')
  await page.screenshot({ path: path.join(artifacts, 'empty-click.png') })
  await description.pressSequentially('e')
  const input = page.locator('.design-param-row:not(.is-tail) .design-param-description input').first()
  check(await popup().count() === 0, '描述输入文字也保持普通编辑')
  const row = page.locator('.design-param-row:not(.design-param-head):not(.is-tail)').first()
  const name = row.locator('input[aria-label="参数名"]')
  await name.click()
  await popup().waitFor()
  check(await popup().locator('.ant-select-item-option-content .mono').count() > 1, '参数名点击才展开字典建议')
  await name.pressSequentially('e')
  const holder = popup().locator('.rc-virtual-list-holder')
  await holder.hover()
  let duplicate = []
  for (const delta of [190, 190, 190, 190, -190, -190, -190, -190]) {
    await page.mouse.wheel(0, delta)
    await page.waitForTimeout(120)
    const keys = await popup().locator('[data-dictionary-id]').evaluateAll(nodes => nodes.map(node => node.dataset.dictionaryId))
    if (new Set(keys).size !== keys.length) { duplicate = keys; break }
  }
  check(duplicate.length === 0, `滚轮后每个建议条目保持独立${duplicate.length ? ': ' + duplicate.join(',') : ''}`)
  check(await input.inputValue() === 'e' && await name.inputValue() === 'e', '滚轮不会改写参数名和描述')
  await page.screenshot({ path: path.join(artifacts, 'scrolled.png') })
  await name.press('Escape')
  await popup().waitFor({ state: 'hidden' })
  check(await popup().count() === 0, 'Esc 收起参数名建议')
  const value = row.locator('.design-param-value input')
  await value.click(); await value.pressSequentially('abc')
  await popup().waitFor({ state: 'hidden' })
  check(await popup().count() === 0 && await value.inputValue() === 'abc', '参数值点击与输入不弹字典')
  await name.click(); await name.fill('page')
  await popup().locator('.mono').getByText('page', { exact: true }).click()
  check(await name.inputValue() === 'page' && await input.inputValue() === source.find(entry => entry.key === 'page').description, '选择字典项写入名称并覆盖描述')
  check(await value.inputValue() === '' && (await row.locator('.design-param-type').innerText()).includes('number'), '选择字典项同步类型与默认值')
  check(await page.locator('.design-param-row.is-tail').count() === 1 && await page.locator('.design-param-row:not(.design-param-head):not(.is-tail)').count() === 1, '一次选择保留单个数据行和单个空尾行')
  await input.click(); await input.fill('电话')
  await input.press('ControlOrMeta+A'); await input.press('Backspace')
  await popup().waitFor({ state: 'hidden' })
  check(await popup().count() === 0 && await input.inputValue() === '', '已有描述可以输入、全选、清空，不弹字典')
  await name.click(); await name.fill('email')
  await popup().locator('.mono').getByText('email', { exact: true }).click()
  await input.click()
  await popup().waitFor({ state: 'hidden' })
  check(await popup().count() === 0 && await input.inputValue() === '电子邮箱', '字典选中收起且再次点描述不展开')
  const openLibrary = async () => {
    await row.hover()
    await row.getByRole('button', { name: '描述助手 email', exact: true }).click()
    await page.getByRole('menuitem', { name: /字典库.*从字典库/ }).click()
    const library = page.getByRole('dialog', { name: '描述字典库', exact: true })
    await library.getByRole('option', { name: '电话号码', exact: true }).first().waitFor()
    return library
  }
  await value.fill('保持原值'); await input.fill('手工说明')
  let library = await openLibrary()
  check(await library.getByRole('button', { name: /替.*换/ }).isDisabled(), '未选择描述时替换按钮禁用')
  await library.getByRole('option', { name: '电话号码', exact: true }).first().click()
  await page.screenshot({ path: path.join(artifacts, 'description-library.png') })
  await library.getByRole('button', { name: /替.*换/ }).click()
  await library.waitFor({ state: 'hidden' })
  check(await input.inputValue() === '电话号码' && await name.inputValue() === 'email' && await value.inputValue() === '保持原值', '描述字典替换仅改变描述并关闭浮层')
  await input.fill('左右'); await input.press('ArrowLeft')
  library = await openLibrary()
  await library.getByRole('option', { name: '电话号码', exact: true }).last().click()
  await library.getByRole('button', { name: /插.*入/ }).click()
  check(await input.inputValue() === '左右电话号码', `字典插入按原型追加到末尾，实际：${await input.inputValue()}`)
  library = await openLibrary()
  await library.getByRole('button', { name: '关闭描述字典库', exact: true }).click()
  check(await input.inputValue() === '左右电话号码', '关闭字典不修改输入内容')
  library = await openLibrary()
  await library.getByRole('button', { name: '返回描述助手', exact: true }).click()
  await page.getByRole('menuitem', { name: /字典库.*从字典库/ }).waitFor()
  await value.click(); await page.locator('.ant-dropdown:visible').waitFor({ state: 'hidden' })
  library = await openLibrary()
  await library.getByRole('button', { name: '字典库管理' }).click()
  const manager = page.getByRole('dialog', { name: '字典库', exact: true })
  await manager.getByPlaceholder('搜索参数名称或参数描述').waitFor()
  await manager.getByRole('button', { name: /关.*闭/ }).click()
  await manager.waitFor({ state: 'hidden' })
  check(await page.getByLabel('参数描述 email', { exact: true }).inputValue() === '左右电话号码', '字典库管理入口可用且返回保留草稿')
  await page.locator('.save-btn').click()
  await page.reload(); await page.waitForSelector('.app-shell')
  await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
  await page.locator('.tree-node').filter({ hasText: '未命名接口' }).first().click()
  await page.locator('.mode-row .segmented').getByText('调试', { exact: true }).click()
  await page.locator('.req-tabs').getByRole('tab', { name: 'Query', exact: true }).click()
  check(await page.getByLabel('参数描述 email', { exact: true }).inputValue() === '左右电话号码', '参数描述保存后重开保持')
  for (const [index, [mode, section, bodyType]] of [
    ['设计', 'Header'], ['设计', 'Query'], ['设计', 'Body', 'form-data'], ['设计', 'Body', 'urlencoded'],
    ['调试', 'Header'], ['调试', 'Query'], ['调试', 'Body', 'form-data'], ['调试', 'Body', 'urlencoded'], ['调试', 'Cookie'], ['调试', 'Path']
  ].entries()) {
    await page.locator('.mode-row .segmented').getByText(mode, { exact: true }).click()
    if (section === 'Path') await page.locator('.url-input input').fill('http://127.0.0.1/verify/{id}')
    await page.locator('.req-tabs').getByRole('tab', { name: section, exact: true }).click()
    if (bodyType) await page.locator('.bodytypes .ant-radio-wrapper').filter({ hasText: bodyType }).click()
    const table = page.locator('.request-pane .design-param-table')
    const key = section === 'Path' ? 'id' : `check_${index}`
    if (section !== 'Path') {
      const field = table.locator('.is-tail input[aria-label="参数名"]')
      await field.click(); await field.pressSequentially(key)
    }
    const dataRows = table.locator('.design-param-row:not(.design-param-head):not(.is-tail)')
    const fieldRow = section === 'Path' ? dataRows.first() : dataRows.last()
    const fieldValue = fieldRow.getByLabel(`参数值 ${key}`, { exact: true })
    const fieldDescription = fieldRow.getByLabel(`参数描述 ${key}`, { exact: true })
    await fieldValue.click(); await fieldValue.pressSequentially('value')
    await fieldDescription.click(); await fieldDescription.pressSequentially('手动说明')
    await popup().waitFor({ state: 'hidden' })
    check(await fieldValue.inputValue() === 'value' && await fieldDescription.inputValue() === '手动说明', `${mode}/${section}${bodyType ? '/' + bodyType : ''} 名/值/描述实际点击输入`)
    if (section !== 'Path') { await fieldRow.getByRole('checkbox').uncheck(); await fieldRow.getByRole('checkbox').check() }
    await fieldRow.locator('.design-param-type').click()
    await popup().getByText('integer', { exact: true }).click()
    await fieldRow.getByRole('button', { name: `必填 ${key}`, exact: true }).click()
    await fieldRow.getByRole('button', { name: '字段规则', exact: true }).click()
    const rules = page.getByRole('dialog', { name: '字段说明与规则' })
    await rules.locator('textarea').first().fill('规则内说明')
    await rules.getByRole('button', { name: /保.*存/ }).click()
    await rules.waitFor({ state: 'hidden' })
    check(await fieldDescription.inputValue() === '规则内说明', `${mode}/${section} 类型/必填/规则编辑可用`)
    if (section !== 'Path') {
      const count = await dataRows.count()
      await fieldRow.hover(); await fieldRow.getByRole('button', { name: `复制参数 ${key}`, exact: true }).click()
      check(await dataRows.count() === count + 1, `${mode}/${section} 复制参数`)
      await dataRows.last().hover(); await dataRows.last().getByRole('button', { name: `删除参数 ${key}`, exact: true }).click()
      check(await dataRows.count() === count, `${mode}/${section} 删除副本`)
    }
  }
  await page.evaluate(async () => {
    const projectId = (await window.api.projects.list()).data[0].project_id
    for (const [description, default_value] of [['同名甲', 'alpha'], ['同名乙', 'beta']]) {
      const result = await window.api.dictionary.save(projectId, { id: '', project_id: projectId, key: 'same_key', description, default_value, field_type: 'string', created_at: '', updated_at: '' })
      if (!result.ok) throw Error(result.error)
    }
  })
  // Re-enter the module so its cache is loaded after the external dictionary edits.
  await page.locator('.rail-btn').filter({ hasText: '字典' }).click()
  await page.locator('.schema-nav-row').filter({ hasText: '数据字典' }).click()
  await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
  await page.locator('.req-tabs').getByRole('tab', { name: 'Query', exact: true }).click()
  const duplicatedName = page.locator('.design-param-row.is-tail input[aria-label="参数名"]')
  await duplicatedName.fill('same_key')
  let sameRow = page.locator('.design-param-row').filter({ has: page.locator('input[aria-label="参数名"][value="same_key"]') })
  await sameRow.locator('input[aria-label="参数名"]').click()
  await popup().getByText('同名甲', { exact: true }).click()
  check(await sameRow.getByLabel('参数值 same_key', { exact: true }).inputValue() === 'alpha', '同名条目选甲使用甲的默认值')
  await sameRow.locator('input[aria-label="参数名"]').click()
  await popup().getByText('同名乙', { exact: true }).click()
  check(await sameRow.getByLabel('参数值 same_key', { exact: true }).inputValue() === 'beta', '同名条目选乙使用乙的默认值，不串行')
  // 模型描述仍支持按文字联想，保留同描述不同条目的虚拟滚动回归。
  await page.locator('.rail-btn').filter({ hasText: '字典' }).click()
  await page.locator('.schemas-new').click()
  await page.getByRole('menuitem', { name: /新建数据模型/ }).click()
  const rootDescription = page.getByPlaceholder('模型根节点描述')
  await rootDescription.click(); await rootDescription.pressSequentially('e')
  await popup().waitFor()
  await popup().locator('.rc-virtual-list-holder').hover()
  let modelDuplicates = false
  for (const delta of [190, 190, -190, -190]) {
    await page.mouse.wheel(0, delta); await page.waitForTimeout(120)
    const keys = await popup().locator('[data-dictionary-id]').evaluateAll(nodes => nodes.map(node => node.dataset.dictionaryId))
    modelDuplicates ||= new Set(keys).size !== keys.length
  }
  check(!modelDuplicates, '共用字典组件中同描述的 telephone/tel 在模型联想滚轮下也保持独立')
  await rootDescription.press('Escape')
  assert.deepEqual(failures, [])
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close() }
  fs.rmSync(userData, { recursive: true, force: true })
})
