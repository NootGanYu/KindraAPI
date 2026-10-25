import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Divider,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag
} from 'antd'
import type { MenuProps } from 'antd'
import {
  BranchesOutlined,
  CodeOutlined,
  DeleteOutlined,
  DownOutlined,
  LinkOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { useApp } from '../store'
import type {
  GitAvailability,
  GitBranch,
  GitCommit,
  GitDiffRequest,
  GitDiffResult,
  GitFileChange,
  GitRepoInfo,
  GitStatus,
  Result
} from '@shared/types'

type ChangeGroup = 'conflicted' | 'staged' | 'unstaged' | 'untracked'

interface Group {
  key: ChangeGroup
  label: string
  files: GitFileChange[]
}

interface SelectedFile {
  group: ChangeGroup
  file: GitFileChange
}

interface RemoteDraft {
  name: string
  url: string
}

const GROUP_ORDER: ChangeGroup[] = ['conflicted', 'staged', 'unstaged', 'untracked']

const GROUP_LABEL: Record<ChangeGroup, string> = {
  conflicted: '冲突',
  staged: '已暂存',
  unstaged: '更改',
  untracked: '未跟踪'
}

const GROUP_DISMISS_ACTION: Record<ChangeGroup, string> = {
  conflicted: '',
  staged: '取消暂存',
  unstaged: '丢弃更改',
  untracked: '删除文件'
}

function keyOf(group: ChangeGroup, file: GitFileChange): string {
  return `${group}:${file.path}`
}

function badgeOf(group: ChangeGroup, file: GitFileChange): string {
  if (group === 'untracked') return '?'
  const status = group === 'staged' ? file.index_status : file.worktree_status
  return !status || status === ' ' ? '·' : status
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function renderDiffLines(text: string): JSX.Element[] {
  return text
    .split('\n')
    .slice(0, 4000)
    .map((line, index) => {
      let className = 'dl ctx'
      if (line.startsWith('@@')) className = 'dl hunk'
      else if (!line.startsWith('---') && !line.startsWith('+++') && line.startsWith('+')) {
        className = 'dl add'
      } else if (!line.startsWith('---') && !line.startsWith('+++') && line.startsWith('-')) {
        className = 'dl del'
      } else if (
        /^(diff --git|index |old mode|new mode|similarity index|rename |new file mode|deleted file mode|commit |Author:|Date:|AuthorDate:|Commit:|CommitDate:|Merge:|--- |\+\+\+ )/.test(
          line
        )
      ) {
        className = 'dl meta'
      }
      return (
        <span key={index} className={className}>
          {line || ' '}
        </span>
      )
    })
}

export default function GitPage(): JSX.Element {
  const project = useApp((state) => state.project)
  const { message, modal } = AntApp.useApp()

  const [availability, setAvailability] = useState<GitAvailability | null>(null)
  const [info, setInfo] = useState<GitRepoInfo | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitCommit[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [tab, setTab] = useState<'changes' | 'history'>('changes')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)

  const [commitMessage, setCommitMessage] = useState('')
  const [stageAll, setStageAll] = useState(false)
  const [initBranch, setInitBranch] = useState('main')

  const [branchModalOpen, setBranchModalOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')

  const [remoteModalOpen, setRemoteModalOpen] = useState(false)
  const [remoteEdits, setRemoteEdits] = useState<Record<string, string>>({})
  const [newRemote, setNewRemote] = useState<RemoteDraft>({ name: '', url: '' })

  const showError = useCallback(
    (error: unknown) => {
      message.error(error instanceof Error ? error.message : String(error))
    },
    [message]
  )

  const run = useCallback(
    async <T,>(
      label: string,
      action: () => Promise<Result<T>>,
      successText?: (data: T) => string
    ): Promise<T | null> => {
      setBusy(label)
      try {
        const result = await action()
        if (!result.ok) {
          message.error(result.error)
          return null
        }
        if (successText) message.success(successText(result.data))
        return result.data
      } catch (error) {
        showError(error)
        return null
      } finally {
        setBusy(null)
      }
    },
    [message, showError]
  )

  const refresh = useCallback(async () => {
    if (!project) return
    setLoading(true)
    try {
      const availabilityResult = await window.api.git.availability()
      const nextAvailability: GitAvailability = availabilityResult.ok
        ? availabilityResult.data
        : { available: false, error: availabilityResult.error }
      setAvailability(nextAvailability)
      if (!nextAvailability.available) return

      const infoResult = await window.api.git.info(project.project_id)
      if (!infoResult.ok) {
        message.error(infoResult.error)
        return
      }
      setInfo(infoResult.data)
      if (!infoResult.data.is_repo) {
        setStatus(null)
        setLog([])
        setBranches([])
        setSelectedFile(null)
        setSelectedCommit(null)
        setDiff(null)
        return
      }

      const [statusResult, logResult, branchesResult] = await Promise.all([
        window.api.git.status(project.project_id),
        window.api.git.log(project.project_id, 50),
        window.api.git.branches(project.project_id)
      ])
      if (statusResult.ok) setStatus(statusResult.data)
      if (logResult.ok) setLog(logResult.data)
      if (branchesResult.ok) setBranches(branchesResult.data)
    } catch (error) {
      showError(error)
    } finally {
      setLoading(false)
    }
  }, [project, message, showError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    setSelectedPaths(new Set())
    setSelectedFile(null)
    setSelectedCommit(null)
    setDiff(null)
    setCommitMessage('')
    setTab('changes')
  }, [project?.project_id])

  const groups = useMemo<Group[]>(() => {
    const files = status?.files ?? []
    const conflicted = files.filter((file) => file.kind === 'conflicted')
    const untracked = files.filter((file) => file.kind === 'untracked')
    const normal = files.filter(
      (file) => file.kind !== 'conflicted' && file.kind !== 'untracked'
    )
    const staged = normal.filter(
      (file) => file.index_status !== ' ' && file.index_status !== '?'
    )
    const unstaged = normal.filter(
      (file) => file.worktree_status !== ' ' && file.worktree_status !== '?'
    )
    const map: Record<ChangeGroup, GitFileChange[]> = {
      conflicted,
      staged,
      unstaged,
      untracked
    }
    return GROUP_ORDER.map((key) => ({
      key,
      label: GROUP_LABEL[key],
      files: map[key]
    }))
  }, [status])

  const changeCount = status?.files.length ?? 0

  const toggleFile = (group: ChangeGroup, file: GitFileChange): void => {
    const key = keyOf(group, file)
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleGroup = (group: Group, checked: boolean): void => {
    setSelectedPaths((current) => {
      const next = new Set(current)
      for (const file of group.files) {
        const key = keyOf(group.key, file)
        if (checked) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  const selectedInGroup = (group: Group): GitFileChange[] =>
    group.files.filter((file) => selectedPaths.has(keyOf(group.key, file)))

  const openFileDiff = async (
    group: ChangeGroup,
    file: GitFileChange
  ): Promise<void> => {
    if (!project) return
    const request: GitDiffRequest = {
      path: file.path,
      staged: group === 'staged',
      untracked: group === 'untracked'
    }
    setSelectedCommit(null)
    setSelectedFile({ group, file })
    const data = await run('diff', () => window.api.git.diff(project.project_id, request))
    if (data) setDiff(data)
  }

  const openCommitDiff = async (commit: GitCommit): Promise<void> => {
    if (!project) return
    setSelectedFile(null)
    setSelectedCommit(commit)
    const data = await run('commitDiff', () =>
      window.api.git.commitDiff(project.project_id, commit.hash)
    )
    if (data) setDiff(data)
  }

  const stageGroup = (group: Group): void => {
    if (!project) return
    const files = selectedInGroup(group)
    if (files.length === 0) {
      message.warning('请先勾选文件')
      return
    }
    void run('stage', () =>
      window.api.git.stage(
        project.project_id,
        files.map((file) => file.path)
      )
    ).then((data) => {
      if (data) {
        setSelectedPaths(new Set())
        void refresh()
      }
    })
  }

  const handleGroupAction = (group: Group): void => {
    if (!project) return
    const files = selectedInGroup(group)
    if (files.length === 0) {
      message.warning('请先勾选文件')
      return
    }
    const paths = files.map((file) => file.path)
    if (group.key === 'staged') {
      void run('unstage', () =>
        window.api.git.unstage(project.project_id, paths)
      ).then((data) => {
        if (data) {
          setSelectedPaths(new Set())
          void refresh()
        }
      })
      return
    }
    if (group.key === 'conflicted') return
    const deleting = group.key === 'untracked'
    modal.confirm({
      title: deleting ? '删除未跟踪文件？' : '丢弃工作区更改？',
      content: `将影响 ${paths.length} 个文件，该操作不可撤销。`,
      okText: deleting ? '删除' : '丢弃',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const data = await run('discard', () =>
          window.api.git.discard(
            project.project_id,
            files.map((file) => ({
              path: file.path,
              untracked: deleting
            }))
          )
        )
        if (data) {
          setSelectedPaths(new Set())
          setSelectedFile(null)
          setDiff(null)
          await refresh()
        }
      }
    })
  }

  const submitCommit = async (): Promise<void> => {
    if (!project) return
    const text = commitMessage.trim()
    if (!text) {
      message.warning('请填写提交信息')
      return
    }
    const data = await run('commit', () =>
      window.api.git.commit(project.project_id, text, stageAll)
    )
    if (data) {
      message.success(data.message)
      setCommitMessage('')
      setSelectedPaths(new Set())
      setSelectedFile(null)
      setSelectedCommit(null)
      setDiff(null)
      await refresh()
    }
  }

  const initialize = async (): Promise<void> => {
    if (!project) return
    const data = await run('init', () =>
      window.api.git.init(project.project_id, initBranch.trim() || 'main')
    )
    if (data) {
      message.success(data.message)
      await refresh()
    }
  }

  const openTerminal = async (): Promise<void> => {
    if (!project) return
    const data = await run('terminal', () => window.api.git.terminal(project.project_id))
    if (data) message.success('已在终端打开项目目录')
  }

  const switchBranch = async (name: string): Promise<void> => {
    if (!project || name === info?.branch) return
    const data = await run('checkout', () =>
      window.api.git.checkoutBranch(project.project_id, name)
    )
    if (data) {
      message.success(data.message)
      setBranchModalOpen(false)
      await refresh()
    }
  }

  const createBranch = async (): Promise<void> => {
    if (!project) return
    const name = newBranchName.trim()
    if (!name) {
      message.warning('请填写分支名')
      return
    }
    const data = await run('branchCreate', () =>
      window.api.git.createBranch(project.project_id, name, true)
    )
    if (data) {
      message.success(data.message)
      setNewBranchName('')
      setBranchModalOpen(false)
      await refresh()
    }
  }

  const confirmDeleteBranch = (name: string): void => {
    if (!project) return
    modal.confirm({
      title: `删除分支 ${name}？`,
      content: '仅删除已合并的本地分支；未合并的分支会被 Git 拒绝删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const data = await run('branchDelete', () =>
          window.api.git.deleteBranch(project.project_id, name)
        )
        if (data) {
          message.success(data.message)
          await refresh()
        }
      }
    })
  }

  const addRemote = async (): Promise<void> => {
    if (!project) return
    const name = newRemote.name.trim()
    const url = newRemote.url.trim()
    if (!name || !url) {
      message.warning('请填写远程名称和仓库地址')
      return
    }
    const data = await run('remoteAdd', () =>
      window.api.git.addRemote(project.project_id, name, url)
    )
    if (data) {
      message.success(data.message)
      setNewRemote({ name: '', url: '' })
      await refresh()
    }
  }

  const saveRemoteUrl = async (name: string): Promise<void> => {
    if (!project) return
    const url = (remoteEdits[name] ?? '').trim()
    if (!url) {
      message.warning('仓库地址不能为空')
      return
    }
    const data = await run(`remoteSave:${name}`, () =>
      window.api.git.setRemoteUrl(project.project_id, name, url)
    )
    if (data) {
      message.success(data.message)
      setRemoteEdits((current) => {
        const next = { ...current }
        delete next[name]
        return next
      })
      await refresh()
    }
  }

  const removeRemote = (name: string): void => {
    if (!project) return
    modal.confirm({
      title: `移除远程 ${name}？`,
      content: '只删除本地仓库的远程配置，不会影响远端仓库。',
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const data = await run(`remoteRemove:${name}`, () =>
          window.api.git.removeRemote(project.project_id, name)
        )
        if (data) {
          message.success(data.message)
          await refresh()
        }
      }
    })
  }

  const runRemote = async (
    kind: 'fetch' | 'pull' | 'pull-rebase' | 'push'
  ): Promise<void> => {
    if (!project) return
    if (!info?.remotes.length) {
      message.warning('请先配置远程仓库')
      setRemoteModalOpen(true)
      return
    }
    const remote = info.remotes[0].name
    const branch = info.branch ?? undefined
    const data = await run(kind, () => {
      if (kind === 'fetch') return window.api.git.fetch(project.project_id, remote)
      if (kind === 'push') {
        return window.api.git.push(project.project_id, {
          remote,
          branch,
          set_upstream: !info.upstream
        })
      }
      return window.api.git.pull(project.project_id, {
        remote,
        branch,
        rebase: kind === 'pull-rebase'
      })
    })
    if (data) {
      message.success(data.message)
      await refresh()
    }
  }

  const remoteMenu: MenuProps = {
    items: [
      { key: 'fetch', label: '获取远端更新（fetch）' },
      { key: 'pull', label: '拉取并合并（pull）' },
      { key: 'pull-rebase', label: '拉取并变基（pull --rebase）' },
      { type: 'divider' },
      { key: 'push', label: '推送当前分支（push）' }
    ],
    onClick: ({ key }) => {
      void runRemote(key as 'fetch' | 'pull' | 'pull-rebase' | 'push')
    }
  }

  if (!project) {
    return (
      <div className="git-page">
        <div className="git-empty">
          <Empty description="尚未选择项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      </div>
    )
  }

  if (loading && !availability) {
    return (
      <div className="git-page">
        <div className="git-empty">
          <Spin tip="正在检测 Git…" />
        </div>
      </div>
    )
  }

  if (availability && !availability.available) {
    return (
      <div className="git-page">
        <div className="git-empty">
          <div className="git-empty-card">
            <BranchesOutlined className="git-empty-icon" />
            <h2>未检测到 Git</h2>
            <Alert
              type="warning"
              showIcon
              message="无法调用系统 git"
              description={availability.error || '请先安装 Git，并确保 git 命令位于 PATH 中。'}
            />
            <Space>
              <Button onClick={() => void refresh()}>重新检测</Button>
              <Button type="link" onClick={() => void openTerminal()}>
                在终端打开项目目录
              </Button>
            </Space>
          </div>
        </div>
      </div>
    )
  }

  if (info && !info.is_repo) {
    return (
      <div className="git-page">
        <div className="git-empty">
          <div className="git-empty-card">
            <BranchesOutlined className="git-empty-icon" />
            <h2>尚未启用 Git</h2>
            <p>
              为当前项目目录初始化 Git 仓库，接口、环境、全局变量与流程文件都会纳入版本管理。
              发送历史保存在本地目录；初始化时会写入 .gitignore，忽略可能含敏感信息的
              executions/runs/ 运行记录。
            </p>
            <Space>
              <Input
                addonBefore="默认分支"
                value={initBranch}
                onChange={(event) => setInitBranch(event.target.value)}
                style={{ width: 240 }}
              />
              <Button type="primary" loading={busy === 'init'} onClick={() => void initialize()}>
                初始化仓库
              </Button>
            </Space>
            <Space>
              <Button type="link" onClick={() => void openTerminal()}>
                在终端打开项目目录
              </Button>
              <Button type="link" onClick={() => void refresh()}>
                重新检测
              </Button>
            </Space>
          </div>
        </div>
      </div>
    )
  }

  const branchOptions = branches.map((branch) => ({
    value: branch.name,
    label: branch.current ? `${branch.name}（当前）` : branch.name
  }))
  const remoteBusy =
    busy === 'fetch' || busy === 'pull' || busy === 'pull-rebase' || busy === 'push'
  const detailTitle = selectedCommit
    ? `提交 ${selectedCommit.short_hash}`
    : selectedFile
      ? selectedFile.file.old_path
        ? `${selectedFile.file.old_path} → ${selectedFile.file.path}`
        : selectedFile.file.path
      : ''

  return (
    <div className="git-page">
      <div className="git-toolbar">
        <div className="git-toolbar-left">
          <BranchesOutlined />
          <span className="git-title">Git</span>
          {info?.branch ? (
            <Select
              size="small"
              value={info.branch}
              options={branchOptions}
              style={{ width: 180 }}
              onChange={(value) => void switchBranch(value)}
            />
          ) : (
            <Tag>游离 HEAD</Tag>
          )}
          {info && (info.ahead > 0 || info.behind > 0) && (
            <span className="git-track">
              ↑{info.ahead} ↓{info.behind}
            </span>
          )}
          {info?.upstream && <span className="git-upstream">{info.upstream}</span>}
        </div>
        <div className="git-toolbar-right">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void refresh()}
          >
            刷新
          </Button>
          <Button size="small" icon={<CodeOutlined />} onClick={() => void openTerminal()}>
            终端
          </Button>
          <Button
            size="small"
            icon={<BranchesOutlined />}
            onClick={() => setBranchModalOpen(true)}
          >
            分支
          </Button>
          <Button
            size="small"
            icon={<LinkOutlined />}
            onClick={() => setRemoteModalOpen(true)}
          >
            远程
          </Button>
          <Dropdown menu={remoteMenu} trigger={['click']}>
            <Button size="small" loading={remoteBusy}>
              同步 <DownOutlined />
            </Button>
          </Dropdown>
        </div>
      </div>

      <div className="git-body">
        <aside className="git-side">
          <div className="git-side-tabs">
            <button
              type="button"
              className={tab === 'changes' ? 'active' : ''}
              onClick={() => setTab('changes')}
            >
              更改 {changeCount > 0 ? <span className="git-count">{changeCount}</span> : null}
            </button>
            <button
              type="button"
              className={tab === 'history' ? 'active' : ''}
              onClick={() => setTab('history')}
            >
              历史 {log.length > 0 ? <span className="git-count">{log.length}</span> : null}
            </button>
          </div>

          {tab === 'changes' ? (
            <>
              <div className="git-changes">
                {changeCount === 0 ? (
                  <Empty
                    description="工作区干净，没有待提交的更改"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : (
                  groups.map((group) => {
                    if (group.files.length === 0) return null
                    const groupKeys = group.files.map((file) => keyOf(group.key, file))
                    const checked = groupKeys.every((key) => selectedPaths.has(key))
                    const indeterminate =
                      !checked && groupKeys.some((key) => selectedPaths.has(key))
                    const selectedCount = group.files.filter((file) =>
                      selectedPaths.has(keyOf(group.key, file))
                    ).length
                    return (
                      <div className="git-group" key={group.key}>
                        <div className="git-group-head">
                          <Checkbox
                            checked={checked}
                            indeterminate={indeterminate}
                            onChange={(event) => toggleGroup(group, event.target.checked)}
                          />
                          <span className="git-group-label">{group.label}</span>
                          <span className="git-group-count">{group.files.length}</span>
                          <span className="git-group-spacer" />
                          {(group.key === 'conflicted' ||
                            group.key === 'unstaged' ||
                            group.key === 'untracked') && (
                            <Button
                              type="link"
                              size="small"
                              disabled={selectedCount === 0}
                              loading={busy === 'stage'}
                              onClick={() => stageGroup(group)}
                            >
                              {group.key === 'conflicted' ? '标记已解决' : '暂存'}
                              {selectedCount > 0 ? ` (${selectedCount})` : ''}
                            </Button>
                          )}
                          {group.key !== 'conflicted' && (
                            <Button
                              type="link"
                              size="small"
                              danger={group.key === 'unstaged' || group.key === 'untracked'}
                              disabled={selectedCount === 0}
                              loading={busy === 'unstage' || busy === 'discard'}
                              onClick={() => handleGroupAction(group)}
                            >
                              {GROUP_DISMISS_ACTION[group.key]}
                              {selectedCount > 0 ? ` (${selectedCount})` : ''}
                            </Button>
                          )}
                        </div>
                        {group.files.map((file) => {
                          const active =
                            selectedFile?.group === group.key &&
                            selectedFile.file.path === file.path
                          return (
                            <div
                              key={keyOf(group.key, file)}
                              className={`git-file${active ? ' active' : ''}`}
                              onClick={() => void openFileDiff(group.key, file)}
                            >
                              <span
                                onClick={(event) => event.stopPropagation()}
                                className="git-file-check"
                              >
                                <Checkbox
                                  checked={selectedPaths.has(keyOf(group.key, file))}
                                  onChange={() => toggleFile(group.key, file)}
                                />
                              </span>
                              <span className={`git-badge ${file.kind}`}>
                                {badgeOf(group.key, file)}
                              </span>
                              <span
                                className="git-file-path"
                                title={
                                  file.old_path
                                    ? `${file.old_path} → ${file.path}`
                                    : file.path
                                }
                              >
                                {file.old_path ? `${file.old_path} → ` : ''}
                                {file.path}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })
                )}
              </div>
              <div className="git-commit">
                <Input.TextArea
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="提交信息（必填）"
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  onPressEnter={(event) => {
                    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
                      event.preventDefault()
                      void submitCommit()
                    }
                  }}
                />
                <div className="git-commit-actions">
                  <Checkbox
                    checked={stageAll}
                    onChange={(event) => setStageAll(event.target.checked)}
                  >
                    暂存全部更改
                  </Checkbox>
                  <Button
                    type="primary"
                    size="small"
                    loading={busy === 'commit'}
                    disabled={!commitMessage.trim()}
                    onClick={() => void submitCommit()}
                  >
                    提交
                  </Button>
                </div>
                <div className="git-commit-hint">⌘/Ctrl + Enter 提交</div>
              </div>
            </>
          ) : (
            <div className="git-log">
              {log.length === 0 ? (
                <Empty description="暂无提交记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                log.map((commit) => (
                  <button
                    type="button"
                    key={commit.hash}
                    className={`git-log-row${
                      selectedCommit?.hash === commit.hash ? ' active' : ''
                    }`}
                    onClick={() => void openCommitDiff(commit)}
                  >
                    <div className="git-log-subject">{commit.subject}</div>
                    <div className="git-log-meta">
                      <span className="git-log-hash">{commit.short_hash}</span>
                      <span>{commit.author}</span>
                      <span>{formatDate(commit.date)}</span>
                    </div>
                    {commit.refs ? <div className="git-log-refs">{commit.refs}</div> : null}
                  </button>
                ))
              )}
            </div>
          )}
        </aside>

        <section className="git-detail">
          <div className="git-diff-head">
            <span className="git-diff-title">
              {detailTitle || '差异'}
            </span>
            {diff?.truncated && <Tag color="orange">已截断</Tag>}
          </div>
          {diff && diff.diff.trim() ? (
            <pre className="git-diff">{renderDiffLines(diff.diff)}</pre>
          ) : (
            <div className="git-detail-empty">
              {diff ? (
                <Empty description="没有差异内容" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Empty
                  description="在左侧选择一个文件或提交查看差异"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </div>
          )}
        </section>
      </div>

      <Modal
        open={branchModalOpen}
        title="分支管理"
        footer={null}
        width={520}
        onCancel={() => setBranchModalOpen(false)}
      >
        <div className="git-branch-add">
          <Input
            placeholder="新分支名"
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            onPressEnter={() => void createBranch()}
          />
          <Button type="primary" loading={busy === 'branchCreate'} onClick={() => void createBranch()}>
            创建并切换
          </Button>
        </div>
        <Divider style={{ margin: '12px 0' }} />
        <div className="git-branch-list">
          {branches.map((branch) => (
            <div
              key={branch.name}
              className={`git-branch-row${branch.current ? ' current' : ''}`}
            >
              <span className="git-branch-name">{branch.name}</span>
              {branch.upstream && <span className="git-branch-upstream">{branch.upstream}</span>}
              {branch.current ? (
                <Tag color="gold">当前</Tag>
              ) : (
                <Space size={4}>
                  <Button size="small" onClick={() => void switchBranch(branch.name)}>
                    切换
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => confirmDeleteBranch(branch.name)}
                  />
                </Space>
              )}
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={remoteModalOpen}
        title="远程仓库"
        footer={null}
        width={620}
        onCancel={() => setRemoteModalOpen(false)}
      >
        {info?.remotes.length === 0 && (
          <Alert
            type="info"
            showIcon
            message="尚未配置远程仓库"
            description="支持 HTTPS / SSH 地址。认证由系统 git credential helper 处理，KindraAPI 不保存密码或私钥。"
          />
        )}
        <div className="git-remote-list">
          {(info?.remotes ?? []).map((remote) => (
            <div className="git-remote-row" key={remote.name}>
              <span className="git-remote-name">{remote.name}</span>
              <Input
                value={remoteEdits[remote.name] ?? remote.fetch_url}
                onChange={(event) =>
                  setRemoteEdits((current) => ({
                    ...current,
                    [remote.name]: event.target.value
                  }))
                }
                placeholder="https://... 或 git@..."
              />
              <Button
                loading={busy === `remoteSave:${remote.name}`}
                onClick={() => void saveRemoteUrl(remote.name)}
              >
                保存
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeRemote(remote.name)}
              />
            </div>
          ))}
        </div>
        <Divider style={{ margin: '12px 0' }} />
        <div className="git-remote-add">
          <Input
            placeholder="名称（如 origin）"
            value={newRemote.name}
            onChange={(event) =>
              setNewRemote((current) => ({ ...current, name: event.target.value }))
            }
            style={{ width: 160 }}
          />
          <Input
            placeholder="仓库地址"
            value={newRemote.url}
            onChange={(event) =>
              setNewRemote((current) => ({ ...current, url: event.target.value }))
            }
          />
          <Button
            type="primary"
            loading={busy === 'remoteAdd'}
            onClick={() => void addRemote()}
          >
            添加
          </Button>
        </div>
      </Modal>
    </div>
  )
}
