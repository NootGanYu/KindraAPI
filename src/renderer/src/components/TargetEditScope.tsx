import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react'
import { useApp } from '../store'

const TargetEditContext = createContext<string | null>(null)
export function TargetEditScope({ id, children }: { id: string | null; children: ReactNode }): JSX.Element {
  return <TargetEditContext.Provider value={id}>{children}</TargetEditContext.Provider>
}

/** Portal 弹窗也继承上下文；多个本地编辑器独立持锁，取消时释放。 */
export function useTargetEditLock(active: boolean): void {
  const id = useContext(TargetEditContext)
  useLayoutEffect(() => {
    if (!active || !id) return
    useApp.getState().lockEditing(id, 1)
    return () => useApp.getState().lockEditing(id, -1)
  }, [active, id])
}
