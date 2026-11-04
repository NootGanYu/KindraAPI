import { useEffect, useRef, useState } from 'react'
import {
  App as AntApp,
  Button,
  Empty,
  Input,
  Modal,
  Radio,
  Select,
  Switch,
  Tag
} from 'antd'
import {
  CloseOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type {
  BodyMode,
  CookieJar,
  Environment,
  GlobalVars,
  RequestModel
} from '@shared/types'
import { createRequest } from '@shared/factories'
import { useApp } from '../store'
import ParamTable from './ParamTable'

interface Props {
  open: boolean
  initialEnvId?: string
  onClose: () => void
}

type Pane =
  | { type: 'cookies' }
  | { type: 'globalParams' }
  | { type: 'globals' }
  | { type: 'env'; envId: string }

interface VarRow {
  key: string
  value: string
  initial: string
  description: string
  checked: boolean
}

interface GlobalRow {
  key: string
  value: string
  initial: string
  description: string
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

interface ServerRow {
  server_id: string
  name: string
  uri: string
}

function nextServerId(items: ServerRow[]): string {
  const used = new Set(items.map((item) => item.server_id))
  let suffix = 1
  while (used.has(String(suffix))) suffix += 1
  return String(suffix)
}

const BODY_MODES: Array<{ value: BodyMode; label: string }> = [
  { value: 'none', label: 'none' },
  { value: 'raw', label: 'raw' },
  { value: 'urlencoded', label: 'urlencoded' },
  { value: 'formdata', label: 'form-data' }
]

export default function EnvironmentModal({
  open,
  initialEnvId,
  onClose
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const project = useApp((s) => s.project)
  const environments = useApp((s) => s.environments)
  const currentEnvId = useApp((s) => s.currentEnvId)
  const reloadEnvironments = useApp((s) => s.reloadEnvironments)
  const setEnv = useApp((s) => s.setEnv)
  const addEnvironment = useApp((s) => s.addEnvironment)
  const projectId = project?.project_id ?? ''

  const [active, setActive] = useState<Pane>({ type: 'cookies' })

  // 环境设置
  const [envName, setEnvName] = useState('')
  const [servers, setServers] = useState<ServerRow[]>([])
  const [envRows, setEnvRows] = useState<VarRow[]>([])
  const [envSearch, setEnvSearch] = useState('')

  // 全局变量
  const [globals, setGlobals] = useState<GlobalRow[]>([])
  const [globalSearch, setGlobalSearch] = useState('')

  // 全局参数
  const [params, setParams] = useState<RequestModel>(createRequest())

  // Cookie 管理器
  const [jar, setJar] = useState<CookieJar | null>(null)
  const [domainInput, setDomainInput] = useState('')
  const jarRef = useRef<CookieJar | null>(null)

  const updateJar = (next: CookieJar): void => {
    jarRef.current = next
    setJar(next)
  }

  const activeEnv =
    active.type === 'env'
      ? environments.find((item) => item.env_id === active.envId) ?? null
      : null

  useEffect(() => {
    if (!open) return
    setActive({
      type: 'env',
      envId: initialEnvId || currentEnvId || environments[0]?.env_id || ''
    })
    // 只在打开时确定初始面板，环境列表刷新不重置当前选择。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialEnvId])

  useEffect(() => {
    if (!activeEnv) return
    setEnvName(activeEnv.name)
    setServers(
      (activeEnv.server_list?.length
        ? activeEnv.server_list
        : [{ server_id: '1', name: 'default', uri: '', sort: 1000 }]
      ).map((item) => ({
        server_id: item.server_id,
        name: item.name,
        uri: item.uri ?? ''
      }))
    )
    setEnvRows(
      Object.entries(activeEnv.env_var_list ?? {}).map(([key, value]) => ({
        key,
        value: value.current_value ?? '',
        initial: value.initial_value ?? '',
        description: value.description ?? '',
        checked: (value.is_checked ?? 1) > 0
      }))
    )
    setEnvSearch('')
  }, [activeEnv?.env_id, activeEnv?.updated_at])

  useEffect(() => {
    if (!open || !projectId) return
    if (active.type === 'globals') {
      void window.api.globals.get(projectId).then((result) => {
        if (!result.ok) {
          message.error(result.error)
          return
        }
        setGlobals(
          Object.entries(result.data.vars).map(([key, value]) => ({
            key,
            value: value.current_value ?? '',
            initial: value.initial_value ?? '',
            description: value.description ?? ''
          }))
        )
        setGlobalSearch('')
      })
    } else if (active.type === 'globalParams') {
      void window.api.globalParams.get(projectId).then((result) => {
        if (result.ok) setParams(result.data ?? createRequest())
        else message.error(result.error)
      })
    } else if (active.type === 'cookies') {
      void window.api.cookies.get(projectId).then((result) => {
        if (!result.ok) {
          message.error(result.error)
          return
        }
        updateJar(result.data)
      })
    }
  }, [open, active.type, projectId, message])

  const selectEnv = (envId: string): void => {
    setActive({ type: 'env', envId })
    void setEnv(envId)
  }

  const createEnv = async (): Promise<void> => {
    try {
      const env = await addEnvironment('新环境')
      setActive({ type: 'env', envId: env.env_id })
      message.success('环境已创建')
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const removeEnv = (): void => {
    if (!projectId || !activeEnv) return
    if (environments.length <= 1) {
      message.warning('至少保留一个环境')
      return
    }
    modal.confirm({
      title: `删除环境「${activeEnv.name}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.api.envs.remove(projectId, activeEnv.env_id)
        if (!result.ok) {
          message.error(result.error)
          return
        }
        await reloadEnvironments()
        message.success('环境已删除')
      }
    })
  }

  const saveEnv = async (closeAfter: boolean): Promise<void> => {
    if (!projectId || !activeEnv) return
    const duplicated = duplicateKeys(envRows)
    if (duplicated.length) {
      message.error(`变量名重复：${duplicated.join('、')}`)
      return
    }
    const envVarList: Environment['env_var_list'] = {}
    for (const row of envRows) {
      const key = row.key.trim()
      if (!key) continue
      envVarList[key] = {
        current_value: row.value,
        initial_value: row.initial,
        description: row.description,
        is_checked: row.checked ? 1 : -1
      }
    }
    const serverList = servers
      .filter((item) => item.name.trim() || item.uri.trim())
      .map((item, index) => ({
        server_id: item.server_id,
        name: item.name.trim() || `服务${index + 1}`,
        uri: item.uri.trim(),
        sort: (index + 1) * 1000
      }))
    const next: Environment = {
      ...activeEnv,
      name: envName.trim() || activeEnv.name,
      env_var_list: envVarList,
      server_list:
        serverList.length > 0
          ? serverList
          : [{ server_id: '1', name: 'default', uri: '', sort: 1000 }]
    }
    const result = await window.api.envs.save(projectId, next)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    await reloadEnvironments()
    message.success('环境已保存')
    if (closeAfter) onClose()
  }

  const saveGlobals = async (closeAfter: boolean): Promise<void> => {
    if (!projectId) return
    const duplicated = duplicateKeys(globals)
    if (duplicated.length) {
      message.error(`变量名重复：${duplicated.join('、')}`)
      return
    }
    const vars: GlobalVars['vars'] = {}
    for (const row of globals) {
      const key = row.key.trim()
      if (!key) continue
      vars[key] = {
        current_value: row.value,
        initial_value: row.initial,
        description: row.description
      }
    }
    const result = await window.api.globals.save(projectId, {
      project_id: projectId,
      vars,
      updated_at: new Date().toISOString()
    })
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success('全局变量已保存')
    if (closeAfter) onClose()
  }

  const saveGlobalParams = async (closeAfter: boolean): Promise<void> => {
    if (!projectId) return
    const result = await window.api.globalParams.save(projectId, params)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success('全局参数已保存')
    if (closeAfter) onClose()
  }

  const persistJar = async (next?: CookieJar): Promise<void> => {
    if (!projectId) return
    const payload = next ?? jarRef.current
    if (!payload) return
    const result = await window.api.cookies.save(projectId, payload)
    if (!result.ok) message.error(result.error)
  }

  const addDomain = (): void => {
    const value = domainInput.trim().toLowerCase()
    if (!value || !jar) return
    if (jar.domains.some((item) => item.domain === value)) {
      message.warning('域名已存在')
      return
    }
    const next: CookieJar = {
      ...jar,
      domains: [
        ...jar.domains,
        { domain: value, cookies: '', updated_at: new Date().toISOString() }
      ]
    }
    updateJar(next)
    void persistJar(next)
    setDomainInput('')
  }

  const saveCurrent = async (closeAfter: boolean): Promise<void> => {
    if (active.type === 'env') await saveEnv(closeAfter)
    else if (active.type === 'globals') await saveGlobals(closeAfter)
    else if (active.type === 'globalParams') await saveGlobalParams(closeAfter)
    else {
      await persistJar()
      message.success('Cookie 已保存')
      if (closeAfter) onClose()
    }
  }

  const filteredEnvRows = envRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const keyword = envSearch.trim().toLowerCase()
      if (!keyword) return true
      return (
        row.key.toLowerCase().includes(keyword) ||
        row.description.toLowerCase().includes(keyword)
      )
    })

  const filteredGlobals = globals
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const keyword = globalSearch.trim().toLowerCase()
      if (!keyword) return true
      return (
        row.key.toLowerCase().includes(keyword) ||
        row.description.toLowerCase().includes(keyword)
      )
    })

  const renderHeader = (title: string, subtitle?: string): JSX.Element => (
    <div className="env-pane-head">
      <div>
        <div className="env-pane-title">{title}</div>
        {subtitle ? <div className="env-pane-sub">{subtitle}</div> : null}
      </div>
    </div>
  )

  const renderEnv = (): JSX.Element => (
    <div className="env-pane">
      {renderHeader(
        '环境设置',
        '您可以在请求参数或者接口 URL 中引用环境变量，引用方法：{{ 变量名 }}'
      )}
      {!activeEnv ? (
        <Empty description="请选择或新建环境" />
      ) : (
        <>
          <div className="env-pane-row">
            <span className="env-label">环境名称</span>
            <Input
              value={envName}
              placeholder="请输入环境名称"
              onChange={(event) => setEnvName(event.target.value)}
            />
            <Button danger onClick={removeEnv}>
              删除环境
            </Button>
          </div>

          <div className="env-section-head">
            <span>服务（前置 URL）</span>
            <Button
              size="small"
              type="link"
              icon={<PlusOutlined />}
              onClick={() =>
                setServers((items) => [
                  ...items,
                  {
                    server_id: nextServerId(items),
                    name: `服务${items.length + 1}`,
                    uri: ''
                  }
                ])
              }
            >
              添加服务
            </Button>
          </div>
          <div className="env-table">
            <div className="env-tr env-thead server">
              <span>服务名</span>
              <span>前置URL</span>
              <span />
            </div>
            {servers.map((item, index) => (
              <div className="env-tr server" key={`${item.server_id}-${index}`}>
                <Input
                  value={item.name}
                  placeholder="服务名"
                  onChange={(event) =>
                    setServers((items) =>
                      items.map((row, i) =>
                        i === index ? { ...row, name: event.target.value } : row
                      )
                    )
                  }
                />
                <Input
                  value={item.uri}
                  placeholder="https://api.example.com"
                  onChange={(event) =>
                    setServers((items) =>
                      items.map((row, i) =>
                        i === index ? { ...row, uri: event.target.value } : row
                      )
                    )
                  }
                />
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setServers((items) => items.filter((_, i) => i !== index))
                  }
                />
              </div>
            ))}
          </div>

          <div className="env-section-head">
            <span>环境变量</span>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              style={{ width: 220 }}
              placeholder="搜索变量名、描述"
              value={envSearch}
              onChange={(event) => setEnvSearch(event.target.value)}
            />
          </div>
          <div className="env-table">
            <div className="env-tr env-thead">
              <span className="env-check" />
              <span>变量名</span>
              <span>当前值</span>
              <span>初始值</span>
              <span>描述</span>
              <span />
            </div>
            {filteredEnvRows.map(({ row, index }) => {
              return (
                <div className="env-tr" key={index}>
                  <span className="env-check">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(event) =>
                        setEnvRows((items) =>
                          items.map((item, i) =>
                            i === index ? { ...item, checked: event.target.checked } : item
                          )
                        )
                      }
                    />
                  </span>
                  <Input
                    value={row.key}
                    placeholder="变量名"
                    onChange={(event) =>
                      setEnvRows((items) =>
                        items.map((item, i) =>
                          i === index ? { ...item, key: event.target.value } : item
                        )
                      )
                    }
                  />
                  <Input
                    value={row.value}
                    placeholder="当前值"
                    onChange={(event) =>
                      setEnvRows((items) =>
                        items.map((item, i) =>
                          i === index ? { ...item, value: event.target.value } : item
                        )
                      )
                    }
                  />
                  <Input
                    value={row.initial}
                    placeholder="初始值"
                    onChange={(event) =>
                      setEnvRows((items) =>
                        items.map((item, i) =>
                          i === index ? { ...item, initial: event.target.value } : item
                        )
                      )
                    }
                  />
                  <Input
                    value={row.description}
                    placeholder="描述"
                    onChange={(event) =>
                      setEnvRows((items) =>
                        items.map((item, i) =>
                          i === index ? { ...item, description: event.target.value } : item
                        )
                      )
                    }
                  />
                  <Button
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => setEnvRows((items) => items.filter((_, i) => i !== index))}
                  />
                </div>
              )
            })}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() =>
                setEnvRows((items) => [
                  ...items,
                  { key: '', value: '', initial: '', description: '', checked: true }
                ])
              }
            >
              添加变量
            </Button>
          </div>
        </>
      )}
    </div>
  )

  const renderGlobals = (): JSX.Element => (
    <div className="env-pane">
      {renderHeader(
        '全局变量',
        '全局变量不受当前环境影响，只要在同一个项目下都会生效；引用方法同样是 {{变量名}}。'
      )}
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索变量名、描述"
        value={globalSearch}
        onChange={(event) => setGlobalSearch(event.target.value)}
        style={{ marginBottom: 10 }}
      />
      <div className="env-table">
        <div className="env-tr env-thead three">
          <span>变量名</span>
          <span>当前值</span>
          <span>初始值</span>
          <span>描述</span>
          <span />
        </div>
        {filteredGlobals.map(({ row, index }) => {
          return (
            <div className="env-tr three" key={index}>
              <Input
                value={row.key}
                placeholder="变量名"
                onChange={(event) =>
                  setGlobals((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, key: event.target.value } : item
                    )
                  )
                }
              />
              <Input
                value={row.value}
                placeholder="当前值"
                onChange={(event) =>
                  setGlobals((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, value: event.target.value } : item
                    )
                  )
                }
              />
              <Input
                value={row.initial}
                placeholder="初始值"
                onChange={(event) =>
                  setGlobals((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, initial: event.target.value } : item
                    )
                  )
                }
              />
              <Input
                value={row.description}
                placeholder="描述"
                onChange={(event) =>
                  setGlobals((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, description: event.target.value } : item
                    )
                  )
                }
              />
              <Button
                type="text"
                icon={<DeleteOutlined />}
                onClick={() => setGlobals((items) => items.filter((_, i) => i !== index))}
              />
            </div>
          )
        })}
        {filteredGlobals.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无全局变量" />
        ) : null}
        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={() => setGlobals((items) => [...items, { key: '', value: '', initial: '', description: '' }])}
        >
          添加变量
        </Button>
      </div>
    </div>
  )

  const renderGlobalParams = (): JSX.Element => (
    <div className="env-pane">
      {renderHeader(
        '全局参数',
        '设置全局请求参数（针对当前项目有效），发送请求时自动携带；全局 Body 参数仅在 formdata、urlencode 时生效。'
      )}
      <div className="env-param-tabs">
        <ParamTable
          title="Header"
          keyPlaceholder="Header 名"
          params={params.header?.parameter ?? []}
          onChange={(parameter) => setParams({ ...params, header: { parameter } })}
        />
        <ParamTable
          title="Query"
          keyPlaceholder="参数名"
          params={params.query?.parameter ?? []}
          onChange={(parameter) => setParams({ ...params, query: { parameter } })}
        />
        <ParamTable
          title="Cookie"
          keyPlaceholder="Cookie 名"
          params={params.cookie?.parameter ?? []}
          onChange={(parameter) => setParams({ ...params, cookie: { parameter } })}
        />
        <div className="env-section-head">
          <span>Body</span>
        </div>
        <Radio.Group
          value={params.body?.mode ?? 'none'}
          onChange={(event) =>
            setParams({
              ...params,
              body: { ...(params.body ?? {}), mode: event.target.value as BodyMode }
            })
          }
          options={BODY_MODES}
          optionType="button"
          size="small"
        />
        {params.body?.mode === 'raw' ? (
          <Input.TextArea
            autoSize={{ minRows: 4, maxRows: 10 }}
            value={params.body.raw ?? ''}
            placeholder="请求体内容"
            onChange={(event) =>
              setParams({
                ...params,
                body: { ...(params.body ?? { mode: 'raw' }), raw: event.target.value }
              })
            }
            style={{ marginTop: 8 }}
          />
        ) : null}
        {params.body?.mode === 'urlencoded' ? (
          <div style={{ marginTop: 8 }}>
            <ParamTable
              title="urlencoded"
              params={params.body.urlencoded ?? []}
              onChange={(urlencoded) =>
                setParams({
                  ...params,
                  body: { ...(params.body ?? { mode: 'urlencoded' }), urlencoded }
                })
              }
            />
          </div>
        ) : null}
        {params.body?.mode === 'formdata' ? (
          <div style={{ marginTop: 8 }}>
            <ParamTable
              title="form-data"
              params={params.body.formdata ?? []}
              onChange={(formdata) =>
                setParams({
                  ...params,
                  body: { ...(params.body ?? { mode: 'formdata' }), formdata }
                })
              }
            />
          </div>
        ) : null}
        <div className="env-section-head">
          <span>认证</span>
        </div>
        <div className="env-pane-row">
          <span className="env-label">类型</span>
          <Select
            style={{ width: 160 }}
            value={params.auth?.type ?? 'noauth'}
            onChange={(type) => setParams({ ...params, auth: { ...params.auth, type } })}
            options={[
              { value: 'noauth', label: 'noauth' },
              { value: 'bearer', label: 'Bearer Token' },
              { value: 'basic', label: 'Basic Auth' },
              { value: 'kv', label: 'Key/Value' }
            ]}
          />
          {params.auth?.type === 'bearer' ? (
            <Input
              style={{ flex: 1 }}
              placeholder="Token"
              value={params.auth?.bearer?.key ?? ''}
              onChange={(event) =>
                setParams({
                  ...params,
                  auth: {
                    ...params.auth,
                    bearer: { ...(params.auth?.bearer ?? { key: '' }), key: event.target.value }
                  }
                })
              }
            />
          ) : null}
          {params.auth?.type === 'basic' ? (
            <>
              <Input
                placeholder="用户名"
                value={params.auth?.basic?.username ?? ''}
                onChange={(event) =>
                  setParams({
                    ...params,
                    auth: {
                      ...params.auth,
                      basic: {
                        ...(params.auth?.basic ?? { username: '', password: '' }),
                        username: event.target.value
                      }
                    }
                  })
                }
              />
              <Input.Password
                placeholder="密码"
                value={params.auth?.basic?.password ?? ''}
                onChange={(event) =>
                  setParams({
                    ...params,
                    auth: {
                      ...params.auth,
                      basic: {
                        ...(params.auth?.basic ?? { username: '', password: '' }),
                        password: event.target.value
                      }
                    }
                  })
                }
              />
            </>
          ) : null}
          {params.auth?.type === 'kv' ? (
            <>
              <Input
                placeholder="Key"
                value={params.auth?.kv?.key ?? ''}
                onChange={(event) =>
                  setParams({
                    ...params,
                    auth: {
                      ...params.auth,
                      kv: {
                        ...(params.auth?.kv ?? { key: '', value: '', in: 'header' }),
                        key: event.target.value
                      }
                    }
                  })
                }
              />
              <Input
                placeholder="Value"
                value={params.auth?.kv?.value ?? ''}
                onChange={(event) =>
                  setParams({
                    ...params,
                    auth: {
                      ...params.auth,
                      kv: {
                        ...(params.auth?.kv ?? { key: '', value: '', in: 'header' }),
                        value: event.target.value
                      }
                    }
                  })
                }
              />
              <Select
                style={{ width: 110 }}
                value={params.auth?.kv?.in ?? 'header'}
                onChange={(location) =>
                  setParams({
                    ...params,
                    auth: {
                      ...params.auth,
                      kv: {
                        ...(params.auth?.kv ?? { key: '', value: '', in: 'header' }),
                        in: location as 'header' | 'query'
                      }
                    }
                  })
                }
                options={[
                  { value: 'header', label: 'Header' },
                  { value: 'query', label: 'Query' }
                ]}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )

  const renderCookies = (): JSX.Element => (
    <div className="env-pane">
      <div className="env-pane-head">
        <div className="env-pane-title">
          Cookie管理器{' '}
          {jar ? (
            <Switch
              size="small"
              checked={jar.enabled}
              onChange={(checked) => {
                const next = { ...jar, enabled: checked }
                updateJar(next)
                void persistJar(next)
              }}
            />
          ) : null}
        </div>
      </div>
      <div className="env-cookie-add">
        <Input
          placeholder="example.com"
          value={domainInput}
          onChange={(event) => setDomainInput(event.target.value)}
          onPressEnter={addDomain}
        />
        <Button type="primary" onClick={addDomain}>
          添加域名
        </Button>
      </div>
      {!jar || jar.domains.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无域名，添加后可在此维护 Cookie"
          style={{ marginTop: 60 }}
        />
      ) : (
        <div className="cookie-list">
          {jar.domains.map((item, index) => (
            <div className="cookie-row" key={item.domain}>
              <div className="cookie-domain">
                <Tag color="gold">{item.domain}</Tag>
                <span className="env-pane-sub">
                  匹配该域名及其子域，发送请求时自动合并到 Cookie 头
                </span>
                <span style={{ flex: 1 }} />
                <Button
                  type="text"
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => {
                    const next = {
                      ...jar,
                      domains: jar.domains.filter((_, i) => i !== index)
                    }
                    updateJar(next)
                    void persistJar(next)
                  }}
                />
              </div>
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder="a=1; b=2"
                value={item.cookies}
                onChange={(event) => {
                  const domains = jar.domains.map((row, i) =>
                    i === index ? { ...row, cookies: event.target.value } : row
                  )
                  updateJar({ ...jar, domains })
                }}
                onBlur={() => void persistJar()}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderPane = (): JSX.Element => {
    if (active.type === 'cookies') return renderCookies()
    if (active.type === 'globals') return renderGlobals()
    if (active.type === 'globalParams') return renderGlobalParams()
    return renderEnv()
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1000}
      title={null}
      destroyOnClose
      className="env-modal"
      styles={{ body: { padding: 0 } }}
    >
      <div className="env-modal-body">
        <aside className="env-modal-side">
          <button type="button" className="env-close" onClick={onClose}>
            <CloseOutlined />
          </button>
          <div className="env-nav-group">全局</div>
          <button
            type="button"
            className={`env-nav-row${active.type === 'cookies' ? ' active' : ''}`}
            onClick={() => setActive({ type: 'cookies' })}
          >
            Cookie管理器
          </button>
          <button
            type="button"
            className={`env-nav-row${active.type === 'globalParams' ? ' active' : ''}`}
            onClick={() => setActive({ type: 'globalParams' })}
          >
            全局参数
          </button>
          <button
            type="button"
            className={`env-nav-row${active.type === 'globals' ? ' active' : ''}`}
            onClick={() => setActive({ type: 'globals' })}
          >
            全局变量
          </button>

          <div className="env-nav-group">环境管理</div>
          {environments.map((env) => (
            <button
              key={env.env_id}
              type="button"
              className={`env-nav-row${
                active.type === 'env' && active.envId === env.env_id ? ' active' : ''
              }`}
              onClick={() => selectEnv(env.env_id)}
            >
              <span className="env-badge">默</span>
              {env.name}
            </button>
          ))}
          <div className="env-side-spacer" />
          <Button block icon={<PlusOutlined />} onClick={() => void createEnv()}>
            新建环境
          </Button>
        </aside>

        <section className="env-modal-main">
          <div className="env-modal-scroll">{renderPane()}</div>
          <div className="env-modal-footer">
            <Button onClick={() => void saveCurrent(true)}>保存并关闭</Button>
            <Button type="primary" onClick={() => void saveCurrent(false)}>
              保存
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  )
}
