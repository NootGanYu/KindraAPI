# 组件：CasesEditor.tsx

- 源码：`src/renderer/src/components/CasesEditor.tsx`
- 行数：540
- 静态统计：JSX 64 / 提示 5 / 菜单 16 / Tooltip 0 / Placeholder 7 / IPC 2

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Button` | 新建 | size=small | `src/renderer/src/components/CasesEditor.tsx`:188 |
| `Button` | 全部运行 | size=small loading=running === 'all' | `src/renderer/src/components/CasesEditor.tsx`:191 |
| `Empty` | — | description=暂无用例 | `src/renderer/src/components/CasesEditor.tsx`:202 |
| `Tag` | item.last_run.status | — | `src/renderer/src/components/CasesEditor.tsx`:219 |
| `Empty` | — | description=选择或新建一个用例 | `src/renderer/src/components/CasesEditor.tsx`:234 |
| `Input` | — | value=selected.name | `src/renderer/src/components/CasesEditor.tsx`:238 |
| `Switch` | — | checked=selected.is_enabled !== 0 | `src/renderer/src/components/CasesEditor.tsx`:243 |
| `Button` | 复制 | size=small | `src/renderer/src/components/CasesEditor.tsx`:249 |
| `Button` | 删除 | size=small danger=true | `src/renderer/src/components/CasesEditor.tsx`:256 |
| `Button` | 运行 | type=primary size=small loading=running === 'one' | `src/renderer/src/components/CasesEditor.tsx`:265 |
| `Input.TextArea` | 用例说明 | value=selected.description ?? '' placeholder=用例说明 | `src/renderer/src/components/CasesEditor.tsx`:276 |
| `Select` | 方法 | placeholder=方法 value=selected.override.method options=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map( (value) => ({ value, label: value }) ) | `src/renderer/src/components/CasesEditor.tsx`:288 |
| `Input` | URL（留空继承） | placeholder=URL（留空继承） value=selected.override.url ?? '' | `src/renderer/src/components/CasesEditor.tsx`:300 |
| `ParamTable` | Header 覆盖 | title=Header 覆盖 | `src/renderer/src/components/CasesEditor.tsx`:308 |
| `ParamTable` | Query 覆盖 | title=Query 覆盖 | `src/renderer/src/components/CasesEditor.tsx`:314 |
| `Select` | 继承接口 | placeholder=继承接口 value=selected.override.body_mode ?? undefined options=BODY_MODES.filter((item) => item.value !== '').map((item) => ({ value: item.value, label | `src/renderer/src/components/CasesEditor.tsx`:324 |
| `Input.TextArea` | 请求体 | placeholder=请求体 value=selected.override.body ?? '' | `src/renderer/src/components/CasesEditor.tsx`:341 |
| `ParamTable` | x-www-form-urlencoded | title=x-www-form-urlencoded | `src/renderer/src/components/CasesEditor.tsx`:353 |
| `ParamTable` | form-data | title=form-data | `src/renderer/src/components/CasesEditor.tsx`:363 |
| `Switch` | — | checked=assertion.is_enabled !== 0 | `src/renderer/src/components/CasesEditor.tsx`:380 |
| `Select` | — | value=assertion.kind options=KIND_OPTIONS | `src/renderer/src/components/CasesEditor.tsx`:393 |
| `Select` | — | value=assertion.op options=OP_OPTIONS | `src/renderer/src/components/CasesEditor.tsx`:408 |
| `Input` | $.data.id | placeholder=$.data.id value=assertion.path ?? '' | `src/renderer/src/components/CasesEditor.tsx`:424 |
| `Input` | 期望值 | placeholder=期望值 value=assertion.expected ?? '' | `src/renderer/src/components/CasesEditor.tsx`:440 |
| `Button` | — | size=small type=text danger=true | `src/renderer/src/components/CasesEditor.tsx`:456 |
| `Button` | 添加断言 | size=small | `src/renderer/src/components/CasesEditor.tsx`:473 |
| `Tag` | selected.last_run.status | — | `src/renderer/src/components/CasesEditor.tsx`:498 |
| `Tag` | item.passed ? '通过' : '失败' | — | `src/renderer/src/components/CasesEditor.tsx`:519 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 新建 | size=small | `src/renderer/src/components/CasesEditor.tsx`:188 |
| Button | 全部运行 | size=small loading=running === 'all' | `src/renderer/src/components/CasesEditor.tsx`:191 |
| Button | 复制 | size=small | `src/renderer/src/components/CasesEditor.tsx`:249 |
| Button | 删除 | size=small danger=true | `src/renderer/src/components/CasesEditor.tsx`:256 |
| Button | 运行 | type=primary size=small loading=running === 'one' | `src/renderer/src/components/CasesEditor.tsx`:265 |
| Button | 添加断言 | size=small | `src/renderer/src/components/CasesEditor.tsx`:473 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `result.error` | `src/renderer/src/components/CasesEditor.tsx`:140 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/CasesEditor.tsx`:145 |
| `message.error` | `result.error` | `src/renderer/src/components/CasesEditor.tsx`:162 |
| `message.success` | `\`运行完成：通过 ${result.data.passed} / 失败 ${result.data.failed} / 异常 ${result.data.error}\`` | `src/renderer/src/components/CasesEditor.tsx`:166 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/CasesEditor.tsx`:170 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `继承接口` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:37 |
| `raw` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:38 |
| `JSON` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:39 |
| `x-www-form-urlencoded` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:40 |
| `form-data` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:41 |
| `状态码` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:45 |
| `耗时(ms)` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:46 |
| `JSON 路径` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:47 |
| `等于` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:51 |
| `不等于` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:52 |
| `包含` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:53 |
| `存在` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:54 |
| `大于` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:55 |
| `小于` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:56 |
| `value` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:294 |
| `item.label` | `` | — | `src/renderer/src/components/CasesEditor.tsx`:329 |

### 源码中的提示文案

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `用例说明` | `src/renderer/src/components/CasesEditor.tsx`:278 |
| `方法` | `src/renderer/src/components/CasesEditor.tsx`:290 |
| `URL（留空继承）` | `src/renderer/src/components/CasesEditor.tsx`:301 |
| `继承接口` | `src/renderer/src/components/CasesEditor.tsx`:326 |
| `请求体` | `src/renderer/src/components/CasesEditor.tsx`:344 |
| `$.data.id` | `src/renderer/src/components/CasesEditor.tsx`:425 |
| `期望值` | `src/renderer/src/components/CasesEditor.tsx`:442 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `暂无用例` | `src/renderer/src/components/CasesEditor.tsx`:202 |
| `选择或新建一个用例` | `src/renderer/src/components/CasesEditor.tsx`:234 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.targets.cases.run` | `projectId, latest, selected.case_id, environmentId` | `src/renderer/src/components/CasesEditor.tsx`:133 |
| `window.api.targets.cases.runAll` | `projectId, latest, environmentId` | `src/renderer/src/components/CasesEditor.tsx`:156 |

> 返回 [组件索引](README.md)
