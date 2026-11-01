import { useState } from 'react'
import { App, Button, Modal } from 'antd'
import { useApp } from '../store'

export default function TargetSyncGuard(): JSX.Element {
  const conflict = useApp(state => state.saveConflict)
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const deleted = conflict?.snapshot.target === null
  const act = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try { await action() } catch (error) { message.error((error as Error).message) } finally { setBusy(false) }
  }
  return <Modal open={!!conflict} title={deleted ? '接口已被删除' : '接口已更新，保存前请选择'}
    closable={!busy} maskClosable={false} onCancel={() => useApp.setState({ saveConflict: null })} footer={null}>
    <p>{deleted ? '本地内容已保留。可以复制内容或另存为新接口。' : '已保存的接口与你开始编辑时不同。本地内容已保留，覆盖会替换最新定义。'}</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <Button disabled={busy} onClick={() => useApp.setState({ saveConflict: null })}>保留草稿</Button>
      {deleted ? <Button type="primary" loading={busy} onClick={() => conflict && void act(async () => {
        await useApp.getState().saveCopy(conflict.id)
        useApp.getState().closeTab(conflict.id)
      })}>另存为新接口</Button> : <>
        <Button disabled={busy} onClick={() => conflict && void act(() => useApp.getState().loadLatest(conflict.id))}>放弃本地修改，加载最新版</Button>
        <Button danger loading={busy} onClick={() => conflict?.snapshot.revision && void act(() => useApp.getState().saveTarget(conflict.id, conflict.snapshot.revision!))}>确认用本地内容覆盖最新版</Button>
      </>}
    </div>
  </Modal>
}
