import { useRef, useState } from 'react'
import { Button, Dropdown, Input, Popconfirm, Switch } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { CodeOutlined, DeleteOutlined, DownOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons'

interface Props {
  stage: 'pre' | 'post'
  value: string
  enabled?: boolean
  onChange: (value: string, enabled?: boolean) => void
}
const common = [
  ['设置环境变量', 'apt.environment.set("key", "value");'],
  ['获取环境变量', 'const value = apt.environment.get("key");'],
  ['删除环境变量', 'apt.environment.unset("key");'],
  ['设置全局变量', 'apt.globals.set("key", "value");'],
  ['获取全局变量', 'const value = apt.globals.get("key");'],
  ['打印日志', 'console.log("调试信息");']
]

export default function RequestScriptEditor({ stage, value, enabled, onChange }: Props): JSX.Element {
  const input = useRef<TextAreaRef>(null)
  const [collapsed, setCollapsed] = useState(false)
  const active = Boolean(value) || enabled !== undefined
  const label = stage === 'pre' ? '预执行脚本' : '后执行脚本'
  const snippets = stage === 'pre' ? [
    ['设置请求头', 'apt.setRequestHeader("key", "value");'],
    ['设置 Query 参数', 'apt.setRequestQuery("key", "value");'], ...common
  ] : [
    ['状态码为 200', 'apt.test("响应码为 200", function () {\n  apt.response.to.have.status(200);\n});'],
    ['验证 JSON 响应', 'apt.test("响应内容正确", function () {\n  const jsonData = apt.response.json();\n  apt.expect(jsonData.ok).to.eql(true);\n});'],
    ['提取响应变量', 'const jsonData = apt.response.json();\napt.environment.set("token", jsonData.token);'], ...common
  ]
  const insert = (code: string): void => {
    const element = input.current?.resizableTextArea?.textArea
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? start
    const text = (start && value[start - 1] !== '\n' ? '\n' : '') + code + '\n'
    onChange(value.slice(0, start) + text + value.slice(end), enabled ?? true)
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + text.length, start + text.length) })
  }
  return <div className="request-operations">
    {!active ? <Dropdown trigger={['click']} menu={{ items: [{ key: 'script', label: '自定义脚本' }], onClick: () => onChange(value, true) }}>
      <Button aria-label="添加操作项" icon={<PlusOutlined />}>添加操作项 <DownOutlined /></Button>
    </Dropdown> : <>
      <div className={`request-script-operation${enabled === false ? ' is-disabled' : ''}`}>
        <div className="request-operation-head">
          <button aria-label={collapsed ? '展开脚本' : '收起脚本'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <RightOutlined /> : <DownOutlined />}</button>
          <CodeOutlined /><strong>自定义脚本</strong>
          <span className="muted">{stage === 'pre' ? '发送请求前执行' : '收到响应后执行'}</span>
          <Switch size="small" checked={enabled !== false} aria-label={`启用${label}`} onChange={checked => onChange(value, checked)} />
          <Popconfirm title="删除此脚本操作？" okText="删除" cancelText="取消" onConfirm={() => onChange('', undefined)}>
            <button aria-label={`删除${label}`}><DeleteOutlined /></button>
          </Popconfirm>
        </div>
        {!collapsed && <div className="request-script-content">
          <Input.TextArea ref={input} aria-label={label} value={value} onChange={event => onChange(event.target.value, enabled ?? true)}
            className="mono" placeholder={`// ${label}`} autoSize={{ minRows: 12 }} spellCheck={false} />
          <aside className="request-script-assistant">
            <strong>常用脚本</strong>
            {snippets.map(([name, code]) => <button key={name} onClick={() => insert(code)}>{name}</button>)}
          </aside>
        </div>}
      </div>
    </>}
  </div>
}
