const fs = require('fs')
const map = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const pats = process.argv.slice(3).map(p => new RegExp(p, 'i'))
const seen = new Set()
for (const [k, v] of Object.entries(map)) {
  if (!pats.some(p => p.test(k) || p.test(v))) continue
  if (seen.has(k)) continue
  seen.add(k)
  console.log(k + ' = ' + v)
}
