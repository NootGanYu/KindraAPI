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
import { DownOutlined, MoreOutlined, PlusOutlined, RightOutlined, WarningOutlined } from '@ant-design/icons'
import type { FieldDoc, JsonFieldType } from '@shared/types'
import {
  buildFieldRows,
  deleteValueAtPointer,
  parseValueText,
  pathToPointer,
  setValueAtPointer,
  type JsonFieldRow
} from '@shared/jsonFields'

interface Props {
  raw: string
  docs: FieldDoc[]
  valuesReadOnly?: boolean
  /** 设计页：隐藏值列，增加可空 / Mock 列 */
  designMode?: boolean
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
  return Boolean(
    doc.type ||
    doc.doc_only ||
    doc.mock !== undefined ||
    RULE_KEYS.some(key => doc[key] !== undefined)
  )
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
  onCommit
}: {
  row: JsonFieldRow
  readOnly: boolean
  onCommit: (value: unknown) => void
}): JSX.Element {
  const [text, setText] = useState(row.valueText)
  const [error, setError] = useState<string | null>(null)
  useTargetEditLock(text !== row.valueText || !!error)

  useEffect(() => {
    setText(row.valueText)
    setError(null)
  }, [row.pointer, row.valueText, row.type])

  if (!row.present) {
    return <span className="muted">（未出现在示例中）</span>
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
  designMode = false,
  onChangeRaw,
  onChangeDocs
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const result = useMemo(() => buildFieldRows(raw, docs), [raw, docs])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const initialized = useRef(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addType, setAddType] = useState<JsonFieldType>('string')
  const [addRequired, setAddRequired] = useState(false)
  const [addDescription, setAddDescription] = useState('')
  const [addError, setAddError] = useState('')
  const [remapPointer, setRemapPointer] = useState<string | null>(null)
  const [remapPath, setRemapPath] = useState('')
  const [remapError, setRemapError] = useState('')
  useTargetEditLock(addOpen || remapPointer !== null)

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
    if (valuesReadOnly || !row.present || row.wildcard) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      message.error('当前 JSON 无效，无法写回字段值')
      return
    }
    if (!setValueAtPointer(parsed, row.pointer, value)) {
      message.error('无法在该路径写入值')
      return
    }
    onChangeRaw(JSON.stringify(parsed, null, 2))
  }

  const openAdd = (): void => {
    setAddPath('')
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
      setAddError('请至少填写说明、类型或必填')
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
    onChangeDocs([...docs, next])
    setAddOpen(false)
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
      title: '从请求体中删除字段？',
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
        if (!deleteValueAtPointer(parsed, row.pointer)) {
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
    if (row.present && !row.wildcard) {
      items.push({ key: 'remove-raw', label: '从请求体删除', danger: true })
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
          JSON 无效，字段表暂不可用。请在「原始」中修正后再回到字段视图。
        </div>
      </div>
    )
  }

  if (result.rootKind === 'primitive') {
    return (
      <div className="json-field-panel">
        <div className="field-banner">当前请求体不是对象或数组，无法生成字段表。</div>
      </div>
    )
  }

  return (
    <div className="json-field-panel">
      <div className="json-field-toolbar">
        <span className="json-field-title">{designMode ? '数据结构' : '字段说明'}</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {designMode ? '结构定义不包含实际值' : '值与结构以原始 JSON 为准'}
        </span>
        {designMode ? (
          <span className="muted" style={{ fontSize: 11 }}>
            根节点：{result.rootKind === 'array' ? 'array' : 'object'}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <Tooltip title="新增 raw 中不存在的仅文档字段">
          <Button size="small" icon={<PlusOutlined />} onClick={openAdd}>
            仅文档字段
          </Button>
        </Tooltip>
      </div>

      {result.orphanCount > 0 ? (
        <div className="field-banner warning">
          有 {result.orphanCount} 条说明对应的字段已不在请求体中（孤立），导出时不会包含。
        </div>
      ) : null}
      {result.aggregated ? (
        <div className="field-banner warning">
          字段较多或嵌套较深，已默认折叠部分层级；导出仍会包含完整内容。
        </div>
      ) : null}

      <div className={`json-field-table${designMode ? ' design-mode' : ''}`}>
        <div className="json-field-row json-field-head">
          <div className="json-field-cell json-field-name">字段</div>
          {designMode ? null : <div className="json-field-cell json-field-value">值</div>}
          <div className="json-field-cell json-field-type">类型</div>
          <div className="json-field-cell json-field-required">必填</div>
          {designMode ? <div className="json-field-cell json-field-nullable">可空</div> : null}
          {designMode ? <div className="json-field-cell json-field-mock">Mock</div> : null}
          <div className="json-field-cell json-field-desc">说明</div>
          <div className="json-field-cell json-field-actions" />
        </div>

        {visibleRows.map((row) => {
          const items = valuesReadOnly ? [] : menuItems(row)
          return (
            <div
              className={`json-field-row${row.orphan ? ' is-orphan' : ''}${
                row.docOnly ? ' is-doc-only' : ''
              }`}
              key={row.pointer}
            >
              <div className="json-field-cell json-field-name">
                <span style={{ paddingLeft: row.depth * 16, display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
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
                  <span className="mono" title={row.path || row.name}>
                    {row.name}
                  </span>
                  {row.orphan ? <Tag color="warning">孤立</Tag> : null}
                  {row.docOnly ? <Tag>仅文档</Tag> : null}
                  {row.wildcard ? <Tag>数组元素</Tag> : null}
                </span>
              </div>
              {designMode ? null : (
                <div className="json-field-cell json-field-value">
                  <ValueCell row={row} readOnly={valuesReadOnly} onCommit={(value) => commitValue(row, value)} />
                </div>
              )}
              <div className="json-field-cell json-field-type">
                <Select
                  size="small"
                  variant="borderless"
                  style={{ flex: 1, minWidth: 0 }}
                  value={row.typeOverridden ? row.type : '__auto__'}
                  disabled={valuesReadOnly && row.present}
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
                <Checkbox
                  disabled={valuesReadOnly}
                  indeterminate={row.doc?.required === undefined}
                  checked={row.required}
                  onChange={(event) => updateDoc(row.pointer, { required: event.target.checked })}
                />
              </div>
              {designMode ? (
                <div className="json-field-cell json-field-nullable">
                  {(() => {
                    const explicit = typeof row.doc?.nullable === 'boolean'
                    const canBeNull = explicit ? Boolean(row.doc?.nullable) : row.nullable
                    return (
                      <button
                        type="button"
                        className={`design-bool-btn${canBeNull ? ' on' : ''}${
                          explicit ? '' : ' inferred'
                        }`}
                        disabled={valuesReadOnly || row.type === 'null'}
                        title={
                          explicit
                            ? '切换是否可为 null'
                            : '未显式声明，当前按示例推断；点击写入明确值'
                        }
                        onClick={() => updateDoc(row.pointer, { nullable: !canBeNull })}
                      >
                        {canBeNull ? '是' : '否'}
                      </button>
                    )
                  })()}
                </div>
              ) : null}
              {designMode ? (
                <div className="json-field-cell json-field-mock">
                  <Input
                    variant="borderless"
                    value={row.doc?.mock ?? ''}
                    disabled={valuesReadOnly}
                    placeholder="Mock 值"
                    onChange={(event) =>
                      updateDoc(row.pointer, { mock: event.target.value || undefined })
                    }
                  />
                </div>
              ) : null}
              <div className="json-field-cell json-field-desc">
                <Input.TextArea
                  variant="borderless"
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  disabled={valuesReadOnly}
                  value={row.description}
                  placeholder="字段含义"
                  onChange={(event) => updateDoc(row.pointer, { description: event.target.value })}
                />
              </div>
              <div className="json-field-cell json-field-actions" style={{ minWidth: 80 }}>
                <FieldRulesEditor value={{ ...row.doc, type: row.type }} disabled={valuesReadOnly} onChange={rules => updateDoc(row.pointer, rules as Partial<FieldDoc>)} />
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
              </div>
            </div>
          )
        })}

        {result.rows.length === 0 ? (
          <div className="json-field-empty">
            当前请求体没有字段。可切换到「原始」编写 JSON，或新增仅文档字段。
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
          <label>必填</label>
          <Checkbox checked={addRequired} onChange={(event) => setAddRequired(event.target.checked)}>
            该字段必填
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
