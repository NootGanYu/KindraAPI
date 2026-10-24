#!/usr/bin/env node
'use strict'

/**
 * Local demo API for manual testing.
 *   node scripts/demo-server.cjs
 *   DEMO_PORT=8090 node scripts/demo-server.cjs
 */
const http = require('node:http')

const PORT = Number(process.env.DEMO_PORT || 8090)
const HOST = '127.0.0.1'
const TOKEN = 'tkn_demo'

function json(res, code, body) {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
    const method = (req.method || 'GET').toUpperCase()
    console.log(`${new Date().toISOString()} ${method} ${url.pathname}${url.search}`)

    if (method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'openpost-demo' })
    }

    if (method === 'GET' && /^\/users\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/')[2])
      if (id === 404) return json(res, 404, { error: 'user not found' })
      return json(res, 200, {
        id,
        name: id === 1 ? 'Ada' : `User ${id}`,
        email: `user${id}@example.com`
      })
    }

    if (method === 'POST' && url.pathname === '/users') {
      let body = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        return json(res, 400, { error: 'invalid json' })
      }
      if (!body.name) return json(res, 422, { error: 'name is required' })
      return json(res, 201, { id: 7, name: body.name, created: true })
    }

    if (method === 'POST' && url.pathname === '/login') {
      return json(res, 200, {
        token: TOKEN,
        user: { id: 1, name: 'Ada' }
      })
    }

    if (method === 'GET' && url.pathname === '/orders') {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${TOKEN}`) {
        return json(res, 401, { error: 'unauthorized' })
      }
      return json(res, 200, {
        orders: [
          { id: 1001, total: 99.5 },
          { id: 1002, total: 12 }
        ],
        total: 2
      })
    }

    const echoMatch = /^\/echo\/([^/]+)$/.exec(url.pathname)
    if ((method === 'GET' || method === 'POST') && (url.pathname === '/echo' || echoMatch)) {
      let body = null
      if (raw) {
        try {
          body = JSON.parse(raw)
        } catch {
          body = raw
        }
      }
      res.setHeader('set-cookie', 'demo_session=abc123; Path=/; HttpOnly')
      return json(res, 200, {
        method,
        path: url.pathname,
        path_id: echoMatch ? decodeURIComponent(echoMatch[1]) : null,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body
      })
    }

    if (method === 'GET' && url.pathname === '/preview/html') {
      const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>预览 HTML 测试</title>
<style>
  body { margin:0; padding:28px; font-family:-apple-system,"PingFang SC",sans-serif; background:#faf5ea; color:#3e3324; }
  .card { background:#fffdf8; border:1px solid #e6dcc8; border-radius:8px; padding:22px 24px; max-width:720px; }
  h1 { margin:0 0 6px; font-size:22px; }
  .sub { color:#8e8069; font-size:13px; margin-bottom:18px; }
  .badges { display:flex; gap:8px; margin-bottom:18px; }
  .badge { font-size:12px; padding:3px 9px; border-radius:999px; background:#f3ead8; color:#7a5c30; }
  .badge.ok { background:#e5f4ec; color:#2f7d4f; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:18px; }
  .metric { border:1px solid #f0e8d8; border-radius:6px; padding:10px 12px; background:#fff; }
  .metric b { display:block; font-size:20px; color:#8a6b3b; }
  .metric span { font-size:11px; color:#a99d88; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; color:#8e8069; font-weight:600; padding:7px 8px; background:#faf5ea; border-bottom:1px solid #e6dcc8; }
  td { padding:7px 8px; border-bottom:1px solid #f3ecdd; }
  .bar { height:8px; border-radius:4px; background:linear-gradient(90deg,#c8a25e,#8a6b3b); }
</style>
</head>
<body>
  <div class="card">
    <h1>预览 HTML 测试</h1>
    <div class="sub">这段内容来自 /preview/html，用于验证 iframe 渲染预览。</div>
    <div class="badges">
      <span class="badge ok">200 OK</span>
      <span class="badge">text/html</span>
      <span class="badge">sandbox</span>
    </div>
    <div class="grid">
      <div class="metric"><b>1,284</b><span>今日请求</span></div>
      <div class="metric"><b>98.6%</b><span>成功率</span></div>
      <div class="metric"><b>142ms</b><span>平均耗时</span></div>
    </div>
    <table>
      <thead><tr><th>接口</th><th>方法</th><th>状态</th><th>耗时</th></tr></thead>
      <tbody>
        <tr><td>/users</td><td>GET</td><td>200</td><td>36ms</td></tr>
        <tr><td>/orders</td><td>POST</td><td>201</td><td>122ms</td></tr>
        <tr><td>/login</td><td>POST</td><td>200</td><td>88ms</td></tr>
      </tbody>
    </table>
    <p style="margin-top:16px"><div class="bar" style="width:72%"></div></p>
  </div>
</body>
</html>`
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html)
      })
      return res.end(html)
    }

    if (method === 'GET' && url.pathname === '/preview/markdown') {
      const md = `# 预览 Markdown 测试

这段内容来自 \`/preview/markdown\`，用于验证 Markdown 渲染。

## 特性列表

- 支持 **粗体**、*斜体* 和 \`行内代码\`
- 支持无序列表与有序列表
- 支持代码块、引用和表格

## 有序步骤

1. 发送请求
2. 切换到「预览」
3. 查看渲染结果

> 引用：预览会按内容类型渲染，而不是显示源码。

\`\`\`json
{
  "code": 0,
  "message": "success",
  "data": { "total": 5 }
}
\`\`\`

## 数据表

| 接口 | 方法 | 状态 |
| --- | --- | --- |
| /users | GET | 200 |
| /orders | POST | 201 |
| /login | POST | 200 |

---

结束。`
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-length': Buffer.byteLength(md)
      })
      return res.end(md)
    }

    if (method === 'GET' && url.pathname === '/preview/svg') {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fbf6ec"/>
      <stop offset="1" stop-color="#f0e3c8"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#8a6b3b"/>
      <stop offset="1" stop-color="#c8a25e"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <text x="40" y="58" font-family="PingFang SC, sans-serif" font-size="24" fill="#3e3324">SVG 预览测试</text>
  <text x="40" y="84" font-family="PingFang SC, sans-serif" font-size="13" fill="#8e8069">来自 /preview/svg · image/svg+xml</text>
  <g transform="translate(40,120)">
    <rect x="0" y="120" width="70" height="80" rx="6" fill="url(#bar)"/>
    <rect x="100" y="70" width="70" height="130" rx="6" fill="url(#bar)"/>
    <rect x="200" y="30" width="70" height="170" rx="6" fill="url(#bar)"/>
    <rect x="300" y="90" width="70" height="110" rx="6" fill="url(#bar)"/>
    <rect x="400" y="10" width="70" height="190" rx="6" fill="url(#bar)"/>
  </g>
  <circle cx="560" cy="240" r="48" fill="none" stroke="#8a6b3b" stroke-width="12" stroke-dasharray="210 90" transform="rotate(-90 560 240)"/>
  <text x="560" y="246" text-anchor="middle" font-family="PingFang SC, sans-serif" font-size="16" fill="#8a6b3b">70%</text>
</svg>`
      res.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'content-length': Buffer.byteLength(svg)
      })
      return res.end(svg)
    }

    if (method === 'GET' && url.pathname === '/preview/json') {
      return json(res, 200, {
        code: 0,
        message: 'success',
        data: {
          total: 3,
          records: [
            { id: 1, name: '预览记录 A', state: 'ok', score: 98.6, tags: ['html', 'json'] },
            { id: 2, name: '预览记录 B', state: 'warn', score: 72.1, tags: ['table'] },
            { id: 3, name: '预览记录 C', state: 'ok', score: 88.4, tags: [] }
          ],
          meta: { page: 1, size: 10, pages: 1 }
        }
      })
    }

    if (method === 'GET' && url.pathname === '/preview/text') {
      const text = '预览纯文本测试\n来自 /preview/text\ntext/plain 不做渲染，回退为美化文本。'
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(text)
      })
      return res.end(text)
    }

    return json(res, 404, { error: 'not found', path: url.pathname })
  })
})

server.listen(PORT, HOST, () => {
  console.log(`Demo API listening on http://${HOST}:${PORT}`)
  console.log('  GET  /health')
  console.log('  GET  /users/1')
  console.log('  POST /users            {"name":"Ada"}')
  console.log('  POST /login            -> token tkn_demo')
  console.log('  GET  /orders           Authorization: Bearer tkn_demo')
  console.log('  GET  /echo?hello=1')
  console.log('  GET  /preview/html | /preview/markdown | /preview/svg | /preview/json | /preview/text')
})
