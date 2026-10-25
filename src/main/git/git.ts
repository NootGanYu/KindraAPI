import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  GitAvailability,
  GitBranch,
  GitCommit,
  GitDiffRequest,
  GitDiffResult,
  GitDiscardTarget,
  GitFileChange,
  GitFileKind,
  GitOperationResult,
  GitPullOptions,
  GitPushOptions,
  GitRemote,
  GitRepoInfo,
  GitStatus
} from '@shared/types'

const execFileAsync = promisify(execFile)

const LOCAL_TIMEOUT_MS = 20_000
const NETWORK_TIMEOUT_MS = 120_000
const MAX_BUFFER = 4 * 1024 * 1024
const MAX_DIFF_CHARS = 1_500_000
const MAX_LOG_LIMIT = 200

interface RunOptions {
  timeout?: number
  /** 允许的非零退出码（例如探测类命令） */
  okCodes?: number[]
}

interface RunResult {
  stdout: string
  stderr: string
  code: number
}

/**
 * 统一通过 execFile + 参数数组调用 git：
 * 不经过 shell，所有路径/分支/URL 都作为独立参数传入。
 */
async function runGit(
  cwd: string | null,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  if (cwd && !fs.existsSync(cwd)) {
    throw new Error(`项目目录不存在: ${cwd}`)
  }
  try {
    const result = await execFileAsync('git', args, {
      cwd: cwd ?? os.tmpdir(),
      timeout: options.timeout ?? LOCAL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_PAGER: 'cat',
        LC_ALL: 'C'
      }
    })
    return { stdout: result.stdout, stderr: result.stderr, code: 0 }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      code?: number | string
      killed?: boolean
      stdout?: string
      stderr?: string
    }
    if (err.code === 'ENOENT') {
      throw new Error('未找到 git 命令，请先安装 Git 并确保其位于 PATH 中')
    }
    if (err.killed) {
      throw new Error(`git ${args[0]} 执行超时`)
    }
    const code = typeof err.code === 'number' ? err.code : -1
    if (options.okCodes?.includes(code)) {
      return {
        stdout: String(err.stdout ?? ''),
        stderr: String(err.stderr ?? ''),
        code
      }
    }
    const detail = String(err.stderr || err.stdout || err.message || '').trim()
    throw new Error(detail || `git ${args[0]} 执行失败`)
  }
}

function normalizeDir(dir: string): string {
  const resolved = path.resolve(dir)
  try {
    return fs.realpathSync(resolved)
  } catch {
    return resolved
  }
}

/** 解析上级仓库边界；结果必须与项目目录完全一致，避免误操作外部仓库。 */
async function findRepoRoot(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ['rev-parse', '--show-toplevel'], { okCodes: [128] })
  if (result.code !== 0) return null
  const root = result.stdout.trim()
  return root ? normalizeDir(root) : null
}

async function ensureRepo(cwd: string): Promise<string> {
  const root = await findRepoRoot(cwd)
  if (!root) throw new Error('当前项目目录还不是 Git 仓库')
  if (root !== normalizeDir(cwd)) {
    throw new Error('项目目录位于其他 Git 仓库内，已拒绝操作')
  }
  return root
}

function safeRelPath(cwd: string, filePath: string): string {
  const value = String(filePath ?? '')
  if (!value) throw new Error('文件路径不能为空')
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(`非法文件路径: ${value}`)
  }
  if (value.split(/[\\/]/).includes('..')) {
    throw new Error(`非法文件路径: ${value}`)
  }
  const root = path.resolve(cwd)
  const absolute = path.resolve(root, value)
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error(`文件路径越界: ${value}`)
  }
  return value
}

function assertBranchName(name: string): string {
  const value = String(name ?? '').trim()
  if (!value || value.length > 100) throw new Error('分支名不能为空且不超过 100 个字符')
  if (value.startsWith('-') || value.startsWith('.') || value.endsWith('.') || value.endsWith('/')) {
    throw new Error(`非法分支名: ${value}`)
  }
  if (value.includes('..') || /[\s~^:?*[\\]/.test(value)) {
    throw new Error(`非法分支名: ${value}`)
  }
  return value
}

function assertRemoteName(name: string): string {
  const value = String(name ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)) {
    throw new Error(`非法远程名称: ${value}`)
  }
  return value
}

function assertRemoteUrl(url: string): string {
  const value = String(url ?? '').trim()
  if (!value || value.length > 2048) throw new Error('仓库地址不能为空且不超过 2048 个字符')
  if (value.startsWith('-')) throw new Error('非法仓库地址')
  const looksValid =
    /^(https?|ssh|git|file):\/\//i.test(value) ||
    /^[\w.-]+@[\w.-]+:/.test(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith('/')
  if (!looksValid) {
    throw new Error('仓库地址需为 http(s)/ssh/git/file URL 或本地绝对路径')
  }
  return value
}

function fileKind(index: string, worktree: string): GitFileKind {
  const pair = `${index}${worktree}`
  if (pair === '??') return 'untracked'
  if (pair.includes('U') || pair === 'AA' || pair === 'DD') return 'conflicted'
  if (index === 'R' || worktree === 'R') return 'renamed'
  if (index === 'C' || worktree === 'C') return 'copied'
  if (index === 'A' || worktree === 'A') return 'added'
  if (index === 'D' || worktree === 'D') return 'deleted'
  if (index === 'T' || worktree === 'T') return 'typechange'
  return 'modified'
}

function parseBranchLine(line: string, status: GitStatus): void {
  if (line.startsWith('No commits yet on ')) {
    status.branch = line.slice('No commits yet on '.length).trim() || null
    return
  }
  if (line.startsWith('HEAD (no branch)')) {
    status.detached = true
    status.branch = null
    return
  }
  const trackMatch = line.match(/\[(.+)\]$/)
  const head = line.replace(/\s*\[.+\]$/, '')
  const [branchPart, upstreamPart] = head.split('...')
  status.branch = branchPart?.trim() || null
  status.upstream = upstreamPart?.trim() || null
  if (trackMatch) {
    const ahead = trackMatch[1].match(/ahead (\d+)/)
    const behind = trackMatch[1].match(/behind (\d+)/)
    status.ahead = ahead ? Number(ahead[1]) : 0
    status.behind = behind ? Number(behind[1]) : 0
  }
}

function parseStatus(raw: string): GitStatus {
  const status: GitStatus = {
    is_repo: true,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: []
  }
  const tokens = raw.split('\0')
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) continue
    if (token.startsWith('## ')) {
      parseBranchLine(token.slice(3), status)
      continue
    }
    const index = token[0] ?? ' '
    const worktree = token[1] ?? ' '
    const filePath = token.slice(3)
    if (!filePath) continue
    let oldPath: string | undefined
    if (index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C') {
      const next = tokens[i + 1]
      if (next !== undefined) {
        oldPath = next
        i += 1
      }
    }
    status.files.push({
      path: filePath,
      old_path: oldPath,
      index_status: index,
      worktree_status: worktree,
      kind: fileKind(index, worktree)
    })
  }
  return status
}

function limitDiff(diff: string): GitDiffResult {
  if (diff.length <= MAX_DIFF_CHARS) return { diff, truncated: false }
  return { diff: diff.slice(0, MAX_DIFF_CHARS), truncated: true }
}

function isProbablyBinary(file: string): boolean {
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return false
  }
  if (!stat.isFile()) return true
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(8192, stat.size))
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read).includes(0)
  } finally {
    fs.closeSync(fd)
  }
}

export async function getGitAvailability(): Promise<GitAvailability> {
  try {
    const { stdout } = await runGit(null, ['--version'])
    return { available: true, version: stdout.trim() }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function getGitInfo(cwd: string): Promise<GitRepoInfo> {
  const root = await findRepoRoot(cwd)
  if (!root || root !== normalizeDir(cwd)) {
    return {
      is_repo: false,
      root: null,
      branch: null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      remotes: []
    }
  }
  const status = await getGitStatus(cwd)
  const remotes = await listRemotes(cwd)
  return {
    is_repo: true,
    root,
    branch: status.branch,
    detached: status.detached,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    remotes
  }
}

export async function initRepo(cwd: string, branch = 'main'): Promise<GitOperationResult> {
  if (!fs.existsSync(cwd)) throw new Error('项目目录不存在')
  const existing = await findRepoRoot(cwd)
  if (existing) {
    if (existing !== normalizeDir(cwd)) {
      throw new Error('项目目录位于其他 Git 仓库内，已拒绝操作')
    }
    return { message: '已经是 Git 仓库', output: '' }
  }
  const name = assertBranchName(branch || 'main')
  const result = await runGit(cwd, ['init', '-b', name], { okCodes: [129] })
  let output = (result.stdout + result.stderr).trim()
  if (result.code !== 0) {
    const legacy = await runGit(cwd, ['init'])
    output = (legacy.stdout + legacy.stderr).trim()
    await runGit(cwd, ['symbolic-ref', 'HEAD', `refs/heads/${name}`])
  }
  // 运行记录属于本地执行日志，可能包含请求头/Cookie 等敏感信息，默认不纳入版本管理。
  const ignoreFile = path.join(cwd, '.gitignore')
  if (!fs.existsSync(ignoreFile)) {
    fs.writeFileSync(
      ignoreFile,
      '# openPost 运行记录（可能包含敏感信息）\nexecutions/runs/\n',
      'utf8'
    )
  }
  return { message: 'Git 仓库已初始化', output }
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  const root = await findRepoRoot(cwd)
  if (!root || root !== normalizeDir(cwd)) {
    return {
      is_repo: false,
      branch: null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: []
    }
  }
  const { stdout } = await runGit(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--branch',
    '--untracked-files=all'
  ])
  return parseStatus(stdout)
}

export async function getGitDiff(
  cwd: string,
  request: GitDiffRequest
): Promise<GitDiffResult> {
  await ensureRepo(cwd)
  const filePath = safeRelPath(cwd, request.path)
  if (request.untracked) {
    const absolute = path.join(cwd, filePath)
    if (isProbablyBinary(absolute)) {
      return { diff: `二进制文件，不展示内容：${filePath}`, truncated: false }
    }
    if (fs.statSync(absolute).size > MAX_DIFF_CHARS) {
      return { diff: `文件过大，不展示内容：${filePath}`, truncated: true }
    }
    const content = fs.readFileSync(absolute, 'utf8')
    const lines = content.split('\n').map((line) => `+${line}`)
    return limitDiff(
      [`--- /dev/null`, `+++ b/${filePath}`, ...lines].join('\n')
    )
  }
  const args = ['diff', '--no-color', '--no-ext-diff']
  if (request.staged) args.push('--cached')
  args.push('--', filePath)
  const { stdout } = await runGit(cwd, args)
  return limitDiff(stdout)
}

export async function getCommitDiff(
  cwd: string,
  hash: string
): Promise<GitDiffResult> {
  await ensureRepo(cwd)
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('非法提交哈希')
  const { stdout } = await runGit(cwd, [
    'show',
    '--no-color',
    '--no-ext-diff',
    '--format=fuller',
    '--stat',
    '-p',
    hash
  ])
  return limitDiff(stdout)
}

export async function stagePaths(
  cwd: string,
  paths: string[]
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const list = paths.map((item) => safeRelPath(cwd, item))
  if (list.length === 0) throw new Error('没有选择文件')
  const { stdout, stderr } = await runGit(cwd, ['add', '--', ...list])
  return { message: '已暂存', output: (stdout + stderr).trim() }
}

export async function unstagePaths(
  cwd: string,
  paths: string[]
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const list = paths.map((item) => safeRelPath(cwd, item))
  if (list.length === 0) throw new Error('没有选择文件')
  const head = await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], { okCodes: [128, 129] })
  const args =
    head.code === 0
      ? ['reset', 'HEAD', '--', ...list]
      : ['rm', '--cached', '--', ...list]
  const { stdout, stderr } = await runGit(cwd, args)
  return { message: '已取消暂存', output: (stdout + stderr).trim() }
}

export async function discardPaths(
  cwd: string,
  targets: GitDiscardTarget[]
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  if (targets.length === 0) throw new Error('没有选择文件')
  const tracked: string[] = []
  for (const target of targets) {
    const relative = safeRelPath(cwd, target.path)
    if (target.untracked) {
      fs.rmSync(path.join(cwd, relative), { recursive: true, force: true })
    } else {
      tracked.push(relative)
    }
  }
  if (tracked.length > 0) {
    // 只恢复工作区到暂存区版本，保留用户已暂存的内容。
    await runGit(cwd, ['checkout', '--', ...tracked])
  }
  return {
    message: targets.some((item) => item.untracked) ? '已删除/丢弃所选更改' : '已丢弃更改',
    output: ''
  }
}

export async function commitChanges(
  cwd: string,
  message: string,
  stageAll: boolean
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const text = String(message ?? '').trim()
  if (!text) throw new Error('提交信息不能为空')
  if (text.length > 5000) throw new Error('提交信息过长（最多 5000 字符）')
  if (stageAll) await runGit(cwd, ['add', '-A', '--', '.'])
  const { stdout, stderr } = await runGit(cwd, ['commit', '-m', text])
  return { message: '提交成功', output: (stdout + stderr).trim() }
}

export async function getGitLog(cwd: string, limit = 50): Promise<GitCommit[]> {
  await ensureRepo(cwd)
  const head = await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], { okCodes: [128, 129] })
  if (head.code !== 0) return []
  const count = Math.min(Math.max(Number(limit) || 50, 1), MAX_LOG_LIMIT)
  const { stdout } = await runGit(cwd, [
    'log',
    `-n${count}`,
    '--date=iso-strict',
    '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e'
  ])
  return stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, email, date, subject, refs] = record.split('\x1f')
      return {
        hash: hash ?? '',
        short_hash: shortHash ?? '',
        author: author ?? '',
        email: email ?? '',
        date: date ?? '',
        subject: subject ?? '',
        refs: refs ?? ''
      }
    })
}

export async function listBranches(cwd: string): Promise<GitBranch[]> {
  await ensureRepo(cwd)
  const { stdout } = await runGit(cwd, [
    'for-each-ref',
    '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)',
    'refs/heads'
  ])
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, head, upstream, track] = line.split('\t')
      const ahead = track?.match(/ahead (\d+)/)
      const behind = track?.match(/behind (\d+)/)
      return {
        name: name ?? '',
        current: head?.trim() === '*',
        upstream: upstream?.trim() || null,
        ahead: ahead ? Number(ahead[1]) : 0,
        behind: behind ? Number(behind[1]) : 0
      }
    })
    .filter((branch) => Boolean(branch.name))
}

export async function createBranch(
  cwd: string,
  name: string,
  checkout: boolean
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const branch = assertBranchName(name)
  const args = checkout ? ['checkout', '-b', branch] : ['branch', branch]
  const { stdout, stderr } = await runGit(cwd, args)
  return {
    message: checkout ? `已创建并切换到 ${branch}` : `已创建分支 ${branch}`,
    output: (stdout + stderr).trim()
  }
}

export async function checkoutBranch(
  cwd: string,
  name: string
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const branch = assertBranchName(name)
  const { stdout, stderr } = await runGit(cwd, ['checkout', branch])
  return { message: `已切换到 ${branch}`, output: (stdout + stderr).trim() }
}

export async function deleteBranch(
  cwd: string,
  name: string
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const branch = assertBranchName(name)
  const { stdout, stderr } = await runGit(cwd, ['branch', '-d', branch])
  return { message: `已删除分支 ${branch}`, output: (stdout + stderr).trim() }
}

export async function listRemotes(cwd: string): Promise<GitRemote[]> {
  const result = await runGit(cwd, ['remote', '-v'], { okCodes: [128] })
  if (result.code !== 0) return []
  const map = new Map<string, GitRemote>()
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^(\S+)\t(.+) \((fetch|push)\)$/)
    if (!match) continue
    const [, name, url, kind] = match
    const item = map.get(name) ?? { name, fetch_url: '', push_url: '' }
    if (kind === 'fetch') item.fetch_url = url
    else item.push_url = url
    map.set(name, item)
  }
  return Array.from(map.values())
}

export async function addRemote(
  cwd: string,
  name: string,
  url: string
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const remote = assertRemoteName(name)
  const address = assertRemoteUrl(url)
  const { stdout, stderr } = await runGit(cwd, ['remote', 'add', remote, address])
  return { message: `已添加远程 ${remote}`, output: (stdout + stderr).trim() }
}

export async function setRemoteUrl(
  cwd: string,
  name: string,
  url: string
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const remote = assertRemoteName(name)
  const address = assertRemoteUrl(url)
  const { stdout, stderr } = await runGit(cwd, ['remote', 'set-url', remote, address])
  return { message: `已更新远程 ${remote}`, output: (stdout + stderr).trim() }
}

export async function removeRemote(
  cwd: string,
  name: string
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const remote = assertRemoteName(name)
  const { stdout, stderr } = await runGit(cwd, ['remote', 'remove', remote])
  return { message: `已移除远程 ${remote}`, output: (stdout + stderr).trim() }
}

export async function fetchRepo(
  cwd: string,
  remote?: string
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const args = ['fetch', '--prune']
  if (remote) args.push(assertRemoteName(remote))
  const { stdout, stderr } = await runGit(cwd, args, { timeout: NETWORK_TIMEOUT_MS })
  return { message: '远端更新已获取', output: (stdout + stderr).trim() }
}

export async function pullRepo(
  cwd: string,
  options: GitPullOptions = {}
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const args = ['pull']
  if (options.rebase) args.push('--rebase')
  if (options.remote) args.push(assertRemoteName(options.remote))
  if (options.branch) args.push(assertBranchName(options.branch))
  const { stdout, stderr } = await runGit(cwd, args, { timeout: NETWORK_TIMEOUT_MS })
  return { message: '拉取完成', output: (stdout + stderr).trim() }
}

export async function pushRepo(
  cwd: string,
  options: GitPushOptions = {}
): Promise<GitOperationResult> {
  await ensureRepo(cwd)
  const remote = options.remote ? assertRemoteName(options.remote) : 'origin'
  const branch = options.branch ? assertBranchName(options.branch) : ''
  const args = ['push']
  if (options.set_upstream) args.push('--set-upstream')
  args.push(remote)
  args.push(branch || 'HEAD')
  const { stdout, stderr } = await runGit(cwd, args, { timeout: NETWORK_TIMEOUT_MS })
  return { message: '推送完成', output: (stdout + stderr).trim() }
}

export function openInTerminal(cwd: string): { opened: boolean; output: string } {
  const dir = normalizeDir(cwd)
  if (process.platform === 'darwin') {
    execFile('open', ['-a', 'Terminal', dir], () => undefined)
    return { opened: true, output: dir }
  }
  if (process.platform === 'win32') {
    execFile(
      'cmd.exe',
      ['/c', 'start', 'cmd.exe', '/k', `cd /d "${dir}"`],
      { windowsHide: true },
      () => undefined
    )
    return { opened: true, output: dir }
  }
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: 'x-terminal-emulator', args: [`--working-directory=${dir}`] },
    { command: 'gnome-terminal', args: [`--working-directory=${dir}`] },
    { command: 'konsole', args: ['--workdir', dir] },
    { command: 'xfce4-terminal', args: [`--working-directory=${dir}`] }
  ]
  const chosen = candidates[0]
  execFile(chosen.command, chosen.args, () => undefined)
  return { opened: true, output: dir }
}
