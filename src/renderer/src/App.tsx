import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { App as AntApp, Spin } from 'antd'
import { useApp } from './store'
import TopBar from './components/TopBar'
import LeftNav from './components/LeftNav'
import ApisPage from './pages/ApisPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import AutomationPage from './pages/AutomationPage'
import SchemasPage from './pages/SchemasPage'
import DocsPage from './pages/DocsPage'

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
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/schemas" element={<SchemasPage />} />
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
