# 组件：EnvironmentModal.tsx

- 源码：`src/renderer/src/components/EnvironmentModal.tsx`
- 行数：988
- 静态统计：JSX 124 / 提示 18 / 菜单 10 / Tooltip 0 / Placeholder 19 / IPC 11

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Empty` | — | description=请选择或新建环境 | `src/renderer/src/components/EnvironmentModal.tsx`:369 |
| `Input` | 请输入环境名称 | value=envName placeholder=请输入环境名称 | `src/renderer/src/components/EnvironmentModal.tsx`:374 |
| `Button` | 删除环境 | danger=true | `src/renderer/src/components/EnvironmentModal.tsx`:379 |
| `Button` | 添加服务 | size=small type=link | `src/renderer/src/components/EnvironmentModal.tsx`:386 |
| `Input` | 服务名 | value=item.name placeholder=服务名 | `src/renderer/src/components/EnvironmentModal.tsx`:412 |
| `Input` | https://api.example.com | value=item.uri placeholder=https://api.example.com | `src/renderer/src/components/EnvironmentModal.tsx`:423 |
| `Button` | — | type=text | `src/renderer/src/components/EnvironmentModal.tsx`:434 |
| `Input` | 搜索变量名、描述 | placeholder=搜索变量名、描述 value=envSearch | `src/renderer/src/components/EnvironmentModal.tsx`:447 |
| `Input` | 变量名 | value=row.key placeholder=变量名 | `src/renderer/src/components/EnvironmentModal.tsx`:480 |
| `Input` | 变量值 | value=row.value placeholder=变量值 | `src/renderer/src/components/EnvironmentModal.tsx`:491 |
| `Input` | 描述 | value=row.description placeholder=描述 | `src/renderer/src/components/EnvironmentModal.tsx`:502 |
| `Button` | — | type=text | `src/renderer/src/components/EnvironmentModal.tsx`:513 |
| `Button` | 添加变量 | type=dashed | `src/renderer/src/components/EnvironmentModal.tsx`:521 |
| `Input` | 搜索变量名、描述 | placeholder=搜索变量名、描述 value=globalSearch | `src/renderer/src/components/EnvironmentModal.tsx`:546 |
| `Input` | 变量名 | value=row.key placeholder=变量名 | `src/renderer/src/components/EnvironmentModal.tsx`:564 |
| `Input` | 变量值 | value=row.value placeholder=变量值 | `src/renderer/src/components/EnvironmentModal.tsx`:575 |
| `Input` | 描述 | value=row.description placeholder=描述 | `src/renderer/src/components/EnvironmentModal.tsx`:586 |
| `Button` | — | type=text | `src/renderer/src/components/EnvironmentModal.tsx`:597 |
| `Empty` | — | description=暂无全局变量 | `src/renderer/src/components/EnvironmentModal.tsx`:606 |
| `Button` | 添加变量 | type=dashed | `src/renderer/src/components/EnvironmentModal.tsx`:608 |
| `ParamTable` | Header | title=Header | `src/renderer/src/components/EnvironmentModal.tsx`:627 |
| `ParamTable` | Query | title=Query | `src/renderer/src/components/EnvironmentModal.tsx`:633 |
| `ParamTable` | Cookie | title=Cookie | `src/renderer/src/components/EnvironmentModal.tsx`:639 |
| `Radio.Group` | — | value=params.body?.mode ?? 'none' options=BODY_MODES size=small | `src/renderer/src/components/EnvironmentModal.tsx`:648 |
| `Input.TextArea` | 请求体内容 | value=params.body.raw ?? '' placeholder=请求体内容 | `src/renderer/src/components/EnvironmentModal.tsx`:661 |
| `ParamTable` | urlencoded | title=urlencoded | `src/renderer/src/components/EnvironmentModal.tsx`:676 |
| `ParamTable` | form-data | title=form-data | `src/renderer/src/components/EnvironmentModal.tsx`:690 |
| `Select` | — | value=params.auth?.type ?? 'noauth' options=[ { value: 'noauth', label: 'noauth' }, { value: 'bearer', label: 'Bearer Token' }, { value: 'basic', label: 'Basic  | `src/renderer/src/components/EnvironmentModal.tsx`:707 |
| `Input` | Token | placeholder=Token value=params.auth?.bearer?.key ?? '' | `src/renderer/src/components/EnvironmentModal.tsx`:719 |
| `Input` | 用户名 | placeholder=用户名 value=params.auth?.basic?.username ?? '' | `src/renderer/src/components/EnvironmentModal.tsx`:736 |
| `Input.Password` | 密码 | placeholder=密码 value=params.auth?.basic?.password ?? '' | `src/renderer/src/components/EnvironmentModal.tsx`:752 |
| `Input` | Key | placeholder=Key value=params.auth?.kv?.key ?? '' | `src/renderer/src/components/EnvironmentModal.tsx`:772 |
| `Input` | Value | placeholder=Value value=params.auth?.kv?.value ?? '' | `src/renderer/src/components/EnvironmentModal.tsx`:788 |
| `Select` | — | value=params.auth?.kv?.in ?? 'header' options=[ { value: 'header', label: 'Header' }, { value: 'query', label: 'Query' } ] | `src/renderer/src/components/EnvironmentModal.tsx`:804 |
| `Switch` | — | size=small checked=jar.enabled | `src/renderer/src/components/EnvironmentModal.tsx`:837 |
| `Input` | example.com | placeholder=example.com value=domainInput | `src/renderer/src/components/EnvironmentModal.tsx`:850 |
| `Button` | 添加域名 | type=primary | `src/renderer/src/components/EnvironmentModal.tsx`:856 |
| `Empty` | — | description=暂无域名，添加后可在此维护 Cookie | `src/renderer/src/components/EnvironmentModal.tsx`:861 |
| `Tag` | item.domain | — | `src/renderer/src/components/EnvironmentModal.tsx`:871 |
| `Button` | — | type=text danger=true | `src/renderer/src/components/EnvironmentModal.tsx`:876 |
| `Input.TextArea` | a=1; b=2 | placeholder=a=1; b=2 value=item.cookies | `src/renderer/src/components/EnvironmentModal.tsx`:890 |
| `Modal` | null | open=open width=1000 title=null | `src/renderer/src/components/EnvironmentModal.tsx`:917 |
| `Button` | 新建环境 | — | `src/renderer/src/components/EnvironmentModal.tsx`:970 |
| `Button` | 保存并关闭 | — | `src/renderer/src/components/EnvironmentModal.tsx`:978 |
| `Button` | 保存 | type=primary | `src/renderer/src/components/EnvironmentModal.tsx`:979 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 删除环境 | danger=true | `src/renderer/src/components/EnvironmentModal.tsx`:379 |
| Button | 添加服务 | size=small type=link | `src/renderer/src/components/EnvironmentModal.tsx`:386 |
| Button | 添加变量 | type=dashed | `src/renderer/src/components/EnvironmentModal.tsx`:521 |
| Button | 添加变量 | type=dashed | `src/renderer/src/components/EnvironmentModal.tsx`:608 |
| Button | 添加域名 | type=primary | `src/renderer/src/components/EnvironmentModal.tsx`:856 |
| Button | 新建环境 |  | `src/renderer/src/components/EnvironmentModal.tsx`:970 |
| Button | 保存并关闭 |  | `src/renderer/src/components/EnvironmentModal.tsx`:978 |
| Button | 保存 | type=primary | `src/renderer/src/components/EnvironmentModal.tsx`:979 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `result.error` | `src/renderer/src/components/EnvironmentModal.tsx`:151 |
| `message.error` | `result.error` | `src/renderer/src/components/EnvironmentModal.tsx`:166 |
| `message.error` | `result.error` | `src/renderer/src/components/EnvironmentModal.tsx`:171 |
| `message.success` | `环境已创建` | `src/renderer/src/components/EnvironmentModal.tsx`:188 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/EnvironmentModal.tsx`:190 |
| `message.warning` | `至少保留一个环境` | `src/renderer/src/components/EnvironmentModal.tsx`:197 |
| `modal.confirm` | `title=\`删除环境「${activeEnv.name}」？\`; okText=删除; cancelText=取消` | `src/renderer/src/components/EnvironmentModal.tsx`:200 |
| `message.error` | `result.error` | `src/renderer/src/components/EnvironmentModal.tsx`:208 |
| `message.success` | `环境已删除` | `src/renderer/src/components/EnvironmentModal.tsx`:212 |
| `message.error` | `result.error` | `src/renderer/src/components/EnvironmentModal.tsx`:249 |
| `message.success` | `环境已保存` | `src/renderer/src/components/EnvironmentModal.tsx`:253 |
| `message.error` | `result.error` | `src/renderer/src/components/EnvironmentModal.tsx`:275 |
| `message.success` | `全局变量已保存` | `src/renderer/src/components/EnvironmentModal.tsx`:278 |
| `message.error` | `result.error` | `src/renderer/src/components/EnvironmentModal.tsx`:286 |
| `message.success` | `全局参数已保存` | `src/renderer/src/components/EnvironmentModal.tsx`:289 |
| `message.error` | `result.error` | `src/renderer/src/components/EnvironmentModal.tsx`:298 |
| `message.warning` | `域名已存在` | `src/renderer/src/components/EnvironmentModal.tsx`:305 |
| `message.success` | `Cookie 已保存` | `src/renderer/src/components/EnvironmentModal.tsx`:326 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `none` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:62 |
| `raw` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:63 |
| `urlencoded` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:64 |
| `form-data` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:65 |
| `noauth` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:712 |
| `Bearer Token` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:713 |
| `Basic Auth` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:714 |
| `Key/Value` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:715 |
| `Header` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:820 |
| `Query` | `` | — | `src/renderer/src/components/EnvironmentModal.tsx`:821 |

### 源码中的提示文案

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `请输入环境名称` | `src/renderer/src/components/EnvironmentModal.tsx`:376 |
| `服务名` | `src/renderer/src/components/EnvironmentModal.tsx`:414 |
| `https://api.example.com` | `src/renderer/src/components/EnvironmentModal.tsx`:425 |
| `搜索变量名、描述` | `src/renderer/src/components/EnvironmentModal.tsx`:451 |
| `变量名` | `src/renderer/src/components/EnvironmentModal.tsx`:482 |
| `变量值` | `src/renderer/src/components/EnvironmentModal.tsx`:493 |
| `描述` | `src/renderer/src/components/EnvironmentModal.tsx`:504 |
| `搜索变量名、描述` | `src/renderer/src/components/EnvironmentModal.tsx`:549 |
| `变量名` | `src/renderer/src/components/EnvironmentModal.tsx`:566 |
| `变量值` | `src/renderer/src/components/EnvironmentModal.tsx`:577 |
| `描述` | `src/renderer/src/components/EnvironmentModal.tsx`:588 |
| `请求体内容` | `src/renderer/src/components/EnvironmentModal.tsx`:664 |
| `Token` | `src/renderer/src/components/EnvironmentModal.tsx`:721 |
| `用户名` | `src/renderer/src/components/EnvironmentModal.tsx`:737 |
| `密码` | `src/renderer/src/components/EnvironmentModal.tsx`:753 |
| `Key` | `src/renderer/src/components/EnvironmentModal.tsx`:773 |
| `Value` | `src/renderer/src/components/EnvironmentModal.tsx`:789 |
| `example.com` | `src/renderer/src/components/EnvironmentModal.tsx`:851 |
| `a=1; b=2` | `src/renderer/src/components/EnvironmentModal.tsx`:892 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `请选择或新建环境` | `src/renderer/src/components/EnvironmentModal.tsx`:369 |
| `暂无全局变量` | `src/renderer/src/components/EnvironmentModal.tsx`:606 |
| `暂无域名，添加后可在此维护 Cookie` | `src/renderer/src/components/EnvironmentModal.tsx`:861 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.globals.get(projectId).then` | `(result) => { if (!result.ok) { message.error(result.error) return } se` | `src/renderer/src/components/EnvironmentModal.tsx`:149 |
| `window.api.globals.get` | `projectId` | `src/renderer/src/components/EnvironmentModal.tsx`:149 |
| `window.api.globalParams.get(projectId).then` | `(result) => { if (result.ok) setParams(result.data ?? createRequest()) else message.error(result.err` | `src/renderer/src/components/EnvironmentModal.tsx`:164 |
| `window.api.globalParams.get` | `projectId` | `src/renderer/src/components/EnvironmentModal.tsx`:164 |
| `window.api.cookies.get(projectId).then` | `(result) => { if (!result.ok) { message.error(result.error) return } up` | `src/renderer/src/components/EnvironmentModal.tsx`:169 |
| `window.api.cookies.get` | `projectId` | `src/renderer/src/components/EnvironmentModal.tsx`:169 |
| `window.api.envs.remove` | `projectId, activeEnv.env_id` | `src/renderer/src/components/EnvironmentModal.tsx`:206 |
| `window.api.envs.save` | `projectId, next` | `src/renderer/src/components/EnvironmentModal.tsx`:247 |
| `window.api.globals.save` | `projectId, { project_id: projectId, vars, updated_at: new Date().toISOString() }` | `src/renderer/src/components/EnvironmentModal.tsx`:269 |
| `window.api.globalParams.save` | `projectId, params` | `src/renderer/src/components/EnvironmentModal.tsx`:284 |
| `window.api.cookies.save` | `projectId, payload` | `src/renderer/src/components/EnvironmentModal.tsx`:297 |

> 返回 [组件索引](README.md)
