import FieldRulesEditor from './FieldRulesEditor'
import { RULE_KEYS } from '@shared/fieldRules'
import { useTargetEditLock } from './TargetEditScope'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntApp,
  Button,
  Checkbox,
  Dropdown,
  Input,
  Modal,
  Select,
  Tag,
  Tooltip
} from 'antd'
import { DeleteOutlined, DownOutlined, HolderOutlined, MoreOutlined, PlusOutlined, RightOutlined, WarningOutlined } from '@ant-design/icons'
import type { FieldDoc, JsonFieldType } from '@shared/types'
import {
  buildFieldRows,
  deleteValueAtPointer,
  parseValueText,
  pathToPointer,
  joinPointer,
  splitPointer,
  setValueAtPointer,
  type JsonFieldRow
} from '@shared/jsonFields'

interface Props {
  raw: string
  docs: FieldDoc[]
  valuesReadOnly?: boolean
  compact?: boolean
  context?: 'request' | 'response'
  /** design 维护结构与说明；debug 只允许改值 */
  mode?: 'design' | 'debug' | 'edit'
  title?: string
  onChangeRaw: (raw: string) => void
  onChangeDocs: (docs: FieldDoc[]) => void
}

const TYPE_OPTIONS: Array<{ value: JsonFieldType | '__auto__'; label: string }> = [
  { value: '__auto__', label: '自动推断' },
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'integer', label: 'integer' },
  { value: 'boolean', label: 'boolean' },
  { value: 'null', label: 'null' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
  { value: 'unknown', label: 'unknown' }
]

function docHasMeaning(doc: FieldDoc): boolean {
  return Boolean(doc.type || doc.doc_only || doc.order !== undefined || doc.mock !== undefined || RULE_KEYS.some(key => doc[key] !== undefined))
}

function upsertDoc(
  docs: FieldDoc[],
  pointer: string,
  patch: Partial<FieldDoc>,
  absentDocOnly = false
): FieldDoc[] {
  const index = docs.findIndex((doc) => doc.pointer === pointer)
  if (index >= 0) {
    const next = docs.slice()
    const merged = { ...next[index], ...patch }
    if (!docHasMeaning(merged)) next.splice(index, 1)
    else next[index] = merged
    return next
  }
  const created: FieldDoc = { pointer, source: 'manual', ...patch }
  if (absentDocOnly && created.doc_only === undefined) created.doc_only = true
  return docHasMeaning(created) ? [...docs, created] : docs
}

function removeDoc(docs: FieldDoc[], pointer: string): FieldDoc[] {
  return docs.filter((doc) => doc.pointer !== pointer)
}

function removeDocTree(docs: FieldDoc[], pointer: string): FieldDoc[] {
  const prefix = `${pointer}/`
  return docs.filter((doc) => doc.pointer !== pointer && !doc.pointer.startsWith(prefix))
}

function ValueCell({
  row,
  readOnly,
  canEditMissing = false,
  onCommit
}: {
  row: JsonFieldRow
  readOnly: boolean
  canEditMissing?: boolean
  onCommit: (value: unknown) => void
}): JSX.Element {
  const initialText = row.present ? row.valueText : ''
  const [text, setText] = useState(initialText)
  const [error, setError] = useState<string | null>(null)
  useTargetEditLock(text !== initialText || !!error)

  useEffect(() => {
    setText(row.present ? row.valueText : '')
    setError(null)
  }, [row.pointer, row.valueText, row.type, row.present])

  if (!row.present && !canEditMissing) {
    return <span className="muted">（未出现在示例中）</span>
  }
  if (!row.present && (row.type === 'object' || row.type === 'array')) {
    return <span className="muted">（由子字段生成）</span>
  }
  if (row.wildcard) {
    if (row.sameValue && row.type !== 'object' && row.type !== 'array') {
      return <span className="muted mono">{row.valueText}</span>
    }
    return <span className="muted">数组元素字段，请在数组行编辑</span>
  }
  if (readOnly) {
    return <span className="mono field-static-value">{row.valueText}</span>
  }
  if (row.type === 'null') {
    return <span className="muted mono">null</span>
  }
  if (row.type === 'boolean') {
    return (
      <Select
        size="small"
        variant="borderless"
        value={row.value === true ? 'true' : 'false'}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' }
        ]}
        onChange={(value) => onCommit(value === 'true')}
      />
    )
  }

  const commit = (): void => {
    const parsed = parseValueText(text, row.type)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    onCommit(parsed.value)
  }

  if (row.type === 'object' || row.type === 'array') {
    return (
      <div>
        <Input.TextArea
          variant="borderless"
          className="mono field-value-json"
          autoSize={{ minRows: 1, maxRows: 8 }}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          status={error ? 'error' : undefined}
        />
        {error ? <div className="field-value-error">{error}</div> : null}
      </div>
    )
  }

  return (
    <div>
      <Input
        variant="borderless"
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (row.type === 'string' || row.type === 'unknown') {
            const parsed = parseValueText(next, row.type)
            if (parsed.ok) onCommit(parsed.value)
          }
        }}
        onBlur={commit}
        onPressEnter={commit}
        status={error ? 'error' : undefined}
      />
      {error ? <div className="field-value-error">{error}</div> : null}
    </div>
  )
}

export default function JsonFieldTable({
  raw,
  docs,
  valuesReadOnly = false,
  compact = false,
  context = 'request',
  mode = 'edit',
  title = '字段说明',
  onChangeRaw,
  onChangeDocs
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const bodyLabel = context === 'response' ? '响应体' : '请求体'
  const requiredLabel = context === 'response' ? '必有' : '必填'
  const docsReadOnly = mode === 'debug' || valuesReadOnly
  const result = useMemo(() => buildFieldRows(raw, docs), [raw, docs])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const initialized = useRef(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addType, setAddType] = useState<JsonFieldType>('string')
  const [addRequired, setAddRequired] = useState(false)
  const [addDescription, setAddDescription] = useState('')
  const [addError, setAddError] = useState('')
  const [addAfter, setAddAfter] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [fieldName, setFieldName] = useState('')
  const renamingRef = useRef<string | null>(null)
  const dragging = useRef<string | null>(null)
  const [remapPointer, setRemapPointer] = useState<string | null>(null)
  const [remapPath, setRemapPath] = useState('')
  const [remapError, setRemapError] = useState('')
  useTargetEditLock(addOpen || remapPointer !== null || renaming !== null)

  useEffect(() => {
    if (initialized.current) return
    if (!result.ok || result.rows.length === 0) return
    initialized.current = true
    if (result.aggregated) {
      const next = new Set<string>()
      for (const row of result.rows) {
        if (row.depth >= 1) next.add(row.pointer)
      }
      setCollapsed(next)
    }
  }, [result])

  const visibleRows = useMemo(() => {
    const hidden = new Set<string>()
    const rows: JsonFieldRow[] = []
    for (const row of result.rows) {
      const parentHidden = row.parent ? hidden.has(row.parent) || collapsed.has(row.parent) : false
      if (parentHidden) {
        hidden.add(row.pointer)
        continue
      }
      rows.push(row)
    }
    return rows
  }, [result.rows, collapsed])

  const toggle = (pointer: string): void => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(pointer)) next.delete(pointer)
      else next.add(pointer)
      return next
    })
  }

  const updateDoc = (pointer: string, patch: Partial<FieldDoc>): void => {
    const row = result.rows.find((item) => item.pointer === pointer)
    onChangeDocs(upsertDoc(docs, pointer, patch, row ? !row.present : true))
  }

  const commitValue = (row: JsonFieldRow, value: unknown): void => {
    if (valuesReadOnly || row.wildcard) return
    let parsed: unknown
    try {
      parsed = raw.trim() ? JSON.parse(raw) : {}
    } catch {
      message.error('当前 JSON 无效，无法写回字段值')
      return
    }
    if (parsed === null || typeof parsed !== 'object') {
      message.error('当前 JSON 不是对象或数组，无法写回字段值')
      return
    }
    if (!setValueAtPointer(parsed, row.pointer, value, { createMissing: !row.present })) {
      message.error('无法在该路径写入值')
      return
    }
    onChangeRaw(JSON.stringify(parsed, null, 2))
  }

  const openAdd = (parentPath = '', after: string | null = null): void => {
    setAddAfter(after)
    setAddPath(parentPath ? `${parentPath}.` : result.rootKind === 'array' ? '[]' : '')
    setAddType('string')
    setAddRequired(false)
    setAddDescription('')
    setAddError('')
    setAddOpen(true)
  }

  const submitAdd = (): void => {
    const pointer = pathToPointer(addPath)
    if (pointer === null || pointer === '') {
      setAddError('请输入有效的字段路径，如 user.name 或 items[].id')
      return
    }
    if (docs.some((doc) => doc.pointer === pointer)) {
      setAddError('该路径已有说明，可直接在表中编辑')
      return
    }
    if (!addDescription.trim() && !addRequired && addType === 'unknown') {
      setAddError(`请至少填写说明、类型或${requiredLabel}`)
      return
    }
    const present = result.rows.some((row) => row.pointer === pointer && row.present)
    const next: FieldDoc = {
      pointer,
      type: addType,
      required: addRequired,
      description: addDescription,
      source: 'manual'
    }
    if (!present) next.doc_only = true
    let nextDocs = [...docs, next]
    if (addAfter) {
      const parent = joinPointer(splitPointer(addAfter).slice(0, -1))
      if (joinPointer(splitPointer(pointer).slice(0, -1)) === parent) {
        const siblings = result.rows.filter(row => (row.parent ?? '') === parent).map(row => row.pointer)
        siblings.splice(siblings.indexOf(addAfter) + 1, 0, pointer)
        nextDocs = applyOrder(nextDocs, siblings)
      }
    }
    onChangeDocs(nextDocs)
    setAddOpen(false)
  }

  const rootDoc = docs.find(doc => doc.pointer === '')
  const applyOrder = (currentDocs: FieldDoc[], pointers: string[]): FieldDoc[] => {
    let next = currentDocs
    pointers.forEach((pointer, order) => { next = upsertDoc(next, pointer, { order }) })
    return next
  }
  const moveField = (from: string, to: string): void => {
    const row = result.rows.find(row => row.pointer === from)
    const target = result.rows.find(row => row.pointer === to)
    if (!row || !target || row.parent !== target.parent || from === to) return
    const siblings = result.rows.filter(item => item.parent === row.parent).map(item => item.pointer)
    siblings.splice(siblings.indexOf(from), 1)
    siblings.splice(siblings.indexOf(to), 0, from)
    onChangeDocs(applyOrder(docs, siblings))
  }
  const renameField = (row: JsonFieldRow): void => {
    if (renamingRef.current !== row.pointer) return
    const name = fieldName.trim()
    if (!name) { message.error('请输入字段名称'); return }
    const parts = splitPointer(row.pointer)
    const destination = joinPointer([...parts.slice(0, -1), name])
    if (destination !== row.pointer && result.rows.some(item => item.pointer === destination)) { message.error('同级已存在该字段'); return }
    try {
      if (destination !== row.pointer) {
        if (row.present) {
          const rewrite = (node: unknown, index: number): unknown => {
            if (!node || typeof node !== 'object') return node
            const token = parts[index]
            if (token === '*' && Array.isArray(node)) return node.map(item => rewrite(item, index + 1))
            if (!Object.hasOwn(node, token)) return node
            if (index === parts.length - 1) {
              if (Object.hasOwn(node, name)) throw Error('同级已存在该字段')
              return Object.fromEntries(Object.entries(node).map(([key, value]) => [key === token ? name : key, value]))
            }
            return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === token ? rewrite(value, index + 1) : value]))
          }
          onChangeRaw(JSON.stringify(rewrite(JSON.parse(raw), 0), null, 2))
        }
        onChangeDocs(docs.map(doc => doc.pointer === row.pointer || doc.pointer.startsWith(`${row.pointer}/`)
          ? { ...doc, pointer: destination + doc.pointer.slice(row.pointer.length) } : doc))
      }
      renamingRef.current = null; setRenaming(null)
    } catch (error) { message.error((error as Error).message) }
  }
  const changeRootType = (type: string): void => {
    const commit = (): void => {
      onChangeRaw(type === 'array' ? '[]' : '{}')
      onChangeDocs(type === 'array' ? [{ pointer: '/*', type: 'string', doc_only: true }] : [])
    }
    if (result.rows.length) modal.confirm({ title: '切换根节点类型？', content: '将清空当前字段结构和示例，切换后无法恢复。', okText: '切换', cancelText: '取消', onOk: commit })
    else commit()
  }

  const openRemap = (row: JsonFieldRow): void => {
    setRemapPointer(row.pointer)
    setRemapPath(row.path || '')
    setRemapError('')
  }

  const submitRemap = (): void => {
    if (!remapPointer) return
    const pointer = pathToPointer(remapPath)
    if (pointer === null || pointer === '') {
      setRemapError('请输入有效的字段路径')
      return
    }
    if (pointer === remapPointer) {
      setRemapPointer(null)
      return
    }
    if (docs.some((doc) => doc.pointer === pointer)) {
      setRemapError('目标路径已有说明，请先删除或选择其他路径')
      return
    }
    const current = docs.find((doc) => doc.pointer === remapPointer)
    if (!current) {
      setRemapPointer(null)
      return
    }
    const present = result.rows.some((row) => row.pointer === pointer && row.present)
    const next = docs
      .filter((doc) => doc.pointer !== pointer)
      .map((doc) =>
        doc.pointer === remapPointer
          ? {
              ...doc,
              pointer,
              doc_only: present ? undefined : true
            }
          : doc
      )
    onChangeDocs(next)
    setRemapPointer(null)
  }

  const confirmDeleteRaw = (row: JsonFieldRow): void => {
    modal.confirm({
      title: `从${bodyLabel}中删除字段？`,
      content: `将删除 ${row.path}，并移除其下所有字段说明。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          message.error('当前 JSON 无效，无法删除字段')
          return
        }
        const removeFromArrays = (node: unknown, parts: string[]): boolean => {
          if (!node || typeof node !== 'object') return false
          const [key, ...rest] = parts
          if (key === '*' && Array.isArray(node)) return node.map(item => removeFromArrays(item, rest)).some(Boolean)
          if (!Object.hasOwn(node, key)) return false
          if (!rest.length) return delete (node as Record<string, unknown>)[key]
          return removeFromArrays((node as Record<string, unknown>)[key], rest)
        }
        const removed = context === 'response' && row.wildcard
          ? removeFromArrays(parsed, splitPointer(row.pointer)) : deleteValueAtPointer(parsed, row.pointer)
        if (!removed) {
          message.error('无法删除该字段')
          return
        }
        onChangeRaw(JSON.stringify(parsed, null, 2))
        onChangeDocs(removeDocTree(docs, row.pointer))
      }
    })
  }

  const menuItems = (row: JsonFieldRow): Array<{ key: string; label: string; danger?: boolean }> => {
    const items: Array<{ key: string; label: string; danger?: boolean }> = []
    if (row.orphan) items.push({ key: 'remap', label: '重新映射' })
    if (row.docOnly || row.description || row.required || row.typeOverridden) {
      items.push({ key: 'remove-doc', label: row.docOnly ? '删除文档行' : '清除说明', danger: true })
    }
    if (row.present && (!row.wildcard || (context === 'response' && row.name !== '[]'))) {
      items.push({ key: 'remove-raw', label: `从${bodyLabel}删除`, danger: true })
    }
    return items
  }

  const handleMenu = (row: JsonFieldRow, key: string): void => {
    if (key === 'remap') openRemap(row)
    else if (key === 'remove-doc') onChangeDocs(removeDoc(docs, row.pointer))
    else if (key === 'remove-raw') confirmDeleteRaw(row)
  }

  if (!result.ok) {
    return (
      <div className="json-field-panel">
        <div className="field-banner error">
          JSON 无效，字段表暂不可用。请在「示例」中修正后再回到字段视图。
        </div>
      </div>
    )
  }

  if (result.rootKind === 'primitive') {
    return (
      <div className="json-field-panel">
        <div className="field-banner">当前{bodyLabel}不是对象或数组，无法生成字段表。</div>
      </div>
    )
  }

  return (
    <div className={`json-field-panel${compact ? ' json-field-compact' : ''}${docsReadOnly ? ' json-field-panel--readonly' : ''}`}>
      <div className="json-field-toolbar">
        <span className="json-field-title">{title}</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {docsReadOnly ? '结构由设计页维护，这里只修改值' : '字段结构以本表为准，示例 JSON 可留空'}
        </span>
        <span style={{ flex: 1 }} />
        {docsReadOnly ? null : (
          <Tooltip title="新增 raw 中不存在的仅文档字段">
            <Button size="small" icon={<PlusOutlined />} onClick={() => openAdd()}>
              仅文档字段
            </Button>
          </Tooltip>
        )}
      </div>

      {result.orphanCount > 0 ? (
        <div className="field-banner warning">
          有 {result.orphanCount} 条说明对应的字段已不在{bodyLabel}中（孤立），导出时不会包含。
        </div>
      ) : null}
      {result.aggregated ? (
        <div className="field-banner warning">
          字段较多或嵌套较深，已默认折叠部分层级；导出仍会包含完整内容。
        </div>
      ) : null}

      <div className="json-field-table">
        {compact && <div className="json-root-row">
          <button aria-label="展开或收起根节点" className="field-expand" onClick={() => toggle('')}>
            {collapsed.has('') ? <RightOutlined /> : <DownOutlined />}
          </button>
          <span className="json-root-name">根节点</span>
          <button className="json-add-child" aria-label="添加根字段" disabled={docsReadOnly} onClick={() => openAdd()}><PlusOutlined /></button>
          <Tooltip title="根节点类型">
            <Select size="small" aria-label="根节点类型" variant="borderless" className="json-root-type"
              value={result.rootKind === 'array' ? 'array' : 'object'} disabled={docsReadOnly}
              options={[{ value: 'object', label: 'object' }, { value: 'array', label: 'array' }]}
              onChange={changeRootType} />
          </Tooltip>
          <FieldRulesEditor compact fixedType fixedRequired disabled={docsReadOnly} value={{ ...rootDoc, type: result.rootKind === 'array' ? 'array' : 'object', required: true }}
            onChange={({ type: _type, ...rules }) => onChangeDocs(upsertDoc(docs, '', rules))} />
          <Tooltip title={`${bodyLabel}根节点必需`}><span className="field-flag active">*</span></Tooltip>
          <Tooltip title={`可为 null：${rootDoc?.nullable === undefined ? '待补充' : rootDoc.nullable ? '是' : '否'}`}><button className={`field-flag${rootDoc?.nullable ? ' active' : ''}`}
            aria-label="根节点可空" disabled={docsReadOnly} aria-pressed={rootDoc?.nullable === undefined ? 'mixed' : rootDoc.nullable}
            onClick={() => onChangeDocs(upsertDoc(docs, '', { nullable: !rootDoc?.nullable }))}>N</button></Tooltip>
          <Input variant="borderless" className="json-root-description" aria-label="根节点描述" placeholder="描述" value={rootDoc?.description ?? ''}
            disabled={docsReadOnly} onChange={event => onChangeDocs(upsertDoc(docs, '', { description: event.target.value }))} />
        </div>}

        <div className="json-field-row json-field-head">
          <div className="json-field-cell json-field-name">字段</div>
          <div className="json-field-cell json-field-value">值</div>
          <div className="json-field-cell json-field-type">类型</div>
          <div className="json-field-cell json-field-required">{requiredLabel}</div>
          <div className="json-field-cell json-field-desc">说明</div>
          <div className="json-field-cell json-field-actions" />
        </div>

        {(compact && collapsed.has('') ? [] : visibleRows).map((row) => {
          const items = valuesReadOnly || docsReadOnly ? [] : menuItems(row)
          return (
            <div
              className={`json-field-row${row.orphan ? ' is-orphan' : ''}${
                row.docOnly ? ' is-doc-only' : ''
              }`}
              key={row.pointer}
              onDragOver={event => { if (dragging.current && context === 'response') event.preventDefault() }}
              onDrop={event => { if (dragging.current) { event.preventDefault(); moveField(dragging.current, row.pointer); dragging.current = null } }}
            >
              <div className="json-field-cell json-field-name">
                <span style={{ paddingLeft: row.depth * 16, display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                  {compact && context === 'response' && !docsReadOnly && <span className="json-drag-handle" draggable title="拖拽调整同级顺序" aria-label={`拖拽字段 ${row.path}`}
                    onDragStart={event => { dragging.current = row.pointer; event.dataTransfer.setData('text/plain', row.pointer); event.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { dragging.current = null }}><HolderOutlined /></span>}
                  {row.hasChildren ? (
                    <button className="field-expand" onClick={() => toggle(row.pointer)}>
                      {collapsed.has(row.pointer) ? (
                        <RightOutlined style={{ fontSize: 9 }} />
                      ) : (
                        <DownOutlined style={{ fontSize: 9 }} />
                      )}
                    </button>
                  ) : (
                    <span className="field-expand-placeholder" />
                  )}
                  {renaming === row.pointer ? <Input size="small" autoFocus variant="borderless" className="json-field-rename" aria-label={`字段名称 ${row.path}`} value={fieldName}
                    onChange={event => setFieldName(event.target.value)} onBlur={() => renameField(row)} onPressEnter={() => renameField(row)}
                    onKeyDown={event => { if (event.key === 'Escape') { renamingRef.current = null; setRenaming(null) } }} /> :
                    compact && context === 'response' && !docsReadOnly && row.name !== '[]' ? <button className="mono json-field-name-button" title={row.path || row.name}
                      onClick={() => { setFieldName(row.name); renamingRef.current = row.pointer; setRenaming(row.pointer) }}>{row.name}</button> :
                    <span className="mono" title={row.path || row.name}>{row.name}</span>}
                  {compact && (row.type === 'object' || row.type === 'array') && !docsReadOnly && <button className="json-add-child"
                    aria-label={`添加子字段 ${row.path}`} onClick={() => openAdd(row.type === 'array' ? `${row.path}[]` : row.path)}><PlusOutlined /></button>}
                  {compact && context === 'response' && !['object', 'array'].includes(row.type) && !docsReadOnly && row.name !== '[]' && <button className="json-add-child"
                    aria-label={`添加相邻字段 ${row.path}`} title="添加相邻节点" onClick={() => openAdd(result.rows.find(item => item.pointer === row.parent)?.path ?? '', row.pointer)}><PlusOutlined /></button>}
                  {row.orphan ? <Tag color="warning">孤立</Tag> : null}
                  {row.docOnly ? <Tag>仅文档</Tag> : null}
                  {row.wildcard ? <Tag>数组元素</Tag> : null}
                </span>
              </div>
              <div className="json-field-cell json-field-value">
                <ValueCell
                  row={row}
                  readOnly={valuesReadOnly}
                  canEditMissing={!valuesReadOnly}
                  onCommit={(value) => commitValue(row, value)}
                />
              </div>
              <div className="json-field-cell json-field-type">
                <Select
                  size="small"
                  variant="borderless"
                  style={{ flex: 1, minWidth: 0 }}
                  value={compact ? row.type : row.typeOverridden ? row.type : '__auto__'}
                  disabled={valuesReadOnly || docsReadOnly}
                  options={TYPE_OPTIONS.map((option) =>
                    option.value === '__auto__'
                      ? { ...option, label: `自动（${row.inferred}${row.mixed ? '/mixed' : ''}）` }
                      : option
                  )}
                  onChange={(value) =>
                    updateDoc(row.pointer, {
                      type: value === '__auto__' ? undefined : (value as JsonFieldType)
                    })
                  }
                />
                {row.typeMismatch ? (
                  <Tooltip title="声明的类型与当前值不一致">
                    <WarningOutlined style={{ color: '#c08a2e', fontSize: 12 }} />
                  </Tooltip>
                ) : null}
              </div>
              <div className="json-field-cell json-field-required">
                {compact ? <>
                  <Tooltip title={`${requiredLabel}：${row.doc?.required === undefined ? '待补充' : row.required ? '是' : '否'}`}><button
                    className={`field-flag${row.required ? ' active' : ''}`} aria-label={`${requiredLabel} ${row.path}`} disabled={docsReadOnly}
                    aria-pressed={row.doc?.required === undefined ? 'mixed' : row.required}
                    onClick={() => updateDoc(row.pointer, { required: !row.required })}>*</button></Tooltip>
                  <Tooltip title={`可为 null：${row.doc?.nullable === undefined ? '待补充' : row.doc.nullable ? '是' : '否'}`}><button
                    className={`field-flag${row.doc?.nullable ? ' active' : ''}`} aria-label={`可空 ${row.path}`} disabled={docsReadOnly}
                    aria-pressed={row.doc?.nullable === undefined ? 'mixed' : row.doc.nullable}
                    onClick={() => updateDoc(row.pointer, { nullable: !row.doc?.nullable })}>N</button></Tooltip>
                </> : <Checkbox
                  disabled={valuesReadOnly || docsReadOnly}
                  indeterminate={row.doc?.required === undefined}
                  checked={row.required}
                  onChange={(event) => updateDoc(row.pointer, { required: event.target.checked })}
                />}
              </div>
              <div className="json-field-cell json-field-desc">
                <Input.TextArea
                  variant="borderless"
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  disabled={valuesReadOnly || docsReadOnly}
                  value={row.description}
                  placeholder="字段含义"
                  onChange={(event) => updateDoc(row.pointer, { description: event.target.value })}
                />
              </div>
              <div className="json-field-cell json-field-actions" style={{ minWidth: 80 }}>
                {docsReadOnly ? null : (
                  <>
                    <FieldRulesEditor compact={compact} value={{ ...row.doc, type: row.type }} disabled={valuesReadOnly} onChange={rules => updateDoc(row.pointer, rules as Partial<FieldDoc>)} />
                    {compact && context === 'response' && <button className="json-field-remove" aria-label={`删除字段 ${row.path}`} title="删除字段"
                      disabled={row.name === '[]' && !row.docOnly} onClick={() => row.docOnly ? onChangeDocs(removeDocTree(docs, row.pointer)) : confirmDeleteRaw(row)}><DeleteOutlined /></button>}
                    {items.length > 0 ? (
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items,
                          onClick: ({ key }) => handleMenu(row, key)
                        }}
                      >
                        <button className="param-delete" title="更多操作">
                          <MoreOutlined style={{ fontSize: 13 }} />
                        </button>
                      </Dropdown>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )
        })}

        {!compact && result.rows.length === 0 ? (
          <div className="json-field-empty">
            {docsReadOnly
              ? '暂无字段，请在设计页维护字段结构。'
              : `当前${bodyLabel}没有字段。可切换到「示例」编写 JSON，或新增仅文档字段。`}
          </div>
        ) : null}
      </div>

      <Modal
        title="新增仅文档字段"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={submitAdd}
        okText="添加"
        cancelText="取消"
      >
        <div className="field-form">
          <label>字段路径</label>
          <Input
            value={addPath}
            placeholder="user.name 或 items[].id"
            onChange={(event) => setAddPath(event.target.value)}
          />
          <label>类型</label>
          <Select
            value={addType}
            options={TYPE_OPTIONS.filter((option) => option.value !== '__auto__')}
            onChange={(value) => setAddType(value as JsonFieldType)}
          />
          <label>{requiredLabel}</label>
          <Checkbox checked={addRequired} onChange={(event) => setAddRequired(event.target.checked)}>
            该字段{requiredLabel}
          </Checkbox>
          <label>说明</label>
          <Input.TextArea
            value={addDescription}
            autoSize={{ minRows: 2, maxRows: 5 }}
            onChange={(event) => setAddDescription(event.target.value)}
          />
          {addError ? <div className="field-value-error">{addError}</div> : null}
        </div>
      </Modal>

      <Modal
        title="重新映射说明"
        open={Boolean(remapPointer)}
        onCancel={() => setRemapPointer(null)}
        onOk={submitRemap}
        okText="保存"
        cancelText="取消"
      >
        <div className="field-form">
          <label>新的字段路径</label>
          <Input
            value={remapPath}
            placeholder="user.name 或 items[].id"
            onChange={(event) => setRemapPath(event.target.value)}
          />
          {remapError ? <div className="field-value-error">{remapError}</div> : null}
        </div>
      </Modal>
    </div>
  )
}
