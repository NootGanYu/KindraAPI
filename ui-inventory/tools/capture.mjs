#!/usr/bin/env node
/**
 * KindraAPI UI inventory capture.
 *
 * Launches the source-built Electron app against a throwaway copy of the
 * user's real project data, then records:
 *   - full-window screenshots at 1180x760 and 1440x900
 *   - cropped screenshots for dialogs/drawers
 *   - a DOM + accessibility-oriented element inventory per screen
 *   - layout regions, design tokens, and screenshot hashes (baseline)
 *
 * The real userData directory is never written to.
 *
 * Usage:
 *   node ui-inventory/tools/capture.mjs                 # full run
 *   node ui-inventory/tools/capture.mjs --only=apis     # one route
 *   node ui-inventory/tools/capture.mjs --reuse         # keep temp data
 *   node ui-inventory/tools/capture.mjs --no-webp       # keep PNG only
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const INV = path.join(ROOT, 'ui-inventory')
const TMP = path.join(INV, '.user-data')
const PNG_DIR = path.join(INV, 'screenshots', 'png')
const WEBP_DIR = path.join(INV, 'screenshots', 'webp')
const BASELINE_DIR = path.join(INV, 'baseline')
const CACHE_DIR = path.join(HERE, '.cache')
const INVENTORY_FILE = path.join(INV, 'inventory.json')

const REAL_USER_DATA =
  process.env.KINDRAAPI_REAL_USER_DATA ||
  (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'KindraAPI')
    : path.join(os.homedir(), 'Library', 'Application Support', 'KindraAPI'))
const MAIN_ID = '1a175dca3b49a64930001'
const MAIN_NAME = '默认项目'
const VIEWPORTS = [
  { key: '1180x760', width: 1180, height: 760 },
  { key: '1440x900', width: 1440, height: 900 }
]
const ROUTES = ['/history', '/apis', '/docs', '/schemas', '/mqtt', '/automation', '/git', '/settings']
const ARGS = process.argv.slice(2)
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) || '').split('=')[1] || ''
const REUSE = ARGS.includes('--reuse')
const MERGE = ARGS.includes('--merge')
const NO_WEBP = ARGS.includes('--no-webp')
const MAX_SCREENS = Number((ARGS.find((a) => a.startsWith('--max-screens=')) || '').split('=')[1] || 0)

const screens = []
let currentRoute = '/global'
let screenSeq = 0
let page
let app

if (MERGE && fs.existsSync(INVENTORY_FILE)) {
  try {
    const previous = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'))
    if (Array.isArray(previous.screens)) {
      screens.push(...previous.screens)
      screenSeq = screens.length
      console.log(`merge: loaded ${screens.length} existing screens`)
    }
  } catch (error) {
    console.warn('merge: could not read previous inventory:', error.message)
  }
}

// ---------------------------------------------------------------------------
// Throwaway userData
// ---------------------------------------------------------------------------
function prepareUserData() {
  if (!REUSE && fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true })
  if (!fs.existsSync(path.join(TMP, 'offline-data'))) {
    fs.mkdirSync(TMP, { recursive: true })
    for (const dir of ['offline-data', 'offline-data-local']) {
      fs.cpSync(path.join(REAL_USER_DATA, dir), path.join(TMP, dir), { recursive: true })
    }
    console.log('copied userData ->', TMP)
  }
  // The copied profile enables a fixed CDP port that the user's running
  // packaged instance already owns. Disable it in the throwaway copy only.
  const debugConfig = path.join(TMP, 'offline-data-local', 'settings', 'debug_config.json')
  fs.mkdirSync(path.dirname(debugConfig), { recursive: true })
  fs.writeFileSync(debugConfig, JSON.stringify({ enabled: false }, null, 2))

  // <userData>/offline-projects.json stores absolute project paths, so rewrite
  // it to point at the copied project and only that project.
  fs.writeFileSync(
    path.join(TMP, 'offline-projects.json'),
    JSON.stringify(
      [
        {
          project_id: MAIN_ID,
          path: path.join(TMP, 'offline-data', MAIN_ID),
          created_at: '2026-10-26T01:39:16.531Z'
        }
      ],
      null,
      2
    )
  )

  // Give the Git page a real repository inside the throwaway copy.
  const projectDir = path.join(TMP, 'offline-data', MAIN_ID)
  try {
    if (!fs.existsSync(path.join(projectDir, '.git'))) {
      execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.email', 'ui-inventory@example.local'], { cwd: projectDir })
      execFileSync('git', ['config', 'user.name', 'UI Inventory'], { cwd: projectDir })
      fs.writeFileSync(path.join(projectDir, 'README.md'), '# 默认项目\n\n用于 UI 盘点截图的临时仓库。\n')
      fs.writeFileSync(path.join(projectDir, 'docs-notes.md'), '# 接口整理笔记\n')
      execFileSync('git', ['add', '.'], { cwd: projectDir, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', 'chore: 初始化项目快照'], { cwd: projectDir, stdio: 'ignore' })
      fs.appendFileSync(path.join(projectDir, 'README.md'), '\n本地修改：用于 UI 截图。\n')
      fs.writeFileSync(path.join(projectDir, 'draft.md'), '未跟踪草稿\n')
      console.log('prepared temporary git repository')
    }
  } catch (error) {
    console.warn('git preparation skipped:', error.message)
  }

  for (const dir of [PNG_DIR, WEBP_DIR, BASELINE_DIR, CACHE_DIR]) fs.mkdirSync(dir, { recursive: true })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => page.waitForTimeout(ms)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const btnName = (s) => new RegExp(`(^|\\s)${esc(s)}$`)
const ZH_ID = {
  设计: 'design',
  调试: 'debug',
  接口用例: 'cases',
  一键压测: 'stress',
  Mock: 'mock',
  认证: 'auth',
  预执行操作: 'pre-request',
  后执行操作: 'post-request',
  实时响应: 'response',
  响应头: 'headers',
  响应示例: 'example',
  字段说明: 'field-docs',
  实际请求: 'actual-request',
  控制台: 'console',
  项目: 'project',
  目录: 'folder',
  接口: 'api',
  自定义: 'custom',
  数据字典管理: 'dictionary',
  数据库管理: 'database',
  新建数据模型: 'model',
  可视化: 'visual',
  'Raw 编辑': 'raw',
  预览: 'preview',
  生成代码: 'codegen',
  智能导入: 'smart-import',
  消息: 'messages',
  发布: 'publish',
  运行记录: 'attempts',
  环境与请求前缀: 'env',
  全局变量: 'global-vars',
  发送设置: 'send',
  MCP: 'mcp',
  全部: 'all',
  HTTP: 'http',
  GraphQL: 'graphql',
  'TLS 校验证书': 'tls',
  '遗嘱 Will': 'will',
  'MQTT 5 属性': 'props',
  分支: 'branches',
  远程: 'remotes',
  同步: 'sync',
  添加变量: 'add-variable',
  历史运行: 'history',
  运行结果: 'run-result',
  分享服务: 'share-service'
}
function localizeName(name) {
  let out = String(name)
  for (const [zh, en] of Object.entries(ZH_ID).sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(zh).join(en)
  }
  return out
}
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/')
}
function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function uniqueId(base) {
  let id = base
  let n = 2
  while (screens.some((s) => s.id === id)) id = `${base}-${n++}`
  return id
}

async function setViewport(vp) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    win.setBounds({ width: size.width, height: size.height })
  }, vp)
  await page.waitForTimeout(350)
}

async function goto(route) {
  await closeOverlays()
  currentRoute = route
  await page.evaluate((h) => {
    location.hash = h
  }, '#' + route)
  await page.waitForTimeout(1100)
}

async function clickButton(name, scope = '.main') {
  const loc = page.locator(scope).getByRole('button', { name: btnName(name) })
  const count = await loc.count()
  if (!count) return false
  await loc.first().click({ force: true, timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(750)
  return true
}

async function clickButtonLoose(re, scope = '.main') {
  const loc = page.locator(scope).getByRole('button', { name: re })
  if (!(await loc.count())) return false
  await loc.first().click({ force: true, timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(750)
  return true
}

async function clickButtonAt(name, index, scope = '.main') {
  const loc = page.locator(scope).getByRole('button', { name: btnName(name) })
  const count = await loc.count()
  if (!count) return false
  const i = index === 'last' ? count - 1 : Math.max(0, Math.min(index, count - 1))
  await loc.nth(i).click({ force: true, timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(750)
  return true
}

async function clickText(text, scope = '.main', exact = false) {
  const loc = page.locator(scope).getByText(text, { exact })
  if (!(await loc.count())) return false
  await loc.first().click({ force: true, timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(750)
  return true
}

async function clickTab(label, scope = '.main') {
  const loc = page.locator(`${scope} .ant-tabs-tab`).filter({ hasText: label })
  if (await loc.count()) {
    await loc.first().click({ force: true, timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(650)
    return true
  }
  // Some custom tab strips expose role=tab or plain buttons instead of
  // .ant-tabs-tab (e.g. the MQTT message/publish/attempts strip).
  const fallback = page.locator(`${scope} [role="tab"], ${scope} button`).filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) })
  if (await fallback.count()) {
    await fallback.first().click({ force: true, timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(650)
    return true
  }
  return false
}

async function clickSegment(label, scope = '.main') {
  const loc = page.locator(`${scope} .segmented button`).filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) })
  if (await loc.count()) {
    await loc.first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(650)
    return true
  }
  const alt = page.locator(`${scope} .ant-segmented-item`).filter({ hasText: label })
  if (await alt.count()) {
    await alt.first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(650)
    return true
  }
  return false
}

async function expandTree() {
  for (let i = 0; i < 40; i++) {
    const switcher = page.locator('.main .ant-tree-switcher.ant-tree-switcher_close').first()
    if (!(await switcher.count())) break
    await switcher.click({ force: true }).catch(() => {})
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(350)
}

async function visibleOverlays() {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
    }
    return [...document.querySelectorAll('.ant-modal, .ant-drawer, .ant-dropdown, .ant-popover, .ant-select-dropdown')]
      .filter(vis)
      .map((el) => ({
        cls: String(el.className),
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        rect: (() => {
          const r = el.getBoundingClientRect()
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        })()
      }))
  })
}

async function closeOverlays() {
  for (let i = 0; i < 3; i++) {
    const overlays = await visibleOverlays()
    if (!overlays.length) return
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(220)
    const close = page.locator('.ant-modal-close:visible, .ant-drawer-close:visible, .ant-popover-close:visible').first()
    if (await close.count()) {
      await close.click({ force: true }).catch(() => {})
      await page.waitForTimeout(180)
    }
    const cancel = page
      .locator('.ant-modal:visible, .ant-drawer:visible')
      .getByRole('button', { name: /^(取\s*消|关闭|Close)$/ })
      .first()
    if (await cancel.count()) {
      await cancel.click({ force: true }).catch(() => {})
      await page.waitForTimeout(180)
    }
  }
}

// ---------------------------------------------------------------------------
// DOM inventory / baseline
// ---------------------------------------------------------------------------
async function collectInventory(scopeSelector) {
  return page.evaluate((scopeSel) => {
    const isVis = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
    }
    // Playwright's :visible pseudo-class is not valid CSS; strip it and pick
    // the last visible match (antd portals append overlays to the body).
    const clean = String(scopeSel || '').replace(/:visible/g, '').trim()
    let root = document.body
    if (clean) {
      const candidates = [...document.querySelectorAll(clean)].filter(isVis)
      root = candidates[candidates.length - 1] || null
      if (!root) return { error: `scope not found: ${scopeSel}` }
    }
    const clip = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
    const cssPath = (el) => {
      const bits = []
      let node = el
      while (node && node.nodeType === 1 && node !== document.body && bits.length < 6) {
        let part = node.tagName.toLowerCase()
        if (node.id) {
          part += '#' + node.id
          bits.unshift(part)
          break
        }
        const cls = [...node.classList].filter((c) => /^[a-zA-Z_-][\w-]*$/.test(c)).slice(0, 2)
        if (cls.length) part += '.' + cls.join('.')
        const parent = node.parentElement
        if (parent) {
          const same = [...parent.children].filter((c) => c.tagName === node.tagName)
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`
        }
        bits.unshift(part)
        node = node.parentElement
      }
      return bits.join(' > ')
    }
    const sectionOf = (el) => {
      let node = el
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        if (node.matches?.('.ant-modal')) return 'modal:' + clip(node.querySelector('.ant-modal-title')?.innerText || '', 80)
        if (node.matches?.('.ant-drawer')) return 'drawer:' + clip(node.querySelector('.ant-drawer-title')?.innerText || '', 80)
        if (node.matches?.('.request-pane')) return 'request-editor'
        if (node.matches?.('.response-pane')) return 'response-panel'
        if (node.matches?.('.ant-card')) return 'card:' + clip(node.querySelector('.ant-card-head-title')?.innerText || '', 80)
        if (node.matches?.('form')) return 'form'
      }
      return ''
    }
    const styleOf = (el) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        backgroundColor: s.backgroundColor,
        borderColor: s.borderColor,
        borderRadius: s.borderRadius,
        padding: s.padding,
        margin: s.margin
      }
    }
    const maskValue = (el) => {
      const type = (el.getAttribute('type') || '').toLowerCase()
      const name = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase()
      if (type === 'password' || /pass|secret|token|key/.test(name)) return el.value ? '***' : ''
      return clip(el.value || '', 80)
    }
    const pick = (el) => {
      const icon = el.querySelector?.('.anticon')
      const iconClass = icon ? [...icon.classList].filter((c) => c.startsWith('anticon-')).join(' ') : ''
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        classes: String(el.className || '').slice(0, 180),
        text: clip(el.innerText || el.textContent || ''),
        ariaLabel: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        placeholder: el.getAttribute('placeholder') || '',
        value: el.matches('input, textarea, select') ? maskValue(el) : undefined,
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        checked: el.checked === true || el.getAttribute('aria-checked') === 'true',
        active: /(^|\s)(active|selected|ant-tabs-tab-active|ant-segmented-item-selected|ant-radio-button-wrapper-checked)(\s|$)/.test(String(el.className || '')),
        icon: iconClass,
        section: sectionOf(el),
        selector: cssPath(el),
        style: styleOf(el)
      }
    }
    const selectors = [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '.ant-tabs-tab',
      '.ant-tabs-tab-btn',
      '.ant-segmented-item',
      '.ant-radio-button-wrapper',
      '.ant-radio-wrapper',
      '.ant-checkbox-wrapper',
      '.ant-switch',
      '.ant-menu-item',
      '.ant-dropdown-menu-item',
      '.ant-select-item-option',
      '.ant-tree-treenode',
      '.ant-tree-node-content-wrapper',
      '.ant-table-thead th',
      '.ant-card-head-title',
      '.ant-collapse-header',
      '.ant-form-item-label',
      '.ant-form-item-explain-error',
      '.ant-descriptions-item-label',
      '.ant-descriptions-item-content',
      '.ant-modal-title',
      '.ant-drawer-title',
      '.ant-select',
      '.ant-input-number',
      '.ant-picker',
      '.ant-empty-description',
      '.ant-alert',
      '.ant-message-notice',
      '.ant-notification-notice',
      '.ant-tooltip-inner',
      '[title]',
      '[aria-label]'
    ]
    const els = [...root.querySelectorAll(selectors.join(','))].filter(isVis)
    const seen = new Set()
    const elements = []
    for (const el of els) {
      const selector = cssPath(el)
      if (seen.has(selector)) continue
      seen.add(selector)
      elements.push(pick(el))
    }

    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,.ant-typography,.ant-card-head-title,.ant-collapse-header')]
      .filter(isVis)
      .map(pick)

    const tableHeaders = [...root.querySelectorAll('.ant-table-thead th')].filter(isVis).map((el) => clip(el.innerText))
    const tableRows = root.querySelectorAll('.ant-table-tbody tr.ant-table-row').length

    const prompts = {
      empty: [...root.querySelectorAll('.ant-empty-description, .ant-empty-normal')].filter(isVis).map((el) => clip(el.innerText)),
      alerts: [...root.querySelectorAll('.ant-alert')].filter(isVis).map(pick),
      formErrors: [...root.querySelectorAll('.ant-form-item-explain-error')].filter(isVis).map((el) => clip(el.innerText)),
      messages: [...root.querySelectorAll('.ant-message-notice, .ant-notification-notice')].filter(isVis).map((el) => clip(el.innerText)),
      tooltips: [...root.querySelectorAll('.ant-tooltip-inner')].filter(isVis).map((el) => clip(el.innerText)),
      titleAttrs: [...root.querySelectorAll('[title]')].filter(isVis).map((el) => ({ title: el.getAttribute('title'), text: clip(el.innerText, 80) })).filter((x) => x.title)
    }

    return {
      elementCount: elements.length,
      elements,
      headings,
      tableHeaders,
      tableRows,
      prompts
    }
  }, scopeSelector)
}

async function collectRegions() {
  return page.evaluate(() => {
    const out = {}
    const add = (key, sel) => {
      const el = document.querySelector(sel)
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      out[key] = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    }
    add('topbar', '.topbar')
    add('rail', '.rail')
    add('main', '.main')
    add('statusbar', '.app-status')
    add('modeRow', '.mode-row')
    add('segmented', '.mode-row .segmented')
    add('requestPane', '.request-pane')
    add('responsePane', '.response-pane')
    add('tabsNav', '.main .ant-tabs-nav')
    const modals = [...document.querySelectorAll('.ant-modal, .ant-drawer')].filter((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'
    })
    out.overlays = modals.map((el, i) => {
      const r = el.getBoundingClientRect()
      return { index: i, cls: String(el.className), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    })
    return out
  })
}

async function collectTokens() {
  return page.evaluate(() => {
    const read = (sel, props) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const s = getComputedStyle(el)
      const out = {}
      for (const p of props) out[p] = s[p]
      return out
    }
    return {
      body: read('body', ['fontFamily', 'fontSize', 'color', 'backgroundColor']),
      topbar: read('.topbar', ['height', 'backgroundColor', 'borderBottomColor', 'color']),
      rail: read('.rail', ['width', 'backgroundColor', 'color', 'borderRightColor']),
      statusbar: read('.app-status', ['height', 'backgroundColor', 'color', 'fontSize']),
      primaryButton: read('.ant-btn-primary', ['height', 'backgroundColor', 'color', 'borderRadius', 'fontSize', 'fontWeight', 'padding']),
      defaultButton: read('.ant-btn-default', ['height', 'backgroundColor', 'color', 'borderColor', 'borderRadius', 'fontSize']),
      input: read('.ant-input', ['height', 'backgroundColor', 'borderColor', 'borderRadius', 'fontSize', 'color']),
      activeTab: read('.ant-tabs-tab-active', ['color', 'fontSize', 'fontWeight']),
      tableHeader: read('.ant-table-thead th', ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'padding']),
      tag: read('.ant-tag', ['backgroundColor', 'color', 'borderColor', 'borderRadius', 'fontSize']),
      modal: read('.ant-modal-content', ['backgroundColor', 'borderRadius', 'boxShadow']),
      card: read('.ant-card', ['backgroundColor', 'borderColor', 'borderRadius'])
    }
  })
}

// ---------------------------------------------------------------------------
// Record a screen
// ---------------------------------------------------------------------------
async function record(name, opts = {}) {
  if (MAX_SCREENS && screens.length >= MAX_SCREENS) return null
  const routeKey = slug(opts.route || currentRoute) || 'global'
  const rawSlug = slug(localizeName(name)) || 'state'
  const base = routeKey === 'global' ? rawSlug : rawSlug.startsWith(`${routeKey}-`) ? rawSlug : `${routeKey}__${rawSlug}`
  if (MERGE && screens.some((screen) => screen.id === base)) return null
  const id = uniqueId(base)
  screenSeq += 1
  const vp = opts.viewport || (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
  const png = path.join(PNG_DIR, `${id}.png`)
  await page.screenshot({ path: png, animations: 'disabled' })
  const webp = path.join(WEBP_DIR, `${id}.webp`)
  const scope = opts.scope || '.main'
  let inventory
  try {
    inventory = await collectInventory(scope)
  } catch (error) {
    inventory = { error: String(error) }
  }
  const regions = await collectRegions()
  const tokens = await collectTokens()
  let cropPng = null
  if (opts.crop) {
    try {
      cropPng = path.join(PNG_DIR, `${id}__crop.png`)
      await page.locator(opts.crop).last().screenshot({ path: cropPng, animations: 'disabled' })
    } catch {
      cropPng = null
    }
  }
  const screen = {
    id,
    route: opts.route || currentRoute,
    name,
    kind: opts.kind || 'page',
    notes: opts.notes || '',
    viewport: { width: vp.width, height: vp.height },
    screenshot: { png: rel(png), webp: rel(webp), cropPng: cropPng ? rel(cropPng) : null },
    sha256: hashFile(png),
    regions,
    tokens,
    inventory
  }
  screens.push(screen)
  if (screens.length % 5 === 0) writeInventory()
  console.log(`  [${screens.length}] ${id}  (${inventory?.elementCount ?? '?'} elements)`)
  return screen
}

async function recordViewports(name, opts = {}) {
  for (const vp of VIEWPORTS) {
    await setViewport(vp)
    await record(`${name}__${vp.key}`, { ...opts, viewport: vp })
  }
  await setViewport(VIEWPORTS[0])
}

// ---------------------------------------------------------------------------
// Route scenarios
// ---------------------------------------------------------------------------
async function captureGlobalChrome() {
  await goto('/apis')
  const projectBtn = page.locator('.topbar').getByRole('button', { name: /默认项目/ }).first()
  if (await projectBtn.count()) {
    await projectBtn.click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
    await record('chrome__project-menu', { route: '/global', kind: 'menu', scope: '.ant-dropdown, .main', crop: '.ant-dropdown' })
    await page.keyboard.press('Escape')
  }
  for (const [name, sel] of [
    ['git', '.rail a[href="#/git"]'],
    ['trash', '.rail button.icon-only']
  ]) {
    const el = page.locator(sel).first()
    if (await el.count()) {
      await el.hover().catch(() => {})
      await page.waitForTimeout(500)
      await record(`chrome__tooltip-${name}`, { route: '/global', kind: 'tooltip', scope: '.ant-tooltip, .main' })
    }
  }
}

async function captureApis() {
  await goto('/apis')
  await recordViewports('apis__welcome', { route: '/apis', notes: '未选择接口时的欢迎页/空态' })

  await expandTree()
  await record('apis__tree-expanded', { route: '/apis', notes: 'API 树全部展开' })

  const node = page.locator('.main .ant-tree-treenode').filter({ hasText: /^\s*(GET|POST|PUT|DELETE|PATCH)/ }).first()
  if (await node.count()) {
    await node.click({ force: true }).catch(() => {})
    await page.waitForTimeout(1300)
  }
  await recordViewports('apis__editor-debug', { route: '/apis', notes: '接口调试工作台默认态' })

  for (const mode of ['设计', '接口用例', '一键压测', 'Mock']) {
    if (await clickSegment(mode, '.main')) {
      await record(`apis__mode-${mode}`, { route: '/apis', notes: `模式：${mode}` })
      if (mode === '设计') await clickButton('添加错误码', '.main')
    }
  }
  await clickSegment('调试', '.main')

  for (const tab of ['Header', 'Query', 'Path', 'Body', '认证', 'Cookie', '预执行操作', '后执行操作']) {
    if (await clickTab(tab, '.request-pane')) {
      await record(`apis__request-tab-${tab}`, { route: '/apis', notes: `请求编辑器 Tab：${tab}` })
    }
  }
  for (const tab of ['实时响应', '响应头', '响应示例', '字段说明', '实际请求', '控制台']) {
    if (await clickTab(tab, '.response-pane')) {
      await record(`apis__response-tab-${tab}`, { route: '/apis', notes: `响应面板 Tab：${tab}` })
    }
  }

  // More menu
  const more = page.locator('.api-meta button.mini').last()
  if (await more.count()) {
    await more.click({ force: true }).catch(() => {})
    await page.waitForTimeout(500)
    await record('apis__more-menu', { route: '/apis', kind: 'menu', scope: '.ant-dropdown', crop: '.ant-dropdown' })
    const code = page.getByRole('menuitem', { name: /生成代码/ }).first()
    if (await code.count()) {
      await code.click({ force: true }).catch(() => {})
      await page.waitForTimeout(900)
      await record('apis__dialog-codegen', { route: '/apis', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
      await closeOverlays()
    }
    await more.click({ force: true }).catch(() => {})
    await page.waitForTimeout(500)
    const versions = page.getByRole('menuitem', { name: /版本管理/ }).first()
    if (await versions.count()) {
      await versions.click({ force: true }).catch(() => {})
      await page.waitForTimeout(900)
      await record('apis__drawer-versions', { route: '/apis', kind: 'drawer', scope: '.ant-drawer:visible', crop: '.ant-drawer:visible' })
      await closeOverlays()
    }
  }

  const desc = page.locator('.api-meta button.mini').first()
  if (await desc.count()) {
    await desc.click({ force: true }).catch(() => {})
    await page.waitForTimeout(900)
    await record('apis__dialog-description', { route: '/apis', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
    await closeOverlays()
  }

  if (await clickButton('分享', '.main')) {
    await record('apis__dialog-share', { route: '/apis', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
    await closeOverlays()
  }

  const env = page.locator('.main').getByText('默认环境', { exact: true }).first()
  if (await env.count()) {
    await env.click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
    await record('apis__environment-menu', { route: '/apis', kind: 'menu', scope: '.ant-dropdown', crop: '.ant-dropdown' })
    await page.keyboard.press('Escape')
  }

  const search = page.locator('.main input[placeholder="关键字/URL"]').first()
  if (await search.count()) {
    await search.fill('__no_such_api_zzz__')
    await page.waitForTimeout(700)
    await record('apis__empty-search', { route: '/apis', notes: '搜索无结果空态' })
    await search.fill('')
    await page.waitForTimeout(500)
  }
}

async function captureHistory() {
  await goto('/history')
  await recordViewports('history__list', { route: '/history', notes: '发送历史列表（最多 100 条）' })
  const row = page.locator('.main .ant-table-tbody tr.ant-table-row').first()
  if (await row.count()) {
    await row.click({ force: true }).catch(() => {})
    await page.waitForTimeout(900)
    await record('history__detail-drawer', { route: '/history', kind: 'drawer', scope: '.ant-drawer:visible', crop: '.ant-drawer:visible' })
    for (const tab of ['响应头', 'Cookie', '响应示例', '字段说明', '实际请求', '控制台']) {
      if (await clickTab(tab, '.ant-drawer:visible')) {
        await record(`history__drawer-tab-${tab}`, { route: '/history', kind: 'drawer-tab', scope: '.ant-drawer:visible' })
      }
    }
    // Response body view toggles: pretty / raw / preview / visual / table.
    for (const mode of ['美化', '原生', '预览', '可视化', '表格']) {
      if (await clickButton(mode, '.ant-drawer:visible')) {
        await record(`history__drawer-view-${mode}`, { route: '/history', kind: 'drawer-view', scope: '.ant-drawer:visible', notes: `响应视图：${mode}` })
      }
    }
    await closeOverlays()
  }
  const search = page.locator('.main input[placeholder="搜索接口或 URL"]').first()
  if (await search.count()) {
    await search.fill('__no_such_history_zzz__')
    await page.waitForTimeout(700)
    await record('history__empty-search', { route: '/history', notes: '历史搜索无结果' })
    await search.fill('')
  }
  if (await clickButton('清空', '.main')) {
    await page.waitForTimeout(600)
    await record('history__confirm-clear', { route: '/history', kind: 'confirm', scope: '.ant-modal-confirm:visible', crop: '.ant-modal-confirm:visible' })
    await closeOverlays()
  }
}

async function captureDocs() {
  await goto('/docs')
  await recordViewports('docs__list', { route: '/docs', notes: '文档分享列表与筛选' })
  if (await clickButton('新建分享', '.main')) {
    await page.waitForTimeout(500)
    await record('docs__dialog-new-share', { route: '/docs', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
    for (const tab of ['项目', '目录', '接口', '自定义']) {
      // These are antd Radio.Button scope pills, not <button> elements.
      if (await clickText(tab, '.ant-modal:visible', true)) {
        await record(`docs__new-share-tab-${tab}`, { route: '/docs', kind: 'dialog-tab', scope: '.ant-modal:visible' })
      }
    }
    await closeOverlays()
  }
  const shareService = page.locator('.main').getByText(/分享服务/, { exact: false }).first()
  if (await shareService.count()) {
    await shareService.click({ force: true }).catch(() => {})
    await page.waitForTimeout(800)
    await record('docs__dialog-share-service', { route: '/docs', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
    await closeOverlays()
  }
  for (const filter of ['全部', '自定义', '目录', 'HTTP', 'SSE', 'MD', 'gRPC', 'TCP', 'Websocket', 'Socket.IO', 'GraphQL']) {
    if (await clickButton(filter, '.main')) {
      // Only record a couple of representative filtered states to keep noise down.
      if (['HTTP', 'GraphQL'].includes(filter)) {
        await record(`docs__filter-${filter}`, { route: '/docs', notes: `筛选：${filter}` })
      }
    }
  }
}

async function captureSchemas() {
  await goto('/schemas')
  await recordViewports('schemas__landing', { route: '/schemas', notes: '字典/模型/数据库入口' })

  // Data dictionary
  if (await clickText('数据字典管理', '.main')) {
    await page.waitForTimeout(900)
    await record('schemas__dictionary', { route: '/schemas', notes: '数据字典面板' })
    await clickButton('新建数据字段', '.main')
    await page.waitForTimeout(600)
    await record('schemas__dictionary-new-field', { route: '/schemas', kind: 'dialog', scope: '.main', crop: '.ant-modal:visible' })
    await closeOverlays()
  }

  // Database management
  await goto('/schemas')
  if (await clickText('数据库管理', '.main')) {
    await page.waitForTimeout(900)
    await record('schemas__database-empty', { route: '/schemas', notes: '数据库连接列表空态' })
    if (await clickButtonAt('新建', 'last', '.main')) {
      await page.waitForTimeout(500)
      await record('schemas__dialog-db-connection', { route: '/schemas', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
      await fillDbConnection()
      await record('schemas__dialog-db-connection-filled', { route: '/schemas', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
      if (await clickButtonLoose(/^(保\s*存|保存|确\s*定|确定)$/, '.ant-modal:visible')) {
        await page.waitForTimeout(1600)
        await record('schemas__database-list', { route: '/schemas', notes: '已保存的 MySQL 连接（只读）' })
        const conn = page.locator('.main .ant-table-tbody tr.ant-table-row, .main .ant-list-item').first()
        if (await conn.count()) {
          // Row actions: [0] edit, [1] import table structure, [2] delete.
          const importBtn = conn.locator('button.icon-btn').nth(1)
          if (await importBtn.count()) {
            await importBtn.click({ force: true }).catch(() => {})
            await page.waitForTimeout(2600)
            await record('schemas__dialog-import-tables', { route: '/schemas', kind: 'dialog', scope: '.ant-modal:visible, .ant-drawer:visible', crop: '.ant-modal:visible, .ant-drawer:visible', notes: '导入表结构：表列表（ft-nbm-v2，只读）' })
            const firstTable = page.locator('.ant-modal:visible .ant-table-tbody tr.ant-table-row, .ant-drawer:visible .ant-table-tbody tr.ant-table-row').first()
            if (await firstTable.count()) {
              await firstTable.click({ force: true }).catch(() => {})
              await page.waitForTimeout(900)
              await record('schemas__dialog-import-tables-selected', { route: '/schemas', kind: 'dialog', scope: '.ant-modal:visible, .ant-drawer:visible', crop: '.ant-modal:visible, .ant-drawer:visible', notes: '导入表结构：选中表后的字段预览' })
            }
          }
        }
      } else {
        await record('schemas__dialog-db-connection-validation', { route: '/schemas', notes: '数据库连接表单校验/未保存态', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
      }
      await closeOverlays()
    }
  }

  // Model editor. After the database view the schema route keeps its inner
  // state, so switch back to the model view first.
  await goto('/schemas')
  const modelsNav = page.locator('.main .schema-nav-row').filter({ hasText: '全部模型' }).first()
  if (await modelsNav.count()) {
    await modelsNav.click({ force: true }).catch(() => {})
    await page.waitForTimeout(900)
  }
  let createdModel = false
  const newBtn = page.locator('.main .schemas-new').first()
  if (await newBtn.count()) {
    await newBtn.click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
    const item = page.getByRole('menuitem', { name: /新建数据模型/ }).first()
    if (await item.count()) {
      await item.click({ force: true }).catch(() => {})
      createdModel = true
    }
  }
  if (!createdModel) createdModel = await clickText('新建数据模型', '.main')
  if (createdModel) {
    await page.waitForTimeout(1300)
    await record('schemas__model-editor', { route: '/schemas', notes: '数据模型编辑器' })
    for (const mode of ['可视化', 'Raw 编辑', '预览', '生成代码', '智能导入']) {
      let clicked = false
      const btn = page.locator('.main').getByRole('button', { name: new RegExp(`^\\s*${esc(mode)}\\s*$`) }).first()
      if (await btn.count()) {
        await btn.click({ force: true }).catch(() => {})
        clicked = true
      } else {
        clicked = await clickText(mode, '.main', true)
      }
      if (clicked) {
        await page.waitForTimeout(900)
        await record(`schemas__model-${mode}`, { route: '/schemas', notes: `模型模式：${mode}` })
      }
    }
    if (await clickButton('添加字段', '.main')) {
      await record('schemas__model-add-field', { route: '/schemas', notes: '添加字段后的字段表' })
    }
  }
}

function loadEnvLocal() {
  const file = path.join(INV, '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
}

async function fillDbConnection() {
  const modal = page.locator('.ant-modal:visible').last()
  const fill = async (placeholder, value) => {
    const input = modal.locator(`input[placeholder="${placeholder}"]`).first()
    if (await input.count()) {
      await input.fill(String(value)).catch(() => {})
      await page.waitForTimeout(120)
    }
  }
  const host = process.env.MYSQL_HOST || '127.0.0.1'
  const port = process.env.MYSQL_PORT || '3307'
  const user = process.env.MYSQL_USER || 'root'
  const password = process.env.MYSQL_PASSWORD || ''
  const database = process.env.MYSQL_DATABASE || 'ft-nbm-v2'
  await fill('连接名称', '本地 MySQL（只读盘点）')
  await fill('127.0.0.1', host)
  await fill('3306', port)
  await fill('root', user)
  await fill('密码', password)
  await fill('database', database)
}

async function captureMqtt() {
  await goto('/mqtt')
  await recordViewports('mqtt__empty', { route: '/mqtt', notes: 'MQTT 连接列表空态' })
  if (await clickButton('新建连接', '.main')) {
    await page.waitForTimeout(1000)
    await recordViewports('mqtt__profile-editor', { route: '/mqtt', notes: 'MQTT 连接编辑器（新建默认连接）' })
    for (const tab of ['消息', '发布', '运行记录']) {
      if (await clickTab(tab, '.main')) {
        await record(`mqtt__tab-${tab}`, { route: '/mqtt', notes: `MQTT Tab：${tab}` })
      }
    }
    if (await clickButton('更多操作', '.main')) {
      await record('mqtt__more-menu', { route: '/mqtt', kind: 'menu', scope: '.ant-dropdown', crop: '.ant-dropdown' })
      await page.keyboard.press('Escape')
    }
    if (await clickButton('版本历史', '.main')) {
      await page.waitForTimeout(700)
      await record('mqtt__drawer-versions', { route: '/mqtt', kind: 'drawer', scope: '.ant-drawer:visible', crop: '.ant-drawer:visible' })
      await closeOverlays()
    }
    if (await clickButton('添加订阅', '.main')) {
      await record('mqtt__subscription-row', { route: '/mqtt', notes: '新增订阅行' })
    }
    // Expand collapsible advanced sections.
    for (const label of ['TLS 校验证书', '遗嘱 Will', 'MQTT 5 属性']) {
      const header = page.locator('.main .ant-collapse-header').filter({ hasText: label }).first()
      if (await header.count()) {
        await header.click({ force: true }).catch(() => {})
        await page.waitForTimeout(500)
        await record(`mqtt__advanced-${label}`, { route: '/mqtt', notes: `展开：${label}` })
      } else if (await clickButton(label, '.main')) {
        await record(`mqtt__advanced-${label}`, { route: '/mqtt', notes: `展开：${label}` })
      }
    }
  }
}

async function captureAutomation() {
  await goto('/automation')
  await recordViewports('automation__empty', { route: '/automation', notes: '流程列表空态' })
  if (await clickButton('新建流程', '.main')) {
    await page.waitForTimeout(1000)
    await recordViewports('automation__flow-editor', { route: '/automation', notes: '流程编辑器（新建流程）' })
    if (await clickButton('添加事件', '.main')) {
      await record('automation__event-menu', { route: '/automation', kind: 'menu', scope: '.ant-dropdown, .ant-select-dropdown, .ant-popover, .main', crop: '.ant-dropdown, .ant-select-dropdown, .ant-popover' })
      const firstEvent = page.locator('.ant-dropdown-menu-item:visible, .ant-select-item-option:visible').first()
      if (await firstEvent.count()) {
        await firstEvent.click({ force: true }).catch(() => {})
        await page.waitForTimeout(900)
        await record('automation__event-added', { route: '/automation', notes: '添加一个事件后的编辑器' })
      } else {
        await page.keyboard.press('Escape')
      }
    }
    await record('automation__run-result-empty', { route: '/automation', notes: '运行结果/历史运行空态', scope: '.main' })
  }
}

async function captureGit() {
  await goto('/git')
  await recordViewports('git__status', { route: '/git', notes: 'Git 工作区状态（临时仓库）' })
  if (await clickButton('分支', '.main')) {
    await page.waitForTimeout(700)
    await record('git__dialog-branches', { route: '/git', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
    await closeOverlays()
  }
  if (await clickButton('远程', '.main')) {
    await page.waitForTimeout(700)
    await record('git__dialog-remotes', { route: '/git', kind: 'dialog', scope: '.ant-modal:visible', crop: '.ant-modal:visible' })
    await closeOverlays()
  }
  if (await clickButton('同步', '.main')) {
    await record('git__sync-menu', { route: '/git', kind: 'menu', scope: '.ant-dropdown', crop: '.ant-dropdown' })
    await page.keyboard.press('Escape')
  }
}

async function captureSettings() {
  await goto('/settings')
  await recordViewports('settings__top', { route: '/settings', notes: '设置页顶部' })
  // Scroll the main pane to capture each section.
  const sections = ['环境与请求前缀', '全局变量', '发送设置', 'MCP', '调试']
  for (const label of sections) {
    const el = page.locator('.main').getByText(label, { exact: false }).first()
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded().catch(() => {})
      await page.waitForTimeout(500)
      await record(`settings__section-${label}`, { route: '/settings', notes: `设置区块：${label}` })
    }
  }
  if (await clickButton('添加变量', '.main')) {
    await record('settings__variable-row-added', { route: '/settings', notes: '新增环境变量行' })
  }
}

// ---------------------------------------------------------------------------
// WebP conversion + output
// ---------------------------------------------------------------------------
function convertWebp() {
  if (NO_WEBP) return
  let ok = 0
  let fail = 0
  for (const screen of screens) {
    const png = path.join(ROOT, screen.screenshot.png)
    const webp = path.join(ROOT, screen.screenshot.webp)
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-quality', '92', '-compression_level', '6', webp], { stdio: 'ignore' })
      ok += 1
    } catch {
      fail += 1
    }
  }
  console.log(`webp: ${ok} ok, ${fail} failed`)
}

function writeInventory() {
  const byRoute = {}
  for (const screen of screens) {
    byRoute[screen.route] ||= []
    byRoute[screen.route].push(screen.id)
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    app: { name: 'KindraAPI', version: '0.2.4', mainProjectId: MAIN_ID, mainProjectName: MAIN_NAME },
    capture: {
      driver: 'playwright-core _electron',
      viewports: VIEWPORTS,
      routes: ROUTES,
      dataMode: 'temp copy of real userData (main project only)',
      theme: 'light'
    },
    summary: {
      screens: screens.length,
      elements: screens.reduce((n, s) => n + (s.inventory?.elementCount || 0), 0),
      dialogs: screens.filter((s) => s.kind.includes('dialog')).length,
      byRoute
    },
    screens
  }
  fs.writeFileSync(INVENTORY_FILE, JSON.stringify(payload, null, 2))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  loadEnvLocal()
  prepareUserData()
  console.log('launching Electron…')
  app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, KINDRAAPI_USER_DATA: TMP },
    timeout: 60000
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.app-shell', { timeout: 30000 })
  await page.waitForTimeout(2200)
  await setViewport(VIEWPORTS[0])

  const scenarios = [
    ['global', captureGlobalChrome],
    ['/history', captureHistory],
    ['/apis', captureApis],
    ['/docs', captureDocs],
    ['/schemas', captureSchemas],
    ['/mqtt', captureMqtt],
    ['/automation', captureAutomation],
    ['/git', captureGit],
    ['/settings', captureSettings]
  ]
  for (const [key, fn] of scenarios) {
    if (ONLY && !key.includes(ONLY) && !(ONLY === 'apis' && key === '/apis')) continue
    console.log(`\n## ${key}`)
    try {
      await fn()
    } catch (error) {
      console.error(`  ! ${key} failed:`, error.message)
      await closeOverlays().catch(() => {})
    }
  }

  writeInventory()
  convertWebp()
  console.log(`\nscreens=${screens.length} -> ${rel(INVENTORY_FILE)}`)
  await app.close()
}

main().catch(async (error) => {
  console.error(error)
  try {
    writeInventory()
    await app?.close()
  } catch {}
  process.exitCode = 1
})
