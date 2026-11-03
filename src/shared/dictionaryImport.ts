import type { DbColumnInfo, DictionaryEntry, DictFieldType } from './types'

export type DictionaryField = Pick<DictionaryEntry, 'key' | 'description' | 'field_type' | 'default_value' | 'remarks' | 'schema'>
export type NamingStyle = 'original' | 'camel' | 'pascal' | 'snake'

export function renameDictionaryKey(key: string, style: NamingStyle): string {
  if (style === 'original') return key
  const words = key.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean).map(word => word.toLowerCase())
  if (style === 'snake') return words.join('_')
  return words.map((word, index) => style === 'camel' && !index ? word : word.charAt(0).toUpperCase() + word.slice(1)).join('')
}

/** Both text formats describe fields; their values are descriptions, never sample values. */
export function parseDictionaryText(text: string, mode: 'kv' | 'json'): DictionaryField[] {
  if (!text.trim()) return []
  let rows: Array<[string, unknown]>
  if (mode === 'json') {
    const object: unknown = JSON.parse(text)
    if (!object || typeof object !== 'object' || Array.isArray(object)) throw Error('请输入参数名与说明组成的 JSON 对象')
    rows = Object.entries(object)
  } else rows = text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const separator = line.search(/[:：=]/)
    if (separator < 1) throw Error(`第 ${index + 1} 行请使用 参数名:参数说明 格式`)
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
  })
  return rows.map(([key, description]) => {
    if (!key.trim()) throw Error('参数名称不能为空')
    return { key: key.trim(), description: typeof description === 'string' ? description : JSON.stringify(description), field_type: 'string' }
  })
}

export function dictionaryFieldFromColumn(column: DbColumnInfo): DictionaryField {
  const type = column.data_type.toLowerCase()
  const field_type: DictFieldType = type === 'tinyint' && /^tinyint\(1\)/i.test(column.column_type) ? 'boolean'
    : /^(tinyint|smallint|mediumint|int|integer|bigint)$/.test(type) ? 'integer'
      : /^(decimal|numeric|float|double|real)$/.test(type) ? 'number' : type === 'json' ? 'object' : 'string'
  const schema: Record<string, unknown> = { type: field_type, nullable: column.is_nullable }
  if (column.default_value !== null) {
    const raw = column.default_value
    const number = Number(raw)
    schema.default = field_type === 'boolean' && /^(0|1|true|false)$/i.test(raw) ? /^(1|true)$/i.test(raw)
      : ['number', 'integer'].includes(field_type) && raw.trim() && Number.isFinite(number) ? number : raw
  }
  const length = column.column_type.match(/^(?:var)?char\((\d+)\)/i)
  if (length) schema.maxLength = Number(length[1])
  return { key: column.name, description: column.comment, field_type, default_value: schema.default === undefined ? '' : String(schema.default), schema }
}

type Token = { value: string; quoted?: 'string' | 'identifier' }
/** Tokenize before splitting definitions: commas/parentheses inside comments, strings and ENUMs are not separators. */
function sqlTokens(sql: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < sql.length) {
    const char = sql[i]
    if (/\s/.test(char)) { i++; continue }
    if (sql.startsWith('--', i) || char === '#') { while (i < sql.length && sql[i] !== '\n') i++; continue }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); if (end < 0) throw Error('SQL 注释未闭合'); i = end + 2; continue }
    if (['`', "'", '"'].includes(char)) {
      let value = '', closed = false; i++
      while (i < sql.length) {
        if (sql[i] === char) {
          if (sql[i + 1] === char) { value += char; i += 2; continue }
          i++; closed = true; break
        }
        if (sql[i] === '\\' && i + 1 < sql.length) { value += sql[++i]; i++; continue }
        value += sql[i++]
      }
      if (!closed) throw Error('SQL 引号未闭合')
      tokens.push({ value, quoted: char === '`' ? 'identifier' : 'string' }); continue
    }
    const match = sql.slice(i).match(/^[\w$]+/)
    if (match) { tokens.push({ value: match[0] }); i += match[0].length } else { tokens.push({ value: char }); i++ }
  }
  return tokens
}

export function parseDictionaryDdl(sql: string): DictionaryField[] {
  if (!sql.trim()) return []
  const tokens = sqlTokens(sql), fields: DictionaryField[] = []
  const is = (index: number, value: string): boolean => !tokens[index]?.quoted && tokens[index]?.value.toUpperCase() === value
  let tables = 0
  for (let i = 0; i < tokens.length; i++) {
    if (!is(i, 'CREATE')) continue
    if (is(i + 1, 'TEMPORARY')) i++
    if (!is(i + 1, 'TABLE')) continue
    i += 2
    if (is(i, 'IF') && is(i + 1, 'NOT') && is(i + 2, 'EXISTS')) i += 3
    if (!tokens[i]) throw Error('缺少表名')
    i++
    if (is(i, '.')) i += 2
    if (!is(i, '(')) throw Error('请使用包含字段定义的 CREATE TABLE 语句')
    const definitions: Token[][] = []; let depth = 1, definition: Token[] = []
    while (++i < tokens.length) {
      if (is(i, '(')) depth++
      if (is(i, ')')) depth--
      if (!depth) { if (definition.length) definitions.push(definition); break }
      if (is(i, ',') && depth === 1) { definitions.push(definition); definition = [] } else definition.push(tokens[i])
    }
    if (depth) throw Error('CREATE TABLE 括号未闭合')
    tables++
    for (const column of definitions) {
      if (!column.length || (!column[0].quoted && /^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK|FULLTEXT|SPATIAL)$/i.test(column[0].value))) continue
      if (column.length < 2 || column[1].quoted) throw Error(`字段 ${column[0].value} 缺少类型`)
      const dataType = column[1].value.toLowerCase()
      let typeEnd = 2
      if (column[typeEnd]?.value === '(') { let nesting = 0; do { if (column[typeEnd]?.value === '(') nesting++; if (column[typeEnd]?.value === ')') nesting--; typeEnd++ } while (typeEnd < column.length && nesting) }
      const columnType = column.slice(1, typeEnd).map(token => token.value).join('')
      const keyword = (word: string): number => column.findIndex((token, index) => index >= typeEnd && !token.quoted && token.value.toUpperCase() === word)
      const comment = keyword('COMMENT'), defaultIndex = keyword('DEFAULT')
      let defaultValue: string | null = null
      if (defaultIndex >= 0) {
        const token = column[defaultIndex + 1]
        if (!token) throw Error(`字段 ${column[0].value} 缺少默认值`)
        if (token.quoted) defaultValue = token.value
        else if (token.value.toUpperCase() !== 'NULL') {
          let end = defaultIndex + 1, nesting = 0
          while (end < column.length) {
            const current = column[end]
            if (!nesting && end > defaultIndex + 1 && !current.quoted && /^(COMMENT|NOT|NULL|ON|PRIMARY|UNIQUE|AUTO_INCREMENT|COLLATE|CHARACTER|REFERENCES|CHECK|GENERATED)$/i.test(current.value)) break
            if (current.value === '(') nesting++
            if (current.value === ')') nesting--
            end++
          }
          defaultValue = column.slice(defaultIndex + 1, end).map(item => item.value).join('')
        }
      }
      fields.push(dictionaryFieldFromColumn({ name: column[0].value, data_type: dataType, column_type: columnType,
        is_nullable: !(keyword('NOT') >= 0 && column[keyword('NOT') + 1]?.value.toUpperCase() === 'NULL') && keyword('PRIMARY') < 0,
        default_value: defaultValue, comment: comment >= 0 ? column[comment + 1]?.value ?? '' : '', extra: '' }))
    }
  }
  if (!tables) throw Error('未找到 MySQL CREATE TABLE 语句')
  return fields
}
