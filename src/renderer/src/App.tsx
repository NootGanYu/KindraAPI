import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { App as AntApp, Spin } from 'antd'
import { connectTargetSync, useApp } from './store'
import TargetSyncGuard from './components/TargetSyncGuard'
import TopBar from './components/TopBar'
import LeftNav from './components/LeftNav'
import ApisPage from './pages/ApisPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import AutomationPage from './pages/AutomationPage'
import SchemasPage from './pages/SchemasPage'
import DocsPage from './pages/DocsPage'
import GitPage from './pages/GitPage'
import MqttPage from './pages/MqttPage'
import AgentPage from './pages/AgentPage'

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
            <Route path="/git" element={<GitPage />} />
            <Route path="/mqtt" element={<MqttPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="*" element={<Navigate to="/apis" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

function QuitGuard(): JSX.Element {
  const { message } = AntApp.useApp()
  const saveTarget = useApp((s) => s.saveTarget)
  const closing = useRef(false)

  useEffect(() => {
    return window.api.app.onRequestClose(() => {
      if (closing.current) return
      closing.current = true
      void (async () => {
        try {
          const dirty = useApp.getState().tabs.filter((tab) => tab.dirty)
          for (const tab of dirty) await saveTarget(tab.id)
          await window.api.app.confirmClose()
        } catch (error) {
          // 保存失败时不退出，避免丢失未保存内容；用户可修正后再次关闭。
          closing.current = false
          message.error(`自动保存失败，窗口保持打开：${(error as Error).message}`)
        }
      })()
    })
  }, [message, saveTarget])

  return <></>
}

export default function App(): JSX.Element {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  const [error, setError] = useState('')

  useEffect(() => {
    const off = connectTargetSync()
    init().catch((e: Error) => setError(e.message))
    return off
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
      <QuitGuard />
      <TargetSyncGuard />
    </AntApp>
  )
}
