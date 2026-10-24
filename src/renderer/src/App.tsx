import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { App as AntApp, Spin } from 'antd'
import { useApp } from './store'
import TopBar from './components/TopBar'
import LeftNav from './components/LeftNav'
import ApisPage from './pages/ApisPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import PlaceholderPage from './pages/PlaceholderPage'
import AutomationPage from './pages/AutomationPage'

function Shell(): JSX.Element {
  return (
    <div className="app-shell">
      <TopBar />
      <div className="shell">
        <LeftNav />
        <div className="main">
          <Routes>
            <Route path="/apis" element={<ApisPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/docs"
              element={
                <PlaceholderPage
                  title="文档"
                  description="分享文档与只读预览将在后续里程碑接入；接口契约可先在「设计」视图查看。"
                />
              }
            />
            <Route
              path="/schemas"
              element={
                <PlaceholderPage
                  title="字典"
                  description="数据模型与字典库将在后续里程碑接入。"
                />
              }
            />
            <Route path="/automation" element={<AutomationPage />} />
            <Route path="*" element={<Navigate to="/apis" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  const [error, setError] = useState('')

  useEffect(() => {
    init().catch((e: Error) => setError(e.message))
  }, [init])

  if (error) {
    return <div style={{ padding: 32, color: '#ff583e' }}>初始化失败：{error}</div>
  }

  if (!ready) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spin tip="正在加载项目…" />
      </div>
    )
  }

  return (
    <AntApp>
      <Shell />
    </AntApp>
  )
}
