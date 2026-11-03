import { App as AntApp, Tooltip } from 'antd'
import { NavLink } from 'react-router-dom'
import {
  ApiOutlined,
  RobotOutlined,
  BranchesOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HistoryOutlined,
  SettingOutlined
} from '@ant-design/icons'

const items = [
  { to: '/agent', icon: <RobotOutlined />, label: 'Agent' },
  { to: '/history', icon: <HistoryOutlined />, label: '最近' },
  { to: '/apis', icon: <ApiOutlined />, label: 'APIs' },
  { to: '/docs', icon: <FileTextOutlined />, label: '文档' },
  { to: '/schemas', icon: <DatabaseOutlined />, label: '字典' },
  { to: '/mqtt', icon: <CloudServerOutlined />, label: 'MQTT' }
]

export default function LeftNav(): JSX.Element {
  const { message } = AntApp.useApp()

  return (
    <nav className="rail">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `rail-btn${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
      <span className="rail-gap" />
      <Tooltip title="Git 版本管理">
        <NavLink
          to="/git"
          className={({ isActive }) => `rail-btn${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon">
            <BranchesOutlined />
          </span>
          <span>Git</span>
        </NavLink>
      </Tooltip>
      <span className="rail-spacer" />
      <NavLink
        to="/settings"
        className={({ isActive }) => `rail-btn${isActive ? ' active' : ''}`}
      >
        <span className="nav-icon">
          <SettingOutlined />
        </span>
        <span>设置</span>
      </NavLink>
      <Tooltip title="回收站（后续支持）">
        <button
          className="rail-btn icon-only"
          onClick={() => message.info('回收站将在后续里程碑支持')}
        >
          <span className="nav-icon">
            <DeleteOutlined />
          </span>
        </button>
      </Tooltip>
    </nav>
  )
}
