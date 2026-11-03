const asar = require('D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/node_modules/@electron/asar')
const ASAR = process.argv[2]

const files = ['index-0d1d8198fa5a.js', 'vendor-c93cd7e95d6e.js']
const pairs = []
const re = /"([a-zA-Z0-9_.\-]{2,60})"\s*:\s*"((?:[^"\\]|\\.){0,300})"/g
for (const f of files) {
  const s = asar.extractFile(ASAR, f).toString('utf8')
  let m
  while ((m = re.exec(s))) {
    const v = m[2]
    if (!/[\u4e00-\u9fa5]/.test(v)) continue
    if (v.length > 160) continue
    pairs.push({ f, k: m[1], v: v.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\') })
  }
}
console.log('pairs', pairs.length)
const anchors = process.argv.slice(3)
for (const a of anchors) {
  const hits = pairs.filter(p => p.v.includes(a))
  console.log(`\n===== ${a} (${hits.length}) =====`)
  const seen = new Set()
  for (const h of hits) {
    const key = h.k + '=' + h.v
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`${h.k} = ${h.v}`)
  }
}
