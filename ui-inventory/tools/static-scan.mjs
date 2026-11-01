#!/usr/bin/env node
/**
 * Static UI inventory scanner.
 *
 * Parses every renderer TS/TSX file with the TypeScript compiler API and
 * extracts UI-facing facts that are hard to reach at runtime:
 *   - JSX tags, visible text, and the props that drive copy/state
 *   - message / Modal / notification calls
 *   - menu item object literals
 *   - placeholders, Tooltip titles, Empty descriptions
 *   - disabled expressions, keyboard shortcuts
 *   - window.api.* IPC calls (control -> behavior mapping)
 *
 * Output: ui-inventory/tools/.cache/static-ui.json
 *
 * Usage: node ui-inventory/tools/static-scan.mjs [--pretty]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = path.join(ROOT, 'src', 'renderer', 'src')
const OUT_DIR = path.join(HERE, '.cache')
const OUT_FILE = path.join(OUT_DIR, 'static-ui.json')

const ATTRS_OF_INTEREST = new Set([
  'title',
  'placeholder',
  'label',
  'description',
  'okText',
  'cancelText',
  'aria-label',
  'alt',
  'tooltip',
  'message',
  'help',
  'hint',
  'emptyText',
  'notFoundContent',
  'disabled',
  'danger',
  'type',
  'htmlType',
  'size',
  'shape',
  'status',
  'loading',
  'open',
  'visible',
  'closable',
  'maskClosable',
  'keyboard',
  'width',
  'placement',
  'mode',
  'value',
  'defaultValue',
  'checked',
  'options',
  'items'
])

const MESSAGE_OWNERS = new Set(['message', 'notification'])
const MODAL_OWNERS = new Set(['Modal', 'modal'])
const MESSAGE_METHODS = new Set([
  'success',
  'error',
  'warning',
  'info',
  'loading',
  'open',
  'destroy',
  'confirm'
])

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

function textOfStringLike(node) {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.getText()
  return null
}

function jsxTextOf(node) {
  if (!node) return ''
  if (ts.isJsxText(node)) return node.getText().replace(/\s+/g, ' ').trim()
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isJsxExpression(node) && node.expression) return node.expression.getText()
  return ''
}

function jsxChildrenText(node) {
  if (!ts.isJsxElement(node) && !ts.isJsxFragment(node)) return ''
  return [...node.children].map(jsxTextOf).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function attrText(attr) {
  const init = attr.initializer
  if (!init) return 'true'
  if (ts.isStringLiteral(init)) return init.text
  if (ts.isJsxExpression(init) && init.expression) return init.expression.getText()
  return init.getText()
}

function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const tags = []
  const messages = []
  const menuItems = []
  const placeholders = []
  const tooltips = []
  const empties = []
  const shortcuts = []
  const ipc = []
  const navigations = []
  const conditions = []

  function visit(node) {
    // JSX elements
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const tagName = opening.tagName.getText(sf)
      const attrs = {}
      for (const attr of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue
        const name = attr.name.getText(sf)
        const raw = attrText(attr)
        if (ATTRS_OF_INTEREST.has(name)) attrs[name] = raw
        if (name === 'placeholder') placeholders.push({ text: raw, line: lineOf(sf, attr), tag: tagName })
        if (name === 'disabled' && raw !== 'true') conditions.push({ kind: 'disabled', expression: raw, line: lineOf(sf, attr), tag: tagName })
      }
      const visible = ts.isJsxElement(node) ? jsxChildrenText(node) : ''
      tags.push({ tag: tagName, text: visible, attrs, line: lineOf(sf, node) })
      if (/^Tooltip$/.test(tagName) && attrs.title) tooltips.push({ text: attrs.title, line: lineOf(sf, node) })
      if (/^Empty$/.test(tagName)) empties.push({ text: attrs.description || visible || '', line: lineOf(sf, node) })
    }

    // message.success(...) / Modal.confirm({...}) etc.
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf)
      const parts = callee.split('.')
      const owner = parts[0]
      const method = parts[parts.length - 1]
      if ((MESSAGE_OWNERS.has(owner) || MODAL_OWNERS.has(owner)) && MESSAGE_METHODS.has(method)) {
        const arg = node.arguments[0]
        let copy = ''
        if (arg) {
          const literal = textOfStringLike(arg)
          if (literal !== null) copy = literal
          else if (ts.isObjectLiteralExpression(arg)) {
            const bits = []
            for (const prop of arg.properties) {
              if (!ts.isPropertyAssignment(prop)) continue
              const key = prop.name.getText(sf)
              if (['title', 'content', 'description', 'okText', 'cancelText', 'message'].includes(key)) {
                const value = textOfStringLike(prop.initializer) ?? prop.initializer.getText()
                bits.push(`${key}=${value}`)
              }
            }
            copy = bits.join('; ')
          } else copy = arg.getText(sf)
        }
        messages.push({ kind: `${owner}.${method}`, copy, line: lineOf(sf, node) })
      }

      // window.api.* IPC calls and navigate()
      if (/^window\.api\./.test(callee)) {
        ipc.push({ call: callee, args: node.arguments.map((a) => a.getText(sf).slice(0, 120)).join(', '), line: lineOf(sf, node) })
      }
      if (/^navigate$/.test(callee) || /^window\.api\./.test(callee)) {
        if (/^navigate$/.test(callee)) navigations.push({ to: node.arguments[0]?.getText(sf) ?? '', line: lineOf(sf, node) })
      }
    }

    // object literals that look like menu entries
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map()
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        props.set(prop.name.getText(sf), prop.initializer)
      }
      if (props.has('label') || (props.has('key') && props.has('title'))) {
        const labelNode = props.get('label') || props.get('title')
        const label = textOfStringLike(labelNode) ?? labelNode?.getText(sf) ?? ''
        const key = textOfStringLike(props.get('key')) ?? props.get('key')?.getText(sf) ?? ''
        const disabled = props.get('disabled')?.getText(sf) ?? ''
        if (label) menuItems.push({ label, key, disabled, line: lineOf(sf, node) })
      }
    }

    // keyboard shortcuts
    if (ts.isBinaryExpression(node)) {
      const txt = node.getText(sf)
      if (/["'](Enter|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Delete|Backspace|Tab|F\d+)["']/.test(txt) && /event\.key|e\.key|key ===|key==/.test(txt)) {
        shortcuts.push({ expression: txt, line: lineOf(sf, node) })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)
  const dedupe = (arr, keyFn) => {
    const seen = new Set()
    return arr.filter((item) => {
      const k = keyFn(item)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  return {
    file: rel,
    lines: text.split(/\r?\n/).length,
    tags: dedupe(tags, (t) => `${t.tag}|${t.text}|${t.line}`),
    messages: dedupe(messages, (m) => `${m.kind}|${m.copy}|${m.line}`),
    menuItems: dedupe(menuItems, (m) => `${m.label}|${m.key}|${m.line}`),
    placeholders: dedupe(placeholders, (p) => `${p.text}|${p.line}`),
    tooltips: dedupe(tooltips, (t) => `${t.text}|${t.line}`),
    empties: dedupe(empties, (e) => `${e.text}|${e.line}`),
    shortcuts: dedupe(shortcuts, (s) => s.expression),
    ipc: dedupe(ipc, (i) => `${i.call}|${i.line}`),
    navigations: dedupe(navigations, (n) => `${n.to}|${n.line}`),
    conditions: dedupe(conditions, (c) => `${c.expression}|${c.line}`)
  }
}

const files = walk(SRC).sort()
const results = files.map(scanFile)
const summary = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  fileCount: results.length,
  totalLines: results.reduce((n, f) => n + f.lines, 0),
  counts: {
    tags: results.reduce((n, f) => n + f.tags.length, 0),
    messages: results.reduce((n, f) => n + f.messages.length, 0),
    menuItems: results.reduce((n, f) => n + f.menuItems.length, 0),
    tooltips: results.reduce((n, f) => n + f.tooltips.length, 0),
    placeholders: results.reduce((n, f) => n + f.placeholders.length, 0),
    empties: results.reduce((n, f) => n + f.empties.length, 0),
    shortcuts: results.reduce((n, f) => n + f.shortcuts.length, 0),
    ipc: results.reduce((n, f) => n + f.ipc.length, 0)
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify({ summary, files: results }, null, 2), 'utf8')

if (process.argv.includes('--pretty')) {
  for (const f of results) {
    console.log(`\n## ${f.file} (${f.lines} lines)`)
    console.log(`  tags=${f.tags.length} messages=${f.messages.length} menu=${f.menuItems.length} tips=${f.tooltips.length} ipc=${f.ipc.length}`)
    const buttons = f.tags.filter((t) => /Button$/.test(t.tag) && t.text)
    if (buttons.length) console.log('  buttons:', buttons.map((b) => b.text).join(' / '))
    const chips = f.tags.filter((t) => /^(Tag|Badge|Tooltip)$/.test(t.tag) && t.text)
    if (chips.length) console.log('  tags/tips:', chips.map((b) => b.text).join(' / '))
    if (f.messages.length) console.log('  messages:', f.messages.map((m) => `${m.kind}:${m.copy}`).join(' | '))
  }
}

console.log(JSON.stringify({ ok: true, out: path.relative(ROOT, OUT_FILE), ...summary }, null, 2))
