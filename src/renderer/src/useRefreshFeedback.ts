import { useRef, useState } from 'react'

/** 刷新按钮旋转反馈：至少展示 minimumMs，避免刷新过快时看不到动效。 */
export function useRefreshFeedback(minimumMs = 600): {
  refreshing: boolean
  run: (task: () => Promise<unknown>) => Promise<void>
} {
  const [refreshing, setRefreshing] = useState(false)
  const active = useRef(false)

  const run = async (task: () => Promise<unknown>): Promise<void> => {
    if (active.current) return
    active.current = true
    setRefreshing(true)
    const started = Date.now()
    try {
      await task()
    } finally {
      const remain = Math.max(0, minimumMs - (Date.now() - started))
      window.setTimeout(() => {
        active.current = false
        setRefreshing(false)
      }, remain)
    }
  }

  return { refreshing, run }
}
