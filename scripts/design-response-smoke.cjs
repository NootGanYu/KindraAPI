/** Focused response-design checks. Launches only a throwaway Electron profile. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-design-response-'))
const artifacts = path.join(__dirname, '.ui-artifacts', 'design-response')
const errors = []
let app, page, response, projectId, targetId

async function saved() {
  return page.evaluate(async ({ projectId, targetId }) => {
    const result = await window.api.targets.get(projectId, targetId)
    if (!result.ok) throw Error(result.error)
    return result.data
  }, { projectId, targetId })
}

async function settle(check, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw Error(`Timed out: ${description}`)
}

async function save(check, description) {
  await page.locator('.save-btn').click()
  await settle(async () => check((await saved()).response.example), description)
}

async function tab(name) {
  await response.getByRole('tab', { name, exact: true }).click()
}

async function select(control, label) {
  // Match the actual Select container, not ant-select-selection-search/selector.
  const container = control.locator('xpath=ancestor-or-self::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]')
  await container.click()
  await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).last().click()
}

async function shot(name) {
  await page.locator('.ant-message-notice').last().waitFor({ state: 'hidden' })
  await response.screenshot({ path: path.join(artifacts, `${name}.png`), animations: 'disabled' })
}

function item(name) {
  return response.locator('.resp-expect-item').filter({
    has: page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^${name}（`) })
  })
}

async function openTool(name) {
  await response.locator('.response-body-tools').getByRole('button', { name: new RegExp(`${name}$`) }).click()
  const modal = page.locator('.ant-modal:visible')
  await modal.waitFor()
  await modal.evaluate(async element => {
    await Promise.allSettled(element.getAnimations().map(animation => animation.finished))
  })
  return modal
}

async function closeTool(modal) {
  await modal.locator('.ant-modal-close').click()
  await modal.waitFor({ state: 'hidden' })
}

async function applyTool(modal) {
  await modal.getByRole('button', { name: /确.*定/ }).click()
  await modal.waitFor({ state: 'hidden' })
}

async function modalShot(modal, name) {
  await page.locator('.ant-message-notice').last().waitFor({ state: 'hidden' })
  await modal.screenshot({ path: path.join(artifacts, `${name}.png`), animations: 'disabled' })
}

async function bodyTools() {
  await tab('Body')
  const schema = {
    type: 'object', required: ['message', 'items'], properties: {
      message: { type: 'string', default: 'seed', description: 'Response message' },
      items: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'integer', default: 7 } } } }
    }
  }
  let modal = await openTool('Raw编辑')
  const schemaInput = modal.getByRole('textbox', { name: '响应 JSON Schema', exact: true })
  await schemaInput.fill('{broken')
  await modal.getByRole('button', { name: /确.*定/ }).click()
  await modal.getByRole('alert').waitFor()
  assert.equal(await modal.isVisible(), true, 'invalid Raw schema must not close or apply')
  await schemaInput.fill(JSON.stringify(schema))
  await applyTool(modal)
  await save(examples => examples[0]?.raw?.includes('seed'), 'apply Raw schema with nested arrays and defaults')
  let example = (await saved()).response.example[0]
  assert.deepEqual(JSON.parse(example.raw), { message: 'seed', items: [{ id: 7 }] })
  assert.equal(example.field_docs.find(doc => doc.pointer === '/message').required, true)
  assert.equal(example.field_docs.find(doc => doc.pointer === '/items/*/id').default, 7)
  assert.equal(example.headers[0].value, 'trace-fixture')
  await response.getByRole('button', { name: '根节点可空', exact: true }).click()
  await response.getByRole('textbox', { name: '根节点描述', exact: true }).fill('Response envelope')
  await save(examples => examples[0]?.field_docs?.some(doc => doc.pointer === '' && doc.nullable === true && doc.description === 'Response envelope'), 'persist response root rules')
  await response.locator('.design-body-toolbar').getByText('示例', { exact: true }).click()
  await response.locator('.design-body-toolbar').getByText('数据结构', { exact: true }).click()
  assert.equal(await response.getByRole('button', { name: '根节点可空', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await response.getByRole('textbox', { name: '根节点描述', exact: true }).inputValue(), 'Response envelope')
  example = (await saved()).response.example[0]
  await shot('body')

  const beforePreview = structuredClone(example)
  modal = await openTool('预览')
  await settle(async () => (await modal.locator('.response-tool-preview').textContent()).includes('seed'), 'load generated preview')
  await modal.getByText('数据结构', { exact: true }).click()
  assert.ok((await modal.locator('.response-tool-preview').textContent()).includes('properties'))
  await modal.getByText('示例预览', { exact: true }).click()
  await modalShot(modal, 'preview')
  await closeTool(modal)
  await save(examples => JSON.stringify(examples[0]) === JSON.stringify(beforePreview), 'preview leaves the draft unchanged')
  console.log('PASS Raw schema validation, array/default generation and read-only structure/example preview')

  await response.locator('.design-body-toolbar').getByText('示例', { exact: true }).click()
  await response.getByRole('textbox', { name: '响应示例 JSON', exact: true }).fill('{"message":"seed","items":[{"id":7},{"id":8}]}')
  await response.locator('.design-body-toolbar').getByText('数据结构', { exact: true }).click()
  await response.getByRole('button', { name: '删除字段 items[].id', exact: true }).click()
  const removeArrayField = page.locator('.ant-modal-confirm:visible')
  await removeArrayField.getByRole('button', { name: /删.*除/ }).click()
  await removeArrayField.waitFor({ state: 'hidden' })
  await save(examples => JSON.parse(examples[0].raw).items.every(item => !Object.hasOwn(item, 'id')), 'delete the field from every array item')
  assert.deepEqual(JSON.parse((await saved()).response.example[0].raw).items, [{}, {}])
  assert.equal((await saved()).response.example[0].field_docs.some(doc => doc.pointer === '/items/*/id'), false)
  console.log('PASS array-object field deletion removes each value and its field rules')

  modal = await openTool('智能导入')
  let input = modal.getByRole('textbox', { name: '导入响应结构', exact: true })
  await input.fill('{"message":"incoming","extra":true}')
  await modal.getByRole('button', { name: /格.*式.*化/ }).click()
  assert.ok((await input.inputValue()).includes('\n'))
  await modal.getByRole('button', { name: /预.*览/ }).click()
  await settle(async () => (await modal.locator('.response-tool-preview').textContent()).includes('properties'), 'preview JSON import')
  await modalShot(modal, 'import')
  await applyTool(modal)
  await save(examples => examples[0]?.raw?.includes('incoming'), 'merge imported JSON')
  example = (await saved()).response.example[0]
  assert.deepEqual(JSON.parse(example.raw), { message: 'incoming', items: [{}, {}], extra: true })
  const preserved = example.field_docs.find(doc => doc.pointer === '/message')
  assert.equal(preserved.required, true)
  assert.equal(preserved.default, 'seed')
  assert.equal(preserved.description, 'Response message')

  modal = await openTool('智能导入')
  input = modal.getByRole('textbox', { name: '导入响应结构', exact: true })
  await input.fill('{"replaced":1}')
  await select(modal.getByRole('combobox', { name: '导入覆盖模式', exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select")][1]'), '完全覆盖')
  await applyTool(modal)
  await save(examples => examples[0]?.raw?.includes('replaced'), 'replace with imported JSON')
  example = (await saved()).response.example[0]
  assert.deepEqual(JSON.parse(example.raw), { replaced: 1 })
  assert.equal(example.field_docs.some(doc => doc.pointer === '/message'), false)

  modal = await openTool('智能导入')
  await modal.getByText('JSON Schema', { exact: true }).click()
  await modal.getByRole('textbox', { name: '导入响应结构', exact: true }).fill(JSON.stringify({
    type: 'object', required: ['ok'], properties: {
      ok: { type: 'boolean', default: true },
      count: { type: 'integer', default: 2, description: 'Total count' }
    }
  }))
  await select(modal.getByRole('combobox', { name: '导入覆盖模式', exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select")][1]'), '完全覆盖')
  await applyTool(modal)
  await save(examples => examples[0]?.raw?.includes('count'), 'import JSON Schema and generate its defaults')
  example = (await saved()).response.example[0]
  assert.deepEqual(JSON.parse(example.raw), { ok: true, count: 2 })
  assert.equal(example.field_docs.find(doc => doc.pointer === '/ok').required, true)
  assert.equal(example.field_docs.find(doc => doc.pointer === '/count').default, 2)
  assert.equal(example.field_docs.some(doc => doc.pointer === '/replaced'), false)
  console.log('PASS import format/preview, JSON merge preserving rules, JSON replacement and JSON Schema import')

  modal = await openTool('生成代码')
  await settle(async () => (await modal.locator('.response-tool-preview').textContent()).includes('export type Response'), 'generate TypeScript model')
  await modal.locator('#response-model-name').fill('9invalid')
  await modal.getByRole('alert').filter({ hasText: 'TypeScript' }).waitFor()
  assert.equal(await modal.getByRole('button', { name: /复.*制/ }).isDisabled(), true)
  assert.equal(await modal.getByRole('button', { name: /下.*载/ }).isDisabled(), true)
  await modal.locator('#response-model-name').fill('class')
  await modal.getByRole('alert').filter({ hasText: 'TypeScript' }).waitFor()
  assert.equal(await modal.getByRole('button', { name: /复.*制/ }).isDisabled(), true, 'reserved TypeScript names cannot be copied')
  assert.equal((await modal.locator('.response-tool-preview').textContent()).trim(), '', 'reserved names cannot generate invalid declarations')
  await modal.locator('#response-model-name').fill('ResultEnvelope')
  const code = await modal.locator('.response-tool-preview').textContent()
  assert.ok(code.includes('export type ResultEnvelope'))
  assert.ok(code.includes('"ok": boolean'))
  assert.ok(code.includes('"count"?: number'))
  await modalShot(modal, 'code')
  await closeTool(modal)

  await response.locator('.design-body-toolbar').getByText('示例', { exact: true }).click()
  const raw = response.getByRole('textbox', { name: '响应示例 JSON', exact: true })
  await raw.fill('{"ok":true,"count":9}')
  await response.locator('.response-body-tools').getByRole('button', { name: '美化', exact: true }).click()
  assert.ok((await raw.inputValue()).includes('\n'))
  await response.getByRole('button', { name: '示例更多', exact: true }).click()
  await page.getByRole('menuitem', { name: '简化', exact: true }).click()
  assert.equal(await raw.inputValue(), '{"ok":true,"count":9}')
  await response.getByRole('button', { name: '示例更多', exact: true }).click()
  await page.getByRole('menuitem', { name: '查找替换', exact: true }).click()
  modal = page.locator('.ant-modal:visible')
  await modal.locator('#response-find').fill('9')
  await modal.locator('#response-replace').fill('12')
  await modal.getByRole('button', { name: /全部替换/ }).click()
  await closeTool(modal)
  assert.equal(JSON.parse(await raw.inputValue()).count, 12)
  await response.locator('.response-body-tools').getByRole('button', { name: '从数据结构生成示例', exact: true }).click()
  await settle(async () => JSON.parse(await raw.inputValue()).count === 2, 'regenerate from field rules')
  await save(examples => JSON.parse(examples[0].raw).count === 2, 'persist generated example')
  assert.equal((await saved()).response.example[0].field_docs.find(doc => doc.pointer === '/count').default, 2)
  await response.locator('.response-body-tools').getByRole('button', { name: /复制$/ }).click()
  await page.getByText('已复制', { exact: true }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.__designResponseCopiedText), await raw.inputValue(), 'copy IPC receives the complete example')
  console.log('PASS TypeScript name validation/output, example format/minify/search/replace/generate/copy')
}

async function modelReference() {
  const before = (await saved()).response.example[0]
  const modelId = await page.evaluate(async projectId => {
    const created = await window.api.models.create(projectId, '0', 'model')
    if (!created.ok) throw Error(created.error)
    const model = created.data
    model.name = 'Regression response model'
    model.data.schema = {
      type: 'object', required: ['linked'], properties: {
        linked: { type: 'string', default: 'model-value', description: 'Linked field' }
      }
    }
    const result = await window.api.models.save(projectId, model)
    if (!result.ok) throw Error(result.error)
    return model.model_id
  }, projectId)
  await tab('Body')
  await response.locator('.design-body-toolbar').getByText('示例', { exact: true }).click()
  await response.getByRole('button', { name: '引用模型', exact: true }).click()
  const picker = page.locator('.ant-modal:visible').filter({ hasText: '选择响应示例模型' })
  await picker.locator('.model-picker-row').filter({ hasText: 'Regression response model' }).click()
  await picker.waitFor({ state: 'hidden' })
  await save(examples => examples[0]?.expect?.model_id === modelId, 'link the response model')
  const linked = (await saved()).response.example[0]
  assert.equal(linked.example_id, before.example_id)
  assert.equal(linked.expect.name, before.expect.name, 'async model selection preserves the expectation name')
  assert.equal(linked.expect.code, before.expect.code)
  assert.equal(linked.expect.sleep, before.expect.sleep)
  assert.equal(linked.expect.is_default, before.expect.is_default)
  assert.deepEqual(linked.headers, before.headers)
  assert.deepEqual(JSON.parse(linked.raw), { linked: 'model-value' })
  const raw = response.getByRole('textbox', { name: '响应示例 JSON', exact: true })
  assert.notEqual(await raw.getAttribute('readonly'), null)
  assert.equal(await response.locator('.response-body-tools').getByRole('button', { name: '从数据结构生成示例', exact: true }).isDisabled(), true)
  await response.locator('.design-body-toolbar').getByText('数据结构', { exact: true }).click()
  assert.equal(await response.locator('.response-body-tools').getByRole('button', { name: 'Raw编辑', exact: true }).isDisabled(), true)
  assert.equal(await response.locator('.response-body-tools').getByRole('button', { name: /智能导入$/ }).isDisabled(), true)
  assert.equal(await response.getByRole('button', { name: '添加根字段', exact: true }).isDisabled(), true)
  await response.locator('.design-body-toolbar').getByText('示例', { exact: true }).click()
  await response.getByRole('button', { name: '解除引用', exact: true }).click()
  await save(examples => !examples[0]?.expect?.model_id, 'detach without losing the generated response')
  const detached = (await saved()).response.example[0]
  assert.equal(await raw.getAttribute('readonly'), null)
  assert.equal(detached.raw, linked.raw)
  assert.deepEqual(detached.field_docs, linked.field_docs)
  assert.deepEqual(detached.headers, before.headers)
  assert.equal(detached.expect.name, before.expect.name)
  assert.equal(detached.expect.code, before.expect.code)
  assert.equal(detached.expect.sleep, before.expect.sleep)
  console.log('PASS model selection preserves expectation metadata; linked editors are locked; detach retains body/docs/headers')
}

async function fieldInteractions() {
  await tab('Body')
  await response.locator('.design-body-toolbar').getByText('数据结构', { exact: true }).click()
  await response.locator('.json-field-name-button[title="count"]').click()
  const rename = response.getByRole('textbox', { name: '字段名称 count', exact: true })
  await rename.fill('total')
  await rename.press('Enter')
  await save(examples => JSON.parse(examples[0].raw).total === 2, 'rename the field and its stored value')
  let example = (await saved()).response.example[0]
  assert.equal(Object.hasOwn(JSON.parse(example.raw), 'count'), false)
  assert.equal(example.field_docs.find(doc => doc.pointer === '/total').default, 2)
  assert.equal(example.field_docs.some(doc => doc.pointer === '/count'), false)

  await response.getByRole('button', { name: '添加相邻字段 ok', exact: true }).click()
  const add = page.locator('.ant-modal:visible')
  await add.getByPlaceholder('user.name 或 items[].id').fill('note')
  await add.getByRole('button', { name: /添.*加/ }).click()
  await add.waitFor({ state: 'hidden' })
  await save(examples => examples[0].field_docs.some(doc => doc.pointer === '/note'), 'persist adjacent field')
  assert.deepEqual(await response.locator('.json-field-name-button').allTextContents(), ['ok', 'note', 'total'], 'adjacent add inserts after the selected sibling')

  // Exercise the native HTML drag handlers, including the source transfer data.
  await response.evaluate(container => {
    const source = container.querySelector('[aria-label="拖拽字段 total"]')
    const destination = container.querySelector('[aria-label="拖拽字段 ok"]').closest('.json-field-row')
    const dataTransfer = new DataTransfer()
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    destination.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
  })
  await settle(async () => (await response.locator('.json-field-name-button').allTextContents())[0] === 'total', 'apply sibling drag order')
  await save(examples => examples[0].field_docs.find(doc => doc.pointer === '/total')?.order === 0, 'persist sibling drag order')
  example = (await saved()).response.example[0]
  assert.equal(example.field_docs.find(doc => doc.pointer === '/ok').order, 1)
  assert.equal(example.field_docs.find(doc => doc.pointer === '/note').order, 2)
  let modal = await openTool('Raw编辑')
  const projected = JSON.parse(await modal.getByRole('textbox', { name: '响应 JSON Schema', exact: true }).inputValue())
  assert.deepEqual(Object.keys(projected.properties), ['total', 'ok', 'note'], 'exported schema follows the persisted sibling order')
  await closeTool(modal)

  await response.getByRole('button', { name: '删除字段 total', exact: true }).click()
  const confirm = page.locator('.ant-modal-confirm:visible')
  await confirm.getByRole('button', { name: /删.*除/ }).click()
  await confirm.waitFor({ state: 'hidden' })
  await save(examples => !Object.hasOwn(JSON.parse(examples[0].raw), 'total'), 'delete actual field value and rules')
  example = (await saved()).response.example[0]
  assert.equal(example.field_docs.some(doc => doc.pointer === '/total'), false)

  await response.locator('.design-body-toolbar').getByText('示例', { exact: true }).click()
  const rawBefore = example.raw
  modal = await openTool('字段描述')
  const okRow = modal.locator('.json-field-name [title="ok"]').locator('xpath=ancestor::div[contains(@class,"json-field-row")]')
  await okRow.locator('.json-field-desc textarea').fill('Confirmed status')
  await modal.getByRole('button', { name: /重新提取/ }).click()
  assert.equal(await okRow.locator('.json-field-desc textarea').inputValue(), 'Confirmed status')
  const docOnlyRow = modal.locator('.json-field-row').filter({ has: page.locator('.json-field-name [title="note"]') })
  assert.equal(await docOnlyRow.locator('.json-field-value input').inputValue(), '', 'a documentation-only field starts with a blank value, not the text undefined')
  await modalShot(modal, 'field-descriptions')
  await modal.getByRole('button', { name: /关.*闭/, exact: false }).last().click()
  await modal.waitFor({ state: 'hidden' })
  await save(examples => examples[0].field_docs.find(doc => doc.pointer === '/ok')?.description === 'Confirmed status', 'persist extracted field descriptions')
  example = (await saved()).response.example[0]
  assert.equal(example.raw, rawBefore)
  assert.equal(example.field_docs.find(doc => doc.pointer === '/ok').required, true)
  assert.equal(example.field_docs.find(doc => doc.pointer === '/ok').default, true)
  console.log('PASS field rename, adjacent insertion, sibling drag/export order, deletion and description extraction preserving rules')
}

async function addExpectation(name, code = '200', format = 'JSON') {
  await response.locator('.resp-expect-add').click()
  const form = page.locator('.response-new-expect:visible')
  await form.locator('#new-expect-name').fill(name)
  await select(form.locator('#new-expect-content-type').locator('xpath=ancestor::div[contains(@class,"ant-select")][1]'), format)
  await form.locator('#new-expect-code').fill(code)
  // Move focus within the popover so status suggestions cannot cover its next control.
  await form.locator('#new-expect-name').click()
  await form.getByRole('button', { name: /确.*定/ }).click()
  await form.waitFor({ state: 'hidden' })
  await settle(() => item(name).locator('button[aria-pressed="true"]').count(), `select new expectation ${name}`)
}

async function deleteExpectation(name) {
  await item(name).hover()
  await item(name).getByRole('button', { name: `删除期望 ${name}`, exact: true }).click()
  const confirm = page.locator('.ant-modal-confirm:visible')
  await confirm.getByRole('button', { name: /删.*除/ }).click()
  await confirm.waitFor({ state: 'hidden' })
  await item(name).waitFor({ state: 'detached' })
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true })
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    env: { ...process.env, KINDRAAPI_USER_DATA: userData, KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1' }
  })
  page = await app.firstWindow()
  // An isolated profile still shares the OS clipboard. Capture this test app's
  // clipboard writes in memory while exercising its real renderer-to-main IPC.
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = text => { globalThis.__designResponseCopiedText = text }
  })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForSelector('.app-shell')
  await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
  await page.locator('.tab-add').click()
  await page.locator('.url-input input').waitFor()
  const ids = await page.evaluate(async () => {
    const project = (await window.api.projects.list()).data[0]
    const target = (await window.api.targets.list(project.project_id)).data.find(item => item.target_type === 'api')
    return { projectId: project.project_id, targetId: target.target_id }
  })
  projectId = ids.projectId
  targetId = ids.targetId
  response = page.locator('.design-response')
  await response.scrollIntoViewIfNeeded()
  assert.equal(await response.locator('.resp-expect-item').count(), 0)
  await addExpectation('成功')
  await save(examples => examples.length === 1, 'persist the first expectation')
  const firstId = (await saved()).response.example[0].example_id
  assert.equal((await saved()).response.example[0].expect.is_default, 1)

  await tab('Header')
  await response.locator('.design-param-row.is-tail').getByLabel('参数名', { exact: true }).fill('X-Trace-Id')
  const header = response.locator('.design-param-row:not(.design-param-head):not(.is-tail)')
  await header.getByRole('textbox', { name: '参数值 X-Trace-Id', exact: true }).fill('trace-fixture')
  await header.getByRole('button', { name: '必有 X-Trace-Id', exact: true }).click()
  await save(examples => examples[0]?.headers?.[0]?.value === 'trace-fixture', 'persist response Header')
  assert.equal((await saved()).response.example[0].headers[0].required, true)
  await shot('header')
  console.log('PASS empty state, anchored creation, stable selection and response Header persistence')

  await tab('期望设置')
  await response.locator('#expect-name').fill('成功响应')
  await response.locator('#expect-code').fill('201')
  await response.locator('#expect-sleep').fill('125')
  await save(examples => examples[0]?.expect?.sleep === 125, 'persist direct expectation settings')
  let first = (await saved()).response.example[0]
  assert.equal(first.example_id, firstId)
  assert.equal(first.expect.name, '成功响应')
  assert.equal(first.expect.code, 201)
  assert.equal(first.headers[0].value, 'trace-fixture')

  await response.locator('#expect-code').fill('999')
  await response.getByRole('alert').filter({ hasText: 'HTTP 状态码' }).waitFor()
  await tab('Header')
  await page.getByText('HTTP 状态码应为 100–599 的整数', { exact: true }).waitFor()
  await tab('期望设置')
  assert.equal(await response.locator('#expect-code').inputValue(), '201')
  await response.locator('#expect-sleep').fill('-1')
  await response.getByRole('alert').filter({ hasText: '返回延迟' }).waitFor()
  await tab('Header')
  await page.getByText('返回延迟应为非负整数（ms）', { exact: true }).waitFor()
  await tab('期望设置')
  assert.equal(await response.locator('#expect-sleep').inputValue(), '125')
  await save(examples => examples[0]?.expect?.code === 201 && examples[0]?.expect?.sleep === 125, 'reject invalid settings')
  await shot('settings')
  console.log('PASS direct settings, status/delay validation, invalid-input restoration and saved metadata')

  await tab('Body')
  await response.getByRole('button', { name: '添加根字段', exact: true }).click()
  const add = page.locator('.ant-modal:visible')
  await add.getByPlaceholder('user.name 或 items[].id').fill('name')
  await add.getByRole('button', { name: /添.*加/ }).click()
  await add.waitFor({ state: 'hidden' })
  await response.locator('.json-field-name [title="name"]').waitFor()
  await shot('body')
  await select(response.locator('.json-root-type'), 'array')
  const rootConfirm = page.locator('.ant-modal-confirm:visible')
  await rootConfirm.getByRole('button', { name: /切.*换/ }).click()
  await rootConfirm.waitFor({ state: 'hidden' })
  await save(examples => examples[0]?.raw === '[]' && examples[0]?.field_docs?.some(doc => doc.pointer === '/*'), 'apply raw and field_docs in one root-type action')
  assert.equal((await saved()).response.example[0].field_docs.some(doc => doc.pointer === '/name'), false)
  assert.equal((await saved()).response.example[0].headers[0].value, 'trace-fixture')
  console.log('PASS root type change preserves both sequential raw and field_docs patches')

  await bodyTools()
  await fieldInteractions()
  await modelReference()

  await addExpectation('未找到', '404', 'XML')
  assert.equal(await response.locator('.resp-expect-item').count(), 2)
  assert.equal(await response.locator('.json-field-panel').count(), 0, 'XML uses text editing instead of a JSON structure error')
  const raw = response.getByRole('textbox', { name: '响应示例 JSON', exact: true })
  await raw.fill('<error>missing</error>')
  await save(examples => examples.length === 2 && examples[1]?.raw === '<error>missing</error>', 'persist XML expectation')
  const secondId = (await saved()).response.example[1].example_id
  assert.equal((await saved()).response.example[1].expect.content_type, 'application/xml')
  assert.equal((await saved()).response.example[0].example_id, firstId)
  await shot('body-xml')

  await tab('期望设置')
  await response.getByRole('button', { name: '设为默认', exact: true }).click()
  await save(examples => examples[1]?.expect?.is_default === 1, 'set the second expectation as default')
  assert.equal((await saved()).response.example.filter(item => item.expect.is_default === 1).length, 1)
  await deleteExpectation('成功响应')
  assert.equal(await item('未找到').locator('button[aria-pressed="true"]').count(), 1, 'deleting another expectation preserves current selection')
  await save(examples => examples.length === 1 && examples[0]?.example_id === secondId, 'delete the nonselected expectation')
  assert.equal(await item('未找到').locator('.resp-expect-delete').count(), 0, 'the last expectation cannot be deleted')
  assert.equal((await saved()).response.example[0].expect.is_default, 1)
  assert.deepEqual(errors, [], 'no renderer exceptions')
  console.log('PASS XML text editing, unique default, nonselected deletion and protection of the last expectation')
  console.log(`Artifacts: ${artifacts}`)
}

main().catch(async error => {
  console.error(error)
  if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  process.exitCode = 1
}).finally(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {})
    await app.close()
  }
  fs.rmSync(userData, { recursive: true, force: true })
})
