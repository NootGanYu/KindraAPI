#!/usr/bin/env node
/**
 * Keep inventory.json reviewable and git-friendly.
 *
 * capture.mjs records every visible DOM/AX node (15k+). Most of those are
 * icon spans and tree child wrappers. This step keeps:
 *   - interactive/textual controls
 *   - tree rows (for the collapsible tree appendix)
 *   - prompts / headings / table headers
 * and stores the untouched full dump in tools/.cache/inventory.raw.json
 * (gitignored) for anyone who needs the raw evidence.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INV = path.resolve(HERE, '..')
const FILE = path.join(INV, 'inventory.json')
const RAW = path.join(HERE, '.cache', 'inventory.raw.json')

const inv = JSON.parse(fs.readFileSync(FILE, 'utf8'))
if (inv.summary?.storedElements !== undefined) {
  console.log('inventory already compacted; no changes')
  process.exit(0)
}

function meaningful(el) {
  if (el.text || el.ariaLabel || el.title || el.placeholder) return true
  if (/^(input|textarea|select)$/.test(el.tag)) return true
  if (el.icon) return true
  if (/ant-tree-treenode|ant-table-thead|ant-card-head-title|ant-form-item-label|ant-tabs-tab|ant-menu-item|ant-empty-description|ant-modal-title|ant-drawer-title/.test(el.classes)) return true
  return false
}

function keep(el) {
  if (meaningful(el)) return true
  if (el.role === 'treeitem') return true
  if (/ant-tree-treenode/.test(el.classes)) return true
  if (/^(button|a)$/.test(el.tag)) return true
  if (/^(button|tab|menuitem|checkbox|radio|switch)$/.test(el.role)) return true
  return false
}

const rawElements = inv.screens.reduce((n, s) => n + (s.inventory?.elements?.length || 0), 0)
let storedElements = 0
for (const screen of inv.screens) {
  const invScreen = screen.inventory || {}
  invScreen.elements = (invScreen.elements || []).filter(keep)
  storedElements += invScreen.elements.length
  // Keep only the fields the generated docs consume.
  invScreen.elements = invScreen.elements.map((el) => ({
    tag: el.tag,
    role: el.role,
    type: el.type,
    classes: el.classes,
    text: el.text,
    ariaLabel: el.ariaLabel,
    title: el.title,
    placeholder: el.placeholder,
    value: el.value,
    disabled: el.disabled,
    checked: el.checked,
    active: el.active,
    icon: el.icon,
    section: el.section,
    selector: el.selector,
    style: el.style ? { rect: el.style.rect } : undefined
  }))
}

fs.mkdirSync(path.dirname(RAW), { recursive: true })
fs.copyFileSync(FILE, RAW)
inv.summary.rawElements = rawElements
inv.summary.storedElements = storedElements
fs.writeFileSync(FILE, JSON.stringify(inv, null, 2))
const before = fs.statSync(RAW).size
const after = fs.statSync(FILE).size
console.log(`inventory compacted: ${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(1)} MB (${rawElements} -> ${storedElements} element records)`)
console.log(`raw dump: ${path.relative(process.cwd(), RAW).replace(/\\/g, '/')}`)
