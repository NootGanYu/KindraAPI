import { useState } from 'react'
import { App, Button, Dropdown, Input, Modal, Popover, Tooltip } from 'antd'
import { DeleteOutlined, DownOutlined, UnorderedListOutlined } from '@ant-design/icons'
import type { ApiStatus, Target } from '@shared/types'
import { createId } from '@shared/factories'
import { apiStatuses, defaultApiStatus } from '@shared/apiStatuses'
import { stableJson, targetDefinition } from '@shared/targetSync'
import { useApp } from '../store'

const colors = ['#3865f5', '#22cea4', '#ffb401', '#ff583e', '#057bed', '#a66ee8', '#f28248', '#8e8069']
function StatusLabel({ status }: { status: ApiStatus }): JSX.Element {
  return <span className="api-status-label"><i style={{ background: status.color }} />{status.name}</span>
}

export default function ApiStatusControl({ target }: { target: Target }): JSX.Element {
  const { message } = App.useApp()
  const project = useApp(state => state.project)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(colors[0])
  const statuses = apiStatuses(project)
  const defaultId = defaultApiStatus(project)
  const current = statuses.find(status => status.id === target.mark_id) ?? statuses.find(status => status.id === defaultId)!

  const persist = async (next: ApiStatus[], nextDefault = defaultId): Promise<boolean> => {
    if (!project || busy) return false
    setBusy(true)
    try {
      const result = await window.api.projects.saveApiStatuses(project.project_id, next, nextDefault)
      if (!result.ok) throw Error(result.error)
      if (useApp.getState().project?.project_id !== project.project_id) return false
      const removed = new Set(statuses.filter(status => !next.some(item => item.id === status.id)).map(status => status.id))
      const ids = useApp.getState().tabs.filter(tab => removed.has(useApp.getState().baselines[tab.id]?.target?.mark_id ?? '')).map(tab => tab.id)
      const snapshots = await Promise.all(ids.map(async id => ({ id, result: await window.api.targets.read(project.project_id, id) })))
      useApp.setState(state => {
        if (state.project?.project_id !== project.project_id) return {}
        const drafts = { ...state.drafts }, baselines = { ...state.baselines }, pendingUpdates = { ...state.pendingUpdates }
        const refreshed = new Set<string>()
        for (const { id, result } of snapshots) {
          if (!result.ok || !result.data.target || !drafts[id] || !baselines[id]?.target) continue
          const saved = result.data.target, baseline = baselines[id].target!
          // 仅合并本次状态迁移；同时出现其他外部修改时，保留现有并发冲突处理。
          if (stableJson(targetDefinition({ ...baseline, mark_id: saved.mark_id })) !== stableJson(targetDefinition(saved))) continue
          if (removed.has(drafts[id].mark_id ?? '')) drafts[id] = { ...drafts[id], mark_id: nextDefault }
          baselines[id] = result.data
          if (pendingUpdates[id]?.revision === result.data.revision) delete pendingUpdates[id]
          refreshed.add(id)
        }
        for (const [id, draft] of Object.entries(drafts)) if (removed.has(draft.mark_id ?? '')) drafts[id] = { ...draft, mark_id: nextDefault }
        return { project: result.data, projects: state.projects.map(item => item.project_id === project.project_id ? result.data : item), drafts, baselines, pendingUpdates,
          tabs: state.tabs.map(tab => refreshed.has(tab.id) ? { ...tab, dirty: stableJson(targetDefinition(drafts[tab.id])) !== stableJson(targetDefinition(baselines[tab.id].target!)), externalSource: undefined, syncError: undefined } : tab) }
      })
      return true
    } catch (error) { message.error((error as Error).message); return false }
    finally { setBusy(false) }
  }
  const add = async (): Promise<void> => {
    if (!name.trim() || statuses.some(status => status.name === name.trim())) { message.error('请输入不重复的状态名称'); return }
    if (await persist([...statuses, { id: createId('status'), name: name.trim(), color }])) { setAdding(false); setName('') }
  }
  return <>
    <Dropdown overlayClassName="api-status-dropdown" trigger={['click']} menu={{ selectedKeys: [current.id], items: [
      ...statuses.map(status => ({ key: status.id, label: <StatusLabel status={status} /> })),
      { type: 'divider' }, { key: 'manage', label: '接口状态管理', icon: <UnorderedListOutlined aria-hidden /> }
    ], onClick: ({ key }) => {
      if (key === 'manage') { setAdding(false); setOpen(true) }
      else useApp.getState().patchDraft(target.target_id, { mark_id: key })
    } }}>
      <button className="dev-state" aria-label="接口状态"><StatusLabel status={current} /><DownOutlined style={{ fontSize: 9 }} /></button>
    </Dropdown>
    <Modal title="接口状态" open={open} width={880} closable={false} onCancel={() => setOpen(false)}
      footer={<Button onClick={() => setOpen(false)} disabled={busy}>关闭</Button>} className="api-status-modal">
      <Button className="api-status-create" type="primary" size="small" disabled={adding || busy} onClick={() => { setName(''); setColor(colors[0]); setAdding(true) }}>新建</Button>
      <div className="api-status-help">1、设为默认状态后，新创建的接口开发状态会展示为该默认状态<br />2、设为默认状态则不支持删除<br />3、删除任意状态，正在使用该状态的接口会变为默认状态</div>
      <table className="api-status-table"><thead><tr><th>接口状态</th><th>操作</th></tr></thead><tbody>
        {statuses.map(status => <tr key={status.id}><td><StatusLabel status={status} />
          <button className={`api-status-default${status.id === defaultId ? ' selected' : ''}`} disabled={busy || status.id === defaultId} aria-label={`设为默认 ${status.name}`} onClick={() => void persist(statuses, status.id)}>默认</button>
        </td><td><Tooltip title={status.id === defaultId ? '默认状态不能删除' : '删除状态'}><button aria-label={`删除状态 ${status.name}`} disabled={busy || status.id === defaultId} onClick={() => void persist(statuses.filter(item => item.id !== status.id))}><DeleteOutlined /></button></Tooltip></td></tr>)}
        {adding && <tr><td className="api-status-new"><Popover trigger="click" content={<div className="api-status-colors">{colors.map(value => <button key={value} aria-label={`状态颜色 ${value}`} style={{ background: value }} onClick={() => setColor(value)} />)}</div>}><button className="api-status-color" aria-label="新状态颜色" style={{ background: color }} /></Popover>
          <Input autoFocus placeholder="状态名称" value={name} onChange={event => setName(event.target.value)} onPressEnter={() => void add()} maxLength={30} />
        </td><td><Button type="link" size="small" loading={busy} onClick={() => void add()}>保存</Button><button aria-label="取消新建状态" disabled={busy} onClick={() => setAdding(false)}><DeleteOutlined /></button></td></tr>}
      </tbody></table>
    </Modal>
  </>
}
