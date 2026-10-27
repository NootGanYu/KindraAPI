import { BrowserWindow } from 'electron'
import type { MqttEvent } from '@shared/mqtt'

/**
 * 将 MQTT 事件推送给所有渲染窗口。
 * smoke 等无窗口场景下 BrowserWindow.getAllWindows() 返回空数组。
 */
export function broadcastMqttEvent(event: MqttEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send('mqtt:event', event)
    } catch {
      // 窗口正在销毁时忽略发送失败，不影响会话。
    }
  }
}
