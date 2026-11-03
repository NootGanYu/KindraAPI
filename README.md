# KindraAPI

KindraAPI 是一个本地优先的 API 调试与协作工具：接口调试、请求历史、环境与 Cookie 管理、接口文档分享、流程自动化，以及供 AI Agent 使用的 MCP 服务。

所有数据默认保存在本机，不依赖云端账号。

## 功能

- **接口调试**：HTTP 请求、环境变量、路径/查询/Header/Cookie、多种 Body 类型、响应查看与 JSON 校验
- **接口管理**：项目 / 目录 / 接口树、标签页、拖拽排序、版本快照、克隆
- **文档与分享**：接口说明富文本、本地只读文档页、密码/有效期、Markdown 与 OpenAPI 导出
- **环境管理**：环境下拉搜索、全局参数、全局变量、Cookie 管理器
- **代码生成**：基于解析后的真实请求生成 curl
- **流程自动化**：请求、脚本、断言、条件、循环、等待等事件
- **字典与数据模型**：数据字典、模型可视化、MySQL 表结构导入
- **MQTT**：独立连接配置、连接测试、持久会话、多订阅、消息收件箱、发布面板、MQTT 5 常用属性与三类导出
- **MCP**：通过 stdio / TCP 向 AI Agent 暴露项目、接口、执行、字典与 MQTT 会话能力

## 技术栈

Electron 45 · electron-vite 6 · React 18 · Ant Design 5 · Zustand 5 · postman-runtime · TypeScript

## 环境要求

- Node.js >= 22.12
- npm >= 10

## 本地开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run typecheck   # 类型检查
npm run build       # 构建主进程 / preload / 渲染层产物到 out/
npm run smoke       # 端到端冒烟测试
npm run demo        # 本地演示 HTTP 服务
```

## 打包

打包使用 [electron-builder](https://www.electron.build/)，配置见 `electron-builder.yml`，产物输出到 `release/`。

### macOS

```bash
npm run pack:mac
```

默认生成 Apple Silicon（arm64）的 `.dmg` 与 `.zip`。

### Windows

```bash
npm run pack:win
```

生成 x64 的 NSIS 安装包与免安装 `.zip`。

> macOS 构建会通过 `scripts/after-pack.cjs` 自动执行 ad-hoc 签名，但未做 Apple 公证。首次打开如被拦截，可在 Finder 中右键选择“打开”，或执行：
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/KindraAPI.app
> ```
>
> Windows 构建未签名，可能出现 SmartScreen 提示，选择“仍要运行”即可。

### 手动指定目标

```bash
npx electron-builder --mac dmg zip --arm64
npx electron-builder --win nsis zip --x64
```

## 数据目录

- macOS：`~/Library/Application Support/KindraAPI`
- Windows：`%APPDATA%/KindraAPI`

项目数据、发送历史、分享文档与 MCP 配置均保存在该目录下。

## MQTT

左侧导航的「MQTT」是独立于 API 页面的项目级模块（ADR-0003）：它不使用 Target 树、Environment 变量、DocShare、OpenAPI 或 Send Record。

支持范围：

- Connection Profile：TCP/TLS/WS/WSS、MQTT 3.1.1 与 5.0、认证、TLS、Will、MQTT 5 连接属性、保留策略
- 连接：测试连接（可选往返验证）、持久会话、指数退避重连、自动重订阅、同一配置全局单会话
- 消息：多订阅、收件箱、JSON/Plain/Hex/Base64 视图、1MB 限制、分片 JSONL 落盘与轮转、搜索、清空、导出
- 发布：QoS 0/1/2、retain、MQTT 5 User Properties、最近历史、有护栏的定时/循环发布
- 配置：轻量版本快照（最近 20 个）、克隆、Profile JSON / 消息 JSONL·CSV / Attempt JSONL 导出

边界：一期不包含 payload 脚本变换、压测、CLI、HTTP/SOCKS 代理、MQTT 3.1、Flow 自动化节点与配置导入。

数据归属：

- Connection Profile 与版本位于 `offline-data/<project_id>/mqtt/`，随项目 Git 版本管理。
- 消息、Connection Attempt 与发布历史位于 `offline-data-local/projects/<project_id>/mqtt/`，**不随项目 Git 版本管理**。

已知限制：消息搜索只作用于当前已加载的消息；Connection Profile 导出包含明文凭据（ADR-0004），导出前会提示风险。

术语见 `GLOSSARY.md` 的 MQTT 分组，决策见 `docs/adr/0003-mqtt-as-independent-module.md` 与 `docs/adr/0004-mqtt-plaintext-credentials-in-exports.md`。

## MCP

在应用「配置 → MCP」中开启服务后，可让 AI Agent 通过本地 MCP 访问 KindraAPI。仓库根目录提供 `mcp-stdio.cjs` 作为 stdio 桥接器，打包后的应用也会在资源目录中附带该文件。

### 编码时维护接口文档

编码 Agent 优先调用 `upsert_api`：一次提交请求参数、请求体、成功响应字段规则及示例，不需要先执行接口。先用 `list_projects` 获取已授权项目，使用项目内稳定的 `source_key`（例如控制器方法名）重复更新同一接口，或使用已知 `target_id`。

```json
{
  "project_id": "项目 ID",
  "source_key": "OrderController.detail",
  "name": "订单详情",
  "method": "GET",
  "url": "{{baseUrl}}/orders/detail",
  "query": [{
    "key": "id", "value": "order_001", "type": "string",
    "description": "订单标识", "required": true, "nullable": false, "enum": null
  }],
  "body": { "mode": "none" },
  "success_response": {
    "code": 200,
    "raw": { "state": 1 },
    "field_docs": [{
      "path": "state", "type": "integer", "description": "订单状态",
      "required": true, "nullable": false,
      "enum": [0, 1, 2], "enum_descriptions": ["待审核", "通过", "驳回"],
      "default": 0, "example": 1
    }]
  }
}
```

- `url` 必须填写完整的 `http://` 或 `https://` 地址，包含主机名和路径，不能只写 `/path`。项目使用环境前缀时可写 `{{baseUrl}}/path`，但 `baseUrl` 必须解析为完整地址。
- 新建接口执行硬性文档校验：接口说明、完整 URL，以及每个已知请求/响应字段的 `description`、`type`、`required`、`nullable`、`enum` 均为必填；有枚举时必须提供 `enum_descriptions`。缺失任一项时服务端拒绝写入且不保存。无法确定时先向用户确认，不能根据字段名或示例猜测。创建目录和数据模型时也应填写对应说明。
- 字段路径支持 `data.items[].id` 或 JSON Pointer `/data/items/*/id`；无需先在示例中填入该字段。
- `required` 表示请求必填或响应必有，与 `nullable` 分开；嵌套字段的必填仅在父对象存在时生效。
- `enum: null` 明确表示无限制；不提供规则表示待补充。枚举值保留 JSON 类型，`enum_descriptions` 按顺序对应。
- 参数按 `key`、JSON 字段按路径增量更新；未提交的内容保留。`{ "path": "data.note", "remove": true }` 删除字段及其子字段，并从示例中移除；`{ "path": "state", "unset": ["default"] }` 清除单项规则。
- 返回 `target_id`、完整 `api` 及 `documentation.issues`。新建接口缺少必填文档时整次拒绝，不会产生半成品；更新接口仅校验本次显式提交的字段，未提交字段保持原样。Agent 应核查每条 `path/missing`，根据业务代码补全；未知含义不能从一次响应猜测。不合法定义拒绝整次接口写入，原有数据保留。
- 模型引用继承完整字段规则；需要单独维护时传 `model_id: null` 解除引用并保留当前定义。
- `create_api`、`update_api` 兼容上述字段。旧客户端更新参数列表和字段文档现改为增量合并；显式删除使用 `remove`。多接口逐个调用，现有 `sync_openapi` 仍可批量导入。
- 发送接口和普通保存不再自动替换响应示例。应用中通过“保存为响应示例”选择新增或更新；MCP 执行时仅在显式传 `save_response: true` 时保存。

字段文档同步用于应用内查看、在线分享、离线 HTML、Markdown 和 OpenAPI。OpenAPI 用 `x-enum-descriptions` 保存枚举含义，用 `x-kindra-rules` 保留未说明状态；其他工具可能忽略扩展字段。

运行 `npm run test:documentation` 验证 stdio MCP 编写及文档导出流程；测试使用隔离的临时数据目录。

运行 `npm run test:client-sync` 验证外部变更同步、冲突保护与标签刷新；测试同样使用隔离的临时数据目录。

上述完整字段编写能力自 0.2.4 提供；新建接口的硬性文档门槛自 0.2.6 起生效。升级应用后重启 KindraAPI，并让 Agent 重新连接 MCP 以刷新工具列表；原来的 `mcp-stdio.cjs` 和 `KINDRAAPI_MCP_INFO` 配置路径不变。旧接口缺少的业务说明、必填及枚举规则会标为“待补充”，需由 Agent 根据业务代码补齐；更新旧接口时只校验本次提交的字段，不会因历史缺项而阻塞。

MQTT 工具：`mqtt_list_profiles`、`mqtt_create_profile`、`mqtt_update_profile`、`mqtt_delete_profile`、`mqtt_test_connection`、`mqtt_connect`、`mqtt_subscribe`、`mqtt_unsubscribe`、`mqtt_publish`、`mqtt_drain_messages`、`mqtt_list_sessions`、`mqtt_disconnect`。Profile 写工具受 `allow_write` 控制；连接/测试/订阅/发布/断开受 `allow_execute` 控制；消息使用游标拉取；MCP 会话空闲 5 分钟自动回收。

## 许可

MIT
