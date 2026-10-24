export type TargetType = 'folder' | 'api'

export type BodyMode = 'none' | 'raw' | 'json' | 'urlencoded' | 'formdata' | 'binary'

export interface Param {
  param_id: string
  key: string
  value: string
  description?: string
  field_type?: string
  is_checked: number
  is_system?: number
  schema?: unknown
}

export type AuthType =
  | 'noauth'
  | 'inherit'
  | 'kv'
  | 'bearer'
  | 'basic'
  | 'digest'
  | 'oauth1'
  | 'oauth2'
  | 'hawk'
  | 'awsv4'
  | 'ntlm'
  | 'jwt'
  | 'asap'
  | 'edgegrid'

export interface AuthModel {
  type: AuthType
  kv?: { key: string; value: string; in: 'header' | 'query' }
  bearer?: { key: string }
  basic?: { username: string; password: string }
  [key: string]: unknown
}

export interface BodyModel {
  mode: BodyMode
  raw?: string
  parameter?: Param[]
  urlencoded?: Param[]
  formdata?: Param[]
  binary?: { file_path?: string; data_url?: string; file_name?: string }
  json?: string
}

export interface RequestModel {
  auth: AuthModel
  header: { parameter: Param[] }
  query: { parameter: Param[] }
  restful: { parameter: Param[] }
  cookie: { parameter: Param[] }
  body: BodyModel
  pre_tasks: unknown[]
  post_tasks: unknown[]
  pre_script?: string
  test?: string
}

export interface ResponseExampleRequest {
  method?: string
  url?: string
  headers?: Param[]
  body?: string
}

export interface ResponseExample {
  example_id: string
  expect?: {
    name?: string
    code?: string | number
    content_type?: string
    is_default?: number
    schema?: unknown
    verify_type?: string
  }
  raw?: string
  raw_parameter?: Param[]
  headers?: Param[]
  cookies?: Param[]
  request?: ResponseExampleRequest
}

export interface ResponseModel {
  example?: ResponseExample[]
}

export interface Target {
  target_id: string
  target_type: TargetType
  parent_id: string
  project_id: string
  name: string
  description?: string
  method?: string
  url?: string
  protocol?: string
  server_id?: string
  sort: number
  status?: number
  version?: number
  mark_id?: string
  tags?: string[]
  is_exampled?: number
  request?: RequestModel
  response?: ResponseModel
  created_at: string
  updated_at: string
}

export interface TargetSummary {
  target_id: string
  target_type: TargetType
  parent_id: string
  name: string
  method?: string
  url?: string
  sort: number
  status?: number
  updated_at: string
}

export interface Project {
  project_id: string
  name: string
  intro: string
  logo?: string
  team_id?: string
  created_at: string
  updated_at: string
}

export interface EnvVar {
  current_value: string
  initial_value: string
  description?: string
  is_checked: number
}

export interface ServerEntry {
  server_id: string
  name: string
  uri: string
  sort?: number
}

export interface Environment {
  env_id: string
  project_id: string
  name: string
  env_var_list: Record<string, EnvVar>
  server_list: ServerEntry[]
  sort?: number
  is_private?: number
  created_at: string
  updated_at: string
}

export interface GlobalVar {
  current_value: string
  initial_value: string
  description?: string
}

export interface GlobalVars {
  project_id: string
  vars: Record<string, GlobalVar>
  updated_at: string
}

export interface AppSettings {
  send_timeout: number
  auto_redirect: number
  max_redirect_time: number
  follow_original_method: number
  ignore_tls: number
  environment_id?: string
}

export interface RequestSnapshot {
  name: string
  project_id: string
  target_id: string
  method: string
  url: string
  headers: Record<string, string>
  querys: Record<string, string>
  paths: Record<string, string>
  cookies: Record<string, string>
  body: unknown
  mode: string
}

export interface ResponseSnapshot {
  code: number
  status: string
  headers: Record<string, string>
  body: string
  body_truncated?: boolean
  mime: { ext: string; mime: string }
  size: number
  response_time: number
  timings: Record<string, number>
  cookies: Array<Record<string, unknown>>
  network?: Record<string, unknown>
}

export interface AssertionResult {
  name: string
  passed: boolean
  skipped?: boolean
  error?: string
}

export interface ConsoleEntry {
  time: number
  level: string
  args: string[]
}

export interface SendRecord {
  record_id: string
  project_id: string
  target_id: string
  target_name: string
  method: string
  url: string
  created_at: number
  status: 'passed' | 'failed'
  request: RequestSnapshot
  response: ResponseSnapshot | null
  assertions: AssertionResult[]
  console: ConsoleEntry[]
  error: { type: string; message: string } | null
}

export interface SendRecordSummary {
  record_id: string
  project_id: string
  target_id: string
  target_name: string
  method: string
  url: string
  created_at: number
  status: 'passed' | 'failed'
  status_code: number | null
  response_time: number | null
}

export interface AppPaths {
  userData: string
  projectRoot: string
  localRoot: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// M2 · Flow automation
// ---------------------------------------------------------------------------

export type FlowEventType = 'api' | 'request' | 'script' | 'assert' | 'if' | 'wait' | 'begin' | 'loop'

export interface FlowRequestInput {
  query?: Record<string, string>
  path?: Record<string, string>
  headers?: Record<string, string>
  cookies?: Record<string, string>
  body?: string
}

export type FlowAssertionType = 'status' | 'json' | 'time' | 'bodyContains'
export type FlowAssertionOp = 'equals' | 'exists' | 'length_gt' | 'contains'

export interface FlowAssertion {
  assert_id: string
  type: FlowAssertionType
  path?: string
  op?: FlowAssertionOp
  expected?: string | number | boolean
}

export interface FlowEvent {
  event_id: string
  type: FlowEventType
  name: string
  enabled: boolean
  /** api event */
  target_id?: string
  input?: FlowRequestInput
  /** request event */
  method?: string
  url?: string
  headers?: Array<{ key: string; value: string }>
  body?: string
  /** script event */
  script?: string
  /** assert event */
  assertions?: FlowAssertion[]
  /** if event */
  condition?: string
  /** wait event */
  wait_ms?: number
  /** loop / begin / if children */
  loop_count?: number
  children?: FlowEvent[]
}

export interface Flow {
  flow_id: string
  project_id: string
  name: string
  description: string
  env_id: string
  events: FlowEvent[]
  created_at: string
  updated_at: string
}

export interface FlowResponseSnapshot {
  code: number
  status: string
  headers: Record<string, string>
  body: string
  size: number
  response_time: number
}

export interface FlowEventResult {
  event_id: string
  name: string
  type: FlowEventType
  status: 'passed' | 'failed' | 'skipped'
  started_at: number
  elapsed_ms: number
  detail?: string
  request?: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
  response?: FlowResponseSnapshot
  assertions?: AssertionResult[]
  error?: string
  children?: FlowEventResult[]
  iteration?: number
}

export interface FlowRun {
  run_id: string
  project_id: string
  flow_id: string
  flow_name: string
  env_id: string
  started_at: number
  finished_at: number
  status: 'passed' | 'failed'
  elapsed_ms: number
  variables: Record<string, string>
  events: FlowEventResult[]
  console: ConsoleEntry[]
}

export interface FlowRunSummary {
  run_id: string
  project_id: string
  flow_id: string
  flow_name: string
  started_at: number
  status: 'passed' | 'failed'
  elapsed_ms: number
  passed: number
  failed: number
  skipped: number
}

// ---------------------------------------------------------------------------
// M3 · MCP
// ---------------------------------------------------------------------------

export interface DebugConfig {
  enabled: boolean
  port: number
}

export interface DebugState extends DebugConfig {
  /** 当前进程实际监听的端口；null 表示未启用 */
  active_port: number | null
}

export interface McpConfig {
  enabled: boolean
  allow_write: boolean
  allow_execute: boolean
  allowed_project_ids: string[]
  host: string
  port: number
  token: string
}

export interface McpToolInfo {
  name: string
  description: string
  requires_write: boolean
  requires_execute: boolean
  input_schema: Record<string, unknown>
}

export interface McpStatus {
  running: boolean
  host: string
  port: number
  error?: string
}

// ---------------------------------------------------------------------------
// Docs · local share
// ---------------------------------------------------------------------------

export type DocScope = 'project' | 'folder' | 'api' | 'custom'

export interface DocSettings {
  /** 空字符串表示公开访问 */
  password: string
  /** -1 永久有效；正数为有效天数 */
  expire_days: number
  show_request: boolean
  show_body: boolean
  show_response: boolean
  show_headers: boolean
  show_scripts: boolean
  openapi: boolean
}

export interface DocTargetSnapshot {
  target_id: string
  target_type: TargetType
  parent_id: string
  name: string
  description?: string
  method?: string
  url?: string
  protocol?: string
  sort: number
  request?: RequestModel
  response?: ResponseModel
}

export interface DocSnapshot {
  project_name: string
  project_intro?: string
  generated_at: string
  targets: DocTargetSnapshot[]
}

export interface DocShare {
  share_id: string
  project_id: string
  name: string
  scope: DocScope
  target_ids: string[]
  settings: DocSettings
  snapshot: DocSnapshot
  created_at: string
  updated_at: string
}

export interface DocShareSummary {
  share_id: string
  project_id: string
  name: string
  scope: DocScope
  type_label: string
  visibility: 'public' | 'password'
  target_count: number
  expire_at: string | null
  expire_label: string
  expired: boolean
  owner: string
  created_at: string
  updated_at: string
}

export interface DocShareInput {
  name: string
  scope: DocScope
  target_ids: string[]
  settings: DocSettings
}

export interface DocServiceConfig {
  enabled: boolean
  port: number
}

export interface DocServiceStatus extends DocServiceConfig {
  running: boolean
  host: string
  base_url: string
  error?: string
  share_count: number
}
