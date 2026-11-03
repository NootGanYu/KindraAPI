const asar = require('D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/node_modules/@electron/asar')
const fs = require('fs')
const path = require('path')

const ASAR = process.argv[2]
const OUT = process.argv[3]

const files = asar.listPackage(ASAR).filter(f => f.endsWith('.js') && !f.includes('monaco-editor'))
const all = new Map()

for (const f of files) {
  let buf
  try { buf = asar.extractFile(ASAR, f.replace(/^\\/, '')) } catch { continue }
  const src = buf.toString('utf8')
  // Chinese-containing string literals
  const re = /['"`]([^'"`\n]{1,120})['"`]/g
  let m
  while ((m = re.exec(src))) {
    const s = m[1]
    if (!/[\u4e00-\u9fa5]/.test(s)) continue
    if (s.length < 2 || s.length > 80) continue
    if (/^\s*[\{\[<]/.test(s)) continue
    const key = s.trim()
    if (!key) continue
    if (!all.has(key)) all.set(key, { count: 0, files: new Set() })
    const e = all.get(key)
    e.count++
    e.files.add(f)
  }
  // also unquoted Chinese chunks from template/plain text
  const re2 = /[\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9_\-：:（）()、，。！？\/·\s]{1,40}/g
  while ((m = re2.exec(src))) {
    const s = m[0].trim()
    if (s.length < 2) continue
    if (!all.has(s)) all.set(s, { count: 0, files: new Set() })
    const e = all.get(s)
    e.count++
    e.files.add(f)
  }
}

const rows = [...all.entries()].map(([s, e]) => ({ s, count: e.count, files: [...e.files] }))
rows.sort((a, b) => b.count - a.count || a.s.localeCompare(b.s))
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1))
console.log('js files', files.length, 'unique strings', rows.length)

const kw = process.argv.slice(4)
for (const k of kw) {
  const hits = rows.filter(r => r.s.includes(k))
  console.log(`\n### ${k} (${hits.length})`)
  console.log(hits.slice(0, 40).map(h => `${h.count}x ${h.s}`).join('\n'))
}
