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

MQTT 工具：`mqtt_list_profiles`、`mqtt_test_connection`、`mqtt_connect`、`mqtt_subscribe`、`mqtt_unsubscribe`、`mqtt_publish`、`mqtt_drain_messages`、`mqtt_list_sessions`、`mqtt_disconnect`。连接/测试/订阅/发布/断开受 `allow_execute` 控制；消息使用游标拉取；MCP 会话空闲 5 分钟自动回收。

## 许可

MIT
