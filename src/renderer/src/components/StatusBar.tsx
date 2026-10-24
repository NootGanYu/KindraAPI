import { useNavigate } from 'react-router-dom'
import { SettingOutlined } from '@ant-design/icons'
import { useApp } from '../store'

export default function StatusBar(): JSX.Element {
  const navigate = useNavigate()
  const project = useApp((s) => s.project)
  const paths = useApp((s) => s.paths)
  const targets = useApp((s) => s.targets)

  return (
    <div className="app-status">
      <span>本地离线</span>
      <span>接口 {targets.filter((t) => t.target_type === 'api').length}</span>
      <span>目录 {targets.filter((t) => t.target_type === 'folder').length}</span>
      <span style={{ flex: 1 }} />
      <span className="mono" title="项目 ID">
        {project?.project_id ?? '-'}
      </span>
      <span className="mono" title={paths?.projectRoot} style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {paths?.projectRoot}
      </span>
      <span className="status-link" onClick={() => navigate('/settings')}>
        <SettingOutlined /> 设置
      </span>
    </div>
  )
}
