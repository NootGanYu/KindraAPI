# 组件：CodeGenDialog.tsx

- 源码：`src/renderer/src/components/CodeGenDialog.tsx`
- 行数：124
- 静态统计：JSX 18 / 提示 3 / 菜单 17 / Tooltip 0 / Placeholder 0 / IPC 4

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Modal` | 生成代码 | open=open width=920 title=生成代码 | `src/renderer/src/components/CodeGenDialog.tsx`:68 |
| `Button` | 复制代码 | size=small | `src/renderer/src/components/CodeGenDialog.tsx`:98 |
| `Alert` | — | type=warning message=result.warnings.join('；') | `src/renderer/src/components/CodeGenDialog.tsx`:112 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 复制代码 | size=small | `src/renderer/src/components/CodeGenDialog.tsx`:98 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `response.error` | `src/renderer/src/components/CodeGenDialog.tsx`:55 |
| `message.success` | `已复制` | `src/renderer/src/components/CodeGenDialog.tsx`:63 |
| `message.error` | `response.error` | `src/renderer/src/components/CodeGenDialog.tsx`:64 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `shell(curl)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:15 |
| `shell(httpie)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:16 |
| `shell(wget)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:17 |
| `c(libcurl)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:18 |
| `clojure(clj_http)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:19 |
| `csharp(httpclient)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:20 |
| `csharp(restsharp)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:21 |
| `go(native)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:22 |
| `HTTP(http/1.1)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:23 |
| `java(asynchttp)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:24 |
| `java(nethttp)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:25 |
| `java(okhttp)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:26 |
| `java(unirest)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:27 |
| `javascript(axios)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:28 |
| `javascript(fetch)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:29 |
| `javascript(jquery)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:30 |
| `javascript(xhr)` | `` | — | `src/renderer/src/components/CodeGenDialog.tsx`:31 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.targets
      .codegenCurl(projectId, target, environmentId)
      .then((response) => {
        if (response.ok) setResult(response.data)
        else message.error(response.error)
      })
      .finally` | `() => setLoading(false)` | `src/renderer/src/components/CodeGenDialog.tsx`:51 |
| `window.api.targets
      .codegenCurl(projectId, target, environmentId)
      .then` | `(response) => { if (response.ok) setResult(response.data) else message.error(response.error) }` | `src/renderer/src/components/CodeGenDialog.tsx`:51 |
| `window.api.targets
      .codegenCurl` | `projectId, target, environmentId` | `src/renderer/src/components/CodeGenDialog.tsx`:51 |
| `window.api.app.copyText` | `result.script` | `src/renderer/src/components/CodeGenDialog.tsx`:62 |

> 返回 [组件索引](README.md)
