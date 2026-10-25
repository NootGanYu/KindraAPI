import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import type {
  DocServiceStatus,
  DocSettings,
  DocShare,
  DocTargetSnapshot,
  Param,
  ResponseExample
} from '@shared/types'
import * as store from '../storage/store'

const DOC_HOST = '0.0.0.0'
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const COOKIE_NAME = 'openpost_doc_token'
const MAX_BODY_BYTES = 16 * 1024
const AUTH_WINDOW_MS = 60 * 1000
const AUTH_MAX_ATTEMPTS = 10

let server: http.Server | null = null
let status: DocServiceStatus = {
  enabled: true,
  port: store.DOC_DEFAULT_PORT,
  running: false,
  host: DOC_HOST,
  base_url: `http://127.0.0.1:${store.DOC_DEFAULT_PORT}`,
  share_count: 0
}

const sessions = new Map<
  string,
  { shareId: string; expires: number; updatedAt: string }
>()
const authAttempts = new Map<string, { count: number; reset: number }>()

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

function lanAddress(): string {
  try {
    const candidates: Array<{ name: string; address: string }> = []
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        const family = String(entry.family)
        if ((family === 'IPv4' || family === '4') && !entry.internal) {
          candidates.push({ name, address: entry.address })
        }
      }
    }
    // 优先物理网卡（en0/en1…），避免选到 VPN / 虚拟网卡地址。
    const physical = candidates.find((item) => /^en\d+$/i.test(item.name))
    if (physical) return physical.address
    const virtual = /^(utun|tun|tap|awdl|llw|bridge|gif|stf|lo|docker|veth|vmnet)/i
    const fallback = candidates.find((item) => !virtual.test(item.name))
    return (fallback ?? candidates[0])?.address ?? '127.0.0.1'
  } catch {
    // fall through
  }
  return '127.0.0.1'
}

function baseUrlFor(port: number): string {
  return `http://${lanAddress()}:${port}`
}

function countShares(): number {
  try {
    return store.listAllDocShares().length
  } catch {
    return 0
  }
}

export function getDocServiceStatus(): DocServiceStatus {
  return { ...status, share_count: countShares() }
}

export function getDocShareUrl(shareId: string): string {
  return `${status.base_url}/share/${shareId}`
}

export async function stopDocServer(): Promise<void> {
  sessions.clear()
  authAttempts.clear()
  if (server) {
    const current = server
    server = null
    await new Promise<void>((resolve) => current.close(() => resolve()))
  }
  status = { ...status, running: false, error: undefined }
}

export async function startDocServer(): Promise<DocServiceStatus> {
  await stopDocServer()
  const config = store.getDocServiceConfig()
  status = {
    enabled: config.enabled,
    port: config.port,
    running: false,
    host: DOC_HOST,
    base_url: baseUrlFor(config.port),
    share_count: countShares()
  }
  if (!config.enabled) return getDocServiceStatus()

  return new Promise<DocServiceStatus>((resolve) => {
    let settled = false
    const finish = (next: DocServiceStatus): void => {
      if (settled) return
      settled = true
      status = next
      resolve(getDocServiceStatus())
    }

    const srv = http.createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        console.error('[docs] request failed:', error)
        if (!res.headersSent) sendText(res, 500, '服务器内部错误')
        else res.end()
      })
    })
    srv.once('error', (error: NodeJS.ErrnoException) => {
      server = null
      finish({
        ...status,
        running: false,
        error:
          error.code === 'EADDRINUSE'
            ? `端口 ${config.port} 已被占用`
            : error.message
      })
    })
    srv.listen(config.port, DOC_HOST, () => {
      server = srv
      finish({ ...status, running: true })
    })
  })
}

export async function restartDocServer(): Promise<DocServiceStatus> {
  return startDocServer()
}

export async function shutdownDocs(): Promise<void> {
  await stopDocServer()
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendText(res: http.ServerResponse, code: number, body: string): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(body)
}

function sendHtml(res: http.ServerResponse, code: number, body: string): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(body)
}

function sendAttachment(
  res: http.ServerResponse,
  body: string,
  contentType: string,
  filename: string
): void {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`
  )
  res.end(body)
}

function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  )
  res.setHeader('Cache-Control', 'no-store')
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    if (!key) continue
    try {
      result[key] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      result[key] = part.slice(index + 1).trim()
    }
  }
  return result
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a)
    return false
  }
  return crypto.timingSafeEqual(a, b)
}

function clientIp(req: http.IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? ''
  return remote.replace(/^::ffff:/, '')
}

function authAllowed(ip: string): boolean {
  const now = Date.now()
  const entry = authAttempts.get(ip)
  if (!entry || entry.reset < now) return true
  return entry.count < AUTH_MAX_ATTEMPTS
}

function noteAuthFailure(ip: string): void {
  const now = Date.now()
  const entry = authAttempts.get(ip)
  if (!entry || entry.reset < now) {
    authAttempts.set(ip, { count: 1, reset: now + AUTH_WINDOW_MS })
    return
  }
  entry.count += 1
}

function readBody(req: http.IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function isValidSession(req: http.IncomingMessage, share: DocShare): boolean {
  if (!share.settings.password) return true
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (!token) return false
  const session = sessions.get(token)
  if (!session) return false
  // 分享内容或密码被修改后，旧 token 立即失效。
  if (
    session.expires <= Date.now() ||
    session.shareId !== share.share_id ||
    session.updatedAt !== share.updated_at
  ) {
    sessions.delete(token)
    return false
  }
  return true
}

function shareExpired(share: DocShare): boolean {
  return store.docShareExpireInfo(share).expired
}

function formatTime(value: string | number | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function pretty(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return raw
    }
  }
  return raw
}

function activeParams(params?: Param[]): Param[] {
  return (params ?? []).filter((param) => param.is_checked !== 0 && (param.key || param.value))
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const DOC_CSS = `
:root{--ink:#2d2820;--text:#5f574b;--muted:#968c7b;--line:#e8e2d7;--soft:#faf8f3;--bg:#f7f5f0;--card:#fff;--gold:#8a6b3b;--green:#2f8f62;--red:#c9463a;--blue:#3d7ec7;--code:#f6f2ea}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--gold);text-decoration:none}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.doc-top{height:56px;display:flex;align-items:center;gap:12px;padding:0 26px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);white-space:nowrap}
.brand .logo{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;background:linear-gradient(135deg,#c8a25e,#8a6b3b)}
.top-crumb{color:var(--muted);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top-badges{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:4px;font-size:11.5px;border:1px solid var(--line);background:var(--soft);color:var(--text);white-space:nowrap}
.chip.public{color:#b06d16;background:#fdf3e3;border-color:#f0ddb8}
.chip.password{color:#3d6fa8;background:#eef5fd;border-color:#cfe1f5}
.chip.type{color:#8a6b3b;background:#f6efe2;border-color:#e7d8bd}
.chip.expired{color:var(--red);background:#fdf0ee;border-color:#f3cfc9}
.doc-layout{display:flex;max-width:1340px;margin:0 auto;align-items:flex-start}
.doc-nav{width:274px;flex:none;position:sticky;top:56px;height:calc(100vh - 56px);overflow:auto;padding:22px 14px 60px 24px;border-right:1px solid var(--line)}
.nav-title{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px 8px}
.nav-folder{margin:2px 0}
.nav-folder>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:5px;color:var(--text);font-size:13px;user-select:none}
.nav-folder>summary::-webkit-details-marker{display:none}
.nav-folder>summary::before{content:"";width:0;height:0;border-left:4px solid var(--muted);border-top:3px solid transparent;border-bottom:3px solid transparent;transition:transform .12s;flex:none}
.nav-folder[open]>summary::before{transform:rotate(90deg)}
.nav-folder>summary:hover{background:rgba(138,107,59,.08);color:var(--ink)}
.nav-children{margin-left:10px;padding-left:6px;border-left:1px solid var(--line)}
.nav-api{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:5px;color:var(--text);font-size:12.5px;line-height:1.4}
.nav-api:hover{background:rgba(138,107,59,.08);color:var(--ink)}
.nav-api .m{font:600 9.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--green);min-width:30px}
.nav-api .m.POST{color:var(--blue)}
.nav-api .m.PUT,.nav-api .m.PATCH{color:#b7791f}
.nav-api .m.DELETE{color:var(--red)}
.nav-api .m.md{color:#4971a6}
.nav-meta{margin-top:22px;padding:12px;background:#fff;border:1px solid var(--line);border-radius:8px;font-size:12px;color:var(--muted);line-height:1.8}
.nav-meta b{color:var(--text);font-weight:500}
.doc-main{flex:1;min-width:0;padding:30px 44px 90px}
.hero{padding:4px 0 20px;border-bottom:1px solid var(--line);margin-bottom:24px}
.hero h1{margin:0 0 10px;font-size:26px;line-height:1.3;letter-spacing:-.01em}
.hero p{margin:0;color:var(--text);max-width:780px}
.hero .hero-meta{margin-top:14px;display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12px}
.section-title{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:30px 0 12px}
.api-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px 26px;margin:16px 0;box-shadow:0 1px 2px rgba(70,55,30,.03)}
.api-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.api-head h2{margin:0;font-size:19px;line-height:1.35}
.method{display:inline-flex;align-items:center;justify-content:center;height:22px;padding:0 8px;border-radius:5px;color:#fff;background:var(--green);font:700 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;flex:none}
.method.POST{background:var(--blue)}
.method.PUT,.method.PATCH{background:#b7791f}
.method.DELETE{background:var(--red)}
.method.HEAD,.method.OPTIONS{background:#7a6b55}
.api-desc{color:var(--text);margin:10px 0 0;white-space:pre-wrap}
.url-line{margin:14px 0 2px;padding:9px 12px;background:var(--soft);border:1px solid var(--line);border-radius:7px;font-size:12.5px;word-break:break-all;color:#4a3d29}
.url-line b{color:var(--gold);margin-right:8px;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.api-block{margin-top:22px}
.api-block h3{font-size:14px;margin:0 0 10px;color:var(--ink);font-weight:600}
.api-block h4{font-size:12.5px;margin:16px 0 7px;color:var(--muted);font-weight:500}
table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top;word-break:break-word}
th{background:var(--soft);color:var(--muted);font-weight:500;white-space:nowrap}
pre{margin:8px 0 0;padding:13px 15px;background:var(--code);border:1px solid var(--line);border-radius:8px;font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;overflow:auto}
.example{margin-top:12px;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff}
.example-head{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--soft);border-bottom:1px solid var(--line);font-size:12.5px;flex-wrap:wrap}
.example-head .code{font:700 11px/1 ui-monospace,Menlo,monospace;color:var(--green)}
.example-head .name{color:var(--ink)}
.example-head .ctype{color:var(--muted);font-size:11.5px}
.example .example-body{padding:12px 14px}
.example pre{margin:0;border:none;background:transparent;padding:0}
details.raw-request{margin-top:12px;border-top:1px dashed var(--line);padding-top:10px}
details.raw-request summary{cursor:pointer;color:var(--gold);font-size:12.5px}
.empty{padding:40px;text-align:center;color:var(--muted);background:#fff;border:1px dashed var(--line);border-radius:10px}
.doc-footer{max-width:1340px;margin:0 auto;padding:0 44px 40px 318px;color:var(--muted);font-size:11.5px}
.muted{color:var(--muted)}
.gate-wrap{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(160deg,#faf8f4 0%,#f1e8d7 100%)}
.gate{width:100%;max-width:380px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:32px 30px;box-shadow:0 18px 60px rgba(70,55,30,.10)}
.gate .logo{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#c8a25e,#8a6b3b);font-weight:700;margin-bottom:18px}
.gate h1{font-size:20px;margin:0 0 6px}
.gate p{margin:0 0 20px;color:var(--muted);font-size:13px;word-break:break-word}
.gate label{display:block;font-size:12px;color:var(--text);margin-bottom:6px}
.gate input{width:100%;height:38px;padding:0 11px;border:1px solid var(--line);border-radius:7px;font-size:14px;outline:none;background:var(--soft)}
.gate input:focus{border-color:var(--gold);background:#fff}
.gate button{width:100%;height:38px;margin-top:14px;border:none;border-radius:7px;background:var(--gold);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
.gate button:hover{background:#715830}
.gate .error{color:var(--red);font-size:12.5px;margin:10px 0 0}
.gate .foot{margin-top:18px;font-size:11.5px;color:var(--muted);text-align:center}
@media (max-width:900px){
  .doc-layout{display:block}
  .doc-nav{position:static;width:auto;height:auto;border-right:none;border-bottom:1px solid var(--line);padding:16px 20px}
  .doc-main{padding:22px 20px 70px}
  .doc-footer{padding:0 20px 30px}
  .doc-top{padding:0 16px}
  .top-crumb{display:none}
}
@media print{
  .doc-top,.doc-nav,.doc-footer{display:none}
  .doc-main{padding:0}
  .api-card{break-inside:avoid;box-shadow:none}
  body{background:#fff}
}
`

function shareTypeLabel(share: DocShare): string {
  return store.docShareTypeLabel(share)
}

function shareChipText(share: DocShare): string {
  return `${share.settings.password ? '密码访问' : '公开访问'} · ${shareTypeLabel(
    share
  )} · ${store.docShareExpireInfo(share).expire_label}`
}

function shareChips(share: DocShare): string {
  const parts = [
    `<span class="chip ${share.settings.password ? 'password' : 'public'}">${
      share.settings.password ? '密码访问' : '公开访问'
    }</span>`,
    `<span class="chip type">${escapeHtml(shareTypeLabel(share))}</span>`
  ]
  const expire = store.docShareExpireInfo(share)
  parts.push(
    `<span class="chip${expire.expired ? ' expired' : ''}">${escapeHtml(expire.expire_label)}</span>`
  )
  return parts.join('')
}

function pageShell(title: string, body: string, extraStyle = ''): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>${DOC_CSS}${extraStyle}</style>
</head>
<body>${body}</body>
</html>`
}

function methodText(method?: string): string {
  return (method || 'GET').toUpperCase().slice(0, 24)
}

function methodClass(method?: string): string {
  const upper = methodText(method)
  return /^[A-Z]+$/.test(upper) ? upper : 'OTHER'
}

function renderParamTable(params: Param[], showValue = true): string {
  const rows = params
    .map(
      (param) => `<tr>
<td class="mono">${escapeHtml(param.key)}</td>
${showValue ? `<td class="mono">${param.value ? escapeHtml(param.value) : '<span class="muted">—</span>'}</td>` : ''}
<td>${escapeHtml(param.description || '')}</td>
</tr>`
    )
    .join('')
  return `<table><thead><tr><th>参数名</th>${showValue ? '<th>值</th>' : ''}<th>说明</th></tr></thead><tbody>${rows}</tbody></table>`
}

function renderParamGroup(title: string, params: Param[]): string {
  const list = activeParams(params)
  if (list.length === 0) return ''
  return `<h4>${escapeHtml(title)}</h4>${renderParamTable(list)}`
}

function renderResponseExample(example: ResponseExample, settings: DocSettings): string {
  const code = example.expect?.code ?? 200
  const name = example.expect?.name || ''
  const contentType = example.expect?.content_type || ''
  const raw = example.raw ?? ''
  const headerParams = activeParams(example.headers ?? example.raw_parameter ?? [])
  const cookies = activeParams(example.cookies ?? [])
  const request = example.request

  const headerBlock =
    settings.show_headers && headerParams.length
      ? `<h4>响应头</h4>${renderParamTable(headerParams)}`
      : ''
  const cookieBlock =
    settings.show_headers && cookies.length
      ? `<h4>Cookie</h4>${renderParamTable(cookies)}`
      : ''

  const snapshotHeaders = activeParams(request?.headers ?? [])
  const snapshotHeaderBlock =
    settings.show_request && settings.show_headers && snapshotHeaders.length
      ? `<h4>请求头</h4>${renderParamTable(snapshotHeaders)}`
      : ''
  const snapshotBodyBlock =
    settings.show_request && settings.show_body && request?.body
      ? `<h4>请求体</h4><pre>${escapeHtml(pretty(request.body))}</pre>`
      : ''
  const requestBlock =
    settings.show_request && request
      ? `<details class="raw-request"><summary>查看示例请求</summary>
<p class="muted mono" style="margin:8px 0 0">${escapeHtml(
          `${request.method || ''} ${request.url || ''}`.trim()
        )}</p>
${snapshotHeaderBlock}${snapshotBodyBlock}</details>`
      : ''

  return `<div class="example">
<div class="example-head">
<span class="code">${escapeHtml(code)}</span>
${name ? `<span class="name">${escapeHtml(name)}</span>` : ''}
${contentType ? `<span class="ctype mono">${escapeHtml(contentType)}</span>` : ''}
</div>
<div class="example-body">
${raw ? `<pre>${escapeHtml(pretty(raw))}</pre>` : '<span class="muted">（空响应体）</span>'}
${headerBlock}${cookieBlock}${requestBlock}
</div>
</div>`
}

function renderBody(target: DocTargetSnapshot, settings: DocSettings): string {
  if (!settings.show_body) return ''
  const body = target.request?.body
  if (!body) return ''
  const mode = body.mode || 'none'

  if (mode === 'urlencoded' || mode === 'formdata') {
    const params = activeParams(mode === 'formdata' ? body.formdata : body.urlencoded)
    if (params.length === 0) return ''
    return `<h4>${mode === 'formdata' ? 'form-data' : 'x-www-form-urlencoded'}</h4>${renderParamTable(
      params
    )}`
  }
  if (mode === 'binary') {
    if (!body.binary?.file_name) return ''
    return `<h4>二进制文件</h4><pre>${escapeHtml(body.binary.file_name)}</pre>`
  }
  const raw = mode === 'json' ? body.json ?? body.raw : body.raw
  if (!raw) return ''
  const prettyBody = pretty(raw)
  return `<h4>请求体</h4><pre>${escapeHtml(prettyBody)}</pre>`
}

function renderScripts(target: DocTargetSnapshot, settings: DocSettings): string {
  if (!settings.show_scripts) return ''
  const pre = target.request?.pre_script?.trim()
  const test = target.request?.test?.trim()
  if (!pre && !test) return ''
  return `${pre ? `<h4>前置脚本</h4><pre>${escapeHtml(pre)}</pre>` : ''}${
    test ? `<h4>后置 / 测试脚本</h4><pre>${escapeHtml(test)}</pre>` : ''
  }`
}

function renderApi(target: DocTargetSnapshot, settings: DocSettings): string {
  const method = methodClass(target.method)
  const label = methodText(target.method)
  const request = target.request
  const examples = target.response?.example ?? []

  const paramBlock = settings.show_request
    ? [
        renderParamGroup('Path 参数', request?.restful?.parameter ?? []),
        renderParamGroup('Query 参数', request?.query?.parameter ?? []),
        renderParamGroup('Header 参数', request?.header?.parameter ?? []),
        renderParamGroup('Cookie 参数', request?.cookie?.parameter ?? [])
      ].join('')
    : ''

  const bodyBlock = renderBody(target, settings)
  const requestSection =
    paramBlock || bodyBlock
      ? `<div class="api-block"><h3>请求</h3>${paramBlock}${bodyBlock}</div>`
      : ''

  const responseSection = settings.show_response
    ? `<div class="api-block"><h3>响应示例</h3>
${
  examples.length
    ? examples.map((example) => renderResponseExample(example, settings)).join('')
    : '<div class="empty" style="padding:20px">暂无响应示例</div>'
}
</div>`
    : ''

  const scriptBlock = renderScripts(target, settings)
  const scriptSection = scriptBlock
    ? `<div class="api-block"><h3>脚本</h3>${scriptBlock}</div>`
    : ''

  return `<section class="api-card" id="api-${escapeHtml(target.target_id)}">
<div class="api-head">
<span class="method ${method}">${escapeHtml(label)}</span>
<h2>${escapeHtml(target.name)}</h2>
</div>
${target.description ? `<p class="api-desc">${escapeHtml(target.description)}</p>` : ''}
<div class="url-line"><b>${escapeHtml(label)}</b>${escapeHtml(
    target.url || '（未设置 URL）'
  )}</div>
${requestSection}${responseSection}${scriptSection}
</section>`
}

function renderNav(share: DocShare): string {
  const targets = share.snapshot.targets
  const ids = new Set(targets.map((target) => target.target_id))
  const byParent = new Map<string, DocTargetSnapshot[]>()
  for (const target of targets) {
    const parent = ids.has(target.parent_id) ? target.parent_id : '0'
    const list = byParent.get(parent) ?? []
    list.push(target)
    byParent.set(parent, list)
  }

  const sortItems = (items: DocTargetSnapshot[]): DocTargetSnapshot[] =>
    items
      .slice()
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hans-CN'))

  const walk = (parent: string): string => {
    const items = sortItems(byParent.get(parent) ?? [])
    return items
      .map((target) => {
        if (target.target_type === 'folder') {
          const children = walk(target.target_id)
          return `<details class="nav-folder" open>
<summary>${escapeHtml(target.name)}</summary>
<div class="nav-children">${children || '<span class="muted" style="padding:4px 8px;display:block;font-size:12px">空目录</span>'}</div>
</details>`
        }
        return `<a class="nav-api" href="#api-${escapeHtml(target.target_id)}"><span class="m ${methodClass(
          target.method
        )}">${escapeHtml(methodText(target.method))}</span><span>${escapeHtml(target.name)}</span></a>`
      })
      .join('')
  }

  return walk('0')
}

function renderDocPage(share: DocShare): string {
  const apis = share.snapshot.targets.filter((target) => target.target_type === 'api')
  const expire = store.docShareExpireInfo(share)
  const nav = renderNav(share)
  const content = apis.length
    ? `<div class="section-title">接口（${apis.length}）</div>${apis
        .map((api) => renderApi(api, share.settings))
        .join('')}`
    : '<div class="empty">该分享中没有接口</div>'

  const body = `
<header class="doc-top">
  <div class="brand"><span class="logo">o</span> openPost 文档</div>
  <div class="top-crumb">${escapeHtml(share.snapshot.project_name)} / ${escapeHtml(share.name)}</div>
  <div class="top-badges">${shareChips(share)}</div>
</header>
<div class="doc-layout">
  <aside class="doc-nav">
    <div class="nav-title">目录</div>
    ${nav || '<span class="muted">暂无内容</span>'}
    <div class="nav-meta">
      <div>项目：<b>${escapeHtml(share.snapshot.project_name)}</b></div>
      <div>接口数：<b>${apis.length}</b></div>
      <div>最后更新：<b>${escapeHtml(formatTime(share.updated_at))}</b></div>
      <div>有效期：<b>${escapeHtml(expire.expire_label)}</b></div>
    </div>
  </aside>
  <main class="doc-main">
    <div class="hero">
      <h1>${escapeHtml(share.name)}</h1>
      ${share.snapshot.project_intro ? `<p>${escapeHtml(share.snapshot.project_intro)}</p>` : ''}
      <div class="hero-meta">
        <span>项目 ${escapeHtml(share.snapshot.project_name)}</span>
        <span>生成于 ${escapeHtml(formatTime(share.snapshot.generated_at))}</span>
        <span>${escapeHtml(shareChipText(share))}</span>
      </div>
    </div>
    ${content}
  </main>
</div>
<footer class="doc-footer">由 openPost 生成 · ${escapeHtml(formatTime(share.updated_at))}</footer>`

  return pageShell(`${share.name} · openPost 文档`, body)
}

function renderPasswordPage(share: DocShare, error = false): string {
  const body = `
<div class="gate-wrap">
  <div class="gate">
    <div class="logo">o</div>
    <h1>受保护的文档</h1>
    <p>${escapeHtml(share.name)}</p>
    <form method="post" action="/share/${escapeHtml(share.share_id)}/auth">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" placeholder="请输入访问密码" autofocus autocomplete="current-password" required>
      <button type="submit">进入文档</button>
      ${error ? '<div class="error">密码错误，请重试。</div>' : ''}
    </form>
    <div class="foot">由 openPost 提供本地文档分享</div>
  </div>
</div>`
  return pageShell(`${share.name} · 需要密码`, body)
}

function renderMessagePage(title: string, message: string, code = 404): string {
  const body = `
<div class="gate-wrap">
  <div class="gate" style="text-align:center">
    <div class="logo" style="margin:0 auto 18px">o</div>
    <h1>${escapeHtml(title)}</h1>
    <p style="margin-bottom:0">${escapeHtml(message)}</p>
    <div class="foot">HTTP ${code}</div>
  </div>
</div>`
  return pageShell(`${title} · openPost 文档`, body)
}

function renderIndexPage(): string {
  const shares = store.listAllDocShares()
  const rows = shares
    .map((share) => {
      if (shareExpired(share)) {
        return `<tr><td>${escapeHtml(share.name)}</td><td>${escapeHtml(
          share.snapshot.project_name
        )}</td><td><span class="chip expired">已过期</span></td><td>—</td></tr>`
      }
      return `<tr>
<td><a href="/share/${escapeHtml(share.share_id)}">${escapeHtml(share.name)}</a></td>
<td>${escapeHtml(share.snapshot.project_name)}</td>
<td>${share.settings.password ? '<span class="chip password">密码</span>' : '<span class="chip public">公开</span>'}</td>
<td>${escapeHtml(formatTime(share.updated_at))}</td>
</tr>`
    })
    .join('')
  const body = `
<header class="doc-top">
  <div class="brand"><span class="logo">o</span> openPost 文档</div>
  <div class="top-crumb">本机分享索引</div>
  <div class="top-badges"><span class="chip">${shares.length} 份文档</span></div>
</header>
<div class="doc-layout">
  <main class="doc-main" style="max-width:960px;margin:0 auto">
    <div class="hero"><h1>文档分享</h1><p>这些文档由 openPost 在本机生成，点击即可查看。</p></div>
    ${
      shares.length
        ? `<table><thead><tr><th>名称</th><th>项目</th><th>访问</th><th>更新时间</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty">还没有分享文档</div>'
    }
  </main>
</div>`
  return pageShell('文档分享 · openPost', body)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function mdCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
}

function mdParams(title: string, params: Param[]): string {
  const list = activeParams(params)
  if (list.length === 0) return ''
  return `\n**${title}**\n\n| 参数 | 值 | 说明 |\n| --- | --- | --- |\n${list
    .map((param) => `| ${mdCell(param.key)} | ${mdCell(param.value)} | ${mdCell(param.description)} |`)
    .join('\n')}\n`
}

function buildMarkdown(share: DocShare): string {
  const settings = share.settings
  const lines: string[] = []
  lines.push(`# ${share.name}`, '')
  lines.push(`> 项目：${share.snapshot.project_name}`)
  lines.push(`> 最后更新：${formatTime(share.updated_at)}`)
  lines.push(`> 有效期：${store.docShareExpireInfo(share).expire_label}`, '')

  const apis = share.snapshot.targets.filter((target) => target.target_type === 'api')
  for (const api of apis) {
    const method = methodText(api.method)
    lines.push(`## ${method} ${api.name}`, '')
    lines.push('```http')
    lines.push(`${method} ${api.url || ''}`)
    lines.push('```', '')
    if (api.description) lines.push(api.description, '')

    const request = api.request
    if (settings.show_request) {
      lines.push(mdParams('Path 参数', request?.restful?.parameter ?? []))
      lines.push(mdParams('Query 参数', request?.query?.parameter ?? []))
      lines.push(mdParams('Header 参数', request?.header?.parameter ?? []))
      lines.push(mdParams('Cookie 参数', request?.cookie?.parameter ?? []))
    }

    if (settings.show_body && request?.body) {
      const body = request.body
      if (body.mode === 'urlencoded' || body.mode === 'formdata') {
        lines.push(
          mdParams(
            body.mode === 'formdata' ? 'form-data' : 'x-www-form-urlencoded',
            (body.mode === 'formdata' ? body.formdata : body.urlencoded) ?? []
          )
        )
      } else if (body.mode === 'binary') {
        if (body.binary?.file_name) lines.push(`**二进制文件**：${body.binary.file_name}`, '')
      } else {
        const raw = body.mode === 'json' ? body.json ?? body.raw : body.raw
        if (raw) lines.push('**请求体**', '', '```json', pretty(raw), '```', '')
      }
    }

    if (settings.show_response) {
      const examples = api.response?.example ?? []
      if (examples.length === 0) {
        lines.push('**响应示例**：暂无', '')
      }
      for (const example of examples) {
        const code = example.expect?.code ?? 200
        const name = example.expect?.name || ''
        lines.push(`### 响应 ${code}${name ? ` · ${name}` : ''}`, '')
        if (settings.show_headers) {
          lines.push(mdParams('响应头', example.headers ?? example.raw_parameter ?? []))
          lines.push(mdParams('Cookie', example.cookies ?? []))
        }
        lines.push('```json', pretty(example.raw ?? '') || '', '```', '')
      }
    }

    if (settings.show_scripts) {
      const pre = api.request?.pre_script?.trim()
      const test = api.request?.test?.trim()
      if (pre) lines.push('**前置脚本**', '', '```js', pre, '```', '')
      if (test) lines.push('**后置 / 测试脚本**', '', '```js', test, '```', '')
    }

    lines.push('---', '')
  }

  return lines.join('\n')
}

function schemaForExample(value: unknown): Record<string, unknown> {
  if (value === null) return { nullable: true }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: value.length ? schemaForExample(value[0]) : {}
    }
  }
  if (typeof value === 'object') {
    const properties: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = schemaForExample(child)
    }
    return { type: 'object', properties }
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  return { type: 'string' }
}

function urlToOpenApiPath(raw?: string): string {
  let value = (raw ?? '').trim()
  if (!value) return '/'
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname
    } catch {
      value = value.replace(/^https?:\/\/[^/]+/i, '')
    }
  } else {
    const slash = value.indexOf('/')
    value = slash >= 0 ? value.slice(slash) : '/'
  }
  value = value.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
  if (!value.startsWith('/')) value = `/${value}`
  return value || '/'
}

function buildOpenApi(share: DocShare): Record<string, unknown> | null {
  if (!share.settings.openapi) return null
  const apis = share.snapshot.targets.filter((target) => target.target_type === 'api')
  const paths: Record<string, Record<string, unknown>> = {}
  const servers = new Set<string>()

  for (const api of apis) {
    const method = (api.method || 'GET').toLowerCase()
    if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue
    if (api.url && /^https?:\/\//i.test(api.url)) {
      try {
        servers.add(new URL(api.url).origin)
      } catch {
        // ignore
      }
    }
    const path = urlToOpenApiPath(api.url)
    const operation: Record<string, unknown> = {
      summary: api.name || path,
      description: api.description || undefined,
      parameters: [] as Record<string, unknown>[],
      responses: {} as Record<string, unknown>
    }
    const parameters = operation.parameters as Record<string, unknown>[]
    const seen = new Set<string>()
    const addParams = (params: Param[] | undefined, where: string): void => {
      for (const param of activeParams(params)) {
        const key = `${where}:${param.key}`
        if (!param.key || seen.has(key)) continue
        seen.add(key)
        parameters.push({
          name: param.key,
          in: where,
          required: where === 'path',
          description: param.description || undefined,
          schema: { type: 'string' },
          example: param.value || undefined
        })
      }
    }
    addParams(api.request?.restful?.parameter, 'path')
    addParams(api.request?.query?.parameter, 'query')
    addParams(api.request?.header?.parameter, 'header')
    addParams(api.request?.cookie?.parameter, 'cookie')

    const body = api.request?.body
    if (body) {
      if (body.mode === 'urlencoded' || body.mode === 'formdata') {
        const params = activeParams(body.mode === 'formdata' ? body.formdata : body.urlencoded)
        if (params.length) {
          operation.requestBody = {
            content: {
              [body.mode === 'formdata'
                ? 'multipart/form-data'
                : 'application/x-www-form-urlencoded']: {
                schema: {
                  type: 'object',
                  properties: Object.fromEntries(
                    params.map((param) => [
                      param.key,
                      { type: 'string', description: param.description || undefined }
                    ])
                  )
                }
              }
            }
          }
        }
      } else if (body.mode !== 'none' && body.mode !== 'binary') {
        const raw = body.mode === 'json' ? body.json ?? body.raw : body.raw
        if (raw && raw.trim()) {
          let example: unknown = raw
          let schema: Record<string, unknown> = { type: 'string' }
          try {
            example = JSON.parse(raw)
            schema = schemaForExample(example)
          } catch {
            // keep string
          }
          operation.requestBody = {
            content: {
              [body.mode === 'json' ? 'application/json' : 'text/plain']: { schema, example }
            }
          }
        }
      }
    }

    const examples = api.response?.example ?? []
    const responses = operation.responses as Record<string, unknown>
    if (examples.length === 0) {
      responses['200'] = { description: 'Successful response' }
    } else {
      for (const example of examples) {
        const code = String(example.expect?.code ?? 200)
        let bodyValue: unknown = example.raw ?? ''
        let schema: Record<string, unknown> = { type: 'string' }
        try {
          bodyValue = JSON.parse(example.raw ?? '')
          schema = schemaForExample(bodyValue)
        } catch {
          // keep string
        }
        const contentType = example.expect?.content_type || 'application/json'
        responses[code] = {
          description: example.expect?.name || 'Response',
          content: { [contentType]: { schema, example: bodyValue } }
        }
      }
    }

    paths[path] = { ...(paths[path] ?? {}), [method]: operation }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: share.name,
      description: share.snapshot.project_intro || `${share.snapshot.project_name} 接口文档`,
      version: '1.0.0'
    },
    servers: (servers.size ? [...servers] : ['http://localhost']).map((url) => ({ url })),
    tags: [{ name: share.snapshot.project_name }],
    paths
  }
}

function downloadName(share: DocShare, ext: string): string {
  const base = (share.name || '文档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  return `${base}.${ext}`
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function handleAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  share: DocShare
): Promise<void> {
  const ip = clientIp(req)
  if (!authAllowed(ip)) {
    sendHtml(res, 429, renderMessagePage('访问过于频繁', '请稍后再试。', 429))
    return
  }
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await readBody(req))
  } catch {
    sendHtml(res, 413, renderMessagePage('请求过大', '请缩短请求后重试。', 413))
    return
  }
  if (safeEqual(form.get('password') ?? '', share.settings.password)) {
    const token = crypto.randomBytes(24).toString('hex')
    sessions.set(token, {
      shareId: share.share_id,
      expires: Date.now() + TOKEN_TTL_MS,
      updatedAt: share.updated_at
    })
    authAttempts.delete(ip)
    res.statusCode = 302
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`)
    res.setHeader('Location', `/share/${encodeURIComponent(share.share_id)}`)
    res.end()
    return
  }
  noteAuthFailure(ip)
  res.statusCode = 302
  res.setHeader('Location', `/share/${encodeURIComponent(share.share_id)}?e=1`)
  res.end()
}

function handleDownload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  share: DocShare,
  url: URL
): void {
  if (shareExpired(share)) {
    sendHtml(res, 410, renderMessagePage('文档已过期', '该分享已超过有效期。', 410))
    return
  }
  if (!isValidSession(req, share)) {
    sendHtml(res, 401, renderPasswordPage(share))
    return
  }
  const format = (url.searchParams.get('format') || 'md').toLowerCase()
  if (format === 'openapi') {
    const spec = buildOpenApi(share)
    if (!spec) {
      sendText(res, 403, '该分享未开启 OpenAPI 访问')
      return
    }
    sendAttachment(res, JSON.stringify(spec, null, 2), 'application/json; charset=utf-8', downloadName(share, 'openapi.json'))
    return
  }
  if (format === 'html') {
    sendAttachment(res, renderDocPage(share), 'text/html; charset=utf-8', downloadName(share, 'html'))
    return
  }
  if (format === 'md' || format === 'markdown') {
    sendAttachment(res, buildMarkdown(share), 'text/markdown; charset=utf-8', downloadName(share, 'md'))
    return
  }
  sendText(res, 400, '不支持的导出格式')
}

async function handleShare(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  share: DocShare,
  action: string | undefined,
  url: URL
): Promise<void> {
  if (action === '/auth' && req.method === 'POST') {
    if (shareExpired(share)) {
      sendHtml(res, 410, renderMessagePage('文档已过期', '该分享已超过有效期。', 410))
      return
    }
    await handleAuth(req, res, share)
    return
  }
  if (req.method !== 'GET') {
    sendText(res, 405, 'Method Not Allowed')
    return
  }
  if (action === '/download') {
    handleDownload(req, res, share, url)
    return
  }
  if (shareExpired(share)) {
    sendHtml(res, 410, renderMessagePage('文档已过期', '该分享已超过有效期。', 410))
    return
  }
  if (!isValidSession(req, share)) {
    sendHtml(res, 401, renderPasswordPage(share, url.searchParams.get('e') === '1'))
    return
  }
  sendHtml(res, 200, renderDocPage(share))
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setSecurityHeaders(res)
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/health') {
    sendText(res, 200, 'ok')
    return
  }

  if (url.pathname === '/' || url.pathname === '/docs') {
    if (req.method !== 'GET') {
      sendText(res, 405, 'Method Not Allowed')
      return
    }
    sendHtml(res, 200, renderIndexPage())
    return
  }

  const match = url.pathname.match(/^\/share\/([A-Za-z0-9_-]{1,80})(\/auth|\/download)?\/?$/)
  if (!match) {
    sendHtml(res, 404, renderMessagePage('页面不存在', '请检查分享链接是否正确。', 404))
    return
  }

  const share = store.findDocShare(match[1])
  if (!share) {
    sendHtml(res, 404, renderMessagePage('分享不存在', '该分享可能已被删除。', 404))
    return
  }

  await handleShare(req, res, share, match[2], url)
}
