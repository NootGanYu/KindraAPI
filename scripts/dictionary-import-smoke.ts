import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { parseDictionaryDdl, parseDictionaryText, renameDictionaryKey } from '../src/shared/dictionaryImport'
import { createDictionaryEntry, createParam } from '../src/shared/factories'
import { dictionaryFieldsFromTarget } from '../src/main/schema/dictionary'
import * as store from '../src/main/storage/store'

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-dictionary-data-'))
app.setPath('userData', profile)
async function main(): Promise<void> {
  await app.whenReady()
  const projectId = store.ensureDefaultProject().project_id
  assert.deepEqual(parseDictionaryText('one:一:二\ntwo：说明', 'kv').map(field => field.description), ['一:二', '说明'])
  assert.deepEqual(parseDictionaryText('{"count":42,"nested":{"x":"描述"}}', 'json').map(field => [field.field_type, field.description]), [['string', '42'], ['string', '{"x":"描述"}']])
  assert.throws(() => parseDictionaryText('{"bad":', 'json'))
  assert.throws(() => parseDictionaryText('[]', 'json'))
  assert.equal(renameDictionaryKey('HTTP_responseName', 'camel'), 'httpResponseName')
  assert.equal(renameDictionaryKey('HTTP_responseName', 'pascal'), 'HttpResponseName')
  assert.equal(renameDictionaryKey('HTTPResponseName', 'snake'), 'http_response_name')
  const fields = parseDictionaryDdl("/* CREATE TABLE ignored */ CREATE TABLE IF NOT EXISTS `db`.`sample` (`id` BIGINT NOT NULL, `amount` DECIMAL(10,2) DEFAULT -1.25 COMMENT '价格, (含税)', `label` VARCHAR(40) DEFAULT 'guest' COMMENT '显示名称', `enum_col` ENUM('a,b','c') COMMENT '枚举', PRIMARY KEY (`id`)); CREATE TABLE second (`created` DATETIME DEFAULT CURRENT_TIMESTAMP(3), `switch` TINYINT(1) DEFAULT 1);")
  assert.equal(fields.length, 6)
  assert.equal(fields.find(field => field.key === 'amount')?.default_value, '-1.25')
  assert.equal(fields.find(field => field.key === 'amount')?.description, '价格, (含税)')
  assert.equal(fields.find(field => field.key === 'label')?.schema?.maxLength, 40)
  assert.equal(fields.find(field => field.key === 'switch')?.schema?.default, true)
  assert.equal(fields.find(field => field.key === 'created')?.default_value, 'CURRENT_TIMESTAMP(3)')
  assert.throws(() => parseDictionaryDdl('CREATE TABLE x (id integer'))
  assert.throws(() => parseDictionaryDdl("CREATE TABLE x (label text COMMENT 'missing)"))
  console.log('PASS 字典文本、命名、DDL 引号/嵌套/多表/默认值和错误处理')
  const entry = createDictionaryEntry(projectId, { key: 'same', description: '', field_type: 'string', mock: '@word', example_value: 'one, two', schema: { enum: ['one', 'two'], examples: ['one', 'two'], minLength: 1 } })
  store.saveDictionaryEntry(projectId, entry)
  store.saveDictionaryEntry(projectId, { ...entry, id: '', description: '同名条目' })
  assert.equal(store.listCustomDictionaryEntries(projectId).length, 2)
  assert.equal(store.listCustomDictionaryEntries(projectId)[0].mock, '@word')
  const before = store.listCustomDictionaryEntries(projectId)
  assert.throws(() => store.saveDictionaryEntries(projectId, [{ ...entry, id: '', key: 'valid' }, { ...entry, id: '', key: '' }]))
  assert.deepEqual(store.listCustomDictionaryEntries(projectId), before)
  assert.equal(store.stageDictionaryEntry(projectId, { ...entry, key: 'pending', description: '临时' }), true)
  assert.equal(store.stageDictionaryEntry(projectId, { ...entry, key: 'pending', description: '临时' }), false)
  const pending = store.listDictionaryEntries(projectId).find(item => item.key === 'pending')!
  assert.equal(pending.temporary, true)
  store.saveTemporaryDictionaryEntries(projectId, [pending.id])
  assert.equal(store.listDictionaryEntries(projectId).find(item => item.id === pending.id)?.temporary, undefined)
  assert.throws(() => store.deleteDictionaryEntries(projectId, [pending.id, 'builtin_page']))
  assert.ok(store.listCustomDictionaryEntries(projectId).find(item => item.id === pending.id))
  store.deleteDictionaryEntries(projectId, [pending.id])
  console.log('PASS 空描述/重名/规则保存、失败批次无部分写入、临时去重/转正/删除')
  const model = store.createModelInProject(projectId, '0', 'model')
  model.data!.schema = { type: 'object', properties: { model_id: { type: 'integer', description: '模型编号', default: 9 } } }
  store.saveModel(projectId, model)
  const target = store.createTargetInProject(projectId, '0', 'api')
  target.request!.query.parameter = [createParam({ key: 'q', value: '运行值', description: '查询说明', field_type: 'string', default: '规则默认值' })]
  target.request!.body.model_id = model.model_id
  target.response!.example = [{ example_id: 'response', raw: '{"runtime_only":123}', field_docs: [{ pointer: '/doc_only', type: 'boolean', description: '仅文档字段', doc_only: true }], expect: { schema: { type: 'object', properties: { from_schema: { type: 'string', description: '期望结构', default: '明确默认' } } } } }]
  const extracted = dictionaryFieldsFromTarget(target)
  assert.equal(extracted.find(field => field.key === 'q')?.default_value, '规则默认值')
  assert.equal(extracted.find(field => field.key === 'model_id')?.description, '模型编号')
  assert.equal(extracted.find(field => field.key === 'model_id')?.default_value, '9')
  assert.equal(extracted.find(field => field.key === 'doc_only')?.field_type, 'boolean')
  assert.equal(extracted.find(field => field.key === 'from_schema')?.description, '期望结构')
  assert.equal(extracted.find(field => field.key === 'runtime_only')?.default_value, '')
  console.log('PASS API 字段提取保留模型/仅文档字段/独立约束，运行示例不变成默认值')
}
main().then(() => { fs.rmSync(profile, { recursive: true, force: true }); app.exit(0) }).catch(error => { console.error(error); app.exit(1) })
