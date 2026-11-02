const asar = require('D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/node_modules/@electron/asar')
const fs = require('fs')

const asarPath = process.argv[2]
const outPath = process.argv[3]
const files = asar.listPackage(asarPath).filter(f => f.endsWith('.js') && !f.includes('monaco-editor'))
const re = /"([a-zA-Z0-9_.\-]{2,80})"\s*:\s*"((?:[^"\\]|\\.){0,400})"/g
const map = new Map()
let scanned = 0
for (const f of files) {
  let s
  try { s = asar.extractFile(asarPath, f.replace(/^\\/, '')).toString('utf8') } catch { continue }
  scanned++
  let m
  while ((m = re.exec(s))) {
    const v = m[2]
    if (!/[\u4e00-\u9fa5]/.test(v)) continue
    if (/[\u3040-\u30ff]/.test(v)) continue
    if (v.length > 220) continue
    if (!map.has(m[1])) map.set(m[1], v.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
  }
}
fs.writeFileSync(outPath, JSON.stringify(Object.fromEntries(map), null, 1))
console.log('scanned', scanned, 'keys', map.size, '->', outPath)
