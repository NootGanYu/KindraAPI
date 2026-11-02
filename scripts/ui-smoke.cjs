/**
 * UI automation for the dictionary module.
 * Requires `npm run build` first. Uses Playwright's Electron driver with an
 * isolated temporary userData directory.
 */
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const createAedes = require('aedes')
const { _electron: electron } = require('playwright-core')

const ARTIFACTS = path.join(__dirname, '.ui-artifacts')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindraapi-ui-'))
const logs = []
let app = null
let page = null
let mqttBroker = null

function log(message) {
  const line = `${new Date().toISOString()} ${message}`
  logs.push(line)
  process.stdout.write(`${line}\n`)
}

async function waitText(text, timeout = 10000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout })
}

function confirmModal() {
  return page.locator('.ant-modal-confirm:visible').last()
}

function visibleModal(text) {
  return page.locator('.ant-modal:visible').filter({ hasText: text })
}

function btn(scope, name) {
  return scope.getByRole('button', { name: new RegExp([...name].join('\\s*')) })
}

function btnExact(name) {
  // antd 图标会为按钮贡献 aria-label，例如 "save 保存"；用末尾匹配避免误伤
  // "测试连接" 与 "连接"。
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return page.getByRole('button', { name: new RegExp(`(^|\\s)${escaped}$`) })
}

function startMqttBroker() {
  const broker = createAedes()
  broker.authenticate = (_client, username, password, done) => {
    if (username === 'tester' && password?.toString() === 'secret') {
      done(null, true)
      return
    }
    done(Object.assign(new Error('bad credentials'), { returnCode: 4 }), false)
  }
  const server = net.createServer(broker.handle)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            broker.close(() => server.close(() => done()))
          })
      })
    })
  })
}

async function clickText(text, options = {}) {
  const locator =
    options.scope ??
    page
  await locator.getByText(text, { exact: options.exact ?? false }).first().click()
}

async function step(name, fn) {
  try {
    log(`STEP ${name}`)
    await fn()
    log(`PASS ${name}`)
  } catch (error) {
    const slug = name.replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    try {
      await page.screenshot({ path: path.join(ARTIFACTS, `${slug}.png`), fullPage: true })
      fs.writeFileSync(path.join(ARTIFACTS, `${slug}.log`), logs.join('\n'))
    } catch {
      // best effort
    }
    throw new Error(`[${name}] ${error.message}`)
  }
}

async function openSchemas() {
  await page.locator('.rail-btn').filter({ hasText: '字典' }).click()
  await waitText('数据字典与模型')
}

async function pickModel(name, title = null) {
  const modal = title
    ? page.locator('.ant-modal:visible').filter({ hasText: title })
    : page.locator('.ant-modal:visible').filter({ has: page.locator('.model-picker-row') })
  await modal.locator('.model-picker-row').filter({ hasText: name }).first().click()
  // 等待关闭动画结束，避免下一次选择命中仍在动画中的旧弹窗。
  await page.waitForTimeout(450)
}

async function revealModel(name) {
  if (await page.locator('.schema-tree-row').filter({ hasText: name }).count()) return
  const folder = page.locator('.schema-tree-row').filter({ hasText: 'UI 目录' }).first()
  if (await folder.count()) {
    await folder.locator('.schema-tree-toggle').click()
    await page.waitForTimeout(300)
  }
}

async function treeMenu(modelText, itemText) {
  const row = page.locator('.schema-tree-row').filter({ hasText: modelText }).first()
  await row.hover()
  await row.locator('.schema-tree-more').click()
  await page.locator('.ant-dropdown:visible').getByText(itemText, { exact: true }).click()
}

async function dragRowTo(sourceText, targetText) {
  await page.evaluate(
    async ({ sourceText, targetText }) => {
      const rows = [...document.querySelectorAll('.schema-tree-row')]
      const source = rows.find((row) => row.textContent?.includes(sourceText))
      const target = rows.find((row) => row.textContent?.includes(targetText))
      if (!source || !target) throw new Error('drag rows not found')
      const transfer = new DataTransfer()
      transfer.setData('text/plain', sourceText)
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
      // 等待 React 提交 draggingId，再触发 drop。
      await new Promise((resolve) => setTimeout(resolve, 200))
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })
      )
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      )
    },
    { sourceText, targetText }
  )
  await page.waitForTimeout(600)
}

async function chooseFolder(folderName) {
  const modal = visibleModal('目录')
  await modal.locator('.ant-select').click()
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText(folderName, { exact: true })
    .first()
    .click()
  await btn(modal, '确定').click()
  await page.waitForTimeout(450)
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true })
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    env: {
      ...process.env,
      KINDRAAPI_USER_DATA: userData,
      KINDRAAPI_DISABLE_SINGLE_INSTANCE: '1',
      ELECTRON_ENABLE_LOGGING: '1'
    }
  })
  page = await app.firstWindow()
  page.on('console', (message) => logs.push(`[console:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`))
  await page.waitForSelector('.app-shell', { timeout: 20000 })
  await waitText('KindraAPI')

  await step('导航到字典模块', async () => {
    await openSchemas()
    await page.locator('.schemas-card').filter({ hasText: '数据字典管理' }).waitFor()
    await page.locator('.schemas-card').filter({ hasText: '新建数据模型' }).waitFor()
    await page.locator('.schemas-card').filter({ hasText: '数据库管理' }).waitFor()
  })

  await step('系统内置字典、搜索与分页', async () => {
    await page.locator('.schemas-card').filter({ hasText: '数据字典管理' }).click()
    await waitText('自定义')
    await page.locator('.segmented button').filter({ hasText: '系统内置' }).click()
    await waitText('开启系统内置描述')
    await waitText('共 19 条')
    const pageRow = page.locator('.ant-table-tbody tr').filter({ hasText: 'page' }).first()
    await pageRow.waitFor()
    if (!(await pageRow.getByText('number').count())) throw new Error('page 未显示 number 徽标')
    const search = page.getByPlaceholder('搜索参数名称或参数描述')
    await search.fill('邮箱')
    await waitText('email')
    await search.fill('')
    await page.locator('.ant-pagination-item-2').click()
    await page.waitForTimeout(250)
    const rows = await page.locator('.ant-table-tbody tr.ant-table-row').count()
    if (rows !== 9) throw new Error(`第 2 页应有 9 行，实际 ${rows}`)
    await page.locator('.ant-pagination-item-1').click()
    await page.locator('.dict-switch .ant-switch').click()
    await page.waitForTimeout(200)
    await page.locator('.dict-switch .ant-switch').click()
  })

  await step('自定义字典 CRUD', async () => {
    await page.locator('.segmented button').filter({ hasText: '自定义' }).click()
    await clickText('新建字段描述')
    const modal = visibleModal('新建字段描述')
    await modal.getByPlaceholder('例如 user_id').fill('ui_field')
    await modal.getByPlaceholder('例如 用户 ID').fill('界面字段描述')
    await btn(modal, '新建').click()
    await waitText('ui_field')
    const row = page.locator('.ant-table-tbody tr').filter({ hasText: 'ui_field' }).first()
    await row.locator('.icon-btn').first().click()
    const editModal = visibleModal('编辑字段描述')
    await editModal.getByPlaceholder('例如 用户 ID').fill('界面字段描述-已更新')
    await btn(editModal, '保存').click()
    await waitText('界面字段描述-已更新')
    const updated = page.locator('.ant-table-tbody tr').filter({ hasText: 'ui_field' }).first()
    await updated.locator('.icon-btn').nth(1).click()
    await btn(confirmModal(), '删除').click()
    await page.waitForTimeout(300)
    if (await page.locator('.ant-table-tbody tr').filter({ hasText: 'ui_field' }).count()) {
      throw new Error('自定义条目未删除')
    }
  })

  await step('字典联想与内置开关', async () => {
    await page.locator('.segmented button').filter({ hasText: '系统内置' }).click()
    await page.locator('.dict-switch .ant-switch').click()
    await page.waitForTimeout(250)
    await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
    await page.waitForSelector('.api-workspace')
    await page.locator('.tab-add').click()
    await page.locator('.req-tabs button').filter({ hasText: 'Header' }).click()
    let section = page.locator('.param-section').first()
    await section.locator('.param-add-mini').click()
    let desc = section.locator('.param-desc input').last()
    await desc.click()
    await desc.fill('邮箱')
    await page.waitForTimeout(350)
    if (await page.locator('.ant-select-dropdown:visible').getByText('电子邮箱').count()) {
      throw new Error('关闭内置描述后仍出现内置联想')
    }
    await page.locator('.rail-btn').filter({ hasText: '字典' }).click()
    await page.locator('.schema-nav-row').filter({ hasText: '数据字典' }).click()
    await page.locator('.segmented button').filter({ hasText: '系统内置' }).click()
    await page.locator('.dict-switch .ant-switch').click()
    await page.waitForTimeout(250)
    await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
    await page.waitForSelector('.api-workspace')
    await page.locator('.req-tabs button').filter({ hasText: 'Header' }).click()
    section = page.locator('.param-section').first()
    desc = section.locator('.param-desc input').last()
    await desc.click()
    await desc.fill('邮箱')
    const option = page
      .locator('.ant-select-dropdown:visible')
      .last()
      .getByText('电子邮箱')
      .first()
    await option.waitFor()
    await option.dispatchEvent('click')
    await page.waitForTimeout(200)
    if ((await desc.inputValue()) !== '电子邮箱') throw new Error('选择字典联想后未写入描述')
  })

  await step('新建目录与模型（Raw + 预览 + 保存）', async () => {
    await openSchemas()
    await page.locator('.schemas-new').click()
    await page.locator('.ant-dropdown-menu').getByText('新建模型目录', { exact: true }).click()
    const folderName = page.getByPlaceholder('目录名称')
    await folderName.waitFor()
    await folderName.fill('UI 目录')
    await btn(page, '保存').click()
    await page.waitForTimeout(400)
    await page.locator('.schema-tree-row').filter({ hasText: 'UI 目录' }).first().click()
    await page.locator('.schemas-new').click()
    await page.locator('.ant-dropdown-menu').getByText('新建数据模型', { exact: true }).click()
    const nameInput = page.getByPlaceholder('输入模型名称，建议使用代码模型名称或其同义词')
    await nameInput.waitFor()
    await nameInput.fill('UI 模型')
    await btn(page, 'Raw 编辑').click()
    const raw = page.locator('.model-raw textarea')
    await raw.fill(
      JSON.stringify(
        {
          type: 'object',
          'x-schema-orders': ['id', 'price'],
          required: ['id'],
          properties: {
            id: { type: 'integer', example: 7, description: '主键' },
            price: { type: 'number', default: 9.9, description: '价格' }
          }
        },
        null,
        2
      )
    )
    await btn(page, '应用').click()
    await btn(page, '可视化').click()
    const fieldInputs = page.locator('.schema-field-row .schema-col-name input')
    await fieldInputs.nth(0).waitFor()
    if ((await fieldInputs.nth(0).inputValue()) !== 'id') throw new Error('可视化未显示 id 字段')
    if ((await fieldInputs.nth(1).inputValue()) !== 'price') throw new Error('可视化未显示 price 字段')
    await btn(page, '预览').click()
    await waitText('"id": 7')
    await btn(page, '保存').click()
    await page.waitForTimeout(500)
    await waitText('UI 模型')
    await btn(page, '可视化').click()
    await btn(page, '添加字段').click()
    const fieldName = page.locator('.schema-field-row .schema-col-name input').last()
    await fieldName.fill('name')
    await btn(page, '保存').click()
    await page.waitForTimeout(400)
    const names = page.locator('.schema-field-row .schema-col-name input')
    if ((await names.last().inputValue()) !== 'name') {
      throw new Error('可视化新增字段失败')
    }
  })

  await step('模型字段进阶（嵌套/约束/枚举/顺序）', async () => {
    await btn(page, 'Raw 编辑').click()
    await page.locator('.model-raw textarea').fill(
      JSON.stringify(
        {
          type: 'object',
          'x-schema-orders': ['profile', 'status', 'name'],
          required: ['status'],
          properties: {
            profile: {
              type: 'object',
              'x-schema-orders': ['nickname'],
              properties: { nickname: { type: 'string', description: '昵称' } }
            },
            status: { type: 'string', enum: ['on', 'off'], description: '状态' },
            name: { type: 'string' }
          }
        },
        null,
        2
      )
    )
    await btn(page, '应用').click()
    await btn(page, '可视化').click()
    const fieldInputs = page.locator('.schema-field-row .schema-col-name input')
    const values = await fieldInputs.evaluateAll((inputs) => inputs.map((input) => input.value))
    if (
      JSON.stringify(values.slice(0, 4)) !==
      JSON.stringify(['profile', 'nickname', 'status', 'name'])
    ) {
      throw new Error(`嵌套字段展示异常：${values.join(',')}`)
    }
    // 可视化新增嵌套字段（profile.avatar）
    await page.locator('.schema-add-btn').filter({ hasText: '添加子字段' }).click()
    const nestedInputs = page.locator('.schema-field-row .schema-col-name input')
    await nestedInputs.nth(2).fill('avatar')
    if ((await nestedInputs.nth(2).inputValue()) !== 'avatar') {
      throw new Error('可视化新增嵌套字段失败')
    }
    // 可视化为 name 设置必填与可空
    const nameRow = page.locator('.schema-field-row').nth(4)
    await nameRow.locator('.ant-checkbox-input').nth(0).check({ force: true })
    await nameRow.locator('.ant-checkbox-input').nth(1).check({ force: true })
    await btn(page, '保存').click()
    await page.waitForTimeout(450)
    await btn(page, 'Raw 编辑').click()
    const saved = JSON.parse(await page.locator('.model-raw textarea').inputValue())
    if (JSON.stringify(saved['x-schema-orders']) !== JSON.stringify(['profile', 'status', 'name'])) {
      throw new Error('字段顺序未持久化')
    }
    if (!(saved.required ?? []).includes('status')) throw new Error('必填未持久化')
    if (!(saved.required ?? []).includes('name')) throw new Error('可视化必填未持久化')
    if (saved.properties.name['x-nullable'] !== true) throw new Error('可空未持久化')
    if (!(saved.properties.status.enum ?? []).includes('on')) throw new Error('枚举未持久化')
    if (saved.properties.profile.properties.nickname.type !== 'string') {
      throw new Error('嵌套字段未持久化')
    }
    if (!(saved.properties.profile['x-schema-orders'] ?? []).includes('avatar')) {
      throw new Error('嵌套字段顺序未持久化')
    }
    await btn(page, '可视化').click()
  })

  await step('全部模型列设置与未保存关闭确认', async () => {
    await page
      .getByPlaceholder('输入模型名称，建议使用代码模型名称或其同义词')
      .fill('UI 模型 未保存')
    await page.waitForTimeout(150)
    const modelTab = page.locator('.filetab').filter({ hasText: 'UI 模型' }).first()
    await modelTab.locator('.tab-x').click()
    await page.locator('.ant-modal-confirm:visible').waitFor()
    await btn(confirmModal(), '取消').click()
    await page.waitForTimeout(200)
    if (!(await page.locator('.filetab').filter({ hasText: 'UI 模型' }).count())) {
      throw new Error('取消关闭后标签不应消失')
    }
    await page.locator('.schema-nav-row').filter({ hasText: '全部模型' }).click()
    await waitText('UI 模型')
    const settingsButton = page.locator('.dict-head .ant-btn').filter({
      has: page.locator('.anticon-setting')
    })
    await settingsButton.click()
    const aliasCheckbox = page.locator('.column-settings label').filter({ hasText: '别名' })
    await aliasCheckbox.locator('input').click()
    await page.waitForTimeout(200)
    if (await page.locator('.ant-table-thead').getByText('别名', { exact: true }).count()) {
      throw new Error('列设置未隐藏别名')
    }
    await aliasCheckbox.locator('input').click()
  })

  await step('API 请求 Body 引用模型与解除', async () => {
    await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
    await page.waitForSelector('.api-workspace')
    await page.locator('.tab-add').click()
    const urlInput = page.getByPlaceholder('请输入URL或粘贴cURL文本')
    await urlInput.waitFor()
    const apiName = page.locator('.api-name input')
    await apiName.fill('UI 引用接口')
    await apiName.press('Enter')
    await page.locator('.mode-row .segmented').getByText('设计', { exact: true }).click()
    if (await page.locator('.send-group').count()) {
      throw new Error('设计页不应显示发送按钮')
    }
    await page.locator('.mode-row .segmented').getByText('调试', { exact: true }).click()
    if ((await urlInput.getAttribute('readonly')) !== null) {
      throw new Error('调试页 URL 应可编辑')
    }
    if (!(await page.locator('.send-group').count())) {
      throw new Error('调试页应显示发送按钮')
    }
    await page.locator('.mode-row .segmented').getByText('设计', { exact: true }).click()
    await page.locator('.bodytypes .ant-radio-wrapper').filter({ hasText: 'raw' }).click()
    await page.locator('.body-view-segmented .ant-segmented-item').filter({ hasText: '示例' }).click()
    await page.locator('.req-body .body-model-bar').getByText('引用模型').click()
    await pickModel('UI 模型', '选择数据模型')
    const bodyTextArea = page.locator('.req-body textarea.editor-input')
    await bodyTextArea.waitFor()
    if ((await bodyTextArea.getAttribute('readonly')) === null) {
      throw new Error('引用模型后请求体应为只读')
    }
    const bodyValue = await bodyTextArea.inputValue()
    if (!bodyValue.includes('"status"')) throw new Error('引用模型未生成请求体')
    await page.locator('.req-body .body-model-bar').getByText('解除引用').click()
    await page.waitForTimeout(200)
    if ((await bodyTextArea.getAttribute('readonly')) !== null) {
      throw new Error('解除引用后请求体应可编辑')
    }
    await page.locator('.req-body .body-model-bar').getByText('引用模型').click()
    await pickModel('UI 模型', '选择数据模型')
    await page.locator('.req-body .body-model-bar').getByText('编辑', { exact: true }).click()
    await btn(confirmModal(), '解除并编辑').click()
    await page.waitForTimeout(200)
    if ((await bodyTextArea.getAttribute('readonly')) !== null) {
      throw new Error('确认编辑后应解除只读')
    }
  })

  await step('JSON 字段说明表编辑与保存', async () => {
    const bodyTextArea = page.locator('.req-body textarea.editor-input')
    await bodyTextArea.fill('{"user": ')
    await page.waitForTimeout(700)
    await page.locator('.json-error.inline').waitFor()
    if (await page.locator('.body-view-segmented').count()) {
      throw new Error('JSON 报错时字段切换按钮应隐藏')
    }
    await bodyTextArea.fill('')
    await bodyTextArea.pressSequentially('{"user":{"name":"Ada"},"amount":12}', { delay: 10 })
    await page.waitForTimeout(700)
    await page.locator('.body-view-segmented').waitFor()
    await page.locator('.body-view-segmented .ant-segmented-item').filter({ hasText: '数据结构' }).click()
    await page.locator('.json-field-panel').waitFor()
    const nameRow = page
      .locator('.json-field-name [title="user.name"]')
      .locator('xpath=ancestor::div[contains(@class,"json-field-row")]')
    await nameRow.locator('textarea').fill('用户姓名')
    await page.waitForTimeout(200)
    await page.locator('.body-view-segmented .ant-segmented-item').filter({ hasText: '示例' }).click()
    const rawValue = await bodyTextArea.inputValue()
    if (!rawValue.includes('"name": "Ada"')) {
      throw new Error('字段说明编辑不应破坏原始 JSON')
    }
    await page.locator('.save-btn').click()
    await page.waitForTimeout(300)
    await page.locator('.body-view-segmented .ant-segmented-item').filter({ hasText: '数据结构' }).click()
    const savedDescription = await page
      .locator('.json-field-name [title="user.name"]')
      .locator('xpath=ancestor::div[contains(@class,"json-field-row")]')
      .locator('textarea')
      .inputValue()
    if (savedDescription !== '用户姓名') {
      throw new Error('字段说明未保存')
    }
  })

  await step('响应示例引用模型与失效徽标', async () => {
    await page.locator('.resp-tabs button').filter({ hasText: '响应示例' }).click()
    await page.locator('.resp .body-model-bar').getByText('引用模型').click()
    await page
      .locator('.ant-modal:visible')
      .filter({ hasText: '选择响应示例模型' })
      .locator('.model-picker-row')
      .first()
      .waitFor()
    await pickModel('UI 模型', '选择响应示例模型')
    await page.locator('.resp .body-model-bar').getByText('模型 · UI 模型').waitFor()
    const code = await page.locator('textarea[aria-label="响应示例 JSON"]').inputValue()
    if (!code.includes('"status"')) throw new Error('响应示例未生成模型内容')
    await page.locator('.save-btn').click()
    await page.waitForTimeout(300)
  })

  await step('模型复制、移动、拖拽与删除警告', async () => {
    await openSchemas()
    await revealModel('UI 模型')
    await treeMenu('UI 模型', '复制到…')
    await chooseFolder('UI 目录')
    await waitText('UI 模型 副本')
    await treeMenu('UI 模型 副本', '移动到…')
    await chooseFolder('根目录')
    await page.locator('.schema-nav-row').filter({ hasText: '全部模型' }).click()
    const copyRow = page.locator('.ant-table-tbody tr').filter({ hasText: 'UI 模型 副本' }).first()
    await copyRow.waitFor()
    if (!(await copyRow.innerText()).includes('根目录')) throw new Error('复制/移动后目录不正确')
    await dragRowTo('UI 模型 副本', 'UI 目录')
    await page.waitForTimeout(400)
    if (!(await copyRow.innerText()).includes('UI 目录')) throw new Error('拖拽移动未生效')
    await treeMenu('UI 模型', '删除')
    await page.locator('.ant-modal-confirm:visible').getByText('以下接口仍引用该模型').waitFor()
    await page.locator('.ant-modal-confirm:visible').getByText('UI 引用接口').waitFor()
    await btn(confirmModal(), '取消').click()
  })

  await step('失效引用徽标与解除', async () => {
    await page.locator('.schemas-new').click()
    await page.locator('.ant-dropdown-menu').getByText('新建数据模型', { exact: true }).click()
    const nameInput = page.getByPlaceholder('输入模型名称，建议使用代码模型名称或其同义词')
    await nameInput.waitFor()
    await nameInput.fill('临时模型')
    await btn(page, '保存').click()
    await page.waitForTimeout(450)

    await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
    await page.waitForSelector('.api-workspace')
    await page.locator('.resp-tabs button').filter({ hasText: '响应示例' }).click()
    const exampleBar = page.locator('.resp .body-model-bar')
    if (await exampleBar.getByText('解除引用').count()) {
      await exampleBar.getByText('解除引用').click()
      await page.waitForTimeout(200)
    }
    await exampleBar.getByText('引用模型').click()
    await pickModel('临时模型', '选择响应示例模型')
    await exampleBar.getByText('模型 · 临时模型').waitFor()
    await page.locator('.save-btn').click()
    await page.waitForTimeout(350)

    await openSchemas()
    await treeMenu('临时模型', '删除')
    await page.locator('.ant-modal-confirm:visible').getByText('UI 引用接口').waitFor()
    await btn(confirmModal(), '删除').click()
    await page.waitForTimeout(500)

    await page.locator('.rail-btn').filter({ hasText: 'APIs' }).click()
    await page.waitForSelector('.api-workspace')
    await page.locator('.resp-tabs button').filter({ hasText: '响应示例' }).click()
    await page.locator('.resp .body-model-bar').getByText('模型已删除').waitFor()
    await page.locator('.resp .body-model-bar').getByText('解除引用').click()
    await page.waitForTimeout(200)
    await page.locator('.save-btn').click()
  })

  await step('数据库连接与导入向导', async () => {
    await openSchemas()
    await page.locator('.schema-nav-row').filter({ hasText: '数据库管理' }).click()
    await waitText('新建')
    await btn(page.locator('.dict-head'), '新建').click()
    const modal = visibleModal('新建数据库连接')
    await modal.getByPlaceholder('连接名称').fill('UI MySQL')
    const host = process.env.KINDRAAPI_UI_MYSQL_HOST || '127.0.0.1'
    const port = process.env.KINDRAAPI_UI_MYSQL_PORT || '3306'
    const user = process.env.KINDRAAPI_UI_MYSQL_USER || 'root'
    const database = process.env.KINDRAAPI_UI_MYSQL_DATABASE || 'kindraapi_dict_test'
    await modal.locator('.ant-form-item').filter({ hasText: '数据库地址' }).locator('input').fill(host)
    await modal.locator('.ant-form-item').filter({ hasText: '端口' }).locator('input').fill(port)
    await modal.locator('.ant-form-item').filter({ hasText: '用户名' }).locator('input').fill(user)
    await modal
      .locator('.ant-form-item')
      .filter({ hasText: '数据库名' })
      .locator('input')
      .fill(database)
    await modal.locator('.ant-tabs-tab').filter({ hasText: 'SSH' }).click()
    await page.locator('.ant-modal:visible').getByText('SSH 隧道后续支持').waitFor()
    await modal.locator('.ant-tabs-tab').filter({ hasText: '常规' }).click()
    if (process.env.KINDRAAPI_UI_MYSQL_HOST) {
      await btn(modal, '测试连接').click()
      await waitText('连接成功')
    }
    await btn(modal, '确定').click()
    await page.waitForTimeout(400)
    const row = page.locator('.ant-table-tbody tr').filter({ hasText: 'UI MySQL' }).first()
    await row.waitFor()
    await row.locator('.icon-btn').first().click()
    const editModal = visibleModal('编辑数据库连接')
    await editModal.getByPlaceholder('连接名称').fill('UI MySQL 2')
    await btn(editModal, '确定').click()
    await waitText('UI MySQL 2')
    if (process.env.KINDRAAPI_UI_MYSQL_HOST) {
      const edited = page.locator('.ant-table-tbody tr').filter({ hasText: 'UI MySQL 2' }).first()
      await edited.locator('.icon-btn').nth(1).click()
      await page.locator('.ant-modal:visible').getByText('导入表结构').waitFor()
      await page.locator('.ant-modal:visible').getByText('smoke_types').first().waitFor()
      await page
        .locator('.ant-modal:visible')
        .locator('.db-table-row')
        .filter({ hasText: 'smoke_types' })
        .locator('.ant-checkbox-input')
        .check({ force: true })
      await btn(page, '开始导入').click()
      await waitText('导入结果')
      await waitText('smoke_types')
      await btn(visibleModal('导入表结构'), '关闭').click()
      await page.waitForTimeout(350)
      await edited.locator('.icon-btn').nth(1).click()
      await page.locator('.ant-modal:visible').getByText('导入表结构').waitFor()
      await page
        .locator('.ant-modal:visible')
        .locator('.db-table-row')
        .filter({ hasText: 'smoke_types' })
        .locator('.ant-checkbox-input')
        .check({ force: true })
      await page.getByText('跳过同名模型', { exact: true }).click()
      await btn(page, '开始导入').click()
      await waitText('跳过 1')
      await btn(visibleModal('导入表结构'), '关闭').click()
      await page.waitForTimeout(300)
      await page.locator('.schema-nav-row').filter({ hasText: '全部模型' }).click()
      await waitText('smoke_types')
    }
    const finalRow = page.locator('.ant-table-tbody tr').filter({ hasText: 'UI MySQL 2' }).first()
    if (await finalRow.count()) {
      await finalRow.locator('.icon-btn').nth(2).click()
      await btn(confirmModal(), '删除').click()
      await page.waitForTimeout(300)
    }
  })

  await step('MQTT 新建配置、测试连接与持久连接', async () => {
    mqttBroker = await startMqttBroker()
    await page.locator('.rail-btn').filter({ hasText: 'MQTT' }).click()
    await waitText('新建一个 MQTT 连接开始调试')
    await page
      .locator('.mqtt-side-empty')
      .getByRole('button', { name: /(^|\s)新建连接$/ })
      .click()
    await page.waitForTimeout(400)

    const field = (label) =>
      page.locator('label.mqtt-field').filter({ hasText: label }).first()
    await field('名称').locator('input').fill('UI MQTT')
    await field('主机').locator('input').fill('127.0.0.1')
    await field('端口').locator('input').fill(String(mqttBroker.port))
    await field('用户名').locator('input').fill('tester')
    await field('密码').locator('input').fill('secret')

    // 默认 MQTT 5.0；aedes 仅支持 3.1.1，切到 v4。
    await field('协议版本').locator('.ant-select').click()
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText('MQTT 3.1.1 (v4)', { exact: true })
      .click()

    if (!(await page.getByRole('button', { name: /添加订阅/ }).count())) {
      await page
        .locator('.mqtt-collapse-label')
        .filter({ hasText: '订阅' })
        .first()
        .click()
    }
    await page.getByRole('button', { name: /添加订阅/ }).click()
    await page.locator('.mqtt-sub-row input.ant-input').first().fill('ui/topic')

    await btnExact('保存').click()
    await waitText('已保存')

    await page.getByText('往返验证', { exact: true }).click()
    await btnExact('测试连接').click()
    await page.locator('.mqtt-test-result.ok').waitFor({ timeout: 15000 })
    await page
      .locator('.mqtt-test-result.ok')
      .getByText('成功', { exact: true })
      .first()
      .waitFor({ timeout: 5000 })

    await btnExact('连接').click()
    await page
      .locator('.mqtt-status')
      .filter({ hasText: '已连接' })
      .waitFor({ timeout: 15000 })
  })

  await step('MQTT 发布、收件箱、视图切换与重发预填', async () => {
    await page.locator('.mqtt-tabs .ant-tabs-tab').filter({ hasText: '发布' }).click()
    await page
      .locator('.mqtt-publish label.mqtt-field')
      .filter({ hasText: 'Topic' })
      .first()
      .locator('input')
      .fill('ui/topic')
    await page
      .locator('.mqtt-publish label.mqtt-field')
      .filter({ hasText: '视图' })
      .first()
      .locator('.ant-select')
      .click()
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText('Plain', { exact: true })
      .click()
    await page.locator('.mqtt-payload-input').fill('hello ui')
    await btnExact('发送').click()
    await waitText('发布成功')

    // 周期发布：启动后手动停止，覆盖护栏与停止路径。
    await page.locator('.mqtt-loop-row input.ant-input-number-input').nth(0).fill('300')
    await page.locator('.mqtt-loop-row input.ant-input-number-input').nth(1).fill('20')
    await btnExact('启动循环').click()
    await confirmModal()
      .getByRole('button', { name: /启\s*动/ })
      .click()
    await waitText('循环发布已启动')
    await page.locator('.mqtt-loop-status').waitFor({ timeout: 8000 })
    await page
      .locator('.mqtt-loop-row')
      .getByRole('button', { name: /(^|\s)停止$/ })
      .click()
    await waitText('已停止循环发布')

    await page.locator('.mqtt-tabs .ant-tabs-tab').filter({ hasText: '消息' }).click()
    const row = page.locator('.mqtt-msg-row').filter({ hasText: 'hello ui' }).first()
    await row.waitFor({ timeout: 10000 })

    await row.click()
    await waitText('消息详情')
    await page.locator('.mqtt-payload').filter({ hasText: 'hello ui' }).waitFor()
    await visibleModal('消息详情')
      .getByRole('button', { name: /重\s*发/ })
      .click()
    await waitText('已填入发布面板')
    await page
      .locator('.mqtt-publish label.mqtt-field')
      .filter({ hasText: 'Topic' })
      .first()
      .locator('input')
      .waitFor()

    // 回到消息页，切换 Hex 视图并搜索。
    await page.locator('.mqtt-tabs .ant-tabs-tab').filter({ hasText: '消息' }).click()
    await page.locator('.mqtt-panel-toolbar .ant-select').first().click()
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText('Hex', { exact: true })
      .click()
    await waitText('68656c6c6f207569')
    await page.getByPlaceholder('搜索 topic / 内容').fill('not-found-payload')
    await page.waitForTimeout(300)
    if (await page.locator('.mqtt-msg-row').count()) {
      throw new Error('搜索未过滤消息')
    }
    await page.getByPlaceholder('搜索 topic / 内容').fill('')
    await page.waitForTimeout(300)
    await page.locator('.mqtt-msg-row').first().waitFor()

    await page.getByText('暂停自动滚动', { exact: true }).click()
    await page.locator('.mqtt-panel-toolbar').getByRole('button', { name: /导出/ }).first().hover()
  })

  await page.screenshot({ path: path.join(ARTIFACTS, 'final.png'), fullPage: true })
  fs.writeFileSync(path.join(ARTIFACTS, 'ui-smoke.log'), logs.join('\n'))
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        artifacts: ARTIFACTS,
        user_data: userData,
        steps: logs.filter((line) => line.includes('PASS ')).length
      },
      null,
      2
    ) + '\n'
  )
}

main()
  .catch(async (error) => {
    process.stderr.write(`UI smoke failed: ${error.stack ?? error}\n`)
    if (page) {
      try {
        await page.screenshot({ path: path.join(ARTIFACTS, 'failure.png'), fullPage: true })
      } catch {
        // ignore
      }
    }
    fs.writeFileSync(path.join(ARTIFACTS, 'ui-smoke.log'), logs.join('\n'))
    process.exitCode = 1
  })
  .finally(async () => {
    if (mqttBroker) await mqttBroker.close().catch(() => undefined)
    if (app) await app.close().catch(() => undefined)
    fs.rmSync(userData, { recursive: true, force: true })
  })
