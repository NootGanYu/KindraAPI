import { connectAgentDraftSync, flushAgentDrafts } from './agentDraftSync'
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
  const { message, modal } = AntApp.useApp()
  const closing = useRef(false)

  useEffect(() => {
    return window.api.app.onRequestClose(() => {
      if (closing.current) return
      closing.current = true
      void (async () => {
        try {
          await flushAgentDrafts()
          const activity = await window.api.agent.getActivity()
          if (!activity.ok) throw new Error(activity.error)
          if (activity.data.running) {
            const confirmed = await new Promise<boolean>(resolve => modal.confirm({ title: '退出将停止 Agent 任务', content: `当前有 ${activity.data.running} 个 Agent 任务。退出仅暂存 Agent 草稿，不保存定义；重启不会自动重放请求。`, okText: '停止并退出', cancelText: '继续工作', onOk: () => resolve(true), onCancel: () => resolve(false) }))
            if (!confirmed) { await window.api.app.cancelClose(); closing.current = false; return }
          }
          const prepared = await window.api.agent.prepareQuit()
          if (!prepared.ok) throw new Error(prepared.error)
          await flushAgentDrafts()
          const state = useApp.getState()
          for (const tab of state.tabs.filter(tab => tab.dirty)) {
            if (!state.project || !state.drafts[tab.id]) continue
            const saved = await window.api.agent.saveManualDraftOnQuit(state.project.project_id, state.drafts[tab.id], state.baselines[tab.id]?.revision ?? '')
            if (!saved.ok) throw new Error(saved.error)
          }
          await window.api.app.confirmClose()
        } catch (error) {
          // 保存失败时不退出，避免丢失未保存内容；用户可修正后再次关闭。
          await window.api.app.cancelClose()
          closing.current = false
          message.error(`自动保存失败，窗口保持打开：${(error as Error).message}`)
        }
      })()
    })
  }, [message, modal])

  return <></>
}

export default function App(): JSX.Element {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  const [error, setError] = useState('')

  useEffect(() => {
    const off = connectTargetSync()
    const offAgent = connectAgentDraftSync()
    init().catch((e: Error) => setError(e.message))
    return () => { off(); offAgent() }
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
