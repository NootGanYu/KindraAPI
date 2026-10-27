import { useEffect, useRef } from 'react'
import type { Result } from '@shared/types'
import type {
  MqttEvent,
  MqttPayloadView,
  MqttSessionStateName
} from '@shared/mqtt'
import { renderPayload } from '@shared/mqtt'

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 订阅主进程 MQTT 事件。key 变化（切换连接 / 项目）时重新订阅并清理。
 * handler 通过 ref 保存，避免每次渲染重新注册。
 */
export function useMqttEvent(
  key: string | null,
  handler: (event: MqttEvent) => void
): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!key) return
    const off = window.api.mqtt.onEvent((event) => ref.current(event))
    return off
  }, [key])
}

export type MqttStatusTone =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'

export function statusTone(state?: MqttSessionStateName | null): MqttStatusTone {
  if (!state) return 'idle'
  if (state === 'connected') return 'connected'
  if (state === 'connecting') return 'connecting'
  if (state === 'reconnecting') return 'reconnecting'
  return 'closed'
}

export function statusLabel(state?: MqttSessionStateName | null): string {
  switch (state) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'reconnecting':
      return '重连中'
    case 'closed':
      return '已断开'
    default:
      return '未连接'
  }
}

export function formatTime(value?: string | null, withDate = false): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (input: number): string => String(input).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  if (!withDate) return time
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

export function formatDateTime(value?: string | null): string {
  return formatTime(value, true)
}

export function formatBytes(value?: number | null): string {
  if (value === undefined || value === null) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

export function formatQos(qos: number): string {
  return `QoS ${qos}`
}

export const PAYLOAD_VIEW_OPTIONS: Array<{ value: MqttPayloadView; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'plain', label: 'Plain' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' }
]

export function previewPayload(
  preview: string,
  encoding: 'utf8' | 'base64',
  view: MqttPayloadView
): string {
  try {
    const rendered = renderPayload(
      { payload: preview, payload_encoding: encoding },
      view
    )
    return rendered.length > 600 ? `${rendered.slice(0, 600)}…` : rendered
  } catch {
    // 摘要可能是被截断的 base64，无法解码时退回原始预览。
    return preview
  }
}

export async function copyText(text: string): Promise<void> {
  const result = await window.api.app.copyText(text)
  if (!result.ok) throw new Error(result.error)
}

export function protocolLabel(version: number): string {
  return version === 4 ? 'MQTT 3.1.1' : 'MQTT 5.0'
}
