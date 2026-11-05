import { useState } from 'react'
import { Drawer, Empty } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store'
import AgentConversationPanel from './AgentConversationPanel'
import '../pages/agent.css'

/** Always-mounted entry point: the main app stays interactive while the panel is open. */
export default function AgentDock(): JSX.Element {
  const project = useApp(state => state.project)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  function openSettings(): void {
    setOpen(false)
    navigate('/settings#agent-connections')
  }
  return <>
    {!open && <button className="agent-dock-fab" aria-label="打开 Agent" onClick={() => setOpen(true)}>
      <RobotOutlined />
      <span>Agent</span>
    </button>}
    <Drawer
      className="agent-dock-drawer"
      rootClassName="agent-dock-drawer-root"
      placement="right"
      width="40vw"
      mask={false}
      forceRender
      destroyOnClose={false}
      open={open}
      onClose={() => setOpen(false)}
      title={null}
      closable={false}
      styles={{ body: { padding: 0 }, header: { display: 'none' } }}
    >
      {project
        ? <AgentConversationPanel key={project.project_id} projectId={project.project_id} projectName={project.name} open={open} onOpenSettings={openSettings} onClose={() => setOpen(false)} />
        : <Empty description="请先选择项目" style={{ marginTop: 80 }} />}
    </Drawer>
  </>
}
