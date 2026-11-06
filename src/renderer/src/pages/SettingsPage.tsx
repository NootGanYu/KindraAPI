import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined
} from '@ant-design/icons'
import type {
  AppSettings,
  DebugConfig,
  DebugState,
  Environment,
  GlobalVars,
  McpConfig
} from '@shared/types'
import { useLocation } from 'react-router-dom'
import { useApp } from '../store'
import CustomAttributesPanel from '../components/CustomAttributesPanel'

interface VarRow {
  key: string
  value: string
  initial: string
  description: string
  checked: boolean
}

function envToRows(env: Environment | null): VarRow[] {
  if (!env) return []
  return Object.entries(env.env_var_list).map(([key, value]) => ({
    key,
    value: value.current_value ?? '',
    initial: value.initial_value ?? '',
    description: value.description ?? '',
    checked: value.is_checked > 0
  }))
}

function globalsToRows(globals: GlobalVars | null): VarRow[] {
  if (!globals) return []
  return Object.entries(globals.vars).map(([key, value]) => ({
    key,
    value: value.current_value ?? '',
    initial: value.initial_value ?? '',
    description: value.description ?? '',
    checked: true
  }))
}

function duplicateKeys(rows: Array<{ key: string }>): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    if (seen.has(key)) duplicates.add(key)
    else seen.add(key)
  }
  return [...duplicates]
}

export default function SettingsPage(): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const project = useApp((s) => s.project)
  const projects = useApp((s) => s.projects)
  const paths = useApp((s) => s.paths)
  const environments = useApp((s) => s.environments)
  const settings = useApp((s) => s.settings)
  const reloadEnvironments = useApp((s) => s.reloadEnvironments)
  const saveSettings = useApp((s) => s.saveSettings)
  const mcpConfig = useApp((s) => s.mcpConfig)
  const mcpStatus = useApp((s) => s.mcpStatus)
  const mcpTools = useApp((s) => s.mcpTools)
  const saveMcp = useApp((s) => s.saveMcp)
  const regenerateMcpToken = useApp((s) => s.regenerateMcpToken)
  const location = useLocation()

  useEffect(() => {
    const id = location.hash.replace(/^#/, '')
    if (!id) return
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
    return () => clearTimeout(timer)
  }, [location.hash])

  const [envId, setEnvId] = useState(environments[0]?.env_id ?? '')
  const [envName, setEnvName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [envRows, setEnvRows] = useState<VarRow[]>([])
  const [globalRows, setGlobalRows] = useState<VarRow[]>([])
  const [form, setForm] = useState<AppSettings | null>(settings)
  const [mcpForm, setMcpForm] = useState<McpConfig | null>(mcpConfig)
  const [mcpInfo, setMcpInfo] = useState('')
  const [mcpStdio, setMcpStdio] = useState('')
  const [debugForm, setDebugForm] = useState<DebugConfig>({ enabled: false, port: 9222 })
  const [debugActive, setDebugActive] = useState<DebugState | null>(null)

  const env = useMemo(
    () => environments.find((e) => e.env_id === envId) ?? environments[0] ?? null,
    [environments, envId]
  )

  useEffect(() => {
    if (!env) return
    setEnvName(env.name)
    setBaseUrl(env.server_list?.[0]?.uri ?? '')
    setEnvRows(envToRows(env))
  }, [env])

  useEffect(() => {
    if (!project) return
    void window.api.globals.get(project.project_id).then((result) => {
      if (result.ok) setGlobalRows(globalsToRows(result.data))
    })
  }, [project])

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  useEffect(() => {
    if (mcpConfig) setMcpForm(mcpConfig)
  }, [mcpConfig])

  useEffect(() => {
    void window.api.debug.get().then((result) => {
      if (!result.ok) return
      setDebugActive(result.data)
      setDebugForm({ enabled: result.data.enabled, port: result.data.port })
    })
  }, [])

  useEffect(() => {
    void window.api.mcp.infoPath().then((result) => {
      if (result.ok) setMcpInfo(result.data)
    })
    void window.api.mcp.stdioPath().then((result) => {
      if (result.ok) setMcpStdio(result.data)
    })
  }, [])

  const saveEnv = async (): Promise<void> => {
    if (!project || !env) return
    const duplicated = duplicateKeys(envRows)
    if (duplicated.length) {
      message.error(`变量名重复：${duplicated.join('、')}`)
      return
    }
    const envVarList: Environment['env_var_list'] = {}
    for (const row of envRows) {
      if (!row.key.trim()) continue
      envVarList[row.key.trim()] = {
        current_value: row.value,
        initial_value: row.initial,
        description: row.description,
        is_checked: row.checked ? 1 : -1
      }
    }
    const first = env.server_list?.[0]
    const serverList = first
      ? [{ ...first, uri: baseUrl.trim() }, ...(env.server_list ?? []).slice(1)]
      : [{ server_id: '1', name: 'default', uri: baseUrl.trim(), sort: 1000 }]
    const next: Environment = {
      ...env,
      name: envName.trim() || env.name,
      env_var_list: envVarList,
      server_list: serverList
    }
    const result = await window.api.envs.save(project.project_id, next)
    if (result.ok) {
      message.success('环境已保存')
      await reloadEnvironments()
    } else message.error(result.error)
  }

  const saveGlobals = async (): Promise<void> => {
    if (!project) return
    const duplicated = duplicateKeys(globalRows)
    if (duplicated.length) {
      message.error(`变量名重复：${duplicated.join('、')}`)
      return
    }
    const vars: GlobalVars['vars'] = {}
    for (const row of globalRows) {
      if (!row.key.trim()) continue
      vars[row.key.trim()] = {
        current_value: row.value,
        initial_value: row.initial,
        description: row.description
      }
    }
    const result = await window.api.globals.save(project.project_id, {
      project_id: project.project_id,
      vars,
      updated_at: new Date().toISOString()
    })
    if (result.ok) message.success('全局变量已保存')
    else message.error(result.error)
  }

  const saveForm = async (): Promise<void> => {
    if (!form) return
    try {
      await saveSettings(form)
      message.success('设置已保存')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const saveMcpForm = async (): Promise<void> => {
    if (!mcpForm) return
    try {
      await saveMcp(mcpForm)
      message.success('MCP 配置已保存，服务已重启')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const saveDebug = async (): Promise<void> => {
    const result = await window.api.debug.save(debugForm)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    const state = await window.api.debug.get()
    const active = state.ok ? state.data : null
    setDebugActive(active)
    setDebugForm({ enabled: result.data.enabled, port: result.data.port })
    message.success('调试设置已保存')
    const needsRestart = result.data.enabled
      ? active?.active_port !== result.data.port
      : active?.active_port !== null
    if (needsRestart) {
      modal.confirm({
        title: '需要重启应用',
        content: 'CDP 调试开关在应用启动时生效，是否立即重启？',
        okText: '立即重启',
        cancelText: '稍后',
        onOk: () => {
          void window.api.app.relaunch()
        }
      })
    }
  }

  const requestSaveDebug = (): void => {
    const activePort = debugActive?.active_port ?? null
    if (debugForm.enabled && activePort === null) {
      modal.confirm({
        title: '启用远程调试？',
        content:
          'CDP 没有鉴权。启用后，本机任意程序都能通过 DevTools 协议控制本应用（读写项目、发送请求）。请在调试结束后关闭。',
        okText: '启用',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => void saveDebug()
      })
      return
    }
    void saveDebug()
  }

  const copyText = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制')
    } catch {
      message.error('复制失败，请手动选择文本')
    }
  }

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        KindraAPI: {
          command: 'node',
          args: [mcpStdio || '/path/to/mcp-stdio.cjs'],
          env: {
            KINDRAAPI_MCP_INFO: mcpInfo || '/path/to/mcp_info.json'
          }
        }
      }
    },
    null,
    2
  )

  return (
    <div className="settings-page">
      <div className="settings-card">
        <div className="section-title">项目</div>
        <Space direction="vertical" size={4}>
          <div>
            名称：<b>{project?.name ?? '-'}</b>
          </div>
          <div className="muted">项目 ID：{project?.project_id ?? '-'}</div>
          <div className="muted">
            存储位置：<span className="mono">{paths?.projectRoot}</span>
          </div>
        </Space>
      </div>

      <div className="settings-card">
        <CustomAttributesPanel projectId={project?.project_id} />
      </div>

      <div className="settings-card">
        <div className="section-title">环境与请求前缀</div>
        <Space style={{ marginBottom: 12 }}>
          <Select
            value={envId || undefined}
            style={{ width: 180 }}
            onChange={setEnvId}
            options={environments.map((item) => ({ value: item.env_id, label: item.name }))}
            placeholder="选择环境"
          />
          <Input
            value={envName}
            onChange={(e) => setEnvName(e.target.value)}
            style={{ width: 180 }}
            placeholder="环境名称"
          />
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            style={{ width: 320 }}
            placeholder="服务前缀，例如 https://api.example.com"
          />
          <Button type="primary" icon={<SaveOutlined />} onClick={() => void saveEnv()}>
            保存环境
          </Button>
        </Space>
        <VarEditor rows={envRows} onChange={setEnvRows} nameLabel="变量名" />
        <div className="muted" style={{ marginTop: 6 }}>
          请求 URL 不以 http(s) 开头时，会拼接到该前缀；变量用 {'{{name}}'} 引用。
        </div>
      </div>

      <div className="settings-card">
        <div className="section-title">全局变量</div>
        <VarEditor rows={globalRows} onChange={setGlobalRows} nameLabel="变量名" />
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={() => void saveGlobals()}
          style={{ marginTop: 10 }}
        >
          保存全局变量
        </Button>
      </div>

      <div className="settings-card">
        <div className="section-title">发送设置</div>
        {form ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Space>
              <span style={{ width: 120 }} className="muted">
                请求超时
              </span>
              <InputNumber
                min={0}
                step={1000}
                value={form.send_timeout}
                onChange={(value) => setForm({ ...form, send_timeout: Number(value ?? 0) })}
              />
              <span className="muted">毫秒，0 表示不限制</span>
            </Space>
            <Space>
              <span style={{ width: 120 }} className="muted">
                最大重定向次数
              </span>
              <InputNumber
                min={0}
                value={form.max_redirect_time}
                onChange={(value) => setForm({ ...form, max_redirect_time: Number(value ?? 0) })}
              />
            </Space>
            <Checkbox
              checked={form.auto_redirect > 0}
              onChange={(e) => setForm({ ...form, auto_redirect: e.target.checked ? 1 : -1 })}
            >
              自动跟随重定向
            </Checkbox>
            <Checkbox
              checked={form.follow_original_method > 0}
              onChange={(e) =>
                setForm({ ...form, follow_original_method: e.target.checked ? 1 : -1 })
              }
            >
              重定向后保持原请求方法
            </Checkbox>
            <Tooltip title="开发调试常用；生产环境建议关闭">
              <Checkbox
                checked={form.ignore_tls > 0}
                onChange={(e) => setForm({ ...form, ignore_tls: e.target.checked ? 1 : -1 })}
              >
                忽略 TLS 证书错误
              </Checkbox>
            </Tooltip>
            <Button type="primary" icon={<SaveOutlined />} onClick={() => void saveForm()}>
              保存发送设置
            </Button>
          </Space>
        ) : null}
      </div>

      <div className="settings-card">
        <div className="section-title">MCP 服务</div>
        {mcpForm ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Space wrap>
              <span className="muted" style={{ width: 120 }}>
                服务状态
              </span>
              <Switch
                checked={mcpForm.enabled}
                onChange={(enabled) => setMcpForm({ ...mcpForm, enabled })}
              />
              {mcpStatus?.running ? (
                <Tag color="success">
                  运行中 · {mcpStatus.host}:{mcpStatus.port}
                </Tag>
              ) : mcpStatus?.error ? (
                <Tag color="error">{mcpStatus.error}</Tag>
              ) : (
                <Tag>未启动</Tag>
              )}
            </Space>

            <Space wrap>
              <span className="muted" style={{ width: 120 }}>
                监听地址
              </span>
              <Input value={mcpForm.host} disabled style={{ width: 150 }} />
              <InputNumber
                min={1024}
                max={65535}
                value={mcpForm.port}
                onChange={(value) => setMcpForm({ ...mcpForm, port: Number(value ?? 39121) })}
                style={{ width: 130 }}
              />
              <span className="muted">仅监听本机回环地址</span>
            </Space>

            <Space wrap>
              <span className="muted" style={{ width: 120 }}>
                访问 token
              </span>
              <Input.Password
                value={mcpForm.token}
                onChange={(event) => setMcpForm({ ...mcpForm, token: event.target.value })}
                style={{ width: 360 }}
              />
              <Tooltip title="复制 token">
                <Button icon={<CopyOutlined />} onClick={() => void copyText(mcpForm.token)} />
              </Tooltip>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  void regenerateMcpToken()
                    .then(() => message.success('token 已重新生成，服务已重启'))
                    .catch((error: Error) => message.error(error.message))
                }}
              >
                重新生成
              </Button>
            </Space>

            <Space wrap>
              <span className="muted" style={{ width: 120 }}>
                写入权限
              </span>
              <Switch
                checked={mcpForm.allow_write}
                onChange={(allow_write) => setMcpForm({ ...mcpForm, allow_write })}
              />
              <span className="muted">允许创建 / 更新 / 删除接口、环境、变量与流程</span>
            </Space>

            <Space wrap>
              <span className="muted" style={{ width: 120 }}>
                执行权限
              </span>
              <Switch
                checked={mcpForm.allow_execute}
                onChange={(allow_execute) => setMcpForm({ ...mcpForm, allow_execute })}
              />
              <span className="muted">允许执行接口与流程</span>
            </Space>

            <div>
              <div className="muted" style={{ marginBottom: 4 }}>
                授权项目
              </div>
              <Checkbox.Group
                options={projects.map((item) => ({
                  label: item.name,
                  value: item.project_id
                }))}
                value={mcpForm.allowed_project_ids}
                onChange={(values) =>
                  setMcpForm({
                    ...mcpForm,
                    allowed_project_ids: values.map((value) => String(value))
                  })
                }
              />
            </div>

            <Space>
              <Button type="primary" icon={<SaveOutlined />} onClick={() => void saveMcpForm()}>
                保存 MCP 配置
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => void copyText(mcpSnippet)}>
                复制 Claude Desktop 配置
              </Button>
            </Space>

            <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
              描述文件：<span className="mono">{mcpInfo || '—'}</span>
              <br />
              stdio 入口：<span className="mono">{mcpStdio || '—'}</span>
            </div>

            <pre
              style={{
                margin: 0,
                background: 'var(--color-bg-page)',
                border: '1px solid var(--color-border)',
                padding: 8,
                borderRadius: 4,
                maxHeight: 180,
                overflow: 'auto',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                fontSize: 11.5,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {mcpSnippet}
            </pre>

            <Collapse
              size="small"
              items={[
                {
                  key: 'mcp-tools',
                  label: `已注册工具（${mcpTools.length}）`,
                  children: (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th align="left" style={{ padding: '4px 6px', borderBottom: '1px solid var(--color-border)' }}>
                            工具
                          </th>
                          <th align="left" style={{ padding: '4px 6px', borderBottom: '1px solid var(--color-border)' }}>
                            权限
                          </th>
                          <th align="left" style={{ padding: '4px 6px', borderBottom: '1px solid var(--color-border)' }}>
                            说明
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {mcpTools.map((tool) => (
                          <tr key={tool.name}>
                            <td className="mono" style={{ padding: '4px 6px', borderBottom: '1px solid var(--color-border)' }}>
                              {tool.name}
                            </td>
                            <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--color-border)' }}>
                              {tool.requires_write ? <Tag color="warning">write</Tag> : null}
                              {tool.requires_execute ? <Tag color="processing">execute</Tag> : null}
                              {!tool.requires_write && !tool.requires_execute ? (
                                <Tag>read</Tag>
                              ) : null}
                            </td>
                            <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--color-border)' }}>
                              {tool.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                }
              ]}
            />
          </Space>
        ) : (
          <div className="muted">MCP 配置未加载</div>
        )}
      </div>

      <div className="settings-card">
        <div className="section-title">开发者调试（CDP）</div>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap>
            <span className="muted" style={{ width: 120 }}>
              远程调试
            </span>
            <Switch
              checked={debugForm.enabled}
              onChange={(enabled) => setDebugForm({ ...debugForm, enabled })}
            />
            {debugActive?.active_port ? (
              debugForm.enabled ? (
                <Tag color="warning">
                  已生效 · 127.0.0.1:{debugActive.active_port}
                </Tag>
              ) : (
                <Tag color="warning">已保存关闭，重启后停止监听</Tag>
              )
            ) : debugForm.enabled ? (
              <Tag color="processing">已保存，重启后生效</Tag>
            ) : (
              <Tag>未启用</Tag>
            )}
          </Space>

          <Space wrap>
            <span className="muted" style={{ width: 120 }}>
              调试端口
            </span>
            <InputNumber
              min={1024}
              max={65535}
              value={debugForm.port}
              disabled={!debugForm.enabled}
              onChange={(value) => setDebugForm({ ...debugForm, port: Number(value ?? 9222) })}
              style={{ width: 130 }}
            />
            <span className="muted">仅监听本机回环地址</span>
          </Space>

          <Alert
            type="warning"
            showIcon
            message="CDP 没有鉴权"
            description="启用后，本机任意程序都能通过 DevTools 协议控制本应用（读写项目、发送请求、修改设置）。仅在需要调试时开启，用完请关闭；正式分发时保持关闭。"
          />

          {debugActive?.active_port ? (
            <div className="muted" style={{ fontSize: 11 }}>
              调试地址：
              <span className="mono">http://127.0.0.1:{debugActive.active_port}/json</span>
              <Button
                size="small"
                type="link"
                icon={<CopyOutlined />}
                onClick={() =>
                  void copyText(`http://127.0.0.1:${debugActive.active_port}/json`)
                }
              >
                复制
              </Button>
            </div>
          ) : null}

          <Button type="primary" icon={<SaveOutlined />} onClick={requestSaveDebug}>
            保存调试设置
          </Button>
        </Space>
      </div>

      <div className="settings-card">
        <div className="section-title">能力状态</div>
        <Space direction="vertical" size={4}>
          <span>
            <Tag color="success">M1</Tag> 接口 CRUD、环境/全局变量、HTTP 调试、发送记录
          </span>
          <span>
            <Tag color="success">M2</Tag> 流程编排、脚本、断言、条件/循环、运行记录
          </span>
          <span>
            <Tag color="success">M3</Tag> MCP stdio/TCP 桥、三层权限、项目/接口/执行/环境/变量/流程工具
          </span>
          <Divider style={{ margin: '8px 0' }} />
          <span className="muted">后续：设计契约、接口用例、压测、Mock、文档分享、字典、Git/回收站</span>
        </Space>
      </div>
    </div>
  )
}

function VarEditor({
  rows,
  onChange,
  nameLabel
}: {
  rows: VarRow[]
  onChange: (rows: VarRow[]) => void
  nameLabel: string
}): JSX.Element {
  const update = (index: number, patch: Partial<VarRow>): void => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  return (
    <div>
      <div className="kv-row muted" style={{ fontSize: 11 }}>
        <span>{nameLabel}</span>
        <span>当前值</span>
        <span>初始值</span>
        <span>说明</span>
        <span>启用</span>
        <span />
      </div>
      {rows.map((row, index) => (
        <div className="kv-row" key={index}>
          <Input
            size="small"
            value={row.key}
            onChange={(e) => update(index, { key: e.target.value })}
            placeholder="变量名"
          />
          <Input
            size="small"
            value={row.value}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder="当前值"
          />
          <Input
            size="small"
            value={row.initial}
            onChange={(e) => update(index, { initial: e.target.value })}
            placeholder="初始值"
          />
          <Input
            size="small"
            value={row.description}
            onChange={(e) => update(index, { description: e.target.value })}
            placeholder="说明"
          />
          <Checkbox
            checked={row.checked}
            onChange={(e) => update(index, { checked: e.target.checked })}
          />
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() => onChange([...rows, { key: '', value: '', initial: '', description: '', checked: true }])}
      >
        添加变量
      </Button>
    </div>
  )
}
