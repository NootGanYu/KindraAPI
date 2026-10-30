import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
  Tree,
  TreeSelect
} from 'antd'
import type { DataNode } from 'antd/es/tree'
import type {
  DocScope,
  DocSettings,
  DocShare,
  DocShareInput,
  TargetSummary
} from '@shared/types'
import { createDocSettings } from '@shared/factories'

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
    openapi: false
  }))
  const [saving, setSaving] = useState(false)

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
      openapi: settings.openapi
    })
  }, [open, initialKey, lockScope, lockTarget, lockTargetName, projectName])

  const patchDraft = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
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
        openapi: draft.openapi
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

        {lockScope ? (
          <div className="docs-field">
            <label>分享范围</label>
            <div className="docs-hint" style={{ marginTop: 0 }}>
              当前接口：{lockTargetName || lockTarget || '—'}
            </div>
          </div>
        ) : (
          <>
            <div className="docs-field">
              <label>分享范围</label>
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
            </div>

            <div className="docs-field docs-target-picker">
              {draft.scope === 'project' ? (
                <div className="docs-hint">
                  将分享「{projectName || '当前项目'}」内全部接口，共 {apiCount} 个。
                </div>
              ) : draft.scope === 'custom' ? (
                <>
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
                  <div className="docs-hint">勾选目录会包含其下全部接口。</div>
                </>
              ) : (
                <TreeSelect
                  style={{ width: '100%' }}
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
          </>
        )}

        <div className="docs-field-row">
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
          </div>
          <div className="docs-field">
            <label>有效期</label>
            <div className="docs-inline">
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
          </div>
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

        <div className="docs-field docs-switch-row">
          <div>
            <label style={{ margin: 0 }}>允许 OpenAPI 导出</label>
            <div className="docs-hint">开启后访问者可下载 OpenAPI 3.0 文档。</div>
          </div>
          <Switch
            checked={draft.openapi}
            onChange={(checked) => patchDraft({ openapi: checked })}
          />
        </div>
      </div>
    </Modal>
  )
}
