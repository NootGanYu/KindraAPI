import { useEffect, useMemo, useState } from 'react'
import { Alert, App as AntApp, Button, Input, Modal, Select, Space, Typography } from 'antd'
import type { TargetSummary, TargetTransferMode, TargetTransferPreview } from '@shared/types'
import { hasLocalEdits, useApp } from '../store'

interface Props {
  item: TargetSummary | null
  mode: TargetTransferMode
  onClose: () => void
}

export default function TargetTransferDialog({ item, mode, onClose }: Props): JSX.Element {
  const { message, notification } = AntApp.useApp()
  const project = useApp((s) => s.project)
  const projects = useApp((s) => s.projects)
  const tabs = useApp((s) => s.tabs)
  const createProjectOnly = useApp((s) => s.createProjectOnly)
  const previewTargetTransfer = useApp((s) => s.previewTargetTransfer)
  const transferTargetToProject = useApp((s) => s.transferTargetToProject)
  const selectProject = useApp((s) => s.selectProject)

  const action = mode === 'move' ? '移动' : '复制'
  const [destinationId, setDestinationId] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [preview, setPreview] = useState<TargetTransferPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDestinationId('')
    setCreating(false)
    setNewName('')
    setPreview(null)
    setError('')
  }, [item?.target_id, mode])

  const options = useMemo(
    () =>
      projects
        .filter((entry) => entry.project_id !== project?.project_id)
        .map((entry) => ({ value: entry.project_id, label: entry.name })),
    [projects, project?.project_id]
  )

  useEffect(() => {
    if (!item || !destinationId) {
      setPreview(null)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    previewTargetTransfer(item.target_id, destinationId, mode)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setPreview(null)
          setError(reason.message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [item?.target_id, destinationId, mode, previewTargetTransfer])

  const createProject = async (): Promise<void> => {
    const name = newName.trim()
    if (!name || creatingBusy) return
    setCreatingBusy(true)
    try {
      const created = await createProjectOnly(name)
      setCreating(false)
      setNewName('')
      setDestinationId(created.project_id)
    } catch (reason) {
      message.error((reason as Error).message)
    } finally {
      setCreatingBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!item || !destinationId || submitting) return
    setSubmitting(true)
    try {
      const result = await transferTargetToProject(item.target_id, destinationId, mode)
      const destinationName =
        projects.find((entry) => entry.project_id === destinationId)?.name ?? '目标项目'
      onClose()
      notification.success({
        message: `已${action}到「${destinationName}」`,
        description: `${result.folder_count} 个目录、${result.api_count} 个接口已${action}。`,
        duration: 8,
        btn: (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              notification.destroy()
              void selectProject(destinationId)
            }}
          >
            打开目标项目
          </Button>
        )
      })
    } catch (reason) {
      message.error((reason as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const blocked = Boolean(preview && !preview.can_transfer)
  const dirtyNames = preview
    ? preview.target_ids
        .filter((targetId) => hasLocalEdits(targetId))
        .map((targetId) => tabs.find((tab) => tab.id === targetId)?.name ?? targetId)
    : []
  const renameNotice =
    preview && item && preview.root_name_after !== item.name
      ? `目标项目已有同名节点，将重命名为「${preview.root_name_after}」。`
      : ''

  return (
    <Modal
      title={item ? `${action}「${item.name}」到项目` : `${action}到项目`}
      open={Boolean(item)}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={action}
      confirmLoading={submitting}
      okButtonProps={{
        disabled: !destinationId || loading || blocked || dirtyNames.length > 0 || submitting
      }}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Select
          placeholder="选择目标项目"
          style={{ width: '100%' }}
          value={destinationId || undefined}
          options={options}
          onChange={setDestinationId}
          showSearch
          optionFilterProp="label"
        />
        {creating ? (
          <Space.Compact style={{ width: '100%' }}>
            <Input
              autoFocus
              value={newName}
              placeholder="新项目名称"
              onChange={(event) => setNewName(event.target.value)}
              onPressEnter={() => void createProject()}
            />
            <Button loading={creatingBusy} onClick={() => void createProject()}>
              创建并选择
            </Button>
            <Button onClick={() => setCreating(false)}>取消</Button>
          </Space.Compact>
        ) : (
          <Button type="link" style={{ padding: 0 }} onClick={() => setCreating(true)}>
            新建项目并{action}
          </Button>
        )}

        {loading ? <Typography.Text type="secondary">正在检查关联数据…</Typography.Text> : null}
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {dirtyNames.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            message="有未保存的修改"
            description={`${action}前请先保存或关闭：${dirtyNames.join('、')}`}
          />
        ) : null}

        {preview ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text>
              将{action} {preview.folder_count} 个目录、{preview.api_count}{' '}
              个接口到目标项目根目录。
            </Typography.Text>
            {mode === 'copy' ? (
              <Typography.Text type="secondary">复制不会删除源项目中的内容。</Typography.Text>
            ) : null}
            {renameNotice ? <Alert type="info" showIcon message={renameNotice} /> : null}
            {preview.shares.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message={`源项目有 ${preview.shares.length} 个分享包含这些节点`}
                description={`移动后这些分享将缺少对应接口：${preview.shares
                  .slice(0, 5)
                  .map((share) => share.name)
                  .join('、')}${preview.shares.length > 5 ? ' 等' : ''}`}
              />
            ) : null}
            {preview.flows.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message={`源项目有 ${preview.flows.length} 条流程引用这些节点`}
                description={`移动后流程中的相关步骤将失效：${preview.flows
                  .slice(0, 5)
                  .map((flow) => flow.name)
                  .join('、')}${preview.flows.length > 5 ? ' 等' : ''}`}
              />
            ) : null}
            {preview.source_key_conflicts.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="source_key 冲突"
                description={`以下接口与目标项目已有 source_key 冲突，${action}后将清除该字段：${preview.source_key_conflicts.join('、')}`}
              />
            ) : null}
            {preview.server_reset_ids.length > 0 ? (
              <Alert
                type="info"
                showIcon
                message="服务前缀将重置"
                description={`以下接口的 server_id 在目标项目不存在，${action}后将使用目标项目的默认服务：${preview.server_reset_ids.join('、')}`}
              />
            ) : null}
            {preview.model_blockers.length > 0 ? (
              <Alert
                type="error"
                showIcon
                message={`目标项目缺少数据模型，无法${action}`}
                description={preview.model_blockers
                  .map(
                    (blocker) =>
                      `${blocker.target_name}（${
                        blocker.kind === 'request-body' ? '请求体' : '响应示例'
                      }：${blocker.model_id}）`
                  )
                  .join('；')}
              />
            ) : null}
          </Space>
        ) : null}
      </Space>
    </Modal>
  )
}
