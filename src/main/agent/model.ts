import { responsesCompletion } from './responses'
import type { AgentConnection } from '@shared/agent'

export type ModelConnection = AgentConnection & { api_key: string }
export interface ModelToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: ModelToolCall[] }
export interface ModelTool { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ModelReply { text: string; toolCalls: Array<{ id: string; name: string; arguments: string }> }
export function redactKey(text: string, key: string): string {
  return key ? text.split(key).join('[已隐藏]') : text
}

/** Hide a secret prefix until enough bytes arrive to decide whether it is the key. */
export function redactStreamingKey(text: string, key: string): string {
  const redacted = redactKey(text, key)
  for (let length = key.length - 1; length > 0; length--) {
    if (text.endsWith(key.slice(0, length))) return redacted.slice(0, -length)
  }
  return redacted
}

/** Native HTTP boundary: never retries or follows redirects with credentials. */
export async function chatCompletion(
  config: ModelConnection,
  messages: ModelMessage[],
  options: { signal?: AbortSignal; onText?: (text: string) => void; probeTools?: boolean; tools?: ModelTool[]; toolChoice?: 'auto' | 'required' | 'none' } = {}
): Promise<ModelReply> {
  const body: Record<string, unknown> = { model: config.model, messages, stream: !!options.onText }
  if (options.tools) { body.tools = options.tools; body.tool_choice = options.toolChoice ?? 'auto' }
  if (options.probeTools) {
    body.tools = [{ type: 'function', function: { name: 'kindra_capability_probe', description: 'Return the supplied token to confirm function calling. No side effects.', parameters: { type: 'object', properties: { token: { type: 'string', enum: ['kindra-probe'] } }, required: ['token'], additionalProperties: false } } }]
    body.tool_choice = { type: 'function', function: { name: 'kindra_capability_probe' } }
  }
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])])
  let response: Response
  try {
    response = await fetch(`${config.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}) },
      body: JSON.stringify(body)
    })
  } catch { throw new Error(signal.aborted ? '模型请求已取消或超时' : '无法连接模型服务，请检查地址和网络') }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`模型服务返回 HTTP ${response.status}，请检查连接配置`) }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    let value: any
    try { value = await response.json() } catch { throw new Error('模型服务返回了无效 JSON') }
    const message = value.choices?.[0]?.message
    if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) throw new Error('模型服务未返回有效消息')
    const text = typeof message.content === 'string' ? message.content : ''
    options.onText?.(text)
    return { text, toolCalls: (message.tool_calls ?? []).map((call: any) => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments })) }
  }
  if (!response.body) throw new Error('模型返回空响应流')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', text = '', completed = false
  try {
    while (!completed) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      buffer = buffer.replace(/\r\n/g, '\n')
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        if (data === '[DONE]') { completed = true; break }
        let value: any
        try { value = JSON.parse(data) } catch { throw new Error('模型返回无效事件数据') }
        if (value.error) throw new Error('模型响应流失败')
        const delta = value.choices?.[0]?.delta?.content
        if (typeof delta === 'string') { text += delta; options.onText?.(text) }
      }
      if (chunk.done) break
    }
    if (!completed) throw new Error('模型响应流中断，可手动发起新消息')
    return { text, toolCalls: [] }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Explicit protocol selection; never fall back to another endpoint. */
export function completeModel(config: ModelConnection, messages: ModelMessage[], options: Parameters<typeof chatCompletion>[2] = {}): Promise<ModelReply> {
  return config.protocol === 'responses' ? responsesCompletion(config, messages, options) : chatCompletion(config, messages, options)
}
