import { ruleCells, rulesToSchema } from '@shared/fieldRules'
import { documentedRequestExample, modelDocumentationWarnings, resolveDocumentedTarget } from './definition'
import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type {
  CaseAssertion,
  DocServiceStatus,
  DocSettings,
  DocShare,
  Param,
  Project,
  ResponseExample,
  Target
} from '@shared/types'
import * as store from '../storage/store'
import { descriptionToHtml, htmlToText } from '@shared/richText'
import { buildFieldRows, buildFieldSchema, typeLabel, type JsonFieldRow } from '@shared/jsonFields'
import { createZip } from './zip'
import { generateModelExample, type ExampleWarning } from '../schema/example'

const DOC_HOST = '0.0.0.0'
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const COOKIE_NAME = 'kindraapi_doc_token'
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
  body: string | Buffer,
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
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
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

/** 分享页图标：仅接受 store 校验过的 data:image，未设置时回退内置 K。 */
function logoMark(settings?: Pick<DocSettings, 'logo'>): string {
  const logo = settings?.logo
  if (logo && logo.startsWith('data:image/')) {
    return `<span class="logo"><img src="${escapeHtml(logo)}" alt=""></span>`
  }
  return '<span class="logo">K</span>'
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
  return (params ?? []).filter((param) => (param.key || param.value))
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
.brand .logo{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;background:linear-gradient(135deg,#c8a25e,#8a6b3b);overflow:hidden}
.brand .logo img,.gate .logo img{width:100%;height:100%;object-fit:cover;display:block}
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
.api-desc{color:var(--text);margin:10px 0 0;line-height:1.75;word-break:break-word}
.api-desc p{margin:6px 0}
.api-desc p:first-child{margin-top:0}
.api-desc p:last-child{margin-bottom:0}
.api-desc h1,.api-desc h2,.api-desc h3,.api-desc h4{margin:12px 0 6px;color:var(--ink);line-height:1.4}
.api-desc ul,.api-desc ol{margin:8px 0;padding-left:22px}
.api-desc li{margin:3px 0}
.api-desc a{color:#2f6bb0}
.api-desc img{max-width:100%}
.api-desc hr{border:none;border-top:1px solid var(--line);margin:12px 0}
.api-desc code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;background:#f6f1e7;padding:1px 4px;border-radius:3px}
.api-desc blockquote{margin:8px 0;padding-left:10px;border-left:3px solid #d9c7a5;color:#6b5d48}
.api-desc pre{background:#f7f3ea;padding:8px 10px;border-radius:4px;overflow:auto}
.api-desc pre code{background:none;padding:0}
.api-desc table{border-collapse:collapse;margin:8px 0}
.api-desc th,.api-desc td{border:1px solid #e3d9c6;padding:4px 8px}
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
.breadcrumb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--muted);font-size:12.5px;margin-bottom:14px}
.breadcrumb a{color:var(--gold)}
.breadcrumb .sep{color:#c9bfae}
.download-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.dl-btn{display:inline-flex;align-items:center;height:30px;padding:0 12px;border-radius:6px;border:1px solid var(--line);background:#fff;color:var(--text);font-size:12.5px;text-decoration:none}
.dl-btn:hover{border-color:var(--gold);color:var(--gold)}
.dl-btn.disabled{background:var(--soft);color:#b8ae9d;border-color:var(--line);cursor:not-allowed}
.folder-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin:14px 0;box-shadow:0 1px 2px rgba(70,55,30,.03)}
.folder-card h2{margin:0;font-size:17px}
.folder-card .folder-count{margin-top:8px;color:var(--muted);font-size:12px}
.nav-api.active{background:rgba(138,107,59,.12);color:var(--ink);font-weight:600}
.nav-folder>summary a{color:inherit;text-decoration:none}
.nav-desc{color:var(--muted);font-size:11.5px;line-height:1.5;margin:2px 8px 6px 20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.folder-desc{margin:8px 0 18px}
.offline-note{margin-top:16px;padding:10px 12px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);font-size:12px;background:var(--soft)}
.content-warning{margin:10px 0;padding:10px 12px;border:1px solid #dc9a32;border-radius:7px;background:#fff3d6;color:#7b4614;font-size:12.5px;white-space:pre-wrap}
.gate-wrap{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(160deg,#faf8f4 0%,#f1e8d7 100%)}
.gate{width:100%;max-width:380px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:32px 30px;box-shadow:0 18px 60px rgba(70,55,30,.10)}
.gate .logo{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#c8a25e,#8a6b3b);font-weight:700;margin-bottom:18px;overflow:hidden}
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

function fileNameOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

function renderDocumentationTable(headings: string[], rows: string[][]): string {
  return '<div style="overflow-x:auto"><table><thead><tr>' + headings.map(h => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + escapeHtml(cell).replace(/\n/g, '<br>') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
}
const RULE_HEADINGS = ['必填/必有', '可为 null', '说明', '枚举及含义', '默认值', '示例值']
function renderParamTable(params: Param[], showValue = true): string {
  return renderDocumentationTable(['参数名', '类型', ...(showValue ? ['值'] : []), ...RULE_HEADINGS], params.map(p => [p.key, p.field_type || '待补充', ...(showValue ? [p.field_type === 'file' ? fileNameOf(p.value) : p.value] : []), ...ruleCells(p)]))
}

function renderParamGroup(title: string, params: Param[]): string {
  const list = activeParams(params)
  if (list.length === 0) return ''
  return `<h4>${escapeHtml(title)}</h4>${renderParamTable(list)}`
}

function renderFieldDocsTable(rows: JsonFieldRow[], title = '请求体字段说明'): string {
  if (!rows.length) return ''
  return '<h4>' + escapeHtml(title) + '</h4>' + renderDocumentationTable(['字段', '类型', ...RULE_HEADINGS], rows.map(row => [row.path || row.name, row.type, ...ruleCells({ ...row.doc, example: row.doc?.example !== undefined ? row.doc.example : row.value })]))
}

interface ShareWarnings {
  requestBodies: Map<string, ExampleWarning[]>
  responseExamples: Map<string, ExampleWarning[]>
}

function responseWarningKey(targetId: string, exampleId: string): string {
  return `${targetId}:${exampleId}`
}

function warningText(warnings: ExampleWarning[], raw: string): string {
  const fallback = raw ? '已保留旧示例' : '使用空示例'
  return `模型警告：内容未完整生成，${fallback}。${warnings
    .map((warning) => warning.message)
    .join('；')}`
}

function renderWarning(warnings: ExampleWarning[], raw: string): string {
  if (warnings.length === 0) return ''
  return `<div class="content-warning" role="alert"><strong>模型警告</strong> · ${escapeHtml(
    warningText(warnings, raw).replace(/^模型警告：/, '')
  )}</div>`
}

function renderResponseExample(
  example: ResponseExample,
  settings: DocSettings,
  warnings: ExampleWarning[] = []
): string {
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
    settings.show_request && snapshotHeaders.length
      ? `<h4>请求头</h4>${renderParamTable(snapshotHeaders)}`
      : ''
  const snapshotBodyBlock =
    settings.show_request && settings.show_body && request
      ? request.body_mode === 'none' || !request.body
        ? '<h4>请求体</h4><p class="muted">无请求体</p>'
        : `<h4>请求体${request.body_mode === undefined ? '（历史记录）' : ''}</h4><pre>${escapeHtml(pretty(request.body))}</pre>`
      : ''
  const requestBlock =
    settings.show_request && request
      ? `<details class="raw-request"><summary>查看历史调用（字段规则以上方定义为准）</summary>
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
${renderWarning(warnings, raw)}
${raw ? `<pre>${escapeHtml(pretty(raw))}</pre>` : '<span class="muted">暂未提供响应体示例</span>'}
${renderFieldDocsTable(buildFieldRows(raw, example.field_docs ?? []).exportedRows, '响应字段说明')}${headerBlock}${cookieBlock}${requestBlock}
</div>
</div>`
}

function renderBody(
  target: Target,
  settings: DocSettings,
  warnings: ExampleWarning[] = []
): string {
  if (!settings.show_request || !settings.show_body) return ''
  const body = target.request?.body
  if (!body) return ''
  const mode = body.mode || 'none'
  if (mode === 'none') return '<h4>请求体</h4><p class="muted">无请求体</p>'

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
  const raw = mode === 'json' ? body.raw ?? body.json : body.raw
  const fieldRows =
    mode === 'json'
      ? buildFieldRows(raw ?? '', body.field_docs ?? []).exportedRows
      : []
  const fieldTable = renderFieldDocsTable(fieldRows)
  const warningBlock = renderWarning(warnings, raw ?? '')
  if (!raw && !fieldTable) return warningBlock
  const prettyBody = raw ? `<h4>请求体</h4><pre>${escapeHtml(pretty(raw))}</pre>` : ''
  return `${warningBlock}${prettyBody}${fieldTable}`
}

function renderScripts(target: Target, settings: DocSettings): string {
  if (!settings.show_scripts) return ''
  const pre = target.request?.pre_script?.trim()
  const test = target.request?.test?.trim()
  if (!pre && !test) return ''
  return `${pre ? `<h4>前置脚本</h4><pre>${escapeHtml(pre)}</pre>` : ''}${
    test ? `<h4>后置 / 测试脚本</h4><pre>${escapeHtml(test)}</pre>` : ''
  }`
}

function renderDesignSection(target: Target): string {
  const errors = target.design?.errors ?? []
  if (errors.length === 0) return ''
  const rows = errors
    .map(
      (error) => `<tr>
<td class="mono">${escapeHtml(error.code)}</td>
<td>${escapeHtml(error.message)}</td>
<td>${escapeHtml(error.description || '')}</td>
</tr>`
    )
    .join('')
  return `<div class="api-block"><h3>设计 · 错误码</h3>
<table><thead><tr><th>Code</th><th>说明</th><th>备注</th></tr></thead><tbody>${rows}</tbody></table>
</div>`
}

const ASSERTION_OPS: Record<string, string> = {
  equals: '等于',
  not_equals: '不等于',
  contains: '包含',
  exists: '存在',
  gt: '大于',
  lt: '小于'
}

function assertionText(assertion: CaseAssertion): string {
  const subject =
    assertion.kind === 'status'
      ? '状态码'
      : assertion.kind === 'duration'
        ? '耗时(ms)'
        : `JSON ${assertion.path || '（未设置路径）'}`
  const op = ASSERTION_OPS[assertion.op] ?? assertion.op
  const expected = assertion.op === 'exists' ? '' : ` ${assertion.expected ?? ''}`
  return `${subject} ${op}${expected}`
}

function renderCasesSection(target: Target): string {
  const cases = (target.cases ?? []).filter((item) => item.is_enabled !== 0)
  if (cases.length === 0) return ''
  const rows = cases
    .map((item) => {
      const assertions = (item.assertions ?? [])
        .filter((assertion) => assertion.is_enabled !== 0)
        .map(assertionText)
        .join('；')
      return `<tr>
<td>${escapeHtml(item.name)}</td>
<td>${escapeHtml(item.description || '')}</td>
<td>${escapeHtml(assertions || '—')}</td>
</tr>`
    })
    .join('')
  return `<div class="api-block"><h3>接口用例</h3>
<table><thead><tr><th>用例</th><th>说明</th><th>断言</th></tr></thead><tbody>${rows}</tbody></table>
</div>`
}

function renderApi(
  target: Target,
  settings: DocSettings,
  apiHref?: string,
  warnings?: ShareWarnings
): string {
  const requestExample = documentedRequestExample(target)
  const modelWarnings = modelDocumentationWarnings(target)
  target = resolveDocumentedTarget(target)
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

  const bodyBlock = renderBody(
    target,
    settings,
    warnings?.requestBodies.get(target.target_id) ?? []
  )
  const requestSection =
    paramBlock || bodyBlock
      ? `<div class="api-block"><h3>请求</h3><h4>请求示例</h4><pre>${escapeHtml(requestExample)}</pre>${paramBlock}${bodyBlock}</div>`
      : ''

  const responseSection = settings.show_response
    ? `<div class="api-block"><h3>响应示例</h3>
${
  examples.length
    ? examples
        .map((example) =>
          renderResponseExample(
            example,
            settings,
            warnings?.responseExamples.get(
              responseWarningKey(target.target_id, example.example_id)
            ) ?? []
          )
        )
        .join('')
    : '<div class="empty" style="padding:20px">暂无响应示例</div>'
}
</div>`
    : ''

  const scriptBlock = renderScripts(target, settings)
  const scriptSection = scriptBlock
    ? `<div class="api-block"><h3>脚本</h3>${scriptBlock}</div>`
    : ''
  const designSection = settings.show_design !== false ? renderDesignSection(target) : ''
  const casesSection = settings.show_cases !== false ? renderCasesSection(target) : ''

  const heading = apiHref
    ? `<a href="${escapeHtml(apiHref)}">${escapeHtml(target.name)}</a>`
    : escapeHtml(target.name)

  return `<section class="api-card" id="api-${escapeHtml(target.target_id)}">
<div class="api-head">
<span class="method ${method}">${escapeHtml(label)}</span>
<h2>${heading}</h2>
</div>
${target.description ? `<div class="api-desc">${descriptionToHtml(target.description)}</div>` : ''}
<div class="url-line"><b>${escapeHtml(label)}</b>${escapeHtml(
    target.url || '（未设置 URL）'
  )}</div>
${modelWarnings.length ? `<div class="api-block"><h3>模型定义待修复</h3><p>以下引用暂时无法解析，相关字段可能不完整：</p>${modelWarnings.map(warning => `<p>${escapeHtml(warning.message)}</p>`).join('')}</div>` : ''}
${requestSection}${responseSection}${designSection}${casesSection}${scriptSection}
</section>`
}

interface ShareView {
  share: DocShare
  project: Project
  targets: Target[]
  rootId: string | null
  byParent: Map<string, Target[]>
  byId: Map<string, Target>
  lastUpdated: string
  warnings: ShareWarnings
  /** 展示环境；变量已按该环境解析为实际值 */
  environment: { name: string } | null
}

export type ShareSelection =
  | { type: 'share' }
  | { type: 'folder'; targetId: string }
  | { type: 'api'; targetId: string }

export type ShareContentIntent =
  | { type: 'page'; selection: ShareSelection }
  | { type: 'zip'; selection: { type: 'share' } | { type: 'folder'; targetId: string } }
  | {
      type: 'html' | 'markdown'
      selection: { type: 'share' } | { type: 'api'; targetId: string }
    }
  | { type: 'openapi'; selection: { type: 'share' } }

export type ShareContentResult =
  | { kind: 'success'; bytes: Buffer; contentType: string; filename?: string }
  | { kind: 'not-found' }
  | { kind: 'openapi-disabled' }

interface RenderCtx {
  share: DocShare
  view: ShareView
  offline: boolean
  /** 完整 HTML / 单 API HTML 使用页内锚点，不引用包外文件。 */
  singleFile?: boolean
  /** 当前页面在 ZIP 内的路径，仅离线渲染使用 */
  currentFile: string
  /** target_id → ZIP 内路径，仅离线渲染使用 */
  fileOf: ((targetId: string) => string | null) | null
}

function prepareShareTargets(
  share: DocShare,
  source: Target[]
): { targets: Target[]; warnings: ShareWarnings } {
  const warnings: ShareWarnings = {
    requestBodies: new Map(),
    responseExamples: new Map()
  }
  const targets = source.map((target) => {
    if (target.target_type !== 'api') return target
    let next = target
    const body = target.request?.body
    if (share.settings.show_request && share.settings.show_body && body?.model_id) {
      const raw = body.raw ?? body.json ?? ''
      const generated = generateModelExample(share.project_id, body.model_id)
      const nextRaw = generated.warnings.length
        ? raw
        : JSON.stringify(generated.value, null, 2)
      next = {
        ...next,
        request: { ...next.request!, body: { ...body, raw: nextRaw } }
      }
      if (generated.warnings.length) {
        warnings.requestBodies.set(target.target_id, generated.warnings)
      }
    }
    if (share.settings.show_response && target.response?.example) {
      let changed = false
      const examples = target.response.example.map((example) => {
        const modelId = example.expect?.model_id
        if (!modelId) return example
        const raw = example.raw ?? ''
        const generated = generateModelExample(share.project_id, modelId)
        changed = true
        if (generated.warnings.length) {
          warnings.responseExamples.set(
            responseWarningKey(target.target_id, example.example_id),
            generated.warnings
          )
        }
        return {
          ...example,
          raw: generated.warnings.length ? raw : JSON.stringify(generated.value, null, 2)
        }
      })
      if (changed) next = { ...next, response: { ...target.response, example: examples } }
    }
    return next
  })
  return { targets, warnings }
}

function environmentVariables(
  share: DocShare,
  projectId: string
): { name: string; vars: Record<string, string> } | null {
  if (!share.settings.env_id) return null
  const environment = store
    .listEnvironments(projectId)
    .find((item) => item.env_id === share.settings.env_id)
  if (!environment) return null
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(environment.env_var_list)) {
    if (value.is_checked > 0) vars[key] = value.current_value ?? ''
  }
  return { name: environment.name, vars }
}

const VARIABLE_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g

/** 文档展示副本的变量替换；未定义的变量保持原样。 */
function replaceVariables<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(VARIABLE_PATTERN, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
    ) as T
  }
  if (Array.isArray(value)) return value.map((item) => replaceVariables(item, vars)) as T
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = replaceVariables(item, vars)
    }
    return result as T
  }
  return value
}

function buildShareView(
  share: DocShare,
  resolved: store.ResolvedDocShare
): ShareView | null {
  if (!resolved.project || resolved.notFound) return null
  const prepared = prepareShareTargets(share, resolved.targets)
  const environment = environmentVariables(share, resolved.project.project_id)
  const targets = environment
    ? prepared.targets.map((target) => replaceVariables(target, environment.vars))
    : prepared.targets
  const ids = new Set(targets.map((target) => target.target_id))
  const byParent = new Map<string, Target[]>()
  const byId = new Map<string, Target>()
  let lastUpdated = share.updated_at
  for (const target of targets) {
    byId.set(target.target_id, target)
    if (!lastUpdated || target.updated_at > lastUpdated) lastUpdated = target.updated_at
    const parent = ids.has(target.parent_id) ? target.parent_id : '0'
    const list = byParent.get(parent) ?? []
    list.push(target)
    byParent.set(parent, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }
  return {
    share,
    project: resolved.project,
    targets,
    rootId: resolved.rootId,
    byParent,
    byId,
    lastUpdated,
    warnings: prepared.warnings,
    environment: environment ? { name: environment.name } : null
  }
}

function shareBase(share: DocShare): string {
  return `/share/${encodeURIComponent(share.share_id)}`
}

function navRoot(view: ShareView): string {
  return view.rootId && view.byId.get(view.rootId)?.target_type === 'folder'
    ? view.rootId
    : '0'
}

function relativeHref(fromFile: string, toFile: string): string {
  const fromDir = path.posix.dirname(fromFile)
  const rel = path.posix.relative(fromDir, toFile)
  return encodeURI(rel || path.posix.basename(toFile))
}

function hrefFor(ctx: RenderCtx, target: Target): string {
  if (ctx.offline && ctx.singleFile) {
    return `#${target.target_type === 'folder' ? 'folder' : 'api'}-${target.target_id}`
  }
  if (!ctx.offline) {
    return target.target_type === 'folder'
      ? `${shareBase(ctx.share)}/f/${encodeURIComponent(target.target_id)}`
      : `${shareBase(ctx.share)}/a/${encodeURIComponent(target.target_id)}`
  }
  const to = ctx.fileOf?.(target.target_id)
  if (!to) return '#'
  return relativeHref(ctx.currentFile, to)
}

function indexHref(ctx: RenderCtx): string {
  if (ctx.offline && ctx.singleFile) return '#top'
  return ctx.offline ? relativeHref(ctx.currentFile, 'index.html') : shareBase(ctx.share)
}

function folderChain(view: ShareView, targetId: string): Target[] {
  const stack: Target[] = []
  const current = view.byId.get(targetId)
  if (!current) return stack
  let parent = current.parent_id !== '0' ? view.byId.get(current.parent_id) : undefined
  while (parent) {
    stack.unshift(parent)
    parent = parent.parent_id !== '0' ? view.byId.get(parent.parent_id) : undefined
  }
  return stack
}

function renderBreadcrumb(ctx: RenderCtx, current?: Target): string {
  const parts = [`<a href="${escapeHtml(indexHref(ctx))}">${escapeHtml(ctx.share.name)}</a>`]
  if (current) {
    for (const ancestor of folderChain(ctx.view, current.target_id)) {
      if (ancestor.target_id === current.target_id) continue
      parts.push(`<span class="sep">/</span><a href="${escapeHtml(hrefFor(ctx, ancestor))}">${escapeHtml(ancestor.name)}</a>`)
    }
    parts.push(`<span class="sep">/</span><span>${escapeHtml(current.name)}</span>`)
  }
  return `<div class="breadcrumb">${parts.join('')}</div>`
}

function renderDownloadBar(
  share: DocShare,
  folderId: string | null,
  apiId: string | null
): string {
  const base = shareBase(share)
  const all = `<a class="dl-btn" href="${base}/download?scope=all&amp;format=zip">下载全部</a>`
  const folder = folderId
    ? `<a class="dl-btn" href="${base}/f/${encodeURIComponent(folderId)}/download?format=zip">下载当前文件夹</a>`
    : '<span class="dl-btn disabled" title="仅在文件夹页可用">下载当前文件夹</span>'
  const api = apiId
    ? `<a class="dl-btn" href="${base}/a/${encodeURIComponent(apiId)}/download?format=html">下载当前接口</a>`
    : '<span class="dl-btn disabled" title="仅在接口页可用">下载当前接口</span>'
  return `<div class="download-bar">${all}${folder}${api}</div>`
}

function renderNav(ctx: RenderCtx, currentFolderId?: string, currentApiId?: string): string {
  const folderNode = (target: Target): string => {
    const children = walk(target.target_id)
    const active = target.target_id === currentFolderId ? ' active' : ''
    const desc = target.description
      ? `<div class="nav-desc">${escapeHtml(htmlToText(descriptionToHtml(target.description)))}</div>`
      : ''
    return `<details class="nav-folder" open>
<summary class="nav-folder-summary${active}"><a href="${escapeHtml(hrefFor(ctx, target))}">${escapeHtml(target.name)}</a></summary>
${desc}
<div class="nav-children">${children || '<span class="muted" style="padding:4px 8px;display:block;font-size:12px">空目录</span>'}</div>
</details>`
  }

  const walk = (parent: string): string =>
    (ctx.view.byParent.get(parent) ?? [])
      .map((target) => {
        if (target.target_type === 'folder') return folderNode(target)
        const active = target.target_id === currentApiId ? ' active' : ''
        return `<a class="nav-api${active}" href="${escapeHtml(hrefFor(ctx, target))}"><span class="m ${methodClass(
          target.method
        )}">${escapeHtml(methodText(target.method))}</span><span>${escapeHtml(target.name)}</span></a>`
      })
      .join('')

  if (ctx.view.rootId) {
    const root = ctx.view.byId.get(ctx.view.rootId)
    if (root?.target_type === 'folder') return folderNode(root)
  }
  return walk(navRoot(ctx.view))
}

function renderShareShell(
  ctx: RenderCtx,
  title: string,
  main: string,
  currentFolderId?: string,
  currentApiId?: string
): string {
  const { share, view } = ctx
  const apiCount = view.targets.filter((target) => target.target_type === 'api').length
  const expire = store.docShareExpireInfo(share)
  const nav = renderNav(ctx, currentFolderId, currentApiId)
  const body = `
<header class="doc-top" id="top">
  <div class="brand">${logoMark(share.settings)} KindraAPI 文档</div>
  <div class="top-crumb">${escapeHtml(view.project.name)} / ${escapeHtml(share.name)}</div>
  <div class="top-badges">${
    view.environment
      ? `<span class="chip env" title="文档中的变量已按该环境解析">环境：${escapeHtml(view.environment.name)}</span>`
      : ''
  }${shareChips(share)}</div>
</header>
<div class="doc-layout">
  <aside class="doc-nav">
    <div class="nav-title">目录</div>
    ${nav || '<span class="muted">暂无内容</span>'}
    <div class="nav-meta">
      <div>项目：<b>${escapeHtml(view.project.name)}</b></div>
      <div>接口数：<b>${apiCount}</b></div>
      <div>最后更新：<b>${escapeHtml(formatTime(view.lastUpdated))}</b></div>
      <div>有效期：<b>${escapeHtml(expire.expire_label)}</b></div>
    </div>
  </aside>
  <main class="doc-main">${main}</main>
</div>
<footer class="doc-footer">由 KindraAPI 生成 · ${escapeHtml(formatTime(view.lastUpdated))}</footer>`
  return pageShell(title, body)
}

function folderCounts(view: ShareView, folderId: string): string {
  const children = view.byParent.get(folderId) ?? []
  const folders = children.filter((item) => item.target_type === 'folder').length
  const apis = children.filter((item) => item.target_type === 'api').length
  return `${folders} 个子目录 · ${apis} 个接口`
}

function renderFolderCard(ctx: RenderCtx, folder: Target): string {
  const href = hrefFor(ctx, folder)
  return `<section class="folder-card">
<h2><a href="${escapeHtml(href)}">${escapeHtml(folder.name)}</a></h2>
${folder.description ? `<div class="api-desc">${descriptionToHtml(folder.description)}</div>` : ''}
<div class="folder-count">${escapeHtml(folderCounts(ctx.view, folder.target_id))}</div>
</section>`
}

function renderListing(ctx: RenderCtx, parentId: string): string {
  const items = ctx.view.byParent.get(parentId) ?? []
  if (items.length === 0) {
    return '<div class="empty">该目录下暂无内容</div>'
  }
  const folders = items.filter((item) => item.target_type === 'folder')
  const apis = items.filter((item) => item.target_type === 'api')
  return `${folders.map((folder) => renderFolderCard(ctx, folder)).join('')}${
    apis.length
      ? `<div class="section-title">接口（${apis.length}）</div>${apis
          .map((api) => renderApi(api, ctx.share.settings, hrefFor(ctx, api), ctx.view.warnings))
          .join('')}`
      : ''
  }`
}

function renderOfflineNote(ctx: RenderCtx): string {
  if (!ctx.offline) return ''
  return `<div class="offline-note">离线文档 · 生成于 ${escapeHtml(formatTime(ctx.view.lastUpdated))}，由 KindraAPI 导出。</div>`
}

function renderHero(
  ctx: RenderCtx,
  options: {
    title?: string
    introHtml?: string
    downloadFolderId?: string | null
    downloadApiId?: string | null
    current?: Target
  }
): string {
  const { share } = ctx
  const meta = `<div class="hero-meta">
<span>项目 ${escapeHtml(ctx.view.project.name)}</span>
<span>${escapeHtml(shareChipText(share))}</span>
</div>`
  return `<div class="hero">
${renderBreadcrumb(ctx, options.current)}
${options.title ? `<h1>${escapeHtml(options.title)}</h1>` : ''}
${options.introHtml ? `<div class="api-desc folder-desc">${options.introHtml}</div>` : ''}
${meta}
${ctx.offline ? '' : renderDownloadBar(share, options.downloadFolderId ?? null, options.downloadApiId ?? null)}
${renderOfflineNote(ctx)}
</div>`
}

function renderShareIndexPage(ctx: RenderCtx): string | null {
  if (ctx.view.rootId) {
    const root = ctx.view.byId.get(ctx.view.rootId)
    if (root?.target_type === 'folder') return renderFolderPage(ctx, root.target_id)
    if (root?.target_type === 'api') return renderApiPage(ctx, root.target_id)
  }
  const main = `${renderHero(ctx, {
    title: ctx.share.name,
    introHtml: descriptionToHtml(ctx.view.project.intro)
  })}
<div class="section-title">目录</div>
${renderListing(ctx, '0')}`
  return renderShareShell(ctx, `${ctx.share.name} · KindraAPI 文档`, main)
}

function renderFolderPage(ctx: RenderCtx, folderId: string): string | null {
  const folder = ctx.view.byId.get(folderId)
  if (!folder || folder.target_type !== 'folder') return null
  const main = `${renderHero(ctx, {
    current: folder,
    title: folder.name,
    introHtml: folder.description ? descriptionToHtml(folder.description) : '',
    downloadFolderId: folder.target_id
  })}
<div class="section-title">内容</div>
${renderListing(ctx, folder.target_id)}`
  return renderShareShell(
    ctx,
    `${folder.name} · ${ctx.share.name}`,
    main,
    folder.target_id
  )
}

function renderApiPage(ctx: RenderCtx, apiId: string): string | null {
  const api = ctx.view.byId.get(apiId)
  if (!api || api.target_type !== 'api') return null
  const main = `${renderHero(ctx, { current: api, downloadApiId: api.target_id })}
${renderApi(api, ctx.share.settings, undefined, ctx.view.warnings)}`
  return renderShareShell(
    ctx,
    `${api.name} · ${ctx.share.name}`,
    main,
    undefined,
    api.target_id
  )
}

function renderCompleteListing(ctx: RenderCtx, parentId: string): string {
  const items = ctx.view.byParent.get(parentId) ?? []
  return items
    .map((target) => {
      if (target.target_type === 'api') {
        return renderApi(target, ctx.share.settings, undefined, ctx.view.warnings)
      }
      return `<section class="folder-card" id="folder-${escapeHtml(target.target_id)}">
<h2>${escapeHtml(target.name)}</h2>
${target.description ? `<div class="api-desc">${descriptionToHtml(target.description)}</div>` : ''}
<div class="folder-count">${escapeHtml(folderCounts(ctx.view, target.target_id))}</div>
${renderCompleteListing(ctx, target.target_id)}
</section>`
    })
    .join('')
}

function renderCompleteHtmlPage(ctx: RenderCtx): string | null {
  if (ctx.view.rootId) {
    const root = ctx.view.byId.get(ctx.view.rootId)
    if (root?.target_type === 'api') return renderApiPage(ctx, root.target_id)
    if (root?.target_type === 'folder') {
      const main = `<div id="folder-${escapeHtml(root.target_id)}">${renderHero(ctx, {
        current: root,
        title: root.name,
        introHtml: root.description ? descriptionToHtml(root.description) : ''
      })}${renderCompleteListing(ctx, root.target_id)}</div>`
      return renderShareShell(ctx, `${root.name} · ${ctx.share.name}`, main, root.target_id)
    }
  }
  const main = `${renderHero(ctx, {
    title: ctx.share.name,
    introHtml: descriptionToHtml(ctx.view.project.intro)
  })}${renderCompleteListing(ctx, '0')}`
  return renderShareShell(ctx, `${ctx.share.name} · KindraAPI 文档`, main)
}

function renderPasswordPage(share: DocShare, error = false): string {
  const body = `
<div class="gate-wrap">
  <div class="gate">
    ${logoMark(share.settings)}
    <h1>受保护的文档</h1>
    <p>${escapeHtml(share.name)}</p>
    <form method="post" action="/share/${escapeHtml(share.share_id)}/auth">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" placeholder="请输入访问密码" autofocus autocomplete="current-password" required>
      <button type="submit">进入文档</button>
      ${error ? '<div class="error">密码错误，请重试。</div>' : ''}
    </form>
    <div class="foot">由 KindraAPI 提供本地文档分享</div>
  </div>
</div>`
  return pageShell(`${share.name} · 需要密码`, body)
}

function renderMessagePage(title: string, message: string, code = 404): string {
  const body = `
<div class="gate-wrap">
  <div class="gate" style="text-align:center">
    <div class="logo" style="margin:0 auto 18px">K</div>
    <h1>${escapeHtml(title)}</h1>
    <p style="margin-bottom:0">${escapeHtml(message)}</p>
    <div class="foot">HTTP ${code}</div>
  </div>
</div>`
  return pageShell(`${title} · KindraAPI 文档`, body)
}

function shareProjectName(share: DocShare): string {
  const resolved = store.resolveDocShareTargets(share.project_id, share)
  return resolved.project?.name ?? share.snapshot.project_name
}

function renderIndexPage(): string {
  const shares = store.listAllDocShares()
  const rows = shares
    .map((share) => {
      if (shareExpired(share)) {
        return `<tr><td>${escapeHtml(share.name)}</td><td>${escapeHtml(
          shareProjectName(share)
        )}</td><td><span class="chip expired">已过期</span></td><td>—</td></tr>`
      }
      return `<tr>
<td><a href="${shareBase(share)}">${escapeHtml(share.name)}</a></td>
<td>${escapeHtml(shareProjectName(share))}</td>
<td>${share.settings.password ? '<span class="chip password">密码</span>' : '<span class="chip public">公开</span>'}</td>
<td>${escapeHtml(formatTime(share.updated_at))}</td>
</tr>`
    })
    .join('')
  const body = `
<header class="doc-top">
  <div class="brand"><span class="logo">K</span> KindraAPI 文档</div>
  <div class="top-crumb">本机分享索引</div>
  <div class="top-badges"><span class="chip">${shares.length} 份文档</span></div>
</header>
<div class="doc-layout">
  <main class="doc-main" style="max-width:960px;margin:0 auto">
    <div class="hero"><h1>文档分享</h1><p>这些文档由 KindraAPI 在本机生成，点击即可查看。</p></div>
    ${
      shares.length
        ? `<table><thead><tr><th>名称</th><th>项目</th><th>访问</th><th>更新时间</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty">还没有分享文档</div>'
    }
  </main>
</div>`
  return pageShell('文档分享 · KindraAPI', body)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function mdCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
}

function mdDocumentationTable(headings: string[], rows: string[][]): string {
  return '| ' + headings.map(mdCell).join(' | ') + ' |\n| ' + headings.map(() => '---').join(' | ') + ' |\n' + rows.map(row => '| ' + row.map(mdCell).join(' | ') + ' |').join('\n') + '\n'
}

function descriptionToMarkdown(value: string): string {
  const html = descriptionToHtml(value)
  const text = htmlToText(html)
  const images = [...html.matchAll(/<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')[^>]*>/gi)].map(
    (match) => `![](${htmlToText(match[1] ?? match[2])})`
  )
  return [text, ...images].filter(Boolean).join('\n\n')
}

function mdParams(title: string, params: Param[]): string {
  const list = activeParams(params)
  return list.length ? '\n**' + title + '**\n\n' + mdDocumentationTable(['参数', '类型', '值', ...RULE_HEADINGS], list.map(p => [p.key, p.field_type || '待补充', p.field_type === 'file' ? fileNameOf(p.value) : p.value, ...ruleCells(p)])) : ''
}
function mdFieldDocs(rows: JsonFieldRow[], title = '请求体字段说明'): string {
  return rows.length ? '\n**' + title + '**\n\n' + mdDocumentationTable(['字段', '类型', ...RULE_HEADINGS], rows.map(row => [row.path || row.name, row.type, ...ruleCells({ ...row.doc, example: row.doc?.example !== undefined ? row.doc.example : row.value })])) : ''
}

function buildMarkdown(share: DocShare, view: ShareView): string {
  const settings = share.settings
  const lines: string[] = []
  lines.push(`# ${share.name}`, '')
  lines.push(`> 项目：${view.project.name}`)
  if (view.environment) lines.push(`> 展示环境：${view.environment.name}（变量已解析为实际值）`)
  lines.push(`> 最后更新：${formatTime(view.lastUpdated)}`)
  lines.push(`> 有效期：${store.docShareExpireInfo(share).expire_label}`, '')

  const apis = view.targets.filter((target) => target.target_type === 'api')
  for (const stored of apis) {
    const api = resolveDocumentedTarget(stored)
    const method = methodText(api.method)
    lines.push(`## ${method} ${api.name}`, '')
    lines.push('```http')
    lines.push(documentedRequestExample(stored))
    lines.push('```', '')
    const descriptionText = descriptionToMarkdown(api.description ?? '')
    if (descriptionText) lines.push(descriptionText, '')
    for (const warning of modelDocumentationWarnings(stored)) lines.push(`> 模型定义待修复，相关字段可能不完整：${mdCell(warning.message)}`, '')

    const request = api.request
    if (settings.show_request) {
      lines.push(mdParams('Path 参数', request?.restful?.parameter ?? []))
      lines.push(mdParams('Query 参数', request?.query?.parameter ?? []))
      lines.push(mdParams('Header 参数', request?.header?.parameter ?? []))
      lines.push(mdParams('Cookie 参数', request?.cookie?.parameter ?? []))
    }

    if (settings.show_request && settings.show_body && request?.body) {
      const body = request.body
      const warnings = view.warnings.requestBodies.get(api.target_id) ?? []
      if (warnings.length) {
        lines.push(`> **${mdCell(warningText(warnings, body.raw ?? body.json ?? ''))}**`, '')
      }
      if (body.mode === 'none') lines.push('**请求体**：无请求体', '')
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
        const raw = body.mode === 'json' ? body.raw ?? body.json : body.raw
        if (raw) lines.push('**请求体**', '', '```json', pretty(raw), '```', '')
        if (body.mode === 'json') {
          const result = buildFieldRows(raw ?? '', body.field_docs ?? [])
          if (result.ok) lines.push(mdFieldDocs(result.exportedRows))
        }
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
        const warnings =
          view.warnings.responseExamples.get(
            responseWarningKey(api.target_id, example.example_id)
          ) ?? []
        if (warnings.length) {
          lines.push(`> **${mdCell(warningText(warnings, example.raw ?? ''))}**`, '')
        }
        if (settings.show_headers) {
          lines.push(mdParams('响应头', example.headers ?? example.raw_parameter ?? []))
          lines.push(mdParams('Cookie', example.cookies ?? []))
        }
        lines.push('```json', pretty(example.raw ?? '') || '', '```', '')
        lines.push(mdFieldDocs(buildFieldRows(example.raw ?? '', example.field_docs ?? []).exportedRows, '响应字段说明'))
        if (settings.show_request && example.request) {
          lines.push('**示例请求**', '', '```http')
          lines.push(`${example.request.method || ''} ${example.request.url || ''}`.trim(), '```')
          lines.push(mdParams('请求头', example.request.headers ?? []))
          if (settings.show_body && example.request.body) {
            lines.push('**请求体**', '', '```json', pretty(example.request.body), '```', '')
          }
        }
      }
    }

    if (settings.show_design) {
      const errors = api.design?.errors ?? []
      if (errors.length) {
        lines.push('### 设计 · 错误码', '', '| Code | 说明 | 备注 |', '| --- | --- | --- |')
        for (const error of errors) {
          lines.push(
            `| ${mdCell(error.code)} | ${mdCell(error.message)} | ${mdCell(error.description)} |`
          )
        }
        lines.push('')
      }
    }

    if (settings.show_cases) {
      const cases = (api.cases ?? []).filter((item) => item.is_enabled !== 0)
      if (cases.length) {
        lines.push('### 接口用例', '', '| 用例 | 说明 | 断言 |', '| --- | --- | --- |')
        for (const item of cases) {
          const assertions = (item.assertions ?? [])
            .filter((assertion) => assertion.is_enabled !== 0)
            .map(assertionText)
            .join('；')
          lines.push(
            `| ${mdCell(item.name)} | ${mdCell(item.description)} | ${mdCell(assertions || '—')} |`
          )
        }
        lines.push('')
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

function buildOpenApi(share: DocShare, view: ShareView): Record<string, unknown> {
  const spec = buildOpenApi30(share, view)
  const version = share.settings.openapi_version ?? '3.0'
  if (version === '3.1') return toOpenApi31(spec)
  if (version === '2.0') return toSwagger20(spec)
  return spec
}

function buildOpenApi30(share: DocShare, view: ShareView): Record<string, unknown> {
  const apis = view.targets.filter((target) => target.target_type === 'api')
  const settings = share.settings
  const paths: Record<string, Record<string, unknown>> = {}
  const servers = new Set<string>()

  for (const stored of apis) {
    const api = resolveDocumentedTarget(stored)
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
    const description = htmlToText(descriptionToHtml(api.description ?? ''))
    const requestWarnings =
      settings.show_request && settings.show_body
        ? (view.warnings.requestBodies.get(api.target_id) ?? [])
        : []
    const operation: Record<string, unknown> = {
      summary: api.name || path,
      description:
        [
          description,
          requestWarnings.length
            ? warningText(requestWarnings, api.request?.body?.raw ?? api.request?.body?.json ?? '')
            : ''
        ]
          .filter(Boolean)
          .join('\n\n') || undefined,
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
          required: where === 'path' ? true : param.required,
          description: param.description || undefined,
          schema: { type: param.field_type || 'string', ...rulesToSchema(param) },
          example: param.example !== undefined ? param.example : param.value || undefined
        })
      }
    }
    if (settings.show_request) {
      addParams(api.request?.restful?.parameter, 'path')
      addParams(api.request?.query?.parameter, 'query')
      addParams(api.request?.header?.parameter, 'header')
      addParams(api.request?.cookie?.parameter, 'cookie')
    }

    const body = api.request?.body
    if (settings.show_request && settings.show_body && body) {
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
                  required: params.filter(p => p.required).map(p => p.key),
                  properties: Object.fromEntries(
                    params.map((param) => [
                      param.key,
                      { type: param.field_type === 'file' ? 'string' : param.field_type || 'string', ...(param.field_type === 'file' ? { format: 'binary' } : {}), ...rulesToSchema(param) }
                    ])
                  )
                }
              }
            }
          }
        }
      } else if (body.mode !== 'none' && body.mode !== 'binary') {
        const raw = (body.mode === 'json' ? body.raw ?? body.json : body.raw) ?? ''
        const fieldDocs = body.field_docs ?? []
        if ((raw && raw.trim()) || requestWarnings.length) {
          let example: unknown = raw
          let schema: Record<string, unknown> = { type: 'string' }
          try {
            example = JSON.parse(raw)
            if (body.mode === 'json') {
              const built = buildFieldSchema(raw, fieldDocs)
              schema = built.ok ? built.schema : schemaForExample(example)
            } else {
              schema = schemaForExample(example)
            }
          } catch {
            // keep string
          }
          operation.requestBody = {
            content: {
              [body.mode === 'json' ? 'application/json' : 'text/plain']: { schema, example }
            }
          }
        } else if (body.mode === 'json' && fieldDocs.length > 0) {
          const built = buildFieldSchema('', fieldDocs)
          if (built.ok && built.hasFields) {
            operation.requestBody = {
              content: { 'application/json': { schema: built.schema } }
            }
          }
        }
      }
    }

    const examples = api.response?.example ?? []
    const responses = operation.responses as Record<string, unknown>
    if (!settings.show_response || examples.length === 0) {
      responses['200'] = { description: 'Successful response' }
    } else {
      for (const example of examples) {
        const code = String(example.expect?.code ?? 200)
        const raw = example.raw ?? ''
        let bodyValue: unknown = raw
        let schema: Record<string, unknown> = { type: 'string' }
        try {
          bodyValue = JSON.parse(raw)
          schema = schemaForExample(bodyValue)
        } catch {
          // keep string
        }
        const built = buildFieldSchema(example.raw ?? '', example.field_docs ?? [])
        if (built.ok && built.hasFields) schema = built.schema
        const contentType = example.expect?.content_type || 'application/json'
        const warnings =
          view.warnings.responseExamples.get(
            responseWarningKey(api.target_id, example.example_id)
          ) ?? []
        const headers = settings.show_headers
          ? Object.fromEntries(
              activeParams(example.headers ?? example.raw_parameter ?? [])
                .filter((param) => param.key)
                .map((param) => [
                  param.key,
                  {
                    description: param.description || undefined,
                    schema: { type: 'string' },
                    example: param.value || undefined
                  }
                ])
            )
          : {}
        const response = (responses[code] ??= {
          description: [example.expect?.name || 'Response', warnings.length ? warningText(warnings, raw) : '']
            .filter(Boolean)
            .join('\n\n'),
          ...(Object.keys(headers).length ? { headers } : {}),
          content: {}
        }) as {
          description: string
          headers?: Record<string, unknown>
          content: Record<string, Record<string, any>>
        }
        const media = response.content[contentType]
        if (!media) response.content[contentType] = { schema, ...(example.raw !== undefined ? { example: bodyValue } : {}) }
        else {
          if (!media.examples) {
            media.examples = { default: { value: media.example } }
            delete media.example
          }
          media.examples[example.example_id] = { summary: example.expect?.name, value: bodyValue }
        }
      }
    }

    paths[path] = { ...(paths[path] ?? {}), [method]: operation }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: share.name,
      description:
        htmlToText(descriptionToHtml(view.project.intro)) || `${view.project.name} 接口文档`,
      version: '1.0.0'
    },
    servers: (servers.size ? [...servers] : ['http://localhost']).map((url) => ({ url })),
    tags: [{ name: view.project.name }],
    paths
  }
}

/** 递归把 OpenAPI 3.0 的 nullable 转为 3.1 的 type 数组表达。 */
function convertNullableFor31(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convertNullableFor31)
  if (!node || typeof node !== 'object') return node
  const source = node as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'nullable') continue
    result[key] = convertNullableFor31(value)
  }
  if (source.nullable === true) {
    const type = result.type
    if (type === undefined) result.type = 'null'
    else if (typeof type === 'string') result.type = [type, 'null']
    else if (Array.isArray(type)) result.type = [...type, 'null']
  }
  return result
}

function toOpenApi31(spec: Record<string, unknown>): Record<string, unknown> {
  return { ...(convertNullableFor31(spec) as Record<string, unknown>), openapi: '3.1.0' }
}

/** 递归删除 Swagger 2.0 不支持的 nullable 关键字。 */
function stripNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNullable)
  if (!node || typeof node !== 'object') return node
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'nullable') continue
    result[key] = stripNullable(value)
  }
  return result
}

const SWAGGER_PARAM_KEYS = [
  'type',
  'format',
  'items',
  'enum',
  'default',
  'minimum',
  'maximum',
  'pattern',
  'minLength',
  'maxLength',
  'description'
] as const

/** 把 JSON Schema 片段展开为 Swagger 2.0 参数可接受的字段。 */
function schemaToSwagger(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripNullable(schema) as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of SWAGGER_PARAM_KEYS) {
    if (cleaned[key] !== undefined) result[key] = cleaned[key]
  }
  if (result.type === 'object' || result.type === 'null' || result.type === undefined) {
    result.type = 'string'
  }
  return result
}

function toSwaggerOperation(operation: Record<string, unknown>): Record<string, unknown> {
  const parameters: Record<string, unknown>[] = []
  for (const raw of (operation.parameters as Record<string, unknown>[] | undefined) ?? []) {
    const schema = (raw.schema as Record<string, unknown> | undefined) ?? {}
    parameters.push({
      name: raw.name,
      in: raw.in,
      ...(raw.required !== undefined ? { required: raw.required } : {}),
      ...(raw.description !== undefined ? { description: raw.description } : {}),
      ...schemaToSwagger(schema),
      ...(raw.example !== undefined ? { 'x-example': raw.example } : {})
    })
  }

  const requestBody = operation.requestBody as
    | { content?: Record<string, { schema?: Record<string, unknown>; example?: unknown }> }
    | undefined
  let consumes: string[] | undefined
  if (requestBody?.content) {
    for (const [contentType, media] of Object.entries(requestBody.content)) {
      const schema = (media.schema as Record<string, unknown> | undefined) ?? {}
      if (contentType.includes('urlencoded') || contentType.includes('multipart')) {
        consumes = [contentType.includes('multipart') ? 'multipart/form-data' : 'application/x-www-form-urlencoded']
        const properties = (schema.properties as Record<string, Record<string, unknown>>) ?? {}
        const required = (schema.required as string[] | undefined) ?? []
        for (const [name, property] of Object.entries(properties)) {
          parameters.push({
            name,
            in: 'formData',
            required: required.includes(name),
            ...schemaToSwagger(property)
          })
        }
      } else {
        consumes ??= [contentType]
        parameters.push({
          name: 'body',
          in: 'body',
          required: true,
          ...(schema.description ? { description: schema.description } : {}),
          schema: stripNullable(schema)
        })
      }
    }
  }

  const responses = (operation.responses as Record<string, Record<string, unknown>> | undefined) ?? {}
  const swaggerResponses = Object.fromEntries(
    Object.entries(responses).map(([code, response]) => {
      const content = response.content as
        | Record<string, { schema?: Record<string, unknown>; example?: unknown }>
        | undefined
      const first = content ? Object.values(content)[0] : undefined
      const headers = response.headers as
        | Record<string, { description?: string; example?: unknown }>
        | undefined
      return [
        code,
        {
          description: response.description ?? '',
          ...(first?.schema ? { schema: stripNullable(first.schema) } : {}),
          ...(headers
            ? {
                headers: Object.fromEntries(
                  Object.entries(headers).map(([name, header]) => [
                    name,
                    { type: 'string', ...(header.description ? { description: header.description } : {}) }
                  ])
                )
              }
            : {}),
          ...(first?.example !== undefined ? { 'x-example': first.example } : {})
        }
      ]
    })
  )

  return {
    ...(operation.summary ? { summary: operation.summary } : {}),
    ...(operation.description ? { description: operation.description } : {}),
    ...(consumes ? { consumes } : {}),
    ...(parameters.length ? { parameters } : {}),
    responses: swaggerResponses
  }
}

function toSwagger20(spec: Record<string, unknown>): Record<string, unknown> {
  const servers = (spec.servers as Array<{ url: string }> | undefined) ?? []
  let host: string | undefined
  let basePath: string | undefined
  let schemes: string[] | undefined
  try {
    const url = new URL(servers[0]?.url ?? '')
    host = url.host
    schemes = [url.protocol.replace(':', '')]
    if (url.pathname && url.pathname !== '/') basePath = url.pathname.replace(/\/$/, '')
  } catch {
    // 非绝对地址时省略 host/basePath/schemes
  }
  const paths = Object.fromEntries(
    Object.entries((spec.paths as Record<string, Record<string, unknown>>) ?? {}).map(
      ([path, operations]) => [
        path,
        Object.fromEntries(
          Object.entries(operations).map(([method, operation]) => [
            method,
            toSwaggerOperation(operation as Record<string, unknown>)
          ])
        )
      ]
    )
  )
  return {
    swagger: '2.0',
    info: spec.info,
    ...(host ? { host } : {}),
    ...(basePath ? { basePath } : {}),
    ...(schemes ? { schemes } : {}),
    ...(spec.tags ? { tags: spec.tags } : {}),
    produces: ['application/json'],
    paths
  }
}

function downloadName(share: DocShare, ext: string): string {
  const base = sanitizeSegment(share.name || '文档', 'docs').slice(0, 80)
  return `${base}.${ext}`
}

function sanitizeSegment(raw: string, fallback: string): string {
  let value = String(raw ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
  if (!value) value = fallback
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) value = `_${value}`
  return value.slice(0, 60) || fallback
}

interface ZipLayout {
  files: Map<string, string>
  pages: Array<{ target: Target; file: string }>
}

function buildZipLayout(view: ShareView, rootFolderId?: string): ZipLayout {
  const files = new Map<string, string>()
  const pages: Array<{ target: Target; file: string }> = []
  const used = new Map<string, Set<string>>()
  // 每份 ZIP 都有根 index.html，接口不能占用这个路径（含大小写变体）。
  used.set('', new Set(['index']))

  const unique = (dir: string, base: string): string => {
    const set = used.get(dir) ?? new Set<string>()
    used.set(dir, set)
    let name = base
    let n = 2
    while (set.has(name.toLowerCase())) name = `${base} (${n++})`
    set.add(name.toLowerCase())
    return name
  }
  const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

  const walk = (parent: string, dir: string): void => {
    for (const item of view.byParent.get(parent) ?? []) {
      const base = sanitizeSegment(
        item.name,
        item.target_type === 'folder' ? 'folder' : 'api'
      )
      if (item.target_type === 'folder') {
        const folderDir = join(dir, unique(dir, base))
        const file = `${folderDir}/index.html`
        files.set(item.target_id, file)
        pages.push({ target: item, file })
        walk(item.target_id, folderDir)
      } else {
        const file = join(dir, `${unique(dir, base)}.html`)
        files.set(item.target_id, file)
        pages.push({ target: item, file })
      }
    }
  }

  if (rootFolderId) {
    const root = view.byId.get(rootFolderId)
    if (root && root.target_type === 'folder') {
      files.set(root.target_id, 'index.html')
      pages.push({ target: root, file: 'index.html' })
      walk(root.target_id, '')
    }
  } else if (view.share.scope === 'folder' && view.rootId) {
    const root = view.byId.get(view.rootId)
    if (root) {
      files.set(root.target_id, 'index.html')
      pages.push({ target: root, file: 'index.html' })
      walk(root.target_id, '')
    }
  } else if (view.share.scope === 'api' && view.rootId) {
    const root = view.byId.get(view.rootId)
    if (root) {
      files.set(root.target_id, 'index.html')
      pages.push({ target: root, file: 'index.html' })
    }
  } else {
    walk('0', '')
  }

  return { files, pages }
}

function offlineCtx(
  share: DocShare,
  view: ShareView,
  layout: ZipLayout,
  currentFile: string
): RenderCtx {
  return {
    share,
    view,
    offline: true,
    currentFile,
    fileOf: (id) => layout.files.get(id) ?? null
  }
}

function buildZip(
  share: DocShare,
  view: ShareView,
  rootFolderId?: string
): Buffer {
  const layout = buildZipLayout(view, rootFolderId)
  const entries: Array<{ path: string; data: string }> = []
  const indexFile = rootFolderId ?? (view.share.scope === 'folder' || view.share.scope === 'api' ? view.rootId : null)
  const indexCtx = offlineCtx(share, view, layout, 'index.html')
  const indexHtml = indexFile
    ? view.byId.get(indexFile)?.target_type === 'api'
      ? renderApiPage(indexCtx, indexFile)
      : renderFolderPage(indexCtx, indexFile)
    : renderShareIndexPage(indexCtx)
  entries.push({ path: 'index.html', data: indexHtml ?? '' })

  for (const page of layout.pages) {
    if (page.file === 'index.html') continue
    const ctx = offlineCtx(share, view, layout, page.file)
    const html =
      page.target.target_type === 'folder'
        ? renderFolderPage(ctx, page.target.target_id)
        : renderApiPage(ctx, page.target.target_id)
    if (html) entries.push({ path: page.file, data: html })
  }

  const root = sanitizeSegment(share.name, 'docs')
  return createZip(entries.map((entry) => ({ path: `${root}/${entry.path}`, data: entry.data })))
}

function folderSelectionView(view: ShareView, folderId: string): ShareView | null {
  const root = view.byId.get(folderId)
  if (!root || root.target_type !== 'folder') return null
  const ids = new Set<string>()
  const walk = (id: string): void => {
    if (ids.has(id)) return
    ids.add(id)
    for (const child of view.byParent.get(id) ?? []) walk(child.target_id)
  }
  walk(folderId)
  return buildShareView(view.share, {
    project: view.project,
    targets: view.targets.filter((target) => ids.has(target.target_id)),
    rootId: folderId,
    notFound: false
  })
}

function apiSelectionView(view: ShareView, apiId: string): ShareView | null {
  const api = view.byId.get(apiId)
  if (!api || api.target_type !== 'api') return null
  return buildShareView(view.share, {
    project: view.project,
    targets: [api],
    rootId: apiId,
    notFound: false
  })
}

export function produceShareContent(
  share: DocShare,
  intent: ShareContentIntent
): ShareContentResult {
  const view = loadShareView(share)
  if (!view) return { kind: 'not-found' }
  if (intent.type === 'zip') {
    const scoped =
      intent.selection.type === 'folder'
        ? folderSelectionView(view, intent.selection.targetId)
        : view
    if (!scoped) return { kind: 'not-found' }
    return {
      kind: 'success',
      bytes: buildZip(
        share,
        scoped,
        intent.selection.type === 'folder' ? intent.selection.targetId : undefined
      ),
      contentType: 'application/zip',
      filename: downloadName(share, 'zip')
    }
  }
  if (intent.type === 'html') {
    const scoped =
      intent.selection.type === 'api'
        ? apiSelectionView(view, intent.selection.targetId)
        : view
    if (!scoped) return { kind: 'not-found' }
    const html = renderCompleteHtmlPage({
      share,
      view: scoped,
      offline: true,
      singleFile: true,
      currentFile: 'index.html',
      fileOf: null
    })
    if (!html) return { kind: 'not-found' }
    return {
      kind: 'success',
      bytes: Buffer.from(html, 'utf8'),
      contentType: 'text/html; charset=utf-8',
      filename:
        intent.selection.type === 'api'
          ? `${sanitizeSegment(scoped.targets[0].name, 'api')}.html`
          : downloadName(share, 'html')
    }
  }
  if (intent.type === 'markdown') {
    const scoped =
      intent.selection.type === 'api'
        ? apiSelectionView(view, intent.selection.targetId)
        : view
    if (!scoped) return { kind: 'not-found' }
    return {
      kind: 'success',
      bytes: Buffer.from(buildMarkdown(share, scoped), 'utf8'),
      contentType: 'text/markdown; charset=utf-8',
      filename:
        intent.selection.type === 'api'
          ? `${sanitizeSegment(scoped.targets[0].name, 'api')}.md`
          : downloadName(share, 'md')
    }
  }
  if (intent.type === 'openapi') {
    if (!share.settings.openapi) return { kind: 'openapi-disabled' }
    const spec = buildOpenApi(share, view)
    return {
      kind: 'success',
      bytes: Buffer.from(JSON.stringify(spec, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
      filename: downloadName(share, 'openapi.json')
    }
  }
  const ctx: RenderCtx = {
    share,
    view,
    offline: false,
    currentFile: '',
    fileOf: null
  }
  const html =
    intent.selection.type === 'share'
      ? renderShareIndexPage(ctx)
      : intent.selection.type === 'folder'
        ? renderFolderPage(ctx, intent.selection.targetId)
        : renderApiPage(ctx, intent.selection.targetId)
  if (!html) return { kind: 'not-found' }
  return {
    kind: 'success',
    bytes: Buffer.from(html, 'utf8'),
    contentType: 'text/html; charset=utf-8'
  }
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

function loadShareView(share: DocShare): ShareView | null {
  return buildShareView(share, store.resolveDocShareTargets(share.project_id, share))
}

function sendContentResult(res: http.ServerResponse, result: ShareContentResult): void {
  if (result.kind === 'not-found') {
    sendHtml(res, 404, renderMessagePage('分享内容不存在', '该目标不存在或不在分享范围内。', 404))
    return
  }
  if (result.kind === 'openapi-disabled') {
    sendText(res, 403, '该分享未开启 OpenAPI 访问')
    return
  }
  if (result.filename) {
    sendAttachment(res, result.bytes, result.contentType, result.filename)
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', result.contentType)
  res.end(result.bytes)
}

function handleDownload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  share: DocShare,
  url: URL,
  scope: { folderId?: string; apiId?: string } = {}
): void {
  if (shareExpired(share)) {
    sendHtml(res, 410, renderMessagePage('文档已过期', '该分享已超过有效期。', 410))
    return
  }
  if (!isValidSession(req, share)) {
    sendHtml(res, 401, renderPasswordPage(share))
    return
  }

  let intent: ShareContentIntent
  if (scope.folderId) {
    if ((url.searchParams.get('format') || 'zip').toLowerCase() !== 'zip') {
      sendText(res, 400, '文件夹仅支持 ZIP 下载')
      return
    }
    intent = { type: 'zip', selection: { type: 'folder', targetId: scope.folderId } }
  } else if (scope.apiId) {
    const format = (url.searchParams.get('format') || 'html').toLowerCase()
    if (format !== 'html' && format !== 'md' && format !== 'markdown') {
      sendText(res, 400, '不支持的导出格式')
      return
    }
    intent = {
      type: format === 'html' ? 'html' : 'markdown',
      selection: { type: 'api', targetId: scope.apiId }
    }
  } else {
    const format = (
      url.searchParams.get('format') ||
      (url.searchParams.get('scope') === 'all' ? 'zip' : 'md')
    ).toLowerCase()
    if (!['zip', 'html', 'md', 'markdown', 'openapi'].includes(format)) {
      sendText(res, 400, '不支持的导出格式')
      return
    }
    intent =
      format === 'zip'
        ? { type: 'zip', selection: { type: 'share' } }
        : format === 'html'
          ? { type: 'html', selection: { type: 'share' } }
          : format === 'openapi'
            ? { type: 'openapi', selection: { type: 'share' } }
            : { type: 'markdown', selection: { type: 'share' } }
  }
  sendContentResult(res, produceShareContent(share, intent))
}

async function handleShare(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  share: DocShare,
  rest: string,
  url: URL
): Promise<void> {
  if (rest === '/auth') {
    if (req.method !== 'POST') {
      sendText(res, 405, 'Method Not Allowed')
      return
    }
    if (shareExpired(share)) {
      sendHtml(res, 410, renderMessagePage('文档已过期', '该分享已超过有效期。', 410))
      return
    }
    await handleAuth(req, res, share)
    return
  }

  const folderMatch = rest.match(/^\/f\/([A-Za-z0-9_-]{1,80})(\/download)?\/?$/)
  const apiMatch = rest.match(/^\/a\/([A-Za-z0-9_-]{1,80})(\/download)?\/?$/)
  const isIndex = rest === '' || rest === '/'
  const isDownload = rest === '/download'
  if (!isIndex && !isDownload && !folderMatch && !apiMatch) {
    sendHtml(res, 404, renderMessagePage('页面不存在', '请检查分享链接是否正确。', 404))
    return
  }
  if (req.method !== 'GET') {
    sendText(res, 405, 'Method Not Allowed')
    return
  }
  if (isDownload || folderMatch?.[2] || apiMatch?.[2]) {
    handleDownload(req, res, share, url, {
      folderId: folderMatch?.[1],
      apiId: apiMatch?.[1]
    })
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
  const selection: ShareSelection = isIndex
    ? { type: 'share' }
    : folderMatch
      ? { type: 'folder', targetId: folderMatch[1] }
      : { type: 'api', targetId: apiMatch![1] }
  sendContentResult(res, produceShareContent(share, { type: 'page', selection }))
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

  const match = url.pathname.match(/^\/share\/([A-Za-z0-9_-]{1,80})(\/.*)?$/)
  if (!match) {
    sendHtml(res, 404, renderMessagePage('页面不存在', '请检查分享链接是否正确。', 404))
    return
  }

  const share = store.findDocShare(match[1])
  if (!share) {
    sendHtml(res, 404, renderMessagePage('分享不存在', '该分享可能已被删除。', 404))
    return
  }

  await handleShare(req, res, share, match[2] ?? '', url)
}
