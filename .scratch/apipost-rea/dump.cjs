const asar = require('D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/node_modules/@electron/asar')
const ASAR = 'D:/Program Files/Apipost/resources/app/build/work.asar'
const files = ['index-0d1d8198fa5a.js', 'vendor-c93cd7e95d6e.js']
const re = /"([a-zA-Z0-9_.\-]{2,60})"\s*:\s*"((?:[^"\\]|\\.){0,300})"/g
const map = new Map()
for (const f of files) {
  const s = asar.extractFile(ASAR, f).toString('utf8')
  let m
  while ((m = re.exec(s))) {
    if (!/[\u4e00-\u9fa5]/.test(m[2]) || m[2].length > 200) continue
    if (/[\u3040-\u30ff]/.test(m[2])) continue
    if (!map.has(m[1])) map.set(m[1], m[2].replace(/\\n/g, ' ').replace(/\\"/g, '"'))
  }
}
const patterns = process.argv.slice(2).map(p => new RegExp(p, 'i'))
for (const [k, v] of map) {
  if (patterns.some(p => p.test(k))) console.log(k + ' = ' + v)
}
