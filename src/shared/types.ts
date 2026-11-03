export type TargetType = 'folder' | 'api'

export type BodyMode = 'none' | 'raw' | 'json' | 'urlencoded' | 'formdata' | 'binary'

export interface FieldRules {
  required?: boolean
  nullable?: boolean
  description?: string
  /** null 明确表示没有枚举限制；未提供表示待补充。 */
  enum?: unknown[] | null
  enum_descriptions?: string[]
  default?: unknown
  example?: unknown
}

export interface Param extends FieldRules {
  param_id: string
  key: string
  value: string
  description?: string
  field_type?: string
  is_checked: number
  is_system?: number
  /** 当前接口对继承参数的禁用覆盖，不作为自定义参数行展示。 */
  inherited_override?: boolean
  schema?: unknown
  /** form-data 文件行的大小（字节），仅用于展示 */
  file_size?: number
  /** multipart/form-data 单个参数的 MIME 类型；缺省时自动推断。 */
  content_type?: string
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

export type JsonFieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'
  | 'unknown'

/**
 * JSON 请求体的字段文档。pointer 使用内部 JSON Pointer，数组任意下标记为 `*`。
 * 值与原始结构仍以 body.raw 为准，这里只保存无法从 JSON 推导的信息。
 */
export interface FieldDoc extends FieldRules {
  pointer: string
  /** 同级字段的显示顺序；未设置时沿用示例/定义中的顺序。 */
  order?: number
  type?: JsonFieldType
  required?: boolean
  description?: string
  /** 设计页 Mock 值，仅用于生成示例，不参与真实发送 */
  mock?: string
  /** 用户显式新增、raw 中可能不存在的仅文档行 */
  doc_only?: boolean
  source?: 'manual' | 'openapi'
}

export type RawBodyLanguage = 'json' | 'xml' | 'text' | 'html' | 'javascript'

export interface BodyModel {
  mode: BodyMode
  raw?: string
  /** raw 子格式，仅用于设计/编辑展示 */
  raw_language?: RawBodyLanguage
  parameter?: Param[]
  urlencoded?: Param[]
  formdata?: Param[]
  binary?: { file_path?: string; data_url?: string; file_name?: string }
  json?: string
  /** JSON 请求体的字段说明 sidecar */
  field_docs?: FieldDoc[]
  /** 引用数据模型；存在时 raw 仅作为最近一次生成结果 */
  model_id?: string
}

export interface RequestModel {
  auth: AuthModel
  header: { parameter: Param[] }
  query: { parameter: Param[]; omit_empty_equals?: boolean }
  restful: { parameter: Param[] }
  cookie: { parameter: Param[] }
  body: BodyModel
  pre_tasks: unknown[]
  post_tasks: unknown[]
  pre_script?: string
  test?: string
  pre_script_enabled?: boolean
  test_enabled?: boolean
}

export interface ResponseExampleRequest {
  body_mode?: string
  method?: string
  url?: string
  headers?: Param[]
  body?: string
}

export interface ResponseExample {
  example_id: string
  /** 成功响应字段定义，独立于 raw 示例保存。 */
  field_docs?: FieldDoc[]
  expect?: {
    name?: string
    code?: string | number
    content_type?: string
    is_default?: number
    schema?: unknown
    verify_type?: string
    /** 设计期望的返回延迟，单位 ms；不修改实际请求的响应耗时。 */
    sleep?: number
    /** 引用数据模型；存在时 raw 仅作为最近一次生成结果 */
    model_id?: string
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

export interface DesignError {
  code: string
  message: string
  description?: string
}

export interface DesignModel {
  errors?: DesignError[]
}

export type CaseAssertionKind = 'status' | 'duration' | 'json'
export type CaseAssertionOp = 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'lt'

export interface CaseAssertion {
  assertion_id: string
  kind: CaseAssertionKind
  op: CaseAssertionOp
  /** JSONPath 子集，如 $.data.items[0].id；kind=json 时使用 */
  path?: string
  /** equals / not_equals / contains / gt / lt 使用；exists 忽略 */
  expected?: string
  is_enabled: number
}

export interface ApiCaseOverride {
  method?: string
  url?: string
  headers?: Param[]
  query?: Param[]
  restful?: Param[]
  body_mode?: BodyMode
  body?: string
  formdata?: Param[]
  urlencoded?: Param[]
}

export interface CaseRunAssertion {
  assertion_id: string
  passed: boolean
  actual?: string
  message?: string
}

export interface CaseRunResult {
  ran_at: string
  status: 'passed' | 'failed' | 'error'
  http_status?: number
  duration_ms?: number
  error?: string
  assertions?: CaseRunAssertion[]
}

export interface ApiCase {
  case_id: string
  name: string
  description?: string
  is_enabled: number
  override: ApiCaseOverride
  assertions: CaseAssertion[]
  last_run?: CaseRunResult
}

export interface CaseRunSummary {
  total: number
  passed: number
  failed: number
  error: number
  results: Array<{ case_id: string; result: CaseRunResult }>
}

export interface Target {
  /** 编码 Agent 提供的项目内稳定标识，用于重复写入。 */
  source_key?: string
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
  design?: DesignModel
  cases?: ApiCase[]
  /** 项目自定义属性值：attribute_id → 值 */
  custom_attributes?: Record<string, string | number | string[] | null>
  created_at: string
  updated_at: string
}

export interface TargetSummary {
  target_id: string
  target_type: TargetType
  parent_id: string
  name: string
  description?: string
  method?: string
  url?: string
  sort: number
  status?: number
  updated_at: string
}

export type CustomAttributeType = 'text' | 'number' | 'radio' | 'checkbox' | 'date' | 'link' | 'email'

export interface CustomAttributeOption {
  key: string
  label: string
  value: string
}

/** 项目级自定义属性，用于给接口补充业务字段（负责人、优先级等）。 */
export interface CustomAttribute {
  attribute_id: string
  project_id: string
  field_name: string
  field_type: CustomAttributeType
  enable: boolean
  /** 单选 / 多选的候选值 */
  extra: CustomAttributeOption[]
  sort: number
  created_at: string
  updated_at: string
}

export interface ApiStatus {
  id: string
  name: string
  color: string
}

export interface Project {
  project_id: string
  name: string
  intro: string
  logo?: string
  team_id?: string
  created_at: string
  updated_at: string
  /** 系统内置描述总开关：1 开启，-1 关闭 */
  is_describe_library?: number
  /** 项目自定义属性定义 */
  custom_attributes?: CustomAttribute[]
  api_statuses?: ApiStatus[]
  default_api_status_id?: string
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
  /** 截断上限内的原始字节，用于切换编码、图片预览和下载。 */
  body_base64?: string
  charset?: string
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
  /** Stable legacy step identity and full-step pause boundary. */
  step_id?: string
  logical_step_id?: string
  /** Omitted: conservative sequence. Empty array: explicitly independent. References event IDs. */
  depends_on?: string[]
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
  /** Content signature returned by storage; required for checked updates. */
  revision?: string
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
  status: 'running' | 'passed' | 'failed' | 'skipped' | 'blocked'
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

export interface FlowFileDependency {
  path: string
  sha256: string | null
}

export interface FlowExecutionSnapshot {
  flow_revision: string
  captured_at: number
  environment_id: string
  requests: Array<{ event_id: string; target_id: string; revision: string; files: FlowFileDependency[] }>
}
export type FlowRunStatus = 'running' | 'pausing' | 'paused' | 'passed' | 'failed' | 'interrupted' | 'unknown' | 'blocked'

export interface FlowRun {
  snapshot?: FlowExecutionSnapshot
  run_id: string
  project_id: string
  flow_id: string
  flow_name: string
  env_id: string
  started_at: number
  finished_at: number
  status: FlowRunStatus
  elapsed_ms: number
  variables: Record<string, string>
  events: FlowEventResult[]
  console: ConsoleEntry[]
  request_in_flight?: boolean
  remote_outcome?: 'unknown'
  request_id?: string
  request_environment_id?: string
  source?: 'ui' | 'mcp'
  error?: string
}

export interface FlowRunSummary {
  run_id: string
  project_id: string
  flow_id: string
  flow_name: string
  started_at: number
  status: FlowRunStatus
  elapsed_ms: number
  passed: number
  failed: number
  skipped: number
  blocked?: number
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
// Data dictionary
// ---------------------------------------------------------------------------

export const DICT_FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null', 'any', 'allOf', 'anyOf', 'oneOf'] as const
export type DictFieldType = typeof DICT_FIELD_TYPES[number]

export interface DictionaryEntry {
  id: string
  project_id: string
  key: string
  field_type: DictFieldType
  description: string
  remarks?: string
  default_value?: string
  example_value?: string
  mock?: string
  temporary?: boolean
  schema?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface DictionaryEntryView extends DictionaryEntry {
  source: 'builtin' | 'custom'
}

export interface DictionarySettings {
  builtin_enabled: boolean
}

// ---------------------------------------------------------------------------
// Data models
// ---------------------------------------------------------------------------

export type ModelType = 'model' | 'folder'

export interface ModelSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, ModelSchema>
  items?: ModelSchema
  required?: string[]
  default?: unknown
  enum?: unknown[]
  description?: string
  example?: unknown
  $ref?: string
  'x-schema-orders'?: string[]
  'x-nullable'?: boolean
  [key: string]: unknown
}

export interface DataModel {
  model_id: string
  project_id: string
  parent_id: string
  model_type: ModelType
  name: string
  alias?: string
  sort: number
  version: number
  status: number
  data: {
    description: string
    schema: ModelSchema
  }
  created_by?: string
  updated_by?: string
  created_time: string
  updated_time: string
}

export interface ModelSummary {
  model_id: string
  parent_id: string
  model_type: ModelType
  name: string
  alias?: string
  sort: number
  created_by?: string
  created_time: string
  updated_by?: string
  updated_time: string
}

export type ModelReferenceKind = 'request-body' | 'response-example'

export interface ModelReference {
  target_id: string
  target_name: string
  method?: string
  kind: ModelReferenceKind
  example_id?: string
}

export interface GeneratedExampleResult {
  value: unknown
  warnings: Array<{
    code: 'cycle' | 'missing-model' | 'invalid-ref' | 'depth-limit'
    message: string
    ref?: string
    path?: string
  }>
}

// ---------------------------------------------------------------------------
// Database connections
// ---------------------------------------------------------------------------

export interface DbDefaultConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  charset?: string
}

export interface DbSshConfig {
  enable: -1 | 1
  host: string
  port: number
  username: string
  password: string
  auth_type: 1 | 2 | 3
  private_key: string
  passphrase: string
}

export interface DbConnection {
  db_id: string
  project_id: string
  name: string
  type: 'mysql'
  remarks: string
  config: { default: DbDefaultConfig }
  ssh: DbSshConfig
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Docs · local share
// ---------------------------------------------------------------------------

export type DocScope = 'project' | 'folder' | 'api' | 'custom'

/** 文档分享导出的 OpenAPI 规范版本 */
export type OpenApiVersion = '3.1' | '3.0' | '2.0'

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
  show_design: boolean
  show_cases: boolean
  openapi: boolean
  /** OpenAPI 导出规范版本；默认 3.0，保持既有输出兼容 */
  openapi_version: OpenApiVersion
  /** 分享页 Logo，data URL；空字符串使用内置图标 */
  logo: string
  /** 文档展示环境；非空时 {{变量}} 按该环境取值替换 */
  env_id: string
  /** 分享页展示的自定义属性 ID；空数组不展示 */
  attribute_list: string[]
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

export type DbConnectionView = Omit<DbConnection, 'config' | 'ssh'> & {
  config: { default: Omit<DbDefaultConfig, 'password'> & { has_password: boolean } }
  ssh: Omit<DbSshConfig, 'password' | 'private_key' | 'passphrase'> & {
    has_password: boolean
    has_private_key: boolean
    has_passphrase: boolean
  }
}

export interface DbTable {
  name: string
  comment: string
  columns: DbColumnInfo[]
}

export interface DbColumnInfo {
  name: string
  data_type: string
  column_type: string
  is_nullable: boolean
  default_value: string | null
  comment: string
  extra: string
}

export type ImportConflictStrategy = 'update' | 'skip' | 'copy'

export interface ImportDbOptions {
  tables: string[]
  target_parent_id?: string
  conflict?: ImportConflictStrategy
}

export interface ImportDbTableResult {
  table: string
  status: 'created' | 'updated' | 'skipped' | 'copied' | 'failed'
  model_id?: string
  model_name?: string
  message?: string
}

export interface ImportDbResult {
  items: ImportDbTableResult[]
  created: number
  updated: number
  skipped: number
  copied: number
  failed: number
  warnings: string[]
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

// Git
// ---------------------------------------------------------------------------

export interface GitAvailability {
  available: boolean
  version?: string
  error?: string
}

export interface GitRemote {
  name: string
  fetch_url: string
  push_url: string
}

export interface GitRepoInfo {
  is_repo: boolean
  root: string | null
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  remotes: GitRemote[]
}

export type GitFileKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'typechange'

export interface GitFileChange {
  path: string
  old_path?: string
  /** porcelain 第一列：暂存区状态 */
  index_status: string
  /** porcelain 第二列：工作区状态 */
  worktree_status: string
  kind: GitFileKind
}

export interface GitStatus {
  is_repo: boolean
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileChange[]
}

export interface GitCommit {
  hash: string
  short_hash: string
  author: string
  email: string
  date: string
  subject: string
  refs: string
}

export interface GitBranch {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
}

export interface GitDiffResult {
  diff: string
  truncated: boolean
}

export interface GitOperationResult {
  message: string
  output: string
}

export interface GitDiffRequest {
  path: string
  staged: boolean
  untracked: boolean
}

export interface GitDiscardTarget {
  path: string
  untracked: boolean
}

export interface GitPullOptions {
  remote?: string
  branch?: string
  rebase?: boolean
}

export interface GitPushOptions {
  remote?: string
  branch?: string
  set_upstream?: boolean
}

// ---------------------------------------------------------------------------
// API 版本历史 / Cookie 管理器 / 代码生成
// ---------------------------------------------------------------------------

export interface TargetVersion {
  version_id: string
  version: number
  created_at: string
  label?: string
  tagged_at?: string
  /** 内容签名，用于避免相同内容重复记录 */
  signature: string
  snapshot: Target
}

export interface TargetVersionSummary {
  version_id: string
  version: number
  created_at: string
  label?: string
  tagged_at?: string
  method?: string
  url?: string
  name?: string
}

export interface CookieDomain {
  domain: string
  /** document.cookie 形式：a=1; b=2 */
  cookies: string
  updated_at: string
}

export interface CookieJar {
  project_id: string
  enabled: boolean
  domains: CookieDomain[]
  updated_at: string
}

export interface CurlResult {
  script: string
  warnings: string[]
}
