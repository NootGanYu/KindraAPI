import { useEffect, useState } from 'react'
import {
  App as AntApp,
  Button,
  Empty,
  Input,
  Select,
  Switch,
  Tag
} from 'antd'
import {
  DeleteOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  CopyOutlined
} from '@ant-design/icons'
import type {
  ApiCase,
  BodyMode,
  CaseAssertion,
  CaseRunResult,
  Param,
  Target
} from '@shared/types'
import { createApiCase, createCaseAssertion } from '@shared/factories'
import ParamTable from './ParamTable'
import { useApp } from '../store'

interface Props {
  draft: Target
  projectId?: string
  environmentId?: string
  onChange: (patch: Partial<Target>) => void
}

const BODY_MODES: Array<{ value: BodyMode | ''; label: string }> = [
  { value: '', label: '继承接口' },
  { value: 'raw', label: 'raw' },
  { value: 'json', label: 'JSON' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'formdata', label: 'form-data' }
]

const KIND_OPTIONS = [
  { value: 'status', label: '状态码' },
  { value: 'duration', label: '耗时(ms)' },
  { value: 'json', label: 'JSON 路径' }
]

const OP_OPTIONS = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'exists', label: '存在' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' }
]

function runStatusColor(status?: CaseRunResult['status']): string {
  if (status === 'passed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'error') return 'warning'
  return 'default'
}

export default function CasesEditor({
  draft,
  projectId,
  environmentId,
  onChange
}: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const cases = draft.cases ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [running, setRunning] = useState<'one' | 'all' | null>(null)

  useEffect(() => {
    if (selectedId && cases.some((item) => item.case_id === selectedId)) return
    setSelectedId(cases[0]?.case_id ?? null)
  }, [draft.target_id, cases, selectedId])

  const selected = cases.find((item) => item.case_id === selectedId) ?? null

  const updateCases = (next: ApiCase[]): void => onChange({ cases: next })
  const patchCase = (caseId: string, patch: Partial<ApiCase>): void => {
    updateCases(cases.map((item) => (item.case_id === caseId ? { ...item, ...patch } : item)))
  }
  const patchOverride = (caseId: string, patch: ApiCase['override']): void => {
    const current = cases.find((item) => item.case_id === caseId)
    if (!current) return
    patchCase(caseId, { override: { ...current.override, ...patch } })
  }
  const patchAssertions = (caseId: string, assertions: CaseAssertion[]): void => {
    patchCase(caseId, { assertions })
  }

  const addCase = (): void => {
    const next = createApiCase({ name: `用例 ${cases.length + 1}` })
    updateCases([...cases, next])
    setSelectedId(next.case_id)
  }

  const copyCase = (source: ApiCase): void => {
    const next: ApiCase = {
      ...JSON.parse(JSON.stringify(source)),
      case_id: createApiCase().case_id,
      name: `${source.name} 副本`,
      last_run: undefined
    }
    updateCases([...cases, next])
    setSelectedId(next.case_id)
  }

  const removeCase = (caseId: string): void => {
    updateCases(cases.filter((item) => item.case_id !== caseId))
  }

  const applyResult = (caseId: string, result: CaseRunResult): void => {
    const latest = useApp.getState().drafts[draft.target_id] ?? draft
    const latestCases = latest.cases ?? []
    onChange({
      cases: latestCases.map((item) =>
        item.case_id === caseId ? { ...item, last_run: result } : item
      )
    })
  }

  const runOne = async (): Promise<void> => {
    if (!projectId || !selected || running) return
    setRunning('one')
    try {
      const latest = useApp.getState().drafts[draft.target_id] ?? draft
      const result = await window.api.targets.cases.run(
        projectId,
        latest,
        selected.case_id,
        environmentId
      )
      if (!result.ok) {
        message.error(result.error)
        return
      }
      applyResult(selected.case_id, result.data)
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const runAll = async (): Promise<void> => {
    if (!projectId || running) return
    setRunning('all')
    try {
      const latest = useApp.getState().drafts[draft.target_id] ?? draft
      const result = await window.api.targets.cases.runAll(
        projectId,
        latest,
        environmentId
      )
      if (!result.ok) {
        message.error(result.error)
        return
      }
      for (const item of result.data.results) applyResult(item.case_id, item.result)
      message.success(
        `运行完成：通过 ${result.data.passed} / 失败 ${result.data.failed} / 异常 ${result.data.error}`
      )
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          width: 240,
          flex: 'none',
          borderRight: '1px solid var(--line, #e8e2d7)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ display: 'flex', gap: 6, padding: 10 }}>
          <Button size="small" icon={<PlusOutlined />} onClick={addCase}>
            新建
          </Button>
          <Button
            size="small"
            icon={<PlayCircleOutlined />}
            loading={running === 'all'}
            onClick={() => void runAll()}
          >
            全部运行
          </Button>
        </div>
        <div style={{ overflow: 'auto', flex: 1, padding: '0 8px 12px' }}>
          {cases.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无用例" />
          ) : null}
          {cases.map((item) => (
            <div
              key={item.case_id}
              onClick={() => setSelectedId(item.case_id)}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background:
                  item.case_id === selectedId ? 'rgba(138,107,59,.12)' : 'transparent'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1, fontSize: 13 }}>{item.name}</span>
                {item.last_run ? (
                  <Tag color={runStatusColor(item.last_run.status)}>
                    {item.last_run.status}
                  </Tag>
                ) : null}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {item.assertions.length} 条断言
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {!selected ? (
          <Empty description="选择或新建一个用例" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input
                value={selected.name}
                onChange={(event) => patchCase(selected.case_id, { name: event.target.value })}
                style={{ width: 260 }}
              />
              <Switch
                checked={selected.is_enabled !== 0}
                onChange={(checked) =>
                  patchCase(selected.case_id, { is_enabled: checked ? 1 : 0 })
                }
              />
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyCase(selected)}
              >
                复制
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeCase(selected.case_id)}
              >
                删除
              </Button>
              <span style={{ flex: 1 }} />
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                loading={running === 'one'}
                onClick={() => void runOne()}
              >
                运行
              </Button>
            </div>

            <Input.TextArea
              value={selected.description ?? ''}
              placeholder="用例说明"
              autoSize={{ minRows: 2, maxRows: 4 }}
              onChange={(event) =>
                patchCase(selected.case_id, { description: event.target.value })
              }
            />

            <div>
              <div className="section-title">请求覆盖（空值继承接口）</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Select
                  allowClear
                  placeholder="方法"
                  style={{ width: 130 }}
                  value={selected.override.method}
                  options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(
                    (value) => ({ value, label: value })
                  )}
                  onChange={(value) =>
                    patchOverride(selected.case_id, { method: value ?? undefined })
                  }
                />
                <Input
                  placeholder="URL（留空继承）"
                  value={selected.override.url ?? ''}
                  onChange={(event) =>
                    patchOverride(selected.case_id, { url: event.target.value })
                  }
                />
              </div>
              <ParamTable
                title="Header 覆盖"
                params={selected.override.headers ?? []}
                showDescription={false}
                onChange={(headers) => patchOverride(selected.case_id, { headers })}
              />
              <ParamTable
                title="Query 覆盖"
                params={selected.override.query ?? []}
                showDescription={false}
                onChange={(query) => patchOverride(selected.case_id, { query })}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  请求体
                </span>
                <Select
                  allowClear
                  placeholder="继承接口"
                  style={{ width: 200 }}
                  value={selected.override.body_mode ?? undefined}
                  options={BODY_MODES.filter((item) => item.value !== '').map((item) => ({
                    value: item.value,
                    label: item.label
                  }))}
                  onChange={(value) =>
                    patchOverride(selected.case_id, {
                      body_mode: (value as BodyMode | undefined) ?? undefined
                    })
                  }
                />
                {(selected.override.body_mode === 'raw' ||
                  selected.override.body_mode === 'json') && (
                  <Input.TextArea
                    style={{ flex: 1 }}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    placeholder="请求体"
                    value={selected.override.body ?? ''}
                    onChange={(event) =>
                      patchOverride(selected.case_id, { body: event.target.value })
                    }
                  />
                )}
              </div>
              {selected.override.body_mode === 'urlencoded' ? (
                <ParamTable
                  title="x-www-form-urlencoded"
                  params={selected.override.urlencoded ?? []}
                  showDescription={false}
                  onChange={(urlencoded) =>
                    patchOverride(selected.case_id, { urlencoded })
                  }
                />
              ) : null}
              {selected.override.body_mode === 'formdata' ? (
                <ParamTable
                  title="form-data"
                  params={selected.override.formdata ?? []}
                  showDescription={false}
                  onChange={(formdata) => patchOverride(selected.case_id, { formdata })}
                />
              ) : null}
            </div>

            <div>
              <div className="section-title">断言</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selected.assertions.map((assertion) => (
                  <div
                    key={assertion.assertion_id}
                    style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                  >
                    <Switch
                      checked={assertion.is_enabled !== 0}
                      onChange={(checked) =>
                        patchAssertions(
                          selected.case_id,
                          selected.assertions.map((item) =>
                            item.assertion_id === assertion.assertion_id
                              ? { ...item, is_enabled: checked ? 1 : 0 }
                              : item
                          )
                        )
                      }
                    />
                    <Select
                      style={{ width: 120 }}
                      value={assertion.kind}
                      options={KIND_OPTIONS}
                      onChange={(value) =>
                        patchAssertions(
                          selected.case_id,
                          selected.assertions.map((item) =>
                            item.assertion_id === assertion.assertion_id
                              ? { ...item, kind: value }
                              : item
                          )
                        )
                      }
                    />
                    <Select
                      style={{ width: 110 }}
                      value={assertion.op}
                      options={OP_OPTIONS}
                      onChange={(value) =>
                        patchAssertions(
                          selected.case_id,
                          selected.assertions.map((item) =>
                            item.assertion_id === assertion.assertion_id
                              ? { ...item, op: value }
                              : item
                          )
                        )
                      }
                    />
                    {assertion.kind === 'json' ? (
                      <Input
                        placeholder="$.data.id"
                        value={assertion.path ?? ''}
                        onChange={(event) =>
                          patchAssertions(
                            selected.case_id,
                            selected.assertions.map((item) =>
                              item.assertion_id === assertion.assertion_id
                                ? { ...item, path: event.target.value }
                                : item
                            )
                          )
                        }
                      />
                    ) : null}
                    {assertion.op !== 'exists' ? (
                      <Input
                        style={{ width: 160 }}
                        placeholder="期望值"
                        value={assertion.expected ?? ''}
                        onChange={(event) =>
                          patchAssertions(
                            selected.case_id,
                            selected.assertions.map((item) =>
                              item.assertion_id === assertion.assertion_id
                                ? { ...item, expected: event.target.value }
                                : item
                            )
                          )
                        }
                      />
                    ) : null}
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        patchAssertions(
                          selected.case_id,
                          selected.assertions.filter(
                            (item) => item.assertion_id !== assertion.assertion_id
                          )
                        )
                      }
                    />
                  </div>
                ))}
                <div>
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() =>
                      patchAssertions(selected.case_id, [
                        ...selected.assertions,
                        createCaseAssertion()
                      ])
                    }
                  >
                    添加断言
                  </Button>
                </div>
              </div>
            </div>

            {selected.last_run ? (
              <div
                style={{
                  border: '1px solid var(--line, #e8e2d7)',
                  borderRadius: 8,
                  padding: 12
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Tag color={runStatusColor(selected.last_run.status)}>
                    {selected.last_run.status}
                  </Tag>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {selected.last_run.http_status ?? '—'} ·{' '}
                    {selected.last_run.duration_ms ?? '—'} ms ·{' '}
                    {new Date(selected.last_run.ran_at).toLocaleString()}
                  </span>
                </div>
                {selected.last_run.error ? (
                  <div style={{ color: 'var(--red, #c9463a)', marginTop: 6, fontSize: 12 }}>
                    {selected.last_run.error}
                  </div>
                ) : null}
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(selected.last_run.assertions ?? []).map((item) => {
                    const assertion = selected.assertions.find(
                      (candidate) => candidate.assertion_id === item.assertion_id
                    )
                    return (
                      <div key={item.assertion_id} style={{ fontSize: 12 }}>
                        <Tag color={item.passed ? 'success' : 'error'}>
                          {item.passed ? '通过' : '失败'}
                        </Tag>
                        <span className="muted">
                          {assertion?.kind ?? 'json'}
                          {assertion?.path ? ` ${assertion.path}` : ''} · 实际{' '}
                          {item.actual ?? '—'}
                          {item.message ? ` · ${item.message}` : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
