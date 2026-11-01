# 组件：RequestEditor.tsx

- 源码：`src/renderer/src/components/RequestEditor.tsx`
- 行数：780
- 静态统计：JSX 100 / 提示 14 / 菜单 23 / Tooltip 1 / Placeholder 10 / IPC 6

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Tag` | 模型已删除 | — | `src/renderer/src/components/RequestEditor.tsx`:332 |
| `Tag` | 模型 · referencedModel?.name | — | `src/renderer/src/components/RequestEditor.tsx`:334 |
| `Tooltip` | 解除引用后保留当前 JSON 可编辑 | title=解除引用后保留当前 JSON 可编辑 | `src/renderer/src/components/RequestEditor.tsx`:337 |
| `Segmented` | — | size=small value=bodyView options=[ { label: '原始', value: 'raw' }, { label: '字段', value: 'fields' } ] | `src/renderer/src/components/RequestEditor.tsx`:368 |
| `JsonFieldTable` | — | — | `src/renderer/src/components/RequestEditor.tsx`:383 |
| `Input.TextArea` | body.mode === 'json' ? '{ "key": "value" }' : '请求体' | value=body.raw ?? '' placeholder=body.mode === 'json' ? '{ "key": "value" }' : '请求体' | `src/renderer/src/components/RequestEditor.tsx`:392 |
| `ParamTable` | 表单参数（urlencoded） | title=表单参数（urlencoded） | `src/renderer/src/components/RequestEditor.tsx`:414 |
| `ParamTable` | 表单参数（form-data） | title=表单参数（form-data） | `src/renderer/src/components/RequestEditor.tsx`:423 |
| `Space` | body.binary?.file_name ? ( <span className="muted" style={{ fontSize: 11 }}> {body.binary.file_name} | — | `src/renderer/src/components/RequestEditor.tsx`:434 |
| `Input` | /path/to/file | value=body.binary?.file_path ?? '' placeholder=/path/to/file | `src/renderer/src/components/RequestEditor.tsx`:439 |
| `Button` | 选择文件 | — | `src/renderer/src/components/RequestEditor.tsx`:446 |
| `Radio.Group` | — | value=bodyValue options=BODY_OPTIONS | `src/renderer/src/components/RequestEditor.tsx`:483 |
| `ParamTable` | 公共参数（Header） | title=公共参数（Header） | `src/renderer/src/components/RequestEditor.tsx`:507 |
| `ParamTable` | 查询参数（Query） | title=查询参数（Query） | `src/renderer/src/components/RequestEditor.tsx`:519 |
| `ParamTable` | 路径参数（Path） | title=路径参数（Path） | `src/renderer/src/components/RequestEditor.tsx`:531 |
| `ParamTable` | Cookie 参数 | title=Cookie 参数 | `src/renderer/src/components/RequestEditor.tsx`:543 |
| `Input.TextArea` | // 预执行脚本 | value=request.pre_script ?? '' placeholder=// 预执行脚本 | `src/renderer/src/components/RequestEditor.tsx`:564 |
| `Input.TextArea` | // 后执行脚本 | value=request.test ?? '' placeholder=// 后执行脚本 | `src/renderer/src/components/RequestEditor.tsx`:580 |
| `Dropdown` | — | — | `src/renderer/src/components/RequestEditor.tsx`:598 |
| `Input` | 请输入URL或粘贴cURL文本 | value=draft.url ?? '' placeholder=请输入URL或粘贴cURL文本 | `src/renderer/src/components/RequestEditor.tsx`:612 |
| `Select` | — | value=draft.protocol \|\| 'http/1.1' options=[ { value: 'http/1.1', label: 'http/1.1' }, { value: 'auto', label: 'auto' }, { value: 'http/2', label: 'http/2' }  | `src/renderer/src/components/RequestEditor.tsx`:621 |
| `Dropdown` | — | — | `src/renderer/src/components/RequestEditor.tsx`:639 |
| `Dropdown` | — | — | `src/renderer/src/components/RequestEditor.tsx`:650 |
| `ModelPickerModal` | — | open=pickerOpen | `src/renderer/src/components/RequestEditor.tsx`:672 |
| `Space` | auth.type === 'bearer' ? ( <div> <div className="muted" style={{ marginBottom: 4 }}> Token </div> <I | size=10 | `src/renderer/src/components/RequestEditor.tsx`:696 |
| `Select` | — | value=auth.type options=[ { value: 'inherit', label: '继承父级' }, { value: 'noauth', label: '无需认证' }, { value: 'bearer', label: 'Bearer Token' }, { value: 'basic', | `src/renderer/src/components/RequestEditor.tsx`:701 |
| `Input` | Bearer token | value=auth.bearer?.key ?? '' placeholder=Bearer token | `src/renderer/src/components/RequestEditor.tsx`:720 |
| `Space` | — | — | `src/renderer/src/components/RequestEditor.tsx`:729 |
| `Input` | 用户名 | value=auth.basic?.username ?? '' placeholder=用户名 | `src/renderer/src/components/RequestEditor.tsx`:730 |
| `Input.Password` | 密码 | value=auth.basic?.password ?? '' placeholder=密码 | `src/renderer/src/components/RequestEditor.tsx`:737 |
| `Space` | — | — | `src/renderer/src/components/RequestEditor.tsx`:748 |
| `Input` | Key | value=auth.kv?.key ?? '' placeholder=Key | `src/renderer/src/components/RequestEditor.tsx`:749 |
| `Input` | Value | value=auth.kv?.value ?? '' placeholder=Value | `src/renderer/src/components/RequestEditor.tsx`:756 |
| `Select` | — | value=auth.kv?.in ?? 'header' options=[ { value: 'header', label: 'Header' }, { value: 'query', label: 'Query' } ] | `src/renderer/src/components/RequestEditor.tsx`:763 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 选择文件 |  | `src/renderer/src/components/RequestEditor.tsx`:446 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `error.message` | `src/renderer/src/components/RequestEditor.tsx`:161 |
| `modal.confirm` | `title=编辑将解除模型引用; content=解除后保留当前生成的 JSON，可继续手动修改。; okText=解除并编辑; cancelText=取消` | `src/renderer/src/components/RequestEditor.tsx`:173 |
| `message.error` | `error.message` | `src/renderer/src/components/RequestEditor.tsx`:183 |
| `message.error` | `result.error` | `src/renderer/src/components/RequestEditor.tsx`:187 |
| `message.warning` | `result.data.warnings[0].message` | `src/renderer/src/components/RequestEditor.tsx`:191 |
| `message.error` | `\`JSON 结构错误：第 ${problem.line} 行第 ${problem.column} 列\`` | `src/renderer/src/components/RequestEditor.tsx`:222 |
| `message.success` | `\`请求完成 ${record.response?.code ?? ''}\`` | `src/renderer/src/components/RequestEditor.tsx`:226 |
| `message.error` | `record.error?.message ?? '请求失败'` | `src/renderer/src/components/RequestEditor.tsx`:227 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/RequestEditor.tsx`:230 |
| `message.error` | `\`JSON 结构错误：第 ${problem.line} 行第 ${problem.column} 列\`` | `src/renderer/src/components/RequestEditor.tsx`:241 |
| `message.success` | `已保存` | `src/renderer/src/components/RequestEditor.tsx`:246 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/RequestEditor.tsx`:248 |
| `message.error` | `result.error` | `src/renderer/src/components/RequestEditor.tsx`:450 |
| `message.info` | `msgpack 将在后续里程碑支持` | `src/renderer/src/components/RequestEditor.tsx`:488 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `none` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:62 |
| `form-data` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:63 |
| `urlencoded` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:64 |
| `binary` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:65 |
| `msgpack` | `` | `true` | `src/renderer/src/components/RequestEditor.tsx`:66 |
| `raw` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:67 |
| `发送` | `send` | — | `src/renderer/src/components/RequestEditor.tsx`:280 |
| `发送并保存` | `sendSave` | — | `src/renderer/src/components/RequestEditor.tsx`:281 |
| `保存` | `save` | — | `src/renderer/src/components/RequestEditor.tsx`:296 |
| `保存并发送` | `saveSend` | — | `src/renderer/src/components/RequestEditor.tsx`:297 |
| `原始` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:374 |
| `字段` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:375 |
| `method` | `method` | — | `src/renderer/src/components/RequestEditor.tsx`:601 |
| `http/1.1` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:627 |
| `auto` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:628 |
| `http/2` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:629 |
| `继承父级` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:706 |
| `无需认证` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:707 |
| `Bearer Token` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:708 |
| `Basic Auth` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:709 |
| `API Key` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:710 |
| `Header` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:770 |
| `Query` | `` | — | `src/renderer/src/components/RequestEditor.tsx`:771 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `解除引用后保留当前 JSON 可编辑` | `src/renderer/src/components/RequestEditor.tsx`:337 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `body.mode === 'json' ? '{ "key": "value" }' : '请求体'` | `src/renderer/src/components/RequestEditor.tsx`:404 |
| `/path/to/file` | `src/renderer/src/components/RequestEditor.tsx`:444 |
| `// 预执行脚本` | `src/renderer/src/components/RequestEditor.tsx`:569 |
| `// 后执行脚本` | `src/renderer/src/components/RequestEditor.tsx`:585 |
| `请输入URL或粘贴cURL文本` | `src/renderer/src/components/RequestEditor.tsx`:616 |
| `Bearer token` | `src/renderer/src/components/RequestEditor.tsx`:723 |
| `用户名` | `src/renderer/src/components/RequestEditor.tsx`:735 |
| `密码` | `src/renderer/src/components/RequestEditor.tsx`:742 |
| `Key` | `src/renderer/src/components/RequestEditor.tsx`:754 |
| `Value` | `src/renderer/src/components/RequestEditor.tsx`:761 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.models
      .list(projectId)
      .then((result) => {
        if (active && result.ok) setModels(result.data)
      })
      .catch` | `() => undefined` | `src/renderer/src/components/RequestEditor.tsx`:135 |
| `window.api.models
      .list(projectId)
      .then` | `(result) => { if (active && result.ok) setModels(result.data) }` | `src/renderer/src/components/RequestEditor.tsx`:135 |
| `window.api.models
      .list` | `projectId` | `src/renderer/src/components/RequestEditor.tsx`:135 |
| `window.api.models.generateExample` | `projectId, model.model_id` | `src/renderer/src/components/RequestEditor.tsx`:185 |
| `window.api.dialog.openFiles().then` | `(result) => { if (!result.ok) { message.error(result.error) re` | `src/renderer/src/components/RequestEditor.tsx`:448 |
| `window.api.dialog.openFiles` | `` | `src/renderer/src/components/RequestEditor.tsx`:448 |

> 返回 [组件索引](README.md)
