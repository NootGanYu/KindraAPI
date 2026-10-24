import { useState } from 'react'
import { App as AntApp, Dropdown, Input, Modal, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  ApiOutlined,
  DownOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store'

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
  const [newName, setNewName] = useState('')

  const openLocation = (): void => {
    if (paths) void window.api.app.openPath(paths.projectRoot)
  }

  const refresh = (): void => {
    void Promise.all([reloadTargets(), reloadEnvironments()])
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
    { key: '__import', label: '导入项目（后续支持）' }
  ]

  return (
    <header className="topbar">
      <div className="top-left">
        <div className="brand">
          <span className="logo">
            <ApiOutlined style={{ fontSize: 11 }} />
          </span>
          <span>openPost</span>
        </div>
        <button className="new-project" onClick={() => setProjectModal(true)}>
          <PlusOutlined style={{ fontSize: 11 }} /> 新建/导入项目
        </button>
      </div>

      <div className="top-center">
        <Dropdown
          trigger={['click']}
          menu={{
            items: projectItems,
            onClick: ({ key }) => {
              if (key === '__new') setProjectModal(true)
              else if (key === '__import') message.info('导入项目将在后续里程碑支持')
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
          <button className="icon-btn" onClick={refresh}>
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
          导入已有项目数据将在后续里程碑支持。
        </div>
      </Modal>
    </header>
  )
}
