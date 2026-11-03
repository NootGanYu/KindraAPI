import runtimePackage from 'postman-runtime/package.json'
import type { Param } from './types'

/** Headers supplied by the installed runtime when the request has no override. */
export const runtimeDefaultHeaders: Param[] = [
  ['Accept', '*/*'],
  ['Accept-Encoding', 'gzip, deflate, br'],
  ['User-Agent', `PostmanRuntime/${runtimePackage.version}`],
  ['Connection', 'keep-alive']
].map(([key, value]) => ({ param_id: `runtime-${key}`, key, value, field_type: 'string', is_checked: 1 }))
