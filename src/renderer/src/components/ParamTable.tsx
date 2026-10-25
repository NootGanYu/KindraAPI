import { useState } from 'react'
import { Checkbox, Input, Tooltip } from 'antd'
import {
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  RightOutlined
} from '@ant-design/icons'
import type { Param } from '@shared/types'
import { createParam } from '@shared/factories'
import { useApp } from '../store'
import DictionarySuggest from './schemas/DictionarySuggest'

interface Props {
  params: Param[]
  onChange: (next: Param[]) => void
  title?: string
  keyPlaceholder?: string
  valuePlaceholder?: string
  showDescription?: boolean
}

export default function ParamTable({
  params,
  onChange,
  title = '公共参数',
  keyPlaceholder = '参数名',
  valuePlaceholder = '参数值',
  showDescription = true
}: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const projectId = useApp((state) => state.project?.project_id ?? '')

  const update = (index: number, patch: Partial<Param>): void => {
    onChange(params.map((param, i) => (i === index ? { ...param, ...patch } : param)))
  }

  const add = (): void => {
    onChange([...params, createParam()])
  }

  const allChecked = params.length > 0 && params.every((param) => param.is_checked > 0)
  const someChecked = params.some((param) => param.is_checked > 0)
  const toggleAll = (): void => {
    const value = allChecked ? -1 : 1
    onChange(params.map((param) => ({ ...param, is_checked: value })))
  }

  return (
    <div className="param-section">
      <div className="param-section-head">
        <button
          className="param-section-toggle"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? (
            <RightOutlined style={{ fontSize: 9 }} />
          ) : (
            <DownOutlined style={{ fontSize: 9 }} />
          )}
        </button>
        <span className="param-section-title">{title}</span>
        <Tooltip title="添加参数">
          <button className="param-add-mini" onClick={add}>
            <PlusOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
      </div>

      {collapsed ? null : (
        <div className={`param-table${showDescription ? '' : ' no-desc'}`}>
          <div className="param-tr param-thead">
            <div className="param-td param-check">
              <Checkbox
                checked={allChecked}
                indeterminate={!allChecked && someChecked}
                onChange={toggleAll}
              />
            </div>
            <div className="param-td param-name">参数名</div>
            <div className="param-td param-value">参数值</div>
            {showDescription ? <div className="param-td param-desc">描述</div> : null}
          </div>

          {params.map((param, index) => (
            <div className="param-tr" key={param.param_id}>
              <div className="param-td param-check">
                <Checkbox
                  checked={param.is_checked > 0}
                  onChange={(event) =>
                    update(index, { is_checked: event.target.checked ? 1 : -1 })
                  }
                />
              </div>
              <div className="param-td param-name">
                <Input
                  variant="borderless"
                  value={param.key}
                  placeholder={keyPlaceholder}
                  onChange={(event) => update(index, { key: event.target.value })}
                  onPressEnter={() => {
                    if (index === params.length - 1) add()
                  }}
                />
              </div>
              <div className="param-td param-value">
                <Input
                  variant="borderless"
                  value={param.value}
                  placeholder={valuePlaceholder}
                  onChange={(event) => update(index, { value: event.target.value })}
                  onPressEnter={() => {
                    if (index === params.length - 1) add()
                  }}
                />
              </div>
              {showDescription ? (
                <div className="param-td param-desc">
                  {projectId ? (
                    <DictionarySuggest
                      projectId={projectId}
                      value={param.description ?? ''}
                      placeholder="描述"
                      size="small"
                      onChange={(value) => update(index, { description: value })}
                    />
                  ) : (
                    <Input
                      variant="borderless"
                      value={param.description ?? ''}
                      placeholder="描述"
                      onChange={(event) => update(index, { description: event.target.value })}
                    />
                  )}
                </div>
              ) : null}
              <div className="param-actions">
                <Tooltip title="删除">
                  <button
                    className="param-delete"
                    onClick={() => onChange(params.filter((_, i) => i !== index))}
                  >
                    <DeleteOutlined style={{ fontSize: 12 }} />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}

          {params.length === 0 ? (
            <button className="param-add-row" onClick={add}>
              <PlusOutlined style={{ fontSize: 12 }} /> 添加参数
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
