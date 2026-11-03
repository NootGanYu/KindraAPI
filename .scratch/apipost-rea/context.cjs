const asar = require('D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/node_modules/@electron/asar')
const ASAR = process.argv[2]
const FILE = process.argv[3]
const anchors = process.argv.slice(4)

const buf = asar.extractFile(ASAR, FILE.replace(/^\\/, ''))
const src = buf.toString('utf8')
const re = /['"`]([^'"`\n]{1,120})['"`]/g
const items = []
let m
while ((m = re.exec(src))) {
  const s = m[1]
  if (!/[\u4e00-\u9fa5]/.test(s)) continue
  if (s.trim().length < 2) continue
  items.push({ s: s.trim(), i: m.index })
}
console.log('total chinese literals', items.length)
const seen = new Set()
for (const a of anchors) {
  const idxs = []
  for (let k = 0; k < items.length; k++) if (items[k].s.includes(a)) idxs.push(k)
  console.log(`\n===== anchor ${a} (${idxs.length}) =====`)
  for (const k of idxs.slice(0, 3)) {
    const from = Math.max(0, k - 20), to = Math.min(items.length, k + 25)
    const key = from + ':' + to
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`--- window ${from}-${to} ---`)
    console.log(items.slice(from, to).map((it, j) => `${from + j}\t${it.s}`).join('\n'))
  }
}
