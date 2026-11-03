import { onFlowDraftEvent } from './flowDrafts'
import { onDraftEvent } from './drafts'
import { onPlanEvent } from './plans'
import { BrowserWindow, ipcMain } from 'electron'
import { agentCommands, onAgentEvent } from './service'

let offFlowDrafts: (() => void) | undefined
let offDrafts: (() => void) | undefined
let offPlans: (() => void) | undefined
let off: (() => void) | undefined
export function registerAgentIpc(): void {
  for (const [name, command] of Object.entries(agentCommands)) {
    const channel = `agent:${name}`
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, ...args) => {
      try { return { ok: true, data: await (command as (...args: any[]) => unknown)(...args) } }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Agent 操作失败' } }
    })
  }
  offFlowDrafts?.()
  offFlowDrafts = onFlowDraftEvent(event => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agent:flow-draft-changed', event)
  })
  offDrafts?.()
  offDrafts = onDraftEvent(event => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agent:draft-changed', event)
  })
  offPlans?.()
  offPlans = onPlanEvent(event => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agent:plan-changed', event)
  })
  off?.()
  off = onAgentEvent(event => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agent:changed', event)
  })
}
