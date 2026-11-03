import type { ModelConnection, ModelMessage, ModelReply } from './model'

type ResponseOutput = { type: string; call_id?: string; id?: string; content?: Array<{ type: string; text?: string; refusal?: string }>; name?: string; arguments?: string }
type ResponsePayload = { status?: string; error?: unknown; output?: ResponseOutput[] }

function completedReply(value: ResponsePayload): ModelReply {
  if (!value || typeof value !== 'object') throw new Error('模型服务未返回有效 Responses 消息')
  if (value.error || value.status === 'failed') throw new Error('模型响应失败')
  if (value.status === 'incomplete') throw new Error('模型回复未完成，请检查输出限制后手动继续')
  if (value.status !== 'completed' || !Array.isArray(value.output)) throw new Error('模型服务未返回完整的 Responses 消息')
  const text = value.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []).map(part => part.type === 'output_text' ? part.text ?? '' : part.type === 'refusal' ? part.refusal ?? '' : '').join('')
  return { text, toolCalls: value.output.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id ?? item.id ?? '', name: item.name ?? '', arguments: item.arguments ?? '' })) }
}

/** Responses uses semantic SSE events and a response.completed terminal event. */
export async function responsesCompletion(
  config: ModelConnection,
  messages: ModelMessage[],
  options: { signal?: AbortSignal; onText?: (text: string) => void; probeTools?: boolean } = {}
): Promise<ModelReply> {
  const body: Record<string, unknown> = { model: config.model, input: messages, stream: !!options.onText, store: false }
  if (options.probeTools) {
    body.tools = [{ type: 'function', name: 'kindra_capability_probe', description: 'Return the supplied token to confirm function calling. No side effects.', parameters: { type: 'object', properties: { token: { type: 'string', enum: ['kindra-probe'] } }, required: ['token'], additionalProperties: false }, strict: true }]
    body.tool_choice = { type: 'function', name: 'kindra_capability_probe' }
  }
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])])
  let response: Response
  try {
    response = await fetch(`${config.base_url.replace(/\/$/, '')}/responses`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}) },
      body: JSON.stringify(body)
    })
  } catch { throw new Error(signal.aborted ? '模型请求已取消或超时' : '无法连接模型服务，请检查地址和网络') }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`模型服务返回 HTTP ${response.status}，请检查连接配置`) }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    let value: ResponsePayload
    try { value = await response.json() as ResponsePayload } catch { throw new Error('模型服务返回了无效 JSON') }
    const reply = completedReply(value)
    options.onText?.(reply.text)
    return reply
  }
  if (!response.body) throw new Error('模型返回空响应流')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      buffer = buffer.replace(/\r\n/g, '\n')
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        let value: { type?: string; delta?: string; response?: ResponsePayload }
        try { value = JSON.parse(data) } catch { throw new Error('模型返回无效事件数据') }
        if (value.type === 'error' || value.type === 'response.failed') throw new Error('模型响应流失败')
        if (value.type === 'response.incomplete') throw new Error('模型回复未完成，请检查输出限制后手动继续')
        if (value.type === 'response.output_text.delta' || value.type === 'response.refusal.delta') {
          if (typeof value.delta !== 'string') throw new Error('模型返回无效文本事件')
          text += value.delta; options.onText?.(text)
        }
        if (value.type === 'response.completed') {
          const reply = completedReply(value.response ?? {})
          options.onText?.(reply.text)
          return reply
        }
      }
      if (chunk.done) throw new Error('模型响应流中断，可手动发起新消息')
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
