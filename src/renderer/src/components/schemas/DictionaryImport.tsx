import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Button, Input, Modal, Radio, Select, Table, Tabs, Tree } from 'antd'
import type { DataNode } from 'antd/es/tree'
import type { DbConnection, DbTable, DictionaryEntry, DictionaryEntryView, TargetSummary } from '@shared/types'
import { dictionaryFieldFromColumn, parseDictionaryDdl, parseDictionaryText, renameDictionaryKey } from '@shared/dictionaryImport'
import type { DictionaryField, NamingStyle } from '@shared/dictionaryImport'

type Mode = 'kv' | 'json' | 'db' | 'api'
export default function DictionaryImport({ open, projectId, entries, onClose, onImported }: {
  open: boolean; projectId: string; entries: DictionaryEntryView[]; onClose: () => void; onImported: () => Promise<void>
}): JSX.Element {
  const { message } = App.useApp()
  const [mode, setMode] = useState<Mode>('kv')
  const [texts, setTexts] = useState({ kv: '', json: '{}', ddl: '' })
  const [naming, setNaming] = useState<NamingStyle>('original')
  const [preview, setPreview] = useState('new')
  const [selected, setSelected] = useState<React.Key[]>([])
  const [dbMode, setDbMode] = useState('connection')
  const [connections, setConnections] = useState<DbConnection[]>([])
  const [connectionId, setConnectionId] = useState<string>()
  const [tables, setTables] = useState<DbTable[]>([])
  const [tableNames, setTableNames] = useState<string[]>([])
  const [apis, setApis] = useState<TargetSummary[]>([])
  const [apiIds, setApiIds] = useState<string[]>([])
  const [apiQuery, setApiQuery] = useState('')
  const [apiFields, setApiFields] = useState<DictionaryField[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    if (!open) return
    const token = ++generation.current
    setMode('kv'); setTexts({ kv: '', json: '{}', ddl: '' }); setNaming('original'); setPreview('new'); setApiFields([]); setApiIds([]); setApiQuery(''); setTables([]); setTableNames([]); setConnectionId(undefined); setLoadError(''); setDbMode('connection')
    void Promise.all([window.api.db.list(projectId), window.api.targets.list(projectId)]).then(([db, targets]) => {
      if (generation.current !== token) return
      if (db.ok) setConnections(db.data); else setLoadError(db.error)
      if (targets.ok) setApis(targets.data); else setLoadError(targets.error)
    })
    return () => { generation.current++ }
  }, [open, projectId])
  const parsed = useMemo(() => {
    try {
      const fields = mode === 'kv' || mode === 'json' ? parseDictionaryText(texts[mode], mode)
        : mode === 'api' ? apiFields : dbMode === 'ddl' ? parseDictionaryDdl(texts.ddl)
          : tables.filter(table => tableNames.includes(table.name)).flatMap(table => table.columns.map(dictionaryFieldFromColumn))
      const keys = new Set(entries.filter(entry => entry.source === 'custom').map(entry => entry.key))
      return { rows: fields.map((field, index) => {
        const key = renameDictionaryKey(field.key, naming)
        return { ...field, key, id: `${index}:${key}`, duplicate: keys.has(key) }
      }), error: '' }
    } catch (error) { return { rows: [], error: (error as Error).message } }
  }, [mode, texts, apiFields, dbMode, tables, tableNames, entries, naming])
  useEffect(() => { setSelected(parsed.rows.filter(row => !row.duplicate).map(row => row.id)) }, [parsed])
  const filtered = parsed.rows.filter(row => row.duplicate === (preview === 'duplicate'))
  const tree = useMemo(() => {
    const visited = new Set<string>()
    const children = (parent: string): DataNode[] => apis.filter(api => api.parent_id === parent).flatMap(api => {
      if (visited.has(api.target_id)) return []
      visited.add(api.target_id)
      const nested = children(api.target_id)
      if (apiQuery && !`${api.name} ${api.url}`.toLowerCase().includes(apiQuery.toLowerCase()) && !nested.length) return []
      return [{ key: api.target_id, title: api.name, children: nested.length ? nested : undefined, isLeaf: api.target_type === 'api' }]
    })
    return children('0')
  }, [apis, apiQuery])
  const readTables = async (id: string): Promise<void> => {
    setConnectionId(id); setTables([]); setTableNames([]); setLoading(true); setLoadError('')
    const token = ++generation.current
    const connection = connections.find(item => item.db_id === id)
    try {
      if (!connection) throw Error('请选择数据库连接')
      const result = await window.api.db.tables(connection.config.default, connection.ssh)
      if (generation.current !== token) return
      if (!result.ok) throw Error(result.error)
      setTables(result.data)
    } catch (error) { if (generation.current === token) setLoadError((error as Error).message) }
    finally { if (generation.current === token) setLoading(false) }
  }
  const readApis = async (): Promise<void> => {
    setLoading(true); setLoadError('')
    const token = ++generation.current
    try {
      const ids = apiIds.filter(id => apis.some(api => api.target_id === id && api.target_type === 'api'))
      if (!ids.length) throw Error('请先选择接口')
      const result = await window.api.dictionary.apiFields(projectId, ids)
      if (generation.current !== token) return
      if (!result.ok) throw Error(result.error)
      setApiFields(result.data)
    } catch (error) { if (generation.current === token) setLoadError((error as Error).message) } finally { if (generation.current === token) setLoading(false) }
  }
  const save = async (): Promise<void> => {
    if (saving || parsed.error) return
    const chosen = parsed.rows.filter(row => selected.includes(row.id))
    if (!chosen.length) { message.info('请至少选择一个字段'); return }
    setSaving(true)
    try {
      const input: DictionaryEntry[] = chosen.map(({ duplicate: _, id: _id, ...field }) => ({ ...field, id: '', project_id: projectId, created_at: '', updated_at: '' }))
      const result = await window.api.dictionary.saveMany(projectId, input)
      if (!result.ok) throw Error(result.error)
      await onImported(); onClose(); message.success('导入成功')
    } catch (error) { message.error((error as Error).message) } finally { setSaving(false) }
  }
  const textEditor = (key: 'kv' | 'json' | 'ddl', placeholder: string): JSX.Element => <Input.TextArea aria-label={key === 'ddl' ? '建表 SQL' : key === 'json' ? 'Raw-Json 内容' : 'Key-Value 内容'} value={texts[key]} onChange={event => setTexts(current => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} spellCheck={false} rows={12} className="mono" />
  return <Modal title="导入" open={open} width={1000} onCancel={onClose} onOk={() => void save()} okText="导入" cancelText="取消" confirmLoading={saving} okButtonProps={{ disabled: !!parsed.error || !selected.length }} className="dictionary-import-modal" destroyOnHidden>
    <Tabs activeKey={mode} onChange={value => { setMode(value as Mode); setLoadError(''); setPreview('new') }} items={[
      { key: 'kv', label: 'Key-Value格式' }, { key: 'json', label: 'Raw-Json格式' }, { key: 'db', label: '从数据库导入' }, { key: 'api', label: '已有API获取' }
    ]} />
    <div className="dictionary-import-columns"><div className="dictionary-import-source">
      {mode === 'kv' && textEditor('kv', '参数名:参数说明')}
      {mode === 'json' && <><Button size="small" onClick={() => { try { const json = JSON.stringify(JSON.parse(texts.json), null, 2); setTexts(current => ({ ...current, json })); setLoadError('') } catch { setLoadError('JSON 格式错误，请修正后重试') } }}>格式化</Button>{textEditor('json', '{"参数名":"参数说明"}')}</>}
      {mode === 'db' && <><Radio.Group value={dbMode} onChange={event => setDbMode(event.target.value)} options={[{ value: 'connection', label: '数据库连接' }, { value: 'ddl', label: 'DDL' }]} />
        {dbMode === 'ddl' ? <><p className="muted">暂仅支持 MySQL 建表 SQL</p>{textEditor('ddl', 'CREATE TABLE ...')}</> : <><Select aria-label="数据库连接" placeholder="请选择数据库连接" value={connectionId} onChange={id => void readTables(id)} options={connections.map(connection => ({ value: connection.db_id, label: connection.name }))} style={{ width: '100%' }} /><Table size="small" loading={loading} rowKey="name" dataSource={tables} columns={[{ title: '表名称', dataIndex: 'name' }]} pagination={false} rowSelection={{ selectedRowKeys: tableNames, onChange: keys => setTableNames(keys.map(String)) }} scroll={{ y: 280 }} /></>}
      </>}
      {mode === 'api' && <><Input aria-label="搜索接口" placeholder="搜索接口" allowClear value={apiQuery} onChange={event => setApiQuery(event.target.value)} /><div className="dictionary-import-api-tree"><Tree checkable treeData={tree} checkedKeys={apiIds} onCheck={keys => { setApiIds((Array.isArray(keys) ? keys : keys.checked).map(String)); setApiFields([]) }} defaultExpandAll /></div><Button onClick={() => void readApis()} loading={loading} disabled={!apiIds.some(id => apis.some(api => api.target_id === id && api.target_type === 'api'))}>一键获取字段</Button></>}
    </div><div className="dictionary-import-preview">
      <div className="dict-head"><span>命名方式</span><Select aria-label="命名方式" value={naming} onChange={setNaming} style={{ width: 180 }} options={[{ value: 'original', label: '保持原样' }, { value: 'camel', label: '小驼峰' }, { value: 'pascal', label: '大驼峰' }, { value: 'snake', label: '下划线' }]} /></div>
      <Tabs activeKey={preview} onChange={setPreview} items={[['new', '新增字段', false], ['duplicate', '重复字段', true]].map(([key, label, duplicate]) => {
        const rows = parsed.rows.filter(row => row.duplicate === duplicate)
        return { key: String(key), label: `${label} ${rows.filter(row => selected.includes(row.id)).length}/${rows.length}` }
      })} />
      <Table size="small" rowKey="id" dataSource={filtered} pagination={false} scroll={{ y: 300 }} rowSelection={{ selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: setSelected }} columns={[
        { title: '参数名', dataIndex: 'key', render: (key, row) => <div className="dict-builtin-name"><span>{key}</span><small>{row.field_type}</small></div> },
        { title: '默认值', dataIndex: 'default_value' }, { title: '别名', dataIndex: 'remarks' }, { title: '描述', dataIndex: 'description' }
      ]} />
    </div></div>
    {(parsed.error || loadError) && <Alert type="error" message={parsed.error || loadError} showIcon />}
  </Modal>
}
