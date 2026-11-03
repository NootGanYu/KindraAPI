const asar = require('D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/node_modules/@electron/asar')
const files = ['index-0d1d8198fa5a.js', 'vendor-c93cd7e95d6e.js']
const re = /"([a-zA-Z0-9_.\-]{2,60})"\s*:\s*"((?:[^"\\]|\\.){0,300})"/g
const pairs = []
for (const f of files) {
  const s = asar.extractFile('D:/Program Files/Apipost/resources/app/build/work.asar', f).toString('utf8')
  let m
  while ((m = re.exec(s))) {
    if (!/[\u4e00-\u9fa5]/.test(m[2]) || m[2].length > 160) continue
    pairs.push([m[1], m[2]])
  }
}
const map = new Map()
for (const [k, v] of pairs) if (!map.has(k)) map.set(k, v)
const keys = [...map.keys()]
console.log('unique keys', keys.length)
const prefixes = process.argv.slice(2)
for (const pre of prefixes) {
  const h = keys.filter(k => k.toLowerCase().includes(pre))
  console.log(`\n### ${pre} (${h.length})`)
  console.log(h.slice(0, 80).join(', '))
}
