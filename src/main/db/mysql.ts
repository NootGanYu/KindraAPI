import mysql from 'mysql2/promise'
import type {
  DbColumnInfo,
  DbDefaultConfig,
  DbSshConfig,
  DbTable,
  ImportDbOptions,
  ImportDbResult,
  ImportDbTableResult,
  ModelSchema
} from '@shared/types'
import * as store from '../storage/store'

export const SSH_NOT_SUPPORTED_MESSAGE =
  'SSH 隧道后续支持：当前版本只保存 SSH 配置，测试连接与导入仅走直连'

const CONNECT_TIMEOUT = 8000

function assertDirect(ssh?: DbSshConfig | null): void {
  if (ssh?.enable === 1) throw new Error(SSH_NOT_SUPPORTED_MESSAGE)
}

export function readableDbError(error: unknown): string {
  const err = error as { code?: string; message?: string; errno?: number }
  const code = err?.code ?? ''
  switch (code) {
    case 'ER_ACCESS_DENIED_ERROR':
      return '认证失败：用户名或密码错误'
    case 'ECONNREFUSED':
      return `无法连接数据库：${err?.message ?? '连接被拒绝'}`
    case 'ETIMEDOUT':
    case 'PROTOCOL_SEQUENCE_TIMEOUT':
      return '连接超时（8 秒），请检查地址、端口与网络'
    case 'ENOTFOUND':
      return '主机不存在，请检查数据库地址'
    case 'ER_BAD_DB_ERROR':
      return '数据库不存在，请检查数据库名'
    case 'ER_NOT_SUPPORTED_AUTH_MODE':
      return '数据库认证方式不受支持，请检查 MySQL 用户配置'
    default:
      return err?.message ? `连接失败：${err.message}` : '连接失败'
  }
}

function connectionOptions(config: DbDefaultConfig): mysql.ConnectionOptions {
  return {
    host: String(config.host ?? '').trim(),
    port: Number(config.port) || 3306,
    user: String(config.user ?? ''),
    password: String(config.password ?? ''),
    database: config.database ? String(config.database) : undefined,
    charset: config.charset || 'utf8mb4',
    connectTimeout: CONNECT_TIMEOUT,
    multipleStatements: false
  }
}

async function withConnection<T>(
  config: DbDefaultConfig,
  fn: (connection: mysql.Connection) => Promise<T>
): Promise<T> {
  if (!config.host) throw new Error('数据库地址不能为空')
  if (!config.user) throw new Error('用户名不能为空')
  const connection = await mysql.createConnection(connectionOptions(config))
  try {
    return await fn(connection)
  } finally {
    await connection.end().catch(() => undefined)
  }
}

export interface TestConnectionResult {
  ok: boolean
  server_version?: string
  message: string
}

export async function testDbConnection(
  config: DbDefaultConfig,
  ssh?: DbSshConfig | null
): Promise<TestConnectionResult> {
  if (ssh?.enable === 1) return { ok: false, message: SSH_NOT_SUPPORTED_MESSAGE }
  try {
    const version = await withConnection(config, async (connection) => {
      const [rows] = await connection.query('SELECT VERSION() AS version')
      const first = (rows as Array<{ version?: string }>)[0]
      return first?.version ?? ''
    })
    return { ok: true, server_version: version, message: '连接成功' }
  } catch (error) {
    return { ok: false, message: readableDbError(error) }
  }
}

interface TableRow {
  name: string
  comment: string
}

interface ColumnRow {
  TABLE_NAME: string
  COLUMN_NAME: string
  DATA_TYPE: string
  COLUMN_TYPE: string
  IS_NULLABLE: string
  COLUMN_DEFAULT: string | null
  COLUMN_COMMENT: string
  EXTRA: string
}

export async function listDbTables(
  config: DbDefaultConfig,
  ssh?: DbSshConfig | null
): Promise<DbTable[]> {
  assertDirect(ssh)
  if (!config.database) throw new Error('数据库名不能为空')
  return withConnection(config, async (connection) => {
    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      [config.database]
    )
    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
              COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [config.database]
    )
    const columnsByTable = new Map<string, DbColumnInfo[]>()
    for (const row of columnRows as ColumnRow[]) {
      const list = columnsByTable.get(row.TABLE_NAME) ?? []
      list.push({
        name: row.COLUMN_NAME,
        data_type: row.DATA_TYPE,
        column_type: row.COLUMN_TYPE,
        is_nullable: row.IS_NULLABLE === 'YES',
        default_value: row.COLUMN_DEFAULT,
        comment: row.COLUMN_COMMENT ?? '',
        extra: row.EXTRA ?? ''
      })
      columnsByTable.set(row.TABLE_NAME, list)
    }
    return (tableRows as TableRow[]).map((row) => ({
      name: row.name,
      comment: row.comment ?? '',
      columns: columnsByTable.get(row.name) ?? []
    }))
  })
}

export interface TypeMapping {
  type: NonNullable<ModelSchema['type']>
  warning?: string
}

const INTEGER_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer'])
const NUMBER_TYPES = new Set(['decimal', 'numeric', 'float', 'double', 'real'])
const DATE_TYPES = new Set(['date', 'time', 'datetime', 'timestamp', 'year'])

export function mapMysqlType(dataType: string, columnType: string): TypeMapping {
  const data = String(dataType ?? '').toLowerCase()
  const column = String(columnType ?? '').toLowerCase()
  if (data === 'tinyint' && /^tinyint\(1\)/.test(column)) return { type: 'boolean' }
  if (INTEGER_TYPES.has(data)) return { type: 'integer' }
  if (data === 'bigint') {
    return { type: 'integer', warning: 'bigint 已映射为 integer，超过安全整数范围时可能丢失精度' }
  }
  if (NUMBER_TYPES.has(data)) return { type: 'number' }
  if (data === 'json') return { type: 'object' }
  if (DATE_TYPES.has(data)) return { type: 'string' }
  return { type: 'string' }
}

function parseDefault(value: string | null, mapping: TypeMapping, dataType: string): unknown {
  if (value === null) return undefined
  const text = String(value)
  const lower = text.toLowerCase()
  if (mapping.type === 'boolean') {
    return lower === '1' || lower === 'true'
  }
  if (mapping.type === 'integer' || mapping.type === 'number') {
    const numeric = Number(text)
    return Number.isFinite(numeric) ? numeric : text
  }
  if (dataType === 'json') {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

export function schemaFromTable(table: DbTable): {
  schema: ModelSchema
  warnings: string[]
} {
  const properties: Record<string, ModelSchema> = {}
  const required: string[] = []
  const orders: string[] = []
  const warnings: string[] = []

  for (const column of table.columns) {
    const mapping = mapMysqlType(column.data_type, column.column_type)
    if (mapping.warning) warnings.push(`${table.name}.${column.name}：${mapping.warning}`)
    const field: ModelSchema = {
      type: mapping.type,
      description: column.comment || ''
    }
    if (column.is_nullable) field['x-nullable'] = true
    else required.push(column.name)
    const defaultValue = parseDefault(column.default_value, mapping, column.data_type)
    if (defaultValue !== undefined) field.default = defaultValue
    properties[column.name] = field
    orders.push(column.name)
  }

  return {
    schema: {
      type: 'object',
      description: table.comment || '',
      properties,
      ...(required.length > 0 ? { required } : {}),
      'x-schema-orders': orders
    },
    warnings
  }
}

function uniqueModelName(projectId: string, parentId: string, base: string): string {
  const names = new Set(
    store
      .listModels(projectId)
      .filter((item) => item.parent_id === parentId && item.model_type === 'model')
      .map((item) => item.name)
  )
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

export async function importDbTables(
  projectId: string,
  dbId: string,
  options: ImportDbOptions
): Promise<ImportDbResult> {
  const connection = store.getDbConnection(projectId, dbId)
  if (!connection) throw new Error('数据库连接不存在')
  assertDirect(connection.ssh)
  const selected = Array.isArray(options.tables) ? options.tables.filter(Boolean) : []
  if (selected.length === 0) throw new Error('请至少选择一张表')
  const targetParentId = options.target_parent_id || '0'
  if (targetParentId !== '0') {
    const parent = store.getModel(projectId, targetParentId)
    if (!parent || parent.model_type !== 'folder') throw new Error('目标模型目录不存在')
  }
  const strategy = options.conflict ?? 'update'
  if (!['update', 'skip', 'copy'].includes(strategy)) throw new Error('同名策略非法')

  const allTables = await listDbTables(connection.config.default, connection.ssh)
  const byName = new Map(allTables.map((table) => [table.name, table]))
  const items: ImportDbTableResult[] = []
  const warnings: string[] = []

  for (const tableName of selected) {
    const table = byName.get(tableName)
    if (!table) {
      items.push({ table: tableName, status: 'failed', message: '表不存在' })
      continue
    }
    const built = schemaFromTable(table)
    warnings.push(...built.warnings)
    const siblings = store
      .listModels(projectId)
      .filter((item) => item.parent_id === targetParentId && item.model_type === 'model')
    const existing = siblings.find((item) => item.name === table.name)

    if (existing && strategy === 'skip') {
      items.push({
        table: tableName,
        status: 'skipped',
        model_id: existing.model_id,
        model_name: existing.name
      })
      continue
    }

    if (existing && strategy === 'update') {
      const model = store.getModel(projectId, existing.model_id)
      if (!model) {
        items.push({ table: tableName, status: 'failed', message: '同名模型读取失败' })
        continue
      }
      model.name = table.name
      model.data = {
        description: table.comment || '',
        schema: built.schema
      }
      model.updated_by = '本地'
      store.saveModel(projectId, model)
      items.push({
        table: tableName,
        status: 'updated',
        model_id: model.model_id,
        model_name: model.name
      })
      continue
    }

    const name = existing
      ? uniqueModelName(projectId, targetParentId, `${table.name} 副本`)
      : table.name
    const created = store.createModelInProject(projectId, targetParentId, 'model')
    created.name = name
    created.alias = ''
    created.data = {
      description: table.comment || '',
      schema: built.schema
    }
    store.saveModel(projectId, created)
    items.push({
      table: tableName,
      status: existing ? 'copied' : 'created',
      model_id: created.model_id,
      model_name: created.name
    })
  }

  const count = (status: ImportDbTableResult['status']): number =>
    items.filter((item) => item.status === status).length

  return {
    items,
    created: count('created'),
    updated: count('updated'),
    skipped: count('skipped'),
    copied: count('copied'),
    failed: count('failed'),
    warnings
  }
}
