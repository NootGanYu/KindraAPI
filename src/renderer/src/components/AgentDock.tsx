import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Drawer, Empty } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import { useApp } from '../store'
import AgentConversationPanel from './AgentConversationPanel'
import '../pages/agent.css'

const MIN_RATIO = 0.4
function clampWidth(value: number): number {
  const min = Math.round(window.innerWidth * MIN_RATIO)
  const max = Math.max(min, window.innerWidth - 32)
  return Math.min(max, Math.max(min, value))
}

/** Always-mounted entry point: the main app stays interactive while the panel is open. */
export default function AgentDock(): JSX.Element {
  const project = useApp(state => state.project)
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(() => clampWidth(Math.round(window.innerWidth * MIN_RATIO)))
  useEffect(() => {
    const onResize = (): void => setWidth(current => clampWidth(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  function startDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    document.body.classList.add('agent-resizing')
    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.buttons === 0) { onEnd(); return }
      setWidth(clampWidth(startWidth + startX - moveEvent.clientX))
    }
    const onEnd = (): void => {
      document.body.classList.remove('agent-resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      window.removeEventListener('blur', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    window.addEventListener('blur', onEnd)
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
      width={width}
      mask={false}
      forceRender
      destroyOnClose={false}
      open={open}
      onClose={() => setOpen(false)}
      title={null}
      closable={false}
      styles={{ body: { padding: 0 }, header: { display: 'none' } }}
    >
      <div className="agent-dock-shell">
        <div
          className="agent-dock-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整 Agent 面板宽度"
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(current => clampWidth(current + 24)) }
            if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(current => clampWidth(current - 24)) }
          }}
        />
        {project
          ? <AgentConversationPanel key={project.project_id} projectId={project.project_id} projectName={project.name} open={open} onClose={() => setOpen(false)} />
          : <Empty description="请先选择项目" style={{ marginTop: 80 }} />}
      </div>
    </Drawer>
  </>
}
