import type { DictionaryEntry, DictFieldType } from './types'

interface BuiltinSeed {
  key: string
  field_type: DictFieldType
  description: string
  remarks?: string
}

/** 系统内置字段描述：代码常量，不写入项目。 */
const BUILTIN_SEEDS: BuiltinSeed[] = [
  { key: 'page', field_type: 'number', description: '当前页码' },
  { key: 'token', field_type: 'string', description: '访问令牌' },
  { key: 'email', field_type: 'string', description: '电子邮箱' },
  { key: 'password', field_type: 'string', description: '密码' },
  { key: 'username', field_type: 'string', description: '用户名' },
  { key: 'telephone', field_type: 'string', description: '电话号码' },
  { key: 'tel', field_type: 'string', description: '电话号码' },
  { key: 'mobile', field_type: 'string', description: '手机号码' },
  { key: 'organization', field_type: 'string', description: '组织机构' },
  { key: 'account', field_type: 'string', description: '账号' },
  { key: 'data', field_type: 'string', description: '响应数据' },
  { key: 'msg', field_type: 'string', description: '提示信息' },
  { key: 'result', field_type: 'string', description: '返回结果' },
  { key: 'success', field_type: 'string', description: '是否成功' },
  { key: 'error', field_type: 'string', description: '错误信息' },
  { key: 'authorization', field_type: 'string', description: '认证信息' },
  { key: 'article_id', field_type: 'string', description: '文章 ID' },
  { key: 'date', field_type: 'string', description: '日期' },
  { key: 'price', field_type: 'number', description: '价格' }
]

const EPOCH = '2026-10-25T00:00:00.000Z'

export const BUILTIN_DICTIONARY: DictionaryEntry[] = BUILTIN_SEEDS.map((seed) => ({
  id: `builtin_${seed.key}`,
  project_id: '0',
  key: seed.key,
  field_type: seed.field_type,
  description: seed.description,
  remarks: seed.remarks,
  created_at: EPOCH,
  updated_at: EPOCH
}))

export const BUILTIN_DICTIONARY_KEYS = new Set(BUILTIN_DICTIONARY.map((entry) => entry.key))

export function isBuiltinDictionaryId(id: string): boolean {
  return id.startsWith('builtin_')
}
