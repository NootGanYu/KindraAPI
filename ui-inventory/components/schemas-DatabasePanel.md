# 组件：DatabasePanel.tsx

- 源码：`src/renderer/src/components/schemas/DatabasePanel.tsx`
- 行数：639
- 静态统计：JSX 104 / 提示 11 / 菜单 15 / Tooltip 3 / Placeholder 9 / IPC 7

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Tag` | value.toUpperCase() | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:246 |
| `Space` | — | size=2 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:254 |
| `Tooltip` | 编辑 | title=编辑 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:255 |
| `Tooltip` | 导入表结构 | title=导入表结构 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:260 |
| `Tooltip` | 删除 | title=删除 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:265 |
| `Button` | 刷新 | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:296 |
| `Button` | 新建 | type=primary | `src/renderer/src/components/schemas/DatabasePanel.tsx`:299 |
| `Table` | — | size=small loading=loading | `src/renderer/src/components/schemas/DatabasePanel.tsx`:304 |
| `Empty` | — | description=暂无数据库连接，点击右上角「新建」开始 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:313 |
| `Modal` | editing ? '编辑数据库连接' : '新建数据库连接' | title=editing ? '编辑数据库连接' : '新建数据库连接' open=open width=620 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:321 |
| `Button` | 测试连接 | loading=testing | `src/renderer/src/components/schemas/DatabasePanel.tsx`:328 |
| `Button` | 取消 | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:336 |
| `Button` | 确定 | type=primary | `src/renderer/src/components/schemas/DatabasePanel.tsx`:337 |
| `Form` | testResult ? ( <Alert style={{ marginTop: 12 }} type={testResult.ok ? 'success' : 'error'} showIcon  | size=small | `src/renderer/src/components/schemas/DatabasePanel.tsx`:343 |
| `Form.Item` | 名称 | label=名称 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:350 |
| `Input` | 连接名称 | value=draft.name placeholder=连接名称 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:351 |
| `Form.Item` | 说明 | label=说明 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:357 |
| `Input` | 可选 | value=draft.remarks placeholder=可选 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:358 |
| `Form.Item` | 数据库类型 | label=数据库类型 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:364 |
| `Select` | — | value=draft.type options=[{ value: 'mysql', label: 'MySQL' }] disabled=true | `src/renderer/src/components/schemas/DatabasePanel.tsx`:365 |
| `Form.Item` | 默认配置 | label=默认配置 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:371 |
| `Tabs` | — | items=[ { key: 'regular', label: '常规', children: ( <div> <Form.Item label="数据库地址" required> <Input value={draft.config.default.host} onChange={(event) => patchD | `src/renderer/src/components/schemas/DatabasePanel.tsx`:377 |
| `Form.Item` | 数据库地址 | label=数据库地址 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:386 |
| `Input` | 127.0.0.1 | value=draft.config.default.host placeholder=127.0.0.1 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:387 |
| `Form.Item` | 端口 | label=端口 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:393 |
| `InputNumber` | 3306 | placeholder=3306 value=draft.config.default.port | `src/renderer/src/components/schemas/DatabasePanel.tsx`:394 |
| `Form.Item` | 用户名 | label=用户名 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:403 |
| `Input` | root | value=draft.config.default.user placeholder=root | `src/renderer/src/components/schemas/DatabasePanel.tsx`:404 |
| `Form.Item` | 密码 | label=密码 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:410 |
| `Input.Password` | 密码 | value=draft.config.default.password placeholder=密码 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:411 |
| `Form.Item` | 数据库名 | label=数据库名 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:417 |
| `Input` | database | value=draft.config.default.database placeholder=database | `src/renderer/src/components/schemas/DatabasePanel.tsx`:418 |
| `Alert` | — | type=warning message=SSH 隧道后续支持 description=本轮只保存 SSH 配置，测试连接与导入仍走直连，不会建立隧道。 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:432 |
| `Form.Item` | 启用 SSH | label=启用 SSH | `src/renderer/src/components/schemas/DatabasePanel.tsx`:439 |
| `Switch` | — | checked=draft.ssh.enable === 1 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:440 |
| `Form.Item` | Host | label=Host | `src/renderer/src/components/schemas/DatabasePanel.tsx`:445 |
| `Input` | — | value=draft.ssh.host | `src/renderer/src/components/schemas/DatabasePanel.tsx`:446 |
| `Form.Item` | Port | label=Port | `src/renderer/src/components/schemas/DatabasePanel.tsx`:451 |
| `InputNumber` | 22 | placeholder=22 value=draft.ssh.port | `src/renderer/src/components/schemas/DatabasePanel.tsx`:452 |
| `Form.Item` | 用户名 | label=用户名 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:461 |
| `Input` | — | value=draft.ssh.username | `src/renderer/src/components/schemas/DatabasePanel.tsx`:462 |
| `Form.Item` | 密码 | label=密码 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:467 |
| `Input.Password` | — | value=draft.ssh.password | `src/renderer/src/components/schemas/DatabasePanel.tsx`:468 |
| `Form.Item` | 认证方式 | label=认证方式 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:473 |
| `Select` | — | value=draft.ssh.auth_type options=[ { value: 1, label: '密码' }, { value: 2, label: '私钥' }, { value: 3, label: '密码 + 私钥' } ] | `src/renderer/src/components/schemas/DatabasePanel.tsx`:474 |
| `Form.Item` | 私钥 | label=私钥 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:484 |
| `Input.TextArea` | -----BEGIN OPENSSH PRIVATE KEY----- | value=draft.ssh.private_key placeholder=-----BEGIN OPENSSH PRIVATE KEY----- | `src/renderer/src/components/schemas/DatabasePanel.tsx`:485 |
| `Form.Item` | Passphrase | label=Passphrase | `src/renderer/src/components/schemas/DatabasePanel.tsx`:492 |
| `Input.Password` | — | value=draft.ssh.passphrase | `src/renderer/src/components/schemas/DatabasePanel.tsx`:493 |
| `Alert` | — | type=testResult.ok ? 'success' : 'error' message=testResult.message description=testResult.server_version ? `MySQL ${testResult.server_version}` : undefined | `src/renderer/src/components/schemas/DatabasePanel.tsx`:505 |
| `Modal` | importConnection?.ssh.enable === 1 ? ( <Alert type="warning" showIcon style={{ marginBottom: 12 }} m | title=`导入表结构${importConnection ? ` · ${importConnection.name}` : ''}` open=importOpen width=720 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:516 |
| `Button` | 重新读取表 | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:523 |
| `Button` | 关闭 | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:527 |
| `Button` | 开始导入 | type=primary loading=importing | `src/renderer/src/components/schemas/DatabasePanel.tsx`:528 |
| `Alert` | — | type=warning message=SSH 隧道后续支持，无法读取表结构 description=请先在「常规」中关闭 SSH，或等待后续版本支持隧道。 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:535 |
| `Checkbox` | 全选 | checked=tableItems.length > 0 && selectedTables.length === tableItems.length | `src/renderer/src/components/schemas/DatabasePanel.tsx`:545 |
| `Select` | — | value=targetFolder options=[ { value: '0', label: '根目录' }, ...folders.map((folder) => ({ value: folder.model_id, label: folder.name })) ] | `src/renderer/src/components/schemas/DatabasePanel.tsx`:559 |
| `Empty` | — | description=暂无表 | `src/renderer/src/components/schemas/DatabasePanel.tsx`:574 |
| `Checkbox` | — | checked=selectedTables.includes(table.key) | `src/renderer/src/components/schemas/DatabasePanel.tsx`:578 |
| `Radio.Group` | — | value=conflict options=[ { value: 'update', label: '更新同名模型' }, { value: 'skip', label: '跳过同名模型' }, { value: 'copy', label: '创建副本' } ] | `src/renderer/src/components/schemas/DatabasePanel.tsx`:599 |
| `Alert` | — | type=importResult.failed > 0 ? 'warning' : 'success' message=`导入结果：新建 ${importResult.created}，更新 ${importResult.updated}，跳过 ${importResult.skipped}，副本 ${importR | `src/renderer/src/components/schemas/DatabasePanel.tsx`:612 |
| `Tag` | item.status | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:621 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 刷新 |  | `src/renderer/src/components/schemas/DatabasePanel.tsx`:296 |
| Button | 新建 | type=primary | `src/renderer/src/components/schemas/DatabasePanel.tsx`:299 |
| Button | 测试连接 | loading=testing | `src/renderer/src/components/schemas/DatabasePanel.tsx`:328 |
| Button | 取消 |  | `src/renderer/src/components/schemas/DatabasePanel.tsx`:336 |
| Button | 确定 | type=primary | `src/renderer/src/components/schemas/DatabasePanel.tsx`:337 |
| Button | 重新读取表 |  | `src/renderer/src/components/schemas/DatabasePanel.tsx`:523 |
| Button | 关闭 |  | `src/renderer/src/components/schemas/DatabasePanel.tsx`:527 |
| Button | 开始导入 | type=primary loading=importing | `src/renderer/src/components/schemas/DatabasePanel.tsx`:528 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:79 |
| `message.error` | `problem` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:138 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:143 |
| `message.success` | `editing ? '已更新连接' : '已新建连接'` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:148 |
| `modal.confirm` | `title=\`删除数据库连接「${connection.name}」？\`; content=已导入的数据模型会保留，此操作不可撤销。; okText=删除; cancelText=取消` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:171 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:180 |
| `message.success` | `已删除连接` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:184 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:206 |
| `message.error` | `请至少勾选一张表` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:216 |
| `message.success` | `\`导入完成：新建 ${result.data.created}，更新 ${result.data.updated}，跳过 ${result.data.skipped}，副本 ${result.data.copied}\`` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:229 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:233 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `名称` | `name` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:240 |
| `数据库类型` | `type` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:241 |
| `说明` | `remarks` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:248 |
| `操作` | `actions` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:249 |
| `MySQL` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:367 |
| `常规` | `regular` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:381 |
| `SSH` | `ssh` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:427 |
| `密码` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:478 |
| `私钥` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:479 |
| `密码 + 私钥` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:480 |
| `根目录` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:564 |
| `folder.name` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:565 |
| `更新同名模型` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:603 |
| `跳过同名模型` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:604 |
| `创建副本` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:605 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `编辑` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:255 |
| `导入表结构` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:260 |
| `删除` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:265 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `连接名称` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:354 |
| `可选` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:361 |
| `127.0.0.1` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:390 |
| `3306` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:398 |
| `root` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:407 |
| `密码` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:414 |
| `database` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:421 |
| `22` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:456 |
| `-----BEGIN OPENSSH PRIVATE KEY-----` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:489 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `暂无数据库连接，点击右上角「新建」开始` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:313 |
| `暂无表` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:574 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.db.list` | `projectId` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:75 |
| `window.api.models.list` | `projectId` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:96 |
| `window.api.db.save` | `projectId, draft` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:141 |
| `window.api.db.test` | `draft.config.default, draft.ssh` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:160 |
| `window.api.db.delete` | `projectId, connection.db_id` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:178 |
| `window.api.db.tables` | `connection.config.default, connection.ssh` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:202 |
| `window.api.db.importTables` | `projectId, importConnection.db_id, { tables: selectedTables, target_parent_id: targetFolder, conflic` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:221 |

> 返回 [组件索引](README.md)
