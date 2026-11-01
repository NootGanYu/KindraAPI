#!/usr/bin/env node
/**
 * Turn inventory.json + static-ui.json into the human-readable UI inventory:
 *   README.md, pages/*.md, components/*.md, flows/*.md, observations.md,
 *   baseline/*.json, screenshots/README.md
 *
 * Usage: node ui-inventory/tools/generate-docs.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const INV = path.join(ROOT, 'ui-inventory')
const INVENTORY_FILE = path.join(INV, 'inventory.json')
const STATIC_FILE = path.join(HERE, '.cache', 'static-ui.json')
const PAGES_DIR = path.join(INV, 'pages')
const COMPONENTS_DIR = path.join(INV, 'components')
const FLOWS_DIR = path.join(INV, 'flows')
const BASELINE_DIR = path.join(INV, 'baseline')

const inv = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'))
const stat = JSON.parse(fs.readFileSync(STATIC_FILE, 'utf8'))
const screens = inv.screens

const ROUTE_META = [
  {
    path: '/apis',
    key: 'apis',
    title: 'APIs 接口工作台',
    purpose: '接口树、请求编辑器、响应面板、环境选择、接口用例与版本管理。',
    sources: [
      'src/renderer/src/pages/ApisPage.tsx',
      'src/renderer/src/components/ApiTree.tsx',
      'src/renderer/src/components/RequestEditor.tsx',
      'src/renderer/src/components/ResponsePanel.tsx',
      'src/renderer/src/components/ParamTable.tsx',
      'src/renderer/src/components/JsonFieldTable.tsx',
      'src/renderer/src/components/CasesEditor.tsx',
      'src/renderer/src/components/DesignEditor.tsx',
      'src/renderer/src/components/CodeGenDialog.tsx',
      'src/renderer/src/components/ApiDescriptionDialog.tsx',
      'src/renderer/src/components/TargetVersionDrawer.tsx',
      'src/renderer/src/components/EnvironmentModal.tsx',
      'src/renderer/src/components/FieldRulesEditor.tsx',
      'src/renderer/src/components/TargetSyncGuard.tsx',
      'src/renderer/src/components/TargetEditScope.tsx'
    ]
  },
  {
    path: '/history',
    key: 'history',
    title: '最近 / 发送历史',
    purpose: '最近发送记录、历史列表、响应详情抽屉与搜索/清空。',
    sources: ['src/renderer/src/pages/HistoryPage.tsx', 'src/renderer/src/components/ResponsePanel.tsx']
  },
  {
    path: '/docs',
    key: 'docs',
    title: '文档分享',
    purpose: '分享列表、分享范围（项目/目录/接口/自定义）、分享服务配置。',
    sources: [
      'src/renderer/src/pages/DocsPage.tsx',
      'src/renderer/src/components/DocShareDialog.tsx',
      'src/renderer/src/components/DocShareLinkDialog.tsx'
    ]
  },
  {
    path: '/schemas',
    key: 'schemas',
    title: '字典 / 数据模型 / 数据库',
    purpose: '数据字典、数据模型编辑器、MySQL 连接与表结构导入。',
    sources: [
      'src/renderer/src/pages/SchemasPage.tsx',
      'src/renderer/src/components/schemas/DatabasePanel.tsx',
      'src/renderer/src/components/schemas/DictionaryPanel.tsx',
      'src/renderer/src/components/schemas/DictionarySuggest.tsx',
      'src/renderer/src/components/schemas/ModelEditor.tsx',
      'src/renderer/src/components/schemas/ModelPickerModal.tsx',
      'src/renderer/src/components/schemas/ModelsListPanel.tsx',
      'src/renderer/src/components/schemas/SchemaFieldEditor.tsx',
      'src/renderer/src/components/schemas/modelDocumentation.ts'
    ]
  },
  {
    path: '/mqtt',
    key: 'mqtt',
    title: 'MQTT 模块',
    purpose: '连接配置、消息、发布、运行记录、版本历史、TLS/Will/MQTT5 属性。',
    sources: [
      'src/renderer/src/pages/MqttPage.tsx',
      'src/renderer/src/components/mqtt/ProfileEditor.tsx',
      'src/renderer/src/components/mqtt/ProfileList.tsx',
      'src/renderer/src/components/mqtt/MessagesPanel.tsx',
      'src/renderer/src/components/mqtt/PublishPanel.tsx',
      'src/renderer/src/components/mqtt/AttemptsPanel.tsx',
      'src/renderer/src/components/mqtt/UserPropertiesEditor.tsx',
      'src/renderer/src/components/mqtt/VersionDrawer.tsx'
    ]
  },
  {
    path: '/automation',
    key: 'automation',
    title: '流程自动化',
    purpose: '流程列表、事件编排、运行结果与历史运行。',
    sources: ['src/renderer/src/pages/AutomationPage.tsx']
  },
  {
    path: '/git',
    key: 'git',
    title: 'Git 版本管理',
    purpose: '工作区变更/未跟踪、差异、提交、分支、远程与同步。',
    sources: ['src/renderer/src/pages/GitPage.tsx']
  },
  {
    path: '/settings',
    key: 'settings',
    title: '设置',
    purpose: '环境与请求前缀、全局变量、发送设置、MCP 服务、调试设置。',
    sources: ['src/renderer/src/pages/SettingsPage.tsx']
  }
]

const GLOBAL_META = {
  path: '/global',
  key: 'global',
  title: '全局框架',
  purpose: '顶栏、左侧导航、状态栏、项目菜单与全局 Tooltip。',
  sources: [
    'src/renderer/src/App.tsx',
    'src/renderer/src/components/TopBar.tsx',
    'src/renderer/src/components/LeftNav.tsx',
    'src/renderer/src/components/StatusBar.tsx'
  ]
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------
const md = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim().slice(0, n)
const code = (s) => '`' + String(s ?? '').replace(/`/g, '\\`') + '`'
const table = (headers, rows) =>
  ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map((r) => '| ' + r.join(' | ') + ' |')].join('\n')
const link = (text, href) => `[${text}](${href.replace(/\\/g, '/')})`
const rel = (fromDir, target) => path.relative(fromDir, target).replace(/\\/g, '/')
const shotLink = (screen, fromDir = INV) => `![${screen.id}](${rel(fromDir, path.join(ROOT, screen.screenshot.webp))})`
const shotPath = (screen, fromDir = INV) => rel(fromDir, path.join(ROOT, screen.screenshot.webp))
const pageDoc = (route) => `pages/${route.replace(/^\//, '')}.md`
const flowDoc = (screen) => `flows/${screen.id}.md`
const componentDoc = (source) =>
  `components/${source
    .replace(/^src\/renderer\/src\/components\//, '')
    .replace(/^src\/renderer\/src\//, '')
    .replace(/\.tsx?$/, '')
    .replace(/\//g, '-')}.md`

function meaningful(el) {
  if (el.text || el.ariaLabel || el.title || el.placeholder) return true
  if (/^(input|textarea|select)$/.test(el.tag)) return true
  if (el.icon) return true
  if (/ant-tree-treenode|ant-table-thead|ant-card-head-title|ant-form-item-label|ant-tabs-tab|ant-menu-item|ant-empty-description|ant-modal-title|ant-drawer-title/.test(el.classes)) return true
  return false
}

function elLabel(el) {
  return el.text || el.ariaLabel || el.title || el.placeholder || el.icon || '(未命名单选/控件)'
}

// Icons and Ant Design tree child spans duplicate the parent row. Keep the
// real controls in the primary table and list tree data separately.
function isControl(el) {
  if (!meaningful(el)) return false
  if (el.role === 'img') return false
  if (el.tag === 'span' && /ant-tree|tree-row|tree-label|tree-title/.test(`${el.classes} ${el.selector}`)) return false
  if (el.tag === 'div' && el.role === 'treeitem') return false
  return true
}

function controlRows(screenList, limit = 400) {
  const seen = new Set()
  const rows = []
  for (const screen of screenList) {
    for (const el of screen.inventory?.elements || []) {
      if (!isControl(el)) continue
      const key = [el.section, el.tag, el.text, el.ariaLabel, el.title, el.placeholder, el.icon].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      rows.push([
        md(el.section || '页面'),
        `${md(elLabel(el), 90)}${el.icon ? `<br>${code(el.icon)}` : ''}`,
        code([el.tag, el.role].filter(Boolean).join('/')),
        [el.disabled ? 'disabled' : '', el.checked ? 'checked' : '', el.active ? 'active' : ''].filter(Boolean).join(' ') || '—',
        el.style?.rect ? `${el.style.rect.x},${el.style.rect.y} · ${el.style.rect.width}×${el.style.rect.height}` : '—',
        code(screen.id)
      ])
      if (rows.length >= limit) return { rows, truncated: true }
    }
  }
  return { rows, truncated: false }
}

function treeRows(screenList, limit = 200) {
  const seen = new Set()
  const rows = []
  for (const screen of screenList) {
    for (const el of screen.inventory?.elements || []) {
      if (!(el.role === 'treeitem' || /ant-tree-treenode/.test(el.classes))) continue
      const label = el.text || el.ariaLabel || el.title
      if (!label) continue
      const key = label
      if (seen.has(key)) continue
      seen.add(key)
      rows.push([md(label, 120), el.disabled ? 'disabled' : '—', code(screen.id), code(el.selector)])
      if (rows.length >= limit) return { rows, truncated: true }
    }
  }
  return { rows, truncated: false }
}

function promptsOf(screenList) {
  const empty = new Set()
  const alerts = new Set()
  const errors = new Set()
  const messages = new Set()
  const tooltips = new Set()
  const titleAttrs = new Set()
  for (const s of screenList) {
    for (const x of s.inventory?.prompts?.empty || []) if (x) empty.add(x)
    for (const x of s.inventory?.prompts?.alerts || []) if (x.text) alerts.add(x.text)
    for (const x of s.inventory?.prompts?.formErrors || []) if (x) errors.add(x)
    for (const x of s.inventory?.prompts?.messages || []) if (x) messages.add(x)
    for (const x of s.inventory?.prompts?.tooltips || []) if (x) tooltips.add(x)
    for (const x of s.inventory?.prompts?.titleAttrs || []) if (x.title && x.title !== '---') titleAttrs.add(x.title)
  }
  return { empty, alerts, errors, messages, tooltips, titleAttrs }
}

function staticFilesFor(sources) {
  return stat.files.filter((f) => sources.some((s) => f.file === s || f.file.endsWith(s)))
}

function staticSection(files, fromDir) {
  const out = []
  const buttons = []
  const messages = []
  const menus = []
  const tips = []
  const placeholders = []
  const empties = []
  const shortcuts = []
  const ipc = []
  for (const f of files) {
    for (const t of f.tags) {
      if (/Button$/.test(t.tag) && t.text) buttons.push([md(t.tag), md(t.text), md(Object.entries(t.attrs).map(([k, v]) => `${k}=${v}`).join(' '), 120), `${code(f.file)}:${t.line}`])
    }
    for (const m of f.messages) messages.push([code(m.kind), code(md(m.copy, 160)), `${code(f.file)}:${m.line}`])
    for (const m of f.menuItems) menus.push([code(md(m.label, 80)), code(m.key), m.disabled ? code(m.disabled) : '—', `${code(f.file)}:${m.line}`])
    for (const t of f.tooltips) tips.push([code(md(t.text, 100)), `${code(f.file)}:${t.line}`])
    for (const p of f.placeholders) placeholders.push([code(md(p.text, 100)), `${code(f.file)}:${p.line}`])
    for (const e of f.empties) empties.push([code(md(e.text, 120)), `${code(f.file)}:${e.line}`])
    for (const s of f.shortcuts) shortcuts.push([code(md(s.expression, 120)), `${code(f.file)}:${s.line}`])
    for (const i of f.ipc) ipc.push([code(i.call), code(md(i.args, 100)), `${code(f.file)}:${i.line}`])
  }
  if (buttons.length) out.push(`### 源码中的按钮\n\n${table(['组件', '文案', '关键属性', '位置'], buttons)}`)
  if (messages.length) out.push(`### 源码中的提示 / 通知 / 确认框\n\n${table(['类型', '文案', '位置'], messages)}`)
  if (menus.length) out.push(`### 源码中的菜单项\n\n${table(['label', 'key', 'disabled', '位置'], menus)}`)
  if (tips.length || placeholders.length || empties.length) {
    const parts = []
    if (tips.length) parts.push(`**Tooltip**\n\n${table(['文案', '位置'], tips)}`)
    if (placeholders.length) parts.push(`**Placeholder**\n\n${table(['文案', '位置'], placeholders)}`)
    if (empties.length) parts.push(`**Empty**\n\n${table(['文案', '位置'], empties)}`)
    out.push(`### 源码中的提示文案\n\n${parts.join('\n\n')}`)
  }
  if (shortcuts.length) out.push(`### 快捷键 / 键盘处理\n\n${table(['表达式', '位置'], shortcuts)}`)
  if (ipc.length) out.push(`### 行为 / IPC 调用\n\n${table(['调用', '参数', '位置'], ipc)}`)
  return out.join('\n\n')
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
function generatePage(meta) {
  const pageScreens = screens.filter((s) => s.route === meta.path)
  const files = staticFilesFor(meta.sources)
  const elements = pageScreens.reduce((n, s) => n + (s.inventory?.elementCount || 0), 0)
  const lines = []
  lines.push(`# ${meta.title}`)
  lines.push('')
  lines.push(`- 路由：${code(meta.path)}`)
  lines.push(`- 用途：${meta.purpose}`)
  lines.push(`- 采集状态：${pageScreens.length} 个；DOM/AX 元素合计：${elements}`)
  lines.push(`- 主要源码：${meta.sources.map((s) => code(s)).join('、')}`)
  lines.push('')
  lines.push('## 状态截图')
  lines.push('')
  lines.push(
    table(
      ['状态', '类型', '视口', '元素数', '截图'],
      pageScreens.map((s) => [
        code(s.id),
        s.kind,
        `${s.viewport.width}×${s.viewport.height}`,
        String(s.inventory?.elementCount ?? '—'),
        link('WebP', shotPath(s, PAGES_DIR))
      ])
    )
  )
  lines.push('')
  const hero = pageScreens.filter((s) => s.kind === 'page').slice(0, 2)
  for (const s of hero) {
    lines.push(`### ${s.id}`)
    lines.push('')
    lines.push(shotLink(s, PAGES_DIR))
    lines.push('')
  }
  const first = pageScreens[0]
  if (first) {
    lines.push('## 布局区域（1180×760 基准）')
    lines.push('')
    lines.push(
      table(
        ['区域', 'x', 'y', 'width', 'height'],
        Object.entries(first.regions || {})
          .filter(([k, v]) => k !== 'overlays' && v && typeof v === 'object')
          .map(([k, v]) => [code(k), String(v.x), String(v.y), String(v.width), String(v.height)])
      )
    )
    lines.push('')
  }
  lines.push('## 控件全量清单')
  lines.push('')
  const { rows, truncated } = controlRows(pageScreens)
  lines.push(table(['区块', '控件文案 / aria / icon', '类型', '状态', '位置', '来源状态'], rows))
  if (truncated) lines.push(`\n> 清单上限 400 行；完整数据见 ${link('inventory.json', rel(PAGES_DIR, INVENTORY_FILE))}。`)
  lines.push('')

  const trees = treeRows(pageScreens)
  if (trees.rows.length) {
    lines.push('## 树节点（数据，不是控件）')
    lines.push('')
    lines.push(`<details><summary>展开 ${trees.rows.length} 个树节点</summary>`)
    lines.push('')
    lines.push(table(['节点', '状态', '来源状态', '选择器'], trees.rows))
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  const menus = pageScreens.flatMap((s) => (s.inventory?.elements || []).filter((e) => e.role === 'menuitem' || /ant-dropdown-menu-item|ant-select-item-option|ant-menu-item/.test(e.classes)))
  if (menus.length) {
    const seen = new Set()
    const menuRows = []
    for (const m of menus) {
      const key = [m.section, m.text, m.selector].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      menuRows.push([md(m.section || '菜单'), md(m.text || m.ariaLabel || m.title, 100), code(m.tag), m.disabled ? 'disabled' : '—', code(m.selector)])
    }
    lines.push('## 菜单 / 下拉项（运行态）')
    lines.push('')
    lines.push(table(['所在区域', '菜单文案', '类型', '状态', '选择器'], menuRows))
    lines.push('')
  }

  const prompts = promptsOf(pageScreens)
  lines.push('## 提示、空态与错误')
  lines.push('')
  const sections = []
  if (prompts.empty.size) sections.push(`**空态**\n\n${[...prompts.empty].map((x) => `- ${md(x)}`).join('\n')}`)
  if (prompts.alerts.size) sections.push(`**警告 / 提示条**\n\n${[...prompts.alerts].map((x) => `- ${md(x)}`).join('\n')}`)
  if (prompts.errors.size) sections.push(`**表单校验错误**\n\n${[...prompts.errors].map((x) => `- ${md(x)}`).join('\n')}`)
  if (prompts.messages.size) sections.push(`**Toast / Notification**\n\n${[...prompts.messages].map((x) => `- ${md(x)}`).join('\n')}`)
  if (prompts.tooltips.size) sections.push(`**可见 Tooltip**\n\n${[...prompts.tooltips].map((x) => `- ${md(x)}`).join('\n')}`)
  if (prompts.titleAttrs.size) sections.push(`**title 属性（悬停提示）**\n\n${[...prompts.titleAttrs].slice(0, 80).map((x) => `- ${md(x)}`).join('\n')}`)
  lines.push(sections.join('\n\n') || '本次采集未捕获到运行态提示文案；请结合下方源码静态清单。')
  lines.push('')

  const tableScreens = pageScreens.filter((s) => (s.inventory?.tableHeaders || []).length)
  if (tableScreens.length) {
    lines.push('## 表格')
    lines.push('')
    const rows = []
    const seen = new Set()
    for (const s of tableScreens) {
      const key = s.inventory.tableHeaders.join('|')
      if (seen.has(key)) continue
      seen.add(key)
      rows.push([code(s.id), md(s.inventory.tableHeaders.join(' / '), 160), String(s.inventory.tableRows)])
    }
    lines.push(table(['状态', '表头', '可见行数'], rows))
    lines.push('')
  }

  lines.push('## 源码静态清单（含 file:line）')
  lines.push('')
  lines.push(staticSection(files) || '未找到对应源码。')
  lines.push('')
  lines.push(`> 返回 ${link('总索引', rel(PAGES_DIR, path.join(INV, 'README.md')))}`)
  lines.push('')
  fs.writeFileSync(path.join(PAGES_DIR, `${meta.key}.md`), lines.join('\n'))
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function generateComponent(file) {
  const lines = []
  const name = path.basename(file.file)
  lines.push(`# 组件：${name}`)
  lines.push('')
  lines.push(`- 源码：${code(file.file)}`)
  lines.push(`- 行数：${file.lines}`)
  lines.push(`- 静态统计：JSX ${file.tags.length} / 提示 ${file.messages.length} / 菜单 ${file.menuItems.length} / Tooltip ${file.tooltips.length} / Placeholder ${file.placeholders.length} / IPC ${file.ipc.length}`)
  lines.push('')
  lines.push('## JSX 控件（含行号）')
  lines.push('')
  const tagRows = file.tags
    .filter((t) => /Button|Input|Select|Tabs|Modal|Drawer|Dropdown|Tooltip|Popconfirm|Switch|Checkbox|Radio|Tree|Table|Empty|Alert|Card|Collapse|Segmented|Upload|AutoComplete|Form|Menu|Tag|Badge|Steps|Timeline|Descriptions|Space|Divider|Popover/.test(t.tag))
    .map((t) => [
      code(t.tag),
      md(t.text || t.attrs.title || t.attrs.placeholder || t.attrs.label || t.attrs['aria-label'] || '—', 100),
      md(Object.entries(t.attrs).map(([k, v]) => `${k}=${v}`).join(' '), 160) || '—',
      `${code(file.file)}:${t.line}`
    ])
  lines.push(tagRows.length ? table(['标签', '文案', '关键属性', '位置'], tagRows) : '未提取到常用 UI 标签。')
  lines.push('')
  const sec = staticSection([file], COMPONENTS_DIR)
  lines.push(sec || '该文件没有可提取的提示/菜单/IPC。')
  lines.push('')
  lines.push(`> 返回 ${link('组件索引', 'README.md')}`)
  lines.push('')
  fs.writeFileSync(path.join(COMPONENTS_DIR, path.basename(componentDoc(file.file))), lines.join('\n'))
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------
function generateFlow(screen) {
  const lines = []
  lines.push(`# 交互流：${screen.id}`)
  lines.push('')
  lines.push(`- 路由：${code(screen.route)}`)
  lines.push(`- 类型：${screen.kind}`)
  lines.push(`- 视口：${screen.viewport.width}×${screen.viewport.height}`)
  lines.push(`- 说明：${md(screen.notes || '—')}`)
  lines.push(`- 所属页面：${link(pageDoc(screen.route), rel(FLOWS_DIR, path.join(INV, pageDoc(screen.route))))}`)
  lines.push('')
  lines.push(shotLink(screen, FLOWS_DIR))
  lines.push('')
  const rows = (screen.inventory?.elements || [])
    .filter(isControl)
    .map((el) => [
      md(el.section || '—'),
      md(elLabel(el), 100),
      code([el.tag, el.role].filter(Boolean).join('/')),
      [el.disabled ? 'disabled' : '', el.checked ? 'checked' : '', el.active ? 'active' : ''].filter(Boolean).join(' ') || '—',
      code(el.selector)
    ])
  lines.push('## 可见控件')
  lines.push('')
  lines.push(rows.length ? table(['区块', '文案 / aria / icon', '类型', '状态', '选择器'], rows) : '未捕获到控件。')
  lines.push('')
  const prompts = promptsOf([screen])
  const promptBits = []
  for (const [label, set] of [
    ['空态', prompts.empty],
    ['警告', prompts.alerts],
    ['表单错误', prompts.errors],
    ['Toast', prompts.messages],
    ['Tooltip', prompts.tooltips],
    ['title 属性', prompts.titleAttrs]
  ]) {
    if (set.size) promptBits.push(`**${label}**\n\n${[...set].map((x) => `- ${md(x)}`).join('\n')}`)
  }
  lines.push('## 提示文案')
  lines.push('')
  lines.push(promptBits.join('\n\n') || '未捕获到提示文案。')
  lines.push('')
  const meta = ROUTE_META.find((m) => m.path === screen.route)
  if (meta) {
    const files = staticFilesFor(meta.sources)
    const bits = []
    for (const f of files) {
      if (f.messages.length) bits.push(`- ${code(f.file)}：${f.messages.length} 条提示`)
      if (f.menuItems.length) bits.push(`- ${code(f.file)}：${f.menuItems.length} 个菜单项`)
      if (f.tooltips.length) bits.push(`- ${code(f.file)}：${f.tooltips.length} 个 Tooltip`)
      if (f.ipc.length) bits.push(`- ${code(f.file)}：${f.ipc.length} 个 IPC 调用`)
    }
    lines.push('## 相关源码')
    lines.push('')
    lines.push(bits.join('\n') || '—')
    lines.push('')
  }
  lines.push(`> 返回 ${link('交互流索引', 'README.md')}`)
  lines.push('')
  fs.writeFileSync(path.join(FLOWS_DIR, `${screen.id}.md`), lines.join('\n'))
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------
function scanSources() {
  const files = stat.files.map((f) => path.join(ROOT, f.file))
  const inlineStyle = []
  const hex = []
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    const relFile = rel(ROOT, file)
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      if (/style=\{\{/.test(line)) inlineStyle.push({ file: relFile, line: i + 1, text: line.trim().slice(0, 140) })
      const matches = line.match(/#[0-9a-fA-F]{3,8}\b/g) || []
      for (const m of matches) hex.push({ file: relFile, line: i + 1, color: m, text: line.trim().slice(0, 120) })
    })
  }
  return { inlineStyle, hex }
}

function generateObservations() {
  const { inlineStyle, hex } = scanSources()
  const iconOnly = []
  const noLabelInputs = []
  const smallControls = []
  const seenSmall = new Set()
  for (const s of screens) {
    for (const el of s.inventory?.elements || []) {
      if (/^(button|input|textarea|select)$/.test(el.tag) && el.style?.rect?.height && el.style.rect.height < 24) {
        const key = `${s.id}|${el.selector}`
        if (!seenSmall.has(key)) {
          seenSmall.add(key)
          smallControls.push({ screen: s.id, tag: el.tag, text: elLabel(el), height: el.style.rect.height })
        }
      }
      if (el.tag === 'input' && !el.placeholder && !el.ariaLabel && !el.title) {
        noLabelInputs.push({ screen: s.id, selector: el.selector, type: el.type })
      }
    }
  }
  for (const f of stat.files) {
    for (const t of f.tags) {
      if (/Button$/.test(t.tag) && !t.text && !t.attrs['aria-label'] && !t.attrs.title) {
        iconOnly.push({ file: f.file, line: t.line, attrs: t.attrs })
      }
    }
  }
  const labelFiles = new Map()
  for (const f of stat.files) {
    for (const t of f.tags) {
      if (!/Button$/.test(t.tag) || !t.text) continue
      const set = labelFiles.get(t.text) || new Set()
      set.add(f.file)
      labelFiles.set(t.text, set)
    }
  }
  const duplicateLabels = [...labelFiles.entries()].filter(([, set]) => set.size > 1).sort((a, b) => b[1].size - a[1].size)
  const complex = [...screens].sort((a, b) => (b.inventory?.elementCount || 0) - (a.inventory?.elementCount || 0)).slice(0, 12)
  const messageTotal = stat.files.reduce((n, f) => n + f.messages.length, 0)
  const tooltipTotal = stat.files.reduce((n, f) => n + f.tooltips.length, 0)
  const placeholderTotal = stat.files.reduce((n, f) => n + f.placeholders.length, 0)
  const emptyTotal = stat.files.reduce((n, f) => n + f.empties.length, 0)
  const ipcTotal = stat.files.reduce((n, f) => n + f.ipc.length, 0)

  const lines = []
  lines.push('# 重构观察（observations）')
  lines.push('')
  lines.push('> 本文件是“重构观察”，与事实清单分离。清单本身不包含主观判断；这里的每条判断尽量附证据。')
  lines.push('')
  lines.push('## 总览指标')
  lines.push('')
  lines.push(
    table(
      ['指标', '数值'],
      [
        ['采集状态数', String(screens.length)],
        ['DOM/AX 元素条目', String(screens.reduce((n, s) => n + (s.inventory?.elementCount || 0), 0))],
        ['源码提示/确认框', String(messageTotal)],
        ['源码 Tooltip', String(tooltipTotal)],
        ['源码 Placeholder', String(placeholderTotal)],
        ['源码 Empty', String(emptyTotal)],
        ['源码 IPC 调用', String(ipcTotal)],
        ['内联 style={{}}', String(inlineStyle.length)],
        ['硬编码颜色（十六进制）', String(hex.length)],
        ['图标按钮缺 aria-label', String(iconOnly.length)]
      ]
    )
  )
  lines.push('')
  lines.push('## 值得在重构中优先处理')
  lines.push('')
  const curated = [
    ['模式占位与真实功能混在一起', 'APIs 的「设计 / 一键压测 / Mock」当前是 `ModePlaceholder` 说明页，界面却与「调试」并列为主 Tab，重构时容易让用户误以为功能完整。', 'src/renderer/src/pages/ApisPage.tsx:803'],
    ['请求编辑器 Tab 中英混用', '`Header / Query / Path / Body` 与 `认证 / Cookie / 预执行操作 / 后执行操作` 混排，重构时可统一为中文或统一为英文。', 'src/renderer/src/components/RequestEditor.tsx:35'],
    ['文档分享服务启动失败', '本次采集中 Docs 页显示「分享服务 异常」，分享服务弹窗提示启动失败；重构前需要先确认端口/权限/防火墙策略。', 'screenshots/webp/docs-list-1180x760.webp · docs-dialog-share-service.webp'],
    ['数据库凭据明文存储', '数据库管理页明确提示“凭据明文存储，不会同步给团队”；重构 UI 时建议把风险提示做成更显眼的警示块，而不是普通说明文字。', 'src/renderer/src/components/schemas/DatabasePanel.tsx:292'],
    ['大量“后续里程碑”占位', '回收站、导入项目、复制/粘贴、msgpack、部分接口模式等仍是占位提示；重构时应统一占位样式与文案，避免看起来像坏掉的按钮。', 'src/renderer/src/components/LeftNav.tsx / TopBar.tsx / RequestEditor.tsx'],
    ['颜色来源有两套', '`theme.ts` 的 palette 与 `global.css` 的 CSS 变量并存，且组件里仍有硬编码色值（如 `#2f8f62`、`#1f9e7c`、`#ff583e`）。重构设计系统时应收敛为单一 token 源。', 'src/renderer/src/theme.ts · src/renderer/src/styles/global.css · src/renderer/src/App.tsx'],
    ['图标按钮可访问性不足', `检测到 ${iconOnly.length} 处 Button 既无文本也无 aria-label/title；纯图标工具栏在键盘与读屏下难以识别。`, '见下方“图标按钮缺 aria-label”'],
    ['提示文案分散', `源码中 ${messageTotal} 条 message/Modal 文案、${tooltipTotal} 个 Tooltip、${placeholderTotal} 个 Placeholder 分散在各组件，缺少统一 copy 层，重构时容易漏改。`, '见 components/*.md'],
    ['高密度页面', 'APIs 调试工作台单状态 500+ 个 DOM/AX 条目，重构时建议拆分面板与延迟渲染，降低一次渲染的控件数量。', [...complex.slice(0, 3).map((s) => `${s.id}(${s.inventory?.elementCount})`), ''].join(' ')],
    ['真实数据截图含敏感信息', '截图来自主项目真实数据，包含接口名、URL、项目 ID、请求体等；如需对外分享，请先脱敏或改用空数据/演示数据模式重跑。', 'ui-inventory/screenshots/webp/']
  ]
  lines.push(table(['观察', '说明', '证据'], curated.map(([a, b, c]) => [md(a), md(b, 240), code(c)])))
  lines.push('')
  lines.push('## 图标按钮缺 aria-label')
  lines.push('')
  lines.push(iconOnly.length ? table(['文件', '行号', '属性'], iconOnly.slice(0, 120).map((x) => [code(x.file), String(x.line), code(Object.entries(x.attrs).map(([k, v]) => `${k}=${v}`).join(' ') || '—')])) : '未检测到。')
  lines.push('')
  lines.push('## 小尺寸控件（高度 < 24px）')
  lines.push('')
  lines.push(smallControls.length ? table(['状态', '标签', '文案', '高度'], smallControls.slice(0, 80).map((x) => [code(x.screen), code(x.tag), md(x.text, 80), `${x.height}px`])) : '未检测到。')
  lines.push('')
  lines.push('## 无标签输入框')
  lines.push('')
  lines.push(noLabelInputs.length ? table(['状态', '类型', '选择器'], noLabelInputs.slice(0, 80).map((x) => [code(x.screen), code(x.type || '—'), code(x.selector)])) : '未检测到。')
  lines.push('')
  lines.push('## 重复按钮文案（跨文件）')
  lines.push('')
  lines.push(table(['文案', '出现文件数', '文件'], duplicateLabels.slice(0, 40).map(([label, set]) => [md(label, 40), String(set.size), [...set].map((f) => code(f)).join('<br>')])))
  lines.push('')
  lines.push('## 元素最多的状态')
  lines.push('')
  lines.push(table(['状态', '路由', '元素数', '截图'], complex.map((s) => [code(s.id), code(s.route), String(s.inventory?.elementCount ?? '—'), link('WebP', shotPath(s, INV))])))
  lines.push('')
  lines.push('## 硬编码颜色（前 120 条）')
  lines.push('')
  lines.push(table(['文件', '行号', '颜色', '代码片段'], hex.slice(0, 120).map((x) => [code(x.file), String(x.line), code(x.color), md(x.text, 120)])))
  lines.push('')
  lines.push('## 内联样式（前 80 条）')
  lines.push('')
  lines.push(table(['文件', '行号', '代码片段'], inlineStyle.slice(0, 80).map((x) => [code(x.file), String(x.line), md(x.text, 140)])))
  lines.push('')
  fs.writeFileSync(path.join(INV, 'observations.md'), lines.join('\n'))
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------
function generateBaseline() {
  const screenshots = screens.map((s) => ({
    id: s.id,
    route: s.route,
    kind: s.kind,
    viewport: s.viewport,
    sha256: s.sha256,
    png: s.screenshot.png,
    webp: s.screenshot.webp
  }))
  const regions = screens.map((s) => ({ id: s.id, route: s.route, regions: s.regions }))
  const tokens = screens.map((s) => ({ id: s.id, route: s.route, tokens: s.tokens }))
  fs.writeFileSync(path.join(BASELINE_DIR, 'screenshots.json'), JSON.stringify({ generatedAt: inv.generatedAt, screenshots }, null, 2))
  fs.writeFileSync(path.join(BASELINE_DIR, 'regions.json'), JSON.stringify({ generatedAt: inv.generatedAt, screens: regions }, null, 2))
  fs.writeFileSync(path.join(BASELINE_DIR, 'tokens.json'), JSON.stringify({ generatedAt: inv.generatedAt, screens: tokens }, null, 2))
  const lines = []
  lines.push('# 重构基线')
  lines.push('')
  lines.push('本目录用于重构前后对比，不依赖外部服务：')
  lines.push('')
  lines.push('- `screenshots.json`：每个状态的 WebP/PNG 路径、视口、截图 SHA-256。')
  lines.push('- `regions.json`：topbar/rail/main/statusbar/模式条/请求面板/响应面板/弹窗的 bounding box。')
  lines.push('- `tokens.json`：body/topbar/rail/statusbar/按钮/输入/Tab/表头/Tag/Modal/Card 的计算样式。')
  lines.push('')
  lines.push('重构后重跑 `npm run ui:inventory`，对比：')
  lines.push('')
  lines.push('1. `sha256` 变化 → 视觉发生变化的状态。')
  lines.push('2. `regions.json` 尺寸变化 → 布局漂移。')
  lines.push('3. `tokens.json` 颜色/字号/圆角变化 → 设计令牌漂移。')
  lines.push('')
  fs.writeFileSync(path.join(BASELINE_DIR, 'README.md'), lines.join('\n'))
}

// ---------------------------------------------------------------------------
// HTML gallery
// ---------------------------------------------------------------------------
function generateGallery() {
  const html = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const sections = [...ROUTE_META, GLOBAL_META].map((meta) => {
    const list = screens.filter((s) => s.route === meta.path)
    const cards = list
      .map((s) => {
        const text = `${s.id} ${s.kind} ${s.route} ${s.notes || ''}`
        const img = path.relative(INV, path.join(ROOT, s.screenshot.webp)).replace(/\\/g, '/')
        return `<article class="card" data-text="${html(text.toLowerCase())}">
  <a href="${html(img)}" target="_blank" rel="noreferrer"><img loading="lazy" src="${html(img)}" alt="${html(s.id)}"></a>
  <div class="card-meta"><strong>${html(s.id)}</strong><span>${html(s.kind)} · ${s.viewport.width}×${s.viewport.height} · ${s.inventory?.elementCount ?? '—'} 元素</span></div>
</article>`
      })
      .join('\n')
    return `<section id="${html(meta.key)}"><h2>${html(meta.title)} <small>${html(meta.path)} · ${list.length} 个状态</small></h2><div class="grid">${cards}</div></section>`
  }).join('\n')
  const nav = [...ROUTE_META, GLOBAL_META].map((m) => `<a href="#${html(m.key)}">${html(m.title)}</a>`).join('')
  const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KindraAPI UI 清单 · ${screens.length} 个状态</title>
<style>
  :root { --bg:#faf5ea; --panel:#fff; --line:rgba(147,117,63,.18); --text:#2c2214; --muted:#6b5d48; --primary:#8a6b3b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif; }
  header { position:sticky; top:0; z-index:2; background:#f4eddf; border-bottom:1px solid var(--line); padding:14px 20px; }
  header h1 { margin:0 0 4px; font-size:18px; }
  header p { margin:0; color:var(--muted); }
  nav { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:10px; }
  nav a { color:var(--primary); text-decoration:none; }
  .toolbar { padding:14px 20px 0; }
  .toolbar input { width:100%; max-width:420px; height:34px; padding:0 12px; border:1px solid var(--line); border-radius:4px; background:var(--panel); color:var(--text); }
  main { padding:8px 20px 40px; }
  section { margin-top:26px; }
  h2 { font-size:16px; margin:0 0 12px; }
  h2 small { color:var(--muted); font-weight:400; font-size:12px; margin-left:8px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  .card img { display:block; width:100%; height:auto; background:#fff; }
  .card-meta { padding:8px 10px; display:flex; flex-direction:column; gap:2px; border-top:1px solid var(--line); }
  .card-meta strong { font-size:12px; word-break:break-all; }
  .card-meta span { color:var(--muted); font-size:11px; }
  .empty { color:var(--muted); padding:20px 0; }
</style>
</head>
<body>
<header>
  <h1>KindraAPI 前端 UI 清单</h1>
  <p>${screens.length} 个状态 · ${screens.reduce((n, s) => n + (s.inventory?.elementCount || 0), 0)} 条 DOM/AX 记录 · 主项目「${html(inv.app.mainProjectName)}」 · 浅色主题 · 1180×760 / 1440×900</p>
  <nav>${nav}<a href="README.md">README</a><a href="observations.md">重构观察</a><a href="rea-ipc-evidence.md">REA IPC 证据</a></nav>
</header>
<div class="toolbar"><input id="q" placeholder="筛选状态 / 类型 / 路由…" autocomplete="off"></div>
<main>
${sections}
<div class="empty" id="empty" hidden>没有匹配的状态。</div>
</main>
<script>
  const q = document.getElementById('q');
  const cards = [...document.querySelectorAll('.card')];
  const sections = [...document.querySelectorAll('main section')];
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      const hit = !v || card.dataset.text.includes(v);
      card.hidden = !hit;
      if (hit) visible++;
    }
    for (const section of sections) section.hidden = ![...section.querySelectorAll('.card')].some((c) => !c.hidden);
    document.getElementById('empty').hidden = visible > 0;
  });
</script>
</body>
</html>`
  fs.writeFileSync(path.join(INV, 'index.html'), page)
}

// ---------------------------------------------------------------------------
// REA IPC evidence
// ---------------------------------------------------------------------------
function generateReaEvidence() {
  const dir = path.join(BASELINE_DIR, 'rea')
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []
  const entries = []
  for (const file of files) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      entries.push({ file, json, result: json.normalized_result })
    } catch (error) {
      entries.push({ file, error: String(error) })
    }
  }
  const lines = []
  lines.push('# REA IPC 取证')
  lines.push('')
  lines.push('> 这一层补的是“控件 → 主进程 IPC”的运行期证据。REA 的 Electron 场景输出 IPC 时间线、窗口/进程与覆盖率，不产出截图；截图与 DOM/AX 由 Playwright 采集。')
  lines.push('')
  lines.push('## 关键结论')
  lines.push('')
  lines.push(
    table(
      ['操作', '新增的 IPC 通道（相对打开接口基线）', '证据文件'],
      [
        ['打开接口', '`target:read`', code('baseline/rea/open-api.json')],
        ['保存接口', '`target:save-checked`；主进程→渲染进程 `target:changed`', code('baseline/rea/save-api.json')],
        ['版本管理', '`target:versions:list`', code('baseline/rea/versions.json')],
        ['生成代码', '`target:codegen:curl`', code('baseline/rea/codegen.json')]
      ]
    )
  )
  lines.push('')
  lines.push('所有场景共有的启动/加载 IPC：`project:list`、`project:ensureDefault`、`target:list`、`model:list`、`env:list`、`settings:get`、`app:paths`、`mcp:config:get`、`mcp:status`、`mcp:tools`。')
  lines.push('')
  for (const entry of entries) {
    lines.push(`## ${entry.file.replace(/\.json$/, '')}`)
    lines.push('')
    if (entry.error) {
      lines.push(`读取失败：${code(entry.error)}`)
      lines.push('')
      continue
    }
    const r = entry.result
    if (!r) {
      lines.push('该文件不是 REA 成功结果。')
      lines.push('')
      continue
    }
    lines.push(`- 窗口：${r.windows.map((w) => code(w.url)).join('、')}`)
    lines.push(`- 覆盖率：${code(r.coverage.status)}；IPC 观测 ${r.ipc.observed} 条，丢弃 ${r.ipc.dropped} 条`)
    lines.push('')
    lines.push('### 动作')
    lines.push('')
    lines.push(table(['step_id', 'kind', 'status', 'elapsed_ms'], r.actions.map((a) => [code(a.step_id), a.kind, a.status, String(a.elapsed_ms)])))
    lines.push('')
    const by = new Map()
    for (const e of r.ipc.events) {
      const key = `${e.kind} | ${e.channel}`
      by.set(key, (by.get(key) || 0) + 1)
    }
    lines.push('### IPC 通道')
    lines.push('')
    lines.push(table(['kind', 'channel', '次数'], [...by.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => {
      const [kind, channel] = key.split(' | ')
      return [code(kind), code(channel), String(count)]
    })))
    lines.push('')
    lines.push(`原始证据：${link('JSON', `baseline/rea/${entry.file}`)}`)
    lines.push('')
  }
  lines.push('## 复现方式与限制')
  lines.push('')
  lines.push('```bash')
  lines.push('# REA 只传固定白名单环境变量，无法继承 KINDRAAPI_USER_DATA。')
  lines.push('# 复现时临时把 out/main/index.js 的 userData 改成 ui-inventory/.user-data，跑完还原/重建。')
  lines.push('npx -y rea-agents@6.7.0 capture-electron-scenario ui-inventory/tools/rea-scenarios/open-api.json --format json')
  lines.push('```')
  lines.push('')
  if (entries[0]?.result?.limitations?.length) {
    lines.push('REA 报告的限制：')
    lines.push('')
    for (const l of entries[0].result.limitations) lines.push(`- ${md(l)}`)
    lines.push('')
  }
  fs.writeFileSync(path.join(INV, 'rea-ipc-evidence.md'), lines.join('\n'))
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------
function generateIndexes() {
  const totalElements = screens.reduce((n, s) => n + (s.inventory?.elementCount || 0), 0)
  const lines = []
  lines.push('# KindraAPI 前端 UI 全量清单')
  lines.push('')
  lines.push(`- 生成时间：${inv.generatedAt}`)
  lines.push(`- 应用：${inv.app.name} v${inv.app.version}`)
  lines.push(`- 主项目：${inv.app.mainProjectName}（${code(inv.app.mainProjectId)}）`)
  lines.push(`- 采集驱动：${inv.capture.driver}；视口：${inv.capture.viewports.map((v) => v.key).join(' / ')}；主题：${inv.capture.theme}`)
  lines.push(`- 规模：${screens.length} 个状态，${totalElements} 条 DOM/AX 元素记录，${screens.filter((s) => s.kind !== 'page').length} 个弹窗/抽屉/菜单状态`)
  lines.push(`- 浏览截图：${link('index.html', 'index.html')}（按页面分组，可搜索筛选）`)
  lines.push('')
  lines.push('## 这份清单包含什么')
  lines.push('')
  lines.push('- 8 个路由页 + 全局框架（TopBar / LeftNav / StatusBar）的全部可见控件。')
  lines.push('- 每个按钮、菜单项、Tab、输入框、Tooltip、placeholder、空态、警告、表单校验、Toast/确认框。')
  lines.push('- 每个控件的运行态选择器、尺寸位置、禁用/选中状态，以及对应源码 `file:line`。')
  lines.push('- 双视口截图（1180×760 / 1440×900）与弹窗/抽屉裁切图。')
  lines.push('- 可重构前后对比的基线（截图哈希、布局区域、设计令牌）。')
  lines.push('- `inventory.json` 只保留控件/提示/树节点；完整原始 DOM/AX 转储在 `tools/.cache/inventory.raw.json`（本地，未入库）。')
  lines.push('')
  lines.push('## 目录')
  lines.push('')
  lines.push('```')
  lines.push('ui-inventory/')
  lines.push('├── README.md               ← 本文件')
  lines.push('├── inventory.json          ← 机读清单（控件/提示/树节点；原始全量在 tools/.cache/inventory.raw.json）')
  lines.push('├── observations.md         ← 重构观察（硬编码、重复、可访问性、风险）')
  lines.push('├── pages/                  ← 8 个路由页的详细清单')
  lines.push('├── components/             ← 每个组件的源码级控件/提示/IPC 清单')
  lines.push('├── flows/                  ← 每个弹窗/抽屉/菜单状态的截图与控件')
  lines.push('├── screenshots/')
  lines.push('│   ├── webp/               ← 入库截图')
  lines.push('│   └── png/                ← 本地原图（.gitignore）')
  lines.push('├── baseline/               ← 重构对比基线')
  lines.push('└── tools/                  ← 采集、静态扫描、文档生成脚本')
  lines.push('```')
  lines.push('')
  lines.push('## 页面索引')
  lines.push('')
  const pageRows = ROUTE_META.map((m) => {
    const ss = screens.filter((s) => s.route === m.path)
    return [link(m.title, pageDoc(m.path)), code(m.path), String(ss.length), String(ss.reduce((n, s) => n + (s.inventory?.elementCount || 0), 0)), md(m.purpose, 120)]
  })
  lines.push(table(['页面', '路由', '状态数', '元素数', '用途'], pageRows))
  lines.push('')
  lines.push('## 全局框架')
  lines.push('')
  const globalScreens = screens.filter((s) => s.route === '/global')
  lines.push(table(['状态', '类型', '截图'], globalScreens.map((s) => [code(s.id), s.kind, link('WebP', shotPath(s, INV))])))
  lines.push('')
  lines.push(`- 页面文档：${link('全局框架', 'pages/global.md')}`)
  lines.push(`- 源码：${GLOBAL_META.sources.map((s) => code(s)).join('、')}`)
  lines.push(`- 组件文档：${GLOBAL_META.sources.filter((s) => s.includes('/components/')).map((s) => link(path.basename(s), componentDoc(s))).join('、')}`)
  lines.push('')
  lines.push('## 组件索引')
  lines.push('')
  const componentFiles = stat.files.filter((f) => f.file.includes('/components/'))
  lines.push(table(['组件', '源码', '控件', '提示', '菜单', 'IPC'], componentFiles.map((f) => [link(path.basename(f.file), componentDoc(f.file)), code(f.file), String(f.tags.length), String(f.messages.length), String(f.menuItems.length), String(f.ipc.length)])))
  lines.push('')
  lines.push('## 交互流索引')
  lines.push('')
  for (const meta of [...ROUTE_META, GLOBAL_META]) {
    const flows = screens.filter((s) => s.route === meta.path && s.kind !== 'page')
    if (!flows.length) continue
    lines.push(`### ${meta.title}`)
    lines.push('')
    lines.push(flows.map((s) => `- ${link(s.id, flowDoc(s))}（${s.kind}，${s.viewport.width}×${s.viewport.height}）`).join('\n'))
    lines.push('')
  }
  lines.push('## 重构观察与基线')
  lines.push('')
  lines.push(`- ${link('observations.md', 'observations.md')}：硬编码颜色、内联样式、图标按钮可访问性、重复文案、高密度页面。`)
  lines.push(`- ${link('baseline/README.md', 'baseline/README.md')}：截图哈希、布局区域、设计令牌对比方法。`)
  lines.push('')
  lines.push('## 如何重跑')
  lines.push('')
  lines.push('```bash')
  lines.push('npm run build')
  lines.push('cp ui-inventory/tools/.env.example ui-inventory/.env.local   # 填 MySQL 只读连接')
  lines.push('npm run ui:inventory                # 全量采集 + WebP + inventory.json')
  lines.push('node ui-inventory/tools/generate-docs.mjs   # 重新生成本目录')
  lines.push('```')
  lines.push('')
  lines.push('可选参数：`--only=apis`、`--merge`、`--no-webp`、`--max-screens=20`。')
  lines.push('')
  lines.push('## 安全与数据说明')
  lines.push('')
  lines.push('- 采集使用 `KINDRAAPI_USER_DATA` 指向 `ui-inventory/.user-data/` 的临时副本；真实 userData 目录只读复制，未被写入。')
  lines.push('- 临时副本会关闭固定 CDP 端口（避开你正在运行的 9222 实例），并重写 `offline-projects.json` 只指向副本。')
  lines.push('- 截图来自主项目真实数据，可能包含接口名、URL、项目 ID、请求体等内容；对外分享前请先脱敏或改用空数据重跑。')
  lines.push('- MySQL 仅做表结构 introspection 与 SELECT；连接参数放在 `ui-inventory/.env.local`（已在 `.gitignore`）。')
  lines.push('')
  lines.push('## REA 说明')
  lines.push('')
  lines.push('- REA `capture-electron-scenario` 的动作只有 `click / wait / renderer-reload / renderer-crash / deep-link`，输出 IPC 时间线，不产出截图，因此截图与 DOM/AX 由 Playwright Electron 驱动完成。')
  lines.push(`- 详细 IPC 证据见 ${link('rea-ipc-evidence.md', 'rea-ipc-evidence.md')}（原始 JSON 在 ${code('baseline/rea/')}）。`)
  lines.push('')
  fs.writeFileSync(path.join(INV, 'README.md'), lines.join('\n'))

  // pages/README.md
  fs.writeFileSync(
    path.join(PAGES_DIR, 'README.md'),
    ['# 页面索引', '', table(['页面', '路由', '文件'], [...ROUTE_META, GLOBAL_META].map((m) => [link(m.title, `${m.key}.md`), code(m.path), code(pageDoc(m.path))])), ''].join('\n')
  )
  // components/README.md
  const compRows = stat.files.filter((f) => f.file.includes('/components/')).map((f) => [link(path.basename(f.file), path.basename(componentDoc(f.file))), code(f.file), String(f.lines)])
  fs.writeFileSync(path.join(COMPONENTS_DIR, 'README.md'), ['# 组件索引', '', table(['组件', '源码', '行数'], compRows), ''].join('\n'))
  // flows/README.md
  const flowLines = ['# 交互流索引', '']
  for (const meta of [...ROUTE_META, GLOBAL_META]) {
    const flows = screens.filter((s) => s.route === meta.path && s.kind !== 'page')
    if (!flows.length) continue
    flowLines.push(`## ${meta.title}`, '')
    for (const s of flows) flowLines.push(`- ${link(s.id, `${s.id}.md`)} — ${s.kind} · ${s.viewport.width}×${s.viewport.height} · ${md(s.notes || '', 100)}`)
    flowLines.push('')
  }
  fs.writeFileSync(path.join(FLOWS_DIR, 'README.md'), flowLines.join('\n'))
  // screenshots/README.md
  const shotLines = ['# 截图索引', '', 'WebP 入库；PNG 原图在 `png/` 下，已被 `.gitignore`。', '', table(['状态', '路由', '类型', 'WebP'], screens.map((s) => [code(s.id), code(s.route), s.kind, link('WebP', rel(path.join(INV, 'screenshots'), path.join(ROOT, s.screenshot.webp)))]))]
  fs.writeFileSync(path.join(INV, 'screenshots', 'README.md'), shotLines.join('\n'))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function normalizeMarkdown() {
  const files = []
  ;(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!/^(\.user-data|\.cache|\.runs|node_modules)$/.test(entry.name)) walk(full)
      } else if (entry.name.endsWith('.md')) {
        files.push(full)
      }
    }
  })(INV)
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const trimmed = text.replace(/[ \t]+$/gm, '')
    if (trimmed !== text) fs.writeFileSync(file, trimmed)
  }
}

for (const dir of [PAGES_DIR, COMPONENTS_DIR, FLOWS_DIR, BASELINE_DIR]) fs.mkdirSync(dir, { recursive: true })
for (const meta of [...ROUTE_META, GLOBAL_META]) generatePage(meta)
for (const file of stat.files.filter((f) => f.file.includes('/components/'))) generateComponent(file)
for (const screen of screens.filter((s) => s.kind !== 'page')) generateFlow(screen)
generateObservations()
generateBaseline()
generateReaEvidence()
generateGallery()
generateIndexes()
normalizeMarkdown()
console.log(`generated: ${screens.length} screens, ${ROUTE_META.length + 1} page docs, ${stat.files.filter((f) => f.file.includes('/components/')).length} component docs, ${screens.filter((s) => s.kind !== 'page').length} flow docs`)
