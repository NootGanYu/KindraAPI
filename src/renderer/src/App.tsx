import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { App as AntApp, Button, Modal, Spin } from 'antd'
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
  const dirtyCount = useApp(
    (s) => s.tabs.filter((tab) => tab.dirty).length
  )
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    return window.api.app.onRequestClose(() => {
      const dirty = useApp.getState().tabs.filter((tab) => tab.dirty)
      if (dirty.length === 0) {
        void window.api.app.confirmClose()
        return
      }
      setOpen(true)
    })
  }, [])

  const saveAndClose = async (): Promise<void> => {
    setSaving(true)
    try {
      const dirty = useApp.getState().tabs.filter((tab) => tab.dirty)
      for (const tab of dirty) await saveTarget(tab.id)
      await window.api.app.confirmClose()
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="放弃未保存的修改？"
      closable={false}
      maskClosable={false}
      footer={null}
    >
      <p>
        {dirtyCount > 1
          ? `有 ${dirtyCount} 个标签页存在未保存的修改，关闭后将丢失。`
          : '该标签页有未保存的修改，关闭后将丢失。'}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button
          style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }}
          loading={saving}
          onClick={() => void saveAndClose()}
        >
          保存后关闭
        </Button>
        <Button onClick={() => setOpen(false)}>取消</Button>
        <Button
          danger
          onClick={() => {
            void window.api.app.confirmClose()
          }}
        >
          放弃并关闭
        </Button>
      </div>
    </Modal>
  )
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
