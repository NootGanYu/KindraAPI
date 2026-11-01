import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { TargetChangeEvent, TargetChangeKind } from '@shared/targetSync'

interface ChangeContext {
  source: TargetChangeEvent['source']
  operationId: string
  projects: Map<string, { targets: Map<string, TargetChangeKind>; modelsChanged: boolean }>
}
const context = new AsyncLocalStorage<ChangeContext>()
const listeners = new Set<(event: TargetChangeEvent) => void>()

export function onTargetChanges(listener: (event: TargetChangeEvent) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function publish(current: ChangeContext): void {
  for (const [projectId, changes] of current.projects) {
    const event: TargetChangeEvent = {
      projectId, changes: [...changes.targets].map(([targetId, kind]) => ({ targetId, kind })),
      modelsChanged: changes.modelsChanged, source: current.source,
      operationId: current.operationId
    }
    for (const listener of listeners) {
      try { listener(event) } catch { /* 通知失败不能把已提交的写入报告为失败。 */ }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.isDestroyed()) win.webContents.send('target:changed', event) } catch { /* 窗口正在关闭。 */ }
    }
  }
  current.projects.clear()
}

export async function withTargetChanges<T>(
  source: TargetChangeEvent['source'], operationId: string | undefined,
  fn: () => T | Promise<T>
): Promise<T> {
  const current: ChangeContext = { source, operationId: operationId || randomUUID(), projects: new Map() }
  return context.run(current, async () => {
    try { return await fn() } finally { publish(current) }
  })
}

export function recordTargetChange(projectId: string, targetId: string, kind: TargetChangeKind): void {
  record(projectId, targetId, kind)
}
export function recordModelChange(projectId: string): void { record(projectId) }

function record(projectId: string, targetId?: string, kind?: TargetChangeKind): void {
  const current: ChangeContext = context.getStore() ?? {
    source: 'system', operationId: randomUUID(), projects: new Map()
  }
  let changes = current.projects.get(projectId)
  if (!changes) {
    changes = { targets: new Map(), modelsChanged: false }
    current.projects.set(projectId, changes)
  }
  if (targetId && kind) {
    if (kind !== 'runtime' || !changes.targets.has(targetId)) changes.targets.set(targetId, kind)
  } else changes.modelsChanged = true
  if (!context.getStore()) publish(current)
}
