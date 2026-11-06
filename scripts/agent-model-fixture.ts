import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentProtocol } from '../src/shared/agent'

const fragments = (text: string): string[] => [text.slice(0, 5), ...(text.slice(5).match(/.{1,4}/gu) ?? [])]

/** Loopback provider speaks each wire protocol; contract assertions use the same messages. */
export function decodeModelRequest(req: IncomingMessage, body: any, protocol: AgentProtocol): any {
  assert.equal(req.url, protocol === 'responses' ? '/v1/responses' : '/v1/chat/completions')
  if (protocol === 'chat-completions') return body
  assert.equal(body.store, false)
  assert.equal(body.messages, undefined)
  assert(Array.isArray(body.input))
  const messages = body.input.map((item: any) => {
    if (item.type === 'function_call') {
      assert.equal(typeof item.call_id, 'string')
      return { role: 'assistant', content: '', tool_calls: [{ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } }] }
    }
    if (item.type === 'function_call_output') {
      assert(body.input.some((call: any) => call.type === 'function_call' && call.call_id === item.call_id), 'each output must match its function call_id')
      assert.equal(typeof item.output, 'string')
      return { role: 'tool', tool_call_id: item.call_id, content: item.output }
    }
    assert.notEqual(item.role, 'tool', 'Responses cannot accept Chat tool messages')
    assert.equal(item.tool_calls, undefined, 'Responses cannot accept Chat assistant tool_calls')
    return item
  })
  const tools = body.tools?.map((tool: any) => {
    assert.equal(tool.type, 'function'); assert.equal(tool.function, undefined)
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }
  })
  return { ...body, messages, tools }
}
export function respondModel(res: ServerResponse, protocol: AgentProtocol, streaming: boolean, message: any): void {
  if (protocol === 'chat-completions') {
    if (!streaming) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] })); return }
    res.setHeader('Content-Type', 'text/event-stream')
    for (const [index, call] of (message.tool_calls ?? []).entries()) {
      const half = Math.floor(call.function.arguments.length / 2)
      for (const [part, args] of [call.function.arguments.slice(0, half), call.function.arguments.slice(half)].entries()) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, ...(part === 0 ? { id: call.id, type: 'function' } : {}), function: { ...(part === 0 ? { name: call.function.name } : {}), arguments: args } }] } }] })}\n\n`)
      }
    }
    if (message.content) for (const content of fragments(message.content)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    res.end('data: [DONE]\n\n'); return
  }
  const output = [
    ...(message.content ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message.content }] }] : []),
    ...(message.tool_calls ?? []).map((call: any) => ({ type: 'function_call', id: `item-${call.id}`, call_id: call.id, name: call.function.name, arguments: call.function.arguments }))
  ]
  const response = { status: 'completed', output }
  if (!streaming) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(response)); return }
  res.setHeader('Content-Type', 'text/event-stream')
  for (const [output_index, item] of output.entries()) {
    if (item.type === 'function_call') {
      const half = Math.floor(item.arguments.length / 2)
      const events = [
        { type: 'response.output_item.added', output_index, item: { ...item, arguments: '' } },
        ...[item.arguments.slice(0, half), item.arguments.slice(half)].map(delta => ({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index, delta })),
        { type: 'response.function_call_arguments.done', item_id: item.id, output_index, arguments: item.arguments },
        { type: 'response.output_item.done', output_index, item }
      ]
      for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    } else for (const delta of fragments(message.content)) res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', output_index, delta })}\n\n`)
  }
  res.end(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`)
}
