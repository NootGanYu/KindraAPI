const fs = require('fs')
const files = process.argv.slice(2)
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
  console.log(`\n### ${f}`)
  const out = []
  lines.forEach((line, i) => {
    const ms = line.match(/['"`]([^'"`]*[\u4e00-\u9fa5][^'"`]*)['"`]/g)
    if (!ms) return
    for (const raw of ms) {
      const s = raw.slice(1, -1).trim()
      if (s.length < 1 || s.length > 60) continue
      out.push(`${i + 1}: ${s}`)
    }
  })
  // dedupe preserving order
  const seen = new Set()
  for (const x of out) { const t = x.replace(/^\d+: /, ''); if (seen.has(t)) continue; seen.add(t); console.log(x) }
}
