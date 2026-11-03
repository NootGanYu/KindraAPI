import { AsyncLocalStorage } from 'node:async_hooks'
import { channel } from 'node:diagnostics_channel'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { ClientHttp2Stream } from 'node:http2'

/** Raw transport completion, before postman-request's close -> synthetic end fallback.
 * Scope subscriptions to the current async execution; concurrent manual requests are untouched.
 * This checks the HTTP parser/stream, so gzip, chunked, HEAD and empty responses need no byte guesses.
 */
const scope = new AsyncLocalStorage<object>()
export async function withTransportIntegrity<T>(operation: () => Promise<T>): Promise<{ value: T; complete: boolean }> {
  const token = {}
  const http: IncomingMessage[] = []
  const http2: ClientHttp2Stream[] = []
  const requestChannel = channel('http.client.request.start')
  const streamChannel = channel('http2.client.stream.created')
  const requestStarted = (message: unknown): void => {
    if (scope.getStore() !== token) return
    const request = (message as { request: ClientRequest }).request
    request.once('response', response => { http.push(response) })
  }
  const streamCreated = (message: unknown): void => {
    if (scope.getStore() !== token) return
    http2.push((message as { stream: ClientHttp2Stream }).stream)
  }
  requestChannel.subscribe(requestStarted); streamChannel.subscribe(streamCreated)
  try {
    const value = await scope.run(token, operation)
    return { value, complete: http.length + http2.length > 0 && http.every(response => response.complete) && http2.every(stream => stream.readableEnded && !stream.aborted && stream.rstCode === 0) }
  } finally {
    requestChannel.unsubscribe(requestStarted); streamChannel.unsubscribe(streamCreated)
  }
}
