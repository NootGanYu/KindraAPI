import type {
  AuthModel,
  BodyModel,
  DataModel,
  DbConnection,
  DictionaryEntry,
  DocSettings,
  Environment,
  Flow,
  FlowAssertion,
  FlowEvent,
  FlowEventType,
  ModelSchema,
  ModelType,
  Param,
  Project,
  RequestModel,
  Target,
  TargetType
} from './types'

let seq = 0

export function createId(prefix = ''): string {
  const time = Date.now().toString(16)
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')
  seq = (seq + 1) % 0xffff
  return `${prefix}${time}${rand}${seq.toString(16).padStart(4, '0')}`
}

export function createParam(partial: Partial<Param> = {}): Param {
  return {
    param_id: createId('p'),
    key: '',
    value: '',
    description: '',
    field_type: 'string',
    is_checked: 1,
    is_system: -1,
    ...partial
  }
}

export function createAuth(): AuthModel {
  return {
    type: 'inherit',
    kv: { key: '', value: '', in: 'header' },
    bearer: { key: '' },
    basic: { username: '', password: '' }
  }
}

export function createBody(): BodyModel {
  return {
    mode: 'none',
    raw: '',
    urlencoded: [],
    formdata: [],
    binary: {},
    json: ''
  }
}

export function createRequest(): RequestModel {
  return {
    auth: createAuth(),
    header: { parameter: [createParam({ key: 'Content-Type', value: 'application/json', is_system: 1 })] },
    query: { parameter: [] },
    restful: { parameter: [] },
    cookie: { parameter: [] },
    body: createBody(),
    pre_tasks: [],
    post_tasks: [],
    pre_script: '',
    test: ''
  }
}

export function createTarget(
  projectId: string,
  parentId: string,
  type: TargetType,
  name?: string
): Target {
  const now = new Date().toISOString()
  const isFolder = type === 'folder'
  return {
    target_id: createId('t'),
    target_type: type,
    parent_id: parentId,
    project_id: projectId,
    name: name || (isFolder ? '新建目录' : '未命名接口'),
    description: '',
    method: isFolder ? '' : 'GET',
    url: '',
    protocol: 'http/1.1',
    server_id: '0',
    sort: 1000,
    status: 1,
    version: 1,
    mark_id: '1',
    tags: [],
    is_exampled: 0,
    request: isFolder ? undefined : createRequest(),
    response: isFolder ? undefined : { example: [] },
    created_at: now,
    updated_at: now
  }
}

export function createProject(name: string): Project {
  const now = new Date().toISOString()
  return {
    project_id: createId(''),
    name,
    intro: '',
    logo: '',
    team_id: '',
    created_at: now,
    updated_at: now
  }
}

export function createEnvironment(projectId: string, name = '默认环境'): Environment {
  const now = new Date().toISOString()
  return {
    env_id: createId('e'),
    project_id: projectId,
    name,
    env_var_list: {},
    server_list: [{ server_id: '1', name: 'default', uri: '', sort: 1000 }],
    sort: 1000,
    is_private: -1,
    created_at: now,
    updated_at: now
  }
}

export function createFlowAssertion(partial: Partial<FlowAssertion> = {}): FlowAssertion {
  return {
    assert_id: createId('as'),
    type: 'status',
    op: 'equals',
    expected: 200,
    ...partial
  }
}

export function createFlowEvent(type: FlowEventType, partial: Partial<FlowEvent> = {}): FlowEvent {
  const base: FlowEvent = {
    event_id: createId('ev'),
    type,
    name:
      type === 'api'
        ? '接口'
        : type === 'request'
          ? '内联请求'
          : type === 'script'
            ? '脚本'
            : type === 'assert'
              ? '断言'
              : type === 'if'
                ? '条件'
                : type === 'wait'
                  ? '等待'
                  : type === 'begin'
                    ? '分组'
                    : '循环',
    enabled: true
  }
  if (type === 'script') base.script = ''
  if (type === 'assert') base.assertions = [createFlowAssertion()]
  if (type === 'if') {
    base.condition = 'env.token !== undefined'
    base.children = []
  }
  if (type === 'wait') base.wait_ms = 500
  if (type === 'begin' || type === 'loop') base.children = []
  if (type === 'loop') base.loop_count = 2
  if (type === 'request') {
    base.method = 'GET'
    base.url = '{{baseUrl}}/'
    base.headers = [{ key: 'Content-Type', value: 'application/json' }]
    base.body = ''
  }
  return { ...base, ...partial }
}

export function createFlow(projectId: string, name = '新建流程', envId = ''): Flow {
  const now = new Date().toISOString()
  return {
    flow_id: createId('f'),
    project_id: projectId,
    name,
    description: '',
    env_id: envId,
    events: [],
    created_at: now,
    updated_at: now
  }
}

export function createDictionaryEntry(
  projectId: string,
  partial: Partial<DictionaryEntry> = {}
): DictionaryEntry {
  const now = new Date().toISOString()
  return {
    id: createId('d'),
    project_id: projectId,
    key: '',
    field_type: 'string',
    description: '',
    remarks: '',
    default_value: '',
    created_at: now,
    updated_at: now,
    ...partial
  }
}

export function createEmptyModelSchema(): ModelSchema {
  return { type: 'object', properties: {}, 'x-schema-orders': [] }
}

export function createDataModel(
  projectId: string,
  parentId: string,
  kind: ModelType = 'model',
  name?: string
): DataModel {
  const now = new Date().toISOString()
  return {
    model_id: createId('m'),
    project_id: projectId,
    parent_id: parentId || '0',
    model_type: kind,
    name: name || (kind === 'folder' ? '新建目录' : '新建数据模型'),
    alias: '',
    sort: 1000,
    version: 1,
    status: 1,
    data: {
      description: '',
      schema: kind === 'model' ? createEmptyModelSchema() : {}
    },
    created_by: '本地',
    updated_by: '本地',
    created_time: now,
    updated_time: now
  }
}

export function createDbConnection(projectId: string, partial: Partial<DbConnection> = {}): DbConnection {
  const now = new Date().toISOString()
  return {
    db_id: createId('db'),
    project_id: projectId,
    name: '新建数据库连接',
    type: 'mysql',
    remarks: '',
    config: {
      default: {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: ''
      }
    },
    ssh: {
      enable: -1,
      host: '',
      port: 22,
      username: '',
      password: '',
      auth_type: 1,
      private_key: '',
      passphrase: ''
    },
    created_at: now,
    updated_at: now,
    ...partial
  }
}

export function createDocSettings(partial: Partial<DocSettings> = {}): DocSettings {
  return {
    password: '',
    expire_days: -1,
    show_request: true,
    show_body: true,
    show_response: true,
    show_headers: true,
    show_scripts: false,
    openapi: false,
    ...partial
  }
}
