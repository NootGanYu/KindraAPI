import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  App as AntApp,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
  Tooltip,
  Tree,
  TreeSelect
} from 'antd'
import type { DataNode } from 'antd/es/tree'
import type {
  CustomAttribute,
  DocScope,
  DocSettings,
  DocShare,
  DocShareInput,
  Environment,
  OpenApiVersion,
  TargetSummary
} from '@shared/types'
import { createDocSettings } from '@shared/factories'

function Hint({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Tooltip title={children} placement="top">
      <span className="docs-hint">{children}</span>
    </Tooltip>
  )
}

const DEFAULT_LOGO_KEY = 'kindra.docs.defaultLogo'

function readDefaultLogo(): string {
  try {
    const value = localStorage.getItem(DEFAULT_LOGO_KEY)
    return value && value.startsWith('data:image/') ? value : ''
  } catch {
    return ''
  }
}

export interface DocShareInitial {
  shareId?: string
  name?: string
  scope?: DocScope
  targetIds?: string[]
  settings?: Partial<DocSettings>
}

interface Props {
  open: boolean
  projectId: string
  projectName: string
  targets: TargetSummary[]
  initial?: DocShareInitial
  lockScope?: DocScope
  lockTarget?: string
  lockTargetName?: string
  onClose: () => void
  onSaved: (share: DocShare) => void
}

type ExpireMode = 'permanent' | '7' | '30' | 'custom'

interface DocTreeNode {
  key: string
  title: string
  targetType: 'folder' | 'api'
  children: DocTreeNode[]
}

interface SelectNode {
  value: string
  title: string
  disabled?: boolean
  children?: SelectNode[]
}

interface Draft {
  shareId?: string
  name: string
  scope: DocScope
  targetIds: string[]
  passwordEnabled: boolean
  password: string
  expireMode: ExpireMode
  customDays: number
  showRequest: boolean
  showBody: boolean
  showResponse: boolean
  showHeaders: boolean
  showScripts: boolean
  showDesign: boolean
  showCases: boolean
  openapi: boolean
  openapiVersion: OpenApiVersion
  logo: string
  envId: string
  attributeList: string[]
  allowDebug: boolean
}

function buildTree(targets: TargetSummary[]): DocTreeNode[] {
  const byParent = new Map<string, TargetSummary[]>()
  for (const target of targets) {
    const list = byParent.get(target.parent_id) ?? []
    list.push(target)
    byParent.set(target.parent_id, list)
  }
  const walk = (parentId: string): DocTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hans-CN'))
      .map((target) => ({
        key: target.target_id,
        title: target.name,
        targetType: target.target_type,
        children: target.target_type === 'folder' ? walk(target.target_id) : []
      }))
  return walk('0')
}

function toSelectData(nodes: DocTreeNode[], selectable: 'folder' | 'api'): SelectNode[] {
  return nodes.map((node) => ({
    value: node.key,
    title: node.title,
    disabled: node.targetType !== selectable,
    children: node.children.length ? toSelectData(node.children, selectable) : undefined
  }))
}

function toCheckData(nodes: DocTreeNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.key,
    title: node.title,
    children: node.children.length ? toCheckData(node.children) : undefined
  }))
}

function expireModeOf(days: number): ExpireMode {
  if (days === -1) return 'permanent'
  if (days === 7) return '7'
  if (days === 30) return '30'
  return 'custom'
}

function expireDaysOf(draft: Draft): number {
  if (draft.expireMode === 'permanent') return -1
  if (draft.expireMode === '7') return 7
  if (draft.expireMode === '30') return 30
  return Math.max(1, Math.min(3650, Math.round(draft.customDays || 1)))
}

export default function DocShareDialog({
  open,
  projectId,
  projectName,
  targets,
  initial,
  lockScope,
  lockTarget,
  lockTargetName,
  onClose,
  onSaved
}: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const [draft, setDraft] = useState<Draft>(() => ({
    name: '',
    scope: lockScope ?? 'project',
    targetIds: lockTarget ? [lockTarget] : [],
    passwordEnabled: false,
    password: '',
    expireMode: 'permanent',
    customDays: 7,
    showRequest: true,
    showBody: true,
    showResponse: true,
    showHeaders: true,
    showScripts: false,
    showDesign: true,
    showCases: true,
    openapi: true,
    openapiVersion: '3.0',
    logo: '',
    envId: '',
    attributeList: [],
    allowDebug: false
  }))
  const [saving, setSaving] = useState(false)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [attributes, setAttributes] = useState<CustomAttribute[]>([])

  useEffect(() => {
    if (!open || !projectId) return
    void window.api.envs.list(projectId).then((result) => {
      if (result.ok) setEnvironments(result.data)
    })
    void window.api.attributes.list(projectId).then((result) => {
      if (result.ok) setAttributes(result.data.filter((item) => item.enable))
    })
  }, [open, projectId])

  const defaultAttributesApplied = useRef(false)

  useEffect(() => {
    if (!open) {
      defaultAttributesApplied.current = false
      return
    }
    if (initial || defaultAttributesApplied.current || attributes.length === 0) return
    defaultAttributesApplied.current = true
    setDraft((current) =>
      current.attributeList.length
        ? current
        : { ...current, attributeList: attributes.map((item) => item.attribute_id) }
    )
  }, [open, initial, attributes])

  const tree = useMemo(() => buildTree(targets), [targets])
  const apiCount = useMemo(
    () => targets.filter((target) => target.target_type === 'api').length,
    [targets]
  )
  const initialKey = JSON.stringify(initial ?? null)

  useEffect(() => {
    if (!open) return
    const settings = createDocSettings(initial?.settings)
    const scope = lockScope ?? initial?.scope ?? 'project'
    const targetIds = lockTarget ? [lockTarget] : initial?.targetIds ?? []
    setDraft({
      shareId: initial?.shareId,
      name:
        initial?.name?.trim() ||
        lockTargetName ||
        (projectName ? `${projectName} 接口文档` : '接口文档'),
      scope,
      targetIds,
      passwordEnabled: Boolean(settings.password),
      password: settings.password,
      expireMode: expireModeOf(settings.expire_days),
      customDays: settings.expire_days > 0 ? settings.expire_days : 7,
      showRequest: settings.show_request,
      showBody: settings.show_body,
      showResponse: settings.show_response,
      showHeaders: settings.show_headers,
      showScripts: settings.show_scripts,
      showDesign: settings.show_design,
      showCases: settings.show_cases,
      openapi: settings.openapi,
      openapiVersion: settings.openapi_version ?? '3.0',
      logo: settings.logo || readDefaultLogo(),
      envId: settings.env_id ?? '',
      attributeList: settings.attribute_list ?? [],
      allowDebug: settings.allow_debug === true
    })
  }, [open, initialKey, lockScope, lockTarget, lockTargetName, projectName])

  const patchDraft = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const logoInput = useRef<HTMLInputElement>(null)
  const MAX_LOGO_INPUT_BYTES = 10 * 1024 * 1024
  const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  const LOGO_MAX_SIDE = 256
  const LOGO_MAX_DATA_URL = 190 * 1024

  const compressLogo = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.onload = () => {
        const image = new Image()
        image.onerror = () => reject(new Error('无法解析图片'))
        image.onload = () => {
          const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(image.width, image.height))
          const width = Math.max(1, Math.round(image.width * scale))
          const height = Math.max(1, Math.round(image.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          if (!context) {
            reject(new Error('无法处理图片'))
            return
          }
          context.drawImage(image, 0, 0, width, height)
          let quality = 0.92
          let dataUrl = canvas.toDataURL('image/webp', quality)
          while (dataUrl.length > LOGO_MAX_DATA_URL && quality > 0.5) {
            quality -= 0.1
            dataUrl = canvas.toDataURL('image/webp', quality)
          }
          if (dataUrl.length > LOGO_MAX_DATA_URL) {
            reject(new Error('图片压缩后仍然过大，请换一张'))
            return
          }
          resolve(dataUrl)
        }
        image.src = String(reader.result ?? '')
      }
      reader.readAsDataURL(file)
    })

  const pickLogo = (file: File | undefined): void => {
    if (!file) return
    if (!LOGO_TYPES.includes(file.type)) {
      message.warning('仅支持 PNG / JPEG / WebP / GIF')
      return
    }
    if (file.size > MAX_LOGO_INPUT_BYTES) {
      message.warning('原始图片请小于 10MB')
      return
    }
    void compressLogo(file)
      .then((logo) => {
        patchDraft({ logo })
        try {
          localStorage.setItem(DEFAULT_LOGO_KEY, logo)
        } catch {
          // 本地存储不可用时仍保留本次分享的 logo。
        }
        message.success('Logo 已保存，后续分享将默认使用')
      })
      .catch((error: Error) => message.error(error.message))
  }

  const changeScope = (scope: DocScope): void => {
    setDraft((current) => ({
      ...current,
      scope,
      targetIds: [],
      name: current.name.trim()
        ? current.name
        : scope === 'project' && projectName
          ? `${projectName} 接口文档`
          : current.name
    }))
  }

  const save = async (): Promise<void> => {
    if (!projectId) {
      message.error('项目未就绪')
      return
    }
    const name = draft.name.trim()
    const scope = lockScope ?? draft.scope
    const targetIds = lockTarget ? [lockTarget] : draft.targetIds
    if (!name) {
      message.warning('请输入分享名称')
      return
    }
    if (scope !== 'project' && targetIds.length === 0) {
      message.warning(scope === 'folder' ? '请选择要分享的目录' : '请选择要分享的接口')
      return
    }
    if (draft.passwordEnabled && !draft.password) {
      message.warning('请输入访问密码')
      return
    }

    const input: DocShareInput = {
      name,
      scope,
      target_ids: scope === 'project' ? [] : targetIds,
      settings: {
        password: draft.passwordEnabled ? draft.password : '',
        expire_days: expireDaysOf(draft),
        show_request: draft.showRequest,
        show_body: draft.showBody,
        show_response: draft.showResponse,
        show_headers: draft.showHeaders,
        show_scripts: draft.showScripts,
        show_design: draft.showDesign,
        show_cases: draft.showCases,
        openapi: draft.openapi,
        openapi_version: draft.openapiVersion,
        logo: draft.logo,
        env_id: draft.envId,
        attribute_list: draft.attributeList,
        allow_debug: draft.allowDebug
      }
    }

    setSaving(true)
    try {
      const result = draft.shareId
        ? await window.api.docs.update(projectId, draft.shareId, input)
        : await window.api.docs.create(projectId, input)
      if (!result.ok) {
        message.error(result.error)
        return
      }
      onSaved(result.data)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={draft.shareId ? '编辑分享' : '新建分享'}
      open={open}
      width={600}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => void save()}
      onCancel={onClose}
      destroyOnClose
    >
      <div className="docs-form">
        <div className="docs-field">
          <label>分享名称</label>
          <Input
            value={draft.name}
            placeholder="请输入分享名称"
            onChange={(event) => patchDraft({ name: event.target.value })}
          />
        </div>

        {lockScope ? null : (
          <div className="docs-field docs-scope-row">
            <label>分享范围</label>
            <div className="docs-scope-control">
              <Radio.Group
                value={draft.scope}
                size="small"
                optionType="button"
                buttonStyle="solid"
                onChange={(event) => changeScope(event.target.value as DocScope)}
              >
                <Radio.Button value="project">项目</Radio.Button>
                <Radio.Button value="folder">目录</Radio.Button>
                <Radio.Button value="api">接口</Radio.Button>
                <Radio.Button value="custom">自定义</Radio.Button>
              </Radio.Group>
              {draft.scope === 'project' ? (
                <Hint>
                  将分享「{projectName || '当前项目'}」内全部接口，共 {apiCount} 个。
                </Hint>
              ) : draft.scope === 'custom' ? (
                <div className="docs-target-picker" style={{ width: '100%' }}>
                  <Tree
                    checkable
                    selectable={false}
                    defaultExpandAll
                    treeData={toCheckData(tree)}
                    checkedKeys={draft.targetIds}
                    onCheck={(keys) => {
                      const list = Array.isArray(keys) ? keys : keys.checked
                      patchDraft({ targetIds: list.map(String) })
                    }}
                  />
                  <Hint>勾选目录会包含其下全部接口。</Hint>
                </div>
              ) : (
                <TreeSelect
                  style={{ flex: 1, minWidth: 180 }}
                  placeholder={draft.scope === 'folder' ? '请选择目录' : '请选择接口'}
                  value={draft.targetIds[0]}
                  treeData={toSelectData(tree, draft.scope === 'folder' ? 'folder' : 'api')}
                  treeDefaultExpandAll
                  showSearch
                  treeNodeFilterProp="title"
                  onChange={(value) =>
                    patchDraft({ targetIds: value ? [String(value)] : [] })
                  }
                />
              )}
            </div>
          </div>
        )}

        <div className="docs-field">
          <label>展示环境</label>
          <Select
            allowClear
            style={{ width: '100%' }}
            placeholder="不解析变量，按变量名原样展示"
            value={draft.envId || undefined}
            onChange={(value) => patchDraft({ envId: value ?? '' })}
            options={environments.map((item) => ({ value: item.env_id, label: item.name }))}
          />
          <Hint>
            选择后，文档中的 {'{{变量}}'} 会替换为该环境的当前值，并在页面标注所用环境。
          </Hint>
        </div>

        {attributes.length ? (
          <div className="docs-field">
            <label>展示属性</label>
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder="选择要在文档中展示的接口属性"
              value={draft.attributeList}
              options={attributes.map((item) => ({
                value: item.attribute_id,
                label: item.field_name
              }))}
              onChange={(value) => patchDraft({ attributeList: value })}
            />
            <Hint>未选择的属性不会出现在分享文档中。</Hint>
          </div>
        ) : null}

        <div className="docs-field">
          <label>访问方式</label>
          <Radio.Group
            value={draft.passwordEnabled ? 'password' : 'public'}
            size="small"
            onChange={(event) =>
              patchDraft({ passwordEnabled: event.target.value === 'password' })
            }
          >
            <Radio value="public">公开访问</Radio>
            <Radio value="password">密码访问</Radio>
          </Radio.Group>
          <span className="docs-inline-label">有效期</span>
          <Select
            value={draft.expireMode}
            style={{ width: 126 }}
            onChange={(value) => patchDraft({ expireMode: value as ExpireMode })}
            options={[
              { value: 'permanent', label: '永久有效' },
              { value: '7', label: '7 天' },
              { value: '30', label: '30 天' },
              { value: 'custom', label: '自定义' }
            ]}
          />
          {draft.expireMode === 'custom' ? (
            <InputNumber
              min={1}
              max={3650}
              value={draft.customDays}
              addonAfter="天"
              onChange={(value) => patchDraft({ customDays: Number(value ?? 1) })}
            />
          ) : null}
        </div>

        {draft.passwordEnabled ? (
          <div className="docs-field">
            <label>访问密码</label>
            <Input.Password
              value={draft.password}
              placeholder="访问者需要输入此密码"
              onChange={(event) => patchDraft({ password: event.target.value })}
            />
          </div>
        ) : null}

        <div className="docs-field">
          <label>字段展示</label>
          <div className="docs-checks">
            <Checkbox
              checked={draft.showRequest}
              onChange={(event) => patchDraft({ showRequest: event.target.checked })}
            >
              请求参数
            </Checkbox>
            <Checkbox
              checked={draft.showBody}
              onChange={(event) => patchDraft({ showBody: event.target.checked })}
            >
              请求体
            </Checkbox>
            <Checkbox
              checked={draft.showResponse}
              onChange={(event) => patchDraft({ showResponse: event.target.checked })}
            >
              响应示例
            </Checkbox>
            <Checkbox
              checked={draft.showHeaders}
              onChange={(event) => patchDraft({ showHeaders: event.target.checked })}
            >
              响应头 / Cookie
            </Checkbox>
            <Checkbox
              checked={draft.showScripts}
              onChange={(event) => patchDraft({ showScripts: event.target.checked })}
            >
              前后脚本
            </Checkbox>
            <Checkbox
              checked={draft.showDesign}
              onChange={(event) => patchDraft({ showDesign: event.target.checked })}
            >
              接口设计
            </Checkbox>
            <Checkbox
              checked={draft.showCases}
              onChange={(event) => patchDraft({ showCases: event.target.checked })}
            >
              接口用例
            </Checkbox>
          </div>
        </div>

        <div className="docs-field">
          <label>分享 Logo</label>
          <div className="docs-inline">
            {draft.logo ? (
              <img
                src={draft.logo}
                alt=""
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '1px solid var(--color-border, #eee)'
                }}
              />
            ) : null}
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(event) => {
                pickLogo(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <Button size="small" onClick={() => logoInput.current?.click()}>
              {draft.logo ? '更换' : '上传'}
            </Button>
            {draft.logo ? (
              <Button
                size="small"
                onClick={() => {
                  patchDraft({ logo: '' })
                  try {
                    localStorage.removeItem(DEFAULT_LOGO_KEY)
                  } catch {
                    // 本地存储不可用时仅清除本次分享的 logo。
                  }
                }}
              >
                移除
              </Button>
            ) : null}
          </div>
          <Hint>支持 PNG / JPEG / WebP / GIF，上传后自动压缩到 256×256 以内；GIF 会转为静态图。</Hint>
        </div>

        <div className="docs-field">
          <label>允许 OpenAPI 导出</label>
          <Select
            size="small"
            style={{ width: 132 }}
            disabled={!draft.openapi}
            value={draft.openapiVersion}
            onChange={(value) => patchDraft({ openapiVersion: value as OpenApiVersion })}
            options={[
              { value: '3.1', label: 'OpenAPI 3.1' },
              { value: '3.0', label: 'OpenAPI 3.0' },
              { value: '2.0', label: 'Swagger 2.0' }
            ]}
          />
          <Switch
            checked={draft.openapi}
            onChange={(checked) => patchDraft({ openapi: checked })}
          />
          <Hint>开启后访问者可下载 OpenAPI / Swagger 文档。</Hint>
        </div>

        <div className="docs-field">
          <label>允许在线调试</label>
          <Switch
            checked={draft.allowDebug}
            onChange={(checked) => patchDraft({ allowDebug: checked })}
          />
          <Hint>
            访问者可在分享页直接发送请求；只允许调用本次分享范围内的接口。
          </Hint>
        </div>
      </div>
    </Modal>
  )
}
