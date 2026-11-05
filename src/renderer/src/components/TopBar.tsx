import { useState } from 'react'
import { App as AntApp, Dropdown, Input, Modal, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  ApiOutlined,
  DownOutlined,
  FolderAddOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store'
import { useRefreshFeedback } from '../useRefreshFeedback'
import ProjectImportModal from './ProjectImportModal'

export default function TopBar(): JSX.Element {
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const project = useApp((s) => s.project)
  const projects = useApp((s) => s.projects)
  const paths = useApp((s) => s.paths)
  const selectProject = useApp((s) => s.selectProject)
  const createProject = useApp((s) => s.createProject)
  const reloadTargets = useApp((s) => s.reloadTargets)
  const reloadEnvironments = useApp((s) => s.reloadEnvironments)
  const mcpConfig = useApp((s) => s.mcpConfig)
  const mcpStatus = useApp((s) => s.mcpStatus)
  const saveMcp = useApp((s) => s.saveMcp)

  const [projectModal, setProjectModal] = useState(false)
  const [importModal, setImportModal] = useState(false)
  const [newName, setNewName] = useState('')
  const { refreshing, run: runRefreshFeedback } = useRefreshFeedback()

  const openLocation = (): void => {
    if (paths) void window.api.app.openPath(paths.projectRoot)
  }

  const refresh = (): void => {
    void runRefreshFeedback(() => Promise.all([reloadTargets(), reloadEnvironments()]))
  }

  const toggleMcp = async (): Promise<void> => {
    if (!mcpConfig) return
    try {
      await saveMcp({ ...mcpConfig, enabled: !mcpConfig.enabled })
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const submitProject = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) {
      message.warning('请输入项目名称')
      return
    }
    try {
      await createProject(name)
      setProjectModal(false)
      setNewName('')
      message.success('项目已创建')
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const projectItems: MenuProps['items'] = [
    ...projects.map((item) => ({
      key: item.project_id,
      label: item.name,
      disabled: item.project_id === project?.project_id
    })),
    { type: 'divider' as const },
    { key: '__new', label: '新建项目' },
    { key: '__import', label: '导入项目', icon: <FolderAddOutlined /> }
  ]

  return (
    <header className="topbar">
      <div className="top-left">
        <div className="brand">
          <span className="logo">
            <ApiOutlined style={{ fontSize: 11 }} />
          </span>
          <span>KindraAPI</span>
        </div>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'new', label: '新建项目', icon: <PlusOutlined /> },
              { key: 'import', label: '导入项目', icon: <FolderAddOutlined /> }
            ],
            onClick: ({ key }) => {
              if (key === 'new') setProjectModal(true)
              if (key === 'import') setImportModal(true)
            }
          }}
        >
          <button className="new-project">
            <PlusOutlined style={{ fontSize: 11 }} /> 新建/导入项目
          </button>
        </Dropdown>
      </div>

      <div className="top-center">
        <Dropdown
          trigger={['click']}
          menu={{
            items: projectItems,
            onClick: ({ key }) => {
              if (key === '__new') setProjectModal(true)
              else if (key === '__import') setImportModal(true)
              else void selectProject(key).catch((error: Error) => message.error(error.message))
            }
          }}
        >
          <button className="project-switch">
            <FolderOutlined style={{ fontSize: 14 }} /> {project?.name ?? '默认项目'}
            <DownOutlined style={{ fontSize: 9 }} />
          </button>
        </Dropdown>
        <button className="text-btn" onClick={openLocation}>
          打开位置
        </button>
        <Tooltip title="刷新项目">
          <button
            className={`icon-btn${refreshing ? ' is-refreshing' : ''}`}
            aria-label="刷新项目"
            aria-busy={refreshing}
            disabled={refreshing}
            onClick={refresh}
          >
            <ReloadOutlined style={{ fontSize: 14 }} />
          </button>
        </Tooltip>
      </div>

      <div className="top-right">
        <button className="ai" onClick={() => navigate('/automation')}>
          <ThunderboltOutlined style={{ fontSize: 11 }} /> AI 执行计划
        </button>
        <Tooltip
          title={
            mcpStatus?.error
              ? `MCP：${mcpStatus.error}`
              : mcpStatus?.running
                ? `MCP 运行中 · ${mcpStatus.host}:${mcpStatus.port}`
                : 'MCP 未启动'
          }
        >
          <button className="mcp" onClick={() => void toggleMcp()}>
            <span
              className="green-dot"
              style={{ background: mcpStatus?.running ? 'var(--green-2)' : '#c9bfa9' }}
            />
            MCP连接 {mcpStatus?.running ? '运行中' : '未启动'}
            <span className={`toggle${mcpConfig?.enabled ? ' on' : ''}`}>
              <i />
            </span>
          </button>
        </Tooltip>
      </div>

      <Modal
        title="新建项目"
        open={projectModal}
        okText="创建"
        cancelText="取消"
        onOk={() => void submitProject()}
        onCancel={() => setProjectModal(false)}
        destroyOnClose
      >
        <Input
          autoFocus
          placeholder="项目名称"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onPressEnter={() => void submitProject()}
        />
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          创建空白项目；如需导入 Postman / OpenAPI 数据，请使用“导入项目”。
        </div>
      </Modal>

      <ProjectImportModal open={importModal} onClose={() => setImportModal(false)} />
    </header>
  )
}
