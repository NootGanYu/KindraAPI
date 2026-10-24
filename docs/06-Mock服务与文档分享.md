# 06 · Mock 服务与文档分享

## 1. 概述

Mock 服务是一个**内置在 Electron 主进程的原生 HTTP 服务**，不依赖 Express：

- 默认端口 `30999`，被占用时自动 +1，最多重试 10 次。
- 启动入口：`main.js` 里 `require("./build/mock.asar/server.js")`。
- 数据源：直接读本地 `offline-data/<project_id>/`，不经过后端。
- 同时托管「文档分享」页面与接口。

```
http://localhost:30999
├── /mock/:projectid/*                  Mock 入口（推荐）
├── /app/mock/project/:projectid/*      Mock 入口（兼容）
├── /__mock/status                      健康检查
├── /__mock/sync                        同步 Mock 配置
├── /__mock/remove                      删除 Mock 配置
├── /api/issue/*                        分享管理（创建/更新/列表/删除）
├── /share/:issueId                     分享页
└── /doc/*                              文档分享站数据接口
```

---

## 2. Mock 请求处理流程

```
请求 /mock/<project_id>/<path>?apipost_id=<target_id>
  └─ mockListener
       ├─ getLocalTargetData(project_id, target_id, method, path)
       │    ├─ 有 target_id：读 settings/mock_<tid>.json + apis/<tid>.json
       │    └─ 无 target_id：按 method + 路径匹配
       │         ├─ 先查 settings 显式配置
       │         └─ 再查接口实体
       ├─ 未找到配置 → 直接 200 "Mock config not found"（不再生成）
       ├─ 校验 mock_server_enable
       ├─ 校验 IP 白名单
       ├─ 解析 AI 期望（ai_expect）
       ├─ 按条件匹配期望 → 选中 example
       ├─ 设置状态码 / 响应头 / Content-Type / sleep
       └─ 生成响应
            ├─ mock_method = 1：JSON Schema + json-schema-faker-pro
            └─ mock_method = 2：原样返回 raw JSON（JSON5 解析）
```

### 2.1 target_id 匹配

`target_id` 来源优先级：

```
query.apipost_id → query.echoapi_id → query.target_id
```

有 `target_id` 时直接定位接口；否则按路径和方法匹配。

### 2.2 路径匹配

- 两侧都做 URL 解码（兼容 `%7B` / `%7D`）。
- 支持路径参数：定义 `/store/order/{orderId}` 可匹配 `/store/order/123`。
- 段数必须一致。
- 接口 URL 会去掉域名与 query，只保留 pathname。

### 2.3 配置合并

`settings/mock_<target_id>.json` 优先，接口实体 `data` 兜底：

```json
{
  "path": "/users/{id}",
  "method": "GET",
  "mock_server_enable": 1,
  "mock_ip_white_list_enable": -1,
  "mock_ip_white_list": "",
  "mock_apipost_id": "...",
  "ai_expect": { "list": [], "none_math_expect_id": "1", "none_math_example": null },
  "example": [ ... ],
  "mock_setup": { "mock_method": 1, "mock_code_method": 1 },
  "custom_functions": []
}
```

---

## 3. 期望（Expectation）与条件匹配

`ai_expect.list[]`：

```json
{
  "id": "1",
  "desc": "用户不存在",
  "enable": 1,
  "conditions": [
    { "location": "query", "name": "id", "compareType": "eq", "value": "0" }
  ],
  "expect_id": "2",
  "example": {
    "example_id": "2",
    "expect": {
      "name": "失败",
      "code": 404,
      "content_type": "json",
      "schema": { "type": "object", "properties": { "msg": { "type": "string" } } }
    },
    "raw": "{\"msg\":\"not found\"}",
    "headers": [
      { "key": "X-Trace", "value": "abc", "is_checked": 1 }
    ]
  }
}
```

匹配规则：

- `conditions` 逐条比较 `header / query / body`。
- `compareType` 与断言同一套：`eq / uneq / gt / gte / lt / lte / includes / unincludes / null / notnull / exist / notexist / regularmatch / belongscollection / notbelongscollection`。
- 条件之间是 **AND**（全部满足才算命中）。
- 命中第一个 `enable > 0` 的期望。
- 都不命中时：
  - 若 `none_math_expect_id` 指向某个 example，用它；
  - 否则用 `none_math_example`。

---

## 4. 响应生成

### 4.1 基于 Schema（`mock_method = 1`）

- 使用 `json-schema-faker-pro` 生成 JSON。
- 选项：
  ```js
  {
    alwaysFakeOptionals: true,
    useExamplesValue: true,
    fillProperties: false,
    useDefaultValue: true,
    mockRules: <字段规则>,
    lang: "zh-cn",
    customFunctions: <自定义函数>
  }
  ```
- 数据模型 `$ref` 会从 `<project>/schemas/*.json` 解析。
- `content_type = xml` 时用 `fast-xml-parser` 转 XML，并加 `<xml version="1.0" encoding="UTF-8">` 前缀。

### 4.2 基于 Raw（`mock_method = 2`）

```js
res.json(JSON5.parse(raw))   // 解析失败则原样输出
```

### 4.3 状态码与响应头

- `mock_code_method = 1`：固定 200。
- 否则使用期望的 `code`。
- `content_type` 非空时设置 `application/<type>;charset=utf-8`。
- 期望的 `headers[]` 中 `is_checked > 0` 且 key/value 非空才写入。
- 【事实】`sleep > 0` 时调用 `delay(ms)` 但**没有 `await`**
  （`analysis/ext/mock/server.js:220-222`），实际不会阻塞响应。
  复刻时若需要真实延迟，必须改成 `await delay(ms)`。
- Schema 分支实际是 `res.json(JSON.stringify(obj))`，会产生**二次编码**；
  XML 分支用字符串拼接，不是标准序列化器。

### 4.4 Mock 字段规则

> 【事实】离线版**不使用** `settings/mock_inner_rules.json`：Mock 服务的
> 目录扫描显式跳过该文件（`analysis/ext/mock/server.js:481`、`:627`），
> 字段规则恒来自内置 `modules/defaultRule.json`。下面这段结构应理解为
> “默认规则文件的结构”，不是项目内可覆盖文件的生效路径。

```json
[
  {
    "field_type": "string",
    "intro": "头像、icon",
    "match_case": -1,
    "match_rule": "{avatar,icon}",
    "match_type": "wildcard",
    "mock_custom_rule_id": "1f...",
    "mock_rule_content": "@image('100x100')",
    "mock_type": 1
  },
  {
    "field_type": "string",
    "match_rule": "*url",
    "mock_type": 1,
    "mock_rule_content": "@url('http')"
  }
]
```

- `match_type`：`wildcard`（支持 `{a,b}`）等。
- `mock_rule_content`：Mock.js 表达式，如 `@cname`、`@ctitle`、`@integer(1,100)`、`@image('100x100')`。
- 没有自定义规则时使用内置 `modules/defaultRule.json`。

---

## 5. Mock 管理 API

### 5.1 安全约束

- 仅接受**回环地址**（`127.0.0.1 / ::1`）。
- Origin 必须是可信来源（`app://localhost`、`apt://localhost`、`http://localhost`、`http://127.0.0.1`）。
- 无 Origin 的脚本请求按回环地址放行。
- `project_id / target_id` 做白名单校验，拒绝路径分隔符与 `..`。

### 5.2 `GET /__mock/status`

```json
{ "code": 0, "port": 30999, "count": 12 }
```

`count` 为所有项目 `settings/mock_*.json` 的数量。

### 5.3 `POST /__mock/sync`

请求：

```json
{
  "project_id": "...",
  "target_id": "...",
  "path": "/users/{id}",
  "method": "GET",
  "mock": { "mock_server_enable": 1, "ai_expect": { ... } },
  "example": [ ... ],
  "mock_setup": { "mock_method": 1, "mock_code_method": 1 },
  "custom_functions": []
}
```

写入 `settings/mock_<target_id>.json`（临时文件 + rename），并让内存索引失效。

### 5.4 `POST /__mock/remove`

```json
{ "project_id": "...", "target_id": "..." }
```

删除对应配置文件。

---

## 6. 路由索引与性能

- 启动时按项目惰性构建内存索引（settings + apis）。
- TTL 5 分钟；写/删 `apis`、`settings` 时主动失效。
- 异步分批读取，避免阻塞主进程。
- 匹配逻辑与目录扫描一致：settings 优先，然后接口实体。

---

## 7. 文档分享

分享服务在 `mock.asar/share.js`，与 Mock 共用端口。

### 7.1 数据流

```
前端创建分享
  → POST /api/issue/create（携带目标快照 + 分享配置）
  → 落盘 userData/share-store.json
  → 生成 net_url = http://<host>:<port>/share/<issue_id>
分享页
  → GET /share/:issueId → 重定向到文档站 /docs/detail/<issue_id>
  → GET /doc/preview / POST /doc/details / POST /doc/auth / GET /doc/down
```

### 7.2 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/issue/create` | 创建分享 |
| POST | `/api/issue/update` | 更新分享 |
| POST | `/api/issue/info` | 分享详情（回显/判断是否已存在） |
| GET | `/api/issue/list` | 项目分享列表 |
| POST | `/api/issue/delete` | 批量删除 |
| GET | `/share/:issueId` | 分享页 HTML（`location.replace('/docs/detail/<id>')`） |
| GET | `/doc/preview?issue_id=` | 文档信息 + 全量列表 |
| POST | `/doc/details` | 指定目标详情 |
| POST | `/doc/auth` | 签发访问 token |
| GET | `/doc/down?issue_id=` | 导出全量数据（MD/HTML） |

> 【事实】源码头部注释里写的 `/share/:issueId/verify` 与
> `/share/:issueId/data` **并不存在**（`analysis/ext/mock/share.js:575-637`
> 只有 `/doc/*` 与 `/share/:issueId` 重定向）。密码校验统一走
> `POST /doc/auth`，不要按旧表实现。

### 7.3 分享记录

```json
{
  "issue_id": "1f...",
  "project_id": "...",
  "name": "接口文档",
  "target_type": "project",
  "target_id": "...",
  "target_ids": [],
  "expire_days": -1,
  "password": "",
  "env_ids": [],
  "attribute_list": [],
  "data": { ... },
  "create_time": 175...,
  "net_url": "http://192.168.1.10:30999/share/1f..."
}
```

- `expire_days`：`-1` 永久，`7/30` N 天，`-99` 关闭。
- 密码为明文比较（离线场景）；token 只存内存、重启失效，TTL 为 **12 小时**
  （`VERIFY_TOKEN_TTL_MS = 12 * 60 * 60 * 1000`）。
- `/doc/*` 的查看链路**不受**管理接口的回环限制；只有 `/api/issue/*`
  管理接口做回环 + Origin 校验。
- 数据快照保存在 `share-store.json`，不依赖原项目是否移动。

### 7.4 分享页前端

`doc-sharing-dist/` 是独立的 Umi 构建产物（文档站），由分享服务托管：

- 路由前缀：`/docs`、`/preview`、`/passwordPage`、`/pageFail`
- 支持 Mermaid、Cytoscape、ELK、Monaco 等可视化组件
- 支持导出 Markdown / HTML

---

## 8. 复刻建议

### 8.1 Mock 的最小实现

1. 一个 `http.createServer`，按 `method + path` 匹配项目接口。
2. 读取接口的响应示例（status / headers / body）。
3. 支持「固定响应」和「按 JSON Schema 生成」两种模式。
4. 支持字段名规则（如 `*time` → 时间、`*id` → 数字）。
5. 提供一个管理接口，让前端保存 Mock 配置。

### 8.2 不建议照搬的点

- 98MB 的 `doc-sharing-dist` 不需要；分享文档可以用更轻的 Markdown/HTML 渲染。
- AI 期望匹配（`ai_expect`）可以先不做，保留「固定响应 + 条件匹配」即可。
- 复杂的模型 `$ref` 解析可以后置。

### 8.3 关键坑

- 路径参数匹配要兼容 URL 编码与 `{param}` 两种写法。
- Mock 配置必须和接口实体分离，否则改接口会丢失 Mock 数据。
- 端口冲突要自动递增，并把实际端口回报给前端。
- 管理接口必须限制回环地址 + Origin，否则局域网可写你的文件。
- 大响应不要一次性 JSON 序列化（流式输出更稳）。

---

## 9. 复核补充（2026-10-24）

- **默认值**：`mock_server_enable = 1`；
  `mock_setup = {mock_method: 1, mock_code_method: 1, mock_engine: 1}`；
  `ai_expect = {list: [], none_math_expect_id: "", none_math_example: null}`。
- **期望匹配**：`conditions` 之间是 AND；命中第一个 `enable > 0` 的期望；
  `expect_id != 0` 时取 `targetData.example`，否则用内联 `example`；
  全不命中且无兜底时返回 `{}`。
- **未命中配置**：直接 `200` 返回 `"Mock config not found"`，不会进入
  生成流程。
- **Schema 分支**：`res.json(JSON.stringify(obj))` 造成二次编码；
  XML 用字符串拼装。复刻时应修正为标准 `res.json(obj)`。
- **分享 token**：12 小时 TTL；`/doc/*` 查看链路不受管理接口回环限制。
- **端口**：Mock 服务 `server.listen(port)` 未绑定 host，实际监听所有网卡；
  `localhost` 只是示例（管理接口另有回环校验）。

## 10. 证据索引（2026-10-24 复核）

| 断言 | 证据 |
|---|---|
| `sleep` 调用未 await | `analysis/ext/mock/server.js:220-222` |
| `mock_inner_rules.json` 被跳过 | `analysis/ext/mock/server.js:481`、`:627` |
| 未命中配置直接返回 | `analysis/ext/mock/server.js:121-131` |
| 默认规则来源 | `analysis/ext/mock/server.js:10`、`:254` |
| 分享 `/doc/*` 路由 | `analysis/ext/mock/share.js:481/492/503/532` |
| 无 `/share/:id/verify` 与 `/data` | `analysis/ext/mock/share.js:575-637`（仅注释提到） |
| token TTL 12h | `analysis/ext/mock/share.js:300` |
| `/doc/*` 不受管理回环限制 | `analysis/ext/mock/share.js:578` |
| 监听所有网卡 | `analysis/ext/mock/server.js:807` |

未确认：`mock_custom_rules.json` 的优先级、AI 期望的完整匹配器、
`doc-sharing-dist` 的组件清单。
